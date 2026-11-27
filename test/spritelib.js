/** The skater sprite library (tools/sprites): pose maths always; with the ROMs in roms/ and the NHL 95 PC files in
 *  the NHL 95 PC CD image (or pc95/), the anatomy of every frame and the composer. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const P = require('../tools/sprites/pose');

// Pose maths: a pose is at distance 0 from itself, mirroring twice gives it back, and limbs swap when mirrored.
const kp = { head: [2, -26], neck: [1, -21], shoulder0: [-3, -19], hand0: [-8, -14], shoulder1: [5, -20], hand1: [12, -18],
  hip0: [-2, -11], hip1: [3, -11], hipMid: [0.5, -11], knee0: [-3, -5], knee1: [4, -5], skate0: [-4, 1], skate1: [5, 1] };
// Pixel art (lib/pixel-art.js): turning a sprite never makes a colour, moving it copies it exactly, lines step evenly.
{
  const PA = require('../lib/pixel-art');
  const L = { x0: -3, y0: -6, w: 6, h: 8, px: Uint8Array.from({ length: 48 }, (_, i) => ((i * 7) % 5 ? 10 + (i % 3) : 0)) };
  const moved = PA.rotate(L, 0, 0, [0, 0], [2, -1]);
  assert.deepStrictEqual([moved.x0, moved.y0, [...moved.px].join()], [-1, -7, [...L.px].join()]);
  for (const a of [0.2, -0.5, 1.1]) for (const v of PA.rotate(L, 0, a, [0, 0], [0, 0]).px) assert.ok(v === 0 || [10, 11, 12].includes(v), 'rotation keeps the palette');
  for (const [dx, dy] of [[9, 12], [12, 4], [-3, -14], [10, 0], [7, -7]]) {
    const { pts, dir } = PA.cleanLine([0.5, 0.5], dx, dy, 14);
    const runs = []; let run = 1;
    for (let i = 1; i < pts.length; i++) {
      assert.ok(Math.max(Math.abs(pts[i][0] - pts[i - 1][0]), Math.abs(pts[i][1] - pts[i - 1][1])) === 1, 'the line is unbroken');
      const minor = dir.xMajor ? pts[i][1] !== pts[i - 1][1] : pts[i][0] !== pts[i - 1][0];
      if (minor) { runs.push(run); run = 1; } else run++;
    }
    if (dir.b === 1) assert.ok(runs.every((r) => r === dir.a), 'runs of ' + dir.a + ': ' + runs);
  }
}
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
if (fs.existsSync(path.join(root, 'roms'))) {
  let loaded = null;
  try { loaded = require('../tools/sprites/frames').loadAll(); } catch (e) { loaded = null; }
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
    const { lib: rl } = require('../tools/sprites/rig-load').load();
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
    // Posing: the body follows a dragged joint, and the stick stays a stick in the hands.
    for (const id of ['94g:347', '94g:12', '95pc:12', '93g:12']) {
      const f = rl.byId.get(id), rig = R.rigOf(rl, f.kp, f.game), len = (k, a, b) => Math.hypot(k[a][0] - k[b][0], k[a][1] - k[b][1]);
      const arm = [0, 1].find((k) => f.kp['shoulder' + k] && f.kp['elbow' + k] && f.kp['hand' + k] && !(rig.grip && (rig.grip.top === k || (rig.grip.bottom && rig.grip.bottom.k === k))));
      if (arm != null) {
        const k = R.drag(f.kp, 'hand' + arm, [f.kp['hand' + arm][0] + 3, f.kp['hand' + arm][1] - 2], rig);
        assert.ok(Math.abs(len(k, 'shoulder' + arm, 'elbow' + arm) - len(f.kp, 'shoulder' + arm, 'elbow' + arm)) < 0.6, id + ': the upper arm keeps its length');
      }
      const head = R.drag(f.kp, 'head', [f.kp.head[0] - 6, f.kp.head[1] - 6], rig);
      assert.ok(Math.abs(len(head, 'head', 'neck') - len(f.kp, 'head', 'neck')) < 1e-6, id + ': the head turns on the neck');
      const crouch = R.drag(f.kp, f.kp.hip0 ? 'hip0' : 'hip1', [(f.kp.hip0 || f.kp.hip1)[0], (f.kp.hip0 || f.kp.hip1)[1] + 3], rig);
      for (const s of ['skate0', 'skate1']) if (f.kp[s]) assert.deepStrictEqual(crouch[s], f.kp[s], id + ': a crouch keeps the skates planted');
      if (!rig.grip || rig.grip.top == null) continue;
      const top = 'hand' + rig.grip.top;
      for (const to of [[f.kp.stickButt[0] + 9, f.kp.stickButt[1] + 12], [f.kp.stickButt[0] - 12, f.kp.stickButt[1] - 4]]) {
        const k = R.drag(f.kp, 'stickBlade', to, rig);
        assert.deepStrictEqual(k.stickButt, f.kp.stickButt, id + ': the blade swings about the top hand');
        assert.ok(Math.abs(len(k, 'stickButt', 'stickBlade') - len(f.kp, 'stickButt', 'stickBlade')) < 1e-6, id + ': the stick is rigid (blade drag)');
        const cel = R.render(rl, id, k, { facing: f.facing });
        // The stick is drawn whole: its pixels are one piece, in the game's own colours.
        const pts = [];
        for (const S of cel.layers.filter((x) => x.part === 'stick')) for (let i = 0; i < S.w * S.h; i++) if (S.px[i] !== f.empty) pts.push([S.x0 + (i % S.w), S.y0 + ((i / S.w) | 0)]);
        assert.ok(pts.length >= 6, id + ': a stick is drawn');
        const key = (p) => p[0] + ',' + p[1], all = new Set(pts.map(key)), seen = new Set([key(pts[0])]), todo = [pts[0]];
        while (todo.length) { const [x, y] = todo.pop(); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const q = key([x + dx, y + dy]); if (all.has(q) && !seen.has(q)) { seen.add(q); todo.push([x + dx, y + dy]); } } }
        assert.ok(seen.size >= all.size - 1, id + ': the stick is in one piece (' + seen.size + ' of ' + all.size + ')');
        const own = new Set(); for (const g of rl.frames) if (g.game === f.game) for (const v of g.px) own.add(v);
        for (const v of cel.px) assert.ok(own.has(v), id + ': colour ' + v + ' is one the game uses');
      }
      // The top hand carries the butt; a blade on the ice stays where it is.
      const up = R.drag(f.kp, top, [f.kp[top][0] - 1, f.kp[top][1] - 4], R.rigOf(rl, f.kp, f.game));
      assert.ok(Math.hypot(up.stickButt[0] - up[top][0] - rig.grip.buttOffset[0], up.stickButt[1] - up[top][1] - rig.grip.buttOffset[1]) < 1e-6, id + ': the butt stays in the top hand');
      if (rig.grip.bladeOnIce) assert.ok(Math.hypot(up.stickBlade[0] - f.kp.stickBlade[0], up.stickBlade[1] - f.kp.stickBlade[1]) < 1e-6, id + ': the blade stays on the ice');
      const L0 = len(f.kp, 'stickButt', 'stickBlade');
      assert.ok(Math.abs(len(up, 'stickButt', 'stickBlade') - L0) < 1e-6, id + ': the stick is rigid (hand drag)');
      // Moved whole by its middle: same length, same angle; in hand, the top hand comes along.
      const mid = [(f.kp.stickButt[0] + f.kp.stickBlade[0]) / 2 + 2, (f.kp.stickButt[1] + f.kp.stickBlade[1]) / 2 - 1];
      const moved = R.drag(f.kp, 'stickMid', mid, R.rigOf(rl, f.kp, f.game));
      assert.ok(Math.abs(len(moved, 'stickButt', 'stickBlade') - L0) < 1e-6, id + ': the stick is rigid (moved whole)');
      assert.ok(Math.abs(Math.atan2(moved.stickBlade[1] - moved.stickButt[1], moved.stickBlade[0] - moved.stickButt[0]) - Math.atan2(f.kp.stickBlade[1] - f.kp.stickButt[1], f.kp.stickBlade[0] - f.kp.stickButt[0])) < 1e-9, id + ': moved whole, not turned');
      // Let go of: the stick moves on its own and the hands stay.
      const free = R.rigOf(rl, f.kp, f.game, null, { free: true });
      const loose = R.drag(f.kp, 'stickButt', [f.kp.stickButt[0] - 4, f.kp.stickButt[1] + 3], free);
      assert.deepStrictEqual([loose.hand0, loose.hand1], [f.kp.hand0, f.kp.hand1], id + ': a free stick leaves the hands');
      assert.deepStrictEqual(loose.stickBlade, f.kp.stickBlade, id + ': a free stick swings about its blade');
      assert.ok(Math.abs(len(loose, 'stickButt', 'stickBlade') - L0) < 1e-6, id + ': the free stick is rigid');
      // Drawn as the frame's own stick turned whole: the same blade pixels (turned) and no other stick's.
      const turned = R.render(rl, id, R.drag(f.kp, 'stickBlade', [f.kp.stickButt[0] + 8, f.kp.stickButt[1] + 10], R.rigOf(rl, f.kp, f.game)), { facing: f.facing });
      if (R.stickOf(f)) assert.ok(!turned.swaps.stick && turned.layers.filter((x) => x.part === 'stick').every((x) => x.from === id), id + ': the stick is its own, turned');
    }
    // The full skeleton: both sides of every frame, the hidden joints filled in; the untouched frame draws unchanged.
    for (const id of ['94g:347', '94g:12', '95pc:12', '93g:358']) {
      const f = rl.byId.get(id), full = R.fullSkeleton(rl, f);
      for (const j of R.JOINTS) if (!/^stick/.test(j)) assert.ok(full.kp[j], id + ': ' + j + ' in the full skeleton');
      for (const j of R.JOINTS) if (f.kp[j]) assert.deepStrictEqual(full.kp[j], f.kp[j], id + ': ' + j + ' kept');
      const cel = R.render(rl, id, full.kp);
      assert.deepStrictEqual(Object.keys(cel.swaps), [], id + ': the full skeleton draws the frame as it is');
      for (let i = 0; i < f.w * f.h; i++) if (f.px[i] !== f.empty) assert.strictEqual(cel.px[(f.y0 - cel.y0 + ((i / f.w) | 0)) * cel.w + (f.x0 - cel.x0 + (i % f.w))], f.px[i], id + ': pixel ' + i);
      // A hidden leg moves: the skate goes there and the lower body is redrawn.
      const hid = full.synthetic.find((j) => /^skate/.test(j));
      if (hid) {
        const k = R.drag(full.kp, hid, [full.kp[hid][0] + 3, full.kp[hid][1]], R.rigOf(rl, full.kp, f.game));
        const cel = R.render(rl, id, k), leg = 'leg' + hid.slice(-1);
        assert.ok(cel.swaps[leg] && cel.swaps[leg].turn.some(Boolean), id + ': the hidden leg turns on its own');
        assert.ok(Math.hypot(cel.kp[hid][0] - k[hid][0], cel.kp[hid][1] - k[hid][1]) < 2.5, id + ': its skate goes where it was put');
        for (const s of ['skate0', 'skate1']) if (s !== hid) assert.ok(Math.hypot(cel.kp[s][0] - full.kp[s][0], cel.kp[s][1] - full.kp[s][1]) < 1e-6, id + ': the other skate stays');
      }
    }
    more += '; rig: ' + rl.frames.length + ' frames layered exactly, turn ' + (ours / n).toFixed(2) + ' px vs ' + (near / n).toFixed(2);
  }
}
console.log('spritelib ok' + more);
