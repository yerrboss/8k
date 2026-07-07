const { ipcRenderer } = require("electron");
const http = require("http");
const net = require("net");
// Track which channels have already been initialized on the hardware
const initializedChannels = new Set();
let modifiedMonitors = new Set();
let isUserDragging = false; 

/* ==========================================================================
   GLOBAL STATE & CORE TOPOLOGY CONFIGURATION
   ========================================================================== */
let API_BASE = "http://127.0.0.1:8080";
let isInfrastructureMode = false;
let isAnimatingPreset = false;
let selectedGroup = new Set();

/* ==========================================================================
   BROADCAST LAYOUT ENGINE
   ========================================================================== */

const BROADCAST_PRESETS = {
  QUAD: [
    { ch: 0, x: 0, y: 0, w: 3840, h: 2160 },
    { ch: 1, x: 3840, y: 0, w: 3840, h: 2160 },
    { ch: 2, x: 0, y: 2160, w: 3840, h: 2160 },
    { ch: 3, x: 3840, y: 2160, w: 3840, h: 2160 },
  ],
  VERTICAL: [
    { ch: 0, x: 0, y: 0, w: 1920, h: 4320 },
    { ch: 1, x: 1920, y: 0, w: 1920, h: 4320 },
    { ch: 2, x: 3840, y: 0, w: 1920, h: 4320 },
    { ch: 3, x: 5760, y: 0, w: 1920, h: 4320 },
  ],
  SIX_PACK: [
    { ch: 0, x: 0, y: 0, w: 2560, h: 2160 },
    { ch: 1, x: 2560, y: 0, w: 2560, h: 2160 },
    { ch: 2, x: 5120, y: 0, w: 2560, h: 2160 },
    { ch: 3, x: 0, y: 2160, w: 2560, h: 2160 },
    { ch: 4, x: 2560, y: 2160, w: 2560, h: 2160 },
    { ch: 5, x: 5120, y: 2160, w: 2560, h: 2160 },
  ],
  PIP_MAIN: [
    { ch: 0, x: 0, y: 0, w: 5760, h: 4320 },
    { ch: 1, x: 5760, y: 0, w: 1920, h: 1440 },
    { ch: 2, x: 5760, y: 1440, w: 1920, h: 1440 },
    { ch: 3, x: 5760, y: 2880, w: 1920, h: 1440 },
  ],
  T_BAR: [
    { ch: 0, x: 0, y: 0, w: 7680, h: 2160 },
    { ch: 1, x: 0, y: 2160, w: 2560, h: 2160 },
    { ch: 2, x: 2560, y: 2160, w: 2560, h: 2160 },
    { ch: 3, x: 5120, y: 2160, w: 2560, h: 2160 },
  ],
FOCUS_CENTER: [
    // --- 1. THE MAIN CENTER FOCUS ---
    // Channel 0 becomes a giant 4K screen locked perfectly in the middle
    { ch: 0, x: 1920, y: 1080, w: 3840, h: 2160 }, 

    // --- 2. TOP BORDER ROW (4 screens) ---
    { ch: 1, x: 0, y: 0, w: 1920, h: 1080 },
    { ch: 2, x: 1920, y: 0, w: 1920, h: 1080 },
    { ch: 3, x: 3840, y: 0, w: 1920, h: 1080 },
    { ch: 4, x: 5760, y: 0, w: 1920, h: 1080 },

    // --- 3. MIDDLE SIDES (Flanking the center) ---
    { ch: 5, x: 0, y: 1080, w: 1920, h: 1080 },      // Left Top
    { ch: 6, x: 5760, y: 1080, w: 1920, h: 1080 },   // Right Top
    { ch: 7, x: 0, y: 2160, w: 1920, h: 1080 },      // Left Bottom
    { ch: 8, x: 5760, y: 2160, w: 1920, h: 1080 },   // Right Bottom

    // --- 4. BOTTOM BORDER ROW (4 screens) ---
    { ch: 9, x: 0, y: 3240, w: 1920, h: 1080 },
    { ch: 10, x: 1920, y: 3240, w: 1920, h: 1080 },
    { ch: 11, x: 3840, y: 3240, w: 1920, h: 1080 },
    { ch: 12, x: 5760, y: 3240, w: 1920, h: 1080 },
  ],
CLEAN_GRID: [
    // --- TOP ROW ---
    { ch: 0, x: 0, y: 0, w: 2560, h: 1440 },
    { ch: 1, x: 2560, y: 0, w: 2560, h: 1440 },
    { ch: 2, x: 5120, y: 0, w: 2560, h: 1440 },

    // --- MIDDLE ROW ---
    { ch: 3, x: 0, y: 1440, w: 2560, h: 1440 },
    { ch: 4, x: 2560, y: 1440, w: 2560, h: 1440 },
    { ch: 5, x: 5120, y: 1440, w: 2560, h: 1440 },

    // --- BOTTOM ROW ---
    { ch: 6, x: 0, y: 2880, w: 2560, h: 1440 },
    { ch: 7, x: 2560, y: 2880, w: 2560, h: 1440 },
    { ch: 8, x: 5120, y: 2880, w: 2560, h: 1440 },
  ],
};

function getCanvasBoundingBox() {
  const screens = document.querySelectorAll(".screen-layer");
  if (screens.length === 0)
    return { x: 0, y: 0, w: 7680, h: 4320, centerX: 3840, centerY: 2160 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  screens.forEach((s) => {
    const left = parseFloat(s.style.left);
    const top = parseFloat(s.style.top);
    const width = parseFloat(s.style.width);
    const height = parseFloat(s.style.height);

    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, left + width);
    maxY = Math.max(maxY, top + height);
  });

  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
    centerX: minX + (maxX - minX) / 2,
    centerY: minY + (maxY - minY) / 2,
  };
}

