// Model data structure + the edge/face engine (auto face creation, splitting, healing).
import * as THREE from 'three';
import { V3, TOL, ATOL, basis, newell, area2, pointInPoly, inRegion, interiorPoint, segSeg, canonNormal, round } from './geom.js';

let NID = 1;
export const nid = () => NID++;
export const bumpNid = (n) => { if (n >= NID) NID = n + 1; };

export class Entities {
  constructor() {
    this.verts = new Map(); this.edges = new Map(); this.faces = new Map();
    this.insts = new Map(); this.guides = new Map(); this.dims = new Map(); this.texts = new Map();
    this.sections = new Map(); this.curves = new Map();
    this.ekey = new Map(); this.vedges = new Map(); this._vh = null; this.version = 1;
  }
  P(id) { return this.verts.get(id).p; }
  touch() { this._vh = null; this.version++; }
  isEmpty() { return !this.verts.size && !this.insts.size && !this.guides.size && !this.dims.size && !this.texts.size && !this.sections.size; }
}

export class Model {
  constructor() {
    this.root = new Entities();
    this.defs = new Map();
    this.materials = new Map();
    this.tags = new Map([[0, { id: 0, name: 'Untagged', visible: true, color: '#9aa0a6' }]]);
    this.scenes = [];
    this.info = { name: 'Untitled', author: '', client: '', location: '', desc: '' };
    this.units = { unit: 'mm', precision: 0, snap: 1, angleSnap: 15 };
    this.geo = { lat: -6.2, lon: 106.82, tz: 7, north: 0 };
    this.style = defaultStyle();
    this.shadow = { on: false, month: 6, day: 21, hour: 13.5, light: 80, dark: 45, onGround: true, onFaces: true };
    this.fog = { on: false, start: 0.3, end: 1, color: '#d6dde5', useBg: true };
    this.dimStyle = { textSize: 12, arrow: 'slash', unitsShow: false };
  }
}

export function defaultStyle() {
  return {
    name: 'Default Style', faceMode: 'textured', xray: false, backEdges: false,
    edges: true, profiles: false, profileW: 2.5, depthCue: false, extension: false, endpoints: false,
    edgeColor: 'all', edgeRGB: '#1a1a1a', front: '#ffffff', back: '#a8b4c4',
    bg: '#ffffff', sky: true, skyRGB: '#c7dcef', ground: false, groundRGB: '#cfc6b8', groundOpacity: 0.5,
    axes: true, guides: true, hidden: false, sectionPlanes: true, sectionCuts: true, sectionFill: true, sectionFillRGB: '#2b2b2b',
    fadeOthers: true, fadeAmount: 0.5,
  };
}

// ---------------------------------------------------------------- vertices
const CK = (x, y, z) => x + ',' + y + ',' + z;
function hput(h, v) {
  const k = CK(Math.floor(v.p.x), Math.floor(v.p.y), Math.floor(v.p.z));
  let s = h.get(k); if (!s) h.set(k, (s = [])); s.push(v.id);
}
function vhash(ents) {
  if (!ents._vh) { const h = new Map(); for (const v of ents.verts.values()) hput(h, v); ents._vh = h; }
  return ents._vh;
}
export function findVertex(ents, p, tol = TOL) {
  const h = vhash(ents), cx = Math.floor(p.x), cy = Math.floor(p.y), cz = Math.floor(p.z), t2 = tol * tol;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
    const l = h.get(CK(cx + i, cy + j, cz + k)); if (!l) continue;
    for (const id of l) { const v = ents.verts.get(id); if (v && v.p.distanceToSquared(p) <= t2) return id; }
  }
  return null;
}
export function addVertex(ents, p, merge = true) {
  if (merge) { const f = findVertex(ents, p); if (f != null) return f; }
  const id = nid(); const v = { id, p: new V3(p.x, p.y, p.z) };
  ents.verts.set(id, v); ents.vedges.set(id, new Set());
  if (ents._vh) hput(ents._vh, v);
  return id;
}
export function removeVertexIfFree(ents, vid) {
  const s = ents.vedges.get(vid);
  if (s && s.size === 0) { ents.verts.delete(vid); ents.vedges.delete(vid); return true; }
  return false;
}
export function cleanupVerts(ents) {
  for (const [id, s] of ents.vedges) if (!s.size) { ents.verts.delete(id); ents.vedges.delete(id); }
}

// ---------------------------------------------------------------- edges
const EK = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
export const getEdge = (ents, a, b) => { const id = ents.ekey.get(EK(a, b)); return id != null ? ents.edges.get(id) : null; };
export function addEdgeRaw(ents, a, b, props) {
  if (a === b) return null;
  let e = getEdge(ents, a, b);
  if (e) return e;
  e = { id: nid(), a, b, faces: new Set(), soft: false, smooth: false, hidden: false, tag: 0, curve: null, mat: null };
  if (props) Object.assign(e, props);
  ents.edges.set(e.id, e); ents.ekey.set(EK(a, b), e.id);
  ents.vedges.get(a).add(e.id); ents.vedges.get(b).add(e.id);
  return e;
}
export function deleteEdgeRaw(ents, e) {
  ents.edges.delete(e.id); ents.ekey.delete(EK(e.a, e.b));
  ents.vedges.get(e.a)?.delete(e.id); ents.vedges.get(e.b)?.delete(e.id);
}
const eprops = (e) => ({ soft: e.soft, smooth: e.smooth, hidden: e.hidden, tag: e.tag, curve: e.curve, mat: e.mat });

