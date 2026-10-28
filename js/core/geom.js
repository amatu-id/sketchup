// Low-level geometry helpers. Internal unit = millimetre, Z is up.
import * as THREE from 'three';

export const V3 = THREE.Vector3;
export const TOL = 0.05;          // length tolerance (mm)
export const ATOL = 1e-6;         // normal / direction tolerance

export const v3 = (x = 0, y = 0, z = 0) => new V3(x, y, z);
export const arr = (p) => [p.x, p.y, p.z];
export const fromArr = (a) => new V3(a[0], a[1], a[2]);

// Plane basis with u x v = n. u is horizontal for non-horizontal planes.
export function basis(n) {
  let u;
  if (Math.abs(n.z) > 0.9999) u = new V3(1, 0, 0);
  else u = new V3(0, 0, 1).cross(n).normalize();
  const v = new V3().crossVectors(n, u);
  return { u, v };
}

export function newell(pts) {
  const n = new V3();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  return n;
}

export function area2(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const inRegion = (p, outer, holes = []) => pointInPoly(p, outer) && !holes.some((h) => pointInPoly(p, h));

// Triangulate a 2D polygon with holes → [[i,j,k]] indexing outer.concat(...holes)
export function triangulate2(outer, holes = []) {
  const c = outer.map((q) => new THREE.Vector2(q[0], q[1]));
  const h = holes.map((hh) => hh.map((q) => new THREE.Vector2(q[0], q[1])));
  try { return THREE.ShapeUtils.triangulateShape(c, h); } catch (e) { return []; }
}

export function interiorPoint(outer, holes = []) {
  const all = outer.concat(...holes);
  const tris = triangulate2(outer, holes);
  let best = null, ba = -1;
  for (const t of tris) {
    const a = all[t[0]], b = all[t[1]], c = all[t[2]];
    const ar = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]));
    if (ar > ba) { ba = ar; best = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3]; }
  }
  if (best) return best;
  let x = 0, y = 0;
  for (const q of outer) { x += q[0]; y += q[1]; }
  return [x / outer.length, y / outer.length];
}

// Closest points between segments p1q1 and p2q2 (Ericson). Returns params s,t in [0,1].
export function segSeg(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  if (a <= 1e-12 && e <= 1e-12) { s = t = 0; }
  else if (a <= 1e-12) { s = 0; t = clamp01(f / e); }
  else {
    const c = d1.dot(r);
    if (e <= 1e-12) { t = 0; s = clamp01(-c / a); }
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den !== 0 ? clamp01((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  const c1 = p1.clone().addScaledVector(d1, s), c2 = p2.clone().addScaledVector(d2, t);
  return { s, t, c1, c2, dist: c1.distanceTo(c2), parallel: d1.clone().normalize().cross(d2.clone().normalize()).lengthSq() < 1e-10 };
}
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// Closest point on infinite line (o + s*dir) to a ray (ro + t*rd). Returns {p, s, t, dist}
export function lineRay(o, dir, ro, rd) {
  const w = o.clone().sub(ro);
  const a = dir.dot(dir), b = dir.dot(rd), c = rd.dot(rd), d = dir.dot(w), e = rd.dot(w);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-12) return null;
  const s = (b * e - c * d) / den, t = (a * e - b * d) / den;
  const p = o.clone().addScaledVector(dir, s);
  const q = ro.clone().addScaledVector(rd, t);
  return { p, s, t, dist: p.distanceTo(q) };
}

export function rayPlane(ro, rd, n, d) {
  const den = n.dot(rd);
  if (Math.abs(den) < 1e-9) return null;
  const t = (d - n.dot(ro)) / den;
  if (t < 0) return null;
  return ro.clone().addScaledVector(rd, t);
}

export function pointSegDist(p, a, b) {
  const ab = b.clone().sub(a), l2 = ab.lengthSq();
  const t = l2 ? clamp01(p.clone().sub(a).dot(ab) / l2) : 0;
  return { t, p: a.clone().addScaledVector(ab, t), dist: a.clone().addScaledVector(ab, t).distanceTo(p) };
}

export function canonNormal(n) {
  const c = n.clone().normalize();
  if (c.z < -ATOL || (Math.abs(c.z) <= ATOL && (c.y < -ATOL || (Math.abs(c.y) <= ATOL && c.x < 0)))) c.negate();
  return c;
}

export function bboxOf(points) {
  const b = new THREE.Box3();
  for (const p of points) b.expandByPoint(p);
  return b;
}

export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;
export const round = (x, k = 1e4) => Math.round(x * k) / k;
