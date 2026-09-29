# Hangly Desktop Companion

A Hangly-inspired desktop companion application for Windows (macOS planned), built on **Electron + React + TypeScript + Vite**, packaged with **Electron Forge**.

## Requirements

- Node.js 22.12+ (LTS recommended) and npm
- Windows 10/11 for packaging Windows installers

## Getting started

```bash
npm install
npm run dev
```

`npm run dev` (alias of `npm start`) launches the app with Vite HMR: edits to the renderer hot-reload, and main-process changes restart the app automatically.

## Scripts

| Script             | What it does                                              |
| ------------------ | --------------------------------------------------------- |
| `npm run dev`      | Run the app in development with hot reload                |
| `npm start`        | Same as `dev`                                             |
| `npm run typecheck`| Strict TypeScript check across main, preload, and renderer |
| `npm run package`  | Package the app into `out/` (unpackaged, per-platform)    |
| `npm run make`     | Build distributables: Squirrel.Windows installer in `out/make/` |

## Project layout

```
├── forge.config.ts            # Electron Forge config (Squirrel maker, Vite plugin, fuses)
├── forge.env.d.ts             # Types for Forge's injected build-time constants
├── index.html                 # Renderer entry HTML (CSP configured here)
├── vite.main.config.ts        # Vite config: main process
├── vite.preload.config.ts     # Vite config: preload script
├── vite.renderer.config.ts    # Vite config: React renderer
└── src/
    ├── main.ts                # Electron main process (window creation, lifecycle)
    ├── preload.ts             # contextBridge API exposed to the renderer
    ├── preload.d.ts           # Types for window.hangly
    └── renderer/
        ├── index.tsx          # React bootstrap
        ├── App.tsx            # Welcome screen
        └── styles.css
```

## Security model

The window is configured with hardened Electron defaults:

- `contextIsolation: true` and `nodeIntegration: false` — the renderer has no direct Node access
- `sandbox: true` for the renderer
- A minimal, typed preload API (`window.hangly`) is the **only** bridge between processes
- A restrictive Content-Security-Policy in `index.html`
- `window.open` / external navigation is redirected to the OS browser via `shell.openExternal`
- At package time, Forge fuses disable `RunAsNode`, Node CLI inspect flags, and `NODE_OPTIONS`, and enable ASAR integrity validation

## Packaging for Windows

```bash
npm run make
```

Outputs a Squirrel.Windows installer (`HanglyDesktopCompanionSetup.exe`) plus nupkg packages under `out/make/squirrel.windows/` — ready for auto-update hosting later.

## macOS support (planned)

The Forge config currently targets Windows. When macOS work begins, add `MakerZIP`/`MakerDMG` entries to `makers` in `forge.config.ts` and run `npm run make` on a macOS machine.
