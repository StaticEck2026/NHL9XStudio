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
  68000 sequencer (`SndSlotsTickAll`) and Z80 driver (Z80 image at `MAIN.BIN $5E0C-$765C`). What the disc shares with the
  cartridge is the effect ids (the game's `sfx` call posts the same numbers, id 4 is the horn), so the names are the
  cartridge's ("sfx whistle", "sfx pass1", ...), and the FM patch layout. `SndEffectTable` (file `$863C`: a word count, 79,
  then records of type, id and a big-endian length) lists the type 3 scripts (ids in the cartridge's numbering), then the 31
  type 0 FM patches. `SndEffectScripts` (`$877A`) holds the scripts back to back, each as long as its record says, each with a
  few header bytes and ending `$FF`. `FmInstrumentPatches` (`$8C6C`, 36 bytes each). A script is MIDI-like with a delta time
  after every event: `9n note vel duration`, `Bn 12 v` (channel type), `Cn program`, `En bend`, `FF` end. Channel type 0 is
  FM. **Channel type 1 is a sample channel on the RF5C164 PCM chip, never the PSG** (the disc writes no PSG data and no YM
  DAC data for effects; checked by injecting every id into the real disc in an emulator). Programs `$60-$6F` pick a sample from
  the bank at `GRAPH2.BIN $2D2000` (GTABLE record 96): `u16` count 13, 13 pairs of tag and length, then the samples
  (sign-magnitude bytes, `$FF` stops). The game copies the samples into the chip's wave RAM from pages `$01 $1B $1D $2B $30 $3A
  $40 $4C $4F $7E $AB $D3 $E1`, and the chip plays on to the first `$FF` (a sample with none runs into the next one). The disc sets
  FD to `$200 * 2^((note - reference note) / 12)` (the chip steps FD/`$800` bytes per 32,552 Hz tick, so `$200` is 8,138 Hz), ENV
  to twice the velocity and PAN to `$FF` (`$99` for the punch/check program 103). Programs: 96 puck pickup s7, 97 pass s2, 98
  backhand s1, 99 forehand s6, 100 s4, 101 s0, 102 boards s3, 103 punch/check s5, 107 boo s12, 108 oooh s10, 109 cheer s8, 110
  glass s9, 111 whistle s11. The cartridge's own samples are different recordings. The FM effects play through the ymfm YM2612
  with what was read from the disc's Z80 driver by recording every YM2612 write: the patch bytes go to `$30, $34, $38, ...` in
  order, carrier total level goes up by 19.3 steps per halving of the velocity, a note sounds 12 semitones above its number plus the
  patch's signed byte 28, a full bend is +-(patch byte 30) semitones (the horn 2, the siren 12), and one tick is one 60 Hz frame.
  Output is checked against emulator recordings of every effect (mean similarity of envelope, spectrum and length 0.66 before,
  0.94 after); the remaining differences are the FM envelopes and release (ymfm against the real chip) and the disc's Z80 driver
  is not run.
- **Stereo CD music:** the tracks are mixed to mono because the Audio player's clips are mono.
- **STARTER PCM bank** (`$BC64`): instrument waves for the PCM chip, not sound effects; not listed.

## Goalie license and loading screens (GRAPH2.BIN)

Two full-screen pictures sit in GRAPH2.BIN outside its own directory: the license screen at $DD800 (23,496 bytes) and the loading screen at $E33C8 (12,648 bytes). GTABLE.BIN lists them (6-byte records: u16 sector, u32 length; record 5 is sector 443). Both are stored uncompressed as u16 $0808, u16 tile count, the 4bpp tiles, 128 bytes of CRAM, u16 width, u16 height (40 x 28) and the name table. Studio wraps each with a 10 byte `.map.jim` header (`segacd-film.blobJim`).

## Team pages (GRAPH2.BIN, GTABLE records 68 to 95)

One record per team in TeamList order (68 is ANH, 78 is LA, 95 is ASW). GTABLE.BIN holds 6-byte entries (u16 sector, u32 length); the record sits at sector * 2048 in GRAPH2.BIN. It starts with three longs (the pictures' offsets, 12 and then each after the one before), followed by three stored pictures in the goalie-screen format: the team details page (name banner, crest, arena photo, NHLPA and NHL logos), the same page with an empty photo frame, and the video player frame (crest left and right, a black window of 18 x 11 tiles for the clip). The clips themselves are the 20 x 14 tile `SM` frames of the `.SEG` movies that `segacd-film.js` already decodes. `CD_TEAM_PAGES` in `lib/games.js` lists the offsets and sizes.

## Boot pictures (STARTER.BIN)

STARTER.BIN holds two uncompressed .map.jim pictures in the region the disassembly once called unused data: the title with credits at $5BD8 (18030 bytes, 40 by 28 tiles) and High Score Productions at $A942 (4896 bytes). Studio appends STARTER.BIN after HOCKEY.BIN to list them.

The 32 by 4 tile font at $A246 of STARTER.BIN (packed .map.jim) is listed as Boot font.
