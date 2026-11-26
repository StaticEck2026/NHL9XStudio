/**
 * Cut a cel into Genesis hardware sprites the way the player sheet stores a frame.
 *
 * A VDP sprite is 1-4 tiles wide and 1-4 tiles high (8x8 pixel tiles, 4 bits a pixel). Tiles are stored column by
 * column inside a sprite. A sheet frame is a list of such sprites, each with an x, y offset from the player position,
 * a size index (SIZE_TAB / DIMENSIONS in lib/anim.js: index = (width - 1) * 4 + (height - 1)) and a first tile.
 *
 * The cut: lay an 8x8 grid on the cel's box, mark the tiles holding any pixel, and cover them greedily with the
 * biggest rectangles up to 4x4 that only hold marked tiles, top-left first. Sprites sit on any pixel, so the grid
 * is tried at all 64 alignments and the one needing fewest tiles (then fewest sprites) wins. Each piece gets its tiles, column-major,
 * as 32-byte 4bpp blocks (high nibble first), ready for a tile bank. A sprite has one palette line, so each line a
 * cel uses is cut on its own: the skater is line 2, the ice spray of the SPFstop frames is line 0, as in the retail
 * frames.
 */
'use strict';

const { Cel } = require('./cel');

function splitLine(cel, line, gx, gy) {
  // The grid starts gx, gy pixels left of and above the layer, so the same picture can be tried on every alignment.
  const b = cel.grow(cel.x0 - gx, cel.y0 - gy, cel.x0 + cel.w - 1, cel.y0 + cel.h - 1);
  const tw = Math.ceil(b.w / 8), th = Math.ceil(b.h / 8);
  const used = [];
  for (let ty = 0; ty < th; ty++) {
    used.push([]);
    for (let tx = 0; tx < tw; tx++) {
      let any = false;
      for (let y = 0; y < 8 && !any; y++) for (let x = 0; x < 8 && !any; x++) any = !!b.get(b.x0 + tx * 8 + x, b.y0 + ty * 8 + y);
      used[ty].push(any);
    }
  }
  const taken = used.map((r) => r.map(() => false));
  const free = (tx, ty) => tx < tw && ty < th && used[ty][tx] && !taken[ty][tx];
  const pieces = [];
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      if (!free(tx, ty)) continue;
      let best = null;
      for (let w = 1; w <= 4; w++) {
        for (let h = 1; h <= 4; h++) {
          let ok = true;
          for (let y = 0; y < h && ok; y++) for (let x = 0; x < w && ok; x++) ok = free(tx + x, ty + y);
          if (ok && (!best || w * h > best.w * best.h)) best = { w, h };
        }
      }
      for (let y = 0; y < best.h; y++) for (let x = 0; x < best.w; x++) taken[ty + y][tx + x] = true;
      const px0 = b.x0 + tx * 8, py0 = b.y0 + ty * 8;
      const tiles = [];
      for (let x = 0; x < best.w; x++) {
        for (let y = 0; y < best.h; y++) {
          const bytes = new Uint8Array(32);
          for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c += 2) {
              const hi = b.get(px0 + x * 8 + c, py0 + y * 8 + r), lo = b.get(px0 + x * 8 + c + 1, py0 + y * 8 + r);
              bytes[r * 4 + c / 2] = ((hi & 15) << 4) | (lo & 15);
            }
          }
          tiles.push(bytes);
        }
      }
      pieces.push({ x: px0, y: py0, w: best.w, h: best.h, sizeIndex: (best.w - 1) * 4 + (best.h - 1), palette: line, tiles });
    }
  }
  return pieces;
}

function split(cel) {
  const b = cel.trim();
  const lines = [...new Set(b.pixels().map(([, , v]) => v >> 4))].sort();
  const pieces = [];
  for (const line of lines) {
    const layer = Cel.empty(b.x0, b.y0, b.w, b.h);
    for (const [x, y, v] of b.pixels()) if (v >> 4 === line) layer.set(x, y, v);
    const trimmed = layer.trim();
    let best = null;
    for (let gy = 0; gy < 8; gy++) {
      for (let gx = 0; gx < 8; gx++) {
        const cut = splitLine(trimmed, line, gx, gy);
        const tiles = cut.reduce((n, p) => n + p.w * p.h, 0);
        if (!best || tiles < best.tiles || (tiles === best.tiles && cut.length < best.cut.length)) best = { tiles, cut };
      }
    }
    pieces.push(...best.cut);
  }
  const tileCount = pieces.reduce((n, p) => n + p.w * p.h, 0);
  let perLine = 0;
  for (let y = b.y0; y < b.y0 + b.h; y++) {
    perLine = Math.max(perLine, pieces.filter((p) => y >= p.y && y < p.y + p.h * 8).length);
  }
  return { pieces, tileCount, perLine, box: { x: b.x0, y: b.y0, w: b.w, h: b.h } };
}

module.exports = { split };
