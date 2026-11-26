/**
 * Every skater frame of the three sheets, each with its pixels and a body-zone label for every pixel.
 *
 * Sources (tools/pcupgrade/sources.js; nothing from NHL 92):
 *  - NHL 94 Genesis: the skater groups of frames94.asm (1-352, the penalty-box jump 377-383, catch, hook, stumble,
 *    flip, injury and glass bang 577-657).
 *  - NHLPA 93 Genesis: all its skater frames. Those identical to NHL 94's same picture take that frame's labels
 *    and say so (sameAs); the rest (the fight 353-376, the bloody check injury, the handful of frames 93 drew
 *    differently) are labelled on their own.
 *  - NHL 95 PC: its skater frames, including the animations 95 added (cup, face-off, anthem, line change, bench
 *    check, cheer, cross-check, board checks, shot blocks). Referees, goalies and UI are left out.
 *
 * Labels are NHL 94/95 PC sprite indices (tools/pcupgrade/zones.js): the PC frames carry them already; a Genesis
 * frame takes them from the PC sheet's own version of the picture where there is one (94 1-352 = PC 1-352, 94
 * 577-652 = PC 569-644), else from the learned zone model. A Genesis frame also keeps a hint per pixel of what its
 * own colour said (stick, skin, black...), which separates the stick from skin where the PC uses 136 for both.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const S = require('../pcupgrade/sources');
const { segment, CLASS } = require('../pcupgrade/segment');
const { transfer } = require('../pcupgrade/transfer');
const { parseFrames } = require('../../lib/parse-frames');

const ROOT = path.join(__dirname, '..', '..');
const GENESIS_SKATER = ['SPFskatewp', 'SPFskate', 'SPFturnl', 'SPFturnr', 'SPFswing', 'SPFstop', 'SPFskateb', 'SPFcelebrate',
  'SPFpump', 'SPFcup', 'SPFhipl', 'SPFhipr', 'SPFshoulderl', 'SPFshoulderr', 'SPFsweep', 'SPFfallback', 'SPFfallfwd',
  'SPFduck', 'SPFHold', 'SPFgloves', 'SPFfight', 'SPFfinjury', 'SPFPen', 'SPFcatch', 'SPFhook', 'SPFstumble', 'SPFflip',
  'SPFinjury1', 'SPFbglass'];
const PC_SKATER = ['SPFskatewp', 'SPFskate', 'SPFturnl', 'SPFturnr', 'SPFswing', 'SPFstop', 'SPFskateb', 'SPFcelebrate',
  'SPFpump', 'SPFcup', 'SPFhipl', 'SPFhipr', 'SPFshoulderl', 'SPFshoulderr', 'SPFsweep', 'SPFfallback', 'SPFfallfwd',
  'SPFduck', 'SPFHold', 'SPFcupaccept', 'SPFfaceoff', 'SPFanthem', 'SPFlinechange', 'SPFanthem2', 'SPFbench', 'SPFextra',
  'SPFcupskate', 'SPFbenchcheck', 'SPFcheer', 'SPFcrosscheck', 'SPFboards', 'SPFshotblock'];

function groups(file, names) {
  const spfs = parseFrames(fs.readFileSync(path.join(ROOT, 'data', file), 'utf8')).spfs;
  const out = [];
  for (const s of spfs) {
    if (!names.some((n) => n.toLowerCase() === s.name.toLowerCase())) continue;
    // Facing: groups laid out as eight runs of `stride` frames (or eight single frames) start at facing 0 = north.
    const stride = s.stride || 0;
    const eight = s.count === 8 * Math.max(1, stride);
    for (let k = 0; k < s.count; k++) {
      out.push({ n: s.start + k, group: s.name, facing: eight ? Math.floor(k / Math.max(1, stride)) : null, step: eight ? k % Math.max(1, stride) : k });
    }
  }
  return out;
}

/** Genesis colour class per pixel ('stick', 'skin', 'black', 'steel', 'shadow', team classes, 'other'). */
function hints(px) {
  return Array.from(px, (v) => (!v ? null : v >> 4 >= 2 ? CLASS[v & 15] || 'other' : 'other'));
}

