// Modify tools: Push/Pull, Move, Rotate, Scale, Offset, Follow Me
import * as THREE from 'three';
import { Tool, isMac, planeFor, drawProtractor, axisColorFor, copyKey } from './base.js';
import { pushPull, drawSegments, faceEdges, facePoly2 } from '../core/model.js';
import { transformSelection, copyInto, selVerts, settleGeometry, selectionBox, offsetFacePoints, offsetEdgesPoints, followMe, chainEdges, splitSel } from '../core/ops.js';
import { rayPlane, lineRay, pointSegDist, inRegion, rad } from '../core/geom.js';
import { COL } from '../view/overlay.js';

const MODKEY = isMac ? '⌥ Option' : 'Ctrl';

// ------------------------------------------------------------------ Push/Pull
export class PushPullTool extends Tool {
  constructor(app) { super(app); this.id = 'pushpull'; this.cursor = 'pushpull'; this.vcbLabel = 'Distance'; this.hint = `Click a face, move to extrude, click to finish. Double-click repeats the last distance. ${MODKEY} = create a new starting face.`; this.keep = false; }
  reset() { super.reset(); this.faceId = null; this.dist = 0; this.app.setHover([]); }
  onMove(ev) {
    if (this.faceId == null) {
      const k = this.app.pickEntity(ev.x, ev.y, { noEdges: true });
      this.app.setHover(k && !k.outside && k.key[0] === 'f' ? [k.key] : []);
      return;
    }
    const r = this.find(ev, { start: this.p0, lockDir: this.nW, noFace: false, skipFace: (ud) => ud.ents === this.app.ctxInfo().ents });
    this.dist = r.p.clone().sub(this.p0).dot(this.nW);
    this.setMarker(r.type === 'axis' ? { ...r, lines: [], label: r.label.includes('/') ? r.label.split(' / ')[1] : '' } : r);
    this.run(this.dist);
    this.app.setVCB('Distance', this.app.units.format(Math.abs(this.dist)));
  }
  run(d) {
    const s = this.scale, keep = this.keep, fid = this.faceId;
    this.app.liveRun((ents) => { pushPull(ents, fid, d / s, keep); });
  }
  start(ev) {
    const k = this.app.pickEntity(ev.x, ev.y, { noEdges: true });
    if (!k || k.outside || k.key[0] !== 'f') return false;
    const { ents, matrix } = this.app.ctxInfo();
    const f = ents.faces.get(+k.key.slice(1));
    const hit = this.view.pickFace(ev.x, ev.y);
    this.faceId = f.id;
    const nW = f.n.clone().transformDirection(matrix);
    this.scale = f.n.clone().applyMatrix4(new THREE.Matrix4().extractRotation(matrix).invert().multiply(matrix)).length() || 1;
    this.nW = nW;
    this.p0 = hit ? hit.point.clone() : this.find(ev, {}).p;
    this.app.setHover([]);
    this.app.beginLive('Push/Pull');
    this.downAt = { x: ev.x, y: ev.y };
    return true;
  }
  onDown(ev) { if (this.faceId == null) { this.start(ev); return; } this.finish(); }
  onUp(ev) { if (this.faceId != null && this.downAt && Math.hypot(ev.x - this.downAt.x, ev.y - this.downAt.y) > 8) this.finish(); this.downAt = null; }
  finish(d = this.dist) {
    if (Math.abs(d) < 0.01) { this.app.cancelLive(); this.reset(); return; }
    this.run(d);
    this.app.commitLive();
    PushPullTool.last = d; this.lastFace = this.faceId; this.lastKeep = this.keep;
    this.reset();
  }
  onDbl(ev) {
    if (PushPullTool.last == null) return;
    this.app.cancelLive(); this.reset();
    const k = this.app.pickEntity(ev.x, ev.y, { noEdges: true });
    if (!k || k.outside || k.key[0] !== 'f') return;
    const fid = +k.key.slice(1);
    this.app.commit('Push/Pull', () => pushPull(this.app.ctxInfo().ents, fid, PushPullTool.last, this.keep));
  }
  onVCB(s) {
    const d = this.app.units.parse(s); if (d == null) return false;
    if (this.faceId != null) { this.finish(Math.sign(this.dist || 1) * d); return true; }
    if (this.lastFace != null) {
      const sgn = Math.sign(PushPullTool.last || 1);
      this.app.undo(true);
      const fid = this.lastFace, keep = this.lastKeep;
      this.app.commit('Push/Pull', () => pushPull(this.app.ctxInfo().ents, fid, sgn * d, keep));
      PushPullTool.last = sgn * d; return true;
    }
    return false;
  }
  onKey(e) {
    if (copyKey(e)) { this.keep = !this.keep; this.app.setCursor(this.keep ? 'pushpull-plus' : 'pushpull'); if (this.faceId != null) this.run(this.dist); return true; }
    if (e.key === 'Escape') { this.cancel(); return true; }
    return false;
  }
}

