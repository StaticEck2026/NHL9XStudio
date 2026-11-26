/**
 * Take the stick out of a retail skater frame, leaving the empty-handed body.
 *
 * The art draws a stick as a one-pixel line of colour 14 (wood) from the gloves to a blade that is a two-row run of
 * colour 14 on the ice, with colour 15 (ice shadow) under it: solid under the blade, dotted under a raised shaft.
 * Colour 14 and 15 are the same in every team palette, so these two indices find the stick on any jersey.
 *
 *  1. Every colour-14 pixel goes. Where the shaft crossed the body (body pixels on both sides of it, across or
 *     along), the hole takes the colour the body has on either side, the same way the artist would have painted the
 *     jersey or pants behind it. Holes are filled from the outside in, so a two-pixel blade crossing the pants closes.
 *  2. Colour-15 pixels that only belonged to the stick go: shadow farther than SKATE_SHADOW pixels from any remaining
 *     skater pixel, and shadow touching the removed wood that does not touch a skate. The skates keep their own
 *     shadow.
 */
'use strict';

const { Cel, STICK, SHADOW, BLACK, STEEL } = require('./cel');

const SKATE_SHADOW = 2;

const isBody = (v) => v && v !== STICK && v !== SHADOW;

function fillColour(cel, x, y) {
  const l = cel.get(x - 1, y), r = cel.get(x + 1, y), u = cel.get(x, y - 1), d = cel.get(x, y + 1);
  const across = isBody(l) && isBody(r);
  const along = isBody(u) && isBody(d);
  if (!across && !along) return 0;
  // Prefer the pair that agrees; the run the stick cut keeps its colour.
  if (across && l === r) return l;
  if (along && u === d) return u;
  const votes = new Map();
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const v = cel.get(x + dx, y + dy);
    if (isBody(v)) votes.set(v, (votes.get(v) || 0) + (dx && dy ? 1 : 2));
  }
  let best = 0, score = -1;
  for (const [v, s] of votes) if (s > score) { best = v; score = s; }
  return best;
}

/**
 * keepStick: optional predicate (x, y) => true for wood pixels that are not the stick (none in the skater frames).
 * Returns { body, stick } — the body without the stick, and the stick's own wood and shadow pixels as a cel.
 */
function unstick(src) {
  const cel = src.clone();
  const stick = Cel.empty(src.x0, src.y0, src.w, src.h);
  let holes = cel.pixels().filter(([, , v]) => v === STICK).map(([x, y]) => [x, y]);
  for (const [x, y] of holes) { stick.set(x, y, STICK); cel.set(x, y, 0); }
  // Close holes from the outside in: a pass fills every hole with body on both sides, until none changes.
  for (let pass = 0; pass < 6 && holes.length; pass++) {
    const fills = [];
    for (const [x, y] of holes) {
      const v = fillColour(cel, x, y);
      if (v) fills.push([x, y, v]);
    }
    if (!fills.length) break;
    for (const [x, y, v] of fills) cel.set(x, y, v);
    const done = new Set(fills.map(([x, y]) => x + ',' + y));
    holes = holes.filter(([x, y]) => !done.has(x + ',' + y));
  }
  // Shadow that belonged to the stick: shadow no skater pixel is near, and shadow touching the wood that went
  // unless it also touches a skate. Only the skater's own line counts as body here; the ice spray of the stop
  // frames is palette line 0 and casts no shadow.
  const wood = new Set(stick.pixels().map(([x, y]) => x + ',' + y));
  const skater = cel.pixels().filter(([, , v]) => isBody(v) && v >> 4 === STICK >> 4);
  const skates = skater.filter(([, y, v]) => (v === BLACK || v === STEEL) && y >= -3);
  const within = (list, x, y, r) => list.some(([bx, by]) => Math.max(Math.abs(bx - x), Math.abs(by - y)) <= r);
  for (const [x, y, v] of cel.pixels()) {
    if (v !== SHADOW) continue;
    let byWood = false;
    for (let dy = -1; dy <= 1 && !byWood; dy++) for (let dx = -1; dx <= 1 && !byWood; dx++) byWood = wood.has((x + dx) + ',' + (y + dy));
    const drop = !within(skater, x, y, SKATE_SHADOW) || (byWood && !within(skates, x, y, 1));
    if (drop) { cel.set(x, y, 0); stick.set(x, y, SHADOW); }
  }
  return { body: cel, stick };
}

module.exports = { unstick, SKATE_SHADOW };
