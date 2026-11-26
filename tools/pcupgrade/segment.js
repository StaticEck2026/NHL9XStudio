/**
 * Give every pixel of a Genesis skater frame its NHL 94/95 PC sprite index: a fixed material, or a jersey zone and
 * shade. Pixels never move; only what they mean is decided.
 *
 * What the Genesis colours mean (palette line 2, and line 3 for the second team in NHLPA 93's fight frames). The
 * order holds for 47-50 of the 50 team palettes in data/pals/genesis:
 *   1 skate steel, 2 black (skates, gloves), 3/4/5 pants dark/medium/light, 6/7 skin light/shade, 8/9 trim
 *   dark/light, 10 second colour, 11/12/13 main colour medium/light/dark, 14 stick, 15 ice shadow.
 *   NHLPA 93 draws the eye with 13 between two skin pixels (lib/rom93.js markEyes).
 *
 * Fixed materials map one to one (measured on the aligned retail skating frames, docs/genesis-to-pc/PC-PALETTE.md):
 * steel -> 8, black -> 0, skin -> 134 / 136, eye -> 140, stick -> 136 with the two-pixel blade -> 0 (tape),
 * shadow -> 88.
 *
 * Team colours need a body part. The parts come from the figure's own geometry, so a fighter or a player lying on
 * the ice is read the same way as a skater:
 *   - skates: black next to steel; the feet are their centre. The head is the skin blob farthest from the feet.
 *     The body axis runs feet -> head; t is the height along it (0 feet, 1 face).
 *   - hands: black blobs that are not skates (gloves) and skin blobs that are not the face (bare fists).
 *   - helmet: main or second colour within 3 pixels of the face and not below its middle along the body axis.
 *   - socks: team colours within a quarter of the body's height of the skates, measured along the leg (so spread
 *     or raised legs read right). Pants: the pants colours above that.
 *   - arms: team colours reached from a hand through team pixels within an arm's length, away from the body axis.
 *     Along an arm, from the hand: forearm, then each trim band in turn (arm stripe 3, 2, 1), then upper arm.
 *   - waist: trim and second colour touching the top of the pants. Yoke: trim and second colour high on the back.
 *   - the rest of the main colour is the jersey.
 * The rules above give each team pixel a part, and the band logic a zone. When tools/pcupgrade/model.json is there
 * (opts.model undefined: load it; null: rules only), two decision trees trained on all 345 retail NHL 94 Genesis /
 * NHL 95 PC frame pairs decide the zone instead, from the same geometry (feature()). On pose types it never saw
 * (trained without the falls and injuries, tested on them) 76% of team pixels land in the PC artist's body part and
 * 57% in the exact zone, against 57% and 38% for the rules. A majority filter then removes single-pixel specks.
 * Shade (opts.shade): 'genesis' (default) keeps the Genesis artist's tone on the PC ramp, 12/9/5 light, 11/10/4
 * medium, 13/8/3 dark; on those unseen poses it matches the PC artist's shade 50% of the time, where always-medium
 * gets 40% and the model's shade tree ('model') 48.5%.
 */
'use strict';

const Zs = require('./zones');

const CLASS = { 1: 'steel', 2: 'black', 3: 'pants', 4: 'pants', 5: 'pants', 6: 'skin', 7: 'skin', 8: 'trim', 9: 'trim', 10: 'second', 11: 'main', 12: 'main', 13: 'main', 14: 'stick', 15: 'shadow' };
const SHADE = { 3: 'dark', 4: 'medium', 5: 'light', 8: 'dark', 9: 'light', 10: 'medium', 11: 'medium', 12: 'light', 13: 'dark' };
const TEAM = new Set(['pants', 'trim', 'second', 'main']);

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8 = N4.concat([[1, 1], [1, -1], [-1, 1], [-1, -1]]);

/**
 * frame: { w, h, px } with px[i] = line * 16 + colour (0 empty). opts.lines: palette lines that are skater colours
 * (default [2, 3]). opts.fixed(rgbIndex) -> sprite index for any other line's pixel (blood, ice spray).
 * Returns { out: Uint8Array of sprite indices (255 empty), parts: per-pixel part names, info }.
 */
