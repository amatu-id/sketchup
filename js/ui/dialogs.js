// Dialogs: Welcome, Model Info, Preferences (incl. shortcut editor), Make Component, 3D Text, Export, Working Drawings, etc.
import * as THREE from 'three';
import { icon } from './icons.js';
import { DEFAULT_KEYS, keyLabel } from './commands.js';
import { isMac } from '../tools/base.js';
import { Entities, nid } from '../core/model.js';
import { build3DText } from '../tools/construct.js';
import { entsBox } from '../core/ops.js';
import { NAV_DEFAULTS } from '../view/viewport.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};
const field = (label, input) => h('label', { class: 'fld' }, h('span', {}, label), input);
const inp = (v, type = 'text', attrs = {}) => h('input', { type, value: v ?? '', ...attrs });
const sel = (opts, v) => { const s = h('select', {}); for (const [val, l] of opts) s.append(h('option', { value: val, selected: String(val) === String(v) }, l)); return s; };
const cb = (v, label) => { const i = h('input', { type: 'checkbox' }); i.checked = !!v; return [h('label', { class: 'chk' }, i, h('span', {}, label)), i]; };

export class Dialogs {
  constructor(app, ui) { this.app = app; this.ui = ui; }
  prompt(title, value, done) {
    const i = inp(value); const body = h('div', {}, i);
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { this.ui.closeModal(); done(i.value); } e.stopPropagation(); });
    this.ui.modal(title, body, [{ label: 'Cancel', run: () => done(null) }, { label: 'OK', primary: true, run: () => done(i.value) }]);
    setTimeout(() => i.select(), 40);
  }
  confirm(text, yes, no) { this.ui.modal('Amatu Sketch', h('p', { class: 'pre' }, text), [{ label: 'No', run: () => no?.() }, { label: 'Yes', primary: true, run: () => yes() }]); }
  confirmDiscard(next) { if (!this.app.dirty) { next(); return; } this.ui.modal('Save changes?', h('p', {}, `Save changes to “${this.app.fileName || 'Untitled'}” before continuing?`), [{ label: 'Cancel' }, { label: "Don't Save", run: () => next() }, { label: 'Save', primary: true, run: () => { this.app.io.save().then(() => next()); } }]); }

  welcome(isNew = false) {
    const app = this.app, auto = app.autosaved();
    const templates = [['mm', 'Simple — Millimeters', 'Perspective, mm units'], ['m', 'Simple — Meters', 'Perspective, m units'], ['cm', 'Simple — Centimeters', 'Perspective, cm units'], ['arch', 'Architectural — Feet and Inches', 'Imperial'], ['plan', 'Plan View — Millimeters', 'Top view, parallel projection']];
    const list = h('div', { class: 'tpl' });
    for (const [id, name, desc] of templates) list.append(h('button', { class: 'tplbtn', onclick: () => { this.ui.closeModal(); app.newModel(id); } }, h('span', { class: 'ti', html: icon(id === 'plan' ? 'top' : 'iso') }), h('span', {}, h('b', {}, name), h('small', {}, desc))));
    const side = h('div', { class: 'welcome-side' },
      h('div', { class: 'welcome-logo', html: '<svg viewBox="0 0 24 24"><path d="M3 8l9-5 9 5v8l-9 5-9-5z" fill="#d8262e"/><path d="M3 8l9 5 9-5M12 13v8" stroke="#fff" stroke-width="1.4" fill="none"/></svg>' }),
      h('h2', {}, 'Amatu Sketch'), h('p', { class: 'muted' }, 'Push/Pull 3D modeling in your browser, with working drawings export to PDF and AutoCAD DXF.'),
      h('button', { class: 'btn', onclick: () => { this.ui.closeModal(); app.io.open(); } }, h('span', { class: 'ic', html: icon('open') }), 'Open a file…'),
      auto && auto.model ? h('button', { class: 'btn primary', onclick: () => { this.ui.closeModal(); app.loadModel(auto.model, auto.name, auto.cam); app.dirty = true; app.ui.updateTitle(); } }, h('span', { class: 'ic', html: icon('save') }), `Restore autosave (${new Date(auto.t).toLocaleString()})`) : null,
      h('button', { class: 'btn', onclick: () => { this.ui.closeModal(); app.newModel('mm'); app.io.loadDemo(); } }, 'Open demo house'));
    const body = h('div', { class: 'welcome' }, side, h('div', { class: 'welcome-main' }, h('h3', {}, 'Templates'), list));
    this.ui.modal(isNew ? 'New Model' : 'Welcome', body, [], { wide: true, cls: 'welcome-modal', noFocus: true });
  }

  dialogModelInfo(tab = 'units') {
    const app = this.app, m = app.model;
    const tabs = ['units', 'geo', 'dimensions', 'statistics', 'info'];
    const names = { units: 'Units', geo: 'Geo-location', dimensions: 'Dimensions', statistics: 'Statistics', info: 'Credits & File' };
    const nav = h('div', { class: 'vtabs' }), pane = h('div', { class: 'vpane' });
    const show = (t) => {
      for (const b of nav.children) b.classList.toggle('on', b.dataset.t === t);
      pane.innerHTML = '';
      if (t === 'units') {
        const u = sel([['mm', 'Millimeters'], ['cm', 'Centimeters'], ['m', 'Meters'], ['in', 'Inches'], ['ft', 'Feet'], ['arch', 'Architectural (ft/in)']], m.units.unit);
        const p = sel([[0, '0'], [1, '0.0'], [2, '0.00'], [3, '0.000'], [4, '0.0000']], m.units.precision);
        const a = sel([[0, 'Off'], [5, '5°'], [10, '10°'], [15, '15°'], [30, '30°'], [45, '45°']], m.units.angleSnap);
        const [unitShow, ui] = cb(m.units.showUnit !== false, 'Display units format');
        const apply = () => { m.units.unit = u.value; m.units.precision = +p.value; m.units.angleSnap = +a.value || 0.0001; m.units.showUnit = ui.checked; app.afterChange({ noHistory: true, dirty: true }); };
        for (const x of [u, p, a, ui]) x.addEventListener('change', apply);
        pane.append(h('h4', {}, 'Length units'), field('Format', u), field('Precision', p), unitShow, h('h4', {}, 'Angle units'), field('Angle snapping', a));
      } else if (t === 'geo') {
        const lat = inp(m.geo.lat, 'number', { step: 'any' }), lon = inp(m.geo.lon, 'number', { step: 'any' }), tz = inp(m.geo.tz, 'number', { step: '0.5' }), north = inp(m.geo.north, 'number', { step: 'any' });
        const apply = () => { m.geo.lat = +lat.value; m.geo.lon = +lon.value; m.geo.tz = +tz.value; m.geo.north = +north.value; app.view.updateLights(); app.afterChange({ noHistory: true, dirty: true }); };
        for (const x of [lat, lon, tz, north]) x.addEventListener('change', apply);
        const presets = sel([['', 'Choose a city…'], ['-6.2,106.82,7', 'Jakarta'], ['-6.92,107.61,7', 'Bandung'], ['-7.25,112.75,7', 'Surabaya'], ['-7.8,110.37,7', 'Yogyakarta'], ['3.59,98.67,7', 'Medan'], ['-8.65,115.22,8', 'Denpasar'], ['-5.15,119.43,8', 'Makassar'], ['-0.03,109.33,7', 'Pontianak'], ['1.29,103.85,8', 'Singapore'], ['51.5,-0.12,0', 'London'], ['40.71,-74.0,-5', 'New York']], '');
        presets.addEventListener('change', () => { if (!presets.value) return; const [a, b, c] = presets.value.split(','); lat.value = a; lon.value = b; tz.value = c; apply(); });
        pane.append(h('h4', {}, 'Location (used for shadows)'), field('City', presets), field('Latitude', lat), field('Longitude', lon), field('Time zone (UTC±)', tz), field('North angle (°)', north));
      } else if (t === 'dimensions') {
        const ts = inp(m.dimStyle.textSize, 'number');
        ts.addEventListener('change', () => { m.dimStyle.textSize = +ts.value; app.afterChange({ noHistory: true, dirty: true }); });
        pane.append(field('Text size (px / pt in drawings)', ts));
      } else if (t === 'statistics') {
        let f = 0, e = 0, g = 0, c = 0; app.forAllEnts((E) => { f += E.faces.size; e += E.edges.size; });
        for (const d of m.defs.values()) d.group ? g++ : c++;
        const box = entsBox(m, m.root);
        const sz = box.isEmpty() ? null : box.getSize(new THREE.Vector3());
        pane.append(h('table', { class: 'stats' }, ...[['Faces', f], ['Edges', e], ['Group definitions', g], ['Component definitions', c], ['Materials', m.materials.size], ['Tags', m.tags.size], ['Scenes', m.scenes.length], ['Model size', sz ? `${app.units.format(sz.x)} × ${app.units.format(sz.y)} × ${app.units.format(sz.z)}` : '—']].map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, String(v))))),
          h('button', { class: 'btn sm', onclick: () => { app.commit('Purge Unused', () => { const used = new Set(); const walk = (E) => { for (const i of E.insts.values()) if (!used.has(i.def)) { used.add(i.def); walk(m.defs.get(i.def).ents); } }; walk(m.root); for (const id of [...m.defs.keys()]) if (!used.has(id)) m.defs.delete(id); const um = new Set(); app.forAllEnts((E) => { for (const x of E.faces.values()) { um.add(x.mat); um.add(x.back); } for (const x of E.insts.values()) um.add(x.mat); }); for (const id of [...m.materials.keys()]) if (!um.has(id)) m.materials.delete(id); }); show('statistics'); } }, 'Purge Unused'));
      } else if (t === 'info') {
        const fields = [['name', 'Project / model name'], ['client', 'Client (Pemilik)'], ['location', 'Location (Lokasi)'], ['author', 'Designer (Digambar)'], ['checker', 'Checked by (Diperiksa)'], ['desc', 'Description']];
        for (const [k, l] of fields) { const i = inp(m.info[k]); i.addEventListener('change', () => { m.info[k] = i.value; app.dirty = true; app.ui.updateTitle(); }); pane.append(field(l, i)); }
        pane.append(h('p', { class: 'muted' }, 'These fields fill the title block of exported working drawings.'));
      }
    };
    for (const t of tabs) nav.append(h('button', { class: 'vtab', 'data-t': t, onclick: () => show(t) }, names[t]));
    this.ui.modal('Model Info', h('div', { class: 'vsplit' }, nav, pane), [{ label: 'Close', primary: true }], { wide: true });
    show(tab);
  }

  dialogPrefs(tab = 'general') {
    const app = this.app, s = app.settings;
    const nav = h('div', { class: 'vtabs' }), pane = h('div', { class: 'vpane' });
    const show = (t) => {
      for (const b of nav.children) b.classList.toggle('on', b.dataset.t === t);
      pane.innerHTML = '';
      if (t === 'general') {
        const opts = [['tooltips', 'Show inference tooltips'], ['autosave', 'Auto-save to this browser'], ['spaceSelect', 'Space bar activates Select']];
        for (const [k, l] of opts) { const [row, i] = cb(k === 'spaceSelect' ? s[k] !== false : s[k], l); i.addEventListener('change', () => { s[k] = i.checked; app.saveSettings(); }); pane.append(row); }
        pane.append(h('p', { class: 'muted' }, 'Mouse, trackpad and touch sensitivity are under ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); show('nav'); } }, 'Navigation'), '.'));
      } else if (t === 'nav') {
        this.navPrefs(pane, () => show('nav'));
      } else if (t === 'ai') {
        this.aiPrefs(pane);
      } else {
        const filter = inp('', 'search', { placeholder: 'Filter commands…' });
        const list = h('div', { class: 'keylist' });
        const render = () => {
          list.innerHTML = '';
          const keys = { ...DEFAULT_KEYS, ...s.keys };
          const f = filter.value.toLowerCase();
          for (const [id, cmd] of Object.entries(app.cmds)) {
            if (!cmd.label) continue;
            if (f && !cmd.label.toLowerCase().includes(f) && !id.includes(f)) continue;
            const k = keys[id] || '';
            const keyBtn = h('button', { class: 'keycap' + (k ? '' : ' empty') }, k ? keyLabel(k) : 'Add');
            keyBtn.addEventListener('click', () => {
              keyBtn.textContent = 'Press keys…'; keyBtn.classList.add('rec');
              const onk = (e) => {
                e.preventDefault(); e.stopPropagation();
                if (e.key === 'Escape') { done(); return; }
                const combo = app.keyCombo(e); if (!combo) return;
                for (const [oid, ok] of Object.entries({ ...DEFAULT_KEYS, ...s.keys })) if (ok && ok.split('|').includes(combo) && oid !== id) s.keys[oid] = '';
                s.keys[id] = combo; app.saveSettings(); done();
              };
              const done = () => { window.removeEventListener('keydown', onk, true); render(); app.ui.buildToolbars(); };
              window.addEventListener('keydown', onk, true);
            });
            const clear = h('button', { class: 'tb xs', title: 'Remove shortcut', html: icon('close'), onclick: () => { s.keys[id] = ''; app.saveSettings(); render(); } });
            list.append(h('div', { class: 'keyrow' }, h('span', {}, cmd.label), keyBtn, k ? clear : h('span', {})));
          }
        };
        filter.addEventListener('input', render);
        pane.append(h('div', { class: 'row' }, filter, h('button', { class: 'btn sm', onclick: () => { s.keys = {}; app.saveSettings(); render(); } }, 'Reset All')), list,
          h('p', { class: 'muted' }, isMac ? 'On macOS, “⌘” is used where SketchUp for Windows uses Ctrl. A few browser shortcuts (⌘N, ⌘T, ⌘W) cannot be overridden.' : 'Some browser shortcuts (Ctrl+N, Ctrl+T, Ctrl+W) cannot be overridden by web pages.'));
        render();
      }
    };
    for (const [t, l] of [['general', 'General'], ['nav', 'Navigation'], ['ai', 'Image to 3D (AI)'], ['shortcuts', 'Shortcuts']]) nav.append(h('button', { class: 'vtab', 'data-t': t, onclick: () => show(t) }, l));
    this.ui.modal('Preferences', h('div', { class: 'vsplit' }, nav, pane), [{ label: 'Close', primary: true }], { wide: true });
    show(tab);
  }

  // Preferences › Navigation: mouse, trackpad and touch-screen sensitivity (applied live by the viewport)
  navPrefs(pane, refresh) {
    const app = this.app, s = app.settings, N = app.view.navCfg();
    const set = (k, v) => { s[k] = v; if (k === 'wheelMode') s.trackpad = v !== 'mouse'; app.saveSettings(); };
    const pct = (v) => Math.round(v * 100) + '%';
    const slider = (k, label, min = 0.2, max = 3) => {
      const out = h('output', {}, pct(N[k]));
      const r = h('input', { type: 'range', min, max, step: 0.05, value: N[k], 'aria-label': label });
      r.addEventListener('input', () => { set(k, +r.value); out.textContent = pct(+r.value); });
      r.addEventListener('dblclick', () => { r.value = NAV_DEFAULTS[k]; set(k, NAV_DEFAULTS[k]); out.textContent = pct(NAV_DEFAULTS[k]); });
      return h('label', { class: 'fld sl', title: 'Double-click the slider to reset to the default (' + pct(NAV_DEFAULTS[k]) + ')' }, h('span', {}, label), r, out);
    };
    const choice = (k, label, opts) => { const x = sel(opts, N[k]); x.addEventListener('change', () => set(k, x.value)); return field(label, x); };
    const check = (k, label) => { const [row, i] = cb(N[k], label); i.addEventListener('change', () => set(k, i.checked)); return row; };
    pane.append(
      h('h4', {}, 'Mouse'),
      slider('orbitSpeed', 'Orbit sensitivity'), slider('panSpeed', 'Pan sensitivity'), slider('zoomSpeed', 'Scroll-wheel zoom speed'),
      choice('middleButton', 'Middle-button drag', [['orbit', 'Orbit  ·  Shift = Pan'], ['pan', 'Pan  ·  Shift = Orbit']]),
      choice('orbitPivot', 'Orbit around', [['auto', 'Point under the cursor'], ['cursor', 'Point under the cursor (trackpad too)'], ['center', 'Center of the view']]),
      h('div', { class: 'row' }, check('zoomToCursor', 'Zoom toward the cursor'), check('invertZoom', 'Invert wheel zoom'), check('invertOrbitX', 'Invert orbit left/right'), check('invertOrbitY', 'Invert orbit up/down')),
      h('h4', {}, 'Trackpad'),
      choice('wheelMode', 'Scrolling device', [['auto', 'Detect automatically'], ['trackpad', 'Trackpad — swipe moves the view'], ['mouse', 'Mouse wheel — scroll zooms']]),
      choice('tpSwipe', 'Two-finger swipe', [['orbit', 'Orbit  ·  Shift = Pan'], ['pan', 'Pan  ·  Shift = Orbit']]),
      slider('tpOrbitSpeed', 'Swipe orbit sensitivity'), slider('tpPanSpeed', 'Swipe pan sensitivity'), slider('pinchSpeed', 'Pinch zoom sensitivity'),
      h('div', { class: 'row' }, check('tpInvert', 'Reverse swipe direction')),
      h('h4', {}, 'Touch screen (phone & tablet)'),
      choice('touchTwoFinger', 'Two-finger drag', [['orbit', 'Orbit  ·  three fingers = Pan'], ['pan', 'Pan  ·  three fingers = Orbit']]),
      slider('touchOrbitSpeed', 'Orbit sensitivity'), slider('touchPanSpeed', 'Pan sensitivity'), slider('touchPinchSpeed', 'Pinch zoom sensitivity'),
      h('div', { class: 'row' }, check('touchTwist', 'Twist two fingers to spin the view')),
      h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => { for (const k of Object.keys(NAV_DEFAULTS)) delete s[k]; s.trackpad = isMac; app.saveSettings(); refresh(); app.toast('Navigation reset to defaults'); } }, 'Reset to defaults'),
        h('span', { class: 'muted' }, 'Changes apply right away. If a mouse wheel orbits instead of zooming, set Scrolling device to Mouse wheel.')),
    );
  }
  aiPrefs(pane) {
    const app = this.app, s = app.settings;
    const tok = inp(s.hfToken || '', 'password', { placeholder: 'hf_…', autocomplete: 'off', spellcheck: 'false' });
    tok.addEventListener('change', () => { s.hfToken = tok.value.trim(); app.saveSettings(); app.toast(s.hfToken ? 'Hugging Face token saved' : 'Token removed'); });
    pane.append(
      h('p', {}, 'Image to 3D sends your picture to free AI models on Hugging Face (Hunyuan3D, TRELLIS, Stable Fast 3D, TripoSG). Each visitor gets a small free GPU quota per day.'),
      field('Hugging Face token', tok),
      h('p', { class: 'muted' }, 'Optional. With a free account the daily quota is larger; with PRO it is much larger. Create a token with “Read” access at huggingface.co › Settings › Access Tokens and paste it here. It is kept in this app’s settings and sent only to Hugging Face.'),
    );
  }

  dialogMakeComponent() {
    const app = this.app; if (!app.sel.size) return;
    const name = inp('Component#' + ([...app.model.defs.values()].filter((d) => !d.group).length + 1)), desc = inp('');
    const [fcRow, fc] = cb(false, 'Always face camera'); const [rpRow, rp] = cb(true, 'Replace selection with component');
    this.ui.modal('Create Component', h('div', {}, field('Definition', name), field('Description', desc), fcRow, rpRow), [{ label: 'Cancel' }, { label: 'Create', primary: true, run: () => {
      const inst = app.makeGroupCmd(true, { name: name.value || 'Component', desc: desc.value, faceCam: fc.checked });
      if (inst && !rp.checked) { /* keep geometry: explode copy */ }
    } }]);
  }

  dialog3DText() {
    const app = this.app;
    const t = h('textarea', { rows: 3 }, 'Enter text'), hgt = inp(app.units.format(500, { unit: true }).replace('~ ', '')), ext = inp(app.units.format(50).replace('~ ', ''));
    const font = sel([['regular', 'Helvetiker Regular'], ['bold', 'Helvetiker Bold']], 'regular'), align = sel([['left', 'Left'], ['center', 'Center'], ['right', 'Right']], 'left');
    const [fRow, filled] = cb(true, 'Filled'); const [eRow, extr] = cb(true, 'Extruded');
    this.ui.modal('Place 3D Text', h('div', {}, t, h('div', { class: 'grid2' }, field('Font', font), field('Align', align), field('Height', hgt), field('Extruded', ext)), h('div', { class: 'row' }, fRow, eRow)), [{ label: 'Cancel' }, { label: 'Place', primary: true, run: () => {
      const height = app.units.parse(hgt.value) || 500, depth = extr.checked ? app.units.parse(ext.value) || 50 : 0;
      (async () => {
        const ents = new Entities();
        try { await build3DText(ents, t.value || 'Text', { height, extrude: depth, filled: filled.checked, bold: font.value === 'bold', align: align.value }); }
        catch (e) { app.toast('Could not load the font (internet connection needed).'); return; }
        let inst;
        app.commit('3D Text', () => {
          const def = { id: nid(), name: t.value.slice(0, 24) || 'Text', desc: '3D Text', group: false, ents };
          app.model.defs.set(def.id, def);
          inst = { id: nid(), def: def.id, m: new THREE.Matrix4(), name: '', tag: 0, hidden: false, locked: false, mat: null };
          app.ctxInfo().ents.insts.set(inst.id, inst); app.ctxInfo().ents.touch();
        });
        app.applySelection(['i' + inst.id], 'set');
        app.setTool('move'); app.tools.move.startPlacement(['i' + inst.id], new THREE.Vector3().applyMatrix4(app.ctxInfo().matrix));
      })();
    } }]);
  }

  dialogExportImage(fmt = 'png') {
    const app = this.app, v = app.view;
    const w = inp(Math.round(v.w * 2), 'number'), hh = inp(Math.round(v.h * 2), 'number');
    const [tRow, tr] = cb(false, 'Transparent background (PNG)');
    this.ui.modal(`Export ${fmt.toUpperCase()} Image`, h('div', {}, h('div', { class: 'grid2' }, field('Width (px)', w), field('Height (px)', hh)), fmt === 'png' ? tRow : null, h('p', { class: 'muted' }, 'The current view is rendered at the chosen resolution.')), [{ label: 'Cancel' }, { label: 'Export', primary: true, run: () => app.io.exportImage(fmt, +w.value, +hh.value, tr.checked) }]);
  }

  dialogDrawings() {
    const app = this.app, m = app.model;
    const sheets = [['plan', 'Denah (Floor plan, cut at height)', true], ['top', 'Tampak Atas (Top / roof view)', true], ['front', 'Tampak Depan (Front elevation)', true], ['back', 'Tampak Belakang (Back elevation)', true], ['left', 'Tampak Samping Kiri (Left)', true], ['right', 'Tampak Samping Kanan (Right)', true], ['secx', 'Potongan A–A (Section across X)', true], ['secy', 'Potongan B–B (Section across Y)', true], ['iso', 'Perspektif / Isometri (3D view)', true]];
    const checks = sheets.map(([id, l, d]) => { const [row, i] = cb(d, l); i.dataset.id = id; return { row, i }; });
    for (const s of app.allSections()) { const [row, i] = cb(true, `${s.sec.name || 'Section'} (model section plane)`); i.dataset.id = 'sp:' + s.sec.id; checks.push({ row, i }); }
    (m.scenes || []).forEach((s, k) => { const [row, i] = cb(false, `Scene: ${s.name}`); i.dataset.id = 'scene:' + k; checks.push({ row, i }); });
    const paper = sel([['A4', 'A4 (297×210)'], ['A3', 'A3 (420×297)'], ['A2', 'A2 (594×420)'], ['A1', 'A1 (841×594)']], 'A3');
    const scale = sel([['auto', 'Auto (fit)'], [1, '1:1'], [2, '1:2'], [5, '1:5'], [10, '1:10'], [20, '1:20'], [25, '1:25'], [50, '1:50'], [100, '1:100'], [200, '1:200'], [500, '1:500']], 'auto');
    const cut = inp(app.units.format(1200).replace('~ ', ''));
    const [dRow, dims] = cb(true, 'Automatic dimensions (overall + chain)');
    const [hRow, hatch] = cb(true, 'Poché / hatch section cuts');
    const [uRow, udims] = cb(true, 'Include model dimensions & text');
    const title = inp(m.info.name && m.info.name !== 'Untitled' ? m.info.name : app.fileName || 'Proyek'), client = inp(m.info.client || ''), loc = inp(m.info.location || ''), by = inp(m.info.author || '');
    const fmt = sel([['pdf', 'PDF (gambar kerja)'], ['dxf', 'AutoCAD DXF (2D, layers)'], ['both', 'PDF + DXF']], 'pdf');
    const body = h('div', { class: 'drawdlg' },
      h('div', {}, h('h4', {}, 'Sheets'), h('div', { class: 'checks' }, ...checks.map((c) => c.row))),
      h('div', {}, h('h4', {}, 'Layout'), field('Paper', paper), field('Scale', scale), field('Plan cut height', cut), dRow, hRow, uRow,
        h('h4', {}, 'Title block (Kop gambar)'), field('Proyek', title), field('Pemilik', client), field('Lokasi', loc), field('Digambar', by), field('Format', fmt)));
    this.ui.modal('Export Working Drawings — Gambar Kerja', body, [{ label: 'Cancel' }, { label: 'Generate', primary: true, run: () => {
      Object.assign(m.info, { name: title.value, client: client.value, location: loc.value, author: by.value });
      const opts = { sheets: checks.filter((c) => c.i.checked).map((c) => c.i.dataset.id), paper: paper.value, scale: scale.value === 'auto' ? 'auto' : +scale.value, cutZ: app.units.parse(cut.value) ?? 1200, dims: dims.checked, hatch: hatch.checked, userDims: udims.checked, format: fmt.value };
      app.io.drawings(opts);
    } }], { wide: true });
  }

  dialogAbout() {
    this.ui.modal('About Amatu Sketch', h('div', {}, h('p', {}, h('b', {}, 'Amatu Sketch'), ' — a SketchUp-style 3D modeler for the browser.'),
      h('p', { class: 'muted' }, 'Independent project; not affiliated with or endorsed by Trimble Inc. “SketchUp” is a trademark of Trimble Inc.'),
      h('p', {}, 'Native files are saved as .amsk (JSON). Export to COLLADA (.dae, opens in SketchUp via File › Import), OBJ, STL, glTF, AutoCAD DXF (2D & 3D), PNG/JPG/SVG and multi-sheet PDF working drawings.'),
      h('p', { class: 'muted' }, 'Image to 3D uses free models hosted on Hugging Face Spaces (Hunyuan3D 2.1 by Tencent, TRELLIS by Microsoft, Stable Fast 3D by Stability AI, TripoSG by VAST). Your picture goes straight from this browser to the Space you pick, under that model’s own license and terms.')), [{ label: 'Close', primary: true }]);
  }
  dialogGestures() {
    const rows = [['Orbit', 'Middle-drag · O tool · trackpad two-finger swipe · touch two-finger drag'], ['Pan', 'Shift + middle-drag · H tool · Shift + two-finger swipe · touch three-finger drag'], ['Zoom', 'Scroll wheel (zooms to cursor) · pinch · Z tool'], ['Center view', 'Double-click with the middle button / in the Orbit tool'], ['Zoom Extents', 'Shift+Z'], ['Context menu', 'Right-click · two-finger tap'], ['Lock inference', 'Hold Shift'], ['Lock axis', '→ red · ← green · ↑ blue · ↓ parallel/perpendicular'], ['Drawing plane', 'Circle, Arc, Rectangle, Polygon, Pie: ↑ horizontal · ↓ vertical facing you · → red · ← green (same key again = Auto) · hold Shift to keep the plane · or the Plane bar above the view'], ['Copy (Move/Rotate)', isMac ? 'Tap ⌥ Option' : 'Tap Ctrl'], ['Arrays', 'After copying type x5 or /5 and Enter'], ['Measurements', 'Just type numbers while using a tool, then Enter']];
    this.ui.modal('Mouse, Trackpad & Gestures', h('table', { class: 'stats' }, ...rows.map(([a, b]) => h('tr', {}, h('td', {}, h('b', {}, a)), h('td', {}, b)))), [{ label: 'Sensitivity settings…', run: () => { this.dialogPrefs('nav'); return false; } }, { label: 'Close', primary: true }], { wide: true });
  }
}
