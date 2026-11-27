#!/usr/bin/env node
/**
 * NHL 94 (Genesis) skater style reference sheets: the look every new or upgraded frame has to match.
 *
 *   node tools/build-style-sheets.js [--out docs/sprite-style/nhl94] [--teams bos:home,mtl:away,chi:home]
 *
 * Measures the retail NHL 94 skater frames (the ROM in roms/, read by tools/sprites/rig-load.js; no NHL 92 data)
 * and writes, at 1x (to hand to an image tool as a reference) and enlarged (to read):
 *   turnaround.png      the reference pose (SPFskate step 0) in all eight facings, for each team, 1x and 6x
 *   turnaround-1x.png   the same at game size only, one row per team (a style reference image)
 *   colour-roles.png    the skater palette line: what each of its 15 colours is for, each team's colours, and the
 *                       eight facings painted by role
 *   jersey-zones.png    the eight facings painted by PC jersey zone (helmet, yoke bands, sleeve stripes, waist
 *                       bands, pants, socks...): where each stripe and band sits
 *   helmet.png          every distinct helmet and face, by facing, 8x, with its role map
 *   gloves.png          every distinct glove, by facing, 8x
 *   stick.png           every distinct blade by facing, and the stick's colours and lengths
 *   proportions.png     the skeleton of the reference pose in each facing, with its bone lengths
 *   style.json          the measured rules: palette roles and team colours, sprite sizes, bone lengths, stick
 *                       lengths, outline and shading habits, light direction, per facing
 */
'use strict';

const fs = require('fs');
const path = require('path');
const S = require('./pcupgrade/sources');
const Z = require('./pcupgrade/zones');
const R = require('../lib/sprite-rig');
const { Canvas } = require('./dropstick/raster');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const OUT = path.resolve(ROOT, opt('--out', path.join('docs', 'sprite-style', 'nhl94')));
const TEAMS = opt('--teams', 'bos:home,mtl:away,chi:home').split(',').map((s) => { const [code, side] = s.split(':'); return { code, home: side !== 'away', label: (code + ' ' + (side || 'home')).toUpperCase() }; });

const rom94 = S.load94();
if (!rom94) { console.error('needs the retail NHL 94 Genesis ROM in roms/'); process.exit(1); }
const { lib, frames: all } = require('./sprites/rig-load').load({});
const F = all.filter((f) => f.game === '94g' && !f.prop && !R.PROP_GROUPS.includes(f.group));
const labels = new Map(require('./sprites/frames').loadAll({}).frames.filter((f) => f.game === '94g').map((f) => [f.id, f.label]));
const FACINGS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const INK = [24, 32, 48], DIM = [96, 112, 128], PAPER = [244, 246, 248], ICE = [216, 236, 244];
fs.mkdirSync(OUT, { recursive: true });

// ---- the skater palette line -----------------------------------------------------------------------------------
// Line 2 (values 32-47) is the team's; the other lines are fixed. Roles from how the game's frames use each colour.
// (Measured: colour 1 is only ever the shadow's core, 2 is skates and gloves, 6-7 the face, 8-10 the stripes and socks,
// 11-13 the jersey, sleeves and helmet, 14 only the stick, 15 only the shadow.)
const ROLE = { 1: 'ice shadow core', 2: 'black (skates, gloves)', 3: 'pants dark', 4: 'pants medium', 5: 'pants light',
  6: 'skin', 7: 'skin', 8: 'trim dark (stripes, socks)', 9: 'trim light (stripes, socks)', 10: 'second colour (stripes, socks)',
  11: 'main colour medium (jersey, sleeves, helmet)', 12: 'main colour light', 13: 'main colour dark', 14: 'stick', 15: 'ice shadow' };
const pals = TEAMS.map((t) => rom94.palette(t.code, t.home));
{
  // The two skin colours: the lighter one is the lit side.
  const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const [a, b] = [pals[0][38], pals[0][39]];
  ROLE[lum(a) >= lum(b) ? 6 : 7] = 'skin light'; ROLE[lum(a) >= lum(b) ? 7 : 6] = 'skin shade';
}
const ROLE_SHOW = { 1: [60, 90, 120], 2: [20, 20, 24], 3: [90, 40, 120], 4: [140, 70, 170], 5: [190, 120, 220], 6: [250, 200, 160], 7: [210, 140, 100],
  8: [200, 120, 0], 9: [255, 190, 40], 10: [0, 170, 120], 11: [40, 110, 220], 12: [120, 180, 255], 13: [20, 50, 140], 14: [160, 100, 40], 15: [100, 160, 200] };
