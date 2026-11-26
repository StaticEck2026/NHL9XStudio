#!/usr/bin/env node
/**
 * Upgrade Genesis player frames to the NHL 94 / 95 PC colour standard:
 *   - NHLPA Hockey '93 (Genesis): the fight frames (gloves 353, fight 354-370, bloody fight injury 371-376) and the
 *     bloody check injury (633-644);
 *   - NHL Hockey '94 (Genesis): the injury frames (fight injury 371-376, check injury 641-652), with the ones whose
 *     pixels differ from NHLPA 93's marked as '94's own.
 *
 *   node tools/build-pc-upgrade.js [--rom93 file|dir] [--rom94 file|dir] [--pc dir] [--teams bos,mtl,chi]
 *                                  [--shade genesis|model] [--out docs/genesis-to-pc]
 *
 * ROMs are looked for in roms/ by default (any file name; each is checked against the retail checksums), the PC
 * game folder in pc94/ then pc95/. No NHL 92 data is read.
 *
 * Every Genesis pixel keeps its place. Each becomes a PC sprite index (docs/genesis-to-pc/PC-PALETTE.md): fixed
 * materials one to one, team colours a jersey zone and shade. A frame the PC sheet also has (the check injury) takes
 * its zones and shades from the PC frame (tools/pcupgrade/transfer.js); the others are segmented from the Genesis
 * art (tools/pcupgrade/segment.js). Colours then come from the retail HOMEPALS / AWAYPALS records: 6-bit VGA.
 *
 * Always written: validation-skating.png, the method checked on the retail skating frames (bundled in
 * public/skaters-data.js) against NHL 94 PC's own versions. With the ROMs: the upgraded sheets, every frame as an
 * 8-bit PNG in PC sprite colour space, and report.json.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const S = require('./pcupgrade/sources');
const { segment } = require('./pcupgrade/segment');
const { transfer, align } = require('./pcupgrade/transfer');
const Zs = require('./pcupgrade/zones');
const J = require('../lib/pc-jersey');
const Img = require('../lib/indexed-image');
const { Canvas } = require('./dropstick/raster');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const outDir = path.resolve(ROOT, opt('--out', path.join('docs', 'genesis-to-pc')));
const shade = opt('--shade', 'genesis');
const teamCodes = opt('--teams', 'bos,mtl,chi').split(',').map((s) => s.trim().toLowerCase());

const rom93 = S.load93(opt('--rom93'));
const rom94 = S.load94(opt('--rom94'));
const pcGame = S.loadPc(opt('--pc'));
const jerseys = pcGame ? { game: pcGame.game, home: pcGame.jersey.home, away: pcGame.jersey.away } : S.bundledJerseys();
const base = S.pcBase();

const INK = [24, 32, 48], DIM = [96, 112, 128], RULE = [176, 200, 212], PAPER = [244, 246, 248], ICE = [216, 236, 244];

/** The PC sprite palette (256 [r,g,b]) of a team code and side, from the jersey records. */
function pcPalette(code, side) {
  const file = jerseys[side];
  const t = file.teams.findIndex((x) => x.code === code);
  if (t < 0) throw new Error('no PC team ' + code + ' in ' + side + ' jerseys');
  return J.spritePalette(file, t, base, side);
}
const teamName = (code) => (jerseys.home.teams.find((x) => x.code === code) || { name: code }).name;

/** A Genesis pixel on palette lines 0-1 (blood, ice spray) -> the nearest fixed PC colour (sprite 0..127). */
function fixedMatcher(genPalette) {
  const pal = pcPalette(teamCodes[0], 'home');
  const cache = new Map();
  return (v) => {
    if (cache.has(v)) return cache.get(v);
    const c = genPalette[v];
    let best = 0, bd = Infinity;
    for (let s = 0; s < 128; s++) {
      const p = pal[s], d = (p[0] - c[0]) ** 2 * 3 + (p[1] - c[1]) ** 2 * 4 + (p[2] - c[2]) ** 2 * 2;
      if (d < bd) { bd = d; best = s; }
    }
    cache.set(v, best);
    return best;
  };
}

