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
  onActivate() { this.holdN = null; this.reset(); }
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
  return faceNormalAt(r) || tool.inf.axes()[2].clone();
}
// Normal of the face the inferred point lies on: the face itself, or — when the point snapped to an
// endpoint / midpoint / edge — the face under the cursor if that point lies in the face's plane.
export function faceNormalAt(r) {
  if (!r) return null;
  if (r.type === 'face' && r.normal) return r.normal.clone();
  const hit = r.hit;
  if (hit && hit.normal && onPlaneOf(hit, r.p)) return hit.normal.clone();
  return null;
}
export const onPlaneOf = (hit, p) => Math.abs(hit.normal.dot(p.clone().sub(hit.point))) < Math.max(0.5, hit.dist * 2e-4);

// ---------------------------------------------------------------- drawing plane
// Shared by the planar shape tools; chosen on the Plane bar above the viewport, in Draw › Drawing Plane
// or with the arrow keys. app.planeMode: 'auto' | 'h' horizontal (⟂ blue) | 'v' vertical facing the
// camera | 'x' vertical ⟂ red | 'y' vertical ⟂ green. Holding Shift keeps the plane shown under the cursor.
export const PLANE_TOOLS = new Set(['rect', 'circle', 'polygon', 'arc', 'arc2', 'arc3', 'pie', 'freehand']);
export const PLANE_KEYS = { ArrowUp: 'h', ArrowRight: 'x', ArrowLeft: 'y', ArrowDown: 'v' };
export function planeKey(tool, e) {
  const m = PLANE_KEYS[e.key]; if (!m) return false;
  tool.app.setPlaneMode(tool.app.planeMode === m ? 'auto' : m);
  return true;
}
// normal of the locked plane, or null in Auto
export function lockedNormal(tool, mode = tool.app.planeMode) {
  const ax = tool.inf.axes();
  if (mode === 'h') return ax[2].clone();
  if (mode === 'x') return ax[0].clone();
  if (mode === 'y') return ax[1].clone();
  if (mode === 'v') return facingVertical(tool);
  return null;
}
// the upright axis plane that faces the camera most (normal red or green)
export function facingVertical(tool) {
  const ax = tool.inf.axes(), v = tool.view;
  let d = v.viewDir(); d.addScaledVector(ax[2], -d.dot(ax[2]));
  if (d.lengthSq() < 0.02) { d = new THREE.Vector3().setFromMatrixColumn(v.camera.matrixWorld, 1); d.addScaledVector(ax[2], -d.dot(ax[2])); }
  return Math.abs(d.dot(ax[0])) >= Math.abs(d.dot(ax[1])) ? ax[0].clone() : ax[1].clone();
}
// plane of a shape tool at an inferred point: Shift-held, locked, face under the cursor, else horizontal
export function shapePlane(tool, r) { return tool.holdN ? tool.holdN.clone() : lockedNormal(tool) || planeFor(tool, r, null); }
// readable name + colour of a plane normal
export function planeInfo(tool, n) {
  const ax = tool.inf.axes(), a = ax.map((x) => Math.abs(x.dot(n)));
  if (a[2] > 0.9999) return { label: 'Horizontal', color: COL.blue };
  if (a[0] > 0.9999) return { label: 'Vertical (Red)', color: COL.red };
  if (a[1] > 0.9999) return { label: 'Vertical (Green)', color: COL.green };
  if (a[2] < 1e-3) return { label: 'Vertical', color: COL.magenta };
  return { label: 'Sloped', color: COL.magenta };
}
// show the current plane in the Plane bar read-out (null hides it)
export function notePlane(tool, n) {
  tool.app.ui?.setPlaneNow?.(n ? planeInfo(tool, n) : null, tool.holdN ? 'held' : tool.app.planeMode !== 'auto' ? 'locked' : 'auto');
}
// marker for a hovered point that also names the drawing plane (tooltip + Plane bar read-out)
export function planeMarker(tool, r, n, extra = '') {
  notePlane(tool, n);
  return { ...r, label: [r.label, extra, planeInfo(tool, n).label].filter(Boolean).join(' · ') };
}
// keys shared by the shape tools: arrows pick the plane, Shift (while hovering) keeps the plane under the cursor
export function shapeKey(tool, e, canHold) {
  if (planeKey(tool, e)) return true;
  if (e.key === 'Shift' && canHold && tool.hovN && !tool.holdN) { tool.holdN = tool.hovN.clone(); return true; }
  return false;
}
export function shapeKeyUp(tool, e) { if (e.key === 'Shift' && tool.holdN) { tool.holdN = null; return true; } return false; }
// small square lying in the drawing plane at the cursor (Rectangle / Freehand hover)
export function drawPlaneSquare(tool, ov, p, n, color) {
  const v = ov.view, s = (v.cam.ortho ? v.cam.orthoH : p.distanceTo(v.camera.position)) * 0.04;
  const { u, v: w } = planeBasisAxes(tool, n);
  ov.poly([p, p.clone().addScaledVector(u, s), p.clone().addScaledVector(u, s).addScaledVector(w, s), p.clone().addScaledVector(w, s)], color, tint(color, 0.14), 1.4);
}
export const tint = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
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