async function applyPreset(presetName) {
  const layout = BROADCAST_PRESETS[presetName];
  if (!layout) return;

  for (let i = 0; i < layout.length; i++) {
    const el = document.querySelector(
      `.video-layer[data-channel="${layout[i].ch}"]:not(.screen-layer)`,
    );
    if (!el) {
      spawnSourceOnCanvas("AUTO_SPAWN", 0, 0, null, "LIVE", null, 0, layout[i].ch, false, "");
    }
  }

  const masterScreen = document.querySelector(".screen-layer");
  if (!masterScreen) return;

  const mX = parseFloat(masterScreen.style.left) || 0;
  const mY = parseFloat(masterScreen.style.top) || 0;
  const mW = parseFloat(masterScreen.style.width) || 7680;
  const mH = parseFloat(masterScreen.style.height) || 4320;

  const layers = Array.from(document.querySelectorAll(".video-layer:not(.screen-layer)"));

  layout.forEach((config) => {
    const el = layers.find((l) => parseInt(l.dataset.channel) === config.ch);
    if (!el) return;

    const scaleX = mW / 7680;
    const scaleY = mH / 4320;

    el.style.left = `${mX + config.x * scaleX}px`;
    el.style.top = `${mY + config.y * scaleY}px`;
    el.style.width = `${config.w * scaleX}px`;
    el.style.height = `${config.h * scaleY}px`;

    el.style.objectFit = "cover";
    el.style.overflow = "hidden";

    pushUpdateToHardware(el, true);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initQuickLayoutUI();
});

function initQuickLayoutUI() {
  const container = document.getElementById("presetContainer");
  if (!container) return;

  container.innerHTML = "";

  Object.keys(BROADCAST_PRESETS).forEach((name) => {
    const btn = document.createElement("button");
    btn.className = "ptz-btn";
    btn.style.fontSize = "9px";
    btn.style.padding = "6px";
    btn.style.cursor = "pointer";
    btn.innerText = name.replace("_", " ");
    btn.onclick = () => applyPreset(name);
    container.appendChild(btn);
  });
}

function sendRawTCP(rawPath) {
  return new Promise((resolve) => {
    const urlObj = new URL(API_BASE);
    const host = urlObj.hostname;
    const port = urlObj.port || 8080;
    const client = new net.Socket();

    client.connect(port, host, () => {
      client.write(`GET ${rawPath} HTTP/1.1\r\n`);
      client.write(`Host: ${host}:${port}\r\n`);
      client.write(`Connection: close\r\n\r\n`);
    });

    client.on("data", () => {
      client.destroy();
      resolve();
    });

    client.on("error", (err) => {
      console.error("TCP Bypass Error:", err);
      client.destroy();
      resolve();
    });
  });
}

function sendRawCommand(fullUrl) {
  return new Promise((resolve, reject) => {
    try {
      const ipPort = fullUrl.split("/command")[0].replace("http://", "");
      const [hostname, port] = ipPort.split(":");
      let rawPath = fullUrl.substring(fullUrl.indexOf("/command"));
      const safePath = encodeURI(rawPath);

      const req = http.request(
        { hostname: hostname, port: port || 8080, path: safePath, method: "GET" },
        (res) => resolve(res.statusCode),
      );

      req.on("error", (e) => reject(e));
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

const commandQueue = [];
let isProcessing = false;

async function addToQueue(url) {
  commandQueue.push(url);
  if (!isProcessing) processQueue();
}

async function processQueue() {
  isProcessing = true;
  while (commandQueue.length > 0) {
    const url = commandQueue.shift();
    try {
      await fetch(url, { keepalive: true });
      await new Promise((r) => setTimeout(r, 50));
    } catch (e) {
      console.error("Queue Error:", e);
    }
  }
  isProcessing = false;
}

function getEndpoints() {
  return {
    alive: `${API_BASE}/alive`,
    status: `${API_BASE}/query?key=status`,
    screens: `${API_BASE}/query?key=screens`,
    inputs: `${API_BASE}/query?key=input_sources`,
    channels: `${API_BASE}/query?key=channels`,
    sources: `${API_BASE}/query?key=sources`,
  };
}

let activeElement = null;
let highestZ = 1000;
let warpActive = false;
let systemOnline = false;
let isScanning = false;

let canvasScale = 0.25;
let uiZoom = 1.0;
let panX = 0, panY = 0;
let isPanningWorkspace = false;
let isSpacePressed = false;
let hasAutoCentered = false;
let currentMappingMode = "pixel";

let localImportedFiles = [];
let detectedSignals = { NDI: [], LIVE: [], STREAM: [], PTZ: [] };
let lastActivePreset = 1;

const UI_IDENTITY = {
  accent: "#00f2ff",
  critical: "#ff4444",
  surface: "rgba(0, 242, 255, 0.05)",
  fontPrimary: "'Consolas', 'Monaco', monospace",
  borderDefault: "2px solid var(--vada-accent)",
  gridColor: "rgba(255, 255, 255, 0.05)",
  transitionFast: "0.15s ease-out",
  glowEffect: "0 0 15px rgba(0, 242, 255, 0.4)",
};

console.log("Salrayworks VaDA Engine: Initializing Full-Scale Architecture...");

/* ==========================================================================
   BOOTSTRAP ENGINE & CSS INJECTION
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  console.log("Salrayworks Core // Interaction Engine Online");

  const style = document.createElement("style");
  style.innerHTML = `
        #mediaPoolList { display: flex; flex-direction: column; gap: 10px; overflow-y: auto !important; overflow-x: hidden; max-height: 80vh; padding-right: 8px; }
        #mediaPoolList::-webkit-scrollbar { width: 4px; }
        #mediaPoolList::-webkit-scrollbar-thumb { background: #252525; border-radius: 10px; }
        #mediaPoolList::-webkit-scrollbar-track { background: rgba(0, 0, 0, 0.05); }
        .media-item { cursor: pointer; transition: background 0.2s; border: 1px solid rgba(255,255,255,0.1); }
        .media-item:hover { background: rgba(0, 242, 255, 0.1); border-color: ${UI_IDENTITY.accent}; }

        .window-controls { z-index: 10005 !important; -webkit-app-region: no-drag; }
        #architectPanel, #inspectorPanel, .guideline-dropdown, .right-sidebar { z-index: 10001 !important; pointer-events: auto !important; }
        .video-layer { pointer-events: auto !important; }
        
        #workspaceView { background-color: #050505 !important; }
        #vada-grid-layer { opacity: 1; transition: opacity 0.2s; }

        #vada-grid-layer.grid-100 { background-image: linear-gradient(rgba(0, 242, 255, 0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 242, 255, 0.4) 1px, transparent 1px); background-size: 25px 25px; }
        #vada-grid-layer.grid-200 { background-image: linear-gradient(rgba(0, 242, 255, 0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 242, 255, 0.4) 1px, transparent 1px); background-size: 50px 50px; }
        #vada-grid-layer.grid-400 { background-image: linear-gradient(rgba(0, 242, 255, 0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 242, 255, 0.4) 1px, transparent 1px); background-size: 100px 100px; }
        #vada-grid-layer.grid-thirds { display: grid !important; grid-template-columns: 1fr 1fr 1fr !important; grid-template-rows: 1fr 1fr 1fr !important; background-image: none !important; border: none !important; }
        #vada-grid-layer.grid-thirds::before { content: ""; grid-column: 1 / 4; grid-row: 1 / 4; border: 2px solid rgba(0, 242, 255, 0.5); background-image: linear-gradient(to right, rgba(0, 242, 255, 0.5) 3px, transparent 2px), linear-gradient(to bottom, rgba(0, 242, 255, 0.5) 3px, transparent 2px); background-size: 33.33% 33.33%; }

        .guideline-dropdown { position: relative; display: inline-block; width: 100%; margin-top: 10px; }
        .guideline-content { display: none; position: absolute; top: 100%; left: 0; background: #0a0a0a; border: 1px solid ${UI_IDENTITY.accent}; width: 100%; z-index: 10002; box-shadow: 0 10px 30px rgba(0,0,0,0.8); margin-top: 5px; border-radius: 4px; overflow: hidden; }
        .guideline-dropdown.open .guideline-content { display: block; }
        .guideline-opt { padding: 10px 15px; color: #ccc; cursor: pointer; font-size: 11px; font-family: ${UI_IDENTITY.fontPrimary}; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); text-transform: uppercase; }
        .guideline-opt:hover { background: rgba(0, 242, 255, 0.1); color: #fff; }
        .guideline-opt.active { color: ${UI_IDENTITY.accent}; background: rgba(0, 242, 255, 0.05); font-weight: bold; }
        .guideline-opt.active::after { content: '✓'; }

        .ptz-btn { background: rgba(0, 0, 0, 0.6); border: 1px solid rgba(0, 242, 255, 0.3); width: 100%; color: #ffffff; padding: 10px 15px; cursor: pointer; border-radius: 4px; font-family: ${UI_IDENTITY.fontPrimary}; transition: all 0.15s ease-out; display: flex; align-items: center; justify-content: center; text-transform: uppercase; }
        .ptz-btn:hover { border-color: ${UI_IDENTITY.accent}; color: ${UI_IDENTITY.accent}; box-shadow: ${UI_IDENTITY.glowEffect}; }
        .ptz-btn:active { background: ${UI_IDENTITY.accent}; color: #000; }

        #networkOverlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 99999; display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: ${UI_IDENTITY.fontPrimary}; color: white; }
        .network-box { background: #111; border: 1px solid ${UI_IDENTITY.accent}; padding: 30px; border-radius: 8px; box-shadow: ${UI_IDENTITY.glowEffect}; text-align: center; }
        .network-input { background: #222; border: 1px solid #444; color: white; padding: 10px; width: 250px; text-align: center; font-size: 16px; font-family: monospace; margin: 20px 0; outline: none; }
        .network-input:focus { border-color: ${UI_IDENTITY.accent}; }
        
        #webrtc-debug-corner { position: absolute; bottom: 20px; right: 20px; width: 320px; height: 180px; background: #000; border: 2px solid var(--vada-accent); border-radius: 4px; z-index: 10000; box-shadow: 0 5px 20px rgba(0,0,0,0.8); display: flex; flex-direction: column; overflow: hidden; pointer-events: none; }
        #webrtc-debug-corner:active { cursor: grabbing; }

        .custom-dropdown { position: relative; width: 100%; margin-top: 5px; font-family: var(--font-primary, monospace); font-size: 12px; color: #fff; user-select: none; }
        .dropdown-selected { background: #111; border: 1px solid #444; padding: 8px 12px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; border-radius: 2px; transition: border-color 0.15s; }
        .dropdown-selected:hover { border-color: #00f2ff; }
        .dropdown-selected::after { content: '▼'; font-size: 8px; color: #666; }
        
        .dropdown-options { display: none; position: absolute; top: 100%; left: 0; width: 100%; background: #0a0a0a; border: 1px solid #00f2ff; z-index: 10005 !important; box-shadow: 0 10px 30px rgba(0,0,0,0.9); border-radius: 0 0 4px 4px; }
        .custom-dropdown.open .dropdown-options { display: block; }
        .dropdown-options .option { padding: 10px 12px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.1s; }
        .dropdown-options .option:hover { background: rgba(0, 242, 255, 0.15); color: #fff; }
        .dropdown-options .option.active { color: #00f2ff; background: rgba(0, 242, 255, 0.05); font-weight: bold; }
        
        #webrtc-debug-corner video { width: 100%; height: 100%; object-fit: cover; background: #000; pointer-events: none; border-radius: 0 0 4px 4px; }
        #webrtc-debug-label-inline-inline-inline { position: absolute; top: 0; left: 0; width: 100%; background: rgba(0,0,0,0.8); color: #00f2ff; font-family: monospace; font-size: 10px; padding: 6px; border-bottom: 1px solid rgba(0, 242, 255, 0.3); z-index: 10; pointer-events: none; }

        #webrtc_bg_video { pointer-events: none !important; }
        #bottomControlDeck { z-index: 10005 !important; position: relative; pointer-events: auto !important; }
        .guideline-dropdown { padding-bottom: 10px; }
        .guideline-content { margin-top: 0px !important; }

        /* =========================================================
           THE MISSING INFRASTRUCTURE LOCKS
           ========================================================= */
        .screen-layer { pointer-events: auto !important; border: 1px dashed rgba(0, 242, 255, 0.3) !important; background: transparent !important; z-index: 1 !important; transition: all 0.3s ease; }
        .screen-layer .transform-nodes, .screen-layer .rotate-node { display: none !important; }

        /* Visual confirmation that you successfully targeted this monitor */
body:not(.infra-mode-active) .screen-layer.active {
    border: 1px solid #00f2ff !important;
    background: rgba(0, 242, 255, 0.05) !important;
    box-shadow: 0 0 20px rgba(0, 242, 255, 0.1) inset;
}

        /* THE NEW DISABLED MONITOR STATE */
        body.infra-mode-active .screen-layer.is-disabled { 
            border: 2px dashed #ff4444 !important; 
            background: repeating-linear-gradient(45deg, rgba(255, 68, 68, 0.1), rgba(255, 68, 68, 0.1) 10px, transparent 10px, transparent 20px) !important; 
            opacity: 0.4 !important; 
        }
        body.infra-mode-active .screen-layer.is-disabled .transform-nodes, 
        body.infra-mode-active .screen-layer.is-disabled .rotate-node { 
            border-color: #ff4444 !important; 
        }

        /* --- ADD THIS RULE TO HIDE IT IN THE WORKSPACE --- */
        body:not(.infra-mode-active) .screen-layer.is-disabled {
            display: none !important;
        }
        
        body.infra-mode-active .screen-layer { pointer-events: auto !important; border: 2px dashed #ff00ff !important; background: repeating-linear-gradient(45deg, rgba(255, 0, 255, 0.05), rgba(255, 0, 255, 0.05) 10px, transparent 10px, transparent 20px) !important; z-index: 9999 !important; }
        body.infra-mode-active .screen-layer .transform-nodes, body.infra-mode-active .screen-layer .rotate-node { display: block !important; }
        
        body.infra-mode-active .video-layer:not(.screen-layer) { pointer-events: none !important; opacity: 0.15 !important; filter: grayscale(100%); transition: all 0.3s ease; }
        
        
    `;
  document.head.appendChild(style);

  try {
    initSystemWindowControls();
    initImportEngine();
    initCanvasResizers();
    initCanvasNavigation();
    initCustomDropdowns();
    window.loadProjects();
    initGlobalContextHandlers();
    initMediaCollapse();
    initInspectorFields();
    initNavigationBindings();
    initDiscoveryMenus();
    verifyHardwareConnection();

// REPLACE the injection code in DOMContentLoaded with this:
const surface = document.getElementById("activeSurface");
if (surface) {
    const marker = document.createElement("div");
    marker.id = "canvas-origin-marker";
    surface.appendChild(marker);
}

    initCustomDropdowns();
    window.loadProjects();

    const urlInput = document.getElementById("webrtcUrlInput");
    if (urlInput) urlInput.value = WEBRTC_SIGNAL_URL;

document.addEventListener("mousedown", (e) => {
    // 1. Ignore clicks on UI panels and menus
    if (
        e.target.closest(".salray-title-bar") || 
        e.target.closest("#bottomControlDeck") || 
        e.target.closest("#inspectorPanel") || 
        e.target.closest(".sidebar-right") || // <--- THE FIX IS HERE
        e.target.closest(".custom-dropdown") ||
        e.target.closest("#webrtc-debug-corner") ||
        e.target.closest("#architectPanel") ||
        e.target.closest("#mediaPoolList") ||
        e.target.closest(".media-item") ||
        e.target.closest("#sourceTray") ||
        e.target.closest("#mediaFlyout") ||
        e.target.closest(".flyout-item")
    ) {
        return; 
    }

    const target = e.target.closest(".moveable-source");
    
    // 2. Clicked a video source (Let the source's pointerdown handle it)
    if (target) {
        return;
    } 
    // 3. Clicked the empty canvas: Clear everything
    else if (e.target.closest(".canvas-viewport")) {
        
        if (activeElement) {
            activeElement.classList.remove("active");
            removeWarpPoints(activeElement);
            if (activeElement.dataset.cropMode === "true") {
                activeElement.dataset.cropMode = "false";
                activeElement.classList.remove("crop-mode-active");
                const ghost = activeElement.querySelector(".source-ghost-outline");
                if (ghost) ghost.remove();
                pushUpdateToHardware(activeElement, true); 
            }
        }

        document.querySelectorAll(".video-layer.crop-mode-active").forEach(el => {
            el.dataset.cropMode = "false";
            el.classList.remove("crop-mode-active");
            const ghost = el.querySelector(".source-ghost-outline");
            if (ghost) ghost.remove();
            pushUpdateToHardware(el, true);
        });

        // Wipe out the group selection
        if (typeof selectedGroup !== 'undefined') {
            selectedGroup.forEach(item => {
                item.classList.remove("active");
                removeWarpPoints(item);
            });
            selectedGroup.clear();
        }

        // Clear coordinate inputs
        const xInput = document.getElementById("posX");
        const yInput = document.getElementById("posY");
        const sInput = document.getElementById("posScale");
        if (xInput) xInput.value = "";
        if (yInput) yInput.value = "";
        if (sInput) sInput.value = "";
        
        const tooltip = document.getElementById("vada-drag-tooltip");
        if (tooltip) tooltip.style.display = "none";

        // Reset active states
        activeElement = null;
        togglePTZControls(false); 
        
        // --- THE FIX: Force the HUD to update (which triggers the CSS :empty fade out) ---
        if (typeof syncInspector === "function") {
            syncInspector();
        }
    }
});

  } catch (err) {
    console.error("CRITICAL BOOT ERROR - ENGINE HALTED:", err);
  }

// --- THE NEW GLOBAL LOCK BUTTON LOGIC ---
  const globalLockBtn = document.getElementById("globalLockBtn");
  if (globalLockBtn) {
      window.isGlobalLockActive = false; 
      
      globalLockBtn.onclick = () => {
          // Flip the state
          window.isGlobalLockActive = !window.isGlobalLockActive;
          
          // Apply the Active Design (Solid Cyan Glow) or Reset to Default
          if (window.isGlobalLockActive) {
              globalLockBtn.innerText = "CANVAS LOCKED";
              globalLockBtn.style.background = "var(--vada-accent)";
              globalLockBtn.style.color = "#000";
              globalLockBtn.style.boxShadow = "0 0 15px var(--vada-accent)";
          } else {
              globalLockBtn.innerText = "LOCK CANVAS";
              globalLockBtn.style.background = "transparent";
              globalLockBtn.style.color = "var(--vada-accent)";
              globalLockBtn.style.boxShadow = "none";
          }
          
          // Apply lock state to the layers
          document.querySelectorAll(".video-layer, .screen-layer").forEach((el) => {
              el.dataset.locked = window.isGlobalLockActive ? "true" : "false";
              el.classList.toggle("is-locked", window.isGlobalLockActive);
          });
      };
  }
  
goHome();
});

/* ==========================================================================
   WebRTC ENGINE INTEGRATION (FULL-SCREEN SYNC)
   ========================================================================== */

let webrtcPC = null;
let webrtcWS = null;
let WEBRTC_SIGNAL_URL = "";

function randomId(length) {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

async function handleWebRTCOffer(offer) {
  stopWebRTC();
  const config = { bundlePolicy: "max-bundle", iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }] };
  webrtcPC = new RTCPeerConnection(config);

  webrtcPC.ontrack = (evt) => {
    const bgVideo = document.getElementById("webrtc_bg_video");
    const label = document.getElementById("webrtc-debug-label-inline");

    if (bgVideo) {
      bgVideo.srcObject = evt.streams[0];
      bgVideo.play().catch(() => {});
      if (label) { label.innerText = "CANVAS SYNC: FULL SCREEN LIVE 🔴"; label.style.color = "#00ff00"; }
    }
  };

  await webrtcPC.setRemoteDescription(offer);
  const answer = await webrtcPC.createAnswer();
  await webrtcPC.setLocalDescription(answer);

  if (webrtcWS && webrtcWS.readyState === WebSocket.OPEN) {
    webrtcWS.send(JSON.stringify({ id: "server", type: webrtcPC.localDescription.type, sdp: webrtcPC.localDescription.sdp }));
  }
}

function stopWebRTC() {
  if (!webrtcPC) return;
  webrtcPC.getTransceivers().forEach((t) => t.stop && t.stop());
  webrtcPC.close();
  webrtcPC = null;
}

let hasAutoConfiguredWebRTC = false;

function autoConfigureWebRTC() {
  if (hasAutoConfiguredWebRTC) return;

  try {
    const urlObj = new URL(API_BASE);
    let hardwareIp = urlObj.hostname;
    if (hardwareIp === "127.0.0.1" || hardwareIp === "localhost") hardwareIp = "192.168.0.177";

    const webrtcPort = 8081;
    const dynamicUrl = `ws://${hardwareIp}:${webrtcPort}`;

    const input = document.getElementById("webrtcUrlInput");
    if (input && input.value !== dynamicUrl) input.value = dynamicUrl;

    window.updateWebRTCUrl(dynamicUrl);
    hasAutoConfiguredWebRTC = true;
  } catch (err) {
    console.warn("VaDA Auto-Config Failed:", err);
  }
}

/* ==========================================================================
   1. DYNAMIC STATE ROUTER 
   ========================================================================== */

function setSidebarState(state) {
  // --- FIX 1: FORCE CLEANUP SO INFRA-MODE NEVER LEAKS INTO WORKSPACE ---
  document.body.classList.remove("infra-mode-active");
  window.isInfrastructureMode = false;
  const infraBtn = document.getElementById("infraToggleBtn");
  if (infraBtn) {
      infraBtn.style.background = "transparent";
      infraBtn.style.color = "#ff00ff";
      infraBtn.innerText = "EDIT INFRASTRUCTURE";
  }
  // ----------------------------------------------------------------------

  const architect = document.getElementById("architectPanel"); 
  const inspector = document.getElementById("inspectorPanel");
  const layoutSection = document.getElementById("layoutSection");
  const quickLayoutSection = document.getElementById("quickLayoutSection");
  const lock = document.getElementById("lockSection"); 
  const reset = document.getElementById("resetSection");
  const actionButtons = document.getElementById("workspaceActionButtons");
  const infraContainer = document.getElementById("infraContainer"); 
  
  const globalLockBtn = document.getElementById("globalLockBtn");

  const scanBtn = document.querySelector("button[onclick='toggleScanner()']");
  const scanContainer = scanBtn ? scanBtn.parentElement : null;

  if (state === "GALLERY") {
    if (architect) architect.style.display = "block";
    if (scanContainer) scanContainer.style.display = "block";
    
    // Hide Canvas Elements
    if (inspector) inspector.style.display = "none";
    if (layoutSection) layoutSection.style.display = "none";
    if (quickLayoutSection) quickLayoutSection.style.display = "none";
    if (lock) lock.style.display = "none"; 
    if (reset) reset.style.display = "none";
    if (actionButtons) actionButtons.style.display = "none";
    if (infraContainer) infraContainer.style.display = "none"; 
    
    // THE FIX: Hide the button!
    if (globalLockBtn) globalLockBtn.style.display = "none";
    

    const debugBox = document.getElementById("webrtc-debug-corner");
    if (debugBox) debugBox.style.display = "none";
    if (typeof stopWebRTC === "function") stopWebRTC();

  } else if (state === "WORKSPACE") {
    if (architect) architect.style.display = "none";
    if (scanContainer) scanContainer.style.display = "none";

    if (inspector) {
      inspector.style.display = "block";
      const title = document.getElementById("inspectorTitle");
      if (title) title.innerText = "CANVAS SETTINGS";
    }
    
    // Show Canvas Elements
    if (layoutSection) layoutSection.style.display = "block";
    if (quickLayoutSection) quickLayoutSection.style.display = "block";
    if (lock) lock.style.display = "block";
    if (reset) reset.style.display = "block";
    if (actionButtons) actionButtons.style.display = "flex";
    if (infraContainer) infraContainer.style.display = "block"; 
    
    // THE FIX: Show the button!
    if (globalLockBtn) globalLockBtn.style.display = "block";

    const debugBox = document.getElementById("webrtc-debug-corner");
    if (debugBox) debugBox.style.display = "flex";
    if (typeof initWebRTC === "function") initWebRTC();
  }
}

function enterWorkspace(name, w, h) {
  const gallery = document.getElementById("galleryView");
  const workspace = document.getElementById("workspaceView");
  const taskName = document.getElementById("activeTaskName");
  const resInfo = document.getElementById("liveRes");

  if (gallery) gallery.style.display = "none";
  if (workspace) workspace.style.display = "flex";
  if (taskName) taskName.innerText = "ACTIVE: " + name.toUpperCase();
  if (resInfo) resInfo.innerText = `${w} x ${h}`;

  if (activeElement) {
    activeElement.classList.remove("active");
    activeElement = null;
  }

  setSidebarState("WORKSPACE");

  const surface = document.getElementById("activeSurface");
  if (surface) {
    surface.classList.remove("moveable-source");
    surface.style.pointerEvents = "none";
    surface.style.zIndex = "1";
    surface.style.border = "2px dashed rgba(255, 255, 255, 0.3)";
    surface.style.position = "absolute";
  }
  window.hasHardwareCentered = false;
  centerCanvas(w, h);
}

function goHome() {
  const gallery = document.getElementById("galleryView");
  const workspace = document.getElementById("workspaceView");

  if (gallery) {
    gallery.style.display = "block";
    gallery.scrollTop = 0;
    window.loadProjects();
  }
  if (workspace) workspace.style.display = "none";

  if (activeElement) activeElement.classList.remove("active");
  activeElement = null;

  setSidebarState("GALLERY");
}

function selectElement(el, event = null) {
    if (!el) return;


    // --- NEW: REMEMBER THE LAST CLICKED MONITOR ---
    if (el.classList.contains("screen-layer")) {
        window.lastTargetedMonitor = el;
    }
    
    const isMulti = event && event.shiftKey;
    const isAlreadySelected = typeof selectedGroup !== 'undefined' && selectedGroup.has(el);

    // ==========================================
    // NEW: DRAG PROTECTION
    // If you click an item that is ALREADY selected without holding Shift,
    // we assume you are grabbing it to drag the group. Do not clear the selection!
    // ==========================================
    if (!isMulti && isAlreadySelected) {
        activeElement = el;
        syncInspector();
        return; // Skip the rest of the logic so we don't accidentally unselect anything!
    }

    // 1. If Shift is NOT held, and it's a brand new item, clear the existing group
    if (!isMulti) {
        if (typeof selectedGroup !== 'undefined') {
            selectedGroup.forEach(item => {
                item.classList.remove("active");
                removeWarpPoints(item);
            });
            selectedGroup.clear();
        }
    }

    // 2. Group-Aware Selection Logic
    const groupId = el.dataset.groupId;

    if (groupId && !isMulti) {
        // Clicked a grouped item normally: Select the whole group
        document.querySelectorAll(`.video-layer[data-group-id="${groupId}"]`).forEach(groupMember => {
            selectedGroup.add(groupMember);
            groupMember.classList.add("active");
        });
        activeElement = el; 
    } else if (groupId && isMulti) {
        // Shift-clicked a grouped item: Toggle the whole group in/out
        const isCurrentlySelected = selectedGroup.has(el);
        document.querySelectorAll(`.video-layer[data-group-id="${groupId}"]`).forEach(groupMember => {
            if (isCurrentlySelected) {
                selectedGroup.delete(groupMember);
                groupMember.classList.remove("active");
            } else {
                selectedGroup.add(groupMember);
                groupMember.classList.add("active");
            }
        });
        activeElement = Array.from(selectedGroup).pop() || null;
    } else {
        // Normal individual selection
        if (isMulti && isAlreadySelected) {
            selectedGroup.delete(el);
            el.classList.remove("active");
            activeElement = Array.from(selectedGroup).pop() || null;
        } else {
            selectedGroup.add(el);
            el.classList.add("active");
            activeElement = el; 
        }
    }

    syncInspector();

    // 3. Infrastructure Mode UI Update
// 3. Infrastructure Mode UI Update
    if (activeElement && activeElement.classList.contains("screen-layer") && typeof isInfrastructureMode !== 'undefined' && isInfrastructureMode) {
        const title = document.getElementById("inspectorTitle");
        if(title) title.innerText = `OUTPUT ${activeElement.dataset.monitorNum || 0} CONFIG`;
        
        const mW = document.getElementById("monW");
        const mH = document.getElementById("monH");
        const mX = document.getElementById("monX");
        const mY = document.getElementById("monY");

        if (mW) mW.value = Math.round((parseFloat(activeElement.style.width) || activeElement.offsetWidth) / canvasScale);
        if (mH) mH.value = Math.round((parseFloat(activeElement.style.height) || activeElement.offsetHeight) / canvasScale);
        if (mX) mX.value = Math.round((parseFloat(activeElement.style.left) || activeElement.offsetLeft) / canvasScale);
        if (mY) mY.value = Math.round((parseFloat(activeElement.style.top) || activeElement.offsetTop) / canvasScale);

        // --- NEW: SYNC THE ENABLE/DISABLE BUTTON ---
        const btn = document.getElementById("monitorEnableBtn");
        if (btn) {
            const isDisabled = activeElement.dataset.disabled === "true";
            if (!isDisabled) {
                btn.innerText = "ENABLED";
                btn.style.borderColor = "var(--vada-accent)";
                btn.style.color = "var(--vada-accent)";
                btn.style.boxShadow = "none";
            } else {
                btn.innerText = "DISABLED";
                btn.style.borderColor = "#ff4444";
                btn.style.color = "#ff4444";
                btn.style.boxShadow = "0 0 10px rgba(255, 68, 68, 0.3)";
            }
        }
    } else {
        const title = document.getElementById("inspectorTitle");
        if (title && (!isInfrastructureMode)) title.innerText = "CANVAS SETTINGS";
    }

    const allText = el.innerText || "";
    togglePTZControls((allText.toUpperCase().includes("PTZ") || allText.toUpperCase().includes("UHD")) && !el.classList.contains("screen-layer"));
}

function initNavigationBindings() {
  const targets = ["backBtn", "exitInspBtn"];
  targets.forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.onclick = goHome;
  });
}

/* ==========================================================================
   2. HARDWARE SYNC & NETWORK DISCOVERY ENGINE
   ========================================================================== */

async function verifyHardwareConnection() {
  try {
    const res = await fetch(getEndpoints().alive, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      console.log("Hardware connection established natively.");
      startHardwareSync();
      return;
    }
  } catch (e) {
    showNetworkOverlay();
  }
}

function showNetworkOverlay() {
  const overlay = document.createElement("div");
  overlay.id = "networkOverlay";

  const currentIP = API_BASE.replace("http://", "").replace(":8080", "");
  const defaultVal = currentIP === "127.0.0.1" ? "192.168.0.120" : currentIP;

  overlay.innerHTML = `
      <div class="network-box">
          <h2 style="margin:0; color:${UI_IDENTITY.accent}">HARDWARE OFFLINE</h2>
          <p style="color:#aaa; font-size:12px; margin-top:10px;">The C++ Video Wall Engine is not responding on the current IP.</p>
          <input type="text" id="engineIpInput" class="network-input" value="${defaultVal}" placeholder="192.168.x.x">
          <br>
          <button id="connectHardwareBtn" class="ptz-btn" style="width: 250px; margin: 0 auto;">CONNECT TO RACK UNIT</button>
      </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById("connectHardwareBtn").onclick = async () => {
    const btn = document.getElementById("connectHardwareBtn");
    const input = document.getElementById("engineIpInput").value.trim();

    btn.innerText = "CONNECTING...";
    btn.style.borderColor = "#aaa";

    API_BASE = `http://${input}:8080`;

    try {
      const res = await fetch(getEndpoints().alive, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        document.body.removeChild(overlay);
        startHardwareSync();
      } else {
        throw new Error("Rejected");
      }
    } catch (e) {
      btn.innerText = "CONNECTION FAILED - RETRY";
      btn.style.borderColor = UI_IDENTITY.critical;
    }
  };
}

function isGhostSource(nameStr) {
    if (nameStr === undefined || nameStr === null) return true;
    const clean = String(nameStr).replace(/['"\0\n\r\t\v]/g, "").trim();
    return clean.length === 0 || clean.toLowerCase() === "null";
}

// 1. Move the function OUTSIDE
function updateSourceTelemetry(el, sourceData) {
    // 1. Extract the real data the engine sends
    const fps = sourceData.fps !== undefined ? sourceData.fps : "---";
    const res = sourceData.resolution || "---";
    const drops = sourceData.drops !== undefined ? sourceData.drops : "---";

    // 2. If this is the active element, push it directly to the Top HUD
    if (activeElement === el) {
        el.dataset.res = res;
        el.dataset.fps = fps;
        el.dataset.drops = drops;
        if (typeof updateTopHUD === "function") {
            updateTopHUD(el);
        }
    }

    // 3. Update the inline canvas box
    let telemetry = el.querySelector(".source-telemetry");
    if (!telemetry) {
        telemetry = document.createElement("div");
        telemetry.className = "source-telemetry";
        el.appendChild(telemetry);
    }
    
    telemetry.innerHTML = `
        <div class="telemetry-line">RES: ${res}</div>
        <div class="telemetry-line">FPS: ${fps}</div>
        <div class="telemetry-line">DROP: ${drops}</div>
    `;
}
async function startHardwareSync() {
  setInterval(async () => {
    if (window.isHardwareMounting) return;

    try {
      const aliveRes = await fetch(getEndpoints().alive);
      systemOnline = aliveRes.ok;

      if (systemOnline) {
        const [inputData, screenData, statusData, channelData, sourceData] =
          await Promise.all([
            fetch(getEndpoints().inputs).then((r) => r.json()),
            fetch(getEndpoints().screens).then((r) => r.json()),
            fetch(getEndpoints().status).then((r) => r.json()),
            fetch(getEndpoints().channels).then((r) => r.json()).catch(() => ({ channels: [] })),
            fetch(getEndpoints().sources).then((r) => r.json()).catch(() => ({ sources: [] })),
          ]);

        let rawInputs = Array.isArray(inputData.input_sources) ? inputData.input_sources : [];
          
        rawInputs = rawInputs
          .map((input) => {
            let inferredType = input.type;
            const safeName = String(input.name || "").toUpperCase();
            if (!inferredType) {
              if (safeName.includes("PTZ")) inferredType = "PTZ";
              else if (safeName.includes("NDI")) inferredType = "NDI";
              else inferredType = "LIVE";
            }
            return { ...input, type: inferredType };
          })
          .filter((i) => !isGhostSource(i.name)); 

        detectedSignals.NDI = rawInputs.filter((i) => i.type === "NDI");
        detectedSignals.LIVE = rawInputs.filter((i) => i.type === "LIVE" || i.type === "CAPTURE" || i.type === "SDI");
        detectedSignals.STREAM = rawInputs.filter((i) => i.type === "STREAM" || i.type === "URL" || i.type === "PTZ");

let activeSources = (sourceData.sources || [])
          .map((src, index) => {
            const safeName = String(src.name || "").toUpperCase();
            let type = "LIVE";
            if (safeName.includes(".MP4") || safeName.includes(".JPG") || safeName.includes(".PNG")) type = "FILE";
            else if (safeName.includes("PTZ") || safeName.includes("UHD") || safeName.includes("MGH")) type = "PTZ";
            
            // THE FIX: Added "...src," to pass all raw hardware metrics through to the UI
            return { ...src, source: index, name: src.name, path: src.name, url: src.url, type: type };
          })
          .filter((src) => !isGhostSource(src.name));

processMediaPoolSync(activeSources);

        if (!document.querySelector(".is-dragging")) {
          processChannelTopologySync(channelData.channels || [], activeSources);
          processCanvasTopologySync(screenData);
        }

        updateSystemStatusUI(statusData);
        document.body.classList.remove("hardware-offline");
        autoConfigureWebRTC();
      } else {
        handleHardwareDisconnect();
      }
    } catch (err) {
      systemOnline = false;
      handleHardwareDisconnect();
    }
  }, 2000);
}

function handleHardwareDisconnect() {
  systemOnline = false;
  hasAutoConfiguredWebRTC = false;
  document.body.classList.add("hardware-offline");
  const statusTag = document.getElementById("canvasStatus");
  if (statusTag) {
    statusTag.innerText = "OFFLINE";
    statusTag.style.color = UI_IDENTITY.critical;
  }
}

function processChannelTopologySync(channels, inputs) {
    if (!Array.isArray(channels)) return;

    channels.forEach((ch, index) => {
        const channelNum = index;
        const srcIndex = ch.src_index;
        const physical_w = ch.area_right - ch.area_left;
        const physical_h = ch.area_bottom - ch.area_top;

        if (physical_w <= 0 || physical_h <= 0) {
            let staleEl = document.querySelector(`.video-layer[data-channel="${channelNum}"]:not(.screen-layer)`);
            if (staleEl) {
                const wasRecentlyModified = (Date.now() - (parseInt(staleEl.dataset.lastMoveTime) || 0)) < 3000;
                const isCurrentlySelected = (staleEl === activeElement);
                if (wasRecentlyModified || isCurrentlySelected) return; 
                if (staleEl === activeElement) {
                    activeElement = null;
                    const title = document.getElementById("inspectorTitle");
                    if (title) title.innerText = "CANVAS SETTINGS";
                    togglePTZControls(false);
                }
                staleEl.remove();
            }
            return;
        }


        const physical_x = ch.position_x - physical_w / 2;
        const physical_y = ch.position_y - physical_h / 2;
        const ui_w = physical_w * canvasScale;
        const ui_h = physical_h * canvasScale;
        const ui_x = physical_x * canvasScale;
        const ui_y = physical_y * canvasScale;

        const src = inputs.find((i) => i.source == srcIndex);
        const fullPath = src && src.name ? src.name : null;
        const cleanName = fullPath ? fullPath.split(/[\\/]/).pop() : `SRC_IDX_${srcIndex}`;
        
        const safeType = src ? src.type : "LIVE";
        const safeUrl = src ? src.url : "";
        const isPTZType = safeType === "STREAM" || safeType === "PTZ" || cleanName.toUpperCase().includes("PTZ") || cleanName.toUpperCase().includes("UHD") || cleanName.toUpperCase().includes("MGH");

        let el = document.querySelector(`.video-layer[data-channel="${channelNum}"]:not(.screen-layer)`);

        if (!el) {
            spawnSourceOnCanvas(cleanName, ui_x, ui_y, `CH_${channelNum}_${Date.now()}`, safeType, fullPath, srcIndex, channelNum, true, safeUrl);
            el = document.querySelector(`.video-layer[data-channel="${channelNum}"]:not(.screen-layer)`);
            if (el) el.dataset.isPtz = isPTZType ? "true" : "false";
        }

if (el) {
            if (el.dataset.isFull === "true") return; 

            // 1. Update source identity only if changed
            if (el.dataset.srcIndex != srcIndex) {
                el.dataset.srcIndex = srcIndex;
                el.dataset.isPtz = isPTZType ? "true" : "false";
                const infoTag = el.querySelector(".layer-info");
                if (infoTag) infoTag.innerText = `${cleanName.toUpperCase()} (CH: ${channelNum})`;
            }

// 2. ALWAYS update telemetry (so stats refresh live every 2 seconds)
            
            // Try to pull actual native resolution from the feed, fallback to physical box size
            const nativeRes = (src && src.width && src.height) 
                ? `${src.width}x${src.height}` 
                : `${physical_w}x${physical_h}`;

                // Inside processChannelTopologySync

            // Check both the Channel data and Source data for the live metrics
            updateSourceTelemetry(el, {
                fps: ch.fps !== undefined ? ch.fps : (src && src.fps !== undefined ? src.fps : undefined),
                resolution: nativeRes,
                drops: ch.dropped_frames !== undefined ? ch.dropped_frames : (src && src.dropped_frames !== undefined ? src.dropped_frames : undefined)
            });

            if (el === activeElement) togglePTZControls(isPTZType);
            if (el !== activeElement) el.style.zIndex = 1000 + index;

            const isBeingDragged = el.classList.contains("is-dragging");
            const wasRecentlyModified = (Date.now() - (parseInt(el.dataset.lastMoveTime) || 0)) < 3000;
            const isCropMode = el.dataset.cropMode === "true";

            if (!isBeingDragged && !wasRecentlyModified && !isCropMode) {
                el.style.left = `${ui_x}px`;
                el.style.top = `${ui_y}px`;
                el.style.width = `${ui_w}px`;
                el.style.height = `${ui_h}px`;
                
                // Rotation sync logic: Invert engine value to match UI clockwise degrees
// Rotation sync logic: Direct match for Video Sources (No inversion needed)
                if (ch.rotation !== undefined) {
                    const hwRot = parseFloat(ch.rotation) || 0;
                    let uiRot = Math.round(hwRot % 360);
                    el.style.transform = `rotate(${uiRot}deg)`;
                    el.dataset.rotation = uiRot;
                }
            }
        }
    });
}
function processMediaPoolSync(inputs) {
    const list = document.getElementById("mediaPoolList");
    if (!list || !inputs) return;

    const uniqueSourcesMap = new Map();
    
    // --- THE FIX: Filter out ghosts AND graveyard items ---
    const validInputs = inputs.filter((i) => {
        // 1. Ignore blank/ghost sources
        if (isGhostSource(i.name)) return false;
        
        // 2. Ignore sources the user has explicitly deleted
        if (window.vadaGraveyard && window.vadaGraveyard.has(String(i.source))) return false;
        
        return true;
    });

    validInputs.forEach((input) => {
        if (!uniqueSourcesMap.has(input.name)) uniqueSourcesMap.set(input.name, input);
    });

    const sortedInputs = Array.from(uniqueSourcesMap.values()).sort((a, b) => {
        const idA = a.source !== undefined && a.source !== null ? parseInt(a.source) : 9999;
        const idB = b.source !== undefined && b.source !== null ? parseInt(b.source) : 9999;
        return idA - idB;
    });

    // Check if the list actually changed before forcing a DOM redraw (prevents flickering)
    const stateHash = sortedInputs.map((i) => `${i.source}-${i.name}`).join("|");
    if (list.dataset.stateHash === stateHash) return;

    list.dataset.stateHash = stateHash;
    list.innerHTML = "";

    sortedInputs.forEach((input) => {
        const cleanName = input.name.split(/[\\/]/).pop();
        const label = cleanName || `[EMPTY SLOT ${input.source}]`;
        const type = input.type || "LIVE";
        const hardwarePath = input.path || input.name;
        addNewMediaToPool(type, label, hardwarePath, input.source, input.url || "");
    });
}

function processCanvasTopologySync(screens) {
  if (isUserDragging) return;

  let safeScreens = Array.isArray(screens.screens) ? screens.screens : screens;
  if (!safeScreens || !safeScreens.length) return;

  const stage = document.querySelector(".canvas-stage");

  safeScreens.forEach((scr, index) => {
    const monitorNum = scr.monitor_num ?? index;
    const screenId = `PHYSICAL_MONITOR_IDX_${index}`;

    let el = document.getElementById(screenId);

    // SYNC SHIELD: Ignore hardware data if we just modified this monitor
    if (el) {
        const wasRecentlyModified = (Date.now() - (parseInt(el.dataset.lastMoveTime) || 0)) < 3000;
        if (el.classList.contains("is-dragging") || wasRecentlyModified) return;
    }

    const physW = scr.monitor_area_right - scr.monitor_area_left;
    const physH = scr.monitor_area_bottom - scr.monitor_area_top;
    const uiW = physW * canvasScale;
    const uiH = physH * canvasScale;
    const uiX = scr.position_x * canvasScale - uiW / 2;
    const uiY = scr.position_y * canvasScale - uiH / 2;

    if (!el) {
      el = document.createElement("div");
      el.id = screenId;
      el.className = "screen-layer video-layer moveable-source";
      el.dataset.monitorNum = monitorNum;
      el.style.cssText = `position: absolute; z-index: 5; border: 2px dashed rgba(0, 242, 255, 0.5); background: rgba(0, 242, 255, 0.05); display: flex; flex-direction: column; align-items: center; justify-content: center;`;

      el.innerHTML = `
          <div style="position: absolute; top: 0; left: 0; padding: 6px 12px; background: rgba(0, 242, 255, 0.15); backdrop-filter: blur(4px); border-bottom: 1px solid var(--vada-accent); border-right: 1px solid var(--vada-accent); display: flex; flex-direction: column; gap: 3px; pointer-events: none; z-index: 10;">
              <span style="font-size: 11px; font-weight: bold; color: #fff; letter-spacing: 1px; text-shadow: 0 0 5px var(--vada-accent);">OUTPUT ${monitorNum}</span>
              <span style="font-size: 9px; color: var(--vada-accent); font-family: monospace;">RES: ${Math.round(physW)} x ${Math.round(physH)}</span>
          </div>
          <div class="transform-nodes"><div class="rotate-node"></div></div>
      `;
      stage.appendChild(el);
      makeTransformable(el);
    }

    el.style.width = `${uiW}px`;
    el.style.height = `${uiH}px`;
    el.style.left = `${uiX}px`;
    el.style.top = `${uiY}px`;

if (scr.rotation !== undefined) {
    const hwRot = parseFloat(scr.rotation) || 0;
    // The engine stores the inverted value. 
    // We convert it back to UI rotation by re-inverting it.
    let uiRot = (360 - (hwRot % 360)) % 360;
    el.style.transform = `rotate(${uiRot}deg)`;
    el.dataset.rotation = uiRot;
    }
    if (scr.rotation !== undefined) {
        const hwRot = parseFloat(scr.rotation) || 0;
        // The engine stores the inverted value. 
        // We convert it back to UI rotation by re-inverting it.
        let uiRot = (360 - (hwRot % 360)) % 360;
        el.style.transform = `rotate(${uiRot}deg)`;
        el.dataset.rotation = uiRot;
    }

    // --- THE ENGINE KILL-SWITCH (VISIBILITY ONLY) ---
    const isInfra = document.body.classList.contains("infra-mode-active");
    const isDisabled = (el.dataset.disabled === "true");

    if (isDisabled && !isInfra) {
        // If disabled AND in Workspace: Force it to disappear
        el.style.setProperty("display", "none", "important");
    } else {
        // Otherwise: Bring it back, and let YOUR CSS handle the colors and opacity
        el.style.setProperty("display", "flex", "important");
    }
  });
}

function updateSystemStatusUI(status) {
  const statusTag = document.getElementById("canvasStatus");
  const resInfo = document.getElementById("liveRes");
  const taskName = document.getElementById("activeTaskName");

  if (statusTag && status.mode) {
    statusTag.innerText = status.mode.toUpperCase();
    statusTag.style.color = UI_IDENTITY.accent;
  }
  if (taskName && status.project) {
    taskName.innerText = "ACTIVE: " + status.project.toUpperCase();
  }

  if (status.status && status.status[0]) {
    const s = status.status[0];
    const physical_w = s.canvas_area_right - s.canvas_area_left;
    const physical_h = s.canvas_area_bottom - s.canvas_area_top;

    if (resInfo) {
      resInfo.innerText = `${Math.round(physical_w)} x ${Math.round(physical_h)}`;
    }

    const surface = document.getElementById("activeSurface");
    if (surface) {
      surface.style.width = `${physical_w * canvasScale}px`;
      surface.style.height = `${physical_h * canvasScale}px`;
      surface.style.left = `${s.canvas_area_left * canvasScale}px`;
      surface.style.top = `${s.canvas_area_top * canvasScale}px`;
    }

    if (!window.hasHardwareCentered && physical_w > 0) {
      centerCanvas(physical_w, physical_h, s.canvas_area_left, s.canvas_area_top);
      window.hasHardwareCentered = true;
    }
    if (!window.hardwareCameraLocked && physical_w > 0) {
      centerCanvas(physical_w, physical_h, s.canvas_area_left, s.canvas_area_top);
      window.hardwareCameraLocked = true;
    }
  }
}

/* ==========================================================================
   3. DISCOVERY MENU ENGINE
   ========================================================================== */

function initDiscoveryMenus() {
  const tray = document.getElementById("sourceTray");
  const flyout = document.getElementById("mediaFlyout");
  if (!tray || !flyout) return;

  let hideTimeout;
  const hideFlyout = () => { hideTimeout = setTimeout(() => { flyout.style.display = "none"; }, 200); };

  tray.addEventListener("mouseleave", hideFlyout);
  flyout.addEventListener("mouseleave", hideFlyout);

  tray.addEventListener("mouseover", (e) => {
    const opt = e.target.closest(".tray-opt");
    if (!opt) return;

    clearTimeout(hideTimeout);
    const type = opt.dataset.type;
    if (type === "FILE" || type === "WEBRTC") {
      flyout.style.display = "none";
      return;
    }

    const sources = detectedSignals[type] || [];
    const rect = opt.getBoundingClientRect();

    flyout.style.display = "block";
    flyout.style.left = `${rect.right}px`;
    flyout.style.top = `${rect.top}px`;

    if (sources.length > 0) {
      flyout.innerHTML = `
        <div class="flyout-header">${type} DISCOVERY</div>
        <div class="flyout-list">
            ${sources.map((src) => `
                <div class="flyout-item" onclick="window.executeHotSwap('${src.type}', '${src.name || src.id}', '${src.source || ""}', '${src.url || ""}')">
                    <span class="src-name">${src.name || src.id}</span>
                    <span class="src-add">+</span>
                </div>`).join("")}
        </div>`;
    } else {
      flyout.innerHTML = `<div class="flyout-item empty">Detecting ${type}...</div>`;
    }
  });

  flyout.addEventListener("mouseover", () => { clearTimeout(hideTimeout); });
}

/* ==========================================================================
   4. TRANSFORM ENGINE & MESH WARP
   ========================================================================== */

function updateCanvasTransform() {
  const stage = document.querySelector(".canvas-stage");
  if (!stage) return;
  stage.style.transformOrigin = "0 0";
  stage.style.transform = `translate(${panX}px, ${panY}px) scale(${uiZoom})`;
}

function centerCanvas(forceWidth = 7680, forceHeight = 4320, forceLeft = null, forceTop = null) {
    // 1. Measure the actual free stage area, not the whole window
    const stage = document.querySelector(".canvas-stage");
    const surface = document.getElementById("activeSurface");

    if (!stage || stage.clientWidth === 0) {
        setTimeout(() => centerCanvas(forceWidth, forceHeight, forceLeft, forceTop), 50);
        return;
    }

    const vW = stage.clientWidth;
    const vH = stage.clientHeight;
    
    const uiW = parseFloat(forceWidth) * canvasScale;
    const uiH = parseFloat(forceHeight) * canvasScale;
    
    // Grab exact surface coordinates or default to center
    const uiLeft = forceLeft !== null ? parseFloat(forceLeft) * canvasScale : -(uiW / 2);
    const uiTop = forceTop !== null ? parseFloat(forceTop) * canvasScale : -(uiH / 2);

    if (surface) {
        surface.style.width = `${uiW}px`;
        surface.style.height = `${uiH}px`;
        surface.style.left = `${uiLeft}px`;
        surface.style.top = `${uiTop}px`;
    }

    // 2. Calculate smooth zoom padding
    uiZoom = Math.min((vW - 50) / uiW, (vH - 50) / uiH);
    uiZoom = Math.max(0.05, Math.min(uiZoom, 5.0));
    uiZoom = uiZoom * 0.9;

    const boxCenterX = uiLeft + uiW / 2;
    const boxCenterY = uiTop + uiH / 2;

    // 3. PERFECT CENTER: We removed the old "- 135" offset hack here!
    panX = vW / 2 - boxCenterX * uiZoom;
    panY = vH / 2 - boxCenterY * uiZoom; 

    updateCanvasTransform();
    hasAutoCentered = true;
}

let isPushing = false;

function makeTransformable(el) {
    if (el.id === "webrtc-debug-corner" || el.id === "activeSurface") return;

    el.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        if (el.classList.contains("screen-layer")) return; 

        const wasCropMode = el.dataset.cropMode === "true";

        document.querySelectorAll(".video-layer.crop-mode-active").forEach(otherEl => {
            if (otherEl !== el) {
                otherEl.dataset.cropMode = "false";
                otherEl.classList.remove("crop-mode-active");
                const otherGhost = otherEl.querySelector(".source-ghost-outline");
                if (otherGhost) otherGhost.remove();
                pushUpdateToHardware(otherEl, true); 
            }
        });

        if (wasCropMode) {
            el.dataset.cropMode = "false";
            el.classList.remove("crop-mode-active");
            let ghost = el.querySelector(".source-ghost-outline");
            if (ghost) ghost.remove();
            pushUpdateToHardware(el, true);
            return;
        }

        el.dataset.cropMode = "true";
        el.classList.add("crop-mode-active");
        
        let ghost = document.createElement("div");
        ghost.className = "source-ghost-outline";
        
        const hole = document.createElement("div");
        hole.className = "source-ghost-hole";
        ghost.appendChild(hole);

        el.insertBefore(ghost, el.firstChild); 

        const currentW = el.offsetWidth;
        const currentH = el.offsetHeight;
        const pX = parseFloat(el.dataset.panX) || 0;
        const pY = parseFloat(el.dataset.panY) || 0;
        
        let ghostW = currentW;
        let ghostH = currentH;
        const sourceAspect = 16 / 9;
        const targetAspect = currentW / currentH;

        if (targetAspect > sourceAspect) {
            ghostW = currentW; ghostH = currentW / sourceAspect;
        } else {
            ghostH = currentH; ghostW = currentH * sourceAspect;
        }

        ghost.style.width = `${ghostW}px`;
        ghost.style.height = `${ghostH}px`;
        
        const baseLeft = (currentW - ghostW) / 2;
        const baseTop = (currentH - ghostH) / 2;
        const finalLeft = baseLeft + pX;
        const finalTop = baseTop + pY;

        ghost.style.left = `${finalLeft}px`;
        ghost.style.top = `${finalTop}px`;

        
        hole.style.width = `${currentW}px`;
        hole.style.height = `${currentH}px`;
        hole.style.left = `${-finalLeft - 2}px`;
        hole.style.top = `${-finalTop - 2}px`;

        pushUpdateToHardware(el, true);
    });

el.onpointerdown = (e) => {
        if (warpActive || e.button === 1 || isSpacePressed) return;
        if (e.target.closest(".fullscreen-btn")) return;

        e.preventDefault(); 
        e.stopPropagation();
        
        // 1. ALWAYS ALLOW SELECTION (So you can right-click to unlock!)
        selectElement(el, e);

        // --- NEW FIX: PREVENT DRAGGING MONITORS IN WORKSPACE ---
        const isInfraMode = document.body.classList.contains("infra-mode-active");
        if (el.classList.contains("screen-layer") && !isInfraMode) {
            return; // Stops the drag logic, but leaves it selected!
        }
        // -------------------------------------------------------

        // 2. THE LOCK GUARD: Stop dragging, but keep the selection active
        if (el.classList.contains('is-locked')) {
            console.log("Source is locked. Dragging disabled.");
            return; 
        }

        el.setPointerCapture(e.pointerId);
        document.body.classList.add("dragging-active");
        
        if (el.dataset.cropMode === "true") {
            let startX = e.clientX, startY = e.clientY;
            let currentPanX = parseFloat(el.dataset.panX) || 0;
            let currentPanY = parseFloat(el.dataset.panY) || 0;
            const ghost = el.querySelector(".source-ghost-outline");

            const onCropMove = (m) => {
                m.preventDefault();
                el.dataset.panX = currentPanX + (m.clientX - startX) / uiZoom;
                el.dataset.panY = currentPanY + (m.clientY - startY) / uiZoom;
                
                if (ghost) {
                    const ghostW = parseFloat(ghost.style.width) || el.offsetWidth;
                    const ghostH = parseFloat(ghost.style.height) || el.offsetHeight;
                    const baseLeft = (el.offsetWidth - ghostW) / 2;
                    const baseTop = (el.offsetHeight - ghostH) / 2;
                    
                    const finalLeft = baseLeft + parseFloat(el.dataset.panX);
                    const finalTop = baseTop + parseFloat(el.dataset.panY);

                    ghost.style.left = `${finalLeft}px`;
                    ghost.style.top = `${finalTop}px`;

                    const hole = ghost.querySelector(".source-ghost-hole");
                    if (hole) {
                        hole.style.left = `${-finalLeft - 2}px`;
                        hole.style.top = `${-finalTop - 2}px`;
                    }
                }
            };

            const onCropUp = (m) => {
                el.releasePointerCapture(m.pointerId);
                document.body.classList.remove("dragging-active");
                try { pushUpdateToHardware(el, true); } 
                finally {
                    el.removeEventListener("pointermove", onCropMove);
                    el.removeEventListener("pointerup", onCropUp);
                }
            };
            el.addEventListener("pointermove", onCropMove);
            el.addEventListener("pointerup", onCropUp);
            return; 
        }

        isUserDragging = true;
        el.classList.add("is-dragging");
        el.dataset.hwLock = "true";

        // --- THE BULLETPROOF TOOLTIP FIX ---
        let tooltip = document.getElementById("vada-drag-tooltip");
        if (!tooltip) {
            tooltip = document.createElement("div");
            tooltip.id = "vada-drag-tooltip";
            tooltip.style.cssText = "position:fixed; background:rgba(0,0,0,0.8); border:1px solid #00f2ff; color:#00f2ff; padding:4px 8px; font-family:monospace; font-size:11px; pointer-events:none; z-index:999999;";
            document.body.appendChild(tooltip);
        }
        
        // 1. Make it visible
        tooltip.style.display = "block";
        
        // 2. INSTANTLY snap it to the exact click coordinates
        tooltip.style.left = `${e.clientX + 15}px`;
        tooltip.style.top = `${e.clientY + 15}px`;

        // 3. INSTANTLY pre-fill the actual data so it doesn't flash empty numbers
        const initialCurW = Math.round((parseFloat(el.style.width) || el.offsetWidth) / canvasScale);
        const initialCurH = Math.round((parseFloat(el.style.height) || el.offsetHeight) / canvasScale);
        const initialCurX = Math.round((parseFloat(el.style.left) || el.offsetLeft) / canvasScale);
        const initialCurY = Math.round((parseFloat(el.style.top) || el.offsetTop) / canvasScale);
        const initialRot = Math.round(parseFloat(el.dataset.rotation) || 0);

        tooltip.innerHTML = `
            <div>X: ${initialCurX} &nbsp; Y: ${initialCurY}</div>
            <div>W: ${initialCurW} &nbsp; H: ${initialCurH}</div>
            <div>R: ${initialRot}°</div>
        `;

        const rotateHandle = e.target.closest(".rotate-node");
        const resizeHandle = e.target.closest(".node");

        let isResizing = false, isMoving = false, isRotating = false;
        let currentHandle = null;

        if (rotateHandle) isRotating = true;
        else if (resizeHandle) {
            isResizing = true;
            currentHandle = resizeHandle.classList[1];
        } else isMoving = true;

        let startX = e.clientX, startY = e.clientY;
        let initialW = parseFloat(el.style.width) || el.offsetWidth;
        let initialH = parseFloat(el.style.height) || el.offsetHeight;
        let initialL = parseFloat(el.style.left) || el.offsetLeft;
        let initialT = parseFloat(el.style.top) || el.offsetTop;
        const aspectRatio = initialW / initialH;

        const startRot = parseFloat(el.dataset.rotation) || 0;
        const rect = el.getBoundingClientRect();
        const cX = rect.left + rect.width / 2;
        const cY = rect.top + rect.height / 2;
        const startMouseAngle = Math.atan2(startY - cY, startX - cX);

        let isTicking = false;
        let latestX = startX;
        let latestY = startY;

        const onPointerMove = (m) => {
            m.preventDefault();
            
            // Capture latest mouse coordinates instantly
            latestX = m.clientX;
            latestY = m.clientY;

            if (!isTicking) {
                requestAnimationFrame(() => {
                    const dx = (latestX - startX) / uiZoom;
                    const dy = (latestY - startY) / uiZoom;

                    // --- 1. SNAPPING & MODIFIERS: MOVING ---
                    if (isMoving) {
                        let newX = initialL + dx;
                        let newY = initialT + dy;

                        // Shift Key Lock
                        if (m.shiftKey) {
                            if (Math.abs(dx) > Math.abs(dy)) newY = initialT; 
                            else newX = initialL; 
                        }

                        // 30px Snap Threshold
                        const SNAP_THRESH = 30 / (uiZoom || 1); 
                        clearAllHighlights(el);

                        const currentElWidth = parseFloat(el.style.width) || el.offsetWidth || 0;
                        const currentElHeight = parseFloat(el.style.height) || el.offsetHeight || 0;
                        const isInfraMode = document.body.classList.contains("infra-mode-active");

                        // --- THE SNAP ENGINE (Monitors + Nearby Sources) ---
                        document.querySelectorAll(".video-layer:not(.is-dragging)").forEach(other => {
                            if (other === el || other.id === "activeSurface") return;
                            if (isInfraMode && other.classList.contains("screen-layer")) return;
                            
                            const oL = parseFloat(other.style.left) || other.offsetLeft || 0;
                            const oT = parseFloat(other.style.top) || other.offsetTop || 0;
                            const oW = parseFloat(other.style.width) || other.offsetWidth || 0;
                            const oH = parseFloat(other.style.height) || other.offsetHeight || 0;

                            const isYAligned = (newY + currentElHeight > oT - SNAP_THRESH) && (newY < oT + oH + SNAP_THRESH);
                            const isXAligned = (newX + currentElWidth > oL - SNAP_THRESH) && (newX < oL + oW + SNAP_THRESH);
                            
                            const isMonitorScreen = other.classList.contains("screen-layer");

                            // Snap X-Axis
                            if (isYAligned && (!m.shiftKey || Math.abs(dx) > Math.abs(dy))) {
                                if (Math.abs(newX - (oL + oW)) < SNAP_THRESH) { 
                                    newX = oL + oW; setEdgeHighlight(el, 'left', true); 
                                }
                                if (Math.abs((newX + currentElWidth) - oL) < SNAP_THRESH) { 
                                    newX = oL - currentElWidth; setEdgeHighlight(el, 'right', true); 
                                }
                                if (isMonitorScreen) {
                                    if (Math.abs(newX - oL) < SNAP_THRESH) { 
                                        newX = oL; setEdgeHighlight(el, 'left', true); 
                                    }
                                    if (Math.abs((newX + currentElWidth) - (oL + oW)) < SNAP_THRESH) { 
                                        newX = oL + oW - currentElWidth; setEdgeHighlight(el, 'right', true); 
                                    }
                                }
                            }

                            // Snap Y-Axis
                            if (isXAligned && (!m.shiftKey || Math.abs(dy) > Math.abs(dx))) {
                                if (Math.abs(newY - (oT + oH)) < SNAP_THRESH) { 
                                    newY = oT + oH; setEdgeHighlight(el, 'top', true); 
                                }
                                if (Math.abs((newY + currentElHeight) - oT) < SNAP_THRESH) { 
                                    newY = oT - currentElHeight; setEdgeHighlight(el, 'bottom', true); 
                                }
                                if (isMonitorScreen) {
                                    if (Math.abs(newY - oT) < SNAP_THRESH) { 
                                        newY = oT; setEdgeHighlight(el, 'top', true); 
                                    }
                                    if (Math.abs((newY + currentElHeight) - (oT + oH)) < SNAP_THRESH) { 
                                        newY = oT + oH - currentElHeight; setEdgeHighlight(el, 'bottom', true); 
                                    }
                                }
                            }
                        });

                        // --- HARD WALL BOUNDARY ---
                        if (!el.classList.contains("screen-layer")) {
                            const bounds = getCanvasBoundingBox();
                            if (bounds.w > 0 && bounds.h > 0) {
                                const minX = bounds.x;
                                const maxX = bounds.x + bounds.w - currentElWidth;
                                const minY = bounds.y;
                                const maxY = bounds.y + bounds.h - currentElHeight;

                                newX = Math.max(minX, Math.min(newX, maxX));
                                newY = Math.max(minY, Math.min(newY, maxY));
                            }
                        }

                        // --- APPLY GROUP MOVEMENT ---
                        const offsetDeltaX = newX - (parseFloat(el.style.left) || 0);
                        const offsetDeltaY = newY - (parseFloat(el.style.top) || 0);
                        const elementsToMove = typeof selectedGroup !== 'undefined' && selectedGroup.has(el) ? Array.from(selectedGroup) : [el];
                        
                        elementsToMove.forEach(targetEl => {
                            if (targetEl !== el) {
                                targetEl.style.left = `${(parseFloat(targetEl.style.left) || 0) + offsetDeltaX}px`;
                                targetEl.style.top = `${(parseFloat(targetEl.style.top) || 0) + offsetDeltaY}px`;
                            }
                        });

                        el.style.left = `${newX}px`;
                        el.style.top = `${newY}px`;
                    }

                    // --- 2. SNAPPING: RESIZING ---
                    if (isResizing) {
                        const rad = startRot * (Math.PI / 180);
                        const localDx = dx * Math.cos(rad) + dy * Math.sin(rad);
                        const localDxDy = -dx * Math.sin(rad) + dy * Math.cos(rad);
                        let nw = initialW, nh = initialH;

                        if (currentHandle.includes("e")) nw = initialW + localDx;
                        if (currentHandle.includes("w")) nw = initialW - localDx;
                        if (currentHandle.includes("s")) nh = initialH + localDxDy;
                        if (currentHandle.includes("n")) nh = initialH - localDxDy;

                        const GUIDELINE_SNAP = 50; 
                        nw = Math.round(nw / GUIDELINE_SNAP) * GUIDELINE_SNAP;
                        nh = Math.round(nh / GUIDELINE_SNAP) * GUIDELINE_SNAP;

                        el.style.width = `${Math.max(40, nw)}px`;
                        el.style.height = `${Math.max(40, nh)}px`;
                        
                        let nl = initialL, nt = initialT;
                        if (currentHandle.includes("w")) nl = initialL + (initialW - nw);
                        if (currentHandle.includes("n")) nt = initialT + (initialH - nh);

                        el.style.left = `${nl}px`;
                        el.style.top = `${nt}px`;
                    }

                    // --- 3. ROTATION ---
                    if (isRotating) {
                        const curA = Math.atan2(latestY - cY, latestX - cX);
                        const delta = (curA - startMouseAngle) * (180 / Math.PI);
                        el.dataset.rotation = (startRot + delta) % 360;
                        el.style.transform = `rotate(${el.dataset.rotation}deg)`;
                    }

                    // --- 4. HUD SYNC (3-ROW TOOLTIP) ---
                    if (tooltip) {
                        const curW = Math.round((parseFloat(el.style.width) || el.offsetWidth) / canvasScale);
                        const curH = Math.round((parseFloat(el.style.height) || el.offsetHeight) / canvasScale);
                        const curX = Math.round((parseFloat(el.style.left) || el.offsetLeft) / canvasScale);
                        const curY = Math.round((parseFloat(el.style.top) || el.offsetTop) / canvasScale);
                        const rot = Math.round(parseFloat(el.dataset.rotation) || 0);

                        tooltip.innerHTML = `
                            <div>X: ${curX} &nbsp; Y: ${curY}</div>
                            <div>W: ${curW} &nbsp; H: ${curH}</div>
                            <div>R: ${rot}°</div>
                        `;
                        tooltip.style.left = `${latestX + 15}px`;
                        tooltip.style.top = `${latestY + 15}px`;
                    }

                    syncInspector();

                    isTicking = false;
                });
                
                isTicking = true;
            }
        };

        const onPointerUp = (m) => {
            if (tooltip) tooltip.style.display = "none";
            // 1. Reset state variables
            isUserDragging = false;
            
            // 2. Clear visual indicators and CSS classes
            clearAllHighlights(el);
            document.body.classList.remove("dragging-active");
            el.classList.remove("is-dragging");
            el.dataset.lastMoveTime = Date.now();
            
            // 3. Release mouse capture
            el.releasePointerCapture(m.pointerId);

            // 4. Handle monitor specific logic
            if (el.classList.contains("screen-layer")) {
                modifiedMonitors.add(el.id);
            }

            // 5. Final Hardware Sync (Group Aware)
            try { 
                const elementsToSync = typeof selectedGroup !== 'undefined' && selectedGroup.has(el) ? Array.from(selectedGroup) : [el];
                elementsToSync.forEach(item => pushUpdateToHardware(item, true));
            } finally {
                // 6. Remove event listeners to prevent memory leaks
                el.removeEventListener("pointermove", onPointerMove);
                el.removeEventListener("pointerup", onPointerUp);
            }
        };

        el.addEventListener("pointermove", onPointerMove);
        el.addEventListener("pointerup", onPointerUp);
    };
}

let pendingElement = null;
let pendingForce = false;

async function pushUpdateToHardware(el, force = false) {
    if (el.classList.contains("is-dragging")) return;  
    
    // 1. Calculate physical dimensions based on canvas scale
    const currentW = (parseFloat(el.style.width) || el.offsetWidth) / canvasScale;
    const currentH = (parseFloat(el.style.height) || el.offsetHeight) / canvasScale;
    const currentX = (parseFloat(el.style.left) || el.offsetLeft) / canvasScale;
    const currentY = (parseFloat(el.style.top) || el.offsetTop) / canvasScale;

    // 2. Calculate center-point positioning
    let pos_x = Math.round(currentX + currentW / 2);
    let pos_y = Math.round(currentY + currentH / 2);
    
    // 3. Get raw UI Rotation
    const uiRot = parseFloat(el.dataset.rotation) || 0;
    
    // 4. Define Area Boundaries (relative to center)
    let aL = Math.round(-(currentW / 2));
    let aT = Math.round(-(currentH / 2));
    let aR = Math.round(currentW / 2);
    let aB = Math.round(currentH / 2);

    let url = "";

    // 5. Build Command URL based on element type
    if (el.classList.contains("screen-layer")) {
        // MONITORS: Require the mathematical mirror (inverted angle)
        const monitorRot = Math.round((360 - (uiRot % 360)) % 360);
        const monitorNum = parseInt(el.dataset.monitorNum) || 0;
        url = `${API_BASE}/command?name=set_screen&index=${monitorNum}&minitor_num=${monitorNum}&monitor_num=${monitorNum}&local_area_left=${aL}&local_area_top=${aT}&local_area_right=${aR}&local_area_bottom=${aB}&position_x=${pos_x}&position_y=${pos_y}&rotation=${monitorRot}`;
    } else {
        // SOURCES: Direct rotation mapping (No mirror needed)
        const sourceRot = Math.round(uiRot % 360);
        let sIdx = parseInt(el.dataset.srcIndex);
        if (isNaN(sIdx) || sIdx === -999) sIdx = 0; 
        const cIdx = parseInt(el.dataset.channel) || 0;

        const sourceAspect = 16 / 9; 
        const targetAspect = currentW / currentH; 
        
        let uvL = 0.0, uvT = 0.0, uvR = 1.0, uvB = 1.0;
        const uiPanX = parseFloat(el.dataset.panX) || 0;
        const uiPanY = parseFloat(el.dataset.panY) || 0;
        const hwPanX = uiPanX / canvasScale;
        const hwPanY = uiPanY / canvasScale;

        // UV coordinate calculations for cropping
        if (targetAspect > sourceAspect) {
            const scaledH = currentW / sourceAspect;
            const cropFactor = ((scaledH - currentH) / 2) / scaledH;
            const uvOffsetY = -uiPanY / scaledH;
            uvT = cropFactor + uvOffsetY;
            uvB = (1.0 - cropFactor) + uvOffsetY;
            if (uvT < 0) { uvT = 0; uvB = 1.0 - (cropFactor * 2); el.dataset.panY = (cropFactor * scaledH); }
            if (uvB > 1) { uvB = 1; uvT = cropFactor * 2; el.dataset.panY = -(cropFactor * scaledH); }
            el.dataset.panX = 0; 
        } else {
            const scaledW = currentH / (9 / 16);
            const cropFactor = ((scaledW - currentW) / 2) / scaledW;
            const uvOffsetX = -uiPanX / scaledW;
            uvL = cropFactor + uvOffsetX;
            uvR = (1.0 - cropFactor) + uvOffsetX;
            if (uvL < 0) { uvL = 0; uvR = 1.0 - (cropFactor * 2); el.dataset.panX = (cropFactor * scaledW); }
            if (uvR > 1) { uvR = 1; uvL = cropFactor * 2; el.dataset.panX = -(cropFactor * scaledW); }
            el.dataset.panY = 0;
        }

        if (el.dataset.cropMode === "true") {
            uvL = 0.0; uvT = 0.0; uvR = 1.0; uvB = 1.0;
            let fullW, fullH;
            if (targetAspect > sourceAspect) {
                fullW = currentW; fullH = currentW / sourceAspect;
            } else {
                fullH = currentH; fullW = currentH * sourceAspect;
            }
            pos_x = Math.round(pos_x + hwPanX);
            pos_y = Math.round(pos_y + hwPanY);
            aL = Math.round(-(fullW / 2));
            aT = Math.round(-(fullH / 2));
            aR = Math.round(fullW / 2);
            aB = Math.round(fullH / 2);
        }

        url = `${API_BASE}/command?name=set_channel&channel=${cIdx}&src_index=${sIdx}&position_x=${pos_x}&position_y=${pos_y}&rotation=${sourceRot}&area_left=${aL}&area_top=${aT}&area_right=${aR}&area_bottom=${aB}&uv_left=${uvL.toFixed(4)}&uv_top=${uvT.toFixed(4)}&uv_right=${uvR.toFixed(4)}&uv_bottom=${uvB.toFixed(4)}&color=4294967295&edge_size=0.0`;
    }
    
    // 6. Push to Queue
    addToQueue(url);
}

function releaseQueue() {
  isPushing = false;
  if (pendingElement) {
    const nextEl = pendingElement;
    const nextForce = pendingForce;
    pendingElement = null;
    pendingForce = false;
    pushUpdateToHardware(nextEl, nextForce);
  }
}

/* ==========================================================================
   5. SPAWN ENGINE & CHANNEL MANAGER
   ========================================================================== */

async function assignSourceToChannel(channel, hardwareName, sourceUrl, isMediaFile = false) {
  const ch = parseInt(channel);
  let endpoint = `/command?name=add_channel&channel=${ch}&source_name='${hardwareName}'`;
  if (!isMediaFile && sourceUrl) endpoint += `&source_url='${sourceUrl}'`;
  try { await sendRawTCP(endpoint); } catch (e) { console.error("Binding failed:", e); }
}

async function spawnSourceOnCanvas(name, dropX = 150, dropY = 150, forceId = null, srcType = "LIVE", filePath = null, srcIndex = null, forceChannel = null, isSync = false, sourceUrl = "") {
  const stage = document.querySelector(".canvas-stage");
  const surface = document.getElementById("activeSurface");
  if (!stage) return;

// 1. IMPROVED CENTER-SNAP LOGIC (Clamps to Canvas)
  if (dropX === null || dropY === null) {
      const surface = document.getElementById("activeSurface");
      const surfaceRect = surface.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      
      // Calculate center point relative to the surface
      const centerX = (surfaceRect.left - stageRect.left + (surfaceRect.width / 2)) / uiZoom;
      const centerY = (surfaceRect.top - stageRect.top + (surfaceRect.height / 2)) / uiZoom;
      
      // Subtract half of the default element size (480/2=240, 270/2=135) to center it
      dropX = centerX - 240;
      dropY = centerY - 135;
  }

  const sIdx = srcIndex !== null && srcIndex !== undefined ? parseInt(srcIndex) : -999;
  let assignedChannel = forceChannel;
  if (assignedChannel === null) {
    const used = Array.from(document.querySelectorAll(".video-layer:not(.screen-layer)")).map((l) => parseInt(l.dataset.channel));
    for (let i = 0; i <= 15; i++) {
      if (!used.includes(i)) { assignedChannel = i; break; }
    }
  }
  if (assignedChannel === null) assignedChannel = 0;

  const layer = document.createElement("div");
  layer.className = "video-layer moveable-source";
  layer.dataset.channel = assignedChannel;
  layer.dataset.srcIndex = sIdx;
  layer.dataset.srcType = srcType;
  layer.dataset.filePath = filePath || "";
  layer.dataset.sourceUrl = sourceUrl || "";

  highestZ++;
  
  // NEW: Respect the global lock switch when spawning new layers
  if (window.isGlobalLockActive) {
      layer.dataset.locked = "true";
      layer.classList.add("is-locked");
  }

  layer.style.cssText = `width: 480px; height: 270px; left: ${dropX}px; top: ${dropY}px; position: absolute; z-index: ${highestZ}; border: 2px solid #00f2ff; background: rgba(0, 0, 0, 0.15); overflow: visible;`;
  
  const isFile = srcType === "FILE" || name.toLowerCase().includes(".mp4");
  const icon = isFile ? "🎬" : "📹";
  const label = isFile ? "VIDEO FILE" : `LIVE FEED (SRC ${sIdx})`;
  const cleanFileName = name.split(/[\\/]/).pop();

  layer.innerHTML = `
    <div class="centered-content" style="position: absolute; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; z-index: 5;">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; max-width: 90%;">
            <div class="layer-icon" style="font-size: 16px;">${icon}</div>
            <div class="layer-label" style="font-size: 9px; color: #aaa; text-transform: uppercase;">${label}</div>
            <div class="layer-info" style="font-size: 10px; color: #00f2ff; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${cleanFileName}
            </div>
        </div>
    </div>
    <div style="position:absolute; bottom:0; width:100%; height:20px; background:rgba(0,242,255,0.1); color:#00f2ff; font-size:9px; display:flex; align-items:center; justify-content:center; border-top:1px solid rgba(0,242,255,0.2); z-index:10; pointer-events: auto;">
        <div class="fullscreen-btn" onclick="toggleFullScreen(this, event)" style="cursor:pointer; margin-right:10px; font-size:12px; font-weight:bold; pointer-events: auto; z-index: 99;">⛶</div>
        CH: ${assignedChannel} | ID: ${sIdx}
    </div>
    <div class="transform-nodes" style="position: absolute; top:-1px; left:-1px; width:calc(100% + 2px); height:calc(100% + 2px); z-index: 20; pointer-events: none;">
        <div class="rotate-node" style="pointer-events: auto;"></div>
        <div class="node nw" style="pointer-events: auto; position: absolute; width: 12px; height: 12px; background: transparent; border: 2px solid #00f2ff; top: 0; left: 0; transform: translate(-50%, -50%); cursor: nwse-resize;"></div>
        <div class="node n"  style="pointer-events: auto; position: absolute; width: 12px; height: 12px; background: transparent; border: 2px solid #00f2ff; top: 0; left: 50%; transform: translate(-50%, -50%); cursor: ns-resize;"></div>
        <div class="node ne" style="pointer-events: auto; position: absolute; width: 12px; height: 12px; background: transparent; border: 2px solid #00f2ff; top: 0; left: 100%; transform: translate(-50%, -50%); cursor: nesw-resize;"></div>
        <div class="node w"  style="pointer-events: auto; position: absolute; width: 12px; height: 12px; background: transparent; border: 2px solid #00f2ff; top: 50%; left: 0; transform: translate(-50%, -50%); cursor: ew-resize;"></div>
        <div class="node e"  style="pointer-events: auto; position: absolute; width: 12px; height: 12px; background: transparent; border: 2px solid #00f2ff; top: 50%; left: 100%; transform: translate(-50%, -50%); cursor: ew-resize;"></div>
        <div class="node sw" style="pointer-events: auto; position: absolute; width: 12px; height: 12px; background: transparent; border: 2px solid #00f2ff; top: 100%; left: 0; transform: translate(-50%, -50%); cursor: nesw-resize;"></div>
        <div class="node s"  style="pointer-events: auto; position: absolute; width: 12px; height: 12px; background: transparent; border: 2px solid #00f2ff; top: 100%; left: 50%; transform: translate(-50%, -50%); cursor: ns-resize;"></div>
        <div class="node se" style="pointer-events: auto; position: absolute; width: 12px; height: 12px; background: transparent; border: 2px solid #00f2ff; top: 100%; left: 100%; transform: translate(-50%, -50%); cursor: nwse-resize;"></div>
    </div>
  `;
  stage.appendChild(layer);
  makeTransformable(layer);

  if (!isSync) {
    selectElement(layer);
    
    // ONLY fire add_channel if it is a truly new unregistered source (-999)
    if (sIdx === -999) {
        await assignSourceToChannel(assignedChannel, name, sourceUrl, isFile);
    }

    layer.dataset.lastMoveTime = Date.now() + 3000;
    setTimeout(() => { pushUpdateToHardware(layer, true); }, isFile ? 800 : 200);
  }
}

/* ==========================================================================
   6. UI IDENTITY & PROJECTS
   ========================================================================== */

function initCustomDropdowns() {
  const mappingDropdown = document.getElementById("mappingDropdown");
  if (!mappingDropdown) return;
  const selected = mappingDropdown.querySelector(".dropdown-selected");
  const options = mappingDropdown.querySelectorAll(".option");

  selected.onclick = (e) => { e.stopPropagation(); mappingDropdown.classList.toggle("open"); };
  options.forEach((opt) => {
    opt.onclick = (e) => {
      e.stopPropagation();
      mappingDropdown.dataset.mode = opt.dataset.value;
      options.forEach((o) => o.classList.remove("active"));
      opt.classList.add("active");
      selected.innerText = opt.innerText;
      mappingDropdown.classList.remove("open");
      if (activeElement) pushUpdateToHardware(activeElement, true);
    };
  });
}

window.createNewProject = () => {
    const nameInput = document.getElementById("projName");
    const wInput = document.getElementById("canvasW");
    const hInput = document.getElementById("canvasH");
    
    // Check if input exists AND isn't just empty spaces
    let name = "UNTITLED";
    if (nameInput && nameInput.value.trim() !== "") {
        name = nameInput.value.trim();
    }
    
    const w = wInput && wInput.value ? parseInt(wInput.value) : 7680;
    const h = hInput && hInput.value ? parseInt(hInput.value) : 4320;
    
    const newProject = { id: Date.now(), name: name, width: w, height: h, lastModified: Date.now() };
    let projects = JSON.parse(localStorage.getItem("vada_projects") || "[]");
    projects.unshift(newProject);
    localStorage.setItem("vada_projects", JSON.stringify(projects));
    
    // Clear the input field for the next time the modal is opened
    if (nameInput) nameInput.value = ""; 
    
    enterWorkspace(name, w, h);
};

let isBulkSelectMode = false;
let selectedProjectIds = new Set();

window.toggleBulkSelectMode = () => {
    isBulkSelectMode = !isBulkSelectMode;
    const btn = document.getElementById("bulkSelectToggleBtn");
    const tray = document.getElementById("bulkActionTray");
    selectedProjectIds.clear(); 
    
    if (isBulkSelectMode) {
        if (btn) { btn.style.borderColor = "var(--vada-accent)"; btn.style.color = "var(--vada-accent)"; btn.innerText = "CANCEL"; }
        if (tray) tray.style.bottom = "0px"; 
    } else {
        if (btn) { btn.style.borderColor = "#333"; btn.style.color = "#fff"; btn.innerText = "SELECT"; }
        if (tray) tray.style.bottom = "-60px"; 
    }
    window.loadProjects(); 
};

window.loadProjects = () => {
  const grid = document.querySelector(".template-grid");
  const countTag = document.getElementById("projectCountTag");
  if (!grid) return;

  let projects = JSON.parse(localStorage.getItem("vada_projects") || "[]");
  if (projects.length === 0) {
      projects.push({ id: 1111111111111, name: "MAIN 8K BROADCAST", width: 7680, height: 4320, lastModified: Date.now() });
  }

  projects.sort((a, b) => b.lastModified - a.lastModified);
  if (countTag) countTag.innerText = `${projects.length} SAVED`;
  grid.innerHTML = ""; 

  projects.forEach(p => {
    const dateStr = new Date(p.lastModified).toLocaleString();
    const card = document.createElement("div");
    card.className = "template-card";
    if (selectedProjectIds.has(p.id)) card.classList.add("active");

    card.innerHTML = `
      <div class="preview-box" style="position: relative; overflow: hidden; background: #050505;">
          <div style="width: 80%; height: 50%; border: 1px dashed var(--vada-accent); display: flex; align-items: center; justify-content: center; opacity: 0.5;">
             <span style="font-size: 8px; font-family: monospace; color: var(--vada-accent);">${p.width} x ${p.height}</span>
          </div>
          <div class="gallery-checkbox" style="position: absolute; top: 10px; right: 10px; width: 16px; height: 14px; border: 1px solid ${selectedProjectIds.has(p.id) ? 'var(--vada-accent)' : '#444'}; background: ${selectedProjectIds.has(p.id) ? 'rgba(0, 242, 255, 0.2)' : 'rgba(0,0,0,0.6)'}; display: ${isBulkSelectMode ? 'flex' : 'none'}; align-items: center; justify-content: center; border-radius: 3px; color: var(--vada-accent); font-size: 8px; font-weight: bold; pointer-events: none;">
              ${selectedProjectIds.has(p.id) ? '✓' : ''}
          </div>
      </div>
      <div class="card-info" style="padding-top: 8px; display: flex; flex-direction: column; gap: 4px;">
        <span class="type" style="font-size: 11px; font-weight: bold; color: #aaaaaa; text-transform: uppercase; letter-spacing: 1px;">${p.name}</span>
        <span class="res" style="font-size: 9px; font-weight: normal; color: #666666; font-family: monospace;">MODIFIED: ${dateStr}</span>
      </div>
    `;
    
    card.onclick = (e) => {
        if (isBulkSelectMode) {
            e.preventDefault();
            if (selectedProjectIds.has(p.id)) { selectedProjectIds.delete(p.id); } 
            else { selectedProjectIds.add(p.id); }
            document.getElementById("bulkSelectionCount").innerText = `${selectedProjectIds.size} PROJECTS SELECTED`;
            window.loadProjects(); 
        }
    };

    card.ondblclick = () => {
      if (!isBulkSelectMode) {
          p.lastModified = Date.now();
          localStorage.setItem("vada_projects", JSON.stringify(projects));
          enterWorkspace(p.name, p.width, p.height);
      }
    };
    grid.appendChild(card);
  });
};

window.bulkDeleteProjects = () => {
    if (selectedProjectIds.size === 0) return;
    if (confirm(`Permanently drop all ${selectedProjectIds.size} selected projects?`)) {
        let projects = JSON.parse(localStorage.getItem("vada_projects") || "[]");
        projects = projects.filter(p => !selectedProjectIds.has(p.id));
        localStorage.setItem("vada_projects", JSON.stringify(projects));
        window.toggleBulkSelectMode();
    }
};

window.bulkDuplicateProjects = () => {
    if (selectedProjectIds.size === 0) return;
    let projects = JSON.parse(localStorage.getItem("vada_projects") || "[]");
    let copies = [];
    projects.forEach(p => {
        if (selectedProjectIds.has(p.id)) {
            copies.push({ ...p, id: Date.now() + Math.random(), name: `${p.name}_COPY`, lastModified: Date.now() });
        }
    });
    localStorage.setItem("vada_projects", JSON.stringify([...copies, ...projects]));
    window.toggleBulkSelectMode();
};

window.bulkExportTopology = () => {
    if (selectedProjectIds.size === 0) return;
    let projects = JSON.parse(localStorage.getItem("vada_projects") || "[]");
    let exportPayload = projects.filter(p => selectedProjectIds.has(p.id));
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `VADA_TOPOLOGY_EXPORT_${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
    console.log("Topology payload matrix exported.");
};

window.toggleElementLock = (shouldLock) => {
  if (!activeElement) return;
  activeElement.dataset.locked = shouldLock ? "true" : "false";
  activeElement.classList.toggle("is-locked", shouldLock);
  // We explicitly do NOT flip the global "LOCK ALL" switch here anymore!
};
function syncInspector() {
    const infoContainer = document.getElementById("selectedSourceInfo");
    
    if (!activeElement) {
        if (infoContainer) infoContainer.innerText = "";
        const xIn = document.getElementById("posX");
        const yIn = document.getElementById("posY");
        const rIn = document.getElementById("posRot");
        if (xIn) xIn.value = "";
        if (yIn) yIn.value = "";
        if (rIn) rIn.value = "";
        return;
    }

    const name = activeElement.querySelector(".layer-info")?.innerText || "SOURCE";
    const res = activeElement.dataset.res || "---";
    const fps = activeElement.dataset.fps || "---";
    const drops = activeElement.dataset.drops || "---";
    
    if (infoContainer) {
        infoContainer.innerText = `${name} | RES: ${res} | FPS: ${fps} | DROP: ${drops}`;
    }

    // Calculate ACTUAL physical coordinates from the canvas UI
    const x = Math.round((parseFloat(activeElement.style.left) || 0) / canvasScale);
    const y = Math.round((parseFloat(activeElement.style.top) || 0) / canvasScale);
    const rot = Math.round(parseFloat(activeElement.dataset.rotation) || 0);

    // Sync to the CORRECT HTML element IDs
    const xInput = document.getElementById("posX");
    const yInput = document.getElementById("posY");
    const rotInput = document.getElementById("posRot");

    if (xInput) xInput.value = x;
    if (yInput) yInput.value = y;
    if (rotInput) rotInput.value = rot;

    // --- SYNC COLOR SLIDERS ---
    const briIn = document.getElementById("colorBri");
    const briVal = document.getElementById("colorBriVal");
    const conIn = document.getElementById("colorCon");
    const conVal = document.getElementById("colorConVal");
    const satIn = document.getElementById("colorSat");
    const satVal = document.getElementById("colorSatVal");

    if (briIn) {
        const b = activeElement.dataset.bri || 100;
        briIn.value = b; if (briVal) briVal.value = b;
    }
    if (conIn) {
        const c = activeElement.dataset.con || 100;
        conIn.value = c; if (conVal) conVal.value = c;
    }
    if (satIn) {
        const s = activeElement.dataset.sat || 100;
        satIn.value = s; if (satVal) satVal.value = s;
    }
}
function setEdgeHighlight(el, edge, active) {
    let line = el.querySelector(`.edge-${edge}`);
    if (!line) {
        line = document.createElement("div");
        line.className = `edge-snap-line edge-${edge}`;
        el.appendChild(line);
    }
    line.classList.toggle("active", active);
}

function clearAllHighlights(el) {
    el.querySelectorAll(".edge-snap-line").forEach(l => l.classList.remove("active"));
}
function initInspectorFields() {
    const x = document.getElementById("posX");
    const y = document.getElementById("posY");
    const s = document.getElementById("posScale");
    const r = document.getElementById("posRot");

    if (x) {
        x.oninput = (e) => {
            if (activeElement) {
                activeElement.style.left = parseFloat(e.target.value) * canvasScale + "px";
                pushUpdateToHardware(activeElement, true);
            }
        };
    }

    if (y) {
        y.oninput = (e) => {
            if (activeElement) {
                activeElement.style.top = parseFloat(e.target.value) * canvasScale + "px";
                pushUpdateToHardware(activeElement, true);
            }
        };
    }

    if (s) {
        s.oninput = (e) => {
            if (activeElement) {
                const scale = parseFloat(e.target.value) || 1.0;
                activeElement.style.width = 480 * scale + "px";
                activeElement.style.height = 270 * scale + "px";
                pushUpdateToHardware(activeElement, true);
            }
        };
    }

    if (r) {
        r.oninput = (e) => {
            if (activeElement) {
                // Parse the number, default to 0 if blank
                let angle = parseFloat(e.target.value) || 0;
                
                // Keep the math clean for the C++ Engine (0 to 359 degrees)
                angle = (angle % 360 + 360) % 360; 

                // Apply it visually to the UI
                activeElement.dataset.rotation = angle;
                activeElement.style.transform = `rotate(${angle}deg)`;

                // Fire it to the hardware loop
                pushUpdateToHardware(activeElement, true);
            }
        };
    }
}

function togglePTZControls(show) {} // Dummy to prevent crashes if called elsewhere

window.toggleGrid = () => {
  setTimeout(() => {
    const surface = document.getElementById("activeSurface");
    if (!surface) return;
    let gridLayer = document.getElementById("vada-grid-layer");
    if (!gridLayer) {
      window.setGuideline("100");
    } else {
      const isHidden = gridLayer.style.display === "none";
      gridLayer.style.display = isHidden ? "block" : "none";
      const btn = document.getElementById("gridToggleBtn");
      if (btn) {
        btn.style.color = isHidden ? "#00f2ff" : "#666";
        btn.classList.toggle("active", isHidden);
      }
    }
  }, 10);
};

window.setGuideline = (mode) => {
  setTimeout(() => {
    const surface = document.getElementById("activeSurface");
    const guidelineDropdown = document.querySelector(".guideline-dropdown");
    if (!surface) return;
    let styleTag = document.getElementById("vada-grid-styles");
    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = "vada-grid-styles";
      document.head.appendChild(styleTag);
    }
    styleTag.innerHTML = `
          #vada-grid-layer { position: absolute !important; top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important; width: 100% !important; height: 100% !important; z-index: 5 !important; pointer-events: none !important; }
          #vada-grid-layer.grid-100 { background-image: linear-gradient(rgba(0, 242, 255, 0.4) 3px, transparent 1px), linear-gradient(90deg, rgba(0, 242, 255, 0.4) 3px, transparent 1px) !important; background-size: 25px 25px !important; }
          #vada-grid-layer.grid-200 { background-image: linear-gradient(rgba(0, 242, 255, 0.4) 3px, transparent 1px), linear-gradient(90deg, rgba(0, 242, 255, 0.4) 3px, transparent 1px) !important; background-size: 50px 50px !important; }
          #vada-grid-layer.grid-400 { background-image: linear-gradient(rgba(0, 242, 255, 0.4) 4px, transparent 1px), linear-gradient(90deg, rgba(0, 242, 255, 0.4) 4px, transparent 1px) !important; background-size: 100px 100px !important; }
        #vada-grid-layer.grid-thirds { display: grid !important; grid-template-columns: 1fr 1fr 1fr !important; grid-template-rows: 1fr 1fr 1fr !important; background-image: none !important; border: none !important; }
        #vada-grid-layer.grid-thirds::before { content: ""; grid-column: 1 / 4; grid-row: 1 / 4; border: 2px solid rgba(0, 242, 255, 0.5); background-image: linear-gradient(to right, rgba(0, 242, 255, 0.5) 3px, transparent 2px), linear-gradient(to bottom, rgba(0, 242, 255, 0.5) 3px, transparent 2px); background-size: 33.33% 33.33%; }
        .guideline-dropdown { padding-bottom: 10px; }
        .guideline-content { margin-top: 0px !important; }
      `;
    let gridLayer = document.getElementById("vada-grid-layer");
    if (!gridLayer) {
      gridLayer = document.createElement("div");
      gridLayer.id = "vada-grid-layer";
      surface.appendChild(gridLayer);
    }
    gridLayer.className = "";
    if (mode === "off") { gridLayer.style.display = "none"; } 
    else { gridLayer.style.display = "block"; gridLayer.classList.add("grid-" + mode); }
    document.querySelectorAll(".guideline-opt").forEach((opt) => { opt.classList.toggle("active", opt.dataset.value === mode); });
    if (guidelineDropdown) guidelineDropdown.classList.remove("open");
    const btn = document.getElementById("gridToggleBtn");
    if (btn) {
      btn.style.color = mode !== "off" ? "#00f2ff" : "#666";
      btn.classList.toggle("active", mode !== "off");
    }
  }, 10);
};

/* ==========================================================================
   7. NAVIGATION ENGINE (CANVAS & MESH WARP)
   ========================================================================== */

function initCanvasNavigation() {
  const workspace = document.getElementById("workspaceView");
  if (!workspace) return;
  const style = document.createElement("style");
  style.innerHTML = `
        #workspaceView { background-color: #050505 !important; overflow: hidden !important; }
        .canvas-stage { background-color: transparent !important; border: none !important; outline: none !important; box-shadow: none !important; overflow: visible !important; }
        .guideline-content { padding-top: 5px; }
        .node.n { top: -5px; left: 50%; transform: translateX(-50%); cursor: n-resize; }
        .node.s { bottom: -5px; left: 50%; transform: translateX(-50%); cursor: s-resize; }
        .node.e { top: 50%; right: -5px; transform: translateY(-50%); cursor: e-resize; }
        .node.w { top: 50%; left: -5px; transform: translateY(-50%); cursor: w-resize; }
    `;
  document.head.appendChild(style);

window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
      e.preventDefault(); isSpacePressed = true; workspace.style.cursor = "grab"; return;
    }

    // --- CHANGED: CTRL + G (GROUP / UNGROUP TOGGLE) ---
    if ((e.ctrlKey || e.metaKey) && (e.key === "G" || e.key === "g") && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
        e.preventDefault();
        if (typeof selectedGroup !== 'undefined' && selectedGroup.size > 0) {
            const arrayGroup = Array.from(selectedGroup);
            const firstGroupId = arrayGroup[0].dataset.groupId;
            const allShareGroup = firstGroupId && arrayGroup.every(el => el.dataset.groupId === firstGroupId);

            if (allShareGroup) {
                // UNGROUP: Remove ID and flash red
                arrayGroup.forEach(el => {
                    delete el.dataset.groupId;
                    el.style.boxShadow = "0 0 25px #ff4444"; 
                    setTimeout(() => el.style.boxShadow = "none", 400);
                });
            } else if (selectedGroup.size > 1) {
                // GROUP: Apply new ID and flash green
                const newGroupId = "VADA_GROUP_" + Date.now();
                arrayGroup.forEach(el => {
                    el.dataset.groupId = newGroupId;
                    el.style.boxShadow = "0 0 25px #44ff44"; 
                    setTimeout(() => el.style.boxShadow = "none", 400);
                });
            }
        }
        return; 

        // Global Keyboard Listener for Deletion
window.addEventListener('keydown', (e) => {
    // Don't accidentally delete sources while typing numbers in the X/Y coordinate boxes!
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        window.deleteSelected();
    }
});
    }

    if (!activeElement || document.activeElement.tagName === "INPUT") return;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
      const step = 1;
      let currentL = parseFloat(activeElement.style.left) || 0;
      let currentT = parseFloat(activeElement.style.top) || 0;
      if (e.key === "ArrowUp") currentT -= step;
      if (e.key === "ArrowDown") currentT += step;
      if (e.key === "ArrowLeft") currentL -= step;
      if (e.key === "ArrowRight") currentL += step;
      activeElement.style.left = currentL + "px";
      activeElement.style.top = currentT + "px";
      syncInspector(); pushUpdateToHardware(activeElement, true);
    }
  });

  window.addEventListener("keyup", (e) => { if (e.code === "Space") { isSpacePressed = false; workspace.style.cursor = ""; } });
  workspace.addEventListener("wheel", (e) => {
    if (e.ctrlKey || e.metaKey) e.preventDefault();
    const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
    uiZoom *= zoomDelta; uiZoom = Math.max(0.1, Math.min(uiZoom, 5.0)); updateCanvasTransform();
  });

  let startPanX = 0, startPanY = 0;
  workspace.addEventListener("mousedown", (e) => {
    if (e.button === 1 || (e.button === 0 && isSpacePressed)) {
      e.preventDefault(); isPanningWorkspace = true; startPanX = e.clientX - panX; startPanY = e.clientY - panY; workspace.style.cursor = "grabbing";
    }
  });

  document.addEventListener("mousemove", (e) => {
    if (!isPanningWorkspace) return;
    panX = e.clientX - startPanX; panY = e.clientY - startPanY; updateCanvasTransform();
  });

  document.addEventListener("mouseup", (e) => {
    if ((e.button === 1 || e.button === 0) && isPanningWorkspace) {
      isPanningWorkspace = false; workspace.style.cursor = isSpacePressed ? "grab" : "";
    }
  });
}

window.toggleWarpEditor = () => {
  if (!activeElement) return alert("Select a screen first.");
  warpActive = !warpActive;
  const btn = document.getElementById("warpToggleBtn");
  activeElement.classList.toggle("warp-mode", warpActive);
  if (warpActive) {
    if (btn) btn.innerText = "EXIT MESH EDITOR";
    activeElement.style.overflow = "visible";
    createWarpPoints(activeElement);
  } else {
    if (btn) btn.innerText = "ENABLE MESH EDITING";
    removeWarpPoints(activeElement);
  }
};

function createWarpPoints(el) {
  removeWarpPoints(el);
  const nodes = ["tl", "tr", "bl", "br"];
  nodes.forEach((pos) => {
    const dot = document.createElement("div");
    dot.className = `warp-dot ${pos}`;
    dot.innerHTML = `<div class="tangent t-left"></div><div class="tangent t-right"></div>`;
    dot.onmousedown = (e) => {
      e.stopPropagation(); e.preventDefault();
      let sX = e.clientX, sY = e.clientY;
      const onMove = (mE) => {
        const tx = (mE.clientX - sX) / uiZoom; const ty = (mE.clientY - sY) / uiZoom;
        dot.style.transform = `translate(${tx}px, ${ty}px)`;
        ipcRenderer.send("vada-warp-update", { targetId: el.id, point: pos, x: tx, y: ty });
      };
      const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
      document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
    };
    el.appendChild(dot);
  });
}

function removeWarpPoints(el) {
  if (el) { const dots = el.querySelectorAll(".warp-dot"); dots.forEach((d) => d.remove()); }
}

/* ==========================================================================
   8. SYSTEM MENUS & CONTEXT
   ========================================================================== */

function initGlobalContextHandlers() {
    const ctx = document.getElementById("contextMenu");
    if (!ctx) return;

    // --- 1. DELETE SOURCE BINDING ---
    const btnDelete = document.getElementById("ctxDelete");
    if (btnDelete) {
        btnDelete.onmousedown = (e) => { 
            e.stopPropagation(); 
            e.preventDefault();
            if (typeof window.deleteSelected === 'function') window.deleteSelected();
            ctx.style.display = "none"; 
        };
    }

    // --- 2. DELETE CHANNEL BINDING ---
    const btnDeleteChannel = document.getElementById("ctxDeleteChannel");
    if (btnDeleteChannel) {
        btnDeleteChannel.onmousedown = (e) => { 
            e.stopPropagation(); 
            e.preventDefault();
            if (typeof window.deleteSelected === 'function') window.deleteSelected();
            ctx.style.display = "none"; 
        };
    }

    // --- 3. LAYER ORDER BINDINGS ---
    const btnFront = document.getElementById("ctxFront");
    if (btnFront) {
        btnFront.onmousedown = (e) => { 
            e.stopPropagation(); 
            window.bringToFront(); 
            ctx.style.display = "none"; 
        };
    }

    const btnBack = document.getElementById("ctxBack");
    if (btnBack) {
        btnBack.onmousedown = (e) => { 
            e.stopPropagation(); 
            window.sendToBack(); 
            ctx.style.display = "none"; 
        };
    }

    // --- 4. TRANSFORM BINDINGS ---
    const btnReset = document.getElementById("ctxReset");
    if (btnReset) {
        btnReset.onmousedown = (e) => { 
            e.stopPropagation(); 
            window.resetTransform(); 
            ctx.style.display = "none"; 
        };
    }

    const btnLock = document.getElementById("ctxLock");
    if (btnLock) {
        btnLock.onmousedown = (e) => { 
            e.stopPropagation(); 
            window.toggleElementLock(true); 
            ctx.style.display = "none"; 
        };
    }

    const btnUnlock = document.getElementById("ctxUnlock");
    if (btnUnlock) {
        btnUnlock.onmousedown = (e) => { 
            e.stopPropagation(); 
            window.toggleElementLock(false); 
            ctx.style.display = "none"; 
        };
    }

    // --- 5. MENU POSITIONING & CLOSING LOGIC ---
    document.addEventListener("contextmenu", (e) => {
        const target = e.target.closest(".moveable-source");
        if (target) {
            e.preventDefault(); 
            selectElement(target); 
            
            const isL = target.dataset.locked === "true";
            if (btnLock) btnLock.style.display = isL ? "none" : "block";
            if (btnUnlock) btnUnlock.style.display = isL ? "block" : "none";
            
            ctx.style.display = "block"; 
            ctx.style.left = `${e.clientX}px`; 
            ctx.style.top = `${e.clientY}px`;
        } else { 
            ctx.style.display = "none"; 
        }
    });

    document.addEventListener("mousedown", (e) => {
        if (!e.target.closest('#contextMenu')) {
            ctx.style.display = "none";
        }
    });
}

function initImportEngine() {
  const addBtn = document.querySelector(".btn-mini-add");
  const tray = document.getElementById("sourceTray");
  if (!addBtn || !tray) return;
  addBtn.onclick = (e) => { e.stopPropagation(); tray.classList.toggle("open"); };

  const options = document.querySelectorAll(".tray-opt");
  options.forEach((opt) => {
    opt.onclick = async () => {
      const type = opt.dataset.type;
      if (type === "FILE") {
        const res = await ipcRenderer.invoke("open-file-dialog");
        if (res) {
          const n = res.split(/[\\/]/).pop();
          if (!localImportedFiles.find((f) => f.path === res)) { localImportedFiles.push({ id: n, name: n, type: "FILE", path: res }); }
          addNewMediaToPool("FILE", n, res, -999, res);
        }
      }
      tray.classList.remove("open");
    };
  });
}

/* ==========================================================================
   MEDIA POOL LOGIC & ROUTING ENGINE (UNIFIED HOT-SWAP BARRAGE OVERRIDE)
   ========================================================================== */
/* ==========================================================================
   MEDIA POOL LOGIC & ROUTING ENGINE (UNIFIED HOT-SWAP BARRAGE OVERRIDE)
   ========================================================================== */
window.executeHotSwap = async (type, name, source, url) => {
    // 1. The Swap Shield (Prevents double-clicking)
    if (window.isSwapping) return;
    window.isSwapping = true;
    setTimeout(() => window.isSwapping = false, 800);
    
    const isMediaFile = type === "FILE" || name.toLowerCase().endsWith(".mp4");
    const cleanFileName = name.split(/[\\/]/).pop();
    
    let targetBox = activeElement;
    if (!targetBox || !targetBox.classList.contains("video-layer")) {
        targetBox = document.querySelector(".video-layer.active:not(.screen-layer)");
    }

    if (targetBox && !targetBox.classList.contains("screen-layer")) {
        const channelIndex = targetBox.dataset.channel;
        const isFullState = targetBox.dataset.isFull === "true";

        try {
            let actualSourceIndex = source;
            targetBox.dataset.srcIndex = actualSourceIndex;
            targetBox.dataset.srcType = type;
            targetBox.dataset.filePath = name;
            targetBox.dataset.sourceUrl = url || "";

            const infoTag = targetBox.querySelector(".layer-info");
            if (infoTag) infoTag.innerText = cleanFileName;

            targetBox.dataset.lastMoveTime = Date.now() + 5000; 

            // 2. The Sync Loop (Forces hardware update without adding a new channel)
            let syncCount = 0;
            const forceSyncInterval = setInterval(() => {
                if (targetBox) {
                    pushUpdateToHardware(targetBox, true);
                    targetBox.dataset.lastMoveTime = Date.now() + 3000; 
                }
                syncCount++;
                if (syncCount >= 5) {
                    clearInterval(forceSyncInterval);
                    syncInspector();
                }
            }, 500);

            activeElement = targetBox;
        } catch (err) { console.error("Swap Failed:", err); }
    } else {
        // Spawn brand new
        spawnSourceOnCanvas(name, null, null, null, type, name, source, null, false, url);
    }
};

function addNewMediaToPool(type, name, path, source, url) {
    const list = document.getElementById("mediaPoolList");
    if (!list) return;

    const item = document.createElement("div");
    item.className = "media-item";
    item.innerHTML = `<div class="media-meta"><label>${name}</label><span>SRC: ${source === -999 ? "UNREGISTERED" : source}</span></div>`;
    item.onpointerdown = (e) => { e.preventDefault(); e.stopPropagation(); window.executeHotSwap(type, name, source, url); };
    list.appendChild(item);
}

function initSystemWindowControls() {
  const min = document.getElementById("minBtn");
  const max = document.getElementById("maxBtn");
  const close = document.getElementById("closeBtn");
  if (min) min.onclick = () => ipcRenderer.send("window-minimize");
  if (max) max.onclick = () => ipcRenderer.send("window-maximize");
  if (close) close.onclick = () => ipcRenderer.send("window-close");
}

function initCanvasResizers() {
  const handle = document.getElementById("canvasResizer");
  if (!handle) return;
  handle.onmousedown = (e) => {
    const startH = document.getElementById("bottomControlDeck").offsetHeight;
    const startY = e.clientY;
    const onMove = (m) => {
      const h = startH + (startY - m.clientY);
      document.getElementById("bottomControlDeck").style.height = h + "px";
    };
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
  };
}

function initMediaCollapse() { console.log("Salrayworks: Media Core Subsystem - Synchronized"); }

window.toggleBgRemoval = (s) => { if (activeElement) activeElement.classList.toggle("ai-bg-removing", s); };
window.hardResetWorkspace = () => { if (confirm("Purge all configuration and layers?")) location.reload(); };
window.toggleScanner = () => { isScanning = !isScanning; document.body.classList.toggle("scanning", isScanning); };
window.bringToFront = () => { if (activeElement) { highestZ++; activeElement.style.zIndex = highestZ; } };
window.sendToBack = () => { if (activeElement) activeElement.style.zIndex = 101; };


window.resetTransform = () => {
  if (activeElement) {
    activeElement.style.transform = "rotate(0deg)";
    activeElement.dataset.rotation = "0";
    if (!activeElement.classList.contains("screen-layer")) {
      activeElement.style.width = "480px";
      activeElement.style.height = "270px";
    }
    syncInspector();
    pushUpdateToHardware(activeElement, true);
  }
};

window.saveLayout = async (presetId = 1) => {
  const hardwareIndex = presetId - 1;
  const url = `${API_BASE}/command?name=save_layout&layout_index=${hardwareIndex}`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP Status ${response.status}`);
    console.log(`VaDA UI: Hardware Layout saved to C++ Slot ${hardwareIndex}`);
    const btn = document.querySelector(`button[onclick="saveLayout(${presetId})"]`);
    if (btn) {
      btn.style.borderColor = "#00f2ff";
      setTimeout(() => (btn.style.borderColor = "#444"), 1000);
    }
  } catch (err) {
    console.error(`❌ C++ Engine Rejected SAVE Command for Slot ${hardwareIndex}:`, err.message);
  }
};