// ------------------------------------------------------------------ shared: hover target + transform runner
class XformTool extends Tool {
  reset() { super.reset(); this.keys = null; this.copy = false; this.lockDir = null; this.shiftLock = null; this.app.setHover([]); }
  hoverTarget(ev) {
    if (this.app.sel.size) { this.app.setHover([]); return; }
    const k = this.app.pickEntity(ev.x, ev.y);
    this.app.setHover(k && !k.outside ? [k.key] : []);
  }
  takeTarget() {
    const app = this.app;
    if (app.sel.size) return new Set(app.sel);
    if (app.hover && app.hover.size) { const s = new Set(app.hover); app.setHover([]); app.applySelection([...s], 'set'); return s; }
    return null;
  }
  applyM(M) {
    // M is a world-space transform; convert to the context
    const { matrix, inv } = this.app.ctxInfo();
    const L = inv.clone().multiply(M).multiply(matrix);
    const keys = this.keys, model = this.model, copy = this.copy;
    let out = null;
    this.app.liveRun((ents) => {
      if (copy) out = copyInto(model, ents, keys, ents, L);
      else transformSelection(model, ents, keys, L);
    });
    this.newKeys = out;
    return L;
  }
  settle() {
    const { ents } = this.app.ctxInfo();
    if (this.copy) return;
    const vs = selVerts(ents, this.keys);
    if (vs.size) settleGeometry(ents, vs);
  }
  doArray(mats, label) {
    const app = this.app, keys = this.keys;
    app.commit(label, () => {
      const { ents } = app.ctxInfo();
      let last = null;
      for (const L of mats) last = copyInto(this.model, ents, keys, ents, L);
      if (last) app.setSelectionSilently(last);
    });
  }
  onKey(e) {
    if (copyKey(e)) { this.copy = !this.copy; this.app.setCursor(this.cursor + (this.copy ? '-plus' : '')); if (this.live) this.refresh?.(); return true; }
    if (this.arrowLock(e)) { this.refresh?.(); return true; }
    if (e.key === 'Escape') { this.cancel(); return true; }
    return false;
  }
}

