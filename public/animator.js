/* Animation builder (animator.html): pose a retail skater by its skeleton, get all eight facings, build a sequence.
 * The frames, parts and skeletons come from the sprite library built from the user's own files
 * (node tools/build-sprite-layers.js -> library/bundle-<game>.json, served by server.js at /library/). The rig is
 * lib/sprite-rig.js: limbs are swapped for retail limbs, parts are moved, nothing is redrawn. */
(function () {
  'use strict';
  const R = window.NhlSpriteRig;
  const $ = (id) => document.getElementById(id);
  const FACINGS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const BONES = [['head', 'neck'], ['neck', 'shoulder0'], ['neck', 'shoulder1'], ['shoulder0', 'elbow0'], ['elbow0', 'hand0'], ['shoulder1', 'elbow1'],
    ['elbow1', 'hand1'], ['neck', 'hipMid'], ['hipMid', 'hip0'], ['hipMid', 'hip1'], ['hip0', 'knee0'], ['knee0', 'skate0'], ['hip1', 'knee1'],
    ['knee1', 'skate1'], ['stickButt', 'stickBlade']];
  const DRAG = ['head', 'shoulder0', 'elbow0', 'hand0', 'shoulder1', 'elbow1', 'hand1', 'hip0', 'knee0', 'skate0', 'hip1', 'knee1', 'skate1', 'stickButt', 'stickBlade'];
  const LABEL = { head: 'head', torso: 'torso', arm0: 'arm A', arm1: 'arm B', hand0: 'hand A', hand1: 'hand B', leg0: 'leg A', leg1: 'leg B',
    skate0: 'skate A', skate1: 'skate B', stick: 'stick', stickShadow: 'stick shadow', shadow: 'shadow', other: 'other' };
  const STAGE = { w: 96, h: 80, ox: 48, oy: 58 };       // game pixels; the player position sits at ox, oy

  const S = { year: null, lib: null, palette: null, empty: 0, cur: null, cel: null, dirs: null, hidden: new Set(), seq: [], sel: -1, playing: null, drag: null };

  // ---- loading ---------------------------------------------------------------------------------------------
  const b64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  async function loadYear(year) {
    let data;
    try {
      const res = await fetch('library/bundle-' + year + '.json');
      if (!res.ok) throw new Error(res.status);
      data = await res.json();
    } catch (e) { $('missing').hidden = false; $('app').hidden = true; return; }
    $('missing').hidden = true; $('app').hidden = false;
    const frames = data.frames.map((f) => Object.assign({}, f, { game: year, px: b64(f.px), part: b64(f.part), empty: data.empty }));
    S.year = year; S.lib = R.index(frames); S.palette = data.palette; S.empty = data.empty; S.seq = []; S.sel = -1;
    if (S.playing) { clearTimeout(S.playing); S.playing = null; $('play').textContent = 'Play'; }
    $('player').getContext('2d').clearRect(0, 0, $('player').width, $('player').height);
    const groups = [...new Set(frames.filter((f) => !f.prop).map((f) => f.group))];
    $('group').innerHTML = groups.map((g) => '<option>' + g + '</option>').join('');
    $('group').value = groups.includes('SPFHold') ? 'SPFHold' : groups[0];
    showThumbs();
    const first = frames.find((f) => f.group === $('group').value && f.facing === 2) || frames.find((f) => f.group === $('group').value);
    pick(first.id);
    drawStrip();
  }

  // ---- drawing ---------------------------------------------------------------------------------------------
  function drawLayers(ctx, layers, scale, ox, oy, hidden) {
    for (const L of layers) {
      if (hidden && hidden.has(L.part)) continue;
      for (let i = 0; i < L.w * L.h; i++) {
        const v = L.px[i];
        if (v === S.empty) continue;
        const c = S.palette[v];
        ctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
        ctx.fillRect(ox + (L.x0 + (i % L.w)) * scale, oy + (L.y0 + ((i / L.w) | 0)) * scale, scale, scale);
      }
    }
  }
  function celLayers(cel) { return cel.layers || [{ part: 'all', x0: cel.x0, y0: cel.y0, w: cel.w, h: cel.h, px: cel.px }]; }
  function miniCanvas(cel, w, h, scale) {
    const c = document.createElement('canvas');
    c.width = w * scale; c.height = h * scale; c.className = 'mini';
    const ctx = c.getContext('2d');
    if (cel) {
      const ox = Math.round((w / 2 - (cel.x0 + cel.w / 2)) * scale), oy = Math.round((h / 2 - (cel.y0 + cel.h / 2)) * scale);
      drawLayers(ctx, celLayers(cel), scale, ox, oy);
    }
    return c;
  }
  const zoom = () => Number($('zoom').value);
  function drawStage() {
    const z = zoom(), cv = $('stage');
    cv.width = STAGE.w * z; cv.height = STAGE.h * z;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    drawLayers(ctx, S.cel.layers, z, STAGE.ox * z, STAGE.oy * z, S.hidden);
    if ($('show-skeleton').checked) {
      const kp = S.cur.kp, P = (j) => [(STAGE.ox + kp[j][0]) * z, (STAGE.oy + kp[j][1]) * z];
      ctx.lineWidth = Math.max(2, z / 3);
      for (const [a, b] of BONES) {
        if (!kp[a] || !kp[b]) continue;
        ctx.strokeStyle = a === 'stickButt' ? 'rgba(200,0,200,.8)' : 'rgba(0,80,255,.75)';
        ctx.beginPath(); ctx.moveTo(...P(a)); ctx.lineTo(...P(b)); ctx.stroke();
      }
      for (const j of DRAG) {
        if (!kp[j]) continue;
        const [x, y] = P(j);
        ctx.fillStyle = S.drag === j ? '#ffd66b' : '#fff'; ctx.strokeStyle = '#18202f'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, Math.max(4, z * 0.8), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
  }
  function drawLayersPanel() {
    const BONE = { upper: L0 => (L0.part.startsWith('leg') ? 'thigh' : 'upper arm'), lower: L0 => (L0.part.startsWith('leg') ? 'shin' : 'forearm') };
    $('layers').innerHTML = S.cel.layers.slice().reverse().map((L) => '<li><label><input type="checkbox" data-part="' + L.part + '"' + (S.hidden.has(L.part) ? '' : ' checked') + '> ' + (LABEL[L.part] || L.part) + (BONE[L.bone] ? ' · ' + BONE[L.bone](L) : '') +
      '</label><span class="src">' + (L.from || '') + '</span></li>').join('');
  }
  function drawFacings() {
    const box = $('facings');
    box.innerHTML = '';
    if (!S.dirs) { $('facings-note').textContent = 'No 8-facing animation to learn the turn from in this game.'; return; }
    S.dirs.facings.forEach((f) => {
      const b = document.createElement('button');
      b.type = 'button'; b.title = 'Edit facing ' + FACINGS[f.facing] + ' (base ' + f.base + ')';
      b.setAttribute('aria-selected', String(f.facing === S.cur.facing));
      b.append(miniCanvas(f.cel, 64, 60, 2), document.createTextNode(FACINGS[f.facing]));
      b.onclick = () => { S.cur = { scaffold: f.base, kp: clone(f.kp), facing: f.facing, label: 'facing ' + FACINGS[f.facing] + ' of ' + S.cur.label }; refresh(true); };
      box.append(b);
    });
    $('facings-note').textContent = 'Turn learned from ' + S.dirs.set.split('|').slice(1).join(' step ') + ' and its neighbours.';
  }
  const NAME = { arm0: 'arm A', arm1: 'arm B', legs: 'legs', stick: 'stick blade' };
  function showSwaps() {
    const sw = Object.entries(S.cel.swaps || {});
    $('swaps').textContent = sw.length ? 'Drawn from: ' + sw.map(([limb, h]) => (NAME[limb] || limb) + ' ← ' + h.id + (h.turn && h.turn.some(Boolean) ? ' turned ' + h.turn.map((a) => a + '°').join('/') : '')).join(', ') : '';
  }

  // ---- state -----------------------------------------------------------------------------------------------
  const clone = (kp) => JSON.parse(JSON.stringify(kp));
  function pick(id) {
    const f = S.lib.byId.get(id);
    const facing = f.facing != null ? f.facing : 2;
    S.cur = { scaffold: id, kp: clone(f.kp), facing, label: id + ' ' + f.group, original: id };
    $('as-facing').value = String(facing);
    $('as-facing').disabled = f.facing != null;
    for (const b of $('thumbs').children) b.setAttribute('aria-selected', String(b.dataset.id === id));
    refresh(true);
  }
  let dirTimer = null;
  function refresh(withFacings) {
    const f = S.lib.byId.get(S.cur.scaffold);
    const untouched = S.cur.original === S.cur.scaffold && JSON.stringify(S.cur.kp) === JSON.stringify(f.kp);
    S.cel = untouched ? { x0: f.x0, y0: f.y0, w: f.w, h: f.h, px: f.px, empty: f.empty, swaps: {}, layers: R.orderedLayers(f).map((L) => Object.assign(L, { from: f.id })) }
      : R.render(S.lib, S.cur.scaffold, S.cur.kp, { facing: f.facing != null ? f.facing : S.cur.facing, noStick: !S.cur.kp.stickButt && !S.cur.kp.stickBlade });
    $('pose-title').textContent = S.cur.label;
    drawStage(); drawLayersPanel(); showSwaps();
    if (withFacings) { clearTimeout(dirTimer); dirTimer = setTimeout(computeFacings, 30); }
  }
  function computeFacings() {
    S.dirs = R.directions(S.lib, { game: S.year, facing: S.cur.facing, kp: S.cur.kp, cel: S.cel });
    drawFacings();
  }

  // ---- frame browser ---------------------------------------------------------------------------------------
  function showThumbs() {
    const g = $('group').value, ff = $('facing-filter').value;
    const box = $('thumbs');
    box.innerHTML = '';
    for (const f of S.lib.frames) {
      if (f.group !== g || f.prop || (ff !== '' && String(f.facing) !== ff)) continue;
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.id = f.id; b.setAttribute('role', 'option');
      b.append(miniCanvas(Object.assign({}, f, { layers: R.orderedLayers(f) }), 56, 56, 1), document.createTextNode(f.n + (f.facing != null ? ' ' + FACINGS[f.facing] : '')));
      b.onclick = () => pick(f.id);
      box.append(b);
    }
  }

  // ---- dragging --------------------------------------------------------------------------------------------
  function toGame(ev) {
    const cv = $('stage'), r = cv.getBoundingClientRect(), z = zoom();
    const x = (ev.clientX - r.left) * (cv.width / r.width) / z - STAGE.ox, y = (ev.clientY - r.top) * (cv.height / r.height) / z - STAGE.oy;
    return [x, y];
  }
  $('stage').addEventListener('pointerdown', (ev) => {
    const [x, y] = toGame(ev);
    let best = null, bd = 2.2;
    for (const j of DRAG) { const p = S.cur.kp[j]; if (!p) continue; const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = j; } }
    if (!best) return;
    // What the body is made of at the start of the drag: bone lengths, reach, how the stick is held.
    S.drag = best; S.rig = R.rigOf(S.lib, S.cur.kp, S.year, S.cur.grip);
    S.cur.grip = S.rig.grip;
    $('stage').setPointerCapture(ev.pointerId); drawStage();
  });
  let raf = 0;
  $('stage').addEventListener('pointermove', (ev) => {
    if (!S.drag) return;
    const [x, y] = toGame(ev);
    // The joint goes where it is put and the body follows (lib/sprite-rig.js drag): arms and legs bend at their
    // own lengths, the hips crouch over planted skates, the shoulders lean the upper body, the stick stays in the hands.
    S.cur.kp = R.drag(S.cur.kp, S.drag, [x, y], S.rig);
    S.cur.label = S.cur.label.replace(/ \(edited\)$/, '') + ' (edited)';
    cancelAnimationFrame(raf); raf = requestAnimationFrame(() => refresh(false));
  });
  // On release the skeleton snaps to where the swapped-in limbs really put their joints.
  const endDrag = () => { if (!S.drag) return; S.drag = null; if (S.cel.kp) S.cur.kp = clone(S.cel.kp); refresh(true); };
  $('stage').addEventListener('pointerup', endDrag);
  $('stage').addEventListener('pointercancel', endDrag);

  // ---- sequence --------------------------------------------------------------------------------------------
  function drawStrip() {
    const box = $('strip');
    box.innerHTML = '';
    const t = Number($('play-facing').value);
    S.seq.forEach((item, k) => {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('aria-selected', String(k === S.sel));
      b.append(miniCanvas(item.facings[t].cel, 64, 56, 1), document.createTextNode((k + 1) + ' · ' + item.hold + 'v'));
      b.onclick = () => { S.sel = k; $('hold').value = item.hold; S.cur = clone2(item.source); refresh(true); drawStrip(); };
      box.append(b);
    });
  }
  const clone2 = (src) => Object.assign({}, src, { kp: clone(src.kp) });
  $('add').onclick = () => {
    if (!S.dirs) computeFacings();
    const item = { source: clone2(S.cur), hold: Number($('hold').value) || 8, facings: S.dirs.facings.map((f) => ({ facing: f.facing, base: f.base, kp: f.kp, cel: f.cel })) };
    if (S.sel >= 0) S.seq.splice(S.sel + 1, 0, item), S.sel++; else S.seq.push(item), S.sel = S.seq.length - 1;
    drawStrip();
  };
  $('remove').onclick = () => { if (S.sel < 0) return; S.seq.splice(S.sel, 1); S.sel = Math.min(S.sel, S.seq.length - 1); drawStrip(); };
  const move = (d) => { const k = S.sel, j = k + d; if (k < 0 || j < 0 || j >= S.seq.length) return; [S.seq[k], S.seq[j]] = [S.seq[j], S.seq[k]]; S.sel = j; drawStrip(); };
  $('left').onclick = () => move(-1);
  $('right').onclick = () => move(1);
  $('hold').onchange = () => { if (S.sel >= 0) { S.seq[S.sel].hold = Math.max(1, Number($('hold').value) || 8); drawStrip(); } };
  $('play').onclick = () => {
    if (S.playing) { clearTimeout(S.playing); S.playing = null; $('play').textContent = 'Play'; return; }
    if (!S.seq.length) return;
    $('play').textContent = 'Stop';
    let k = 0;
    const step = () => {
      const item = S.seq[k], cv = $('player'), ctx = cv.getContext('2d'), z = 2, cel = item.facings[Number($('play-facing').value)].cel;
      ctx.clearRect(0, 0, cv.width, cv.height);
      drawLayers(ctx, celLayers(cel), z, STAGE.ox * z, STAGE.oy * z);
      k = (k + 1) % S.seq.length;
      S.playing = setTimeout(step, ((item.hold + 1) * 1000) / 60);      // a step of N vblanks shows for N + 1
    };
    step();
  };

  // ---- export ----------------------------------------------------------------------------------------------
  function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  $('export-png').onclick = () => {
    if (!S.seq.length) return;
    let minX = 0, minY = 0, maxX = 1, maxY = 1;
    for (const it of S.seq) for (const f of it.facings) { const c = f.cel; minX = Math.min(minX, c.x0); minY = Math.min(minY, c.y0); maxX = Math.max(maxX, c.x0 + c.w); maxY = Math.max(maxY, c.y0 + c.h); }
    const cw = maxX - minX + 2, ch = maxY - minY + 2;
    const cv = document.createElement('canvas'); cv.width = S.seq.length * cw; cv.height = 8 * ch;
    const ctx = cv.getContext('2d');
    S.seq.forEach((it, k) => it.facings.forEach((f) => drawLayers(ctx, celLayers(f.cel), 1, k * cw - minX + 1, f.facing * ch - minY + 1)));
    cv.toBlob((b) => download('animation-' + S.year + '.png', b));
  };
  $('export-json').onclick = () => {
    const toB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
    const out = {
      game: S.year, note: 'Each facing of each frame: pixels in the game\'s own indices (' + (S.empty === 255 ? 'PC sprite index, 255 empty' : 'Genesis palette line * 16 + colour, 0 empty') + '), placed at x0, y0 from the player position; the retail frame it is built on and the limbs swapped in.',
      frames: S.seq.map((it) => ({ hold: it.hold, facings: it.facings.map((f) => {
        const c = f.cel, flat = new Uint8Array(c.w * c.h).fill(S.empty);
        for (const L of celLayers(c)) for (let i = 0; i < L.w * L.h; i++) { const v = L.px[i]; if (v !== S.empty) flat[(L.y0 - c.y0 + ((i / L.w) | 0)) * c.w + (L.x0 - c.x0 + (i % L.w))] = v; }
        return { facing: FACINGS[f.facing], base: f.base, swaps: c.swaps || {}, x0: c.x0, y0: c.y0, w: c.w, h: c.h, px: toB64(flat), skeleton: f.kp };
      }) }))
    };
    download('animation-' + S.year + '.json', new Blob([JSON.stringify(out)], { type: 'application/json' }));
  };

  // ---- controls --------------------------------------------------------------------------------------------
  const facingOptions = FACINGS.map((n, i) => '<option value="' + i + '">' + i + ' ' + n + '</option>').join('');
  $('as-facing').innerHTML = facingOptions;
  $('play-facing').innerHTML = facingOptions;
  $('play-facing').value = '2';
  $('facing-filter').innerHTML += facingOptions;
  $('year').onchange = () => loadYear($('year').value);
  $('group').onchange = showThumbs;
  $('facing-filter').onchange = showThumbs;
  $('as-facing').onchange = () => { S.cur.facing = Number($('as-facing').value); refresh(true); };
  $('show-skeleton').onchange = drawStage;
  $('zoom').oninput = drawStage;
  $('reset').onclick = () => pick(S.cur.original || S.cur.scaffold);
  $('play-facing').onchange = drawStrip;
  $('layers').addEventListener('change', (ev) => { const p = ev.target.dataset.part; if (!p) return; if (ev.target.checked) S.hidden.delete(p); else S.hidden.add(p); drawStage(); });
  window.NhlAnimator = { state: S, loadYear, pick };            // for tests and the console
  loadYear($('year').value);
})();