window.recallLayout = async (presetId = 1) => {
  const hardwareIndex = presetId - 1;
  lastActivePreset = presetId;
  const slotLabel = document.getElementById("activeSlotNum");
  if (slotLabel) slotLabel.innerText = presetId;

  const url = `${API_BASE}/command?name=load_layout&layout_index=${hardwareIndex}`;
  addToQueue(url);
  console.log(`📡 Queued Recall for C++ Slot ${hardwareIndex}`);
};

async function applyPreset(presetName) {
    const baseLayout = BROADCAST_PRESETS[presetName];
    if (!baseLayout) return;

    // 1. Determine the TARGET monitor (Prefer the selected one, fallback to the first one)
    let targetMonitor = null;
    if (activeElement && activeElement.classList.contains("screen-layer")) {
        targetMonitor = activeElement;
    } else {
        targetMonitor = document.querySelector(".screen-layer"); // Defaults to Output 0
    }

    if (!targetMonitor) {
        console.warn("VaDA: No physical monitor found to apply the layout.");
        return; 
    }

    // 2. Get the physical boundaries of THIS specific monitor
    const mX = parseFloat(targetMonitor.style.left) || 0;
    const mY = parseFloat(targetMonitor.style.top) || 0;
    const mW = parseFloat(targetMonitor.style.width) || (7680 * canvasScale);
    const mH = parseFloat(targetMonitor.style.height) || (4320 * canvasScale);

    // Calculate the scale relative to our standard 8K baseline
    const scaleX = mW / 7680;
    const scaleY = mH / 4320;

    // 3. Smart Channel Offset
    // Multiply the preset length by the monitor number so Monitor 1 doesn't steal Monitor 0's sources
    const monitorNum = parseInt(targetMonitor.dataset.monitorNum) || 0;
    const channelOffset = monitorNum * baseLayout.length;

    // 4. Stamp the preset layout ONLY inside the targeted monitor
    baseLayout.forEach((config) => {
        const targetCh = config.ch + channelOffset;

        let el = document.querySelector(`.video-layer[data-channel="${targetCh}"]:not(.screen-layer)`);

        // Spawn the source if it doesn't exist yet
        if (!el) {
            spawnSourceOnCanvas("AUTO_SPAWN", 0, 0, null, "LIVE", null, 0, targetCh, false, "");
            el = document.querySelector(`.video-layer[data-channel="${targetCh}"]:not(.screen-layer)`);
        }

        if (el) {
            // Position and scale it precisely within the target monitor
            el.style.left = `${mX + (config.x * scaleX)}px`;
            el.style.top = `${mY + (config.y * scaleY)}px`;
            el.style.width = `${config.w * scaleX}px`;
            el.style.height = `${config.h * scaleY}px`;

            el.style.objectFit = "cover";
            el.style.overflow = "hidden";

            // Fire the new coordinates to the C++ engine
            pushUpdateToHardware(el, true);
        }
    });
}

