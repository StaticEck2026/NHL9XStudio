// NHL 92 HD sprites (data/hd/nhl92-sprites-hd.json, docs/HD-SPRITES.md): every player and goalie frame has a
// 2x version that decodes, sits over the original, and stays on the palette rows the original frame uses
// (so the jersey row still recolors it).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Anim = require('../lib/anim.js');
const Hd = require('../lib/hd-sprites.js');

(async () => {
  const root = path.join(__dirname, '..');
  const json = JSON.parse(fs.readFileSync(path.join(root, 'data', 'hd', 'nhl92-sprites-hd.json'), 'utf8'));
  const data = await Hd.load(json);
  const anim = Anim.parseAnim(fs.readFileSync(path.join(root, 'test', 'fixtures', 'ANIM-To-BMP', 'Sprites.anim')));
  const want = [];
  for (let n = 1; n <= 377; n++) want.push(n);
  for (let n = 400; n <= 511; n++) want.push(n);
  for (const n of want) {
    const entry = data.frames.get(n);
    assert.ok(entry, 'HD frame ' + n + ' missing');
    const orig = Anim.renderFrame(anim, n);
    const rows = new Set([...orig.pixels].filter(Boolean).map((v) => v >> 4));
    for (const v of entry.pixels) assert.ok(v === 0 || (rows.has(v >> 4) && v % 16), 'HD frame ' + n + ' uses index ' + v + ' outside the original palette rows');
    const f = Hd.hdFrame(orig, entry, data.scale);
    assert.strictEqual(f.bitmapWidth, f.width * 2, 'frame ' + n + ' bitmap is 2x');
    // The HD drawing overlaps the original's box (anchored at the same 0,0).
    const ox = Math.max(f.minX, orig.minX) < Math.min(f.minX + f.width, orig.minX + orig.width);
    const oy = Math.max(f.minY, orig.minY) < Math.min(f.minY + f.height, orig.minY + orig.height);
    assert.ok(ox && oy, 'HD frame ' + n + ' does not overlap the original');
    assert.strictEqual(f.hotspotPxX + f.minX, orig.hotspotPxX + orig.minX, 'frame ' + n + ' hotspot moved');
  }
  // Skeletons drive the poses: every rig-posed frame has one, and its rig exists.
  let posed = 0;
  for (const [n, s] of Object.entries(data.skeletons)) {
    assert.ok(data.rigs[s.character + ':' + s.body], 'rig for frame ' + n);
    if (data.frames.get(Number(n)).method !== 'rig') continue;
    assert.ok(Hd.bones(data, Number(n)).length >= 10, 'frame ' + n + ' skeleton has bones');
    posed++;
  }
  assert.ok(posed >= 340, 'posed frames: ' + posed);
  console.log('hd-sprites ok (' + data.frames.size + ' frames, ' + posed + ' posed by rig)');
})().catch((err) => { console.error(err); process.exitCode = 1; });
