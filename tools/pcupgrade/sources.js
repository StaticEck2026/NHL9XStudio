/**
 * The frames the PC upgrade reads. Nothing here touches NHL 92 data.
 *
 *  - NHLPA 93 Genesis ROM (lib/rom93.js, Rev 0 / A / B): the gloves (353), the fight (354-370), the bloody fight
 *    injury (371-376) and the check injury (633-644, SPFinjury1). Team colours from its own TeamList.
 *  - NHL 94 Genesis ROM (lib/rom94.js retail check, lib/sheet.js player sheet): the fight injury (371-376) and the
 *    check injury (641-652, SPFinjury1; 8 later than in 93 because SPFgready grew). Team colours from TeamList.
 *  - NHL 94 PC or NHL 95 PC game folder, or the NHL 95 PC CD image in roms/ (lib/pc95.js, lib/iso9660.js): the
 *    player sheet (PPV, 50 frames a file) and the jersey files HOMEPALS.BIN / AWAYPALS.BIN. Both PC sheets hold the check injury at 633-644 (frames94pc.asm / frames95pc.asm
 *    SPAinjury1), the PC versions of the Genesis frames above. Neither holds fight frames.
 *
 * A Genesis frame comes back as { n, w, h, x0, y0, px } with px[i] = palette line * 16 + colour (0 empty) and the
 * player position at (-x0, -y0). A PC frame as { n, w, h, x0, y0, px } with PC sprite indices, 255 empty.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const R93 = require(path.join(ROOT, 'lib', 'rom93'));
const R94 = require(path.join(ROOT, 'lib', 'rom94'));
const sheet = require(path.join(ROOT, 'lib', 'sheet'));
const anim = require(path.join(ROOT, 'lib', 'anim'));
const Pc = require(path.join(ROOT, 'lib', 'pc95'));
const J = require(path.join(ROOT, 'lib', 'pc-jersey'));

const NHL94_PROFILE = { record: '94', boundsAt: 2, sprites: 0x5DE7A, hotlist: 0xA44C8, palette: 0x59924 };

const FRAMES93 = {
  gloves: [353], fight: range(354, 370), fightInjury: range(371, 376), checkInjury: range(633, 644)
};
const FRAMES94 = { fightInjury: range(371, 376), checkInjury: range(641, 652) };
/** NHL 94 Genesis frame -> the same picture's number in NHLPA 93 and on the PC sheets. */
const TO93 = (n) => (n >= 641 ? n - 8 : n);
const TOPC = (n) => (n >= 641 && n <= 652 ? n - 8 : null);

function range(a, b) { const out = []; for (let n = a; n <= b; n++) out.push(n); return out; }

/** Look through files and folders for a ROM the reader accepts. */
function findRom(candidates, open) {
  for (const c of candidates.filter(Boolean)) {
    let files = [];
    try { files = fs.statSync(c).isDirectory() ? fs.readdirSync(c).map((n) => path.join(c, n)) : [c]; } catch (e) { continue; }
    for (const f of files) {
      if (!/\.(bin|md|gen|smd)$/i.test(f)) continue;
      // A cartridge is 512 KB or 1 MB (plus a 512-byte copier header): skip anything else, such as a CD image's .bin.
      let size = 0;
      try { size = fs.statSync(f).size; } catch (e) { continue; }
      if (![0x80000, 0x80200, 0x100000, 0x100200].includes(size)) continue;
      try { const rom = open(fs.readFileSync(f)); return { file: f, rom }; } catch (e) { /* not this one */ }
    }
  }
  return null;
}

function load93(where) {
  const hit = findRom([where, path.join(ROOT, 'roms')], (b) => R93.open(b));
  if (!hit) return null;
  const { rom } = hit;
  const frame = (n) => {
    const f = R93.decode(rom, n);
    return f ? { n, w: f.width, h: f.height, x0: f.x0, y0: f.y0, px: Uint8Array.from(f.pixels) } : null;
  };
  return {
    file: hit.file, rev: rom.rev, frame,
    teams: R93.TEAMS,
    /** 64 [r,g,b]: rink lines 0-1, team lines 2-3 (Genesis CRAM). */
    palette: (team, home) => R93.palette(rom, team, home)
  };
}

function load94(where) {
  const hit = findRom([where, path.join(ROOT, 'roms')], (b) => R94.open(b));
  if (!hit) return null;
  const { rom } = hit;
  const bank = sheet.parseSheet(rom.data, NHL94_PROFILE);
  const frame = (n) => {
    const r = anim.renderFrame(bank, n);
    return { n, w: r.width, h: r.height, x0: -r.offsetX, y0: -r.offsetY, px: Uint8Array.from(r.pixels) };
  };
  return {
    file: hit.file, frame, rom,
    /** 64 [r,g,b]: the sheet's own lines, line 2 replaced by the team's (TeamList), as the game loads them. */
    palette: (code, home) => {
      const base = bank.palettes.flat().map((c) => c.slice());
      const t = R94.teamColours(rom, code, home);
      if (t) for (let i = 0; i < 16; i++) base[32 + i] = t[i].map((v) => Math.round(v * 255 / 252));
      return base;
    }
  };
}

