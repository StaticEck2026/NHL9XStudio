/**
 * Truecolour canvas, a 5x7 label font, PNG output (lib/indexed-image.js) and a small GIF89a encoder, so the
 * builder needs no packages. The sheet's pictures are drawn from game colour indices only; the labels, panel
 * backgrounds and grid are the only colours the game does not own.
 */
'use strict';

const path = require('path');
const zlib = require('zlib');
const Img = require(path.join(__dirname, '..', '..', 'lib', 'indexed-image'));

const GLYPHS = {
  A: '01110100011000111111100011000110001', B: '11110100011000111110100011000111110', C: '01110100011000010000100001000101110',
  D: '11110100011000110001100011000111110', E: '11111100001000011110100001000011111', F: '11111100001000011110100001000010000',
  G: '01110100011000010111100011000101111', H: '10001100011000111111100011000110001', I: '01110001000010000100001000010001110',
  J: '00111000100001000010000101001001100', K: '10001100101010011000101001001010001', L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001', N: '10001100011100110101100111000110001', O: '01110100011000110001100011000101110',
  P: '11110100011000111110100001000010000', Q: '01110100011000110001101011001001101', R: '11110100011000111110101001001010001',
  S: '01111100001000001110000010000111110', T: '11111001000010000100001000010000100', U: '10001100011000110001100011000101110',
  V: '10001100011000110001100010101000100', W: '10001100011000110101101011010101010', X: '10001100010101000100010101000110001',
  Y: '10001100010101000100001000010000100', Z: '11111000010001000100010001000011111',
  0: '01110100011001110101110011000101110', 1: '00100011000010000100001000010001110', 2: '01110100010000100010001000100011111',
  3: '11111000100010000010000011000101110', 4: '00010001100101010010111110001000010', 5: '11111100001111000001000011000101110',
  6: '00110010001000011110100011000101110', 7: '11111000010001000100010000100001000', 8: '01110100011000101110100011000101110',
  9: '01110100011000101111000010001001100', ' ': '00000000000000000000000000000000000', '.': '00000000000000000000000000110001100',
  ',': '00000000000000000000001100010001000', ':': '00000011000110000000011000110000000', '-': '00000000000000011111000000000000000',
  '+': '00000001000010011111001000010000000', '/': '00001000010001000100010001000010000', '#': '01010010101111101010111110101001010',
  '(': '00010001000100001000010000010000010', ')': '01000001000001000010000100010001000', "'": '00100001000100000000000000000000000',
  '=': '00000000001111100000111110000000000', '>': '01000001000001000001000100010001000', '<': '00010001000100010000010000010000010',
  '%': '11000110010001000100010001001100011', '?': '01110100010000100010001000000000100', '*': '00000001001010101110101010010000000',
  '[': '01110010000100001000010000100001110', ']': '01110000100001000010000100001001110', '_': '00000000000000000000000000000011111',
  '~': '00000000000100010101000100000000000'
};

class Canvas {
  constructor(w, h, bg) {
    this.w = w; this.h = h;
    this.rgb = new Uint8Array(w * h * 3);
    if (bg) this.fill(0, 0, w, h, bg);
  }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.rgb[i] = c[0]; this.rgb[i + 1] = c[1]; this.rgb[i + 2] = c[2];
  }
  fill(x, y, w, h, c) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c); }
  box(x, y, w, h, c) { this.fill(x, y, w, 1, c); this.fill(x, y + h - 1, w, 1, c); this.fill(x, y, 1, h, c); this.fill(x + w - 1, y, 1, h, c); }
  text(x, y, str, c, scale = 1) {
    let cx = x;
    for (const ch of String(str).toUpperCase()) {
      const g = GLYPHS[ch] || GLYPHS['?'];
      for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) if (g[r * 5 + k] === '1') this.fill(cx + k * scale, y + r * scale, scale, scale, c);
      cx += 6 * scale;
    }
    return cx;
  }
  static textWidth(str, scale = 1) { return String(str).length * 6 * scale; }
  /** Draw a cel's indices (origin at ox, oy) through `palette` (64 [r,g,b]), each pixel scale x scale. */
  cel(cel, ox, oy, palette, scale) {
    for (const [x, y, v] of cel.pixels()) if (v & 15) this.fill(ox + x * scale, oy + y * scale, scale, scale, palette[v]);
  }
  /** Truecolour PNG, written as 8-bit indexed (the sheet uses far fewer than 256 colours). */
  png() {
    const map = new Map(), pal = [], idx = new Uint8Array(this.w * this.h);
    for (let i = 0; i < this.w * this.h; i++) {
      const k = (this.rgb[i * 3] << 16) | (this.rgb[i * 3 + 1] << 8) | this.rgb[i * 3 + 2];
      if (!map.has(k)) {
        if (pal.length === 256) throw new Error('more than 256 colours on the sheet');
        map.set(k, pal.length); pal.push([this.rgb[i * 3], this.rgb[i * 3 + 1], this.rgb[i * 3 + 2]]);
      }
      idx[i] = map.get(k);
    }
    return png8(this.w, this.h, idx, pal);
  }
}

