// Image to 3D (AI): photo → cut-out → free AI model on Hugging Face → light, coloured component
// placed in the model. Generated models are cached in the browser, so changing detail, colours
// or size of the same photo later costs no GPU quota.
import * as THREE from 'three';
import { Entities, nid } from '../core/model.js';
import { trianglesToFaces, entsBox } from '../core/ops.js';
import * as M from '../ai/mesh.js';
import { ENGINES, engineById, generate, quotaState, quotaText, shortReason, AUTO_ORDER } from '../ai/engines.js';
import { readImage, ownAlpha, plainAlpha, aiAlpha, cleanAlpha, packCut } from '../ai/cutout.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};
// typical heights (mm) — picked from the file name, or with one click
const SIZES = [
  ['Chair', 850, /kursi|chair|stool|bangku/i], ['Table', 750, /meja|table|desk/i], ['Sofa', 850, /sofa|couch|bench/i], ['Bed', 1000, /kasur|ranjang|bed\b/i],
  ['Cabinet', 1900, /lemari|cabinet|wardrobe|almari|rak|shelf|bookcase/i], ['Lamp', 1500, /lampu|lamp/i], ['Plant', 900, /tanaman|plant|pot\b|bunga|flower/i],
  ['Person', 1700, /orang|person|man\b|woman|human|people|figure/i], ['Car', 1450, /mobil|car\b|sedan|suv/i], ['Motorbike', 1100, /motor|bike|scooter/i],
  ['Tree', 5000, /pohon|tree/i], ['Vase', 350, /\bvas\b|vase|guci/i], ['Bottle', 250, /botol|bottle/i], ['Cup', 100, /gelas|cup|mug|cangkir/i],
];
const DETAIL = [[2000, 'Low · 2,000 triangles'], [6000, 'Medium · 6,000 triangles'], [15000, 'High · 15,000 triangles'], [40000, 'Very high · 40,000 triangles']];
const RUN_ETA = { hunyuan: 35, trellis: 70, sf3d: 12, triposg: 45, trellis2: 120 };
const CACHE = 'amatu-sketch-ai-v1';

