# HD sprites (PixelLab)

**HD sprites** on the transport bar swaps the NHL 92 player sheet (`Sprites.anim`) for frames redrawn at twice the resolution with [PixelLab](https://www.pixellab.ai). It covers the skaters (frames 1–377) and the goalies (400–511). The arrows, star, puck, nets, logos and goal light stay as they are. **Rig** draws the skeleton each HD frame was posed with.

The HD frames are meant to be the same sprites with more detail, not new art:

- **Same motion.** Each HD frame is posed from the original frame of the same number, so every SPA plays the game's own animation step for step, with the same timing, facings and hotspots.
- **Same palette.** Every HD pixel is a palette index of the original frame (the jersey row on these banks). Team jerseys and the embedded palette lines recolor HD frames just like the originals, and **Export frame** writes an 8-bit PNG at 2x.
- **Same place.** HD frames are anchored to the frame's 0,0 (the skates), so they sit where the original sits. The dashed canvas, the 0,0 mark and the hotspot are unchanged.
- **Same ice spray.** The light-blue spray under the skates is copied from the original frame (index 47, scaled 2x), since the model does not draw it.

## How the frames are made

`tools/pixellab/hd-sprites.js` builds `data/hd/nhl92-sprites-hd.json`:

1. **Base drawing per facing.** The rest frame of each facing (`SPAglide` for skaters, `SPAgready` for goalies) is scaled 2x and redrawn with more detail by `edit-images-v2`, four facings per call so the eight match. The result is snapped back to the palette indices the original uses.
2. **Rig.** `estimate-custom-skeleton` builds a skeleton on each base: the body, plus joints for the stick (`stick_hand`, `stick_mid`, `stick_tip`), and the pads and glove for the goalie.
3. **Poses.** The same rig is placed on every original frame of that facing, scaled 2x onto a shared canvas. This reads the pose of each frame of each animation.
4. **Frames.** `animate-with-skeleton-v3` redraws the base in those poses, up to 15 per call.
5. **Clean-up.** Each result is snapped to the original frame's palette indices (when two indices share a color, the one the original used at that spot wins), stray single pixels are removed, and the original's ice spray goes back underneath.

The SPA facing is the direction of travel, but in checks, falls, shots and backward skating the body often turns its back (or its front) to the camera. A 2D skeleton cannot tell front from back, so the tool counts face pixels in the original (indices 38 and 39). A skater seen from behind shows only the back of the neck (about 3 pixels), and from the front 10 or more. A south-facing frame with 5 or fewer is posed from the matching north base, and a north-facing frame with 8 or more from the matching south base. Fights use the south-east base and the penalty-box jump uses east and west.

The Stanley Cup frames (217–224) and the dropped gloves (353) are props rather than body poses, and each is a single still. They are redrawn at 2x by `/resize` from the frame itself, with the frame's own colors as the forced palette.

## Rebuilding

```
NODE_USE_ENV_PROXY=1 node tools/pixellab/hd-sprites.js            # everything
NODE_USE_ENV_PROXY=1 node tools/pixellab/hd-sprites.js --only skater:4   # one character and facing
node tools/pixellab/hd-sprites.js --plan                           # chunk count and cost estimate, no requests
node tools/pixellab/preview.js out.png skater:4                    # original over HD contact sheet
```

Set `PIXELLAB_API_TOKEN`, or run where a proxy adds the token for `api.pixellab.ai`. Every response is cached in `.pixellab-cache/` (ignored by git), keyed by the request, so a rerun only pays for requests it has not made before. A `--only` run merges into the existing JSON.

A full build cost about 270 PixelLab generations: about 40 for the bases, 16 for the rigs, about 200 to place the rigs and animate, and 9 for the props.

## File format

`data/hd/nhl92-sprites-hd.json`, read by `lib/hd-sprites.js`:

- `frames[n]`: `x`, `y` (top-left in 2x pixels from the frame's 0,0), `w`, `h`, and `data` (palette indices, 0 transparent, zlib then base64).
- `skeletons[n]`: the pose read from original frame `n`: `character`, `body` (the facing of the base it was posed from), and `keypoints` (`label`, `x`, `y` in 2x pixels from 0,0, `z`).
- `rigs["skater:4"]`: the joints and their parents for that character and facing.
