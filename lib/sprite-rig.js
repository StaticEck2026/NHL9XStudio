/**
 * Skeleton rig over the skater sprite library (docs/sprite-library): layers, pose maths, limb swaps and the eight
 * facings from one pose. Used by the animation builder (public/animator.js) and the tools (tools/sprites/).
 *
 * A frame: { id, game, group, facing, step, w, h, x0, y0, px, part, kp, empty }
 *   px    the frame's own pixels (Genesis: palette line * 16 + colour, empty 0; PC: sprite index, empty 255)
 *   part  part number per pixel (PARTS), 255 none
 *   kp    skeleton: { head, neck, shoulder0/1, elbow0/1, hand0/1, hipMid, hip0/1, knee0/1, skate0/1, stickButt,
 *         stickBlade } in player-position coordinates (0, 0 where the skates meet the ice), null when hidden
 * Nothing is painted in a new colour: limbs are retail limbs, turned a few degrees by RotSprite (lib/pixel-art.js)
 * onto the pose; the shaft of a moved stick is redrawn as the game draws one, a clean line in its own stick colour,
 * with a retail blade.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pixel-art'));
  else root.NhlSpriteRig = factory(root.NhlPixelArt);
})(typeof self !== 'undefined' ? self : this, function (PA) {
  'use strict';

  const PARTS = ['head', 'torso', 'arm0', 'arm1', 'hand0', 'hand1', 'leg0', 'leg1', 'skate0', 'skate1', 'stick', 'shadow', 'other'];
  const JOINTS = ['head', 'neck', 'shoulder0', 'elbow0', 'hand0', 'shoulder1', 'elbow1', 'hand1', 'hip0', 'knee0', 'skate0',
    'hip1', 'knee1', 'skate1', 'stickButt', 'stickBlade'];
  /** Limbs: the parts that move together, the joint they hang from, and the joints along them. */
  const LIMBS = {
    arm0: { kind: 'arm', root: 'shoulder0', joints: ['elbow0', 'hand0'], parts: ['arm0', 'hand0'] },
    arm1: { kind: 'arm', root: 'shoulder1', joints: ['elbow1', 'hand1'], parts: ['arm1', 'hand1'] },
    leg0: { kind: 'leg', root: 'hip0', joints: ['knee0', 'skate0'], parts: ['leg0', 'skate0'] },
    leg1: { kind: 'leg', root: 'hip1', joints: ['knee1', 'skate1'], parts: ['leg1', 'skate1'] },
    stick: { kind: 'stick', root: 'stickButt', joints: ['stickBlade'], parts: ['stick', 'stickShadow'] }
  };
  const WEIGHT = { head: 1.5, neck: 1, hand0: 1.5, hand1: 1.5, skate0: 1.2, skate1: 1.2, stickBlade: 0.7, stickButt: 0.5 };
  const PART_NO = Object.fromEntries(PARTS.map((p, i) => [p, i]));
  /** Animations that carry a prop (the Stanley Cup): never a base or a limb donor for a new pose. */
  const PROP_GROUPS = ['SPFcup', 'SPFcupskate', 'SPFcupaccept', 'SPFbench', 'SPFlinechange'];

  // ---- pose maths --------------------------------------------------------------------------------------------
  /** Hips at 0, 0, body height 1 (head to the skates' midpoint; 30 pixels when either is missing). */
  function frameOf(kp) {
    const mid = kp.hipMid || [0, -10];
    const feet = [kp.skate0, kp.skate1].filter(Boolean);
    const fm = feet.length ? [feet.reduce((a, p) => a + p[0], 0) / feet.length, feet.reduce((a, p) => a + p[1], 0) / feet.length] : null;
    const tall = kp.head && fm ? Math.hypot(kp.head[0] - fm[0], kp.head[1] - fm[1]) : 30;
    return { mid, scale: Math.max(tall, 10) };
  }
  function normalise(kp) {
    const { mid, scale } = frameOf(kp);
    const v = {};
    for (const j of JOINTS) v[j] = kp[j] ? [(kp[j][0] - mid[0]) / scale, (kp[j][1] - mid[1]) / scale] : null;
    return v;
  }
  function denormalise(v, ref) {
    const { mid, scale } = frameOf(ref);
    const kp = {};
    for (const j of JOINTS) kp[j] = v[j] ? [v[j][0] * scale + mid[0], v[j][1] * scale + mid[1]] : null;
    const hips = [kp.hip0, kp.hip1].filter(Boolean);
    kp.hipMid = hips.length ? [hips.reduce((a, p) => a + p[0], 0) / hips.length, hips.reduce((a, p) => a + p[1], 0) / hips.length] : ref.hipMid;
    return kp;
  }
  function mirrorPose(v) {
    const out = {};
    for (const j of JOINTS) out[j] = v[j] ? [-v[j][0], v[j][1]] : null;
    for (const p of ['shoulder', 'elbow', 'hand', 'hip', 'knee', 'skate']) { const t = out[p + '0']; out[p + '0'] = out[p + '1']; out[p + '1'] = t; }
    return out;
  }
  function distance(a, b) {
    let sum = 0, wsum = 0;
    for (const j of JOINTS) {
      const w = WEIGHT[j] || 1;
      if (a[j] && b[j]) { sum += w * Math.hypot(a[j][0] - b[j][0], a[j][1] - b[j][1]); wsum += w; }
      else if (a[j] || b[j]) { sum += w * 0.35; wsum += w; }
    }
    return wsum ? sum / wsum : Infinity;
  }

  // ---- layers ------------------------------------------------------------------------------------------------
  const centreOf = (pts) => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  /** Each part on its own: { part, x0, y0, w, h, px } in player-position coordinates. */
  function layers(f) {
    if (!f._layers || f._layersOf !== f.part) { f._layers = cutLayers(f); f._layersOf = f.part; }
    return f._layers.map((L) => Object.assign({}, L));
  }
  function cutLayers(f) {
    const out = [];
    for (let p = 0; p < PARTS.length; p++) {
      let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
      for (let i = 0; i < f.w * f.h; i++) {
        if (f.part[i] !== p) continue;
        const x = i % f.w, y = (i / f.w) | 0;
        if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
      if (maxX < 0) continue;
      const w = maxX - minX + 1, h = maxY - minY + 1, px = new Uint8Array(w * h).fill(f.empty);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (minY + y) * f.w + minX + x;
        if (f.part[i] === p) px[y * w + x] = f.px[i];
      }
      out.push({ part: PARTS[p], x0: f.x0 + minX, y0: f.y0 + minY, w, h, px });
    }
    // The stick casts its own shadow on the ice, below it however high it is held: in a frame with a stick, shadow
    // more than 3 pixels from the legs and skates is the stick's, and goes with it (its own layer, moved and swapped
    // with the stick).
    const sh = out.findIndex((L) => L.part === 'shadow'), st = out.find((L) => L.part === 'stick');
    if (sh >= 0 && st) {
      const at = (P) => { const pts = []; for (let i = 0; i < f.w * f.h; i++) if (P.includes(f.part[i])) pts.push([f.x0 + (i % f.w), f.y0 + ((i / f.w) | 0)]); return pts; };
      const legs = at([PART_NO.leg0, PART_NO.leg1, PART_NO.skate0, PART_NO.skate1]);
      const near = (pts, x, y, r) => pts.some(([a, b]) => Math.max(Math.abs(a - x), Math.abs(b - y)) <= r);
      const S = out[sh], stickPx = new Uint8Array(S.w * S.h).fill(f.empty);
      let moved = 0;
      for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) {
        const v = S.px[y * S.w + x];
        if (v === f.empty) continue;
        const X = S.x0 + x, Y = S.y0 + y;
        if (!near(legs, X, Y, 3)) { stickPx[y * S.w + x] = v; S.px[y * S.w + x] = f.empty; moved++; }
      }
      if (moved) out.push({ part: 'stickShadow', x0: S.x0, y0: S.y0, w: S.w, h: S.h, px: stickPx });
    }
    return out;
  }
  /**
   * Draw order, far to near. The rink is seen from above and in front, so of a pair of limbs the one hanging from
   * the joint lower on screen is the near one (a limb seen alone counts as near). Bottom to top: the shadow, the
   * stick's shadow, the far leg, the near leg, the far arm, the torso, the head, the stick, the near arm; each
   * hand or skate just over its limb.
   */
  function nearOf(kp, a, b) {
    const ya = kp[a] ? kp[a][1] : null, yb = kp[b] ? kp[b][1] : null;
    if (ya == null && yb == null) return 0;
    if (yb == null) return 0;
    if (ya == null) return 1;
    return ya >= yb ? 0 : 1;
  }
  function depthOf(part, kp) {
    const nearArm = nearOf(kp, 'shoulder0', 'shoulder1'), nearLeg = nearOf(kp, 'hip0', 'hip1') ;
    const k = Number(part.slice(-1));
    switch (part) {
      case 'shadow': return 0;
      case 'stickShadow': return 1;
      case 'leg0': case 'leg1': return k === nearLeg ? 3 : 2;
      case 'skate0': case 'skate1': return (k === nearLeg ? 3 : 2) + 0.1;
      case 'arm0': case 'arm1': return k === nearArm ? 7 : 4;
      case 'hand0': case 'hand1': return (k === nearArm ? 7 : 4) + 0.1;
      case 'torso': return 5;
      case 'head': return 6;
      case 'stick': return 6.5;
      default: return 8;
    }
  }
  function orderedLayers(f) {
    return layers(f).map((L) => Object.assign(L, { z: depthOf(L.part, f.kp) })).sort((a, b) => a.z - b.z);
  }

  // ---- the library -------------------------------------------------------------------------------------------
  /** frames: the frames above. Builds the lookups the rest needs. */
  /**
   * The PC sheet's blades are black tape, which the labelling can take for the helmet or leave unlabelled: pixels
   * joined to the stick near its blade point, far from the head, of the stick's own colours or black, are the stick's.
   */
  function repairBlade(f) {
    const T = f.kp.stickBlade, S = PART_NO.stick;
    let part = f.part;
    // Head pixels well away from the head are a mislabelled stick (on the line from butt to blade) or something else.
    if (f.kp.head && part.includes(PART_NO.head)) {
      part = part.slice();
      const B = f.kp.stickButt;
      for (let i = 0; i < f.w * f.h; i++) {
        if (part[i] !== PART_NO.head) continue;
        const q = [f.x0 + (i % f.w) + 0.5, f.y0 + ((i / f.w) | 0) + 0.5];
        if (Math.hypot(q[0] - f.kp.head[0], q[1] - f.kp.head[1]) <= 7) continue;
        part[i] = B && T && segDist(q, B, T) <= 3 ? S : PART_NO.other;
      }
    }
    if (!T || !part.includes(S)) return part;
    f = Object.assign({}, f, { part });
    part = part.slice();
    const vals = new Set();
    for (let i = 0; i < f.w * f.h; i++) if (part[i] === S) vals.add(f.px[i]);
    if (f.empty === 255) vals.add(0);
    const head = f.kp.head;
    const ok = (i) => {
      if (part[i] === S || f.px[i] === f.empty || !vals.has(f.px[i])) return false;
      if (![PART_NO.head, PART_NO.other, PART_NO.skate0, PART_NO.skate1, PART_NO.shadow, 255].includes(part[i])) return false;
      const q = [f.x0 + (i % f.w) + 0.5, f.y0 + ((i / f.w) | 0) + 0.5];
      const far = (p, r) => !p || Math.hypot(q[0] - p[0], q[1] - p[1]) > r;
      return Math.max(Math.abs(q[0] - T[0]), Math.abs(q[1] - T[1])) <= 7 && far(head, 5) && far(f.kp.skate0, 4) && far(f.kp.skate1, 4);
    };
    const queue = [];
    for (let i = 0; i < f.w * f.h; i++) if (part[i] === S) queue.push(i);
    while (queue.length) {
      const i = queue.pop(), x = i % f.w, y = (i / f.w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= f.w || Y >= f.h) continue;
        const j = Y * f.w + X;
        if (ok(j)) { part[j] = S; queue.push(j); }
      }
    }
    return part;
  }
  function index(frames) {
    for (const f of frames) if (f.part && f.kp) f.part = repairBlade(f);
    const byId = new Map(frames.map((f) => [f.id, f]));
    const sets = new Map();                                         // game|group|step -> [id per facing]
    for (const f of frames) {
      if (f.facing == null) continue;
      const k = f.game + '|' + f.group + '|' + f.step;
      if (!sets.has(k)) sets.set(k, new Array(8).fill(null));
      sets.get(k)[f.facing] = f.id;
    }
    for (const [k, s] of sets) if (s.some((x) => !x)) sets.delete(k);
    return { frames, byId, sets, vec: new Map(frames.map((f) => [f.id, normalise(f.kp)])) };
  }

  /** The vectors of a limb from its root joint (pixels), or null when the limb is not there. */
  function limbVectors(kp, limb) {
    const L = LIMBS[limb];
    const r = kp[L.root];
    if (!r) return null;
    const v = L.joints.map((j) => (kp[j] ? [kp[j][0] - r[0], kp[j][1] - r[1]] : null));
    return v.some(Boolean) ? v : null;
  }
  function vecCost(a, b) {
    let c = 0, n = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] && b[i]) { c += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]) * (i === a.length - 1 ? 1.5 : 1); n++; }
      else if (a[i] || b[i]) { c += 6; n++; }
    }
    return n ? c / n : Infinity;
  }
  /**
   * The library limb nearest to target vectors: among frames of one game and facing (both arms or both legs of each
   * frame are candidates). Returns { id, limb, cost } or null.
   */
  function findLimb(lib, game, facing, kind, target, opts = {}) {
    let best = null;
    for (const f of lib.frames) {
      if (f.game !== game || (facing != null && f.facing !== facing && !opts.anyFacing) || f.prop) continue;
      if (opts.exclude && opts.exclude(f)) continue;
      for (const limb of Object.keys(LIMBS)) {
        if (LIMBS[limb].kind !== kind) continue;
        const v = limbVectors(f.kp, limb);
        if (!v) continue;
        // The whole limb must be there (an arm and its hand, a leg and its skate): half a limb leaves a floating piece.
        if (!LIMBS[limb].parts.every((p) => p === 'stickShadow' || f.part.includes(PART_NO[p]))) continue;
        if (PROP_GROUPS.includes(f.group)) continue;
        const c = vecCost(target, v) + (f.facing === facing ? 0 : 2);
        if (!best || c < best.cost) best = { id: f.id, limb, cost: c };
      }
    }
    return best;
  }

  // ---- geometry ----------------------------------------------------------------------------------------------
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const mul = (a, k) => [a[0] * k, a[1] * k];
  const hyp = (v) => Math.hypot(v[0], v[1]);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const ang = (v) => Math.atan2(v[1], v[0]);
  const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
  const rot = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]; };
  const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const unit = (v) => { const d = hyp(v) || 1; return [v[0] / d, v[1] / d]; };
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const round2 = (v) => [Math.round(v[0]), Math.round(v[1])];
  function segDist(p, a, b) {
    const v = sub(b, a), L2 = v[0] * v[0] + v[1] * v[1];
    const t = L2 ? clamp(((p[0] - a[0]) * v[0] + (p[1] - a[1]) * v[1]) / L2, 0, 1) : 0;
    return dist(p, [a[0] + v[0] * t, a[1] + v[1] * t]);
  }

  /** Turns a limb or the body may take from the retail drawing it is built on, before it would no longer read as that drawing. */
  const MAX_TURN = { limb: 0.7, torso: 0.6, head: 0.6 };
  const MIN_BONE = 3;                                    // a bone shorter than this is turned with its neighbour, not on its own
  const BLADE = 3;                                       // pixels of a stick that are its blade, back from the blade point

  // ---- bones -------------------------------------------------------------------------------------------------
  /**
   * A limb of a frame cut at its middle joint: { upper, lower, end } layers (end: the hand, which turns with the
   * forearm, or the skate, which stays flat on the ice) and whether the two bones are long enough to turn apart.
   * Pixels within a pixel of the elbow or knee go in both bones, so a bent joint closes over.
   */
  function limbPieces(f, limb) {
    const Ld = LIMBS[limb], k = limb.slice(-1);
    const main = PART_NO[Ld.kind + k], endPart = PART_NO[(Ld.kind === 'arm' ? 'hand' : 'skate') + k];
    const r = f.kp[Ld.root], m = f.kp[Ld.joints[0]], e = f.kp[Ld.joints[1]];
    const split = !!(r && m && e && dist(r, m) >= MIN_BONE && dist(m, e) >= MIN_BONE);
    const up = new Uint8Array(f.w * f.h).fill(f.empty), lo = up.slice(), en = up.slice();
    let nu = 0, nl = 0, ne = 0;
    for (let i = 0; i < f.w * f.h; i++) {
      const p = f.part[i];
      if (p === endPart) { en[i] = f.px[i]; ne++; continue; }
      if (p !== main) continue;
      if (!split) { up[i] = f.px[i]; nu++; continue; }
      const q = [f.x0 + (i % f.w) + 0.5, f.y0 + ((i / f.w) | 0) + 0.5];
      const du = segDist(q, r, m), dl = segDist(q, m, e);
      if (du <= dl || dist(q, m) <= 1.2) { up[i] = f.px[i]; nu++; }
      if (dl < du || dist(q, m) <= 1.2) { lo[i] = f.px[i]; nl++; }
    }
    const L = (px) => PA.crop({ x0: f.x0, y0: f.y0, w: f.w, h: f.h, px }, f.empty);
    return { split, upper: nu ? L(up) : null, lower: nl ? L(lo) : null, end: ne ? L(en) : null };
  }

  /** Is pixel i of frame f inside the torso (torso pixels on both sides, across or down, within 5)? */
  function insideTorso(f, i) {
    const T = PART_NO.torso, x = i % f.w, y = (i / f.w) | 0;
    const hit = (dx, dy) => { for (let s = 1; s <= 5; s++) { const X = x + dx * s, Y = y + dy * s; if (X < 0 || Y < 0 || X >= f.w || Y >= f.h) return false; if (f.part[Y * f.w + X] === T) return true; } return false; };
    return (hit(-1, 0) && hit(1, 0)) || (hit(0, -1) && hit(0, 1));
  }

  // ---- retail statistics per game ------------------------------------------------------------------------------
  function statsOf(lib, game) {
    lib.stats = lib.stats || {};
    if (lib.stats[game]) return lib.stats[game];
    const arm = [], leg = [], stick = [];
    for (const f of lib.frames) {
      if (f.game !== game || f.prop || PROP_GROUPS.includes(f.group)) continue;
      const k = f.kp;
      for (const s of [0, 1]) {
        if (k['shoulder' + s] && k['hand' + s]) arm.push(dist(k['shoulder' + s], k['hand' + s]));
        if (k['hip' + s] && k['skate' + s]) leg.push(dist(k['hip' + s], k['skate' + s]));
      }
      if (k.stickButt && k.stickBlade) stick.push(dist(k.stickButt, k.stickBlade));
    }
    const q = (a, p, d) => { if (!a.length) return d; a.sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
    return (lib.stats[game] = { armReach: q(arm, 0.98, 12), legReach: q(leg, 0.98, 12), stickMin: q(stick, 0.05, 8), stickMax: q(stick, 0.95, 20) });
  }

  // ---- the stick -----------------------------------------------------------------------------------------------
  /** Every retail stick of a game, for its blade: { id, facing, butt, tip, len, angle, heel, blade (layer), shaft value, width }. */
  function sticksOf(lib, game) {
    lib.sticks = lib.sticks || {};
    if (lib.sticks[game]) return lib.sticks[game];
    const out = [];
    for (const f of lib.frames) {
      if (f.game !== game || f.prop || PROP_GROUPS.includes(f.group) || !f.kp.stickButt || !f.kp.stickBlade) continue;
      const B = f.kp.stickButt, T = f.kp.stickBlade, len = dist(B, T);
      if (len < 6) continue;
      const u = unit(sub(T, B));
      const st = layers(f).find((L) => L.part === 'stick');
      if (!st) continue;
      const blade = new Uint8Array(st.w * st.h).fill(f.empty);
      const vals = new Map();
      let nb = 0, ns = 0, minM = Infinity, maxM = -Infinity;
      for (let i = 0; i < st.w * st.h; i++) {
        const v = st.px[i];
        if (v === f.empty) continue;
        const q = [st.x0 + (i % st.w) + 0.5, st.y0 + ((i / st.w) | 0) + 0.5];
        const s = (q[0] - B[0]) * u[0] + (q[1] - B[1]) * u[1];
        if (s >= len - BLADE - 0.5) { blade[i] = v; nb++; }
        else { vals.set(v, (vals.get(v) || 0) + 1); ns++; const m = Math.abs(u[0]) >= Math.abs(u[1]) ? q[0] : q[1]; minM = Math.min(minM, m); maxM = Math.max(maxM, m); }
      }
      if (nb < 2 || ns < 3) continue;
      // A PC blade is black tape: a blade without it is a stick seen end-on or cut off, not one to copy.
      if (f.empty === 255 && ![...blade].some((v) => v === 0)) continue;
      const shaft = [...vals].sort((a, b) => b[1] - a[1])[0][0];
      out.push({ id: f.id, facing: f.facing, butt: B, tip: T, len, angle: ang(sub(T, B)), heel: add(B, mul(u, len - BLADE)),
        blade: PA.crop({ x0: st.x0, y0: st.y0, w: st.w, h: st.h, px: blade }, f.empty), shaft, width: ns / Math.max(1, maxM - minM + 1) > 1.6 ? 2 : 1 });
    }
    // Each blade mirrored too, as the Genesis sprite flip mirrors a frame: a facing's blade at an angle its own
    // frames never hold it.
    for (const d of out.slice()) {
      const b = d.blade, px = new Uint8Array(b.w * b.h);
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) px[y * b.w + x] = b.px[y * b.w + (b.w - 1 - x)];
      const m = (p) => [-p[0], p[1]];
      out.push(Object.assign({}, d, { facing: d.facing == null ? null : (8 - d.facing) % 8, butt: m(d.butt), tip: m(d.tip), heel: m(d.heel), angle: Math.PI - d.angle,
        blade: { x0: -(b.x0 + b.w), y0: b.y0, w: b.w, h: b.h, px }, mirrored: true }));
    }
    return (lib.sticks[game] = out);
  }
  /** The value of a frame's stick shadow pixels (the most common), or null. */
  function shadowValue(f, part) {
    const L = layers(f).find((x) => x.part === part);
    if (!L) return null;
    const c = new Map();
    for (const v of L.px) if (v !== f.empty) c.set(v, (c.get(v) || 0) + 1);
    return c.size ? [...c].sort((a, b) => b[1] - a[1])[0][0] : null;
  }
  /**
   * A stick from butt to blade point, drawn the way the game draws one: the shaft a clean pixel line in the game's
   * own stick colour, the blade copied from the retail stick nearest in angle (same facing first; turned the few
   * degrees between them by RotSprite), and a dithered shadow on the ice. Returns { layers, tip (the blade point as
   * drawn), from (the retail stick) } or null.
   */
  function drawStick(lib, S, B, T, facing, iceY) {
    const len = dist(B, T);
    if (len < 4) return null;
    const want = ang(sub(T, B)), onIce = T[1] > iceY - 5;
    let best = null, bc = Infinity;
    for (const d of sticksOf(lib, S.game)) {
      const c = Math.abs(angDiff(want, d.angle)) * 10 + Math.abs(len - d.len) * 0.15 + (d.facing === facing ? 0 : 1.5) + (d.mirrored ? 0.8 : 0) + ((d.tip[1] > -5) === onIce ? 0 : 1.5);
      if (c < bc) { bc = c; best = d; }
    }
    if (!best) return null;
    const E = S.empty;
    const line = PA.cleanLine(B, T[0] - B[0], T[1] - B[1], Math.max(1, len - BLADE));
    const u = [line.dir.ux, line.dir.uy];
    const pts = line.pts.slice();
    if (best.width === 2) for (const [x, y] of line.pts) pts.push(line.dir.xMajor ? [x, y + 1] : [x + 1, y]);
    const heel = line.end;
    const blade = PA.rotate(best.blade, E, angDiff(ang(u), best.angle), best.heel, heel);
    // The shaft runs on until it meets the blade (a pixel apart at most), never leaving a gap at the heel.
    const bladeAt = new Set();
    for (let i = 0; i < blade.w * blade.h; i++) if (blade.px[i] !== E) bladeAt.add((blade.x0 + (i % blade.w)) + ',' + (blade.y0 + ((i / blade.w) | 0)));
    const touches = (p) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (bladeAt.has((p[0] + dx) + ',' + (p[1] + dy))) return true; return false; };
    if (bladeAt.size && !touches(line.pts[line.pts.length - 1])) {
      const longer = PA.cleanLine(B, T[0] - B[0], T[1] - B[1], len + 6).pts;
      for (let i = line.pts.length; i < longer.length; i++) { pts.push(longer[i]); if (best.width === 2) pts.push(line.dir.xMajor ? [longer[i][0], longer[i][1] + 1] : [longer[i][0] + 1, longer[i][1]]); if (touches(longer[i])) break; }
    }
    const tip = add(heel, mul(u, BLADE));
    const shaft = pixelsLayer(pts, best.shaft, E);
    const out = [Object.assign(shaft, { part: 'stick' }), Object.assign(blade, { part: 'stick' })];
    // The shadow: each point of the stick drops to the ice below it, a little to the left as the game's light falls.
    const sv = shadowValue(S, 'stickShadow') ?? shadowValue(lib.byId.get(best.id), 'stickShadow');
    if (sv != null) {
      const g = (p) => { const h = Math.max(0, iceY - p[1]); return [p[0] - 0.3 * h, iceY + 0.5 + Math.min(3, h * 0.08)]; };
      const a = g(B), b = onIce ? [tip[0], tip[1] + 0.5] : g(tip);
      const sl = PA.cleanLine(a, b[0] - a[0], b[1] - a[1], dist(a, b));
      out.push(Object.assign(pixelsLayer(sl.pts.filter((p, i) => i % 2 === 0), sv, E), { part: 'stickShadow' }));
    }
    return { layers: out, tip, butt: B, from: best.id };
  }
  function pixelsLayer(pts, v, empty) {
    if (!pts.length) return { x0: 0, y0: 0, w: 0, h: 0, px: new Uint8Array(0) };
    const x0 = Math.min(...pts.map((p) => p[0])), y0 = Math.min(...pts.map((p) => p[1]));
    const w = Math.max(...pts.map((p) => p[0])) - x0 + 1, h = Math.max(...pts.map((p) => p[1])) - y0 + 1;
    const px = new Uint8Array(w * h).fill(empty);
    for (const [x, y] of pts) px[(y - y0) * w + (x - x0)] = v;
    return { x0, y0, w, h, px };
  }

  // ---- drawing a pose ------------------------------------------------------------------------------------------
  /**
   * Draw a pose on a retail frame (the scaffold), joint by joint, the way the game's artists built their frames:
   *  - the torso leans about the hips and the head turns on the neck (RotSprite, a few degrees);
   *  - each arm and leg is the retail limb (of this game, this facing first, the scaffold's own preferred) whose
   *    shape best fits the target once turned, hung from the shoulder or hip and turned bone by bone onto the target
   *    elbow and hand, knee and skate; hands turn with the forearm, skates stay flat on the ice;
   *  - the stick is redrawn as the game draws one (drawStick) wherever it moved;
   *  - where an arm or leg moved off the chest, the torso is filled in from its own pixels; specks and pinholes the
   *    re-assembly leaves are cleaned (only where something moved).
   * Returns { w, h, x0, y0, px, empty, kp (where the joints are as drawn), target, swaps: { limb: { id, limb, cost,
   * turn } }, layers: [...] in draw order }.
   */
  function render(lib, scaffoldId, target, opts = {}) {
    const S = lib.byId.get(scaffoldId);
    const E = S.empty;
    const tol = opts.tolerance ?? 1.2;
    const game = opts.game || S.game, facing = opts.facing ?? S.facing;
    const kp = Object.assign({}, S.kp, target);
    const actual = Object.assign({}, kp);
    const own = layers(S);
    const ownOf = (p) => own.filter((L) => L.part === p);
    const pieces = [];                                               // { L, part, from, moved, bone }
    const swaps = {};
    const put = (L, part, from, moved, bone) => { if (L && L.w) pieces.push({ L, part, from, moved, bone }); };

    // The body: lean about the hips (moved with them), the head turned on the neck.
    const hm0 = S.kp.hipMid || [0, -10], hm1 = kp.hipMid || hm0;
    const tMove = round2(sub(hm1, hm0));
    let tRot = 0;
    if (S.kp.neck && kp.neck && kp.hipMid) {
      tRot = clamp(angDiff(ang(sub(kp.neck, hm1)), ang(sub(S.kp.neck, hm0))), -MAX_TURN.torso, MAX_TURN.torso);
      if (Math.abs(tRot) < 0.06) tRot = 0;
    }
    const T = (p) => p && add(add(rot(sub(p, hm0), tRot), hm0), tMove);
    actual.hipMid = add(hm0, tMove);
    if (S.kp.neck) actual.neck = T(S.kp.neck);
    for (const s of [0, 1]) { if (S.kp['shoulder' + s]) actual['shoulder' + s] = T(S.kp['shoulder' + s]); if (S.kp['hip' + s]) actual['hip' + s] = add(S.kp['hip' + s], tMove); }

    // Arms and legs.
    const vacated = new Uint8Array(S.w * S.h);
    // Legs: the games often draw both legs as one shape, so the lower body is taken whole, from the retail frame
    // whose stance best fits, set down so its skates stand where the pose's skates are (they stay on the ice).
    {
      const legParts = ['leg0', 'leg1', 'skate0', 'skate1'];
      const wantLegs = [0, 1].map((k) => ['knee' + k, 'skate' + k].map((j) => (kp[j] && kp.hipMid ? sub(kp[j], kp.hipMid) : null)));
      const haveLegs = [0, 1].map((k) => ['knee' + k, 'skate' + k].map((j) => (S.kp[j] ? sub(S.kp[j], hm0) : null)));
      const moved = (a, b) => { const c = vecCost(a, b); return c !== Infinity && c > tol; };
      const changed = [0, 1].some((k) => moved(wantLegs[k], haveLegs[k]));
      if (!changed) {
        for (const p of legParts) for (const L of ownOf(p)) put(PA.rotate(L, E, 0, [0, 0], tMove), p, S.id, !!(tMove[0] || tMove[1]));
        for (const j of ['knee0', 'knee1', 'skate0', 'skate1']) if (S.kp[j]) actual[j] = add(S.kp[j], tMove);
        for (const L of ownOf('shadow')) put(PA.rotate(L, E, 0, [0, 0], [tMove[0], 0]), 'shadow', S.id, !!tMove[0]);
      } else {
        const hit = bestLegs(lib, S, kp, game, facing, opts);
        const D = lib.byId.get(hit.id);
        for (const p of legParts) for (const L of layers(D).filter((x) => x.part === p)) put(PA.rotate(L, E, 0, [0, 0], hit.offset), hit.swap ? p.replace(/\d$/, (d) => String(1 - d)) : p, hit.id, true);
        for (const L of layers(D).filter((x) => x.part === 'shadow')) put(PA.rotate(L, E, 0, [0, 0], hit.offset), 'shadow', hit.id, true);
        for (const k of [0, 1]) for (const j of ['knee', 'skate']) {
          const q = D.kp[j + (hit.swap ? 1 - k : k)];
          actual[j + k] = q ? add(q, hit.offset) : null;
        }
        swaps.legs = { id: hit.id, limb: 'legs', cost: hit.cost };
      }
    }
    for (const limb of ['arm0', 'arm1']) {
      const Ld = LIMBS[limb], k = limb.slice(-1);
      const r0 = S.kp[Ld.root];
      const partsOf = Ld.parts;
      if (!r0) {
        // No shoulder in this frame: the glove alone, set where the pose puts the hand.
        const ej = Ld.joints[1], d = kp[ej] && S.kp[ej] ? round2(sub(kp[ej], S.kp[ej])) : tMove;
        for (const p of partsOf) for (const L of ownOf(p)) put(PA.rotate(L, E, 0, [0, 0], d), p, S.id, !!(d[0] || d[1]));
        if (S.kp[ej]) actual[ej] = add(S.kp[ej], d);
        continue;
      }
      const rootA = actual[Ld.root];
      const want = Ld.joints.map((j) => (kp[j] ? sub(kp[j], rootA) : null));
      const have = Ld.joints.map((j) => (S.kp[j] ? sub(S.kp[j], r0) : null));
      if (!want.some(Boolean) || vecCost(want, have) <= tol) {
        // Unchanged: the limb's own pixels, carried with its root.
        const d = round2(sub(rootA, r0));
        for (const p of partsOf) for (const L of ownOf(p)) put(PA.rotate(L, E, 0, r0, rootA), p, S.id, !!(d[0] || d[1]));
        Ld.joints.forEach((j) => { if (S.kp[j]) actual[j] = add(S.kp[j], d); });
        continue;
      }
      const hit = bestLimb(lib, S, limb, want, game, facing, opts);
      const D = lib.byId.get(hit.id), dl = LIMBS[hit.limb];
      const dr = D.kp[dl.root], dm = D.kp[dl.joints[0]], de = D.kp[dl.joints[1]];
      const P = limbPieces(D, hit.limb);
      const rootQ = add(dr, round2(sub(rootA, dr)));
      const endPart = (Ld.kind === 'arm' ? 'hand' : 'skate') + k;
      let midA = null, endA = null, turn;
      if (P.split && want[0] && want[1]) {
        const t1 = clamp(angDiff(ang(want[0]), ang(sub(dm, dr))), -MAX_TURN.limb, MAX_TURN.limb);
        put(PA.rotate(P.upper, E, t1, dr, rootA), Ld.kind + k, hit.id, true, 'upper');
        midA = add(rootQ, rot(sub(dm, dr), t1));
        const t2 = clamp(angDiff(ang(sub(add(rootA, want[1]), midA)), ang(sub(de, dm))), -MAX_TURN.limb, MAX_TURN.limb);
        const midQ = add(dm, round2(sub(midA, dm)));
        put(PA.rotate(P.lower, E, t2, dm, midA), Ld.kind + k, hit.id, true, 'lower');
        endA = add(midQ, rot(sub(de, dm), t2));
        midA = midQ;

        turn = [t1, t2];
      } else {
        const wEnd = want[1] || want[0], dEnd = de ? sub(de, dr) : dm ? sub(dm, dr) : null;
        const t = wEnd && dEnd && hyp(wEnd) >= 2 && hyp(dEnd) >= 2 ? clamp(angDiff(ang(wEnd), ang(dEnd)), -MAX_TURN.limb, MAX_TURN.limb) : 0;
        put(PA.rotate(P.upper, E, t, dr, rootA), Ld.kind + k, hit.id, true, 'whole');
        if (dm) midA = add(rootQ, rot(sub(dm, dr), t));
        if (de) endA = add(rootQ, rot(sub(de, dr), t));

        turn = [t];
      }
      // Gloves and skates are set at the end of the limb unturned: a few pixels turned break up.
      if (P.end && de && endA) put(PA.rotate(P.end, E, 0, de, endA), endPart, hit.id, true);
      actual[Ld.joints[0]] = midA; actual[Ld.joints[1]] = endA;
      if (hit.id !== S.id || hit.limb !== limb || turn.some((t) => Math.abs(t) > 0.01)) swaps[limb] = { id: hit.id, limb: hit.limb, cost: hit.cost, turn: turn.map((t) => Math.round(t * 180 / Math.PI)) };
      // What it leaves behind on the chest is filled from the torso.
      if (depthOf(limb, S.kp) > depthOf('torso', S.kp))
        for (let i = 0; i < S.w * S.h; i++) if ((S.part[i] === PART_NO[Ld.kind + k] || S.part[i] === PART_NO[endPart]) && insideTorso(S, i)) vacated[i] = 1;
    }

    // Torso (with what the limbs left filled in), anything unlabelled with it, then the head.
    {
      const px = new Uint8Array(S.w * S.h).fill(E);
      for (let i = 0; i < S.w * S.h; i++) if (S.part[i] === PART_NO.torso) px[i] = S.px[i];
      let holes = 0;
      for (let i = 0; i < S.w * S.h; i++) if (vacated[i]) holes++;
      if (holes) PA.inpaint(S.w, S.h, px, vacated, E);
      const torso = PA.crop({ x0: S.x0, y0: S.y0, w: S.w, h: S.h, px }, E);
      put(PA.rotate(torso, E, tRot, hm0, add(hm0, tMove)), 'torso', S.id, !!(tRot || tMove[0] || tMove[1] || holes));
      for (const L0 of ownOf('other')) {
        let L = L0;
        // A pose without a stick drops what is left of the scaffold's stick (pixels along it the labelling missed).
        if (opts.noStick && S.kp.stickButt && S.kp.stickBlade) {
          const px = L.px.slice();
          for (let i = 0; i < L.w * L.h; i++) if (px[i] !== E && segDist([L.x0 + (i % L.w) + 0.5, L.y0 + ((i / L.w) | 0) + 0.5], S.kp.stickButt, S.kp.stickBlade) <= 3) px[i] = E;
          L = PA.crop(Object.assign({}, L, { px }), E);
        }
        put(PA.rotate(L, E, tRot, hm0, add(hm0, tMove)), 'other', S.id, !!(tRot || tMove[0] || tMove[1]) || L !== L0);
      }
    }
    for (const L of ownOf('head')) {
      if (!S.kp.neck || !S.kp.head) { put(PA.rotate(L, E, tRot, hm0, add(hm0, tMove)), 'head', S.id, !!(tRot || tMove[0] || tMove[1])); continue; }
      let hRot = kp.head && kp.neck ? clamp(angDiff(ang(sub(kp.head, kp.neck)), ang(sub(S.kp.head, S.kp.neck))), -MAX_TURN.head, MAX_TURN.head) : tRot;
      if (Math.abs(hRot) < 0.06) hRot = 0;
      const neckA = actual.neck;
      put(PA.rotate(L, E, hRot, S.kp.neck, neckA), 'head', S.id, !!(hRot || neckA[0] !== S.kp.neck[0] || neckA[1] !== S.kp.neck[1]));
      actual.head = add(add(S.kp.neck, round2(sub(neckA, S.kp.neck))), rot(sub(S.kp.head, S.kp.neck), hRot));
    }

    // The shadow stays on the ice under the player; the stick.
    const iceY = Math.max(0, ...[S.kp.skate0, S.kp.skate1].filter(Boolean).map((p) => p[1]));
    if (!opts.noStick && kp.stickButt && kp.stickBlade) {
      const same = S.kp.stickButt && S.kp.stickBlade && dist(sub(kp.stickBlade, kp.stickButt), sub(S.kp.stickBlade, S.kp.stickButt)) <= tol;
      if (same && ownOf('stick').length) {
        const d = round2(sub(kp.stickButt, S.kp.stickButt));
        for (const L of ownOf('stick')) put(PA.rotate(L, E, 0, [0, 0], d), 'stick', S.id, !!(d[0] || d[1]));
        for (const L of ownOf('stickShadow')) put(PA.rotate(L, E, 0, [0, 0], [d[0], 0]), 'stickShadow', S.id, !!d[0]);
        actual.stickButt = add(S.kp.stickButt, d); actual.stickBlade = add(S.kp.stickBlade, d);
      } else {
        const st = drawStick(lib, S, kp.stickButt, kp.stickBlade, facing, iceY);
        if (st) {
          for (const L of st.layers) put(L, L.part, st.from, true);
          actual.stickBlade = st.tip;
          swaps.stick = { id: st.from, limb: 'stick', cost: 0 };
        }
      }
    }
    if (opts.noStick) { actual.stickButt = null; actual.stickBlade = null; }

    // Compose far to near; clean up where anything moved.
    for (const p of pieces) p.z = depthOf(p.part, actual);
    pieces.sort((a, b) => a.z - b.z);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { L } of pieces) { minX = Math.min(minX, L.x0); minY = Math.min(minY, L.y0); maxX = Math.max(maxX, L.x0 + L.w); maxY = Math.max(maxY, L.y0 + L.h); }
    if (!pieces.length) { minX = 0; minY = 0; maxX = 1; maxY = 1; }
    const w = maxX - minX, h = maxY - minY, px = new Uint8Array(Math.max(1, w * h)).fill(E), dirty = new Uint8Array(Math.max(1, w * h));
    const shade = new Uint8Array(Math.max(1, w * h));
    for (const { L, moved, part } of pieces) {
      const sh = part === 'shadow' || part === 'stickShadow';
      for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
        const v = L.px[y * L.w + x];
        if (v === E) continue;
        const i = (L.y0 + y - minY) * w + (L.x0 + x - minX);
        px[i] = v; shade[i] = sh ? 1 : 0;
        if (moved) dirty[i] = 1;
      }
    }
    // Dirty spreads a pixel, so seams beside moved pixels are seen too.
    const grow = dirty.slice();
    for (let i = 0; i < w * h; i++) if (dirty[i]) { const x = i % w, y = (i / w) | 0; for (const [a, b] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) if (a >= 0 && b >= 0 && a < w && b < h) grow[b * w + a] = 1; }
    PA.tidy(w, h, px, E, grow, (i) => shade[i] === 1);
    // Layers as drawn (the clean-up applied to each), for the layer panel and export.
    const out = pieces.map((p) => {
      const L = p.L, q = new Uint8Array(L.w * L.h).fill(E);
      for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
        const v = L.px[y * L.w + x];
        if (v === E) continue;
        const X = L.x0 + x - minX, Y = L.y0 + y - minY;
        if (px[Y * w + X] !== E) q[y * L.w + x] = v;
      }
      return { part: p.part, bone: p.bone, from: p.from, x0: L.x0, y0: L.y0, w: L.w, h: L.h, px: q, z: p.z };
    });
    // Pinholes the clean-up filled belong to the layer over them.
    for (let i = 0; i < w * h; i++) {
      if (px[i] === E) continue;
      const X = (i % w) + minX, Y = ((i / w) | 0) + minY;
      let covered = false;
      for (const L of out) { if (X < L.x0 || Y < L.y0 || X >= L.x0 + L.w || Y >= L.y0 + L.h) continue; if (L.px[(Y - L.y0) * L.w + (X - L.x0)] !== E) { covered = true; break; } }
      if (covered) continue;
      for (let k = out.length - 1; k >= 0; k--) {
        const L = out[k];
        if (X >= L.x0 && Y >= L.y0 && X < L.x0 + L.w && Y < L.y0 + L.h && ['torso', 'arm0', 'arm1', 'leg0', 'leg1', 'head'].includes(L.part)) { L.px[(Y - L.y0) * L.w + (X - L.x0)] = px[i]; covered = true; break; }
      }
      if (!covered) px[i] = E;
    }
    return { w, h, x0: minX, y0: minY, px, empty: E, kp: actual, target: kp, swaps, layers: out };
  }

  /**
   * The retail limb that best fits target vectors once turned onto them: the scaffold's own limb first, then every
   * limb of this game and facing (other facings cost more). Cost: how far its joints land from the target after the
   * turn, plus the turn itself (a big turn shows), so a near drawing beats a far one turned a long way.
   */
  function bestLimb(lib, S, limb, want, game, facing, opts) {
    const kind = LIMBS[limb].kind;
    const wEnd = want[1] || want[0];
    let best = null;
    const consider = (f, l, bonus) => {
      const v = limbVectors(f.kp, l);
      if (!v) return;
      const dEnd = v[1] || v[0];
      const t = wEnd && dEnd && hyp(wEnd) >= 2 && hyp(dEnd) >= 2 ? clamp(angDiff(ang(wEnd), ang(dEnd)), -MAX_TURN.limb, MAX_TURN.limb) : 0;
      const turned = v.map((p) => (p ? rot(p, t) : null));
      const c = vecCost(want, turned) + 0.35 * Math.abs(t) * (wEnd ? hyp(wEnd) : 8) + (f.facing === facing ? 0 : 2) + bonus;
      if (!best || c < best.cost) best = { id: f.id, limb: l, cost: c };
    };
    if (LIMBS[limb].parts.every((p) => S.part.includes(PART_NO[p]))) consider(S, limb, -1);
    for (const f of lib.frames) {
      if (f.game !== game || f.prop || PROP_GROUPS.includes(f.group) || f === S) continue;
      if (f.facing !== facing && !opts.anyFacing) continue;
      if (opts.exclude && opts.exclude(f)) continue;
      for (const l of Object.keys(LIMBS)) {
        if (LIMBS[l].kind !== kind) continue;
        if (!LIMBS[l].parts.every((p) => f.part.includes(PART_NO[p]))) continue;
        consider(f, l, 0);
      }
    }
    return best;
  }

  /**
   * The retail lower body that best fits the pose's knees and skates (relative to the hips; either leg of the frame
   * may play either leg), set down on the pose's skates. Cost: joints off target, the hips' gap from the pose's
   * hips (the torso sits there), another facing. Returns { id, swap, offset, cost }.
   */
  function bestLegs(lib, S, kp, game, facing, opts) {
    const hip = kp.hipMid || S.kp.hipMid || [0, -10];
    const feet = [0, 1].map((k) => kp['skate' + k]);
    let best = null;
    const consider = (f, bonus) => {
      if (!f.kp.hipMid) return;
      for (const swap of [false, true]) {
        const o = (k) => (swap ? 1 - k : k);
        // Set down on the skates both have; on the hips when none.
        const pairs = [0, 1].map((k) => (feet[k] && f.kp['skate' + o(k)] ? sub(feet[k], f.kp['skate' + o(k)]) : null)).filter(Boolean);
        const off = round2(pairs.length ? [pairs.reduce((a, p) => a + p[0], 0) / pairs.length, pairs.reduce((a, p) => a + p[1], 0) / pairs.length] : sub(hip, f.kp.hipMid));
        let c = 0;
        for (const k of [0, 1]) {
          const ws = kp['skate' + k], ds = f.kp['skate' + o(k)], wk = kp['knee' + k], dk = f.kp['knee' + o(k)];
          if (ws && ds) c += dist(ws, add(ds, off)); else if (ws || ds) c += 4;
          if (wk && dk) c += 0.3 * dist(wk, add(dk, off));
        }
        // The torso may come down over the top of the legs (the way the games' artists crouch a player a pixel or
        // two), but must not leave a gap above them.
        const at = add(f.kp.hipMid, off), dy = hip[1] - at[1];
        c += 1.5 * Math.abs(hip[0] - at[0]) + (dy > 0 ? 0.6 * dy : 2 * -dy) + (f.facing === facing ? 0 : 3) + (swap ? 0.5 : 0) + bonus;
        if (!best || c < best.cost) best = { id: f.id, swap, offset: off, cost: c };
      }
    };
    consider(S, -2);
    for (const f of lib.frames) {
      if (f.game !== game || f.prop || PROP_GROUPS.includes(f.group) || f === S) continue;
      if (f.facing !== facing && !opts.anyFacing) continue;
      if (opts.exclude && opts.exclude(f)) continue;
      if (!f.part.includes(PART_NO.leg0) && !f.part.includes(PART_NO.leg1)) continue;
      consider(f, 0);
    }
    return best;
  }

  // ---- posing: what a drag does --------------------------------------------------------------------------------
  /**
   * What a pose is made of, measured at the start of a drag: bone lengths, how far this game's players reach, and how
   * the stick is held (the top hand at the butt; the bottom hand's grip along the shaft; whether the blade is on the ice).
   */
  function rigOf(lib, kp, game, prev) {
    const st = statsOf(lib, game);
    const len = (a, b) => (kp[a] && kp[b] ? dist(kp[a], kp[b]) : null);
    const rig = { game, stats: st, rest: JSON.parse(JSON.stringify(kp)), bones: {}, grip: null,
      iceY: Math.max(0, ...[kp.skate0, kp.skate1].filter(Boolean).map((p) => p[1])), headLen: len('neck', 'head') };
    for (const k of [0, 1]) {
      rig.bones['arm' + k] = [len('shoulder' + k, 'elbow' + k), len('elbow' + k, 'hand' + k)];
      rig.bones['leg' + k] = [len('hip' + k, 'knee' + k), len('knee' + k, 'skate' + k)];
    }
    if (kp.stickButt && kp.stickBlade) {
      const B = kp.stickButt, T = kp.stickBlade, L = dist(B, T), u = unit(sub(T, B));
      const along = (h) => ((h[0] - B[0]) * u[0] + (h[1] - B[1]) * u[1]) / L, off = (h) => Math.abs(u[0] * (h[1] - B[1]) - u[1] * (h[0] - B[0]));
      let top = null, bd = 5;
      for (const k of [0, 1]) { const h = kp['hand' + k]; if (h && dist(h, B) < bd) { bd = dist(h, B); top = k; } }
      // The hands keep their roles from one drag to the next while the top hand is still at the butt.
      if (prev && prev.top != null && kp['hand' + prev.top] && dist(kp['hand' + prev.top], B) < 6) top = prev.top;
      if (top == null) for (const k of [0, 1]) { const h = kp['hand' + k]; if (h && off(h) < 3 && along(h) > -0.1 && along(h) < 0.8) { top = k; break; } }
      let bottom = null;
      for (const k of [0, 1]) {
        const h = kp['hand' + k];
        if (k === top || !h) continue;
        if (off(h) < 4.5 && along(h) > 0.05 && along(h) < 0.85) bottom = { k, t: along(h) };
      }
      rig.grip = { top, buttOffset: top != null ? sub(B, kp['hand' + top]) : null, bottom, bladeOnIce: T[1] > rig.iceY - 5, blade: T.slice() };
    }
    return rig;
  }
  function bendOf(root, mid, end) {
    if (!root || !mid || !end) return 1;
    const c = (end[0] - root[0]) * (mid[1] - root[1]) - (end[1] - root[1]) * (mid[0] - root[0]);
    return c < 0 ? -1 : 1;
  }
  /** Two-bone reach: the middle joint and the end for a root, a target, bone lengths, a bend side. */
  function ik2(root, target, l1, l2, bend, maxR) {
    let v = sub(target, root), d = hyp(v);
    if (d < 1e-6) { v = [0, 1]; d = 1e-6; }
    const u = [v[0] / d, v[1] / d];
    let a1 = l1, a2 = l2;
    d = clamp(d, Math.max(0.5, Math.abs(a1 - a2) + 0.01), Math.max(a1 + a2, maxR));
    if (d > a1 + a2) { const k = d / (a1 + a2); a1 *= k; a2 *= k; }
    const a = (a1 * a1 - a2 * a2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a1 * a1 - a * a));
    return { mid: [root[0] + u[0] * a - u[1] * h * bend, root[1] + u[1] * a + u[0] * h * bend], end: [root[0] + u[0] * d, root[1] + u[1] * d] };
  }
  function reachTo(kp, rig, limb, target) {
    const Ld = LIMBS[limb], r = kp[Ld.root], [mj, ej] = Ld.joints;
    if (!r) { kp[ej] = target; return; }
    const [l1, l2] = rig.bones[limb] || [];
    const max = Ld.kind === 'arm' ? rig.stats.armReach : rig.stats.legReach;
    if (!l1 || !l2 || !kp[mj]) {
      const v = sub(target, r), d = hyp(v);
      kp[ej] = d > max ? add(r, mul(v, max / d)) : target;
      return;
    }
    const maxR = Math.max(l1 + l2, Math.min(max, (l1 + l2) * 1.25));
    const s = ik2(r, target, l1, l2, bendOf(r, kp[mj], kp[ej]), maxR);
    kp[mj] = s.mid; kp[ej] = dist(s.end, target) < 1e-6 ? target.slice() : s.end;
  }
  /** The bottom hand back on the shaft at its grip (slid along it when it cannot reach). */
  function seatBottom(kp, rig) {
    const g = rig.grip;
    if (!g || !g.bottom || !kp.stickButt || !kp.stickBlade) return;
    const k = g.bottom.k, sh = kp['shoulder' + k];
    const at = (t) => lerp(kp.stickButt, kp.stickBlade, t);
    if (!sh) { kp['hand' + k] = at(g.bottom.t); return; }
    const [l1, l2] = rig.bones['arm' + k];
    const max = l1 && l2 ? Math.max(l1 + l2, Math.min(rig.stats.armReach, (l1 + l2) * 1.25)) : rig.stats.armReach;
    let t = g.bottom.t;
    if (dist(sh, at(t)) > max) {
      let bc = Infinity;
      for (let s = 0.08; s <= 0.8; s += 0.02) { const c = Math.max(0, dist(sh, at(s)) - max) * 10 + Math.abs(s - g.bottom.t); if (c < bc) { bc = c; t = s; } }
    }
    reachTo(kp, rig, 'arm' + k, at(t));
  }
  /** After the top hand moved: the butt goes with it; a blade on the ice stays put (the shaft slides), one in the air is carried. */
  function stickFromTop(kp, rig) {
    const g = rig.grip, h = kp['hand' + g.top];
    if (!h) return;
    const B = add(h, g.buttOffset);
    let T;
    if (g.bladeOnIce) {
      const v = sub(g.blade, B), L = clamp(hyp(v), rig.stats.stickMin, rig.stats.stickMax);
      T = add(B, mul(unit(v), L));
    } else T = add(B, sub(kp.stickBlade, kp.stickButt));
    kp.stickButt = B; kp.stickBlade = T;
    seatBottom(kp, rig);
  }
  const UPPER = ['neck', 'head', 'shoulder0', 'shoulder1', 'elbow0', 'elbow1', 'hand0', 'hand1'];
  /**
   * Move one joint of a pose and let the rest follow as a body would. Returns the new pose (kp is not changed).
   *  head          turns on the neck (the neck stays; at most about 35 degrees from where it started)
   *  shoulder      leans the upper body about the hips (head, arms and a held stick go with it)
   *  hip           moves the body; the skates stay planted and the knees bend
   *  elbow / knee  bends the arm or leg; a hand on the stick and a planted skate stay put
   *  hand / skate  reaches there (two-bone IK at the arm's or leg's own bone lengths)
   *  a hand on the stick takes the stick with it: the top hand carries the butt (a blade on the ice stays planted);
   *  the bottom hand levers the stick about the butt, sliding along the shaft
   *  stickBlade    swings the stick about the top hand; the bottom hand slides with it
   *  stickButt     moves the top hand (and so the stick)
   */
  function drag(kp0, j, to, rig) {
    const kp = JSON.parse(JSON.stringify(kp0));
    const g = rig.grip;
    const holds = (k) => g && (g.top === k || (g.bottom && g.bottom.k === k));
    const m = /^(shoulder|elbow|hand|hip|knee|skate)([01])$/.exec(j);
    const kind = m ? m[1] : j, k = m ? Number(m[2]) : null;
    switch (kind) {
      case 'head': {
        if (!kp.neck || !rig.headLen) { kp.head = to; break; }
        const rest = ang(sub(rig.rest.head, rig.rest.neck));
        const a = rest + clamp(angDiff(ang(sub(to, kp.neck)), rest), -MAX_TURN.head, MAX_TURN.head);
        kp.head = add(kp.neck, polar(rig.headLen, a));
        break;
      }
      case 'shoulder': {
        const pv = kp.hipMid, sh = kp[j];
        if (!pv || !sh) break;
        const lean = kp.neck && rig.rest.neck ? angDiff(ang(sub(kp.neck, pv)), ang(sub(rig.rest.neck, rig.rest.hipMid))) : 0;
        const t = clamp(angDiff(ang(sub(to, pv)), ang(sub(sh, pv))), -MAX_TURN.torso - lean, MAX_TURN.torso - lean);
        for (const q of UPPER) if (kp[q]) kp[q] = add(pv, rot(sub(kp[q], pv), t));
        if (g && g.top != null) {
          if (g.bladeOnIce) stickFromTop(kp, rig);
          else { kp.stickButt = add(pv, rot(sub(kp.stickButt, pv), t)); kp.stickBlade = add(pv, rot(sub(kp.stickBlade, pv), t)); seatBottom(kp, rig); }
        }
        break;
      }
      case 'hip': case 'hipMid': {
        const from = kp[j] || kp.hipMid;
        if (!from) break;
        let d = sub(to, from);
        // As far as the legs reach with the skates planted.
        const ok = (s) => [0, 1].every((q) => { const hp = kp['hip' + q], sk = kp['skate' + q]; if (!hp || !sk) return true; const [a, b] = rig.bones['leg' + q]; const max = a && b ? Math.max(a + b, Math.min(rig.stats.legReach, (a + b) * 1.15)) : rig.stats.legReach; const e = dist(add(hp, mul(d, s)), sk); return e <= max && (!a || !b || e >= Math.abs(a - b) + 0.05); });
        if (!ok(1)) { let lo = 0, hi = 1; for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; } d = mul(d, lo); }
        for (const q of UPPER.concat(['hip0', 'hip1', 'hipMid'])) if (kp[q]) kp[q] = add(kp[q], d);
        if (g && g.top != null && g.bladeOnIce) stickFromTop(kp, rig);
        else if (kp.stickButt && kp.stickBlade) { kp.stickButt = add(kp.stickButt, d); kp.stickBlade = add(kp.stickBlade, d); }
        for (const q of [0, 1]) if (kp['hip' + q] && kp['skate' + q]) reachTo(kp, rig, 'leg' + q, kp['skate' + q]);
        break;
      }
      case 'elbow': case 'knee': {
        const limb = (kind === 'elbow' ? 'arm' : 'leg') + k, Ld = LIMBS[limb];
        const r = kp[Ld.root], e = kp[Ld.joints[1]], [l1, l2] = rig.bones[limb];
        if (!r || !l1) { kp[j] = to; break; }
        if (kind === 'knee' || holds(k)) {
          // The end stays: the joint goes to whichever side of the bend is nearer.
          if (!e || !l2) break;
          const flip = ik2(r, e, l1, l2, -bendOf(r, kp[j], e), l1 + l2), keep = ik2(r, e, l1, l2, bendOf(r, kp[j], e), l1 + l2);
          kp[j] = dist(flip.mid, to) < dist(keep.mid, to) ? flip.mid : keep.mid;
        } else {
          // The upper arm swings about the shoulder; the forearm and hand come with it.
          const ne = add(r, polar(l1, ang(sub(to, r))));
          if (e) kp[Ld.joints[1]] = add(e, sub(ne, kp[j]));
          kp[j] = ne;
        }
        break;
      }
      case 'hand': {
        if (g && g.top === k) { reachTo(kp, rig, 'arm' + k, to); stickFromTop(kp, rig); break; }
        if (g && g.bottom && g.bottom.k === k && kp.stickButt && g.bottom.t * dist(kp.stickButt, kp.stickBlade) < 5 && g.top != null) {
          // Hands together at the butt: they carry the stick between them (a lever that short would spin it).
          const d = sub(to, kp[j]);
          reachTo(kp, rig, 'arm' + g.top, add(kp['hand' + g.top], d));
          stickFromTop(kp, rig);
          break;
        }
        if (g && g.bottom && g.bottom.k === k && kp.stickButt) {
          const B = kp.stickButt, L = dist(B, kp.stickBlade), v = sub(to, B);
          if (hyp(v) < 1) break;
          const u = unit(v);
          g.bottom.t = clamp(hyp(v) / L, 0.08, 0.8);
          kp.stickBlade = add(B, mul(u, L));
          reachTo(kp, rig, 'arm' + k, add(B, mul(u, g.bottom.t * L)));
          const v2 = sub(kp[j], B);
          if (hyp(v2) > 1) { kp.stickBlade = add(B, mul(unit(v2), L)); g.bottom.t = clamp(hyp(v2) / L, 0.08, 0.8); }
          break;
        }
        reachTo(kp, rig, 'arm' + k, to);
        break;
      }
      case 'skate': reachTo(kp, rig, 'leg' + k, to); break;
      case 'stickBlade': {
        const B = kp.stickButt;
        if (!B) { kp.stickBlade = to; break; }
        const v = sub(to, B), L = clamp(hyp(v), rig.stats.stickMin, rig.stats.stickMax);
        kp.stickBlade = add(B, mul(unit(v), L));
        if (g) { g.bladeOnIce = kp.stickBlade[1] > rig.iceY - 5; g.blade = kp.stickBlade.slice(); }
        seatBottom(kp, rig);
        break;
      }
      case 'stickButt': {
        if (g && g.top != null) { reachTo(kp, rig, 'arm' + g.top, sub(to, g.buttOffset)); stickFromTop(kp, rig); break; }
        if (kp.stickButt && kp.stickBlade) { const d = sub(to, kp.stickButt); kp.stickButt = to; kp.stickBlade = add(kp.stickBlade, d); }
        break;
      }
      default: kp[j] = to;
    }
    const hips = [kp.hip0, kp.hip1].filter(Boolean);
    if (hips.length && kind !== 'hip') kp.hipMid = kp.hipMid || hips[0];
    return kp;
  }
  /**
   * Put the stick back in the hands of a pose (the eight facings predict each joint on its own): the butt at the top
   * hand, the shaft through the bottom hand, at the predicted length; the bottom hand onto the shaft.
   */
  function gripStick(kp, grip) {
    if (!grip || grip.top == null || !kp.stickButt || !kp.stickBlade) return kp;
    const top = kp['hand' + grip.top];
    if (!top) return kp;
    const L = dist(kp.stickButt, kp.stickBlade);
    const out = Object.assign({}, kp);
    out.stickButt = top.slice();
    let u = unit(sub(kp.stickBlade, kp.stickButt));
    const bot = grip.bottom && kp['hand' + grip.bottom.k];
    if (bot && dist(bot, top) > 2) u = unit(sub(bot, top));
    out.stickBlade = add(top, mul(u, L));
    if (bot) { const s = clamp((bot[0] - top[0]) * u[0] + (bot[1] - top[1]) * u[1], 0.08 * L, 0.8 * L); out['hand' + grip.bottom.k] = add(top, mul(u, s)); }
    return out;
  }

  /**
   * How each joint moves between two facings, learned from the animations the games draw in all eight: for every
   * facing pair and joint a small linear map (normalised x, y -> x, y, with a little ridge so few samples stay sane).
   * Trained on every 8-facing step of every game. Recreating facings of steps it never saw, the joints land 6.4 pixels
   * from the real frames' on average, against 6.9 for the nearest step's pose and 8.9 for copying the source pose
   * (tools/sprites/eval-directions.js).
   */
  function turnModel(lib, exclude) {
    const cache = new Map();
    const steps = [];
    for (const [k, ids] of lib.sets) if (!(exclude && exclude(k))) steps.push(ids.map((id) => lib.vec.get(id)));
    return (d, t, j) => {
      const key = d + ',' + t + ',' + j;
      if (cache.has(key)) return cache.get(key);
      const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r = [[0, 0, 0], [0, 0, 0]];
      let n = 0;
      for (const v of steps) {
        const a = v[d][j], b = v[t][j];
        if (!a || !b) continue;
        const x = [a[0], a[1], 1]; n++;
        for (let p = 0; p < 3; p++) { r[0][p] += x[p] * b[0]; r[1][p] += x[p] * b[1]; for (let q = 0; q < 3; q++) M[p][q] += x[p] * x[q]; }
      }
      let out = null;
      if (n >= 8) {
        M[0][0] += 0.05; M[1][1] += 0.05;
        out = [0, 1].map((c) => {
          const A = M.map((row, i) => row.concat([r[c][i]]));
          for (let i = 0; i < 3; i++) {
            let m = i; for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[m][i])) m = k;
            [A[i], A[m]] = [A[m], A[i]];
            for (let k = 0; k < 3; k++) { if (k === i) continue; const f = A[k][i] / A[i][i]; for (let q = i; q < 4; q++) A[k][q] -= f * A[i][q]; }
          }
          return A.map((row, i) => row[3] / row[i]);
        });
      }
      cache.set(key, out);
      return out;
    };
  }

  /**
   * All eight facings from one pose. The games draw many animations in all eight facings, which is how a pose
   * changes as the player turns. For each other facing: the pose the learned turn maps give, averaged with the
   * nearest three steps' poses in that facing (weighted by how near they are in the source facing); then drawn on
   * the nearest step's frame of that facing, its limbs swapped for the nearest library limbs of that facing.
   * src: { game, facing, kp, id? or cel? }. Returns { set, d, facings: [{ facing, base, kp, cel }] }: the source facing
   * is the source itself; a source without a stick gives facings without one. Animations with a prop (the Cup) are
   * never used.
   */
  function directions(lib, src, opts = {}) {
    const sv = normalise(src.kp);
    const near = [];
    for (const [k, ids] of lib.sets) {
      if (!k.startsWith(src.game + '|')) continue;
      if (opts.excludeSet && opts.excludeSet(k)) continue;
      if (PROP_GROUPS.includes(k.split('|')[1])) continue;
      near.push({ k, ids, d: distance(sv, lib.vec.get(ids[src.facing])) });
    }
    if (!near.length) return null;
    near.sort((a, b) => a.d - b.d);
    const top = near.slice(0, 3);
    const model = opts.excludeSet ? turnModel(lib, opts.excludeSet) : (lib.turn || (lib.turn = turnModel(lib)));
    const out = [];
    for (let t = 0; t < 8; t++) {
      const base = lib.byId.get(top[0].ids[t]);
      let kp;
      if (t === src.facing) kp = Object.assign({}, src.kp);
      else {
        const v = {};
        for (const j of JOINTS) {
          let a = [0, 0], w = 0;
          for (const c of top) { const p = lib.vec.get(c.ids[t])[j]; if (p) { const ww = 1 / (c.d + 0.02); a[0] += p[0] * ww; a[1] += p[1] * ww; w += ww; } }
          const avg = w ? [a[0] / w, a[1] / w] : null;
          const m = model(src.facing, t, j), p = sv[j];
          const lin = m && p ? [m[0][0] * p[0] + m[0][1] * p[1] + m[0][2], m[1][0] * p[0] + m[1][1] * p[1] + m[1][2]] : null;
          v[j] = lin && avg ? [(lin[0] + avg[0]) / 2, (lin[1] + avg[1]) / 2] : (lin || avg);
          if (!lib.vec.get(top[0].ids[t])[j] && !p) v[j] = null;
          if ((j === 'stickButt' || j === 'stickBlade') && !sv.stickButt && !sv.stickBlade) v[j] = null;
        }
        kp = denormalise(v, base.kp);
        // The joints are predicted one by one: keep the hands within the arms' reach (bending the elbows) and put
        // the stick back in the hands, held as this facing's frame holds it.
        const br = rigOf(lib, base.kp, src.game);
        for (const k of [0, 1]) if (kp['shoulder' + k] && kp['hand' + k] && br.bones['arm' + k][0]) reachTo(kp, br, 'arm' + k, kp['hand' + k]);
        if (kp.stickButt && kp.stickBlade) {
          let grip = br.grip;
          if (!grip || grip.top == null) {
            const hs = [0, 1].filter((k) => kp['hand' + k]).sort((a, b) => dist(kp['hand' + a], kp.stickButt) - dist(kp['hand' + b], kp.stickButt));
            grip = hs.length ? { top: hs[0], bottom: null } : null;
          }
          kp = gripStick(kp, grip);
        }
      }
      let cel = null;
      if (opts.draw !== false) {
        // The source facing is the source itself, when it is a frame (or a drawn cel) rather than a bare skeleton.
        if (t === src.facing && src.cel) cel = src.cel;
        else if (t === src.facing && src.id && lib.byId.get(src.id)) { const f = lib.byId.get(src.id); cel = { w: f.w, h: f.h, x0: f.x0, y0: f.y0, px: f.px, empty: f.empty, kp: f.kp, swaps: {}, layers: orderedLayers(f) }; }
        else cel = render(lib, base.id, kp, { facing: t, exclude: opts.exclude, tolerance: opts.tolerance, noStick: !src.kp.stickBlade && !src.kp.stickButt });
      }
      out.push({ facing: t, base: t === src.facing && src.id ? src.id : base.id, kp, cel });
    }
    return { set: top[0].k, d: top[0].d, facings: out };
  }

  return { PARTS, JOINTS, LIMBS, PART_NO, PROP_GROUPS, normalise, denormalise, mirrorPose, distance, layers, orderedLayers, depthOf, index, limbVectors, findLimb, render, directions, turnModel,
    rigOf, drag, gripStick, drawStick, limbPieces, statsOf };
});
