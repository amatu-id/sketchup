// Procedural PBR textures for the renderer: tileable noise → colour, normal and roughness maps.
// Everything is drawn on the device (no image downloads) and cached.
import * as THREE from 'three';
import { textureCanvas } from '../core/materials.js';

const cache = new Map();
export function cached(key, make) { let t = cache.get(key); if (!t) { t = make(); cache.set(key, t); } return t; }
export function disposeTextures() { for (const t of cache.values()) for (const x of [].concat(t)) x?.dispose?.(); cache.clear(); }

// ---------------------------------------------------------------- noise
export function rnd(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// periodic value noise, size×size, `period` lattice cells across → tiles seamlessly
export function tileNoise(size, period, seed) {
  const R = rnd(seed), lat = new Float32Array(period * period);
  for (let i = 0; i < lat.length; i++) lat[i] = R();
  const out = new Float32Array(size * size), k = period / size;
  for (let y = 0; y < size; y++) {
    const fy = y * k, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty), r0 = (y0 % period) * period, r1 = ((y0 + 1) % period) * period;
    for (let x = 0; x < size; x++) {
      const fx = x * k, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx), c0 = x0 % period, c1 = (x0 + 1) % period;
      const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * sx, b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * sx;
      out[y * size + x] = a + (b - a) * sy;
    }
  }
  return out;
}
export function fbm(size, period, oct, seed, gain = 0.5) {
  const out = new Float32Array(size * size); let amp = 1, tot = 0, p = period;
  for (let o = 0; o < oct && p <= size; o++) { const n = tileNoise(size, p, seed + o * 101); for (let i = 0; i < out.length; i++) out[i] += n[i] * amp; tot += amp; amp *= gain; p *= 2; }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;
function hex(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

// height field → tangent-space normal map canvas (wraps at the edges)
export function normalFromHeight(hf, size, strength = 2) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const xl = (x - 1 + size) % size, xr = (x + 1) % size, yu = (y - 1 + size) % size, yd = (y + 1) % size;
    const dx = (hf[y * size + xr] - hf[y * size + xl]) * strength, dy = (hf[yd * size + x] - hf[yu * size + x]) * strength;
    const l = Math.hypot(dx, dy, 1), k = (y * size + x) * 4;
    d[k] = (-dx / l * 0.5 + 0.5) * 255; d[k + 1] = (dy / l * 0.5 + 0.5) * 255; d[k + 2] = (1 / l * 0.5 + 0.5) * 255; d[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
// luminance of a canvas → height field
export function heightOf(canvas, invert = false) {
  const s = canvas.width, d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, s, s).data, hf = new Float32Array(s * s);
  for (let i = 0; i < hf.length; i++) { const v = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.55 + d[i * 4 + 2] * 0.15) / 255; hf[i] = invert ? 1 - v : v; }
  return hf;
}
function toTex(canvas, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(canvas);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
function canvasOf(size) { const c = document.createElement('canvas'); c.width = c.height = size; return c; }
function paint(size, fn) {
  const c = canvasOf(size), g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data;
  for (let i = 0, n = size * size; i < n; i++) { const [r, gg, b] = fn(i, i % size, (i / size) | 0); d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0); return c;
}

// ---------------------------------------------------------------- ground surfaces → { map, normalMap, roughnessMap? , size (mm per tile) }
export function grassSet() {
  return cached('grass', () => {
    const S = 1024, big = fbm(S, 4, 5, 11), mid = fbm(S, 16, 4, 23), fine = fbm(S, 128, 2, 37);
    const A = [52, 84, 26], B = [84, 118, 38], C = [124, 138, 58], D = [70, 62, 40];
    const hf = new Float32Array(S * S);
    const c = paint(S, (i) => {
      const t = clamp01(big[i] * 1.4 - 0.2), m = mid[i], f = fine[i];
      let r = lerp(A[0], B[0], t), g = lerp(A[1], B[1], t), b = lerp(A[2], B[2], t);
      const y = clamp01((m - 0.55) * 3); r = lerp(r, C[0], y * 0.6); g = lerp(g, C[1], y * 0.6); b = lerp(b, C[2], y * 0.6);
      const dirt = clamp01((0.32 - m) * 6) * 0.35; r = lerp(r, D[0], dirt); g = lerp(g, D[1], dirt); b = lerp(b, D[2], dirt);
      const k = 0.78 + f * 0.44; hf[i] = f * 0.6 + m * 0.4;
      return [r * k, g * k, b * k];
    });
    // blades
    const g = c.getContext('2d'), R = rnd(5);
    for (let i = 0; i < 26000; i++) {
      const x = R() * S, y = R() * S, l = 4 + R() * 9, a = R() * Math.PI * 2, s = 0.75 + R() * 0.6;
      g.strokeStyle = `rgba(${(70 + R() * 70) * s | 0},${(105 + R() * 70) * s | 0},${(30 + R() * 30) * s | 0},${0.55 + R() * 0.4})`;
      g.lineWidth = 0.8 + R() * 1.2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    const h2 = heightOf(c);
    return { map: toTex(c), normalMap: toTex(normalFromHeight(h2, S, 3.5), false), tile: 1600 };
  });
}
export function asphaltSet() {
  return cached('asphalt', () => {
    const S = 1024, big = fbm(S, 3, 4, 41), fine = fbm(S, 256, 2, 43), R = rnd(9);
    const hf = new Float32Array(S * S);
    const c = paint(S, (i) => { const v = 40 + big[i] * 22 + (fine[i] - 0.5) * 34 + (R() - 0.5) * 18; hf[i] = fine[i]; return [v, v * 1.0, v * 1.03]; });
    const g = c.getContext('2d');
    for (let i = 0; i < 5000; i++) { const v = 95 + R() * 90; g.fillStyle = `rgba(${v},${v},${v * 0.97},${0.5 + R() * 0.5})`; g.fillRect(R() * S, R() * S, 1 + R() * 1.6, 1 + R() * 1.6); }
    g.strokeStyle = 'rgba(20,20,22,.55)'; g.lineWidth = 1.2;
    for (let i = 0; i < 5; i++) { let x = R() * S, y = R() * S; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 12; k++) { x += (R() - 0.5) * 40; y += (R() - 0.3) * 30; g.lineTo(x, y); } g.stroke(); }
    return { map: toTex(c), normalMap: toTex(normalFromHeight(heightOf(c), S, 2.2), false), tile: 4000 };
  });
}
export function concreteSet(color = '#a9a7a0', key = 'concrete') {
  return cached(key + color, () => {
    const S = 1024, big = fbm(S, 4, 5, 61), fine = fbm(S, 256, 2, 67), R = rnd(13), [r0, g0, b0] = hex(color);
    const c = paint(S, (i) => { const k = 0.86 + big[i] * 0.22 + (fine[i] - 0.5) * 0.1; return [r0 * k, g0 * k, b0 * k]; });
    const g = c.getContext('2d');
    for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(40,40,40,${0.15 + R() * 0.3})`; g.beginPath(); g.arc(R() * S, R() * S, 0.5 + R() * 1.6, 0, 7); g.fill(); }
    return { map: toTex(c), normalMap: toTex(normalFromHeight(heightOf(c), S, 1.6), false), tile: 3000 };
  });
}
// interlocking concrete pavers (running bond) or square tiles
export function paverSet(kind = 'paver', color = '#9a938a') {
  return cached('pav:' + kind + color, () => {
    const S = 1024, R = rnd(kind.length * 31 + 7), [r0, g0, b0] = hex(color), fine = fbm(S, 128, 3, 71);
    const c = canvasOf(S), g = c.getContext('2d');
    const hc = canvasOf(S), hg = hc.getContext('2d');
    g.fillStyle = `rgb(${r0 * 0.45 | 0},${g0 * 0.45 | 0},${b0 * 0.45 | 0})`; g.fillRect(0, 0, S, S);
    hg.fillStyle = '#000'; hg.fillRect(0, 0, S, S);
    const brick = (x, y, w, h) => {
      const k = 0.82 + R() * 0.3, tint = (R() - 0.5) * 14;
      g.fillStyle = `rgb(${Math.min(255, r0 * k + tint) | 0},${Math.min(255, g0 * k) | 0},${Math.min(255, b0 * k - tint * 0.5) | 0})`;
      const j = kind === 'tile' ? 2 : 3;
      for (const [ox, oy] of [[0, 0], [-S, 0], [0, -S], [-S, -S]]) {
        g.fillRect(x + j + ox, y + j + oy, w - 2 * j, h - 2 * j);
        const grd = hg.createLinearGradient(x + ox, y + oy, x + ox, y + oy + h); grd.addColorStop(0, '#9a9a9a'); grd.addColorStop(0.1, '#fff'); grd.addColorStop(0.9, '#fff'); grd.addColorStop(1, '#9a9a9a');
        hg.fillStyle = grd; hg.fillRect(x + j + ox, y + j + oy, w - 2 * j, h - 2 * j);
      }
    };
    if (kind === 'tile') { const n = 4, s = S / n; for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) brick(i * s, k * s, s, s); }
    else if (kind === 'deck') { const n = 8, s = S / n; for (let k = 0; k < n; k++) { let x = (k % 2) * S * 0.37; const L = S * 0.62; for (let q = 0; q < 3; q++) { brick(x % S, k * s, L, s); x += L; } } }
    else { const rows = 10, h = S / rows, w = h * 2; for (let r = 0; r < rows; r++) for (let x = (r % 2 ? -w / 2 : 0); x < S; x += w) brick((x + S) % S, r * h, w, h); }
    // grain
    const img = g.getImageData(0, 0, S, S), d = img.data;
    for (let i = 0; i < S * S; i++) { const k = 0.9 + fine[i] * 0.2; d[i * 4] *= k; d[i * 4 + 1] *= k; d[i * 4 + 2] *= k; }
    g.putImageData(img, 0, 0);
    const hf = heightOf(hc); for (let i = 0; i < hf.length; i++) hf[i] = hf[i] * 0.8 + fine[i] * 0.2;
    const tile = kind === 'tile' ? 1600 : kind === 'deck' ? 1500 : 1000;
    return { map: toTex(c), normalMap: toTex(normalFromHeight(hf, S, 5), false), tile };
  });
}
export function soilSet() {
  return cached('soil', () => {
    const S = 512, big = fbm(S, 4, 5, 81), R = rnd(3);
    const c = paint(S, (i) => { const k = 0.7 + big[i] * 0.5 + (R() - 0.5) * 0.25; return [74 * k, 54 * k, 36 * k]; });
    const g = c.getContext('2d');
    for (let i = 0; i < 1500; i++) { const v = R(); g.fillStyle = v < 0.5 ? `rgba(110,80,50,${0.5 + R() * 0.4})` : `rgba(40,28,18,${0.5})`; g.fillRect(R() * S, R() * S, 1 + R() * 3, 1 + R() * 2); }
    return { map: toTex(c), normalMap: toTex(normalFromHeight(heightOf(c), S, 3), false), tile: 1200 };
  });
}
export function waterNormal() {
  return cached('waterN', () => { const S = 512, hf = fbm(S, 8, 5, 91, 0.55); return toTex(normalFromHeight(hf, S, 6), false); });
}
// big soft variation laid over the lawn so its tiling never shows
export function macroNoise() {
  return cached('macro', () => { const S = 256, n = fbm(S, 4, 4, 101); const c = paint(S, (i) => { const v = n[i] * 255; return [v, v, v]; }); return toTex(c, false); });
}

// ---------------------------------------------------------------- model materials: colour + normal map for each texture kind
export function modelTextures(mat) {
  if (!mat.tex) return null;
  const key = 'm:' + (mat.tex === 'image' ? mat.id + ':' + (mat.img || '').length : mat.tex + mat.color);
  return cached(key, () => {
    if (mat.tex === 'image') {
      const t = new THREE.TextureLoader().load(mat.img, () => window.dispatchEvent(new Event('rd-redraw')));
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      return { map: t, normalMap: null };
    }
    const c = textureCanvas(mat.tex, mat.color, 1024);
    const k = BUMP[mat.tex] ?? 1;
    const hf = heightOf(c, k < 0);
    return { map: toTex(c), normalMap: k ? toTex(normalFromHeight(hf, 1024, Math.abs(k)), false) : null };
  });
}
// normal strength per texture kind (negative: darker = higher, e.g. light mortar joints are lower)
const BUMP = { brick: -4, blocks: 3, stone: 5, granite: 1.2, wood: 1, siding: 3, parquet: 1.5, concrete: 1.6, plaster: 1.2, asphalt: 2.5, soil: 3, gravel: 5, marble: 0.4, tile: -3, checker: 0, paving: -4, roof: 6, shingle: 5, metal: 4, brushed: 0.6, rust: 3, water: 0, grass: 3.5, fabric: 2, leather: 1.5, bark: 4, leaves: 3 };

// ---------------------------------------------------------------- foliage cards (RGBA)
export function leafCard(kind = 'broad', seed = 1) {
  return cached('leaf:' + kind + seed, () => {
    const S = 512, c = canvasOf(S), g = c.getContext('2d'), R = rnd(seed * 97 + kind.length);
    const pal = {
      broad: [[48, 92, 32], [70, 118, 40], [96, 140, 52], [38, 74, 28]], small: [[58, 100, 36], [86, 128, 46], [42, 80, 30], [110, 146, 60]],
      dark: [[32, 66, 30], [46, 86, 38], [26, 54, 26], [60, 98, 44]], yellow: [[96, 128, 40], [130, 150, 52], [76, 110, 36], [150, 160, 70]],
      hedge: [[44, 86, 34], [62, 108, 42], [36, 70, 30], [80, 122, 50]], frangi: [[52, 98, 38], [72, 120, 46], [40, 80, 32], [90, 132, 56]],
    }[kind] || [[60, 110, 40]];
    const leafSize = { broad: 34, small: 16, dark: 26, yellow: 28, hedge: 12, frangi: 52 }[kind] || 30;
    const N = { broad: 170, small: 520, dark: 240, yellow: 200, hedge: 1100, frangi: 70 }[kind] || 200;
    // clustered around a few twigs so the card reads as a branch tip, not a square
    const twigs = Array.from({ length: kind === 'hedge' ? 1 : 5 }, () => [S * (0.25 + R() * 0.5), S * (0.25 + R() * 0.5)]);
    if (kind !== 'hedge') { g.strokeStyle = 'rgba(70,52,34,.9)'; g.lineWidth = 3; for (const [x, y] of twigs) { g.beginPath(); g.moveTo(S / 2, S * 0.98); g.quadraticCurveTo(S / 2 + (x - S / 2) * 0.3, y + 60, x, y); g.stroke(); } }
    for (let i = 0; i < N; i++) {
      let x, y;
      if (kind === 'hedge') { x = S * (0.06 + R() * 0.88); y = S * (0.06 + R() * 0.88); }
      else { const t = twigs[i % twigs.length], rr = Math.sqrt(R()) * S * 0.24, a = R() * 7; x = t[0] + Math.cos(a) * rr; y = t[1] + Math.sin(a) * rr; }
      const col = pal[Math.floor(R() * pal.length)], sh = 0.78 + R() * 0.4;
      const L = leafSize * (0.7 + R() * 0.6), Wd = L * (kind === 'frangi' ? 0.32 : 0.45), ang = R() * Math.PI * 2;
      g.save(); g.translate(x, y); g.rotate(ang);
      const grd = g.createLinearGradient(-Wd, 0, Wd, 0);
      grd.addColorStop(0, `rgb(${col[0] * sh * 0.8 | 0},${col[1] * sh * 0.8 | 0},${col[2] * sh * 0.8 | 0})`); grd.addColorStop(1, `rgb(${Math.min(255, col[0] * sh * 1.15) | 0},${Math.min(255, col[1] * sh * 1.15) | 0},${Math.min(255, col[2] * sh * 1.1) | 0})`);
      g.fillStyle = grd; g.beginPath(); g.moveTo(0, -L / 2); g.quadraticCurveTo(Wd, -L * 0.1, 0, L / 2); g.quadraticCurveTo(-Wd, -L * 0.1, 0, -L / 2); g.fill();
      if (L > 20) { g.strokeStyle = `rgba(${Math.min(255, col[0] * 1.5) | 0},${Math.min(255, col[1] * 1.4) | 0},${col[2] | 0},.45)`; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -L / 2); g.lineTo(0, L / 2); g.stroke(); }
      g.restore();
    }
    return { map: toTex(c, true, false), aspect: 1 };
  });
}
// flower clusters on a leafy card (bougainvillea, hibiscus, frangipani flowers)
export function flowerCard(color = '#d9468a', seed = 1, petals = 5) {
  return cached('flower:' + color + seed, () => {
    const S = 512, base = leafCard('small', seed).map.image, c = canvasOf(S), g = c.getContext('2d'), R = rnd(seed * 13 + 5), [r0, g0, b0] = hex(color);
    g.drawImage(base, 0, 0);
    for (let i = 0; i < 90; i++) {
      const x = S * (0.15 + R() * 0.7), y = S * (0.12 + R() * 0.7), r = 7 + R() * 9, k = 0.8 + R() * 0.35;
      g.fillStyle = `rgb(${Math.min(255, r0 * k) | 0},${Math.min(255, g0 * k) | 0},${Math.min(255, b0 * k) | 0})`;
      for (let p = 0; p < petals; p++) { const a = (p / petals) * Math.PI * 2 + R(); g.beginPath(); g.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.55, r * 0.32, a, 0, 7); g.fill(); }
      g.fillStyle = 'rgba(250,220,90,.9)'; g.beginPath(); g.arc(x, y, r * 0.18, 0, 7); g.fill();
    }
    return { map: toTex(c, true, false) };
  });
}
// palm frond leaflets: a long card, rachis along the middle
export function palmCard(seed = 1) {
  return cached('palm:' + seed, () => {
    const W = 256, H = 1024, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), R = rnd(seed * 7 + 3);
    g.strokeStyle = 'rgb(120,108,60)'; g.lineWidth = 5; g.beginPath(); g.moveTo(W / 2, H); g.lineTo(W / 2, 0); g.stroke();
    for (let y = H * 0.96; y > 10; y -= 9 + R() * 4) {
      const t = 1 - y / H, len = (W / 2) * (0.35 + 0.65 * Math.sin(Math.min(1, t * 1.25) * Math.PI)) * (0.85 + R() * 0.3);
      for (const s of [-1, 1]) {
        const sh = 0.8 + R() * 0.35;
        g.strokeStyle = `rgb(${66 * sh | 0},${112 * sh | 0},${40 * sh | 0})`; g.lineWidth = 3.2 + R() * 1.5;
        g.beginPath(); g.moveTo(W / 2, y); g.quadraticCurveTo(W / 2 + s * len * 0.5, y - 10, W / 2 + s * len, y + 24 + R() * 14); g.stroke();
      }
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return { map: t };
  });
}
export function barkSet(color = '#5b4632') {
  return cached('bark' + color, () => {
    const S = 512, [r0, g0, b0] = hex(color), n1 = tileNoise(S, 64, 3), n2 = fbm(S, 8, 4, 5), hf = new Float32Array(S * S);
    const c = paint(S, (i, x, y) => {
      const s = n1[(Math.floor(y / 8) % S) * S + x] * 0.6 + n2[i] * 0.4, k = 0.6 + s * 0.7; hf[i] = s; void y;
      return [r0 * k, g0 * k, b0 * k];
    });
    return { map: toTex(c), normalMap: toTex(normalFromHeight(hf, S, 7), false) };
  });
}

// ---------------------------------------------------------------- facades for the generated neighbourhood
export function facadeCard(o) {
  // o: { wall, frame, floors, bays, door, seed, shop, glass }
  const key = 'fac:' + JSON.stringify(o);
  return cached(key, () => {
    const W = 512, H = Math.round(512 * (o.floors || 1) * 0.6), c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), R = rnd(o.seed || 1), [r0, g0, b0] = hex(o.wall || '#e9e3d6');
    g.fillStyle = o.wall || '#e9e3d6'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 1600; i++) { const k = 0.9 + R() * 0.15; g.fillStyle = `rgba(${r0 * k | 0},${g0 * k | 0},${b0 * k | 0},.35)`; g.fillRect(R() * W, R() * H, 2 + R() * 3, 2 + R() * 3); }
    const fh = H / (o.floors || 1), bays = o.bays || 3, bw = W / bays;
    for (let f = 0; f < (o.floors || 1); f++) {
      const y0 = H - (f + 1) * fh;
      for (let b = 0; b < bays; b++) {
        const shopFloor = o.shop && f === 0;
        if (shopFloor) {
          // folding shutter or shop window + sign band
          g.fillStyle = R() < 0.5 ? '#8f969c' : '#3d4f5c'; g.fillRect(b * bw + 8, y0 + fh * 0.28, bw - 16, fh * 0.72);
          g.strokeStyle = 'rgba(0,0,0,.25)'; for (let y = y0 + fh * 0.3; y < y0 + fh; y += 5) { g.beginPath(); g.moveTo(b * bw + 8, y); g.lineTo(b * bw + bw - 8, y); g.stroke(); }
          g.fillStyle = ['#c62828', '#1565c0', '#f9a825', '#2e7d32', '#ef6c00', '#6a1b9a'][Math.floor(R() * 6)]; g.fillRect(b * bw + 6, y0 + fh * 0.06, bw - 12, fh * 0.17);
          g.fillStyle = 'rgba(255,255,255,.85)'; for (let k = 0; k < 4; k++) g.fillRect(b * bw + 16 + k * (bw - 32) / 4, y0 + fh * 0.11, (bw - 40) / 5, fh * 0.07);
          continue;
        }
        const isDoor = o.door && f === 0 && b === Math.floor(bays / 2);
        const ww = bw * (isDoor ? 0.42 : 0.5), wh = fh * (isDoor ? 0.72 : 0.46), x = b * bw + (bw - ww) / 2, y = isDoor ? y0 + fh - wh : y0 + fh * 0.24;
        g.fillStyle = o.frame || '#3a2a20'; g.fillRect(x - 5, y - 5, ww + 10, wh + 10);
        if (isDoor) { g.fillStyle = '#7a5032'; g.fillRect(x, y, ww, wh); g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(x + ww * 0.1, y + wh * 0.08, ww * 0.8, wh * 0.38); g.fillRect(x + ww * 0.1, y + wh * 0.52, ww * 0.8, wh * 0.38); continue; }
        const grd = g.createLinearGradient(x, y, x + ww, y + wh); const gl = o.glass || [70, 92, 104];
        grd.addColorStop(0, `rgb(${gl[0] + 60},${gl[1] + 60},${gl[2] + 60})`); grd.addColorStop(0.55, `rgb(${gl[0]},${gl[1]},${gl[2]})`); grd.addColorStop(1, `rgb(${gl[0] * 0.6 | 0},${gl[1] * 0.6 | 0},${gl[2] * 0.6 | 0})`);
        g.fillStyle = grd; g.fillRect(x, y, ww, wh);
        g.fillStyle = o.frame || '#3a2a20'; g.fillRect(x + ww / 2 - 2, y, 4, wh); g.fillRect(x, y + wh * 0.3, ww, 3);
        if (R() < 0.5) { g.fillStyle = 'rgba(240,236,226,.75)'; g.fillRect(x + 2, y + 2, ww * 0.22, wh - 4); }
      }
      if (f > 0) { g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, y0 + fh - 6, W, 6); }
    }
    return { map: toTex(c, true, false) };
  });
}
// window grid for city towers in the background
export function towerCard(seed = 1, tint = [92, 112, 128]) {
  return cached('tower:' + seed + tint, () => {
    const W = 256, H = 1024, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), R = rnd(seed);
    g.fillStyle = `rgb(${tint[0] * 0.55 | 0},${tint[1] * 0.55 | 0},${tint[2] * 0.55 | 0})`; g.fillRect(0, 0, W, H);
    const cols = 6, rows = 40, cw = W / cols, rh = H / rows;
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const v = 0.7 + R() * 0.5; g.fillStyle = `rgb(${Math.min(255, tint[0] * v) | 0},${Math.min(255, tint[1] * v) | 0},${Math.min(255, tint[2] * v * 1.05) | 0})`;
      g.fillRect(k * cw + 2, r * rh + 3, cw - 4, rh - 6);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return { map: t };
  });
}
// a car licence plate (Indonesian style: white plate, black letters)
export function plateCard(text) {
  return cached('plate:' + text, () => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
    g.fillStyle = '#f4f4f2'; g.fillRect(0, 0, 256, 64); g.strokeStyle = '#111'; g.lineWidth = 4; g.strokeRect(3, 3, 250, 58);
    g.fillStyle = '#111'; g.font = 'bold 40px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 34);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return { map: t };
  });
}
export { lerp, clamp01, hex, toTex, canvasOf };
