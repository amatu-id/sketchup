// Higher-level modelling operations built on the edge/face engine.
import * as THREE from 'three';
import { V3, TOL, basis, area2, inRegion, pointInPoly, newell } from './geom.js';
import {
  Entities, nid, addVertex, addEdgeRaw, addFace, removeFace, deleteEdgeRaw, getEdge, drawSegments, cleanupVerts,
  moveVerts, fixNonPlanar, reverseFace, updatePlane, faceEdges, facePoly2, removeCollinear, healAround, weldCoincident, entsToJSON, entsFromJSON,
} from './model.js';

// ---------------------------------------------------------------- selection helpers
// sel: Set of keys like 'f12', 'e5', 'i3', 'g2' (guide), 'd4' (dim), 't1' (text), 's9' (section)
export function splitSel(sel) {
  const o = { faces: [], edges: [], insts: [], guides: [], dims: [], texts: [], sections: [] };
  for (const k of sel) {
    const id = +k.slice(1);
    ({ f: o.faces, e: o.edges, i: o.insts, g: o.guides, d: o.dims, t: o.texts, s: o.sections })[k[0]]?.push(id);
  }
  return o;
}
export function selVerts(ents, sel) {
  const s = splitSel(sel), vs = new Set();
  for (const id of s.faces) { const f = ents.faces.get(id); if (f) for (const l of f.loops) for (const v of l) vs.add(v); }
  for (const id of s.edges) { const e = ents.edges.get(id); if (e) { vs.add(e.a); vs.add(e.b); } }
  return vs;
}
// SketchUp: selecting a face also implies its bounding edges for move/rotate operations
export function expandFaceEdges(ents, sel) {
  const out = new Set(sel);
  for (const k of sel) if (k[0] === 'f') { const f = ents.faces.get(+k.slice(1)); if (f) for (const e of faceEdges(ents, f)) out.add('e' + e.id); }
  return out;
}
export function connected(ents, startKeys) {
  const out = new Set(), stack = [...startKeys];
  while (stack.length) {
    const k = stack.pop(); if (out.has(k)) continue; out.add(k);
    const id = +k.slice(1);
    if (k[0] === 'e') {
      const e = ents.edges.get(id); if (!e) continue;
      for (const f of e.faces) stack.push('f' + f);
      for (const v of [e.a, e.b]) for (const o of ents.vedges.get(v) || []) stack.push('e' + o);
    } else if (k[0] === 'f') {
      const f = ents.faces.get(id); if (!f) continue;
      for (const e of faceEdges(ents, f)) stack.push('e' + e.id);
    }
  }
  return out;
}

// ---------------------------------------------------------------- bounds
export function entsBox(model, ents, m = new THREE.Matrix4(), box = new THREE.Box3(), opts = {}) {
  const p = new V3();
  for (const v of ents.verts.values()) box.expandByPoint(p.copy(v.p).applyMatrix4(m));
  for (const inst of ents.insts.values()) {
    if (opts.visibleOnly && inst.hidden) continue;
    const d = model.defs.get(inst.def); if (!d) continue;
    entsBox(model, d.ents, m.clone().multiply(inst.m), box, opts);
  }
  return box;
}
export function selectionBox(model, ents, sel, m = new THREE.Matrix4()) {
  const box = new THREE.Box3(), p = new V3();
  for (const v of selVerts(ents, sel)) box.expandByPoint(p.copy(ents.P(v)).applyMatrix4(m));
  const s = splitSel(sel);
  for (const id of s.insts) { const i = ents.insts.get(id); const d = i && model.defs.get(i.def); if (d) entsBox(model, d.ents, m.clone().multiply(i.m), box); }
  for (const id of s.guides) { const g = ents.guides.get(id); if (g) box.expandByPoint(p.copy(g.p).applyMatrix4(m)); }
  for (const id of s.texts) { const t = ents.texts.get(id); if (t) box.expandByPoint(p.copy(t.at || t.p).applyMatrix4(m)); }
  for (const id of s.dims) { const d = ents.dims.get(id); if (d) { box.expandByPoint(p.copy(d.a).applyMatrix4(m)); box.expandByPoint(p.copy(d.b).applyMatrix4(m)); } }
  return box;
}

