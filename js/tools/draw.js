// Drawing tools: Line, Freehand, Rectangle, Rotated Rectangle, Circle, Polygon, Arcs, Pie
import * as THREE from 'three';
import { Tool, planeFor, planeBasisAxes, drawProtractor, axisColorFor, shapePlane, lockedNormal, planeKey, planeMarker, notePlane, faceNormalAt, onPlaneOf, shapeKey, shapeKeyUp, drawPlaneSquare, tint } from './base.js';
import { drawSegments, nid } from '../core/model.js';
import { rayPlane } from '../core/geom.js';
import { COL } from '../view/overlay.js';

// commit world-space segments to the active context
export function commitSegs(app, label, segs, curve = null, plane = null) {
  let res;
  app.commit(label, () => {
    const { ents, inv } = app.ctxInfo();
    let props = null;
    if (curve) {
      const id = nid();
      // arc tools hand over their geometry as { n }, circles / freehand as { normal }
      ents.curves.set(id, { id, center: curve.center.clone().applyMatrix4(inv), normal: (curve.normal || curve.n).clone().transformDirection(inv), radius: curve.radius, segs: curve.segs, arc: !!curve.arc, xa: curve.xa ? curve.xa.clone().transformDirection(inv) : null, a0: curve.a0, a1: curve.a1 });
      props = { curve: id };
    }
    const eye = app.view.cam.eye.clone().applyMatrix4(inv);
    const pl = plane ? { n: plane.n.clone().transformDirection(inv), p: plane.p.clone().applyMatrix4(inv) } : null;
    res = drawSegments(ents, segs.map(([a, b]) => [a.clone().applyMatrix4(inv), b.clone().applyMatrix4(inv)]), { props, eye, plane: pl });
  });
  return res;
}
const loopSegs = (pts, closed = true) => { const s = []; for (let i = 0; i + 1 < pts.length + (closed ? 1 : 0); i++) s.push([pts[i], pts[(i + 1) % pts.length]]); return s; };
const fmtLen = (app, d) => app.units.format(d);

// ------------------------------------------------------------------ Line
export class LineTool extends Tool {
  constructor(app) { super(app); this.id = 'line'; this.cursor = 'pencil'; this.vcbLabel = 'Length'; this.hint = 'Click to start the line, click to end it. Type a length and press Enter. Arrow keys lock axis (→ red, ← green, ↑ blue). Hold Shift to lock the current inference.'; }
  reset() { super.reset(); this.start = null; this.first = null; this.cur = null; this.lockDir = null; this.shiftLock = null; }
  onMove(ev) {
    const r = this.find(ev, { start: this.start, lockDir: this.shiftLock || this.lockDir });
    this.cur = r; this.setMarker(r);
    if (this.start) this.app.setVCB('Length', fmtLen(this.app, r.p.distanceTo(this.start)));
    this.view.requestRender();
  }
  onDown(ev) { this.downAt = { x: ev.x, y: ev.y }; if (!this.start) { const r = this.find(ev, {}); this.cur = r; this.addPoint(r.p); this.dragStarted = true; } else this.dragStarted = false; }
  onUp(ev) {
    if (!this.downAt) return;
    const moved = Math.hypot(ev.x - this.downAt.x, ev.y - this.downAt.y) > 6;
    if (this.dragStarted && moved && this.start && this.cur) this.addPoint(this.cur.p);
    else if (!this.dragStarted && this.cur) this.addPoint(this.cur.p);
    this.downAt = null;
  }
  addPoint(p) {
    if (!this.start) { this.start = p.clone(); this.first = p.clone(); this.app.setStatus('Select end point.'); return; }
    if (p.distanceTo(this.start) < 0.01) return;
    const res = commitSegs(this.app, 'Line', [[this.start, p]]);
    this.lastDir = p.clone().sub(this.start).normalize();
    this.lastSeg = [this.start.clone(), p.clone()];
    if ((res && res.faces.length) || p.distanceTo(this.first) < 0.01) { this.start = null; this.first = null; this.view.overlay.marker = null; this.inf.reset(); }
    else this.start = p.clone();
    this.inf.track(p);
  }
  onVCB(s) {
    const app = this.app;
    const abs = s.match(/^\[(.+)\]$/), rel = s.match(/^<(.+)>$/);
    if (abs || rel) {
      const v = (abs || rel)[1].split(/[,;]/).map((x) => app.units.parse(x));
      if (v.length !== 3 || v.some((x) => x == null)) return false;
      const p = new THREE.Vector3(...v);
      if (rel) { if (!this.start) return false; p.add(this.start); }
      else p.applyMatrix4(app.ctxInfo().matrix);
      if (!this.start) { this.start = p; this.first = p.clone(); return true; }
      this.addPoint(p); return true;
    }
    const len = app.units.parse(s); if (len == null) return false;
    if (this.start && this.cur) {
      const d = this.cur.p.clone().sub(this.start); if (d.lengthSq() < 1e-9) return false;
      this.addPoint(this.start.clone().addScaledVector(d.normalize(), len));
      return true;
    }
    if (!this.start && this.lastSeg) {
      // resize the last drawn line
      const [a] = this.lastSeg;
      app.undo(true);
      const p = a.clone().addScaledVector(this.lastDir, len);
      this.start = a.clone(); this.first = a.clone(); this.addPoint(p);
      return true;
    }
    return false;
  }
  onKey(e) {
    if (this.arrowLock(e)) { this.view.requestRender(); return true; }
    if (e.key === 'Shift' && this.start && this.cur && !this.shiftLock) { const d = this.cur.dir || this.cur.p.clone().sub(this.start); if (d.lengthSq() > 1e-9) this.shiftLock = d.clone().normalize(); return true; }
    if (e.key === 'Escape') { this.reset(); this.view.requestRender(); return true; }
    return false;
  }
  onKeyUp(e) { if (e.key === 'Shift') { this.shiftLock = null; return true; } return false; }
  onDbl() { this.start = null; this.first = null; }
  draw(ov) {
    if (!this.start || !this.cur) return;
    const ld = this.shiftLock || this.lockDir;
    const col = this.cur.type === 'axis' ? this.cur.color : ld ? axisColorFor(this, ld) : COL.black;
    ov.line(this.start, this.cur.p, col, 2.2);
    ov.dot(this.start, COL.end, 3.5);
  }
}

