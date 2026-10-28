// Drawing tools: Line, Freehand, Rectangle, Rotated Rectangle, Circle, Polygon, Arcs, Pie
import * as THREE from 'three';
import { Tool, planeFor, planeBasisAxes, drawProtractor, axisColorFor } from './base.js';
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
      ents.curves.set(id, { id, center: curve.center.clone().applyMatrix4(inv), normal: curve.normal.clone().transformDirection(inv), radius: curve.radius, segs: curve.segs, arc: !!curve.arc, xa: curve.xa ? curve.xa.clone().transformDirection(inv) : null, a0: curve.a0, a1: curve.a1 });
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
  constructor(app) { super(app); this.id = 'freehand'; this.cursor = 'pencil'; this.hint = 'Click and drag to draw freehand curves.'; }
  reset() { super.reset(); this.pts = null; this.plane = null; }
  onDown(ev) {
    const r = this.find(ev, {}); const n = planeFor(this, r, null);
    this.plane = { n, d: n.dot(r.p) }; this.pts = [r.p.clone()]; this.last = { x: ev.x, y: ev.y };
  }
  onMove(ev) {
    if (!this.pts) { this.setMarker(this.find(ev, {})); this.view.requestRender(); return; }
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
  draw(ov) { if (this.pts) ov.poly(this.pts, COL.black, null, 2, null, false); }
}

// ------------------------------------------------------------------ Rectangle
export class RectTool extends Tool {
  constructor(app) { super(app); this.id = 'rect'; this.cursor = 'rect'; this.vcbLabel = 'Dimensions'; this.hint = 'Click the first corner, then the opposite corner. Type "length,width" and press Enter. Arrow keys choose the drawing plane.'; }
  reset() { super.reset(); this.p0 = null; this.cur = null; this.lockN = null; }
  onKey(e) {
    const ax = this.inf.axes();
    const map = { ArrowRight: ax[0], ArrowLeft: ax[1], ArrowUp: ax[2] };
    if (e.key in map) { this.lockN = this.lockN && this.lockN.equals(map[e.key]) ? null : map[e.key].clone(); if (this.p0) this.setPlane(this.lockN || this.n0); this.view.requestRender(); return true; }
    if (e.key === 'Escape') { this.reset(); this.view.requestRender(); return true; }
    return false;
  }
  setPlane(n) { this.n = n.clone().normalize(); const b = planeBasisAxes(this, this.n); this.u = b.u; this.v = b.v; }
  onMove(ev) {
    if (!this.p0) { const r = this.find(ev, {}); this.setMarker(r); this.hov = r; this.view.requestRender(); return; }
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
      this.p0 = r.p.clone(); this.n0 = planeFor(this, r, null); this.setPlane(this.lockN || this.n0);
      this.du = this.dv = 0; this.downAt = { x: ev.x, y: ev.y }; this.app.setStatus('Select the opposite corner or type dimensions.');
      return;
    }
    this.finish();
  }
  onUp(ev) { if (this.p0 && this.downAt && Math.hypot(ev.x - this.downAt.x, ev.y - this.downAt.y) > 8) this.finish(); this.downAt = null; }
  finish() {
    if (Math.abs(this.du) < 0.01 || Math.abs(this.dv) < 0.01) return;
    this.last = { p0: this.p0.clone(), u: this.u.clone(), v: this.v.clone(), du: this.du, dv: this.dv };
    commitSegs(this.app, 'Rectangle', loopSegs(this.pts()), null, { n: this.n, p: this.p0 });
    this.reset();
  }
  onVCB(s) {
    const v = this.app.units.parseList(s); if (v.length < 2 || v.some((x) => x == null)) return false;
    if (this.p0) { this.du = Math.sign(this.du || 1) * v[0]; this.dv = Math.sign(this.dv || 1) * v[1]; this.finish(); return true; }
    if (this.last) {
      this.app.undo(true);
      const L = this.last; this.p0 = L.p0; this.u = L.u; this.v = L.v; this.du = Math.sign(L.du) * v[0]; this.dv = Math.sign(L.dv) * v[1];
      this.finish(); return true;
    }
    return false;
  }
  draw(ov) {
    if (!this.p0) return;
    const pts = this.pts();
    ov.poly(pts, this.tag ? COL.magenta : COL.black, 'rgba(70,110,200,0.12)', 1.8);
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
    this.hint = poly ? 'Click to place the center, click again for the radius. Type "6s" to set the number of sides.' : 'Click to place the center, click again for the radius. Type "48s" to change the number of segments.';
  }
  reset() { super.reset(); this.c = null; this.r = 0; this.lockN = null; this.app.setVCB(this.poly ? 'Sides' : 'Segments', String(this.segs)); }
  onKey(e) {
    const ax = this.inf.axes(), map = { ArrowRight: ax[0], ArrowLeft: ax[1], ArrowUp: ax[2] };
    if (e.key in map) { this.lockN = this.lockN && this.lockN.equals(map[e.key]) ? null : map[e.key].clone(); if (this.c) this.setN(this.lockN || this.n0); this.view.requestRender(); return true; }
    if (e.key === 'Escape') { this.reset(); this.view.requestRender(); return true; }
    return false;
  }
  setN(n) { this.n = n.clone().normalize(); const b = planeBasisAxes(this, this.n); this.u = b.u; this.v = b.v; }
  onMove(ev) {
    if (!this.c) { const r = this.find(ev, {}); this.hov = r; this.setMarker(r); this.view.requestRender(); return; }
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
    if (!this.c) { const r = this.find(ev, {}); this.c = r.p.clone(); this.n0 = planeFor(this, r, null); this.setN(this.lockN || this.n0); this.dir = this.u.clone(); this.downAt = { x: ev.x, y: ev.y }; return; }
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
    if (!this.c) { if (this.hov) { const n = this.lockN || planeFor(this, this.hov, null); drawProtractor(ov, this.hov.p, n, axisColorFor(this, n)); } return; }
    if (this.r > 0.01) { ov.poly(this.points(), COL.black, 'rgba(70,110,200,0.12)', 1.8); ov.line(this.c, this.c.clone().addScaledVector(this.dir, this.r), COL.gray, 1, [4, 4]); }
  }
}