// ---------------------------------------------------------------- copy / transform
export function cloneDef(model, defId) {
  const d = model.defs.get(defId);
  const nd = { ...d, id: nid(), ents: entsFromJSON(entsToJSON(d.ents)) };
  remapIds(nd.ents);
  // nested groups must be unique too
  for (const inst of nd.ents.insts.values()) { const c = model.defs.get(inst.def); if (c && c.group) inst.def = cloneDef(model, c.id); }
  model.defs.set(nd.id, nd);
  return nd.id;
}
// give every element in ents fresh ids (needed after JSON round-trip clones)
export function remapIds(ents) {
  const src = entsToJSON(ents), vm = new Map(), em = new Map(), cm = new Map();
  const nn = new Entities();
  for (const c of ents.curves.values()) { const id = nid(); cm.set(c.id, id); nn.curves.set(id, { ...c, id }); }
  for (const v of ents.verts.values()) { const id = nid(); vm.set(v.id, id); nn.verts.set(id, { id, p: v.p.clone() }); nn.vedges.set(id, new Set()); }
  for (const e of ents.edges.values()) { const ne = addEdgeRaw(nn, vm.get(e.a), vm.get(e.b), { soft: e.soft, smooth: e.smooth, hidden: e.hidden, tag: e.tag, curve: e.curve != null ? cm.get(e.curve) ?? null : null, mat: e.mat }); em.set(e.id, ne.id); }
  for (const f of ents.faces.values()) addFace(nn, f.loops.map((l) => l.map((v) => vm.get(v))), { mat: f.mat, back: f.back, tag: f.tag, hidden: f.hidden, uv: f.uv });
  for (const i of ents.insts.values()) { const id = nid(); nn.insts.set(id, { ...i, id, m: i.m.clone() }); }
  for (const [k, map] of [['guides'], ['dims'], ['texts'], ['sections']].map((x) => [x[0], ents[x[0]]])) for (const g of map.values()) { const id = nid(); nn[k].set(id, { ...structuredCloneV(g), id }); }
  for (const k of Object.keys(nn)) ents[k] = nn[k];
  ents.touch();
  void src;
}
function structuredCloneV(o) {
  const r = {};
  for (const [k, v] of Object.entries(o)) r[k] = v && v.isVector3 ? v.clone() : v;
  return r;
}

// Copy selected entities from src into dst, transformed by matrix. Returns Set of new selection keys.
export function copyInto(model, src, sel, dst, matrix = new THREE.Matrix4(), opts = {}) {
  const s = splitSel(sel), out = new Set(), vm = new Map(), cm = new Map();
  const mirror = matrix.determinant() < 0;
  const mv = (vid) => {
    if (!vm.has(vid)) vm.set(vid, addVertex(dst, src.P(vid).clone().applyMatrix4(matrix), opts.merge !== false));
    return vm.get(vid);
  };
  const curve = (cid) => {
    if (cid == null) return null;
    if (!cm.has(cid)) {
      const c = src.curves.get(cid); if (!c) return null;
      const id = nid(), nm = new THREE.Matrix3().getNormalMatrix(matrix);
      dst.curves.set(id, { ...c, id, center: c.center.clone().applyMatrix4(matrix), normal: c.normal.clone().applyMatrix3(nm).normalize(), radius: c.radius * matrix.getMaxScaleOnAxis(), xa: c.xa ? c.xa.clone().transformDirection(matrix) : null });
      cm.set(cid, id);
    }
    return cm.get(cid);
  };
  const edgeIds = new Set(s.edges);
  for (const fid of s.faces) { const f = src.faces.get(fid); if (f) for (const e of faceEdges(src, f)) edgeIds.add(e.id); }
  for (const eid of edgeIds) {
    const e = src.edges.get(eid); if (!e) continue;
    const ne = addEdgeRaw(dst, mv(e.a), mv(e.b), { soft: e.soft, smooth: e.smooth, hidden: e.hidden, tag: e.tag, curve: curve(e.curve), mat: e.mat });
    if (ne && s.edges.includes(eid)) out.add('e' + ne.id);
  }
  for (const fid of s.faces) {
    const f = src.faces.get(fid); if (!f) continue;
    let loops = f.loops.map((l) => l.map(mv));
    if (mirror) loops = loops.map((l) => l.slice().reverse());
    const nf = addFace(dst, loops, { mat: f.mat, back: f.back, tag: f.tag, hidden: f.hidden, uv: f.uv });
    if (nf) out.add('f' + nf.id);
  }
  for (const id of s.insts) {
    const i = src.insts.get(id); if (!i) continue;
    const def = model.defs.get(i.def);
    const ni = { ...i, id: nid(), m: matrix.clone().multiply(i.m), def: def && def.group && opts.uniqueGroups !== false ? cloneDef(model, i.def) : i.def };
    dst.insts.set(ni.id, ni); out.add('i' + ni.id);
  }
  const nm = new THREE.Matrix3().getNormalMatrix(matrix);
  for (const id of s.guides) { const g = src.guides.get(id); if (!g) continue; const ng = { ...g, id: nid(), p: g.p.clone().applyMatrix4(matrix), dir: g.dir ? g.dir.clone().transformDirection(matrix) : null }; dst.guides.set(ng.id, ng); out.add('g' + ng.id); }
  for (const id of s.dims) { const d = src.dims.get(id); if (!d) continue; const nd = { ...d, id: nid(), a: d.a.clone().applyMatrix4(matrix), b: d.b.clone().applyMatrix4(matrix), off: d.off.clone().transformDirection(matrix).multiplyScalar(d.off.length() * matrix.getMaxScaleOnAxis()) }; dst.dims.set(nd.id, nd); out.add('d' + nd.id); }
  for (const id of s.texts) { const t = src.texts.get(id); if (!t) continue; const nt = { ...t, id: nid(), p: t.p.clone().applyMatrix4(matrix), at: t.at ? t.at.clone().applyMatrix4(matrix) : null }; dst.texts.set(nt.id, nt); out.add('t' + nt.id); }
  for (const id of s.sections) { const c = src.sections.get(id); if (!c) continue; const ns = { ...c, id: nid(), p: c.p.clone().applyMatrix4(matrix), n: c.n.clone().applyMatrix3(nm).normalize() }; dst.sections.set(ns.id, ns); out.add('s' + ns.id); }
  dst.touch();
  return out;
}

