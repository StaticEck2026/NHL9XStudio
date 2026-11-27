#!/usr/bin/env node
/**
 * The rig's drags on real frames (writes docs/sprite-library/demo-rig.png): for a few retail poses, the frame, then
 * each drag the animation builder offers, as lib/sprite-rig.js drag() moves the joints and render() draws them.
 *
 *   node tools/sprites/demo-rig.js [--out file.png] [--rig path/to/sprite-rig.js] [--scale 4]
 *
 * Reads library/bundle-<game>.json (node tools/build-sprite-layers.js). --rig draws with another copy of the rig (to
 * compare against an older one; an older rig without drag() gets the joints moved as the old builder moved them).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Canvas } = require('../dropstick/raster');

const ROOT = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const R = require(path.resolve(opt('--rig', path.join(ROOT, 'lib', 'sprite-rig.js'))));
const SC = Number(opt('--scale', 4));
const out = path.resolve(opt('--out', path.join(ROOT, 'docs', 'sprite-library', 'demo-rig.png')));

const libs = {};
function lib(game) {
  if (libs[game]) return libs[game];
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'library', 'bundle-' + game + '.json'), 'utf8'));
  const b64 = (s) => Uint8Array.from(Buffer.from(s, 'base64'));
  const frames = d.frames.map((f) => Object.assign({}, f, { game, px: b64(f.px), part: b64(f.part), empty: d.empty }));
  return (libs[game] = { lib: R.index(frames), palette: d.palette });
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const turn = (p, about, deg) => { const a = deg * Math.PI / 180, v = sub(p, about); return add(about, [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)]); };
/** The old builder's drag: the joint goes where it is put, a root carries what hangs from it. */
function oldDrag(kp0, j, to) {
  const kp = JSON.parse(JSON.stringify(kp0)), d = sub(to, kp[j]);
  kp[j] = to;
  const carry = { shoulder0: ['elbow0', 'hand0'], shoulder1: ['elbow1', 'hand1'], hip0: ['knee0', 'skate0'], hip1: ['knee1', 'skate1'], stickButt: ['stickBlade'], head: ['neck'] }[j] || [];
  for (const c of carry) if (kp[c]) kp[c] = add(kp[c], d);
  return kp;
}
const topHand = (kp) => [0, 1].filter((k) => kp['hand' + k]).sort((a, b) => Math.hypot(...sub(kp['hand' + a], kp.stickButt)) - Math.hypot(...sub(kp['hand' + b], kp.stickButt)))[0];

/** Drags: [label, (kp) => [joint, to]]. */
const DRAGS = [
  ['BLADE TO THE ICE', (kp) => ['stickBlade', add(kp.stickButt, [9, 12])]],
  ['BLADE OUT WIDE', (kp) => ['stickBlade', turn(kp.stickBlade, kp.stickButt, -35)]],
  ['TOP HAND UP', (kp) => ['hand' + topHand(kp), add(kp['hand' + topHand(kp)], [-1, -5])]],
  ['LEAN FORWARD', (kp) => { const s = kp.shoulder0 ? 'shoulder0' : 'shoulder1'; return [s, turn(kp[s], kp.hipMid, kp.head[0] > kp.hipMid[0] ? 14 : -14)]; }],
  ['CROUCH', (kp) => [kp.hip0 ? 'hip0' : 'hip1', add(kp.hip0 || kp.hip1, [0, 3])]],
  ['HEAD UP', (kp) => ['head', turn(kp.head, kp.neck, kp.head[0] > kp.neck[0] ? -25 : 25)]],
  ['STICK MOVED WHOLE', (kp) => ['stickMid', add([(kp.stickButt[0] + kp.stickBlade[0]) / 2, (kp.stickButt[1] + kp.stickBlade[1]) / 2], [-3, 3])]],
  ['OTHER SKATE OUT', (kp, syn) => { const s = syn.find((j) => /^skate/.test(j)) || 'skate1'; return [s, add(kp[s], [kp.head[0] > kp.hipMid[0] ? -5 : 5, 1])]; }]
];
const POSES = opt('--poses', '94g:347,94g:12,93g:358,95pc:347,95pc:12').split(',');
const ONLY = opt('--drags', null);

const CW = 64, CH = 60;
const COLS = ONLY ? ONLY.split(',').length + 1 : DRAGS.length + 1;
const cv = new Canvas(COLS * CW * SC + 20, POSES.length * (CH * SC + 22) + 40, [244, 246, 248]);
cv.text(10, 8, (R.drag ? 'RIG DRAGS: JOINTS MOVED AS A BODY, LIMBS TURNED BY ROTSPRITE, STICK HELD' : 'OLD RIG: JOINT MOVED, NEAREST RETAIL LIMB SWAPPED IN').toUpperCase(), [24, 32, 48], 2);
POSES.forEach((id, r) => {
  const { lib: L, palette } = lib(id.split(':')[0]);
  const f = L.byId.get(id);
  const y = 32 + r * (CH * SC + 22);
  const cels = [['RETAIL ' + id, { x0: f.x0, y0: f.y0, w: f.w, h: f.h, px: f.px }, f.kp]];
  const full = R.fullSkeleton ? R.fullSkeleton(L, f) : { kp: f.kp, synthetic: [] };
  for (const [label, how] of DRAGS) {
    if ((label.startsWith('BLADE') || label.startsWith('TOP') || label.startsWith('STICK')) && !f.kp.stickButt) continue;
    if (ONLY && !ONLY.split(',').some((w) => label.includes(w))) continue;
    const [j, to] = how(full.kp, full.synthetic);
    if (!full.kp[j] && j !== 'stickMid') continue;
    const kp = R.drag ? R.drag(full.kp, j, to, R.rigOf(L, full.kp, f.game)) : oldDrag(full.kp, j, to);
    const cel = R.render(L, id, kp, { facing: f.facing });
    cels.push([label, cel, cel.kp || kp]);
  }
  cels.forEach(([label, cel], c) => {
    const x = 10 + c * CW * SC;
    cv.fill(x, y, CW * SC - 6, CH * SC, [216, 236, 244]);
    const ox = x + 32 * SC, oy = y + 46 * SC;
    for (let i = 0; i < cel.w * cel.h; i++) {
      const v = cel.px[i];
      if (v === f.empty) continue;
      cv.fill(ox + (cel.x0 + (i % cel.w)) * SC, oy + (cel.y0 + ((i / cel.w) | 0)) * SC, SC, SC, palette[v]);
    }
    cv.text(x + 2, y + CH * SC + 4, label, [24, 32, 48], 1);
  });
});
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, cv.png());
console.log('wrote', path.relative(process.cwd(), out));