function upgrade(gen, genPalette, pcFrame) {
  const seg = segment({ w: gen.w, h: gen.h, px: gen.px }, { shade, fixed: fixedMatcher(genPalette) });
  if (!pcFrame) return { out: seg.out, method: 'segmented', info: seg.info };
  const t = transfer(gen, pcFrame, seg.out);
  // How the segmenter alone would have done on this frame: body part of each team pixel against the PC frame's.
  const a = align(gen, pcFrame);
  let agree = 0, count = 0;
  for (let i = 0; i < gen.px.length; i++) {
    const z = Zs.BY_INDEX.get(seg.out[i]); if (!z) continue;
    const X = (i % gen.w) + a.ox, Y = ((i / gen.w) | 0) + a.oy;
    const pz = X >= 0 && Y >= 0 && X < pcFrame.w && Y < pcFrame.h ? Zs.BY_INDEX.get(pcFrame.px[Y * pcFrame.w + X]) : null;
    if (!pz) continue;
    count++; if (Zs.part(pz.family) === Zs.part(z.family)) agree++;
  }
  return { out: t.out, method: 'from PC frame ' + pcFrame.n, overlap: t.overlap, fromPc: t.fromPc, total: t.total, segAgree: agree, segCount: count, info: seg.info };
}

// ---- drawing ---------------------------------------------------------------------------------------------------
const SC = 2;
function drawIndexed(cv, ox, oy, w, h, px, pal, empty) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = px[y * w + x];
    if (v === empty) continue;
    cv.fill(ox + x * SC, oy + y * SC, SC, SC, pal[v]);
  }
}

/** rows: [{ label, cells: [{ w, h, px, pal, empty, x0, y0 }] }], headers: column titles. */
function sheet(title, notes, headers, rows, file) {
  const cellW = Math.max(...rows.flatMap((r) => r.cells.map((c) => c ? c.w : 0))) * SC + 8;
  const cellH = Math.max(...rows.flatMap((r) => r.cells.map((c) => c ? c.h : 0))) * SC + 8;
  const left = 150, top = 70 + notes.length * 12 + 20;
  const width = Math.max(left + headers.length * (cellW + 6) + 10, Canvas.textWidth(title, 3) + 30, ...notes.map((n) => Canvas.textWidth(n) + 30));
  const cv = new Canvas(width, top + rows.length * (cellH + 8) + 10, PAPER);
  cv.text(14, 14, title, INK, 3);
  notes.forEach((n, i) => cv.text(14, 46 + i * 12, n, DIM, 1));
  headers.forEach((hd, i) => cv.text(left + i * (cellW + 6), top - 14, hd, INK, 1));
  rows.forEach((r, ri) => {
    const y = top + ri * (cellH + 8);
    r.label.forEach((l, k) => cv.text(14, y + 8 + k * 12, l, k ? DIM : INK, 1));
    r.cells.forEach((c, ci) => {
      const x = left + ci * (cellW + 6);
      cv.fill(x, y, cellW, cellH, ICE); cv.box(x, y, cellW, cellH, RULE);
      if (c) drawIndexed(cv, x + 4 + Math.floor((cellW - 8 - c.w * SC) / 2), y + 4 + Math.floor((cellH - 8 - c.h * SC) / 2), c.w, c.h, c.px, c.pal, c.empty);
    });
  });
  fs.writeFileSync(path.join(outDir, file), cv.png());
}

fs.mkdirSync(outDir, { recursive: true });
const report = { shade, jerseys: 'NHL ' + jerseys.game + ' PC ' + (pcGame ? pcGame.dir : 'bundled HOMEPALS94 / AWAYPALS94'), sources: {} };

