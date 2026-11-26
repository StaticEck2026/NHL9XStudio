/**
 * Draw a loose stick the way the retail art draws one.
 *
 * Read off the skater frames (SPFskatewp, SPFsweep) and the dropped sticks of SPFgloves (frame 353):
 *   - the shaft is a one-pixel line of colour 14, stepped like a Bresenham line (runs, never anti-aliased);
 *   - the blade is a two-pixel-thick run of colour 14 about five pixels long where the stick meets the ice;
 *   - colour 15 (ice blue) is the shadow. A stick lying on the ice has its shadow one pixel under every wood pixel
 *     (one pixel down and right on a steep stick, so it shows); a raised shaft casts a dotted shadow, every other
 *     pixel, along its footprint on the ice, one pixel under the blade's row.
 *
 * The stick pivots on its heel (where shaft meets blade). Angle 0 lies flat pointing back along -axis, 90 stands
 * straight up, 180 lies flat along +axis. axis is the stick's direction on the ice (screen pixels, the ice drawn
 * 1:1 the way the hotspot tables place the puck), length its length on the ice, height its length standing up.
 */
'use strict';

const { Cel, STICK, SHADOW } = require('./cel');

function line(x0, y0, x1, y1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const pts = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    pts.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return pts;
}

/** Plot into a sparse map so the cel can be sized afterwards. */
class Plot {
  constructor() { this.m = new Map(); }
  put(x, y, v, onlyEmpty) {
    const k = x + ',' + y;
    if (onlyEmpty && this.m.has(k)) return;
    this.m.set(k, [x, y, v]);
  }
  has(x, y) { return this.m.has(x + ',' + y); }
  get(x, y) { const p = this.m.get(x + ',' + y); return p ? p[2] : 0; }
  cel() {
    const pts = [...this.m.values()];
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const cel = Cel.empty(x0, y0, Math.max(...xs) - x0 + 1, Math.max(...ys) - y0 + 1);
    for (const [x, y, v] of pts) cel.set(x, y, v);
    return cel;
  }
}

const BLADE = 5;

/**
 * A stick whose heel sits at (0, 0) of the returned cel's space.
 * opts: { axis: [ax, ay] unit, length, height, angle (degrees) }
 */
function drawStick(opts) {
  const { axis, length, height } = opts;
  const a = (opts.angle * Math.PI) / 180;
  const along = -Math.cos(a);                       // -1 flat back, +1 flat ahead
  const up = Math.sin(a);
  // Butt on screen: the footprint on the ice, lifted by its height.
  const fx = axis[0] * length * along, fy = axis[1] * length * along;
  const bx = fx, by = fy - height * up;
  const p = new Plot();
  const shaft = line(0, 0, bx, by);
  for (const [x, y] of shaft) p.put(x, y, STICK);
  // Blade: from the heel away from the butt, two pixels thick, on the ice.
  const back = [-Math.sign(fx) || 0, -Math.sign(fy) || 0];
  const flatAxis = Math.abs(fx) >= Math.abs(fy) * 0.6 || (Math.abs(fx) < 1 && Math.abs(fy) < 1);
  const blade = [];
  if (flatAxis) {
    const dir = back[0] || (axis[0] >= 0 ? -1 : 1);
    for (let i = 0; i < BLADE; i++) { blade.push([i * dir, 0]); if (i < BLADE - 1) blade.push([i * dir + dir, -1]); }
  } else {
    const dir = back[1] || 1;
    for (let i = 0; i < BLADE - 1; i++) { blade.push([0, i * dir]); blade.push([1, i * dir + (dir > 0 ? 1 : -1) * 0]); }
  }
  for (const [x, y] of blade) p.put(x, y, STICK);
  // Shadow.
  const lying = up < 0.2;
  const steep = Math.abs(fy) > Math.abs(fx);
  const [sdx, sdy] = steep ? [1, 1] : [0, 1];
  if (lying) {
    for (const [x, y] of [...p.m.values()].map((q) => [q[0], q[1]])) p.put(x + sdx, y + sdy, SHADOW, true);
  } else {
    for (const [x, y] of blade) p.put(x + sdx, y + sdy, SHADOW, true);
    const foot = line(0, 1, fx, fy + 1);
    foot.forEach(([x, y], i) => { if (i % 2 === 0) p.put(x + sdx, y + sdy, SHADOW, true); });
  }
  return { cel: p.cel(), butt: [bx, by], foot: [fx, fy] };
}

module.exports = { drawStick, line };
