# NHL 94 Sega CD in Studio

Where each part of the disc shows up, and what is still open. Disc layout and names come from the disassembly in
NHL94Genesis (`src/segacd/`, `docs/segacd*.md`). Nothing from the disc is stored in this repo.

| Disc part | In Studio | Code |
| --- | --- | --- |
| `GRAPH2.BIN` + `HOCKEY.BIN` (ISO root) | Images, player sheet. The two files are joined; picture offsets are in `lib/genesis-images.js` (`nhl94cd`) | `lib/games.js`, `server.js` `readDiscFile`, `public/viewer.js` (Open file) |
| `HOCKEY.SEG` last frame | Images > Screens > Title (NHL HOCKEY '94). Decoded to a `.map.jim` and appended after HOCKEY.BIN (30,606 bytes at `3051520 + 184842`) | `lib/segacd-film.js` |
| `*.PCM` (ISO root) | Audio > speech (team names, All-Star calls, Ron Barr), RF5C164 sign-magnitude mono | `lib/audio/segacd-pcm.js` |
| CD-DA tracks 2-79 | Audio > CD music. Not on the ISO: track files next to it in `roms/` (`... (Track NN).bin`, optional `.cue` for pregaps), mixed to mono | `lib/audio/segacd-cdda.js`, `/api/games/nhl94cd/cdda` |

## Movies (.SEG)

`GOALnn`, `HITnn`, `STNLYnn`, `THNDRnn` and `HOCKEY.SEG` are FILM files: `FILM`, header length, `FDSC`, `STAB` (count, then
16-byte records: offset, length, time, duration). The video is an `SM` image (STARTER.BIN `LoadSmImage`): 12-byte header
(w and h in tiles at +8 and +10, palette lines = (flags & 3) + 1), CRAM lines, a 2-bit-per-tile palette-line map, table A
(256 longs), table B (256 words), 2 bits per tile of opcode (keep, raw, A pairs, B groups) and the tile data. Frames are
deltas: "keep" leaves the tile the earlier frame left in word RAM. HOCKEY.SEG is the intro (863 frames of 32 x 28 tiles; the
last 15 hold the title). Audio is interleaved in the same records (RF5C164 sign-magnitude) and is not decoded.

## Not found / not done

- **License screen:** no picture for it is in the disc data. The Sega license text (`PRODUCED BY OR UNDER LICENSE FROM SEGA
  ENTERPRISES, LTD.`) sits in the system area (IP) and is drawn by boot code; the game's own "Licensed by Sega Enterprises Ltd."
  is a text line in the title credits (`Credits` in `teamdata94cd.asm`).
- **Sound effects** (`lib/audio/segacd-sfx.js`, Audio, Sound effects): not the cartridge's sound engine. `MAIN.BIN` has its own
  68000 sequencer (`SndSlotsTickAll`) feeding its own Z80 driver (Z80 image at `MAIN.BIN $5E0C-$765C`, mailbox at Z80 `$0030`);
  none of the Z80 driver's code matches the cartridge's. What the disc shares with the cartridge is the effect ids (the game's
  `sfx` call posts the same numbers, id 4 is the horn) and the FM patch: the first 26 bytes of each 36-byte record are the
  cartridge's register layout. Data: `SndEffectTable` (file `$863D`, 82 records of length low byte, type, id, length high byte;
  type 3 is a script, type 0 a patch; the first three, ids `$26`, `$27` and the horn `$04`, have no script), `SndEffectScripts`
  (`$8785`, 1,255 bytes: the type 3 scripts in record order, each ended by `$FF` and three bytes; the table length is only the
  first block of the long slide, effect 6) and `FmInstrumentPatches` (`$8C6C`). A script is MIDI-like with a delta time after
  every event: `9n note vel duration` (duration is one or two bytes, bit 7 continues), `Bn 12 v` (0 FM, 1 PSG), `Cn program`
  (patch index), `En bend` (`$40` centre), `FF` end. Studio reads the scripts the way the sequencer does and plays them through
  the ymfm YM2612 with the disc's patches. It does not run the disc's Z80 driver, so the note table, envelopes and bend range
  are approximations, the PSG effects are a square wave, and a tick is taken as one frame (60 Hz). Running the real Z80 image
  (`lib/audio/nhl92-z80-harness.js`, `ymTimers: true`) with the queue commands the sequencer posts is the way to make them exact.
- **Stereo CD music:** the tracks are mixed to mono because the Audio player's clips are mono.
- **STARTER PCM bank** (`$BC64`): instrument waves for the PCM chip, not sound effects; not listed.

## Boot pictures (STARTER.BIN)

STARTER.BIN holds two uncompressed .map.jim pictures in the region the disassembly once called unused data: the title with credits at $5BD8 (18030 bytes, 40 by 28 tiles) and High Score Productions at $A942 (4896 bytes). Studio appends STARTER.BIN after HOCKEY.BIN to list them.

The 32 by 4 tile font at $A246 of STARTER.BIN (packed .map.jim) is listed as Boot font.
