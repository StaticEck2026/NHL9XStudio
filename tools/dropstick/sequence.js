/**
 * The "drop stick and go back for it" sequence, one row per facing.
 *
 * Facing d (0 = north, clockwise, as dirtab in logic.asm) is the way the player skates when the stick goes. The
 * stick's blade catches the ice and the shaft pole-vaults over its heel: it stands up, falls forward and lands flat
 * with the butt ahead (toward d) and the blade behind. The player glides on over it, scrape-stops, pivots through
 * facing d + 2 to r = d + 4, skates back, bends to the butt end, grabs it and skates off facing r with the stick on
 * the ice. The stick landing butt-first is what lets the retail SPFsweep pose of facing r pick it up: in that pose the
 * hands are at the butt and the blade is ahead in r.
 *
 * Every player picture is a retail frame, or a retail frame with the stick taken out (unstick.js). The stick on its
 * own (falling or lying) is a new object drawn by stick.js; in the game it would be its own sprite, like the puck,
 * placed at the blade's heel and sorted by y like every other object.
 */
'use strict';

const { unstick } = require('./unstick');
const { drawStick } = require('./stick');

const UNIT = [[0, -1], [Math.SQRT1_2, -Math.SQRT1_2], [1, 0], [Math.SQRT1_2, Math.SQRT1_2],
  [0, 1], [-Math.SQRT1_2, Math.SQRT1_2], [-1, 0], [-Math.SQRT1_2, -Math.SQRT1_2]];
const NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const STICK_HEIGHT = 24;     // standing up: a little under the 28-32 pixel skater
const FEET = [0, 2];         // where the skates meet the ice, below the player position

const round = (p) => [Math.round(p[0]), Math.round(p[1])];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const norm = (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };

function build(src) {
  const S = src.spf;
  const skatewp = (dir, k) => S.SPFskatewp + 5 * dir + k;   // k 0 = glide pose, 1..4 = stride (SPAskatewp)
  const stop = (dir, k) => S.SPFstop + 2 * dir + k;
  const sweep = (dir, k) => S.SPFsweep + 2 * dir + k;

  const bodies = new Map();      // retail frame -> stickless body (new frame)
  const body = (n) => {
    if (!bodies.has(n)) bodies.set(n, unstick(src.frame(n)).body);
    return bodies.get(n).clone();
  };

  /**
   * The stick lying flat where the sweep pose of facing r will grab it, in that frame's space: the heel on the
   * pose's blade (its hotspot), lying back toward the skates, as long as the retail stick reaches from the blade to
   * its skates allow (22 pixels at most, the length of the sticks dropped in SPFgloves frame 353 seen end to end).
   */
  function flatStick(r) {
    const n = sweep(r, 0);
    const hot = src.hot(n);
    const axis = mul(norm(sub(hot, FEET)), -1);   // heel to butt points back at the player
    const toBlade = sub(hot, FEET);
    // Lying flat it reaches back toward the skates but stops short of them: the skates are drawn over the ice,
    // and the pose's gloves sit above the last few pixels of it.
    const length = Math.max(10, Math.min(22, Math.round(Math.hypot(toBlade[0], toBlade[1])) - 4));
    return { heel: hot, axis, length };
  }

  const rows = [];
  for (let d = 0; d < 8; d++) {
    const r = (d + 4) % 8, side = (d + 2) % 8;
    const u = UNIT[d];
    const flat = flatStick(r);
    // World: the player starts at 0,0 carrying the stick. The blade is where the glide pose puts the puck.
    const carry = skatewp(d, 1);
    const heel = round(src.hot(carry));
    // In the stick's frame of reference (heel at 0,0): fall in the plane of its own axis, landing on `flat`.
    const stickAt = (angle) => drawStick({ axis: flat.axis, length: flat.length, height: STICK_HEIGHT, angle });
    // Where the player has to stand for the sweep pose's blade to sit on the stick's heel.
    const grabAt = sub(heel, round(flat.heel));
    // Glide on past the spot he will pick it up from, stop a few pixels beyond it, and come back.
    const along = (k) => round(mul(u, k));
    const stopK = Math.round(Math.max(30, grabAt[0] * u[0] + grabAt[1] * u[1] + 7));
    const back = (t) => round(add(along(stopK), mul(sub(grabAt, along(stopK)), t)));

    const cels = [
      { id: 'carry', label: 'carry', note: 'retail frame', frame: carry, cel: src.frame(carry), at: along(0), stick: null },
      { id: 'catch', label: 'blade catches', frame: skatewp(d, 2), cel: body(skatewp(d, 2)), at: along(5), stick: { angle: 100 } },
      { id: 'vault', label: 'falls', frame: skatewp(d, 3), cel: body(skatewp(d, 3)), at: along(10), stick: { angle: 145 } },
      { id: 'clatter', label: 'clatters', frame: skatewp(d, 4), cel: body(skatewp(d, 4)), at: along(15), stick: { angle: 180 } },
      { id: 'coast', label: 'coasts', frame: skatewp(d, 0), cel: body(skatewp(d, 0)), at: along(Math.round(15 + (stopK - 18) / 2)), stick: { angle: 180 } },
      { id: 'stop', label: 'stops', frame: stop(d, 0), cel: body(stop(d, 0)), at: along(stopK - 3), stick: { angle: 180 } },
      { id: 'stop2', label: 'stops', frame: stop(d, 1), cel: body(stop(d, 1)), at: along(stopK), stick: { angle: 180 } },
      { id: 'pivot', label: 'pivots', frame: stop(side, 0), cel: body(stop(side, 0)), at: along(stopK), stick: { angle: 180 } },
      { id: 'turned', label: 'turns back', frame: skatewp(r, 0), cel: body(skatewp(r, 0)), at: along(stopK), stick: { angle: 180 } },
      { id: 'back1', label: 'skates back', frame: skatewp(r, 1), cel: body(skatewp(r, 1)), at: back(0.4), stick: { angle: 180 } },
      { id: 'back2', label: 'skates back', frame: skatewp(r, 2), cel: body(skatewp(r, 2)), at: back(0.8), stick: { angle: 180 } },
      { id: 'reach', label: 'reaches', frame: sweep(r, 0), cel: body(sweep(r, 0)), at: grabAt, stick: { angle: 180 } },
      { id: 'grab', label: 'grabs', note: 'retail frame', frame: sweep(r, 0), cel: src.frame(sweep(r, 0)), at: grabAt, stick: null },
      { id: 'rise', label: 'stick down', note: 'retail frame', frame: skatewp(r, 0), cel: src.frame(skatewp(r, 0)), at: grabAt, stick: null },
      { id: 'away', label: 'skates off', note: 'retail frame', frame: skatewp(r, 1), cel: src.frame(skatewp(r, 1)), at: add(grabAt, round(mul(UNIT[r], 5))), stick: null }
    ];
    for (const c of cels) {
      c.retail = !!c.note;
      if (c.stick) {
        const drawn = stickAt(c.stick.angle);
        c.stick = { angle: c.stick.angle, cel: drawn.cel, at: heel };
      }
    }
    rows.push({ d, r, name: NAMES[d], back: NAMES[r], heel, grabAt, flat, cels });
  }
  return { rows, bodies, NAMES, UNIT };
}

module.exports = { build, NAMES, UNIT, STICK_HEIGHT };
