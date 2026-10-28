// Construction tools: Tape Measure, Protractor, Dimension, Text, Axes, Section Plane, 3D Text
import * as THREE from 'three';
import { Tool, isMac, planeFor, drawProtractor, axisColorFor, copyKey } from './base.js';
import { nid, addVertex, addFace, pushPull } from '../core/model.js';
import { rayPlane, basis, rad, area2 } from '../core/geom.js';
import { faceArea } from '../core/model.js';
import { COL } from '../view/overlay.js';

// ------------------------------------------------------------------ Tape Measure
export class TapeTool extends Tool {
  constructor(app) { super(app); this.id = 'tape'; this.cursor = 'tape'; this.vcbLabel = 'Length'; this.create = true; this.hint = `Click a start point, then an end point to measure. Start on an edge to create a parallel guide line. ${isMac ? '⌥' : 'Ctrl'} toggles guide creation. Type a new length after measuring to resize the model.`; }
  reset() { super.reset(); this.p0 = null; this.mode = null; this.cur = null; }
  onMove(ev) {
    const r = this.find(ev, { start: this.mode === 'point' ? this.p0 : null }); this.cur = r; this.setMarker(r);
    if (this.p0) {
      if (this.mode === 'edge') { const off = this.offsetVec(r.p); this.app.setVCB('Length', this.app.units.format(off.length())); }
      else this.app.setVCB('Length', this.app.units.format(r.p.distanceTo(this.p0)));
    }
    this.view.requestRender();
  }
  offsetVec(p) { const d = this.edir; const v = p.clone().sub(this.p0); return v.addScaledVector(d, -v.dot(d)); }
  onDown(ev) {
    const r = this.find(ev, { start: this.mode === 'point' ? this.p0 : null });
    if (!this.p0) {
      this.p0 = r.p.clone();
      if (r.type === 'edge' && r.edgeA) { this.mode = 'edge'; this.edir = r.edgeB.clone().sub(r.edgeA).normalize(); }
      else this.mode = 'point';
      return;
    }
    if (this.create) this.makeGuide(r.p);
    else this.lastMeasure = { a: this.p0.clone(), b: r.p.clone() };
    if (this.mode === 'point') this.lastMeasure = { a: this.p0.clone(), b: r.p.clone() };
    this.p0 = null; this.mode = null;
  }
  makeGuide(p, offLen = null) {
    const app = this.app;
    if (this.mode === 'edge') {
      let off = this.offsetVec(p);
      if (offLen != null) off = off.lengthSq() > 1e-9 ? off.normalize().multiplyScalar(offLen) : off;
      const q = this.p0.clone().add(off), d = this.edir.clone();
      app.commit('Guide', () => { const { ents, inv } = app.ctxInfo(); const id = nid(); ents.guides.set(id, { id, kind: 'line', p: q.applyMatrix4(inv), dir: d.transformDirection(inv) }); ents.touch(); });
    } else {
      let q = p.clone();
      if (offLen != null) q = this.p0.clone().addScaledVector(p.clone().sub(this.p0).normalize(), offLen);
      app.commit('Guide Point', () => { const { ents, inv } = app.ctxInfo(); const id = nid(); ents.guides.set(id, { id, kind: 'point', p: q.applyMatrix4(inv) }); ents.touch(); });
    }
  }
  onDbl(ev) {
    const r = this.find(ev, {});
    if (r.type === 'edge' && r.edgeA) {
      this.app.cancelLive?.(); this.p0 = null;
      const a = r.edgeA, d = r.edgeB.clone().sub(r.edgeA).normalize();
      this.app.commit('Guide', () => { const { ents, inv } = this.app.ctxInfo(); const id = nid(); ents.guides.set(id, { id, kind: 'line', p: a.clone().applyMatrix4(inv), dir: d.transformDirection(inv) }); ents.touch(); });
    }
  }
  onVCB(s) {
    const len = this.app.units.parse(s); if (len == null || len === 0) return false;
    if (this.p0 && this.cur) { this.makeGuide(this.cur.p, len); this.p0 = null; this.mode = null; return true; }
    if (this.lastMeasure) {
      const cur = this.lastMeasure.a.distanceTo(this.lastMeasure.b); if (cur < 0.01) return false;
      const f = len / cur;
      this.app.ui.confirm(`Do you want to resize the active model/context?\nScale factor: ${f.toFixed(4)}`, () => this.app.resizeContext(f));
      this.lastMeasure = null; return true;
    }
    return false;
  }
  onKey(e) {
    if (copyKey(e)) { this.create = !this.create; this.app.setCursor(this.create ? 'tape' : 'tape-minus'); return true; }
    if (this.arrowLock(e)) return true;
    if (e.key === 'Escape') { this.reset(); this.view.requestRender(); return true; }
    return false;
  }
  draw(ov) {
    if (!this.p0 || !this.cur) return;
    if (this.mode === 'edge') { const off = this.offsetVec(this.cur.p); const q = this.p0.clone().add(off); ov.line(q.clone().addScaledVector(this.edir, -1e5), q.clone().addScaledVector(this.edir, 1e5), '#333', 1, [6, 4]); ov.line(this.p0, q, COL.black, 1.4); }
    else { ov.line(this.p0, this.cur.p, COL.black, 1.6, [6, 4]); ov.label(this.p0.clone().add(this.cur.p).multiplyScalar(0.5), this.app.units.format(this.p0.distanceTo(this.cur.p))); }
  }
}