// ---- 1. Validation on the retail skating frames ----------------------------------------------------------------
{
  global.window = global.window || {};
  require('../public/skaters-data.js');
  const D = global.window.NhlSkaterData;
  const G = D.find((x) => x.id === 'NHL 94'), P = D.find((x) => x.id === 'NHL 94 PC');
  const genPal = G.base.map((c) => c.slice());
  const bos = G.teams.find((t) => t.name === 'Bruinsh');
  for (let i = 0; i < 16; i++) genPal[32 + i] = bos.c[i].slice();
  const rows = [];
  let agree = 0, total = 0;
  G.frames.forEach((g, k) => {
    const gen = { n: k, w: g.w, h: g.h, x0: 0, y0: 0, px: Uint8Array.from(Buffer.from(g.px, 'base64')) };
    // The loading-screen copy swaps 0 and 255; put the retail meaning back.
    const pf = P.frames[k];
    const pcPx = Uint8Array.from(Buffer.from(pf.px, 'base64')).map((v) => (v === 0 ? 255 : v === 255 ? 0 : v));
    const pc = { n: k, w: pf.w, h: pf.h, x0: 0, y0: 0, px: pcPx };
    const seg = segment({ w: gen.w, h: gen.h, px: gen.px }, { shade });
    const a = align(gen, pc, 20);
    for (let i = 0; i < gen.px.length; i++) {
      const z = Zs.BY_INDEX.get(seg.out[i]); if (!z) continue;
      const x = i % gen.w, y = (i / gen.w) | 0, X = x + a.ox, Y = y + a.oy;
      const pv = X >= 0 && Y >= 0 && X < pc.w && Y < pc.h ? pc.px[Y * pc.w + X] : 255;
      const pz = Zs.BY_INDEX.get(pv); if (!pz) continue;
      total++; if (Zs.part(pz.family) === Zs.part(z.family)) agree++;
    }
    const cells = [{ w: gen.w, h: gen.h, px: gen.px, pal: genPal, empty: 0 }];
    for (const side of ['home', 'away']) {
      cells.push({ w: gen.w, h: gen.h, px: seg.out, pal: pcPalette('bos', side), empty: 255 });
      cells.push({ w: pc.w, h: pc.h, px: pc.px, pal: pcPalette('bos', side), empty: 255 });
    }
    rows.push({ label: ['SKATEWP E #' + (k + 2), 'OVERLAP ' + Math.round(a.overlap * 100) + '%'], cells });
  });
  report.validation = { frames: G.frames.length, partAgreement: +(agree / total).toFixed(3), teamPixels: total };
  sheet('GENESIS TO PC: CHECK ON THE RETAIL SKATING FRAMES',
    ['NHL 94 GENESIS SKATING FRAMES UPGRADED BY THE SEGMENTER (NO PC FRAME COPIED), NEXT TO NHL 94 PC\'S OWN VERSION OF THE SAME FRAME.',
      'BOTH COLOURED THROUGH THE RETAIL NHL ' + jerseys.game + ' PC BOSTON JERSEY RECORDS. BODY-PART AGREEMENT WITH THE PC FRAME: ' + agree + ' / ' + total + ' TEAM PIXELS (' + Math.round(100 * agree / total) + '%).',
      'SHADING: ' + (shade === 'model' ? 'LEARNED MODEL' : 'GENESIS TONES ON THE PC SHADE RAMPS') + '. THESE FOUR FRAMES ARE IN THE MODEL\'S TRAINING SET: SEE README FOR HELD-OUT SCORES.'],
    ['GENESIS (BOS HOME)', 'UPGRADED BOS HOME', 'RETAIL PC BOS HOME', 'UPGRADED BOS AWAY', 'RETAIL PC BOS AWAY'], rows, 'validation-skating.png');
}

// ---- 2. The Genesis frames ---------------------------------------------------------------------------------------
function writeFrame(dir, name, gen, out, pal) {
  fs.mkdirSync(path.join(outDir, dir), { recursive: true });
  fs.writeFileSync(path.join(outDir, dir, name + '.png'), Buffer.from(Img.encodePng8(gen.w, gen.h, out, pal, { transparent: [255] })));
}

