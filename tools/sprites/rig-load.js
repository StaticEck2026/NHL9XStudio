/**
 * The sprite library as lib/sprite-rig.js frames, in memory (from the ROMs and PC files, as frames.js reads them).
 *   const { lib, palettes } = require('./rig-load').load({ pc: 'pc95' });
 */
'use strict';

const F = require('./frames');
const A = require('./anatomy');
const R = require('../../lib/sprite-rig');

const TITLES = { '93g': 'NHLPA Hockey \'93 (Genesis)', '94g': 'NHL Hockey \'94 (Genesis)', '95pc': 'NHL Hockey 95 (PC)' };

function load(opts = {}) {
  const loaded = F.loadAll(opts);
  const anat = new Map();
  const frames = loaded.frames.map((f) => {
    const a = f.sameAs && anat.has(f.sameAs) ? anat.get(f.sameAs) : A.analyse(f);
    anat.set(f.id, a);
    return {
      id: f.id, game: f.game, n: f.n, group: f.group, facing: f.facing, step: f.step, w: f.w, h: f.h, x0: f.x0, y0: f.y0,
      px: f.px, part: Uint8Array.from(a.part, (p) => (p ? R.PART_NO[p] : 255)), kp: a.keypoints, empty: f.space === 'pc' ? 255 : 0,
      prop: a.prop, sameAs: f.sameAs || null, labelSource: f.labelSource
    };
  });
  return { lib: R.index(frames), frames, palettes: loaded.palettes, sources: loaded.sources, titles: TITLES };
}

module.exports = { load, TITLES };
