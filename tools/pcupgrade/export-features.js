#!/usr/bin/env node
/**
 * Training data for the learned zone and shade model (tools/pcupgrade/train_model.py -> model.json).
 *
 *   node tools/pcupgrade/export-features.js [--rom94 file|dir] [--pc dir] > features.json
 *
 * Pairs every NHL 94 Genesis skater frame (1-352) and the check injury (641-652) with the PC sheet's own version
 * (the same number; 633-644 for the injury), lines them up, and for every Genesis team pixel the PC frame paints
 * with a jersey zone writes: frame, the segmenter's geometry features (segment().feature), the PC zone family and
 * shade. Frame pairs that overlap less than 80% are left out. Needs the NHL 94 ROM and an NHL 94 PC or 95 PC folder.
 */
'use strict';

const S = require('./sources');
const Zs = require('./zones');
const { align } = require('./transfer');
const { segment } = require('./segment');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const rom = S.load94(opt('--rom94'));
const pc = S.loadPc(opt('--pc'));
if (!rom || !pc) { console.error('needs the NHL 94 Genesis ROM and an NHL 94 PC or 95 PC folder'); process.exit(1); }

const pairs = [];
for (let n = 1; n <= 352; n++) pairs.push([n, n]);
for (let n = 641; n <= 652; n++) pairs.push([n, S.TOPC(n)]);
const rows = [];
let used = 0;
for (const [gn, pn] of pairs) {
  const g = rom.frame(gn), p = pc.frame(pn);
  if (!g || !p) continue;
  const a = align(g, p, 6);
  if (a.overlap < 0.8) continue;
  used++;
  const s = segment({ w: g.w, h: g.h, px: g.px }, { model: null });
  for (let i = 0; i < g.px.length; i++) {
    if (!Zs.BY_INDEX.get(s.out[i])) continue;
    const x = i % g.w, y = (i / g.w) | 0, X = x + a.ox, Y = y + a.oy;
    if (X < 0 || Y < 0 || X >= p.w || Y >= p.h) continue;
    const z = Zs.BY_INDEX.get(p.px[Y * p.w + X]);
    if (!z) continue;
    rows.push([gn, s.feature(x, y).map((v) => +v.toFixed(4)), z.family, z.shade]);
  }
}
process.stdout.write(JSON.stringify({ pcGame: pc.game, framePairs: used, rows }));
console.error('frame pairs', used, 'pixels', rows.length);
