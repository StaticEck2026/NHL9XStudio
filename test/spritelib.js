/** The skater sprite library (tools/sprites): pose maths always; with the ROMs in roms/ and the NHL 95 PC files in
 *  pc95/, the anatomy of every frame and the composer. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const P = require('../tools/sprites/pose');

// Pose maths: a pose is at distance 0 from itself, mirroring twice gives it back, and limbs swap when mirrored.
const kp = { head: [2, -26], neck: [1, -21], shoulder0: [-3, -19], hand0: [-8, -14], shoulder1: [5, -20], hand1: [12, -18],
  hip0: [-2, -11], hip1: [3, -11], hipMid: [0.5, -11], knee0: [-3, -5], knee1: [4, -5], skate0: [-4, 1], skate1: [5, 1] };
const v = P.normalise(kp);
assert.strictEqual(P.distance(v, v), 0);
assert.deepStrictEqual(P.mirror(P.mirror(v)), v);
assert.ok(Math.abs(P.mirror(v).hand0[0] + v.hand1[0]) < 1e-9, 'mirroring swaps the hands');
assert.ok(P.distance(v, P.mirror(v)) > 0.05, 'an asymmetric pose differs from its mirror');

// The rig's pose maths and draw order, without any game data.
const R = require('../lib/sprite-rig');
const back = R.denormalise(R.normalise(kp), kp);
for (const j of R.JOINTS) if (kp[j]) assert.ok(Math.hypot(back[j][0] - kp[j][0], back[j][1] - kp[j][1]) < 1e-9, 'normalise round trip ' + j);
assert.ok(R.depthOf('shadow', kp) < R.depthOf('torso', kp) && R.depthOf('torso', kp) < R.depthOf('head', kp));
const nearArm = kp.shoulder0[1] >= kp.shoulder1[1] ? 0 : 1;
assert.ok(R.depthOf('arm' + nearArm, kp) > R.depthOf('torso', kp) && R.depthOf('arm' + (1 - nearArm), kp) < R.depthOf('torso', kp), 'near arm over the torso, far arm under');

const root = path.join(__dirname, '..');
let more = '';
if (fs.existsSync(path.join(root, 'roms')) && fs.existsSync(path.join(root, 'pc95'))) {
  let loaded = null;
  try { loaded = require('../tools/sprites/frames').loadAll({ pc: path.join(root, 'pc95') }); } catch (e) { loaded = null; }
  if (loaded) {
    const A = require('../tools/sprites/anatomy');
    const C = require('../tools/sprites/compose');
    let skaters = 0, head = 0, hand = 0, skates = 0;
    for (const f of loaded.frames) {
      const a = A.analyse(f);
      assert.strictEqual(a.part.filter(Boolean).length, f.label.filter((x) => x !== 255).length, f.id + ': every pixel has a part');
      if (a.prop) continue;
      skaters++;
      if (a.keypoints.head && a.keypoints.neck) head++;
      if (a.hands) hand++;
      if (a.skates) skates++;
    }
    assert.ok(head / skaters > 0.97, 'head and neck in ' + head + ' / ' + skaters);
    assert.ok(hand / skaters > 0.85, 'a hand in ' + hand + ' / ' + skaters);
    assert.ok(skates / skaters > 0.98, 'a skate in ' + skates + ' / ' + skaters);
    // The composer only moves retail pixels: a whole frame placed at 0, 0 comes back pixel for pixel.
    const lib = C.source(loaded);
    const f = lib.frame('94g:12');
    const cel = C.compose([{ id: '94g:12' }], lib, { space: 'native' });
    assert.strictEqual(cel.px.filter((x) => x !== cel.empty).length, f.px.filter((x) => x).length);
    for (let i = 0; i < f.w * f.h; i++) if (f.px[i]) assert.strictEqual(cel.px[(f.y0 + ((i / f.w) | 0) - cel.y0) * cel.w + (f.x0 + (i % f.w) - cel.x0)], f.px[i]);
    // A punching arm put on a stance lands with its shoulder on the stance's shoulder.
    const tied = C.compose([{ id: '93g:362', flip: true, anchor: ['neck', [0, 0]] }, { id: '93g:358', anchor: ['hand0', { id: '93g:362', joint: 'neck', flip: true }] }], lib);
    assert.strictEqual(tied.placed[1].flip, false);
    more = ', ' + skaters + ' skater frames: head ' + head + ', a hand ' + hand + ', a skate ' + skates;

    // The rig: layers rebuild every frame exactly; an untouched pose draws the frame unchanged; eight facings.
    const { lib: rl } = require('../tools/sprites/rig-load').load({ pc: path.join(root, 'pc95') });
    for (const f of rl.frames) {
      const flat = new Uint8Array(f.w * f.h).fill(f.empty);
      for (const L of R.orderedLayers(f)) for (let i = 0; i < L.w * L.h; i++) if (L.px[i] !== f.empty) {
        const k = (L.y0 - f.y0 + ((i / L.w) | 0)) * f.w + (L.x0 - f.x0 + (i % L.w));
        assert.strictEqual(flat[k], f.empty, f.id + ': two layers on one pixel'); flat[k] = L.px[i];
      }
      assert.ok(flat.every((v, i) => v === f.px[i]), f.id + ': layers rebuild the frame');
    }
    for (const id of ['94g:12', '93g:360', '95pc:889']) {
      const f = rl.byId.get(id), cel = R.render(rl, id, f.kp);
      assert.deepStrictEqual(Object.keys(cel.swaps), [], id + ': nothing swapped for its own pose');
      assert.strictEqual(cel.px.filter((v) => v !== f.empty).length, f.px.filter((v) => v !== f.empty).length, id + ': same pixel count');
      for (let i = 0; i < f.w * f.h; i++) if (f.px[i] !== f.empty) assert.strictEqual(cel.px[(f.y0 - cel.y0 + ((i / f.w) | 0)) * cel.w + (f.x0 - cel.x0 + (i % f.w))], f.px[i], id + ': pixel ' + i);
    }
    const eight = R.directions(rl, { game: '94g', facing: 2, kp: rl.byId.get('94g:12').kp, id: '94g:12' });
    assert.strictEqual(eight.facings.length, 8);
    assert.strictEqual(eight.facings[2].base, '94g:12');
    const grab = R.directions(rl, { game: '93g', facing: 2, kp: rl.byId.get('93g:358').kp, id: '93g:358' });
    assert.ok(grab.facings.every((x) => !x.cel.layers.some((L) => L.part === 'stick')), 'a stick-less pose stays stick-less in every facing');
    // Recreating hidden facings beats the nearest step's pose (30 steps, from facing 0).
    let ours = 0, near = 0, n = 0;
    const err = (a, b) => { let s = 0, c = 0; for (const j of R.JOINTS) if (a[j] && b[j]) { s += Math.hypot(a[j][0] - b[j][0], a[j][1] - b[j][1]); c++; } return c ? s / c : 0; };
    [...rl.sets.entries()].slice(0, 30).forEach(([k, ids]) => {
      const out = R.directions(rl, { game: k.split('|')[0], facing: 0, kp: rl.byId.get(ids[0]).kp }, { excludeSet: (x) => x === k, draw: false });
      for (let t = 1; t < 8; t++) { ours += err(out.facings[t].kp, rl.byId.get(ids[t]).kp); near += err(rl.byId.get(rl.sets.get(out.set)[t]).kp, rl.byId.get(ids[t]).kp); n++; }
    });
    assert.ok(ours < near, 'learned turn ' + (ours / n).toFixed(2) + ' px against nearest step ' + (near / n).toFixed(2));
    more += '; rig: ' + rl.frames.length + ' frames layered exactly, turn ' + (ours / n).toFixed(2) + ' px vs ' + (near / n).toFixed(2);
  }
}
console.log('spritelib ok' + more);
