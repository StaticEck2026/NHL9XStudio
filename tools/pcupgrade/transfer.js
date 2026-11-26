/**
 * Upgrade a Genesis frame using the PC sheet's own version of the same picture (the check injury, SPFinjury1).
 *
 * The PC frames are the Genesis drawings recoloured (94-98% silhouette overlap on the skating frames), so after
 * lining the two up, each Genesis pixel takes the PC index at the same spot when that PC pixel is the same material:
 * a jersey zone for a team colour, the skin ramp for skin, black for black, and so on. Otherwise it takes the
 * nearest PC pixel of that material within 2 pixels, and failing that the segmenter's answer. The Genesis pixels
 * stay exactly where they are; only their colour comes from the PC frame.
 */
'use strict';

const Zs = require('./zones');
const { CLASS } = require('./segment');

function materialOfPc(v) {
  if (v === Zs.TRANSPARENT) return null;
  if (v === Zs.BLACK) return 'black';
  if (v >= 144 && v < 192) return 'team';
  if (v >= 128 && v < 144) return 'skin';
  if (v >= 192) return 'team';            // crest pixels sit on the jersey
  return 'fixed';
}
function materialOfGenesis(v) {
  if (!v) return null;
  const line = v >> 4, c = CLASS[v & 15];
  if (line < 2) return 'fixed';
  if (c === 'pants' || c === 'trim' || c === 'second' || c === 'main') return 'team';
  if (c === 'skin') return 'skin';
  if (c === 'black') return 'black';
  if (c === 'stick') return 'stick';       // the PC stick lives on the skin ramp (136), its tape is black (0)
  return 'fixed';
}

/** Best offset of pc over gen (pc pixel = gen pixel + d), searched around the player positions lining up. */
function align(gen, pc, reach = 8) {
  const base = [gen.x0 - pc.x0, gen.y0 - pc.y0];
  let best = null;
  for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
    const ox = base[0] + dx, oy = base[1] + dy;
    let hit = 0;
    for (let y = 0; y < gen.h; y++) for (let x = 0; x < gen.w; x++) {
      if (!gen.px[y * gen.w + x]) continue;
      const X = x + ox, Y = y + oy;
      if (X >= 0 && Y >= 0 && X < pc.w && Y < pc.h && pc.px[Y * pc.w + X] !== Zs.TRANSPARENT) hit++;
    }
    if (!best || hit > best.hit) best = { ox, oy, hit };
  }
  let genCount = 0, pcCount = 0;
  for (const v of gen.px) if (v) genCount++;
  for (const v of pc.px) if (v !== Zs.TRANSPARENT) pcCount++;
  best.overlap = best.hit / (genCount + pcCount - best.hit);
  return best;
}

/** fallback: Uint8Array from segment() for the same frame. Returns { out, fromPc, overlap }. */
function transfer(gen, pc, fallback) {
  const a = align(gen, pc);
  const out = Uint8Array.from(fallback);
  let fromPc = 0, total = 0;
  const pcAt = (X, Y) => (X >= 0 && Y >= 0 && X < pc.w && Y < pc.h ? pc.px[Y * pc.w + X] : Zs.TRANSPARENT);
  for (let y = 0; y < gen.h; y++) for (let x = 0; x < gen.w; x++) {
    const i = y * gen.w + x, m = materialOfGenesis(gen.px[i]);
    if (!m || m === 'fixed') continue;
    total++;
    const X = x + a.ox, Y = y + a.oy;
    let got = null;
    for (let r = 0; r <= 2 && got == null; r++) {
      for (let dy = -r; dy <= r && got == null; dy++) for (let dx = -r; dx <= r && got == null; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const v = pcAt(X + dx, Y + dy);
        const pm = materialOfPc(v);
        if (pm === m || (m === 'stick' && (pm === 'skin' || pm === 'black'))) got = v;
      }
    }
    if (got != null) { out[i] = got; fromPc++; }
  }
  return { out, fromPc, total, overlap: a.overlap, offset: [a.ox, a.oy] };
}

module.exports = { transfer, align, materialOfPc, materialOfGenesis };