// ------------------------------------------------------------------ Move
export class MoveTool extends XformTool {
  constructor(app) { super(app); this.id = 'move'; this.cursor = 'move'; this.vcbLabel = 'Distance'; this.hint = `Click to pick the base point, move, click to place. ${MODKEY} = copy, then type "x5" (array) or "/5" (divide). Arrow keys lock axes.`; }
  reset() { super.reset(); this.p0 = null; this.live = false; this.cur = null; }
  onMove(ev) {
    if (!this.live) { this.hoverTarget(ev); const r = this.find(ev, {}); this.setMarker(r); this.view.requestRender(); return; }
    const r = this.find(ev, { start: this.p0, lockDir: this.shiftLock || this.lockDir, skipFace: (ud) => ud.ents === this.app.ctxInfo().ents && ud.inCtx });
    this.cur = r; this.setMarker(r);
    this.t = r.p.clone().sub(this.p0);
    this.refresh();
    this.app.setVCB('Distance', this.app.units.format(this.t.length()));
  }
  refresh() { if (this.live && this.t) this.applyM(new THREE.Matrix4().makeTranslation(this.t.x, this.t.y, this.t.z)); }
  onDown(ev) {
    if (!this.live) {
      const keys = this.takeTarget(); if (!keys) return;
      this.keys = keys;
      this.p0 = this.find(ev, {}).p.clone();
      this.t = new THREE.Vector3();
      this.app.beginLive(this.copy ? 'Copy' : 'Move'); this.live = true;
      this.downAt = { x: ev.x, y: ev.y };
      if (this.placeMode) { this.placeMode = false; }
      return;
    }
    this.finish();
  }
  onUp(ev) { if (this.live && this.downAt && Math.hypot(ev.x - this.downAt.x, ev.y - this.downAt.y) > 8) this.finish(); this.downAt = null; }
  finish(t = this.t) {
    if (!t) return;
    this.t = t;
    const M = new THREE.Matrix4().makeTranslation(t.x, t.y, t.z);
    this.applyM(M);
    this.settleLive();
    this.app.commitLive();
    MoveTool.last = { keys: this.keys, t: t.clone(), copy: this.copy };
    if (this.copy && this.newKeys) this.app.setSelectionSilently(this.newKeys);
    const keep = this.copy;
    this.live = false; this.p0 = null; this.app.setHover([]); this.lockDir = null; this.copy = keep && false;
    this.view.overlay.marker = null;
  }
  settleLive() { if (!this.copy) { const { ents } = this.app.ctxInfo(); const vs = selVerts(ents, this.keys); if (vs.size) settleGeometry(ents, vs); ents.touch(); } }
  onVCB(s) {
    const app = this.app;
    const arr = s.match(/^\s*[x*]\s*(\d+)\s*$|^\s*(\d+)\s*[x*]\s*$/i), div = s.match(/^\s*\/\s*(\d+)\s*$|^\s*(\d+)\s*\/\s*$/);
    const L = MoveTool.last;
    if ((arr || div) && L && L.copy) {
      const n = +(arr ? arr[1] || arr[2] : div[1] || div[2]); if (!(n >= 1)) return false;
      app.undo(true);
      this.keys = L.keys;
      const { matrix, inv } = app.ctxInfo();
      const mats = [];
      if (arr) for (let i = 1; i <= n; i++) mats.push(inv.clone().multiply(new THREE.Matrix4().makeTranslation(L.t.x * i, L.t.y * i, L.t.z * i)).multiply(matrix));
      else for (let i = 1; i <= n; i++) mats.push(inv.clone().multiply(new THREE.Matrix4().makeTranslation((L.t.x * i) / n, (L.t.y * i) / n, (L.t.z * i) / n)).multiply(matrix));
      this.doArray(mats, arr ? 'Array' : 'Divide');
      return true;
    }
    const vals = app.units.parseList(s);
    if (vals.length === 3 && vals.every((x) => x != null)) {
      const t = new THREE.Vector3(...vals);
      if (this.live) { this.finish(t); return true; }
      if (L) { app.undo(true); this.keys = L.keys; this.copy = L.copy; app.beginLive('Move'); this.live = true; this.finish(t); return true; }
    }
    const d = app.units.parse(s); if (d == null) return false;
    if (this.live) { const dir = this.t && this.t.lengthSq() > 1e-9 ? this.t.clone().normalize() : (this.lockDir || new THREE.Vector3(1, 0, 0)); this.finish(dir.multiplyScalar(d)); return true; }
    if (L) { app.undo(true); this.keys = L.keys; this.copy = L.copy; app.beginLive('Move'); this.live = true; this.finish(L.t.clone().normalize().multiplyScalar(d)); return true; }
    return false;
  }
  onKey(e) {
    if (e.key === 'Shift' && this.live && this.cur && !this.shiftLock) { const d = this.cur.dir || this.t; if (d && d.lengthSq() > 1e-9) this.shiftLock = d.clone().normalize(); return true; }
    return super.onKey(e);
  }
  onKeyUp(e) { if (e.key === 'Shift') { this.shiftLock = null; return true; } return false; }
  // used by Paste / component placement: move a fresh selection with the cursor
  startPlacement(keys, base) {
    this.keys = new Set(keys); this.p0 = base.clone(); this.t = new THREE.Vector3(); this.copy = false;
    this.app.beginLive('Place'); this.live = true; this.placeMode = true;
  }
  draw(ov) {
    if (this.live && this.p0 && this.cur) { const col = this.cur.type === 'axis' ? this.cur.color : COL.black; ov.line(this.p0, this.cur.p, col, 1.6, [6, 4]); }
  }
}

