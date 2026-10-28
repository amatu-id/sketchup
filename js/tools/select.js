// Select, Eraser, Paint Bucket
import * as THREE from 'three';
import { Tool, isMac } from './base.js';
import { connected, splitSel, entsBox } from '../core/ops.js';
import { faceEdges, eraseEdges, removeFace, getEdge } from '../core/model.js';

export class SelectTool extends Tool {
  constructor(app) { super(app); this.id = 'select'; this.cursor = 'select'; this.hint = 'Select entities. Shift = toggle, ' + (isMac ? '⌥' : 'Ctrl') + ' = add, Shift+' + (isMac ? '⌥' : 'Ctrl') + ' = subtract. Drag left→right = window, right→left = crossing. Double-click a group to edit it.'; }
  onDown(ev) { this.down = { x: ev.x, y: ev.y, ev }; this.dragging = false; }
  onMove(ev) {
    if (this.down && ev.buttons & 1) {
      if (!this.dragging && Math.hypot(ev.x - this.down.x, ev.y - this.down.y) > 4) this.dragging = true;
      if (this.dragging) { this.app.rubber = { x0: Math.min(this.down.x, ev.x), y0: Math.min(this.down.y, ev.y), x1: Math.max(this.down.x, ev.x), y1: Math.max(this.down.y, ev.y), crossing: ev.x < this.down.x }; this.view.requestRender(); }
    }
  }
  mode(ev) {
    const add = ev.ctrl || ev.alt;
    if (ev.shift && add) return 'sub';
    if (ev.shift) return 'toggle';
    if (add) return 'add';
    return 'set';
  }
  onUp(ev) {
    if (!this.down) return;
    const app = this.app;
    if (this.dragging) {
      const r = app.rubber; app.rubber = null;
      const keys = app.keysInRect(r, r.crossing);
      app.applySelection(keys, this.mode(ev));
    } else {
      const now = performance.now();
      const k = app.pickEntity(ev.x, ev.y);
      if (this.lastClick && now - this.lastClick.t < 600 && this.lastClick.n === 2 && k && k.key === this.lastClick.key) {
        // triple click → all connected
        if (k.key[0] === 'e' || k.key[0] === 'f') app.applySelection(connected(app.ctxInfo().ents, [k.key]), this.mode(ev) === 'set' ? 'set' : this.mode(ev));
        this.lastClick = null;
      } else {
        if (!k) { if (this.mode(ev) === 'set') app.clearSelection(); }
        else if (k.outside) { if (this.mode(ev) === 'set') { app.closeContext(true); } }
        else app.applySelection([k.key], this.mode(ev));
        this.lastClick = { t: now, key: k && k.key, n: 1 };
      }
    }
    this.down = null; this.dragging = false;
    this.view.requestRender();
  }
  onDbl(ev) {
    const app = this.app, k = app.pickEntity(ev.x, ev.y);
    if (!k || k.outside) { if (app.ctxPath.length && (!k || k.outside)) app.closeContext(); return; }
    const ents = app.ctxInfo().ents;
    if (k.key[0] === 'i') { app.openContext(+k.key.slice(1)); return; }
    if (k.key[0] === 't') { app.editText(+k.key.slice(1)); return; }
    if (k.key[0] === 'f') {
      const f = ents.faces.get(+k.key.slice(1));
      app.applySelection([k.key, ...faceEdges(ents, f).map((e) => 'e' + e.id)], this.mode(ev) === 'set' ? 'set' : 'add');
    } else if (k.key[0] === 'e') {
      const e = ents.edges.get(+k.key.slice(1));
      app.applySelection([k.key, ...[...e.faces].map((f) => 'f' + f)], this.mode(ev) === 'set' ? 'set' : 'add');
    }
    if (this.lastClick) this.lastClick.n = 2;
  }
  onKey(e) {
    if (e.key === 'Escape') { if (this.app.sel.size) this.app.clearSelection(); else if (this.app.ctxPath.length) this.app.closeContext(); return true; }
    return false;
  }
  cancel() { this.app.rubber = null; this.down = null; super.cancel(); }
}