export function openImage3D(app, file) {
  const prev = app._i3d || {};
  const s = app.settings.ai = Object.assign({ engine: 'auto', faces: 6000, colors: 8, edges: 'sharp', bg: 'auto', dim: 'h' }, app.settings.ai || {});
  const st = { file: null, img: null, cut: null, cutKey: '', busy: false, ac: null, seed: 0 };
  let sizeTouched = false;

  // ---------------------------------------------------------------- layout
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const preview = h('canvas', { class: 'i3d-canvas', width: 10, height: 10 });
  const empty = h('div', { class: 'i3d-empty' }, h('b', {}, 'Drop a photo here'), h('span', {}, 'or click to choose · paste with ', navigator.platform.includes('Mac') ? '⌘V' : 'Ctrl+V'), h('small', {}, 'One object, whole and clearly visible. A plain background works best.'));
  const drop = h('div', { class: 'i3d-drop', tabindex: 0, title: 'Choose a picture' }, preview, empty);
  const showOrig = h('input', { type: 'checkbox' });
  const cutInfo = h('span', { class: 'muted' }, '');
  const left = h('div', { class: 'i3d-left' }, drop,
    h('div', { class: 'row i3d-under' }, h('button', { class: 'btn sm', onclick: () => fileIn.click() }, 'Choose image…'), h('button', { class: 'btn sm', onclick: pasteImage }, 'Paste'),
      h('label', { class: 'chk' }, showOrig, h('span', {}, 'Original'))), cutInfo, fileIn);

  const nameIn = h('input', { type: 'text', value: prev.name || '', placeholder: 'e.g. Kursi kayu' });
  const sizeIn = h('input', { type: 'text', value: app.units.format(prev.size || 900, { approx: false }), inputmode: 'decimal' });
  const dimSel = sel([['h', 'Height'], ['w', 'Width'], ['d', 'Depth']], s.dim);
  const chips = h('div', { class: 'i3d-chips' }, ...SIZES.slice(0, 9).map(([n, mm]) => h('button', { class: 'chip', type: 'button', title: app.units.format(mm, { approx: false }), onclick: () => { dimSel.value = 'h'; sizeIn.value = app.units.format(mm, { approx: false }); sizeTouched = true; } }, n)));
  const engSel = sel([['auto', 'Auto — best model available'], ...ENGINES.map((e) => [e.id, `${e.name} — ${e.note}`])], s.engine);
  const detSel = sel(DETAIL.map(([v, l]) => [v, l]), s.faces);
  const colIn = h('input', { type: 'range', min: 1, max: 24, step: 1, value: s.colors });
  const colOut = h('output', {}, String(s.colors));
  colIn.addEventListener('input', () => { colOut.textContent = colIn.value; });
  const edgeSel = sel([['sharp', 'Sharp edges only (SketchUp look)'], ['all', 'All edges'], ['none', 'No edges (smooth)']], s.edges);
  const bgSel = sel([['auto', 'Automatic cut-out'], ['ai', 'AI cut-out on this device (busy backgrounds)'], ['plain', 'Plain background (fast)'], ['none', 'Use the whole picture']], s.bg);
  const tokIn = h('input', { type: 'password', value: app.settings.hfToken || '', placeholder: 'hf_… (optional)', autocomplete: 'off', spellcheck: 'false' });
  tokIn.addEventListener('change', () => { app.settings.hfToken = tokIn.value.trim(); app.saveSettings(); refreshQuota(); });
  const quotaLine = h('div', { class: 'muted i3d-quota' });
  const adv = h('details', { class: 'i3d-adv' }, h('summary', {}, 'More GPU quota (Hugging Face token)'),
    h('p', { class: 'muted' }, 'The AI models run free on Hugging Face, with a small daily GPU quota per visitor (about 2 minutes, so 1–2 models a day). A free Hugging Face account gives more, PRO much more: create a token with “Read” access at huggingface.co › Settings › Access Tokens and paste it here. It is only sent to Hugging Face.'),
    fld('HF token', tokIn));
  const right = h('div', { class: 'i3d-right' },
    fld('Name', nameIn),
    h('label', { class: 'fld i3d-size' }, h('span', {}, 'Real size'), h('div', { class: 'i3d-sizerow' }, dimSel, sizeIn)), chips,
    fld('AI model', engSel), fld('Detail', detSel),
    h('label', { class: 'fld sl' }, h('span', {}, 'Colours'), colIn, colOut),
    fld('Edges', edgeSel), fld('Background', bgSel), adv, quotaLine);

  const bar = h('i'), prog = h('div', { class: 'i3d-prog' }, bar), log = h('div', { class: 'i3d-log' });
  const statusBox = h('div', { class: 'i3d-status' }, prog, log);
  const body = h('div', { class: 'i3d' }, left, right, statusBox);
  const box = app.ui.modal('Image to 3D Model (AI)', body, [
    { label: 'Cancel', run: () => { if (st.busy) { st.ac?.abort(); return false; } } },
    { label: 'Generate 3D model', primary: true, run: () => { start(); return false; } },
  ], { wide: true, sticky: true, cls: 'i3d-modal', noFocus: true });
  const [cancelBtn, goBtn] = box.querySelectorAll('.modal-foot .btn');
  const closeX = box.querySelector('.modal-head .tb');
  closeX.addEventListener('click', () => st.ac?.abort(), true);
  statusBox.hidden = true;

  // ---------------------------------------------------------------- picture
  drop.addEventListener('click', () => !st.busy && fileIn.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
  fileIn.addEventListener('change', () => fileIn.files[0] && setFile(fileIn.files[0]));
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/')); if (f) setFile(f); });
  const onPaste = (e) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); setFile(f); } };
  document.addEventListener('paste', onPaste);
  const gone = new MutationObserver(() => { if (!box.isConnected) { document.removeEventListener('paste', onPaste); gone.disconnect(); st.ac?.abort(); } });
  gone.observe(document.body, { childList: true });
  async function pasteImage() {
    try {
      for (const it of await navigator.clipboard.read()) { const t = it.types.find((x) => x.startsWith('image/')); if (t) { const b = await it.getType(t); setFile(new File([b], 'pasted.' + t.split('/')[1], { type: t })); return; } }
      say('No picture on the clipboard.', 'warn');
    } catch (e) { say('Press ' + (navigator.platform.includes('Mac') ? '⌘V' : 'Ctrl+V') + ' to paste a picture.', 'warn'); }
  }
  async function setFile(f) {
    if (st.busy) return;
    try {
      st.file = f; st.img = await readImage(f); st.cut = null; st.cutKey = ''; st.seed = 0;
      const base = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      if (!nameIn.value || nameIn.dataset.auto) { nameIn.value = /^(image|pasted|img|photo|foto|screenshot|whatsapp)/i.test(base) ? 'AI Model' : base.slice(0, 40); nameIn.dataset.auto = '1'; }
      const hit = SIZES.find(([, , re]) => re.test(f.name) || re.test(nameIn.value));
      if (hit && !sizeTouched) { dimSel.value = 'h'; sizeIn.value = app.units.format(hit[1], { approx: false }); }
      empty.hidden = true; drawPreview(); statusBox.hidden = true;
      await ensureCut().catch((e) => { if (e.kind !== 'cancel') cutInfo.textContent = 'Cut-out failed: ' + e.message; });
    } catch (e) { console.error(e); say('Could not read that picture: ' + e.message, 'err'); }
  }
  nameIn.addEventListener('input', () => { delete nameIn.dataset.auto; });
  sizeIn.addEventListener('input', () => { sizeTouched = true; });
  showOrig.addEventListener('change', drawPreview);
  bgSel.addEventListener('change', () => { if (st.img) ensureCut(); });

  function drawPreview() {
    const src = !showOrig.checked && st.cut ? st.cut.canvas : null;
    const img = st.img; if (!img && !src) return;
    const w = src ? src.width : img.w, hh = src ? src.height : img.h;
    preview.width = w; preview.height = hh;
    const g = preview.getContext('2d'); g.clearRect(0, 0, w, hh);
    if (src) g.drawImage(src, 0, 0); else g.putImageData(new ImageData(new Uint8ClampedArray(img.d), img.w, img.h), 0, 0);
    drop.classList.toggle('has', true);
  }
  function ensureCut(signal) {
    const mode = bgSel.value, key = mode + ':' + (st.file?.name || '') + ':' + (st.file?.size || 0) + ':' + (st.img?.w || 0);
    if (st.cut && st.cutKey === key) return Promise.resolve(st.cut);
    if (st.cutting && st.cuttingKey === key) return st.cutting;
    st.cuttingKey = key;
    st.cutting = makeCut(mode, key, signal).finally(() => { if (st.cuttingKey === key) st.cutting = null; });
    return st.cutting;
  }
  async function makeCut(mode, key, signal) {
    const img = st.img; let a = null, how = '';
    if (mode !== 'none') a = ownAlpha(img), how = a ? 'transparent picture' : '';
    if (!a && (mode === 'auto' || mode === 'plain')) { a = plainAlpha(img, mode === 'plain'); if (a) how = 'plain background removed'; }
    if (!a && (mode === 'auto' || mode === 'ai')) {
      cutInfo.textContent = 'Cutting out the object…';
      try { a = await aiAlpha(img, (t) => { cutInfo.textContent = t; }, signal); how = 'background removed on this device'; }
      catch (e) { if (e.kind === 'cancel') throw e; a = plainAlpha(img, true); how = 'simple cut-out (AI cut-out unavailable: ' + e.message + ')'; }
    }
    if (!a) { a = new Uint8Array(img.w * img.h).fill(255); how = 'whole picture'; }
    a = cleanAlpha(a, img.w, img.h);
    const packed = await packCut(img, a);
    if (img !== st.img) return packed; // another picture was chosen meanwhile
    st.cut = packed; st.cutKey = key;
    cutInfo.textContent = 'Cut-out: ' + how + '. Untick “Original” to compare.';
    drawPreview();
    return st.cut;
  }

  // ---------------------------------------------------------------- run
  function refreshQuota() {
    const q = quotaState(app.settings.hfToken);
    quotaLine.textContent = q ? 'Hugging Face: ' + quotaText(q) + (app.settings.hfToken ? '' : '. Add a token for more.') : '';
  }
  refreshQuota();
  let progT = null, progV = 0;
  const setProg = (v) => { progV = Math.max(progV, Math.min(100, v)); bar.style.width = progV.toFixed(1) + '%'; };
  const glide = (from, to, secs) => { clearInterval(progT); const t0 = performance.now(); progT = setInterval(() => { const k = 1 - Math.exp(-((performance.now() - t0) / 1000) / Math.max(3, secs * 0.6)); setProg(from + (to - from) * k); }, 250); };
  function say(text, cls = '') {
    statusBox.hidden = false;
    const last = log.lastElementChild;
    if (last && last.dataset.live && !cls) { last.textContent = text; return; }
    log.append(h('div', { class: cls, 'data-live': cls ? null : '1' }, text)); log.scrollTop = log.scrollHeight;
  }
  function busy(on) {
    st.busy = on; goBtn.disabled = on; cancelBtn.textContent = on ? 'Stop' : 'Cancel';
    for (const el of right.querySelectorAll('input,select,button')) el.disabled = on;
    box.classList.toggle('busy', on);
  }
  async function start() {
    if (st.busy) return;
    if (!st.img) { fileIn.click(); return; }
    const size = app.units.parse(sizeIn.value);
    if (!size || size <= 0) { say('Enter the real size of the object, e.g. 850 mm.', 'err'); sizeIn.focus(); return; }
    Object.assign(s, { engine: engSel.value, faces: +detSel.value, colors: +colIn.value, edges: edgeSel.value, bg: bgSel.value, dim: dimSel.value });
    app.saveSettings();
    app._i3d = { name: nameIn.value, size };
    log.innerHTML = ''; progV = 0; setProg(1); busy(true);
    st.ac = new AbortController(); const signal = st.ac.signal;
    try {
      say('Preparing the picture…');
      const cut = await ensureCut(signal); setProg(8);
      const hash = await digest(cut.png);
      let glb = null, E = null;
      for (const id of s.engine === 'auto' ? AUTO_ORDER : [s.engine]) { glb = await cached(hash, id, st.seed); if (glb) { E = engineById(id); say(`Using the ${E.name} model made earlier from this picture (no GPU used).`); break; } }
      if (!glb) {
        const res = await generate({
          engine: s.engine, png: cut.png, cut: s.bg !== 'none', token: app.settings.hfToken, seed: st.seed, faces: s.faces, signal,
          status: (m) => {
            if (m.stage === 'queue') { say(`${m.engine.name}: waiting in line${m.rank > 0 ? ` (${m.rank} ahead)` : ''}${m.eta ? ` · ~${Math.round(m.eta)} s` : ''}`); setProg(14); }
            else if (m.stage === 'run') { if (!m.progress) { say(`${m.engine.name}: generating the 3D model…`); glide(18, 84, m.eta && m.eta > 3 ? m.eta : RUN_ETA[m.engine.id] || 40); } }
            else if (m.stage === 'log') { if (/waiting|acquired|gpu/i.test(m.text || '')) say(`${m.engine.name}: ${m.text}`); }
            else if (m.text) { say(m.text, m.warn ? 'warn' : ''); setProg(m.warn ? progV : 12); }
          },
        });
        E = res.engine; clearInterval(progT); setProg(86);
        say(`Downloading the model from ${E.name}…`);
        glb = await download(res.url, signal, (p) => setProg(86 + p * 6));
        remember(hash, E.id, st.seed, glb);
      }
      setProg(93); say('Turning it into SketchUp-style geometry…');
      await new Promise((r) => setTimeout(r, 30));
      const out = await convert(app, glb, E, s.bg !== 'none' ? cut : null, s); // no mask without a cut-out
      setProg(98);
      const inst = place(app, out, { name: (nameIn.value || 'AI Model').trim(), size, dim: s.dim, edges: s.edges, engine: E, file: st.file?.name });
      setProg(100);
      busy(false); app.ui.closeModal();
      app.toast(`${(nameIn.value || 'AI Model').trim()} created with ${E.name}: ${out.tris.toLocaleString()} triangles, ${out.pal.centers.length} colours. It is a component — move, scale or paint it like any other.`);
      app.setStatus(`Image to 3D: ${E.name}. Undo (${navigator.platform.includes('Mac') ? '⌘Z' : 'Ctrl+Z'}) removes it.`);
      void inst;
    } catch (e) {
      clearInterval(progT); busy(false);
      if (e.kind === 'cancel') { say('Stopped.', 'warn'); return; }
      if (!e.tried) console.error(e);
      if (e.tried) {
        for (const t of e.tried) say(`${t.E.name}: ${shortReason({ kind: t.kind, message: t.msg })}`, 'err');
        if (e.kind === 'quota') { const q = quotaText(quotaState(app.settings.hfToken)); say(`Today’s free GPU quota is used up${q ? ` (${q})` : ''}. Add a free Hugging Face token under “More GPU quota” for more, or try again later. Models already made from the same photo are reused without quota.`, 'err'); adv.open = true; }
        else say('The free AI models are busy or offline right now. Try again in a minute, or pick another AI model.', 'err');
      } else say('Could not make the model: ' + (e.message || e), 'err');
      refreshQuota();
    }
  }
  if (file) setFile(file);
  return box;

  // ---------------------------------------------------------------- small helpers
  function sel(opts, v) { const x = h('select', {}); for (const [val, l] of opts) x.append(h('option', { value: val, selected: String(val) === String(v) }, l)); return x; }
  function fld(label, input) { return h('label', { class: 'fld' }, h('span', {}, label), input); }
}

