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
- **Sound effects:** `MAIN.BIN` has a GEMS-style 68000 sequencer (`SndSlotsTickAll`) feeding a Z80 FM driver (Z80 image at
  `MAIN.BIN $5E0C-$765C`, mailbox at Z80 `$0030`). Effect data: `SndEffectTable` (file `$863D`, 328 bytes), `SndEffectScripts`
  (`$8785`, 1,255 bytes, MIDI-like: `90` note on, `B0` controller, `C0` program, `E0` pitch bend, `FF` end) and
  `FmInstrumentPatches` (`$8C6C`, 36 bytes per patch). Not decoded or played yet. `lib/audio/nhl92-z80-harness.js` (with
  `ymTimers: true`) already runs a Z80 image against ymfm, so the likely route is a small 68000-side sequencer in JS that
  posts the same commands to the real Z80 image.
- **Stereo CD music:** the tracks are mixed to mono because the Audio player's clips are mono.
- **STARTER PCM bank** (`$BC64`): instrument waves for the PCM chip, not sound effects; not listed.
