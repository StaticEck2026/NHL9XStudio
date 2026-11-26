#!/usr/bin/env python3
"""Train the zone and shade trees the PC upgrade uses (tools/pcupgrade/model.json).

    node tools/pcupgrade/export-features.js --pc pc95 > features.json
    python3 tools/pcupgrade/train_model.py features.json tools/pcupgrade/model.json

Needs scikit-learn. Two decision trees over segment().feature (body-axis height, side of the spine, distances to the
hands, skates, face, pants, arm bone and spine, the Genesis colour class and tone, the number of hands):
  - zone: the PC jersey zone family of a team pixel;
  - shade: light / medium / dark, for the families that have three shades.
Each is scored first on held-out frames (4 folds of 16-frame blocks, so near-identical neighbours never straddle a
fold), then retrained on everything. The scores go into the JSON next to the trees.
"""
import json
import sys

import numpy as np
from sklearn.tree import DecisionTreeClassifier

ZONE_DEPTH, SHADE_DEPTH, LEAF = 10, 8, 20


def folds(model, X, y, blocks):
    acc = []
    for f in range(4):
        test = (blocks % 4) == f
        m = model().fit(X[~test], y[~test])
        acc.append(float((m.predict(X[test]) == y[test]).mean()))
    return round(float(np.mean(acc)), 4)


def export(m):
    t = m.tree_
    nodes = []
    for i in range(t.node_count):
        if t.children_left[i] == -1:
            nodes.append([-1, int(np.argmax(t.value[i][0]))])
        else:
            nodes.append([int(t.feature[i]), round(float(t.threshold[i]), 5), int(t.children_left[i]), int(t.children_right[i])])
    return {'classes': [str(c) for c in m.classes_], 'nodes': nodes}


def main(src, dst):
    data = json.load(open(src))
    rows = data['rows']
    frames = np.array([r[0] for r in rows])
    X = np.array([r[1] for r in rows], float)
    fam = np.array([r[2] for r in rows])
    shade = np.array([r[3] for r in rows])
    blocks = frames // 16
    zone = lambda: DecisionTreeClassifier(max_depth=ZONE_DEPTH, min_samples_leaf=LEAF, random_state=0)
    shd = lambda: DecisionTreeClassifier(max_depth=SHADE_DEPTH, min_samples_leaf=LEAF, random_state=0)
    three = np.isin(shade, ['light', 'medium', 'dark'])
    out = {
        'source': 'NHL 94 Genesis frames paired with NHL %s PC frames (%d pairs, %d pixels)' % (data['pcGame'], data['framePairs'], len(rows)),
        'heldOut': {'zone': folds(zone, X, fam, blocks), 'shade': folds(shd, X[three], shade[three], blocks[three])},
        'zone': export(zone().fit(X, fam)),
        'shade': export(shd().fit(X[three], shade[three])),
    }
    json.dump(out, open(dst, 'w'), separators=(',', ':'))
    print(out['source'], out['heldOut'])


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
