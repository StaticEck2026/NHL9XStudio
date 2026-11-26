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

// The pose maths is lib/sprite-rig.js's, shared with the animation builder.
const R = require('../../lib/sprite-rig');
const { JOINTS, normalise, distance } = R;
const mirror = R.mirrorPose;

/** opts.duplicates: also search NHLPA 93 frames identical to NHL 94's (sameAs); left out by default. */
function open(dir, opts = {}) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'frames.json'), 'utf8'));
  const frames = meta.frames.filter((f) => !f.prop && (opts.duplicates || !f.sameAs));
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