const roleOf = (v) => (v >= 32 && v < 48 ? v - 32 : null);

// ---- helpers ---------------------------------------------------------------------------------------------------
function draw(cv, f, ox, oy, sc, colour) {
  for (let i = 0; i < f.w * f.h; i++) {
    const v = f.px[i];
    if (v === 0) continue;
    const c = colour(v, i);
    if (c) cv.fill(ox + (f.x0 + (i % f.w)) * sc, oy + (f.y0 + ((i / f.w) | 0)) * sc, sc, sc, c);
  }
}
const ref = lib.sets.get('94g|SPFskate|0').map((id) => lib.byId.get(id));
const hold = lib.sets.get('94g|SPFHold|0') ? lib.sets.get('94g|SPFHold|0').map((id) => lib.byId.get(id)) : null;
const bbox = (f) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (let i = 0; i < f.w * f.h; i++) if (f.px[i]) { const x = f.x0 + (i % f.w), y = f.y0 + ((i / f.w) | 0); a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); } return { x0: a, y0: b, w: c - a + 1, h: d - b + 1 }; };
const crop = (f, part) => {
  const P = R.PART_NO[part];
  let a = Infinity, b = Infinity, c = -1, d = -1;
  for (let i = 0; i < f.w * f.h; i++) if (f.part[i] === P) { const x = i % f.w, y = (i / f.w) | 0; a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
  if (c < 0) return null;
  const w = c - a + 1, h = d - b + 1, px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (b + y) * f.w + a + x; if (f.part[i] === P) px[y * w + x] = f.px[i]; }
  return { w, h, x0: 0, y0: 0, px, key: w + 'x' + h + ':' + Buffer.from(px).toString('base64') };
};
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return +s[s.length >> 1].toFixed(2); };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---- turnaround ------------------------------------------------------------------------------------------------
{
  const SC = 6, CW = 40, CH = 46;
  const cv = new Canvas(8 * CW * SC + 20, TEAMS.length * (CH * SC + 40) + 50, PAPER);
  cv.text(10, 8, 'NHL 94 SKATER TURNAROUND: SPFSKATE STEP 0, ALL EIGHT FACINGS (6X)', INK, 2);
  const one = new Canvas(8 * CW + 2, TEAMS.length * CH + 2, ICE);
  TEAMS.forEach((t, r) => {
    const y = 36 + r * (CH * SC + 40);
    cv.text(10, y, t.label, DIM, 1);
    ref.forEach((f, c) => {
      const x = 10 + c * CW * SC;
      cv.fill(x, y + 12, CW * SC - 6, CH * SC, ICE);
      draw(cv, f, x + (CW / 2) * SC, y + 12 + 38 * SC, SC, (v) => pals[r][v]);
      cv.text(x + 2, y + 16, FACINGS[c], DIM, 1);
      draw(one, f, 1 + c * CW + CW / 2, 1 + r * CH + 38, 1, (v) => pals[r][v]);
    });
  });
  fs.writeFileSync(path.join(OUT, 'turnaround.png'), cv.png());
  fs.writeFileSync(path.join(OUT, 'turnaround-1x.png'), one.png());
}

