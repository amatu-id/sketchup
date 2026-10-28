// Solid Tools: Outer Shell, Union, Subtract, Intersect, Trim, Split (CSG via three-bvh-csg)
import * as THREE from 'three';
import { Tool } from './base.js';
import { Entities, nid } from '../core/model.js';
import { trianglesToFaces } from '../core/ops.js';
import { basis, triangulate2 } from '../core/geom.js';

const NAMES = { union: 'Union', subtract: 'Subtract', intersect: 'Intersect', trim: 'Trim', split: 'Split', shell: 'Outer Shell' };

export function instTriangles(model, ents, inst, extra = new THREE.Matrix4()) {
  const pos = [];
  const rec = (E, m) => {
    for (const f of E.faces.values()) {
      const { u, v } = basis(f.n);
      const l2 = f.loops.map((l) => l.map((id) => { const p = E.P(id); return [p.dot(u), p.dot(v)]; }));
      const all = f.loops.flat();
      for (const t of triangulate2(l2[0], l2.slice(1))) for (const k of t) { const p = E.P(all[k]).clone().applyMatrix4(m); pos.push(p.x, p.y, p.z); }
    }
    for (const i of E.insts.values()) { const d = model.defs.get(i.def); if (d) rec(d.ents, m.clone().multiply(i.m)); }
  };
  const d = model.defs.get(inst.def);
  rec(d.ents, extra.clone().multiply(inst.m));
  return pos;
}
function brushOf(CSG, pos) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  const b = new CSG.Brush(g); b.updateMatrixWorld();
  return b;
}

export class SolidTool extends Tool {
  constructor(app, op) { super(app); this.op = op; this.id = 'solid-' + op; this.cursor = 'solid'; this.hint = op === 'shell' ? 'Click solid groups one after another; they will be combined into a single outer shell. Or preselect them.' : `${NAMES[op]}: click the first solid group/component, then the second one.`; }
  reset() { super.reset(); this.first = null; this.app.setHover([]); }
  onActivate() {
    super.onActivate();
    const s = [...this.app.sel].filter((k) => k[0] === 'i');
    if (this.op === 'shell' && s.length >= 2) { this.run(s.map((k) => +k.slice(1))); return; }
    if (s.length === 2) this.run(s.map((k) => +k.slice(1)));
  }
  onMove(ev) { const k = this.app.pickEntity(ev.x, ev.y, { noEdges: true }); this.app.setHover(k && !k.outside && k.key[0] === 'i' ? [k.key, ...(this.first ? ['i' + this.first] : [])] : this.first ? ['i' + this.first] : []); }
  onDown(ev) {
    const k = this.app.pickEntity(ev.x, ev.y, { noEdges: true });
    if (!k || k.outside || k.key[0] !== 'i') { this.app.setStatus('Not a solid group or component.'); return; }
    const id = +k.key.slice(1);
    if (!this.first) { this.first = id; this.app.setStatus(`${NAMES[this.op]}: now click the second solid.`); return; }
    if (id === this.first) return;
    this.run([this.first, id]);
    this.reset();
  }
  async run(ids) {
    const app = this.app;
    app.setStatus('Computing solid operation…');
    let CSG;
    try { CSG = await import('three-bvh-csg'); } catch (e) { app.toast('Solid tools need an internet connection to load the CSG engine.'); return; }
    const { ents } = app.ctxInfo();
    const insts = ids.map((id) => ents.insts.get(id)).filter(Boolean);
    if (insts.length < 2) return;
    const ev = new CSG.Evaluator(); ev.attributes = ['position', 'normal']; ev.useGroups = false;
    const brushes = insts.map((i) => brushOf(CSG, instTriangles(app.model, ents, i)));
    const results = [];
    const OP = { union: CSG.ADDITION, subtract: CSG.SUBTRACTION, intersect: CSG.INTERSECTION };
    try {
      if (this.op === 'shell' || this.op === 'union') { let r = brushes[0]; for (let i = 1; i < brushes.length; i++) r = ev.evaluate(r, brushes[i], OP.union); results.push({ g: r.geometry, from: insts[0] }); }
      else if (this.op === 'subtract') results.push({ g: ev.evaluate(brushes[1], brushes[0], OP.subtract).geometry, from: insts[1] });
      else if (this.op === 'intersect') results.push({ g: ev.evaluate(brushes[0], brushes[1], OP.intersect).geometry, from: insts[0] });
      else if (this.op === 'trim') results.push({ g: ev.evaluate(brushes[1], brushes[0], OP.subtract).geometry, from: insts[1], keepFirst: true });
      else if (this.op === 'split') { results.push({ g: ev.evaluate(brushes[0], brushes[1], OP.subtract).geometry, from: insts[0] }, { g: ev.evaluate(brushes[1], brushes[0], OP.subtract).geometry, from: insts[1] }, { g: ev.evaluate(brushes[0], brushes[1], OP.intersect).geometry, from: insts[0] }); }
    } catch (e) { console.error(e); app.toast('The objects are not valid solids.'); return; }
    const keep = this.op === 'trim' ? new Set([insts[0].id]) : new Set();
    const newKeys = [];
    app.commit(NAMES[this.op], () => {
      for (const r of results) {
        const g = r.g.index ? r.g.toNonIndexed() : r.g;
        const pos = g.attributes.position.array;
        if (!pos.length) continue;
        const def = { id: nid(), name: (app.model.defs.get(r.from.def)?.name || 'Group'), group: true, ents: new Entities(), desc: '' };
        // build in local space of the source instance
        const inv = r.from.m.clone().invert();
        trianglesToFaces(def.ents, pos, { matrix: inv, smoothDeg: 15 });
        app.model.defs.set(def.id, def);
        const inst = { id: nid(), def: def.id, m: r.from.m.clone(), name: r.from.name || '', tag: r.from.tag || 0, hidden: false, locked: false, mat: r.from.mat ?? null };
        ents.insts.set(inst.id, inst); newKeys.push('i' + inst.id);
      }
      for (const i of insts) if (!keep.has(i.id)) ents.insts.delete(i.id);
      ents.touch();
    });
    app.applySelection(newKeys, 'set');
    app.setStatus(`${NAMES[this.op]} complete.`);
  }
}
