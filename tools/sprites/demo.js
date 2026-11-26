#!/usr/bin/env node
/**
 * What the sprite library is for, shown on real frames (writes docs/sprite-library/demo-*.png).
 *
 *   node tools/sprites/demo.js [--pc pc95]           (after node tools/build-sprite-library.js)
 *
 *  - demo-retrieval.png: for a few poses, the nearest poses anywhere else in the three sheets (other animations,
 *    other games, mirrored where the Genesis flip would do), by skeleton (tools/sprites/pose.js).
 *  - demo-compose.png: two frames that exist in no game, put together from library parts by their joints
 *    (tools/sprites/compose.js): a fight stance throwing the arm of a punch, and two players tied up, one gripping
 *    the other's jersey. Shown in each source's own Genesis colours, and in PC jersey colours.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const F = require('./frames');
const P = require('./pose');
const C = require('./compose');
const S = require('../pcupgrade/sources');
const J = require('../../lib/pc-jersey');
const { Canvas } = require('../dropstick/raster');

const ROOT = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const docs = path.join(ROOT, 'docs', 'sprite-library');
const loaded = F.loadAll({ pc: opt('--pc') });
const lib = C.source(loaded);
const idx = P.open(path.join(ROOT, opt('--lib', 'library')));
const pcJersey = S.loadPc(opt('--pc')).jersey;
const pcPal = (code, side) => J.spritePalette(pcJersey[side], pcJersey[side].teams.findIndex((t) => t.code === code), S.pcBase(), side);
const INK = [24, 32, 48], DIM = [96, 112, 128], ICE = [216, 236, 244], PAPER = [244, 246, 248];
const SC = 3;

function drawFrame(cv, f, ox, oy, pal, flip, space) {
  const empty = space === 'zones' || f.space === 'pc' ? 255 : 0;
  const src = space === 'zones' ? f.label : f.px;
  for (let i = 0; i < f.w * f.h; i++) {
    const v = src[i]; if (v === empty) continue;
    const x = f.x0 + (i % f.w), y = f.y0 + ((i / f.w) | 0);
    cv.fill(ox + (flip ? -x - 1 : x) * SC, oy + y * SC, SC, SC, pal[v]);
  }
}
const palOf = (f) => loaded.palettes[f.game];

// ---- Retrieval ---------------------------------------------------------------------------------------------------
{
  const queries = ['93g:358', '95pc:889', '94g:647', '95pc:940'];
  const K = 6, CW = 70, CH = 62;
  const cv = new Canvas((K + 1) * CW * SC + 40, queries.length * (CH * SC + 30) + 70, PAPER);
  cv.text(14, 12, 'NEAREST POSES ACROSS ALL THREE SHEETS', INK, 2);
  cv.text(14, 36, 'LEFT: THE QUERY FRAME. RIGHT: THE CLOSEST SKELETONS IN OTHER ANIMATIONS (MIRRORED WHERE THE GENESIS SPRITE FLIP WOULD DO), BY POSE DISTANCE.', DIM, 1);
  queries.forEach((q, r) => {
    const qf = idx.frame(q);
    const hits = idx.nearest(qf, { k: 40, mirror: true }).filter((h) => idx.frame(h.id).group !== qf.group).slice(0, K);
    const y = 60 + r * (CH * SC + 30);
    [{ id: q, d: 0, mirrored: false, query: true }].concat(hits).forEach((h, c) => {
      const x = 14 + c * CW * SC + (c ? 20 : 0);
      cv.fill(x, y, CW * SC - 6, CH * SC, c ? ICE : [255, 240, 200]);
      const f = lib.frame(h.id);
      drawFrame(cv, f, x + (CW / 2) * SC, y + 44 * SC, palOf(f), h.mirrored, 'native');
      cv.text(x + 2, y + CH * SC + 4, (h.query ? 'QUERY ' : '') + h.id + ' ' + (idx.frame(h.id).group || '').replace('SPF', '').toUpperCase(), INK, 1);
      if (!h.query) cv.text(x + 2, y + CH * SC + 15, 'D ' + h.d.toFixed(3) + (h.mirrored ? ' MIRRORED' : ''), DIM, 1);
    });
  });
  fs.writeFileSync(path.join(docs, 'demo-retrieval.png'), cv.png());
}

// ---- Composition ---------------------------------------------------------------------------------------------------
{
  const front = (id) => { const k = lib.anatomy(id).keypoints; return (k.hand1 && (!k.hand0 || k.hand1[0] > k.hand0[0])) ? 1 : 0; };
  const BODY = ['head', 'torso', 'leg0', 'leg1', 'skate0', 'skate1', 'shadow'];
  // 1. A fight stance (357) throwing the extended arm of the high punch (360), joined at the shoulder.
  const s = front('93g:357'), p = front('93g:360');
  const keep = BODY.concat(['arm' + (1 - s), 'hand' + (1 - s)]);
  const swap = [{ id: '93g:357', parts: keep }, { id: '93g:360', parts: ['arm' + p, 'hand' + p], anchor: ['shoulder' + p, { id: '93g:357', joint: 'shoulder' + s }] }];
  // 2. Two players tied up: the grab (358) has its fist on the chest of a mirrored stance (362) placed by the joints.
  const g = front('93g:358');
  const tussle = [
    { id: '93g:362', flip: true, anchor: ['neck', [0, 0]] },
    { id: '93g:358', anchor: ['hand' + g, { id: '93g:362', joint: 'neck', flip: true }], nudge: [-1, 4] }
  ];
  const builds = [
    { title: 'STANCE + PUNCHING ARM', note: '93G 357 BODY, 360 ARM AT THE SHOULDER', layers: swap, sources: ['93g:357', '93g:360'] },
    { title: 'JERSEY GRAB', note: '93G 358 GRIPS A MIRRORED 362 BY THE CHEST', layers: tussle, sources: ['93g:362', '93g:358'] }
  ];
  const CW = 90, CH = 70;
  const cv = new Canvas(4 * CW * SC + 60, builds.length * (CH * SC + 40) + 70, PAPER);
  cv.text(14, 12, 'NEW FRAMES FROM LIBRARY PARTS', INK, 2);
  cv.text(14, 36, 'EVERY PIXEL IS A RETAIL PIXEL, MOVED (AND MIRRORED) BY THE SKELETON JOINTS. NO PIXEL REDRAWN.', DIM, 1);
  builds.forEach((b, r) => {
    const y = 60 + r * (CH * SC + 40);
    // Sources, the composite in Genesis colours, the composite in PC colours (two teams for the tussle).
    b.sources.forEach((id, c) => {
      const x = 14 + c * CW * SC;
      cv.fill(x, y, CW * SC - 6, CH * SC, ICE);
      drawFrame(cv, lib.frame(id), x + (CW / 2) * SC, y + 52 * SC, palOf(lib.frame(id)), false, 'native');
      cv.text(x + 2, y + CH * SC + 4, 'SOURCE ' + id, DIM, 1);
    });
    const native = C.compose(b.layers, lib, { space: 'native' });
    const zones = C.compose(b.layers, lib, { space: 'zones' });
    const pals = [pcPal('bos', 'home'), pcPal('mtl', 'away')];
    [[native, 'GENESIS COLOURS', () => loaded.palettes['93g']], [zones, 'PC COLOURS', (o) => pals[b.layers.length > 1 && o === 0 && b.title === 'JERSEY GRAB' ? 1 : 0]]].forEach(([cel, label, palFor], c) => {
      const x = 14 + (2 + c) * CW * SC + 20;
      cv.fill(x, y, CW * SC - 6, CH * SC, [255, 240, 200]);
      const ox = x + (CW / 2) * SC - Math.round((cel.x0 + cel.w / 2) * SC), oy = y + (CH / 2) * SC - Math.round((cel.y0 + cel.h / 2) * SC);
      for (let i = 0; i < cel.w * cel.h; i++) {
        const v = cel.px[i]; if (v === cel.empty) continue;
        cv.fill(ox + (cel.x0 + (i % cel.w)) * SC, oy + (cel.y0 + ((i / cel.w) | 0)) * SC, SC, SC, palFor(cel.owner[i])[v]);
      }
      cv.text(x + 2, y + CH * SC + 4, b.title + ': ' + label, INK, 1);
      if (!c) cv.text(x + 2, y + CH * SC + 15, b.note, DIM, 1);
    });
  });
  fs.writeFileSync(path.join(docs, 'demo-compose.png'), cv.png());
}
console.log('wrote', path.relative(ROOT, docs) + '/demo-retrieval.png, demo-compose.png');