// ---- measurements over every NHL 94 skater frame -------------------------------------------------------------
const stats = { roles: {}, outline: {}, byFacing: {} };
for (let k = 1; k < 16; k++) stats.roles[k] = 0;
for (const f of F) {
  const fb = (stats.byFacing[f.facing ?? 'none'] = stats.byFacing[f.facing ?? 'none'] || { frames: 0, w: [], h: [], light: [], outline: {}, bones: {} });
  fb.frames++;
  const bb = bbox(f); fb.w.push(bb.w); fb.h.push(bb.h);
  let lx = 0, ly = 0, ln = 0, dx = 0, dy = 0, dn = 0;
  for (let i = 0; i < f.w * f.h; i++) {
    const v = f.px[i];
    if (!v) continue;
    const r = roleOf(v);
    if (r) stats.roles[r]++;
    const x = i % f.w, y = (i / f.w) | 0;
    const edge = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([a, b]) => a < 0 || b < 0 || a >= f.w || b >= f.h || !f.px[b * f.w + a]);
    if (edge && f.part[i] !== R.PART_NO.shadow) { const key = r ? String(r) : 'other'; stats.outline[key] = (stats.outline[key] || 0) + 1; fb.outline[key] = (fb.outline[key] || 0) + 1; }
    if (f.part[i] === R.PART_NO.torso && r === 12) { lx += x; ly += y; ln++; }
    if (f.part[i] === R.PART_NO.torso && r === 13) { dx += x; dy += y; dn++; }
  }
  if (ln >= 3 && dn >= 3) fb.light.push([lx / ln - dx / dn, ly / ln - dy / dn]);
  const kp = f.kp, bone = (n, a, b) => { if (kp[a] && kp[b]) (fb.bones[n] = fb.bones[n] || []).push(dist(kp[a], kp[b])); };
  bone('head-neck', 'head', 'neck'); bone('neck-hips', 'neck', 'hipMid');
  for (const s of [0, 1]) { bone('upper arm', 'shoulder' + s, 'elbow' + s); bone('forearm', 'elbow' + s, 'hand' + s); bone('shoulder-hand', 'shoulder' + s, 'hand' + s); bone('thigh', 'hip' + s, 'knee' + s); bone('shin', 'knee' + s, 'skate' + s); }
  if (kp.head && (kp.skate0 || kp.skate1)) bone('height', 'head', kp.skate0 ? 'skate0' : 'skate1');
}
const totalRole = Object.values(stats.roles).reduce((a, b) => a + b, 0);
const totalEdge = Object.values(stats.outline).reduce((a, b) => a + b, 0);

// ---- colour roles ----------------------------------------------------------------------------------------------
{
  const SC = 6, CW = 40, CH = 46;
  const cv = new Canvas(Math.max(8 * CW * SC + 20, 1300), 560 + CH * SC + 60, PAPER);
  cv.text(10, 8, 'NHL 94 SKATER COLOURS: PALETTE LINE 2, WHAT EACH COLOUR IS FOR', INK, 2);
  cv.text(10, 32, 'COLOUR 0 IS TRANSPARENT. LINE 2 IS THE TEAM\'S; THE GAME LOADS IT FROM THE TEAM LIST (HOME OR AWAY). SHARE: OF ALL SKATER PIXELS.', DIM, 1);
  for (let k = 1; k < 16; k++) {
    const y = 52 + (k - 1) * 30;
    cv.text(10, y + 8, String(k).padStart(2, ' ') + ' ' + ROLE[k].toUpperCase(), INK, 1);
    cv.text(330, y + 8, (100 * stats.roles[k] / totalRole).toFixed(1) + '%', DIM, 1);
    cv.fill(390, y + 2, 22, 22, ROLE_SHOW[k]);
    TEAMS.forEach((t, r) => { cv.fill(440 + r * 120, y + 2, 40, 22, pals[r][32 + k]); const c = pals[r][32 + k]; cv.text(484 + r * 120, y + 8, c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase(), DIM, 1); });
  }
  TEAMS.forEach((t, r) => cv.text(440 + r * 120, 40 + 4, t.label, INK, 1));
  cv.text(390, 40 + 4, 'MAP', INK, 1);
  const y0 = 52 + 15 * 30 + 20;
  cv.text(10, y0, 'THE TURNAROUND PAINTED BY ROLE (MAP COLOURS ABOVE)', INK, 1);
  ref.forEach((f, c) => {
    const x = 10 + c * CW * SC;
    cv.fill(x, y0 + 14, CW * SC - 6, CH * SC, ICE);
    draw(cv, f, x + (CW / 2) * SC, y0 + 14 + 38 * SC, SC, (v) => (roleOf(v) ? ROLE_SHOW[roleOf(v)] : [255, 0, 255]));
    cv.text(x + 2, y0 + 18, FACINGS[c], DIM, 1);
  });
  fs.writeFileSync(path.join(OUT, 'colour-roles.png'), cv.png());
}

