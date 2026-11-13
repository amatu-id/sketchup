// Material library with procedurally generated textures (no external image files).
import * as THREE from 'three';
import { nid } from './model.js';

export const LIBRARY = {
  'Colors': [
    ['Black', '#1b1b1b'], ['Charcoal', '#3a3d40'], ['Gray', '#8a8d91'], ['Silver', '#c4c7cb'], ['White', '#f6f6f4'],
    ['Red', '#c62828'], ['Brick Red', '#a5452e'], ['Orange', '#ef7d22'], ['Gold', '#d9a520'], ['Yellow', '#f4d03f'],
    ['Lime', '#9ccc3a'], ['Green', '#2e8b57'], ['Olive', '#6b7a32'], ['Teal', '#16807d'], ['Cyan', '#4fc3e0'],
    ['Sky Blue', '#87b9e8'], ['Blue', '#2f62c4'], ['Navy', '#1d2e5c'], ['Purple', '#6c4ab6'], ['Pink', '#e98aae'],
    ['Beige', '#e7dcc4'], ['Sand', '#d8c39a'], ['Tan', '#b9926a'], ['Brown', '#6f4a2c'], ['Cream', '#f4ecd6'],
  ],
  'Brick & Cladding': [
    ['Brick Red', '#9b4a35', 'brick', 1200, 600], ['Brick Antique', '#7e5a4a', 'brick', 1200, 600], ['Brick White', '#d9d3c7', 'brick', 1200, 600],
    ['Roster Block', '#c7b9a2', 'blocks', 800, 800], ['Stone Cladding', '#8f8a80', 'stone', 1200, 1200], ['Siding Wood', '#b07f4f', 'siding', 2000, 900],
  ],
  'Wood': [
    ['Oak', '#c49a64', 'wood', 1200, 1200], ['Walnut', '#6e4b33', 'wood', 1200, 1200], ['Teak', '#9b6a3c', 'wood', 1200, 1200],
    ['Pine', '#d9b47c', 'wood', 1200, 1200], ['Parquet', '#a77945', 'parquet', 800, 800], ['Plywood', '#cfae7d', 'wood', 2400, 1200],
  ],
  'Stone & Concrete': [
    ['Concrete', '#a9a8a3', 'concrete', 2000, 2000], ['Concrete Dark', '#76777a', 'concrete', 2000, 2000], ['Exposed Aggregate', '#b5ad9f', 'gravel', 1000, 1000],
    ['Granite', '#7d7b7d', 'granite', 1000, 1000], ['Marble', '#ece9e3', 'marble', 2000, 2000], ['Plaster', '#e9e4da', 'plaster', 2000, 2000],
  ],
  'Tile': [
    ['Ceramic 30', '#e6e3dc', 'tile', 300, 300], ['Ceramic 60', '#dcd8cf', 'tile', 600, 600], ['Terracotta', '#b8653c', 'tile', 400, 400],
    ['Checker', '#f1f1f1', 'checker', 600, 600], ['Mosaic Blue', '#3f7fb5', 'tile', 100, 100],
  ],
  'Roofing': [
    ['Clay Tile', '#a44f31', 'roof', 600, 600], ['Metal Sheet', '#7b8794', 'metal', 760, 1000], ['Asphalt Shingle', '#4b4d52', 'shingle', 1000, 600], ['Spandek Red', '#9a2f2a', 'metal', 760, 1000],
  ],
  'Metal': [
    ['Steel', '#9aa3ab', 'brushed', 1000, 1000], ['Aluminium', '#c9ced3', 'brushed', 1000, 1000], ['Corten', '#8a4b2a', 'rust', 1500, 1500], ['Black Steel', '#2c2f33', 'brushed', 1000, 1000],
  ],
  'Glass & Water': [
    ['Glass Clear', '#a9d3e6', null, 0, 0, 0.35], ['Glass Tinted', '#3f5f6e', null, 0, 0, 0.5], ['Glass Frosted', '#dbe7ec', null, 0, 0, 0.7], ['Water', '#3c8fb3', 'water', 3000, 3000, 0.75],
  ],
  'Landscape': [
    ['Grass', '#6c9a3c', 'grass', 2000, 2000], ['Soil', '#7a5a3e', 'soil', 2000, 2000], ['Gravel', '#a39b8d', 'gravel', 1000, 1000], ['Paving Block', '#9e8f80', 'paving', 600, 600], ['Asphalt', '#4a4b4d', 'asphalt', 3000, 3000],
  ],
};

export function addLibraryMaterial(model, cat, idx) {
  const [name, color, tex, tw, th, opacity] = LIBRARY[cat][idx];
  for (const m of model.materials.values()) if (m.name === name && m.color === color) return m;
  const m = { id: nid(), name, color, tex: tex || null, tw: tw || 1000, th: th || 1000, opacity: opacity ?? 1 };
  model.materials.set(m.id, m);
  return m;
}

// ---------------------------------------------------------------- procedural textures
const texCache = new Map();
const rnd = (s) => () => ((s = (s * 16807) % 2147483647) / 2147483647);
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const shade = (rgb, k) => `rgb(${rgb.map((c) => Math.max(0, Math.min(255, Math.round(c * k)))).join(',')})`;