/** Genesis frame -> its pixels in player-position space, line 3 folded onto line 2 (93 uses both for one skater). */
function pointsOf(f) {
  const m = new Map();
  f.px.forEach((v, i) => { if (v) m.set((f.x0 + (i % f.w)) + ',' + (f.y0 + ((i / f.w) | 0)), v >= 48 ? v - 16 : v); });
  return m;
}
const blank = (f) => !f || f.px.filter((v) => v).length <= 1;

/**
 * One sheet per set: a column per frame, a row per version (the Genesis original, then the upgrade through each PC
 * jersey, then the retail PC frame when the PC sheet has one).
 */
function runSet(tag, title, notes, frames, src, genPal, pcOf, labelOf) {
  const pals = teamCodes.flatMap((code) => ['home', 'away'].map((side) => ({ code, side, pal: pcPalette(code, side) })));
  const cols = [], log = [];
  for (const n of frames) {
    const gen = src.frame(n);
    const pcFrame = pcOf ? pcOf(n) : null;
    const up = upgrade(gen, genPal, pcFrame);
    cols.push({ n, gen, up, pcFrame });
    for (const p of pals) writeFrame(tag, tag + '-' + n + '-' + p.code + '-' + p.side, gen, up.out, p.pal);
    log.push({ n, method: up.method, overlap: up.overlap && +up.overlap.toFixed(3), fromPc: up.fromPc, teamPixels: up.total, segmenterAgreement: up.segCount ? up.segAgree + ' / ' + up.segCount : undefined, size: [gen.w, gen.h] });
  }
  const rows = [{ label: ['GENESIS', teamCodes[0].toUpperCase() + ' HOME'], cells: cols.map((c) => ({ w: c.gen.w, h: c.gen.h, px: c.gen.px, pal: genPal, empty: 0 })) }]
    .concat(pals.map((p) => ({ label: ['PC ' + p.code.toUpperCase(), p.side.toUpperCase()], cells: cols.map((c) => ({ w: c.gen.w, h: c.gen.h, px: c.up.out, pal: p.pal, empty: 255 })) })));
  if (cols.some((c) => c.pcFrame)) {
    rows.push({ label: ['RETAIL PC', 'FRAME, ' + teamCodes[0].toUpperCase() + ' HOME'], cells: cols.map((c) => (c.pcFrame ? { w: c.pcFrame.w, h: c.pcFrame.h, px: c.pcFrame.px, pal: pals[0].pal, empty: 255 } : null)) });
  }
  const headers = cols.map((c) => labelOf(c));
  sheet(title, notes.concat(['EVERY GENESIS PIXEL KEPT IN PLACE; COLOURS THROUGH THE RETAIL NHL ' + jerseys.game + ' PC JERSEY RECORDS (6-BIT VGA), ' +
    (shade === 'model' ? 'SHADES FROM THE LEARNED MODEL' : 'GENESIS TONES ON THE PC SHADE RAMPS') + '. SOURCE ROM: ' + path.basename(src.file).toUpperCase() + '. NO NHL 92 DATA.']), headers, rows, tag + '-sheet.png');
  return log;
}