window.updateMeshResolution = (density) => { console.log(`VaDA UI: Mesh Density set to ${density}x${density}`); };

function updateIP() {
  const newIP = document.getElementById("ipInput").value;
  if (newIP) {
    API_BASE = `http://${newIP}:8080`;
    const setupView = document.getElementById("ipSetupView");
    if (setupView) setupView.style.display = "none";
  }
}

let discoveryInterval = null;
function startWebRTCAutoDiscovery() {
  if (discoveryInterval) clearInterval(discoveryInterval);
  discoveryInterval = setInterval(() => {
    if (webrtcWS && (webrtcWS.readyState === WebSocket.OPEN || webrtcWS.readyState === WebSocket.CONNECTING)) return;
    initWebRTC();
  }, 5000);
}

function initWebRTC() {
  const input = document.getElementById("webrtcUrlInput");
  const targetUrl = input ? input.value.trim() : WEBRTC_SIGNAL_URL;
  if (!targetUrl) return;

  const ws = new WebSocket(targetUrl);
  const connectionTimeout = setTimeout(() => { if (ws.readyState !== WebSocket.OPEN) ws.close(); }, 2000);

  ws.onopen = () => {
    clearTimeout(connectionTimeout);
    webrtcWS = ws;
    const label = document.getElementById("webrtc-debug-label-inline");
    if (label) { label.innerText = "CANVAS SYNC: LIVE 🔴"; label.style.color = "#00ff00"; }
    webrtcWS.send(JSON.stringify({ id: randomId(16), type: "register" }));
    webrtcWS.send(JSON.stringify({ id: "server", type: "request" }));
  };

  ws.onmessage = async (evt) => {
    try {
      const message = JSON.parse(evt.data);
      if (message.type === "offer") await handleWebRTCOffer(message);
    } catch (e) { console.error("Signaling Parse Error", e); }
  };

  ws.onclose = () => {
    webrtcWS = null;
    const label = document.getElementById("webrtc-debug-label-inline");
    if (label) { label.innerText = "CANVAS SYNC: SEARCHING..."; label.style.color = "#888"; }
  };
  ws.onerror = () => ws.close();
}

