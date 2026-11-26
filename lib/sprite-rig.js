/**
 * Skeleton rig over the skater sprite library (docs/sprite-library): layers, pose maths, limb swaps and the eight
 * facings from one pose. Used by the animation builder (public/animator.js) and the tools (tools/sprites/).
 *
 * A frame: { id, game, group, facing, step, w, h, x0, y0, px, part, kp, empty }
 *   px    the frame's own pixels (Genesis: palette line * 16 + colour, empty 0; PC: sprite index, empty 255)
 *   part  part number per pixel (PARTS), 255 none
 *   kp    skeleton: { head, neck, shoulder0/1, elbow0/1, hand0/1, hipMid, hip0/1, knee0/1, skate0/1, stickButt,
 *         stickBlade } in player-position coordinates (0, 0 where the skates meet the ice), null when hidden
 * Pixels are never redrawn: every operation here copies retail pixels, moves them, or mirrors them as the Genesis
 * sprite flip does.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlSpriteRig = factory();
})(typeof self !== 'undefined' ? self : this, function () {
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
  function index(frames) {
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

  /**
   * Draw a pose: the scaffold frame's parts, with every limb whose target joints moved more than `tolerance`
   * pixels swapped for the nearest library limb, hung from the target root joint. Head moves with the neck.
   * Returns { w, h, x0, y0, px, empty, kp (where the joints really are), target, swaps: { limb: { id, limb, cost } },
   * layers: [...] in draw order }.
   */
  function render(lib, scaffoldId, target, opts = {}) {
    const S = lib.byId.get(scaffoldId);
    const tol = opts.tolerance ?? 2.5;
    const game = opts.game || S.game, facing = opts.facing ?? S.facing;
    const kp = Object.assign({}, S.kp, target);
    const actual = Object.assign({}, kp);
    const pieces = [];                                               // { layer, dx, dy, z }
    const own = orderedLayers(S);
    const swapped = new Set(), swaps = {};
    for (const limb of Object.keys(LIMBS)) {
      if (limb === 'stick' && opts.noStick) continue;
      const want = limbVectors(kp, limb), have = limbVectors(S.kp, limb);
      if (!want) continue;
      const moved = !have || vecCost(want, have) > tol || (opts.force && opts.force.includes(limb));
      if (!moved) continue;
      const hit = findLimb(lib, game, facing, LIMBS[limb].kind, want, { exclude: opts.exclude, anyFacing: opts.anyFacing });
      // A poor match is worse than the base's own limb: keep that (opts.maxCost pixels, default 7).
      if (!hit || (have && hit.cost > (opts.maxCost ?? 7))) continue;
      const src = lib.byId.get(hit.id);
      const from = src.kp[LIMBS[hit.limb].root], to = kp[LIMBS[limb].root];
      for (const L of orderedLayers(src)) {
        if (!LIMBS[hit.limb].parts.includes(L.part)) continue;
        // The swapped-in part takes the place, and so the depth, of the part it replaces.
        const asPart = L.part.replace(/\d$/, LIMBS[limb].parts[0].slice(-1));
        pieces.push({ layer: Object.assign({}, L, { part: /^stick/.test(L.part) ? L.part : asPart, from: hit.id }), dx: Math.round(to[0] - from[0]), dy: Math.round(to[1] - from[1]) });
      }
      for (const p of LIMBS[limb].parts) swapped.add(p);
      swaps[limb] = hit;
      // Where the swapped-in limb's joints really are, so the skeleton matches the pixels.
      LIMBS[limb].joints.forEach((j, i) => { const q = src.kp[LIMBS[hit.limb].joints[i]]; actual[j] = q ? [q[0] + Math.round(to[0] - from[0]), q[1] + Math.round(to[1] - from[1])] : null; });
    }
    if (opts.noStick) { swapped.add('stick'); swapped.add('stickShadow'); }
    const headShift = target.head && S.kp.head ? [Math.round(target.head[0] - S.kp.head[0]), Math.round(target.head[1] - S.kp.head[1])] : [0, 0];
    // A limb that keeps its own pixels still follows its root joint when that moved (a dragged shoulder or hip).
    const rootShift = {};
    for (const limb of Object.keys(LIMBS)) {
      const r = LIMBS[limb].root, a = S.kp[r], b = kp[r];
      const d = a && b ? [Math.round(b[0] - a[0]), Math.round(b[1] - a[1])] : [0, 0];
      for (const p of LIMBS[limb].parts) rootShift[p] = d;
    }
    for (const L of own) {
      if (swapped.has(L.part)) continue;
      const d = L.part === 'head' ? headShift : (rootShift[L.part] || [0, 0]);
      pieces.push({ layer: Object.assign({}, L, { from: S.id }), dx: d[0], dy: d[1] });
    }
    for (const p of pieces) p.z = depthOf(p.layer.part, kp);
    pieces.sort((a, b) => a.z - b.z);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { layer: L, dx, dy } of pieces) { minX = Math.min(minX, L.x0 + dx); minY = Math.min(minY, L.y0 + dy); maxX = Math.max(maxX, L.x0 + dx + L.w); maxY = Math.max(maxY, L.y0 + dy + L.h); }
    const w = maxX - minX, h = maxY - minY, px = new Uint8Array(Math.max(1, w * h)).fill(S.empty);
    for (const { layer: L, dx, dy } of pieces) {
      for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
        const v = L.px[y * L.w + x];
        if (v === S.empty) continue;
        px[(L.y0 + dy + y - minY) * w + (L.x0 + dx + x - minX)] = v;
      }
    }
    return { w, h, x0: minX, y0: minY, px, empty: S.empty, kp: actual, target: kp, swaps, layers: pieces.map((p) => ({ part: p.layer.part, from: p.layer.from, x0: p.layer.x0 + p.dx, y0: p.layer.y0 + p.dy, w: p.layer.w, h: p.layer.h, px: p.layer.px, z: p.z })) };
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

  return { PARTS, JOINTS, LIMBS, PART_NO, PROP_GROUPS, normalise, denormalise, mirrorPose, distance, layers, orderedLayers, depthOf, index, limbVectors, findLimb, render, directions, turnModel };
});
