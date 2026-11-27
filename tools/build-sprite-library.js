#!/usr/bin/env node
/**
 * The skater sprite library, for building new animations out of the retail art.
 *
 *   node tools/build-sprite-library.js [--pc folder] [--out library] [--docs docs/sprite-library]
 *
 * Reads every skater frame of the NHL 94 and NHLPA 93 Genesis sheets and the NHL 95 PC sheet (tools/sprites/frames.js;
 * no NHL 92 data), gives each pixel a body part and each frame a skeleton (tools/sprites/anatomy.js), and writes:
 *
 *   library/ (git-ignored: it is the games' art, rebuilt from your own files)
 *     frames.json               every frame: source, SPF group, facing, step, size, origin, keypoints, part counts
 *     frames/<id>.png           the frame's own pixels (Genesis: palette line * 16 + colour; PC: PC sprite indices),
 *                               with a Boston home palette to look at
 *     parts/<id>.png            the part map: pixel value = part number (frames.json lists them), 255 empty
 *     zones/<id>.png            PC sprite index of every pixel (Genesis frames: the transferred / modelled zones)
 *     cut/<id>/<part>.png       each part on its own, cropped, with cut/<id>/parts.json: box and the joints it carries
 *   docs/sprite-library/
 *     skeletons.json            the keypoints and facings only (no pixels)
 *     overview-*.png            skeleton overlays by group, to check the labelling at a glance
 */
'use strict';

const fs = require('fs');
const path = require('path');
const F = require('./sprites/frames');
const A = require('./sprites/anatomy');
const Img = require('../lib/indexed-image');
const { Canvas } = require('./dropstick/raster');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const lib = path.resolve(ROOT, opt('--out', 'library'));
const docs = path.resolve(ROOT, opt('--docs', path.join('docs', 'sprite-library')));

const { frames, palettes, sources } = F.loadAll({ pc: opt('--pc'), rom93: opt('--rom93'), rom94: opt('--rom94') });
for (const d of ['frames', 'parts', 'zones', 'cut']) fs.mkdirSync(path.join(lib, d), { recursive: true });
fs.mkdirSync(docs, { recursive: true });

const PART_NO = Object.fromEntries(A.PARTS.map((p, i) => [p, i]));
const PART_PAL = [[250, 140, 20], [250, 220, 60], [230, 60, 60], [160, 30, 90], [40, 40, 40], [90, 40, 60], [60, 200, 60],
  [20, 120, 60], [0, 0, 0], [60, 60, 90], [170, 110, 60], [150, 200, 230], [200, 200, 200]];
const fileId = (id) => id.replace(':', '-');
const png = (file, w, h, px, pal, transparent) => fs.writeFileSync(file, Buffer.from(Img.encodePng8(w, h, px, pal, { transparent })));

/** Joints each part carries (the anchors to put it back in place). */
const ANCHORS = { head: ['head', 'neck'], torso: ['neck', 'shoulder0', 'shoulder1', 'hip0', 'hip1', 'hipMid'],
  arm0: ['shoulder0', 'elbow0', 'hand0'], arm1: ['shoulder1', 'elbow1', 'hand1'], hand0: ['hand0'], hand1: ['hand1'],
  leg0: ['hip0', 'knee0', 'skate0'], leg1: ['hip1', 'knee1', 'skate1'], skate0: ['skate0'], skate1: ['skate1'],
  stick: ['stickButt', 'stickBlade'], shadow: [], other: [] };

const out = [];
for (const f of frames) {
  const a = A.analyse(f);
  const id = fileId(f.id);
  const pal = palettes[f.game];
  png(path.join(lib, 'frames', id + '.png'), f.w, f.h, f.px, pal, f.space === 'pc' ? [255] : [0, 16, 32, 48]);
  png(path.join(lib, 'parts', id + '.png'), f.w, f.h, Uint8Array.from(a.part, (p) => (p ? PART_NO[p] : 255)), PART_PAL.concat([[255, 255, 255]]), [255]);
  png(path.join(lib, 'zones', id + '.png'), f.w, f.h, Uint8Array.from(f.label), palettes['95pc'], [255]);
  // Each part cropped to itself.
  const cuts = {};
  fs.mkdirSync(path.join(lib, 'cut', id), { recursive: true });
  for (const p of A.PARTS) {
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    a.part.forEach((q, i) => { if (q !== p) return; const x = i % f.w, y = (i / f.w) | 0; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); });
    if (maxX < 0) continue;
    const w = maxX - minX + 1, h = maxY - minY + 1, px = new Uint8Array(w * h).fill(f.space === 'pc' ? 255 : 0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (minY + y) * f.w + minX + x; if (a.part[i] === p) px[y * w + x] = f.px[i]; }
    png(path.join(lib, 'cut', id, p + '.png'), w, h, px, pal, f.space === 'pc' ? [255] : [0, 16, 32, 48]);
    const joints = {};
    for (const j of ANCHORS[p]) if (a.keypoints[j]) joints[j] = a.keypoints[j];
    cuts[p] = { x0: f.x0 + minX, y0: f.y0 + minY, w, h, pixels: a.counts[p], joints };
  }
  fs.writeFileSync(path.join(lib, 'cut', id, 'parts.json'), JSON.stringify(cuts));
  out.push({ id: f.id, game: f.game, n: f.n, group: f.group, facing: f.facing, step: f.step, space: f.space, w: f.w, h: f.h, x0: f.x0, y0: f.y0,
    labelSource: f.labelSource, sameAs: f.sameAs || null, prop: a.prop, hands: a.hands, skates: a.skates, counts: a.counts, keypoints: a.keypoints });
}
const meta = { sources, parts: A.PARTS, partColours: PART_PAL, spaces: { genesis: 'palette line * 16 + colour, 0 empty', pc: 'NHL 94/95 PC sprite index, 255 empty' }, frames: out };
fs.writeFileSync(path.join(lib, 'frames.json'), JSON.stringify(meta));
fs.writeFileSync(path.join(docs, 'skeletons.json'), JSON.stringify({ sources, frames: out.map((f) => ({ id: f.id, group: f.group, facing: f.facing, step: f.step, prop: f.prop, labelSource: f.labelSource, keypoints: f.keypoints })) }));

