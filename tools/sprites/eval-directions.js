#!/usr/bin/env node
/**
 * How well lib/sprite-rig.js directions() recreates facings it never saw: every 8-facing animation step is hidden in
 * turn (its own step left out of the search and the turn model), recreated from its facings 0, 3 and 6, and each
 * recreated facing's skeleton compared with the real frame's. Baselines: the nearest other step's skeleton as it is,
 * and the source skeleton copied unchanged. Mean joint error in pixels.
 *   node tools/sprites/eval-directions.js [--pc folder]
 */
'use strict';
const path = require('path');
const R = require('../../lib/sprite-rig');
const args = process.argv.slice(2);
const pcAt = args.indexOf('--pc');
const { lib } = require('./rig-load').load({ pc: pcAt >= 0 ? args[pcAt + 1] : undefined });
const err=(a,b)=>{let s=0,n=0;for(const j of R.JOINTS){if(a[j]&&b[j]){s+=Math.hypot(a[j][0]-b[j][0],a[j][1]-b[j][1]);n++}}return n?s/n:null};
const res = { ours: [], nearestStep: [], copy: [] };const byGame={};
for(const [k,ids] of lib.sets){const game=k.split('|')[0];
 for(let d=0;d<8;d+=3){const src=lib.byId.get(ids[d]);
  const out=R.directions(lib,{game,facing:d,kp:src.kp},{excludeSet:(kk)=>kk===k,draw:false});if(!out)continue;
  const near=lib.sets.get(out.set);
  for(let t=0;t<8;t++){if(t===d)continue;const truth=lib.byId.get(ids[t]).kp;
   const o=err(out.facings[t].kp,truth),nn=err(lib.byId.get(near[t]).kp,truth),cp=err(src.kp,truth);
   if(o==null||nn==null||cp==null)continue;res.ours.push(o);res.nearestStep.push(nn);res.copy.push(cp);
   (byGame[game] = byGame[game] || { ours: [], nearestStep: [] }); byGame[game].ours.push(o); byGame[game].nearestStep.push(nn);}}}
const med=a=>{const s=a.slice().sort((x,y)=>x-y);return s[s.length>>1].toFixed(2)};const mean=a=>(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2);
for(const k of Object.keys(res))console.log(k.padEnd(8),'mean joint error',mean(res[k]),'px  median',med(res[k]),'n',res[k].length);
for(const [g,v] of Object.entries(byGame))console.log(g, 'ours', mean(v.ours), 'nearest step', mean(v.nearestStep));