async function digest(blob) {
  try { const b = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()); return [...new Uint8Array(b)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join(''); }
  catch (e) { return String(blob.size); }
}
const ckey = (hash, id, seed) => `https://ai-cache.amatu-sketch/${hash}/${id}-${seed}.glb`;
async function cached(hash, id, seed) { try { const c = await caches.open(CACHE); const r = await c.match(ckey(hash, id, seed)); return r ? await r.arrayBuffer() : null; } catch (e) { return null; } }
async function remember(hash, id, seed, buf) { try { const c = await caches.open(CACHE); await c.put(ckey(hash, id, seed), new Response(buf, { headers: { 'content-type': 'model/gltf-binary' } })); } catch (e) { /* storage off */ } }
async function download(url, signal, onP) {
  let err;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal }); if (!r.ok) throw new Error('HTTP ' + r.status);
      const total = +r.headers.get('content-length') || 0, rd = r.body.getReader(), parts = []; let got = 0;
      for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; if (total) onP(got / total); }
      const buf = new Uint8Array(got); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
      return buf.buffer;
    } catch (e) { if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { kind: 'cancel' }); err = e; await new Promise((r) => setTimeout(r, 1500)); }
  }
  throw new Error('Downloading the model failed (' + err.message + ')');
}

// ---------------------------------------------------------------- GLB → coloured light mesh (sketch axes)
async function readGLB(buf) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().parseAsync(buf, '');
  const root = gltf.scene; root.updateMatrixWorld(true);
  const P = [], I = [], C = []; let textured = false, base = 0;
  const v = new THREE.Vector3();
  const gamma = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry, pos = g.attributes.position, n = pos.count, uv = g.attributes.uv, vc = g.attributes.color;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const fac = mat?.color ? [gamma(mat.color.r), gamma(mat.color.g), gamma(mat.color.b)] : [1, 1, 1];
    const tex = mat?.map?.image && uv ? texPixels(mat.map.image) : null;
    if (tex || vc) textured = true;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); P.push(v.x, v.y, v.z);
      let r = 0.8, gg = 0.8, b = 0.8;
      if (tex) { const [cr, cg, cb] = sampleTex(tex, uv.getX(i), uv.getY(i)); r = cr; gg = cg; b = cb; }
      else if (vc) { r = gamma(vc.getX(i)); gg = gamma(vc.getY(i)); b = gamma(vc.getZ(i)); }
      C.push(r * fac[0], gg * fac[1], b * fac[2]);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) I.push(base + g.index.getX(i)); else for (let i = 0; i < n; i++) I.push(base + i);
    base += n;
  });
  return { pos: new Float32Array(P), idx: new Uint32Array(I), col: textured ? new Float32Array(C) : null };
}
function texPixels(image) {
  const w = image.width, h = image.height, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(image, 0, 0);
  return { w, h, d: g.getImageData(0, 0, w, h).data };
}
function sampleTex(t, u, v) {
  u -= Math.floor(u); v -= Math.floor(v);
  const x = Math.min(t.w - 1, Math.max(0, Math.floor(u * t.w))), y = Math.min(t.h - 1, Math.max(0, Math.floor(v * t.h))), k = (y * t.w + x) * 4;
  return [t.d[k] / 255, t.d[k + 1] / 255, t.d[k + 2] / 255];
}

