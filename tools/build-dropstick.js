#!/usr/bin/env node
/**
 * Build the "drop stick and go back for it" animation for NHL 94 Genesis out of the retail player sheet.
 *
 *   node tools/build-dropstick.js [path/to/nhl94.bin] [--team Bruinsv.pal] [--out docs/dropstick]
 *
 * With the retail NHL 94 ROM (roms/nhl94.bin, .md or .gen, or the path given) every picture comes from that ROM.
 * Without it, from the NHL 92 Sprites.anim in test/fixtures, whose skater frames carry the same numbers
 * (tools/dropstick/source.js). Everything written says which sheet it came from.
 *
 * Writes:
 *   drop-stick-sheet.png     the character sheet: 8 rows (facing when the stick goes) x 15 steps, 2x
 *   drop-stick-frames.png    every new frame the animation needs (stickless bodies, loose stick), by facing, 3x
 *   drop-stick-<dir>.gif     each facing played at game speed with the camera still, 2x
 *   drop-stick-all.gif       all eight facings at once
 *   frames/*.png             each new frame at 1x as an 8-bit PNG holding the game colour indices and palette
 *   dropstick94.asm          SPF equates and SPA tables in the frames94.asm layout
 *   dropstick.json           every new frame's hardware sprites (size index, offsets, palette line, 4bpp tiles)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { load } = require('./dropstick/source');
const { build, NAMES } = require('./dropstick/sequence');
const { split } = require('./dropstick/pieces');
const { Canvas, gif, png8 } = require('./dropstick/raster');
const { STICK, SHADOW } = require('./dropstick/cel');
const anim = require('../lib/anim');
const Img = require('../lib/indexed-image');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : def; };
const team = opt('--team', 'Bruinsv.pal');
const outDir = path.resolve(ROOT, opt('--out', path.join('docs', 'dropstick')));
const romArg = args[0];

const src = load(romArg);
const seq = build(src);

// Palette: the sheet's four lines, line 2 replaced by the team jersey (what SetTeamColors does in the game).
const teamFile = path.join(ROOT, 'data', 'pals', 'genesis', team);
const jersey = anim.decodePaletteFile(fs.readFileSync(teamFile));
const PAL = src.palettes.flat().map((c) => c.slice());
for (let i = 0; i < 16; i++) PAL[32 + i] = jersey[i].slice();
const ICE = [219, 255, 255];
const INK = [24, 32, 48], DIM = [96, 112, 128], RULE = [176, 200, 212], PANEL = [198, 222, 230];
const NEWC = [182, 36, 36], OLDC = [36, 73, 146];

// Timing in vblanks per step (SPAskatewp 10, SPAstop 4, SPAsweepchk 4/8 in frames94.asm).
const TIME = { carry: 10, catch: 6, vault: 6, clatter: 8, coast: 10, stop: 4, stop2: 4, pivot: 6, turned: 6,
  back1: 10, back2: 10, reach: 6, grab: 8, rise: 10, away: 10 };

// ---- New frames: number them the way a sheet would hold them -------------------------------------------------
// SPFnostick: 8 per facing (glide, stride 1-4, stop 1-2, reach). SPFloosestick: 3 per facing (100, 145, 180 deg).
const BODY_SLOTS = [['skatewp', 0], ['skatewp', 1], ['skatewp', 2], ['skatewp', 3], ['skatewp', 4], ['stop', 0], ['stop', 1], ['sweep', 0]];
const BODY_NAMES = ['glide', 'stride1', 'stride2', 'stride3', 'stride4', 'stop1', 'stop2', 'reach'];
const STICK_ANGLES = [100, 145, 180];
const STICK_NAMES = ['upright', 'falling', 'flat'];
const S = src.spf;
const base = { skatewp: S.SPFskatewp, stop: S.SPFstop, sweep: S.SPFsweep };
const per = { skatewp: 5, stop: 2, sweep: 2 };
const retailOf = (slot, dir) => base[BODY_SLOTS[slot][0]] + per[BODY_SLOTS[slot][0]] * dir + BODY_SLOTS[slot][1];

const newFrames = [];         // { id, sym, kind, dir, cel, from }
const bodyId = new Map();     // retail frame -> new id
for (let dir = 0; dir < 8; dir++) {
  BODY_SLOTS.forEach((_, k) => {
    const from = retailOf(k, dir);
    const cel = seq.bodies.get(from) || require('./dropstick/unstick').unstick(src.frame(from)).body;
    const id = newFrames.length;
    newFrames.push({ id, sym: 'SPFnostick+' + (dir * 8 + k), kind: 'body', name: BODY_NAMES[k], dir, cel, from });
    bodyId.set(from, id);
  });
}
const stickId = new Map();    // dir:angle -> new id
for (let dir = 0; dir < 8; dir++) {
  const row = seq.rows[dir];
  STICK_ANGLES.forEach((angle, k) => {
    const cel = row.cels.find((c) => c.stick && c.stick.angle === angle).stick.cel;
    const id = newFrames.length;
    newFrames.push({ id, sym: 'SPFloosestick+' + (dir * 3 + k), kind: 'stick', name: STICK_NAMES[k], dir, cel, angle });
    stickId.set(dir + ':' + angle, id);
  });
}

// ---- Checks: hardware fit and colours ------------------------------------------------------------------------
const retailColours = new Set();
let retailMaxTiles = 0, retailMaxPieces = 0, retailMaxW = 0, retailMaxH = 0, cutMaxTiles = 0, cutMaxPieces = 0;
for (let f = S.SPFskatewp; f < S.SPFgloves; f++) {
  const m = src.meta(f);
  retailMaxPieces = Math.max(retailMaxPieces, m.sprites.length);
  retailMaxTiles = Math.max(retailMaxTiles, m.sprites.reduce((n, s) => n + s.tileCount, 0));
  for (const [, , v] of src.frame(f).pixels()) retailColours.add(v);
  const c = src.frame(f); retailMaxW = Math.max(retailMaxW, c.w); retailMaxH = Math.max(retailMaxH, c.h);
  const cut = split(c); cutMaxTiles = Math.max(cutMaxTiles, cut.tileCount); cutMaxPieces = Math.max(cutMaxPieces, cut.pieces.length);
}
// The limit a new frame is held to: the biggest retail skater frame, as the retail data stores it or as this cut
// stores it, whichever is larger (the cut is close to EA's but not the same).
const limitTiles = Math.max(retailMaxTiles, cutMaxTiles), limitPieces = Math.max(retailMaxPieces, cutMaxPieces);
const problems = [];
for (const f of newFrames) {
  f.split = split(f.cel);
  for (const [, , v] of f.cel.pixels()) {
    if (!retailColours.has(v)) problems.push('frame ' + f.sym + ' uses colour ' + v + ', which no retail skater frame uses');
  }
  if (f.kind === 'stick' && f.cel.pixels().some(([, , v]) => v !== STICK && v !== SHADOW)) problems.push(f.sym + ' is not wood and shadow');
  if (f.split.tileCount > limitTiles) problems.push(f.sym + ' needs ' + f.split.tileCount + ' tiles, retail max ' + limitTiles);
  if (f.split.pieces.length > limitPieces) problems.push(f.sym + ' needs ' + f.split.pieces.length + ' sprites, retail max ' + limitPieces);
}
for (const f of newFrames.filter((x) => x.kind === 'body')) {
  const before = split(src.frame(f.from)).tileCount;
  f.tilesBefore = before;
  if (f.split.tileCount > before) problems.push(f.sym + ' grew from ' + before + ' to ' + f.split.tileCount + ' tiles');
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }

// ---- Cel labels -----------------------------------------------------------------------------------------------
function celInfo(c, row) {
  if (c.retail) return { tag: '#' + c.frame, retail: true };
  return { tag: 'N' + bodyId.get(c.frame), retail: false };
}
const STEP_TITLES = { carry: 'CARRY', catch: 'BLADE CATCH', vault: 'POLE-VAULT', clatter: 'CLATTER', coast: 'COAST',
  stop: 'STOP', stop2: 'STOP', pivot: 'PIVOT', turned: 'TURN BACK', back1: 'SKATE BACK', back2: 'SKATE BACK',
  reach: 'REACH', grab: 'GRAB', rise: 'STICK DOWN', away: 'SKATE OFF' };

/** The cel's two layers in draw order: the stick object is sorted by y against the player, like any sprite. */
function layers(c) {
  const out = [{ cel: c.cel, at: c.at }];
  if (c.stick) {
    const s = { cel: c.stick.cel, at: c.stick.at };
    if (c.stick.at[1] > c.at[1]) out.push(s); else out.unshift(s);
  }
  return out;
}