export function splitEdge(ents, e, vid) {
  if (vid === e.a || vid === e.b) return null;
  const faces = [...e.faces], props = eprops(e), a = e.a, b = e.b;
  deleteEdgeRaw(ents, e);
  const e1 = addEdgeRaw(ents, a, vid, props), e2 = addEdgeRaw(ents, vid, b, props);
  for (const fid of faces) {
    const f = ents.faces.get(fid); if (!f) continue;
    for (const loop of f.loops) {
      for (let i = 0; i < loop.length; i++) {
        const x = loop[i], y = loop[(i + 1) % loop.length];
        if ((x === a && y === b) || (x === b && y === a)) { loop.splice(i + 1, 0, vid); break; }
      }
    }
    e1.faces.add(fid); e2.faces.add(fid);
  }
  return [e1, e2];
}

// Add a segment with full splitting against existing geometry. Returns Set of new edge ids.
export function addSegment(ents, pa, pb, out = new Set(), props = null) {
  const va = addVertex(ents, pa), vb = addVertex(ents, pb);
  if (va === vb) return out;
  // endpoints that fall on the interior of an existing edge split that edge
  for (const v of [va, vb]) {
    const p = ents.P(v);
    for (const e of ents.edges.values()) {
      if (e.a === v || e.b === v) continue;
      if (onSegInterior(p, ents.P(e.a), ents.P(e.b))) { splitEdge(ents, e, v); break; }
    }
  }
  const A = ents.P(va).clone(), B = ents.P(vb).clone();
  const L = A.distanceTo(B), dir = B.clone().sub(A).divideScalar(L);
  const pts = [{ t: 0, v: va }, { t: L, v: vb }];
  const box = new THREE.Box3().setFromPoints([A, B]).expandByScalar(TOL * 2);
  const eb = new THREE.Box3();
  for (const e of [...ents.edges.values()]) {
    if (e.a === va || e.b === va || e.a === vb || e.b === vb) continue;
    const P1 = ents.P(e.a), P2 = ents.P(e.b);
    eb.makeEmpty(); eb.expandByPoint(P1); eb.expandByPoint(P2);
    if (!box.intersectsBox(eb)) continue;
    const r = segSeg(A, B, P1, P2);
    if (r.parallel || r.dist > TOL) continue;
    const l2 = P1.distanceTo(P2);
    if (r.s * L <= TOL || r.s * L >= L - TOL || r.t * l2 <= TOL || r.t * l2 >= l2 - TOL) continue;
    const vx = addVertex(ents, r.c1);
    splitEdge(ents, e, vx);
    pts.push({ t: r.s * L, v: vx });
  }
  for (const v of ents.verts.values()) {
    if (v.id === va || v.id === vb) continue;
    if (!box.containsPoint(v.p)) continue;
    const t = v.p.clone().sub(A).dot(dir);
    if (t > TOL && t < L - TOL && A.clone().addScaledVector(dir, t).distanceTo(v.p) < TOL) pts.push({ t, v: v.id });
  }
  pts.sort((x, y) => x.t - y.t);
  for (let i = 0; i + 1 < pts.length; i++) {
    if (pts[i].v === pts[i + 1].v) continue;
    const e = addEdgeRaw(ents, pts[i].v, pts[i + 1].v, props);
    if (e) out.add(e.id);
  }
  return out;
}
function onSegInterior(p, a, b) {
  const ab = b.clone().sub(a), L = ab.length(); if (L < TOL) return false;
  const t = p.clone().sub(a).dot(ab) / L;
  if (t <= TOL || t >= L - TOL) return false;
  return a.clone().addScaledVector(ab, t / L).distanceTo(p) < TOL;
}