// ---- jersey zones ----------------------------------------------------------------------------------------------
const ZONE_FAMILIES = [...new Set([...Z.BY_INDEX.values()].map((z) => z.family))];
const ZONE_SHOW = {};
ZONE_FAMILIES.forEach((fam, i) => { const h = (i * 137.5) % 360, s = 0.65, l = 0.5 + (i % 3) * 0.1; const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l); const fn = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))); ZONE_SHOW[fam] = [fn(0), fn(8), fn(4)]; });
{
  const SC = 6, CW = 40, CH = 46;
  const used = new Set();
  for (const f of ref) for (const v of labels.get(f.id) || []) { const z = Z.BY_INDEX.get(v); if (z) used.add(z.family); }
  const fams = ZONE_FAMILIES.filter((x) => used.has(x));
  const cv = new Canvas(8 * CW * SC + 20, CH * SC + 90 + Math.ceil(fams.length / 6) * 20 + 30, PAPER);
  cv.text(10, 8, 'NHL 94 JERSEY ZONES: WHERE EACH STRIPE AND BAND SITS, ALL EIGHT FACINGS', INK, 2);
  cv.text(10, 32, 'ZONES OF THE PC JERSEY SYSTEM (48), TAKEN FROM NHL 95 PC\'S OWN VERSION OF EACH FRAME. GREY: SKIN, STICK, BLACK AND STEEL.', DIM, 1);
  ref.forEach((f, c) => {
    const x = 10 + c * CW * SC, lab = labels.get(f.id);
    cv.fill(x, 50, CW * SC - 6, CH * SC, ICE);
    draw(cv, f, x + (CW / 2) * SC, 50 + 38 * SC, SC, (v, i) => { const z = lab && Z.BY_INDEX.get(lab[i]); return z ? ZONE_SHOW[z.family] : [170, 170, 170]; });
    cv.text(x + 2, 54, FACINGS[c], DIM, 1);
  });
  fams.forEach((fam, i) => { const x = 10 + (i % 6) * 200, y = 60 + CH * SC + Math.floor(i / 6) * 20; cv.fill(x, y, 14, 14, ZONE_SHOW[fam]); cv.text(x + 20, y + 4, fam.replace(/([A-Z])/g, ' $1').toUpperCase(), INK, 1); });
  fs.writeFileSync(path.join(OUT, 'jersey-zones.png'), cv.png());
}

// ---- distinct part shapes by facing (helmet, gloves) ------------------------------------------------------------
function partSheet(file, title, parts, perFacing, SC) {
  const byFacing = {};
  for (const f of F) {
    if (f.facing == null) continue;
    for (const p of parts) {
      const c = crop(f, p);
      if (!c || c.w * c.h < 4) continue;
      const m = (byFacing[f.facing] = byFacing[f.facing] || new Map());
      if (!m.has(c.key)) m.set(c.key, Object.assign(c, { n: 0, from: f.id }));
      m.get(c.key).n++;
    }
  }
  const cell = 18;
  const cv = new Canvas(perFacing * (cell * SC + 10) + 80, 8 * (cell * SC + 30) + 50, PAPER);
  cv.text(10, 8, title, INK, 2);
  cv.text(10, 32, 'EACH ROW A FACING; THE MOST-USED SHAPES FIRST (UNDER EACH: HOW MANY FRAMES USE IT). ' + SC + 'X, BOSTON HOME COLOURS.', DIM, 1);
  const counts = {};
  for (let fc = 0; fc < 8; fc++) {
    const y = 48 + fc * (cell * SC + 30);
    cv.text(10, y + 10, FACINGS[fc], INK, 2);
    const list = [...(byFacing[fc] || new Map()).values()].sort((a, b) => b.n - a.n);
    counts[FACINGS[fc]] = list.length;
    list.slice(0, perFacing).forEach((c, k) => {
      const x = 70 + k * (cell * SC + 10);
      cv.fill(x, y, cell * SC, cell * SC, ICE);
      const ox = x + Math.floor((cell - c.w) / 2) * SC, oy = y + Math.floor((cell - c.h) / 2) * SC;
      for (let i = 0; i < c.w * c.h; i++) if (c.px[i]) cv.fill(ox + (i % c.w) * SC, oy + ((i / c.w) | 0) * SC, SC, SC, pals[0][c.px[i]]);
      cv.text(x, y + cell * SC + 4, c.n + 'X ' + c.w + 'X' + c.h, DIM, 1);
    });
  }
  fs.writeFileSync(path.join(OUT, file), cv.png());
  return counts;
}
const helmets = partSheet('helmet.png', 'NHL 94 HELMET AND FACE, BY FACING', ['head'], 8, 8);
const gloves = partSheet('gloves.png', 'NHL 94 GLOVES, BY FACING', ['hand0', 'hand1'], 10, 8);