// ------------------------------------------------------------------ Protractor
export class ProtractorTool extends Tool {
  constructor(app) { super(app); this.id = 'protractor'; this.cursor = 'protractor'; this.vcbLabel = 'Angle'; this.hint = 'Click to place the protractor, click on the baseline, then click to create an angled guide. Type an angle.'; }
  reset() { super.reset(); this.c = null; this.s = null; this.ang = 0; this.lockN = null; }
  onKey(e) {
    const ax = this.inf.axes(), map = { ArrowRight: ax[0], ArrowLeft: ax[1], ArrowUp: ax[2] };
    if (e.key in map && !this.c) { this.lockN = map[e.key].clone(); return true; }
    if (e.key === 'Escape') { this.reset(); this.view.requestRender(); return true; }
    return false;
  }
  onMove(ev) {
    if (!this.c) { this.hov = this.find(ev, {}); this.setMarker(this.hov); this.view.requestRender(); return; }
    const r = this.find(ev, { lockPlane: { n: this.n, d: this.n.dot(this.c) }, start: this.c }); this.cur = r.p; this.setMarker(r);
    if (this.s) {
      const xa = this.s.clone().sub(this.c).normalize(), ya = this.n.clone().cross(xa), q = r.p.clone().sub(this.c);
      let a = Math.atan2(q.dot(ya), q.dot(xa)); const st = rad(this.model.units.angleSnap || 15), sn = Math.round(a / st) * st; if (Math.abs(a - sn) < rad(2.5)) a = sn;
      this.ang = a; this.app.setVCB('Angle', ((a * 180) / Math.PI).toFixed(1));
    }
    this.view.requestRender();
  }
  onDown() {
    if (!this.c) { if (!this.hov) return; this.c = this.hov.p.clone(); this.n = (this.lockN || planeFor(this, this.hov, null)).normalize(); return; }
    if (!this.s) { if (!this.cur || this.cur.distanceTo(this.c) < 0.01) return; this.s = this.cur.clone(); return; }
    this.make(this.ang);
  }
  make(a) {
    const xa = this.s.clone().sub(this.c).normalize(), d = xa.applyAxisAngle(this.n, a), c = this.c.clone();
    this.app.commit('Guide', () => { const { ents, inv } = this.app.ctxInfo(); const id = nid(); ents.guides.set(id, { id, kind: 'line', p: c.applyMatrix4(inv), dir: d.transformDirection(inv) }); ents.touch(); });
    this.reset();
  }
  onVCB(s) { const a = parseFloat(s); if (!this.s || !isFinite(a)) return false; this.make(rad(a) * (this.ang < 0 ? -1 : 1)); return true; }
  draw(ov) {
    const c = this.c || (this.hov && this.hov.p); if (!c) return;
    const n = this.c ? this.n : this.lockN || planeFor(this, this.hov, null);
    drawProtractor(ov, c, n, axisColorFor(this, n));
    if (this.c && this.cur) ov.line(this.c, this.s || this.cur, COL.gray, 1, [4, 4]);
    if (this.s) { const d = this.s.clone().sub(this.c).normalize().applyAxisAngle(this.n, this.ang); ov.line(this.c.clone().addScaledVector(d, -1e5), this.c.clone().addScaledVector(d, 1e5), '#333', 1, [6, 4]); }
  }
}