// ---------------------------------------------------------------- faces
export function loopPts(ents, loop) { return loop.map((id) => ents.P(id)); }
export function updatePlane(ents, f) {
  const n = newell(loopPts(ents, f.loops[0]));
  if (n.lengthSq() < 1e-14) { f.n = f.n || new V3(0, 0, 1); f.d = 0; return; }
  f.n = n.normalize();
  // plane through centroid for robustness
  let c = new V3(); for (const id of f.loops[0]) c.add(ents.P(id)); c.divideScalar(f.loops[0].length);
  f.d = f.n.dot(c);
}
function registerFace(ents, f) {
  for (const loop of f.loops) for (let i = 0; i < loop.length; i++) {
    const e = addEdgeRaw(ents, loop[i], loop[(i + 1) % loop.length]);
    if (e) e.faces.add(f.id);
  }
}
function unregisterFace(ents, f) {
  for (const loop of f.loops) for (let i = 0; i < loop.length; i++) {
    const e = getEdge(ents, loop[i], loop[(i + 1) % loop.length]);
    if (e) e.faces.delete(f.id);
  }
}
export function addFace(ents, loops, props) {
  const clean = loops.map((l) => l.filter((id, i) => id !== l[(i + 1) % l.length])).filter((l) => l.length >= 3);
  if (!clean.length) return null;
  const f = { id: nid(), loops: clean, n: new V3(0, 0, 1), d: 0, mat: null, back: null, hidden: false, tag: 0 };
  if (props) Object.assign(f, props);
  updatePlane(ents, f);
  ents.faces.set(f.id, f);
  registerFace(ents, f);
  return f;
}
export function removeFace(ents, f) {
  if (typeof f === 'number') f = ents.faces.get(f);
  if (!f) return;
  unregisterFace(ents, f); ents.faces.delete(f.id);
}
export function setFaceLoops(ents, f, loops) {
  unregisterFace(ents, f); f.loops = loops.map((l) => l.slice()); registerFace(ents, f); updatePlane(ents, f);
}
export function reverseFace(ents, f) {
  setFaceLoops(ents, f, f.loops.map((l) => l.slice().reverse()));
  const m = f.mat; f.mat = f.back; f.back = m;
}
export function faceEdges(ents, f) {
  const out = [];
  for (const loop of f.loops) for (let i = 0; i < loop.length; i++) {
    const e = getEdge(ents, loop[i], loop[(i + 1) % loop.length]); if (e) out.push(e);
  }
  return out;
}
export function faceArea(ents, f) {
  const { u, v } = basis(f.n);
  let a = 0;
  f.loops.forEach((l, i) => { const ar = Math.abs(area2(l.map((id) => { const p = ents.P(id); return [p.dot(u), p.dot(v)]; }))); a += i ? -ar : ar; });
  return a;
}
export function facePoly2(ents, f) {
  const { u, v } = basis(f.n);
  const c = (id) => { const p = ents.P(id); return [p.dot(u), p.dot(v)]; };
  return { u, v, outer: f.loops[0].map(c), holes: f.loops.slice(1).map((l) => l.map(c)) };
}
export function pointInFace(ents, f, p) {
  if (Math.abs(f.n.dot(p) - f.d) > TOL * 4) return false;
  const { u, v, outer, holes } = facePoly2(ents, f);
  return inRegion([p.dot(u), p.dot(v)], outer, holes);
}
const loopKey = (l) => l.slice().sort((a, b) => a - b).join(',');

// Find edge cycles in a plane and (re)create faces. The heart of "draw edges → faces appear".
export function rebuildPlane(ents, n, d, newEdges = new Set(), opts = {}) {
  n = n.clone().normalize();
  const { u, v } = basis(n);
  const on = (id) => Math.abs(n.dot(ents.P(id)) - d) < TOL;
  const E = [];
  for (const e of ents.edges.values()) if (on(e.a) && on(e.b)) E.push(e);
  const oldFaces = [];
  for (const f of ents.faces.values()) if (Math.abs(f.n.dot(n)) > 1 - 1e-6 && f.loops[0].every((id) => ents.verts.has(id) && on(id))) oldFaces.push(f);
  const xy = new Map();
  const c2 = (id) => { let q = xy.get(id); if (!q) { const p = ents.P(id); q = [p.dot(u), p.dot(v)]; xy.set(id, q); } return q; };
  const oldPoly = oldFaces.map((f) => ({ f, key: loopKey(f.loops[0]), outer: f.loops[0].map(c2), holes: f.loops.slice(1).filter((l) => l.every((id) => ents.verts.has(id))).map((l) => l.map(c2)) }));

  const adj = new Map();
  const addA = (a, b, eid) => { let l = adj.get(a); if (!l) adj.set(a, (l = [])); l.push({ to: b, eid }); };
  for (const e of E) { addA(e.a, e.b, e.id); addA(e.b, e.a, e.id); }
  const bridges = findBridges(adj);
  for (const [a, l] of adj) {
    const pa = c2(a);
    const f = l.filter((x) => !bridges.has(x.eid));
    for (const x of f) { const q = c2(x.to); x.ang = Math.atan2(q[1] - pa[1], q[0] - pa[0]); }
    f.sort((x, y) => x.ang - y.ang);
    adj.set(a, f);
  }
  // components (union-find)
  const par = new Map();
  const find = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
  for (const a of adj.keys()) par.set(a, a);
  for (const [a, l] of adj) for (const x of l) { const ra = find(a), rb = find(x.to); if (ra !== rb) par.set(ra, rb); }

  const used = new Set(), cycles = [];
  for (const [a, l] of adj) for (const h of l) {
    if (used.has(a + '>' + h.to)) continue;
    const vids = [], eids = [];
    let pa = a, ph = h, guard = 0;
    while (true) {
      const k = pa + '>' + ph.to; if (used.has(k)) break; used.add(k);
      vids.push(pa); eids.push(ph.eid);
      const b = ph.to, lb = adj.get(b);
      const i = lb.findIndex((x) => x.to === pa);
      const nx = lb[(i - 1 + lb.length) % lb.length];
      pa = b; ph = nx;
      if (++guard > 200000) break;
    }
    if (vids.length >= 3) { const poly = vids.map(c2); cycles.push({ vids, eids, poly, area: area2(poly), comp: find(vids[0]), holes: [] }); }
  }
  const pos = cycles.filter((c) => c.area > 1e-6), neg = cycles.filter((c) => c.area < -1e-6);
  for (const h of neg) {
    let best = null;
    for (const c of pos) {
      if (c.comp === h.comp || c.area <= -h.area) continue;
      if (pointInPoly(h.poly[0], c.poly) && (!best || c.area < best.area)) best = c;
    }
    if (best) best.holes.push(h);
  }
  const keep = new Set(), created = [];
  for (const c of pos) {
    const loops = [c.vids, ...c.holes.map((h) => h.vids)];
    const key = loopKey(c.vids);
    const m = oldPoly.find((o) => o.key === key && !keep.has(o.f.id));
    if (m) { keep.add(m.f.id); setFaceLoops(ents, m.f, orientLoops(loops, m.f.n.dot(n) > 0)); continue; }
    const holes2 = c.holes.map((h) => h.poly);
    const ip = interiorPoint(c.poly, holes2);
    let src = oldPoly.find((o) => inRegion(ip, o.outer, o.holes));
    if (!src) src = oldPoly.find((o) => { o.ip = o.ip || interiorPoint(o.outer, o.holes); return inRegion(o.ip, c.poly, holes2); });
    if (!src && (opts.noCreate || !c.eids.some((id) => newEdges.has(id)))) continue;
    const front = src ? src.f.n.dot(n) > 0 : chooseFront(ents, c, n, d, opts);
    const props = src ? { mat: src.f.mat, back: src.f.back, tag: src.f.tag, hidden: src.f.hidden, uv: src.f.uv } : opts.faceProps;
    const f = addFace(ents, orientLoops(loops, front), props);
    if (f) created.push(f);
  }
  for (const o of oldPoly) if (!keep.has(o.f.id)) removeFace(ents, o.f);
  ents.touch();
  return created;
}
function orientLoops(loops, front) { return front ? loops.map((l) => l.slice()) : loops.map((l) => l.slice().reverse()); }
function chooseFront(ents, c, n, d, opts) {
  for (let i = 0; i < c.vids.length; i++) {
    const a = c.vids[i], b = c.vids[(i + 1) % c.vids.length];
    const e = getEdge(ents, a, b); if (!e) continue;
    for (const fid of e.faces) {
      const g = ents.faces.get(fid); if (!g || Math.abs(g.n.dot(n)) > 1 - 1e-6) continue;
      for (const loop of g.loops) for (let j = 0; j < loop.length; j++) {
        const x = loop[j], y = loop[(j + 1) % loop.length];
        if (x === a && y === b) return false;
        if (x === b && y === a) return true;
      }
    }
  }
  if (Math.abs(n.z) > 0.9999) {
    const z = d / n.z;
    if (Math.abs(z - (opts.groundZ || 0)) < TOL) return n.z < 0; // faces on the ground face down
    return n.z > 0;
  }
  if (opts.eye) { const p = ents.P(c.vids[0]); return n.dot(opts.eye.clone().sub(p)) > 0; }
  return true;
}
function findBridges(adj) {
  const disc = new Map(), low = new Map(), br = new Set(); let t = 0;
  for (const s of adj.keys()) {
    if (disc.has(s)) continue;
    disc.set(s, t); low.set(s, t); t++;
    const st = [{ v: s, pe: -1, i: 0 }];
    while (st.length) {
      const fr = st[st.length - 1], l = adj.get(fr.v);
      if (fr.i < l.length) {
        const { to, eid } = l[fr.i++];
        if (eid === fr.pe) continue;
        if (!disc.has(to)) { disc.set(to, t); low.set(to, t); t++; st.push({ v: to, pe: eid, i: 0 }); }
        else low.set(fr.v, Math.min(low.get(fr.v), disc.get(to)));
      } else {
        st.pop();
        if (st.length) { const p = st[st.length - 1]; low.set(p.v, Math.min(low.get(p.v), low.get(fr.v))); if (low.get(fr.v) > disc.get(p.v)) br.add(fr.pe); }
      }
    }
  }
  return br;
}