// ---- stick -------------------------------------------------------------------------------------------------------
const sticks = F.map((f) => ({ f, s: R.stickOf(f) })).filter((x) => x.s && x.s.len >= 6);
{
  const SC = 8, cell = 14, per = 10;
  const cv = new Canvas(per * (cell * SC + 10) + 80, 8 * (cell * SC + 30) + 120, PAPER);
  cv.text(10, 8, 'NHL 94 STICK: BLADES BY FACING', INK, 2);
  const L = sticks.map((x) => x.s.len);
  cv.text(10, 32, 'SHAFT: ONE PIXEL WIDE, COLOUR 14, IN CLEAN STEPS. LENGTH BUTT TO BLADE ' + median(L) + ' PX (MEDIAN OF ' + L.length + ' FRAMES; ' +
    Math.min(...L).toFixed(1) + ' TO ' + Math.max(...L).toFixed(1) + ' AS IT FORESHORTENS). BLADES BELOW: THE LAST ' + 3 + ' PX, ' + SC + 'X.', DIM, 1);
  for (let fc = 0; fc < 8; fc++) {
    const y = 56 + fc * (cell * SC + 30);
    cv.text(10, y + 10, FACINGS[fc], INK, 2);
    const seen = new Map();
    for (const { f, s } of sticks) if (f.facing === fc) { const b = s.blade, key = b.w + 'x' + b.h + Buffer.from(b.px).toString('base64'); if (!seen.has(key)) seen.set(key, { b, n: 0 }); seen.get(key).n++; }
    [...seen.values()].sort((a, b) => b.n - a.n).slice(0, per).forEach(({ b, n }, k) => {
      const x = 70 + k * (cell * SC + 10);
      cv.fill(x, y, cell * SC, cell * SC, ICE);
      const ox = x + Math.max(0, Math.floor((cell - b.w) / 2)) * SC, oy = y + Math.max(0, Math.floor((cell - b.h) / 2)) * SC;
      for (let i = 0; i < b.w * b.h; i++) if (b.px[i]) cv.fill(ox + (i % b.w) * SC, oy + ((i / b.w) | 0) * SC, SC, SC, pals[0][b.px[i]]);
      cv.text(x, y + cell * SC + 4, n + 'X', DIM, 1);
    });
  }
  fs.writeFileSync(path.join(OUT, 'stick.png'), cv.png());
}

// ---- proportions ---------------------------------------------------------------------------------------------------
const BONES = [['head', 'neck'], ['neck', 'shoulder0'], ['neck', 'shoulder1'], ['shoulder0', 'elbow0'], ['elbow0', 'hand0'], ['shoulder1', 'elbow1'], ['elbow1', 'hand1'],
  ['neck', 'hipMid'], ['hipMid', 'hip0'], ['hipMid', 'hip1'], ['hip0', 'knee0'], ['knee0', 'skate0'], ['hip1', 'knee1'], ['knee1', 'skate1'], ['stickButt', 'stickBlade']];
{
  const SC = 6, CW = 40, CH = 46;
  const cv = new Canvas(8 * CW * SC + 20, CH * SC + 260, PAPER);
  cv.text(10, 8, 'NHL 94 PROPORTIONS: THE SKELETON OF THE TURNAROUND, AND MEDIAN BONE LENGTHS (PX) OVER EVERY FRAME OF THAT FACING', INK, 1);
  cv.text(10, 22, 'HOLLOW JOINTS ARE HIDDEN IN THAT FRAME (FILLED IN FROM THE NEAREST FRAMES THAT SHOW THEM).', DIM, 1);
  const names = ['height', 'head-neck', 'neck-hips', 'upper arm', 'forearm', 'shoulder-hand', 'thigh', 'shin'];
  ref.forEach((f, c) => {
    const x = 10 + c * CW * SC, ox = x + (CW / 2) * SC, oy = 40 + 38 * SC;
    cv.fill(x, 40, CW * SC - 6, CH * SC, ICE);
    draw(cv, f, ox, oy, SC, (v) => pals[0][v].map((q) => Math.round(q * 0.35 + 255 * 0.65)));
    const full = R.fullSkeleton(lib, f), kp = full.kp;
    const P = (j) => [ox + kp[j][0] * SC, oy + kp[j][1] * SC];
    for (const [a, b] of BONES) {
      if (!kp[a] || !kp[b]) continue;
      const pa = P(a), pb = P(b), n = Math.ceil(Math.max(Math.abs(pb[0] - pa[0]), Math.abs(pb[1] - pa[1])));
      for (let i = 0; i <= n; i++) cv.fill(Math.round(pa[0] + (pb[0] - pa[0]) * i / n) - 1, Math.round(pa[1] + (pb[1] - pa[1]) * i / n) - 1, 3, 3, a === 'stickButt' ? [200, 0, 200] : [0, 80, 255]);
    }
    for (const j of R.JOINTS) if (kp[j]) { const [px, py] = P(j).map(Math.round); if (full.synthetic.includes(j)) { cv.box(px - 3, py - 3, 7, 7, INK); } else cv.fill(px - 3, py - 3, 7, 7, INK); }
    cv.text(x + 2, 44, FACINGS[c], DIM, 1);
    const fb = stats.byFacing[c];
    names.forEach((nm, k) => cv.text(x + 4, 50 + CH * SC + k * 14, nm.toUpperCase() + ' ' + (median(fb.bones[nm] || []) ?? '-'), INK, 1));
  });
  fs.writeFileSync(path.join(OUT, 'proportions.png'), cv.png());
}

