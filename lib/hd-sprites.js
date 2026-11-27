/**
 * Detailed 2x NHL 92 sprite frames made with PixelLab (tools/pixellab/hd-sprites.js).
 *
 * data/hd/nhl92-sprites-hd.json holds, per frame number of Sprites.anim:
 * a 2x palette-index bitmap (0 transparent, zlib + base64) and its top-left
 * x, y in 2x pixels from the frame's 0,0; plus the skeleton pose PixelLab
 * read from the original frame and the rig (joints and parents) of each
 * character and facing. `method` is 'rig' for a frame posed by its skeleton,
 * 'resize' for one redrawn from the frame itself (props, and rig results that
 * strayed too far from the original).
 *
 * `hdFrame(orig, entry)` returns a frame the viewer paints like the original:
 * width, height, minX, minY and the hotspot stay in game pixels, and the
 * bitmap is bitmapWidth x bitmapHeight (twice as fine).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlHdSprites = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  async function inflate(b64) {
    if (typeof Buffer !== 'undefined' && typeof require === 'function') {
      return new Uint8Array(require('zlib').inflateSync(Buffer.from(b64, 'base64')));
    }
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** Parse the JSON into { scale, frames: Map(frame → entry), skeletons, rigs }. */
  async function load(json) {
    const scale = json.scale || 2;
    const frames = new Map();
    await Promise.all(Object.entries(json.frames || {}).map(async ([n, f]) => {
      const pixels = await inflate(f.data);
      if (pixels.length !== f.w * f.h) throw new Error('HD frame ' + n + ' has ' + pixels.length + ' pixels, expected ' + f.w * f.h);
      frames.set(Number(n), { x: f.x, y: f.y, w: f.w, h: f.h, method: f.method || 'rig', pixels });
    }));
    return { scale, frames, skeletons: json.skeletons || {}, rigs: json.rigs || {}, source: json.source || '' };
  }

  function hdFrame(orig, entry, scale) {
    const s = scale || 2;
    const minX = entry.x / s;
    const minY = entry.y / s;
    return Object.assign({}, orig, {
      hd: s,
      width: entry.w / s,
      height: entry.h / s,
      bitmapWidth: entry.w,
      bitmapHeight: entry.h,
      pixels: entry.pixels,
      minX,
      minY,
      offsetX: -minX,
      offsetY: -minY,
      hotspotPxX: orig.hotspotX - minX,
      hotspotPxY: orig.hotspotY - minY
    });
  }

  /** Bones of the skeleton a frame was posed with, as [[x0, y0, x1, y1], ...] in game pixels from 0,0 (none for a redrawn frame). */
  function bones(data, frameNumber) {
    const skel = data.skeletons[frameNumber];
    const entry = data.frames.get(Number(frameNumber));
    if (!skel || (entry && entry.method !== 'rig')) return [];
    const rig = data.rigs[skel.character + ':' + (skel.body != null ? skel.body : skel.facing)] || [];
    const at = new Map(skel.keypoints.map((k) => [k.label, k]));
    const s = data.scale || 2;
    const out = [];
    for (const joint of rig) {
      const a = at.get(joint.name);
      const b = joint.parent && at.get(joint.parent);
      if (a && b) out.push([b.x / s, b.y / s, a.x / s, a.y / s]);
    }
    return out;
  }

  return { load, hdFrame, bones, inflate };
});