// ------------------------------------------------------------------ Dimension
export class DimensionTool extends Tool {
  constructor(app) { super(app); this.id = 'dimension'; this.cursor = 'dimension'; this.hint = 'Click two points (or click an edge, or a circle for a radius), then move to place the dimension and click.'; }
  reset() { super.reset(); this.a = null; this.b = null; this.cur = null; this.kind = 'linear'; }
  onMove(ev) {
    const r = this.find(ev, { start: this.b ? this.a.clone().add(this.b).multiplyScalar(0.5) : this.a }); this.cur = r; this.setMarker(this.b ? null : r);
    this.view.requestRender();
  }
  onDown(ev) {
    const r = this.find(ev, { start: this.a });
    if (!this.a) {
      if (r.type === 'edge' && r.edge) {
        const e = r.edge.ents.edges.get(r.edge.id);
        if (e && e.curve != null) {
          const c = r.edge.ents.curves.get(e.curve);
          if (c && c.radius > 0) {
            const m = this.app.worldMatrixOfPath(r.edge.path);
            this.kind = c.arc ? 'radius' : 'diameter';
            this.a = c.center.clone().applyMatrix4(m); this.b = r.p.clone(); this.r = c.radius;
            this.place(); return;
          }
        }
        this.a = r.edgeA.clone(); this.b = r.edgeB.clone(); return;
      }
      this.a = r.p.clone(); return;
    }
    if (!this.b) { if (r.p.distanceTo(this.a) < 0.01) return; this.b = r.p.clone(); return; }
    this.place();
  }
  offset() {
    if (!this.cur) return new THREE.Vector3();
    const d = this.b.clone().sub(this.a).normalize();
    const v = this.cur.p.clone().sub(this.a); return v.addScaledVector(d, -v.dot(d));
  }
  place() {
    const app = this.app, a = this.a.clone(), b = this.b.clone(), off = this.kind === 'linear' ? this.offset() : new THREE.Vector3(), kind = this.kind, r = this.r;
    app.commit('Dimension', () => {
      const { ents, inv } = app.ctxInfo(); const id = nid();
      const la = a.applyMatrix4(inv), lb = b.applyMatrix4(inv), lo = off.clone().transformDirection(inv).multiplyScalar(off.length());
      ents.dims.set(id, { id, a: la, b: lb, off: lo, kind, r, tag: 0 }); ents.touch();
    });
    this.reset();
  }
  onKey(e) { if (e.key === 'Escape') { this.reset(); this.view.requestRender(); return true; } return false; }
  draw(ov) {
    if (this.a && !this.b && this.cur) ov.line(this.a, this.cur.p, COL.black, 1, [4, 4]);
    if (this.a && this.b) {
      const off = this.offset(), A = this.a.clone().add(off), B = this.b.clone().add(off);
      ov.line(this.a, A, COL.black, 1); ov.line(this.b, B, COL.black, 1); ov.line(A, B, COL.black, 1); ov.arrowHead(B, A, COL.black); ov.arrowHead(A, B, COL.black);
      ov.label(A.clone().add(B).multiplyScalar(0.5), this.app.units.format(this.a.distanceTo(this.b)));
    }
  }
}

