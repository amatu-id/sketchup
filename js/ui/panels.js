// Default Tray panels: Entity Info, Materials, Components, Styles, Tags, Scenes, Shadows, Fog, Outliner, Soften Edges, Instructor
import * as THREE from 'three';
import { icon } from './icons.js';
import { LIBRARY, addLibraryMaterial, swatchURL, libSwatch } from '../core/materials.js';
import { COMPONENTS, buildComponent } from '../core/library.js';
import { splitSel, entsBox } from '../core/ops.js';
import { faceArea, nid, defaultStyle } from '../core/model.js';
import { sunDirection } from '../view/viewport.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};
const PANELS = [
  ['entity', 'Entity Info', 'info'], ['materials', 'Materials', 'materials'], ['components', 'Components', 'components'], ['styles', 'Styles', 'styles'],
  ['tags', 'Tags', 'tags'], ['scenes', 'Scenes', 'scenes'], ['shadows', 'Shadows', 'shadows'], ['fog', 'Fog', 'fog'],
  ['outliner', 'Outliner', 'outliner'], ['soften', 'Soften Edges', 'soften'], ['instructor', 'Instructor', 'instructor'],
];
const DEFAULT_PANELS = { entity: { show: true, open: true }, materials: { show: true, open: false }, components: { show: true, open: false }, styles: { show: true, open: false }, tags: { show: true, open: false }, scenes: { show: true, open: false }, shadows: { show: true, open: false }, fog: { show: false, open: false }, outliner: { show: true, open: false }, soften: { show: false, open: false }, instructor: { show: true, open: false } };
const field = (label, input) => h('label', { class: 'fld' }, h('span', {}, label), input);
const num = (v, onchange, step = 'any') => { const i = h('input', { type: 'number', value: v, step }); i.addEventListener('change', () => onchange(parseFloat(i.value))); return i; };
const txt = (v, onchange) => { const i = h('input', { type: 'text', value: v ?? '' }); i.addEventListener('change', () => onchange(i.value)); return i; };
const chk = (v, onchange, label) => { const i = h('input', { type: 'checkbox' }); i.checked = !!v; i.addEventListener('change', () => onchange(i.checked)); return h('label', { class: 'chk' }, i, h('span', {}, label)); };
const color = (v, onchange) => { const i = h('input', { type: 'color', value: v }); i.addEventListener('input', () => onchange(i.value)); return i; };
const range = (v, min, max, step, oninput) => { const i = h('input', { type: 'range', min, max, step, value: v }); i.addEventListener('input', () => oninput(parseFloat(i.value))); return i; };

export class Panels {
  constructor(app, ui) { this.app = app; this.ui = ui; this.els = {}; this.activeScene = null; this.matCat = 'In Model'; this.matTab = 'select'; }
  get state() { const s = this.app.settings; if (!s.panels) s.panels = JSON.parse(JSON.stringify(DEFAULT_PANELS)); for (const k of Object.keys(DEFAULT_PANELS)) if (!s.panels[k]) s.panels[k] = { ...DEFAULT_PANELS[k] }; return s.panels; }
  save() { this.app.saveSettings(); }
  build(tray) {
    this.tray = tray; tray.innerHTML = '';
    tray.append(h('div', { class: 'tray-title' }, 'Default Tray'));
    for (const [id, title, ic] of PANELS) {
      const head = h('div', { class: 'panel-head' }, h('span', { class: 'caret', html: icon('chevron') }), h('span', { class: 'pi', html: icon(ic) }), h('span', { class: 'pt' }, title), h('button', { class: 'tb xs', title: 'Close', html: icon('close'), onclick: (e) => { e.stopPropagation(); this.toggle(id); } }));
      const body = h('div', { class: 'panel-body' });
      const p = h('section', { class: 'panel', 'data-panel': id }, head, body);
      head.addEventListener('click', () => { this.state[id].open = !this.state[id].open; this.save(); this.layout(); this.render(id); });
      this.els[id] = { p, body };
      tray.append(p);
    }
    this.layout();
    const app = this.app;
    app.on('selection', () => { this.render('entity'); this.render('outliner'); });
    app.on('model', () => { for (const id of ['entity', 'tags', 'outliner', 'scenes', 'components', 'materials']) this.render(id); });
    app.on('tool', () => this.renderInstructor());
    app.on('materials', () => this.render('materials'));
    app.on('current-material', () => this.render('materials'));
    app.on('style', () => this.render('styles'));
    app.on('shadow', () => this.render('shadows'));
    for (const [id] of PANELS) this.render(id);
  }
  layout() { for (const [id] of PANELS) { const s = this.state[id], e = this.els[id]; e.p.style.display = s.show ? '' : 'none'; e.p.classList.toggle('open', !!s.open); } }
  visible(id) { return !!this.state[id]?.show; }
  toggle(id) { const s = this.state[id]; s.show = !s.show; if (s.show) s.open = true; this.save(); this.layout(); this.render(id); }
  open(id) { const s = this.state[id]; s.show = true; s.open = true; this.save(); this.layout(); this.render(id); this.els[id].p.scrollIntoView({ block: 'nearest' }); }
  render(id) {
    const e = this.els[id]; if (!e || !this.state[id].show || !this.state[id].open) return;
    const fn = this['r_' + id]; if (!fn) return;
    e.body.innerHTML = '';
    try { fn.call(this, e.body); } catch (err) { console.error(err); }
  }
  renderInstructor() { this.render('instructor'); }
  style() { return this.app.model.style; }
  styleChanged() { this.app.afterChange({ noHistory: true, dirty: true }); }

