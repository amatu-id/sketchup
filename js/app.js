// Application core: state, undo/redo, edit contexts, selection, tools, keyboard.
import * as THREE from 'three';
import { Model, modelToJSON, modelFromJSON, entsToJSON, entsFromJSON, nid, faceArea, reverseFace, faceEdges, getEdge } from './core/model.js';
import { splitSel, entsBox, copyInto, deleteSelection, makeGroup, explodeInstance, cloneDef, transformSelection, selectionBox, intersectFaces, facesAsCutters, instanceCutters, connected, purgeDefs, transformEnts } from './core/ops.js';
import { Units } from './core/units.js';
import { Viewport } from './view/viewport.js';
import { Inference } from './view/inference.js';
import { isMac } from './tools/base.js';
import { SelectTool, EraserTool, PaintTool, eraseKeysIn } from './tools/select.js';
import { LineTool, FreehandTool, RectTool, RotRectTool, CircleTool, Arc2Tool, ArcCenterTool, Arc3Tool } from './tools/draw.js';
import { PushPullTool, MoveTool, RotateTool, ScaleTool, OffsetTool, FollowMeTool } from './tools/modify.js';
import { TapeTool, ProtractorTool, DimensionTool, TextTool, AxesTool, SectionTool } from './tools/construct.js';
import { OrbitTool, PanTool, ZoomTool, ZoomWindowTool, WalkTool, LookTool, PositionCameraTool } from './tools/camera.js';
import { SolidTool } from './tools/solid.js';
import { UI } from './ui/ui.js';
import { buildCommands, DEFAULT_KEYS } from './ui/commands.js';
import { cursorCSS } from './ui/icons.js';

const SETTINGS_KEY = 'amatu-sketch:settings', AUTOSAVE_KEY = 'amatu-sketch:autosave';

