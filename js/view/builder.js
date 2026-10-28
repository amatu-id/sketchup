// Converts an Entities container into GPU geometry (cached by version).
import * as THREE from 'three';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { basis, triangulate2 } from '../core/geom.js';
import { getTexture } from '../core/materials.js';

const cache = new WeakMap();

export function buildEnts(ents, model, key) {
  const c = cache.get(ents);
  if (c && c.version === ents.version && c.key === key) return c;
  if (c) { c.front.dispose(); c.back.dispose(); c.edges.dispose(); c.soft.dispose(); }
  const b = doBuild(ents, model, key);
  b.version = ents.version; b.key = key;
  cache.set(ents, b);
  return b;
}
export function invalidateAll() { /* WeakMap entries get rebuilt when key changes */ }

function doBuild(ents, model, key) {
  const tags = model.tags;
  const visTag = (t) => { const x = tags.get(t || 0); return !x || x.visible !== false; };
  const showHidden = model.style.hidden;
  // smoothing groups: faces joined by smooth edges
  const par = new Map();
  const find = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
  for (const f of ents.faces.keys()) par.set(f, f);
  for (const e of ents.edges.values()) {
    if (!e.smooth || e.faces.size !== 2) continue;
    const [a, bb] = [...e.faces]; const ra = find(a), rb = find(bb); if (ra !== rb) par.set(ra, rb);
  }
  const vnAcc = new Map(); // `${vid}:${group}` → normal sum
  for (const f of ents.faces.values()) {
    const g = find(f.id);
    for (const l of f.loops) for (const v of l) {
      const k = v + ':' + g; let n = vnAcc.get(k); if (!n) vnAcc.set(k, (n = new THREE.Vector3())); n.add(f.n);
    }
  }
  const pos = [], nor = [], uv = [];
  const frontIdx = new Map(), backIdx = new Map(); // matKey → {idx:[], faces:[]}
  let vcount = 0;
  const push = (map, k, i0, i1, i2, fid) => { let o = map.get(k); if (!o) map.set(k, (o = { idx: [], faces: [] })); o.idx.push(i0, i1, i2); o.faces.push(fid); };
  for (const f of ents.faces.values()) {
    if (!visTag(f.tag) || (f.hidden && !showHidden)) continue;
    const { u, v } = basis(f.n);
    const loops2 = f.loops.map((l) => l.map((id) => { const p = ents.P(id); return [p.dot(u), p.dot(v)]; }));
    const tris = f.loops[0].length === 3 && f.loops.length === 1 ? [[0, 1, 2]] : triangulate2(loops2[0], loops2.slice(1));
    const ids = f.loops.flat();
    const g = find(f.id);
    const m = f.mat != null ? model.materials.get(f.mat) : null;
    const mb = f.back != null ? model.materials.get(f.back) : null;
    const tm = m && m.tex ? m : mb && mb.tex ? mb : null;
    const tw = tm ? tm.tw || 1000 : 1000, th = tm ? tm.th || 1000 : 1000;
    const base = vcount;
    const uo = f.uv ? f.uv : null;
    for (const id of ids) {
      const p = ents.P(id);
      pos.push(p.x, p.y, p.z);
      const n = vnAcc.get(id + ':' + g);
      const nn = n && n.lengthSq() > 1e-9 ? n.clone().normalize() : f.n;
      if (nn.dot(f.n) < 0.5) nor.push(f.n.x, f.n.y, f.n.z); else nor.push(nn.x, nn.y, nn.z);
      let su = p.dot(u), sv = p.dot(v);
      if (uo) { const c = Math.cos(uo.r || 0), s = Math.sin(uo.r || 0); const x = su - (uo.ox || 0), y = sv - (uo.oy || 0); su = (x * c + y * s) / (uo.sx || 1); sv = (-x * s + y * c) / (uo.sy || 1); }
      uv.push(su / tw, sv / th);
      vcount++;
    }
    const fk = f.mat != null ? 'm' + f.mat : 'df';
    const bk = f.back != null ? 'm' + f.back : 'db';
    for (const t of tris) {
      push(frontIdx, fk + (f.hidden ? 'h' : ''), base + t[0], base + t[1], base + t[2], f.id);
      push(backIdx, bk + (f.hidden ? 'h' : ''), base + t[0], base + t[1], base + t[2], f.id);
    }
  }
  const P = new THREE.Float32BufferAttribute(pos, 3), N = new THREE.Float32BufferAttribute(nor, 3), U = new THREE.Float32BufferAttribute(uv, 2);
  const mk = (map) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', P); geo.setAttribute('normal', N); geo.setAttribute('uv', U);
    const all = [], keys = [], triFace = [];
    let start = 0;
    for (const [k, o] of map) { all.push(...o.idx); keys.push(k); geo.addGroup(start, o.idx.length, keys.length - 1); start += o.idx.length; triFace.push(...o.faces); }
    geo.setIndex(all.length > 65535 ? new THREE.Uint32BufferAttribute(all, 1) : new THREE.Uint16BufferAttribute(all, 1));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    return { geo, keys, triFace: Int32Array.from(triFace) };
  };
  const front = mk(frontIdx), back = mk(backIdx);
  // edges
  const ep = [], sp = [], ecol = [], eids = [];
  for (const e of ents.edges.values()) {
    if (!visTag(e.tag)) continue;
    const a = ents.P(e.a), bq = ents.P(e.b);
    const invisible = e.soft || e.hidden;
    if (invisible) { if (showHidden) sp.push(a.x, a.y, a.z, bq.x, bq.y, bq.z); continue; }
    ep.push(a.x, a.y, a.z, bq.x, bq.y, bq.z); eids.push(e.id);
    const d = bq.clone().sub(a).normalize();
    const ax = Math.abs(d.x) > 0.9999 ? [0.85, 0.1, 0.1] : Math.abs(d.y) > 0.9999 ? [0.1, 0.6, 0.1] : Math.abs(d.z) > 0.9999 ? [0.1, 0.2, 0.85] : [0.1, 0.1, 0.1];
    ecol.push(...ax, ...ax);
  }
  const edges = new LineSegmentsGeometry();
  if (ep.length) { edges.setPositions(ep); edges.setColors(ecol); } else edges.setPositions([0, 0, 0, 0, 0, 0.0001]);
  const soft = new LineSegmentsGeometry();
  if (sp.length) soft.setPositions(sp); else soft.setPositions([0, 0, 0, 0, 0, 0.0001]);
  return { front: front.geo, frontKeys: front.keys, frontTri: front.triFace, back: back.geo, backKeys: back.keys, backTri: back.triFace, edges, soft, hasEdges: ep.length > 0, hasSoft: sp.length > 0, edgeIds: eids };
}