export function candidatePlanes(ents, eids) {
  const planes = [];
  const add = (n, p) => {
    if (n.lengthSq() < 1e-12) return;
    n = canonNormal(n); const d = n.dot(p);
    if (!planes.some((q) => q.n.dot(n) > 1 - 1e-9 && Math.abs(q.d - d) < TOL)) planes.push({ n, d });
  };
  for (const id of eids) {
    const e = ents.edges.get(id); if (!e) continue;
    const A = ents.P(e.a), B = ents.P(e.b), dir = B.clone().sub(A).normalize();
    for (const vv of [e.a, e.b]) for (const oid of ents.vedges.get(vv) || []) {
      if (oid === id) continue;
      const o = ents.edges.get(oid);
      const od = ents.P(o.b).clone().sub(ents.P(o.a)).normalize();
      const c = dir.clone().cross(od);
      if (c.length() > 1e-4) add(c, A);
    }
    for (const f of ents.faces.values()) {
      if (Math.abs(f.n.dot(A) - f.d) < TOL && Math.abs(f.n.dot(B) - f.d) < TOL) add(f.n, A);
    }
  }
  return planes;
}

// Draw a set of segments [[pa,pb],...] and let faces form. Returns {edges:Set, faces:[]}
export function drawSegments(ents, segs, opts = {}) {
  const out = new Set();
  for (const [a, b] of segs) addSegment(ents, a, b, out, opts.props);
  const faces = [];
  const planes = opts.plane ? [{ n: opts.plane.n.clone().normalize(), d: opts.plane.n.clone().normalize().dot(opts.plane.p) }] : candidatePlanes(ents, out);
  for (const pl of planes) faces.push(...rebuildPlane(ents, pl.n, pl.d, out, opts));
  ents.touch();
  return { edges: out, faces: faces.filter((f) => ents.faces.has(f.id)) };
}

// ---------------------------------------------------------------- erase / heal
export function coplanarFaces(f, g) { return f.n.dot(g.n) > 1 - 1e-6 && Math.abs(f.d - g.d) < TOL; }

