/** NHL 95 SNES: the unpacker, the jerseys and the player frames (lib/snes95.js). */
const assert = require('assert');
const path = require('path');
const S = require('../lib/snes95');
const { parseFrames } = require('../lib/parse-frames');
const { findRomIn, ROMS } = require('../lib/upstream-rom');
const fs = require('fs');

// The unpacker, on hand-made streams of each format. A set is the size word, the format word, then the stream; the game's
// pointer sits one byte before each command, so the first command is at +4 and a format 6 / 8 flag byte is at +4 too.
function set(size, format, bytes) {
  return Uint8Array.from([size & 255, size >> 8, format & 255, format >> 8, ...bytes]);
}
{
  // Format 0: 3 literals "ABC" (cmd 2), a copy of 3 bytes from output offset 0 ($83, word 0), then the end ($80).
  const a = S.unpack(set(6, 0, [0x02, 0x41, 0x42, 0x43, 0x82, 0x00, 0x00, 0x80, 0x00]), 0);
  assert.deepStrictEqual(Array.from(a.data), [0x41, 0x42, 0x43, 0x41, 0x42, 0x43]);
  assert.strictEqual(a.format, 0);
  // Format 2: "AB" then a copy of 2 bytes ((cmd & $7F) >> 2 = 1, plus 1) from 2 back, then the end.
  const b = S.unpack(set(4, 2, [0x01, 0x41, 0x42, 0x84, 0x02, 0x80, 0x00]), 0);
  assert.deepStrictEqual(Array.from(b.data), [0x41, 0x42, 0x41, 0x42]);
  // Format 4: the same with a 3-bit shift: cmd $88 copies (8 >> 3) + 1 = 2 bytes.
  const c = S.unpack(set(4, 4, [0x01, 0x41, 0x42, 0x88, 0x02, 0x80, 0x00]), 0);
  assert.deepStrictEqual(Array.from(c.data), [0x41, 0x42, 0x41, 0x42]);
  // Format 6: flags $02 (item 0 clear, item 1 set, item 2 clear): a literal run of 2 "AB", a copy of 3 from 2 back, the end.
  const d = S.unpack(set(5, 6, [0x02, 0x02, 0x41, 0x42, 0x00, 0x02, 0x00]), 0);
  assert.deepStrictEqual(Array.from(d.data), [0x41, 0x42, 0x41, 0x42, 0x41]);
}

const romPath = findRomIn(['/tmp/snes/95', path.join(__dirname, '..', 'roms')], ROMS.nhl95snes);
if (!romPath) {
  console.log('snes95: no NHL 95 SNES ROM (set up /tmp/snes/95 or roms/); the ROM checks are skipped');
} else {
  const rom = fs.readFileSync(romPath);
  // TeamPalettes: format 2, $380 bytes, ends at $C0027E.
  const pal = S.unpackAt(rom, 0xC00000);
  assert.strictEqual(pal.format, 2);
  assert.strictEqual(pal.data.length, 0x380);
  assert.strictEqual(pal.data.length, pal.size);
  assert.strictEqual(S.offsetOf(0xC0027E), pal.end);
  assert.strictEqual(S.teamPalettes(rom).length, 28);
  const jerseys = S.uniformPalettes(rom);
  assert.strictEqual(jerseys.length, 56);
  assert.ok(jerseys.some((p) => p.name === 'NYIh.snespal') && jerseys.some((p) => p.name === 'ANHv.snespal'));
  assert.ok(jerseys.every((p) => p.colors.length === 16));
  // The frames: skating frames draw, and the goalie and the puck flip are there.
  const drawn = S.parse95(rom);
  assert.strictEqual(drawn.numFrames, 1059);
  let count = 0;
  for (let f = 0; f < 1060; f++) if (drawn.renderFrame(f)) count++;
  assert.strictEqual(count, 757);
  const skate = drawn.renderFrame(2);
  assert.ok(skate && skate.pixels.some((p) => p) && skate.width > 16 && skate.height > 16);
  assert.ok(skate.pixels.every((p) => !p || (p >> 4) === 2), 'sprite palette 2 is the jersey');
  assert.strictEqual(drawn.renderFrame(0), null);
  assert.strictEqual(drawn.renderFrame(1), null, "frame 1 is an empty slot");
  // The frame list names the game's own groups and its 59 sequences.
  const frames = parseFrames(fs.readFileSync(path.join(__dirname, '..', 'data', 'frames95snes.asm'), 'utf8'));
  assert.ok(frames.spfs.some((s) => s.name === 'SPFskate' && s.start === 1));
  assert.strictEqual(frames.anims.length, 59);
  const names = frames.anims.map((a) => a.name);
  for (const n of ['SPAskate', 'SPAglide', 'SPAgready', 'SPAgready2', 'SPAHold2', 'SPAwallin', 'SPAwallout', 'SPAfaceoff']) assert.ok(names.includes(n), n);
  // Every frame a sequence uses draws, unless the game draws it by code (the goal and the puck).
  const missing = new Set();
  for (const anim of frames.anims) {
    for (const dir of anim.directions || []) {
      for (const step of dir.steps || dir.frames || []) {
        const frame = step.frame != null ? step.frame : step[0];
        if (frame > 0 && !drawn.renderFrame(frame)) missing.add(frame);
      }
    }
  }
  assert.strictEqual(missing.size, 0, 'every frame the sequences use draws: ' + [...missing]);
  console.log('snes95: ' + count + ' frames draw; ' + missing.size + ' frames of the sequences do not (empty slots or code-drawn)');
  // Map sets (pictures): the LZSS decoder, 22 sets by the source's names; each renders, and the palette picks rows from the first used.
  const images = require('../lib/snes95-images');
  assert.strictEqual(images.length, 22);
  assert.ok(images.some((p) => p.id === 'HighScoreMap') && images.some((p) => p.label === 'Hart Memorial Trophy'));
  for (const im of images) {
    const set = S.readMapSet(rom, im.addr);
    assert.strictEqual(set.map.length, set.width * set.height * 2, im.id);
    const pic = S.renderMapSet(rom, im.addr).renderFrame(1);
    assert.strictEqual(pic.width, set.width * 8, im.id);
    assert.ok(pic.pixels.some((v) => v !== 0), im.id);
  }
  assert.strictEqual(S.readMapSet(rom, images.find((p) => p.id === 'HighScoreMap').addr).tiles.length, 0x1320);
}
console.log('snes95 ok');