// ------------------------------------------------------------------ Freehand
export class FreehandTool extends Tool {
  constructor(app) { super(app); this.id = 'freehand'; this.cursor = 'pencil'; this.hint = 'Click and drag to draw freehand curves on the face under the cursor. The Plane bar or arrow keys pick another plane (↑ horizontal, ↓ vertical, → red, ← green); hold Shift to keep the plane.'; }
  reset() { super.reset(); this.pts = null; this.plane = null; }
  onKey(e) { if (shapeKey(this, e, !this.pts)) return true; if (e.key === 'Escape') { this.reset(); this.view.requestRender(); return true; } return false; }
  onKeyUp(e) { return shapeKeyUp(this, e); }
  onDown(ev) {
    const r = this.find(ev, {}); const n = shapePlane(this, r);
    this.plane = { n, d: n.dot(r.p) }; this.pts = [r.p.clone()]; this.last = { x: ev.x, y: ev.y };
  }
  onMove(ev) {
    if (!this.pts) { const r = this.find(ev, {}); this.hov = r; this.hovN = shapePlane(this, r); this.setMarker(planeMarker(this, r, this.hovN)); this.view.requestRender(); return; }
    if (Math.hypot(ev.x - this.last.x, ev.y - this.last.y) < 7) return;
    const ray = this.view.rayAt(ev.x, ev.y);
    const p = rayPlane(ray.o, ray.d, this.plane.n, this.plane.d) || rayPlane(ray.o, ray.d, this.plane.n.clone().negate(), -this.plane.d);
    if (p) { this.pts.push(p); this.last = { x: ev.x, y: ev.y }; this.view.requestRender(); }
  }
  onUp() {
    if (!this.pts || this.pts.length < 2) { this.reset(); return; }
    const pts = this.pts; const closed = pts[0].distanceTo(pts[pts.length - 1]) < pts[0].distanceTo(pts[1]) * 1.5 && pts.length > 4;
    if (closed) pts.pop();
    commitSegs(this.app, 'Freehand', loopSegs(pts, closed), { center: pts[0], normal: this.plane.n, radius: 0, segs: pts.length, arc: true }, { n: this.plane.n, p: pts[0] });
    this.reset();
  }
  draw(ov) {
    if (this.pts) ov.poly(this.pts, COL.black, null, 2, null, false);
    else if (this.hov && this.hovN) drawPlaneSquare(this, ov, this.hov.p, this.hovN, axisColorFor(this, this.hovN));
  }
}

