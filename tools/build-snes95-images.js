/**
 * Build lib/snes95-images.js: the NHL 95 (SNES) map sets (a map, its tiles and its colours, LZSS packed), by the NHL95SNES
 * source's names. Each src/data/gfx/*Map.asm is one set; its first incbin names the bank segment and offset of the map's
 * stream, and the set starts 7 bytes (the map chunk's header) before it. The ROM is checked at that address.
 *
 * Usage: node tools/build-snes95-images.js [path to an NHL95SNES clone]   (default /tmp/snes/95)
 */
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || process.env.SNES95 || '/tmp/snes/95';
const ROMPATH = [process.env.ROM95, path.join(SRC, 'lst', 'nhl95snes.sfc'), path.join(__dirname, '..', 'roms', 'nhl95snes.sfc')].find((f) => f && fs.existsSync(f));
const rom = fs.readFileSync(ROMPATH);
const dir = path.join(SRC, 'src', 'data', 'gfx');
const u16 = (o) => rom[o] | (rom[o + 1] << 8);

const AWARDS = { Vezina: 'Vezina Trophy', Selke: 'Frank J. Selke Trophy', ConnSmythe: 'Conn Smythe Trophy', Jennings: 'William M. Jennings Trophy', Hart: 'Hart Memorial Trophy', ArtRoss: 'Art Ross Trophy', Norris: 'James Norris Memorial Trophy', Presidents: 'Presidents Trophy' };
const GROUPS = { HighScore: 'Screens', VisualConcepts: 'Screens', TitleGoalie: 'Screens', TitleLogo: 'Screens', TitlePlayers: 'Screens', MenuBack: 'Screens', PauseScreen: 'Screens', PadButtons: 'Screens', PlayoffBracket: 'Screens', TeamNameBars: 'Screens', StanleyCup: 'Screens', FaceOff: 'Screens', IceRink: 'Ice', Refs: 'Ice' };

const out = [];
for (const f of fs.readdirSync(dir).filter((n) => /Map\.asm$/.test(n)).sort()) {
  const name = f.replace(/Map\.asm$/, '');
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  const m = /incbin "[^"]*bank(C[0-9A-F])_([0-9A-F]+)\.bin":\$([0-9A-F]+)/.exec(text);
  if (!m) throw new Error(f + ': no incbin');
  const addr = (parseInt(m[1], 16) << 16) | (parseInt(m[2], 16) + parseInt(m[3], 16) - 7);
  const off = (parseInt(m[1], 16) - 0xC0) * 0x10000 + (addr & 0xFFFF);
  if (rom[off + 4] !== 0x8C || off + 2 + u16(off) >= rom.length) throw new Error(f + ': not a map chunk at ' + addr.toString(16));
  const base = name.replace(/Pic$/, '');
  const award = AWARDS[base];
  const label = (award ? award : name.replace(/([a-z])([A-Z])/g, '$1 $2'));
  out.push({
    id: name + 'Map',
    label,
    group: award ? 'Awards' : (GROUPS[name] || 'Screens'),
    kind: 'snes95-set',
    addr,
    fileNames: [name + 'Map', name === 'Refs' ? 'RefTiles' : name + 'Tiles', name === 'Refs' ? 'RefPalette' : name + 'Palette']
  });
}

