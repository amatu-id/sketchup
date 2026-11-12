// Photo → cut-out object on a transparent background (what the 3D models want as input).
// Order for "auto": the picture's own transparency → plain-background flood fill → on-device AI (IS-Net).
import { toLab } from './mesh.js';

export async function readImage(blob) {
  const bmp = await createImageBitmap(blob);
  const L = Math.max(bmp.width, bmp.height), k = Math.min(1, 1280 / L);
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return { w, h, d: g.getImageData(0, 0, w, h).data };
}

// transparent pixels around the object already?
export function ownAlpha(img) {
  const { w, h, d } = img; let clear = 0, border = 0, bclear = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 200) clear++;
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { border++; if (d[(y * w + x) * 4 + 3] < 128) bclear++; }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { border++; if (d[(y * w + x) * 4 + 3] < 128) bclear++; }
  if (clear < w * h * 0.02 || bclear < border * 0.6) return null;
  const a = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) a[i] = d[i * 4 + 3];
  return a;
}

// plain background: grow the background from the border while colours stay close to the border colour
export function plainAlpha(img, force = false) {
  const { w, h, d } = img, n = w * h;
  const lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const o = toLab(d[i * 4] / 255, d[i * 4 + 1] / 255, d[i * 4 + 2] / 255); lab[i * 3] = o[0]; lab[i * 3 + 1] = o[1]; lab[i * 3 + 2] = o[2]; }
  const bpx = []; for (let x = 0; x < w; x += 2) bpx.push(x, (h - 1) * w + x); for (let y = 0; y < h; y += 2) bpx.push(y * w, y * w + w - 1);
  const med = [0, 1, 2].map((k) => { const v = bpx.map((i) => lab[i * 3 + k]).sort((a, b) => a - b); return v[v.length >> 1]; });
  const dist = (i) => Math.hypot(lab[i * 3] - med[0], lab[i * 3 + 1] - med[1], lab[i * 3 + 2] - med[2]);
  const near = bpx.filter((i) => dist(i) < 0.06).length / bpx.length;
  if (near < 0.72 && !force) return null; // busy background: needs the AI cut-out
  const tol = 0.075, bg = new Uint8Array(n), q = new Int32Array(n); let qh = 0, qt = 0;
  for (const i of bpx) if (!bg[i] && dist(i) < tol) { bg[i] = 1; q[qt++] = i; }
  while (qh < qt) {
    const i = q[qh++], x = i % w, y = (i / w) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && !bg[j] && dist(j) < tol) { bg[j] = 1; q[qt++] = j; }
  }
  const a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = bg[i] ? 0 : 255;
  return a;
}

let worker = null;
export function aiAlpha(img, onProgress, signal) {
  return new Promise((resolve, reject) => {
    if (!worker) worker = new Worker(new URL('./seg.worker.js', import.meta.url), { type: 'module' });
    const stop = () => { worker?.terminate(); worker = null; reject(Object.assign(new Error('Cancelled'), { kind: 'cancel' })); };
    signal?.addEventListener('abort', stop, { once: true });
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'progress') { onProgress?.(m.text, m.p); return; }
      signal?.removeEventListener('abort', stop);
      if (m.type === 'error') { reject(new Error(m.message)); return; }
      // S×S map → image size (bilinear), soft threshold for clean edges
      const { w, h } = img, S = m.size, map = m.map, a = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const fx = Math.min(S - 1.001, Math.max(0, ((x + 0.5) / w) * S - 0.5)), fy = Math.min(S - 1.001, Math.max(0, ((y + 0.5) / h) * S - 0.5));
        const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0;
        const v = (map[y0 * S + x0] * (1 - tx) + map[y0 * S + x0 + 1] * tx) * (1 - ty) + (map[(y0 + 1) * S + x0] * (1 - tx) + map[(y0 + 1) * S + x0 + 1] * tx) * ty;
        const s = Math.min(1, Math.max(0, (v - 0.25) / 0.5));
        a[y * w + x] = Math.round(s * s * (3 - 2 * s) * 255);
      }
      resolve(a);
    };
    worker.onerror = (e) => { signal?.removeEventListener('abort', stop); worker?.terminate(); worker = null; reject(new Error(e.message || 'Cut-out failed')); };
    const copy = new Uint8ClampedArray(img.d);
    worker.postMessage({ rgba: copy, w: img.w, h: img.h, device: 'auto' }, [copy.buffer]);
  });
}

// keep the biggest pieces of the object (drops specks the cut-out left behind)
export function cleanAlpha(a, w, h) {
  const n = w * h, lab = new Int32Array(n).fill(-1), sizes = [];
  const q = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (a[s] < 128 || lab[s] >= 0) continue;
    const id = sizes.length; let qh = 0, qt = 0; q[qt++] = s; lab[s] = id; let cnt = 0;
    while (qh < qt) { const i = q[qh++]; cnt++; const x = i % w, y = (i / w) | 0; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && a[j] >= 128 && lab[j] < 0) { lab[j] = id; q[qt++] = j; } }
    sizes.push(cnt);
  }
  if (!sizes.length) return a;
  const big = Math.max(...sizes), out = new Uint8Array(a);
  for (let i = 0; i < n; i++) if (lab[i] >= 0 && sizes[lab[i]] < big * 0.02) out[i] = 0;
  return out;
}

// cut-out → square transparent PNG around the object (+ the same pixels for colouring the model)
export async function packCut(img, alpha) {
  const { w, h, d } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha[y * w + x] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
  const side = Math.ceil(Math.max(x1 - x0 + 1, y1 - y0 + 1) * 1.16), S = Math.min(1024, side), k = S / side;
  const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2;
  const src = document.createElement('canvas'); src.width = w; src.height = h;
  const sg = src.getContext('2d'); const id = new ImageData(new Uint8ClampedArray(d), w, h);
  for (let i = 0; i < w * h; i++) id.data[i * 4 + 3] = Math.min(id.data[i * 4 + 3], alpha[i]);
  sg.putImageData(id, 0, 0);
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high';
  g.drawImage(src, (S / 2 - cx * k), (S / 2 - cy * k), w * k, h * k);
  const px = g.getImageData(0, 0, S, S);
  const a2 = new Uint8Array(S * S); for (let i = 0; i < S * S; i++) a2[i] = px.data[i * 4 + 3];
  const png = await new Promise((r) => c.toBlob(r, 'image/png'));
  return { canvas: c, png, img: { w: S, h: S, d: px.data }, mask: { w: S, h: S, a: a2 } };
}