// ------------------------------------------------------------------ Rotate
export class RotateTool extends XformTool {
  constructor(app) { super(app); this.id = 'rotate'; this.cursor = 'rotate'; this.vcbLabel = 'Angle'; this.hint = `Click to place the protractor, click a start point, then rotate and click. ${MODKEY} = copy (then "x6" / "/6"). Arrow keys lock the rotation axis.`; }
  reset() { super.reset(); this.c = null; this.s = null; this.live = false; this.ang = 0; this.lockN = null; }
  onKey(e) {
    const ax = this.inf.axes(), map = { ArrowRight: ax[0], ArrowLeft: ax[1], ArrowUp: ax[2] };
    if (e.key in map && !this.c) { this.lockN = this.lockN && this.lockN.equals(map[e.key]) ? null : map[e.key].clone(); this.view.requestRender(); return true; }
    if (copyKey(e)) { this.copy = !this.copy; this.app.setCursor('rotate' + (this.copy ? '-plus' : '')); if (this.live) this.refresh(); return true; }
    if (e.key === 'Escape') { this.cancel(); return true; }
    return false;
  }
  onMove(ev) {
    if (!this.c) { this.hoverTarget(ev); const r = this.find(ev, {}); this.hov = r; this.setMarker(r); this.view.requestRender(); return; }
    const r = this.find(ev, { lockPlane: { n: this.n, d: this.n.dot(this.c) }, start: this.c, skipFace: this.live ? (ud) => ud.ents === this.app.ctxInfo().ents && ud.inCtx : null });
    this.cur = r.p; this.setMarker(r);
    if (this.s) {
      const xa = this.s.clone().sub(this.c).normalize(), ya = this.n.clone().cross(xa), q = r.p.clone().sub(this.c);
      let a = Math.atan2(q.dot(ya), q.dot(xa));
      if (this.prevA != null) { while (a - this.prevA > Math.PI) a -= 2 * Math.PI; while (a - this.prevA < -Math.PI) a += 2 * Math.PI; }
      const step = rad(this.model.units.angleSnap || 15);
      const snap = Math.round(a / step) * step;
      if (Math.abs(a - snap) < rad(2.5)) a = snap;
      this.ang = a; this.prevA = a;
      this.refresh();
      this.app.setVCB('Angle', ((a * 180) / Math.PI).toFixed(1));
    }
    this.view.requestRender();
  }
  rotM(a = this.ang) {
    const c = this.c;
    return new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeRotationAxis(this.n, a)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  }
  refresh() { if (this.live) this.applyM(this.rotM()); }
  onDown(ev) {
    if (!this.c) {
      const keys = this.takeTarget(); if (!keys) { this.app.setStatus('Select something to rotate first.'); return; }
      this.keys = keys; const r = this.hov || this.find(ev, {});
      this.c = r.p.clone(); this.n = (this.lockN || planeFor(this, r, null)).normalize();
      return;
    }
    if (!this.s) { if (!this.cur || this.cur.distanceTo(this.c) < 0.01) return; this.s = this.cur.clone(); this.prevA = 0; this.app.beginLive(this.copy ? 'Copy' : 'Rotate'); this.live = true; return; }
    this.finish();
  }
  finish(a = this.ang) {
    this.ang = a; this.applyM(this.rotM(a)); this.settleLive();
    this.app.commitLive();
    RotateTool.last = { keys: this.keys, c: this.c.clone(), n: this.n.clone(), a, copy: this.copy };
    if (this.copy && this.newKeys) this.app.setSelectionSilently(this.newKeys);
    this.live = false; this.c = null; this.s = null; this.view.overlay.marker = null;
  }
  settleLive() { if (!this.copy) { const { ents } = this.app.ctxInfo(); const vs = selVerts(ents, this.keys); if (vs.size) settleGeometry(ents, vs); } }
  onVCB(s) {
    const app = this.app, L = RotateTool.last;
    const arr = s.match(/^\s*[x*]\s*(\d+)\s*$|^\s*(\d+)\s*[x*]\s*$/i), div = s.match(/^\s*\/\s*(\d+)\s*$|^\s*(\d+)\s*\/\s*$/);
    if ((arr || div) && L && L.copy) {
      const n = +(arr ? arr[1] || arr[2] : div[1] || div[2]);
      app.undo(true); this.keys = L.keys; this.c = L.c; this.n = L.n;
      const { matrix, inv } = app.ctxInfo();
      const mats = [];
      for (let i = 1; i <= n; i++) mats.push(inv.clone().multiply(this.rotM(arr ? L.a * i : (L.a * i) / n)).multiply(matrix));
      this.doArray(mats, arr ? 'Radial Array' : 'Divide');
      this.c = null; return true;
    }
    const a = parseFloat(s); if (!isFinite(a)) return false;
    if (this.live) { this.finish(rad(a) * (this.ang < 0 && a > 0 ? -1 : 1)); return true; }
    if (L) { app.undo(true); this.keys = L.keys; this.c = L.c; this.n = L.n; this.copy = L.copy; app.beginLive('Rotate'); this.live = true; this.finish(rad(a) * Math.sign(L.a || 1)); return true; }
    return false;
  }
  draw(ov) {
    const c = this.c || (this.hov && this.hov.p); if (!c) return;
    const n = this.c ? this.n : this.lockN || planeFor(this, this.hov, null);
    const rr = drawProtractor(ov, c, n, axisColorFor(this, n));
    if (this.c && this.cur) ov.line(this.c, this.s || this.cur, COL.gray, 1.2, [5, 4]);
    if (this.s && this.cur) {
      ov.line(this.c, this.c.clone().add(this.cur.clone().sub(this.c).normalize().multiplyScalar(Math.max(rr, this.s.distanceTo(this.c)))), COL.black, 1.4, [5, 4]);
    }
  }
}