export function textureCanvas(kind, color, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), rgb = hexToRgb(color), R = rnd(kind.length * 977 + rgb[0] * 13 + rgb[1]);
  const S = size;
  g.fillStyle = color; g.fillRect(0, 0, S, S);
  const noise = (amt, n = 3000, sz = 1.5) => { for (let i = 0; i < n; i++) { g.fillStyle = shade(rgb, 1 + (R() - 0.5) * amt); g.fillRect(R() * S, R() * S, sz, sz); } };
  switch (kind) {
    case 'brick': {
      const rows = 8, h = S / rows, w = S / 2;
      g.fillStyle = shade(rgb, 1.45); g.fillRect(0, 0, S, S);
      for (let r = 0; r < rows; r++) for (let k = -1; k < 3; k++) {
        const x = k * w + (r % 2 ? w / 2 : 0);
        g.fillStyle = shade(rgb, 0.85 + R() * 0.3); g.fillRect(x + 2, r * h + 2, w - 4, h - 4);
      }
      noise(0.25, 2500); break;
    }
    case 'blocks': {
      const n = 4, s = S / n; g.fillStyle = shade(rgb, 0.7); g.fillRect(0, 0, S, S);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = shade(rgb, 0.9 + R() * 0.2); g.fillRect(i * s + 3, j * s + 3, s - 6, s - 6); g.fillStyle = shade(rgb, 0.55); g.beginPath(); g.arc(i * s + s / 2, j * s + s / 2, s * 0.22, 0, 7); g.fill(); }
      break;
    }
    case 'stone': case 'granite': {
      noise(0.5, 9000, 2.5);
      if (kind === 'stone') { g.strokeStyle = shade(rgb, 0.55); g.lineWidth = 2; for (let i = 0; i < 14; i++) { g.beginPath(); let x = R() * S, y = R() * S; g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (R() - 0.5) * 90; y += (R() - 0.5) * 90; g.lineTo(x, y); } g.stroke(); } }
      break;
    }
    case 'wood': case 'siding': case 'parquet': {
      if (kind === 'parquet') {
        const n = 4, s = S / n;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          const vert = (i + j) % 2;
          for (let k = 0; k < 4; k++) { g.fillStyle = shade(rgb, 0.85 + R() * 0.3); if (vert) g.fillRect(i * s + (k * s) / 4, j * s, s / 4 - 1, s - 1); else g.fillRect(i * s, j * s + (k * s) / 4, s - 1, s / 4 - 1); }
        }
        break;
      }
      for (let y = 0; y < S; y += 1) { const k = 0.9 + 0.12 * Math.sin(y * 0.15 + Math.sin(y * 0.031) * 4) + (R() - 0.5) * 0.05; g.fillStyle = shade(rgb, k); g.fillRect(0, y, S, 1); }
      g.strokeStyle = shade(rgb, 0.75); g.lineWidth = 1;
      for (let i = 0; i < 6; i++) { const cy = R() * S, cx = R() * S; g.beginPath(); g.ellipse(cx, cy, 14 + R() * 10, 4 + R() * 3, 0, 0, 7); g.stroke(); }
      if (kind === 'siding') { g.fillStyle = shade(rgb, 0.55); for (let i = 0; i < 6; i++) g.fillRect(0, (i * S) / 6, S, 3); }
      break;
    }
    case 'concrete': case 'plaster': case 'asphalt': case 'soil': noise(kind === 'plaster' ? 0.08 : 0.22, 14000, kind === 'asphalt' ? 2 : 1.4); if (kind === 'concrete') { g.fillStyle = shade(rgb, 0.8); for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(R() * S, R() * S, R() * 2 + 0.5, 0, 7); g.fill(); } } break;
    case 'gravel': for (let i = 0; i < 1600; i++) { g.fillStyle = shade(rgb, 0.7 + R() * 0.6); g.beginPath(); g.ellipse(R() * S, R() * S, 2 + R() * 4, 2 + R() * 3, R() * 3, 0, 7); g.fill(); } break;
    case 'marble': {
      noise(0.05, 4000); g.strokeStyle = shade(rgb, 0.78); g.globalAlpha = 0.6;
      for (let i = 0; i < 10; i++) { g.lineWidth = R() * 2 + 0.5; g.beginPath(); let x = R() * S, y = 0; g.moveTo(x, y); while (y < S) { x += (R() - 0.5) * 30; y += 10 + R() * 20; g.lineTo(x, y); } g.stroke(); }
      g.globalAlpha = 1; break;
    }
    case 'tile': case 'checker': case 'paving': {
      const n = kind === 'paving' ? 4 : 2, s = S / n;
      g.fillStyle = shade(rgb, 0.72); g.fillRect(0, 0, S, S);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        g.fillStyle = kind === 'checker' ? ((i + j) % 2 ? '#2a2a2a' : color) : shade(rgb, 0.94 + R() * 0.1);
        const o = kind === 'paving' && j % 2 ? s / 2 : 0;
        g.fillRect(i * s + 3 - o, j * s + 3, s - 6, s - 6);
        if (o) g.fillRect(S - o + 3, j * s + 3, s - 6, s - 6);
      }
      break;
    }
    case 'roof': case 'shingle': {
      const rows = 4, h = S / rows;
      for (let r = 0; r < rows; r++) for (let k = -1; k < 5; k++) {
        const w = S / 4, x = k * w + (r % 2 ? w / 2 : 0);
        const grd = g.createLinearGradient(0, r * h, 0, r * h + h);
        grd.addColorStop(0, shade(rgb, 1.15)); grd.addColorStop(1, shade(rgb, 0.7));
        g.fillStyle = grd; g.fillRect(x + 1, r * h, w - 2, h - 2);
      }
      break;
    }
    case 'metal': { for (let x = 0; x < S; x++) { const k = 0.85 + 0.25 * Math.max(0, Math.cos((x / S) * Math.PI * 2 * 4)); g.fillStyle = shade(rgb, k); g.fillRect(x, 0, 1, S); } break; }
    case 'brushed': for (let y = 0; y < S; y++) { g.fillStyle = shade(rgb, 0.95 + R() * 0.1); g.fillRect(0, y, S, 1); } break;
    case 'rust': noise(0.5, 12000, 2); break;
    case 'water': { for (let y = 0; y < S; y += 2) { g.fillStyle = shade(rgb, 0.9 + 0.15 * Math.sin(y * 0.2 + R())); g.fillRect(0, y, S, 2); } break; }
    case 'grass': for (let i = 0; i < 9000; i++) { g.strokeStyle = shade(rgb, 0.7 + R() * 0.6); g.beginPath(); const x = R() * S, y = R() * S; g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 3, y - 3 - R() * 4); g.stroke(); } break;
    case 'fabric': {
      // woven: fine warp/weft threads
      const n = Math.max(32, S / 6);
      for (let i = 0; i < n; i++) { const p = (i / n) * S; g.fillStyle = shade(rgb, i % 2 ? 0.9 : 1.08); g.fillRect(0, p, S, S / n * 0.55); g.fillStyle = shade(rgb, i % 2 ? 1.05 : 0.88); g.globalAlpha = 0.45; g.fillRect(p, 0, S / n * 0.55, S); g.globalAlpha = 1; }
      noise(0.12, 5000, 1); break;
    }
    case 'leather': noise(0.18, 12000, 1.6); g.strokeStyle = shade(rgb, 0.8); g.globalAlpha = 0.25; for (let i = 0; i < 90; i++) { g.beginPath(); const x = R() * S, y = R() * S; g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 18, y + (R() - 0.5) * 18); g.stroke(); } g.globalAlpha = 1; break;
    case 'bark': for (let x = 0; x < S; x += 2) { g.fillStyle = shade(rgb, 0.7 + R() * 0.55); g.fillRect(x, 0, 2, S); } g.strokeStyle = shade(rgb, 0.5); for (let i = 0; i < 60; i++) { const x = R() * S; g.beginPath(); g.moveTo(x, R() * S); g.lineTo(x + (R() - 0.5) * 6, R() * S); g.stroke(); } break;
    case 'leaves': for (let i = 0; i < 900; i++) { g.fillStyle = shade(rgb, 0.65 + R() * 0.7); g.save(); g.translate(R() * S, R() * S); g.rotate(R() * 7); g.beginPath(); g.ellipse(0, 0, 7 + R() * 7, 3 + R() * 3, 0, 0, 7); g.fill(); g.restore(); } break;
    default: break;
  }
  return c;
}