// ------------------------------------------------------------------ Rectangle
export class RectTool extends Tool {
  constructor(app) { super(app); this.id = 'rect'; this.cursor = 'rect'; this.vcbLabel = 'Dimensions'; this.hint = 'Click the first corner, then the opposite corner. Type "length,width" and press Enter. It lies on the face under the cursor; the Plane bar or arrow keys pick another plane (↑ horizontal, ↓ vertical, → red, ← green). Hold Shift to keep the plane.'; }
  reset() { super.reset(); this.p0 = null; this.cur = null; }
  onKey(e) {
    if (shapeKey(this, e, !this.p0)) { this.view.requestRender(); return true; }
    if (e.key === 'Escape') { this.reset(); this.view.requestRender(); return true; }
    return false;
  }
  onKeyUp(e) { return shapeKeyUp(this, e); }
  // Plane bar / arrow key while the first corner is down: re-plane the rectangle
  onPlaneMode() { if (this.p0) { this.setPlane(lockedNormal(this) || this.n0); if (this.app.lastEv) this.onMove(this.app.lastEv); } }
  setPlane(n) { this.n = n.clone().normalize(); const b = planeBasisAxes(this, this.n); this.u = b.u; this.v = b.v; }
  onMove(ev) {
    if (!this.p0) { const r = this.find(ev, {}); this.hov = r; this.hovN = shapePlane(this, r); this.setMarker(planeMarker(this, r, this.hovN)); this.view.requestRender(); return; }
    notePlane(this, this.n);
    const r = this.find(ev, { lockPlane: { n: this.n, d: this.n.dot(this.p0) }, start: this.p0 });
    let d = r.p.clone().sub(this.p0);
    let du = d.dot(this.u), dv = d.dot(this.v);
    this.tag = '';
    if (Math.abs(du) > 1 && Math.abs(dv) > 1) {
      const ratio = Math.abs(du) / Math.abs(dv);
      if (Math.abs(ratio - 1) < 0.035) { const s = Math.max(Math.abs(du), Math.abs(dv)); du = Math.sign(du) * s; dv = Math.sign(dv) * s; this.tag = 'Square'; }
      else if (Math.abs(ratio - 1.618) < 0.04) { dv = (Math.sign(dv) * Math.abs(du)) / 1.618; this.tag = 'Golden Section'; }
      else if (Math.abs(1 / ratio - 1.618) < 0.04) { du = (Math.sign(du) * Math.abs(dv)) / 1.618; this.tag = 'Golden Section'; }
    }
    this.du = du; this.dv = dv;
    this.setMarker(this.tag ? { ...r, p: this.corner(du, dv), label: this.tag, type: 'end', color: COL.magenta } : r);
    this.app.setVCB('Dimensions', `${this.app.units.format(Math.abs(du), { unit: false })}, ${this.app.units.format(Math.abs(dv), { unit: false })}`);
    this.view.requestRender();
  }
  corner(du, dv) { return this.p0.clone().addScaledVector(this.u, du).addScaledVector(this.v, dv); }
  pts(du = this.du, dv = this.dv) { return [this.p0.clone(), this.corner(du, 0), this.corner(du, dv), this.corner(0, dv)]; }
  onDown(ev) {
    if (!this.p0) {
      const r = this.find(ev, {});
      this.p0 = r.p.clone(); this.n0 = this.holdN || planeFor(this, r, null); this.setPlane(this.holdN || lockedNormal(this) || this.n0);
      this.du = this.dv = 0; this.downAt = { x: ev.x, y: ev.y }; this.app.setStatus('Select the opposite corner or type dimensions.');
      return;
    }
    this.finish();
  }
  onUp(ev) { if (this.p0 && this.downAt && Math.hypot(ev.x - this.downAt.x, ev.y - this.downAt.y) > 8) this.finish(); this.downAt = null; }
  finish() {
    if (Math.abs(this.du) < 0.01 || Math.abs(this.dv) < 0.01) return;
    this.last = { p0: this.p0.clone(), n: this.n.clone(), u: this.u.clone(), v: this.v.clone(), du: this.du, dv: this.dv };
    commitSegs(this.app, 'Rectangle', loopSegs(this.pts()), null, { n: this.n, p: this.p0 });
    this.reset();
  }
  onVCB(s) {
    const v = this.app.units.parseList(s); if (v.length < 2 || v.some((x) => x == null)) return false;
    if (this.p0) { this.du = Math.sign(this.du || 1) * v[0]; this.dv = Math.sign(this.dv || 1) * v[1]; this.finish(); return true; }
    if (this.last) {
      this.app.undo(true);
      const L = this.last; this.p0 = L.p0; this.n = L.n; this.u = L.u; this.v = L.v; this.du = Math.sign(L.du) * v[0]; this.dv = Math.sign(L.dv) * v[1];
      this.finish(); return true;
    }
    return false;
  }
  draw(ov) {
    if (!this.p0) { if (this.hov && this.hovN) drawPlaneSquare(this, ov, this.hov.p, this.hovN, axisColorFor(this, this.hovN)); return; }
    const pts = this.pts();
    ov.poly(pts, this.tag ? COL.magenta : COL.black, tint(axisColorFor(this, this.n), 0.12), 1.8);
  }
}

export class RotRectTool extends Tool {
  constructor(app) { super(app); this.id = 'rotrect'; this.cursor = 'rect'; this.vcbLabel = 'Dimensions'; this.hint = 'Click two points for the first edge, then swing the rectangle and click to finish.'; }
  reset() { super.reset(); this.p = []; this.cur = null; }
  onMove(ev) {
    const r = this.find(ev, { start: this.p[this.p.length - 1] }); this.cur = r; this.setMarker(r); this.view.requestRender();
    if (this.p.length === 1) this.app.setVCB('Length', this.app.units.format(r.p.distanceTo(this.p[0])));
  }
  onDown() {
    if (!this.cur) return;
    this.p.push(this.cur.p.clone());
    if (this.p.length === 3) { const q = this.quad(); if (q) commitSegs(this.app, 'Rotated Rectangle', loopSegs(q), null, { n: q[1].clone().sub(q[0]).cross(q[3].clone().sub(q[0])).normalize(), p: q[0] }); this.reset(); }
  }
  quad(c = this.cur && this.cur.p) {
    if (this.p.length < 2 || !c) return null;
    const [a, b] = this.p, d = b.clone().sub(a).normalize();
    const h = c.clone().sub(b); h.addScaledVector(d, -h.dot(d));
    if (h.length() < 0.01) return null;
    return [a, b, b.clone().add(h), a.clone().add(h)];
  }
  onVCB(s) {
    const v = this.app.units.parseList(s);
    if (this.p.length === 1 && v[0] != null && this.cur) { const d = this.cur.p.clone().sub(this.p[0]).normalize(); this.p.push(this.p[0].clone().addScaledVector(d, v[0])); return true; }
    if (this.p.length === 2 && v[0] != null && this.cur) {
      const q = this.quad(); if (!q) return false; const h = q[2].clone().sub(q[1]).normalize();
      const len = v[v.length - 1];
      commitSegs(this.app, 'Rotated Rectangle', loopSegs([q[0], q[1], q[1].clone().addScaledVector(h, len), q[0].clone().addScaledVector(h, len)]));
      this.reset(); return true;
    }
    return false;
  }
  onKey(e) { if (this.arrowLock(e)) return true; if (e.key === 'Escape') { this.reset(); return true; } return false; }
  draw(ov) {
    if (this.p.length === 1 && this.cur) ov.line(this.p[0], this.cur.p, COL.black, 2);
    const q = this.quad(); if (q) ov.poly(q, COL.black, 'rgba(70,110,200,0.12)', 1.8);
  }
}

