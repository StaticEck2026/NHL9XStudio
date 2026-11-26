# NHL 94 / 95 PC player sprites: palette structure and shading

This is groundwork for upgrading Genesis player frames (the NHL '94 injury frames and NHLPA '93's fight frames) to the PC colour standard.

Sources used, all in this repo:

- the NHL 94 PC and NHL 95 PC skater frames in `public/skaters-data.js` (SPAskatewp, facing east, 4 frames; both games carry identical pixels);
- the matching NHL '94 and NHLPA '93 Genesis frames in the same file (identical to each other);
- the retail jersey files `test/fixtures/pc-jersey/HOMEPALS94.BIN`, `AWAYPALS94.BIN` and `HOMEPALS95.BIN`;
- the sprite-space palettes `createjerseyShadowfixed.act` / `rinkpal*.act`, read through `lib/pc-jersey.js`.

No NHL 92 data is used.

## 1. Colour depth

| | Genesis (93 / 94) | PC (94 / 95) |
|---|---|---|
| Channel depth | 3 bits (8 levels), CRAM `0000 BBB0 GGG0 RRR0` | 6 bits (64 levels), VGA DAC, stored ×4 as 8-bit |
| Total colours | 512 | 262,144 |
| On screen | 4 lines × 15 + transparent | 256 |
| A skater | one 16-colour line (line 2; NHLPA '93 fights also line 3 for the other fighter) | 8-bit indices in a 256-entry **sprite colour space**, remapped per team |
| Distinct RGB in one skating frame | 13 | 20 (from 53–61 different indices) |

## 2. The PC sprite colour space

A PC sprite pixel names **what the pixel is**, not a colour. The team record turns that into a colour.

| Sprite index | Meaning | Colour comes from |
|---|---|---|
| 0 | transparent (drawn magenta 252,0,252 in the sheets) | — |
| 1–127 | fixed art: 8 = blade-side dark blue (0,64,128), 88 = ice shadow (64,160,224) | rink palette, the same for all teams (map bytes 192–319: identity except 8→16, 82/88→99) |
| 128–143 | skin, eyes and stick: a 16-step skin ramp from (252,212,180) to (44,20,0); the stick reuses 136 | rink palette through map bytes 320–335 |
| 144–191 | **48 jersey zones** (below) | the team's 64 colours (record bytes 0–191, 6-bit RGB, game palette 128–191) through map bytes 336–383 |
| 192–196, 208–212, 224–228, 240–244 | the 5×4 jersey crest | team colours |
| 197–202, 213–218, 229–234, 245–250 | scoreboard crest | team colours |
| 255 | black: skates, gloves, blade tape, outline darks | fixed |

The 48 zones are 16 body parts. Most have three shades (light / medium / dark):

`forearm`, `arm stripe 3`, `arm stripe 2`, `arm stripe 1`, `upper arm`, `yoke corner`*, `shoulder patch`*, `yoke 3`*, `yoke 1`*, `yoke 2`*, `goalie mask`*, `jersey`, `waist 1` (odd / even / hidden), `waist 2`, `waist 3`, `pants` (dark / medium, stripe 1, stripe 2), `socks`, `socks stripe 1`, `socks stripe 2`, `helmet` (medium / dark). *single shade.

### How much the zone changes the colour (retail records)

Across all teams and shades, the share of zones that render in the same colour as the plain `jersey` zone:

| Zone | HOMEPALS94 | AWAYPALS94 | HOMEPALS95 |
|---|---|---|---|
| upper arm | 63 / 78 | 65 / 78 | 68 / 84 |
| socks | 75 / 78 | 69 / 78 | 70 / 84 |
| forearm | 48 / 78 | 57 / 78 | 50 / 84 |
| helmet | 17 / 52 | 10 / 52 | 19 / 56 |
| arm stripes 1–3 | 14–21 / 78 | 8–22 / 78 | 18–23 / 84 |
| waist 2, 3 | 10–21 / 78 | 10–14 / 78 | 14–25 / 84 |
| yokes, shoulder patch | 0–10 / 26 | 1–17 / 26 | 1–10 / 28 |
| pants, all stripes | 0 | 2–14 | 0 |

So the PC standard depends on each pixel's **body part**. Sleeve stripes, yoke bands, waist bands, sock stripes, the helmet and pants all carry their own team colours. The Genesis has none of that separation: its 16 colours are a few shared tones (pants 3–5, trim 8–9, jersey/helmet/socks 10–13) used on every body part.

## 3. Shading conventions on the PC frames

Measured on the four retail PC skating frames, after aligning each one with its Genesis counterpart. The alignment confirms the PC art is **the same drawing**: silhouette overlap is 94–98% at a 0–5 pixel offset. The PC versions are recoloured, with small touch-ups. They are not redrawn.

- **Three-shade ramps per part.** Zone pixels are 252 medium, 235 dark and 139 light. Shades sit in bands along each part, not dithered. The light band leans toward the side the player faces (mean offset +0.46 px in x from the part's centre, east-facing frames).
- **Black is a material, not an outline.** Index 255 covers skates, gloves and the black tape on the blade, which the Genesis draws in stick colour: 36 of the Genesis stick pixels become black. 141 of the silhouette's edge pixels are black and 91 are a dark shade. No pixel was added around the figure.
- **Skin gets 4 of the 16 ramp steps** (133, 134, 136, 140). The Genesis has 2 skin tones plus the eye. The stick shares ramp step 136.
- **Shadow is two fixed blues**: 88 for the ice shadow, and 8 under the skate blades and the blade. Genesis steel (colour 1) becomes 8.
- **Crest**: a few crest-zone pixels (192–243) sit on the chest. The Genesis frame has nothing there.

### Genesis colour → PC index on the same pixel (aligned skating frames)

| Genesis line 2 colour | Becomes on the PC |
|---|---|
| 1 steel | 8 (40/40) |
| 2 black | 255 (181/183) |
| 3, 4, 5 pants | 177 pants dark, 180 pants medium, 178/179 pants stripes, 182–186 socks |
| 6 skin light | 134 (12/12) |
| 7 skin shade | 136 (27), 133 (8) |
| 8, 9 trim | arm stripes 147–155, yoke 161/163, pants stripe 179, socks stripe 185/188 |
| 10–13 jersey tones | jersey 165–167, upper arm 156–158, forearm 144–146, yoke 161–163, helmet 190/191, socks 181–183 |
| 14 stick | 136 (69), 255 tape (36) |
| 15 shadow | 88 (109/109) |

Two conclusions follow:

1. The fixed materials map one-to-one: black, steel, skin, stick, shadow.
2. Every team-coloured pixel needs a **body-part decision** before it can get its PC zone. The Genesis tone then picks the shade.

## 4. Consequence for upgrading Genesis frames

A faithful PC-standard upgrade has two parts:

- keep every Genesis pixel where it is, and recolour only;
- turn each pixel into a PC sprite index: the fixed materials by the table above, team pixels by **body part + shade**, then render through a real HOMEPALS / AWAYPALS record.

The output is then 6-bit VGA colour with the team's real stripe, yoke, helmet and sock colours.

The body-part decision is where the frames themselves are needed. NHL 94 PC's player sheet numbers its 876 frames like the Genesis sheet. Where it holds PC versions of the same poses, those frames give the exact zone layout to transfer onto the Genesis pixels: the PC fight frames 354–370 (unused in '94), the fight injury 371–376 and the on-ice injury 641–652. Otherwise the parts have to be segmented from the Genesis art.