export class App {
  constructor(root) {
    this.root = root;
    this.listeners = {};
    this.settings = Object.assign({ trackpad: isMac, invertZoom: false, zoomSpeed: 1, tooltips: true, autosave: true, keys: {}, panels: null, toolbars: null, trayWidth: 300, theme: 'light' }, safeJSON(localStorage.getItem(SETTINGS_KEY)));
    // 2026-11-14: trackpad two-finger swipe (orbit + pan) defaults to 70 % — drop swipe speeds saved before that once
    if ((this.settings.navRev || 0) < 2) { delete this.settings.tpOrbitSpeed; delete this.settings.tpPanSpeed; this.settings.navRev = 2; this.saveSettings(); }
    this.planeMode = 'auto'; // drawing plane of the shape tools (Plane bar, Draw › Drawing Plane, arrow keys)
    this.model = new Model();
    this.units = new Units(this.model);
    this.sel = new Set(); this.hover = new Set(); this.ctxPath = [];
    this.undoStack = []; this.redoStack = [];
    this.matVersion = 1; this.geomVersion = 1;
    this.currentMaterial = null;
    this.fileName = null; this.fileHandle = null; this.dirty = false;
    this.ui = new UI(this, root);
    this.view = new Viewport(this, this.ui.viewportEl);
    this.inf = new Inference(this);
    this.tools = {};
    const T = [
      new SelectTool(this), new EraserTool(this), new PaintTool(this),
      new LineTool(this), new FreehandTool(this), new RectTool(this), new RotRectTool(this), new CircleTool(this), new CircleTool(this, true),
      new Arc2Tool(this), new ArcCenterTool(this), new Arc3Tool(this), new ArcCenterTool(this, true),
      new PushPullTool(this), new MoveTool(this), new RotateTool(this), new ScaleTool(this), new OffsetTool(this), new FollowMeTool(this),
      new TapeTool(this), new ProtractorTool(this), new DimensionTool(this), new TextTool(this), new AxesTool(this), new SectionTool(this),
      new OrbitTool(this), new PanTool(this), new ZoomTool(this), new ZoomWindowTool(this), new WalkTool(this), new LookTool(this), new PositionCameraTool(this),
      ...['union', 'subtract', 'intersect', 'trim', 'split', 'shell'].map((op) => new SolidTool(this, op)),
    ];
    for (const t of T) this.tools[t.id] = t;
    this.cmds = buildCommands(this);
    this.ui.build();
    this.bindKeys();
    this.setTool('select');
    this.view.rebuild();
    this.view.pushHistory();
    window.addEventListener('beforeunload', (e) => { if (this.dirty && !this.settings.autosave) { e.preventDefault(); e.returnValue = ''; } });
  }
  // ------------------------------------------------------------ events
  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  emit(ev, data) { for (const fn of this.listeners[ev] || []) fn(data); }
  saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch (e) { /* storage unavailable */ } }

  // ------------------------------------------------------------ contexts
  ctxInfo() {
    let ents = this.model.root, m = new THREE.Matrix4();
    for (let i = 0; i < this.ctxPath.length; i++) {
      const inst = ents.insts.get(this.ctxPath[i]);
      const def = inst && this.model.defs.get(inst.def);
      if (!def) { this.ctxPath = this.ctxPath.slice(0, i); break; }
      m = m.clone().multiply(inst.m); ents = def.ents;
    }
    return { ents, matrix: m, inv: m.clone().invert() };
  }
  ctxPathEq(path) { const c = this.ctxPath; return path && path.length === c.length && path.every((x, i) => x === c[i]); }
  worldMatrixOfPath(path) {
    let ents = this.model.root, m = new THREE.Matrix4();
    for (const id of path || []) { const inst = ents.insts.get(id); if (!inst) break; m = m.clone().multiply(inst.m); ents = this.model.defs.get(inst.def).ents; }
    return m;
  }
  forAllEnts(fn) { fn(this.model.root); for (const d of this.model.defs.values()) fn(d.ents); }
  findInst(id) { let r = this.model.root.insts.get(id); if (r) return r; for (const d of this.model.defs.values()) { r = d.ents.insts.get(id); if (r) return r; } return null; }
  *allSections() {
    const rec = function* (ents, m, path, model) {
      for (const s of ents.sections.values()) yield { sec: s, matrix: m, ents, path };
      for (const i of ents.insts.values()) { const d = model.defs.get(i.def); if (d) yield* rec(d.ents, m.clone().multiply(i.m), [...path, i.id], model); }
    };
    yield* rec(this.model.root, new THREE.Matrix4(), [], this.model);
  }
  findSection(id) { for (const s of this.allSections()) if (s.sec.id === id) return s; return null; }
  openContext(instId) {
    const { ents } = this.ctxInfo();
    const inst = ents.insts.get(instId); if (!inst) return;
    if (inst.locked) { this.toast('This group is locked. Unlock it to edit.'); return; }
    const def = this.model.defs.get(inst.def);
    if (def.group) {
      let refs = 0; this.forAllEnts((E) => { for (const i of E.insts.values()) if (i.def === def.id) refs++; });
      if (refs > 1) inst.def = cloneDef(this.model, def.id);
    }
    this.ctxPath = [...this.ctxPath, instId];
    this.sel.clear(); this.hover.clear();
    this.tool?.cancel?.();
    this.afterChange({ noHistory: true });
    this.setStatus(`Editing ${def.group ? 'group' : 'component'} “${inst.name || def.name}”. Click outside or press Esc to close.`);
  }
  closeContext(all = false) {
    if (!this.ctxPath.length) return;
    const last = this.ctxPath[this.ctxPath.length - 1];
    this.ctxPath = all ? [] : this.ctxPath.slice(0, -1);
    this.sel = new Set(all ? [] : ['i' + last]);
    purgeDefs(this.model);
    this.afterChange({ noHistory: true });
    this.setStatus(this.tool ? this.tool.status() : '');
  }

  // ------------------------------------------------------------ history
  snapshot() { return JSON.stringify({ m: modelToJSON(this.model), ctx: this.ctxPath, sel: [...this.sel] }); }
  restore(snap) {
    const o = JSON.parse(snap);
    this.model = modelFromJSON(o.m); this.units.model = this.model;
    this.ctxPath = o.ctx || []; this.ctxInfo();
    this.sel = new Set(o.sel || []);
    this.matVersion++;
  }
  commit(label, fn) {
    if (this.liveState) this.commitLive();
    const snap = this.snapshot();
    try { fn(); } catch (e) { console.error(e); this.restore(snap); this.afterChange({ noHistory: true }); this.toast('Could not complete: ' + label); return false; }
    this.undoStack.push({ label, snap }); if (this.undoStack.length > 120) this.undoStack.shift();
    this.redoStack = [];
    this.afterChange();
    return true;
  }
  undo(silent = false) {
    if (this.liveState) { this.cancelLive(); return; }
    this.tool?.cancel?.();
    const u = this.undoStack.pop(); if (!u) return;
    this.redoStack.push({ label: u.label, snap: this.snapshot() });
    this.restore(u.snap); this.afterChange({ noHistory: true });
    if (!silent) this.setStatus('Undo ' + u.label);
  }
  redo() {
    const r = this.redoStack.pop(); if (!r) return;
    this.undoStack.push({ label: r.label, snap: this.snapshot() });
    this.restore(r.snap); this.afterChange({ noHistory: true });
    this.setStatus('Redo ' + r.label);
  }
  afterChange(opts = {}) {
    const { ents } = this.ctxInfo();
    for (const k of [...this.sel]) if (!keyExists(ents, k)) this.sel.delete(k);
    for (const k of [...this.hover]) if (!keyExists(ents, k)) this.hover.delete(k);
    this.geomVersion++;
    this.view.rebuild();
    this.emit('model'); this.emit('selection');
    if (!opts.noHistory || opts.dirty) { this.dirty = true; this.scheduleAutosave(); this.ui.updateTitle(); }
  }
  // live preview of an operation in the active context (restored on every move)
  beginLive(label) {
    const { ents } = this.ctxInfo();
    this.liveState = { label, snap: this.snapshot(), json: entsToJSON(ents), ents, defsBefore: new Set(this.model.defs.keys()) };
    this.view.frozen = true;
  }
  liveRun(fn) {
    const L = this.liveState; if (!L) return;
    restoreInPlace(L.ents, L.json);
    for (const id of [...this.model.defs.keys()]) if (!L.defsBefore.has(id)) this.model.defs.delete(id);
    try { fn(L.ents); } catch (e) { console.error(e); }
    L.ents.touch(); this.geomVersion++;
    this.view.rebuild();
  }
  commitLive() {
    const L = this.liveState; if (!L) return;
    this.liveState = null; this.view.frozen = false;
    this.undoStack.push({ label: L.label, snap: L.snap }); this.redoStack = [];
    this.afterChange();
  }
  cancelLive() {
    const L = this.liveState; if (!L) return;
    restoreInPlace(L.ents, L.json);
    for (const id of [...this.model.defs.keys()]) if (!L.defsBefore.has(id)) this.model.defs.delete(id);
    this.liveState = null; this.view.frozen = false;
    this.afterChange({ noHistory: true });
  }
  scheduleAutosave() {
    if (!this.settings.autosave) return;
    clearTimeout(this._as);
    this._as = setTimeout(() => { try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ t: Date.now(), name: this.fileName, model: modelToJSON(this.model), cam: this.view.saveCamera() })); } catch (e) { /* quota */ } }, 1500);
  }
  autosaved() { return safeJSON(localStorage.getItem(AUTOSAVE_KEY)); }
  loadModel(json, name = null, cam = null) {
    this.tool?.cancel?.();
    this.model = modelFromJSON(json); this.units.model = this.model;
    this.ctxPath = []; this.sel.clear(); this.hover.clear();
    this.undoStack = []; this.redoStack = [];
    this.fileName = name; this.dirty = false;
    this.matVersion++;
    this.afterChange({ noHistory: true });
    if (cam) this.view.loadCamera(cam); else this.view.zoomExtents(null, false);
    this.ui.updateTitle();
    this.emit('materials');
  }
  newModel(template = 'mm') {
    this.loadModel(modelToJSON(new Model()), null);
    const u = this.model.units;
    if (template === 'm') { u.unit = 'm'; u.precision = 2; }
    else if (template === 'cm') { u.unit = 'cm'; u.precision = 1; }
    else if (template === 'arch') { u.unit = 'arch'; u.precision = 2; }
    else { u.unit = 'mm'; u.precision = 0; }
    if (template === 'plan') { this.view.standardView('top'); this.view.setOrtho(true); }
    else { this.view.loadCamera({ eye: [-7000, -9500, 6500], target: [1500, 1500, 600], fov: 35, ortho: false, orthoH: 8000 }); }
    this.ui.updateTitle(); this.emit('model');
  }

  // ------------------------------------------------------------ selection
  emitSel() { this.view.rebuildSelection(); this.emit('selection'); }
  setHover(keys) {
    const s = new Set(keys);
    if (s.size === this.hover.size && [...s].every((k) => this.hover.has(k))) return;
    this.hover = s; this.view.rebuildSelection();
  }
  applySelection(keys, mode = 'set') {
    if (mode === 'set') this.sel = new Set(keys);
    else for (const k of keys) {
      if (mode === 'add') this.sel.add(k);
      else if (mode === 'sub') this.sel.delete(k);
      else if (mode === 'toggle') { if (this.sel.has(k)) this.sel.delete(k); else this.sel.add(k); }
    }
    this.emitSel();
  }
  setSelectionSilently(keys) { this.sel = new Set(keys); this.emitSel(); }
  clearSelection() { if (!this.sel.size) return; this.sel.clear(); this.emitSel(); }
  selectAll() {
    const { ents } = this.ctxInfo(), s = new Set();
    for (const f of ents.faces.values()) if (!f.hidden) s.add('f' + f.id);
    for (const e of ents.edges.values()) if (!e.hidden) s.add('e' + e.id);
    for (const i of ents.insts.values()) if (!i.hidden) s.add('i' + i.id);
    for (const k of ['guides', 'dims', 'texts', 'sections']) for (const x of ents[k].values()) s.add({ guides: 'g', dims: 'd', texts: 't', sections: 's' }[k] + x.id);
    this.applySelection([...s], 'set');
  }
  invertSelection() {
    const old = new Set(this.sel); this.selectAll();
    this.applySelection([...this.sel].filter((k) => !old.has(k)), 'set');
  }
  // what is under the cursor in the active context
  pickEntity(x, y, opts = {}) {
    const v = this.view, ctx = this.ctxPath;
    // annotations
    for (const a of v.annots || []) {
      let p;
      if (a.type === 'dim') p = v.project(a.a.clone().add(a.off).add(a.b.clone().add(a.off)).multiplyScalar(0.5));
      else if (a.type === 'text') p = a.screen ? { x: a.sx * v.w + 30, y: a.sy * v.h } : v.project(a.p);
      else p = v.project(a.p);
      if (p.behind) continue;
      if (Math.abs(p.x - x) < (a.type === 'text' ? 45 : 32) && Math.abs(p.y - y) < 10) return this.mapPath(a.path, a.key);
    }
    for (const h of v.sectionHandles || []) {
      for (let i = 0; i < 4; i++) {
        const s = v.overlay.seg(h.sq[i], h.sq[(i + 1) % 4]); if (!s) continue;
        const [a, b] = s, ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey;
        const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / (l2 || 1)));
        if (Math.hypot(a.x + ex * t - x, a.y + ey * t - y) < 5) return this.mapPath(h.path, 's' + h.id);
      }
    }
    const hit = v.pickFace(x, y);
    if (!opts.noEdges) {
      const e = this.inf.pickEdge(x, y, opts.edgesFirst ? 9 : 6, hit);
      if (e && (opts.edgesFirst || !hit || e.dist <= hit.dist + Math.max(5, hit.dist * 0.01))) return this.mapPath(e.ref.path, 'e' + e.ref.id);
    }
    if (hit) {
      const r = this.mapPath(hit.path, 'f' + hit.faceId);
      if (r && r.key[0] === 'f' && opts.noFaces) return null;
      if (r) r.back = hit.back;
      return r;
    }
    // guide lines
    for (const g of v.index.guides) {
      if (!this.ctxPathEq(g.path)) continue;
      const s = v.overlay.seg(g.p.clone().addScaledVector(g.d, -1e5), g.p.clone().addScaledVector(g.d, 1e5)); if (!s) continue;
      const [a, b] = s, ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey;
      const t = ((x - a.x) * ex + (y - a.y) * ey) / (l2 || 1);
      if (Math.hypot(a.x + ex * t - x, a.y + ey * t - y) < 5) return { key: 'g' + g.id };
    }
    void ctx;
    return null;
  }
  mapPath(path, key) {
    const c = this.ctxPath;
    if (!path) return null;
    for (let i = 0; i < c.length; i++) if (path[i] !== c[i]) return { outside: true };
    if (path.length === c.length) return { key };
    if (path.length < c.length) return { outside: true };
    return { key: 'i' + path[c.length] };
  }
  keysInRect(r, crossing) {
    const v = this.view, { ents, matrix } = this.ctxInfo(), out = [];
    const inR = (q) => !q.behind && q.x >= r.x0 && q.x <= r.x1 && q.y >= r.y0 && q.y <= r.y1;
    const P = (p) => v.project(p.clone().applyMatrix4(matrix));
    const segHits = (a, b) => { if (a.behind || b.behind) return false; if (inR(a) || inR(b)) return true; return segRect(a, b, r); };
    for (const e of ents.edges.values()) {
      if (e.hidden && !this.model.style.hidden) continue;
      const a = P(ents.P(e.a)), b = P(ents.P(e.b));
      if (crossing ? segHits(a, b) : inR(a) && inR(b)) out.push('e' + e.id);
    }
    for (const f of ents.faces.values()) {
      if (f.hidden && !this.model.style.hidden) continue;
      const pts = f.loops[0].map((id) => P(ents.P(id)));
      let ok;
      if (crossing) { ok = pts.some(inR) || pts.some((p, i) => segHits(p, pts[(i + 1) % pts.length])) || pointInPoly2([(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2], pts); }
      else ok = pts.every(inR);
      if (ok) out.push('f' + f.id);
    }
    for (const i of ents.insts.values()) {
      if (i.hidden) continue;
      const def = this.model.defs.get(i.def); if (!def) continue;
      const b = entsBox(this.model, def.ents);
      if (b.isEmpty()) continue;
      const m = matrix.clone().multiply(i.m);
      const cs = [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z) => v.project(new THREE.Vector3(x ? b.max.x : b.min.x, y ? b.max.y : b.min.y, z ? b.max.z : b.min.z).applyMatrix4(m)))));
      let ok = crossing ? cs.some(inR) || (Math.min(...cs.map((q) => q.x)) < r.x1 && Math.max(...cs.map((q) => q.x)) > r.x0 && Math.min(...cs.map((q) => q.y)) < r.y1 && Math.max(...cs.map((q) => q.y)) > r.y0) : cs.every(inR);
      if (ok) out.push('i' + i.id);
    }
    for (const a of v.annots || []) {
      if (!this.ctxPathEq(a.path)) continue;
      const p = a.type === 'dim' ? v.project(a.a.clone().add(a.b).multiplyScalar(0.5).add(a.off)) : a.screen ? { x: a.sx * v.w, y: a.sy * v.h } : v.project(a.p);
      if (inR(p)) out.push(a.key);
    }
    for (const g of ents.guides.values()) if (g.kind === 'point' && inR(P(g.p))) out.push('g' + g.id);
    return out;
  }

  // ------------------------------------------------------------ editing helpers
  eraseKeys(keys) { const { ents } = this.ctxInfo(); eraseKeysIn(this, ents, keys); }
  hideKey(ents, k) {
    const id = +k.slice(1);
    if (k[0] === 'f') { const f = ents.faces.get(id); if (f) f.hidden = true; }
    else if (k[0] === 'e') { const e = ents.edges.get(id); if (e) e.hidden = true; }
    else if (k[0] === 'i') { const i = ents.insts.get(id); if (i) i.hidden = true; }
  }
  deleteSelected() {
    if (!this.sel.size) return;
    const keys = [...this.sel];
    this.commit('Erase', () => { const { ents } = this.ctxInfo(); eraseKeysIn(this, ents, keys); });
  }
  copySel(cut = false) {
    if (!this.sel.size) return;
    const { ents } = this.ctxInfo();
    const box = selectionBox(this.model, ents, this.sel);
    const tmp = new (ents.constructor)();
    copyInto(this.model, ents, this.sel, tmp, new THREE.Matrix4(), { uniqueGroups: false, merge: false });
    const defs = new Set();
    const collect = (E) => { for (const i of E.insts.values()) if (!defs.has(i.def)) { defs.add(i.def); collect(this.model.defs.get(i.def).ents); } };
    collect(tmp);
    this.clipboard = { ents: entsToJSON(tmp), defs: [...defs].map((id) => { const d = this.model.defs.get(id); return { ...d, ents: entsToJSON(d.ents) }; }), base: box.isEmpty() ? [0, 0, 0] : box.min.toArray() };
    try { localStorage.setItem('amatu-sketch:clip', JSON.stringify(this.clipboard)); } catch (e) { /* ignore */ }
    if (cut) this.deleteSelected();
  }
  paste(inPlace = false) {
    const clip = this.clipboard || safeJSON(localStorage.getItem('amatu-sketch:clip'));
    if (!clip) return;
    let keys;
    this.commit('Paste', () => {
      const { ents } = this.ctxInfo();
      const idMap = new Map();
      for (const d of clip.defs) {
        if (this.model.defs.has(d.id)) { idMap.set(d.id, d.id); continue; }
        this.model.defs.set(d.id, { ...d, ents: entsFromJSON(d.ents) });
      }
      const tmp = entsFromJSON(clip.ents);
      const all = new Set([...tmp.faces.keys()].map((x) => 'f' + x).concat([...tmp.edges.keys()].map((x) => 'e' + x), [...tmp.insts.keys()].map((x) => 'i' + x), [...tmp.guides.keys()].map((x) => 'g' + x), [...tmp.dims.keys()].map((x) => 'd' + x), [...tmp.texts.keys()].map((x) => 't' + x)));
      keys = copyInto(this.model, tmp, all, ents, new THREE.Matrix4(), { merge: false });
    });
    this.applySelection([...keys], 'set');
    if (!inPlace) {
      this.setTool('move');
      const base = new THREE.Vector3(...clip.base).applyMatrix4(this.ctxInfo().matrix);
      this.tools.move.startPlacement(keys, base);
    }
  }
  makeGroupCmd(component = false, opts = {}) {
    if (!this.sel.size) return null;
    let inst;
    this.commit(component ? 'Make Component' : 'Make Group', () => { const { ents } = this.ctxInfo(); inst = makeGroup(this.model, ents, this.sel, { component, ...opts }); });
    if (inst) this.applySelection(['i' + inst.id], 'set');
    return inst;
  }
  explodeSel() {
    const s = splitSel(this.sel); if (!s.insts.length) return;
    let out = new Set();
    this.commit('Explode', () => { const { ents } = this.ctxInfo(); for (const id of s.insts) for (const k of explodeInstance(this.model, ents, id)) out.add(k); });
    this.applySelection([...out], 'set');
  }
  intersect(mode = 'model') {
    const s = splitSel(this.sel);
    this.commit('Intersect Faces', () => {
      const { ents, matrix } = this.ctxInfo();
      let targets = facesAsCutters(this.model, ents, s.faces);
      for (const id of s.insts) { const i = ents.insts.get(id); const d = this.model.defs.get(i.def); targets.push(...facesAsCutters(this.model, d.ents, [...d.ents.faces.keys()], i.m)); }
      let cutters;
      if (mode === 'selection') cutters = targets;
      else { cutters = facesAsCutters(this.model, ents, [...ents.faces.keys()]); instanceCutters(this.model, ents, new THREE.Matrix4(), cutters); }
      if (mode === 'model' && this.ctxPath.length) { const inv = matrix.clone().invert(); const outer = []; instanceCutters(this.model, this.model.root, new THREE.Matrix4(), outer); for (const c of outer) { c.loops = c.loops.map((l) => l.map((p) => p.clone().applyMatrix4(inv))); c.n = c.n.clone().transformDirection(inv); c.d = c.n.dot(c.loops[0][0]); } cutters.push(...outer); }
      intersectFaces(ents, targets, cutters);
    });
  }
  reverseFaces() { const s = splitSel(this.sel); if (!s.faces.length) return; this.commit('Reverse Faces', () => { const { ents } = this.ctxInfo(); for (const id of s.faces) reverseFace(ents, ents.faces.get(id)); ents.touch(); }); }
  orientFaces() {
    const s = splitSel(this.sel); if (!s.faces.length) return;
    this.commit('Orient Faces', () => {
      const { ents } = this.ctxInfo(); const seen = new Set([s.faces[0]]), stack = [s.faces[0]];
      while (stack.length) {
        const f = ents.faces.get(stack.pop());
        for (const loop of f.loops) for (let i = 0; i < loop.length; i++) {
          const a = loop[i], b = loop[(i + 1) % loop.length], e = getEdge(ents, a, b); if (!e || e.faces.size !== 2) continue;
          for (const gid of e.faces) {
            if (seen.has(gid)) continue; const g = ents.faces.get(gid);
            const same = g.loops.some((l) => l.some((x, j) => x === a && l[(j + 1) % l.length] === b));
            if (same) reverseFace(ents, g);
            seen.add(gid); stack.push(gid);
          }
        }
      }
      ents.touch();
    });
  }
  flipAlong(axis) {
    if (!this.sel.size) return;
    this.commit('Flip', () => {
      const { ents } = this.ctxInfo(); const b = selectionBox(this.model, ents, this.sel); const c = b.getCenter(new THREE.Vector3());
      const s = [1, 1, 1]; s[axis] = -1;
      const M = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeScale(...s)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
      transformSelection(this.model, ents, this.sel, M);
    });
  }
  resizeContext(f) {
    this.commit('Resize Model', () => {
      const { ents } = this.ctxInfo(); const M = new THREE.Matrix4().makeScale(f, f, f);
      const all = new Set([...ents.faces.keys()].map((x) => 'f' + x).concat([...ents.edges.keys()].map((x) => 'e' + x), [...ents.insts.keys()].map((x) => 'i' + x), [...ents.guides.keys()].map((x) => 'g' + x), [...ents.dims.keys()].map((x) => 'd' + x), [...ents.texts.keys()].map((x) => 't' + x)));
      transformSelection(this.model, ents, all, M);
      for (const c of ents.curves.values()) { c.center.multiplyScalar(f); c.radius *= f; }
    });
    this.view.zoomExtents();
  }
  unhide(mode) {
    this.commit('Unhide', () => {
      const { ents } = this.ctxInfo();
      const sel = splitSel(this.sel);
      const all = mode === 'all';
      for (const f of ents.faces.values()) if (all || sel.faces.includes(f.id)) f.hidden = false;
      for (const e of ents.edges.values()) if (all || sel.edges.includes(e.id)) e.hidden = false;
      for (const i of ents.insts.values()) if (all || sel.insts.includes(i.id) || (mode === 'last' && i.id === this.lastHidden)) i.hidden = false;
      ents.touch();
    });
  }
  hideSel() {
    if (!this.sel.size) return;
    const keys = [...this.sel];
    this.commit('Hide', () => { const { ents } = this.ctxInfo(); for (const k of keys) { this.hideKey(ents, k); if (k[0] === 'i') this.lastHidden = +k.slice(1); } ents.touch(); });
    this.clearSelection();
  }
  setLock(lock) { const s = splitSel(this.sel); if (!s.insts.length) return; this.commit(lock ? 'Lock' : 'Unlock', () => { const { ents } = this.ctxInfo(); for (const id of s.insts) ents.insts.get(id).locked = lock; ents.touch(); }); }
  editText(id) {
    const { ents } = this.ctxInfo(); const t = ents.texts.get(id); if (!t) return;
    this.ui.prompt('Edit text', t.text, (v) => { if (v == null) return; this.commit('Edit Text', () => { t.text = v; ents.touch(); }); });
  }
  setCurrentMaterial(id) { this.currentMaterial = id; this.emit('current-material'); if (this.tool?.id !== 'paint') this.setTool('paint'); }
  areaOfSelection() {
    const { ents } = this.ctxInfo(); let a = 0;
    for (const k of this.sel) if (k[0] === 'f') a += faceArea(ents, ents.faces.get(+k.slice(1)));
    return a;
  }
  selectSimilar(kind) {
    const { ents } = this.ctxInfo(); const s = splitSel(this.sel), out = new Set(this.sel);
    if (kind === 'connected') { for (const k of connected(ents, [...this.sel].filter((k) => k[0] === 'e' || k[0] === 'f'))) out.add(k); }
    else if (kind === 'material') { const mats = new Set(s.faces.map((id) => ents.faces.get(id).mat)); for (const f of ents.faces.values()) if (mats.has(f.mat)) out.add('f' + f.id); }
    else if (kind === 'tag') { const tags = new Set([...s.faces.map((id) => ents.faces.get(id).tag), ...s.edges.map((id) => ents.edges.get(id).tag), ...s.insts.map((id) => ents.insts.get(id).tag)]); for (const f of ents.faces.values()) if (tags.has(f.tag)) out.add('f' + f.id); for (const e of ents.edges.values()) if (tags.has(e.tag)) out.add('e' + e.id); for (const i of ents.insts.values()) if (tags.has(i.tag)) out.add('i' + i.id); }
    else if (kind === 'instances') { const defs = new Set(s.insts.map((id) => ents.insts.get(id).def)); this.forAllEnts((E) => { if (E === ents) for (const i of E.insts.values()) if (defs.has(i.def)) out.add('i' + i.id); }); }
    else if (kind === 'bounding') { for (const id of s.faces) for (const e of faceEdges(ents, ents.faces.get(id))) out.add('e' + e.id); }
    this.applySelection([...out], 'set');
  }
  zoomSelection() {
    const { ents, matrix } = this.ctxInfo();
    const b = this.sel.size ? selectionBox(this.model, ents, this.sel, matrix) : null;
    this.view.zoomExtents(b && !b.isEmpty() ? b : null);
  }

  // ------------------------------------------------------------ tools
  setTool(id) {
    const t = this.tools[id]; if (!t) return;
    if (this.tool && this.tool !== t) { this.tool.onDeactivate?.(); if (!['orbit', 'pan', 'zoom', 'zoomwindow'].includes(this.tool.id)) this.prevToolId = this.tool.id; }
    this.tool = t; this.vcbText = '';
    this.inf.reset();
    this.view.overlay.marker = null; this.rubber = null;
    t.onActivate?.();
    this.setCursor(t.cursor);
    this.setStatus(t.status());
    this.emit('tool', id);
    this.view.requestRender();
  }
  // drawing plane for Rectangle / Circle / Polygon / Arcs / Pie / Freehand: auto | h | v | x | y
  setPlaneMode(m) {
    this.planeMode = ['h', 'v', 'x', 'y'].includes(m) ? m : 'auto';
    try { this.tool?.onPlaneMode?.(); } catch (e) { console.error(e); }
    this.emit('plane', this.planeMode);
    this.view.requestRender();
  }
  toolEvent(type, ev) {
    const t = this.tool; if (!t) return;
    this.lastEv = ev;
    try {
      if (type === 'down') t.onDown?.(ev);
      else if (type === 'move') t.onMove?.(ev);
      else if (type === 'up') t.onUp?.(ev);
      else if (type === 'dbl') t.onDbl?.(ev);
      else if (type === 'leave') { this.view.overlay.marker = null; }
    } catch (e) { console.error(e); }
    this.view.requestRender();
  }
  setCursor(name, temp = false) {
    const css = cursorCSS(name || (this.tool && this.tool.cursor) || 'select');
    this.view.renderer.domElement.style.cursor = css;
    void temp;
  }
  setVCB(label, value) { this.ui.setVCB(label, value); }
  setStatus(text) { this.ui.setStatus(text); }
  toast(text) { this.ui.toast(text); }
  contextMenu(ev) {
    const k = this.pickEntity(ev.x, ev.y);
    if (k && !k.outside && !this.sel.has(k.key)) this.applySelection([k.key], 'set');
    this.ui.contextMenu(ev, k);
  }

  // ------------------------------------------------------------ keyboard
  keyCombo(e) {
    const parts = [];
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod) parts.push('Ctrl');
    if (isMac && e.ctrlKey) parts.push('MacCtrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    let k = e.key;
    if (k === ' ') k = 'Space';
    else if (k.length === 1) k = (e.code && e.code.startsWith('Key') ? e.code.slice(3) : e.code && e.code.startsWith('Digit') ? e.code.slice(5) : k.toUpperCase());
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return null;
    parts.push(k);
    return parts.join('+');
  }
  keyMap() {
    if (this._km && this._kmV === JSON.stringify(this.settings.keys)) return this._km;
    const map = new Map();
    for (const [cmd, key] of Object.entries({ ...DEFAULT_KEYS, ...this.settings.keys })) if (key) for (const k of String(key).split('|')) map.set(k, cmd);
    this._km = map; this._kmV = JSON.stringify(this.settings.keys);
    return map;
  }
  bindKeys() {
    document.addEventListener('keydown', (e) => {
      const tg = e.target;
      if (this.ui.modalOpen()) { if (e.key === 'Escape') this.ui.closeModal(); return; }
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || tg.isContentEditable) && tg.id !== 'vcb-input') return;
      if (e.key === 'Escape' && this.ui.closeMenus()) { e.preventDefault(); return; }
      const t = this.tool;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      // VCB typing
      const printable = e.key.length === 1 && !mod && !(isMac && e.ctrlKey);
      const startsVCB = /[0-9.\-[<]/.test(e.key) || (/[x*/]/i.test(e.key) && ['move', 'rotate'].includes(t?.id) && !this.vcbText);
      if (printable && (this.vcbText || startsVCB) && !(e.key === ' ' && !this.vcbText)) {
        this.vcbText = (this.vcbText || '') + e.key; this.ui.setVCBText(this.vcbText); e.preventDefault(); return;
      }
      if (this.vcbText) {
        if (e.key === 'Backspace') { this.vcbText = this.vcbText.slice(0, -1); this.ui.setVCBText(this.vcbText); e.preventDefault(); return; }
        if (e.key === 'Enter') { const txt = this.vcbText; this.vcbText = ''; this.ui.setVCBText(''); let ok = false; try { ok = t?.onVCB?.(txt.trim()); } catch (err) { console.error(err); } if (!ok) this.ui.flashVCB(); e.preventDefault(); this.view.requestRender(); return; }
        if (e.key === 'Escape') { this.vcbText = ''; this.ui.setVCBText(''); e.preventDefault(); return; }
      }
      if (e.key === ' ' && this.settings.spaceSelect !== false && !mod) { if (t?.id !== 'select') this.setTool('select'); e.preventDefault(); return; }
      // tool gets modifier/arrow keys first
      if (['Control', 'Alt', 'Shift', 'Meta', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape'].includes(e.key)) {
        if (!e.repeat && t?.onKey?.(e)) { e.preventDefault(); this.view.requestRender(); return; }
        if (e.key === 'Escape') { t?.cancel?.(); e.preventDefault(); return; }
      }
      const combo = this.keyCombo(e); if (!combo) return;
      const cmd = this.keyMap().get(combo);
      if (cmd && this.cmds[cmd]) { e.preventDefault(); this.cmds[cmd].run(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel.size) { e.preventDefault(); this.deleteSelected(); }
    });
    document.addEventListener('keyup', (e) => { if (this.tool?.onKeyUp?.(e)) this.view.requestRender(); });
  }
}