export function deleteSelection(model, ents, sel) {
  const s = splitSel(sel);
  for (const id of s.faces) removeFace(ents, id);
  for (const id of s.edges) {
    const e = ents.edges.get(id); if (!e) continue;
    for (const fid of [...e.faces]) removeFace(ents, fid);
    deleteEdgeRaw(ents, e);
  }
  for (const id of s.insts) ents.insts.delete(id);
  for (const id of s.guides) ents.guides.delete(id);
  for (const id of s.dims) ents.dims.delete(id);
  for (const id of s.texts) ents.texts.delete(id);
  for (const id of s.sections) ents.sections.delete(id);
  cleanupVerts(ents);
  purgeDefs(model);
  ents.touch();
}
// remove group definitions no longer referenced
export function purgeDefs(model, all = false) {
  const used = new Set();
  const walk = (ents) => { for (const i of ents.insts.values()) if (!used.has(i.def)) { used.add(i.def); const d = model.defs.get(i.def); if (d) walk(d.ents); } };
  walk(model.root);
  for (const [id, d] of model.defs) if (!used.has(id) && (d.group || all)) model.defs.delete(id);
}

export function transformSelection(model, ents, sel, matrix) {
  const s = splitSel(sel);
  const vids = selVerts(ents, sel);
  const fs = moveVerts(ents, vids, (p) => p.applyMatrix4(matrix));
  if (matrix.determinant() < 0) {
    for (const fid of s.faces) { const f = ents.faces.get(fid); if (f) { const m = f.mat; reverseFace(ents, f); f.back = f.mat; f.mat = m; } }
  }
  fixNonPlanar(ents, fs);
  for (const id of s.insts) { const i = ents.insts.get(id); if (i) i.m.premultiply(matrix); }
  const nm = new THREE.Matrix3().getNormalMatrix(matrix);
  for (const id of s.guides) { const g = ents.guides.get(id); if (g) { g.p.applyMatrix4(matrix); if (g.dir) g.dir.transformDirection(matrix); } }
  for (const id of s.dims) { const d = ents.dims.get(id); if (d) { d.a.applyMatrix4(matrix); d.b.applyMatrix4(matrix); d.off.transformDirection(matrix).multiplyScalar(d.off.length()); } }
  for (const id of s.texts) { const t = ents.texts.get(id); if (t) { t.p.applyMatrix4(matrix); if (t.at) t.at.applyMatrix4(matrix); } }
  for (const id of s.sections) { const c = ents.sections.get(id); if (c) { c.p.applyMatrix4(matrix); c.n.applyMatrix3(nm).normalize(); } }
  for (const c of ents.curves.values()) void c;
  ents.touch();
}

