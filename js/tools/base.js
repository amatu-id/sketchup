// Tool base class + shared helpers.
import * as THREE from 'three';
import { COL } from '../view/overlay.js';

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
// "Ctrl" modifier for tool toggles: Option on Mac, Ctrl on Windows (both accepted)
export const copyKey = (e) => e.key === 'Control' || e.key === 'Alt' || e.key === 'Option';
export const addMod = (ev) => ev.ctrl || ev.alt;

export class Tool {
  constructor(app) { this.app = app; this.state = 0; }
  get view() { return this.app.view; }
  get model() { return this.app.model; }
  get inf() { return this.app.inf; }
  onActivate() { this.reset(); }
  onDeactivate() { this.cancel(); }
  reset() { this.state = 0; this.app.view.overlay.marker = null; this.app.setVCB(this.vcbLabel || '', ''); }
  cancel() { if (this.live) this.app.cancelLive(); this.live = false; this.reset(); this.view.requestRender(); }
  status() { return this.hint || ''; }
  setMarker(r) { this.view.overlay.marker = r ? { p: r.p, type: r.type, label: r.label, color: r.color, lines: r.lines } : null; }
  // inference in world space
  find(ev, o = {}) { const r = this.inf.find(ev.x, ev.y, { ...o, lockDir: o.lockDir ?? this.lockDir, start: o.start }); return r; }
  toLocal(p) { return p.clone().applyMatrix4(this.app.ctxInfo().inv); }
  toWorld(p) { return p.clone().applyMatrix4(this.app.ctxInfo().matrix); }
  dirLocal(d) { return d.clone().transformDirection(this.app.ctxInfo().inv); }
  // Arrow keys lock axes like SketchUp: Right = red, Left = green, Up = blue, Down = parallel/perpendicular
  arrowLock(e, start) {
    const ax = this.inf.axes();
    const map = { ArrowRight: ax[0], ArrowLeft: ax[1], ArrowUp: ax[2] };
    if (e.key in map) { this.lockDir = this.lockDir && this.lockDir.equals(map[e.key]) ? null : map[e.key].clone(); return true; }
    if (e.key === 'ArrowDown') { const r = this.inf.refEdge; this.lockDir = r && !this.lockDir ? r.dir.clone() : null; return true; }
    void start;
    return false;
  }
  vcb(str) { void str; }
}

// Pick a drawing plane: face under cursor, locked axis or ground.
export function planeFor(tool, r, lockAxisN) {
  if (lockAxisN) return lockAxisN.clone();
  if (r && r.type === 'face' && r.normal) return r.normal.clone();
  if (r && r.hit && (r.type === 'end' || r.type === 'mid' || r.type === 'edge') && r.hit.point.distanceTo(r.p) < 1) return r.hit.normal.clone();
  return tool.inf.axes()[2].clone();
}
export function planeBasisAxes(tool, n) {
  const ax = tool.inf.axes();
  let u = null;
  for (const a of ax) { const pr = a.clone().addScaledVector(n, -a.dot(n)); if (pr.length() > 0.3) { u = pr.normalize(); break; } }
  if (!u) u = new THREE.Vector3(1, 0, 0);
  const v = n.clone().cross(u).normalize();
  return { u, v };
}
export function drawProtractor(ov, center, n, color, R = null) {
  const v = ov.view;
  const dist = center.distanceTo(v.camera.position);
  const rad = R || (v.cam.ortho ? v.cam.orthoH * 0.06 : dist * 0.06);
  let u = new THREE.Vector3(1, 0, 0); if (Math.abs(n.dot(u)) > 0.9) u = new THREE.Vector3(0, 1, 0);
  u = u.addScaledVector(n, -u.dot(n)).normalize();
  const w = n.clone().cross(u);
  const pts = [];
  for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; pts.push(center.clone().addScaledVector(u, Math.cos(a) * rad).addScaledVector(w, Math.sin(a) * rad)); }
  ov.poly(pts, color, null, 1.6, null, true);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2, k = i % 6 === 0 ? 0.78 : 0.9;
    const d = u.clone().multiplyScalar(Math.cos(a)).addScaledVector(w, Math.sin(a));
    ov.line(center.clone().addScaledVector(d, rad * k), center.clone().addScaledVector(d, rad), color, 1);
  }
  ov.dot(center, color, 3);
  return rad;
}
export const axisColorFor = (tool, n) => {
  const ax = tool.inf.axes();
  for (let i = 0; i < 3; i++) if (Math.abs(ax[i].dot(n)) > 0.9999) return [COL.red, COL.green, COL.blue][i];
  return COL.magenta;
};
