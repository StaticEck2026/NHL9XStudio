/**
 * NHL 94 / 95 PC sprite colour space, as lib/pc-jersey.js and lib/pc95.js read it.
 *
 * 0 equipment black, 1..127 fixed art colours (8 blade-side blue, 88 ice shadow), 128..143 the skin ramp (the stick
 * reuses 136), 144..191 the 48 jersey zones, 192..250 crests, 255 transparent (the blitter skips it).
 */
'use strict';

const BLACK = 0, BLADE_BLUE = 8, SHADOW = 88, TRANSPARENT = 255;
const SKIN_LIGHT = 134, SKIN_SHADE = 136, SKIN_DEEP = 133, EYE = 140, STICK = 136;

// Zone families: sprite index per shade (null where the family has no such shade).
const Z = {
  forearm: { light: 146, medium: 145, dark: 144 },
  armStripe3: { light: 147, medium: 148, dark: 149 },
  armStripe2: { light: 152, medium: 151, dark: 150 },
  armStripe1: { light: 153, medium: 154, dark: 155 },
  upperArm: { light: 156, medium: 157, dark: 158 },
  yokeCorner: { one: 159 }, shoulderPatch: { one: 160 },
  yoke3: { one: 161 }, yoke1: { one: 162 }, yoke2: { one: 163 },
  jersey: { light: 165, medium: 166, dark: 167 },
  waist1: { odd: 168, even: 169, hidden: 170 },
  waist2: { light: 171, medium: 172, dark: 173 },
  waist3: { light: 174, medium: 175, dark: 176 },
  pants: { dark: 177, medium: 180 },
  pantsStripe2: { one: 178 }, pantsStripe1: { one: 179 },
  socks: { light: 181, medium: 182, dark: 183 },
  socksStripe1: { light: 184, medium: 185, dark: 186 },
  socksStripe2: { light: 187, medium: 188, dark: 189 },
  helmet: { medium: 190, dark: 191 }
};

/** The sprite index for a family and shade, falling back to the nearest shade the family has. */
function zoneIndex(family, shade) {
  const f = Z[family];
  if (!f) throw new Error('no zone family ' + family);
  if (f[shade] != null) return f[shade];
  if (f.one != null) return f.one;
  if (family === 'waist1') return shade === 'dark' ? f.hidden : (shade === 'light' ? f.even : f.odd);
  const order = shade === 'light' ? ['medium', 'dark'] : shade === 'dark' ? ['medium', 'light'] : ['light', 'dark'];
  for (const s of order) if (f[s] != null) return f[s];
  throw new Error('no shade for ' + family);
}

/** Sprite index -> { family, shade } (null outside 144..191). */
const BY_INDEX = new Map();
for (const [family, shades] of Object.entries(Z)) for (const [shade, i] of Object.entries(shades)) BY_INDEX.set(i, { family, shade });

/** Coarse body part of a family, for comparing segmentations. */
function part(family) {
  if (!family) return null;
  if (/^(forearm|armStripe|upperArm)/.test(family)) return 'arm';
  if (/^(yoke|shoulderPatch)/.test(family)) return 'yoke';
  if (/^waist/.test(family)) return 'waist';
  if (/^pants/.test(family)) return 'pants';
  if (/^socks/.test(family)) return 'socks';
  return family;            // jersey, helmet
}

module.exports = { Z, zoneIndex, BY_INDEX, part, BLACK, BLADE_BLUE, SHADOW, TRANSPARENT, SKIN_LIGHT, SKIN_SHADE, SKIN_DEEP, EYE, STICK };
