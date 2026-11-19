/**
 * NHL 94 Sega CD sound effects, read straight from MAIN.BIN.
 *
 * The disc does not use the cartridge's sound code: MAIN.BIN has its own sequencer (SndSlotsTickAll in NHL94Genesis
 * src/segacd/main/mainsound294cd.asm) and Z80 driver. What it shares with the cartridge is the effect numbers (the
 * game calls sfx with the cartridge's ids; id 4 is the horn) and the 26-byte FM patch (the first 26 bytes of each
 * 36-byte record, same register order as the cartridge's fm_instrument_patches).
 *
 * Data in MAIN.BIN (file offsets, retail disc):
 *   SndEffectTable   $863C  a word count (79), then 79 records of 4 bytes: type, id, length (big endian word). Type 3 is a
 *                           script (the id is the effect number), type 0 a patch.
 *   SndEffectScripts $877A  the scripts of the type 3 records, one after another in record order, each as long as its
 *                           record says and ending with $FF.
 *   FmInstrumentPatches $8C6C  36 bytes per patch; the script's program number is the patch index.
 * Script events, each followed by a delta time in ticks (a byte with bit 7 set continues the number):
 *   $9n note vel duration(1-2 bytes)  note on, duration in ticks     $Bn $12 v  channel type (0 FM, 1 PSG)
 *   $Cn program                       patch                           $En bend   pitch bend, $40 centre
 *   $FF                               end
 * Ids $26 and $27 are empty scripts (never played); the horn ($04) is a 100 byte script like the others.
 *
 * Channel type 1 (`Bn 12 01`) is a sample channel on the RF5C164 PCM chip, not the PSG (the disc never writes the PSG). Its program
 * numbers $60-$6F pick a sample from the bank in GRAPH2.BIN (GTABLE record 96, offset $2D2000: u16 count 13, 13 pairs of tag and
 * length, then the samples, sign-magnitude, $FF stops). Pitch follows the note: the sample's reference note plays at 8,138 Hz and each
 * semitone is a factor 2^(1/12). The reference notes and the program to sample map were read from the real disc in an emulator.
 *
 * Playing is a reconstruction: the script is read the way the sequencer reads it and the notes go to the chip with the
 * patches, but the Z80 driver's own note table, envelope and PSG handling are not run. The tick is taken as one frame.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlSegaCdSfx = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const TABLE_AT = 0x863e;
  const TABLE_COUNT = 79;
  const SCRIPTS_AT = 0x877a;
  const SCRIPTS_SIZE = 0x8c6a - 0x877a;
  const PATCHES_AT = 0x8c6c;
  const PATCH_SIZE = 36;
  const TICK_HZ = 60;
  const SAMPLE_BANK_AT = 0x2d2000;
  const SAMPLE_BASE_HZ = 8138.25;
  // Program number ($60-$6F) to the sample in the bank, and the note each sample plays at 8,138 Hz.
  const PROGRAM_SAMPLE = { 96: 7, 97: 2, 98: 1, 99: 6, 100: 0, 101: 4, 102: 3, 103: 5, 107: 12, 108: 10, 109: 8, 110: 9, 111: 11 };
  const SAMPLE_REF_NOTE = [60, 60, 60, 66, 60, 60, 60, 60, 66, 66, 72, 60, 66];
  const YM_CLOCK = 7670454;

  // Registers of the 26 patch bytes for FM channel 0 of a part (add the channel's 0-2 position).
  const PATCH_REGS = [0x30, 0x38, 0x34, 0x3c, 0x40, 0x48, 0x44, 0x4c, 0x50, 0x58, 0x54, 0x5c, 0x60,
    0x68, 0x64, 0x6c, 0x70, 0x78, 0x74, 0x7c, 0x80, 0x88, 0x84, 0x8c, 0xb0, 0xb4];
  // Carrier operators (patch order op1..op4) by algorithm.
  const CARRIERS = { 0: [3], 1: [3], 2: [3], 3: [3], 4: [1, 3], 5: [1, 2, 3], 6: [1, 2, 3], 7: [0, 1, 2, 3] };


  // The effect names are the cartridge's: the disc's `sfx` call takes the same ids (SFXsiren, SFXwhistle, ...), and the cartridge
  // Audio list labels them "sfx whistle" and so on (lib/audio/data/nhl94-streams.json, sound ids $0-$2F).
  let CART_NAMES = null;
  function cartridgeNames() {
    if (CART_NAMES) return CART_NAMES;
    CART_NAMES = {};
    try {
      const data = require('./data/nhl94-streams.json');
      for (const s of data.streams) if (s.group === 'SFX' && /^sfx /.test(s.label) && !/^sfx id/.test(s.label)) CART_NAMES[s.soundId] = s.label;
    } catch (e) { /* the list is only a nicety */ }
    return CART_NAMES;
  }

  function nameOf(id) {
    const names = cartridgeNames();
    if (names[id]) return names[id];
    if (id === 0x26 || id === 0x27) return 'sfx ' + id.toString(16).toUpperCase() + ' (empty)';
    return 'sfx $' + id.toString(16).toUpperCase();
  }

  /** True when the bytes look like the retail MAIN.BIN. */
  function isMain(bytes) {
    return !!bytes && bytes.length >= SCRIPTS_AT + SCRIPTS_SIZE && bytes[TABLE_AT] === 3 && bytes[TABLE_AT + 1] === 0x26;
  }

  function patchCount(bytes) {
    return Math.floor((bytes.length - PATCHES_AT) / PATCH_SIZE) >= 31 ? 31 : 0;
  }

  /** Where the script starting at p ends (after its $FF and the three bytes that follow), or -1 when it does not parse. */
  function scriptEnd(s, p) {
    let status = 0;
    while (p < s.length) {
      if (s[p] & 0x80) status = s[p++];
      if (status === 0xff) return Math.min(s.length, p + 3);
      const kind = status & 0xf0;
      if (kind === 0x90) {
        p += 2;
        p = readVar(s, p).p;
      } else if (kind === 0xb0) {
        p += 2;
      } else if (kind === 0xc0 || kind === 0xe0) {
        p += 1;
      } else {
        return -1;
      }
      p = readVar(s, p).p;
    }
    return -1;
  }

  /**
   * The effects: [{id, length, script: Uint8Array}] for the type 3 records. The scripts follow one another in record
   * order and each is as long as its record says (every one ends with $FF).
   */
  function effects(bytes) {
    if (!isMain(bytes)) return [];
    const out = [];
    let pos = SCRIPTS_AT;
    for (let i = 0; i < TABLE_COUNT; i++) {
      const o = TABLE_AT + i * 4;
      if (bytes[o] !== 3) break;
      const length = (bytes[o + 2] << 8) | bytes[o + 3];
      let head = 0; // a few header bytes (flags and priority) come before the first event, which has bit 7 set
      while (head < length && !(bytes[pos + head] & 0x80)) head++;
      out.push({ id: bytes[o + 1], length, head, script: bytes.subarray(pos + head, pos + length) });
      pos += length;
    }
    return out;
  }

  /** The 13 samples of the bank in GRAPH2.BIN: [{start, length, data}], or [] when the bank is not where it should be. */
  function sampleBank(graph2) {
    if (!graph2 || graph2.length < SAMPLE_BANK_AT + 2 + 13 * 4) return [];
    const at = SAMPLE_BANK_AT;
    const u16 = (o) => (graph2[o] << 8) | graph2[o + 1];
    if (u16(at) !== 13) return [];
    const out = [];
    let pos = at + 2 + 13 * 4;
    for (let k = 0; k < 13; k++) {
      const length = u16(at + 2 + k * 4 + 2);
      if (pos + length > graph2.length) return [];
      out.push({ start: pos, length, data: graph2.subarray(pos, pos + length) });
      pos += length;
    }
    return out;
  }

  /** True when the effect's script has a sample channel (a sample plays through the RF5C164). */
  function hasSample(script) {
    return parseScript(script).some((x) => x.type === 'control' && x.num === 0x12 && x.val === 1);
  }

  /** Index into the patch list of the patch with this id (the type 0 records, in order); the program number is the id. */
  function patchIndex(bytes, id) {
    let n = 0;
    for (let i = 0; i < TABLE_COUNT; i++) {
      const o = TABLE_AT + i * 4;
      if (bytes[o] !== 0) continue;
      if (bytes[o + 1] === id) return n;
      n++;
    }
    return Math.min(id, 30);
  }

  function patchBytes(bytes, id) {
    const at = PATCHES_AT + patchIndex(bytes, id) * PATCH_SIZE;
    return bytes.subarray(at, at + 26);
  }

  /** Variable length: bytes with bit 7 set continue (7 bits each). */
  function readVar(s, p) {
    let v = 0;
    while (p < s.length) {
      const b = s[p++];
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return { v, p };
  }

  /** The script as timed events: {tick, type: 'on'|'bend'|'program'|'kind', channel, ...}. */
  function parseScript(s) {
    const ev = [];
    let p = 0;
    let t = 0;
    let status = 0;
    while (p < s.length) {
      if (s[p] & 0x80) status = s[p++];
      if (status === 0xff) break;
      const kind = status & 0xf0;
      const ch = status & 15;
      if (kind === 0x90) {
        const note = s[p++];
        const vel = s[p++];
        const d = readVar(s, p);
        p = d.p;
        ev.push({ tick: t, type: 'on', ch, note, vel, dur: d.v });
      } else if (kind === 0xb0) {
        const num = s[p++];
        const val = s[p++];
        ev.push({ tick: t, type: 'control', ch, num, val });
      } else if (kind === 0xc0) {
        ev.push({ tick: t, type: 'program', ch, program: s[p++] });
      } else if (kind === 0xe0) {
        ev.push({ tick: t, type: 'bend', ch, bend: s[p++] });
      } else {
        break;
      }
      const delta = readVar(s, p);
      p = delta.p;
      t += delta.v;
    }
    return ev;
  }

  function lengthTicks(events) {
    let end = 0;
    for (const e of events) end = Math.max(end, e.tick + (e.dur || 0));
    return end;
  }

  /** YM2612 block and F-number for a frequency in Hz. */
  function fmFreq(hz) {
    for (let block = 0; block < 8; block++) {
      const fnum = Math.round((hz * 144 * Math.pow(2, 20 - block)) / YM_CLOCK);
      if (fnum < 2048) return { block, fnum };
    }
    return { block: 7, fnum: 2047 };
  }

  const midiHz = (n) => 440 * Math.pow(2, (n - 69) / 12);

  /**
   * Render one effect: returns {rate, pcm: Int16Array (mono)}. `chip` is a YM2612 from ym2612-wasm createChip.
   */
  function render(bytes, effect, chip, options) {
    const opts = options || {};
    const bank = opts.samples || [];
    const events = parseScript(effect.script);
    const rate = chip.sampleRate ? chip.sampleRate(YM_CLOCK) : 53267;
    const ticks = lengthTicks(events) + 24;
    const total = Math.ceil((ticks / TICK_HZ) * rate);
    const pcm = new Float32Array(total);
    chip.reset();
    const w = (port, reg, val) => { chip.write(port * 2, reg); chip.write(port * 2 + 1, val); };
    w(0, 0x22, 0); w(0, 0x27, 0); w(0, 0x2b, 0);
    const state = {};
    const get = (ch) => state[ch] || (state[ch] = { kind: 0, patch: null, note: -1, bend: 64, until: -1, vel: 127, freq: null, psg: null });
    const keyCode = (ch) => (ch < 3 ? ch : ch + 1);
    const setPatch = (ch, patch, vel) => {
      const fm = ch % 6;
      const off = fm % 3;
      const port = fm < 3 ? 0 : 1;
      const algorithm = patch[24] & 7;
      for (let i = 0; i < 24; i++) {
        let v = patch[i];
        if (i >= 4 && i < 8 && CARRIERS[algorithm].indexOf(i - 4) >= 0) v = Math.min(127, (v & 127) + ((127 - vel) >> 2));
        w(port, PATCH_REGS[i] + off, v);
      }
      w(port, 0xb0 + off, patch[24]);
      w(port, 0xb4 + off, patch[25] || 0xc0);
    };
    const pitch = (ch, note, bend) => {
      const fm = ch % 6;
      const hz = midiHz(note + ((bend - 64) / 64) * 2);
      const f = fmFreq(hz);
      const port = fm < 3 ? 0 : 1;
      w(port, 0xa4 + (fm % 3), (f.block << 3) | (f.fnum >> 8));
      w(port, 0xa0 + (fm % 3), f.fnum & 255);
    };
    const psgSamples = [];
    // Timeline of tick-aligned actions.
    const off = [];
    for (const e of events) {
      if (e.type === 'on') off.push({ tick: e.tick + e.dur, type: 'off', ch: e.ch });
    }
    const all = events.concat(off).sort((a, b) => a.tick - b.tick || (a.type === 'off' ? -1 : 1));
    let idx = 0;
    const frameSamples = rate / TICK_HZ;
    let written = 0;
    for (let tick = 0; tick <= ticks; tick++) {
      while (idx < all.length && all[idx].tick <= tick) {
        const e = all[idx++];
        const st = get(e.ch);
        if (e.type === 'control' && e.num === 0x12) st.kind = e.val;
        else if (e.type === 'program') {
          st.program = e.program;
          if (!st.kind) st.patch = patchBytes(bytes, e.program);
        } else if (e.type === 'bend') {
          st.bend = e.bend;
          if (st.kind === 0 && st.note >= 0) pitch(e.ch, st.note, st.bend);
        } else if (e.type === 'on') {
          st.note = e.note;
          st.vel = e.vel;
          st.until = e.tick + e.dur;
          if (st.kind === 0 && st.patch) {
            const fm = e.ch % 6;
            w(0, 0x28, keyCode(fm));
            setPatch(e.ch, st.patch, e.vel);
            pitch(e.ch, e.note, st.bend);
            w(0, 0x28, 0xf0 | keyCode(fm));
          } else if (st.kind === 1) {
            const k = PROGRAM_SAMPLE[st.program];
            if (k != null && bank[k]) {
              psgSamples.push({ from: Math.round((e.tick / TICK_HZ) * rate), data: bank[k].data, step: (SAMPLE_BASE_HZ * Math.pow(2, (e.note - SAMPLE_REF_NOTE[k]) / 12)) / rate, vol: e.vel / 127 });
            }
          }
        } else if (e.type === 'off') {
          const s2 = get(e.ch);
          if (s2.kind === 0 && s2.until === e.tick) w(0, 0x28, keyCode(e.ch % 6));
        }
      }
      const want = Math.min(total, Math.round(((tick + 1) * frameSamples)));
      const n = want - written;
      if (n > 0) {
        const g = chip.generateStereo(n);
        for (let i = 0; i < n; i++) pcm[written + i] = (g.left[i] + g.right[i]) / 2;
        written += n;
      }
    }
    // Sample channels: the RF5C164 plays the sample to its $FF stop code at the note's rate, whatever the note length.
    for (const n of psgSamples) {
      let pos = 0;
      for (let i = n.from; i < total; i++, pos += n.step) {
        const a = Math.floor(pos);
        if (a >= n.data.length || n.data[a] === 0xff) break;
        const v = (x) => ((x & 0x80) ? -(x & 0x7f) : (x & 0x7f)) / 127;
        const nxt = a + 1 < n.data.length && n.data[a + 1] !== 0xff ? n.data[a + 1] : n.data[a];
        const f = pos - a;
        pcm[i] += (v(n.data[a]) * (1 - f) + v(nxt) * f) * 0.5 * n.vol;
      }
    }
    const out = new Int16Array(total);
    let peak = 0;
    for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(pcm[i]));
    const gain = peak > 0.9 ? 0.9 / peak : 1;
    for (let i = 0; i < total; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * gain * 32767)));
    return { rate, pcm: out, ticks, events: events.length };
  }

  return { TABLE_AT, SCRIPTS_AT, PATCHES_AT, TICK_HZ, isMain, effects, parseScript, lengthTicks, patchBytes, sampleBank, hasSample, PROGRAM_SAMPLE, SAMPLE_BANK_AT, render, patchCount, nameOf };
});
