import {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  screen,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
} from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Single-instance lock: launching the app again just reveals the overlay.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const OVERLAY_WIDTH = 420;
const OVERLAY_HEIGHT = 320;

// Center the overlay horizontally, near the top of the primary work area
// (above the taskbar). This is the "hangs at the top of the screen" spot the
// charm will live in; physics comes later.
const getOverlayPosition = (): { x: number; y: number } => {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: Math.round(workArea.x + (workArea.width - OVERLAY_WIDTH) / 2),
    y: Math.round(workArea.y + 24),
  };
};

const showOverlay = (): void => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
};

const hideOverlay = (): void => {
  mainWindow?.hide();
};

const toggleOverlay = (): void => {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    hideOverlay();
  } else {
    showOverlay();
  }
};

function createWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showOverlay();
    return;
  }

  const { x, y } = getOverlayPosition();

  mainWindow = new BrowserWindow({
    x,
    y,
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    // Overlay window: no frame, no visible background, always above normal
    // windows. `transparent` requires `frame: false` on all platforms.
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false, // avoid flash of unstyled/white content on startup
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Keep the overlay above normal windows (browser, editors) but below
  // full-screen and system UI.
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  // Show only once the renderer has painted, so transparency applies cleanly.
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Keep navigation and window.open inside the app shell, not arbitrary URLs.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Load the renderer: Vite dev server in development, built files in production.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

function createTray(): void {
  // The Forge Vite plugin packs only `.vite/` into the asar, so the icon
  // ships via `extraResource` (-> <app>/resources/) in packaged builds.
  const trayIconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'assets', 'tray-icon.png')
    : path.join(app.getAppPath(), 'assets', 'tray-icon.png');
  const icon = nativeImage.createFromPath(trayIconPath);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Hangly Desktop Companion');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show overlay', click: () => showOverlay() },
    { label: 'Hide overlay', click: () => hideOverlay() },
    { type: 'separator' },
    { label: 'Quit Hangly', click: () => app.quit() },
  ]);
  tray.setContextMenu(contextMenu);

  // Left-click toggles overlay visibility (Windows convention).
  tray.on('click', () => {
    toggleOverlay();
  });
};

// Privileged operations exposed to the renderer through the preload bridge.
// The renderer never touches ipcRenderer directly (contextIsolation).
ipcMain.on('overlay:hide', () => {
  hideOverlay();
});

ipcMain.on('app:quit', () => {
  app.quit();
});

// A second launch was blocked; reveal the existing overlay instead.
app.on('second-instance', () => {
  showOverlay();
});

app.on('ready', () => {
  createWindow();
  createTray();

  // Escape hatch to close the app without touching the tray.
  // Ctrl+Shift+H toggles the overlay, Ctrl+Shift+Q quits the app.
  globalShortcut.register('Control+Shift+H', () => {
    toggleOverlay();
  });
  globalShortcut.register('Control+Shift+Q', () => {
    app.quit();
  });
});

app.on('before-quit', () => {
  // Never leak process-wide shortcuts.
  globalShortcut.unregisterAll();
});

// The app is a tray companion: closing the overlay keeps it running in the
// tray. Quitting happens via the tray menu or the Ctrl+Shift+Q shortcut.
app.on('window-all-closed', () => {
  if (!tray && process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, clicking the dock icon re-reveals the overlay.
  showOverlay();
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