// ---- The character sheet --------------------------------------------------------------------------------------
fs.mkdirSync(path.join(outDir, 'frames'), { recursive: true });
const SC = 2, PW = 100, PH = 84, PX = 50, PY = 56;            // panel in game pixels; player position at PX, PY
const LEFT = 132, TOP = 150, COLW = PW * SC + 6, ROWH = PH * SC + 40;
const steps = seq.rows[0].cels.length;
const sheet = new Canvas(LEFT + steps * COLW + 14, TOP + 8 * ROWH + 150, [244, 246, 248]);
sheet.text(16, 14, 'NHL HOCKEY \'94  -  DROP STICK AND GO BACK FOR IT', INK, 3);
sheet.text(16, 44, 'NEW ANIMATION BUILT FROM THE RETAIL PLAYER SHEET.  ONE ROW PER FACING WHEN THE STICK GOES; THE PLAYER COMES BACK FACING THE OPPOSITE WAY.', DIM, 1);
sheet.text(16, 56, 'SOURCE: ' + src.label, DIM, 1);
sheet.text(16, 68, 'PALETTE LINE 2 = ' + team.replace(/\.pal$/i, '') + ' (DATA/PALS/GENESIS).  ' + SC + 'X SCALE, CAMERA ON THE PLAYER POSITION.  TIMES IN VBLANKS (1/60 S).', DIM, 1);
sheet.fill(16, 86, 10, 10, OLDC); sheet.text(32, 88, '#N  RETAIL FRAME, UNCHANGED', INK, 1);
sheet.fill(220, 86, 10, 10, NEWC); sheet.text(236, 88, 'NN  NEW FRAME (DROPSTICK94.ASM): RETAIL BODY, STICK REMOVED. S = NEW LOOSE-STICK OBJECT', INK, 1);
sheet.text(16, 104, 'STICK: BLADE CATCHES THE ICE, SHAFT POLE-VAULTS OVER THE HEEL AND LANDS BUTT-FIRST; THE RETAIL SWEEP-CHECK POSE OF THE RETURN FACING PICKS IT UP BY THE BUTT.', DIM, 1);
seq.rows[0].cels.forEach((c, i) => {
  const x = LEFT + i * COLW;
  sheet.text(x + 2, TOP - 22, STEP_TITLES[c.id], INK, 1);
  sheet.text(x + 2, TOP - 12, String(i + 1).padStart(2, '0') + '  ' + TIME[c.id] + 'V', DIM, 1);
});
seq.rows.forEach((row, ri) => {
  const y = TOP + ri * ROWH;
  sheet.text(14, y + 40, 'FACING ' + row.name, INK, 2);
  sheet.text(14, y + 62, 'D=' + row.d + ', BACK ' + row.back, DIM, 1);
  sheet.text(14, y + 74, 'DIRTAB ' + row.d + ' / ' + row.r, DIM, 1);
  row.cels.forEach((c, i) => {
    const x = LEFT + i * COLW;
    sheet.fill(x, y, PW * SC, PH * SC, ICE);
    const ox = c.at[0] - PX, oy = c.at[1] - PY;            // world of the panel's top-left
    const pane = new Canvas(PW * SC, PH * SC, ICE);
    for (const L of layers(c)) pane.cel(L.cel, (L.at[0] - ox) * SC, (L.at[1] - oy) * SC, PAL, SC);
    for (let j = 0; j < PH * SC; j++) for (let k = 0; k < PW * SC; k++) {
      const q = (j * pane.w + k) * 3; sheet.set(x + k, y + j, [pane.rgb[q], pane.rgb[q + 1], pane.rgb[q + 2]]);
    }
    sheet.box(x, y, PW * SC, PH * SC, RULE);
    const info = celInfo(c, row);
    let tx = sheet.text(x + 2, y + PH * SC + 4, info.tag, info.retail ? OLDC : NEWC, 1);
    if (!info.retail) sheet.text(tx + 6, y + PH * SC + 4, 'FROM #' + c.frame, DIM, 1);
    if (c.stick) sheet.text(x + 2, y + PH * SC + 15, 'S' + stickId.get(row.d + ':' + c.stick.angle) + ' ' + c.stick.angle + ' DEG', NEWC, 1);
  });
});
const fy = TOP + 8 * ROWH + 10;
sheet.text(16, fy, 'HARDWARE: EVERY NEW FRAME IS 4BPP 8X8 TILES ON PALETTE LINE 2 (SPRAY ON LINE 0 AS IN THE RETAIL STOP FRAMES), CUT INTO 1-4 X 1-4 TILE VDP SPRITES.', INK, 1);
const bodies = newFrames.filter((f) => f.kind === 'body'), sticks = newFrames.filter((f) => f.kind === 'stick');
const mx = (list, fn) => Math.max(...list.map(fn));
sheet.text(16, fy + 12, 'NEW BODIES: ' + bodies.length + ' FRAMES, MAX ' + mx(bodies, (f) => f.split.tileCount) + ' TILES / ' + mx(bodies, (f) => f.split.pieces.length) +
  ' SPRITES.  LOOSE STICK: ' + sticks.length + ' FRAMES, MAX ' + mx(sticks, (f) => f.split.tileCount) + ' TILES / ' + mx(sticks, (f) => f.split.pieces.length) +
  ' SPRITES.  RETAIL SKATER FRAMES: MAX ' + retailMaxTiles + ' TILES / ' + retailMaxPieces + ' SPRITES (' + cutMaxTiles + ' / ' + cutMaxPieces + ' CUT THIS WAY).', INK, 1);