window.updateWebRTCUrl = (newUrl) => {
  WEBRTC_SIGNAL_URL = newUrl;
  localStorage.setItem("vada_webrtc_url", newUrl);
  if (webrtcWS) { webrtcWS.close(); }
};

startWebRTCAutoDiscovery();

/* ==========================================================================
   SMART CLUSTER BOUNDARY CALCULATOR
   ========================================================================== */
function getConnectedMonitorBounds(sourceElement) {
    const screens = Array.from(document.querySelectorAll(".screen-layer"));

    // Fallback: If no monitors exist, just use the whole canvas
    if (screens.length === 0) return getCanvasBoundingBox();

    // 1. Find the Source's Center Point
    const sL = parseFloat(sourceElement.style.left) || 0;
    const sT = parseFloat(sourceElement.style.top) || 0;
    const sW = parseFloat(sourceElement.style.width) || 0;
    const sH = parseFloat(sourceElement.style.height) || 0;
    const sCenterX = sL + sW / 2;
    const sCenterY = sT + sH / 2;

    // 2. Identify the "Home Monitor" (The screen the center of the video is on)
    let homeMonitor = null;
    for (let screen of screens) {
        const mX = parseFloat(screen.style.left) || 0;
        const mY = parseFloat(screen.style.top) || 0;
        const mW = parseFloat(screen.style.width) || 0;
        const mH = parseFloat(screen.style.height) || 0;

        if (sCenterX >= mX && sCenterX <= mX + mW && sCenterY >= mY && sCenterY <= mY + mH) {
            homeMonitor = screen;
            break;
        }
    }

    // Fallback: If source is floating outside any monitor, use master canvas bounds
    if (!homeMonitor) return getCanvasBoundingBox();

    // 3. Scan for Connected Neighbors (Collision Detection)
    const getRect = (el) => ({
        l: parseFloat(el.style.left) || 0,
        t: parseFloat(el.style.top) || 0,
        r: (parseFloat(el.style.left) || 0) + (parseFloat(el.style.width) || 0),
        b: (parseFloat(el.style.top) || 0) + (parseFloat(el.style.height) || 0)
    });

    const rects = screens.map(s => ({ el: s, rect: getRect(s) }));
    const homeRectData = rects.find(r => r.el === homeMonitor);

    let connectedGroup = [homeRectData];
    let queue = [homeRectData];
    let visited = new Set([homeMonitor]);

    // 15px tolerance ensures that monitors slightly separated by UI borders still count as "touching"
    const SNAP_TOLERANCE = 15; 

    while (queue.length > 0) {
        const current = queue.shift();

        for (let other of rects) {
            if (visited.has(other.el)) continue;

            const c = current.rect;
            const o = other.rect;

            // Check if the two monitors are touching or overlapping
            const intersects = !(
                o.l > c.r + SNAP_TOLERANCE ||
                o.r < c.l - SNAP_TOLERANCE ||
                o.t > c.b + SNAP_TOLERANCE ||
                o.b < c.t - SNAP_TOLERANCE
            );

            if (intersects) {
                visited.add(other.el);
                connectedGroup.push(other);
                queue.push(other);
            }
        }
    }

    // 4. Calculate the bounding box of the connected cluster
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    connectedGroup.forEach(item => {
        if (item.rect.l < minX) minX = item.rect.l;
        if (item.rect.t < minY) minY = item.rect.t;
        if (item.rect.r > maxX) maxX = item.rect.r;
        if (item.rect.b > maxY) maxY = item.rect.b;
    });

    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

window.toggleFullScreen = (btn, e) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    const el = btn.closest(".video-layer");
    if (!el) return;

    const isFull = el.dataset.isFull === "true";

    if (!isFull) {
        // --- THE NEW LOGIC: Calculate bounds based on monitor clusters ---
        const bounds = getConnectedMonitorBounds(el);

        // Save current dimensions to restore later
        el.dataset.oldW = el.style.width; 
        el.dataset.oldH = el.style.height; 
        el.dataset.oldL = el.style.left; 
        el.dataset.oldT = el.style.top; 
        el.dataset.oldZ = el.style.zIndex;
        
        // Stretch to the smart cluster boundaries
        el.style.setProperty("width", `${bounds.w}px`, "important"); 
        el.style.setProperty("height", `${bounds.h}px`, "important"); 
        el.style.setProperty("left", `${bounds.x}px`, "important"); 
        el.style.setProperty("top", `${bounds.y}px`, "important"); 
        el.style.setProperty("z-index", "9999", "important");
        
        el.dataset.isFull = "true"; 
        btn.innerText = "⤬";
    } else {
        // Restore to original size
        el.style.setProperty("width", el.dataset.oldW || "480px", "important"); 
        el.style.setProperty("height", el.dataset.oldH || "270px", "important"); 
        el.style.setProperty("left", el.dataset.oldL || "0px", "important"); 
        el.style.setProperty("top", el.dataset.oldT || "0px", "important"); 
        el.style.setProperty("z-index", el.dataset.oldZ || "1000", "important");
        
        el.dataset.isFull = "false"; 
        btn.innerText = "⛶";
    }
    
    el.dataset.lastMoveTime = Date.now();
    if (el === activeElement && typeof syncInspector === 'function') syncInspector();
    pushUpdateToHardware(el, true);
};