// After moving raw geometry: merge coincident vertices and heal.
export function settleGeometry(ents, vids) {
  const w = weldCoincident(ents, [...vids].filter((v) => ents.verts.has(v)));
  if (w.length) removeCollinear(ents, w.filter((v) => ents.verts.has(v)));
  cleanupVerts(ents);
}

// ---------------------------------------------------------------- groups & components
export function makeGroup(model, ents, sel, opts = {}) {
  const box = selectionBox(model, ents, sel);
  const origin = opts.origin || (box.isEmpty() ? new V3() : box.min.clone());
  const def = { id: nid(), name: opts.name || (opts.component ? 'Component#' + (countComponents(model) + 1) : 'Group'), desc: opts.desc || '', group: !opts.component, faceCam: !!opts.faceCam, ents: new Entities() };
  model.defs.set(def.id, def);
  const toLocal = new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z);
  copyInto(model, ents, sel, def.ents, toLocal, { uniqueGroups: false, merge: true });
  // remove originals
  const s = splitSel(sel);
  for (const id of s.faces) removeFace(ents, id);
  for (const id of s.edges) { const e = ents.edges.get(id); if (e && !e.faces.size) deleteEdgeRaw(ents, e); }
  for (const fid of s.faces) void fid;
  // edges that bounded selected faces and are now free
  for (const e of [...ents.edges.values()]) if (!e.faces.size && def.ents.edges.size && isEdgeCopied(ents, e, def.ents, toLocal)) deleteEdgeRaw(ents, e);
  for (const id of s.insts) ents.insts.delete(id);
  for (const id of s.guides) ents.guides.delete(id);
  for (const id of s.dims) ents.dims.delete(id);
  for (const id of s.texts) ents.texts.delete(id);
  cleanupVerts(ents);
  const inst = { id: nid(), def: def.id, m: new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z), name: '', tag: 0, hidden: false, locked: false, mat: null };
  ents.insts.set(inst.id, inst);
  ents.touch();
  return inst;
}
function isEdgeCopied(ents, e, dst, m) {
  const a = ents.P(e.a).clone().applyMatrix4(m), b = ents.P(e.b).clone().applyMatrix4(m);
  for (const de of dst.edges.values()) {
    const A = dst.P(de.a), B = dst.P(de.b);
    if ((A.distanceTo(a) < TOL && B.distanceTo(b) < TOL) || (A.distanceTo(b) < TOL && B.distanceTo(a) < TOL)) return true;
  }
  return false;
}
const countComponents = (model) => [...model.defs.values()].filter((d) => !d.group).length;

export function explodeInstance(model, ents, instId) {
  const inst = ents.insts.get(instId); if (!inst) return new Set();
  const def = model.defs.get(inst.def); if (!def) return new Set();
  const all = new Set();
  for (const f of def.ents.faces.keys()) all.add('f' + f);
  for (const e of def.ents.edges.keys()) all.add('e' + e);
  for (const i of def.ents.insts.keys()) all.add('i' + i);
  for (const g of def.ents.guides.keys()) all.add('g' + g);
  for (const d of def.ents.dims.keys()) all.add('d' + d);
  for (const t of def.ents.texts.keys()) all.add('t' + t);
  const out = copyInto(model, def.ents, all, ents, inst.m, { uniqueGroups: true });
  if (inst.mat) for (const k of out) if (k[0] === 'f') { const f = ents.faces.get(+k.slice(1)); if (f && f.mat == null) f.mat = inst.mat; }
  ents.insts.delete(instId);
  purgeDefs(model);
  ents.touch();
  return out;
}

