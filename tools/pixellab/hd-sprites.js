#!/usr/bin/env node
'use strict';
/**
 * Build detailed 2x versions of the NHL 92 player and goalie frames with PixelLab.
 *
 *   NODE_USE_ENV_PROXY=1 node tools/pixellab/hd-sprites.js [--only skater:4] [--plan]
 *
 * Steps, per character (skater, goalie) and facing (0 = north, clockwise):
 *
 * 1. Base. The facing's rest frame (SPAglide for skaters, SPAgready for
 *    goalies) is scaled 2x and redrawn by `edit-images-v2` with more
 *    detail, then snapped back to the palette indices the original uses.
 *    Four facings go in one call, so the eight bases match each other.
 * 2. Rig. `estimate-custom-skeleton` builds a skeleton on the base: the
 *    body plus joints for the stick (and pads for the goalie).
 * 3. Poses. The same rig is placed on every original frame of that facing
 *    (scaled 2x onto one canvas), which reads the pose each frame of the
 *    game's animations is in.
 * 4. Frames. `animate-with-skeleton-v3` redraws the base in each of those
 *    poses, so every HD frame keeps the game's own motion frame for frame.
 * 5. Each result is snapped to the original frame's palette indices (so
 *    team jerseys still recolor it), cleaned of stray pixels, and given
 *    back the original's ice spray, then written to data/hd/.
 *
 * Every API response is cached under .pixellab-cache/, so a rerun only
 * pays for requests it has not made before.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { PixelLab, b64png } = require('./client.js');
const png = require('./png.js');
const sp = require('./sprites.js');
const { score } = require('./score.js');

const ROOT = path.join(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'data', 'hd');
const CACHE = process.env.PIXELLAB_CACHE || path.join(ROOT, '.pixellab-cache');
const PREVIEW_DIR = process.env.PIXELLAB_PREVIEW || path.join(CACHE, 'preview');

const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const VIEW = 'low top-down';
const SPRAY = new Set([47]); // ice spray under the skates: kept from the original frame
const CHUNK = 15; // animate-with-skeleton-v3 takes up to 15 poses per call
const SEED = 9201;
const SKIN = new Set([38, 39]);
// Frames that are a prop rather than a body pose (the Stanley Cup held
// overhead, gloves and sticks on the ice): one still each, so they are
// redrawn at 2x by /resize from the frame itself instead of a rig.
const RESIZE_FRAMES = [217, 218, 219, 220, 221, 222, 223, 224, 353];
// A rig-posed frame whose silhouette overlaps the original's less than this
// (or whose colours mostly disagree) went wrong, usually a body lying flat
// on the ice or a goalie stack the rig cannot read: it is redrawn by /resize
// from the original frame instead.
const MIN_IOU = 0.55;
const MIN_COLOR = 0.27;

const CHARACTERS = {
  skater: {
    look: 'ice hockey player in a navy blue jersey with red and white shoulder stripes, red pants with white stripes, navy helmet, brown gloves, black skates, holding a wooden hockey stick',
    rigDescription: 'ice hockey player holding a hockey stick',
    edit: 'Same ice hockey player, same pose, same colors and same proportions, redrawn with more detail and definition: crisp dark outlines, shading on the jersey folds, clean stripes, gloves, helmet, face and skates, a clean wooden stick. Keep the pixel art style and the exact palette.',
    base: (d) => 1 + 5 * d // SPAglide
  },
  goalie: {
    look: 'ice hockey goalie in a navy blue jersey with red and white stripes, white goalie mask, large white leg pads, blocker and catching glove, black skates, holding a wooden goalie stick',
    rigDescription: 'ice hockey goalie with leg pads, blocker, catching glove and goalie stick',
    edit: 'Same ice hockey goalie, same pose, same colors and same proportions, redrawn with more detail and definition: crisp dark outlines, shading on the jersey, defined leg pads, blocker, glove, mask and skates, a clean wooden stick. Keep the pixel art style and the exact palette.',
    base: (d) => 400 + 3 * d // SPAgready
  }
};

/** Facing and character of every frame that gets an HD version. */
function frameTable(sheet) {
  const table = new Map();
  const set = (n, character, facing) => { if (!table.has(n)) table.set(n, { frame: n, character, facing }); };
  // Overrides where the SPA table lists a frame under a facing it does not show.
  for (let n = 354; n <= 370; n++) set(n, 'skater', 3); // fights are drawn facing right, toward the camera
  for (let n = 371; n <= 374; n++) set(n, 'skater', 2); // over the boards into the box
  for (let n = 375; n <= 377; n++) set(n, 'skater', 6);
  for (let n = 337; n <= 344; n++) set(n, 'skater', n - 337); // SPFduck: last step of each fall
  for (const spf of sheet.catalog.spfs) {
    if (spf.stride && spf.count === spf.stride * 8 && spf.end <= 352) {
      for (let n = spf.start; n <= spf.end; n++) set(n, 'skater', Math.floor((n - spf.start) / spf.stride));
    }
  }
  for (const anim of sheet.catalog.anims) {
    if (!/^SPAg/.test(anim.name)) continue;
    anim.directions.forEach((dir, facing) => {
      for (const step of dir.steps || dir) if (step.frame >= 400 && step.frame <= 511) set(step.frame, 'goalie', facing);
    });
  }
  for (let n = 1; n <= 352; n++) if (!table.has(n)) throw new Error('frame ' + n + ' has no facing');
  for (const n of RESIZE_FRAMES) table.delete(n);
  // The SPA facing is the direction of travel; in checks, falls, shots and
  // backward skating the body often shows its back (or its front) instead.
  // Face pixels tell them apart: a skater seen from behind shows only the
  // back of the neck (about 3 skin pixels), from the front 10 or more.
  for (const t of table.values()) {
    t.body = t.facing;
    if (t.character !== 'skater') continue;
    const f = sheet.frame(t.frame);
    let skin = 0;
    for (const v of f.pixels) if (SKIN.has(v)) skin++;
    if ([3, 4, 5].includes(t.facing) && skin <= 5) t.body = (12 - t.facing) % 8; // 3→1, 4→0, 5→7
    else if ([7, 0, 1].includes(t.facing) && skin >= 8) t.body = (12 - t.facing) % 8; // 7→5, 0→4, 1→3
  }
  return table;
}