export async function convert(app, buf, E, cut, s) {
  const { MeshoptSimplifier } = await import('meshoptimizer/simplifier');
  const raw = await readGLB(buf);
  if (!raw.idx.length) throw new Error('The AI model came back empty — try another picture or AI model.');
  let m = M.weld(raw); m = M.dropCrumbs(m); m = await M.simplify(MeshoptSimplifier, m, s.faces);
  let cam = null; // direction object → photo camera, sketch axes
  if (E.frame === 'camera') { const u = M.uprightRotation(m, E.cam); M.rotate(m.pos, u.R); cam = M.apply3(M.GLTF_TO_SKETCH, u.cam); }
  M.rotate(m.pos, M.GLTF_TO_SKETCH);
  let pose = null;
  if (cut && E.frame !== 'camera') {
    const lite = await M.simplify(MeshoptSimplifier, { pos: m.pos, idx: m.idx, col: null }, 1200);
    pose = M.photoPose(lite, cut.mask);
    if (pose && E.frame === 'photo' && pose.iou > 0.45) { const a = M.quarterTurn(pose.th); if (a) { M.rotate(m.pos, M.rotZ(a)); pose.th += a; } }
    if (pose) cam = [Math.sin(pose.th) * Math.cos(pose.ph), -Math.cos(pose.th) * Math.cos(pose.ph), Math.sin(pose.ph)];
  }
  const nt = m.idx.length / 3;
  let col;
  if (m.col) col = M.faceColors(m);
  else if (pose && cut) col = M.projectColors(m, pose, cut.img);
  else col = new Float32Array(nt * 3).fill(0.8);
  const wts = new Float32Array(nt); for (let t = 0; t < nt; t++) wts[t] = M.triArea(m.pos, m.idx, t);
  const adj = M.faceNeighbours(m);
  col = M.smoothColors(adj, col, wts);
  let pal = M.palette(col, wts, s.colors);
  pal = M.prunePalette(pal, M.cleanLabels(adj, pal.label, wts));
  return { mesh: m, pal, cam, pose, tris: nt };
}