// ---------------------------------------------------------------- offset
export function offsetLoop2(poly, dist) {
  // poly CCW; positive dist = outward
  const n = poly.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i - 1 + n) % n], p1 = poly[i], p2 = poly[(i + 1) % n];
    const e1 = norm2([p1[0] - p0[0], p1[1] - p0[1]]), e2 = norm2([p2[0] - p1[0], p2[1] - p1[1]]);
    const n1 = [e1[1], -e1[0]], n2 = [e2[1], -e2[0]];
    const dot = n1[0] * n2[0] + n1[1] * n2[1];
    const k = dist / Math.max(0.2, 1 + dot);
    out.push([p1[0] + (n1[0] + n2[0]) * k, p1[1] + (n1[1] + n2[1]) * k]);
  }
  return out;
}
const norm2 = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
export function offsetFacePoints(ents, f, dist) {
  const { u, v, outer } = facePoly2(ents, f);
  const o2 = offsetLoop2(outer, dist);
  const n = f.n, d = f.d;
  return o2.map((q) => u.clone().multiplyScalar(q[0]).addScaledVector(v, q[1]).addScaledVector(n, d));
}
export function offsetEdgesPoints(ents, eids, dist, normal) {
  // open chain offset in the plane given by normal
  const chain = chainEdges(ents, eids); if (!chain) return null;
  const { pts, closed } = chain;
  const { u, v } = basis(normal);
  const d = normal.dot(pts[0]);
  const p2 = pts.map((p) => [p.dot(u), p.dot(v)]);
  if (closed && area2(p2) < 0) dist = -dist;
  let o2;
  if (closed) o2 = offsetLoop2(p2, dist);
  else {
    o2 = [];
    for (let i = 0; i < p2.length; i++) {
      const a = p2[Math.max(0, i - 1)], b = p2[i], c = p2[Math.min(p2.length - 1, i + 1)];
      const e1 = i > 0 ? norm2([b[0] - a[0], b[1] - a[1]]) : null, e2 = i < p2.length - 1 ? norm2([c[0] - b[0], c[1] - b[1]]) : null;
      const n1 = e1 ? [e1[1], -e1[0]] : null, n2 = e2 ? [e2[1], -e2[0]] : null;
      if (n1 && n2) { const k = dist / Math.max(0.2, 1 + n1[0] * n2[0] + n1[1] * n2[1]); o2.push([b[0] + (n1[0] + n2[0]) * k, b[1] + (n1[1] + n2[1]) * k]); }
      else { const nn = n1 || n2; o2.push([b[0] + nn[0] * dist, b[1] + nn[1] * dist]); }
    }
  }
  return { pts: o2.map((q) => u.clone().multiplyScalar(q[0]).addScaledVector(v, q[1]).addScaledVector(normal, d)), closed };
}
export function chainEdges(ents, eids) {
  const es = eids.map((id) => ents.edges.get(id)).filter(Boolean); if (!es.length) return null;
  const adj = new Map();
  for (const e of es) { for (const [x, y] of [[e.a, e.b], [e.b, e.a]]) { if (!adj.has(x)) adj.set(x, []); adj.get(x).push(y); } }
  let start = es[0].a;
  for (const [vtx, l] of adj) if (l.length === 1) { start = vtx; break; }
  const order = [start], used = new Set();
  let cur = start, prev = null;
  while (true) {
    const nx = (adj.get(cur) || []).find((x) => x !== prev && !used.has(cur + '_' + x) && !used.has(x + '_' + cur));
    if (nx == null) break;
    used.add(cur + '_' + nx); prev = cur; cur = nx;
    if (cur === start) break;
    order.push(cur);
  }
  const closed = cur === start && order.length > 2;
  return { vids: order, pts: order.map((id) => ents.P(id).clone()), closed };
}

