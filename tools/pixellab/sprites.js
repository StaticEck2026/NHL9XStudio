'use strict';
/**
 * Sprite helpers for the PixelLab HD pipeline: render NHL 92 Sprites.anim
 * frames onto origin-anchored canvases and map RGB results back to the
 * game's palette indices.
 */
const fs = require('fs');
const path = require('path');
const Anim = require('../../lib/anim.js');
const Frames = require('../../lib/parse-frames.js');

const ROOT = path.join(__dirname, '..', '..');

function loadSheet() {
  const animFile = [path.join(ROOT, '..', 'ANIM-To-BMP', 'Sprites.anim'), path.join(ROOT, 'test', 'fixtures', 'ANIM-To-BMP', 'Sprites.anim')]
    .find((f) => fs.existsSync(f));
  const anim = Anim.parseAnim(fs.readFileSync(animFile));
  const catalog = Frames.parseFrames(fs.readFileSync(path.join(ROOT, 'data', 'frames.asm'), 'utf8'));
  const cache = new Map();
  function frame(n) {
    if (!cache.has(n)) cache.set(n, Anim.renderFrame(anim, n));
    return cache.get(n);
  }
  return { anim, catalog, frame, palette: anim.combined };
}

/** Bounds of a frame relative to the player's 0,0 (skates). */
function bounds(f) {
  return { x0: f.minX, y0: f.minY, x1: f.minX + f.width, y1: f.minY + f.height };
}

function unionBox(boxes, pad = 0) {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const x of boxes) {
    b.x0 = Math.min(b.x0, x.x0); b.y0 = Math.min(b.y0, x.y0);
    b.x1 = Math.max(b.x1, x.x1); b.y1 = Math.max(b.y1, x.y1);
  }
  b.x0 -= pad; b.y0 -= pad; b.x1 += pad; b.y1 += pad;
  return b;
}

/**
 * Indexed frame → indices on a canvas `box` (origin-relative, 1x units) at `scale`.
 * Returns Uint8Array of (w*scale)*(h*scale) palette indices, 0 transparent.
 */
function indicesOnCanvas(f, box, scale) {
  const W = (box.x1 - box.x0) * scale, H = (box.y1 - box.y0) * scale;
  const out = new Uint8Array(W * H);
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const v = f.pixels[y * f.width + x];
      if (!v) continue;
      const cx = (f.minX + x - box.x0) * scale, cy = (f.minY + y - box.y0) * scale;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) out[(cy + dy) * W + cx + dx] = v;
    }
  }
  return { width: W, height: H, indices: out };
}

function indicesToRgba(img, palette) {
  const rgba = new Uint8Array(img.width * img.height * 4);
  for (let i = 0; i < img.indices.length; i++) {
    const v = img.indices[i];
    if (!v) continue;
    const c = palette[v];
    rgba[i * 4] = c[0]; rgba[i * 4 + 1] = c[1]; rgba[i * 4 + 2] = c[2]; rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/** Paste an indexed image into a larger/smaller canvas at integer offset. */
function placeIndices(img, W, H, ox, oy) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < img.height; y++) {
    const ty = y + oy;
    if (ty < 0 || ty >= H) continue;
    for (let x = 0; x < img.width; x++) {
      const tx = x + ox;
      if (tx < 0 || tx >= W) continue;
      const v = img.indices[y * img.width + x];
      if (v) out[ty * W + tx] = v;
    }
  }
  return { width: W, height: H, indices: out };
}

function lab(c) {
  // sRGB → CIE Lab (D65), for perceptual nearest-colour matching.
  const lin = c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const X = (lin[0] * 0.4124 + lin[1] * 0.3576 + lin[2] * 0.1805) / 0.95047;
  const Y = lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722;
  const Z = (lin[0] * 0.0193 + lin[1] * 0.1192 + lin[2] * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/**
 * Quantise a PixelLab RGBA result back to the game's palette indices.
 *
 * `allowed` is the set of palette indices the result may use (the indices
 * the original frames of this group use, so the HD frame keeps the team
 * jersey slots and never invents colours). `hint` is the original frame
 * scaled onto the same canvas: when two indices share a colour (black is
 * in every row) the one the original used at that spot wins, which keeps
 * the jersey row on the jersey.
 */
function quantize(rgbaImg, palette, allowed, hint) {
  const { width, height, rgba } = rgbaImg;
  const cand = [...allowed].filter((i) => i % 16 !== 0).map((i) => ({ i, lab: lab(palette[i]), rgb: palette[i] }));
  const out = new Uint8Array(width * height);
  const memo = new Map();
  for (let p = 0; p < width * height; p++) {
    if (rgba[p * 4 + 3] < 128) continue;
    const key = (rgba[p * 4] << 16) | (rgba[p * 4 + 1] << 8) | rgba[p * 4 + 2];
    let best = memo.get(key);
    if (!best) {
      const L = lab([rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]]);
      let bd = Infinity;
      best = [];
      for (const c of cand) {
        const d = (L[0] - c.lab[0]) ** 2 + (L[1] - c.lab[1]) ** 2 + (L[2] - c.lab[2]) ** 2;
        if (d < bd - 1e-6) { bd = d; best = [c]; } else if (Math.abs(d - bd) <= 1e-6) best.push(c);
      }
      memo.set(key, best);
    }
    let pick = best[0].i;
    if (best.length > 1 && hint) {
      const h = hint.indices[p];
      const same = best.find((c) => c.i === h) || best.find((c) => h && Math.floor(c.i / 16) === Math.floor(h / 16));
      if (same) pick = same.i;
    }
    out[p] = pick;
  }
  return { width, height, indices: out };
}

module.exports = { loadSheet, bounds, unionBox, indicesOnCanvas, indicesToRgba, placeIndices, quantize, lab };
