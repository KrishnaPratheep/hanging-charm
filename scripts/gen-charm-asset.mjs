/**
 * Generates the built-in "Star" charm: an original cute five-pointed star with
 * a simple face, rendered analytically (polygon signed distance + ray-cast
 * fill test, smooth anti-aliased edges, fully transparent background) into a
 * 128x128 RGBA PNG.
 *
 *   node scripts/gen-charm-asset.mjs
 *
 * The generated asset is tracked in git; this script only regenerates it.
 * No external artwork, fonts, or libraries are used.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SIZE = 128;
const OUT = path.join(here, '..', 'src', 'renderer', 'assets', 'charms', 'star.png');

// Palette (Hangly accent green family).
const FILL = [0x4c, 0xc3, 0x8a];
const LIGHT = [0x7f, 0xe0, 0xb6];
const EDGE = [0x2f, 0x9d, 0x6c];
const FACE = [0x24, 0x3b, 0x33];
const BLUSH = [0xff, 0x8f, 0x6b];

// Five-pointed star polygon: alternating outer/inner radii, one tip up.
const OUTER = 52; // tips
const INNER = 23; // valleys
const TIP_ROUND = 6.5; // capsule radius -> round tips/valleys
const C = SIZE / 2;

const starVertices = (() => {
  const vertices = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? OUTER : INNER;
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    vertices.push({ x: C + radius * Math.cos(angle), y: C + radius * Math.sin(angle) });
  }
  return vertices;
})();

/** Distance from a point to a line segment. */
function segmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const lengthSq = abx * abx + aby * aby;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / lengthSq)) : 0;
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/** Approximate signed distance to the rounded star polygon (negative = inside). */
function starSDF(px, py) {
  let dist = Infinity;
  let inside = false;
  for (let i = 0; i < 10; i += 1) {
    const a = starVertices[i];
    const b = starVertices[(i + 1) % 10];
    dist = Math.min(dist, segmentDistance(px, py, a.x, a.y, b.x, b.y));
    // Ray cast (right direction) for the inside test.
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  // Rounded silhouette = polygon dilated by TIP_ROUND: outside grows by the
  // radius, inside deepens by it.
  return inside ? -(dist + TIP_ROUND) : dist - TIP_ROUND;
}

function circleSDF(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

/** Approximate ellipse signed distance (fine at this size). */
function ellipseSDF(px, py, cx, cy, rx, ry) {
  const nx = (px - cx) / rx;
  const ny = (py - cy) / ry;
  return (Math.hypot(nx, ny) - 1) * Math.min(rx, ry);
}

// Face layout on the star's lower-center body.
const EYES = { y: 66, dx: 13, r: 4.6 };
const MOUTH = { x: C, y: 77, rx: 6.5, ry: 3.8 };
const BLUSH_POS = { y: 73, dx: 21, rx: 5.5, ry: 3.2 };

const px = Buffer.alloc(SIZE * SIZE * 4, 0);
for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    const shape = starSDF(x, y);
    if (shape > 1.2) continue; // outside the star entirely

    // Smooth diagonal gradient: lighter toward the top-left "light".
    const shade = Math.max(0, Math.min(1, (58 - (x - C) * 0.45 - (y - C) * 0.45) / 58));
    const t = Math.max(0, Math.min(1, (shade - 0.6) / 0.4));
    let r = FILL[0] + (LIGHT[0] - FILL[0]) * t;
    let g = FILL[1] + (LIGHT[1] - FILL[1]) * t;
    let b = FILL[2] + (LIGHT[2] - FILL[2]) * t;

    // Blush dots (on the body, under the eyes).
    const blushD = Math.min(
      ellipseSDF(x, y, C - BLUSH_POS.dx, BLUSH_POS.y, BLUSH_POS.rx, BLUSH_POS.ry),
      ellipseSDF(x, y, C + BLUSH_POS.dx, BLUSH_POS.y, BLUSH_POS.rx, BLUSH_POS.ry),
    );
    if (blushD < 0) {
      r = BLUSH[0];
      g = BLUSH[1];
      b = BLUSH[2];
    }

    // Eyes and mouth (dark silhouette on the body).
    const eyeD = Math.min(
      circleSDF(x, y, C - EYES.dx, EYES.y, EYES.r),
      circleSDF(x, y, C + EYES.dx, EYES.y, EYES.r),
    );
    const mouthD = ellipseSDF(x, y, MOUTH.x, MOUTH.y, MOUTH.rx, MOUTH.ry);
    if (eyeD < 0 || mouthD < 0) {
      r = FACE[0];
      g = FACE[1];
      b = FACE[2];
    }

    // 1.5px dark rim just inside the silhouette for a sticker-like edge.
    if (shape > -1.5) {
      r = EDGE[0];
      g = EDGE[1];
      b = EDGE[2];
    }

    // Anti-aliased alpha from the body silhouette only (1.2px feather).
    // Eyes/mouth/blush recolor pixels; they never cut the silhouette.
    const alpha = Math.max(0, Math.min(1, (1.2 - shape) / 1.2));
    const i = (y * SIZE + x) * 4;
    px[i] = Math.round(r);
    px[i + 1] = Math.round(g);
    px[i + 2] = Math.round(b);
    px[i + 3] = Math.round(alpha * 255);
  }
}

// --- PNG encoding (identical minimal encoder as gen-tray-icon.js) -----------
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let row = 0; row < SIZE; row += 1) {
  raw[row * (SIZE * 4 + 1)] = 0; // filter type 0 (None) per scanline
  px.copy(raw, row * (SIZE * 4 + 1) + 1, row * SIZE * 4, (row + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png);
console.log(`Wrote ${OUT} (${png.length} bytes)`);