sheet.text(16, fy + 24, 'COLOURS: ONLY INDICES THE RETAIL SKATER FRAMES ALREADY USE. THE STICK IS COLOUR 14 (WOOD) AND 15 (ICE SHADOW), THE SAME IN EVERY TEAM PALETTE.', INK, 1);
sheet.text(16, fy + 36, 'NO FRAME IS MIRRORED: LIKE THE RETAIL SHEET, EACH OF THE 8 FACINGS IS ITS OWN DRAWING (PLAYERS ARE HANDED).', INK, 1);
sheet.text(16, fy + 54, 'SPA: SPADROPSTICK (STEPS 1-5) + SPASTICKFALL ON THE STICK OBJECT, SPASTOPNOSTICK (6-7), TURN (8-9), SPASKATENOSTICK (10-11), SPAGETSTICK (12-14), SPASKATEWP (15).', DIM, 1);
sheet.text(16, fy + 66, 'REBUILD: NODE TOOLS/BUILD-DROPSTICK.JS [NHL94.BIN] [--TEAM FILE.PAL]', DIM, 1);
fs.writeFileSync(path.join(outDir, 'drop-stick-sheet.png'), sheet.png());

// ---- New frame library ----------------------------------------------------------------------------------------
const LS = 3, LW = 76, LH = 70, LPX = 38, LPY = 48;
const LIBL = 110, LIBT = 92, LCOL = LW * LS + 6, LROW = LH * LS + 36;
const lib = new Canvas(LIBL + 11 * LCOL + 10, LIBT + 8 * LROW + 20, [244, 246, 248]);
lib.text(16, 14, 'DROP STICK  -  NEW FRAMES BY FACING', INK, 3);
lib.text(16, 44, 'SPFNOSTICK: 8 PER FACING, THE RETAIL FRAME WITH ITS STICK TAKEN OUT (HOLES CLOSED WITH THE BODY COLOUR EITHER SIDE).', DIM, 1);
lib.text(16, 56, 'SPFLOOSESTICK: 3 PER FACING, A NEW OBJECT PLACED AT THE BLADE HEEL (THE AMBER MARK). ' + LS + 'X. AMBER = PLAYER POSITION / OBJECT ORIGIN.', DIM, 1);
lib.text(16, 68, 'UNDER EACH: NEW ID, RETAIL SOURCE, TILES / VDP SPRITES (TILES OF THE RETAIL SOURCE CUT THE SAME WAY).', DIM, 1);
for (let dir = 0; dir < 8; dir++) {
  const y = LIBT + dir * LROW;
  lib.text(14, y + 30, 'FACING', INK, 1); lib.text(14, y + 42, NAMES[dir], INK, 3);
  newFrames.filter((f) => f.dir === dir).forEach((f, i) => {
    const x = LIBL + i * LCOL;
    lib.fill(x, y, LW * LS, LH * LS, ICE);
    lib.cel(f.cel, x + LPX * LS, y + LPY * LS, PAL, LS);
    lib.fill(x + LPX * LS - 1, y + LPY * LS - 1, 3, 3, [255, 160, 0]);
    lib.box(x, y, LW * LS, LH * LS, RULE);
    const tag = (f.kind === 'body' ? 'N' : 'S') + f.id + ' ' + f.name.toUpperCase();
    lib.text(x + 2, y + LH * LS + 4, tag, NEWC, 1);
    const sub = f.kind === 'body'
      ? 'FROM #' + f.from + '  ' + f.split.tileCount + 'T/' + f.split.pieces.length + 'S (' + f.tilesBefore + 'T)'
      : f.angle + ' DEG  ' + f.split.tileCount + 'T/' + f.split.pieces.length + 'S';
    lib.text(x + 2, y + LH * LS + 15, sub, DIM, 1);
  });
}
fs.writeFileSync(path.join(outDir, 'drop-stick-frames.png'), lib.png());