// ---------------------------------------------------------------- helpers
function safeJSON(s) { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } }
export function restoreInPlace(ents, json) {
  const v = ents.version;
  const n = entsFromJSON(json);
  for (const k of Object.keys(n)) ents[k] = n[k];
  ents.version = v + 1;
}
function keyExists(ents, k) {
  const id = +k.slice(1);
  return ({ f: ents.faces, e: ents.edges, i: ents.insts, g: ents.guides, d: ents.dims, t: ents.texts, s: ents.sections })[k[0]]?.has(id);
}
function segRect(a, b, r) {
  const segs = [[r.x0, r.y0, r.x1, r.y0], [r.x1, r.y0, r.x1, r.y1], [r.x1, r.y1, r.x0, r.y1], [r.x0, r.y1, r.x0, r.y0]];
  const cr = (ax, ay, bx, by, cx, cy, dx, dy) => { const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx); if (!d) return false; const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d, u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d; return t >= 0 && t <= 1 && u >= 0 && u <= 1; };
  return segs.some((s) => cr(a.x, a.y, b.x, b.y, s[0], s[1], s[2], s[3]));
}
function pointInPoly2(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a.y > p[1]) !== (b.y > p[1]) && p[0] < ((b.x - a.x) * (p[1] - a.y)) / (b.y - a.y) + a.x) inside = !inside; }
  return inside;
}
export { nid, transformEnts, deleteSelection };
