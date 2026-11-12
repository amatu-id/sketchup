// File I/O: native save/open, import (OBJ/STL/GLB/DAE/DXF/images), 3D export (DAE/OBJ/STL/GLB/DXF), images, print, working drawings.
import * as THREE from 'three';
import { modelToJSON, nid, Entities, drawSegments, pushPull, addVertex, addFace } from '../core/model.js';
import { trianglesToFaces, entsBox, offsetFacePoints } from '../core/ops.js';
import { walkGeometry } from '../core/section.js';
import { basis, triangulate2 } from '../core/geom.js';
import { buildComponent } from '../core/library.js';
import { addLibraryMaterial } from '../core/materials.js';
import { DXF } from './dxf.js';
import { projectView, composeSheet, sheetsToPDF, sheetsToDXF, viewToSVG, gather, hiddenLine } from './drawings.js';

const EXT = '.amsk';
export function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
const baseName = (app) => (app.fileName || 'Untitled').replace(/\.[^.]+$/, '');
const pickFile = (accept) => new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => res(i.files[0] || null); i.click(); });

export class IO {
  constructor(app) { this.app = app; }

  // ------------------------------------------------------------ native
  async save(as = false) {
    const app = this.app;
    const data = JSON.stringify({ ...modelToJSON(app.model), camera: app.view.saveCamera() });
    const blob = new Blob([data], { type: 'application/json' });
    let name = app.fileName || 'Untitled' + EXT;
    if (!name.endsWith(EXT)) name = name.replace(/\.[^.]+$/, '') + EXT;
    try {
      if (window.showSaveFilePicker) {
        if (!app.fileHandle || as) app.fileHandle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Amatu Sketch model', accept: { 'application/json': [EXT] } }] });
        const w = await app.fileHandle.createWritable(); await w.write(blob); await w.close();
        app.fileName = app.fileHandle.name;
      } else { download(blob, name); app.fileName = name; }
      app.dirty = false; app.ui.updateTitle(); app.toast('Saved ' + app.fileName);
    } catch (e) { if (e.name !== 'AbortError') app.toast('Save failed: ' + e.message); }
  }
  async open() {
    const f = await pickFile(EXT + ',.json,.dae,.obj,.stl,.glb,.gltf,.dxf');
    if (!f) return;
    if (/\.(amsk|json)$/i.test(f.name)) {
      const o = JSON.parse(await f.text());
      this.app.loadModel(o, f.name, o.camera); this.app.fileHandle = null;
    } else { this.app.newModel(); await this.importBlob(f); this.app.fileName = f.name.replace(/\.[^.]+$/, '') + EXT; this.app.ui.updateTitle(); }
  }