// ---------------------------------------------------------------- follow me
export function followMe(ents, face, path, closed, opts = {}) {
  if (path.length < 2) return [];
  const prof = face.loops.map((l) => l.map((id) => ents.P(id).clone()));
  const props = { mat: face.mat, back: face.back, tag: face.tag };
  const P = path.map((p) => p.clone());
  const m = P.length;
  const segDir = (i) => P[(i + 1) % m].clone().sub(P[i]).normalize();
  const nseg = closed ? m : m - 1;
  const miter = (i) => {
    if (!closed && i === 0) return segDir(0);
    if (!closed && i === m - 1) return segDir(m - 2);
    const din = segDir((i - 1 + m) % m), dout = segDir(i % m);
    const b = din.clone().add(dout);
    return b.lengthSq() < 1e-9 ? dout : b.normalize();
  };
  // project profile onto start plane along first direction
  const d0 = segDir(0), m0 = miter(0);
  let ring = prof.map((l) => l.map((p) => projectAlong(p, d0, P[0], m0)));
  const rings = [ring];
  for (let i = 0; i < nseg; i++) {
    const dir = segDir(i), j = (i + 1) % m;
    const mj = miter(j);
    ring = ring.map((l) => l.map((p) => projectAlong(p, dir, P[j], mj)));
    rings.push(ring);
  }
  const flip = face.n.dot(d0) < 0; // profile normal opposite to sweep
  const vid = (p) => addVertex(ents, p);
  const made = [];
  const smoothJoint = (i) => {
    if (opts.smoothAngle == null) return false;
    const a = segDir((i - 1 + m) % m), b = segDir(i % m);
    return a.angleTo(b) < opts.smoothAngle;
  };
  for (let r = 0; r + 1 < rings.length; r++) {
    const A = rings[r], B = rings[r + 1];
    for (let li = 0; li < A.length; li++) {
      const la = A[li], lb = B[li], n = la.length;
      for (let k = 0; k < n; k++) {
        const a = vid(la[k]), b = vid(la[(k + 1) % n]), c = vid(lb[(k + 1) % n]), d = vid(lb[k]);
        let quad = [a, b, c, d];
        if (flip) quad = quad.reverse();
        const f = addFace(ents, [quad.filter((x, i) => x !== quad[(i + 1) % 4])], props);
        if (f) made.push(f);
        const ep = getEdge(ents, a, d); if (ep) { const prevCurve = profileEdgeCurve(ents, face, li, k); if (prevCurve) { ep.soft = ep.smooth = true; } }
      }
      if (r > 0 && smoothJoint(r)) for (let k = 0; k < n; k++) { const e = getEdge(ents, vid(la[k]), vid(la[(k + 1) % n])); if (e) { e.soft = e.smooth = true; } }
    }
  }
  if (closed) {
    removeFace(ents, face);
  } else {
    // cap ends: start cap keeps the original face (oriented outward), end cap is new
    removeFace(ents, face);
    const s = rings[0].map((l) => l.map(vid)), e = rings[rings.length - 1].map((l) => l.map(vid));
    made.push(addFace(ents, flip ? s : s.map((l) => l.slice().reverse()), props));
    made.push(addFace(ents, flip ? e.map((l) => l.slice().reverse()) : e, props));
  }
  cleanupVerts(ents);
  ents.touch();
  return made.filter(Boolean);
}
function profileEdgeCurve(ents, face, li, k) {
  const l = face.loops[li], n = l.length;
  const e1 = getEdge(ents, l[(k - 1 + n) % n], l[k]), e2 = getEdge(ents, l[k], l[(k + 1) % n]);
  return e1 && e2 && e1.curve != null && e1.curve === e2.curve;
}
function projectAlong(p, dir, q, m) {
  const den = dir.dot(m);
  if (Math.abs(den) < 1e-9) return p.clone();
  const t = q.clone().sub(p).dot(m) / den;
  return p.clone().addScaledVector(dir, t);
}

// ---------------------------------------------------------------- intersect faces
// cutters: array of {pts:[loops of V3], n, d} in ents coordinates
export function facesAsCutters(model, ents, faceIds, m = null) {
  const out = [];
  for (const id of faceIds) {
    const f = ents.faces.get(id); if (!f) continue;
    const loops = f.loops.map((l) => l.map((v) => (m ? ents.P(v).clone().applyMatrix4(m) : ents.P(v).clone())));
    const n = newell(loops[0]).normalize();
    out.push({ loops, n, d: n.dot(loops[0][0]), id });
  }
  return out;
}
export function instanceCutters(model, ents, m = new THREE.Matrix4(), out = []) {
  for (const inst of ents.insts.values()) {
    const def = model.defs.get(inst.def); if (!def) continue;
    const mm = m.clone().multiply(inst.m);
    out.push(...facesAsCutters(model, def.ents, [...def.ents.faces.keys()], mm));
    instanceCutters(model, def.ents, mm, out);
  }
  return out;
}
function intervalsOnLine(poly, n, o, dir, otherN, otherD) {
  // crossings of polygon (with holes) with the plane (otherN, otherD) → params along dir
  const ts = [];
  for (const loop of poly) for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    let da = otherN.dot(a) - otherD, db = otherN.dot(b) - otherD;
    if (Math.abs(da) < 1e-7) da = 1e-7; if (Math.abs(db) < 1e-7) db = 1e-7;
    if ((da > 0) === (db > 0)) continue;
    const t = da / (da - db);
    const x = a.clone().lerp(b, t);
    ts.push(x.clone().sub(o).dot(dir));
  }
  ts.sort((x, y) => x - y);
  const iv = [];
  for (let i = 0; i + 1 < ts.length; i += 2) iv.push([ts[i], ts[i + 1]]);
  return iv;
}
export function intersectFaces(ents, targets, cutters) {
  const segs = [];
  for (const A of targets) for (const B of cutters) {
    if (A.id != null && A.id === B.id) continue;
    const dir = A.n.clone().cross(B.n);
    if (dir.lengthSq() < 1e-10) continue;
    dir.normalize();
    const n1 = A.n, n2 = B.n, dd = n1.clone().cross(n2);
    const o2 = n2.clone().multiplyScalar(A.d).sub(n1.clone().multiplyScalar(B.d)).cross(dd).divideScalar(dd.lengthSq());
    const ia = intervalsOnLine(A.loops, A.n, o2, dir, B.n, B.d);
    const ib = intervalsOnLine(B.loops, B.n, o2, dir, A.n, A.d);
    for (const [a0, a1] of ia) for (const [b0, b1] of ib) {
      const s0 = Math.max(a0, b0), s1 = Math.min(a1, b1);
      if (s1 - s0 > TOL) segs.push([o2.clone().addScaledVector(dir, s0), o2.clone().addScaledVector(dir, s1)]);
    }
  }
  if (!segs.length) return 0;
  drawSegments(ents, segs);
  return segs.length;
}

