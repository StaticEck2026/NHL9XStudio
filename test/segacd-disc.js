/** lib/segacd-film.js (Sega CD .SEG movie pictures: the NHL HOCKEY '94 title) and lib/audio/segacd-cdda.js (CD music
 *  tracks beside the ISO). Synthetic data only: the retail files are not in the repo. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Film = require('../lib/segacd-film');
const Cdda = require('../lib/audio/segacd-cdda');

const be32 = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

// An 'SM' chunk, 2 x 1 tiles, one palette line: header, CRAM, table A (256 longs), table B (256 words), opcode stream, data.
function sm(ops, data, A, B) {
  const tables = [];
  const a = new Uint8Array(1024);
  (A || []).forEach((v, i) => a.set(be32(v), i * 4));
  const b = new Uint8Array(512);
  (B || []).forEach((v, i) => { b[i * 2] = v >> 8; b[i * 2 + 1] = v & 255; });
  const body = [].concat(
    [0x53, 0x4d, 0, 0], be32(12 + 32 + 4 + 2 * 32), [0, 2, 0, 1],
    new Array(32).fill(0),
    be32(1024), Array.from(a), be32(512), Array.from(b),
    be32(ops), data);
  tables.push(body);
  const out = new Uint8Array(tables[0]);
  // decoded size field: header 12 + palette 32 + tile data 2 * 32
  new DataView(out.buffer).setUint32(4, 12 + 32 + 64);
  return out;
}

const raw = Array.from({ length: 32 }, (_, i) => i);
// Tile 0 raw (01), tile 1 keep (00): opcode bits 0100 0000...
let f1 = Film.decodeSm(sm(0x40000000, raw), 0, null);
assert.strictEqual(f1.w, 2); assert.strictEqual(f1.h, 1); assert.strictEqual(f1.tiles.length, 64);
assert.deepStrictEqual(Array.from(f1.tiles.subarray(0, 32)), raw);
assert.deepStrictEqual(Array.from(f1.tiles.subarray(32)), new Array(32).fill(0), 'keep with no earlier frame is blank');
// Next frame: tile 0 keep (00), tile 1 keep (00): both carried from the frame before.
let f2 = Film.decodeSm(sm(0, []), 0, f1.tiles);
assert.deepStrictEqual(Array.from(f2.tiles), Array.from(f1.tiles), 'unchanged tiles carry forward');
// Tile 0 table A pairs (10): index pairs (1,2) x4; tile 1 table B (11): words 0102 0304 0506 0708 interleave.
const A = [0, 0x11223344, 0xaabbccdd];
const B = [0x0102, 0x0304, 0x0506, 0x0708];
const idx = [1, 2, 1, 2, 1, 2, 1, 2, 0, 1, 2, 3];
let f3 = Film.decodeSm(sm(0b1011 << 28, idx, A, B), 0, null);
assert.deepStrictEqual(Array.from(f3.tiles.subarray(0, 8)), [0x11, 0x22, 0xaa, 0xbb, 0x33, 0x44, 0xcc, 0xdd], 'table A pair: high words, then low words');
assert.deepStrictEqual(Array.from(f3.tiles.subarray(32, 40)), [1, 3, 5, 7, 2, 4, 6, 8], 'table B group: odd and even bytes');
// toJim: a raw map.jim of 2 tiles whose map names tiles 0 and 1 on palette line 0.
const jim = Film.toJim(f1);
assert.strictEqual(jim.length, 10 + 64 + 128 + 4 + 4);
const dv = new DataView(jim.buffer);
assert.strictEqual(dv.getUint32(0), 74); assert.strictEqual(dv.getUint32(4), 202); assert.strictEqual(dv.getUint16(8), 2);
assert.strictEqual(dv.getUint16(202), 2); assert.strictEqual(dv.getUint16(204), 1);
assert.strictEqual(dv.getUint16(206), 0); assert.strictEqual(dv.getUint16(208), 1);
assert.strictEqual(Film.TITLE_JIM_SIZE, 30606);
assert.strictEqual(Film.titleJim(null), null);

// --- CD tracks ---
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhl94cd-'));
try {
  const secs = (n, fn) => {
    const b = Buffer.alloc(n * Cdda.SECTOR);
    for (let i = 0; i < n * 588; i++) { const [l, r] = fn(i); b.writeInt16LE(l, i * 4); b.writeInt16LE(r, i * 4 + 2); }
    return b;
  };
  fs.writeFileSync(path.join(dir, "NHL '94 (USA) (Track 07).bin"), secs(160, (i) => (i < 150 * 588 ? [0, 0] : [1000, 3000])));
  fs.writeFileSync(path.join(dir, "NHL '94 (USA) (Track 02).bin"), secs(152, () => [10, 30]));
  fs.writeFileSync(path.join(dir, 'NHL95 (Track 03).bin'), Buffer.alloc(10));
  fs.writeFileSync(path.join(dir, "NHL '94 (USA).cue"), [
    'FILE "x (Track 02).bin" BINARY', '  TRACK 02 AUDIO', '    INDEX 00 00:00:00', '    INDEX 01 00:02:00',
    'FILE "x (Track 07).bin" BINARY', '  TRACK 07 AUDIO', '    INDEX 00 00:00:00', '    INDEX 01 00:01:74', ''].join('\r\n'));
  const tracks = Cdda.findTracks(dir);
  assert.deepStrictEqual(tracks.map((t) => t.track), [2, 7], 'finds the 94 tracks and ignores other games');
  const gaps = Cdda.pregaps(dir);
  assert.strictEqual(gaps.get(2), 150); assert.strictEqual(gaps.get(7), 149);
  assert.ok(Math.abs(Cdda.seconds(tracks[0], gaps.get(2)) - 2 * 588 * 4 / 176400 * 1) < 1e-9, 'seconds after the pregap');
  const pcm = Cdda.readMono(tracks[1], gaps.get(7));
  assert.strictEqual(pcm.readInt16LE(0), 0, 'pregap sector 149 is the first one kept (silence)');
  assert.strictEqual(pcm.readInt16LE(588 * 2), 2000, 'stereo mixed to mono');
  assert.strictEqual(pcm.length, (160 - 149) * 588 * 2);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('segacd-disc: SM pictures, title picture and CD tracks OK');
