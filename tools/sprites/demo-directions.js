#!/usr/bin/env node
/**
 * docs/sprite-library/demo-directions.png: eight facings from one, by lib/sprite-rig.js directions().
 *   - Steps the games do draw in all eight facings, hidden from the search: recreated from facing 2, the real frames
 *     underneath for comparison.
 *   - A frame drawn in one facing only (NHLPA 93's jersey grab, 358): all eight facings made from it.
 *   node tools/sprites/demo-directions.js [--pc folder]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('../../lib/sprite-rig');
const { Canvas } = require('../dropstick/raster');
const args = process.argv.slice(2);
const pcAt = args.indexOf('--pc');
const { lib, palettes } = require('./rig-load').load({ pc: pcAt >= 0 ? args[pcAt + 1] : undefined });
const SC = 3, CW = 64, CH = 60, INK = [24, 32, 48], DIM = [96, 112, 128];
const NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const rows = [];
for (const [id, label] of [['94g:12', 'NHL 94 SKATING (HIDDEN)'], ['93g:186', 'NHLPA 93 CELEBRATE (HIDDEN)'], ['95pc:226', 'NHL 95 PC HIP CHECK (HIDDEN)']]) {
  const f = lib.byId.get(id), key = f.game + '|' + f.group + '|' + f.step;
  const out = R.directions(lib, { game: f.game, facing: f.facing, kp: f.kp, id: f.id }, { excludeSet: (k) => k === key, exclude: (g) => g.game === f.game && g.group === f.group && g.step === f.step });
  rows.push({ label: label + ' FROM FACING ' + NAMES[f.facing], game: f.game, cels: out.facings.map((x) => x.cel), note: 'NEAREST STEP ' + out.set.split('|').slice(1).join(' ') });
  rows.push({ label: 'THE REAL FRAMES', game: f.game, cels: lib.sets.get(key).map((i) => lib.byId.get(i)), real: true });
}
{
  const f = lib.byId.get('93g:358');
  const out = R.directions(lib, { game: '93g', facing: 2, kp: f.kp, id: f.id });
  rows.push({ label: 'NHLPA 93 JERSEY GRAB (358, ONE FACING ONLY), AS FACING E', game: '93g', cels: out.facings.map((x) => x.cel), note: 'NEAREST STEP ' + out.set.split('|').slice(1).join(' ') });
}
const cv = new Canvas(8 * CW * SC + 40, rows.length * (CH * SC + 34) + 60, [244, 246, 248]);
cv.text(14, 12, 'EIGHT FACINGS FROM ONE', INK, 2);
cv.text(14, 34, 'EACH FACING IS A RETAIL FRAME OF THAT FACING WITH LIMBS SWAPPED FOR RETAIL LIMBS OF THAT FACING, POSED BY THE LEARNED TURN. NO PIXEL REDRAWN.', DIM, 1);
rows.forEach((r, ri) => {
  const y = 56 + ri * (CH * SC + 34);
  cv.text(14, y, r.label + (r.note ? '   (' + r.note.toUpperCase() + ')' : ''), r.real ? DIM : INK, 1);
  r.cels.forEach((c, t) => {
    const x = 14 + t * CW * SC;
    cv.fill(x, y + 12, CW * SC - 6, CH * SC, r.real ? [228, 236, 240] : [216, 236, 244]);
    const pal = palettes[r.game];
    for (let i = 0; i < c.w * c.h; i++) {
      const v = c.px[i]; if (v === c.empty) continue;
      cv.fill(x + (CW / 2 + c.x0 + (i % c.w)) * SC, y + 12 + (44 + c.y0 + ((i / c.w) | 0)) * SC, SC, SC, pal[v]);
    }
    cv.text(x + 2, y + 14, NAMES[t], DIM, 1);
  });
});
fs.writeFileSync(path.join(__dirname, '..', '..', 'docs', 'sprite-library', 'demo-directions.png'), cv.png());
console.log('wrote docs/sprite-library/demo-directions.png');
