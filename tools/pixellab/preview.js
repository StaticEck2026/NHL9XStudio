#!/usr/bin/env node
'use strict';
/**
 * Contact sheet of original vs PixelLab HD frames, both anchored at 0,0.
 *   node tools/pixellab/preview.js out.png 21-25 61-65 ...   (or "facing skater:4")
 * Rows alternate: original (scaled 2x, nearest) above, HD below.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const png = require('./png.js');
const sp = require('./sprites.js');

const ROOT = path.join(__dirname, '..', '..');
const [, , outFile, ...specs] = process.argv;
const sheet = sp.loadSheet();
const hd = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hd', 'nhl92-sprites-hd.json'), 'utf8'));
let frames = [];
for (const s of specs) {
  if (s.includes(':')) {
    frames.push(...Object.entries(hd.skeletons).filter(([, v]) => v.character + ':' + v.facing === s).map(([n]) => +n));
  } else {
    const [a, b] = s.split('-').map(Number);
    for (let n = a; n <= (b || a); n++) frames.push(n);
  }
}
frames = frames.filter((n) => hd.frames[n]);
const COLS = Number(process.env.COLS || 15), CW = Number(process.env.CW || 72), CH = Number(process.env.CH || 80), Z = Number(process.env.ZOOM || 2);
const rows = Math.ceil(frames.length / COLS);
const W = COLS * CW * Z, H = rows * CH * 2 * Z;
const rgba = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) rgba.set([58, 86, 118, 255], i * 4);
function blit(indices, w, h, x, y, scale) {
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const v = indices[yy * w + xx];
    if (!v) continue;
    const c = sheet.palette[v];
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const px = x + xx * scale + dx, py = y + yy * scale + dy;
      if (px >= 0 && py >= 0 && px < W && py < H) rgba.set([c[0], c[1], c[2], 255], (py * W + px) * 4);
    }
  }
}
frames.forEach((n, i) => {
  const cx = (i % COLS) * CW * Z, cy = Math.floor(i / COLS) * CH * 2 * Z;
  const ox = cx + (CW / 2) * Z, oy = cy + (CH - 20) * Z;
  const f = sheet.frame(n);
  blit(f.pixels, f.width, f.height, ox + f.minX * 2 * Z / 2 * 1, oy + f.minY * Z, Z);
  const h = hd.frames[n];
  const data = zlib.inflateSync(Buffer.from(h.data, 'base64'));
  blit(data, h.w, h.h, ox + (h.x * Z) / 2, oy + CH * Z + (h.y * Z) / 2, Z / 2 >= 1 ? Z / 2 : 1);
});
fs.writeFileSync(outFile, png.encodeRgba(W, H, rgba));
console.log(frames.length, 'frames ->', outFile);