export class EraserTool extends Tool {
  constructor(app) { super(app); this.id = 'eraser'; this.cursor = 'eraser'; this.hint = 'Click or drag over entities to erase. Shift = hide, ' + (isMac ? '⌥' : 'Ctrl') + ' = soften/smooth, ' + (isMac ? '⌥' : 'Ctrl') + '+Shift = unsoften.'; this.marked = new Set(); }
  onDown(ev) { this.active = true; this.marked = new Set(); this.mark(ev); }
  onMove(ev) {
    const k = this.app.pickEntity(ev.x, ev.y, { edgesFirst: true, noFaces: true });
    this.app.setHover(k && !k.outside ? [k.key] : []);
    if (this.active && ev.buttons & 1) this.mark(ev);
  }
  mark(ev) {
    const k = this.app.pickEntity(ev.x, ev.y, { edgesFirst: true, noFaces: true });
    if (k && !k.outside && !this.marked.has(k.key)) { this.marked.add(k.key); this.app.setHover([...this.marked]); }
  }
  onUp(ev) {
    if (!this.active) return;
    this.active = false;
    const keys = [...this.marked]; this.marked = new Set(); this.app.setHover([]);
    if (!keys.length) return;
    const app = this.app, ents = app.ctxInfo().ents;
    const soft = ev.ctrl || ev.alt;
    if (soft) {
      app.commit(ev.shift ? 'Unsoften' : 'Soften', () => { for (const k of keys) if (k[0] === 'e') { const e = ents.edges.get(+k.slice(1)); if (e) { e.soft = e.smooth = !ev.shift; } } ents.touch(); });
    } else if (ev.shift) {
      app.commit('Hide', () => { for (const k of keys) app.hideKey(ents, k); ents.touch(); });
    } else {
      app.commit('Erase', () => app.eraseKeys(keys));
    }
  }
  onKey(e) { if (e.key === 'Escape') { this.active = false; this.marked = new Set(); this.app.setHover([]); return true; } return false; }
}

export class PaintTool extends Tool {
  constructor(app) { super(app); this.id = 'paint'; this.cursor = 'paint'; this.hint = 'Click a face to paint it. ' + (isMac ? '⌥' : 'Ctrl') + ' = fill connected faces, Shift = replace everywhere, ' + (isMac ? '⌘' : 'Alt') + ' = sample material.'; }
  onMove(ev) {
    const k = this.app.pickEntity(ev.x, ev.y, { noEdges: true });
    this.app.setHover(k && !k.outside && (k.key[0] === 'f' || k.key[0] === 'i') ? [k.key] : []);
  }
  onDown(ev) {
    const app = this.app, k = app.pickEntity(ev.x, ev.y, { noEdges: true });
    if (!k || k.outside) return;
    const ents = app.ctxInfo().ents;
    const sample = isMac ? ev.meta : ev.alt && !ev.ctrl;
    if (sample) {
      let m = null;
      if (k.key[0] === 'f') { const f = ents.faces.get(+k.key.slice(1)); m = k.back ? f.back : f.mat; }
      else if (k.key[0] === 'i') m = ents.insts.get(+k.key.slice(1)).mat;
      app.setCurrentMaterial(m); return;
    }
    const mat = app.currentMaterial;
    if (k.key[0] === 'i') { app.commit('Paint', () => { const sel = app.sel.has(k.key) ? [...app.sel].filter((x) => x[0] === 'i') : [k.key]; for (const s of sel) ents.insts.get(+s.slice(1)).mat = mat; ents.touch(); }); return; }
    const f = ents.faces.get(+k.key.slice(1)); if (!f) return;
    const side = k.back ? 'back' : 'mat';
    app.commit('Paint', () => {
      let faces;
      if (app.sel.has(k.key)) faces = [...app.sel].filter((x) => x[0] === 'f').map((x) => ents.faces.get(+x.slice(1)));
      else if (ev.shift && !(ev.ctrl || ev.alt)) {
        // replace all faces in the model with the same material
        const old = f[side];
        app.forAllEnts((E) => { for (const g of E.faces.values()) { if (g.mat === old) g.mat = mat; } E.touch(); });
        faces = [];
      } else if (ev.ctrl || (ev.alt && !isMac) || (isMac && ev.alt)) {
        const old = f[side];
        faces = [...connected(ents, ['f' + f.id])].filter((x) => x[0] === 'f').map((x) => ents.faces.get(+x.slice(1))).filter((g) => g[side] === old);
      } else faces = [f];
      for (const g of faces) if (g) g[k.back && g === f ? 'back' : side] = mat;
      ents.touch();
    });
  }
}

// helper used by App for erase
export function eraseKeysIn(app, ents, keys) {
  const s = splitSel(new Set(keys));
  eraseEdges(ents, s.edges, []);
  for (const id of s.faces) removeFace(ents, id);
  for (const id of s.insts) ents.insts.delete(id);
  for (const id of s.guides) ents.guides.delete(id);
  for (const id of s.dims) ents.dims.delete(id);
  for (const id of s.texts) ents.texts.delete(id);
  for (const id of s.sections) { ents.sections.delete(id); if (app.model.activeSection === id) app.model.activeSection = null; }
  ents.touch();
  void getEdge; void entsBox; void THREE;
}
