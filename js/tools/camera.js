// Camera tools: Orbit, Pan, Zoom, Zoom Window, Walk, Look Around, Position Camera
import * as THREE from 'three';
import { Tool } from './base.js';
import { COL } from '../view/overlay.js';

export class OrbitTool extends Tool {
  constructor(app) { super(app); this.id = 'orbit'; this.cursor = 'orbit'; this.hint = 'Drag to orbit. Shift = pan. Double-click to center the view on a point.'; }
  onDown(ev) { this.d = { x: ev.x, y: ev.y, pivot: this.view.navPivot(ev.x, ev.y) }; }
  onMove(ev) {
    if (!this.d || !(ev.buttons & 1)) return;
    const dx = ev.x - this.d.x, dy = ev.y - this.d.y; this.d.x = ev.x; this.d.y = ev.y;
    const src = ev.raw?.pointerType === 'touch' ? 'touch' : 'mouse';
    if (ev.shift) this.view.navPan(dx, dy, this.d.pivot, src); else this.view.navOrbit(dx, dy, this.d.pivot, src);
  }
  onUp() { this.d = null; this.view.pushHistory(); }
  onDbl(ev) { const h = this.view.pickFace(ev.x, ev.y); if (h) { const c = this.view.cam, d = h.point.clone().sub(c.target); this.view.animateTo({ eye: c.eye.clone().add(d), target: h.point }, 250); } }
  onKey(e) { if (e.key === 'Shift') { this.app.setCursor('pan'); return true; } return false; }
  onKeyUp(e) { if (e.key === 'Shift') { this.app.setCursor('orbit'); return true; } return false; }
}
export class PanTool extends Tool {
  constructor(app) { super(app); this.id = 'pan'; this.cursor = 'pan'; this.hint = 'Drag to pan the view.'; }
  onDown(ev) { this.d = { x: ev.x, y: ev.y, pivot: this.view.pivotAt(ev.x, ev.y) }; }
  onMove(ev) { if (!this.d || !(ev.buttons & 1)) return; this.view.navPan(ev.x - this.d.x, ev.y - this.d.y, this.d.pivot, ev.raw?.pointerType === 'touch' ? 'touch' : 'mouse'); this.d.x = ev.x; this.d.y = ev.y; }
  onUp() { this.d = null; this.view.pushHistory(); }
}
export class ZoomTool extends Tool {
  constructor(app) { super(app); this.id = 'zoom'; this.cursor = 'zoom'; this.hint = 'Drag up to zoom in, down to zoom out. Shift+drag changes the field of view. Type "35deg" for field of view or "50mm" for focal length.'; this.vcbLabel = 'Field of View'; }
  onActivate() { super.onActivate(); this.app.setVCB('Field of View', this.view.cam.fov.toFixed(1) + ' deg'); }
  onDown(ev) { this.d = { x: ev.x, y: ev.y, ox: ev.x, oy: ev.y }; }
  onMove(ev) {
    if (!this.d || !(ev.buttons & 1)) return;
    const dy = ev.y - this.d.y; this.d.y = ev.y;
    if (ev.shift) { this.view.fov(this.view.cam.fov + dy * 0.2); this.app.setVCB('Field of View', this.view.cam.fov.toFixed(1) + ' deg'); }
    else this.view.zoomAt(Math.exp(dy * 0.008 * (this.view.navCfg().zoomSpeed || 1)), this.d.ox, this.d.oy);
  }
  onUp() { this.d = null; this.view.pushHistory(); }
  onVCB(s) {
    const m = s.match(/^([\d.]+)\s*(deg|°)?$/i), f = s.match(/^([\d.]+)\s*mm$/i);
    if (f) { const fl = parseFloat(f[1]); this.view.fov((2 * Math.atan(24 / (2 * fl)) * 180) / Math.PI); }
    else if (m) this.view.fov(parseFloat(m[1]));
    else return false;
    this.app.setVCB('Field of View', this.view.cam.fov.toFixed(1) + ' deg');
    return true;
  }
}
export class ZoomWindowTool extends Tool {
  constructor(app) { super(app); this.id = 'zoomwindow'; this.cursor = 'zoomwindow'; this.hint = 'Drag a rectangle around the area to zoom into.'; }
  onDown(ev) { this.d = { x: ev.x, y: ev.y }; }
  onMove(ev) { if (!this.d) return; this.app.rubber = { x0: Math.min(this.d.x, ev.x), y0: Math.min(this.d.y, ev.y), x1: Math.max(this.d.x, ev.x), y1: Math.max(this.d.y, ev.y) }; this.view.requestRender(); }
  onUp() {
    const r = this.app.rubber; this.app.rubber = null; this.d = null;
    if (!r || r.x1 - r.x0 < 5) return;
    const v = this.view, cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    const f = Math.max((r.x1 - r.x0) / v.w, (r.y1 - r.y0) / v.h);
    const p = v.pivotAt(cx, cy), c = v.cam;
    if (c.ortho) { const d = p.clone().sub(c.target); d.addScaledVector(v.viewDir(), -d.dot(v.viewDir())); v.animateTo({ eye: c.eye.clone().add(d), target: c.target.clone().add(d), orthoH: c.orthoH * f }, 300); }
    else {
      const ray = v.rayAt(cx, cy);
      const dist = p.distanceTo(c.eye) * f;
      const fwd = v.viewDir();
      const newEye = p.clone().addScaledVector(ray.d, -dist);
      v.animateTo({ eye: newEye, target: newEye.clone().addScaledVector(fwd, dist) }, 300);
    }
    v.pushHistory();
    this.app.setTool(this.app.prevToolId || 'select');
  }
}
export class WalkTool extends Tool {
  constructor(app) { super(app); this.id = 'walk'; this.cursor = 'walk'; this.vcbLabel = 'Eye Height'; this.hint = 'Drag up/down to walk forward/back, left/right to turn. Shift = move up/down or sideways, Ctrl = run. Arrow keys walk too.'; }
  onActivate() { super.onActivate(); this.app.setVCB('Eye Height', this.app.units.format(this.view.cam.eye.z)); }
  onDown(ev) { this.d = { x: ev.x, y: ev.y }; this.loop(); }
  onMove(ev) { if (this.d && ev.buttons & 1) { this.dx = ev.x - this.d.x; this.dy = ev.y - this.d.y; this.sh = ev.shift; this.run = ev.ctrl || ev.alt; } }
  onUp() { this.d = null; this.dx = this.dy = 0; cancelAnimationFrame(this.raf); this.view.pushHistory(); }
  loop() {
    const step = () => {
      if (!this.d) return;
      this.walk((this.dx || 0) * 0.02, (this.dy || 0) * (this.run ? 0.8 : 0.25), this.sh);
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
  walk(turn, fwdAmt, side) {
    const c = this.view.cam;
    const fwd = c.target.clone().sub(c.eye); const L = fwd.length();
    const hf = new THREE.Vector3(fwd.x, fwd.y, 0).normalize();
    if (side) { c.eye.z -= fwdAmt * 4; c.target.z -= fwdAmt * 4; const right = hf.clone().cross(new THREE.Vector3(0, 0, 1)); c.eye.addScaledVector(right, turn * 40); c.target.addScaledVector(right, turn * 40); }
    else {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -turn * 0.03);
      const dir = fwd.clone().applyQuaternion(q);
      c.eye.addScaledVector(hf, -fwdAmt * 4);
      c.target.copy(c.eye).add(dir.setLength(L));
    }
    this.view.applyCamera();
    this.app.setVCB('Eye Height', this.app.units.format(c.eye.z));
  }
  onKey(e) {
    const m = { ArrowUp: [0, -40], ArrowDown: [0, 40], ArrowLeft: [-3, 0], ArrowRight: [3, 0] }[e.key];
    if (m) { this.walk(m[0], m[1], e.shiftKey); return true; }
    return false;
  }
  onVCB(s) { const h = this.app.units.parse(s); if (h == null) return false; const c = this.view.cam, dz = h - c.eye.z; c.eye.z += dz; c.target.z += dz; this.view.applyCamera(); return true; }
}
export class LookTool extends Tool {
  constructor(app) { super(app); this.id = 'look'; this.cursor = 'look'; this.vcbLabel = 'Eye Height'; this.hint = 'Drag to look around from the current eye position.'; }
  onActivate() { super.onActivate(); this.app.setVCB('Eye Height', this.app.units.format(this.view.cam.eye.z)); }
  onDown(ev) { this.d = { x: ev.x, y: ev.y }; }
  onMove(ev) {
    if (!this.d || !(ev.buttons & 1)) return;
    const dx = ev.x - this.d.x, dy = ev.y - this.d.y; this.d.x = ev.x; this.d.y = ev.y;
    const c = this.view.cam, fwd = c.target.clone().sub(c.eye), L = fwd.length();
    fwd.applyAxisAngle(new THREE.Vector3(0, 0, 1), dx * 0.004);
    const right = fwd.clone().cross(new THREE.Vector3(0, 0, 1)).normalize();
    const f2 = fwd.clone().applyAxisAngle(right, -dy * 0.004);
    if (Math.abs(f2.clone().normalize().z) < 0.98) fwd.copy(f2);
    c.target.copy(c.eye).add(fwd.setLength(L));
    this.view.applyCamera();
  }
  onUp() { this.d = null; this.view.pushHistory(); }
  onVCB(s) { return WalkTool.prototype.onVCB.call(this, s); }
}
export class PositionCameraTool extends Tool {
  constructor(app) { super(app); this.id = 'poscam'; this.cursor = 'poscam'; this.vcbLabel = 'Eye Height'; this.hint = 'Click to stand at a point (eye height above it), or drag from where you stand to where you look.'; this.eyeH = 1676; }
  onActivate() { super.onActivate(); this.app.setVCB('Eye Height', this.app.units.format(this.eyeH)); }
  onMove(ev) { const r = this.find(ev, {}); this.cur = r; this.setMarker(r); this.view.requestRender(); }
  onDown(ev) { this.d = { x: ev.x, y: ev.y, p: this.find(ev, {}).p }; }
  onUp(ev) {
    if (!this.d) return;
    const c = this.view.cam, p = this.d.p, eye = p.clone().add(new THREE.Vector3(0, 0, this.eyeH));
    let dir;
    if (Math.hypot(ev.x - this.d.x, ev.y - this.d.y) > 8) { const q = this.find(ev, {}).p; dir = q.clone().sub(p); dir.z = 0; }
    else { dir = c.target.clone().sub(c.eye); dir.z = 0; }
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
    this.view.setOrtho(false);
    this.view.animateTo({ eye, target: eye.clone().add(dir.normalize().multiplyScalar(3000)) }, 500);
    this.d = null;
    this.app.setTool('look');
  }
  onVCB(s) { const h = this.app.units.parse(s); if (h == null) return false; this.eyeH = h; this.app.setVCB('Eye Height', this.app.units.format(h)); return true; }
  draw(ov) { if (this.cur) ov.dot(this.cur.p, COL.blue, 3); }
}