  // ------------------------------------------------------------ import
  async importFile() { const f = await pickFile('.dae,.obj,.stl,.glb,.gltf,.dxf,.amsk,.png,.jpg,.jpeg,.webp'); if (!f) return; if (/\.(png|jpe?g|webp)$/i.test(f.name)) this.app.ui.imageChoice(f); else await this.importBlob(f); }
  async importBlob(f) {
    const app = this.app, ext = f.name.split('.').pop().toLowerCase();
    try {
      if (ext === 'dxf') return this.importDXF(await f.text(), f.name);
      if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return this.importImage(f);
      if (ext === 'amsk' || ext === 'json') return this.importModelAsComponent(JSON.parse(await f.text()), f.name);
      const url = URL.createObjectURL(f);
      let root, upY = true, scale = 1000;
      if (ext === 'stl') { const { STLLoader } = await import('three/addons/loaders/STLLoader.js'); const g = await new STLLoader().loadAsync(url); root = new THREE.Mesh(g); upY = false; scale = 1; }
      else if (ext === 'obj') { const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js'); root = await new OBJLoader().loadAsync(url); }
      else if (ext === 'glb' || ext === 'gltf') { const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'); root = (await new GLTFLoader().loadAsync(url)).scene; }
      else if (ext === 'dae') { const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js'); root = (await new ColladaLoader().loadAsync(url)).scene; }
      else { app.toast('Unsupported file type'); return; }
      root.updateMatrixWorld(true);
      // gather triangles + per-triangle colors
      const pos = [], mats = [];
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3()).length();
      if (ext === 'stl' || ext === 'obj') scale = size < 100 ? 1000 : 1;
      const fix = new THREE.Matrix4().makeScale(scale, scale, scale);
      if (upY) fix.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
      const matIds = new Map();
      root.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
        const p = g.attributes.position; const m = fix.clone().multiply(o.matrixWorld);
        const mm = Array.isArray(o.material) ? o.material : [o.material];
        const groups = g.groups.length ? g.groups : [{ start: 0, count: p.count, materialIndex: 0 }];
        for (const gr of groups) {
          const src = mm[gr.materialIndex] || mm[0];
          let mid = null;
          if (src && src.color) {
            const key = src.color.getHexString() + (src.opacity ?? 1);
            if (!matIds.has(key)) { const id = nid(); app.model.materials.set(id, { id, name: src.name || '#' + src.color.getHexString(), color: '#' + src.color.getHexString(), tex: null, tw: 1000, th: 1000, opacity: src.transparent ? src.opacity : 1 }); matIds.set(key, id); }
            mid = matIds.get(key);
          }
          for (let i = gr.start; i < gr.start + gr.count; i++) { const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m); pos.push(v.x, v.y, v.z); if ((i - gr.start) % 3 === 0) mats.push(mid); }
        }
      });
      URL.revokeObjectURL(url);
      if (!pos.length) { app.toast('No geometry found in file'); return; }
      this.placeTriangles(pos, mats, f.name);
    } catch (e) { console.error(e); app.toast('Import failed: ' + e.message); }
  }
  placeTriangles(pos, mats, name) {
    const app = this.app;
    let inst;
    app.commit('Import', () => {
      const ents = new Entities();
      trianglesToFaces(ents, pos, { mats, weld: 0.05 });
      const b = entsBox(app.model, ents);
      const sh = new THREE.Matrix4().makeTranslation(-b.min.x, -b.min.y, -b.min.z);
      for (const v of ents.verts.values()) v.p.applyMatrix4(sh);
      for (const f of ents.faces.values()) { f.d = f.n.dot(ents.P(f.loops[0][0])); }
      ents.touch();
      const def = { id: nid(), name: name.replace(/\.[^.]+$/, ''), desc: 'Imported ' + name, group: false, ents };
      app.model.defs.set(def.id, def);
      inst = { id: nid(), def: def.id, m: new THREE.Matrix4(), name: '', tag: 0, hidden: false, locked: false, mat: null };
      app.ctxInfo().ents.insts.set(inst.id, inst); app.ctxInfo().ents.touch();
    });
    app.matVersion++; app.emit('materials');
    app.applySelection(['i' + inst.id], 'set');
    app.setTool('move'); app.tools.move.startPlacement(['i' + inst.id], new THREE.Vector3().applyMatrix4(app.ctxInfo().matrix));
    app.setStatus('Click to place the imported model.');
  }
  importModelAsComponent(json, name) {
    const app = this.app;
    import('../core/model.js').then(({ modelFromJSON }) => {
      const m = modelFromJSON(json);
      let inst;
      app.commit('Import', () => {
        for (const [id, d] of m.defs) app.model.defs.set(id, d);
        for (const [id, mt] of m.materials) app.model.materials.set(id, mt);
        const def = { id: nid(), name: name.replace(/\.[^.]+$/, ''), group: false, desc: 'Imported', ents: m.root };
        app.model.defs.set(def.id, def);
        inst = { id: nid(), def: def.id, m: new THREE.Matrix4(), name: '', tag: 0, hidden: false, locked: false, mat: null };
        app.ctxInfo().ents.insts.set(inst.id, inst); app.ctxInfo().ents.touch();
      });
      app.matVersion++;
      app.applySelection(['i' + inst.id], 'set');
      app.setTool('move'); app.tools.move.startPlacement(['i' + inst.id], new THREE.Vector3());
    });
  }
  importDXF(text, name) {
    const app = this.app;
    const lines = text.split(/\r?\n/).map((s) => s.trim());
    const ents = [];
    let cur = null;
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const code = +lines[i], val = lines[i + 1];
      if (code === 0) { if (cur) ents.push(cur); cur = { type: val, v: [] }; continue; }
      if (!cur) continue;
      if (code === 10) cur.v.push({ x: +val, y: 0, z: 0 });
      else if (code === 20 && cur.v.length) cur.v[cur.v.length - 1].y = +val;
      else if (code === 30 && cur.v.length) cur.v[cur.v.length - 1].z = +val;
      else if (code === 11) cur.p2 = { x: +val, y: 0, z: 0 };
      else if (code === 21 && cur.p2) cur.p2.y = +val;
      else if (code === 31 && cur.p2) cur.p2.z = +val;
      else if (code === 40) cur.r = +val;
      else if (code === 50) cur.a0 = +val;
      else if (code === 51) cur.a1 = +val;
      else if (code === 70) cur.flags = +val;
    }
    if (cur) ents.push(cur);
    const segs = [];
    const V = (p) => new THREE.Vector3(p.x, p.y, p.z || 0);
    let poly = null;
    for (const e of ents) {
      if (e.type === 'LINE' && e.v[0] && e.p2) segs.push([V(e.v[0]), V(e.p2)]);
      else if (e.type === 'LWPOLYLINE') { for (let i = 0; i + 1 < e.v.length; i++) segs.push([V(e.v[i]), V(e.v[i + 1])]); if (e.flags & 1 && e.v.length > 2) segs.push([V(e.v[e.v.length - 1]), V(e.v[0])]); }
      else if (e.type === 'POLYLINE') poly = { pts: [], closed: !!(e.flags & 1) };
      else if (e.type === 'VERTEX' && poly && e.v[0]) poly.pts.push(V(e.v[0]));
      else if (e.type === 'SEQEND' && poly) { for (let i = 0; i + 1 < poly.pts.length; i++) segs.push([poly.pts[i], poly.pts[i + 1]]); if (poly.closed) segs.push([poly.pts[poly.pts.length - 1], poly.pts[0]]); poly = null; }
      else if ((e.type === 'CIRCLE' || e.type === 'ARC') && e.v[0] && e.r) {
        const c = V(e.v[0]); const a0 = e.type === 'ARC' ? (e.a0 * Math.PI) / 180 : 0; let a1 = e.type === 'ARC' ? (e.a1 * Math.PI) / 180 : Math.PI * 2; if (a1 <= a0) a1 += Math.PI * 2;
        const n = Math.max(6, Math.round(((a1 - a0) / (Math.PI * 2)) * 24));
        for (let i = 0; i < n; i++) { const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n; segs.push([c.clone().add(new THREE.Vector3(Math.cos(t0) * e.r, Math.sin(t0) * e.r, 0)), c.clone().add(new THREE.Vector3(Math.cos(t1) * e.r, Math.sin(t1) * e.r, 0))]); }
      }
    }
    if (!segs.length) { app.toast('No lines found in DXF'); return; }
    let inst;
    app.commit('Import DXF', () => {
      const E = new Entities();
      drawSegments(E, segs);
      const def = { id: nid(), name: name.replace(/\.[^.]+$/, ''), desc: 'Imported DXF', group: true, ents: E };
      app.model.defs.set(def.id, def);
      inst = { id: nid(), def: def.id, m: new THREE.Matrix4(), name: def.name, tag: 0, hidden: false, locked: false, mat: null };
      app.ctxInfo().ents.insts.set(inst.id, inst); app.ctxInfo().ents.touch();
    });
    app.applySelection(['i' + inst.id], 'set');
    app.view.zoomExtents();
    app.toast(`Imported ${segs.length} segments from DXF (as a group). Double-click to edit.`);
  }
  async importImage(f) {
    const app = this.app;
    const url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
    const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = url; });
    const w = 4000, hgt = (4000 * img.height) / img.width;
    let inst;
    app.commit('Import Image', () => {
      const id = nid(); app.model.materials.set(id, { id, name: f.name, color: '#ffffff', tex: 'image', img: url, tw: w, th: hgt, opacity: 1 });
      const E = new Entities();
      const vs = [[0, 0], [w, 0], [w, hgt], [0, hgt]].map(([x, y]) => addVertex(E, new THREE.Vector3(x, y, 0)));
      addFace(E, [vs], { mat: id, back: id });
      const def = { id: nid(), name: f.name, group: true, desc: 'Image', ents: E };
      app.model.defs.set(def.id, def);
      inst = { id: nid(), def: def.id, m: new THREE.Matrix4(), name: f.name, tag: 0, hidden: false, locked: false, mat: null };
      app.ctxInfo().ents.insts.set(inst.id, inst); app.ctxInfo().ents.touch();
    });
    app.matVersion++;
    app.applySelection(['i' + inst.id], 'set');
    app.setTool('move'); app.tools.move.startPlacement(['i' + inst.id], new THREE.Vector3());
  }

  // ------------------------------------------------------------ 3D export
  flatten(opts = {}) {
    // world triangles grouped by material key + edges
    const app = this.app, model = app.model, groups = new Map(), edges = [];
    const visTag = (t) => { const x = model.tags.get(t || 0); return !x || x.visible !== false; };
    const recs = [];
    const rec = (ents, m, instMat, path) => {
      const W = new Map(), w = (id) => { let p = W.get(id); if (!p) { p = ents.P(id).clone().applyMatrix4(m); W.set(id, p); } return p; };
      const nm = new THREE.Matrix3().getNormalMatrix(m);
      for (const f of ents.faces.values()) {
        if (f.hidden || !visTag(f.tag)) continue;
        const mid = f.mat ?? instMat ?? null;
        const key = mid == null ? 'default' : 'm' + mid;
        if (!groups.has(key)) groups.set(key, { key, mat: mid != null ? model.materials.get(mid) : null, tris: [], polys: [] });
        const g = groups.get(key);
        const { u, v } = basis(f.n);
        const l2 = f.loops.map((l) => l.map((id) => { const p = ents.P(id); return [p.dot(u), p.dot(v)]; }));
        const all = f.loops.flat(), n = f.n.clone().applyMatrix3(nm).normalize();
        for (const t of triangulate2(l2[0], l2.slice(1))) g.tris.push({ a: w(all[t[0]]), b: w(all[t[1]]), c: w(all[t[2]]), n });
        if (f.loops.length === 1) g.polys.push({ pts: f.loops[0].map(w), n }); else for (const t of triangulate2(l2[0], l2.slice(1))) g.polys.push({ pts: [w(all[t[0]]), w(all[t[1]]), w(all[t[2]])], n });
      }
      for (const e of ents.edges.values()) if (!e.soft && !e.hidden && visTag(e.tag)) edges.push({ a: w(e.a), b: w(e.b), tag: model.tags.get(e.tag || 0)?.name || '0' });
      for (const i of ents.insts.values()) {
        if (i.hidden || !visTag(i.tag)) continue;
        const d = model.defs.get(i.def); if (!d) continue;
        rec(d.ents, m.clone().multiply(i.m), i.mat ?? instMat, [...path, i.id]);
      }
      recs.push(path);
    };
    rec(model.root, new THREE.Matrix4(), null, []);
    void opts;
    return { groups: [...groups.values()], edges };
  }
  async export3D(fmt) {
    const app = this.app, name = baseName(app);
    try {
      if (fmt === 'dae') download(new Blob([this.toDAE()], { type: 'model/vnd.collada+xml' }), name + '.dae');
      else if (fmt === 'obj') {
        const { obj, mtl } = this.toOBJ(name);
        const { zipSync, strToU8 } = await import('fflate');
        download(new Blob([zipSync({ [name + '.obj']: strToU8(obj), [name + '.mtl']: strToU8(mtl) })], { type: 'application/zip' }), name + '-obj.zip');
      } else if (fmt === 'stl') download(new Blob([this.toSTL()], { type: 'model/stl' }), name + '.stl');
      else if (fmt === 'glb') download(new Blob([await this.toGLB()], { type: 'model/gltf-binary' }), name + '.glb');
      else if (fmt === 'dxf') download(new Blob([this.toDXF3D()], { type: 'application/dxf' }), name + '-3D.dxf');
      app.toast('Exported ' + fmt.toUpperCase());
    } catch (e) { console.error(e); app.toast('Export failed: ' + e.message); }
  }
  toDAE() {
    // components/groups are preserved as library nodes so SketchUp re-imports them as components
    const app = this.app, model = app.model;
    const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
    const mats = new Map([['default', { id: 'mat_default', name: 'Default', color: model.style.front, opacity: 1 }]]);
    for (const m of model.materials.values()) mats.set('m' + m.id, { id: 'mat_' + m.id, name: m.name, color: m.color, opacity: m.opacity ?? 1 });
    const col = (hex) => { const c = new THREE.Color(hex); return `${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)} 1`; };
    const geoms = [], nodes = [];
    const geomFor = (ents, gid) => {
      const byMat = new Map(); const positions = [], normals = [];
      for (const f of ents.faces.values()) {
        if (f.hidden) continue;
        const key = f.mat != null ? 'm' + f.mat : 'default';
        if (!byMat.has(key)) byMat.set(key, []);
        const { u, v } = basis(f.n);
        const l2 = f.loops.map((l) => l.map((id) => { const p = ents.P(id); return [p.dot(u), p.dot(v)]; }));
        const all = f.loops.flat();
        const ni = normals.length / 3; normals.push(f.n.x, f.n.y, f.n.z);
        for (const t of triangulate2(l2[0], l2.slice(1))) { const idx = []; for (const k of t) { const p = ents.P(all[k]); idx.push(positions.length / 3); positions.push(p.x, p.y, p.z); } byMat.get(key).push(idx.map((x) => `${x} ${ni}`).join(' ')); }
      }
      const lines = [];
      const lpos0 = positions.length / 3;
      for (const e of ents.edges.values()) if (!e.soft && !e.hidden) { const a = ents.P(e.a), b = ents.P(e.b); positions.push(a.x, a.y, a.z, b.x, b.y, b.z); }
      const nEdges = positions.length / 3 - lpos0;
      for (let i = 0; i < nEdges; i += 2) lines.push(`${lpos0 + i} ${lpos0 + i + 1}`);
      if (!positions.length) return null;
      const r = (x) => +x.toFixed(4);
      let x = `<geometry id="${gid}"><mesh>
<source id="${gid}-pos"><float_array id="${gid}-pos-a" count="${positions.length}">${positions.map(r).join(' ')}</float_array><technique_common><accessor source="#${gid}-pos-a" count="${positions.length / 3}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
<source id="${gid}-nrm"><float_array id="${gid}-nrm-a" count="${normals.length || 3}">${(normals.length ? normals : [0, 0, 1]).map(r).join(' ')}</float_array><technique_common><accessor source="#${gid}-nrm-a" count="${Math.max(1, normals.length / 3)}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
<vertices id="${gid}-vtx"><input semantic="POSITION" source="#${gid}-pos"/></vertices>`;
      const used = [];
      for (const [key, tris] of byMat) { used.push(key); x += `\n<triangles material="${mats.get(key)?.id || 'mat_default'}" count="${tris.length}"><input semantic="VERTEX" source="#${gid}-vtx" offset="0"/><input semantic="NORMAL" source="#${gid}-nrm" offset="1"/><p>${tris.join(' ')}</p></triangles>`; }
      if (lines.length) { used.push('edge'); x += `\n<lines material="mat_edge" count="${lines.length}"><input semantic="VERTEX" source="#${gid}-vtx" offset="0"/><p>${lines.join(' ')}</p></lines>`; }
      x += '</mesh></geometry>';
      geoms.push(x);
      return used;
    };
    const bind = (used) => `<bind_material><technique_common>${used.map((k) => { const id = k === 'edge' ? 'mat_edge' : mats.get(k)?.id || 'mat_default'; return `<instance_material symbol="${id}" target="#${id}"/>`; }).join('')}</technique_common></bind_material>`;
    const mtx = (m) => { const e = m.elements; return [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15].map((i) => +e[i].toFixed(6)).join(' '); };
    const instNodes = (ents) => [...ents.insts.values()].filter((i) => !i.hidden && model.defs.has(i.def)).map((i) => `<node id="inst_${i.id}" name="${esc(i.name || model.defs.get(i.def).name)}"><matrix>${mtx(i.m)}</matrix><instance_node url="#def_${i.def}"/></node>`).join('');
    for (const d of model.defs.values()) {
      const used = geomFor(d.ents, 'geom_def_' + d.id);
      nodes.push(`<node id="def_${d.id}" name="${esc(d.name)}">${used ? `<instance_geometry url="#geom_def_${d.id}">${bind(used)}</instance_geometry>` : ''}${instNodes(d.ents)}</node>`);
    }
    const rootUsed = geomFor(model.root, 'geom_root');
    const now = new Date().toISOString();
    return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
<asset><contributor><authoring_tool>Amatu Sketch</authoring_tool></contributor><created>${now}</created><modified>${now}</modified><unit name="millimeter" meter="0.001"/><up_axis>Z_UP</up_axis></asset>
<library_effects>${[...mats.values(), { id: 'mat_edge', color: '#000000', opacity: 1 }].map((m) => `<effect id="${m.id}-fx"><profile_COMMON><technique sid="common"><lambert><diffuse><color>${col(m.color)}</color></diffuse>${m.opacity < 1 ? `<transparent opaque="A_ONE"><color>1 1 1 ${m.opacity}</color></transparent><transparency><float>1</float></transparency>` : ''}</lambert></technique></profile_COMMON></effect>`).join('\n')}</library_effects>
<library_materials>${[...mats.values(), { id: 'mat_edge', name: 'edge' }].map((m) => `<material id="${m.id}" name="${esc(m.name)}"><instance_effect url="#${m.id}-fx"/></material>`).join('\n')}</library_materials>
<library_geometries>${geoms.join('\n')}</library_geometries>
<library_nodes>${nodes.join('\n')}</library_nodes>
<library_visual_scenes><visual_scene id="scene" name="${esc(baseName(app))}"><node id="model" name="${esc(baseName(app))}">${rootUsed ? `<instance_geometry url="#geom_root">${bind(rootUsed)}</instance_geometry>` : ''}${instNodes(model.root)}</node></visual_scene></library_visual_scenes>
<scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>`;
  }
  toOBJ(name) {
    const { groups } = this.flatten();
    let obj = `# Amatu Sketch OBJ export (units: millimeters, Z up)\nmtllib ${name}.mtl\n`, mtl = '# Amatu Sketch MTL\n', vi = 1, ni = 1;
    for (const g of groups) {
      const mname = g.mat ? g.mat.name.replace(/\s+/g, '_') + '_' + g.mat.id : 'Default';
      const c = new THREE.Color(g.mat ? g.mat.color : this.app.model.style.front);
      mtl += `newmtl ${mname}\nKd ${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)}\nd ${g.mat ? g.mat.opacity ?? 1 : 1}\n\n`;
      obj += `g ${mname}\nusemtl ${mname}\n`;
      for (const p of g.polys) {
        for (const q of p.pts) obj += `v ${q.x.toFixed(4)} ${q.y.toFixed(4)} ${q.z.toFixed(4)}\n`;
        obj += `vn ${p.n.x.toFixed(5)} ${p.n.y.toFixed(5)} ${p.n.z.toFixed(5)}\n`;
        obj += 'f ' + p.pts.map((_, k) => `${vi + k}//${ni}`).join(' ') + '\n';
        vi += p.pts.length; ni++;
      }
    }
    return { obj, mtl };
  }
  toSTL() {
    const { groups } = this.flatten();
    const tris = groups.flatMap((g) => g.tris);
    const buf = new ArrayBuffer(84 + tris.length * 50), dv = new DataView(buf);
    const head = 'Amatu Sketch STL (mm)'; for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
    dv.setUint32(80, tris.length, true);
    let o = 84;
    for (const t of tris) { for (const v of [t.n, t.a, t.b, t.c]) { dv.setFloat32(o, v.x, true); dv.setFloat32(o + 4, v.y, true); dv.setFloat32(o + 8, v.z, true); o += 12; } o += 2; }
    return buf;
  }
  async toGLB() {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const { groups } = this.flatten();
    const root = new THREE.Group(); root.rotation.x = -Math.PI / 2; root.scale.setScalar(0.001);
    for (const g of groups) {
      const pos = [], nor = [];
      for (const t of g.tris) for (const p of [t.a, t.b, t.c]) { pos.push(p.x, p.y, p.z); nor.push(t.n.x, t.n.y, t.n.z); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      const m = new THREE.MeshStandardMaterial({ color: g.mat ? g.mat.color : this.app.model.style.front, roughness: 0.8, transparent: (g.mat?.opacity ?? 1) < 1, opacity: g.mat?.opacity ?? 1, side: THREE.DoubleSide, name: g.mat?.name || 'Default' });
      root.add(new THREE.Mesh(geo, m));
    }
    const scene = new THREE.Scene(); scene.add(root);
    return await new GLTFExporter().parseAsync(scene, { binary: true });
  }
  toDXF3D() {
    const { groups, edges } = this.flatten();
    const d = new DXF();
    for (const g of groups) { const layer = g.mat ? g.mat.name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 30) : 'DEFAULT'; d.layer(layer, 7); for (const t of g.tris) d.face3(t.a.toArray(), t.b.toArray(), t.c.toArray(), null, layer); }
    d.layer('EDGES', 7);
    for (const e of edges) d.line(e.a.x, e.a.y, e.a.z, e.b.x, e.b.y, e.b.z, 'EDGES');
    return d.toString();
  }

  // ------------------------------------------------------------ 2D export
  exportImage(fmt, w, h, transparent) {
    const app = this.app;
    const c = app.view.snapshot(Math.min(8000, w), Math.min(8000, h), { transparent: transparent && fmt === 'png' });
    c.toBlob((b) => download(b, baseName(app) + '.' + fmt), fmt === 'png' ? 'image/png' : 'image/jpeg', 0.92);
  }
  async exportView(fmt) {
    const app = this.app, name = baseName(app);
    app.toast('Computing hidden lines…');
    await new Promise((r) => setTimeout(r, 30));
    const { svg, segs, W, H } = viewToSVG(app);
    if (fmt === 'svg') { download(new Blob([svg], { type: 'image/svg+xml' }), name + '.svg'); return; }
    if (fmt === 'dxf') {
      const d = new DXF(); d.layer('VIEW', 7);
      const k = app.view.cam.ortho ? app.view.cam.orthoH / H : 1;
      for (const [x1, y1, x2, y2] of segs) d.line(((x1 + 1) / 2) * W * k, ((y1 + 1) / 2) * H * k, 0, ((x2 + 1) / 2) * W * k, ((y2 + 1) / 2) * H * k, 0, 'VIEW');
      download(new Blob([d.toString()], { type: 'application/dxf' }), name + '-view.dxf'); return;
    }
    if (fmt === 'pdf') {
      const PW = 420, PH = 297, m = 12, s = Math.min((PW - 2 * m) / W, (PH - 2 * m) / H);
      const ox = (PW - W * s) / 2, oy = (PH - H * s) / 2;
      const prims = segs.map(([x1, y1, x2, y2, kk]) => ({ t: 'l', x1: ox + ((x1 + 1) / 2) * W * s, y1: oy + ((y1 + 1) / 2) * H * s, x2: ox + ((x2 + 1) / 2) * W * s, y2: oy + ((y2 + 1) / 2) * H * s, w: kk === 'p' ? 0.35 : 0.18 }));
      download(await sheetsToPDF([{ w: PW, h: PH, prims }], name), name + '-view.pdf');
    }
  }
  print() {
    const c = this.app.view.snapshot(2400, Math.round((2400 * this.app.view.h) / this.app.view.w));
    const wdw = window.open('', '_blank');
    if (!wdw) { this.app.toast('Allow pop-ups to print'); return; }
    wdw.document.write(`<title>${baseName(this.app)}</title><style>@page{size:landscape;margin:10mm}body{margin:0}img{width:100%}</style><img src="${c.toDataURL('image/png')}" onload="setTimeout(()=>print(),200)">`);
    wdw.document.close();
  }

  // ------------------------------------------------------------ working drawings
  async drawings(opts) {
    const app = this.app, name = baseName(app);
    if (!window.jspdf && opts.format !== 'dxf') { app.toast('PDF engine is still loading, try again in a moment.'); return; }
    app.ui.toast('Generating working drawings…', 60000);
    await new Promise((r) => setTimeout(r, 40));
    const geom = gather(app);
    const ids = opts.sheets.filter((s) => !s.startsWith('scene:'));
    const scenes = opts.sheets.filter((s) => s.startsWith('scene:')).map((s) => +s.slice(6));
    const views = [];
    for (const id of ids) {
      const v = projectView(app, id, { cutZ: opts.cutZ, hatch: opts.hatch, userDims: opts.userDims, geom });
      if (v) views.push(v);
      await new Promise((r) => setTimeout(r, 0));
    }
    const total = views.length + scenes.length;
    const sheets = views.map((v, i) => composeSheet(app, v, i + 1, total, { ...opts, unit: 'mm' }));
    // scene sheets (rendered views)
    const saved = app.view.saveCamera(), savedStyle = JSON.stringify(app.model.style);
    for (const [k, si] of scenes.entries()) {
      const sc = app.model.scenes[si]; if (!sc) continue;
      if (sc.style) Object.assign(app.model.style, sc.style);
      app.view.loadCamera(sc.cam, 0); app.view.rebuild();
      const s = composeSheet(app, { title: sc.name.toUpperCase(), lines: [], fills: [], annots: [], box: { x0: 0, y0: 0, x1: 1, y1: 1 }, isIso: true }, views.length + k + 1, total, { ...opts, dims: false });
      const [PW, PH] = [s.w, s.h];
      const area = { w: PW - 20 - 8 - Math.min(70, PW * 0.2) - 16, h: PH - 16 - 30 };
      const img = app.view.snapshot(1800, Math.round((1800 * area.h) / area.w)).toDataURL('image/jpeg', 0.9);
      s.prims.push({ t: 'img', data: img, x: 28, y: 30, w: area.w, h: area.h });
      sheets.push(s);
    }
    Object.assign(app.model.style, JSON.parse(savedStyle)); app.view.loadCamera(saved, 0); app.view.rebuild();
    if (!sheets.length) { app.toast('Nothing to draw — the model is empty.'); return; }
    if (opts.format === 'pdf' || opts.format === 'both') download(await sheetsToPDF(sheets, name), name + ' - Gambar Kerja.pdf');
    if (opts.format === 'dxf' || opts.format === 'both') download(new Blob([sheetsToDXF(sheets)], { type: 'application/dxf' }), name + ' - Gambar Kerja.dxf');
    app.ui.toast(`Working drawings ready: ${sheets.length} sheet(s).`);
    void hiddenLine;
  }

  // ------------------------------------------------------------ demo model
  loadDemo() {
    const app = this.app, model = app.model;
    app.commit('Demo House', () => {
      const E = model.root;
      const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
      const rect = (x0, y0, x1, y1, z = 0) => { const p = [V(x0, y0, z), V(x1, y0, z), V(x1, y1, z), V(x0, y1, z)]; return p.map((q, i) => [q, p[(i + 1) % 4]]); };
      const L = 9000, Wd = 7000, t = 150, H = 3200;
      const conc = addLibraryMaterial(model, 'Stone & Concrete', 0).id, plaster = addLibraryMaterial(model, 'Stone & Concrete', 5).id, tile = addLibraryMaterial(model, 'Tile', 1).id, roof = addLibraryMaterial(model, 'Roofing', 0).id;
      // slab
      drawSegments(E, rect(-300, -300, L + 300, Wd + 300));
      const slab = [...E.faces.values()][0]; slab.mat = conc; slab.back = conc;
      pushPull(E, slab.id, -200);
      // walls on slab
      const top = [...E.faces.values()].find((f) => f.n.z > 0.99);
      const r1 = drawSegments(E, rect(0, 0, L, Wd, 200));
      const outer = r1.faces.find((f) => Math.abs(f.n.z) > 0.99) || [...E.faces.values()].find((f) => f.n.z > 0.99 && f.d > 199 && f.loops[0].length === 4 && f !== top);
      const pts = offsetFacePoints(E, outer, -t);
      drawSegments(E, pts.map((p, i) => [p, pts[(i + 1) % pts.length]]), { plane: { n: V(0, 0, 1), p: V(0, 0, 200) } });
      // interior wall
      drawSegments(E, rect(5000, t, 5000 + t, Wd - t, 200), { plane: { n: V(0, 0, 1), p: V(0, 0, 200) } });
      // the wall ring faces are those inside outer but outside inner
      const bbx = (f) => { const xs = f.loops[0].map((id) => E.P(id).x), ys = f.loops[0].map((id) => E.P(id).y); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
      const ring = [...E.faces.values()].filter((f) => f.n.z > 0.99 && Math.abs(f.d - 200) < 1 && f.loops.length > 1 && bbx(f).every((v, i) => Math.abs(v - [0, 0, L, Wd][i]) < 1));
      for (const f of ring) { f.mat = plaster; pushPull(E, f.id, H); }
      const iw = [...E.faces.values()].find((f) => f.n.z > 0.99 && Math.abs(f.d - 200) < 1 && f.loops.length === 1 && Math.abs(Math.max(...f.loops[0].map((id) => E.P(id).x)) - (5000 + t)) < 1 && Math.abs(Math.min(...f.loops[0].map((id) => E.P(id).x)) - 5000) < 1);
      if (iw) { iw.mat = plaster; pushPull(E, iw.id, H); }
      for (const f of E.faces.values()) if (f.n.z > 0.99 && Math.abs(f.d - 200) < 1 && !f.mat) f.mat = tile;
      // door opening in front wall (y = 0)
      const front = () => [...E.faces.values()].find((f) => f.n.y < -0.99 && Math.abs(f.d) < 1 && Math.max(...f.loops[0].map((id) => E.P(id).z)) > 3000);
      const cut = (x0, z0, x1, z1) => {
        const f = front(); if (!f) return;
        const res = drawSegments(E, [[V(x0, 0, z0), V(x1, 0, z0)], [V(x1, 0, z0), V(x1, 0, z1)], [V(x1, 0, z1), V(x0, 0, z1)], [V(x0, 0, z1), V(x0, 0, z0)]], { plane: { n: V(0, 1, 0), p: V(0, 0, 0) } });
        const nf = res.faces.find((g) => g.n.y < -0.99 && g.loops.length === 1 && Math.abs(Math.min(...g.loops[0].map((id) => E.P(id).x)) - x0) < 1);
        if (nf) pushPull(E, nf.id, -t);
      };
      cut(2000, 200, 2900, 2300);
      cut(3700, 1100, 4900, 2300);
      cut(6200, 1100, 8200, 2300);
      // roof as a group (gable prism along x)
      const rd = { id: nid(), name: 'Roof', group: true, desc: '', ents: new Entities() };
      const R = rd.ents, ov = 600, ridge = 2200;
      const prof = [V(-ov, -ov, 0), V(-ov, Wd + ov, 0), V(-ov, Wd / 2, ridge)];
      const pf = addFace(R, [prof.map((p) => addVertex(R, p))], { mat: roof, back: roof });
      pushPull(R, pf.id, pf.n.x < 0 ? -(L + 2 * ov) : L + 2 * ov);
      for (const f of R.faces.values()) { f.mat = roof; f.back = roof; }
      R.touch();
      model.defs.set(rd.id, rd);
      const rid = nid(); E.insts.set(rid, { id: rid, def: rd.id, m: new THREE.Matrix4().makeTranslation(0, 0, 200 + H), name: 'Atap', tag: 0, hidden: false, locked: false, mat: null });
      // components
      const place = (cid, m, name) => { const d = buildComponent(model, cid); const id = nid(); E.insts.set(id, { id, def: d.id, m, name: name || '', tag: 0, hidden: false, locked: false, mat: null }); };
      place('person', new THREE.Matrix4().makeTranslation(1200, -1800, 0));
      place('tree', new THREE.Matrix4().makeTranslation(-2500, 2500, 0));
      place('car', new THREE.Matrix4().makeTranslation(9800, -1500, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
      place('table', new THREE.Matrix4().makeTranslation(1500, 2500, 200));
      E.touch();
      model.info.name = 'Rumah Contoh';
    });
    app.matVersion++; app.emit('materials');
    app.view.standardView('iso'); app.view.zoomExtents(null, false);
  }
}
