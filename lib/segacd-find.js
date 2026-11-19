/**
 * Finds the user's NHL HOCKEY '94 Sega CD dump under roms/ without depending on how it was ripped or named.
 *
 * The disc is recognised by its contents (a data track with GRAPH2.BIN, HOCKEY.BIN and STARTER.BIN), not by file names. It
 * can be a plain .iso/.img/.bin/.mdf of the data track (2048 byte sectors, or raw 2352/2336/2448 byte sectors, with or
 * without the 2 second pregap), or a .cue sheet in any folder up to three levels down, whose data track is any .bin it
 * names (one file per track, or one file for the disc). The music is read from the same .cue when it has audio tracks.
 */
const fs = require('fs');
const path = require('path');
const iso9660 = require('./iso9660');
const cue = require('./cue');

const DISC_FILES = ['GRAPH2.BIN', 'HOCKEY.BIN', 'STARTER.BIN'];
const DISC_EXT = /\.(iso|img|bin|mdf|cue)$/i;
const MAX_DEPTH = 3;

function walk(dir, depth, out) {
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) { return out; }
  for (const ent of list) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (depth < MAX_DEPTH) walk(full, depth + 1, out); } else out.push(full);
  }
  return out;
}

/** True when the file is a data track of this disc (any supported sector layout). */
function isDisc(file) {
  let disc = null;
  try {
    disc = iso9660.openFile(file);
    if (!disc) return false;
    const names = new Set(disc.names().map((n) => n.toUpperCase()));
    return DISC_FILES.every((n) => names.has(n));
  } catch (err) {
    return false;
  } finally {
    try { if (disc && disc.close) disc.close(); } catch (err) { /* nothing to do */ }
  }
}

/**
 * {image, dataFile, sheet, folder, sheets} or null. `image` is what the rest of Studio opens (the .cue when the disc
 * came from one, else the data track file), `dataFile` the file with the data track, `sheets` every .cue with audio
 * tracks that belong to this disc (the one that names the data track, or a sheet with many audio tracks).
 */
function find(root) {
  const files = walk(root, 0, []);
  const cues = files.filter((f) => /\.cue$/i.test(f));
  let found = null;
  for (const sheet of cues) {
    const data = cue.dataFile(sheet);
    if (data && isDisc(data)) { found = { image: sheet, dataFile: data, sheet, folder: path.dirname(sheet) }; break; }
  }
  if (!found) {
    for (const file of files) {
      if (!DISC_EXT.test(file) || /\.cue$/i.test(file)) continue;
      if (isDisc(file)) { found = { image: file, dataFile: file, sheet: null, folder: path.dirname(file) }; break; }
    }
  }
  // Sheets with the music: the one tied to the disc, or any sheet with a full set of audio tracks (a dump whose data
  // track is only available as a separate .iso).
  const sheets = [];
  for (const sheet of cues) {
    if (found && found.sheet === sheet) { sheets.push(sheet); continue; }
    if (cue.audioCount(sheet) >= 40) sheets.push(sheet);
  }
  if (!found) return null;
  found.sheets = sheets;
  return found;
}

let cache = { root: '', at: 0, value: null };
/** find() remembered for a few seconds, since every request asks. */
function findCached(root) {
  const now = Date.now();
  if (cache.root === root && now - cache.at < 3000) return cache.value;
  const value = find(root);
  cache = { root, at: now, value };
  return value;
}

module.exports = { find, findCached, isDisc };
