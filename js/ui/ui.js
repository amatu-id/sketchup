// UI shell: menu bar, toolbars, tool palette, default tray, status bar + Measurements box, context menu, modals.
import { icon } from './icons.js';
import { menus, TOOLBARS, DEFAULT_KEYS, keyLabel } from './commands.js';
import { Panels } from './panels.js';
import { Dialogs } from './dialogs.js';
import { isMac, PLANE_TOOLS } from '../tools/base.js';
import { splitSel } from '../core/ops.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};
export { h };

export class UI {
  constructor(app, root) {
    this.app = app; this.root = root;
    root.innerHTML = '';
    root.className = 'app';
    this.menubar = h('header', { class: 'menubar' });
    this.toolbarRow = h('div', { class: 'toolbars' });
    this.left = h('aside', { class: 'toolset' });
    this.viewWrap = h('section', { class: 'viewwrap' });
    this.sceneTabs = h('div', { class: 'scenetabs' });
    this.viewportEl = h('div', { class: 'viewport' });
    this.viewWrap.append(this.sceneTabs, this.viewportEl);
    this.tray = h('aside', { class: 'tray' });
    this.trayResize = h('div', { class: 'tray-resize' });
    this.status = h('footer', { class: 'statusbar' });
    const main = h('main', { class: 'main' }, this.left, this.viewWrap, this.trayResize, this.tray);
    root.append(this.menubar, this.toolbarRow, main, this.status);
    this.toastEl = h('div', { class: 'toast' }); root.append(this.toastEl);
    this.panels = new Panels(app, this);
    this.dialogs = new Dialogs(app, this);
    for (const k of Object.getOwnPropertyNames(Dialogs.prototype)) if (k.startsWith('dialog') || ['welcome', 'prompt', 'confirm', 'confirmDiscard'].includes(k)) this[k] = (...a) => this.dialogs[k](...a);
  }
  build() {
    const app = this.app;
    this.buildMenus(); this.buildToolbars(); this.buildStatus(); this.buildPlaneBar(); this.panels.build(this.tray);
    this.renderSceneTabs();
    // tray resize
    this.tray.style.width = (app.settings.trayWidth || 300) + 'px';
    this.trayResize.addEventListener('pointerdown', (e) => {
      const x0 = e.clientX, w0 = this.tray.offsetWidth; this.trayResize.setPointerCapture(e.pointerId);
      const mv = (ev) => { this.tray.style.width = Math.max(220, Math.min(560, w0 - (ev.clientX - x0))) + 'px'; };
      const up = () => { this.trayResize.removeEventListener('pointermove', mv); app.settings.trayWidth = this.tray.offsetWidth; app.saveSettings(); };
      this.trayResize.addEventListener('pointermove', mv); this.trayResize.addEventListener('pointerup', up, { once: true });
    });
    app.on('tool', () => this.refreshButtons());
    app.on('model', () => { this.refreshButtons(); this.renderSceneTabs(); });
    app.on('style', () => this.refreshButtons());
    app.on('camera-end', () => this.refreshButtons());
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.menubar') && !e.target.closest('.ctxmenu')) this.closeMenus(); });
    this.updateTitle();
    this.applyToolbarVisibility();
    if (window.matchMedia('(max-width: 760px)').matches) this.root.classList.add('compact');
  }
  updateTitle() {
    const n = this.app.fileName || 'Untitled';
    document.title = `${this.app.dirty ? '• ' : ''}${n} — Amatu Sketch`;
    if (this.titleEl) this.titleEl.textContent = n + (this.app.dirty ? ' •' : '');
  }