function toPng(sheet, img) {
  return png.encodeRgba(img.width, img.height, sp.indicesToRgba(img, sheet.palette));
}

function stripB64(b) {
  return Buffer.from(String(b.base64 || b).replace(/^data:image\/\w+;base64,/, ''), 'base64');
}

function usedIndices(imgs) {
  const s = new Set();
  for (const img of imgs) for (const v of img.indices) if (v) s.add(v);
  for (const v of SPRAY) s.delete(v);
  return s;
}

/** Drop opaque pixels with fewer than two opaque 8-neighbours (model noise). */
function despeckle(img) {
  const { width: W, height: H, indices } = img;
  const out = Uint8Array.from(indices);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!indices[y * W + x]) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && indices[yy * W + xx]) n++;
      }
      if (n < 2) out[y * W + x] = 0;
    }
  }
  return { width: W, height: H, indices: out };
}

/**
 * For a frame redrawn from itself: the original's ice spray wins where it is,
 * and nothing is drawn more than 2 HD pixels outside the original body
 * (/resize likes to add a drop shadow the game does not have).
 */
function clipToBody(img, hint) {
  const { width: W, height: H } = img;
  const out = Uint8Array.from(img.indices);
  const body = (i) => hint.indices[i] && !SPRAY.has(hint.indices[i]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!out[i]) continue;
    if (SPRAY.has(hint.indices[i])) { out[i] = 0; continue; }
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2 && !near; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && body(yy * W + xx)) near = true;
    }
    if (!near) out[i] = 0;
  }
  return { width: W, height: H, indices: out };
}