export function eraseEdges(ents, eids, faceIds = []) {
  for (const fid of faceIds) removeFace(ents, fid);
  const touchedEnds = new Set();
  for (const id of eids) { const e = ents.edges.get(id); if (e) { touchedEnds.add(e.a); touchedEnds.add(e.b); } }
  const replane = [];
  for (const id of eids) {
    const e = ents.edges.get(id); if (!e) continue;
    const fs = [...e.faces].map((x) => ents.faces.get(x)).filter(Boolean);
    if (fs.length === 2 && coplanarFaces(fs[0], fs[1])) replane.push({ n: fs[0].n.clone(), d: fs[0].d });
    else for (const f of fs) {
      const inOuter = f.loops[0].some((x, i) => { const y = f.loops[0][(i + 1) % f.loops[0].length]; return (x === e.a && y === e.b) || (x === e.b && y === e.a); });
      if (inOuter) removeFace(ents, f); else replane.push({ n: f.n.clone(), d: f.d });
    }
    deleteEdgeRaw(ents, e);
  }
  for (const p of replane) rebuildPlane(ents, p.n, p.d, new Set(), { noCreate: false });
  cleanupVerts(ents);
  removeCollinear(ents, [...ents.verts.keys()].filter((v) => (ents.vedges.get(v) || new Set()).size === 2 && touchedEnds.has(v)));
  ents.touch();
}

// Remove an edge between two coplanar faces, merging them.
export function healEdge(ents, e) {
  if (!e || e.faces.size !== 2) return false;
  const [f, g] = [...e.faces].map((x) => ents.faces.get(x));
  if (!f || !g || !coplanarFaces(f, g)) return false;
  deleteEdgeRaw(ents, e);
  rebuildPlane(ents, f.n.clone(), f.d, new Set());
  return true;
}

// Remove vertices that only join two collinear edges with the same faces.
export function removeCollinear(ents, vids) {
  const gone = new Set();
  for (const v of vids) {
    if (!ents.verts.has(v)) continue;
    const es = [...(ents.vedges.get(v) || [])].map((x) => ents.edges.get(x));
    if (es.length !== 2) continue;
    const [e1, e2] = es;
    const a = e1.a === v ? e1.b : e1.a, b = e2.a === v ? e2.b : e2.a;
    const P = ents.P(v), A = ents.P(a), B = ents.P(b);
    const d1 = P.clone().sub(A).normalize(), d2 = B.clone().sub(P).normalize();
    if (d1.dot(d2) < 1 - 1e-7) continue;
    if (e1.faces.size !== e2.faces.size || [...e1.faces].some((x) => !e2.faces.has(x))) continue;
    if (getEdge(ents, a, b)) continue;
    const faces = [...e1.faces], props = eprops(e1);
    if (e1.curve !== e2.curve) props.curve = null;
    deleteEdgeRaw(ents, e1); deleteEdgeRaw(ents, e2);
    const ne = addEdgeRaw(ents, a, b, props);
    for (const fid of faces) {
      const f = ents.faces.get(fid);
      for (const loop of f.loops) { const i = loop.indexOf(v); if (i >= 0) loop.splice(i, 1); }
      ne.faces.add(fid);
    }
    ents.verts.delete(v); ents.vedges.delete(v); gone.add(v);
  }
  // a face that listed the vertex without being on its edges (thin strips of imported meshes): the vertex
  // was collinear, so dropping it keeps the shape — then hook the face onto the merged edge
  if (gone.size) for (const f of ents.faces.values()) {
    if (!f.loops.some((l) => l.some((x) => gone.has(x)))) continue;
    f.loops = f.loops.map((l) => l.filter((x) => !gone.has(x))).filter((l) => l.length >= 3);
    if (!f.loops.length) { ents.faces.delete(f.id); continue; }
    registerFace(ents, f);
  }
  ents.touch();
}