  // ------------------------------------------------------------ Entity Info
  r_entity(b) {
    const app = this.app, { ents, matrix } = app.ctxInfo(), s = splitSel(app.sel), n = app.sel.size;
    const tagSel = (cur, apply) => { const sel = h('select', {}); for (const t of app.model.tags.values()) sel.append(h('option', { value: t.id, selected: t.id === (cur || 0) }, t.name)); sel.addEventListener('change', () => apply(+sel.value)); return sel; };
    const fmt = (x) => app.units.format(x);
    if (!n) { b.append(h('div', { class: 'muted' }, app.ctxPath.length ? 'No selection (editing a group/component)' : 'No selection'), h('div', { class: 'kv' }, `${ents.faces.size} faces, ${ents.edges.size} edges, ${ents.insts.size} groups/components`)); return; }
    const setAll = (label, fn) => app.commit(label, () => { fn(); ents.touch(); });
    if (n === 1 && s.faces.length) {
      const f = ents.faces.get(s.faces[0]);
      b.append(h('div', { class: 'ei-type' }, 'Face'),
        h('div', { class: 'ei-mats' }, this.matChip(f.mat, 'Front'), this.matChip(f.back, 'Back', true)),
        field('Tag', tagSel(f.tag, (v) => setAll('Tag', () => { f.tag = v; }))),
        h('div', { class: 'kv' }, h('span', {}, 'Area'), h('b', {}, app.units.formatArea(faceArea(ents, f)))),
        chk(f.hidden, (v) => setAll('Hide', () => { f.hidden = v; }), 'Hidden'));
      return;
    }
    if (n === 1 && s.edges.length) {
      const e = ents.edges.get(s.edges[0]); const len = ents.P(e.a).distanceTo(ents.P(e.b));
      const c = e.curve != null ? ents.curves.get(e.curve) : null;
      b.append(h('div', { class: 'ei-type' }, c ? (c.arc ? 'Arc' : 'Circle') : 'Edge'),
        field('Tag', tagSel(e.tag, (v) => setAll('Tag', () => { e.tag = v; }))),
        h('div', { class: 'kv' }, h('span', {}, 'Length'), h('b', {}, fmt(len))));
      if (c && c.radius) b.append(h('div', { class: 'kv' }, h('span', {}, 'Radius'), h('b', {}, fmt(c.radius))), h('div', { class: 'kv' }, h('span', {}, 'Segments'), h('b', {}, String(c.segs))));
      b.append(chk(e.soft, (v) => setAll('Soften', () => { e.soft = v; }), 'Soft'), chk(e.smooth, (v) => setAll('Smooth', () => { e.smooth = v; }), 'Smooth'), chk(e.hidden, (v) => setAll('Hide', () => { e.hidden = v; }), 'Hidden'));
      return;
    }
    if (n === 1 && s.insts.length) {
      const i = ents.insts.get(s.insts[0]), d = app.model.defs.get(i.def);
      const box = entsBox(app.model, d.ents, i.m);
      const sz = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
      const pos = new THREE.Vector3().setFromMatrixPosition(i.m);
      let instances = 0; app.forAllEnts((E) => { for (const x of E.insts.values()) if (x.def === d.id) instances++; });
      b.append(h('div', { class: 'ei-type' }, d.group ? 'Group' : `Component (${instances} in model)`),
        h('div', { class: 'ei-mats' }, this.matChip(i.mat, 'Material', false, (m) => setAll('Paint', () => { i.mat = m; }))),
        field('Instance', txt(i.name, (v) => setAll('Rename', () => { i.name = v; }))),
        field(d.group ? 'Name' : 'Definition', txt(d.name, (v) => setAll('Rename', () => { d.name = v; }))),
        field('Tag', tagSel(i.tag, (v) => setAll('Tag', () => { i.tag = v; }))),
        h('div', { class: 'grid3' }, ...['X', 'Y', 'Z'].map((ax, k) => field('Pos ' + ax, num(+pos.getComponent(k).toFixed(2), (v) => setAll('Move', () => { const p = new THREE.Vector3().setFromMatrixPosition(i.m); p.setComponent(k, v); i.m.setPosition(p); }))))),
        h('div', { class: 'grid3' }, ...['X', 'Y', 'Z'].map((ax, k) => field('Size ' + ax, num(+sz.getComponent(k).toFixed(2), (v) => setAll('Resize', () => {
          const cur = sz.getComponent(k); if (!cur || !v) return; const f = [1, 1, 1]; f[k] = v / cur;
          const p = new THREE.Vector3().setFromMatrixPosition(i.m); const pmin = box.min.clone();
          i.m.premultiply(new THREE.Matrix4().makeTranslation(-pmin.x, -pmin.y, -pmin.z)).premultiply(new THREE.Matrix4().makeScale(...f)).premultiply(new THREE.Matrix4().makeTranslation(pmin.x, pmin.y, pmin.z)); void p;
        }))))),
        h('div', { class: 'row' }, chk(i.locked, (v) => setAll(v ? 'Lock' : 'Unlock', () => { i.locked = v; }), 'Locked'), chk(i.hidden, (v) => setAll('Hide', () => { i.hidden = v; }), 'Hidden'), d.group ? null : chk(d.faceCam, (v) => setAll('Face Camera', () => { d.faceCam = v; }), 'Face camera')),
        h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => app.openContext(i.id) }, 'Edit'), h('button', { class: 'btn sm', onclick: () => app.explodeSel() }, 'Explode')));
      return;
    }
    if (n === 1 && s.dims.length) { const d = ents.dims.get(s.dims[0]); b.append(h('div', { class: 'ei-type' }, 'Dimension'), h('div', { class: 'kv' }, h('span', {}, 'Length'), h('b', {}, fmt(d.a.distanceTo(d.b)))), field('Text', txt(d.text || '', (v) => setAll('Edit Dimension', () => { d.text = v || null; })))); return; }
    if (n === 1 && s.texts.length) { const t = ents.texts.get(s.texts[0]); b.append(h('div', { class: 'ei-type' }, 'Text'), field('Text', txt(t.text, (v) => setAll('Edit Text', () => { t.text = v; })))); return; }
    if (n === 1 && s.sections.length) { const c = ents.sections.get(s.sections[0]); b.append(h('div', { class: 'ei-type' }, 'Section Plane'), field('Name', txt(c.name, (v) => setAll('Rename', () => { c.name = v; }))), field('Symbol', txt(c.symbol, (v) => setAll('Rename', () => { c.symbol = v; }))), chk(app.model.activeSection === c.id, (v) => { app.model.activeSection = v ? c.id : null; app.afterChange({ noHistory: true, dirty: true }); }, 'Active cut')); return; }
    if (n === 1 && s.guides.length) { b.append(h('div', { class: 'ei-type' }, 'Guide')); return; }
    // multiple
    const area = s.faces.reduce((a, id) => a + faceArea(ents, ents.faces.get(id)), 0);
    b.append(h('div', { class: 'ei-type' }, `${n} Entities`), h('div', { class: 'kv' }, `${s.faces.length} faces · ${s.edges.length} edges · ${s.insts.length} groups/components`));
    if (s.faces.length) b.append(h('div', { class: 'kv' }, h('span', {}, 'Total area'), h('b', {}, app.units.formatArea(area))));
    if (s.edges.length) { const L = s.edges.reduce((a, id) => { const e = ents.edges.get(id); return a + ents.P(e.a).distanceTo(ents.P(e.b)); }, 0); b.append(h('div', { class: 'kv' }, h('span', {}, 'Total length'), h('b', {}, fmt(L)))); }
    b.append(field('Tag', tagSel(null, (v) => setAll('Tag', () => { for (const id of s.faces) ents.faces.get(id).tag = v; for (const id of s.edges) ents.edges.get(id).tag = v; for (const id of s.insts) ents.insts.get(id).tag = v; }))));
    void matrix;
  }
  matChip(id, label, back = false, onPick = null) {
    const app = this.app; const m = id != null ? app.model.materials.get(id) : null;
    const sw = h('div', { class: 'swatch', title: m ? m.name : 'Default', style: `background:${m ? `url(${swatchURL(m)}) center/cover` : back ? app.model.style.back : app.model.style.front}` });
    const el = h('div', { class: 'matchip' }, sw, h('div', {}, h('small', {}, label), h('div', {}, m ? m.name : '<Default>')));
    el.addEventListener('click', () => { if (onPick) onPick(app.currentMaterial); else this.open('materials'); });
    return el;
  }

  // ------------------------------------------------------------ Materials
  r_materials(b) {
    const app = this.app, model = app.model;
    const cur = app.currentMaterial != null ? model.materials.get(app.currentMaterial) : null;
    const head = h('div', { class: 'mat-head' },
      h('div', { class: 'swatch lg', style: `background:${cur ? `url(${swatchURL(cur)}) center/cover` : model.style.front}` }),
      h('div', { class: 'grow' }, h('b', {}, cur ? cur.name : 'Default'), h('div', { class: 'muted' }, cur ? (cur.tex ? `${app.units.format(cur.tw)} × ${app.units.format(cur.th)}` : cur.color) : 'Unpainted')),
      h('button', { class: 'btn sm', title: 'Default material', onclick: () => app.setCurrentMaterial(null) }, 'Default'),
      h('button', { class: 'btn sm', title: 'Create material', onclick: () => { const m = { id: nid(), name: 'Material ' + (model.materials.size + 1), color: '#8fb4d9', tex: null, tw: 1000, th: 1000, opacity: 1 }; model.materials.set(m.id, m); app.setCurrentMaterial(m.id); this.matTab = 'edit'; this.render('materials'); } }, '+'));
    const tabs = h('div', { class: 'tabs' }, ...['select', 'edit'].map((t) => h('button', { class: 'tab' + (this.matTab === t ? ' on' : ''), onclick: () => { this.matTab = t; this.render('materials'); } }, t === 'select' ? 'Select' : 'Edit')));
    b.append(head, tabs);
    if (this.matTab === 'edit') {
      if (!cur) { b.append(h('div', { class: 'muted' }, 'Pick a material in the model to edit it.')); return; }
      const upd = (fn) => { fn(); app.matVersion++; app.afterChange({ noHistory: true, dirty: true }); this.render('materials'); };
      const imgIn = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
      imgIn.addEventListener('change', () => { const f = imgIn.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => upd(() => { cur.tex = 'image'; cur.img = r.result; }); r.readAsDataURL(f); });
      b.append(field('Name', txt(cur.name, (v) => upd(() => { cur.name = v; }))), field('Color', color(cur.color, (v) => { cur.color = v; app.matVersion++; app.view.rebuild(); })),
        field('Opacity', range(cur.opacity ?? 1, 0.05, 1, 0.05, (v) => { cur.opacity = v; app.matVersion++; app.view.rebuild(); })),
        h('div', { class: 'grid2' }, field('Texture W', num(cur.tw, (v) => upd(() => { cur.tw = v; }))), field('Texture H', num(cur.th, (v) => upd(() => { cur.th = v; })))),
        h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => imgIn.click() }, 'Use image texture…'), cur.tex ? h('button', { class: 'btn sm', onclick: () => upd(() => { cur.tex = null; cur.img = null; }) }, 'Remove texture') : null, imgIn),
        h('button', { class: 'btn sm danger', onclick: () => app.commit('Delete Material', () => { model.materials.delete(cur.id); app.forAllEnts((E) => { for (const f of E.faces.values()) { if (f.mat === cur.id) f.mat = null; if (f.back === cur.id) f.back = null; } for (const i of E.insts.values()) if (i.mat === cur.id) i.mat = null; E.touch(); }); app.currentMaterial = null; }) }, 'Delete material'));
      return;
    }
    const sel = h('select', {}); for (const c of ['In Model', ...Object.keys(LIBRARY)]) sel.append(h('option', { selected: c === this.matCat }, c));
    sel.addEventListener('change', () => { this.matCat = sel.value; this.render('materials'); });
    b.append(sel);
    const grid = h('div', { class: 'swgrid' });
    if (this.matCat === 'In Model') {
      if (!model.materials.size) grid.append(h('div', { class: 'muted' }, 'No materials in model yet. Choose a library on the list above.'));
      for (const m of model.materials.values()) grid.append(h('button', { class: 'sw' + (app.currentMaterial === m.id ? ' on' : ''), title: m.name, style: `background:url(${swatchURL(m)}) center/cover`, onclick: () => app.setCurrentMaterial(m.id) }));
    } else {
      LIBRARY[this.matCat].forEach((entry, i) => grid.append(h('button', { class: 'sw', title: entry[0], style: `background:url(${libSwatch(entry)}) center/cover`, onclick: () => { const m = addLibraryMaterial(model, this.matCat, i); app.matVersion++; app.setCurrentMaterial(m.id); } })));
    }
    b.append(grid);
  }

  // ------------------------------------------------------------ Components
  r_components(b) {
    const app = this.app, model = app.model;
    const place = (def) => {
      let inst;
      app.commit('Place Component', () => { const { ents } = app.ctxInfo(); inst = { id: nid(), def: def.id, m: new THREE.Matrix4(), name: '', tag: 0, hidden: false, locked: false, mat: null }; ents.insts.set(inst.id, inst); ents.touch(); });
      app.applySelection(['i' + inst.id], 'set');
      app.setTool('move');
      app.tools.move.startPlacement(['i' + inst.id], new THREE.Vector3().applyMatrix4(app.ctxInfo().matrix));
      app.setStatus('Click to place the component. Press Esc to cancel.');
    };
    const inModel = [...model.defs.values()].filter((d) => !d.group);
    b.append(h('button', { class: 'comp ai', onclick: () => app.ui.image3d() }, h('span', { class: 'ci', html: icon('image3d') }), h('span', {}, h('b', {}, 'Image to 3D (AI)…'), h('small', {}, 'Upload a photo of an object (a chair, a lamp…) and get it as a 3D component'))));
    b.append(h('div', { class: 'sub' }, 'In Model'));
    const g1 = h('div', { class: 'complist' });
    if (!inModel.length) g1.append(h('div', { class: 'muted' }, 'No components yet.'));
    for (const d of inModel) g1.append(h('button', { class: 'comp', onclick: () => place(d) }, h('span', { class: 'ci', html: icon('component') }), h('span', {}, h('b', {}, d.name), h('small', {}, d.desc || ''))));
    b.append(g1, h('div', { class: 'sub' }, 'Library'));
    const g2 = h('div', { class: 'complist' });
    for (const c of COMPONENTS) g2.append(h('button', { class: 'comp', onclick: () => { let def = inModel.find((d) => d.libId === c.id); if (!def) { app.commit('Load Component', () => { def = buildComponent(model, c.id); }); app.matVersion++; } place(def); } }, h('span', { class: 'ci', html: icon(c.icon || 'components') }), h('span', {}, h('b', {}, c.name), h('small', {}, c.desc))));
    b.append(g2);
  }

  // ------------------------------------------------------------ Styles
  r_styles(b) {
    const app = this.app, st = this.style();
    const presets = {
      'Default Style': {},
      'Architectural Design': { bg: '#f7f5f0', sky: false, edgeRGB: '#2a2a2a', front: '#f4f1ea', back: '#c8c3b8' },
      'Hidden Line': { faceMode: 'hidden', sky: false, bg: '#ffffff' },
      'Blueprint': { faceMode: 'hidden', sky: false, bg: '#173d75', edgeRGB: '#e8f1ff' },
      'Monochrome': { faceMode: 'mono', sky: false, bg: '#ffffff' },
      'Shaded, No Edges': { edges: false },
      'Night': { bg: '#1c2230', skyRGB: '#2c3e63', edgeRGB: '#d9e1ee', front: '#c8ced8' },
      'Construction Docs': { faceMode: 'shaded', sky: false, bg: '#ffffff', edgeRGB: '#000000', front: '#ffffff', back: '#d0d0d0' },
    };
    const grid = h('div', { class: 'stylegrid' });
    for (const [name, p] of Object.entries(presets)) grid.append(h('button', { class: 'stylebtn' + (st.name === name ? ' on' : ''), onclick: () => { Object.assign(app.model.style, defaultStyle(), p, { name }); this.styleChanged(); this.render('styles'); app.emit('style'); } }, h('span', { class: 'stp', style: `background:${p.bg || '#fff'};border-color:${p.edgeRGB || '#1a1a1a'}` }, h('i', { style: `background:${p.faceMode === 'hidden' ? (p.bg || '#fff') : p.front || '#fff'};border-color:${p.edgeRGB || '#1a1a1a'}` })), name));
    b.append(h('div', { class: 'sub' }, 'Styles'), grid, h('div', { class: 'sub' }, 'Edit'));
    const set = (k) => (v) => { st[k] = v; this.styleChanged(); app.emit('style'); };
    b.append(h('div', { class: 'row wrap' }, chk(st.edges, set('edges'), 'Edges'), chk(st.backEdges, set('backEdges'), 'Back edges'), chk(st.xray, set('xray'), 'X-ray')),
      field('Edge color', (() => { const s = h('select', {}); for (const [v, l] of [['all', 'All same'], ['axis', 'By axis']]) s.append(h('option', { value: v, selected: st.edgeColor === v }, l)); s.addEventListener('change', () => set('edgeColor')(s.value)); return s; })()),
      h('div', { class: 'grid2' }, field('Edges', color(st.edgeRGB, set('edgeRGB'))), field('Background', color(st.bg, set('bg'))), field('Front face', color(st.front, set('front'))), field('Back face', color(st.back, set('back')))),
      h('div', { class: 'row wrap' }, chk(st.sky, set('sky'), 'Sky'), color(st.skyRGB, set('skyRGB')), chk(st.ground, set('ground'), 'Ground'), color(st.groundRGB, set('groundRGB'))),
      field('Section fill', color(st.sectionFillRGB, set('sectionFillRGB'))));
  }

  // ------------------------------------------------------------ Tags
  r_tags(b) {
    const app = this.app, model = app.model;
    const bar = h('div', { class: 'row' },
      h('button', { class: 'btn sm', onclick: () => app.commit('Add Tag', () => { const id = nid(); model.tags.set(id, { id, name: 'Tag ' + model.tags.size, visible: true, color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0') }); }) }, '+ Tag'),
      h('button', { class: 'btn sm', title: 'Assign the selection to the highlighted tag', onclick: () => { if (this.curTag == null) return; const s = splitSel(app.sel); const { ents } = app.ctxInfo(); app.commit('Tag', () => { for (const id of s.faces) ents.faces.get(id).tag = this.curTag; for (const id of s.edges) ents.edges.get(id).tag = this.curTag; for (const id of s.insts) ents.insts.get(id).tag = this.curTag; ents.touch(); }); } }, 'Assign selection'));
    b.append(bar);
    const list = h('div', { class: 'taglist' });
    for (const t of model.tags.values()) {
      const eye = h('button', { class: 'tb xs', html: icon(t.visible !== false ? 'eye' : 'eyeoff'), onclick: (e) => { e.stopPropagation(); t.visible = t.visible === false; app.afterChange({ noHistory: true, dirty: true }); this.render('tags'); } });
      const name = h('input', { value: t.name, disabled: t.id === 0 }); name.addEventListener('change', () => app.commit('Rename Tag', () => { t.name = name.value; }));
      const row = h('div', { class: 'tagrow' + (this.curTag === t.id ? ' on' : '') }, eye, h('span', { class: 'tagdot', style: `background:${t.color}` }), name,
        t.id ? h('button', { class: 'tb xs', title: 'Delete tag', html: icon('trash'), onclick: (e) => { e.stopPropagation(); app.commit('Delete Tag', () => { model.tags.delete(t.id); app.forAllEnts((E) => { for (const x of [...E.faces.values(), ...E.edges.values(), ...E.insts.values()]) if (x.tag === t.id) x.tag = 0; E.touch(); }); }); } }) : null);
      row.addEventListener('click', () => { this.curTag = t.id; this.render('tags'); });
      list.append(row);
    }
    b.append(list);
  }

  // ------------------------------------------------------------ Scenes
  get scenesApi() {
    const app = this.app, self = this;
    const capture = () => ({ cam: app.view.saveCamera(), style: JSON.parse(JSON.stringify(app.model.style)), shadow: { ...app.model.shadow }, hiddenTags: [...app.model.tags.values()].filter((t) => t.visible === false).map((t) => t.id), activeSection: app.model.activeSection ?? null, thumb: thumb() });
    const thumb = () => { try { return app.view.snapshot(160, 100).toDataURL('image/jpeg', 0.7); } catch (e) { return null; } };
    return {
      add() { app.commit('Add Scene', () => { app.model.scenes.push({ name: 'Scene ' + (app.model.scenes.length + 1), ...capture() }); self.activeScene = app.model.scenes.length - 1; }); app.ui.renderSceneTabs(); },
      update() { const i = self.activeScene; if (i == null) return; app.commit('Update Scene', () => { Object.assign(app.model.scenes[i], capture()); }); },
      remove() { const i = self.activeScene; if (i == null) return; app.commit('Delete Scene', () => { app.model.scenes.splice(i, 1); self.activeScene = null; }); app.ui.renderSceneTabs(); },
      go(i, ms = 700) {
        const s = app.model.scenes[i]; if (!s) return;
        self.activeScene = i;
        if (s.style) Object.assign(app.model.style, s.style);
        if (s.shadow) Object.assign(app.model.shadow, s.shadow);
        if (s.hiddenTags) for (const t of app.model.tags.values()) t.visible = !s.hiddenTags.includes(t.id);
        app.model.activeSection = s.activeSection ?? null;
        app.view.cam.ortho = !!s.cam.ortho; app.view.cam.twoPoint = !!s.cam.twoPoint;
        app.view.loadCamera(s.cam, ms);
        app.matVersion++; app.afterChange({ noHistory: true });
        app.ui.renderSceneTabs(); app.emit('style'); app.emit('shadow');
      },
      play() {
        const n = app.model.scenes.length; if (!n) return;
        let i = 0; const step = () => { if (i >= n || app._stopAnim) { app._stopAnim = false; return; } this.go(i, 1500); i++; setTimeout(step, 3500); };
        app._stopAnim = false; step();
      },
    };
  }
  r_scenes(b) {
    const app = this.app, api = this.scenesApi;
    b.append(h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => api.add() }, '+ Add'), h('button', { class: 'btn sm', onclick: () => api.update() }, 'Update'), h('button', { class: 'btn sm', onclick: () => api.remove() }, 'Delete'), h('button', { class: 'btn sm', onclick: () => api.play() }, '▶ Play')));
    const list = h('div', { class: 'scenelist' });
    app.model.scenes.forEach((s, i) => {
      const name = h('input', { value: s.name }); name.addEventListener('change', () => { app.commit('Rename Scene', () => { s.name = name.value; }); app.ui.renderSceneTabs(); });
      name.addEventListener('click', (e) => e.stopPropagation());
      const row = h('div', { class: 'scenerow' + (this.activeScene === i ? ' on' : '') }, s.thumb ? h('img', { src: s.thumb }) : h('div', { class: 'thumb' }), name);
      row.addEventListener('click', () => api.go(i));
      list.append(row);
    });
    if (!app.model.scenes.length) list.append(h('div', { class: 'muted' }, 'Scenes save the camera, style, shadows, tag visibility and active section cut.'));
    b.append(list);
  }

  // ------------------------------------------------------------ Shadows
  r_shadows(b) {
    const app = this.app, sh = app.model.shadow, geo = app.model.geo;
    const upd = () => { app.view.updateLights(); app.afterChange({ noHistory: true, dirty: true }); info.textContent = sunInfo(); };
    const sunInfo = () => { const d = sunDirection(geo, sh); const alt = (Math.asin(d.z) * 180) / Math.PI; return `Sun altitude ${alt.toFixed(1)}° · ${geo.lat.toFixed(3)}, ${geo.lon.toFixed(3)} · UTC${geo.tz >= 0 ? '+' : ''}${geo.tz}`; };
    const hh = (x) => `${String(Math.floor(x)).padStart(2, '0')}:${String(Math.round((x % 1) * 60)).padStart(2, '0')}`;
    const tl = h('span', { class: 'val' }, hh(sh.hour)), dl = h('span', { class: 'val' }, `${sh.day}/${sh.month}`);
    const info = h('div', { class: 'muted' }, sunInfo());
    b.append(chk(sh.on, (v) => { sh.on = v; upd(); app.emit('shadow'); }, 'Show shadows'),
      h('div', { class: 'fld' }, h('span', {}, 'Time'), range(sh.hour, 5, 19, 0.0833, (v) => { sh.hour = v; tl.textContent = hh(v); upd(); }), tl),
      h('div', { class: 'fld' }, h('span', {}, 'Date'), range((sh.month - 1) * 30.5 + sh.day, 1, 365, 1, (v) => { sh.month = Math.min(12, Math.floor((v - 1) / 30.5) + 1); sh.day = Math.max(1, Math.round(v - (sh.month - 1) * 30.5)); dl.textContent = `${sh.day}/${sh.month}`; upd(); }), dl),
      h('div', { class: 'fld' }, h('span', {}, 'Light'), range(sh.light, 0, 100, 1, (v) => { sh.light = v; upd(); })),
      h('div', { class: 'fld' }, h('span', {}, 'Dark'), range(sh.dark, 0, 100, 1, (v) => { sh.dark = v; upd(); })),
      h('div', { class: 'row' }, chk(sh.onFaces !== false, (v) => { sh.onFaces = v; upd(); }, 'On faces'), chk(sh.onGround !== false, (v) => { sh.onGround = v; upd(); }, 'On ground')),
      info, h('button', { class: 'btn sm', onclick: () => this.ui.dialogModelInfo('geo') }, 'Geo-location…'));
  }
  r_fog(b) {
    const app = this.app, f = app.model.fog, upd = () => app.afterChange({ noHistory: true, dirty: true });
    b.append(chk(f.on, (v) => { f.on = v; upd(); }, 'Display fog'), h('div', { class: 'fld' }, h('span', {}, 'Start'), range(f.start, 0, 1, 0.01, (v) => { f.start = v; upd(); })), h('div', { class: 'fld' }, h('span', {}, 'End'), range(f.end, 0, 1.5, 0.01, (v) => { f.end = v; upd(); })), h('div', { class: 'row' }, chk(f.useBg, (v) => { f.useBg = v; upd(); }, 'Use background color'), color(f.color, (v) => { f.color = v; upd(); })));
  }

  // ------------------------------------------------------------ Outliner
  r_outliner(b) {
    const app = this.app, model = app.model;
    const filter = h('input', { placeholder: 'Filter', value: this.olf || '' }); filter.addEventListener('input', () => { this.olf = filter.value; this.render('outliner'); setTimeout(() => this.els.outliner.body.querySelector('input')?.focus(), 0); });
    b.append(filter);
    const tree = h('div', { class: 'tree' });
    const walk = (ents, path, depth) => {
      for (const i of ents.insts.values()) {
        const d = model.defs.get(i.def); if (!d) continue;
        const name = (i.name ? i.name + ' ' : '') + (d.group ? (i.name ? '' : 'Group') : `<${d.name}>`);
        const p = [...path, i.id];
        const match = !this.olf || name.toLowerCase().includes(this.olf.toLowerCase());
        if (match) {
          const selected = app.ctxPathEq(path) && app.sel.has('i' + i.id);
          const row = h('div', { class: 'trow' + (selected ? ' on' : '') + (app.ctxPathEq(p) ? ' ctx' : ''), style: `padding-left:${8 + depth * 14}px` },
            h('span', { class: 'ti', html: icon(d.group ? 'group' : 'component') }), h('span', { class: 'tn' }, name),
            h('button', { class: 'tb xs', html: icon(i.hidden ? 'eyeoff' : 'eye'), onclick: (e) => { e.stopPropagation(); app.commit(i.hidden ? 'Unhide' : 'Hide', () => { i.hidden = !i.hidden; ents.touch(); }); } }));
          row.addEventListener('click', () => { app.ctxPath = path; app.sel = new Set(['i' + i.id]); app.afterChange({ noHistory: true }); });
          row.addEventListener('dblclick', () => { app.ctxPath = path; app.openContext(i.id); });
          tree.append(row);
        }
        walk(d.ents, p, depth + 1);
      }
    };
    tree.append(h('div', { class: 'trow root' + (app.ctxPath.length ? '' : ' ctx'), onclick: () => app.closeContext(true) }, h('span', { class: 'ti', html: icon('iso') }), h('b', {}, app.fileName || 'Untitled')));
    walk(model.root, [], 1);
    b.append(tree);
  }

  // ------------------------------------------------------------ Soften Edges
  r_soften(b) {
    const app = this.app;
    const st = this.soft = this.soft || { angle: 20, smooth: true, coplanar: true };
    const val = h('span', { class: 'val' }, st.angle + '°');
    const apply = () => {
      const { ents } = app.ctxInfo(); const s = splitSel(app.sel);
      const edges = new Set(s.edges); for (const fid of s.faces) { const f = ents.faces.get(fid); for (const l of f.loops) for (let i = 0; i < l.length; i++) { const e = [...ents.vedges.get(l[i])].map((x) => ents.edges.get(x)).find((e) => e.a === l[(i + 1) % l.length] || e.b === l[(i + 1) % l.length]); if (e) edges.add(e.id); } }
      if (!edges.size) { app.toast('Select edges or faces first'); return; }
      app.commit('Soften Edges', () => {
        const lim = Math.cos((st.angle * Math.PI) / 180);
        for (const id of edges) { const e = ents.edges.get(id); if (!e || e.faces.size !== 2) continue; const [f, g] = [...e.faces].map((x) => ents.faces.get(x)); const dot = f.n.dot(g.n); const soft = dot >= lim && (st.coplanar || dot < 1 - 1e-6); e.soft = soft; e.smooth = soft && st.smooth; }
        ents.touch();
      });
    };
    b.append(h('div', { class: 'fld' }, h('span', {}, 'Angle'), range(st.angle, 0, 180, 1, (v) => { st.angle = v; val.textContent = v + '°'; }), val), chk(st.smooth, (v) => { st.smooth = v; }, 'Smooth normals'), chk(st.coplanar, (v) => { st.coplanar = v; }, 'Soften coplanar'), h('button', { class: 'btn sm primary', onclick: apply }, 'Apply to selection'));
  }

  // ------------------------------------------------------------ Instructor
  r_instructor(b) {
    const app = this.app, t = app.tool; if (!t) return;
    const cmd = app.cmds['tool:' + t.id];
    b.append(h('div', { class: 'instr-head' }, h('span', { class: 'ii', html: icon(cmd?.icon || t.id) }), h('b', {}, cmd?.label || t.id)), h('p', {}, t.hint || ''),
      h('div', { class: 'muted' }, 'Navigation: middle-drag = orbit, Shift+middle-drag = pan, scroll = zoom to cursor, double-click middle = center. Trackpad: two-finger swipe = orbit, Shift+swipe = pan, pinch = zoom.'));
  }
}
