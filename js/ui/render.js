// Render window (Enscape / Lumion style): live view of the model placed in an automatic site under a
// real sky, with settings on the right and a high-resolution photo export. Also the Auto Paint dialog.
import * as THREE from 'three';
import { icon } from './icons.js';
import { SKY_PRESETS } from '../render/sky.js';
import { planAutoPaint, applyAutoPaint, prepareAutoPaint, KIND_LABEL, STYLE_LABEL } from '../render/autopaint.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};
const PRESETS = [['auto', 'Otomatis'], ['rumah', 'Rumah & taman'], ['kota', 'Jalan kota'], ['taman', 'Taman'], ['studio', 'Studio']];
const SIZES = [['screen', 'Ukuran layar'], ['1280x720', 'HD 1280×720'], ['1920x1080', 'Full HD 1920×1080'], ['2560x1440', '2K 2560×1440'], ['3840x2160', '4K 3840×2160'], ['2048x2048', 'Persegi 2048×2048'], ['1080x1350', 'Potret IG 1080×1350'], ['1080x1920', 'Story 1080×1920']];
const QUALITY = [['24', 'Cepat (24 sampel)'], ['64', 'Bagus (64 sampel)'], ['160', 'Terbaik (160 sampel)']];

export async function openRender(app) {
  if (app._render) return;
  const { RenderEngine, DEFAULTS } = await import('../render/engine.js');
  const opt = { ...DEFAULTS, ...(app.model.render || {}) };
  const ui = app.ui;
  // ---------------------------------------------------------------- layout
  const canvas = h('canvas', { class: 'rd-canvas' });
  const stage = h('div', { class: 'rd-stage' }, canvas);
  const busy = h('div', { class: 'rd-busy' }, h('div', { class: 'rd-spin' }), h('span', {}, 'Menyiapkan lingkungan…'));
  const prog = h('div', { class: 'rd-prog', hidden: true }, h('div', { class: 'rd-bar' }, h('i')), h('span', { class: 'rd-pt' }, ''), h('button', { class: 'btn sm', onclick: () => abort?.abort() }, 'Batal'));
  const hint = h('div', { class: 'rd-hint' }, 'Seret: orbit · Shift / klik kanan: geser · Scroll / cubit: zoom · W A S D: jalan · Q / E: naik turun');
  const sampleTag = h('div', { class: 'rd-samples' }, '');
  stage.append(busy, prog, hint, sampleTag);
  const side = h('aside', { class: 'rd-side' });
  const top = h('header', { class: 'rd-top' },
    h('div', { class: 'rd-title' }, h('span', { class: 'ic', html: icon('render') }), h('b', {}, 'Render'), h('small', { class: 'rd-kind' }, '')),
    h('div', { class: 'rd-topbtns' },
      h('button', { class: 'btn sm rd-toggle', onclick: () => root.classList.toggle('side-open'), title: 'Pengaturan' }, h('span', { class: 'ic', html: icon('prefs') }), 'Atur'),
      h('button', { class: 'btn sm', onclick: () => shuffle(), title: 'Susun ulang pohon, orang, mobil' }, h('span', { class: 'ic', html: icon('shuffle') }), 'Acak'),
      h('button', { class: 'btn primary', onclick: () => photo() }, h('span', { class: 'ic', html: icon('camera') }), 'Render Foto'),
      h('button', { class: 'tb', title: 'Tutup (Esc)', html: icon('close'), onclick: () => close() })));
  const root = h('div', { class: 'rd-root' }, top, h('div', { class: 'rd-main' }, stage, side));
  document.body.append(root);
  const eng = new RenderEngine(app, canvas);
  Object.assign(eng.opt, opt);
  app._render = eng;
  app.view.suspended = true;
  let abort = null, alive = true, raf = 0, building = false;
  // the app treats this window as a modal: its shortcuts stay off, Esc closes it
  ui.closeMenus(); ui.closeModal();
  ui.modalEl = { remove: () => close(true) };

  // ---------------------------------------------------------------- settings panel
  const save = () => { app.model.render = { ...opt }; app.dirty = true; app.scheduleAutosave(); ui.updateTitle(); };
  const set = async (patch) => {
    Object.assign(opt, patch); save();
    const needs = ['preset', 'seed', 'trees', 'people', 'cars', 'road', 'fence', 'neighbors', 'background', 'grass3d', 'autopaint', 'style'].some((k) => k in patch);
    if (needs) { await rebuild(patch); return; }
    eng.setOpt(patch);
  };
  const section = (title, ...kids) => h('section', { class: 'rd-sec' }, h('h4', {}, title), ...kids);
  const slider = (label, key, min, max, step, fmt = (v) => v) => {
    const out = h('output', {}, fmt(opt[key]));
    const i = h('input', { type: 'range', min, max, step, value: opt[key] });
    i.addEventListener('input', () => { out.textContent = fmt(+i.value); clearTimeout(i._t); const v = +i.value; i._t = setTimeout(() => set({ [key]: v }), ['trees', 'people', 'cars'].includes(key) ? 350 : 30); });
    return h('label', { class: 'rd-sl' }, h('span', {}, label), i, out);
  };
  const check = (label, key) => { const i = h('input', { type: 'checkbox' }); i.checked = !!opt[key]; i.addEventListener('change', () => set({ [key]: i.checked })); return h('label', { class: 'chk' }, i, h('span', {}, label)); };
  const select = (label, key, opts, conv = (v) => v) => { const s = h('select', {}); for (const [v, l] of opts) s.append(h('option', { value: v, selected: String(v) === String(opt[key]) }, l)); s.addEventListener('change', () => set({ [key]: conv(s.value) })); return h('label', { class: 'rd-fld' }, h('span', {}, label), s); };
  const chips = (key, opts, after) => {
    const row = h('div', { class: 'rd-chips' });
    const draw = () => { for (const b of row.children) b.classList.toggle('on', b.dataset.v === String(opt[key])); };
    for (const [v, l] of opts) row.append(h('button', { class: 'rd-chip', 'data-v': v, onclick: () => { const patch = { [key]: v }; after?.(patch); set(patch); draw(); } }, l));
    draw(); return row;
  };
  const pct = (v) => Math.round(v * 100) + '%';
  const hourFmt = (v) => { const hh = Math.floor(v), mm = Math.round((v - hh) * 60); return `${String(hh).padStart(2, '0')}.${String(mm).padStart(2, '0')}`; };
  const summary = h('p', { class: 'muted rd-sum' }, '');
  const hourSl = slider('Jam', 'hour', 5.8, 18.6, 0.05, hourFmt);
  if (opt.hour == null) { const hi = hourSl.querySelector('input'); hi.value = SKY_PRESETS[opt.sky]?.hour ?? 12; hourSl.querySelector('output').textContent = hourFmt(+hi.value); }
  const outSize = h('select', {}); for (const [v, l] of SIZES) outSize.append(h('option', { value: v, selected: v === (app.settings.renderSize || '1920x1080') }, l));
  const outQ = h('select', {}); for (const [v, l] of QUALITY) outQ.append(h('option', { value: v, selected: v === (app.settings.renderQ || '64') }, l));
  const outF = h('select', {}); for (const [v, l] of [['png', 'PNG'], ['jpg', 'JPG']]) outF.append(h('option', { value: v, selected: v === (app.settings.renderFmt || 'jpg') }, l));
  for (const s of [outSize, outQ, outF]) s.addEventListener('change', () => { app.settings.renderSize = outSize.value; app.settings.renderQ = outQ.value; app.settings.renderFmt = outF.value; app.saveSettings(); });
  side.append(
    section('Lingkungan', chips('preset', PRESETS),
      slider('Pohon & taman', 'trees', 0, 1, 0.05, pct), slider('Orang', 'people', 0, 1, 0.05, pct), slider('Kendaraan', 'cars', 0, 1, 0.05, pct),
      h('div', { class: 'rd-checks' }, check('Jalan', 'road'), check('Pagar', 'fence'), check('Tetangga', 'neighbors'), check('Rumput 3D', 'grass3d')),
      select('Latar', 'background', [['auto', 'Otomatis'], ['hills', 'Perbukitan'], ['city', 'Kota'], ['none', 'Tidak ada']])),
    section('Langit & waktu', chips('sky', Object.entries(SKY_PRESETS).map(([k, v]) => [k, v.label]), (patch) => { patch.hour = null; patch.cover = null; patch.haze = null; const hi = hourSl.querySelector('input'); hi.value = SKY_PRESETS[patch.sky].hour; hourSl.querySelector('output').textContent = hourFmt(+hi.value); }),
      hourSl, select('Matahari', 'sunMode', [['kamera', 'Menyinari fasad (otomatis)'], ['lokasi', 'Posisi asli (lokasi & tanggal)']]),
      slider('Putar matahari', 'turn', -180, 180, 1, (v) => (v > 0 ? '+' : '') + v + '°'),
      h('button', { class: 'btn sm', onclick: () => eng.setOpt({ sunAim: 1 }), title: 'Hitung ulang arah matahari dari sudut kamera sekarang' }, 'Arahkan matahari ke pandangan ini'),
      slider('Awan', 'cover', 0, 1, 0.01, (v) => (v == null ? 'auto' : pct(v))), slider('Kabut udara', 'haze', 0, 1, 0.01, (v) => (v == null ? 'auto' : pct(v)))),
    section('Warna & material', check('Auto Paint objek tanpa warna (khusus render)', 'autopaint'),
      select('Gaya', 'style', Object.entries(STYLE_LABEL)), summary,
      h('button', { class: 'btn sm', onclick: () => { close(); setTimeout(() => dialogAutoPaint(app), 50); } }, h('span', { class: 'ic', html: icon('autopaint') }), 'Terapkan Auto Paint ke model…')),
    section('Kamera & efek', slider('Eksposur', 'exposure', -2, 2, 0.05, (v) => (v > 0 ? '+' : '') + (+v).toFixed(2) + ' EV'),
      slider('Kontras', 'contrast', 0.8, 1.3, 0.01, (v) => (+v).toFixed(2)), slider('Saturasi', 'saturation', 0.6, 1.5, 0.01, (v) => (+v).toFixed(2)),
      slider('Hangat', 'warmth', -1, 1, 0.01, (v) => (+v).toFixed(2)), slider('Vignette', 'vignette', 0, 1, 0.01, pct), slider('Bloom', 'bloom', 0, 1, 0.01, pct),
      slider('Bayangan lembut', 'softness', 0, 3, 0.05, (v) => (+v).toFixed(2)), slider('Ketajaman', 'sharpen', 0, 1, 0.01, pct), slider('Oklusi ambien', 'aoAmount', 0, 2, 0.05, (v) => (+v).toFixed(2)),
      h('div', { class: 'rd-checks' }, check('Garis vertikal lurus', 'verticals'), check('Ambient occlusion', 'ao')),
      select('Tone', 'tone', [['aces', 'Film (ACES)'], ['agx', 'Natural (AgX)'], ['neutral', 'Netral']])),
    section('Foto', h('label', { class: 'rd-fld' }, h('span', {}, 'Ukuran'), outSize), h('label', { class: 'rd-fld' }, h('span', {}, 'Kualitas'), outQ), h('label', { class: 'rd-fld' }, h('span', {}, 'Format'), outF),
      h('button', { class: 'btn primary rd-wide', onclick: () => photo() }, h('span', { class: 'ic', html: icon('camera') }), 'Render Foto')),
  );

  // ---------------------------------------------------------------- build + loop
  const kindLabel = { building: 'Bangunan', vehicle: 'Kendaraan', furniture: 'Furnitur', plant: 'Tanaman', person: 'Orang', site: 'Tapak', generic: 'Objek' };
  const presetLabel = Object.fromEntries(PRESETS);
  async function rebuild(patch) {
    building = true; busy.hidden = false;
    await new Promise((r) => setTimeout(r, 30));
    try {
      const res = patch ? eng.setOpt(patch) : eng.build();
      const r = res || {};
      root.querySelector('.rd-kind').textContent = `${kindLabel[eng.kind] || 'Objek'} · ${presetLabel[eng.site?.preset] || ''}`;
      if (opt.autopaint) {
        const objs = (r.objects || []).filter((o) => o.faces).slice(0, 4).map((o) => `${o.name} → ${KIND_LABEL[o.kind] || o.kind}`).join(', ');
        summary.textContent = r.painted ? `${r.painted.toLocaleString('id')} bidang tanpa warna diberi material otomatis${objs ? ' (' + objs + ')' : ''}. Model aslinya tidak berubah.` : 'Semua bidang sudah berwarna.';
      } else summary.textContent = 'Bidang tanpa warna tampil putih (clay).';
    } catch (e) { console.error(e); ui.toast('Render: ' + e.message); }
    building = false; busy.hidden = true;
  }
  const resize = () => {
    const r = stage.getBoundingClientRect(), pr = Math.min(window.devicePixelRatio || 1, 1.5) * (opt.previewScale || 1);
    eng.setSize(r.width * pr, r.height * pr);
  };
  const ro = new ResizeObserver(() => resize());
  await eng.init();
  ro.observe(stage);
  resize();
  await rebuild();
  const keys = new Set();
  let last = performance.now();
  const loop = (t) => {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    if (keys.size) walkKeys(dt);
    if (building) return;
    try { eng.frame(); } catch (e) { console.error(e); }
    sampleTag.textContent = eng.samples >= eng.maxSamples ? '' : eng.samples > 1 ? `menghaluskan ${Math.round((eng.samples / eng.maxSamples) * 100)}%` : '';
  };
  raf = requestAnimationFrame(loop);
  window.addEventListener('rd-redraw', onRedraw);
  function onRedraw() { eng.reset(); }

  // ---------------------------------------------------------------- navigation (moves the model camera too)
  const v = app.view, cam = v.cam;
  let drag = null;
  const ptrs = new Map();
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const pan = e.button === 2 || e.button === 1 || e.shiftKey;
    const hit = eng.pick(x, y);
    drag = { x: e.clientX, y: e.clientY, pan, pivot: hit || cam.target.clone(), depth: hit ? hit.distanceTo(cam.eye) : cam.eye.distanceTo(cam.target) };
    if (ptrs.size === 2) drag.pinch = pinchState();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || !ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2 && drag.pinch) { const p = pinchState(), d = drag.pinch; dolly(Math.log(p.d / d.d) * 1.2, null); panBy(p.x - d.x, p.y - d.y, drag.depth); drag.pinch = p; return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) panBy(dx, dy, drag.depth); else v.navOrbit(dx, dy, drag.pivot, 'mouse');
  });
  const up = (e) => { ptrs.delete(e.pointerId); if (!ptrs.size) { drag = null; v.pushHistory(); } else if (drag) drag.pinch = null; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    if (e.ctrlKey || Math.abs(e.deltaY) >= 40 || e.deltaMode) dolly(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022), { x: e.clientX - r.left, y: e.clientY - r.top });
    else if (e.shiftKey) panBy(-e.deltaX, -e.deltaY, cam.eye.distanceTo(cam.target));
    else v.navOrbit(-e.deltaX * 0.6, -e.deltaY * 0.6, cam.target, 'trackpad');
  }, { passive: false });
  function pinchState() { const [a, b] = [...ptrs.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  function panBy(dx, dy, depth) {
    const H = canvas.clientHeight || 1, wpp = (2 * Math.max(depth, 100) * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / H;
    const fwd = cam.target.clone().sub(cam.eye).normalize(), right = fwd.clone().cross(new THREE.Vector3(0, 0, 1)).normalize(), upv = right.clone().cross(fwd).normalize();
    const mv = right.multiplyScalar(-dx * wpp).add(upv.multiplyScalar(dy * wpp));
    cam.eye.add(mv); cam.target.add(mv); v.applyCamera();
  }
  function dolly(k, at) {
    // move towards the point under the cursor
    let p = at ? eng.pick(at.x, at.y) : null;
    if (!p) p = cam.target.clone();
    const d = p.clone().sub(cam.eye), dist = d.length();
    const step = Math.max(-0.9, Math.min(0.9, k));
    if (step > 0 && dist * (1 - step) < 200) return;
    const mv = d.multiplyScalar(step);
    cam.eye.add(mv); cam.target.add(mv);
    if (cam.target.distanceTo(cam.eye) < 300) cam.target.copy(cam.eye).add(cam.target.clone().sub(cam.eye).normalize().multiplyScalar(2000));
    v.applyCamera();
  }
  function walkKeys(dt) {
    const sp = (keys.has('Shift') ? 9000 : 3500) * dt;
    const fwd = cam.target.clone().sub(cam.eye).setZ(0).normalize(), right = fwd.clone().cross(new THREE.Vector3(0, 0, 1)).normalize();
    const mv = new THREE.Vector3();
    if (keys.has('w') || keys.has('ArrowUp')) mv.add(fwd); if (keys.has('s') || keys.has('ArrowDown')) mv.sub(fwd);
    if (keys.has('d')) mv.add(right); if (keys.has('a')) mv.sub(right);
    if (keys.has('e')) mv.z += 1; if (keys.has('q')) mv.z -= 1;
    if (keys.has('ArrowLeft') || keys.has('ArrowRight')) { const a = (keys.has('ArrowLeft') ? 1 : -1) * dt * 1.2; const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a); cam.target.sub(cam.eye).applyQuaternion(q).add(cam.eye); }
    if (mv.lengthSq()) { mv.normalize().multiplyScalar(sp); cam.eye.add(mv); cam.target.add(mv); }
    v.applyCamera();
  }
  const kd = (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '') && document.activeElement.type !== 'range') return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (['w', 'a', 's', 'd', 'q', 'e', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Shift'].includes(k)) { keys.add(k); if (k.startsWith('Arrow')) e.preventDefault(); }
  };
  const ku = (e) => { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; keys.delete(k); if (!keys.size) v.pushHistory(); };
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
  window.addEventListener('blur', () => keys.clear());

  // ---------------------------------------------------------------- actions
  function shuffle() { set({ seed: (opt.seed || 1) + 1 }); }
  async function photo() {
    if (eng.busy || building) return;
    let [w, hh] = outSize.value === 'screen' ? [Math.round(canvas.clientWidth * (window.devicePixelRatio || 1)), Math.round(canvas.clientHeight * (window.devicePixelRatio || 1))] : outSize.value.split('x').map(Number);
    const n = +outQ.value, fmt = outF.value;
    abort = new AbortController(); prog.hidden = false;
    const bar = prog.querySelector('i'), pt = prog.querySelector('.rd-pt');
    const t0 = performance.now();
    try {
      const c = await eng.still(w, hh, n, (f) => { bar.style.width = Math.round(f * 100) + '%'; const el = (performance.now() - t0) / 1000, left = f > 0.02 ? Math.max(0, el / f - el) : 0; pt.textContent = `${w}×${hh} · ${Math.round(f * 100)}%${left ? ' · ±' + Math.ceil(left) + ' dtk' : ''}`; }, abort.signal);
      result(c, fmt);
    } catch (e) { if (e.message !== 'cancelled') { console.error(e); ui.toast('Render gagal: ' + e.message); } }
    prog.hidden = true; abort = null;
  }
  function result(c, fmt) {
    const url = c.toDataURL(fmt === 'png' ? 'image/png' : 'image/jpeg', 0.93);
    const name = (app.fileName || app.model.info.name || 'Render').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_') + ` - Render ${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.${fmt}`;
    const dl = () => { const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); };
    const box = h('div', { class: 'rd-result' }, h('div', { class: 'rd-res-card' },
      h('img', { src: url, alt: 'Hasil render' }),
      h('div', { class: 'rd-res-foot' }, h('span', { class: 'muted' }, `${c.width}×${c.height} · ${fmt.toUpperCase()}`),
        h('button', { class: 'btn', onclick: () => box.remove() }, 'Tutup'), h('button', { class: 'btn primary', onclick: () => { dl(); } }, h('span', { class: 'ic', html: icon('save') }), 'Simpan gambar'))));
    box.addEventListener('pointerdown', (e) => { if (e.target === box) box.remove(); });
    root.append(box);
  }
  function close(fromModal = false) {
    if (!alive) return; alive = false;
    abort?.abort();
    cancelAnimationFrame(raf); ro.disconnect();
    window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('rd-redraw', onRedraw);
    try { eng.dispose(); } catch (e) { console.error(e); }
    root.remove(); app._render = null;
    app.view.suspended = false; app.view.requestRender();
    if (!fromModal && ui.modalEl && ui.modalEl.remove && !ui.modalEl.nodeType) ui.modalEl = null;
  }
}