/** Load everything. Returns { frames: [...], sources }. */
function loadAll(opts = {}) {
  const rom93 = S.load93(opts.rom93), rom94 = S.load94(opts.rom94), pc = S.loadPc(opts.pc);
  if (!rom94 || !rom93 || !pc) throw new Error('needs the NHL 94 and NHLPA 93 ROMs (roms/) and the NHL 95 PC files (pc95/)');
  const frames = [];
  const fixedFor = (genPal) => {
    const pal = require('../../lib/pc-jersey').spritePalette(pc.jersey.home, 0, S.pcBase(), 'home');
    const cache = new Map();
    return (v) => {
      if (cache.has(v)) return cache.get(v);
      const c = genPal[v]; let best = 0, bd = Infinity;
      for (let s = 1; s < 128; s++) { const p = pal[s], d = (p[0] - c[0]) ** 2 * 3 + (p[1] - c[1]) ** 2 * 4 + (p[2] - c[2]) ** 2 * 2; if (d < bd) { bd = d; best = s; } }
      cache.set(v, best); return best;
    };
  };
  const pal94 = rom94.palette('bos', true), pal93 = rom93.palette(0, true);
  const pcNumber = (n) => (n >= 1 && n <= 352 ? n : n >= 577 && n <= 652 ? n - 8 : null);
  const key = (f) => { const m = []; f.px.forEach((v, i) => { if (v) m.push((f.x0 + (i % f.w)) + ',' + (f.y0 + ((i / f.w) | 0)) + ':' + (v >= 48 ? v - 16 : v)); }); return m.join(';'); };

  function genesis(game, src, n, meta, genPal, pcN) {
    const g = src.frame(n);
    if (!g || g.px.filter((v) => v).length < 20) return null;
    let label = segment({ w: g.w, h: g.h, px: g.px }, { fixed: fixedFor(genPal) }).out, how = 'model';
    const p = pcN ? pc.frame(pcN) : null;
    if (p) { const t = transfer(g, p, label); if (t.overlap > 0.75) { label = t.out; how = 'pc ' + pcN; } }
    return Object.assign({ id: game + ':' + n, game, n, space: 'genesis', w: g.w, h: g.h, x0: g.x0, y0: g.y0, px: g.px, label, hint: hints(g.px), labelSource: how }, meta);
  }

  const seen94 = new Map();
  for (const m of groups('frames94.asm', GENESIS_SKATER)) {
    if (m.n >= 353 && m.n <= 376) continue;                     // blanked in NHL 94
    const f = genesis('94g', rom94, m.n, m, pal94, pcNumber(m.n));
    if (f) { frames.push(f); seen94.set(m.n, key(f)); }
  }
  for (const m of groups('frames93.asm', GENESIS_SKATER)) {
    const as94 = m.n >= 569 && m.n <= 644 ? m.n + 8 : m.n;      // 93 numbers SPFcatch .. SPFinjury1 8 lower (SPFgready grew)
    const g = rom93.frame(m.n);
    if (!g) continue;
    if (seen94.has(as94) && seen94.get(as94) === key(g)) {         // the same picture as 94's: same labels
      const twin = frames.find((x) => x.id === '94g:' + as94);
      frames.push(Object.assign({}, twin, m, { id: '93g:' + m.n, game: '93g', n: m.n, labelSource: 'same as ' + twin.id, sameAs: twin.id }));
      continue;
    }
    const f = genesis('93g', rom93, m.n, m, pal93, m.n <= 352 ? m.n : (m.n >= 569 && m.n <= 644 ? m.n : null));
    if (f) frames.push(f);
  }
  for (const m of groups('frames95pc.asm', PC_SKATER)) {
    const p = pc.frame(m.n);
    if (!p || !p.w) continue;
    const zones = p.px.filter((v) => v >= 144 && v < 192).length;
    if (zones < 15) continue;                                    // not a skater (arrows, crosshair, empty slots)
    frames.push(Object.assign({ id: '95pc:' + m.n, game: '95pc', n: m.n, space: 'pc', w: p.w, h: p.h, x0: p.x0, y0: p.y0, px: p.px, label: p.px, hint: null, labelSource: 'pc native' }, m));
  }
  // A palette to look at each source with: Boston home (64 Genesis colours, line 2 the jersey; 256 PC sprite colours).
  const palettes = { '94g': pal94, '93g': pal93, '95pc': require('../../lib/pc-jersey').spritePalette(pc.jersey.home, 0, S.pcBase(), 'home') };
  return { frames, palettes, sources: { nhl94: path.basename(rom94.file), nhlpa93: path.basename(rom93.file) + ' rev ' + rom93.rev, pc: 'NHL ' + pc.game + ' PC ' + pc.dir } };
}

module.exports = { loadAll, groups, GENESIS_SKATER, PC_SKATER };
