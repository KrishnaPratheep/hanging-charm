/**
 * Bundles DOM-free TypeScript modules (TypeScript ESM) into CommonJS so Node's
 * built-in test runner can require them. The physics layer and the charm
 * registry have no DOM dependencies, so the same code that runs in the app can
 * run headless.
 *
 * Run via `npm test` (or directly: `node scripts/bundle-physics-tests.mjs`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const outdir = path.join(root, '.vite', 'test');

// Rebuild from scratch so stale bundles can never shadow a fresh one.
fs.rmSync(outdir, { recursive: true, force: true });

const entries = [
  { in: path.join(root, 'src', 'renderer', 'physics', 'scene.ts'), outfile: path.join(outdir, 'scene.cjs') },
  { in: path.join(root, 'src', 'renderer', 'physics', 'config.ts'), outfile: path.join(outdir, 'config.cjs') },
  { in: path.join(root, 'src', 'renderer', 'charms', 'registry.ts'), outfile: path.join(outdir, 'registry.cjs') },
  { in: path.join(root, 'src', 'renderer', 'charms', 'types.ts'), outfile: path.join(outdir, 'types.cjs') },
];

await Promise.all(
  entries.map(({ in: entry, outfile }) =>
    build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      outfile,
      loader: { '.png': 'file' },
      logLevel: 'warning',
    }),
  ),
);

console.log(`test bundles -> ${path.relative(root, outdir)}/`);