// ------------------------------------------------------------------ Scale
export class ScaleTool extends XformTool {
  constructor(app) { super(app); this.id = 'scale'; this.cursor = 'scale'; this.vcbLabel = 'Scale'; this.hint = `Select geometry, then drag a green grip. ${MODKEY} = scale about center, Shift = uniform. Type a factor (e.g. 2 or 2,1.5) or a length (e.g. 1500mm).`; }
  reset() { super.reset(); this.grip = null; this.live = false; this.hg = null; this.computeGrips(); }
  computeGrips() {
    const app = this.app;
    this.grips = [];
    if (!app.sel.size) return;
    const { ents, matrix } = app.ctxInfo();
    const b = selectionBox(this.model, ents, app.sel);
    if (b.isEmpty()) return;
    this.box = b; this.keys = new Set(app.sel);
    const sz = b.getSize(new THREE.Vector3());
    const flat = [sz.x < 0.01, sz.y < 0.01, sz.z < 0.01];
    for (const i of [0, 0.5, 1]) for (const j of [0, 0.5, 1]) for (const k of [0, 0.5, 1]) {
      const g = [i, j, k];
      if (g.every((x) => x === 0.5)) continue;
      if (g.some((x, ax) => flat[ax] && x !== 0.5)) continue;
      const loc = new THREE.Vector3(b.min.x + sz.x * i, b.min.y + sz.y * j, b.min.z + sz.z * k);
      this.grips.push({ g, loc, w: loc.clone().applyMatrix4(matrix) });
    }
  }
  onActivate() { super.onActivate(); this.computeGrips(); this.view.requestRender(); }
  onMove(ev) {
    if (!this.live) {
      if (!this.app.sel.size) { this.hoverTarget(ev); return; }
      this.hg = null; let bd = 10;
      for (const gr of this.grips) { const q = this.view.project(gr.w); const d = Math.hypot(q.x - ev.x, q.y - ev.y); if (d < bd) { bd = d; this.hg = gr; } }
      this.view.requestRender(); return;
    }
    const { inv } = this.app.ctxInfo();
    const ray = this.view.rayAt(ev.x, ev.y);
    const o = ray.o.clone().applyMatrix4(inv), dd = ray.d.clone().transformDirection(inv);
    const dir = this.grip.loc.clone().sub(this.anchor); const L0 = dir.length(); dir.normalize();
    const r = lineRay(this.anchor, dir, o, dd); if (!r) return;
    let f = r.s / L0;
    if (Math.abs(f) < 1e-3) f = 1e-3 * Math.sign(f || 1);
    // snap to nice factors
    for (const nf of [1, -1, 0.5, 2, 0.25, 1.5, 3]) if (Math.abs(f - nf) < 0.015) f = nf;
    this.f = f; this.refresh();
    this.app.setVCB('Scale', this.factorStr());
  }
  axesOf(gr) { return gr.g.map((x) => x !== 0.5); }
  factors(f = this.f) {
    const ax = this.axesOf(this.grip);
    const uniform = ax.filter(Boolean).length === 3 ? !this.shift : this.shift;
    return ax.map((on) => (on || uniform ? f : 1));
  }
  factorStr() { return this.factors().filter((x, i) => this.axesOf(this.grip)[i]).map((x) => x.toFixed(3).replace(/\.?0+$/, '')).join(', '); }
  scaleM(fs) { const a = this.anchor; return new THREE.Matrix4().makeTranslation(a.x, a.y, a.z).multiply(new THREE.Matrix4().makeScale(...fs)).multiply(new THREE.Matrix4().makeTranslation(-a.x, -a.y, -a.z)); }
  refresh() {
    if (!this.live) return;
    const { matrix } = this.app.ctxInfo();
    const L = this.scaleM(this.factors());
    this.applyM(matrix.clone().multiply(L).multiply(matrix.clone().invert()));
  }
  onDown(ev) {
    if (!this.live) {
      if (!this.app.sel.size) { const k = this.takeTarget(); if (k) { this.computeGrips(); this.view.requestRender(); } return; }
      if (!this.hg) return;
      this.grip = this.hg; this.keys = new Set(this.app.sel);
      const b = this.box, sz = b.getSize(new THREE.Vector3());
      const about = this.center || ev.ctrl || ev.alt;
      this.anchor = about ? b.getCenter(new THREE.Vector3()) : new THREE.Vector3(...this.grip.g.map((x, i) => b.min.getComponent(i) + sz.getComponent(i) * (x === 0.5 ? 0.5 : 1 - x)));
      this.f = 1; this.app.beginLive('Scale'); this.live = true; this.downAt = { x: ev.x, y: ev.y };
      return;
    }
    this.finish();
  }
  onUp(ev) { if (this.live && this.downAt && Math.hypot(ev.x - this.downAt.x, ev.y - this.downAt.y) > 8) this.finish(); this.downAt = null; }
  finish() { this.refresh(); this.app.commitLive(); this.live = false; this.grip = null; this.computeGrips(); }
  onKey(e) {
    if (copyKey(e)) { this.center = !this.center; return true; }
    if (e.key === 'Shift') { this.shift = true; this.refresh(); return true; }
    if (e.key === 'Escape') { this.cancel(); this.computeGrips(); return true; }
    return false;
  }
  onKeyUp(e) { if (e.key === 'Shift') { this.shift = false; this.refresh(); return true; } return false; }
  onVCB(s) {
    if (!this.live && !this.grip) return false;
    const app = this.app, parts = s.split(/[,;]/).map((x) => x.trim());
    const ax = this.axesOf(this.grip), idx = ax.map((on, i) => (on ? i : -1)).filter((i) => i >= 0);
    const sz = this.box.getSize(new THREE.Vector3());
    const vals = parts.map((p, k) => { if (/[a-z'"]/i.test(p)) { const len = app.units.parse(p); const i = idx[Math.min(k, idx.length - 1)]; return len != null ? len / (sz.getComponent(i) || 1) : null; } const v = parseFloat(p); return isFinite(v) ? v : null; });
    if (vals.some((v) => v == null)) return false;
    let fs;
    if (vals.length === 1) fs = this.factors(vals[0]); else { fs = [1, 1, 1]; idx.forEach((i, k) => { fs[i] = vals[Math.min(k, vals.length - 1)]; }); }
    const { matrix } = app.ctxInfo();
    this.applyM(matrix.clone().multiply(this.scaleM(fs)).multiply(matrix.clone().invert()));
    app.commitLive(); this.live = false; this.grip = null; this.computeGrips();
    return true;
  }
  draw(ov) {
    if (!this.grips || !this.app.sel.size) return;
    if (this.box) {
      const { matrix } = this.app.ctxInfo(); const b = this.live ? null : this.box;
      if (b) { const c = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]].map(([i, j, k]) => new THREE.Vector3(b.min.x + (b.max.x - b.min.x) * i, b.min.y + (b.max.y - b.min.y) * j, b.min.z + (b.max.z - b.min.z) * k).applyMatrix4(matrix));
        for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) ov.line(c[i], c[j], '#d0a000', 1, [4, 3]); }
    }
    if (this.live) { const { matrix } = this.app.ctxInfo(); ov.dot(this.anchor.clone().applyMatrix4(matrix), COL.red, 4, 'square'); return; }
    for (const gr of this.grips) ov.dot(gr.w, gr === this.hg ? COL.red : '#18a83a', gr === this.hg ? 5 : 4, 'square');
  }
}

// ------------------------------------------------------------------ Offset
export class OffsetTool extends Tool {
  constructor(app) { super(app); this.id = 'offset'; this.cursor = 'offset'; this.vcbLabel = 'Distance'; this.hint = 'Click a face (or select edges first), move to offset, click to finish. Double-click repeats the last distance.'; }
  reset() { super.reset(); this.faceId = null; this.live = false; this.dist = 0; this.app.setHover([]); }
  onMove(ev) {
    if (!this.live) { const k = this.app.pickEntity(ev.x, ev.y, { noEdges: true }); this.app.setHover(k && !k.outside && k.key[0] === 'f' ? [k.key] : []); return; }
    const { matrix } = this.app.ctxInfo();
    const ray = this.view.rayAt(ev.x, ev.y);
    const p = rayPlane(ray.o, ray.d, this.nW, this.nW.dot(this.p0)) || rayPlane(ray.o, ray.d, this.nW.clone().negate(), -this.nW.dot(this.p0));
    if (!p) return;
    const lp = p.clone().applyMatrix4(this.app.ctxInfo().inv);
    void matrix;
    const ents = this.app.ctxInfo().ents;
    const base = this.liveFace;
    const { u, v, outer, holes } = base;
    const q = [lp.dot(u), lp.dot(v)];
    let md = Infinity;
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i], b = outer[(i + 1) % outer.length];
      const r = pointSegDist(new THREE.Vector3(q[0], q[1], 0), new THREE.Vector3(a[0], a[1], 0), new THREE.Vector3(b[0], b[1], 0));
      md = Math.min(md, r.dist);
    }
    const inside = inRegion(q, outer, holes);
    this.dist = inside ? -md : md;
    void ents;
    this.run(this.dist);
    this.app.setVCB('Distance', this.app.units.format(Math.abs(this.dist)));
  }
  run(d) {
    const fid = this.faceId, edges = this.edgeIds;
    this.app.liveRun((ents) => {
      if (edges) {
        const r = offsetEdgesPoints(ents, edges, d, this.nLocal); if (!r) return;
        const segs = []; for (let i = 0; i + 1 < r.pts.length + (r.closed ? 1 : 0); i++) segs.push([r.pts[i], r.pts[(i + 1) % r.pts.length]]);
        drawSegments(ents, segs);
      } else {
        const f = ents.faces.get(fid); if (!f || Math.abs(d) < 0.01) return;
        const pts = offsetFacePoints(ents, f, d);
        drawSegments(ents, pts.map((p, i) => [p, pts[(i + 1) % pts.length]]), { plane: { n: f.n, p: pts[0] } });
      }
    });
  }
  onDown(ev) {
    if (this.live) { this.finish(); return; }
    const app = this.app, { ents, matrix } = app.ctxInfo();
    const s = splitSel(app.sel);
    const k = app.pickEntity(ev.x, ev.y, { noEdges: true });
    this.edgeIds = null;
    if (s.edges.length && !s.faces.length) {
      const ch = chainEdges(ents, s.edges); if (!ch) return;
      const f = [...ents.edges.get(s.edges[0]).faces].map((x) => ents.faces.get(x))[0];
      this.nLocal = f ? f.n.clone() : new THREE.Vector3(0, 0, 1);
      this.edgeIds = s.edges;
      this.faceId = null;
      const hit = this.find(ev, {}); this.p0 = hit.p.clone(); this.nW = this.nLocal.clone().transformDirection(matrix);
      this.liveFace = { u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0), outer: ch.pts.map((p) => [p.x, p.y]), holes: [] };
    } else {
      const fid = s.faces.length === 1 ? s.faces[0] : k && !k.outside && k.key[0] === 'f' ? +k.key.slice(1) : null;
      if (fid == null) return;
      const f = ents.faces.get(fid);
      this.faceId = fid; this.liveFace = facePoly2(ents, f);
      this.nW = f.n.clone().transformDirection(matrix);
      const hit = this.view.pickFace(ev.x, ev.y); this.p0 = hit ? hit.point : ents.P(f.loops[0][0]).clone().applyMatrix4(matrix);
    }
    app.setHover([]);
    app.beginLive('Offset'); this.live = true; this.downAt = { x: ev.x, y: ev.y };
  }
  onUp(ev) { if (this.live && this.downAt && Math.hypot(ev.x - this.downAt.x, ev.y - this.downAt.y) > 8) this.finish(); this.downAt = null; }
  finish(d = this.dist) {
    if (Math.abs(d) < 0.01) { this.app.cancelLive(); this.reset(); return; }
    this.run(d); this.app.commitLive(); OffsetTool.last = d; this.lastFace = this.faceId; this.reset();
  }
  onDbl(ev) {
    if (OffsetTool.last == null) return;
    this.app.cancelLive(); this.reset();
    const k = this.app.pickEntity(ev.x, ev.y, { noEdges: true }); if (!k || k.outside || k.key[0] !== 'f') return;
    const fid = +k.key.slice(1), d = OffsetTool.last;
    this.app.commit('Offset', () => { const ents = this.app.ctxInfo().ents; const f = ents.faces.get(fid); const pts = offsetFacePoints(ents, f, d); drawSegments(ents, pts.map((p, i) => [p, pts[(i + 1) % pts.length]]), { plane: { n: f.n, p: pts[0] } }); });
  }
  onVCB(s) {
    const d = this.app.units.parse(s); if (d == null) return false;
    if (this.live) { this.finish(this.dist > 0 ? d : -d); return true; }
    if (this.lastFace != null) {
      const sg = Math.sign(OffsetTool.last || -1); this.app.undo(true);
      const fid = this.lastFace;
      this.app.commit('Offset', () => { const ents = this.app.ctxInfo().ents; const f = ents.faces.get(fid); const pts = offsetFacePoints(ents, f, sg * d); drawSegments(ents, pts.map((p, i) => [p, pts[(i + 1) % pts.length]]), { plane: { n: f.n, p: pts[0] } }); });
      OffsetTool.last = sg * d; return true;
    }
    return false;
  }
  onKey(e) { if (e.key === 'Escape') { this.cancel(); return true; } return false; }
}

