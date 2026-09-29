/**
 * Generates the Hangly tray icon (a green rounded square with an "H" glyph,
 * transparent background) as a 256x256 PNG. Run once with:
 *
 *   node scripts/gen-tray-icon.js
 *
 * The generated asset is tracked in git; this script only exists to
 * regenerate it.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZE = 256;
const OUT = path.join(__dirname, '..', 'assets', 'tray-icon.png');

const px = Buffer.alloc(SIZE * SIZE * 4, 0); // RGBA, transparent by default

const setPixel = (x, y, r, g, b, a = 255) => {
  const i = (y * SIZE + x) * 4;
  px[i] = r;
  px[i + 1] = g;
  px[i + 2] = b;
  px[i + 3] = a;
};

// Rounded-square background, Hangly accent green (#4cc38a).
const R = 56; // corner radius
const inRounded = (x, y) => {
  const cx = Math.min(Math.max(x, R), SIZE - 1 - R);
  const cy = Math.min(Math.max(y, R), SIZE - 1 - R);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= R * R;
};

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (inRounded(x, y)) {
      setPixel(x, y, 0x4c, 0xc3, 0x8a);
    }
  }
}

// Draw the "H": two vertical bars + crossbar, white, centered.
const bar = 26;
const left = 74;
const right = SIZE - 74 - bar;
const top = 64;
const bottom = SIZE - 64;
const crossY = Math.round((top + bottom) / 2 - bar / 2);

const fillRect = (x0, y0, w, h) => {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      setPixel(x, y, 0xff, 0xff, 0xff);
    }
  }
};

fillRect(left, top, bar, bottom - top); // left stroke
fillRect(right, top, bar, bottom - top); // right stroke
fillRect(left, crossY, right + bar - left, bar); // crossbar

// Encode a minimal PNG: IHDR + IDAT (zlib) + IEND, with CRCs.
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
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

// Raw scanlines need a filter byte (0) per row.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
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