// ------------------------------------------------------------------ Text
export class TextTool extends Tool {
  constructor(app) { super(app); this.id = 'text'; this.cursor = 'text'; this.hint = 'Click an entity to attach leader text, move and click to place it. Click empty space for screen text.'; }
  reset() { super.reset(); this.at = null; }
  onMove(ev) {
    if (!this.at) { const r = this.find(ev, {}); this.setMarker(r.type === 'free' ? null : r); this.view.requestRender(); return; }
    const ray = this.view.rayAt(ev.x, ev.y), n = this.view.viewDir();
    this.p = rayPlane(ray.o, ray.d, n.clone().negate(), -n.dot(this.at)) || rayPlane(ray.o, ray.d, n, n.dot(this.at));
    this.view.requestRender();
  }
  defaultText(r) {
    const app = this.app;
    if (r.type === 'face' && r.hit) { const f = r.hit.face; return app.units.formatArea(faceArea(r.hit.ents, f)); }
    if (r.type === 'edge' && r.edgeA) return app.units.format(r.edgeA.distanceTo(r.edgeB));
    if (r.type === 'end' || r.type === 'mid' || r.type === 'center') { const p = r.p.clone().applyMatrix4(app.ctxInfo().inv); return `${app.units.format(p.x, { unit: false })}, ${app.units.format(p.y, { unit: false })}, ${app.units.format(p.z, { unit: false })}`; }
    return 'Text';
  }
  onDown(ev) {
    const app = this.app;
    if (!this.at) {
      const r = this.find(ev, {});
      if (r.type === 'free' && !r.hit) {
        const sx = ev.x / this.view.w, sy = ev.y / this.view.h;
        app.ui.prompt('Screen text', 'Text', (t) => { if (!t) return; app.commit('Text', () => { const { ents } = app.ctxInfo(); const id = nid(); ents.texts.set(id, { id, screen: true, sx, sy, text: t, p: new THREE.Vector3() }); ents.touch(); }); });
        return;
      }
      this.at = r.p.clone(); this.def = this.defaultText(r); this.p = this.at.clone();
      return;
    }
    const at = this.at, p = this.p || at.clone(), def = this.def;
    this.reset();
    app.ui.prompt('Leader text', def, (t) => {
      if (!t) return;
      app.commit('Text', () => { const { ents, inv } = app.ctxInfo(); const id = nid(); ents.texts.set(id, { id, p: p.clone().applyMatrix4(inv), at: at.clone().applyMatrix4(inv), text: t }); ents.touch(); });
    });
  }
  onKey(e) { if (e.key === 'Escape') { this.reset(); return true; } return false; }
  draw(ov) { if (this.at && this.p) { ov.line(this.at, this.p, COL.black, 1); ov.label(this.p, this.def, { border: '#999' }); } }
}

// ------------------------------------------------------------------ Axes
export class AxesTool extends Tool {
  constructor(app) { super(app); this.id = 'axes'; this.cursor = 'axes'; this.hint = 'Click to place the origin, then click along the red axis, then along the green axis.'; }
  reset() { super.reset(); this.p = []; this.cur = null; }
  onMove(ev) { const r = this.find(ev, { start: this.p[this.p.length - 1] }); this.cur = r; this.setMarker(r); this.view.requestRender(); }
  onDown() {
    if (!this.cur) return;
    this.p.push(this.cur.p.clone());
    if (this.p.length === 3) {
      const [o, a, b] = this.p;
      const x = a.clone().sub(o).normalize(); let y = b.clone().sub(o); y.addScaledVector(x, -y.dot(x)); y.normalize();
      if (y.lengthSq() < 0.5) { this.reset(); return; }
      const z = x.clone().cross(y);
      this.app.commit('Axes', () => { this.model.axesM = new THREE.Matrix4().makeBasis(x, y, z).setPosition(o); });
      this.app.setTool('select');
    }
  }
  onKey(e) { if (e.key === 'Escape') { this.reset(); return true; } return false; }
  draw(ov) {
    if (!this.p.length || !this.cur) return;
    ov.line(this.p[0], this.p.length === 1 ? this.cur.p : this.p[1], COL.red, 2);
    if (this.p.length === 2) ov.line(this.p[0], this.cur.p, COL.green, 2);
  }
}