// (Packed sets start 4 bytes, the size and format words, before their first incbin.)
// The SNES address of the first incbin of a source file (the stream's start; later incbins continue it).
function addrOf(file) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  const m = /incbin "[^"]*bank(C[0-9A-F])_([0-9A-F]+)\.bin"(?::\$?([0-9A-F]+))?/.exec(text);
  if (!m) throw new Error(file + ': no incbin');
  return (parseInt(m[1], 16) << 16) | (parseInt(m[2], 16) + (m[3] ? parseInt(m[3], 16) : 0));
}
// The SNES address of a dw / db list in a source file, found by its bytes in the ROM.
function findList(file) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  const bytes = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(dw|db)\s+([^;]+)/.exec(line);
    if (!m) continue;
    for (const v of m[2].split(',')) {
      const n = parseInt(v.trim().replace('$', '0x'), 16 * (v.includes('$') ? 1 : 0) || 10);
      if (m[1] === 'dw') bytes.push(n & 255, n >> 8); else bytes.push(n & 255);
    }
  }
  const at = rom.indexOf(Buffer.from(bytes));
  if (at < 0) throw new Error(file + ': list not found in the ROM');
  return 0xC00000 + at;
}
const TEAMS = ['ANH', 'BOS', 'BUF', 'CGY', 'CHI', 'DAL', 'DET', 'EDM', 'FLA', 'HFD', 'LA', 'MTL', 'NJ', 'NYI', 'NYR', 'OTW', 'PHI', 'PIT', 'QUE', 'SJ', 'STL', 'TB', 'TOR', 'VAN', 'WSH', 'WPG', 'ASE', 'ASW'];
const NAMES = { ANH: 'Anaheim', BOS: 'Boston', BUF: 'Buffalo', CGY: 'Calgary', CHI: 'Chicago', DAL: 'Dallas', DET: 'Detroit', EDM: 'Edmonton', FLA: 'Florida', HFD: 'Hartford', LA: 'Los Angeles', MTL: 'Montreal', NJ: 'New Jersey', NYI: 'Long Island', NYR: 'New York', OTW: 'Ottawa', PHI: 'Philadelphia', PIT: 'Pittsburgh', QUE: 'Quebec', SJ: 'San Jose', STL: 'St. Louis', TB: 'Tampa Bay', TOR: 'Toronto', VAN: 'Vancouver', WSH: 'Washington', WPG: 'Winnipeg', ASE: 'All-Star East', ASW: 'All-Star West' };
const OBJECTS = ['Sprite28', 'PadNumbers', 'Skater', 'RedDot', 'EASports', 'EALogoE', 'EALogoA', 'SportsWord', 'ElectronicWord', 'ItsIn', 'BlackBox', 'NHLShield', 'NHLPA'];
const more = [];
TEAMS.forEach((t, i) => more.push({ id: 'Logo' + t + 'Sprite', label: NAMES[t], group: 'Logos', kind: 'snes95-object', record: i, fileNames: ['Logo' + t + 'Sprite', 'Logo' + t + 'Frame', 'Logo' + t + 'Pieces', 'Logo' + t + 'Tiles'] }));
const OBJ_LABEL = { Sprite28: 'Symbols (arrows, shine, sparkle, copyright)', PadNumbers: 'Pad and numbers', Skater: 'Skater', RedDot: 'Red dot', EASports: 'EA Sports', EALogoE: 'EA logo E', EALogoA: 'EA logo A', SportsWord: 'Sports word', ElectronicWord: 'Electronic Arts word', ItsIn: 'It\'s in the game', BlackBox: 'Black box', NHLShield: 'NHL shield', NHLPA: 'NHLPA' };
OBJECTS.forEach((n, i) => {
  const base = n === 'ItsIn' ? 'ItsInThe' : n;
  more.push({ id: base + 'Sprite', label: OBJ_LABEL[n], group: n === 'Skater' || n === 'RedDot' || n === 'PadNumbers' || n === 'Sprite28' ? 'Sprites' : 'Screens', kind: 'snes95-object', record: 28 + i, fileNames: [base + 'Sprite', base + 'Frame', base + 'Pieces', base + 'Tiles'] });
});
// Tile sheets: a packed (size, format) set or raw tiles, with the palette that goes with it where the game has one.
const SHEETS = [
  ['ArrowFontTiles', 'Arrow Font', 'Fonts'], ['DigitFontTiles', 'Digit Font', 'Fonts'], ['MeterFontTiles', 'Meter Font', 'Fonts'],
  ['GradientBarTiles', 'Gradient Bars', 'Screens'], ['LinePieceTiles', 'Line Pieces', 'Screens'], ['WonCheckTiles', 'Won Check', 'Screens', 'WonCheckPalette']
  
];
for (const [name, label, group, pal] of SHEETS) {
  more.push(Object.assign({ id: name, label, group, kind: 'snes95-tiles', addr: addrOf(name + '.asm') - 4, packed: true, columns: 16, fileNames: [name] }, pal ? { palette: findList(pal + '.asm'), fileNames: [name, pal] } : {}));
}
for (const [name, label, gw, gh, bytes] of [['BoldFontGlyphs', 'Bold Font', 16, 8, 1472], ['ItalicFontGlyphs', 'Italic Font', 16, 16, 4672], ['ThinFontGlyphs', 'Thin Font', 16, 16, 2752]]) {
  more.push({ id: name, label, group: 'Fonts', kind: 'snes95-glyphs', addr: addrOf(name + '.asm'), gw, gh, bytes, columns: 16, fileNames: [name] });
}
more.push({ id: 'TeamNicknameTiles', label: 'Team Nicknames', group: 'Screens', kind: 'snes95-centerice', addr: addrOf('TeamNicknameTiles.asm') - 4, gridW: 10, gridH: 2, fileNames: ['TeamNicknameTiles'] });
more.push({ id: 'CenterIceTiles', label: 'Center Ice Logos', group: 'Ice', kind: 'snes95-centerice', addr: addrOf('CenterIceTiles.asm') - 4, palette: findList('CenterIcePalettes.asm'), fileNames: ['CenterIceTiles', 'CenterIcePalettes'] });
for (const t of TEAMS.slice(0, 26)) {
  more.push({ id: 'PlayerPhotos' + t, label: NAMES[t] + ' Player Photos', group: 'Players', kind: 'snes95-photos', palettes: addrOf('PhotoPalettes' + t + '.asm'), photos: addrOf('PlayerPhotos' + t + '.asm') - 4, fileNames: ['PlayerPhotos' + t, 'PhotoPalettes' + t] });
}
// Player frame groups outside the skaters (frames95s.asm): the controller stars, the replay cursor, the pucks, the nets, the goal light.
for (const [id, label, first, last, names] of [
  ['SPFpad', 'Pad Cursor', 0x6F, 0x6F, ['SPFpad']], ['SPFreplay', 'Replay Cursor', 0x72, 0x72, ['SPFreplay']],
  ['SPFpuck', 'Puck', 0x1B3, 0x1BD, ['SPFpuck']], ['SPFgoal', 'Goal', 0x1BE, 0x1BE, ['SPFgoal']], ['SPFSiren', 'Goal Light', 0x2BD, 0x2CA, ['SPFSiren']]
]) more.push({ id, label, group: 'Sprites', kind: 'snes95-frames', first, last, fileNames: names });
out.push(...more);
const HEX = ['addr', 'palette', 'palettes', 'photos'];
const lines = out.map((o) => '  {' + Object.keys(o).map((k) => k + ':' + (HEX.includes(k) ? '0x' + o[k].toString(16).toUpperCase() : JSON.stringify(o[k]).replace(/'/g, "\\'").replace(/"/g, "'"))).join(',') + '}');
fs.writeFileSync(path.join(__dirname, '..', 'lib', 'snes95-images.js'),
  '// Generated by tools/build-snes95-images.js from the NHL95SNES source. addr is the SNES address of each map set.\nmodule.exports = [\n' + lines.join(',\n') + '\n];\n');
console.log(out.length + ' sets');