/** Put the original frame's ice spray back under the redrawn player. */
function addSpray(img, hint) {
  const out = Uint8Array.from(img.indices);
  for (let i = 0; i < out.length; i++) if (!out[i] && SPRAY.has(hint.indices[i])) out[i] = hint.indices[i];
  return { width: img.width, height: img.height, indices: out };
}

function crop(img, box) {
  // box: the canvas' origin-relative 1x box; result offsets are in 2x pixels.
  const { width: W, height: H, indices } = img;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (indices[y * W + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) data.set(indices.subarray((y0 + y) * W + x0, (y0 + y) * W + x0 + w), y * w);
  return { x: box.x0 * 2 + x0, y: box.y0 * 2 + y0, w, h, data };
}

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  }));
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  const planOnly = args.includes('--plan');
  const sheet = sp.loadSheet();
  const table = frameTable(sheet);
  const pl = new PixelLab({ cacheDir: CACHE });
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });

  // Work list: per character and facing, the frames in sheet order, in chunks.
  const jobs = [];
  for (const character of Object.keys(CHARACTERS)) {
    for (let facing = 0; facing < 8; facing++) {
      if (only && only !== character && only !== character + ':' + facing) continue;
      const frames = [...table.values()].filter((t) => t.character === character && t.body === facing).map((t) => t.frame).sort((a, b) => a - b);
      for (let i = 0; i < frames.length; i += CHUNK) jobs.push({ character, facing, frames: frames.slice(i, i + CHUNK) });
    }
  }
  const est = jobs.reduce((s, j) => s + (j.frames.length > 8 ? 2 : 1) + (j.frames.length <= 3 ? 2 : j.frames.length <= 8 ? 3 : 4), 0);
  console.error(`${jobs.length} animate chunks, ${jobs.reduce((s, j) => s + j.frames.length, 0)} frames, about ${est} generations plus bases and rigs`);
  if (planOnly) return;

  // 1. Bases: four facings per edit call, on one shared origin-anchored canvas.
  const bases = {};
  for (const character of Object.keys(CHARACTERS)) {
    const spec = CHARACTERS[character];
    const facings = [0, 1, 2, 3, 4, 5, 6, 7].filter((f) => !only || only === character || only === character + ':' + f);
    if (!facings.length) continue;
    for (const group of [[0, 1, 2, 3], [4, 5, 6, 7]]) {
      const want = group.filter((f) => facings.includes(f));
      if (!want.length) continue;
      const box = sp.unionBox(group.map((f) => sp.bounds(sheet.frame(spec.base(f)))), 3);
      const W = (box.x1 - box.x0) * 2, H = (box.y1 - box.y0) * 2;
      const hints = group.map((f) => sp.indicesOnCanvas(sheet.frame(spec.base(f)), box, 2));
      const res = await pl.post('/edit-images-v2', {
        method: 'edit_with_text',
        edit_images: hints.map((h) => ({ image: b64png(toPng(sheet, h)), width: W, height: H })),
        image_size: { width: W, height: H },
        description: spec.edit,
        no_background: true,
        seed: SEED
      }, { label: `${character} bases ${group.join(',')}` });
      group.forEach((f, i) => {
        const raw = png.decode(stripB64(res.images[i]));
        const q = despeckle(sp.quantize(raw, sheet.palette, usedIndices([hints[i]]), hints[i]));
        bases[character + ':' + f] = { box, img: q };
        fs.writeFileSync(path.join(PREVIEW_DIR, `base-${character}-${f}.png`), toPng(sheet, q));
      });
    }
  }

  // 2. Rigs: one per character and facing, built on the base.
  const rigs = {};
  await pool(Object.keys(bases), 4, async (key) => {
    const [character, f] = key.split(':');
    const b = bases[key];
    const res = await pl.post('/estimate-custom-skeleton', {
      images: [b64png(toPng(sheet, b.img))],
      description: CHARACTERS[character].rigDescription,
      action: 'skate, shoot, check, fall',
      direction: DIRS[f],
      view: VIEW
    }, { label: `rig ${key}` });
    rigs[key] = { rig: res.rig, kind: res.kind, keypoints: res.frames[0] };
  });

  // 3 + 4. Per chunk: place the rig on the original frames, then animate the base into those poses.
  const hd = {};
  const skeletons = {};
  await pool(jobs, 4, async (job) => {
    const key = job.character + ':' + job.facing;
    const base = bases[key];
    const rig = rigs[key];
    const spec = CHARACTERS[job.character];
    const box = sp.unionBox([base.box, ...job.frames.map((n) => sp.bounds(sheet.frame(n)))], 4);
    const W = (box.x1 - box.x0) * 2, H = (box.y1 - box.y0) * 2;
    if (W > 256 || H > 256) throw new Error(`canvas ${W}x${H} too big for frames ${job.frames}`);
    const baseOnCanvas = sp.placeIndices(base.img, W, H, (base.box.x0 - box.x0) * 2, (base.box.y0 - box.y0) * 2);
    const basePng = toPng(sheet, baseOnCanvas);
    // The rig was placed on the base's own canvas; carry it to this canvas.
    const bw = (base.box.x1 - base.box.x0) * 2, bh = (base.box.y1 - base.box.y0) * 2;
    const ox = (base.box.x0 - box.x0) * 2, oy = (base.box.y0 - box.y0) * 2;
    const baseKeys = rig.keypoints.map((k) => ({ label: k.label, x: (k.x * bw + ox) / W, y: (k.y * bh + oy) / H, z_index: Math.round(k.z_index || 0) }));
    const hints = job.frames.map((n) => sp.indicesOnCanvas(sheet.frame(n), box, 2));
    const label = `${key} frames ${job.frames[0]}-${job.frames[job.frames.length - 1]}`;
    const placed = await pl.post('/estimate-custom-skeleton', {
      images: hints.map((h) => b64png(toPng(sheet, h))),
      direction: DIRS[job.facing],
      view: VIEW,
      rig: rig.rig,
      reference: { image: b64png(basePng), keypoints: baseKeys }
    }, { label: 'place ' + label });
    const poses = placed.frames.map((fr) => fr.map((k) => ({ label: k.label, x: Math.min(1, Math.max(0, k.x)), y: Math.min(1, Math.max(0, k.y)), z_index: Math.round(k.z_index || 0) })));
    const actions = [...new Set(job.frames.map((n) => (sheet.catalog.spfs.find((s) => n >= s.start && n <= (s.end || s.start)) || { name: 'SPFskate' }).name.replace(/^SPF/i, '').toLowerCase()))];
    const res = await pl.post('/animate-with-skeleton-v3', {
      description: spec.look,
      action: actions.join(', ').slice(0, 60),
      direction: DIRS[job.facing],
      view: VIEW,
      first_frame: b64png(basePng),
      first_frame_keypoints: baseKeys,
      keypoints: poses,
      rig: rig.rig,
      template_id: 'mannequin',
      seed: SEED,
      no_background: true
    }, { label: 'animate ' + label });
    job.frames.forEach((n, i) => {
      const raw = png.decode(stripB64(res.images[i]));
      const allowed = usedIndices([hints[i], base.img]);
      const q = addSpray(despeckle(sp.quantize(raw, sheet.palette, allowed, hints[i])), hints[i]);
      const c = crop(q, box);
      if (c) hd[n] = c;
      skeletons[n] = { character: job.character, body: job.facing, keypoints: poses[i].map((k) => ({ label: k.label, x: +(box.x0 * 2 + k.x * W).toFixed(1), y: +(box.y0 * 2 + k.y * H).toFixed(1), z: k.z_index })) };
    });
  });

  // Score the rig-posed frames; the ones that went wrong are redrawn from the frame itself.
  const method = {};
  for (const n of Object.keys(hd)) method[n] = 'rig';
  const fallback = [];
  for (const [n, c] of Object.entries(hd)) {
    const sc = score(sheet, Number(n), { x: c.x, y: c.y, w: c.w, h: c.h, pixels: c.data });
    if (sc.iou < MIN_IOU || sc.color < MIN_COLOR) fallback.push(Number(n));
  }
  if (fallback.length) console.error(`${fallback.length} rig frames below the fidelity floor, redrawn from the frame: ${fallback.join(' ')}`);

  // Props, and the fallbacks: redrawn at 2x straight from the frame.
  {
    const redraw = [...(only ? [] : RESIZE_FRAMES), ...fallback];
    await pool(redraw, 4, async (n) => {
      const f = sheet.frame(n);
      // /resize takes at most 200 pixels a side: no margin for the 100-wide gloves frame.
      const box = sp.unionBox([sp.bounds(f)], f.width + 4 > 100 ? 0 : 2);
      const one = sp.indicesOnCanvas(f, box, 1);
      const two = sp.indicesOnCanvas(f, box, 2);
      const used = usedIndices([one]);
      const swatch = [...used];
      const sw = new Uint8Array(swatch.length * 4);
      swatch.forEach((c, i) => sw.set([...sheet.palette[c], 255], i * 4));
      const t = table.get(n);
      const look = n === 353 ? 'two hockey gloves and two wooden hockey sticks dropped on the ice'
        : RESIZE_FRAMES.includes(n) ? CHARACTERS.skater.look.replace('holding a wooden hockey stick', 'holding the silver Stanley Cup trophy over his head')
          : CHARACTERS[t.character].look;
      const facing = RESIZE_FRAMES.includes(n) ? (n === 353 ? null : n - 217) : t.facing;
      const res = await pl.post('/resize', {
        description: look,
        reference_image: b64png(toPng(sheet, one)),
        reference_image_size: { width: one.width, height: one.height },
        target_size: { width: two.width, height: two.height },
        view: VIEW,
        direction: facing == null ? undefined : DIRS[facing],
        no_background: true,
        init_image: b64png(toPng(sheet, two)),
        init_image_strength: 300,
        color_image: b64png(png.encodeRgba(swatch.length, 1, sw)),
        seed: SEED
      }, { label: 'resize frame ' + n });
      const q = addSpray(clipToBody(despeckle(sp.quantize(png.decode(stripB64(res.image)), sheet.palette, used, two)), two), two);
      const c = crop(q, box);
      if (c) { hd[n] = c; method[n] = 'resize'; }
    });
  }

  // 5. Write: merge with what is already on disk (a partial --only run adds to it).
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, 'nhl92-sprites-hd.json');
  const prev = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { frames: {}, skeletons: {}, rigs: {} };
  const out = {
    game: 'nhl92',
    bank: 'Sprites.anim',
    scale: 2,
    source: 'PixelLab (edit-images-v2 bases, estimate-custom-skeleton rigs, animate-with-skeleton-v3 frames); tools/pixellab/hd-sprites.js',
    note: 'Pixels are palette indices into the Sprites.anim palette (0 transparent), zlib-compressed and base64. x, y: top-left in 2x pixels relative to the frame 0,0.',
    frames: { ...prev.frames },
    skeletons: { ...prev.skeletons },
    rigs: { ...prev.rigs }
  };
  for (const [n, c] of Object.entries(hd)) out.frames[n] = { x: c.x, y: c.y, w: c.w, h: c.h, method: method[n], data: zlib.deflateSync(Buffer.from(c.data), { level: 9 }).toString('base64') };
  for (const [n, s] of Object.entries(skeletons)) out.skeletons[n] = s;
  for (const [k, r] of Object.entries(rigs)) out.rigs[k] = r.rig.map((j) => ({ name: j.name, parent: j.parent }));
  const sorted = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => (+a[0] || 0) - (+b[0] || 0) || a[0].localeCompare(b[0])));
  out.frames = sorted(out.frames); out.skeletons = sorted(out.skeletons); out.rigs = sorted(out.rigs);
  fs.writeFileSync(outFile, JSON.stringify(out));
  console.error(`wrote ${Object.keys(out.frames).length} HD frames to ${path.relative(ROOT, outFile)}`);
  const bal = await pl.balance().catch(() => null);
  if (bal) console.error('balance:', JSON.stringify(bal.subscription || bal));
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });

module.exports = { frameTable, CHARACTERS, DIRS };