// ---- Indexed 1x frames ----------------------------------------------------------------------------------------
for (const f of newFrames) {
  const c = f.cel.trim();
  const idx = Uint8Array.from(c.px);
  const file = (f.kind === 'body' ? 'nostick' : 'loosestick') + '-' + NAMES[f.dir].toLowerCase() + '-' + f.name + '.png';
  f.file = 'frames/' + file;
  fs.writeFileSync(path.join(outDir, f.file), Buffer.from(Img.encodePng8(c.w, c.h, idx, PAL, { transparent: [0, 16, 32, 48] })));
}

// ---- GIFs: still camera, game speed ---------------------------------------------------------------------------
const GS = 2;
function worldBox(row) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of row.cels) for (const L of layers(c)) {
    const b = L.cel.bounds(); if (!b) continue;
    minX = Math.min(minX, L.at[0] + b.minX); minY = Math.min(minY, L.at[1] + b.minY);
    maxX = Math.max(maxX, L.at[0] + b.maxX); maxY = Math.max(maxY, L.at[1] + b.maxY);
  }
  return { minX: minX - 6, minY: minY - 6, w: maxX - minX + 13, h: maxY - minY + 13 };
}
const delays = seq.rows[0].cels.map((c) => Math.round(((TIME[c.id] + 1) * 100) / 60));
const boxes = seq.rows.map(worldBox);
const GW = Math.max(...boxes.map((b) => b.w)), GH = Math.max(...boxes.map((b) => b.h));
function frameOf(row, ci, w, h, box) {
  const cv = new Canvas(w * GS, h * GS, ICE);
  const ox = box.minX - Math.floor((w - box.w) / 2), oy = box.minY - Math.floor((h - box.h) / 2);
  for (const L of layers(row.cels[ci])) cv.cel(L.cel, (L.at[0] - ox) * GS, (L.at[1] - oy) * GS, PAL, GS);
  return cv;
}
seq.rows.forEach((row, ri) => {
  const frames = row.cels.map((_, ci) => frameOf(row, ci, GW, GH, boxes[ri]));
  fs.writeFileSync(path.join(outDir, 'drop-stick-' + row.name.toLowerCase() + '.gif'), gif(frames, delays));
});
const allFrames = seq.rows[0].cels.map((_, ci) => {
  const cv = new Canvas(4 * GW * GS + 3 * 4, 2 * GH * GS + 4, [244, 246, 248]);
  seq.rows.forEach((row, ri) => {
    const f = frameOf(row, ci, GW, GH, boxes[ri]);
    const x0 = (ri % 4) * (GW * GS + 4), y0 = Math.floor(ri / 4) * (GH * GS + 4);
    for (let j = 0; j < f.h; j++) for (let k = 0; k < f.w; k++) {
      const q = (j * f.w + k) * 3; cv.set(x0 + k, y0 + j, [f.rgb[q], f.rgb[q + 1], f.rgb[q + 2]]);
    }
  });
  return cv;
});
fs.writeFileSync(path.join(outDir, 'drop-stick-all.gif'), gif(allFrames, delays));