// ------------------------------------------------------------------ Arcs
function arcPoints(center, n, xa, r, a0, a1, segs) {
  const ya = n.clone().cross(xa);
  const pts = [];
  for (let i = 0; i <= segs; i++) { const a = a0 + ((a1 - a0) * i) / segs; pts.push(center.clone().addScaledVector(xa, Math.cos(a) * r).addScaledVector(ya, Math.sin(a) * r)); }
  return pts;
}
export class Arc2Tool extends Tool {
  constructor(app) { super(app); this.id = 'arc2'; this.cursor = 'arc'; this.segs = 12; this.vcbLabel = 'Length'; this.hint = 'Click the start point, click the end point, then pull to set the bulge. Type "12s" for segments.'; }
  reset() { super.reset(); this.p = []; this.cur = null; this.lockDir = null; }
  onMove(ev) {
    if (this.p.length < 2) {
      const r = this.find(ev, { start: this.p[0] }); this.cur = r; this.setMarker(r);
      if (this.p.length === 1) this.app.setVCB('Length', this.app.units.format(r.p.distanceTo(this.p[0])));
    } else {
      const ray = this.view.rayAt(ev.x, ev.y);
      let q = rayPlane(ray.o, ray.d, this.n, this.n.dot(this.p[0])) || rayPlane(ray.o, ray.d, this.n.clone().negate(), -this.n.dot(this.p[0]));
      const snap = this.find(ev, { noFace: true });
      if (snap && (snap.type === 'end' || snap.type === 'mid' || snap.type === 'edge')) q = snap.p.clone().addScaledVector(this.n, this.n.dot(this.p[0]) - this.n.dot(snap.p));
      if (!q) return;
      const mid = this.p[0].clone().add(this.p[1]).multiplyScalar(0.5);
      this.h = q.clone().sub(mid).dot(this.w);
      const c = this.p[0].distanceTo(this.p[1]);
      this.tag = Math.abs(Math.abs(this.h) - c / 2) < c * 0.02 ? 'Half Circle' : '';
      if (this.tag) this.h = Math.sign(this.h) * c / 2;
      this.setMarker({ p: mid.clone().addScaledVector(this.w, this.h), type: this.tag ? 'end' : 'free', label: this.tag, color: COL.magenta });
      this.app.setVCB('Bulge', this.app.units.format(Math.abs(this.h)));
    }
    this.view.requestRender();
  }
  onDown() {
    if (!this.cur && this.p.length < 2) return;
    if (this.p.length === 0) { this.p.push(this.cur.p.clone()); this.n0 = this.cur.type === 'face' ? this.cur.normal.clone() : null; return; }
    if (this.p.length === 1) { if (this.cur.p.distanceTo(this.p[0]) < 0.01) return; this.p.push(this.cur.p.clone()); this.setupPlane(); return; }
    this.finish();
  }
  setupPlane() {
    const d = this.p[1].clone().sub(this.p[0]).normalize();
    let n = this.n0 && Math.abs(this.n0.dot(d)) < 1e-6 ? this.n0 : null;
    if (!n) { const z = this.inf.axes()[2]; n = Math.abs(d.dot(z)) < 1e-6 ? z.clone() : d.clone().cross(z).cross(d).normalize(); if (n.lengthSq() < 1e-6) n = new THREE.Vector3(1, 0, 0); }
    // prefer a plane that faces the camera when the chord is horizontal and view is low
    this.n = n.normalize(); this.d = d; this.w = this.n.clone().cross(d).normalize(); this.h = 0;
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
    this.last = { p: this.p.map((x) => x.clone()), n: this.n, w: this.w, d: this.d, h };
    commitSegs(this.app, 'Arc', loopSegs(pts, false), { ...g, segs: this.segs, arc: true, radius: g.r });
    this.reset();
  }
  onVCB(s) {
    const m = s.match(/^(\d+)\s*s$/i);
    if (m) { this.segs = Math.max(2, +m[1]); if (!this.p.length && this.last) { this.app.undo(true); Object.assign(this, { p: this.last.p, n: this.last.n, w: this.last.w, d: this.last.d }); this.finish(this.last.h); } return true; }
    const v = this.app.units.parse(s); if (v == null) return false;
    if (this.p.length === 1 && this.cur) { const d = this.cur.p.clone().sub(this.p[0]).normalize(); this.p.push(this.p[0].clone().addScaledVector(d, v)); this.setupPlane(); return true; }
    if (this.p.length === 2) { this.finish(Math.sign(this.h || 1) * v); return true; }
    if (this.last) { this.app.undo(true); Object.assign(this, { p: this.last.p, n: this.last.n, w: this.last.w, d: this.last.d }); this.finish(Math.sign(this.last.h) * v); return true; }
    return false;
  }
  onKey(e) { if (this.p.length < 2 && this.arrowLock(e)) return true; if (e.key === 'Escape') { this.reset(); this.view.requestRender(); return true; } return false; }
  draw(ov) {
    if (this.p.length === 1 && this.cur) ov.line(this.p[0], this.cur.p, COL.black, 1.6, [5, 4]);
    if (this.p.length === 2) {
      const g = this.geom();
      if (g) ov.poly(arcPoints(g.center, g.n, g.xa, g.r, g.a0, g.a1, this.segs), this.tag ? COL.magenta : COL.black, null, 2, null, false);
      else ov.line(this.p[0], this.p[1], COL.black, 2);
    }
  }
}