// ---------------------------------------------------------------- into the model as a component
export function place(app, out, o) {
  const { mesh: m, pal } = out, nt = m.idx.length / 3;
  const b = M.bounds(m.pos), ext = o.dim === 'w' ? b.size[0] : o.dim === 'd' ? b.size[1] : b.size[2];
  const k = o.size / (ext || 1), cx = (b.mn[0] + b.mx[0]) / 2, cy = (b.mn[1] + b.mx[1]) / 2;
  const pos = new Array(nt * 9);
  for (let t = 0; t < nt; t++) for (let j = 0; j < 3; j++) { const v = m.idx[t * 3 + j] * 3, q = t * 9 + j * 3; pos[q] = (m.pos[v] - cx) * k; pos[q + 1] = (m.pos[v + 1] - cy) * k; pos[q + 2] = (m.pos[v + 2] - b.mn[2]) * k; }
  const model = app.model;
  let inst;
  app.commit('Image to 3D', () => {
    const names = new Set([...model.materials.values()].map((x) => x.name));
    const ids = pal.centers.map((c) => {
      let nm = `${o.name} ${M.colorName(c)}`, i = 2; while (names.has(nm)) nm = `${o.name} ${M.colorName(c)} ${i++}`; names.add(nm);
      const id = nid(); model.materials.set(id, { id, name: nm, color: M.hex(c), tex: null, tw: 1000, th: 1000, opacity: 1 }); return id;
    });
    const mats = Array.from(pal.label, (l) => ids[l]);
    const E2 = new Entities();
    trianglesToFaces(E2, pos, { mats, weld: Math.max(0.01, o.size * 2e-5), smoothDeg: o.edges === 'all' ? 0.5 : o.edges === 'none' ? 179 : o.engine.crease || 40 });
    if (o.edges === 'none') for (const e of E2.edges.values()) if (e.faces.size >= 1) { e.soft = true; e.smooth = true; }
    E2.touch();
    const def = { id: nid(), name: o.name, desc: `Generated from ${o.file || 'a photo'} with ${o.engine.name} (${o.engine.by}) via Image to 3D`, group: false, ents: E2 };
    model.defs.set(def.id, def);
    // next to what is already there
    const { ents } = app.ctxInfo(), have = entsBox(model, ents);
    const half = [(b.size[0] * k) / 2, (b.size[1] * k) / 2];
    const at = have.isEmpty() ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(have.max.x + 600 + half[0], (have.min.y + have.max.y) / 2, Math.max(0, have.min.z));
    if (have.isEmpty()) at.set(half[0], half[1], 0);
    inst = { id: nid(), def: def.id, m: new THREE.Matrix4().makeTranslation(at.x, at.y, at.z), name: '', tag: 0, hidden: false, locked: false, mat: null };
    ents.insts.set(inst.id, inst); ents.touch();
  });
  app.matVersion++; app.emit('materials');
  app.applySelection(['i' + inst.id], 'set');
  // look at it the way the photo did
  const { ents, matrix } = app.ctxInfo();
  const box = entsBox(model, model.defs.get(ents.insts.get(inst.id).def).ents, matrix.clone().multiply(inst.m));
  const c = box.getCenter(new THREE.Vector3()), dir = new THREE.Vector3(...(out.cam || [-0.55, -0.7, 0.45])).normalize();
  if (dir.z > 0.85) dir.set(dir.x, dir.y, 0.85).normalize();
  const v = app.view, d = Math.max(1000, box.getSize(new THREE.Vector3()).length() * 2);
  v.cam.upHint.set(0, 1, 0);
  v.animateTo({ eye: c.clone().addScaledVector(dir, d), target: c }, 0);
  v.zoomExtents(box, true);
  setTimeout(() => v.pushHistory(), 450);
  return inst;
}
