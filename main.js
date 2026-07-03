const { app, BrowserWindow, ipcMain, dialog, protocol, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

// ==========================================================================
// CORE SYSTEM CONFIGURATION
// ==========================================================================

// Ensure FFmpeg binaries are mapped correctly whether in dev or production
const isPackaged = app.isPackaged;
const ffmpegPath = isPackaged 
    ? path.join(process.resourcesPath, 'bin', 'ffmpeg.exe') 
    : path.join(__dirname, 'bin', 'ffmpeg.exe');

try {
    ffmpeg.setFfmpegPath(ffmpegPath);
    console.log("VaDA Core: FFmpeg path initialized at", ffmpegPath);
} catch (e) {
    console.error("VaDA Core: FFmpeg mapping bypassed or missing.", e);
}

let mainWindow;

// ==========================================================================
// WINDOW CREATION & LIFECYCLE
// ==========================================================================

function createWindow() {
    // 1. Find exactly where the user's mouse cursor is right now
    const cursor = screen.getCursorScreenPoint();
    
    // 2. Get the specific monitor that the mouse is currently on
    const currentDisplay = screen.getDisplayNearestPoint(cursor);
    
    // workArea gives us the size of the screen minus the Windows taskbar
    const { width, height, x, y } = currentDisplay.workArea;

    // 3. Cap the size to your 8K UI target, but shrink it if the monitor is smaller
    const initialWidth = Math.min(1920, width);
    const initialHeight = Math.min(1080, height);

    mainWindow = new BrowserWindow({
        // This math centers the window perfectly on the exact monitor it spawns on
        x: Math.round(x + (width - initialWidth) / 2), 
        y: Math.round(y + (height - initialHeight) / 2),
        width: initialWidth,
        height: initialHeight,
        minWidth: 1024, // Keeps it from breaking your layout on a tablet
        minHeight: 720,
        frame: false, 
        backgroundColor: '#050505',
    webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        webSecurity: false, // Ensure this is false for development
        allowRunningInsecureContent: true // ADD THIS: Allows loading media from non-HTTPS sources
    }
    });

    // 4. Auto-maximize ONLY if this specific monitor is smaller than your ideal layout
    if (width <= 1920 || height <= 1080) {
        mainWindow.maximize();
    }

    mainWindow.loadFile('index.html');
    
    // Custom Title Bar Controls
    ipcMain.on("window-minimize", () => mainWindow.minimize());
    
    ipcMain.on("window-maximize", () => {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    });
    
    ipcMain.on("window-close", () => mainWindow.close());
}

// ==========================================================================
// MESH WARP IPC HANDLER
// ==========================================================================
ipcMain.on("vada-warp-update", (event, data) => {
    // 1. You will need to access your API_BASE from the renderer 
    // or store it in a persistent variable here. 
    // For now, I'll use the default:
    const API_BASE = "http://127.0.0.1:8080";
    
    // 2. Map the UI 'pos' (tl, tr, bl, br) to the specific C++ command parameters
    // This assumes your backend has a command named 'set_warp_point'
    const warpUrl = `${API_BASE}/command?name=set_warp_point&channel=${data.targetId.split('_')[1]}&point=${data.point}&x=${data.x}&y=${data.y}`;
    
    // 3. Fire the request to the C++ backend
    fetch(warpUrl).catch(err => console.error("Warp IPC Bridge Error:", err));
});

// ==========================================================================
// SYSTEM INITIALIZATION & IPC HANDLERS
// ==========================================================================

app.whenReady().then(() => {
    
    // 1. Register custom protocol for local media playback
    // This bypasses Electron's strict file:// sandboxing in packaged .exe files
    protocol.registerFileProtocol('vada-media', (request, callback) => {
        const url = request.url.replace('vada-media://', '');
        try {
            return callback(decodeURIComponent(url));
        } catch (error) {
            console.error('VaDA Protocol Error: Failed to resolve media path', error);
        }
    });

    // 2. Handle the Native Windows File Dialog
    ipcMain.handle('open-file-dialog', async (event) => {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Import Media Source',
            buttonLabel: 'Import to VaDA',
            properties: ['openFile'],
            filters: [
                { name: 'Supported Media', extensions: ['mp4', 'mov', 'mkv', 'jpg', 'png', 'jpeg'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        // If the user clicked cancel, return null. Otherwise return the first selected path.
        if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths[0];
        }
        return null;
    });

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// ==========================================================================
// PROCESS TERMINATION
// ==========================================================================

app.on('window-all-closed', () => {
    // Release the port and terminate the process when the UI closes
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