// ---- SPA tables -----------------------------------------------------------------------------------------------
const L = [];
const tab = (name, comment, flags, lines) => {
  L.push(name + '\t=\t*-SPAlist\t\t\t;' + comment, name + '_table:', '.t\t\t\t\t\t\t\t\t;offset to each direction of animation (0-7)');
  for (let d = 0; d < 8; d++) L.push('\tdc.w\t.' + d + '-.t');
  L.push('\tdc.w\t' + flags, '');
  for (let d = 0; d < 8; d++) L.push('.' + d + '\tdc.w\t' + lines(d).map(([f, t]) => f + ',' + t).join(','));
  L.push('');
};
const nb = (d, k) => 'SPFnostick+' + (d * 8 + k);
const ns = (d, k) => 'SPFloosestick+' + (d * 3 + k);
L.push(';\tDrop stick and go back for it. Generated by tools/build-dropstick.js from ' + src.label + '.',
  ';\tAppend to frames94.asm after the last SPA table. SPFnew is the first frame number after the retail player',
  ';\tsheet (the new frames are added to Sprites.anim in this order). Timing follows SPAskatewp (10), SPAstop (4)',
  ';\tand SPAsweepchk (4/8). Facing numbers are dirtab\'s: 0 north, clockwise.',
  ';',
  ';\tSPFnostick: 8 frames per facing, the retail frame with the stick taken out:',
  ';\t  +0 glide (SPFskatewp+5d), +1..+4 stride (SPFskatewp+5d+1..4), +5,+6 stop (SPFstop+2d..), +7 reach (SPFsweep+2d)',
  ';\tSPFloosestick: 3 frames per facing d (the facing the stick was dropped in), a separate object drawn at the',
  ';\tblade heel and sorted by y with the players: +0 standing on its blade, +1 falling, +2 flat on the ice.',
  ';\tThe player is then picked up with SPAgetstick in facing d+4, standing where SPFsweep+2(d+4) puts its',
  ';\tblade (its hotspot) on the heel. The flat stick lies exactly under that frame\'s stick.',
  '',
  'SPFnostick\t=\tSPFnew\t\t\t\t; ' + bodies.length + ' frames (stickless skater)',
  'SPFloosestick\t=\tSPFnostick+' + bodies.length + '\t\t; ' + sticks.length + ' frames (dropped stick object)',
  '');