/* ==========================================================================
   INFRASTRUCTURE SETUP MODE
   ========================================================================== */
window.toggleInfrastructureMode = () => {
    isInfrastructureMode = !isInfrastructureMode;
    const body = document.body;
    const btn = document.getElementById("infraToggleBtn");
    
    if (activeElement) {
        activeElement.classList.remove("active");
        activeElement = null;
        syncInspector();
    }

    if (isInfrastructureMode) {
        body.classList.add("infra-mode-active");
        if(btn) {
            btn.style.background = "#ff00ff";
            btn.style.color = "#000";
            btn.innerText = "EXIT INFRASTRUCTURE MODE";
        }
        document.getElementById("layoutSection").style.display = "none";
        document.getElementById("quickLayoutSection").style.display = "none";
        document.getElementById("monitorSetupSection").style.display = "block";
        document.getElementById("inspectorTitle").innerText = "INFRASTRUCTURE";
    } else {
        body.classList.remove("infra-mode-active");
        if(btn) {
            btn.style.background = "transparent";
            btn.style.color = "#ff00ff";
            btn.innerText = "EDIT INFRASTRUCTURE";
        }
        document.getElementById("layoutSection").style.display = "block";
        document.getElementById("quickLayoutSection").style.display = "block";
        document.getElementById("monitorSetupSection").style.display = "none";
        document.getElementById("inspectorTitle").innerText = "CANVAS SETTINGS";
    }

    // --- FIX 2: INSTANT VISIBILITY OVERRIDE ---
    // Forces disabled monitors to hide/show instantly without waiting for the sync loop
    document.querySelectorAll('.screen-layer').forEach(el => {
        if (el.dataset.disabled === "true") {
            if (isInfrastructureMode) {
                el.style.display = "flex";
            } else {
                el.style.setProperty("display", "none", "important");
            }
        }
    });
};