// ---- style.json ------------------------------------------------------------------------------------------------------
const style = {
  game: 'NHL Hockey 94 (Genesis)', frames: F.length, reference: { animation: 'SPFskate step 0', frames: ref.map((f) => f.id) },
  hardware: { colours: '15 + transparent per sprite (one 16-colour palette line); the team line is line 2', pixel: '1:1, Genesis 320x224', maxSprite: 'up to 4x4 tiles (32x32) per hardware sprite; a frame is several' },
  palette: {
    roles: Object.fromEntries(Object.entries(ROLE).map(([k, v]) => [k, { role: v, share: +(stats.roles[k] / totalRole).toFixed(4) }])),
    teams: Object.fromEntries(TEAMS.map((t, r) => [t.label, Object.fromEntries(Array.from({ length: 15 }, (_, k) => [k + 1, '#' + pals[r][33 + k].map((v) => v.toString(16).padStart(2, '0')).join('')]))])),
    shading: 'three tones per team colour: main 12 light / 11 medium / 13 dark; pants 5 / 4 / 3; trim 9 / 8; second colour 10 is one tone'
  },
  outline: { note: 'colour of silhouette-edge pixels (not the ice shadow), share', all: Object.fromEntries(Object.entries(stats.outline).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k === 'other' ? 'other lines' : ROLE[k], +(v / totalEdge).toFixed(3)])) },
  facings: Object.fromEntries(FACINGS.map((name, fc) => {
    const fb = stats.byFacing[fc];
    const lt = fb.light.length ? [median(fb.light.map((v) => v[0])), median(fb.light.map((v) => v[1]))] : null;
    return [name, {
      frames: fb.frames, size: { w: median(fb.w), h: median(fb.h), maxW: Math.max(...fb.w), maxH: Math.max(...fb.h) },
      bones: Object.fromEntries(Object.entries(fb.bones).map(([k, v]) => [k, median(v)])),
      light: lt ? { towards: [lt[0], lt[1]], note: 'pixels from the jersey\'s dark tone to its light tone, median over frames (x right, y down)' } : null,
      helmets: helmets[name], gloves: gloves[name]
    }];
  })),
  stick: { length: { median: median(sticks.map((x) => x.s.len)), min: +Math.min(...sticks.map((x) => x.s.len)).toFixed(2), max: +Math.max(...sticks.map((x) => x.s.len)).toFixed(2) }, shaftWidth: 1, colour: 14, blade: 'last 3 px, colour 14, no tape on the Genesis' }
};
fs.writeFileSync(path.join(OUT, 'style.json'), JSON.stringify(style, null, 1));
console.log('wrote', path.relative(ROOT, OUT), fs.readdirSync(OUT).join(' '));
