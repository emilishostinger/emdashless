import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Black rounded square, thick white em dash, 4x supersampled for clean edges.
const RADIUS = 0.22;   // corner radius as a fraction of the canvas
const BAR_W = 0.62;    // em dash width as a fraction of the canvas
const BAR_H = 0.125;   // em dash thickness as a fraction of the canvas
const BG = 0x0a;       // near-black reads as black without looking like a hole
const SAMPLES = 4;

function pointInRounded(x, y, w, h, r) {
  if (x < 0 || y < 0 || x > w || y > h) return false;
  const cx = Math.min(Math.max(x, r), w - r);
  const cy = Math.min(Math.max(y, r), h - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

const insideRoundedRect = (x, y, size, r) => pointInRounded(x, y, size, size, r);

const insideBar = (x, y, size) => {
  const w = size * BAR_W;
  const h = Math.max(2, Math.round(size * BAR_H));
  return pointInRounded(x - (size - w) / 2, y - (size - h) / 2, w, h, Math.min(h * 0.25, 2));
};

function render(size) {
  const r = size * RADIUS;
  const rgba = Buffer.alloc(size * size * 4);
  const step = 1 / SAMPLES;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let square = 0;
      let bar = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = px + (sx + 0.5) * step;
          const y = py + (sy + 0.5) * step;
          if (!insideRoundedRect(x, y, size, r)) continue;
          square++;
          if (insideBar(x, y, size)) bar++;
        }
      }
      const total = SAMPLES * SAMPLES;
      const alpha = square / total;
      const i = (py * size + px) * 4;
      if (alpha === 0) continue;
      const white = bar / square; // share of the covered area that is the dash
      const level = Math.round(BG + (255 - BG) * white);
      rgba[i] = level;
      rgba[i + 1] = level;
      rgba[i + 2] = level;
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return rgba;
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const out = join(dirname(dirname(fileURLToPath(import.meta.url))), 'emdashless', 'icons');
mkdirSync(out, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = join(out, `icon${size}.png`);
  writeFileSync(file, png(size, render(size)));
  console.log(`wrote ${file}`);
}
