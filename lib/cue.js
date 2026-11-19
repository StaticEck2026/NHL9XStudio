/**
 * .cue sheet reader for Sega CD dumps ("NHL '94 (USA).cue" with one .bin per track, or one .bin for the whole disc).
 * Only what Studio needs: which file holds the data track (track 1) and where each audio track starts and ends.
 */
const fs = require('fs');
const path = require('path');

const FRAME = 2352; // bytes of one CD frame (audio, or a raw data sector)

function frames(mm, ss, ff) {
  return (Number(mm) * 60 + Number(ss)) * 75 + Number(ff);
}

/** The file a cue names, found beside the cue with any capitalisation; null when it is not there. */
function resolveFile(folder, name) {
  name = String(name).replace(/\\/g, '/'); // sheets written on Windows
  const direct = path.join(folder, name);
  if (fs.existsSync(direct)) return direct;
  let names = [];
  try { names = fs.readdirSync(folder); } catch (err) { return null; }
  const hit = names.find((n) => n.toLowerCase() === String(name).toLowerCase());
  return hit ? path.join(folder, hit) : null;
}

/** [{number, audio, mode, name, file, index0, index1}] (indexes in frames inside that file), in cue order. */
function parse(cuePath) {
  let text = '';
  try {
    const raw = fs.readFileSync(cuePath);
    text = raw.toString('utf8');
    if (text.indexOf('\ufffd') >= 0) text = raw.toString('latin1'); // not UTF-8: an older ripper's code page
    text = text.replace(/^\ufeff/, '');
  } catch (err) { return []; }
  const folder = path.dirname(cuePath);
  const tracks = [];
  let fileName = null;
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    let m = /^\s*FILE\s+(?:"([^"]+)"|(\S+))/i.exec(line);
    if (m) { fileName = m[1] || m[2]; continue; }
    m = /^\s*TRACK\s+(\d+)\s+(\S+)/i.exec(line);
    if (m) {
      cur = { number: Number(m[1]), audio: /^AUDIO$/i.test(m[2]), mode: m[2], name: fileName, file: fileName ? resolveFile(folder, fileName) : null, index0: null, index1: null };
      tracks.push(cur);
      continue;
    }
    m = /^\s*INDEX\s+(\d+)\s+(\d+):(\d+):(\d+)/i.exec(line);
    if (m && cur) {
      if (Number(m[1]) === 0) cur.index0 = frames(m[2], m[3], m[4]);
      else if (Number(m[1]) === 1) cur.index1 = frames(m[2], m[3], m[4]);
    }
  }
  return tracks;
}

/** The file holding the disc's data track (track 1), or null when the sheet or the file is missing. */
function dataFile(cuePath) {
  const t = parse(cuePath).find((x) => !x.audio);
  return t && t.file ? t.file : null;
}

/**
 * The audio tracks as {track, file, skip, end}: skip is the byte offset where the music starts (INDEX 01), end the byte
 * offset where the track stops (or null for the end of the file). Works for one .bin per track and for a single .bin.
 */
function audioTracks(cuePath) {
  const tracks = parse(cuePath);
  const out = [];
  tracks.forEach((t, i) => {
    if (!t.audio || !t.file || t.index1 == null) return;
    const next = tracks[i + 1];
    let end = null;
    if (next && next.file === t.file) {
      const at = next.index0 != null ? next.index0 : next.index1;
      if (at != null) end = at * FRAME;
    }
    out.push({ track: t.number, file: t.file, skip: t.index1 * FRAME, end });
  });
  return out;
}

/** How many AUDIO tracks the sheet lists, whether or not their files are present. */
function audioCount(cuePath) {
  return parse(cuePath).filter((t) => t.audio).length;
}

module.exports = { parse, dataFile, audioTracks, audioCount, FRAME };
