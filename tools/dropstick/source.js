/**
 * The retail player sheet the drop-stick frames are cut from.
 *
 * NHL 94 Genesis: the retail ROM (roms/nhl94.bin, .md or .gen, or a path given on the command line), read with the
 * same sheet profile Studio uses (lib/games.js nhl94: frame table at $5DE7A, HotList at $A44C8, palettes at $59924).
 *
 * Without that ROM the builder falls back to the NHL 92 Sprites.anim bundled in test/fixtures. NHL 94's player sheet
 * keeps NHL 92's frame numbering for every skater frame this animation uses (frames94.asm: SPFskatewp 1, SPFstop 145,
 * SPFsweep 257, SPFduck 337 are the same numbers in frames.asm; the two sheets part ways at 371, where 94 adds
 * SPFfinjury). The builder prints which sheet it used and writes it into every output.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const anim = require(path.join(ROOT, 'lib', 'anim'));
const sheet = require(path.join(ROOT, 'lib', 'sheet'));
const R94 = require(path.join(ROOT, 'lib', 'rom94'));
const { parseFrames } = require(path.join(ROOT, 'lib', 'parse-frames'));
const { Cel } = require('./cel');

const NHL94_PROFILE = { record: '94', boundsAt: 2, sprites: 0x5DE7A, hotlist: 0xA44C8, palette: 0x59924 };

function findNhl94(explicit) {
  const names = explicit ? [explicit] : ['nhl94.bin', 'nhl94.md', 'nhl94.gen'].map((n) => path.join(ROOT, 'roms', n));
  for (const file of names) if (file && fs.existsSync(file)) return file;
  return null;
}

/** Load a sheet. Returns { label, game, frame(n) -> Cel, hot(n) -> [x, y], palettes, spf }. */
function load(romPath) {
  const romFile = findNhl94(romPath);
  let bank, label, game, framesAsm;
  if (romFile) {
    const rom = R94.open(fs.readFileSync(romFile));          // throws unless it is the retail NHL 94 ROM
    bank = sheet.parseSheet(rom.data, NHL94_PROFILE);
    label = 'NHL Hockey \'94 (Genesis) retail ROM player sheet';
    game = 'nhl94';
    framesAsm = 'frames94.asm';
  } else {
    bank = anim.parseAnim(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'ANIM-To-BMP', 'Sprites.anim')));
    label = 'NHL Hockey (92) Sprites.anim (same skater frame numbers as NHL 94; no NHL 94 ROM found in roms/)';
    game = 'nhl92';
    framesAsm = 'frames.asm';
  }
  const spf94 = parseFrames(fs.readFileSync(path.join(ROOT, 'data', 'frames94.asm'), 'utf8')).spfs;
  const spf = {};
  for (const s of spf94) spf[s.name] = s.start;
  const cache = new Map();
  return {
    label,
    game,
    framesAsm,
    numFrames: bank.numFrames,
    palettes: bank.palettes,
    spf,
    frame(n) {
      if (!cache.has(n)) cache.set(n, Cel.fromRender(anim.renderFrame(bank, n)));
      return cache.get(n).clone();
    },
    hot(n) { const f = bank.frames[n - 1]; return [f.hotspotX, f.hotspotY]; },
    meta(n) { return bank.frames[n - 1]; }
  };
}

module.exports = { load, NHL94_PROFILE };