// ------------------------------------------------------------------ Section Plane
export class SectionTool extends Tool {
  constructor(app) { super(app); this.id = 'section'; this.cursor = 'section'; this.hint = 'Click a face to place a section plane aligned with it. Arrow keys lock the orientation (→ red, ← green, ↑ blue).'; }
  reset() { super.reset(); this.lockN = null; }
  onKey(e) {
    const ax = this.inf.axes(), map = { ArrowRight: ax[0], ArrowLeft: ax[1], ArrowUp: ax[2] };
    if (e.key in map) { this.lockN = this.lockN && this.lockN.equals(map[e.key]) ? null : map[e.key].clone(); this.view.requestRender(); return true; }
    return false;
  }
  onMove(ev) { this.hov = this.find(ev, {}); this.setMarker(this.hov); this.view.requestRender(); }
  normal() {
    let n = this.lockN || planeFor(this, this.hov, null);
    if (this.lockN && n.dot(this.view.viewDir()) > 0) n = n.clone().negate();
    return n.clone().normalize();
  }
  onDown() {
    if (!this.hov) return;
    const p = this.hov.p.clone(), n = this.normal();
    const app = this.app;
    app.commit('Section Plane', () => {
      const { ents, inv } = app.ctxInfo(); const id = nid();
      const count = [...app.allSections()].length + 1;
      ents.sections.set(id, { id, p: p.applyMatrix4(inv), n: n.transformDirection(inv), name: 'Section Plane ' + count, symbol: String.fromCharCode(64 + count) });
      app.model.activeSection = id; ents.touch();
    });
    app.setTool('select');
  }
  draw(ov) {
    if (!this.hov) return;
    const n = this.normal(), p = this.hov.p, { u, v } = basis(n);
    const R = this.view.cam.ortho ? this.view.cam.orthoH * 0.08 : p.distanceTo(this.view.camera.position) * 0.08;
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => p.clone().addScaledVector(u, a * R).addScaledVector(v, b * R));
    ov.poly(c, COL.orange, 'rgba(236,122,18,0.1)', 2);
    for (const q of c) ov.line(q, q.clone().addScaledVector(n, -R * 0.3), COL.orange, 1.5);
  }
}

// ------------------------------------------------------------------ 3D Text (geometry builder)
let fontCache = {};
export async function loadFont(name = 'helvetiker_regular') {
  if (fontCache[name]) return fontCache[name];
  const { FontLoader } = await import('three/addons/loaders/FontLoader.js');
  const json = await (await fetch(`https://cdn.jsdelivr.net/npm/three@0.169.0/examples/fonts/${name}.typeface.json`)).json();
  return (fontCache[name] = new FontLoader().parse(json));
}
export async function build3DText(ents, text, opts) {
  const font = await loadFont(opts.bold ? 'helvetiker_bold' : 'helvetiker_regular');
  const shapes = font.generateShapes(text, opts.height);
  const div = 6;
  const faces = [];
  // alignment
  let minX = Infinity, maxX = -Infinity;
  for (const s of shapes) for (const p of s.getPoints(div)) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); }
  const shift = opts.align === 'center' ? -(minX + maxX) / 2 : opts.align === 'right' ? -maxX : -minX;
  for (const s of shapes) {
    const clean = (pts) => { const o = []; for (const p of pts) if (!o.length || Math.hypot(p.x - o[o.length - 1].x, p.y - o[o.length - 1].y) > 1e-3) o.push(p); if (o.length > 2 && Math.hypot(o[0].x - o[o.length - 1].x, o[0].y - o[o.length - 1].y) < 1e-3) o.pop(); return o; };
    let outer = clean(s.getPoints(div));
    if (area2(outer.map((p) => [p.x, p.y])) < 0) outer.reverse();
    const holes = s.holes.map((h) => { let hp = clean(h.getPoints(div)); if (area2(hp.map((p) => [p.x, p.y])) > 0) hp.reverse(); return hp; });
    const V = (p) => addVertex(ents, new THREE.Vector3(p.x + shift, 0, p.y));
    // build in XZ plane (upright, facing −Y)
    const loops = [outer.map(V).reverse(), ...holes.map((h) => h.map(V).reverse())];
    if (!opts.filled) { for (const l of loops) for (let i = 0; i < l.length; i++) { /* outline only */ void i; } }
    const f = addFace(ents, loops, {});
    if (f) faces.push(f);
  }
  if (!opts.filled) {
    for (const f of faces) ents.faces.delete(f.id), [...ents.edges.values()].forEach((e) => e.faces.delete(f.id));
  } else if (opts.extrude > 0) {
    for (const f of faces) {
      // ensure normal faces −Y so extrusion goes +Y (into the text "depth")
      if (f.n.y > 0) { /* already toward +Y */ }
      pushPull(ents, f.id, f.n.y < 0 ? -opts.extrude : opts.extrude);
    }
  }
  ents.touch();
}
export { faceArea };
