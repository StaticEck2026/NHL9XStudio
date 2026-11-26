#!/usr/bin/env node
/**
 * Every skater frame of each game year, split into layers, and the data the animation builder (public/animator.html)
 * loads. Needs the retail ROMs in roms/ and the NHL 95 PC files in pc95/ (tools/sprites/frames.js; no NHL 92 data).
 *
 *   node tools/build-sprite-layers.js [--pc pc95] [--out library]
 *
 * Writes into library/ (git-ignored: it is the games' art, rebuilt from your own files):
 *   layers/<year>/<frame>.ora   OpenRaster (GIMP, Krita, MyPaint): one layer per part, stacked far to near (the
 *                               shadow, the stick's shadow, far limbs, torso, head, near limbs, stick), each at its
 *                               place, in the year's colours (Boston home), plus a hidden "skeleton" layer. Years:
 *                               93g NHLPA Hockey '93 Genesis, 94g NHL Hockey '94 Genesis, 95pc NHL Hockey 95 PC.
 *   bundle-<year>.json          frames (pixels, parts, skeletons) and palette for the builder.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const R = require('../lib/sprite-rig');
const Z = require('../lib/zip-store');
const { load } = require('./sprites/rig-load');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const out = path.resolve(ROOT, opt('--out', 'library'));
const { lib, palettes, titles, sources } = load({ pc: opt('--pc'), rom93: opt('--rom93'), rom94: opt('--rom94') });

function rgbaPng(w, h, rgba) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(Z.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const LABEL = { head: 'head', torso: 'torso', arm0: 'arm A', arm1: 'arm B', hand0: 'hand A', hand1: 'hand B', leg0: 'leg A', leg1: 'leg B',
  skate0: 'skate A', skate1: 'skate B', stick: 'stick', stickShadow: 'stick shadow', shadow: 'shadow', other: 'other' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function ora(f, pal) {
  const L = R.orderedLayers(f);
  const W = f.w + 2, H = f.h + 2, ox = -f.x0 + 1, oy = -f.y0 + 1;   // a pixel of margin all round
  const files = [], stack = [];
  const merged = new Uint8Array(W * H * 4);
  L.forEach((layer, k) => {
    const rgba = new Uint8Array(layer.w * layer.h * 4);
    for (let i = 0; i < layer.w * layer.h; i++) {
      const v = layer.px[i];
      if (v === f.empty) continue;
      const c = pal[v];
      rgba.set([c[0], c[1], c[2], 255], i * 4);
      const x = layer.x0 + ox + (i % layer.w), y = layer.y0 + oy + ((i / layer.w) | 0);
      merged.set([c[0], c[1], c[2], 255], (y * W + x) * 4);
    }
    const name = 'data/' + String(k).padStart(2, '0') + '-' + layer.part + '.png';
    files.push({ name, data: rgbaPng(layer.w, layer.h, rgba) });
    stack.unshift('  <layer name="' + esc(LABEL[layer.part] || layer.part) + '" src="' + name + '" x="' + (layer.x0 + ox) + '" y="' + (layer.y0 + oy) + '" visibility="visible" opacity="1.0"/>');
  });
  // The skeleton, hidden, on top.
  const sk = new Uint8Array(W * H * 4);
  const dot = (p, c) => { if (!p) return; const x = Math.round(p[0] + ox - 0.5), y = Math.round(p[1] + oy - 0.5); if (x >= 0 && y >= 0 && x < W && y < H) sk.set(c, (y * W + x) * 4); };
  const line = (a, b, c) => { if (!a || !b) return; const n = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))) || 1; for (let i = 0; i <= n; i++) dot([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n], c); };
  const kp = f.kp, blue = [0, 90, 255, 255], red = [255, 40, 40, 255];
  for (const [a, b] of [['head', 'neck'], ['neck', 'shoulder0'], ['neck', 'shoulder1'], ['shoulder0', 'elbow0'], ['elbow0', 'hand0'], ['shoulder1', 'elbow1'], ['elbow1', 'hand1'],
    ['neck', 'hipMid'], ['hipMid', 'hip0'], ['hipMid', 'hip1'], ['hip0', 'knee0'], ['knee0', 'skate0'], ['hip1', 'knee1'], ['knee1', 'skate1'], ['stickButt', 'stickBlade']]) line(kp[a], kp[b], blue);
  for (const j of R.JOINTS) dot(kp[j], red);
  files.push({ name: 'data/skeleton.png', data: rgbaPng(W, H, sk) });
  stack.unshift('  <layer name="skeleton" src="data/skeleton.png" x="0" y="0" visibility="hidden" opacity="1.0"/>');
  // Thumbnail: the merged picture at up to 8x, within 256.
  const s = Math.max(1, Math.min(8, Math.floor(256 / Math.max(W, H))));
  const th = new Uint8Array(W * s * H * s * 4);
  for (let y = 0; y < H * s; y++) for (let x = 0; x < W * s; x++) th.set(merged.subarray(((y / s | 0) * W + (x / s | 0)) * 4, ((y / s | 0) * W + (x / s | 0)) * 4 + 4), (y * W * s + x) * 4);
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<image version="0.0.5" w="' + W + '" h="' + H + '" xres="72" yres="72">\n <stack name="' + esc(f.id + ' ' + (f.group || '')) + '">\n' + stack.join('\n') + '\n </stack>\n</image>\n';
  return Buffer.from(Z.zipStore([
    { name: 'mimetype', data: Buffer.from('image/openraster') },
    { name: 'stack.xml', data: Buffer.from(xml) },
    ...files,
    { name: 'mergedimage.png', data: rgbaPng(W, H, merged) },
    { name: 'Thumbnails/thumbnail.png', data: rgbaPng(W * s, H * s, th) }
  ]));
}

const b64 = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
const summary = {};
for (const game of ['93g', '94g', '95pc']) {
  const dir = path.join(out, 'layers', game);
  fs.mkdirSync(dir, { recursive: true });
  const frames = lib.frames.filter((f) => f.game === game);
  for (const f of frames) fs.writeFileSync(path.join(dir, f.id.replace(':', '-') + '.ora'), ora(f, palettes[game]));
  fs.writeFileSync(path.join(out, 'bundle-' + game + '.json'), JSON.stringify({
    game, title: titles[game], empty: game === '95pc' ? 255 : 0, palette: palettes[game], parts: R.PARTS, sources,
    frames: frames.map((f) => ({ id: f.id, n: f.n, group: f.group, facing: f.facing, step: f.step, w: f.w, h: f.h, x0: f.x0, y0: f.y0,
      px: b64(f.px), part: b64(f.part), kp: f.kp, prop: !!f.prop, sameAs: f.sameAs }))
  }));
  summary[game] = { frames: frames.length, layers: frames.reduce((n, f) => n + R.orderedLayers(f).length, 0) };
}
console.log(JSON.stringify(summary));
