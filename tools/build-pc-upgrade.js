#!/usr/bin/env node
/**
 * Upgrade Genesis player frames to the NHL 94 / 95 PC colour standard:
 *   - NHLPA Hockey '93 (Genesis): the fight frames (gloves 353, fight 354-370, bloody fight injury 371-376) and the
 *     bloody check injury (633-644);
 *   - NHL Hockey '94 (Genesis): the injury frames (fight injury 371-376, check injury 641-652), with the ones whose
 *     pixels differ from NHLPA 93's marked as '94's own.
 *
 *   node tools/build-pc-upgrade.js [--rom93 file|dir] [--rom94 file|dir] [--pc dir] [--teams bos,mtl,chi]
 *                                  [--shade pc|genesis] [--out docs/genesis-to-pc]
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
const shade = opt('--shade', 'pc');
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
  return { out: t.out, method: 'from PC frame ' + pcFrame.n, overlap: t.overlap, fromPc: t.fromPc, total: t.total, info: seg.info };
}

// ---- drawing ---------------------------------------------------------------------------------------------------
const SC = 3;
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
    ['NHL 94 GENESIS SKATING FRAMES UPGRADED BY THE SEGMENTER (NO PC DATA USED FOR THEM), NEXT TO NHL 94 PC\'S OWN VERSION OF THE SAME FRAME.',
      'BOTH COLOURED THROUGH THE RETAIL NHL ' + jerseys.game + ' PC BOSTON JERSEY RECORDS. BODY-PART AGREEMENT WITH THE PC FRAME: ' + agree + ' / ' + total + ' TEAM PIXELS (' + Math.round(100 * agree / total) + '%).',
      'SHADING: ' + (shade === 'pc' ? 'PC RIM LIGHT FROM SCREEN RIGHT' : 'GENESIS TONES') + '. SOURCE: PUBLIC/SKATERS-DATA.JS (RETAIL NHL 94 GENESIS AND NHL 94 PC FRAMES).'],
    ['GENESIS (BOS HOME)', 'UPGRADED BOS HOME', 'RETAIL PC BOS HOME', 'UPGRADED BOS AWAY', 'RETAIL PC BOS AWAY'], rows, 'validation-skating.png');
}

// ---- 2. The Genesis frames ---------------------------------------------------------------------------------------
function writeFrame(dir, name, gen, out, pal) {
  fs.mkdirSync(path.join(outDir, dir), { recursive: true });
  fs.writeFileSync(path.join(outDir, dir, name + '.png'), Buffer.from(Img.encodePng8(gen.w, gen.h, out, pal, { transparent: [255] })));
}

function runSet(tag, title, groups, src, genTeam, pcOf) {
  const rows = [], log = [];
  const pals = teamCodes.flatMap((code) => ['home', 'away'].map((side) => ({ code, side, pal: pcPalette(code, side) })));
  for (const [group, frames] of Object.entries(groups)) {
    for (const n of frames) {
      const gen = src.frame(n);
      if (!gen) { log.push({ n, group, missing: true }); continue; }
      const genPal = genTeam(teamCodes[0]);
      const pcFrame = pcOf ? pcOf(n) : null;
      const up = upgrade(gen, genPal, pcFrame);
      const cells = [{ w: gen.w, h: gen.h, px: gen.px, pal: genPal, empty: 0 }]
        .concat(pals.map((p) => ({ w: gen.w, h: gen.h, px: up.out, pal: p.pal, empty: 255 })));
      if (pcGame) cells.push(pcFrame ? { w: pcFrame.w, h: pcFrame.h, px: pcFrame.px, pal: pals[0].pal, empty: 255 } : null);
      const extra = groups.exclusive && groups.exclusive.includes(n) ? ' (94 ONLY)' : '';
      rows.push({ label: [group.toUpperCase() + ' #' + n + extra, up.method.toUpperCase()], cells });
      for (const p of pals) writeFrame(tag, tag + '-' + n + '-' + p.code + '-' + p.side, gen, up.out, p.pal);
      log.push({ n, group, method: up.method, overlap: up.overlap, fromPc: up.fromPc, teamPixels: up.total, size: [gen.w, gen.h] });
    }
  }
  const headers = ['GENESIS (' + teamCodes[0].toUpperCase() + ' HOME)'].concat(pals.map((p) => p.code.toUpperCase() + ' ' + p.side.toUpperCase())).concat(pcGame ? ['RETAIL PC (IF ANY)'] : []);
  sheet(title, ['EVERY GENESIS PIXEL KEPT IN PLACE; COLOURS FROM THE RETAIL NHL ' + jerseys.game + ' PC JERSEY RECORDS (6-BIT VGA), ' + (shade === 'pc' ? 'PC RIM-LIGHT SHADING' : 'GENESIS TONES') + '.',
    'SOURCE: ' + path.basename(src.file) + '. NO NHL 92 DATA.'], headers, rows, tag + '-sheet.png');
  return log;
}

if (rom93) {
  report.sources.nhlpa93 = { file: path.basename(rom93.file), rev: rom93.rev };
  const genTeam = (code) => rom93.palette(Math.max(0, S.TO93 ? rom93.teams.indexOf(code.toUpperCase()) : 0), true);
  report.nhlpa93 = runSet('nhlpa93-fight', 'NHLPA HOCKEY \'93 FIGHTS AT THE PC STANDARD',
    { gloves: S.FRAMES93.gloves, fight: S.FRAMES93.fight, 'fight injury': S.FRAMES93.fightInjury, 'check injury': S.FRAMES93.checkInjury },
    rom93, genTeam, null);
}
if (rom94) {
  report.sources.nhl94 = { file: path.basename(rom94.file) };
  // '94's own: the injury frames whose pixels differ from NHLPA 93's same picture.
  const exclusive = [];
  if (rom93) {
    for (const n of S.FRAMES94.fightInjury.concat(S.FRAMES94.checkInjury)) {
      const a = rom94.frame(n), b = rom93.frame(S.TO93(n));
      const same = b && a.w === b.w && a.h === b.h && a.px.every((v, i) => v === b.px[i]);
      if (!same) exclusive.push(n);
    }
  }
  report.nhl94Exclusive = rom93 ? exclusive : 'needs the NHLPA 93 ROM to compare';
  const genTeam = (code) => rom94.palette(code, true);
  const pcOf = pcGame ? (n) => { const m = S.TOPC(n); return m ? pcGame.frame(m) : null; } : null;
  report.nhl94 = runSet('nhl94-injury', 'NHL HOCKEY \'94 INJURIES AT THE PC STANDARD',
    { 'fight injury': S.FRAMES94.fightInjury, 'check injury': S.FRAMES94.checkInjury, exclusive },
    rom94, genTeam, pcOf);
}
report.missing = [!rom93 && 'NHLPA 93 Genesis ROM', !rom94 && 'NHL 94 Genesis ROM', !pcGame && 'NHL 94 PC or 95 PC game folder (optional: exact zones for the check injury)'].filter(Boolean);
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ validation: report.validation, sources: report.sources, exclusive: report.nhl94Exclusive, missing: report.missing }, null, 1));