// ---------------------------------------------------------------- push / pull
export function faceIsLonely(ents, f) {
  return faceEdges(ents, f).every((e) => e.faces.size === 1);
}
export function pushPull(ents, fid, dist, keep = false) {
  const f = ents.faces.get(fid);
  if (!f || Math.abs(dist) < TOL) return null;
  const n = f.n.clone(), t = n.clone().multiplyScalar(dist), s = Math.sign(dist);
  const loops = f.loops.map((l) => l.slice());
  const leave = keep || faceIsLonely(ents, f);
  const props = { mat: f.mat, back: f.back, tag: f.tag };
  const perp = (g) => Math.abs(g.n.dot(n)) < 1e-6;
  const fverts = new Set(loops.flat());
  const baseEdges = [];
  for (const l of loops) for (let i = 0; i < l.length; i++) baseEdges.push({ a: l[i], b: l[(i + 1) % l.length], e: getEdge(ents, l[i], l[(i + 1) % l.length]) });
  const others = (e) => [...e.faces].filter((x) => x !== f.id).map((x) => ents.faces.get(x)).filter(Boolean);
  // a vertex can simply slide along t when every other face around it stays planar
  const movable = new Map();
  for (const id of fverts) {
    let ok = !leave;
    if (ok) for (const eid of ents.vedges.get(id)) {
      const e = ents.edges.get(eid), os = others(e);
      if (os.some((g) => !perp(g))) { ok = false; break; }
      const isBase = baseEdges.some((x) => x.e === e);
      if (isBase && !os.length) { ok = false; break; }
    }
    movable.set(id, ok);
  }
  const map = new Map();
  for (const id of fverts) map.set(id, movable.get(id) ? id : addVertex(ents, ents.P(id).clone().add(t), false));
  const touched = new Set([...fverts, ...map.values()]);
  // stretch neighbours that contain the push direction; build side faces elsewhere
  const sides = [];
  const orphan = [];
  for (const { a, b, e } of baseEdges) {
    const os = e ? others(e) : [];
    const allPerp = os.length && os.every(perp);
    if (allPerp) {
      if (movable.get(a) && movable.get(b)) continue;
      for (const g of os) {
        const nl = g.loops.map((loop) => {
          for (let i = 0; i < loop.length; i++) {
            const x = loop[i], y = loop[(i + 1) % loop.length];
            if (x === b && y === a) return [...loop.slice(0, i + 1), ...(!movable.get(b) ? [map.get(b)] : []), ...(!movable.get(a) ? [map.get(a)] : []), ...loop.slice(i + 1)];
            if (x === a && y === b) return [...loop.slice(0, i + 1), ...(!movable.get(a) ? [map.get(a)] : []), ...(!movable.get(b) ? [map.get(b)] : []), ...loop.slice(i + 1)];
          }
          return loop;
        });
        setFaceLoops(ents, g, nl);
      }
      orphan.push(e);
    } else {
      const A = map.get(a), B = map.get(b);
      const quad = leave && s < 0 ? [a, A, B, b] : [a, b, B, A];
      const sf = addFace(ents, [quad.filter((x, i) => x !== quad[(i + 1) % 4])], props);
      if (sf) sides.push(sf);
    }
  }
  // move the slidable vertices
  for (const id of fverts) if (movable.get(id)) ents.verts.get(id).p.add(t);
  ents.touch();
  // the pushed face itself
  let top;
  const topLoops = loops.map((l) => l.map((id) => map.get(id)));
  if (leave) {
    if (s > 0) reverseFace(ents, f);
    top = addFace(ents, s > 0 ? topLoops : topLoops.map((l) => l.slice().reverse()), props);
    if (top && f.uv) top.uv = f.uv;
  } else { setFaceLoops(ents, f, topLoops); top = f; }
  for (const { a, b, e } of baseEdges) {
    if (!e) continue;
    const te = getEdge(ents, map.get(a), map.get(b));
    if (te && te !== e) te.curve = e.curve;
    // soften seams between curve segments
    if (e.curve != null && map.get(a) !== a) {
      const l = loops.find((x) => x.includes(a)), i = l.indexOf(a);
      const ep = getEdge(ents, l[(i - 1 + l.length) % l.length], a);
      if (ep && ep.curve === e.curve) { const ve = getEdge(ents, a, map.get(a)); if (ve) { ve.soft = true; ve.smooth = true; } }
    }
  }
  for (const e of orphan) if (ents.edges.has(e.id) && !e.faces.size) deleteEdgeRaw(ents, e);
  for (const fs of [...ents.faces.values()]) if (fs.loops.some((l) => l.length >= 3)) updatePlane(ents, fs);
  // tidy: weld collapsed vertices, heal coplanar neighbours, drop collinear points
  const welded = weldCoincident(ents, [...touched].filter((x) => ents.verts.has(x)));
  for (const w of welded) touched.add(w);
  const allowed = new Set(sides.map((x) => x.id)); if (top) allowed.add(top.id);
  healAround(ents, touched, allowed);
  removeCollinear(ents, [...touched]);
  if (top && ents.faces.has(top.id) && !leave) {
    for (const g of [...ents.faces.values()]) {
      if (g === top || g.n.dot(top.n) > -1 + 1e-6 || Math.abs(g.d + top.d) > TOL) continue;
      if (top.loops[0].every((id) => pointInFaceOrEdge(ents, g, ents.P(id)))) { cutThrough(ents, top, g); break; }
    }
  }
  cleanupVerts(ents);
  ents.touch();
  return top && ents.faces.has(top.id) ? top : null;
}
export function healAround(ents, vids, allowed = null) {
  const es = new Set();
  for (const v of vids) for (const eid of ents.vedges.get(v) || []) es.add(eid);
  for (const eid of es) {
    const e = ents.edges.get(eid); if (!e || e.faces.size !== 2 || e.soft) continue;
    const [f, g] = [...e.faces].map((x) => ents.faces.get(x));
    if (allowed && f && g && !allowed.has(f.id) && !allowed.has(g.id)) continue;
    if (f && g && coplanarFaces(f, g) && f.mat === g.mat) { healEdge(ents, e); }
  }
}
function pointInFaceOrEdge(ents, g, p) {
  if (Math.abs(g.n.dot(p) - g.d) > TOL) return false;
  const { u, v, outer, holes } = facePoly2(ents, g);
  const q = [p.dot(u), p.dot(v)];
  if (inRegion(q, outer, holes)) return true;
  // on boundary?
  for (const l of g.loops) for (let i = 0; i < l.length; i++) {
    const a = ents.P(l[i]), b = ents.P(l[(i + 1) % l.length]);
    const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
    if (a.clone().addScaledVector(ab, t).distanceTo(p) < TOL) return true;
  }
  return false;
}
function cutThrough(ents, top, g) {
  // insert the top loop as edges on g's plane, then delete the coincident faces
  const segs = [];
  const l = top.loops[0];
  for (let i = 0; i < l.length; i++) segs.push([ents.P(l[i]).clone(), ents.P(l[(i + 1) % l.length]).clone()]);
  removeFace(ents, top);
  const out = new Set();
  for (const [a, b] of segs) addSegment(ents, a, b, out);
  rebuildPlane(ents, g.n.clone(), g.d, out);
  const key = loopKey(l);
  for (const f of [...ents.faces.values()]) if (f.loops.length === 1 && loopKey(f.loops[0]) === key) removeFace(ents, f);
}