  // ------------------------------------------------------------ menus
  buildMenus() {
    const app = this.app;
    this.menubar.innerHTML = '';
    const logo = h('div', { class: 'brand', title: 'Amatu Sketch' }, h('span', { class: 'brand-mark', html: '<svg viewBox="0 0 24 24"><path d="M3 8l9-5 9 5v8l-9 5-9-5z" fill="#d8262e"/><path d="M3 8l9 5 9-5M12 13v8" stroke="#fff" stroke-width="1.6" fill="none"/></svg>' }), h('b', {}, 'Amatu'), ' Sketch');
    this.menubar.append(logo);
    for (const m of menus(app)) {
      const btn = h('button', { class: 'menu-top' }, m.label);
      const wrap = h('div', { class: 'menu-wrap' }, btn);
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); const open = wrap.classList.contains('open'); this.closeMenus(); if (!open) this.openMenu(wrap, m.items); });
      btn.addEventListener('pointerenter', () => { if (this.menubar.querySelector('.menu-wrap.open') && !wrap.classList.contains('open')) { this.closeMenus(); this.openMenu(wrap, m.items); } });
      this.menubar.append(wrap);
    }
    this.titleEl = h('div', { class: 'doc-title' }, 'Untitled');
    const right = h('div', { class: 'menubar-right' },
      this.iconBtn('undo', 'Undo', () => app.undo()), this.iconBtn('redo', 'Redo', () => app.redo()),
      this.iconBtn('save', 'Save', () => app.io.save()),
      h('button', { class: 'tb tray-toggle', title: 'Show / hide the Default Tray', html: icon('outliner'), onclick: () => { this.root.classList.toggle('tray-open'); requestAnimationFrame(() => app.view.resize()); } }),
      h('button', { class: 'cta cta-render', onclick: () => this.render(), title: 'Render realistis: langit, taman, jalan, orang & kendaraan otomatis' }, h('span', { class: 'ic', html: icon('render') }), 'Render'),
      h('button', { class: 'cta', onclick: () => this.dialogDrawings(), title: 'Generate working drawings (PDF / DXF)' }, h('span', { class: 'ic', html: icon('drawings') }), 'Gambar Kerja'));
    this.menubar.append(this.titleEl, right);
  }
  iconBtn(ic, title, fn) { return h('button', { class: 'tb', title, onclick: fn, html: icon(ic) }); }
  openMenu(wrap, items) {
    wrap.classList.add('open');
    const list = this.renderMenuList(items);
    list.classList.add('dropdown');
    wrap.append(list);
  }
  renderMenuList(items) {
    const app = this.app;
    const list = h('div', { class: 'menu-list' });
    for (const it of items) {
      if (it === '-') { list.append(h('div', { class: 'menu-sep' })); continue; }
      if (typeof it === 'object' && it.items) {
        const row = h('div', { class: 'menu-item has-sub' }, h('span', { class: 'mi-check' }), h('span', { class: 'mi-label' }, it.label), h('span', { class: 'mi-arrow' }, '›'));
        row.addEventListener('pointerenter', () => {
          for (const s of list.querySelectorAll(':scope > .menu-item > .menu-list')) s.remove();
          for (const r of list.querySelectorAll(':scope > .menu-item.sub-open')) r.classList.remove('sub-open');
          const sub = this.renderMenuList(it.items); sub.classList.add('submenu'); row.classList.add('sub-open'); row.append(sub);
          const r = sub.getBoundingClientRect(); if (r.right > innerWidth) sub.classList.add('flip'); if (r.bottom > innerHeight) sub.style.top = Math.min(0, innerHeight - r.bottom - 8) + 'px';
        });
        list.append(row); continue;
      }
      const cmd = typeof it === 'string' ? app.cmds[it] : it.cmd ? { ...app.cmds[it.cmd], label: it.label } : it;
      if (!cmd) continue;
      const enabled = cmd.enabled ? cmd.enabled() : true;
      const checked = cmd.checked ? cmd.checked() : false;
      const key = (typeof it === 'string' ? keyLabel({ ...DEFAULT_KEYS, ...app.settings.keys }[it]) : '') || cmd.keyHint || '';
      const label = cmd.label2 ? cmd.label2() : cmd.label;
      const row = h('div', { class: 'menu-item' + (enabled ? '' : ' disabled') }, h('span', { class: 'mi-check' }, checked ? (cmd.radio ? '●' : '✓') : ''), h('span', { class: 'mi-label' }, label), h('span', { class: 'mi-key' }, key));
      row.addEventListener('pointerenter', () => { for (const s of list.querySelectorAll(':scope > .menu-item > .menu-list')) s.remove(); });
      row.addEventListener('click', (e) => { e.stopPropagation(); if (!enabled) return; this.closeMenus(); cmd.run(); });
      list.append(row);
    }
    return list;
  }
  closeMenus() {
    let any = false;
    for (const w of this.menubar.querySelectorAll('.menu-wrap.open')) { w.classList.remove('open'); w.querySelector('.menu-list')?.remove(); any = true; }
    if (this.ctxEl) { this.ctxEl.remove(); this.ctxEl = null; any = true; }
    return any;
  }
  contextMenu(ev, k) {
    this.closeMenus();
    const app = this.app, s = splitSel(app.sel);
    const items = [];
    if (app.sel.size) {
      items.push({ label: 'Entity Info', run: () => this.openPanel('entity') }, 'delete', 'hide', '-');
      if (s.insts.length) {
        items.push('editgroup', 'explode', { label: 'Make Unique', run: () => app.commit('Make Unique', () => { const { ents } = app.ctxInfo(); for (const id of s.insts) { const i = ents.insts.get(id); const d = app.model.defs.get(i.def); if (d) { i.def = app.model.defs.get(i.def) && cloneDefSafe(app, i.def); } } }) }, s.insts.length === 1 && app.ctxInfo().ents.insts.get(s.insts[0])?.locked ? 'unlock' : 'lock', '-');
        if (s.insts.length >= 2) items.push({ label: 'Solid Tools', items: ['tool:solid-shell', 'tool:solid-union', 'tool:solid-subtract', 'tool:solid-intersect', 'tool:solid-trim', 'tool:solid-split'] }, '-');
      }
      if (s.sections.length === 1) {
        const id = s.sections[0];
        items.push({ label: app.model.activeSection === id ? 'Deactivate Cut' : 'Active Cut', run: () => { app.model.activeSection = app.model.activeSection === id ? null : id; app.afterChange({ noHistory: true, dirty: true }); } },
          { label: 'Reverse', run: () => app.commit('Reverse Section', () => { const sec = app.ctxInfo().ents.sections.get(id); sec.n.negate(); app.ctxInfo().ents.touch(); }) },
          { label: 'Align View', run: () => { const f = app.findSection(id); const n = f.sec.n.clone().transformDirection(f.matrix); const c = app.view.cam; const d = c.eye.distanceTo(c.target); const p = f.sec.p.clone().applyMatrix4(f.matrix); app.view.cam.upHint.set(0, 1, 0); app.view.animateTo({ eye: p.clone().addScaledVector(n, -d), target: p }, 300); app.view.setOrtho(true); } }, '-');
      }
      items.push('makegroup', 'makecomponent', '-', { label: 'Intersect Faces', items: ['intersect:model', 'intersect:selection', 'intersect:context'] });
      if (s.faces.length) items.push('reverse', 'orient', { label: 'Area', run: () => this.toast('Area: ' + app.units.formatArea(app.areaOfSelection())) });
      items.push({ label: 'Select', items: ['sel:connected', 'sel:bounding', 'sel:material', 'sel:tag', 'sel:instances'] }, { label: 'Flip Along', items: ['flip:x', 'flip:y', 'flip:z'] }, 'soften:sel', '-', 'zoomsel');
    } else {
      items.push('paste', 'selectall', '-', 'zoomext', { label: 'Standard Views', items: ['view:top', 'view:front', 'view:right', 'view:back', 'view:left', 'view:iso'] }, 'parallel', 'perspective');
      if (app.ctxPath.length) items.unshift('closegroup', '-');
      else if (k && k.outside) items.unshift('closegroup', '-');
    }
    const list = this.renderMenuList(items);
    list.classList.add('ctxmenu');
    const rect = this.viewportEl.getBoundingClientRect();
    list.style.left = rect.left + ev.x + 'px'; list.style.top = rect.top + ev.y + 'px';
    document.body.append(list);
    const r = list.getBoundingClientRect();
    if (r.right > innerWidth) list.style.left = innerWidth - r.width - 6 + 'px';
    if (r.bottom > innerHeight) list.style.top = Math.max(6, innerHeight - r.height - 6) + 'px';
    this.ctxEl = list;
  }

  // ------------------------------------------------------------ toolbars
  buildToolbars() {
    const app = this.app;
    this.buttons = [];
    const mk = (id) => {
      const cmd = app.cmds[id]; if (!cmd) return null;
      const key = keyLabel({ ...DEFAULT_KEYS, ...app.settings.keys }[id]);
      const b = h('button', { class: 'tb', 'data-cmd': id, html: icon(cmd.icon || 'select'), title: cmd.label + (key ? ` (${key})` : '') });
      b.addEventListener('click', () => cmd.run());
      this.buttons.push(b);
      return b;
    };
    this.toolbarRow.innerHTML = '';
    for (const name of ['main', 'views', 'styles', 'section', 'solid', 'camera']) {
      const bar = h('div', { class: 'tbar', 'data-bar': name });
      for (const id of TOOLBARS[name]) bar.append(id === '|' ? h('span', { class: 'tsep' }) : mk(id));
      this.toolbarRow.append(bar);
    }
    this.left.innerHTML = '';
    const grid = h('div', { class: 'toolgrid' });
    for (const id of TOOLBARS.left) { const b = mk(id); if (b) grid.append(b); }
    this.left.append(grid);
    this.refreshButtons();
  }
  refreshButtons() {
    const app = this.app;
    for (const b of this.buttons || []) {
      const cmd = app.cmds[b.dataset.cmd];
      b.classList.toggle('on', !!(cmd && cmd.checked && cmd.checked()));
      if (cmd && cmd.enabled) b.classList.toggle('disabled', !cmd.enabled());
    }
  }
  toolbarVisible(name) { const t = this.app.settings.toolbars || {}; return t[name] !== false; }
  toggleToolbar(name) { const s = this.app.settings; s.toolbars = { ...(s.toolbars || {}), [name]: !this.toolbarVisible(name) }; s.saveSettings?.(); this.app.saveSettings(); this.applyToolbarVisibility(); }
  applyToolbarVisibility() {
    for (const bar of this.toolbarRow.querySelectorAll('.tbar')) bar.style.display = this.toolbarVisible(bar.dataset.bar) ? '' : 'none';
    this.left.style.display = this.toolbarVisible('left') ? '' : 'none';
    requestAnimationFrame(() => this.app.view?.resize());
  }

  // ------------------------------------------------------------ status bar / VCB
  buildStatus() {
    const app = this.app;
    this.status.innerHTML = '';
    const icons = h('div', { class: 'st-icons' },
      h('button', { class: 'tb sm', title: 'Geo-location', html: icon('geo'), onclick: () => this.dialogModelInfo('geo') }),
      h('button', { class: 'tb sm', title: 'Model Info', html: icon('info'), onclick: () => this.dialogModelInfo() }),
      h('button', { class: 'tb sm', title: 'Show / hide the Instructor', html: icon('instructor'), onclick: () => this.togglePanel('instructor') }));
    this.statusText = h('div', { class: 'st-text' }, '');
    this.vcbLabel = h('label', { class: 'vcb-label', for: 'vcb-input' }, 'Measurements');
    this.vcbInput = h('input', { id: 'vcb-input', class: 'vcb', autocomplete: 'off', spellcheck: 'false' });
    this.vcbInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const v = this.vcbInput.value.trim(); app.vcbText = ''; const ok = app.tool?.onVCB?.(v); if (!ok) this.flashVCB(); this.vcbInput.blur(); app.view.requestRender(); e.preventDefault(); e.stopPropagation(); }
      else if (e.key === 'Escape') { this.vcbInput.blur(); e.stopPropagation(); }
      else e.stopPropagation();
    });
    this.vcbInput.addEventListener('focus', () => { this.vcbInput.select(); });
    this.status.append(icons, this.statusText, h('div', { class: 'vcb-wrap' }, this.vcbLabel, this.vcbInput));
  }
  setStatus(t) { if (this.statusText) this.statusText.textContent = t || ''; this.panels?.renderInstructor?.(); }
  setVCB(label, value) { if (!this.vcbInput) return; this.vcbLabel.textContent = label || 'Measurements'; if (!this.app.vcbText && document.activeElement !== this.vcbInput) this.vcbInput.value = value ?? ''; }
  setVCBText(t) { this.vcbInput.value = t; this.vcbInput.classList.toggle('typing', !!t); }
  flashVCB() { this.vcbInput.classList.add('bad'); setTimeout(() => this.vcbInput.classList.remove('bad'), 500); }
  // ------------------------------------------------------------ drawing-plane bar (shape tools)
  buildPlaneBar() {
    const app = this.app;
    const bar = h('div', { class: 'planebar off', role: 'toolbar', 'aria-label': 'Drawing plane' }, h('span', { class: 'pb-title' }, 'Plane'));
    for (const [m, label, title, key] of PLANE_BTNS) {
      const b = h('button', { class: 'pb-btn', 'data-m': m, title, 'aria-pressed': 'false' }, h('span', { class: 'pb-ic', html: PLANE_ICONS[m] }), h('span', { class: 'pb-lb' }, label), key ? h('kbd', {}, key) : null);
      b.addEventListener('click', () => { app.setPlaneMode(m === app.planeMode ? 'auto' : m); app.view.renderer.domElement.focus({ preventScroll: true }); });
      bar.append(b);
    }
    this.planeNowEl = h('span', { class: 'pb-now off', title: 'Plane the next shape is drawn on' });
    bar.append(this.planeNowEl);
    this.viewportEl.append(bar);
    this.planeBar = bar;
    app.on('tool', () => { this.setPlaneNow(null); this.refreshPlaneBar(); });
    app.on('plane', () => this.refreshPlaneBar());
    this.refreshPlaneBar();
  }
  refreshPlaneBar() {
    const app = this.app, bar = this.planeBar; if (!bar) return;
    bar.classList.toggle('off', !(PLANE_TOOLS.has(app.tool?.id) && app.settings.planeBar !== false));
    for (const b of bar.querySelectorAll('.pb-btn')) { const on = b.dataset.m === (app.planeMode || 'auto'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  }
  // live read-out of the plane under the cursor: info = { label, color } or null; state = auto | locked | held
  setPlaneNow(info, state = 'auto') {
    const el = this.planeNowEl; if (!el) return;
    const k = info ? info.label + '|' + state : '';
    if (el._k === k) return; el._k = k;
    el.classList.toggle('off', !info); el.textContent = '';
    if (info) el.append(h('i', { style: 'background:' + info.color }), info.label + (state === 'held' ? ' · Shift' : ''));
  }
  // Render window + Auto Paint — loaded on first use
  render() { import('./render.js').then((m) => m.openRender(this.app)).catch((e) => { console.error(e); this.toast('Could not open Render: ' + e.message); }); }
  autoPaint() { import('./render.js').then((m) => m.dialogAutoPaint(this.app)).catch((e) => { console.error(e); this.toast('Could not open Auto Paint: ' + e.message); }); }
  // Image to 3D (AI) dialog — loaded on first use
  image3d(file) { import('./image3d.js').then((m) => m.openImage3D(this.app, file)).catch((e) => { console.error(e); this.toast('Could not open Image to 3D: ' + e.message); }); }
  // a picture was dropped/opened: flat picture or 3D model?
  imageChoice(file) {
    const url = URL.createObjectURL(file);
    const body = h('div', { class: 'imgchoice' }, h('img', { src: url, alt: '' }), h('p', {}, 'Place “' + file.name + '” as a flat picture, or let AI turn the object in it into a 3D model?'));
    this.modal('Picture', body, [
      { label: 'Flat picture', run: () => { this.app.io.importImage(file); } },
      { label: '3D model (AI)…', primary: true, run: () => { setTimeout(() => this.image3d(file), 0); } },
    ]);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  toast(text, ms = 2600) { this.toastEl.textContent = text; this.toastEl.classList.add('show'); clearTimeout(this._tt); this._tt = setTimeout(() => this.toastEl.classList.remove('show'), Math.max(ms, Math.min(9000, text.length * 55))); }

  // ------------------------------------------------------------ scene tabs
  renderSceneTabs() {
    const app = this.app, el = this.sceneTabs;
    el.innerHTML = '';
    const scenes = app.model.scenes || [];
    el.style.display = scenes.length && app.settings.sceneTabs !== false ? '' : 'none';
    scenes.forEach((s, i) => {
      const t = h('button', { class: 'stab' + (this.panels.activeScene === i ? ' on' : '') }, s.name);
      t.addEventListener('click', () => this.panels.scenesApi.go(i));
      t.addEventListener('contextmenu', (e) => { e.preventDefault(); this.panels.activeScene = i; this.openPanel('scenes'); });
      el.append(t);
    });
    requestAnimationFrame(() => app.view?.resize());
  }
  get scenes() { return this.panels.scenesApi; }

  // ------------------------------------------------------------ panels
  togglePanel(p) { this.panels.toggle(p); }
  openPanel(p) { this.panels.open(p); }
  panelVisible(p) { return this.panels.visible(p); }

  // ------------------------------------------------------------ modal
  modal(title, body, buttons = [], opts = {}) {
    this.closeModal();
    const box = h('div', { class: 'modal' + (opts.wide ? ' wide' : '') + (opts.cls ? ' ' + opts.cls : '') });
    const head = h('div', { class: 'modal-head' }, h('div', { class: 'modal-title' }, title), h('button', { class: 'tb sm', html: icon('close'), onclick: () => this.closeModal() }));
    const foot = h('div', { class: 'modal-foot' });
    for (const b of buttons) foot.append(h('button', { class: 'btn' + (b.primary ? ' primary' : ''), onclick: () => { const r = b.run?.(); if (r !== false) this.closeModal(); } }, b.label));
    box.append(head, h('div', { class: 'modal-body' }, body), ...(buttons.length ? [foot] : []));
    const back = h('div', { class: 'modal-back' }, box);
    back.addEventListener('pointerdown', (e) => { if (e.target === back && !opts.sticky) this.closeModal(); });
    document.body.append(back);
    this.modalEl = back;
    setTimeout(() => { const f = box.querySelector('input:not([type=checkbox]):not([type=radio]),select,textarea'); if (f && !opts.noFocus) f.focus(); }, 30);
    return box;
  }
  modalOpen() { return !!this.modalEl; }
  closeModal() { if (this.modalEl) { this.modalEl.remove(); this.modalEl = null; this.app.view?.renderer.domElement.focus({ preventScroll: true }); } }
}
// Plane bar buttons: mode, label, tooltip, arrow key
const PLANE_BTNS = [
  ['auto', 'Auto', 'Auto — lies on the face under the cursor (also when snapped to its corners or edges); 2 Point / 3 Point Arcs swing to the plane you pull toward'],
  ['h', 'Horizontal', 'Horizontal — flat, like the ground (↑)', '↑'],
  ['v', 'Vertical', 'Vertical, facing you — stands upright toward the camera (↓)', '↓'],
  ['x', 'Red', 'Vertical, facing the red axis (→)', '→'],
  ['y', 'Green', 'Vertical, facing the green axis (←)', '←'],
];
const disc = (rx, ry, rot, stroke, fill, dash = '') => `<ellipse cx="9" cy="8" rx="${rx}" ry="${ry}" transform="rotate(${rot} 9 8)" fill="${fill}" stroke="${stroke}" stroke-width="1.4"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
const PLANE_ICONS = {
  auto: `<svg viewBox="0 0 18 16">${disc(7.4, 2.6, 0, '#6b717c', 'none')}${disc(2.6, 6.6, 0, '#6b717c', 'none', '2 1.6')}</svg>`,
  h: `<svg viewBox="0 0 18 16">${disc(7.6, 3, 0, '#1f5fe0', 'rgba(31,95,224,.18)')}</svg>`,
  v: `<svg viewBox="0 0 18 16">${disc(3.6, 6.8, 0, '#3b4048', 'rgba(59,64,72,.14)')}</svg>`,
  x: `<svg viewBox="0 0 18 16">${disc(3.2, 6.8, -22, '#e0261b', 'rgba(224,38,27,.16)')}</svg>`,
  y: `<svg viewBox="0 0 18 16">${disc(3.2, 6.8, 22, '#119b3a', 'rgba(17,155,58,.16)')}</svg>`,
};
function cloneDefSafe(app, id) {
  // imported lazily to avoid a cycle
  return app._cloneDef ? app._cloneDef(id) : id;
}
export { isMac };
