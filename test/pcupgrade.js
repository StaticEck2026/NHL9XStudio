/** Genesis -> PC colour upgrade (tools/pcupgrade): pixels never move, fixed materials map one to one, and the
 *  segmenter's body parts agree with NHL 94 PC's own skating frames at least as well as when it was tuned. */
const assert = require('assert');
const { segment } = require('../tools/pcupgrade/segment');
const { align, transfer } = require('../tools/pcupgrade/transfer');
const Zs = require('../tools/pcupgrade/zones');

global.window = global.window || {};
require('../public/skaters-data.js');
const D = global.window.NhlSkaterData;
const G = D.find((x) => x.id === 'NHL 94'), P = D.find((x) => x.id === 'NHL 94 PC');

let agree = 0, total = 0;
G.frames.forEach((g, k) => {
  const px = Uint8Array.from(Buffer.from(g.px, 'base64'));
  const { out } = segment({ w: g.w, h: g.h, px });
  for (let i = 0; i < px.length; i++) {
    assert.strictEqual(px[i] === 0, out[i] === Zs.TRANSPARENT, 'pixel ' + i + ' of frame ' + k + ' moved');
    const c = px[i] & 15;
    if (!px[i]) continue;
    if (c === 1) assert.strictEqual(out[i], Zs.BLADE_BLUE);
    if (c === 2) assert.strictEqual(out[i], Zs.BLACK);
    if (c === 6) assert.strictEqual(out[i], Zs.SKIN_LIGHT);
    if (c === 15) assert.strictEqual(out[i], Zs.SHADOW);
    if (c >= 3 && c <= 13 && c !== 6 && c !== 7 && out[i] !== Zs.EYE) assert.ok(out[i] >= 144 && out[i] < 192, 'team colour ' + c + ' became ' + out[i]);
  }
  const pf = P.frames[k];
  const pcPx = Uint8Array.from(Buffer.from(pf.px, 'base64')).map((v) => (v === 0 ? 255 : v === 255 ? 0 : v));
  const gen = { w: g.w, h: g.h, x0: 0, y0: 0, px }, pc = { w: pf.w, h: pf.h, x0: 0, y0: 0, px: pcPx };
  const a = align(gen, pc, 20);
  assert.ok(a.overlap > 0.9, 'frame ' + k + ' lines up with its PC version (' + a.overlap + ')');
  for (let i = 0; i < px.length; i++) {
    const z = Zs.BY_INDEX.get(out[i]); if (!z) continue;
    const X = (i % g.w) + a.ox, Y = ((i / g.w) | 0) + a.oy;
    const pz = X >= 0 && Y >= 0 && X < pc.w && Y < pc.h ? Zs.BY_INDEX.get(pc.px[Y * pc.w + X]) : null;
    if (!pz) continue;
    total++; if (Zs.part(pz.family) === Zs.part(z.family)) agree++;
  }
  // Transfer from the PC frame itself: every team pixel gets a PC zone, and nothing moves.
  const t = transfer(gen, pc, out);
  assert.ok(t.fromPc / t.total > 0.95, 'transfer reached ' + t.fromPc + ' / ' + t.total);
  for (let i = 0; i < px.length; i++) assert.strictEqual(px[i] === 0, t.out[i] === Zs.TRANSPARENT);
});
assert.ok(agree / total >= 0.6, 'body-part agreement fell to ' + agree + ' / ' + total);
console.log('pcupgrade ok (body parts ' + agree + ' / ' + total + ' agree with NHL 94 PC)');