function segment(frame, opts = {}) {
  const { w, h, px } = frame;
  const lines = opts.lines || [2, 3];
  const model = opts.model === undefined ? require('./model').load() : opts.model;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : px[y * w + x]);
  const colourAt = (x, y) => { const v = at(x, y); return v && lines.includes(v >> 4) ? v & 15 : 0; };
  const cls = new Array(w * h).fill(null);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = px[y * w + x];
    if (!v) continue;
    cls[y * w + x] = lines.includes(v >> 4) ? CLASS[v & 15] || 'other' : 'other';
  }
  // NHLPA 93 eye: a 13 with skin on both sides.
  const eye = new Set();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (colourAt(x, y) !== 13) continue;
    const s = (c) => c === 6 || c === 7;
    if ((s(colourAt(x - 1, y)) && s(colourAt(x + 1, y))) || (s(colourAt(x, y - 1)) && s(colourAt(x, y + 1)))) { eye.add(y * w + x); cls[y * w + x] = 'skin'; }
  }
  const C = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? null : cls[y * w + x]);

  function blobs(test) {
    const seen = new Uint8Array(w * h), out = [];
    for (let i = 0; i < w * h; i++) {
      if (seen[i] || !test(cls[i], i)) continue;
      const pts = [], q = [i]; seen[i] = 1;
      while (q.length) {
        const j = q.pop(), x = j % w, y = (j / w) | 0; pts.push([x, y]);
        for (const [dx, dy] of N8) {
          const nx = x + dx, ny = y + dy, k = ny * w + nx;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[k] || !test(cls[k], k)) continue;
          seen[k] = 1; q.push(k);
        }
      }
      out.push(pts);
    }
    return out;
  }
  const centre = (pts) => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  const near = (pts, x, y, r) => pts.some(([px_, py]) => Math.max(Math.abs(px_ - x), Math.abs(py - y)) <= r);

  // Skates: black blobs touching steel (or, without steel, the black blob lowest on screen).
  const blacks = blobs((c) => c === 'black');
  const steel = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (C(x, y) === 'steel') steel.push([x, y]);
  let skates = blacks.filter((b) => steel.length && b.some(([x, y]) => near(steel, x, y, 2)));
  const skins = blobs((c) => c === 'skin').filter((b) => b.length >= 1);
  // No steel in sight (skates in the air, seen from above): the face is the biggest skin blob, and the skates are
  // the black blobs farthest from it; gloves are nearer.
  if (!skates.length && blacks.length) {
    const big = skins.slice().sort((a, b) => b.length - a.length)[0];
    if (big) {
      const fc = centre(big);
      const dist = (b) => { const c = centre(b); return Math.hypot(c[0] - fc[0], c[1] - fc[1]); };
      const far = Math.max(...blacks.map(dist));
      skates = blacks.filter((b) => b.length >= 2 && dist(b) >= 0.75 * far);
    } else {
      skates = [blacks.slice().sort((a, b) => Math.max(...b.map((p) => p[1])) - Math.max(...a.map((p) => p[1])))[0]];
    }
  }
  const skatePts = skates.flat().concat(steel);
  let feet = skatePts.length ? centre(skatePts) : [w / 2, h - 1];
  // The face: the biggest skin blob far from the feet (a bare fist is smaller or nearer).
  let face = null, faceScore = -1;
  for (const b of skins) {
    const c = centre(b), d = Math.hypot(c[0] - feet[0], c[1] - feet[1]);
    const score = d * Math.min(b.length, 6);
    if (score > faceScore) { faceScore = score; face = b; }
  }
  const head = face ? centre(face) : [feet[0], 0];
  let ax = head[0] - feet[0], ay = head[1] - feet[1];
  const L = Math.hypot(ax, ay) || 1; ax /= L; ay /= L;
  const tOf = (x, y) => ((x - feet[0]) * ax + (y - feet[1]) * ay) / L;
  const sOf = (x, y) => ((x - feet[0]) * -ay + (y - feet[1]) * ax);   // signed distance from the axis

  // Hands: gloves (black, not skates) and fists (skin, not the face).
  const hands = blacks.filter((b) => !skates.includes(b) && b.length >= 2).concat(skins.filter((b) => b !== face && b.length >= 2));
  const handPts = hands.flat();

  const isTeam = (c) => TEAM.has(c);
  const part = new Array(w * h).fill(null);
  const idx = (x, y) => y * w + x;

  // Pants and the knee line.
  const pantsPts = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (C(x, y) === 'pants') pantsPts.push([x, y]);
  const pantsT = pantsPts.map(([x, y]) => tOf(x, y)).sort((a, b) => a - b);
  const q = (arr, f) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(f * arr.length))] : null);
  const knee = pantsT.length ? q(pantsT, 0.12) : 0.3;
  const hip = pantsT.length ? q(pantsT, 0.9) : 0.5;

  // Geodesic distance from the hands through team pixels.
  const dHand = new Float32Array(w * h).fill(Infinity);
  {
    const queue = [];
    for (const [x, y] of handPts) for (const [dx, dy] of N8) {
      const nx = x + dx, ny = y + dy;
      if (isTeam(C(nx, ny)) && dHand[idx(nx, ny)] > 1) { dHand[idx(nx, ny)] = 1; queue.push([nx, ny]); }
    }
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i], d = dHand[idx(x, y)];
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (!isTeam(C(nx, ny)) || dHand[idx(nx, ny)] <= d + 1) continue;
        dHand[idx(nx, ny)] = d + 1; queue.push([nx, ny]);
      }
    }
  }
  // Distance from the skates through team pixels: the socks are the first stretch of each leg, however the legs lie.
  const dSkate = new Float32Array(w * h).fill(Infinity);
  {
    const queue = [];
    for (const [x, y] of skatePts) for (const [dx, dy] of N8) {
      const nx = x + dx, ny = y + dy;
      if (isTeam(C(nx, ny)) && dSkate[idx(nx, ny)] > 1) { dSkate[idx(nx, ny)] = 1; queue.push([nx, ny]); }
    }
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i], d = dSkate[idx(x, y)];
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (!isTeam(C(nx, ny)) || dSkate[idx(nx, ny)] <= d + 1) continue;
        dSkate[idx(nx, ny)] = d + 1; queue.push([nx, ny]);
      }
    }
  }
  // Tuned on the 16 frames that have a PC version (4 upright skating, 12 lying injury): socks are the first quarter
  // of the height measured from the skates along the leg.
  const SOCK = 0.25;

  // Proportions along the body axis, measured on the retail PC skating frames aligned with the Genesis ones
  // (docs/genesis-to-pc/PC-PALETTE.md): socks below 0.30 of the feet-to-face height, pants to 0.47, waist to 0.6,
  // jersey to about 0.8, then the yoke across the upper back; the helmet sits around the face.
  const KNEE = 0.30, HIP = 0.47, WAIST_TOP = 0.6, YOKE = 0.78;
  // Arms: a bone from the shoulder (on the axis at 0.82) to each hand. A team pixel within ARM_W of a bone, and
  // nearer to it than to the spine (the axis from the hip up), is arm.
  const ARM_W = Math.max(2.5, 0.16 * L);
  const shoulder = [feet[0] + ax * 0.82 * L, feet[1] + ay * 0.82 * L];
  const hipPt = [feet[0] + ax * HIP * L, feet[1] + ay * HIP * L];
  const neck = [feet[0] + ax * 0.95 * L, feet[1] + ay * 0.95 * L];
  function segDist(x, y, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy || 1;
    const k = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / l2));
    return Math.hypot(x - a[0] - k * vx, y - a[1] - k * vy);
  }
  const handCentres = hands.map(centre);
  const armDist = (x, y) => Math.min(Infinity, ...handCentres.map((hc) => segDist(x, y, shoulder, hc)));
  const spineDist = (x, y) => segDist(x, y, hipPt, neck);
  // The elbow bends, so the upper arm hangs down the front of the body: the side of the spine the hands are on.
  const handSide = Math.sign(handCentres.reduce((a, hc) => a + sOf(hc[0], hc[1]), 0)) || 1;
  const FRONT = 0;
  const front = (x, y) => sOf(x, y) * handSide > FRONT * L;

  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = C(x, y);
    if (!isTeam(c)) continue;
    const t = tOf(x, y), i = idx(x, y);
    const a = armDist(x, y), sp = spineDist(x, y);
    if (face && (c === 'main' || c === 'second') && near(face, x, y, 3) && t >= tOf(head[0], head[1])) part[i] = 'helmet';
    else if (dSkate[i] <= SOCK * L || (t < KNEE && dSkate[i] === Infinity)) part[i] = 'socks';
    else if (c === 'pants' && t < WAIST_TOP) part[i] = 'pants';
    else if (t >= HIP - 0.05 && ((a <= ARM_W && a < sp) || (t < 0.9 && front(x, y)))) part[i] = 'arm';
    else if (t < HIP) part[i] = c === 'pants' ? 'pants' : (c === 'main' ? 'pants' : 'waist');
    else if (t < WAIST_TOP) part[i] = 'waist';
    else if (t >= YOKE) part[i] = 'yoke';
    else part[i] = 'jersey';
  }

  // Bands along the arms (from the hand) and the yoke (from the face) and the waist (from the pants).
  function bands(name, key) {
    const pts = [];
    for (let i = 0; i < w * h; i++) if (part[i] === name && (CLASS_OF(i) === 'trim' || CLASS_OF(i) === 'second')) pts.push(i);
    const groups = blobs((c, k) => part[k] === name && (c === 'trim' || c === 'second'));
    return groups.map((g) => ({ g, k: g.reduce((a, [x, y]) => a + key(x, y), 0) / g.length })).sort((a, b) => a.k - b.k);
  }
  function CLASS_OF(i) { return cls[i]; }

  // Per-pixel geometry, for the learned part model (tools/pcupgrade/model.js) and its training.
  const feature = (x, y) => {
    const i = idx(x, y), c = C(x, y), v = px[i] & 15;
    const cap = (d) => (Number.isFinite(d) ? Math.min(d / L, 3) : 3);
    let dFace = Infinity, dPants = Infinity;
    if (face) for (const [fx, fy] of face) dFace = Math.min(dFace, Math.hypot(fx - x, fy - y));
    for (const [qx, qy] of pantsPts) dPants = Math.min(dPants, Math.hypot(qx - x, qy - y));
    return [tOf(x, y), sOf(x, y) * handSide / L, cap(dHand[i]), cap(dSkate[i]), cap(dFace), cap(dPants),
      cap(armDist(x, y)), cap(spineDist(x, y)), c === 'pants' ? 1 : 0, c === 'trim' ? 1 : 0, c === 'second' ? 1 : 0, c === 'main' ? 1 : 0,
      { 3: 0, 8: 0, 13: 0, 4: 1, 10: 1, 11: 1, 5: 2, 9: 2, 12: 2 }[v] ?? 1, hands.length];
  };
  const blade = new Set();
  {
    const runs = [];
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        if (C(x, y) !== 'stick') { x++; continue; }
        const a = x; while (x < w && C(x, y) === 'stick') x++;
        runs.push({ y, a, b: x - 1 });
      }
    }
    for (const r of runs) {
      if (r.b - r.a + 1 < 3) continue;
      const ok = runs.some((o) => Math.abs(o.y - r.y) === 1 && Math.min(o.b, r.b) - Math.max(o.a, r.a) + 1 >= 2);
      if (ok) for (let x = r.a; x <= r.b; x++) blade.add(r.y * w + x);
    }
    // A blade is one end of a stick, about six pixels: keep, for each stick, only the candidates within 6 pixels of
    // the candidate farthest from that stick's middle (a stick lying flat overlaps itself all along).
    for (const stick of blobs((c) => c === 'stick')) {
      const cand = stick.filter(([x, y]) => blade.has(y * w + x));
      if (!cand.length) continue;
      const mid = centre(stick);
      let end = cand[0], far = -1;
      for (const p of cand) { const d = Math.hypot(p[0] - mid[0], p[1] - mid[1]); if (d > far) { far = d; end = p; } }
      for (const [x, y] of cand) if (Math.max(Math.abs(x - end[0]), Math.abs(y - end[1])) > 6) blade.delete(y * w + x);
    }
  }
  const out = new Uint8Array(w * h).fill(Zs.TRANSPARENT);
  const fam = new Array(w * h).fill(null);
  const tones = new Array(w * h).fill(null);
  const set = (x, y, v) => { out[idx(x, y)] = v; };
  const armBands = bands('arm', (x, y) => dHand[idx(x, y)]);
  const armStripes = ['armStripe3', 'armStripe2', 'armStripe1'];
  const bandFamily = new Map();
  armBands.forEach((b, n) => { for (const [x, y] of b.g) bandFamily.set(idx(x, y), armStripes[Math.min(n, 2)]); });
  const firstBand = armBands.length ? Math.min(...armBands[0].g.map(([x, y]) => dHand[idx(x, y)])) : 0.28 * L;
  const yokeBands = bands('yoke', (x, y) => Math.hypot(x - head[0], y - head[1]));
  ['yoke1', 'yoke2', 'yoke3'].forEach((f, n) => { if (yokeBands[n]) for (const [x, y] of yokeBands[n].g) bandFamily.set(idx(x, y), f); });
  for (let n = 3; n < yokeBands.length; n++) for (const [x, y] of yokeBands[n].g) bandFamily.set(idx(x, y), 'yoke3');
  const waistBands = bands('waist', (x, y) => tOf(x, y));
  ['waist1', 'waist2', 'waist3'].forEach((f, n) => { if (waistBands[n]) for (const [x, y] of waistBands[n].g) bandFamily.set(idx(x, y), f); });
  for (let n = 3; n < waistBands.length; n++) for (const [x, y] of waistBands[n].g) bandFamily.set(idx(x, y), 'waist3');

  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = idx(x, y), v = px[i], c = cls[i];
    if (!v) continue;
    const colour = v & 15, shade = SHADE[colour] || 'medium';
    if (eye.has(i)) { set(x, y, Zs.EYE); continue; }
    switch (c) {
      case 'steel': set(x, y, Zs.BLADE_BLUE); continue;
      case 'black': set(x, y, Zs.BLACK); continue;
      case 'shadow': set(x, y, Zs.SHADOW); continue;
      case 'skin': set(x, y, colour === 6 ? Zs.SKIN_LIGHT : Zs.SKIN_SHADE); continue;
      case 'stick': {
        // The blade is the two-row block of stick colour on the ice; the PC tapes it black. A stepped shaft's runs
        // only touch at a corner, so a blade pixel is one in a run of 3+ whose next row up or down has a stick run
        // overlapping it by 2 or more.
        const block = blade.has(i);
        set(x, y, block ? Zs.BLACK : Zs.STICK); continue;
      }
      case 'other': set(x, y, opts.fixed ? opts.fixed(v) : Zs.BLACK); continue;
      default: break;
    }
    const p = part[i];
    let family;
    if (p === 'helmet') family = 'helmet';
    else if (p === 'socks') family = c === 'trim' ? 'socksStripe1' : c === 'second' ? 'socksStripe2' : 'socks';
    else if (p === 'pants') family = c === 'trim' ? 'pantsStripe1' : c === 'second' ? 'pantsStripe2' : 'pants';
    else if (p === 'arm') family = bandFamily.get(i) || (dHand[i] < firstBand ? 'forearm' : 'upperArm');
    else if (p === 'waist') family = bandFamily.get(i) || 'waist1';
    else if (p === 'yoke') family = bandFamily.get(i) || (Math.hypot(x - head[0], y - head[1]) < 0.3 * L ? 'yoke1' : 'yoke2');
    else family = 'jersey';
    let tone = shade;
    if (model) {
      const f = feature(x, y);
      family = model.zone(f);
      const z = Zs.Z[family];
      if (z.light != null && z.medium != null && z.dark != null && opts.shade === 'model') tone = model.shade(f);
    }
    fam[i] = family;
    tones[i] = tone;
    set(x, y, Zs.zoneIndex(family, tone));
  }
  // The PC zones are solid patches; a tree decides pixel by pixel. A team pixel whose zone none of its 8 neighbours
  // of the same Genesis colour class share takes the zone most of them have.
  if (model && opts.smooth !== false) {
    const next = fam.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = idx(x, y), f = fam[i];
      if (!f || !Zs.Z[f]) continue;
      const votes = new Map();
      let same = 0;
      for (const [dx, dy] of N8) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = idx(nx, ny);
        if (cls[k] !== cls[i] || !fam[k]) continue;
        if (fam[k] === f) same++;
        votes.set(fam[k], (votes.get(fam[k]) || 0) + 1);
      }
      if (same || !votes.size) continue;
      next[i] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    for (let i = 0; i < w * h; i++) if (next[i] !== fam[i]) { fam[i] = next[i]; out[i] = Zs.zoneIndex(fam[i], tones[i]); }
  }
  return { out, part, feature, info: { feet, head, L, knee, hip, hands: hands.length, skates: skates.length, face: face ? face.length : 0 } };
}

module.exports = { segment, CLASS, SHADE };
