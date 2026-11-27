/**
 * Pixel-art operations on indexed sprites, for the skeleton rig (lib/sprite-rig.js). Nothing here invents a colour:
 * every pixel written is a pixel value that was already there.
 *
 *   rotate     RotSprite: upscale 8x with Scale2x (which keeps hard pixel edges and diagonals), rotate by nearest
 *              sample, read back at 1x. Small turns of a limb keep the artist's outline and shading instead of the
 *              broken, doubled edges a plain nearest-neighbour rotation leaves.
 *   cleanLine  a line the way a pixel artist draws one: a repeating step pattern (1:0, 5:1, 4:1, 3:1, 2:1, 3:2, 1:1),
 *              never the uneven runs of an arbitrary slope.
 *   inpaint    fill pixels from their neighbours (a hole a moved arm leaves in the chest).
 *   tidy       remove the specks and pinholes a re-assembled sprite can leave, only where something moved.
 *
 * A layer: { x0, y0, w, h, px } in world (player-position) pixels; px holds palette indices, `empty` where unset.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlPixelArt = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Scale2x (EPX) on indexed pixels; outside the image counts as empty. */
  function scale2x(w, h, px, empty) {
    const W = w * 2, out = new Uint8Array(W * h * 2);
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? empty : px[y * w + x]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const P = px[y * w + x], A = at(x, y - 1), B = at(x + 1, y), C = at(x - 1, y), D = at(x, y + 1);
      let e0 = P, e1 = P, e2 = P, e3 = P;
      if (C === A && C !== D && A !== B) e0 = A;
      if (A === B && A !== C && B !== D) e1 = B;
      if (D === C && D !== B && C !== A) e2 = C;
      if (B === D && B !== A && D !== C) e3 = D;
      const o = (y * 2) * W + x * 2;
      out[o] = e0; out[o + 1] = e1; out[o + W] = e2; out[o + W + 1] = e3;
    }
    return { w: W, h: h * 2, px: out };
  }
  function upscale8(L, empty) {
    let s = { w: L.w, h: L.h, px: L.px };
    for (let k = 0; k < 3; k++) s = scale2x(s.w, s.h, s.px, empty);
    return s;
  }

  /**
   * Turn a layer by `angle` radians (screen coordinates, y down: positive turns clockwise) about `pivot`, and move it
   * so the pivot lands on `to` (both world points). The move is rounded to whole pixels, so a layer that only moves
   * is copied exactly. Returns a new layer.
   */
  function rotate(L, empty, angle, pivot, to) {
    const t = [Math.round(to[0] - pivot[0]), Math.round(to[1] - pivot[1])];
    if (Math.abs(angle) < 0.01) return { x0: L.x0 + t[0], y0: L.y0 + t[1], w: L.w, h: L.h, px: L.px };
    const big = upscale8(L, empty);
    const c = Math.cos(angle), s = Math.sin(angle);
    const P = [pivot[0] + t[0], pivot[1] + t[1]];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of [[L.x0, L.y0], [L.x0 + L.w, L.y0], [L.x0, L.y0 + L.h], [L.x0 + L.w, L.y0 + L.h]]) {
      const u = x - pivot[0], v = y - pivot[1];
      const X = P[0] + u * c - v * s, Y = P[1] + u * s + v * c;
      minX = Math.min(minX, X); maxX = Math.max(maxX, X); minY = Math.min(minY, Y); maxY = Math.max(maxY, Y);
    }
    const x0 = Math.floor(minX) - 1, y0 = Math.floor(minY) - 1, w = Math.ceil(maxX) - x0 + 2, h = Math.ceil(maxY) - y0 + 2;
    const px = new Uint8Array(w * h).fill(empty);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x0 + x + 0.5 - P[0], v = y0 + y + 0.5 - P[1];
      const sx = (u * c + v * s + pivot[0] - L.x0) * 8, sy = (-u * s + v * c + pivot[1] - L.y0) * 8;
      const bx = Math.floor(sx), by = Math.floor(sy);
      if (bx < 0 || by < 0 || bx >= big.w || by >= big.h) continue;
      px[y * w + x] = big.px[by * big.w + bx];
    }
    return crop({ x0, y0, w, h, px }, empty);
  }

  function crop(L, empty) {
    let minX = L.w, minY = L.h, maxX = -1, maxY = -1;
    for (let i = 0; i < L.w * L.h; i++) {
      if (L.px[i] === empty) continue;
      const x = i % L.w, y = (i / L.w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (maxX < 0) return { x0: L.x0, y0: L.y0, w: 0, h: 0, px: new Uint8Array(0) };
    const w = maxX - minX + 1, h = maxY - minY + 1, px = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = L.px[(minY + y) * L.w + minX + x];
    return { x0: L.x0 + minX, y0: L.y0 + minY, w, h, px };
  }

  /** The step patterns pixel artists use for straight lines, as [major, minor] per repeat. */
  const RATIOS = [[1, 0], [5, 1], [4, 1], [3, 1], [2, 1], [3, 2], [1, 1]];
  /** The clean direction nearest to (dx, dy): { ux, uy (unit vector), a, b (pattern), xMajor, sx, sy }. */
  function cleanDir(dx, dy) {
    const xMajor = Math.abs(dx) >= Math.abs(dy);
    const maj = Math.abs(xMajor ? dx : dy), min = Math.abs(xMajor ? dy : dx);
    const want = Math.atan2(min, maj);
    let best = RATIOS[0];
    for (const r of RATIOS) if (Math.abs(Math.atan2(r[1], r[0]) - want) < Math.abs(Math.atan2(best[1], best[0]) - want)) best = r;
    const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1, n = Math.hypot(best[0], best[1]);
    const ux = (xMajor ? best[0] : best[1]) / n * sx, uy = (xMajor ? best[1] : best[0]) / n * sy;
    return { ux, uy, a: best[0], b: best[1], xMajor, sx, sy };
  }
  /**
   * Pixels of a clean line from the pixel holding `from`, heading along (dx, dy) snapped to a clean pattern, `len`
   * pixels long (Euclidean). Returns { pts: [[x, y]...], dir, end: [x, y] centre of the last pixel }.
   */
  function cleanLine(from, dx, dy, len) {
    const d = cleanDir(dx, dy);
    const x0 = Math.floor(from[0]), y0 = Math.floor(from[1]);
    const steps = Math.max(0, Math.round(len * d.a / Math.hypot(d.a, d.b)));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const m = i, n = d.b ? Math.floor(i * d.b / d.a) : 0;
      pts.push(d.xMajor ? [x0 + m * d.sx, y0 + n * d.sy] : [x0 + n * d.sx, y0 + m * d.sy]);
    }
    const last = pts[pts.length - 1];
    return { pts, dir: d, end: [last[0] + 0.5, last[1] + 0.5] };
  }

  /**
   * Fill the pixels marked in `mask` (w * h, truthy = fill) of px from their filled neighbours, outside in: each
   * round, a masked pixel with filled 4-neighbours takes their most common value. Modifies px.
   */
  function inpaint(w, h, px, mask, empty) {
    const todo = new Set();
    for (let i = 0; i < w * h; i++) if (mask[i]) { px[i] = empty; todo.add(i); }
    for (let round = 0; round < 32 && todo.size; round++) {
      const set = [];
      for (const i of todo) {
        const x = i % w, y = (i / w) | 0;
        const count = new Map();
        for (const [ax, ay, wt] of [[x - 1, y, 2], [x + 1, y, 2], [x, y - 1, 2], [x, y + 1, 2], [x - 1, y - 1, 1], [x + 1, y - 1, 1], [x - 1, y + 1, 1], [x + 1, y + 1, 1]]) {
          if (ax < 0 || ay < 0 || ax >= w || ay >= h) continue;
          const j = ay * w + ax;
          if (todo.has(j) || px[j] === empty) continue;
          count.set(px[j], (count.get(px[j]) || 0) + wt);
        }
        let best = null, bn = 0;
        for (const [v, n] of count) if (n > bn) { bn = n; best = v; }
        if (bn >= 3) set.push([i, best]);
      }
      if (!set.length) break;
      for (const [i, v] of set) { px[i] = v; todo.delete(i); }
    }
    return px;
  }

  /**
   * Clean a composed sprite where `dirty` is set: a lone pixel with no 8-neighbour goes; an empty pixel closed on
   * all four sides takes the most common of them (a seam at a turned joint). `keep(v)` protects values (dithered
   * shadows, whose pixels are lone on purpose). Modifies px.
   */
  function tidy(w, h, px, empty, dirty, keep) {
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? empty : px[y * w + x]);
    const out = px.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!dirty[i]) continue;
      const v = px[i];
      const kept = (X, Y) => X >= 0 && Y >= 0 && X < w && Y < h && keep && keep(Y * w + X);
      if (v !== empty) {
        if (kept(x, y)) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && at(x + dx, y + dy) !== empty && !kept(x + dx, y + dy)) n++;
        if (!n) out[i] = empty;
      } else {
        const nb = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)];
        if (nb.some((q) => q === empty) || kept(x - 1, y) || kept(x + 1, y) || kept(x, y - 1) || kept(x, y + 1)) continue;
        const count = new Map();
        for (const q of nb) count.set(q, (count.get(q) || 0) + 1);
        out[i] = [...count].sort((a, b) => b[1] - a[1])[0][0];
      }
    }
    px.set(out);
    return px;
  }

  return { scale2x, rotate, crop, cleanDir, cleanLine, inpaint, tidy, RATIOS };
});
