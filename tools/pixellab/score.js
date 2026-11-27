'use strict';
/**
 * Fidelity score of each HD frame against its original: the HD frame is
 * reduced to 1x (a game pixel is covered when 2 of its 4 HD pixels are) and
 * compared to the original's body (ice spray left out).
 *   iou:   overlap of the two silhouettes (intersection / union)
 *   color: share of the overlap where the HD colour (the most common index
 *          of the 2x2 block) is the original's index or a close shade.
 */
const sp = require('./sprites.js');
const SPRAY = 47;

function score(sheet, n, entry) {
  const f = sheet.frame(n);
  const box = sp.unionBox([sp.bounds(f), { x0: Math.floor(entry.x / 2), y0: Math.floor(entry.y / 2), x1: Math.ceil((entry.x + entry.w) / 2), y1: Math.ceil((entry.y + entry.h) / 2) }], 1);
  const W = box.x1 - box.x0, H = box.y1 - box.y0;
  const orig = sp.indicesOnCanvas(f, box, 1).indices;
  let inter = 0, uni = 0, agree = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = orig[y * W + x];
    const counts = new Map();
    let on = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const hx = (box.x0 + x) * 2 + dx - entry.x, hy = (box.y0 + y) * 2 + dy - entry.y;
      if (hx < 0 || hy < 0 || hx >= entry.w || hy >= entry.h) continue;
      const v = entry.pixels[hy * entry.w + hx];
      if (!v || v === SPRAY) continue;
      on++;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    const a = o && o !== SPRAY, b = on >= 2;
    if (a || b) uni++;
    if (a && b) {
      inter++;
      const best = [...counts.entries()].sort((p, q) => q[1] - p[1])[0][0];
      const lo = sp.lab(sheet.palette[o]), lh = sp.lab(sheet.palette[best]);
      const d = Math.hypot(lo[0] - lh[0], lo[1] - lh[1], lo[2] - lh[2]);
      if (d < 25) agree++;
    }
  }
  return { iou: uni ? inter / uni : 0, color: inter ? agree / inter : 0 };
}

module.exports = { score };