// ------------------------------------------------------------------ Follow Me
export class FollowMeTool extends Tool {
  constructor(app) { super(app); this.id = 'followme'; this.cursor = 'followme'; this.hint = 'Select a path (edges or a face) first, then click the profile face. Or click the profile, then click an edge or face to use as the path.'; }
  reset() { super.reset(); this.profile = null; this.app.setHover([]); }
  onMove(ev) {
    const k = this.app.pickEntity(ev.x, ev.y, { edgesFirst: !!this.profile });
    this.app.setHover(k && !k.outside && (k.key[0] === 'f' || (this.profile && k.key[0] === 'e')) ? [k.key] : []);
  }
  pathFromSel(ents, sel) {
    const s = splitSel(sel);
    if (s.edges.length) {
      const ch = chainEdges(ents, s.edges.filter((id) => !this.profile || !faceEdges(ents, ents.faces.get(this.profile)).some((e) => e.id === id)));
      return ch;
    }
    if (s.faces.length) { const f = ents.faces.get(s.faces[0]); return { pts: f.loops[0].map((v) => ents.P(v).clone()), closed: true }; }
    return null;
  }
  onDown(ev) {
    const app = this.app, { ents } = app.ctxInfo();
    const k = app.pickEntity(ev.x, ev.y, { edgesFirst: !!this.profile });
    if (!k || k.outside) return;
    if (!this.profile) {
      if (k.key[0] !== 'f') return;
      const pid = +k.key.slice(1);
      const path = this.pathFromSel(ents, new Set([...app.sel].filter((x) => x !== k.key)));
      if (path) { this.run(pid, path); return; }
      this.profile = pid; app.setStatus('Now click an edge or a face to use as the path.');
      return;
    }
    let path = null;
    if (k.key[0] === 'f') { const f = ents.faces.get(+k.key.slice(1)); path = { pts: f.loops[0].map((v) => ents.P(v).clone()), closed: true }; }
    else if (k.key[0] === 'e') {
      // connected chain through vertices of degree 2 (excluding profile edges)
      const pe = new Set(faceEdges(ents, ents.faces.get(this.profile)).map((e) => e.id));
      const chain = new Set([+k.key.slice(1)]), stack = [+k.key.slice(1)];
      while (stack.length) {
        const e = ents.edges.get(stack.pop());
        for (const v of [e.a, e.b]) {
          const others = [...ents.vedges.get(v)].filter((x) => !pe.has(x));
          if (others.length !== 2) continue;
          for (const o of others) if (!chain.has(o)) { chain.add(o); stack.push(o); }
        }
      }
      path = chainEdges(ents, [...chain]);
    }
    if (path) this.run(this.profile, path);
    this.reset();
  }
  run(pid, path) {
    const app = this.app;
    app.commit('Follow Me', () => {
      const { ents } = app.ctxInfo();
      const f = ents.faces.get(pid); if (!f) return;
      let pts = path.pts.map((p) => p.clone()), closed = path.closed;
      // start the path where the profile sits
      const c = new THREE.Vector3(); for (const v of f.loops[0]) c.add(ents.P(v)); c.divideScalar(f.loops[0].length);
      const n = f.n, d = f.d;
      let ins = null;
      for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const da = n.dot(a) - d, db = n.dot(b) - d;
        if (da * db < 0) { const x = a.clone().lerp(b, da / (da - db)); if (!ins || x.distanceTo(c) < ins.x.distanceTo(c)) ins = { i, x }; }
      }
      if (ins && closed) { pts.splice(ins.i + 1, 0, ins.x); const k = ins.i + 1; pts = pts.slice(k).concat(pts.slice(0, k)); }
      else {
        let bi = 0; pts.forEach((p, i) => { if (p.distanceTo(c) < pts[bi].distanceTo(c)) bi = i; });
        if (closed) pts = pts.slice(bi).concat(pts.slice(0, bi));
        else if (bi > pts.length / 2) pts.reverse();
        if (ins && !closed) { /* profile in the middle of an open path: start there */ const k = ins.i + 1; pts = [ins.x, ...pts.slice(k)]; }
      }
      followMe(ents, f, pts, closed, { smoothAngle: rad(30) });
    });
    app.clearSelection();
  }
  onKey(e) { if (e.key === 'Escape') { this.reset(); return true; } return false; }
}
