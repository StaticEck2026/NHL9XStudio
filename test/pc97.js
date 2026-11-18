/** NHL 97 (PC): the game entry, the disc detection and the palette block after an 8-bit shape. */
const assert = require('assert');
const Games = require('../lib/games');
const Pc = require('../lib/pc95');

const game = Games.gameById('nhl97pc');
assert.ok(game && game.kind === 'pc97' && game.platform === 'pc' && game.title === 'NHL 97 (PC)');
assert.ok(Pc.isNhl97(['DATA/CDFILEI.VIV', 'GAMEDATA/UNI0001.VIV']));
assert.ok(Pc.isNhl97(['DATA/NHL9596.SEA']));
assert.ok(!Pc.isNhl97(['DATA/GAMEART.VIV', 'GAMEDATA/MENU1.ASF']));

// A SHPI bank with one 2 x 2 shape (code 0x7B, 8 bits) followed by a 0x24 palette block of 4 colours.
function u32(n) { return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]; }
const shape = [0x7B, 20, 0, 0, 2, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3];
const pal = [0x24, 0, 0, 0, 4, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9];
const body = shape.concat(pal);
const head = [0x53, 0x48, 0x50, 0x49].concat(u32(16 + 8 + body.length), u32(1), [0x47, 0x49, 0x4D, 0x58], [0x54, 0x45, 0x53, 0x54], u32(24));
const bytes = Uint8Array.from(head.concat(body));
const opened = Pc.openBytes(bytes);
assert.strictEqual(opened.shapes.length, 1);
const colors = opened.shapes[0].attachedPalette;
assert.ok(colors && colors.length === 256);
assert.deepStrictEqual(colors[0], [255, 0, 0]);
assert.deepStrictEqual(colors[3], [9, 9, 9]);
const image = Pc.openImageParts([{ name: 'x.fsh', data: bytes }], null, { rel: 'x.fsh' });
assert.deepStrictEqual(image.renderFrame(1).colors[1], [0, 255, 0]);
console.log('pc97 ok');

// NHL 97 PC .ASF songs: SCHl header, SCDl chunks of IMA ADPCM (stereo, one byte per frame).
{
  const asf = require('../lib/audio/pc96-asf');
  const fs = require('fs');
  const sample = '/mnt/user-data/uploads/CDs/NHL97/GAMEDATA/DIT40.ASF';
  const build = (frames) => {
    const hdr = Buffer.alloc(100); hdr.write('SCHl', 0); hdr.writeUInt32LE(100, 4); hdr.write('TMpl', 0x40);
    hdr[0x47] = 2; hdr.writeUInt16LE(22050, 0x4a);
    const ch = Buffer.alloc(20 + frames); ch.write('SCDl', 0); ch.writeUInt32LE(20 + frames, 4);
    ch.writeUInt32LE(frames, 8);
    return Buffer.concat([hdr, ch]);
  };
  const p = asf.parse(build(100));
  assert.ok(p && p.playable && p.rate === 22050 && p.channels === 2 && p.pcm.length === 400, 'SCHl parse');
  if (fs.existsSync(sample)) {
    const q = asf.parse(fs.readFileSync(sample));
    assert.strictEqual(q.pcm.length / 4, 230095, 'DIT40 length matches TMpl');
  }
}

// Sega CD speech PCM: sign-magnitude, 0xFF ends the sample.
{
  const pcm = require('../lib/audio/segacd-pcm');
  const out = pcm.decode(Uint8Array.from([0x80, 0x85, 0x05, 0xff, 0x90]));
  assert.deepStrictEqual(Array.from(out), [0, 5, 251], 'Sega CD PCM decode');
}