// ---------------------------------------------------------------- Auto Paint dialog
export function dialogAutoPaint(app) {
  const ui = app.ui;
  let style = 'auto', scope = 'unpainted';
  const kinds = {};
  const list = h('div', { class: 'ap-list' });
  const info = h('p', { class: 'muted' }, '');
  const draw = () => {
    const plan = planAutoPaint(app.model, { scope, style, kinds });
    list.innerHTML = '';
    const objs = plan.objects.filter((o) => o.faces > 0);
    if (!objs.length) list.append(h('p', { class: 'muted' }, 'Model masih kosong.'));
    for (const o of objs.slice(0, 40)) {
      const s = h('select', {}); for (const [k, l] of Object.entries(KIND_LABEL)) s.append(h('option', { value: k, selected: k === o.kind }, l + (k === o.autoKind ? ' (terdeteksi)' : '')));
      s.addEventListener('change', () => { kinds[o.key] = s.value; draw(); });
      const dims = o.size.map((x) => (x / 1000).toFixed(x < 10000 ? 2 : 1)).join(' × ') + ' m';
      list.append(h('div', { class: 'ap-row' }, h('div', {}, h('b', {}, o.name || 'Objek'), h('small', { class: 'muted' }, `${o.faces.toLocaleString('id')} bidang · ${dims}`)), s));
    }
    if (objs.length > 40) list.append(h('p', { class: 'muted' }, `+${objs.length - 40} objek lain`));
    const byRole = new Map(); for (const a of plan.assign) byRole.set(a.spec.name, (byRole.get(a.spec.name) || 0) + 1);
    const top = [...byRole].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([n, c]) => `${n} (${c})`).join(', ');
    info.textContent = plan.assign.length ? `${plan.assign.length.toLocaleString('id')} bidang akan diwarnai — ${top}${byRole.size > 7 ? ', …' : ''}. Gaya bangunan: ${STYLE_LABEL[plan.style]}.` : scope === 'unpainted' ? 'Tidak ada bidang tanpa warna. Pilih “Warnai ulang semua” untuk menimpa warna yang ada.' : 'Tidak ada yang bisa diwarnai.';
    return plan;
  };
  const styleSel = h('select', {}); for (const [k, l] of Object.entries(STYLE_LABEL)) styleSel.append(h('option', { value: k }, l));
  styleSel.addEventListener('change', () => { style = styleSel.value; draw(); });
  const scopeSel = h('select', {}); for (const [k, l] of [['unpainted', 'Hanya yang belum diwarnai'], ['all', 'Warnai ulang semua']]) scopeSel.append(h('option', { value: k }, l));
  scopeSel.addEventListener('change', () => { scope = scopeSel.value; draw(); });
  const body = h('div', { class: 'ap-dlg' },
    h('p', {}, 'Auto Paint mengenali tiap objek (bangunan, kendaraan, furnitur, tanaman, orang…) dan bagian-bagiannya — dinding, atap, lantai, kaca jendela, pintu, ban, lampu, daun — lalu memberi material yang sesuai. Ubah jenis objek bila tebakannya keliru.'),
    h('div', { class: 'grid2' }, h('label', { class: 'fld' }, h('span', {}, 'Bidang'), scopeSel), h('label', { class: 'fld' }, h('span', {}, 'Gaya bangunan'), styleSel)),
    h('h4', {}, 'Objek di model'), list, info);
  draw();
  ui.modal('Auto Paint', body, [{ label: 'Batal' }, { label: 'Warnai', primary: true, run: () => {
    const plan = draw();
    if (!plan.assign.length) { ui.toast('Tidak ada bidang yang perlu diwarnai.'); return; }
    let n = 0;
    app.commit('Auto Paint', () => { const o = { scope, style, kinds }; try { prepareAutoPaint(app.model, o); } catch (e) { console.warn('Auto Paint split skipped', e); } n = applyAutoPaint(app.model, planAutoPaint(app.model, o)); });
    app.matVersion++; app.afterChange({ noHistory: true }); app.emit('materials');
    ui.toast(`Auto Paint: ${n.toLocaleString('id')} bidang diwarnai. Undo (⌘Z / Ctrl+Z) untuk membatalkan.`);
  } }], { wide: true });
}
