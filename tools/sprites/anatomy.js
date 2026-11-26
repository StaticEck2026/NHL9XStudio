/**
 * Body parts and a skeleton for one labelled skater frame (tools/sprites/frames.js).
 *
 * Every pixel gets one part:
 *   head (helmet and face), torso (jersey, yoke, waist, crest), arm0 / arm1, hand0 / hand1 (glove or bare fist),
 *   leg0 / leg1 (pants and sock of one leg), skate0 / skate1, stick (shaft and taped blade), shadow, other.
 * Arms and legs are split by the hand or skate they lead to: distance travelled through the limb's own pixels.
 * Numbering is by screen position (0 the leftmost hand or skate), not anatomical left / right.
 *
 * Keypoints, in player-position coordinates (the frame's 0, 0, where the skates meet the ice):
 *   head, neck, shoulder/elbow/hand per arm, hip/knee/skate per leg, hipMid, stickBlade, stickButt.
 * A keypoint is missing (null) when its part is not visible: a hand behind the body, a stick-less pose.
 *
 * Sprite labels are PC sprite indices: 0 equipment black, 8 / 88 shadow, 128-143 skin (and the stick, 136),
 * 144-191 jersey zones, 192-250 crest, 255 empty. A Genesis frame's hint (its own colour class) separates the stick
 * from skin; a PC frame has no hint, so a thin skin-coloured line is the stick.
 */
'use strict';

const Zs = require('../pcupgrade/zones');

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8 = N4.concat([[1, 1], [1, -1], [-1, 1], [-1, -1]]);
const PARTS = ['head', 'torso', 'arm0', 'arm1', 'hand0', 'hand1', 'leg0', 'leg1', 'skate0', 'skate1', 'stick', 'shadow', 'other'];