export function getTexture(mat) {
  if (!mat || !mat.tex) return null;
  const key = mat.tex === 'image' ? 'img:' + mat.id + ':' + (mat.img || '').length : mat.tex + ':' + mat.color;
  let t = texCache.get(key);
  if (t) return t;
  if (mat.tex === 'image' && mat.img) {
    t = new THREE.TextureLoader().load(mat.img, () => { window.dispatchEvent(new Event('sk-redraw')); });
  } else {
    t = new THREE.CanvasTexture(textureCanvas(mat.tex, mat.color));
  }
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  texCache.set(key, t);
  return t;
}
export function swatchURL(mat, size = 64) {
  if (mat.tex && mat.tex !== 'image') return textureCanvas(mat.tex, mat.color, 128).toDataURL();
  if (mat.tex === 'image' && mat.img) return mat.img;
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  if ((mat.opacity ?? 1) < 1) { for (let i = 0; i < size; i += 8) for (let j = 0; j < size; j += 8) { g.fillStyle = (i + j) % 16 ? '#fff' : '#ddd'; g.fillRect(i, j, 8, 8); } g.globalAlpha = mat.opacity; }
  g.fillStyle = mat.color; g.fillRect(0, 0, size, size);
  return c.toDataURL();
}
export function libSwatch(entry) {
  const [, color, tex, , , opacity] = entry;
  return swatchURL({ color, tex, opacity: opacity ?? 1 });
}
