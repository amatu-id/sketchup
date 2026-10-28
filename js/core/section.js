// Section cut: intersect all faces with a plane → segments, and assemble closed loops for fills.
import * as THREE from 'three';
import { V3, TOL, basis, area2, pointInPoly, interiorPoint, triangulate2 } from './geom.js';
import { Entities, drawSegments } from './model.js';

export function walkGeometry(model, cb, opts = {}) {
  const visTag = (t) => { const x = model.tags.get(t || 0); return !x || x.visible !== false; };
  const rec = (ents, m, path) => {
    cb(ents, m, path);
    for (const inst of ents.insts.values()) {
      if ((inst.hidden && !opts.includeHidden) || !visTag(inst.tag)) continue;
      const d = model.defs.get(inst.def); if (!d) continue;
      rec(d.ents, m.clone().multiply(inst.m), [...path, inst.id]);
    }
  };
  rec(model.root, opts.matrix || new THREE.Matrix4(), []);
}

export function sectionSegments(model, n, d) {
  const segs = [];
  const visTag = (t) => { const x = model.tags.get(t || 0); return !x || x.visible !== false; };
  walkGeometry(model, (ents, m) => {
    const wp = new Map();
    const W = (id) => { let p = wp.get(id); if (!p) { p = ents.P(id).clone().applyMatrix4(m); wp.set(id, p); } return p; };
    for (const f of ents.faces.values()) {
      if (f.hidden || !visTag(f.tag)) continue;
      const loops = f.loops.map((l) => l.map(W));
      const fn = new V3().copy(f.n).transformDirection(m);
      const dir = fn.clone().cross(n);
      if (dir.lengthSq() < 1e-10) continue;
      dir.normalize();
      const pts = [];
      for (const loop of loops) for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        let da = n.dot(a) - d, db = n.dot(b) - d;
        if (Math.abs(da) < 1e-6) da = 1e-6; if (Math.abs(db) < 1e-6) db = 1e-6;
        if ((da > 0) === (db > 0)) continue;
        pts.push(a.clone().lerp(b, da / (da - db)));
      }
      if (pts.length < 2) continue;
      const o = pts[0];
      pts.sort((p, q) => p.clone().sub(o).dot(dir) - q.clone().sub(o).dot(dir));
      for (let i = 0; i + 1 < pts.length; i += 2) if (pts[i].distanceTo(pts[i + 1]) > TOL) segs.push([pts[i], pts[i + 1]]);
    }
  });
  return segs;
}

// Poché: build the planar arrangement of the cut segments and fill regions that are inside material (even-odd rule).
export function sectionFill(segs, n, d) {
  const { u, v } = basis(n);
  const E = new Entities();
  // snap to 0.1 mm to merge shared endpoints coming from different faces
  const snap = (p) => new THREE.Vector3(Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.z * 10) / 10);
  const clean = segs.map(([a, b]) => [snap(a), snap(b)]).filter(([a, b]) => a.distanceTo(b) > TOL);
  if (!clean.length) return { pos: [], loops: [] };
  drawSegments(E, clean);
  const s2 = clean.map(([a, b]) => [[a.dot(u), a.dot(v)], [b.dot(u), b.dot(v)]]);
  const inside = (q) => {
    let c = 0;
    for (const [a, b] of s2) {
      if ((a[1] > q[1]) !== (b[1] > q[1])) { const x = a[0] + ((q[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]); if (x > q[0]) c++; }
    }
    return c % 2 === 1;
  };
  const pos = [], loops = [];
  for (const f of E.faces.values()) {
    const { u: fu, v: fv } = basis(f.n);
    const l2 = f.loops.map((l) => l.map((id) => { const p = E.P(id); return [p.dot(fu), p.dot(fv)]; }));
    const ip2 = interiorPoint(l2[0], l2.slice(1));
    const P = fu.clone().multiplyScalar(ip2[0]).addScaledVector(fv, ip2[1]).addScaledVector(f.n, f.d);
    if (!inside([P.dot(u), P.dot(v)])) continue;
    const all = f.loops.flat();
    for (const t of triangulate2(l2[0], l2.slice(1))) for (const k of t) { const p = E.P(all[k]); pos.push(p.x, p.y, p.z); }
    loops.push(f.loops[0].map((id) => E.P(id).clone()));
  }
  void area2; void pointInPoly; void d;
  return { pos, loops };
}