// ---------------------------------------------------------------- materials
const matCache = new Map();
export function clearMatCache() { for (const m of matCache.values()) m.dispose(); matCache.clear(); }
export function surfaceMaterial(model, key, opts) {
  // key: 'df' default front, 'db' default back, 'm<ID>' model material, optional 'h' suffix = hidden face
  const st = model.style;
  const hidden = key.endsWith('h'); if (hidden) key = key.slice(0, -1);
  const ck = [key, opts.instMat ?? '', st.faceMode, st.xray ? 1 : 0, opts.fade ? 1 : 0, opts.side, st.front, st.back, opts.matVersion, hidden ? 1 : 0, opts.clipKey || ''].join('|');
  let m = matCache.get(ck);
  if (m) return m;
  let color = '#ffffff', tex = null, opacity = 1;
  const isDefault = key === 'df' || key === 'db';
  let mm = null;
  if (key === 'df') { if (opts.instMat != null) mm = model.materials.get(opts.instMat); color = mm ? mm.color : st.front; }
  else if (key === 'db') { if (opts.instMat != null) mm = model.materials.get(opts.instMat); color = mm ? mm.color : st.back; }
  else { mm = model.materials.get(+key.slice(1)); color = mm ? mm.color : '#ff00ff'; }
  if (mm) { opacity = mm.opacity ?? 1; if (st.faceMode === 'textured') tex = getTexture(mm); }
  if (st.faceMode === 'mono') { color = opts.side === THREE.BackSide ? st.back : st.front; tex = null; opacity = 1; }
  void isDefault;
  if (st.faceMode === 'hidden') {
    m = new THREE.MeshBasicMaterial({ color: st.bg, side: opts.side, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  } else {
    m = new THREE.MeshLambertMaterial({ color: new THREE.Color(color), map: tex, side: opts.side, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    if (tex) m.color.set('#ffffff');
  }
  if (st.xray) { opacity = Math.min(opacity, 0.5); }
  if (opts.fade) opacity = Math.min(opacity, 1 - st.fadeAmount * 0.8);
  if (hidden) opacity = Math.min(opacity, 0.35);
  if (opacity < 1) { m.transparent = true; m.opacity = opacity; m.depthWrite = !st.xray && opacity > 0.6; }
  m.clippingPlanes = opts.clip || null;
  m.clipShadows = true;
  matCache.set(ck, m);
  return m;
}