// ---------------------------------------------------------------- moving
export function moveVerts(ents, vids, fn) {
  for (const id of vids) { const v = ents.verts.get(id); if (v) v.p.copy(fn(v.p.clone())); }
  ents.touch();
  const fs = new Set();
  for (const id of vids) for (const eid of ents.vedges.get(id) || []) for (const fid of ents.edges.get(eid).faces) fs.add(fid);
  for (const fid of fs) updatePlane(ents, ents.faces.get(fid));
  return fs;
}
// Auto-fold: triangulate faces that became non-planar.
export function fixNonPlanar(ents, fids) {
  for (const fid of fids) {
    const f = ents.faces.get(fid); if (!f) continue;
    updatePlane(ents, f);
    let bad = false;
    for (const l of f.loops) for (const id of l) if (Math.abs(f.n.dot(ents.P(id)) - f.d) > TOL * 2) bad = true;
    if (!bad || f.loops.length > 1) continue;
    const l = f.loops[0], props = { mat: f.mat, back: f.back, tag: f.tag };
    const { u, v } = basis(f.n);
    const poly = l.map((id) => { const p = ents.P(id); return [p.dot(u), p.dot(v)]; });
    const tris = THREE.ShapeUtils.triangulateShape(poly.map((q) => new THREE.Vector2(q[0], q[1])), []);
    removeFace(ents, f);
    const orig = new Set(); for (let i = 0; i < l.length; i++) orig.add(EK(l[i], l[(i + 1) % l.length]));
    for (const t of tris) {
      let tri = [l[t[0]], l[t[1]], l[t[2]]];
      if (area2(t.map((k) => poly[k])) < 0) tri = tri.reverse();
      addFace(ents, [tri], props);
      for (let k = 0; k < 3; k++) {
        if (!orig.has(EK(tri[k], tri[(k + 1) % 3]))) { const e = getEdge(ents, tri[k], tri[(k + 1) % 3]); if (e) { e.soft = true; e.smooth = true; } }
      }
    }
  }
  ents.touch();
}

// Merge vertices of `vids` that coincide with other vertices.
export function weldCoincident(ents, vids) {
  const merged = [];
  ents._vh = null;
  const other = (id) => {
    const p = ents.P(id), h = vhash(ents), cx = Math.floor(p.x), cy = Math.floor(p.y), cz = Math.floor(p.z);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      for (const w of h.get(CK(cx + i, cy + j, cz + k)) || []) { if (w !== id && ents.verts.has(w) && ents.P(w).distanceTo(p) < TOL) return w; }
    }
    return null;
  };
  const changedFaces = new Set();
  for (const id of vids) {
    if (!ents.verts.has(id)) continue;
    const o = other(id); if (o == null) continue;
    for (const eid of [...(ents.vedges.get(id) || [])]) {
      const e = ents.edges.get(eid); if (!e) continue;
      const faces = [...e.faces], props = eprops(e);
      const a = e.a === id ? o : e.a, b = e.b === id ? o : e.b;
      deleteEdgeRaw(ents, e);
      for (const fid of faces) changedFaces.add(fid);
      if (a === b) continue;
      const ne = addEdgeRaw(ents, a, b, props);
      for (const fid of faces) ne.faces.add(fid);
    }
    for (const fid of changedFaces) { const f = ents.faces.get(fid); if (f) for (const l of f.loops) for (let i = 0; i < l.length; i++) if (l[i] === id) l[i] = o; }
    ents.verts.delete(id); ents.vedges.delete(id);
    merged.push(o);
  }
  if (!merged.length) return merged;
  const seen = new Map();
  for (const fid of changedFaces) {
    const f = ents.faces.get(fid); if (!f) continue;
    unregisterFace(ents, f);
    f.loops = f.loops.map((l) => l.filter((x, i) => x !== l[(i + 1) % l.length])).filter((l, i) => i === 0 || l.length >= 3);
    if (f.loops[0].length < 3) { ents.faces.delete(f.id); continue; }
    registerFace(ents, f); updatePlane(ents, f);
  }
  for (const f of [...ents.faces.values()]) {
    const k = loopKey(f.loops[0]);
    if (seen.has(k) && f.loops.length === 1 && seen.get(k).loops.length === 1) { removeFace(ents, f); removeFace(ents, seen.get(k)); } else seen.set(k, f);
  }
  for (const e of [...ents.edges.values()]) if (!e.faces.size && (merged.includes(e.a) || merged.includes(e.b))) {
    // an edge collapsed onto another face boundary — keep only if it is not duplicated by geometry
  }
  ents.touch();
  return merged;
}

