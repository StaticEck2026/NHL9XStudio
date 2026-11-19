/**
 * NHL 94 Sega CD sound effects, read straight from MAIN.BIN.
 *
 * The disc does not use the cartridge's sound code: MAIN.BIN has its own sequencer (SndSlotsTickAll in NHL94Genesis
 * src/segacd/main/mainsound294cd.asm) and Z80 driver. What it shares with the cartridge is the effect numbers (the
 * game calls sfx with the cartridge's ids; id 4 is the horn) and the 26-byte FM patch (the first 26 bytes of each
 * 36-byte record, same register order as the cartridge's fm_instrument_patches).
 *
 * Data in MAIN.BIN (file offsets, retail disc):
 *   SndEffectTable   $863D  82 records of 4 bytes: length low byte, type, id, length high byte. Type 3 is a script
 *                           (the id is the effect number), type 0 a patch.
 *   SndEffectScripts $8785  the scripts of the type 3 records from the 4th on, one after another, each ending $FF.
 *   FmInstrumentPatches $8C6C  36 bytes per patch; the script's program number is the patch index.
 * Script events, each followed by a delta time in ticks (a byte with bit 7 set continues the number):
 *   $9n note vel duration(1-2 bytes)  note on, duration in ticks     $Bn $12 v  channel type (0 FM, 1 PSG)
 *   $Cn program                       patch                           $En bend   pitch bend, $40 centre
 *   $FF                               end
 * The first three records (ids $26, $27 and the horn $04) have no script here.
 *
 * Playing is a reconstruction: the script is read the way the sequencer reads it and the notes go to the chip with the
 * patches, but the Z80 driver's own note table, envelope and PSG handling are not run. The tick is taken as one frame.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlSegaCdSfx = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const TABLE_AT = 0x863d;
  const TABLE_SIZE = 328;
  const SCRIPTS_AT = 0x8785;
  const SCRIPTS_SIZE = 1255;
  const PATCHES_AT = 0x8c6c;
  const PATCH_SIZE = 36;
  const TICK_HZ = 60;
  const YM_CLOCK = 7670454;

  // Registers of the 26 patch bytes for FM channel 0 of a part (add the channel's 0-2 position).
  const PATCH_REGS = [0x30, 0x38, 0x34, 0x3c, 0x40, 0x48, 0x44, 0x4c, 0x50, 0x58, 0x54, 0x5c, 0x60,
    0x68, 0x64, 0x6c, 0x70, 0x78, 0x74, 0x7c, 0x80, 0x88, 0x84, 0x8c, 0xb0, 0xb4];
  // Carrier operators (patch order op1..op4) by algorithm.
  const CARRIERS = { 0: [3], 1: [3], 2: [3], 3: [3], 4: [1, 3], 5: [1, 2, 3], 6: [1, 2, 3], 7: [0, 1, 2, 3] };


  // The cartridge's effect names (ram94.asm), which the disc keeps: the game calls sfx with the same ids.
  const NAMES = { 0: 'Goal siren', 1: 'Short beep', 2: 'Short beep (last minute)', 3: 'Referee whistle', 4: 'Period horn', 5: 'Slap shot whiff',
    6: 'Stick deflects puck', 7: 'Puck pickup', 8: 'Crowd oooh', 9: 'Fight punch', 10: 'Fight punch (low)', 11: 'Crowd cheer',
    12: 'Crowd boo', 13: 'Crowd oooh (low)', 14: 'Puck hits glass', 15: 'Home team won', 36: 'Puck hits player', 37: 'Puck hits post' };
  const RANGES = [[0x10, 0x13, 'Pass'], [0x14, 0x17, 'Backhand shot'], [0x18, 0x1b, 'Forehand shot'], [0x1c, 0x1f, 'Check'],
    [0x20, 0x23, 'Player hits boards'], [0x28, 0x2b, 'Puck hits boards'], [0x2c, 0x2f, 'Puck hits ice']];

  function nameOf(id) {
    if (NAMES[id]) return NAMES[id];
    for (const r of RANGES) if (id >= r[0] && id <= r[1]) return r[2] + ' ' + (id - r[0] + 1);
    return 'Effect $' + id.toString(16).toUpperCase();
  }

  /** True when the bytes look like the retail MAIN.BIN. */
  function isMain(bytes) {
    return !!bytes && bytes.length >= SCRIPTS_AT + SCRIPTS_SIZE && bytes[TABLE_AT + 1] === 3 && bytes[TABLE_AT + 2] === 0x26;
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
   * The effects: [{id, length, script: Uint8Array}] for the type 3 records that have a script. The scripts follow one
   * another in record order (a couple of padding bytes can sit between two), so they are cut by reading each to its
   * $FF. The table's length field is only the first block of a long script (the long slide, effect 6, is 273 bytes).
   */
  function effects(bytes) {
    if (!isMain(bytes)) return [];
    const blob = bytes.subarray(SCRIPTS_AT, SCRIPTS_AT + SCRIPTS_SIZE);
    const out = [];
    let pos = 0;
    for (let i = 3; i < TABLE_SIZE / 4; i++) {
      const o = TABLE_AT + i * 4;
      if (bytes[o + 1] !== 3) break;
      while (pos < blob.length && !(blob[pos] & 0x80)) pos++;
      const end = scriptEnd(blob, pos);
      if (end < 0) break;
      out.push({ id: bytes[o + 2], length: end - pos, script: blob.subarray(pos, end) });
      pos = end;
    }
    return out;
  }

  function patchBytes(bytes, index) {
    const at = PATCHES_AT + Math.min(index, 30) * PATCH_SIZE;
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
            psgSamples.push({ ch: e.ch, from: Math.round((e.tick / TICK_HZ) * rate), to: Math.round(((e.tick + e.dur) / TICK_HZ) * rate), hz: midiHz(e.note), vol: e.vel / 127 });
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
    // PSG notes: a plain square wave at the note's pitch, velocity as level.
    for (const n of psgSamples) {
      const step = n.hz / rate;
      let ph = 0;
      for (let i = n.from; i < Math.min(total, n.to + 100); i++) {
        ph += step;
        if (ph >= 1) ph -= 1;
        const env = i > n.to ? Math.max(0, 1 - (i - n.to) / 100) : 1;
        pcm[i] += (ph < 0.5 ? 1 : -1) * 0.12 * n.vol * env;
      }
    }
    const out = new Int16Array(total);
    let peak = 0;
    for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(pcm[i]));
    const gain = peak > 0.9 ? 0.9 / peak : 1;
    for (let i = 0; i < total; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * gain * 32767)));
    return { rate, pcm: out, ticks, events: events.length };
  }

  return { TABLE_AT, SCRIPTS_AT, PATCHES_AT, TICK_HZ, isMain, effects, parseScript, lengthTicks, patchBytes, render, patchCount, nameOf };
});
