// Built-in component library (parametric, generated on demand).
import * as THREE from 'three';
import { Entities, nid, addVertex, addFace, reverseFace } from './model.js';
import { boxGeom, cylGeom, prismGeom } from './ops.js';
import { addLibraryMaterial } from './materials.js';

const mat = (model, cat, name) => { const i = (LIB_MATS[cat] || []).indexOf(name); return i >= 0 ? addLibraryMaterial(model, cat, i).id : null; };
const LIB_MATS = {
  'Wood': ['Oak', 'Walnut', 'Teak', 'Pine', 'Parquet', 'Plywood'],
  'Colors': ['Black', 'Charcoal', 'Gray', 'Silver', 'White', 'Red', 'Brick Red', 'Orange', 'Gold', 'Yellow', 'Lime', 'Green', 'Olive', 'Teal', 'Cyan', 'Sky Blue', 'Blue', 'Navy', 'Purple', 'Pink', 'Beige', 'Sand', 'Tan', 'Brown', 'Cream'],
  'Glass & Water': ['Glass Clear', 'Glass Tinted', 'Glass Frosted', 'Water'],
  'Metal': ['Steel', 'Aluminium', 'Corten', 'Black Steel'],
  'Stone & Concrete': ['Concrete', 'Concrete Dark', 'Exposed Aggregate', 'Granite', 'Marble', 'Plaster'],
};

export const COMPONENTS = [
  { id: 'person', name: 'Person (2D)', desc: 'Standing figure, 1700 mm, always faces camera', icon: 'user' },
  { id: 'door', name: 'Door 900×2100', desc: 'Single leaf door with frame' },
  { id: 'window', name: 'Window 1200×1200', desc: 'Casement window with frame and glass' },
  { id: 'column', name: 'Column 300×300', desc: 'Concrete column, 3000 mm' },
  { id: 'beam', name: 'Beam 250×400', desc: 'Concrete beam, 4000 mm' },
  { id: 'stair', name: 'Stair 12 steps', desc: 'Straight stair, rise 175 / going 280 mm' },
  { id: 'table', name: 'Dining Table', desc: '1600×900×750 mm' },
  { id: 'chair', name: 'Chair', desc: '450×500, seat 450 mm' },
  { id: 'bed', name: 'Bed 1600×2000', desc: 'Queen bed with headboard' },
  { id: 'sofa', name: 'Sofa 3-seat', desc: '2100×850 mm' },
  { id: 'cabinet', name: 'Kitchen Cabinet', desc: '600 mm module, 850 mm high' },
  { id: 'tree', name: 'Tree', desc: 'Stylised tree, 5 m, always faces camera' },
  { id: 'car', name: 'Car (massing)', desc: 'Sedan block 4600×1800×1450' },
  { id: 'pool', name: 'Pool 4×8 m', desc: 'Pool shell with water' },
];

