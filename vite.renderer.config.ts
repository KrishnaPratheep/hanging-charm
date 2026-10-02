import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Content-Security-Policy, resolved per mode:
 * - Dev needs 'unsafe-inline' for @vitejs/plugin-react's refresh preamble.
 * - Production keeps script-src strict ('self' only).
 */
const cspForMode = (isDev: boolean): string => {
  const scriptSrc = isDev ? "'self' 'unsafe-inline'" : "'self'";
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
  ].join('; ');
};

/** Replaces the __VITE_CSP__ placeholder in index.html with the mode-appropriate policy. */
const cspPlugin = (): Plugin => ({
  name: 'csp-by-mode',
  transformIndexHtml(html, ctx) {
    return html.replace('__VITE_CSP__', cspForMode(Boolean(ctx.server)));
  },
});

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react(), cspPlugin()],
  build: {
    // Inline small images as data: URIs: charm textures ride inside the
    // renderer bundle (packed in the asar) and satisfy img-src 'self' data:.
    assetsInlineLimit: 16384,
  },
});
