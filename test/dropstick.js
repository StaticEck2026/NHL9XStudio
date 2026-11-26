/** The drop-stick builder (tools/dropstick): stick removal, the stick drawing, the sequence and the hardware cut. */
const assert = require('assert');
const { load } = require('../tools/dropstick/source');
const { unstick } = require('../tools/dropstick/unstick');
const { drawStick } = require('../tools/dropstick/stick');
const { build } = require('../tools/dropstick/sequence');
const { split } = require('../tools/dropstick/pieces');
const { STICK, SHADOW } = require('../tools/dropstick/cel');

const src = load(process.env.NHL94_ROM || undefined);
const S = src.spf;
assert.strictEqual(S.SPFskatewp, 1);
assert.strictEqual(S.SPFstop, 145);
assert.strictEqual(S.SPFsweep, 257);

// Stick removal: no wood left, nothing new added, only colours the frame already had.
for (const n of [6, 11, 21, 31, 147, 150, 158, 261, 265]) {
  const before = src.frame(n);
  const { body, stick } = unstick(before);
  const had = new Set(before.pixels().map((p) => p[2]));
  assert.ok(!body.pixels().some((p) => p[2] === STICK), 'frame ' + n + ' still has wood');
  for (const [x, y, v] of body.pixels()) {
    assert.ok(had.has(v), 'frame ' + n + ' gained colour ' + v);
    assert.ok(before.get(x, y) !== 0, 'frame ' + n + ' gained a pixel at ' + x + ',' + y);
  }
  assert.ok(stick.pixels().some((p) => p[2] === STICK), 'frame ' + n + ' had a stick');
}

// A drawn stick is wood and shadow only; flat it keeps a shadow under it, upright its shaft is a single column.
const flat = drawStick({ axis: [1, 0], length: 20, height: 24, angle: 180 }).cel;
assert.ok(flat.pixels().every((p) => p[2] === STICK || p[2] === SHADOW));
assert.ok(flat.pixels().filter((p) => p[2] === STICK).every(([x, y]) => flat.get(x, y + 1)), 'flat stick has shadow under it');
const up = drawStick({ axis: [1, 0], length: 20, height: 24, angle: 90 }).cel;
assert.strictEqual(new Set(up.pixels().filter((p) => p[2] === STICK && p[1] < -2).map((p) => p[0])).size, 1);

// The sequence: 8 facings x 15 steps; the flat stick's heel is where the sweep pose of the return facing puts its blade.
const seq = build(src);
assert.strictEqual(seq.rows.length, 8);
for (const row of seq.rows) {
  assert.strictEqual(row.cels.length, 15);
  assert.strictEqual(row.r, (row.d + 4) % 8);
  const grab = row.cels.find((c) => c.id === 'grab');
  assert.strictEqual(grab.frame, S.SPFsweep + 2 * row.r);
  const hot = src.hot(grab.frame);
  assert.deepStrictEqual([grab.at[0] + hot[0], grab.at[1] + hot[1]], row.heel);
  const reach = row.cels.find((c) => c.id === 'reach');
  assert.deepStrictEqual(reach.at, grab.at);
  assert.strictEqual(reach.stick.angle, 180);
}

// Hardware: every new body fits the retail envelope and is no bigger than the frame it came from.
for (const [n, body] of seq.bodies) {
  const cut = split(body), was = split(src.frame(n));
  assert.ok(cut.tileCount <= was.tileCount, 'body from ' + n + ' grew');
  assert.ok(cut.pieces.length <= 8 && cut.tileCount <= 21, 'body from ' + n + ' is over the retail envelope');
  for (const p of cut.pieces) assert.ok(p.w >= 1 && p.w <= 4 && p.h >= 1 && p.h <= 4 && p.tiles.length === p.w * p.h);
}
console.log('dropstick ok (' + seq.bodies.size + ' stickless bodies from ' + src.game + ')');