// ------------------------------------------------------------------ Circle & Polygon
export class CircleTool extends Tool {
  constructor(app, poly = false) {
    super(app); this.poly = poly; this.id = poly ? 'polygon' : 'circle'; this.cursor = poly ? 'polygon' : 'circle';
    this.segs = poly ? 6 : 24; this.vcbLabel = 'Sides';
    this.hint = (poly ? 'Click to place the center, click again for the radius. Type "6s" to set the number of sides.' : 'Click to place the center, click again for the radius. Type "48s" to change the number of segments.') +
      ' It lies on the face under the cursor (also when snapped to a point or edge of that face). The Plane bar or arrow keys stand it up: ↓ vertical facing you, → red, ← green, ↑ horizontal. Hold Shift to keep the plane.';
  }
  reset() { super.reset(); this.c = null; this.r = 0; this.app.setVCB(this.poly ? 'Sides' : 'Segments', String(this.segs)); }
  onKey(e) {
    if (shapeKey(this, e, !this.c)) { this.view.requestRender(); return true; }
    if (e.key === 'Escape') { this.reset(); this.view.requestRender(); return true; }
    return false;
  }
  onKeyUp(e) { return shapeKeyUp(this, e); }
  // Plane bar / arrow key after the center is placed: turn the circle around its center
  onPlaneMode() { if (this.c) { this.setN(lockedNormal(this) || this.n0); if (this.app.lastEv) this.onMove(this.app.lastEv); } }
  setN(n) { this.n = n.clone().normalize(); const b = planeBasisAxes(this, this.n); this.u = b.u; this.v = b.v; }
  onMove(ev) {
    if (!this.c) { const r = this.find(ev, {}); this.hov = r; this.hovN = shapePlane(this, r); this.setMarker(planeMarker(this, r, this.hovN)); this.view.requestRender(); return; }
    notePlane(this, this.n);
    const r = this.find(ev, { lockPlane: { n: this.n, d: this.n.dot(this.c) }, start: this.c });
    const d = r.p.clone().sub(this.c);
    this.r = d.length(); this.dir = d.lengthSq() > 1e-9 ? d.normalize() : this.u.clone();
    this.setMarker(r);
    this.app.setVCB('Radius', this.app.units.format(this.r));
    this.view.requestRender();
  }
  points(r = this.r) {
    const pts = [];
    const u = this.poly ? this.dir : this.u, v = this.n.clone().cross(u);
    for (let i = 0; i < this.segs; i++) { const a = (i / this.segs) * Math.PI * 2; pts.push(this.c.clone().addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r)); }
    return pts;
  }
  onDown(ev) {
    if (!this.c) { const r = this.find(ev, {}); this.c = r.p.clone(); this.n0 = this.holdN || planeFor(this, r, null); this.setN(this.holdN || lockedNormal(this) || this.n0); this.dir = this.u.clone(); this.downAt = { x: ev.x, y: ev.y }; return; }
    this.finish();
  }
  onUp(ev) { if (this.c && this.downAt && Math.hypot(ev.x - this.downAt.x, ev.y - this.downAt.y) > 8) this.finish(); this.downAt = null; }
  finish(r = this.r) {
    if (r < 0.01) return;
    this.last = { c: this.c.clone(), n: this.n.clone(), u: this.u.clone(), v: this.v.clone(), dir: this.dir.clone(), r };
    commitSegs(this.app, this.poly ? 'Polygon' : 'Circle', loopSegs(this.points(r)), this.poly ? null : { center: this.c, normal: this.n, radius: r, segs: this.segs, arc: false, xa: this.u }, { n: this.n, p: this.c });
    this.reset();
  }
  onVCB(s) {
    const m = s.match(/^(\d+)\s*s$/i);
    if (m) {
      this.segs = Math.max(3, Math.min(999, +m[1]));
      if (!this.c && this.last) { this.app.undo(true); Object.assign(this, { c: this.last.c, n: this.last.n, u: this.last.u, v: this.last.v, dir: this.last.dir }); this.finish(this.last.r); }
      this.app.setVCB(this.poly ? 'Sides' : 'Segments', String(this.segs)); return true;
    }
    const r = this.app.units.parse(s); if (r == null || r <= 0) return false;
    if (this.c) { this.finish(r); return true; }
    if (this.last) { this.app.undo(true); Object.assign(this, { c: this.last.c, n: this.last.n, u: this.last.u, v: this.last.v, dir: this.last.dir }); this.finish(r); return true; }
    return false;
  }
  draw(ov) {
    if (!this.c) { if (this.hov && this.hovN) drawProtractor(ov, this.hov.p, this.hovN, axisColorFor(this, this.hovN)); return; }
    const col = axisColorFor(this, this.n);
    if (this.r > 0.01) { ov.poly(this.points(), COL.black, tint(col, 0.12), 1.8); ov.line(this.c, this.c.clone().addScaledVector(this.dir, this.r), col, 1, [4, 4]); }
    else drawProtractor(ov, this.c, this.n, col);
  }
}