window.applyMonitorSetup = () => {
    if (!activeElement || !activeElement.classList.contains("screen-layer")) return;
    
    const mW = parseFloat(document.getElementById("monW").value) || 1920;
    const mH = parseFloat(document.getElementById("monH").value) || 1080;
    const mX = parseFloat(document.getElementById("monX").value) || 0;
    const mY = parseFloat(document.getElementById("monY").value) || 0;
    const monitorNum = parseInt(activeElement.dataset.monitorNum) || 0;

    activeElement.style.width = `${mW * canvasScale}px`;
    activeElement.style.height = `${mH * canvasScale}px`;
    activeElement.style.left = `${mX * canvasScale}px`;
    activeElement.style.top = `${mY * canvasScale}px`;

    const aL = Math.round(-(mW / 2));
    const aT = Math.round(-(mH / 2));
    const aR = Math.round(mW / 2);
const aB = Math.round(mH / 2);
    const pos_x = Math.round(mX + (mW / 2));
    const pos_y = Math.round(mY + (mH / 2));
    
    // Invert the manually applied rotation for the C++ engine
const uiRot = parseFloat(activeElement.dataset.rotation) || 0;
    // Safely inverts the angle while guaranteeing a positive number between 0-359
    const rot = Math.round((360 - (uiRot % 360)) % 360);

    const url = `${API_BASE}/command?name=set_screen&index=${monitorNum}&minitor_num=${monitorNum}&monitor_num=${monitorNum}&local_area_left=${aL}&local_area_top=${aT}&local_area_right=${aR}&local_area_bottom=${aB}&position_x=${pos_x}&position_y=${pos_y}&rotation=${rot}`;
    addToQueue(url);

    // Flash Button Green
    const btn = document.querySelector("#monitorSetupSection .btn-vada");
    if (btn) {
        const originalColor = btn.style.borderColor;
        btn.style.borderColor = "#00ff00"; btn.style.color = "#00ff00"; btn.innerText = "SUCCESS ✓";
        setTimeout(() => { btn.style.borderColor = originalColor; btn.style.color = originalColor; btn.innerText = "PUSH SETUP TO ENGINE"; }, 1000);
    }
};

// Add this near the bottom with your other window. helpers
window.switchTab = (tabName) => {
    document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
    document.getElementById(`${tabName}-content`).style.display = 'flex';
    
    document.querySelectorAll('.tab-mini').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
};


function lockLayers() {
    const targets = getAffectedElements(activeElement);
    targets.forEach(el => {
        el.classList.add('is-locked');
        pushUpdateToHardware(el, true); // Update hardware for each
    });
}

function unlockLayers() {
    const targets = getAffectedElements(activeElement);
    targets.forEach(el => {
        el.classList.remove('is-locked');
        pushUpdateToHardware(el, true);
    });
}

// ==========================================================================
// UI & CANVAS DELETION LOGIC (Runs in the Browser)
// ==========================================================================

function getSelectionContext(target) {
    if (typeof selectedGroup !== 'undefined' && selectedGroup.has(target)) {
        return Array.from(selectedGroup);
    }
    return [target];
}

// ==========================================================================
// UNIFIED DELETION & MEMORY MANAGEMENT
// ==========================================================================

function getSelectionContext(target) {
    if (typeof selectedGroup !== 'undefined' && selectedGroup.has(target)) {
        return Array.from(selectedGroup);
    }
    return [target];
}

async function destroySource(el) {
    if (!el) return;

    const channelIdx = el.dataset.channel;
    const srcIndex = el.dataset.srcIndex;
    
    if (channelIdx === undefined) return;

    // 1. DOM: Remove instantly for snappy UX
    el.remove();

    // 2. HARDWARE: Send the kill commands to the C++ Engine
    // (Using your existing addToQueue logic to prevent network blocking)
    addToQueue(`${API_BASE}/command?name=clear_channel_source&channel=${channelIdx}`);
    
    const killParams = new URLSearchParams({ 
        name: "set_channel", channel: channelIdx, src_index: 0, position_x: 0, position_y: 0, 
        rotation: 0, area_left: 0, area_top: 0, area_right: 0, area_bottom: 0, 
        uv_left: 0, uv_top: 0, uv_right: 1, uv_bottom: 1, color: 4294967295, edge_size: 0 
    });
    addToQueue(`${API_BASE}/command?${killParams.toString()}`);

    // 3. STATE & MEDIA POOL: Filter local arrays and force an instant UI refresh
    if (typeof activeSources !== 'undefined') {
        activeSources = activeSources.filter(src => String(src.source) !== String(srcIndex));
        
        // Re-compile the pool using your existing global data
        const allAvailableMedia = [
            ...(detectedSignals.NDI || []), 
            ...(detectedSignals.LIVE || []), 
            ...(detectedSignals.STREAM || []), 
            ...activeSources
        ];
        
        // Use the primary UI engine to redraw so it perfectly matches the sync loop
        processMediaPoolSync(allAvailableMedia);
    }

    // 4. MEMORY CLEANUP
    if (typeof selectedGroup !== 'undefined') selectedGroup.delete(el);
    if (activeElement === el) {
        activeElement = null;
        togglePTZControls(false);
    }
}

// --- TRIGGERS ---

// Context Menu (Ensure you point your HTML buttons here)
window.onContextMenuDelete = () => {
    if (activeElement) {
        const targets = getSelectionContext(activeElement);
        targets.forEach(target => destroySource(target));
    }
    const ctx = document.getElementById("contextMenu");
    if (ctx) ctx.style.display = "none";
};


// Keyboard Listener for Deletion
document.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT') return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (activeElement) {
            e.preventDefault();
            const targets = getSelectionContext(activeElement);
            targets.forEach(target => destroySource(target));
        }
    }
});

// Right-Click Context Menu Delete Action
function onContextMenuDelete() {
    if (activeElement) {
        const targets = getSelectionContext(activeElement);
        targets.forEach(target => destroySource(target));
    }
}

// ==========================================================================
// UNIFIED DELETION CONTROLLER & OVERRIDES (MUST BE IN render.js)
// ==========================================================================