/** 8-bit indexed PNG with real deflate (lib/indexed-image.js stores its zlib blocks uncompressed). */
function png8(w, h, idx, pal) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(Img.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 3;
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; Buffer.from(idx.buffer, idx.byteOffset + y * w, w).copy(raw, y * (w + 1) + 1); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('PLTE', Buffer.from(pal.flat())),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** GIF89a, looping, one global colour table; frames are Canvases the same size; delays in 1/100 s. */
function gif(frames, delays) {
  const { w, h } = frames[0];
  const map = new Map(), pal = [];
  const indexed = frames.map((f) => {
    const out = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const k = (f.rgb[i * 3] << 16) | (f.rgb[i * 3 + 1] << 8) | f.rgb[i * 3 + 2];
      if (!map.has(k)) { if (pal.length === 256) throw new Error('GIF: more than 256 colours'); map.set(k, pal.length); pal.push(k); }
      out[i] = map.get(k);
    }
    return out;
  });
  let bits = 1; while ((1 << bits) < Math.max(2, pal.length)) bits++;
  const bytes = [];
  const u16 = (n) => bytes.push(n & 255, (n >> 8) & 255);
  bytes.push(...Buffer.from('GIF89a')); u16(w); u16(h); bytes.push(0xF0 | (bits - 1), 0, 0);
  for (let i = 0; i < (1 << bits); i++) { const k = pal[i] || 0; bytes.push((k >> 16) & 255, (k >> 8) & 255, k & 255); }
  bytes.push(0x21, 0xFF, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0);
  indexed.forEach((px, n) => {
    bytes.push(0x21, 0xF9, 4, 0); u16(delays[n]); bytes.push(0, 0);
    bytes.push(0x2C); u16(0); u16(0); u16(w); u16(h); bytes.push(0);
    const min = Math.max(2, bits);
    bytes.push(min);
    const data = lzw(px, min);
    for (let i = 0; i < data.length; i += 255) { const blk = data.slice(i, i + 255); bytes.push(blk.length, ...blk); }
    bytes.push(0);
  });
  bytes.push(0x3B);
  return Buffer.from(bytes);
}

function lzw(px, min) {
  const clear = 1 << min, eoi = clear + 1;
  const out = []; let cur = 0, nbits = 0;
  const emit = (code, size) => { cur |= code << nbits; nbits += size; while (nbits >= 8) { out.push(cur & 255); cur >>>= 8; nbits -= 8; } };
  let dict = new Map(), next = eoi + 1, size = min + 1;
  emit(clear, size);
  let prefix = px[0];
  for (let i = 1; i < px.length; i++) {
    const k = px[i], key = prefix * 4096 + k;
    if (dict.has(key)) { prefix = dict.get(key); continue; }
    emit(prefix, size);
    if (next < 4096) { dict.set(key, next++); if (next > (1 << size) && size < 12) size++; }
    else { emit(clear, size); dict = new Map(); next = eoi + 1; size = min + 1; }
    prefix = k;
  }
  emit(prefix, size); emit(eoi, size);
  if (nbits > 0) out.push(cur & 255);
  return out;
}

module.exports = { Canvas, gif, png8 };
