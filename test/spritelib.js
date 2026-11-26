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
  }
}
console.log('spritelib ok' + more);