// ------------------------------------------------------------------ Arcs
function arcPoints(center, n, xa, r, a0, a1, segs) {
  const ya = n.clone().cross(xa);
  const pts = [];
  for (let i = 0; i <= segs; i++) { const a = a0 + ((a1 - a0) * i) / segs; pts.push(center.clone().addScaledVector(xa, Math.cos(a) * r).addScaledVector(ya, Math.sin(a) * r)); }
  return pts;
}
const PT_SNAPS = new Set(['end', 'mid', 'center', 'intersect', 'gpoint']);
// Plane through the chord A→B while the last point is pulled (2 Point Arc bulge, 3 Point Arc end point):
//  · a locked plane (Plane bar / arrow keys) or the one held with Shift
//  · the plane through a snapped endpoint / midpoint
//  · else the face under the cursor or an axis plane through the chord — whichever one's perpendicular
//    bisector passes nearest the cursor on screen. So the arc's apex follows the cursor: pull straight up
//    from a horizontal chord and it stands vertical, pull along the floor and it lies flat.
// Returns { n, q (the pulled point in that plane), snap, kind }.
function swingPlane(tool, ev, A, B, prev, faces = []) {
  const v = tool.view, d = B.clone().sub(A), chord = d.length(); d.normalize();
  const M = A.clone().add(B).multiplyScalar(0.5);
  const contain = (n) => { if (!n) return null; const m = n.clone().addScaledVector(d, -n.dot(d)); return m.lengthSq() > 0.04 ? m.normalize() : null; };
  const snap = tool.find(ev, {}), ray = snap.ray || v.rayAt(ev.x, ev.y), hit = snap.hit;
  const onEdge = snap.type === 'edge' || PT_SNAPS.has(snap.type);
  const res = (n, kind) => {
    const q = onEdge ? snap.p.clone().addScaledVector(n, n.dot(A) - n.dot(snap.p)) : rayPlane(ray.o, ray.d, n, n.dot(A)) || rayPlane(ray.o, ray.d, n.clone().negate(), -n.dot(A));
    return { n, kind, q, snap: onEdge ? snap : null };
  };
  const fixed = contain(tool.holdN || lockedNormal(tool));
  if (fixed) return res(fixed, 'lock');
  if (PT_SNAPS.has(snap.type)) {
    const off = snap.p.clone().sub(A); off.addScaledVector(d, -off.dot(d));
    if (off.length() > chord * 0.01) return { n: d.clone().cross(off).normalize(), kind: 'point', q: snap.p.clone(), snap };
  }
  const cands = [];
  const add = (n, kind, bonus = 0) => {
    if (!n || Math.abs(n.clone().normalize().dot(d)) > 0.01) return; // the plane must hold the chord
    const m = contain(n); if (m && !cands.some((c) => Math.abs(c.n.dot(m)) > 0.9995)) cands.push({ n: m, kind, bonus });
  };
  if (hit && onPlaneOf(hit, A)) add(hit.normal, 'face', 10);
  for (const f of faces) add(f, 'start', 6); // faces the clicks were on (their plane, not necessarily on them)
  for (const a of tool.inf.axes()) { const n = d.clone().cross(a); if (n.lengthSq() > 1e-6) add(n, 'axis'); }
  const PM = v.project(M), PA = v.project(A), PB = v.project(B);
  const chordPx = Math.max(24, Math.hypot(PB.x - PA.x, PB.y - PA.y));
  const vx = ev.x - PM.x, vy = ev.y - PM.y;
  for (const c of cands) {
    const Q = v.project(M.clone().addScaledVector(c.n.clone().cross(d), chord * 0.5));
    const sx = Q.x - PM.x, sy = Q.y - PM.y, sl = Math.hypot(sx, sy);
    // planes seen edge-on can't be pulled into; otherwise: px distance from the cursor to the projected bisector
    c.score = Q.behind || PM.behind || sl < chordPx * 0.12 ? Infinity : Math.abs(vx * sy - vy * sx) / sl - c.bonus;
  }
  cands.sort((a, b) => a.score - b.score);
  let pick = cands[0];
  const keep = prev && cands.find((c) => Math.abs(c.n.dot(prev)) > 0.9995);
  if (keep && keep.score < Infinity && (Math.hypot(vx, vy) < 8 || keep.score <= pick.score + 8)) pick = keep; // no flicker between planes
  if (!pick || pick.score === Infinity) return res(contain(v.viewDir()) || contain(prev) || contain(tool.inf.axes()[2]) || contain(tool.inf.axes()[0]), 'view');
  return res(pick.n, pick.kind);
}
// translucent patch of the drawing plane along a chord (shows which way the arc stands)
function drawPlanePatch(tool, ov, A, B, n, w, h, chord) {
  const col = axisColorFor(tool, n), hh = Math.abs(h) > chord * 0.2 ? h * 1.12 : (Math.sign(h) || 1) * chord * 0.25;
  ov.poly([A, B, B.clone().addScaledVector(w, hh), A.clone().addScaledVector(w, hh)], tint(col, 0.6), tint(col, 0.08), 1, [4, 4]);
}

