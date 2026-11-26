/**
 * Pose vectors and nearest-pose search over the sprite library (library/frames.json).
 *
 * A pose is the skeleton of tools/sprites/anatomy.js, moved so the hips sit at 0, 0 and scaled so the body is 1
 * tall (head to the skates' midpoint; 30 pixels when either is missing). Arms and legs are numbered left to right on
 * screen, so a pose and its mirror image are different poses; search with { mirror: true } to also try every frame
 * mirrored (the Genesis can flip a sprite in hardware).
 *
 *   const P = require('./pose');
 *   const lib = P.open('library');
 *   lib.nearest({ keypoints: {...} }, { k: 5, facing: 2, groups: ['SPFHold'] })   // -> [{ id, d, mirrored }]
 *   lib.nearest(lib.frame('94g:345'), { k: 5 })                                    // poses like a frame's
 */
'use strict';

const fs = require('fs');
const path = require('path');

const JOINTS = ['head', 'neck', 'shoulder0', 'elbow0', 'hand0', 'shoulder1', 'elbow1', 'hand1', 'hip0', 'knee0', 'skate0',
  'hip1', 'knee1', 'skate1', 'stickButt', 'stickBlade'];
const WEIGHT = { head: 1.5, neck: 1, hand0: 1.5, hand1: 1.5, skate0: 1.2, skate1: 1.2, stickBlade: 0.7, stickButt: 0.5 };

function normalise(kp) {
  const mid = kp.hipMid || [0, -10];
  const feet = [kp.skate0, kp.skate1].filter(Boolean);
  const footMid = feet.length ? [feet.reduce((a, p) => a + p[0], 0) / feet.length, feet.reduce((a, p) => a + p[1], 0) / feet.length] : null;
  const tall = kp.head && footMid ? Math.hypot(kp.head[0] - footMid[0], kp.head[1] - footMid[1]) : 30;
  const scale = Math.max(tall, 10);
  const v = {};
  for (const j of JOINTS) v[j] = kp[j] ? [(kp[j][0] - mid[0]) / scale, (kp[j][1] - mid[1]) / scale] : null;
  return v;
}

/** Mirror a normalised pose left to right; limb numbers swap so they stay left-to-right. */
function mirror(v) {
  const out = {};
  for (const j of JOINTS) out[j] = v[j] ? [-v[j][0], v[j][1]] : null;
  const swap = (a, b) => { const t = out[a]; out[a] = out[b]; out[b] = t; };
  for (const p of ['shoulder', 'elbow', 'hand', 'hip', 'knee', 'skate']) swap(p + '0', p + '1');
  return out;
}

/** Mean weighted distance over the joints both poses show; a joint only one shows costs 0.35. */
function distance(a, b) {
  let sum = 0, wsum = 0;
  for (const j of JOINTS) {
    const w = WEIGHT[j] || 1;
    if (a[j] && b[j]) { sum += w * Math.hypot(a[j][0] - b[j][0], a[j][1] - b[j][1]); wsum += w; }
    else if (a[j] || b[j]) { sum += w * 0.35; wsum += w; }
  }
  return wsum ? sum / wsum : Infinity;
}

function open(dir) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'frames.json'), 'utf8'));
  const frames = meta.frames.filter((f) => !f.prop);
  const vecs = new Map(frames.map((f) => [f.id, normalise(f.keypoints)]));
  return {
    meta,
    frames,
    frame: (id) => meta.frames.find((f) => f.id === id) || null,
    vector: (id) => vecs.get(id),
    nearest(query, opts = {}) {
      const q = query.keypoints ? normalise(query.keypoints) : query;
      const out = [];
      for (const f of frames) {
        if (opts.facing != null && f.facing !== opts.facing) continue;
        if (opts.groups && !opts.groups.includes(f.group)) continue;
        if (opts.games && !opts.games.includes(f.game)) continue;
        if (query.id && f.id === query.id) continue;
        const v = vecs.get(f.id);
        out.push({ id: f.id, d: distance(q, v), mirrored: false });
        if (opts.mirror) out.push({ id: f.id, d: distance(q, mirror(v)), mirrored: true });
      }
      return out.sort((a, b) => a.d - b.d).slice(0, opts.k || 5).map((r) => Object.assign(r, { d: +r.d.toFixed(4) }));
    }
  };
}

module.exports = { open, normalise, mirror, distance, JOINTS };