// ---- Overview sheets: every group, frames with their part colours and skeletons --------------------------------
const BONES = [['head', 'neck'], ['neck', 'shoulder0'], ['neck', 'shoulder1'], ['shoulder0', 'elbow0'], ['elbow0', 'hand0'], ['shoulder1', 'elbow1'],
  ['elbow1', 'hand1'], ['neck', 'hipMid'], ['hipMid', 'hip0'], ['hipMid', 'hip1'], ['hip0', 'knee0'], ['knee0', 'skate0'], ['hip1', 'knee1'],
  ['knee1', 'skate1'], ['stickButt', 'stickBlade']];
function line(cv, a, b, c) {
  const n = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))) || 1;
  for (let i = 0; i <= n; i++) cv.fill(Math.round(a[0] + (b[0] - a[0]) * i / n) - 1, Math.round(a[1] + (b[1] - a[1]) * i / n) - 1, 3, 3, c);
}
const SC = 3, CW = 72, CH = 64, PER = 16;
const byGame = { '94g': 'NHL 94 GENESIS', '93g': 'NHLPA 93 GENESIS (WHERE IT DIFFERS FROM 94)', '95pc': 'NHL 95 PC' };
for (const game of Object.keys(byGame)) {
  const list = out.filter((f) => f.game === game);
  const rows = Math.ceil(list.length / PER);
  const cv = new Canvas(PER * CW * SC + 20, rows * (CH * SC + 14) + 60, [255, 255, 255]);
  cv.text(10, 10, byGame[game] + ': ' + list.length + ' FRAMES, BODY PARTS AND SKELETONS', [24, 32, 48], 2);
  cv.text(10, 34, 'ORANGE HEAD, YELLOW TORSO, REDS ARMS, GREENS LEGS, DARK HANDS AND SKATES, BROWN STICK, BLUE SHADOW. BLUE LINES: SKELETON, MAGENTA: STICK.', [96, 112, 128], 1);
  list.forEach((f, k) => {
    const bx = (k % PER) * CW * SC + 10, by = Math.floor(k / PER) * (CH * SC + 14) + 50;
    const ox = bx + (CW / 2) * SC, oy = by + 12 + 40 * SC;
    const a = frames.find((x) => x.id === f.id);
    const parts = A.analyse(a).part;
    parts.forEach((p, i) => { if (p) cv.fill(ox + (f.x0 + (i % f.w)) * SC, oy + (f.y0 + ((i / f.w) | 0)) * SC, SC - 1, SC - 1, PART_PAL[PART_NO[p]]); });
    const P = (j) => (f.keypoints[j] ? [ox + f.keypoints[j][0] * SC, oy + f.keypoints[j][1] * SC] : null);
    for (const [j1, j2] of BONES) if (P(j1) && P(j2)) line(cv, P(j1), P(j2), j1 === 'stickButt' ? [220, 0, 220] : [0, 80, 255]);
    cv.text(bx, by, f.id.split(':')[1] + ' ' + (f.group || '').replace(/^SPF/, '').slice(0, 9).toUpperCase(), [24, 32, 48], 1);
  });
  fs.writeFileSync(path.join(docs, 'overview-' + game + '.png'), cv.png());
}

const stat = { frames: out.length, props: out.filter((f) => f.prop).length, byGame: {}, labelSource: {}, bothHands: 0, bothSkates: 0, stick: 0 };
for (const f of out) {
  stat.byGame[f.game] = (stat.byGame[f.game] || 0) + 1;
  const ls = f.labelSource.split(' ')[0]; stat.labelSource[ls] = (stat.labelSource[ls] || 0) + 1;
  if (f.prop) continue;
  if (f.hands === 2) stat.bothHands++;
  if (f.skates === 2) stat.bothSkates++;
  if (f.keypoints.stickBlade) stat.stick++;
}
fs.writeFileSync(path.join(docs, 'stats.json'), JSON.stringify(stat, null, 1));
console.log(JSON.stringify(stat, null, 1));