export class Arc2Tool extends Tool {
  constructor(app) {
    super(app); this.id = 'arc2'; this.cursor = 'arc'; this.segs = 12; this.vcbLabel = 'Length';
    this.hint = 'Click the start point, click the end point, then pull the bulge — the arc swings to the plane you pull toward (pull straight up for a vertical arc). The Plane bar or arrow keys lock the plane (↓ vertical facing you, → red, ← green, ↑ horizontal); Shift keeps the current one. Type "12s" for segments.';
  }
  reset() { super.reset(); this.p = []; this.cur = null; this.lockDir = null; this.n0 = null; this.n1 = null; this.tag = ''; }
  lockN() { return this.holdN || lockedNormal(this); }
  onPlaneMode() { if (this.app.lastEv) this.onMove(this.app.lastEv); }
  onMove(ev) {
    if (this.p.length < 2) {
      // with a locked plane the end point stays in it; otherwise free points follow the face the arc started on
      const L = this.lockN(), o = { start: this.p[0] };
      if (L && this.p.length === 1) o.lockPlane = { n: L, d: L.dot(this.p[0]) }; else if (this.n0) o.planeN = this.n0;
      const r = this.find(ev, o); this.cur = r;
      this.setMarker(L ? planeMarker(this, r, L) : r);
      if (!L) notePlane(this, null);
      if (this.p.length === 1) this.app.setVCB('Length', this.app.units.format(r.p.distanceTo(this.p[0])));
    } else {
      const sp = swingPlane(this, ev, this.p[0], this.p[1], this.n, [this.n0, this.n1]);
      if (!sp.q) return;
      this.n = sp.n; this.w = this.n.clone().cross(this.d).normalize(); this.kind = sp.kind;
      this.h = sp.q.clone().sub(this.mid).dot(this.w);
      const c = this.chord;
      this.tag = Math.abs(Math.abs(this.h) - c / 2) < c * 0.02 ? 'Half Circle' : '';
      if (this.tag) this.h = Math.sign(this.h) * c / 2;
      const snapLabel = sp.kind === 'point' ? sp.snap.label : '';
      this.setMarker(planeMarker(this, { p: this.mid.clone().addScaledVector(this.w, this.h), type: this.tag ? 'end' : 'free', label: this.tag || snapLabel, color: COL.magenta }, this.n, sp.kind === 'face' ? 'On Face' : ''));
      this.app.setVCB('Bulge', this.app.units.format(Math.abs(this.h)));
    }
    this.view.requestRender();
  }
  onDown() {
    if (!this.cur && this.p.length < 2) return;
    if (this.p.length === 0) { this.p.push(this.cur.p.clone()); this.n0 = faceNormalAt(this.cur); return; }
    if (this.p.length === 1) { if (this.cur.p.distanceTo(this.p[0]) < 0.01) return; this.p.push(this.cur.p.clone()); this.n1 = faceNormalAt(this.cur); this.setupPlane(); return; }
    this.finish();
  }
  setupPlane() {
    const [A, B] = this.p, d = B.clone().sub(A);
    this.chord = d.length(); d.normalize(); this.d = d; this.mid = A.clone().add(B).multiplyScalar(0.5);
    const contain = (n) => { if (!n) return null; const m = n.clone().addScaledVector(d, -n.dot(d)); return m.lengthSq() > 0.04 ? m.normalize() : null; };
    // first guess until the cursor moves: locked plane, the face the arc started on, else the flattest plane through the chord
    const ax = this.inf.axes();
    const n = contain(this.lockN()) || (this.n0 && Math.abs(this.n0.dot(d)) < 0.01 ? contain(this.n0) : null) || contain(ax[2]) || contain(ax[0]) || contain(ax[1]);
    this.n = n; this.w = n.clone().cross(d).normalize(); this.h = 0; this.kind = 'axis';
  }
  geom(h = this.h) {
    const [a, b] = this.p, c = a.distanceTo(b);
    if (Math.abs(h) < 0.01) return null;
    const r = (c * c / 4 + h * h) / (2 * Math.abs(h));
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const s = Math.sign(h);
    const center = mid.clone().addScaledVector(this.w, s * (Math.abs(h) - r));
    const xa = a.clone().sub(center).normalize();
    const n = s > 0 ? this.n.clone().negate() : this.n.clone();
    const ya = n.clone().cross(xa);
    const bb = b.clone().sub(center);
    let a1 = Math.atan2(bb.dot(ya), bb.dot(xa)); if (a1 <= 0) a1 += Math.PI * 2;
    return { center, n, xa, r, a0: 0, a1 };
  }
  finish(h = this.h) {
    const g = this.geom(h); if (!g) return;
    const pts = arcPoints(g.center, g.n, g.xa, g.r, g.a0, g.a1, this.segs);
    pts[0] = this.p[0].clone(); pts[pts.length - 1] = this.p[1].clone();
    this.last = { p: this.p.map((x) => x.clone()), n: this.n.clone(), w: this.w.clone(), d: this.d.clone(), mid: this.mid.clone(), chord: this.chord, h };
    commitSegs(this.app, 'Arc', loopSegs(pts, false), { ...g, segs: this.segs, arc: true, radius: g.r }, { n: this.n, p: this.p[0] });
    this.reset();
  }
  restoreLast() { const L = this.last; Object.assign(this, { p: L.p.map((x) => x.clone()), n: L.n, w: L.w, d: L.d, mid: L.mid, chord: L.chord }); }
  onVCB(s) {
    const m = s.match(/^(\d+)\s*s$/i);
    if (m) { this.segs = Math.max(2, +m[1]); if (!this.p.length && this.last) { this.app.undo(true); this.restoreLast(); this.finish(this.last.h); } return true; }
    const v = this.app.units.parse(s); if (v == null) return false;
    if (this.p.length === 1 && this.cur) { const d = this.cur.p.clone().sub(this.p[0]).normalize(); this.p.push(this.p[0].clone().addScaledVector(d, v)); this.n1 = null; this.setupPlane(); return true; }
    if (this.p.length === 2) { this.finish(Math.sign(this.h || 1) * v); return true; }
    if (this.last) { this.app.undo(true); this.restoreLast(); this.finish(Math.sign(this.last.h) * v); return true; }
    return false;
  }
  onKey(e) {
    if (planeKey(this, e)) return true;
    if (e.key === 'Shift' && this.p.length === 2 && !this.holdN) { this.holdN = this.n.clone(); return true; }
    if (e.key === 'Escape') { this.reset(); this.view.requestRender(); return true; }
    return false;
  }
  onKeyUp(e) { return shapeKeyUp(this, e); }
  draw(ov) {
    const L = this.p.length < 2 ? this.lockN() : null;
    if (L && (this.p[0] || this.cur)) drawProtractor(ov, this.p[0] || this.cur.p, L, axisColorFor(this, L));
    if (this.p.length === 1 && this.cur) ov.line(this.p[0], this.cur.p, COL.black, 1.6, [5, 4]);
    if (this.p.length === 2) {
      drawPlanePatch(this, ov, this.p[0], this.p[1], this.n, this.w, this.h, this.chord);
      const g = this.geom();
      if (g) ov.poly(arcPoints(g.center, g.n, g.xa, g.r, g.a0, g.a1, this.segs), this.tag ? COL.magenta : COL.black, null, 2, null, false);
      else ov.line(this.p[0], this.p[1], COL.black, 2);
    }
  }
}