export function buildComponent(model, id) {
  const ents = new Entities();
  let faceCam = false, name = COMPONENTS.find((c) => c.id === id)?.name || id;
  const M = (cat, n) => ({ mat: mat(model, cat, n) });
  switch (id) {
    case 'person': {
      faceCam = true;
      const pts = [[-120, 0], [-60, 0], [-40, 760], [0, 800], [40, 760], [60, 0], [120, 0], [110, 900], [190, 1350], [150, 1360], [90, 1000], [80, 1400], [50, 1450], [70, 1560], [0, 1700], [-70, 1560], [-50, 1450], [-80, 1400], [-90, 1000], [-150, 1360], [-190, 1350], [-110, 900]];
      const f = addFace(ents, [pts.map(([x, z]) => addVertex(ents, new THREE.Vector3(x, 0, z)))], M('Colors', 'Navy'));
      if (f && f.n.y > 0) { reverseFace(ents, f); [f.mat, f.back] = [f.back, f.mat]; }
      break;
    }
    case 'door': {
      const w = 900, ht = 2100, t = 50, fr = 60;
      boxGeom(ents, -fr, -t, 0, 0, 100, ht + fr, M('Wood', 'Walnut'));
      boxGeom(ents, w, -t, 0, w + fr, 100, ht + fr, M('Wood', 'Walnut'));
      boxGeom(ents, 0, -t, ht, w, 100, ht + fr, M('Wood', 'Walnut'));
      boxGeom(ents, 2, 10, 2, w - 2, 50, ht - 2, M('Wood', 'Oak'));
      cylGeom(ents, w - 80, 0, 1000, 1010, 12, 12, M('Metal', 'Aluminium'));
      break;
    }
    case 'window': {
      const w = 1200, ht = 1200, f = 60;
      for (const [x0, z0, x1, z1] of [[0, 0, f, ht], [w - f, 0, w, ht], [0, 0, w, f], [0, ht - f, w, ht], [w / 2 - f / 2, 0, w / 2 + f / 2, ht]]) boxGeom(ents, x0, 0, z0, x1, 80, z1, M('Colors', 'White'));
      boxGeom(ents, f, 35, f, w / 2 - f / 2, 45, ht - f, M('Glass & Water', 'Glass Clear'));
      boxGeom(ents, w / 2 + f / 2, 35, f, w - f, 45, ht - f, M('Glass & Water', 'Glass Clear'));
      break;
    }
    case 'column': boxGeom(ents, 0, 0, 0, 300, 300, 3000, M('Stone & Concrete', 'Concrete')); break;
    case 'beam': boxGeom(ents, 0, 0, 0, 4000, 250, 400, M('Stone & Concrete', 'Concrete')); break;
    case 'stair': {
      const n = 12, r = 175, g = 280, w = 1000;
      const prof = [[0, 0]];
      for (let i = 0; i < n; i++) { prof.push([i * g, (i + 1) * r], [(i + 1) * g, (i + 1) * r]); }
      prof.push([n * g, (n - 1) * r * 0.9 + 0]); prof.push([n * g, n * r - 400]); prof.push([300, -0]);
      const clean = [[0, 0]];
      for (let i = 0; i < n; i++) clean.push([i * g, (i + 1) * r], [(i + 1) * g, (i + 1) * r]);
      clean.push([n * g, n * r - 450], [450, 0]);
      const vs = clean.map(([x, z]) => addVertex(ents, new THREE.Vector3(x, 0, z)));
      const vs2 = clean.map(([x, z]) => addVertex(ents, new THREE.Vector3(x, w, z)));
      addFace(ents, [vs.slice().reverse()], M('Stone & Concrete', 'Concrete'));
      addFace(ents, [vs2], M('Stone & Concrete', 'Concrete'));
      for (let i = 0; i < vs.length; i++) { const j = (i + 1) % vs.length; addFace(ents, [[vs[i], vs[j], vs2[j], vs2[i]]], M('Stone & Concrete', 'Concrete')); }
      void prof;
      break;
    }
    case 'table': {
      boxGeom(ents, 0, 0, 720, 1600, 900, 750, M('Wood', 'Oak'));
      for (const [x, y] of [[50, 50], [1490, 50], [50, 790], [1490, 790]]) boxGeom(ents, x, y, 0, x + 60, y + 60, 720, M('Wood', 'Walnut'));
      break;
    }
    case 'chair': {
      boxGeom(ents, 0, 0, 430, 450, 450, 470, M('Wood', 'Teak'));
      for (const [x, y] of [[20, 20], [390, 20], [20, 390], [390, 390]]) boxGeom(ents, x, y, 0, x + 40, y + 40, 430, M('Wood', 'Walnut'));
      boxGeom(ents, 0, 410, 470, 450, 450, 900, M('Wood', 'Teak'));
      break;
    }
    case 'bed': {
      boxGeom(ents, 0, 0, 0, 1600, 2000, 300, M('Wood', 'Walnut'));
      boxGeom(ents, 30, 30, 300, 1570, 1970, 520, M('Colors', 'White'));
      boxGeom(ents, 0, 1960, 0, 1600, 2050, 1100, M('Wood', 'Walnut'));
      boxGeom(ents, 150, 1600, 520, 750, 1900, 640, M('Colors', 'Cream'));
      boxGeom(ents, 850, 1600, 520, 1450, 1900, 640, M('Colors', 'Cream'));
      break;
    }
    case 'sofa': {
      const c = M('Colors', 'Charcoal');
      boxGeom(ents, 0, 0, 100, 2100, 850, 420, c); boxGeom(ents, 0, 650, 420, 2100, 850, 850, c);
      boxGeom(ents, 0, 0, 420, 180, 650, 650, c); boxGeom(ents, 1920, 0, 420, 2100, 650, 650, c);
      for (const x of [60, 2000]) for (const y of [60, 750]) boxGeom(ents, x, y, 0, x + 40, y + 40, 100, M('Metal', 'Black Steel'));
      break;
    }
    case 'cabinet': {
      boxGeom(ents, 0, 0, 100, 600, 580, 850, M('Colors', 'White'));
      boxGeom(ents, 0, 0, 850, 600, 620, 890, M('Stone & Concrete', 'Granite'));
      boxGeom(ents, 30, -20, 0, 570, 560, 100, M('Colors', 'Charcoal'));
      boxGeom(ents, 260, -20, 700, 340, 0, 720, M('Metal', 'Steel'));
      break;
    }
    case 'tree': {
      faceCam = true;
      cylGeom(ents, 0, 0, 0, 1800, 120, 10, M('Colors', 'Brown'));
      const crown = [];
      for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2, r = 1500 + 260 * Math.sin(i * 2.7); crown.push([Math.cos(a) * r, 3300 + Math.sin(a) * r * 1.05]); }
      const f = addFace(ents, [crown.map(([x, z]) => addVertex(ents, new THREE.Vector3(x, 0, z)))], M('Colors', 'Green'));
      if (f && f.n.y > 0) { reverseFace(ents, f); [f.mat, f.back] = [f.back, f.mat]; }
      break;
    }
    case 'car': {
      const body = M('Colors', 'Red'), glass = M('Glass & Water', 'Glass Tinted'), tire = M('Colors', 'Black');
      boxGeom(ents, 0, 0, 300, 4600, 1800, 900, body);
      prismGeom(ents, [[1200, 100], [3500, 100], [3500, 1700], [1200, 1700]], 900, 1450, glass);
      for (const x of [800, 3700]) for (const y of [0, 1800 - 220]) {
        const pts = []; for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; pts.push([x + Math.cos(a) * 330, 330 + Math.sin(a) * 330]); }
        const vs = pts.map(([px, pz]) => addVertex(ents, new THREE.Vector3(px, y, pz))), vs2 = pts.map(([px, pz]) => addVertex(ents, new THREE.Vector3(px, y + 220, pz)));
        addFace(ents, [vs], tire); addFace(ents, [vs2.slice().reverse()], tire);
        for (let i = 0; i < 16; i++) { const j = (i + 1) % 16; addFace(ents, [[vs[j], vs[i], vs2[i], vs2[j]]], tire); }
      }
      break;
    }
    case 'pool': {
      const t = 200, W = 4000, L = 8000, D = 1500;
      boxGeom(ents, -t, -t, -D - t, W + t, 0, 0, M('Stone & Concrete', 'Plaster'));
      boxGeom(ents, -t, L, -D - t, W + t, L + t, 0, M('Stone & Concrete', 'Plaster'));
      boxGeom(ents, -t, 0, -D - t, 0, L, 0, M('Stone & Concrete', 'Plaster'));
      boxGeom(ents, W, 0, -D - t, W + t, L, 0, M('Stone & Concrete', 'Plaster'));
      boxGeom(ents, 0, 0, -D - t, W, L, -D, M('Stone & Concrete', 'Plaster'));
      boxGeom(ents, 0, 0, -D, W, L, -150, M('Glass & Water', 'Water'));
      break;
    }
    default: break;
  }
  ents.touch();
  const def = { id: nid(), name, desc: COMPONENTS.find((c) => c.id === id)?.desc || '', group: false, faceCam, ents, libId: id };
  model.defs.set(def.id, def);
  return def;
}