/**
 * The PC game: a folder (the one given, pc94/, pc95/) or, failing that, an NHL 94 / 95 PC disc image in roms/
 * (.iso, .img, .mdf, or a CD .bin: any name, found by its contents). Needs the player sheets (000_049.PPV ...) and
 * HOMEPALS.BIN / AWAYPALS.BIN. Returns { dir, game: '94' | '95', frame(n), jersey: { home, away } } or null.
 */
function loadPc(dir) {
  const fromFiles = (where, files) => {
    const sheets = files.filter((f) => { const r = Pc.rangeOf ? Pc.rangeOf(f.name) : null; return r ? r.kind === 'players' : /^\d{3}_\d{3}\.ppv$/i.test(f.name); });
    const home = files.find((f) => /^homepals\.bin$/i.test(f.name));
    const away = files.find((f) => /^awaypals\.bin$/i.test(f.name));
    if (!sheets.length || !home || !away) return null;
    const jersey = { home: J.openFile(home.read(), 'home'), away: J.openFile(away.read(), 'away') };
    const game = jersey.home.game;
    const bank = Pc.buildSpriteBank(sheets.map((f) => ({ name: f.name, data: f.read() })), 'players', game === '94' ? 'nhl94pc' : 'nhl95pc');
    return {
      dir: where, game, jersey,
      frame: (n) => {
        const f = bank.renderFrame(n);
        if (!f || !f.width) return null;
        return { n, w: f.width, h: f.height, x0: f.minX, y0: f.minY, px: Uint8Array.from(f.pixels) };
      }
    };
  };
  for (const d of [dir, path.join(ROOT, 'pc94'), path.join(ROOT, 'pc95')].filter(Boolean)) {
    let names;
    try { names = walk(d); } catch (e) { continue; }
    const got = fromFiles(d, names.map((f) => ({ name: path.basename(f), read: () => fs.readFileSync(f) })));
    if (got) return got;
  }
  const disc = findPcDisc();
  if (disc) {
    const got = fromFiles(path.relative(ROOT, disc.file), disc.iso.names().map((n) => ({ name: n.split('/').pop(), read: () => Buffer.from(disc.iso.read(n)) })));
    if (got) return got;
  }
  return null;
}

/** An NHL 94 / 95 PC disc image in roms/ (the data track: .iso, .img, .mdf, or a CD .bin), by its contents. */
function findPcDisc() {
  const roms = path.join(ROOT, 'roms');
  let names = [];
  try { names = fs.readdirSync(roms); } catch (e) { return null; }
  const iso9660 = require(path.join(ROOT, 'lib', 'iso9660'));
  for (const name of names) {
    if (!/\.(iso|img|mdf|bin)$/i.test(name)) continue;
    const file = path.join(roms, name);
    try { if (fs.statSync(file).size < 20 * 1024 * 1024) continue; } catch (e) { continue; }
    let iso = null;
    try { iso = iso9660.openFile(file); } catch (e) { iso = null; }
    if (!iso) continue;
    const list = iso.names().map((n) => n.split('/').pop().toUpperCase());
    if (list.includes('HOMEPALS.BIN') && list.includes('000_049.PPV')) return { file, iso };
    if (iso.close) iso.close();
  }
  return null;
}

function walk(d) {
  const out = [];
  for (const n of fs.readdirSync(d)) {
    const f = path.join(d, n);
    const st = fs.statSync(f);
    if (st.isDirectory()) out.push(...walk(f)); else out.push(f);
  }
  return out;
}

/** The PC jersey files without a game folder: the retail NHL 94 PC records bundled for the tests. */
function bundledJerseys() {
  const fx = path.join(ROOT, 'test', 'fixtures', 'pc-jersey');
  return { game: '94', home: J.openFile(fs.readFileSync(path.join(fx, 'HOMEPALS94.BIN')), 'home'), away: J.openFile(fs.readFileSync(path.join(fx, 'AWAYPALS94.BIN')), 'away') };
}

/** The sprite-space base palettes (EA-NHL-Tools PAL-To-ACT), as public/jed.js loads them. */
function pcBase() {
  const act = (f) => { const b = fs.readFileSync(path.join(ROOT, 'public', 'jed-pals', f)); const o = []; for (let i = 0; i < 256; i++) o.push([b[i * 3], b[i * 3 + 1], b[i * 3 + 2]]); return o; };
  return { jersey: act('createjerseyShadowfixed.act'), rink: act('rinkpalShadowfixed.act'), rinkPlain: act('rinkpal.act') };
}

module.exports = { load93, load94, loadPc, bundledJerseys, pcBase, FRAMES93, FRAMES94, TO93, TOPC, NHL94_PROFILE };
