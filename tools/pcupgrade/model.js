/**
 * The learned zone and shade trees (model.json, written by train_model.py from export-features.js).
 *
 * Each tree is a list of nodes: [feature, threshold, left, right] for a split (go left when feature <= threshold)
 * and [-1, class] for a leaf. Features are segment().feature: see there.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'model.json');

function walk(tree, f) {
  let n = 0;
  for (;;) {
    const node = tree.nodes[n];
    if (node[0] === -1) return tree.classes[node[1]];
    n = f[node[0]] <= node[1] ? node[2] : node[3];
  }
}

let cached;
/** The bundled model, or null when model.json is missing. */
function load() {
  if (cached === undefined) {
    try {
      const m = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      cached = { zone: (f) => walk(m.zone, f), shade: (f) => walk(m.shade, f), heldOut: m.heldOut, source: m.source };
    } catch (e) { cached = null; }
  }
  return cached;
}

module.exports = { load, walk, FILE };