export class ArcCenterTool extends Tool {
  constructor(app, pie = false) {
    super(app); this.pie = pie; this.id = pie ? 'pie' : 'arc'; this.cursor = pie ? 'pie' : 'arc'; this.segs = 12;
    this.hint = 'Click the center, click the start point, then click the end angle. Type an angle or "12s". The protractor lies on the face under the cursor; the Plane bar or arrow keys stand it up (↓ vertical facing you, → red, ← green, ↑ horizontal). Hold Shift to keep the plane.';
  }
  reset() { super.reset(); this.c = null; this.s = null; this.ang = 0; }
  onKey(e) {
    if (shapeKey(this, e, !this.c)) { this.view.requestRender(); return true; }
    if (e.key === 'Escape') { this.reset(); this.view.requestRender(); return true; }
    return false;
  }
  onKeyUp(e) { return shapeKeyUp(this, e); }
  // Plane bar / arrow key after the center is placed (before the start point): turn the protractor
  onPlaneMode() { if (this.c && !this.s) { this.n = (lockedNormal(this) || this.n0).clone().normalize(); if (this.app.lastEv) this.onMove(this.app.lastEv); } }
  onMove(ev) {
    if (!this.c) { const r = this.find(ev, {}); this.hov = r; this.hovN = shapePlane(this, r); this.setMarker(planeMarker(this, r, this.hovN)); }
    else {
      notePlane(this, this.n);
      const r = this.find(ev, { lockPlane: { n: this.n, d: this.n.dot(this.c) }, start: this.c });
      this.cur = r.p; this.setMarker(r);
      if (this.s) {
        const xa = this.s.clone().sub(this.c).normalize(), ya = this.n.clone().cross(xa), q = r.p.clone().sub(this.c);
        let a = Math.atan2(q.dot(ya), q.dot(xa));
        if (this.prevA != null) { while (a - this.prevA > Math.PI) a -= 2 * Math.PI; while (a - this.prevA < -Math.PI) a += 2 * Math.PI; }
        const snap = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
        if (Math.abs(a - snap) < 0.03) a = snap;
        this.ang = a; this.prevA = a;
        this.app.setVCB('Angle', (a * 180 / Math.PI).toFixed(1) + '°');
      } else this.app.setVCB('Radius', this.app.units.format(r.p.distanceTo(this.c)));
    }
    this.view.requestRender();
  }
  onDown() {
    if (!this.c) { const r = this.hov; if (!r) return; this.c = r.p.clone(); this.n0 = this.holdN || planeFor(this, r, null); this.n = (this.holdN || lockedNormal(this) || this.n0).clone().normalize(); return; }
    if (!this.s) { if (this.cur.distanceTo(this.c) < 0.01) return; this.s = this.cur.clone(); this.prevA = 0; return; }
    this.finish();
  }
  geom(a = this.ang) {
    const xa = this.s.clone().sub(this.c).normalize(), r = this.s.distanceTo(this.c);
    return a >= 0 ? { center: this.c, n: this.n, xa, r, a0: 0, a1: a } : { center: this.c, n: this.n.clone().negate(), xa, r, a0: 0, a1: -a };
  }
  finish(a = this.ang) {
    if (Math.abs(a) < 1e-4) return;
    const g = this.geom(a), pts = arcPoints(g.center, g.n, g.xa, g.r, g.a0, g.a1, this.segs);
    const segs = loopSegs(pts, false);
    if (this.pie) { segs.push([pts[pts.length - 1], this.c], [this.c, pts[0]]); }
    const plane = { n: this.n, p: this.c };
    commitSegs(this.app, this.pie ? 'Pie' : 'Arc', this.pie ? segs.slice(0, -2) : segs, { ...g, segs: this.segs, arc: true, radius: g.r }, plane);
    if (this.pie) commitSegs(this.app, 'Pie', segs.slice(-2), null, plane);
    this.reset();
  }
  onVCB(s) {
    const m = s.match(/^(\d+)\s*s$/i); if (m) { this.segs = Math.max(2, +m[1]); return true; }
    if (this.s) { const a = parseFloat(s); if (!isFinite(a)) return false; this.finish((a * Math.PI) / 180); return true; }
    if (this.c && this.cur) { const r = this.app.units.parse(s); if (r == null) return false; this.s = this.c.clone().addScaledVector(this.cur.clone().sub(this.c).normalize(), r); this.prevA = 0; return true; }
    return false;
  }
  draw(ov) {
    if (!this.c) { if (this.hov && this.hovN) drawProtractor(ov, this.hov.p, this.hovN, axisColorFor(this, this.hovN)); return; }
    if (!this.s) { if (this.cur) ov.line(this.c, this.cur, COL.black, 1.6, [5, 4]); drawProtractor(ov, this.c, this.n, axisColorFor(this, this.n)); return; }
    const g = this.geom(); const pts = arcPoints(g.center, g.n, g.xa, g.r, g.a0, g.a1, this.segs);
    ov.poly(this.pie ? [this.c, ...pts] : pts, COL.black, this.pie ? tint(axisColorFor(this, this.n), 0.12) : null, 2, null, this.pie);
    ov.line(this.c, this.s, COL.gray, 1, [4, 4]);
  }
}