if (rom93) {
  report.sources.nhlpa93 = { file: path.basename(rom93.file), rev: rom93.rev };
  const genPal = rom93.palette(Math.max(0, rom93.teams.indexOf(teamCodes[0].toUpperCase())), true);
  const frames = S.FRAMES93.gloves.concat(S.FRAMES93.fight, S.FRAMES93.fightInjury);
  report.nhlpa93 = runSet('nhlpa93-fight', 'NHLPA HOCKEY \'93 FIGHTS AT THE PC STANDARD',
    ['GLOVES ON THE ICE (353), THE FIGHT (354-370) AND THE BLOODY FIGHT INJURY (371-376). THE FIGHT AND INJURY ARE SEGMENTED FROM THE',
      'GENESIS ART (NO PC GAME HAS THESE PICTURES). BLOOD AND OTHER RINK-LINE PIXELS TAKE THE NEAREST FIXED PC COLOUR.'],
    frames, rom93, genPal, null, (c) => '#' + c.n + (c.n === 353 ? ' GLOVES' : c.n >= 371 ? ' INJ' : ''));
}
if (rom94) {
  report.sources.nhl94 = { file: path.basename(rom94.file) };
  const removed = S.FRAMES94.fightInjury.filter((n) => blank(rom94.frame(n)));
  report.nhl94Removed = { frames: '353-376', note: 'NHL 94 keeps the fight and fight-injury slots but blanks them (one pixel each)', blank: removed.length };
  const diffs = [];
  const pal94 = rom94.palette(teamCodes[0], true), pal93 = rom93 ? rom93.palette(0, true) : null;
  if (rom93) {
    for (const n of S.FRAMES94.checkInjury) {
      const A = pointsOf(rom94.frame(n)), B = pointsOf(rom93.frame(S.TO93(n)));
      let same = 0, recoloured = 0, added = 0, removedPx = 0;
      for (const [k, v] of A) { if (!B.has(k)) added++; else if (B.get(k) === v) same++; else recoloured++; }
      for (const k of B.keys()) if (!A.has(k)) removedPx++;
      // Blood: rink-line (0-1) pixels whose colour is red (NHLPA 93's 109,0,0 and 182,72,0).
      const red = (pal) => (v) => v >> 4 < 2 && pal[v][0] > pal[v][1] + 60 && pal[v][0] > pal[v][2] + 60;
      const blood93 = [...B.values()].filter(red(pal93)).length, blood94 = [...A.values()].filter(red(pal94)).length;
      diffs.push({ n, from93: S.TO93(n), same, recoloured, added, removed: removedPx, blood93, blood94, exclusive: recoloured + added + removedPx > 0 });
    }
  }
  report.nhl94Exclusive = rom93 ? diffs : 'needs the NHLPA 93 ROM to compare';
  const genPal = rom94.palette(teamCodes[0], true);
  const pcOf = pcGame ? (n) => { const m = S.TOPC(n); return m ? pcGame.frame(m) : null; } : null;
  const excl = new Set(diffs.filter((d) => d.exclusive).map((d) => d.n));
  report.nhl94 = runSet('nhl94-injury', 'NHL HOCKEY \'94 INJURY AT THE PC STANDARD',
    ['THE CHECK INJURY (SPFINJURY1, 641-652), 94\'S OWN REDRAW OF NHLPA 93\'S 633-644: ' + excl.size + ' OF 12 FRAMES DIFFER (BLOOD REMOVED, PIXELS RETOUCHED).',
      '94 BLANKS ITS FIGHT AND FIGHT-INJURY FRAMES (353-376), SO THESE ARE ITS INJURY SPRITES. ' +
      (pcGame ? 'ZONES FROM NHL ' + pcGame.game + ' PC\'S OWN FRAMES 633-644 (BOTTOM ROW).' : 'ZONES SEGMENTED FROM THE GENESIS ART (NO PC SHEET GIVEN).')],
    S.FRAMES94.checkInjury, rom94, genPal, pcOf, (c) => '#' + c.n + (excl.has(c.n) ? ' 94' : ''));
}
report.missing = [!rom93 && 'NHLPA 93 Genesis ROM', !rom94 && 'NHL 94 Genesis ROM', !pcGame && 'NHL 94 PC or 95 PC game folder (optional: exact zones for the check injury)'].filter(Boolean);
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ validation: report.validation, sources: report.sources, removed94: report.nhl94Removed, exclusive94: Array.isArray(report.nhl94Exclusive) ? report.nhl94Exclusive.map((d) => d.n + ':' + (d.recoloured + d.added + d.removed) + 'px blood ' + d.blood93 + '->' + d.blood94).join(' ') : report.nhl94Exclusive, missing: report.missing }, null, 1));