// ---------------------------------------------------------------- serialization
const R = (x) => round(x, 1e4);
export function entsToJSON(ents) {
  return {
    v: [...ents.verts.values()].map((v) => [v.id, R(v.p.x), R(v.p.y), R(v.p.z)]),
    e: [...ents.edges.values()].map((e) => [e.id, e.a, e.b, (e.soft ? 1 : 0) | (e.smooth ? 2 : 0) | (e.hidden ? 4 : 0), e.tag, e.curve, e.mat]),
    f: [...ents.faces.values()].map((f) => ({ i: f.id, l: f.loops, m: f.mat, b: f.back, t: f.tag, h: f.hidden ? 1 : 0, uv: f.uv })),
    i: [...ents.insts.values()].map((x) => ({ ...x, m: x.m.elements.map(R) })),
    g: [...ents.guides.values()].map((g) => ({ ...g, p: v2a(g.p), dir: g.dir ? v2a(g.dir) : null })),
    dm: [...ents.dims.values()].map((d) => ({ ...d, a: v2a(d.a), b: v2a(d.b), off: v2a(d.off) })),
    tx: [...ents.texts.values()].map((t) => ({ ...t, p: v2a(t.p), at: t.at ? v2a(t.at) : null })),
    s: [...ents.sections.values()].map((s) => ({ ...s, p: v2a(s.p), n: v2a(s.n) })),
    c: [...ents.curves.values()].map((c) => ({ ...c, center: v2a(c.center), normal: v2a(c.normal), xa: c.xa ? v2a(c.xa) : null })),
  };
}
const v2a = (p) => [R(p.x), R(p.y), R(p.z)];
const a2v = (a) => new V3(a[0], a[1], a[2]);
export function entsFromJSON(o) {
  const ents = new Entities();
  for (const [id, x, y, z] of o.v || []) { ents.verts.set(id, { id, p: new V3(x, y, z) }); ents.vedges.set(id, new Set()); bumpNid(id); }
  for (const [id, a, b, fl, tag, curve, mat] of o.e || []) {
    const e = { id, a, b, faces: new Set(), soft: !!(fl & 1), smooth: !!(fl & 2), hidden: !!(fl & 4), tag: tag || 0, curve: curve ?? null, mat: mat ?? null };
    ents.edges.set(id, e); ents.ekey.set(EK(a, b), id); ents.vedges.get(a).add(id); ents.vedges.get(b).add(id); bumpNid(id);
  }
  for (const r of o.f || []) {
    const f = { id: r.i, loops: r.l, n: new V3(), d: 0, mat: r.m ?? null, back: r.b ?? null, tag: r.t || 0, hidden: !!r.h, uv: r.uv };
    updatePlane(ents, f); ents.faces.set(f.id, f); registerFace(ents, f); bumpNid(f.id);
  }
  for (const r of o.i || []) { const m = new THREE.Matrix4(); m.fromArray(r.m); ents.insts.set(r.id, { ...r, m }); bumpNid(r.id); }
  for (const r of o.g || []) { ents.guides.set(r.id, { ...r, p: a2v(r.p), dir: r.dir ? a2v(r.dir) : null }); bumpNid(r.id); }
  for (const r of o.dm || []) { ents.dims.set(r.id, { ...r, a: a2v(r.a), b: a2v(r.b), off: a2v(r.off) }); bumpNid(r.id); }
  for (const r of o.tx || []) { ents.texts.set(r.id, { ...r, p: a2v(r.p), at: r.at ? a2v(r.at) : null }); bumpNid(r.id); }
  for (const r of o.s || []) { ents.sections.set(r.id, { ...r, p: a2v(r.p), n: a2v(r.n) }); bumpNid(r.id); }
  for (const r of o.c || []) { ents.curves.set(r.id, { ...r, center: a2v(r.center), normal: a2v(r.normal), xa: r.xa ? a2v(r.xa) : null }); bumpNid(r.id); }
  return ents;
}
export function modelToJSON(m) {
  return {
    format: 'amatu-sketch', version: 1, info: m.info, units: m.units, geo: m.geo, style: m.style, shadow: m.shadow, fog: m.fog, dimStyle: m.dimStyle,
    materials: [...m.materials.values()], tags: [...m.tags.values()], scenes: m.scenes,
    defs: [...m.defs.values()].map((d) => ({ ...d, ents: entsToJSON(d.ents) })),
    activeSection: m.activeSection ?? null, axesM: m.axesM ? m.axesM.elements.slice() : null,
    render: m.render || null,
    root: entsToJSON(m.root),
  };
}
export function modelFromJSON(o) {
  const m = new Model();
  Object.assign(m.info, o.info || {}); Object.assign(m.units, o.units || {}); Object.assign(m.geo, o.geo || {});
  Object.assign(m.style, o.style || {}); Object.assign(m.shadow, o.shadow || {}); Object.assign(m.fog, o.fog || {}); Object.assign(m.dimStyle, o.dimStyle || {});
  for (const mt of o.materials || []) { m.materials.set(mt.id, mt); bumpNid(mt.id); }
  if (o.tags) { m.tags = new Map(); for (const t of o.tags) { m.tags.set(t.id, t); bumpNid(t.id); } }
  m.scenes = o.scenes || [];
  for (const d of o.defs || []) { m.defs.set(d.id, { ...d, ents: entsFromJSON(d.ents) }); bumpNid(d.id); }
  m.root = entsFromJSON(o.root || {});
  m.activeSection = o.activeSection ?? null;
  if (o.render) m.render = o.render;
  if (o.axesM) m.axesM = new THREE.Matrix4().fromArray(o.axesM);
  return m;
}