tab('SPAdropstick', 'stick slips: blade catches, player skates on empty-handed (facing kept)', 0,
  (d) => [['SPFskatewp+' + (5 * d + 1), 10], [nb(d, 2), 6], [nb(d, 3), 6], [nb(d, 4), 8], [nb(d, 0), -10]]);
tab('SPAstickfall', 'the dropped stick object: stands, falls, lies (facing = facing it was dropped in)', 0,
  (d) => [[ns(d, 0), 6], [ns(d, 1), 6], [ns(d, 2), -8]]);
tab('SPAstopnostick', 'scrape stop without a stick (as SPAstop)', 1, (d) => [[nb(d, 5), 4], [nb(d, 6), -4]]);
tab('SPAskatenostick', 'skating without a stick (as SPAskatewp)', 0,
  (d) => [[nb(d, 1), 10], [nb(d, 2), 10], [nb(d, 3), 10], [nb(d, 4), -10]]);
tab('SPAglidenostick', 'gliding without a stick (as SPAglide)', 0, (d) => [[nb(d, 0), -8]]);
tab('SPAgetstick', 'bend to the stick, grab it (retail sweep pose), stick down (retail glide)', 0,
  (d) => [[nb(d, 7), 6], ['SPFsweep+' + 2 * d, 8], ['SPFskatewp+' + 5 * d, -10]]);
fs.writeFileSync(path.join(outDir, 'dropstick94.asm'), L.join('\n'));

// ---- JSON: hardware sprites -----------------------------------------------------------------------------------
const hex = (u8) => Buffer.from(u8).toString('hex');
fs.writeFileSync(path.join(outDir, 'dropstick.json'), JSON.stringify({
  source: src.label,
  palette: { line2: team, colours: PAL.map((c) => c.slice()) },
  note: 'x, y: offset of each VDP sprite from the player position (sticks: from the blade heel). sizeIndex as SIZE_TAB in lib/anim.js. tiles: 32-byte 4bpp tiles, column-major within the sprite.',
  retailLimits: { tiles: retailMaxTiles, sprites: retailMaxPieces, width: retailMaxW, height: retailMaxH, cutTiles: cutMaxTiles, cutSprites: cutMaxPieces },
  frames: newFrames.map((f) => ({
    id: f.id, symbol: f.sym, kind: f.kind, name: f.name, facing: NAMES[f.dir], from: f.from || null, angle: f.angle || null,
    file: f.file, tiles: f.split.tileCount, sprites: f.split.pieces.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h, sizeIndex: p.sizeIndex, palette: p.palette, tiles: p.tiles.map(hex) }))
  })),
  rows: seq.rows.map((row) => ({
    facing: row.name, back: row.back, heel: row.heel, grabAt: row.grabAt,
    steps: row.cels.map((c) => ({ step: c.id, vblanks: TIME[c.id], player: c.retail ? { retail: c.frame } : { new: bodyId.get(c.frame), from: c.frame }, at: c.at,
      stick: c.stick ? { new: stickId.get(row.d + ':' + c.stick.angle), angle: c.stick.angle, at: c.stick.at } : null }))
  }))
}, null, 1));

console.log('source:', src.label);
console.log('new frames:', bodies.length, 'bodies,', sticks.length, 'stick; max tiles', mx(newFrames, (f) => f.split.tileCount), '(retail', retailMaxTiles + ')');
console.log('wrote', path.relative(ROOT, outDir));