export class ArcCenterTool extends Tool {
  constructor(app, pie = false) { super(app); this.pie = pie; this.id = pie ? 'pie' : 'arc'; this.cursor = pie ? 'pie' : 'arc'; this.segs = 12; this.hint = 'Click the center, click the start point, then click the end angle. Type an angle or "12s".'; }
  reset() { super.reset(); this.c = null; this.s = null; this.lockN = null; this.ang = 0; }
  onKey(e) {
    const ax = this.inf.axes(), map = { ArrowRight: ax[0], ArrowLeft: ax[1], ArrowUp: ax[2] };
    if (e.key in map && !this.s) { this.lockN = this.lockN && this.lockN.equals(map[e.key]) ? null : map[e.key].clone(); this.view.requestRender(); return true; }
    if (e.key === 'Escape') { this.reset(); this.view.requestRender(); return true; }
    return false;
  }
  onMove(ev) {
    if (!this.c) { const r = this.find(ev, {}); this.hov = r; this.setMarker(r); }
    else {
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
    if (!this.c) { const r = this.hov; if (!r) return; this.c = r.p.clone(); this.n = (this.lockN || planeFor(this, r, null)).normalize(); return; }
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
    commitSegs(this.app, this.pie ? 'Pie' : 'Arc', this.pie ? segs.slice(0, -2) : segs, { ...g, segs: this.segs, arc: true, radius: g.r });
    if (this.pie) commitSegs(this.app, 'Pie', segs.slice(-2), null, { n: this.n, p: this.c });
    this.reset();
  }
  onVCB(s) {
    const m = s.match(/^(\d+)\s*s$/i); if (m) { this.segs = Math.max(2, +m[1]); return true; }
    if (this.s) { const a = parseFloat(s); if (!isFinite(a)) return false; this.finish((a * Math.PI) / 180); return true; }
    if (this.c && this.cur) { const r = this.app.units.parse(s); if (r == null) return false; this.s = this.c.clone().addScaledVector(this.cur.clone().sub(this.c).normalize(), r); this.prevA = 0; return true; }
    return false;
  }
  draw(ov) {
    if (!this.c) { if (this.hov) { const n = this.lockN || planeFor(this, this.hov, null); drawProtractor(ov, this.hov.p, n, axisColorFor(this, n)); } return; }
    if (!this.s) { if (this.cur) ov.line(this.c, this.cur, COL.black, 1.6, [5, 4]); drawProtractor(ov, this.c, this.n, axisColorFor(this, this.n)); return; }
    const g = this.geom(); const pts = arcPoints(g.center, g.n, g.xa, g.r, g.a0, g.a1, this.segs);
    ov.poly(this.pie ? [this.c, ...pts] : pts, COL.black, this.pie ? 'rgba(70,110,200,0.12)' : null, 2, null, this.pie);
    ov.line(this.c, this.s, COL.gray, 1, [4, 4]);
  }
}

export class Arc3Tool extends Tool {
  constructor(app) { super(app); this.id = 'arc3'; this.cursor = 'arc'; this.segs = 12; this.hint = 'Click the start point, a point on the arc, then the end point.'; }
  reset() { super.reset(); this.p = []; this.cur = null; }
  onMove(ev) { const r = this.find(ev, { start: this.p[this.p.length - 1] }); this.cur = r; this.setMarker(r); this.view.requestRender(); }
  onDown() { if (!this.cur) return; this.p.push(this.cur.p.clone()); if (this.p.length === 3) { const g = this.geom(); if (g) { const pts = arcPoints(g.center, g.n, g.xa, g.r, 0, g.a1, this.segs); pts[0] = this.p[0]; pts[pts.length - 1] = this.p[2]; commitSegs(this.app, 'Arc', loopSegs(pts, false), { ...g, segs: this.segs, arc: true, radius: g.r, a0: 0 }); } this.reset(); } }
  geom(c = this.p[2] || (this.cur && this.cur.p)) {
    if (this.p.length < 2 || !c) return null;
    const [a, b] = this.p;
    const ab = b.clone().sub(a), ac = c.clone().sub(a), n = ab.clone().cross(ac);
    if (n.lengthSq() < 1e-6) return null;
    const center = a.clone().add(ac.clone().multiplyScalar(ab.lengthSq()).sub(ab.clone().multiplyScalar(ac.lengthSq())).cross(n).divideScalar(-2 * n.lengthSq())).add(new THREE.Vector3());
    // standard circumcenter: a + ((|ac|²(ab×ac)×ab + |ab|²(ac×(ab×ac))) / (2|ab×ac|²))
    const cc = a.clone().add(n.clone().cross(ab).multiplyScalar(ac.lengthSq()).add(ac.clone().cross(n).multiplyScalar(ab.lengthSq())).divideScalar(2 * n.lengthSq()));
    void center;
    const nn = n.clone().normalize(), r = cc.distanceTo(a), xa = a.clone().sub(cc).normalize(), ya = nn.clone().cross(xa);
    const q = c.clone().sub(cc);
    let a1 = Math.atan2(q.dot(ya), q.dot(xa)); if (a1 <= 0) a1 += Math.PI * 2;
    return { center: cc, n: nn, xa, r, a1 };
  }
  onKey(e) { if (e.key === 'Escape') { this.reset(); return true; } return false; }
  draw(ov) {
    if (this.p.length === 1 && this.cur) ov.line(this.p[0], this.cur.p, COL.black, 1.6, [5, 4]);
    if (this.p.length === 2) { const g = this.geom(); if (g) ov.poly(arcPoints(g.center, g.n, g.xa, g.r, 0, g.a1, this.segs), COL.black, null, 2, null, false); }
  }
}
