/**
 * Indexed cels for the drop-stick animation builder (tools/build-dropstick.js).
 *
 * A cel is a block of colour indices (palette row * 16 + colour, 0 = empty) placed relative to the player's
 * position, the same point renderFrame calls the origin: x0, y0 are the cel's top-left corner, so the pixel at
 * (x, y) in origin space is px[(y - y0) * w + (x - x0)]. Every pixel stays a game colour index, so nothing here can
 * produce a colour the Genesis palette does not hold.
 */
'use strict';

const ROW = 2;                       // the skater palette line (jersey row)
const STICK = ROW * 16 + 14;         // stick wood, the same in every team palette
const SHADOW = ROW * 16 + 15;        // the blue ice shadow, the same in every team palette
const BLACK = ROW * 16 + 2;          // skates and gloves
const STEEL = ROW * 16 + 1;          // skate blades

class Cel {
  constructor(x0, y0, w, h, px) {
    this.x0 = x0; this.y0 = y0; this.w = w; this.h = h;
    this.px = px || new Uint8Array(w * h);
  }

  static fromRender(r) {
    return new Cel(-r.offsetX, -r.offsetY, r.width, r.height, Uint8Array.from(r.pixels));
  }

  static empty(x0, y0, w, h) { return new Cel(x0, y0, w, h); }

  clone() { return new Cel(this.x0, this.y0, this.w, this.h, Uint8Array.from(this.px)); }

  inside(x, y) { return x >= this.x0 && y >= this.y0 && x < this.x0 + this.w && y < this.y0 + this.h; }

  get(x, y) { return this.inside(x, y) ? this.px[(y - this.y0) * this.w + (x - this.x0)] : 0; }

  set(x, y, v) {
    if (!this.inside(x, y)) throw new Error('pixel ' + x + ',' + y + ' is outside the cel');
    this.px[(y - this.y0) * this.w + (x - this.x0)] = v;
  }

  /** Every non-empty pixel as [x, y, v] in origin space. */
  pixels() {
    const out = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const v = this.px[y * this.w + x];
        if (v) out.push([x + this.x0, y + this.y0, v]);
      }
    }
    return out;
  }

  /** The smallest box holding every non-empty pixel, or null. */
  bounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of this.pixels()) {
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
    return minX === Infinity ? null : { minX, minY, maxX, maxY };
  }

  /** A copy grown (never shrunk) to hold the box. */
  grow(minX, minY, maxX, maxY) {
    const x0 = Math.min(this.x0, minX), y0 = Math.min(this.y0, minY);
    const x1 = Math.max(this.x0 + this.w - 1, maxX), y1 = Math.max(this.y0 + this.h - 1, maxY);
    const out = Cel.empty(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    for (const [x, y, v] of this.pixels()) out.set(x, y, v);
    return out;
  }

  /** A copy cut down to its pixels. */
  trim() {
    const b = this.bounds();
    if (!b) return Cel.empty(0, 0, 1, 1);
    const out = Cel.empty(b.minX, b.minY, b.maxX - b.minX + 1, b.maxY - b.minY + 1);
    for (const [x, y, v] of this.pixels()) out.set(x, y, v);
    return out;
  }

  /** Draw `top` over this cel, `top` moved by dx, dy. Returns a new cel big enough for both. */
  over(top, dx = 0, dy = 0) {
    const tb = top.bounds();
    let out = this.clone();
    if (!tb) return out;
    out = out.grow(tb.minX + dx, tb.minY + dy, tb.maxX + dx, tb.maxY + dy);
    for (const [x, y, v] of top.pixels()) out.set(x + dx, y + dy, v);
    return out;
  }

  /** Draw `top` under this cel: its pixels only fill empty spots. */
  under(top, dx = 0, dy = 0) {
    const tb = top.bounds();
    let out = this.clone();
    if (!tb) return out;
    out = out.grow(tb.minX + dx, tb.minY + dy, tb.maxX + dx, tb.maxY + dy);
    for (const [x, y, v] of top.pixels()) if (!out.get(x + dx, y + dy)) out.set(x + dx, y + dy, v);
    return out;
  }
}

module.exports = { Cel, ROW, STICK, SHADOW, BLACK, STEEL };