// ---------------------------------------------------------------- triangles → faces (import, CSG)
export function trianglesToFaces(ents, pos, opts = {}) {
  // pos: flat array of xyz, 9 per triangle; opts.mats: per-triangle material ids
  const m = opts.matrix;
  const ids = [];
  const p = new V3();
  const tol = opts.weld ?? 0.01;
  const key = new Map();
  const vtx = (x, y, z) => {
    p.set(x, y, z); if (m) p.applyMatrix4(m);
    const k = Math.round(p.x / tol) + ',' + Math.round(p.y / tol) + ',' + Math.round(p.z / tol);
    let id = key.get(k);
    if (id == null) { id = addVertex(ents, p, false); key.set(k, id); }
    return id;
  };
  const tris = [];
  for (let i = 0; i + 8 < pos.length; i += 9) {
    const a = vtx(pos[i], pos[i + 1], pos[i + 2]), b = vtx(pos[i + 3], pos[i + 4], pos[i + 5]), c = vtx(pos[i + 6], pos[i + 7], pos[i + 8]);
    if (a === b || b === c || a === c) continue;
    const A = ents.P(a), B = ents.P(b), C = ents.P(c);
    const n = B.clone().sub(A).cross(C.clone().sub(A));
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    tris.push({ v: [a, b, c], n, d: n.dot(A), mat: opts.mats ? opts.mats[i / 9] : opts.mat ?? null });
  }
  // adjacency
  const emap = new Map();
  tris.forEach((t, ti) => { for (let k = 0; k < 3; k++) { const a = t.v[k], b = t.v[(k + 1) % 3]; const kk = a < b ? a + '_' + b : b + '_' + a; if (!emap.has(kk)) emap.set(kk, []); emap.get(kk).push(ti); } });
  const par = tris.map((_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (const l of emap.values()) {
    if (l.length !== 2) continue;
    const [i, j] = l, ti = tris[i], tj = tris[j];
    if (ti.n.dot(tj.n) > 1 - 1e-5 && Math.abs(ti.d - tj.d) < tol * 10 && ti.mat === tj.mat) { const a = find(i), b = find(j); if (a !== b) par[a] = b; }
  }
  const clusters = new Map();
  tris.forEach((t, i) => { const r = find(i); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(t); });
  let made = 0;
  for (const cl of clusters.values()) {
    const cnt = new Map();
    for (const t of cl) for (let k = 0; k < 3; k++) { const a = t.v[k], b = t.v[(k + 1) % 3]; const kk = a < b ? a + '_' + b : b + '_' + a; cnt.set(kk, (cnt.get(kk) || 0) + 1); }
    const next = new Map();
    for (const t of cl) for (let k = 0; k < 3; k++) {
      const a = t.v[k], b = t.v[(k + 1) % 3]; const kk = a < b ? a + '_' + b : b + '_' + a;
      if (cnt.get(kk) === 1) { if (!next.has(a)) next.set(a, []); next.get(a).push(b); }
    }
    const loops = [];
    const usedE = new Set();
    for (const [s0, l] of next) for (const b0 of l) {
      if (usedE.has(s0 + '>' + b0)) continue;
      const loop = [s0]; let a = s0, b = b0, g = 0;
      while (g++ < 100000) {
        usedE.add(a + '>' + b);
        if (b === s0) break;
        loop.push(b);
        const cand = (next.get(b) || []).filter((x) => !usedE.has(b + '>' + x));
        if (!cand.length) break;
        a = b; b = cand[0];
      }
      if (loop.length >= 3) loops.push(loop);
    }
    if (!loops.length) continue;
    const n = cl[0].n;
    const { u, v } = basis(n);
    const c2 = (id) => { const q = ents.P(id); return [q.dot(u), q.dot(v)]; };
    const outers = [], holes = [];
    for (const l of loops) (area2(l.map(c2)) > 0 ? outers : holes).push(l);
    if (!outers.length) continue;
    const groups = outers.map((o) => [o]);
    for (const h of holes) {
      const q = c2(h[0]);
      let best = 0, ba = Infinity;
      outers.forEach((o, i) => { const pp = o.map(c2); const a = area2(pp); if (pointInPoly(q, pp) && a < ba) { ba = a; best = i; } });
      groups[best].push(h);
    }
    for (const g of groups) { if (addFace(ents, g, { mat: cl[0].mat })) made++; }
  }
  // soften edges between nearly-coplanar faces (curved surfaces)
  const sa = Math.cos(((opts.smoothDeg ?? 20) * Math.PI) / 180);
  for (const e of ents.edges.values()) {
    if (e.faces.size !== 2) continue;
    const [f, g] = [...e.faces].map((x) => ents.faces.get(x));
    if (f && g && f.n.dot(g.n) > sa) { e.soft = true; e.smooth = true; }
  }
  if (opts.collinear !== false) removeCollinear(ents, [...ents.verts.keys()]);
  ents.touch();
  return made;
}

// ---------------------------------------------------------------- primitive builders (library)
export function addPolyFace(ents, pts, props) {
  return addFace(ents, [pts.map((p) => addVertex(ents, p))], props);
}
export function boxGeom(ents, x0, y0, z0, x1, y1, z1, props) {
  const P = (x, y, z) => new V3(x, y, z);
  const q = [
    [P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0)], // bottom (−z)
    [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], // top
    [P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)], // front −y
    [P(x1, y1, z0), P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1)], // back +y
    [P(x0, y1, z0), P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1)], // left −x
    [P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], // right +x
  ];
  return q.map((l) => addPolyFace(ents, l, props));
}
export function prismGeom(ents, pts2, z0, z1, props, opts = {}) {
  // pts2 CCW in XY
  const n = pts2.length;
  const bot = pts2.map((p) => addVertex(ents, new V3(p[0], p[1], z0)));
  const top = pts2.map((p) => addVertex(ents, new V3(p[0], p[1], z1)));
  const cid = opts.curve ? nid() : null;
  if (cid) ents.curves.set(cid, { id: cid, center: new V3(opts.cx || 0, opts.cy || 0, z0), normal: new V3(0, 0, 1), radius: opts.r || 0, segs: n, arc: false });
  addFace(ents, [bot.slice().reverse()], props);
  addFace(ents, [top], props);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    addFace(ents, [[bot[i], bot[j], top[j], top[i]]], props);
    if (opts.curve) {
      const e = getEdge(ents, bot[i], top[i]); if (e) { e.soft = e.smooth = true; }
      getEdge(ents, bot[i], bot[j]).curve = cid; getEdge(ents, top[i], top[j]).curve = cid;
    }
  }
}
export function cylGeom(ents, cx, cy, z0, z1, r, segs = 24, props) {
  const pts = [];
  for (let i = 0; i < segs; i++) { const a = (i / segs) * Math.PI * 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  prismGeom(ents, pts, z0, z1, props, { curve: true, cx, cy, r });
}
export function transformEnts(ents, matrix) {
  for (const v of ents.verts.values()) v.p.applyMatrix4(matrix);
  for (const f of ents.faces.values()) updatePlane(ents, f);
  ents.touch();
}
export { faceEdges, updatePlane };
