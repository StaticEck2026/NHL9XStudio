/**
 * Put new frames together from library parts. Pixels are copied, never redrawn or scaled: a part keeps every pixel
 * of the retail frame it came from and only moves (and mirrors, as the Genesis sprite flip does).
 *
 *   const C = require('./compose');
 *   const lib = C.source(loadAll(...))                         // frames + anatomy, in memory
 *   const cel = C.compose([
 *     { id: '93g:357', parts: ['head', 'torso', 'leg0', 'leg1', 'skate0', 'skate1', 'shadow', 'arm1', 'hand1'] },
 *     { id: '93g:360', parts: ['arm0', 'hand0'], anchor: ['shoulder0', { id: '93g:357', joint: 'shoulder0' }] },
 *   ], lib, { space: 'zones' })
 *
 * A layer's anchor [joint, target] moves the layer so its joint lands on the target: a point [x, y], or a joint of
 * another frame ({ id, joint, flip, at }) as placed by its own layer. Layers draw in order, later on top. space:
 * 'zones' (PC sprite indices: mixes Genesis and PC parts and colours with any PC jersey) or 'native' (each frame's
 * own pixels: only mix frames of one space). Returns { w, h, x0, y0, px, owner (layer of each pixel), empty }.
 */
'use strict';

const A = require('./anatomy');

function source(loaded) {
  const byId = new Map();
  for (const f of loaded.frames) byId.set(f.id, f);
  const anat = new Map();
  return {
    frame: (id) => { const f = byId.get(id); if (!f) throw new Error('no frame ' + id); return f; },
    anatomy: (id) => { if (!anat.has(id)) anat.set(id, A.analyse(byId.get(id))); return anat.get(id); },
    palettes: loaded.palettes
  };
}

function compose(layers, lib, opts = {}) {
  const space = opts.space || 'zones';
  const empty = space === 'zones' ? 255 : (lib.frame(layers[0].id).space === 'pc' ? 255 : 0);
  const placed = [];                               // { id, dx, dy, flip }
  const jointAt = (id, joint, dx, dy, flip) => {
    const k = lib.anatomy(id).keypoints[joint];
    if (!k) throw new Error(id + ' has no ' + joint);
    return [(flip ? -k[0] : k[0]) + dx, k[1] + dy];
  };
  const pixels = new Map();
  layers.forEach((L, li) => {
    const f = lib.frame(L.id), a = lib.anatomy(L.id);
    let [dx, dy] = L.at || [0, 0];
    const flip = !!L.flip;
    if (L.anchor) {
      const [joint, target] = L.anchor;
      let to = target;
      if (!Array.isArray(target)) {
        const p = placed.find((q) => q.id === target.id) || { dx: 0, dy: 0, flip: !!target.flip };
        to = jointAt(target.id, target.joint, p.dx, p.dy, p.flip);
      }
      const from = jointAt(L.id, joint, 0, 0, flip);
      dx = Math.round(to[0] - from[0] + (L.nudge ? L.nudge[0] : 0));
      dy = Math.round(to[1] - from[1] + (L.nudge ? L.nudge[1] : 0));
    }
    placed.push({ id: L.id, dx, dy, flip });
    const want = new Set(L.parts || A.PARTS);
    const src = space === 'zones' ? f.label : f.px;
    for (let i = 0; i < f.w * f.h; i++) {
      if (!want.has(a.part[i])) continue;
      const v = src[i];
      if (v === (space === 'zones' || f.space === 'pc' ? 255 : 0)) continue;
      const x = f.x0 + (i % f.w), y = f.y0 + ((i / f.w) | 0);
      // The sprite flip mirrors about the player position, a pixel to the left of it (as tools/build-pc-gifs.js).
      pixels.set(((flip ? -x - 1 : x) + dx) + ',' + (y + dy), [v, li]);
    }
  });
  const pts = [...pixels.keys()].map((k) => k.split(',').map(Number));
  const x0 = Math.min(...pts.map((p) => p[0])), y0 = Math.min(...pts.map((p) => p[1]));
  const w = Math.max(...pts.map((p) => p[0])) - x0 + 1, h = Math.max(...pts.map((p) => p[1])) - y0 + 1;
  const px = new Uint8Array(w * h).fill(empty), owner = new Uint8Array(w * h).fill(255);
  for (const [k, [v, li]] of pixels) { const [x, y] = k.split(',').map(Number); px[(y - y0) * w + (x - x0)] = v; owner[(y - y0) * w + (x - x0)] = li; }
  return { w, h, x0, y0, px, owner, empty, placed };
}

module.exports = { source, compose };