function analyse(frame) {
  const { w, h, label, hint } = frame;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 255 : label[y * w + x]);
  const idx = (x, y) => y * w + x;
  // First pass: material of each pixel.
  const mat = new Array(w * h).fill(null);
  for (let i = 0; i < w * h; i++) {
    const v = label[i];
    if (v === 255) continue;
    if (v === 0) mat[i] = 'black';
    else if (v === 8 || v === 88) mat[i] = 'shadow';
    else if (v < 128) mat[i] = 'other';
    else if (v < 144) mat[i] = hint && hint[i] === 'stick' ? 'wood' : 'skin';
    else if (v < 192) { const z = Zs.BY_INDEX.get(v); const p = z ? Zs.part(z.family) : 'torso'; mat[i] = p === 'jersey' || p === 'yoke' || p === 'waist' || p === 'shoulderPatch' ? 'torso' : p === 'goalieMask' ? 'helmet' : p; }
    else mat[i] = 'torso';                                    // crest
    if (hint && hint[i] === 'stick' && v === 0) mat[i] = 'tape';
  }
  const M = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? null : mat[idx(x, y)]);
  let faceBlob = null;

  function blobs(test) {
    const seen = new Uint8Array(w * h), out = [];
    for (let i = 0; i < w * h; i++) {
      if (seen[i] || !test(mat[i])) continue;
      const pts = [], q = [i]; seen[i] = 1;
      while (q.length) {
        const j = q.pop(), x = j % w, y = (j / w) | 0; pts.push([x, y]);
        for (const [dx, dy] of N8) {
          const nx = x + dx, ny = y + dy, k = ny * w + nx;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[k] || !test(mat[k])) continue;
          seen[k] = 1; q.push(k);
        }
      }
      out.push(pts);
    }
    return out;
  }
  const touches = (pts, what, r = 1) => pts.some(([x, y]) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (what.includes(M(x + dx, y + dy))) return true; return false; });
  const centre = (pts) => (pts.length ? [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length] : null);
  const box = (pts) => { const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return { w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1 }; };

  // The eye (PC 140; NHLPA 93 draws it with a 13 between skin pixels) marks the face for certain. Where a Genesis
  // frame has one, its skin blob is the face and the helmet is the jersey-coloured cap just above it; "helmet" the
  // zone model put anywhere else (a raised fist next to a sleeve can look like a head) goes back to the torso.
  if (hint && label.includes(140)) {
    const face = blobs((m) => m === 'skin').find((b) => b.some(([x, y]) => label[idx(x, y)] === 140));
    if (face) {
      const fc = centre(face);
      const nearFace = (x, y, r) => face.some(([fx, fy]) => Math.max(Math.abs(fx - x), Math.abs(fy - y)) <= r);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = idx(x, y);
        if (mat[i] === 'helmet' && !nearFace(x, y, 3)) mat[i] = 'torso';
        else if ((hint[i] === 'main' || hint[i] === 'second') && y <= fc[1] && nearFace(x, y, 3)) mat[i] = 'helmet';
      }
      faceBlob = face;
    }
  }
  // Skin that is not the face: a thin line is the stick (PC frames), a blob at an arm is a bare fist.
  if (!hint) {
    for (const b of blobs((m) => m === 'skin')) {
      const bb = box(b), long = Math.max(bb.w, bb.h);
      const nearHead = touches(b, ['helmet'], 2);
      if (!nearHead && long >= 5 && b.length <= long * 1.6) for (const [x, y] of b) mat[idx(x, y)] = 'wood';
    }
  }
  // Black: skate (at a sock, pants, or the blade-blue shadow), glove (at an arm or a fist), tape (at the stick).
  const blackBlobs = blobs((m) => m === 'black');
  const skates = [], gloves = [];
  for (const b of blackBlobs) {
    // A skate stands on the ice: blade-blue (8) or ice shadow (88) directly under it, or a sock above it. Anything
    // else black that touches an arm, the stick, the torso or the pants is a glove (a glove held at the hip touches
    // the pants, so the pants alone do not make a skate).
    const onIce = b.some(([x, y]) => [[0, 1], [1, 1], [-1, 1], [0, 2]].some(([dx, dy]) => at(x + dx, y + dy) === 8 || at(x + dx, y + dy) === 88));
    const atSock = touches(b, ['socks']);
    const nearArm = touches(b, ['arm']), nearWood = touches(b, ['wood']), nearBody = touches(b, ['torso', 'pants', 'skin']);
    let kind;
    if (nearWood && !atSock && !nearArm && !touches(b, ['torso', 'skin'])) kind = 'tape';   // the taped blade, even on the ice
    else if ((onIce || atSock) && !(nearArm && !atSock && b.length < 10)) kind = 'skate';
    else if (nearArm || nearBody) kind = 'glove';
    else if (nearWood) kind = 'tape';
    else kind = b.length >= 4 ? 'glove' : 'other';
    for (const [x, y] of b) mat[idx(x, y)] = kind === 'other' ? 'other' : kind;
    if (kind === 'skate') skates.push(b);
    if (kind === 'glove') gloves.push(b);
  }
  const isFace = (b) => faceBlob && b.some(([x, y]) => faceBlob.some(([fx, fy]) => fx === x && fy === y));
  const fists = blobs((m) => m === 'skin').filter((b) => !isFace(b) && (faceBlob ? touches(b, ['arm', 'torso'], 1) : !touches(b, ['helmet'], 2) && touches(b, ['arm'], 1)) && b.length <= 16);
  for (const b of fists) for (const [x, y] of b) mat[idx(x, y)] = 'fist';
  const byX = (a, b) => centre(a)[0] - centre(b)[0];
  const hands = gloves.concat(fists).sort((a, b) => b.length - a.length).slice(0, 2).sort(byX);
  const feet = skates.sort((a, b) => b.length - a.length).slice(0, 2).sort(byX);

  // Grow limbs from their ends through their own material.
  function grow(seeds, allowed) {
    const owner = new Int8Array(w * h).fill(-1), dist = new Float32Array(w * h).fill(Infinity);
    const q = [];
    seeds.forEach((pts, k) => { for (const [x, y] of pts) { owner[idx(x, y)] = k; dist[idx(x, y)] = 0; q.push([x, y]); } });
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i], d = dist[idx(x, y)], o = owner[idx(x, y)];
      for (const [dx, dy] of N8) {
        const nx = x + dx, ny = y + dy;
        if (!allowed.includes(M(nx, ny))) continue;
        const k = idx(nx, ny), nd = d + (dx && dy ? 1.4 : 1);
        if (nd < dist[k]) { dist[k] = nd; owner[k] = o; q.push([nx, ny]); }
      }
    }
    return { owner, dist };
  }
  // Frames the zone model labelled (no PC version): the arm / torso split is its weakest call, so trace each arm as
  // the corridor of jersey pixels on a near-shortest path from the hand to the neck.
  if (frame.labelSource === 'model' && hands.length) {
    const headPx = []; for (let i = 0; i < w * h; i++) if (mat[i] === 'helmet' || (mat[i] === 'skin' && (!faceBlob || faceBlob.some(([fx, fy]) => idx(fx, fy) === i)))) headPx.push([i % w, (i / w) | 0]);
    const hc = centre(headPx);
    const body = (m) => m === 'arm' || m === 'torso';
    const neckSeeds = [];
    if (hc) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (body(M(x, y)) && y >= hc[1] && headPx.some(([hx, hy]) => Math.max(Math.abs(hx - x), Math.abs(hy - y)) <= 1)) neckSeeds.push([x, y]);
    const geo = (seeds) => {
      const d = new Float32Array(w * h).fill(Infinity), q = [];
      for (const [x, y] of seeds) for (const [dx, dy] of N8) { const nx = x + dx, ny = y + dy; if (body(M(nx, ny)) && d[idx(nx, ny)] > 1) { d[idx(nx, ny)] = 1; q.push([nx, ny]); } }
      for (const [x, y] of seeds) if (body(M(x, y))) { d[idx(x, y)] = 0; q.push([x, y]); }
      for (let i = 0; i < q.length; i++) { const [x, y] = q[i], dd = d[idx(x, y)]; for (const [dx, dy] of N8) { const nx = x + dx, ny = y + dy; if (!body(M(nx, ny))) continue; const nd = dd + (dx && dy ? 1.4 : 1); if (nd < d[idx(nx, ny)]) { d[idx(nx, ny)] = nd; q.push([nx, ny]); } } }
      return d;
    };
    if (neckSeeds.length) {
      const dN = geo(neckSeeds);
      const corridor = new Int8Array(w * h).fill(-1);
      hands.forEach((hb, k) => {
        const dH = geo(hb);
        let D = Infinity; for (const [x, y] of neckSeeds) D = Math.min(D, dH[idx(x, y)]);
        if (!Number.isFinite(D)) return;
        for (let i = 0; i < w * h; i++) if (body(mat[i]) && dH[i] + dN[i] <= D + 2.5 && dH[i] < D * 0.85 && corridor[i] < 0) corridor[i] = k;
      });
      for (let i = 0; i < w * h; i++) if (body(mat[i])) mat[i] = corridor[i] >= 0 ? 'arm' : 'torso';
    }
  }
  const armGrow = grow(hands, ['arm']);
  const legGrow = grow(feet, ['socks', 'pants']);

  const part = new Array(w * h).fill(null);
  const nearestOf = (list, x, y) => { let best = 0, bd = Infinity; list.forEach((pts, k) => { const c = centre(pts); const d = Math.hypot(c[0] - x, c[1] - y); if (d < bd) { bd = d; best = k; } }); return best; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = idx(x, y), m = mat[i];
    if (!m) continue;
    let p;
    switch (m) {
      case 'helmet': case 'skin': p = 'head'; break;
      case 'torso': p = 'torso'; break;
      case 'arm': p = hands.length ? 'arm' + (armGrow.owner[i] >= 0 ? armGrow.owner[i] : nearestOf(hands, x, y)) : 'torso'; break;
      case 'glove': case 'fist': { const k = hands.findIndex((b) => b.some(([bx, by]) => bx === x && by === y)); p = k >= 0 ? 'hand' + k : 'other'; break; }
      case 'pants': case 'socks': p = feet.length ? 'leg' + (legGrow.owner[i] >= 0 ? legGrow.owner[i] : nearestOf(feet, x, y)) : 'other'; break;
      case 'skate': { const k = feet.findIndex((b) => b.some(([bx, by]) => bx === x && by === y)); p = k >= 0 ? 'skate' + k : 'other'; break; }
      case 'wood': case 'tape': p = 'stick'; break;
      case 'shadow': p = 'shadow'; break;
      default: p = 'other';
    }
    part[i] = p;
  }

  // Keypoints (pixel centres, then moved to player-position coordinates).
  const pts = (pred) => { const out = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (pred(idx(x, y), x, y)) out.push([x, y]); return out; };
  const near = (i, x, y, what, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h && what.includes(part[idx(nx, ny)])) return true; } return false; };
  const kp = {};
  const headPts = pts((i) => part[i] === 'head');
  kp.head = centre(headPts);
  kp.neck = centre(pts((i, x, y) => part[i] === 'torso' && near(i, x, y, ['head'], 2))) || null;
  for (let k = 0; k < 2; k++) {
    const arm = pts((i) => part[i] === 'arm' + k);
    kp['hand' + k] = hands[k] ? centre(hands[k]) : null;
    const root = arm.filter(([x, y]) => near(idx(x, y), x, y, ['torso', 'head'], 1));
    const far = arm.length ? Math.max(...arm.map(([x, y]) => armGrow.dist[idx(x, y)]).filter(Number.isFinite), 0) : 0;
    kp['shoulder' + k] = root.length ? centre(root) : (arm.length ? centre(arm.filter(([x, y]) => armGrow.dist[idx(x, y)] >= far * 0.8)) : null);
    kp['elbow' + k] = arm.length && far > 3 ? centre(arm.filter(([x, y]) => Math.abs(armGrow.dist[idx(x, y)] - far / 2) <= 1.5)) : null;
    const leg = pts((i) => part[i] === 'leg' + k);
    kp['skate' + k] = feet[k] ? centre(feet[k]) : null;
    const hipPts = leg.filter(([x, y]) => near(idx(x, y), x, y, ['torso'], 1));
    const lfar = leg.length ? Math.max(...leg.map(([x, y]) => legGrow.dist[idx(x, y)]).filter(Number.isFinite), 0) : 0;
    kp['hip' + k] = hipPts.length ? centre(hipPts) : (leg.length ? centre(leg.filter(([x, y]) => legGrow.dist[idx(x, y)] >= lfar * 0.8)) : null);
    const kneePts = leg.filter(([x, y]) => mat[idx(x, y)] === 'socks' && [[0, -1], [1, 0], [-1, 0], [0, 1], [1, -1], [-1, -1]].some(([dx, dy]) => M(x + dx, y + dy) === 'pants'));
    kp['knee' + k] = kneePts.length ? centre(kneePts) : (leg.length && lfar > 3 ? centre(leg.filter(([x, y]) => Math.abs(legGrow.dist[idx(x, y)] - lfar / 2) <= 1.5)) : null);
  }
  const hipsSeen = [kp.hip0, kp.hip1].filter(Boolean);
  kp.hipMid = hipsSeen.length ? centre(hipsSeen) : null;
  // The stick's two ends: the blade is the end farthest from the hands (the lowest end when no hand shows), the butt
  // the stick pixel farthest from the blade. Tape, where there is any, marks the blade.
  const stickPts = pts((i) => part[i] === 'stick');
  const tape = pts((i) => mat[i] === 'tape');
  kp.stickBlade = null; kp.stickButt = null;
  if (stickPts.length >= 3) {
    const handC = [kp.hand0, kp.hand1].filter(Boolean);
    let blade;
    if (tape.length) blade = centre(tape);
    else if (handC.length) {
      let score = -1;
      for (const p of stickPts) { const d = Math.min(...handC.map((c) => Math.hypot(p[0] - c[0], p[1] - c[1]))); if (d > score) { score = d; blade = p; } }
    } else blade = stickPts.reduce((a, p) => (p[1] > a[1] ? p : a));
    let butt = blade, far = -1;
    for (const p of stickPts) { const d = Math.hypot(p[0] - blade[0], p[1] - blade[1]); if (d > far) { far = d; butt = p; } }
    kp.stickBlade = blade; kp.stickButt = far >= 3 ? butt : null;
  }
  // Player-position coordinates, rounded to a tenth.
  for (const k of Object.keys(kp)) if (kp[k]) kp[k] = [+(kp[k][0] + frame.x0 + 0.5).toFixed(1), +(kp[k][1] + frame.y0 + 0.5).toFixed(1)];

  const counts = {};
  for (const p of part) if (p) counts[p] = (counts[p] || 0) + 1;
  // A frame with no head is a prop (the dropped gloves and sticks, the glass panel), not a skater.
  const prop = !headPts.length;
  return { part, keypoints: kp, counts, hands: hands.length, skates: feet.length, prop };
}

module.exports = { analyse, PARTS };