export class Arc3Tool extends Tool {
  constructor(app) {
    super(app); this.id = 'arc3'; this.cursor = 'arc'; this.segs = 12;
    this.hint = 'Click the start point, a point on the arc, then the end point — the arc swings to the plane you pull toward. The Plane bar or arrow keys lock the plane (↓ vertical facing you, → red, ← green, ↑ horizontal); Shift keeps the current one.';
  }
  reset() { super.reset(); this.p = []; this.cur = null; this.n0 = null; this.n1 = null; this.pn = null; }
  lockN() { return this.holdN || lockedNormal(this); }
  onPlaneMode() { if (this.app.lastEv) this.onMove(this.app.lastEv); }
  onMove(ev) {
    if (this.p.length === 2) {
      const sp = swingPlane(this, ev, this.p[0], this.p[1], this.pn, [this.n0, this.n1]);
      if (!sp.q) return;
      this.pn = sp.n;
      const s = sp.snap;
      this.cur = { p: sp.q, type: s ? s.type : 'free' };
      this.setMarker(planeMarker(this, { p: sp.q, type: s ? s.type : 'free', label: s ? s.label : '', color: s ? s.color : COL.gray }, sp.n, sp.kind === 'face' ? 'On Face' : ''));
    } else {
      const L = this.lockN(), o = { start: this.p[0] };
      if (L && this.p.length === 1) o.lockPlane = { n: L, d: L.dot(this.p[0]) }; else if (this.n0) o.planeN = this.n0;
      const r = this.find(ev, o); this.cur = r;
      this.setMarker(L ? planeMarker(this, r, L) : r);
      if (!L) notePlane(this, null);
    }
    this.view.requestRender();
  }
  onDown() {
    if (!this.cur) return;
    if (this.p.length === 0) this.n0 = faceNormalAt(this.cur);
    else if (this.p.length === 1) { if (this.cur.p.distanceTo(this.p[0]) < 0.01) return; this.n1 = faceNormalAt(this.cur); }
    this.p.push(this.cur.p.clone());
    if (this.p.length === 3) {
      const g = this.geom();
      if (g) { const pts = arcPoints(g.center, g.n, g.xa, g.r, 0, g.a1, this.segs); pts[0] = this.p[0]; pts[pts.length - 1] = this.p[2]; commitSegs(this.app, 'Arc', loopSegs(pts, false), { ...g, segs: this.segs, arc: true, radius: g.r, a0: 0 }, { n: g.n, p: g.center }); }
      this.reset();
    }
  }
  geom(c = this.p[2] || (this.cur && this.cur.p)) {
    if (this.p.length < 2 || !c) return null;
    const [a, b] = this.p;
    const ab = b.clone().sub(a), ac = c.clone().sub(a), n = ab.clone().cross(ac);
    if (n.lengthSq() < 1e-6) return null;
    // circumcenter: a + ((ab×ac)×ab·|ac|² + ac×(ab×ac)·|ab|²) / (2|ab×ac|²)
    const cc = a.clone().add(n.clone().cross(ab).multiplyScalar(ac.lengthSq()).add(ac.clone().cross(n).multiplyScalar(ab.lengthSq())).divideScalar(2 * n.lengthSq()));
    const nn = n.clone().normalize(), r = cc.distanceTo(a), xa = a.clone().sub(cc).normalize(), ya = nn.clone().cross(xa);
    const q = c.clone().sub(cc);
    let a1 = Math.atan2(q.dot(ya), q.dot(xa)); if (a1 <= 0) a1 += Math.PI * 2;
    return { center: cc, n: nn, xa, r, a1 };
  }
  onKey(e) {
    if (planeKey(this, e)) return true;
    if (e.key === 'Shift' && this.p.length === 2 && this.pn && !this.holdN) { this.holdN = this.pn.clone(); return true; }
    if (e.key === 'Escape') { this.reset(); this.view.requestRender(); return true; }
    return false;
  }
  onKeyUp(e) { return shapeKeyUp(this, e); }
  draw(ov) {
    const L = this.p.length < 2 ? this.lockN() : null;
    if (L && (this.p[0] || this.cur)) drawProtractor(ov, this.p[0] || this.cur.p, L, axisColorFor(this, L));
    if (this.p.length === 1 && this.cur) ov.line(this.p[0], this.cur.p, COL.black, 1.6, [5, 4]);
    if (this.p.length === 2) {
      const g = this.geom();
      if (this.pn && this.cur) { const col = axisColorFor(this, this.pn); ov.poly([this.p[0], this.p[1], this.cur.p], tint(col, 0.6), tint(col, 0.08), 1, [4, 4]); }
      if (g) ov.poly(arcPoints(g.center, g.n, g.xa, g.r, 0, g.a1, this.segs), COL.black, null, 2, null, false);
      else if (this.cur) ov.line(this.p[0], this.p[1], COL.black, 2);
    }
  }
}
