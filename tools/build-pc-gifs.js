#!/usr/bin/env node
/**
 * Animated GIFs of the PC-standard fight (NHLPA 93) and injury (NHL 94) sprites, played with the games' own SPA
 * tables (frames93.asm, frames94.asm) at game speed: a step of N vblanks shows for N + 1 (README, updateanim).
 *
 *   node tools/build-pc-gifs.js [--pc folder] [--out docs/genesis-to-pc]
 *
 * Needs the same files as build-pc-upgrade.js (the ROMs and the NHL 95 PC CD image in roms/). Frames are upgraded the same way: the PC sheet's own
 * version where it has one (the injury and the fall into it), the learned zones otherwise (the fight).
 *
 * The fight: every NHLPA 93 fight frame faces right. Facings 0-2 use 357-361 and facings 3-7 use 362-366, so the
 * bout puts a facing-0 fighter on the left and a facing-4 fighter on the right, the right one mirrored with the
 * Genesis sprite flip (pixels unchanged) to face him. The beats are 93's own animations in order: SPAfight (gloves
 * off, and the dropped gloves and sticks of frame 353 appear), SPAfgrab / SPAfheld, then punches (SPAfhigh, SPAflow)
 * answered by SPAfhith / SPAfhitl, and the loser goes down with SPAfinjury (93's bloody fight injury).
 * The injury: NHL 94's SPAinjury1, both variants (facings 0-2 and 7: 273-275 then 641-646; facings 3-6: 289-291
 * then 647-652), for each team.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const S = require('./pcupgrade/sources');
const { segment } = require('./pcupgrade/segment');
const { transfer } = require('./pcupgrade/transfer');
const J = require('../lib/pc-jersey');
const { parseFrames } = require('../lib/parse-frames');
const { Canvas, gif } = require('./dropstick/raster');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const outDir = path.resolve(ROOT, opt('--out', path.join('docs', 'genesis-to-pc')));
const rom93 = S.load93(opt('--rom93')), rom94 = S.load94(opt('--rom94')), pc = S.loadPc(opt('--pc'));
if (!rom93 || !rom94 || !pc) { console.error('needs the NHLPA 93 and NHL 94 Genesis ROMs and the NHL 95 PC CD image in roms/ (or the PC files in pc95/)'); process.exit(1); }
const base = S.pcBase();
const ICE = [216, 236, 244], INK = [24, 32, 48];
const SC = 2, HOLD_CAP = 120;           // long holds (200, 400, 900 vblanks) are cut to 2 s so the GIF loops

const spa = (file, name) => {
  const a = parseFrames(fs.readFileSync(path.join(ROOT, 'data', file), 'utf8')).anims.find((x) => x.name === name);
  return (dir) => a.directions[dir].steps.map((s) => ({ frame: s.frame, ticks: Math.min(s.ticks, HOLD_CAP) + 1 }));
};

function palette(code, side) {
  const file = pc.jersey[side];
  const t = file.teams.findIndex((x) => x.code === code);
  return J.spritePalette(file, t, base, side);
}

/** Upgraded frame n of a ROM: { w, h, x0, y0, px (PC sprite indices) }. */
const cache = new Map();
function upgraded(src, n, genPal, pcNumber) {
  const key = (src === rom93 ? '93:' : '94:') + n;
  if (cache.has(key)) return cache.get(key);
  const g = src.frame(n);
  const fixedPal = palette('bos', 'home');
  const fixed = (v) => {
    const c = genPal[v];
    let best = 0, bd = Infinity;
    for (let s = 0; s < 128; s++) { const p = fixedPal[s], d = (p[0] - c[0]) ** 2 * 3 + (p[1] - c[1]) ** 2 * 4 + (p[2] - c[2]) ** 2 * 2; if (d < bd) { bd = d; best = s; } }
    return best;
  };
  let out = segment({ w: g.w, h: g.h, px: g.px }, { fixed }).out;
  const p = pcNumber ? pc.frame(pcNumber) : null;
  if (p) out = transfer(g, p, out).out;
  const f = { w: g.w, h: g.h, x0: g.x0, y0: g.y0, px: out };
  cache.set(key, f);
  return f;
}

/** Draw a frame with its player position at (ox, oy) on the canvas, optionally mirrored about that point. */
function draw(cv, f, ox, oy, pal, flip) {
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    const v = f.px[y * f.w + x];
    if (v === 255) continue;
    const wx = flip ? -(f.x0 + x) - 1 : f.x0 + x, wy = f.y0 + y;
    cv.fill(ox + wx * SC, oy + wy * SC, SC, SC, pal[v]);
  }
}

/** Tracks: [{ steps: [{frame, ticks}], ... }] played together; returns [{ t, frames: [frame per track] }]. */
function timeline(tracks) {
  const times = new Set([0]);
  for (const tr of tracks) { let t = 0; for (const s of tr) { t += s.ticks; times.add(t); } }
  const end = Math.max(...tracks.map((tr) => tr.reduce((a, s) => a + s.ticks, 0)));
  const sorted = [...times].filter((t) => t < end).sort((a, b) => a - b);
  return sorted.map((t, i) => ({
    ticks: (sorted[i + 1] ?? end) - t,
    frames: tracks.map((tr) => { let acc = 0; for (const s of tr) { if (t < acc + s.ticks) return s.frame; acc += s.ticks; } return tr[tr.length - 1].frame; })
  }));
}
const cs = (ticks) => Math.max(2, Math.round(ticks * 100 / 60));

