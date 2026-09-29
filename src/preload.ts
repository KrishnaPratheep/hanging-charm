import { contextBridge, ipcRenderer } from 'electron';

/** App-info API surface exposed to the renderer. */
export interface HanglyAppApi {
  getName: () => string;
  getVersion: () => string;
}

/** Overlay control API: privileged actions delegated to the main process. */
export interface HanglyOverlayApi {
  /** Hide the overlay window (app keeps running in the tray). */
  hideOverlay: () => void;
  /** Fully quit the application. */
  quitApp: () => void;
}

/** Full bridge exposed on `window.hangly`. */
export interface HanglyBridge {
  app: HanglyAppApi;
  overlay: HanglyOverlayApi;
}

declare global {
  interface Window {
    hangly: HanglyBridge;
  }
}

// The complete API surface exposed to the renderer.
// Keep this minimal: only add methods as the app actually needs them.
// Renderer -> main messages are fire-and-forget (`send`); they carry no
// arguments, so there is nothing to validate on the main side yet.
const api: HanglyBridge = {
  app: {
    /** Display name of the running app, safe to show in the UI. */
    getName: (): string => 'Hangly Desktop Companion',
    /** Version from package.json, safe to show in the UI. */
    getVersion: (): string => '0.1.0',
  },
  overlay: {
    hideOverlay: (): void => {
      ipcRenderer.send('overlay:hide');
    },
    quitApp: (): void => {
      ipcRenderer.send('app:quit');
    },
  },
};

// `exposeInMainWorld` makes `api` available as `window.hangly` in the renderer.
// Nothing from Node.js is exposed, thanks to contextIsolation + sandbox.
contextBridge.exposeInMainWorld('hangly', api);
