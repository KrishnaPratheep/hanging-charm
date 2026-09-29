import { contextBridge } from 'electron';

/** API surface exposed to the renderer (see the object below). */
export interface HanglyAppApi {
  getName: () => string;
  getVersion: () => string;
}

/** Full bridge exposed on `window.hangly`. */
export interface HanglyBridge {
  app: HanglyAppApi;
}

declare global {
  interface Window {
    hangly: HanglyBridge;
  }
}

// The complete API surface exposed to the renderer.
// Keep this minimal: only add methods as the app actually needs them,
// and validate inputs in the main process handlers.
const api: HanglyBridge = {
  app: {
    /** Display name of the running app, safe to show in the UI. */
    getName: (): string => 'Hangly Desktop Companion',
    /** Version from package.json, safe to show in the UI. */
    getVersion: (): string => '0.1.0',
  },
};

// `exposeInMainWorld` makes `api` available as `window.hangly` in the renderer.
// Nothing from Node.js is exposed, thanks to contextIsolation + sandbox.
contextBridge.exposeInMainWorld('hangly', api);
