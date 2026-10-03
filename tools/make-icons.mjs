#!/usr/bin/env node
// make-icons.mjs — draws the app icons from geometry and writes PNGs. No dependencies.
//
//   node tools/make-icons.mjs [outDir]        (default: icons/)
//
// Shapes are signed-distance functions in unit-square coordinates (y down), anti-aliased by
// coverage, composited back to front, and encoded with node:zlib. Output is deterministic.
//
// Variants
//   bleed     full-bleed, fully opaque square  -> icon-180.png: iOS applies its own rounded mask
//             and paints transparent pixels black, so the apple-touch-icon must not have corners
//   any       cheese-yellow rounded square     -> icon-192.png, icon-512.png (manifest purpose "any")
//   maskable  full-bleed, glyph inside the 80% safe circle -> icon-maskable-*.png (purpose "maskable")

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'icons'));

// ---- colour (palette from the v1 css tokens) --------------------------------------------------

const rgb = (hex, a = 1) => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
  a,
];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const CHEESE_TOP = rgb('#ffdc5e');
const CHEESE_BOT = rgb('#f2bb10');
const HOLE = rgb('#b88f06', 0.38);
const DIE = rgb('#17130c');
const DIE_RIM = rgb('#4a3d22');
const PIP_TOP = rgb('#ffe27a');
const PIP_BOT = rgb('#f5c518');
const SHADOW = rgb('#5a4300', 0.42);

// ---- signed distance fields (negative inside) -------------------------------------------------

const everywhere = () => -1;
const disc = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;
function roundBox(cx, cy, hw, hh, r, rot = 0) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return (x, y) => {
    const px = x - cx;
    const py = y - cy;
    const qx = Math.abs(px * c + py * s) - (hw - r);
    const qy = Math.abs(-px * s + py * c) - (hh - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
}

// ---- scene ------------------------------------------------------------------------------------

/** Layers back to front: { sdf, color | (x,y)=>color, soft?, clip? }. Sizes are fractions of the icon. */
function scene(variant) {
  const rounded = variant === 'any';
  const body = rounded ? roundBox(0.5, 0.5, 0.5, 0.5, 0.2237) : everywhere;
  const k = variant === 'maskable' ? 1 : 1.1; // maskable keeps everything inside the safe circle
  const layers = [];

  layers.push({ sdf: body, color: (x, y) => mix(CHEESE_TOP, CHEESE_BOT, Math.min(1, y * 1.1)) });

  // holes biting into the edges, like a slice of emmental
  for (const [cx, cy, r] of [[0.13, 0.2, 0.085], [0.9, 0.78, 0.11], [0.84, 0.1, 0.05], [0.18, 0.9, 0.06]]) {
    layers.push({ sdf: disc(cx, cy, r), color: HOLE, clip: body });
  }

  // the die: tilted, with a soft shadow, a lit rim and five pips
  const h = 0.255 * k;
  const rot = -0.2;
  const dieSdf = (dx, dy) => roundBox(0.5 + dx, 0.5 + dy, h, h, 0.075 * k, rot);
  layers.push({ sdf: dieSdf(0.012 * k, 0.026 * k), color: SHADOW, soft: 0.035 * k });
  layers.push({ sdf: dieSdf(0, 0), color: DIE_RIM });
  layers.push({ sdf: roundBox(0.5, 0.5 + 0.004 * k, h - 0.011 * k, h - 0.011 * k, 0.066 * k, rot), color: DIE });

  const off = 0.55 * h;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (const [px, py] of [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]]) {
    const x = 0.5 + (px * off) * c - (py * off) * s;
    const y = 0.5 + (px * off) * s + (py * off) * c;
    layers.push({ sdf: disc(x, y, 0.2 * h), color: (u, v) => mix(PIP_TOP, PIP_BOT, Math.max(0, Math.min(1, (v - (y - 0.2 * h)) / (0.4 * h)))) });
  }
  return layers;
}

// ---- rasteriser -------------------------------------------------------------------------------

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function render(layers, size) {
  const px = 1 / size;
  const out = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5) * px;
      const y = (j + 0.5) * px;
      let r = 0; let g = 0; let b = 0; let a = 0; // premultiplied
      for (const layer of layers) {
        let cov = clamp01(0.5 - layer.sdf(x, y) / Math.max(layer.soft ?? 0, px));
        if (cov <= 0) continue;
        if (layer.clip) cov *= clamp01(0.5 - layer.clip(x, y) / px);
        const col = typeof layer.color === 'function' ? layer.color(x, y) : layer.color;
        const sa = col[3] * cov;
        r = col[0] * sa + r * (1 - sa);
        g = col[1] * sa + g * (1 - sa);
        b = col[2] * sa + b * (1 - sa);
        a = sa + a * (1 - sa);
      }
      const o = (j * size + i) * 4;
      if (a > 0) {
        out[o] = Math.round(clamp01(r / a) * 255);
        out[o + 1] = Math.round(clamp01(g / a) * 255);
        out[o + 2] = Math.round(clamp01(b / a) * 255);
      }
      out[o + 3] = Math.round(clamp01(a) * 255);
    }
  }
  return out;
}

// ---- PNG encoder ------------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size); // each scanline: filter byte 0 + pixels
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- main -------------------------------------------------------------------------------------

const JOBS = [
  { file: 'icon-180.png', size: 180, variant: 'bleed' },
  { file: 'icon-192.png', size: 192, variant: 'any' },
  { file: 'icon-512.png', size: 512, variant: 'any' },
  { file: 'icon-maskable-192.png', size: 192, variant: 'maskable' },
  { file: 'icon-maskable-512.png', size: 512, variant: 'maskable' },
];

mkdirSync(OUT, { recursive: true });
for (const { file, size, variant } of JOBS) {
  const png = encodePng(size, render(scene(variant), size));
  writeFileSync(join(OUT, file), png);
  console.log(`${file}  ${size}x${size}  ${variant}  ${png.length} bytes`);
}