// ---- The fight ---------------------------------------------------------------------------------------------------
function fight(home, away) {
  const A = { code: home[0], side: home[1] }, B = { code: away[0], side: away[1] };
  const pal93 = (code) => rom93.palette(Math.max(0, rom93.teams.indexOf(code.toUpperCase())), true);
  const play = { fight: spa('frames93.asm', 'SPAfight'), grab: spa('frames93.asm', 'SPAfgrab'), held: spa('frames93.asm', 'SPAfheld'),
    high: spa('frames93.asm', 'SPAfhigh'), low: spa('frames93.asm', 'SPAflow'), hitH: spa('frames93.asm', 'SPAfhith'),
    hitL: spa('frames93.asm', 'SPAfhitl'), injury: spa('frames93.asm', 'SPAfinjury') };
  const wait = (frame, ticks) => [{ frame, ticks }];
  const a = 0, b = 4;                       // facing 0 (357-361) on the left, facing 4 (362-366) on the right
  const stand = { a: 357, b: 362 };
  // Beats: [left steps, right steps]; the shorter side holds its fighting stance. A punch lands 6 vblanks in.
  const beats = [
    [play.fight(a), play.fight(b)],
    [play.grab(a), play.held(b)],
    [play.high(a), wait(stand.b, 6).concat(play.hitH(b))],
    [wait(stand.a, 6).concat(play.hitL(a)), play.low(b)],
    [play.low(a), wait(stand.b, 6).concat(play.hitL(b))],
    [wait(stand.a, 6).concat(play.hitH(a)), play.high(b)],
    [play.high(a), wait(stand.b, 6).concat(play.injury(b))]
  ];
  const left = [], right = [];
  for (const [l, r] of beats) {
    const len = Math.max(l.reduce((s, x) => s + x.ticks, 0), r.reduce((s, x) => s + x.ticks, 0));
    const pad = (steps, stance) => { const t = steps.reduce((s, x) => s + x.ticks, 0); return t < len ? steps.concat(wait(stance, len - t)) : steps; };
    left.push(...pad(l, stand.a)); right.push(...pad(r, stand.b));
  }
  const tl = timeline([left, right]);
  const palA = palette(A.code, A.side), palB = palette(B.code, B.side);
  const gloves = upgraded(rom93, 353, pal93(A.code));
  const W = 150, H = 92, GAP = 28;           // GAP: the grab frames (358 / mirrored 363) just meet
  const frames = [], delays = [];
  let glovesDown = false;
  for (const step of tl) {
    const cv = new Canvas(W * SC, H * SC, ICE);
    const ox = (W / 2 - GAP / 2) * SC, oy = 62 * SC;
    if (step.frames[0] === 357 || glovesDown) glovesDown = true;
    if (glovesDown) draw(cv, gloves, (W / 2) * SC, oy + 6 * SC, palA, false);
    const fl = upgraded(rom93, step.frames[0], pal93(A.code)), fr = upgraded(rom93, step.frames[1], pal93(B.code));
    draw(cv, fr, ox + GAP * SC, oy, palB, true);
    draw(cv, fl, ox, oy, palA, false);
    cv.text(4, 4, (A.code + ' ' + A.side + ' v ' + B.code + ' ' + B.side).toUpperCase(), INK, 1);
    frames.push(cv); delays.push(cs(step.ticks));
  }
  const file = 'nhlpa93-fight-pc-' + A.code + '-' + B.code + '.gif';
  fs.writeFileSync(path.join(outDir, file), gif(frames, delays));
  return { file, frames: frames.length, seconds: +(delays.reduce((s, d) => s + d, 0) / 100).toFixed(1) };
}

// ---- The injury ----------------------------------------------------------------------------------------------------
function injury(teams) {
  const play = spa('frames94.asm', 'SPAinjury1');
  const variants = [play(0), play(4)];
  const tl = timeline(variants);
  const pcOf = (n) => (n >= 641 ? S.TOPC(n) : n);     // the fall frames have the same numbers on the PC sheet
  const CW = 64, CH = 92;
  const frames = [], delays = [];
  for (const step of tl) {
    const cv = new Canvas(variants.length * teams.length * CW * SC, CH * SC + 12, ICE);
    teams.forEach(([code, side], ti) => {
      const pal = palette(code, side);
      step.frames.forEach((n, vi) => {
        const f = upgraded(rom94, n, rom94.palette(code, side === 'home'), pcOf(n));
        const col = ti * variants.length + vi;
        draw(cv, f, (col * CW + CW / 2) * SC, 36 * SC + 12, pal, false);
      });
      cv.text(ti * variants.length * CW * SC + 4, 2, (code + ' ' + side).toUpperCase(), INK, 1);
    });
    frames.push(cv); delays.push(cs(step.ticks));
  }
  const file = 'nhl94-injury-pc.gif';
  fs.writeFileSync(path.join(outDir, file), gif(frames, delays));
  return { file, frames: frames.length, seconds: +(delays.reduce((s, d) => s + d, 0) / 100).toFixed(1) };
}

fs.mkdirSync(outDir, { recursive: true });
const made = [fight(['bos', 'home'], ['mtl', 'away']), fight(['chi', 'home'], ['nyr', 'away']),
  injury([['bos', 'home'], ['mtl', 'away'], ['chi', 'home']])];
console.log(JSON.stringify(made, null, 1));
