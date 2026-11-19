/** Different people rip a Sega CD with different software: sheet dialects, one file per track or one for the disc, raw or WAVE
 *  music, renamed files, CloneCD, a bare ISO with loose tracks. Every layout below is built from synthetic data and must be found
 *  by its contents, give the data track and play the right audio. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Iso = require('../lib/iso9660');
const Find = require('../lib/segacd-find');
const Cdda = require('../lib/audio/segacd-cdda');
const Cue = require('../lib/cue');

const NAMES = ['GRAPH2.BIN', 'HOCKEY.BIN', 'STARTER.BIN'];
const cooked = Buffer.from(Iso.encode(NAMES.map((name) => ({ name, data: new Uint8Array(100).fill(7) }))));
const SECT = cooked.length / 2048;
const MUSIC = 40; // sectors of music per track
const GAP = 150;

function dataTrack(kind, lead) {
  const size = kind === 'cooked' ? 2048 : 2352;
  const head = kind === 'mode2' ? 24 : (kind === 'raw' ? 16 : 0);
  const out = Buffer.alloc((lead + SECT) * size);
  for (let s = 0; s < SECT; s++) cooked.copy(out, (lead + s) * size + head, s * 2048, (s + 1) * 2048);
  return out;
}
/** pregap silence then `n` sectors of constant stereo level t * 100 */
function audio(t, gap, n) {
  const b = Buffer.alloc((gap + n) * 2352);
  for (let i = gap * 588; i < (gap + n) * 588; i++) { b.writeInt16LE(t * 100, i * 4); b.writeInt16LE(t * 100, i * 4 + 2); }
  return b;
}
function wav(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(44100, 24); h.writeUInt32LE(176400, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
const msf = (f) => String(Math.floor(f / 4500)).padStart(2, '0') + ':' + String(Math.floor(f / 75) % 60).padStart(2, '0') + ':' + String(f % 75).padStart(2, '0');

function scenario(name, build, expect) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-'));
  try {
    const mk = (rel, data) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); return f; };
    build(mk, dir);
    const hit = Find.find(dir);
    assert.ok(hit, name + ': the disc is found');
    assert.ok(Iso.openFile(hit.dataFile) && Iso.openFile(hit.dataFile).names().indexOf('GRAPH2.BIN') >= 0, name + ': the data track opens');
    assert.strictEqual(hit.kind, expect.kind, name + ': kind');
    const tracks = hit.audio;
    assert.deepStrictEqual(tracks.map((t) => t.track), expect.tracks, name + ': track numbers');
    for (const t of tracks) {
      const gap = t.skip != null ? undefined : (expect.gap == null ? GAP : expect.gap);
      const secs = Cdda.seconds(t, gap);
      assert.ok(Math.abs(secs - MUSIC * 2352 / 176400) < 0.02, name + ': track ' + t.track + ' length ' + secs);
      const pcm = Cdda.readMono(t, gap);
      assert.strictEqual(pcm.readInt16LE(0), t.track * 100, name + ': track ' + t.track + ' starts at the music');
      assert.strictEqual(pcm.readInt16LE(pcm.length - 2), t.track * 100, name + ': track ' + t.track + ' ends in the music');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const TR = [2, 3, 4, 5];

// 1. Redump style: one .bin per track (pregap in each file), every INDEX 00/01 pair, CRLF.
scenario('redump', (mk) => {
  mk('Game (USA) (Track 01).bin', dataTrack('raw', 0));
  const lines = ['FILE "Game (USA) (Track 01).bin" BINARY', '  TRACK 01 MODE1/2352', '    INDEX 01 00:00:00'];
  TR.forEach((t) => {
    mk('Game (USA) (Track ' + String(t).padStart(2, '0') + ').bin', audio(t, GAP, MUSIC));
    lines.push('FILE "Game (USA) (Track ' + String(t).padStart(2, '0') + ').bin" BINARY', '  TRACK ' + String(t).padStart(2, '0') + ' AUDIO', '    INDEX 00 00:00:00', '    INDEX 01 00:02:00');
  });
  mk('Game (USA).cue', lines.join('\r\n') + '\r\n');
}, { kind: 'cue', tracks: TR });

// 2. One .bin for the whole disc (EAC, ImgBurn, CDRWIN): data, then each track with its pregap; LF endings, lower case, tabs, REM and FLAGS.
scenario('single bin', (mk) => {
  const parts = [dataTrack('raw', 0)];
  const lines = ['REM GENRE "Games"', 'REM COMMENT "ExactAudioCopy v1.5"', 'catalog 0000000000000', 'file "disc.bin" binary', 'track 01 mode1/2352', '\tindex 01 00:00:00'];
  let at = SECT;
  TR.forEach((t) => {
    lines.push('\ttrack ' + String(t).padStart(2, '0') + ' audio', '\t\tflags dcp', '\t\tindex 00 ' + msf(at), '\t\tindex 01 ' + msf(at + GAP));
    parts.push(audio(t, GAP, MUSIC));
    at += GAP + MUSIC;
  });
  mk('disc.bin', Buffer.concat(parts));
  mk('disc.cue', lines.join('\n') + '\n');
}, { kind: 'cue', tracks: TR });

// 3. Bare CR line endings, bare unquoted names with spaces, a BOM, MODE2/2352 data with a lead-in pregap.
scenario('old mac sheet', (mk) => {
  mk('My Disc.bin', Buffer.concat([dataTrack('mode2', 150), audio(2, GAP, MUSIC)]));
  mk('x.cue', '\ufeffFILE My Disc.bin BINARY\rTRACK 01 MODE2/2352\r  INDEX 00 00:00:00\r  INDEX 01 00:02:00\r  TRACK 02 AUDIO\r  INDEX 00 ' + msf(150 + SECT) + '\r  INDEX 01 ' + msf(150 + SECT + GAP) + '\r');
}, { kind: 'cue', tracks: [2] });

// 4. Absolute paths from another machine and backslashes in a subfolder.
scenario('foreign paths', (mk) => {
  mk('Rip/NHL/Track01.bin', dataTrack('raw', 0));
  mk('Rip/NHL/Track02.bin', audio(2, GAP, MUSIC));
  mk('Rip/NHL/disc.cue', 'FILE "C:\\Users\\someone\\Games\\NHL\\Track01.bin" BINARY\r\n  TRACK 01 MODE1/2352\r\n    INDEX 01 00:00:00\r\nFILE "D:\\Rips\\Track02.BIN" BINARY\r\n  TRACK 02 AUDIO\r\n    INDEX 00 00:00:00\r\n    INDEX 01 00:02:00\r\n');
}, { kind: 'cue', tracks: [2] });

// 5. The .bin was renamed but the sheet was not.
scenario('renamed bin', (mk) => {
  mk('renamed disc.bin', dataTrack('raw', 0));
  mk('NHL Hockey 94.cue', 'FILE "NHL Hockey 94.bin" BINARY\r\n  TRACK 01 MODE1/2352\r\n    INDEX 01 00:00:00\r\n');
}, { kind: 'cue', tracks: [] });

// 6. MODE1/2048 data track in an .iso plus music in WAVE files named by the sheet.
scenario('iso + wave sheet', (mk) => {
  mk('disc.iso', cooked);
  const lines = ['FILE "disc.iso" BINARY', '  TRACK 01 MODE1/2048', '    INDEX 01 00:00:00'];
  TR.forEach((t) => {
    mk('Track' + String(t).padStart(2, '0') + '.wav', wav(audio(t, 0, MUSIC)));
    lines.push('FILE "Track' + String(t).padStart(2, '0') + '.wav" WAVE', '  TRACK ' + String(t).padStart(2, '0') + ' AUDIO', '    INDEX 01 00:00:00');
  });
  mk('disc.cue', lines.join('\r\n') + '\r\n');
}, { kind: 'cue', tracks: TR, gap: 0 });

// 7. A bare ISO with loose numbered WAVE files, no sheet.
scenario('iso + loose wav', (mk) => {
  mk('NHL94.iso', cooked);
  TR.forEach((t) => mk('Track' + String(t).padStart(2, '0') + '.wav', wav(audio(t, 0, MUSIC))));
  mk('notes.txt', 'hi');
}, { kind: 'iso', tracks: TR, gap: 0 });

// 8. A raw .bin data track with loose per-track .bin files named by track number, each with its pregap.
scenario('raw + loose bins', (mk) => {
  mk('disc.img', dataTrack('raw', 0));
  TR.forEach((t) => mk('Sega CD - ' + String(t).padStart(2, '0') + ' - Song name ' + t + '.bin', audio(t, GAP, MUSIC)));
}, { kind: 'raw', tracks: TR });

// 9. CloneCD: .ccd + .img (all tracks in the image, LBA 0 = the start).
scenario('clonecd', (mk) => {
  mk('game.img', Buffer.concat([dataTrack('raw', 0), audio(2, 0, MUSIC), audio(3, 0, MUSIC)]));
  const entry = (n, point, control, plba) => '[Entry ' + n + ']\r\nSession=1\r\nPoint=0x' + point.toString(16).padStart(2, '0') + '\r\nADR=0x01\r\nControl=0x0' + control + '\r\nPLBA=' + plba + '\r\n';
  mk('game.ccd', '[CloneCD]\r\nVersion=3\r\n[Disc]\r\nTocEntries=5\r\nSessions=1\r\n' + entry(0, 0xa0, 4, 0) + entry(1, 1, 4, 0) + entry(2, 2, 0, SECT) + entry(3, 3, 0, SECT + MUSIC));
  mk('game.sub', Buffer.alloc(10));
}, { kind: 'ccd', tracks: [2, 3], gap: 0 });

// 10. Audio is in a different folder than the disc (the cue's data track is missing), cooked ISO elsewhere.
scenario('split', (mk) => {
  mk('isos/NHL94CD.iso', cooked);
  const lines = ['FILE "x (Track 01).bin" BINARY', '  TRACK 01 MODE1/2352', '    INDEX 01 00:00:00'];
  const t12 = [];
  for (let t = 2; t <= 13; t++) t12.push(t);
  t12.forEach((t) => {
    mk('tracks/x (Track ' + String(t).padStart(2, '0') + ').bin', audio(t, GAP, MUSIC));
    lines.push('FILE "x (Track ' + String(t).padStart(2, '0') + ').bin" BINARY', '  TRACK ' + String(t).padStart(2, '0') + ' AUDIO', '    INDEX 00 00:00:00', '    INDEX 01 00:02:00');
  });
  mk('tracks/x.cue', lines.join('\r\n') + '\r\n');
}, { kind: 'iso', tracks: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] });

// Unreadable formats are reported, not silently ignored.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-'));
  try {
    fs.writeFileSync(path.join(dir, 'NHL Hockey 94 (USA).chd'), Buffer.alloc(100));
    assert.strictEqual(Find.find(dir), null);
    fs.writeFileSync(path.join(dir, 'disc.iso'), cooked);
    const hit = Find.find(dir);
    assert.ok(hit.notes.some((n) => /CHD/.test(n)), 'a .chd beside the disc is mentioned');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
// A sheet whose music is FLAC says so.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-'));
  try {
    fs.writeFileSync(path.join(dir, 'd.iso'), cooked);
    fs.writeFileSync(path.join(dir, 'Track02.flac'), Buffer.alloc(100));
    fs.writeFileSync(path.join(dir, 'd.cue'), 'FILE "d.iso" BINARY\r\n TRACK 01 MODE1/2048\r\n  INDEX 01 00:00:00\r\nFILE "Track02.flac" FLAC\r\n TRACK 02 AUDIO\r\n  INDEX 01 00:00:00\r\n');
    const hit = Find.find(dir);
    assert.deepStrictEqual(hit.audio, []);
    assert.ok(hit.notes.some((n) => /FLAC/.test(n)), 'FLAC music is reported');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
// Track-number parsing.
assert.strictEqual(Find.trackNumber("NHL '94 (USA) (Track 07).bin"), 7);
assert.strictEqual(Find.trackNumber('Track02.wav'), 2);
assert.strictEqual(Find.trackNumber('02 - Intro.flac'), 2);
assert.strictEqual(Find.trackNumber('Sega CD - 12 - Song name 9.bin'), 9, 'the last number wins when there is no "track"');
console.log('segacd-rips: ' + 'every rip layout found by contents, music offsets and unreadable formats OK');