window.deleteSelected = () => {
    // Prevent accidental deletion of the background surface
    if (!activeElement || activeElement.id === "activeSurface") return;

    // 1. Identify all targets (Handles Single Clicks and Multi-Select Groups)
    const targets = (typeof selectedGroup !== 'undefined' && selectedGroup.has(activeElement)) 
                    ? Array.from(selectedGroup) 
                    : [activeElement];

    targets.forEach(el => {
        if (el.classList.contains("screen-layer")) return; // Protect physical monitors

        const channelIndex = el.dataset.channel;
        const srcIndex = el.dataset.srcIndex;

        // Add this source to the graveyard so the sync loop ignores it forever
        if (!window.vadaGraveyard) window.vadaGraveyard = new Set();
        if (srcIndex !== undefined && srcIndex !== null) {
            window.vadaGraveyard.add(String(srcIndex));
        }

        // 2. HARDWARE: Tell C++ to kill the pipeline
        if (channelIndex !== undefined && channelIndex !== null) {
            addToQueue(`${API_BASE}/command?name=clear_channel_source&channel=${channelIndex}`);
            const killParams = new URLSearchParams({
                name: "set_channel", channel: channelIndex, src_index: 0, position_x: 0, position_y: 0, rotation: 0, area_left: 0, area_top: 0, area_right: 0, area_bottom: 0, uv_left: 0, uv_top: 0, uv_right: 1, uv_bottom: 1, color: 4294967295, edge_size: 0,
            });
            addToQueue(`${API_BASE}/command?${killParams.toString()}`);
        }

        // 3. CANVAS: Remove the visual box
        el.remove();

        // 4. DATA: Purge from local state
        if (typeof activeSources !== 'undefined' && srcIndex !== undefined) {
            activeSources = activeSources.filter(src => String(src.source) !== String(srcIndex));
        }
    });

    // 5. MEDIA POOL: Force sidebar to redraw based on updated state
    if (typeof activeSources !== 'undefined' && typeof processMediaPoolSync === 'function') {
        const allAvailableMedia = [
            ...(detectedSignals.NDI || []), 
            ...(detectedSignals.LIVE || []), 
            ...(detectedSignals.STREAM || []), 
            ...activeSources
        ];
        processMediaPoolSync(allAvailableMedia);
    }

    // 6. CLEANUP: Clear UI memory
    if (typeof selectedGroup !== 'undefined') selectedGroup.clear();
    activeElement = null;
    if (typeof togglePTZControls === 'function') togglePTZControls(false);
    if (typeof syncInspector === 'function') syncInspector();
};

// --- FORCE RIGHT CLICK DELETE BYPASS ---
window.forceContextMenuDelete = (event) => {
    // 1. Force the browser to ignore all other layers (stops the canvas from deselecting)
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    
    // 2. Trigger the master delete function
    if (typeof window.deleteSelected === 'function') {
        window.deleteSelected();
    }

    // 3. Hide the menu
    const ctx = document.getElementById("contextMenu");
    if (ctx) ctx.style.display = "none";
};

// ✅ THE MASTER KEYBOARD LISTENER ✅
window.addEventListener('keydown', (e) => {
    // 1. Ignore if the user is typing in a text box (like X/Y coordinates)
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;

    // 2. Listen for the physical Delete or Backspace keys
    if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault(); // Stop the browser from navigating back
        
        // 3. Fire the master deletion controller
        if (typeof window.deleteSelected === 'function') {
            window.deleteSelected();
        } else {
            console.error("VaDA: window.deleteSelected is missing!");
        }
    }
});

// --- KEYBOARD LISTENER ---
window.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        window.deleteSelected();
    }
});

// ==========================================================================
// NUCLEAR KEYBOARD OVERRIDE (Hijacks the Delete Key)
// ==========================================================================

window.addEventListener('keydown', (e) => {
    // 1. Ignore if the user is typing coordinates into a text box
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
        
        // 2. THE SHIELD: This stops ANY old, hidden listeners from running
        e.preventDefault();
        e.stopImmediatePropagation(); 
        
        // 3. Force the key to use our perfectly working Graveyard logic
        if (typeof window.deleteSelected === 'function') {
            window.deleteSelected();
        } else {
            console.error("VaDA: window.deleteSelected is missing!");
        }
    }
}, true); // <--- The 'true' here is the secret weapon. It forces this to run FIRST.

/* ==========================================================================
   CANVAS VIEW / ZEN MODE CONTROLLER
   ========================================================================== */
// window.toggleSlidePanel = (panel) => {
//     const body = document.body;
//     const zenBtn = document.getElementById("zenModeToggle");
//     const deck = document.getElementById("bottomControlDeck");

//     // 1. If clicking the Master Zen Button
//     if (panel === 'all') {
//         const isHidden = body.classList.contains('hide-left');
//         if (isHidden) {
//             // Restore EVERYTHING
//             body.classList.remove('hide-left', 'hide-right', 'hide-bottom');
//             if (zenBtn) zenBtn.classList.remove('zen-mode-active');
//             if (deck) deck.style.marginBottom = '0px';
//         } else {
//             // Hide EVERYTHING
//             body.classList.add('hide-left', 'hide-right', 'hide-bottom');
//             if (zenBtn) zenBtn.classList.add('zen-mode-active');
//             if (deck) deck.style.marginBottom = `-${deck.offsetHeight}px`;
//         }
//     } 
//     // 2. If clicking an individual Handle (Left, Right, or Bottom)
//     else {
//         body.classList.toggle(`hide-${panel}`);
        
//         // Update specific panel visibility
//         if (panel === 'bottom' && deck) {
//             deck.style.marginBottom = body.classList.contains('hide-bottom') 
//                 ? `-${deck.offsetHeight}px` 
//                 : '0px';
//         }
        
//         // Check if all are hidden now to update Zen Button state
//         const allHidden = body.classList.contains('hide-left') && 
//                           body.classList.contains('hide-right') && 
//                           body.classList.contains('hide-bottom');
//         if (zenBtn) {
//             zenBtn.classList.toggle('zen-mode-active', allHidden);
//         }
//     }

//     // Force a resize event so the canvas centers itself
//     window.dispatchEvent(new Event('resize'));
// };

// Each handle will call this with its specific panel name
window.toggleSlidePanel = (panel) => {
    const body = document.body;
    const zenBtn = document.getElementById("zenModeToggle");
    const deck = document.getElementById("bottomControlDeck");

    if (panel === 'all') {
        const isZen = body.classList.contains('zen-mode');
        if (isZen) {
            body.classList.remove('zen-mode', 'hide-left', 'hide-right', 'hide-bottom');
            if (zenBtn) zenBtn.classList.remove('zen-mode-active');
            if (deck) deck.style.marginBottom = '0px';
        } else {
            body.classList.add('zen-mode', 'hide-left', 'hide-right', 'hide-bottom');
            if (zenBtn) zenBtn.classList.add('zen-mode-active');
            if (deck) deck.style.marginBottom = `-${deck.offsetHeight}px`;
        }
    } else {
        body.classList.toggle(`hide-${panel}`);
        if (panel === 'bottom' && deck) {
            deck.style.marginBottom = body.classList.contains('hide-bottom') ? `-${deck.offsetHeight}px` : '0px';
        }
    }

    // Keep Zen button synced
    const allHidden = body.classList.contains('hide-left') && 
                      body.classList.contains('hide-right') && 
                      body.classList.contains('hide-bottom');
    if (zenBtn) zenBtn.classList.toggle('zen-mode-active', allHidden);

    // --- THE PERFECT CENTERING FIX ---
    // Grab the exact physical coordinates of your active video screen
    const surface = document.getElementById("activeSurface");
    const pw = surface ? (parseFloat(surface.style.width) / canvasScale || 7680) : 7680;
    const ph = surface ? (parseFloat(surface.style.height) / canvasScale || 4320) : 4320;
    const pl = surface ? (parseFloat(surface.style.left) / canvasScale || -(pw/2)) : -(pw/2);
    const pt = surface ? (parseFloat(surface.style.top) / canvasScale || -(ph/2)) : -(ph/2);

    // Animate the centering 60 times a second while the CSS panels are sliding (0.4s)
    let frame = 0;
    const smoothRecenter = setInterval(() => {
        centerCanvas(pw, ph, pl, pt);
        frame++;
        if (frame >= 25) clearInterval(smoothRecenter); // Stops after 400ms exactly
    }, 16);
};

// ==========================================================================
// DYNAMIC HANDLE TRACKING
// ==========================================================================
const bottomDeck = document.getElementById("bottomControlDeck");
if (bottomDeck) {
    // Continuously monitor the deck's height and update a CSS variable
    new ResizeObserver(() => {
        document.body.style.setProperty('--deck-height', `${bottomDeck.offsetHeight}px`);
    }).observe(bottomDeck);
}

function updateTopHUD(sourceElement) {
    // Explicitly target the top container by its ID
    const topContainer = document.getElementById("selectedSourceInfo");
    
    if (!topContainer) {
        console.error("Top HUD container #selectedSourceInfo NOT FOUND in DOM!");
        return;
    }

    if (!sourceElement) {
        topContainer.innerText = "";
        return;
    }

    // Grab data from the element's dataset
    const name = sourceElement.dataset.fileName || sourceElement.querySelector(".layer-info")?.innerText || "SOURCE";
    const res = sourceElement.dataset.res || "---";
    const fps = sourceElement.dataset.fps || "---";
    const drops = sourceElement.dataset.drops || "---";

    // Set the text into the top container
    topContainer.innerText = `${name} | RES: ${res} | FPS: ${fps} | DROP: ${drops}`;
    
    // IMPORTANT: Clear the text from inside the camera box if you don't want it duplicated
    // sourceElement.querySelector(".source-telemetry").innerText = ""; 
}


// ==========================================================================
// COLOR CONTROL ENGINE
// ==========================================================================

function initColorControls() {
    const controls = [
        { slider: 'colorBri', input: 'colorBriVal' },
        { slider: 'colorCon', input: 'colorConVal' },
        { slider: 'colorSat', input: 'colorSatVal' }
    ];

    controls.forEach(ctrl => {
        const slider = document.getElementById(ctrl.slider);
        const input = document.getElementById(ctrl.input);
        
        if (!slider || !input) return;

        slider.addEventListener('input', (e) => {
            input.value = e.target.value;
            applyLiveColorPreview();
        });

        input.addEventListener('input', (e) => {
            let val = parseInt(e.target.value) || 0;
            slider.value = val;
            applyLiveColorPreview();
        });
    });
}

function applyLiveColorPreview() {
    if (!activeElement || activeElement.classList.contains("screen-layer")) return;

    const bri = document.getElementById("colorBri").value;
    const con = document.getElementById("colorCon").value;
    const sat = document.getElementById("colorSat").value;

    activeElement.style.filter = `brightness(${bri}%) contrast(${con}%) saturate(${sat}%)`;

    activeElement.dataset.bri = bri;
    activeElement.dataset.con = con;
    activeElement.dataset.sat = sat;
}

window.resetColor = () => {
    if (!activeElement) return;
    
    document.getElementById("colorBri").value = 100;
    document.getElementById("colorBriVal").value = 100;
    document.getElementById("colorCon").value = 100;
    document.getElementById("colorConVal").value = 100;
    document.getElementById("colorSat").value = 100;
    document.getElementById("colorSatVal").value = 100;

    applyLiveColorPreview();
    window.pushColorToHardware();
};

window.pushColorToHardware = () => {
    if (!activeElement || activeElement.classList.contains("screen-layer")) return;

    const channelIdx = activeElement.dataset.channel;
    if (channelIdx === undefined) return;

    const bri = activeElement.dataset.bri || 100;
    const con = activeElement.dataset.con || 100;
    const sat = activeElement.dataset.sat || 100;

    const url = `${API_BASE}/command?name=set_channel_color&channel=${channelIdx}&brightness=${bri}&contrast=${con}&saturation=${sat}`;
    
    addToQueue(url);
    console.log(`📡 [Color Engine] Pushed profile to CH ${channelIdx}`);
};

// Start the engine on boot
document.addEventListener("DOMContentLoaded", () => {
    initColorControls();
});

document.addEventListener("DOMContentLoaded", () => {
    const tabs = document.querySelectorAll('.deck-tabs .tab-mini');
    const colorPanel = document.getElementById('vada-color-panel');
    const ndiPanel = document.getElementById('vada-ndi-panel');

    // Select all bento inputs EXCEPT the ones inside our Custom Panels
    const mappingInputs = Array.from(document.querySelectorAll('.deck-content .bento-input.mini'))
                               .filter(el => !el.closest('#vada-color-panel') && !el.closest('#vada-ndi-panel'));

    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            // Update button highlights
            tabs.forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');

            const tabName = e.target.textContent.trim().toLowerCase();

            // 1. Hide everything to clear the board
            mappingInputs.forEach(input => input.style.display = 'none');
            if (colorPanel) colorPanel.style.display = 'none';
            if (ndiPanel) ndiPanel.style.display = 'none';

            // 2. Show only the specific tab clicked
            if (tabName === 'color') {
                if (colorPanel) colorPanel.style.display = 'flex';
            } 
            else if (tabName === 'ndi config') {
                if (ndiPanel) ndiPanel.style.display = 'flex';
            }
            else if (tabName === 'mapping') {
                mappingInputs.forEach(input => input.style.display = ''); 
            }
        });
    });
});

// ==========================================================================
// NDI CONFIG ENGINE
// ==========================================================================

function initNdiControls() {
    const volSlider = document.getElementById('ndiVol');
    const volInput = document.getElementById('ndiVolVal');

    if (!volSlider || !volInput) return;

    // Helper function to calculate the visual fill percentage
    const updateSliderFill = (val) => {
        const min = parseFloat(volSlider.min); // -50
        const max = parseFloat(volSlider.max); // 20
        const percentage = ((val - min) / (max - min)) * 100;
        
        // Push the percentage directly to our CSS variable
        volSlider.style.setProperty('--fill-pct', `${percentage}%`);
    };

    // Sync Slider -> Text Box & Update Fill
    volSlider.addEventListener('input', (e) => { 
        volInput.value = e.target.value; 
        updateSliderFill(e.target.value);
    });

    // Sync Text Box -> Slider & Update Fill
    volInput.addEventListener('input', (e) => { 
        let val = parseFloat(e.target.value) || 0;
        
        // Prevent typing outside the limits
        if (val < -50) val = -50;
        if (val > 20) val = 20;

        volSlider.value = val; 
        updateSliderFill(val);
    });

    // Set the initial fill color on load (0db is about 71.4% across the slider)
    updateSliderFill(volSlider.value);
}

window.resetNdi = () => {
    document.getElementById('ndiProfile').value = 'high';
    document.getElementById('ndiBuffer').value = '0';
    document.getElementById('ndiMute').checked = false;
    document.getElementById('ndiTally').checked = false;

    // THE FIX: Grab the slider, reset to 0, and artificially fire the 'input' event
    const volSlider = document.getElementById('ndiVol');
    volSlider.value = 0;
    
    // This forces the CSS fill calculation and the text box to update instantly!
    volSlider.dispatchEvent(new Event('input'));
};

window.pushNdiToHardware = () => {
    if (!activeElement || activeElement.classList.contains("screen-layer")) return;
    const channelIdx = activeElement.dataset.channel;
    if (channelIdx === undefined) return;

    // Gather all settings from the UI
    const profile = document.getElementById('ndiProfile').value;
    const buffer = document.getElementById('ndiBuffer').value;
    const vol = document.getElementById('ndiVol').value;
    const mute = document.getElementById('ndiMute').checked ? 1 : 0;
    const tally = document.getElementById('ndiTally').checked ? 1 : 0;

    // Send the config to the C++ Engine via REST
    // NOTE: You will need to confirm this exact API endpoint with your C++ engineer!
    const url = `${API_BASE}/command?name=set_ndi_config&channel=${channelIdx}&profile=${profile}&buffer=${buffer}&vol=${vol}&mute=${mute}&tally=${tally}`;
    
    addToQueue(url);
    console.log(`📡 [NDI Engine] Pushed network config to CH ${channelIdx}`);
};

// Initialize NDI listeners on boot
document.addEventListener("DOMContentLoaded", () => {
    initNdiControls();
});

/* ==========================================================================
   NEW CAPABILITIES (MONITOR, RENAME, COLOR FILTERS)
   ========================================================================== */

// 1. SMART MONITOR TOGGLE (Context-Aware)
window.toggleMonitorEnable = () => {
    // Make sure we actually have a physical monitor selected
    if (!activeElement || !activeElement.classList.contains("screen-layer")) return;

    // Check its current state
    const isDisabled = activeElement.dataset.disabled === "true";
    const newState = !isDisabled; // Flip it

    // Apply the state to the physical monitor layer
    activeElement.dataset.disabled = newState ? "true" : "false";
    activeElement.classList.toggle("is-disabled", newState);

    // Update the UI Button instantly
    const btn = document.getElementById("monitorEnableBtn");
    if (btn) {
        if (!newState) { // It is ENABLED
            btn.innerText = "ENABLED";
            btn.style.borderColor = "var(--vada-accent)";
            btn.style.color = "var(--vada-accent)";
            btn.style.boxShadow = "none";
        } else { // It is DISABLED
            btn.innerText = "DISABLED";
            btn.style.borderColor = "#ff4444";
            btn.style.color = "#ff4444";
            btn.style.boxShadow = "0 0 10px rgba(255, 68, 68, 0.3)";
        }
    }

    // Optional: Push this state to the C++ Engine here
    // const monitorNum = parseInt(activeElement.dataset.monitorNum) || 0;
    // const stateVal = newState ? 0 : 1; 
    // addToQueue(`${API_BASE}/command?name=set_screen_state&index=${monitorNum}&state=${stateVal}`);
};

/* ==========================================================================
   SMART MONITOR TOGGLE (Context-Aware)
   ========================================================================== */
window.toggleMonitorEnable = () => {
    // 1. Ensure we actually have a physical monitor selected
    if (!activeElement || !activeElement.classList.contains("screen-layer")) {
        console.warn("VaDA: Please select a monitor first to toggle its state.");
        return;
    }

    // 2. Check its current state and flip it
    const isDisabled = activeElement.dataset.disabled === "true";
    const newState = !isDisabled; 

    // 3. Apply the state to the physical monitor layer
    activeElement.dataset.disabled = newState ? "true" : "false";
    activeElement.classList.toggle("is-disabled", newState);

    // 4. Update the UI Button instantly
    const btn = document.getElementById("monitorEnableBtn");
    if (btn) {
        if (!newState) { 
            // ENABLED (Cyan)
            btn.innerText = "ENABLED";
            btn.style.borderColor = "var(--vada-accent)";
            btn.style.color = "var(--vada-accent)";
            btn.style.boxShadow = "none";
        } else { 
            // DISABLED (Red)
            btn.innerText = "DISABLED";
            btn.style.borderColor = "#ff4444";
            btn.style.color = "#ff4444";
            btn.style.boxShadow = "0 0 10px rgba(255, 68, 68, 0.3)";
        }
    }
    
    // 5. Force the hardware loop to acknowledge the change instantly
    if (typeof pushUpdateToHardware === 'function') {
        pushUpdateToHardware(activeElement, true);
    }
};
