// Auto Paint: works out what every unpainted part of the model is (wall, roof, window glass, door,
// tyre, leaf, seat…) from names + geometry only, and gives it a fitting material. Runs on the device.
import * as THREE from 'three';
import { nid, getEdge } from '../core/model.js';
import { basis, triangulate2, area2 } from '../core/geom.js';
import { intersectFaces, facesAsCutters } from '../core/ops.js';

export const KIND_LABEL = { building: 'Bangunan', vehicle: 'Kendaraan', furniture: 'Furnitur', plant: 'Tanaman', person: 'Orang', site: 'Lahan / tapak', generic: 'Benda umum' };
export const STYLE_LABEL = { auto: 'Otomatis', tropis: 'Tropis modern', minimalis: 'Minimalis', klasik: 'Klasik', industrial: 'Industrial' };

// ---------------------------------------------------------------- material specs
// [name, color, tex, tw, th, opacity, pbr]  pbr: r roughness, m metalness, cc clearcoat, e emissive, ec emissive colour, glass, water
const S = (name, color, tex = null, tw = 1000, th = tw, opacity = 1, pbr = null) => ({ name, color, tex, tw, th, opacity, pbr });
const GLASS_CLEAR = S('Kaca Jendela', '#a3c2cf', null, 1000, 1000, 0.3, { glass: 1 });
const GLASS_TINT = S('Kaca Riben', '#5d7c88', null, 1000, 1000, 0.42, { glass: 1 });
const BUILDING = {
  tropis: {
    wall: S('Dinding Putih Tulang', '#ece6d8', 'plaster', 2000), accent: S('Panel Kayu Jati', '#9b6a3c', 'siding', 2000, 900),
    plinth: S('Batu Alam Andesit', '#7a766e', 'stone', 1200), roof: S('Genteng Tanah Liat', '#9e4b2e', 'roof', 600), roofFlat: S('Dak Beton', '#94938e', 'concrete', 2000),
    floor: S('Keramik Krem 60', '#e3dccd', 'tile', 600), terrace: S('Granit Teras', '#b3ab9f', 'tile', 600), ceiling: S('Plafon Gypsum', '#f4f3ef', 'plaster', 2000),
    soffit: S('Plafon Kayu', '#a9774a', 'wood', 1200), fascia: S('Lisplang Kayu', '#5e4130', 'wood', 1200), frame: S('Kusen Kayu', '#5a3a24', 'wood', 800),
    door: S('Pintu Kayu Jati', '#87552f', 'wood', 1200), glass: GLASS_CLEAR, column: S('Kolom Plester', '#f0ede6', 'plaster', 2000), cap: S('Beton Ekspos', '#b0aea8', 'concrete', 2000),
    stair: S('Granit Tangga', '#8d8781', 'granite', 1000), rail: S('Besi Hitam', '#2a2c30', 'brushed', 1000, 1000, 1, { m: 0.6, r: 0.45 }),
  },
  minimalis: {
    wall: S('Dinding Putih', '#f2f1ed', 'plaster', 2000), accent: S('Dinding Abu Ekspos', '#6d6f72', 'concrete', 2000),
    plinth: S('Beton Abu Gelap', '#4f5154', 'concrete', 2000), roof: S('Atap Metal Abu', '#474a4f', 'metal', 760, 1000, 1, { m: 0.35, r: 0.45 }), roofFlat: S('Dak Beton', '#9a9994', 'concrete', 2000),
    floor: S('Granit Putih 60', '#dddbd5', 'tile', 600), terrace: S('Granit Abu 60', '#8e8c88', 'tile', 600), ceiling: S('Plafon Gypsum', '#f4f3ef', 'plaster', 2000),
    soffit: S('Plafon Putih', '#f1f0ec', 'plaster', 2000), fascia: S('Lisplang Abu', '#34373b', null), frame: S('Kusen Aluminium Hitam', '#232528', 'brushed', 1000, 1000, 1, { m: 0.7, r: 0.35 }),
    door: S('Pintu Kayu Walnut', '#4e3727', 'wood', 1200), glass: GLASS_TINT, column: S('Kolom Putih', '#f2f1ed', 'plaster', 2000), cap: S('Beton Abu', '#8d8c88', 'concrete', 2000),
    stair: S('Granit Abu Tangga', '#77757a', 'granite', 1000), rail: S('Besi Hitam', '#222427', 'brushed', 1000, 1000, 1, { m: 0.6, r: 0.4 }),
  },
  klasik: {
    wall: S('Dinding Krem', '#e9dcc0', 'plaster', 2000), accent: S('List Profil Putih', '#f3efe6', 'plaster', 2000),
    plinth: S('Batu Paras', '#c9bfae', 'stone', 1200), roof: S('Genteng Kodok', '#8c3b26', 'roof', 600), roofFlat: S('Dak Beton', '#9a9994', 'concrete', 2000),
    floor: S('Marmer Putih', '#ece9e3', 'marble', 2000), terrace: S('Teraso', '#d6cfc2', 'granite', 1000), ceiling: S('Plafon Putih', '#f6f4ee', 'plaster', 2000),
    soffit: S('Plafon Putih', '#f6f4ee', 'plaster', 2000), fascia: S('Lisplang Putih', '#f1eee6', null), frame: S('Kusen Cat Putih', '#f4f2ec', null, 1000, 1000, 1, { r: 0.4 }),
    door: S('Pintu Kayu Walnut', '#5b3a26', 'wood', 1200), glass: GLASS_CLEAR, column: S('Kolom Putih', '#f6f3ec', 'plaster', 2000), cap: S('List Beton', '#ded7c8', 'concrete', 2000),
    stair: S('Marmer Tangga', '#e2ddd4', 'marble', 2000), rail: S('Besi Tempa', '#1d1e20', 'brushed', 1000, 1000, 1, { m: 0.6, r: 0.4 }),
  },
  industrial: {
    wall: S('Beton Ekspos', '#9c9b97', 'concrete', 2000), accent: S('Bata Merah Ekspos', '#8e4a32', 'brick', 1200, 600),
    plinth: S('Beton Gelap', '#5f5f5f', 'concrete', 2000), roof: S('Atap Spandek', '#6f767d', 'metal', 760, 1000, 1, { m: 0.5, r: 0.4 }), roofFlat: S('Dak Beton', '#8a8985', 'concrete', 2000),
    floor: S('Lantai Beton Poles', '#a9a8a3', 'concrete', 2000, 2000, 1, { r: 0.35 }), terrace: S('Beton Sikat', '#a29f98', 'concrete', 2000), ceiling: S('Plafon Ekspos', '#bdbcb7', 'concrete', 2000),
    soffit: S('Plafon Ekspos', '#bdbcb7', 'concrete', 2000), fascia: S('Besi Hitam', '#232527', 'brushed'), frame: S('Kusen Besi Hitam', '#202225', 'brushed', 1000, 1000, 1, { m: 0.7, r: 0.4 }),
    door: S('Pintu Besi', '#3a3d40', 'brushed', 1000, 1000, 1, { m: 0.6, r: 0.45 }), glass: GLASS_CLEAR, column: S('Kolom Beton', '#a3a29d', 'concrete', 2000), cap: S('Beton', '#a3a29d', 'concrete', 2000),
    stair: S('Tangga Besi', '#2d2f32', 'brushed', 1000, 1000, 1, { m: 0.6, r: 0.45 }), rail: S('Besi Hitam', '#202225', 'brushed', 1000, 1000, 1, { m: 0.6, r: 0.4 }),
  },
};
const COMMON = {
  ground: S('Rumput Gajah Mini', '#5f8f35', 'grass', 2000), paving: S('Paving Blok', '#9e8f80', 'paving', 600), curb: S('Kanstin Beton', '#a7a49d', 'concrete', 2000),
  water: S('Air Kolam', '#2f86ad', 'water', 3000, 3000, 0.8, { water: 1 }), poolTile: S('Mozaik Kolam', '#3f86b5', 'tile', 100), base: S('Beton Pondasi', '#a2a19c', 'concrete', 2000),
  ramp: S('Beton Sikat', '#a6a39c', 'concrete', 2000),
};
const CAR_COLORS = [['Putih', '#eef0f1', 0, 30], ['Silver', '#b8bdc2', 1, 18], ['Hitam', '#141619', 1, 17], ['Abu Tua', '#55595e', 1, 13], ['Merah', '#a3161c', 1, 8], ['Biru Tua', '#1d3561', 1, 6], ['Coklat', '#6b5443', 1, 3], ['Hijau Tua', '#2c4a3a', 1, 3], ['Kuning', '#e0b21c', 0, 2]];
const LIVERY = ['#c62828', '#1565c0', '#2e7d32', '#f9a825', '#6a1b9a', '#ef6c00', '#00838f'];
const VEH = {
  glass: S('Kaca Film Gelap', '#0f1418', null, 1000, 1000, 1, { r: 0.04, cc: 1 }), tire: S('Ban Karet', '#151515', null, 1000, 1000, 1, { r: 0.88 }),
  rim: S('Velg Alloy', '#b7bcc2', 'brushed', 300, 300, 1, { m: 1, r: 0.25 }), light: S('Lampu Depan', '#eef2f6', null, 1000, 1000, 1, { e: 0.6, ec: '#fff6e8', r: 0.08 }),
  tail: S('Lampu Belakang', '#a8141a', null, 1000, 1000, 1, { e: 0.35, ec: '#ff2a1a', r: 0.12 }), trim: S('Plastik Hitam', '#1f2023', null, 1000, 1000, 1, { r: 0.55 }),
  chrome: S('Krom', '#d6d9dd', null, 1000, 1000, 1, { m: 1, r: 0.08 }), under: S('Kolong Hitam', '#1a1a1a', null, 1000, 1000, 1, { r: 0.9 }),
};
const FABRICS = ['#7d8288', '#b9ab95', '#3f4a5c', '#55624d', '#8a5a44', '#d8d2c6', '#2f3033'];
const FURN = {
  wood: S('Kayu Jati', '#9b6a3c', 'wood', 1200), woodDark: S('Kayu Walnut', '#5e4030', 'wood', 1200), woodLight: S('Kayu Oak', '#c49a64', 'wood', 1200),
  metal: S('Besi Hitam Doff', '#2c2e31', 'brushed', 1000, 1000, 1, { m: 0.7, r: 0.5 }), chrome: S('Stainless', '#c9ced3', 'brushed', 1000, 1000, 1, { m: 1, r: 0.2 }),
  mattress: S('Kasur Putih', '#f1efe9', 'fabric', 300), pillow: S('Bantal Krem', '#e8dfcf', 'fabric', 300), marble: S('Marmer Putih', '#ece9e3', 'marble', 2000),
  leather: S('Kulit Coklat', '#5a3b2a', 'leather', 400),
};
const PLANT = {
  bark: S('Batang Pohon', '#5b4632', 'bark', 600, 1200), leaf: S('Daun Hijau Tua', '#3c6f28', 'leaves', 600), leaf2: S('Daun Hijau Muda', '#5f8f2f', 'leaves', 600),
  pot: S('Pot Terakota', '#b0603b', null, 1000, 1000, 1, { r: 0.7 }), soil: S('Tanah', '#4f3b2a', 'soil', 1000),
  flower: [S('Bunga Merah Muda', '#d9468a'), S('Bunga Merah', '#c8202b'), S('Bunga Kuning', '#efc12f'), S('Bunga Putih', '#f4f1ea'), S('Bunga Ungu', '#8d4ab8')],
};
const SKIN = ['#e3b893', '#c99a74', '#b07c55', '#8d5a3b'];
const SHIRT = ['#f2f2f0', '#20304f', '#1c1c1e', '#9d2b2b', '#6f7378', '#2f6f63', '#c98d2e', '#6a5acd'];
const PANTS = ['#2e4a75', '#1c1d20', '#8b7a5e', '#4b4f55', '#2f3b52'];
const GENERIC = {
  main: [S('Cat Putih Doff', '#eceae5'), S('Keramik Glasir Putih', '#f2f0ea', null, 1000, 1000, 1, { r: 0.18 })],
  accent: ['#c0553a', '#2f6f8f', '#d4a637', '#4c7a4c', '#7b5ea7', '#3b3f45'],
  stone: S('Batu Andesit', '#6f6d69', 'granite', 1000), metal: S('Logam Brushed', '#9aa3ab', 'brushed', 1000, 1000, 1, { m: 1, r: 0.35 }),
  wood: S('Kayu Jati', '#9b6a3c', 'wood', 1200),
};

// ---------------------------------------------------------------- names → kind
const NAME_HINTS = [
  ['vehicle', /\b(car|cars|mobil|bus|bis|truck|truk|lorry|van|sedan|suv|jeep|pick-?up|taxi|taksi|vehicle|kendaraan|motor|motorcycle|scooter|sepeda|bike|bicycle|ambulan|ambulance|minibus|angkot|kereta|train|tram|traktor|tractor|forklift|excavator|ekskavator|bulldozer|coach|kopaja|metromini|mpv|hatchback)\b/i],
  ['person', /\b(person|people|orang|man|woman|men|women|pria|wanita|human|manusia|child|anak|boy|girl|figure|figur|lady|guy)\b/i],
  ['plant', /\b(tree|trees|pohon|plant|plants|tanaman|bunga|flower|flowers|bush|semak|palm|palem|kelapa|kaktus|cactus|bonsai|shrub|perdu|pot bunga|hedge)\b/i],
  ['furniture', /\b(chair|kursi|table|meja|sofa|couch|bed|kasur|ranjang|lemari|cabinet|wardrobe|desk|shelf|rak|bench|bangku|stool|nakas|drawer|laci|cupboard|bookcase|furniture|furnitur|mebel)\b/i],
  ['building', /\b(house|rumah|building|gedung|bangunan|villa|ruko|kantor|office|toko|shop|store|masjid|mosque|church|gereja|tower|menara|apartment|apartemen|hotel|school|sekolah|gudang|warehouse|pabrik|factory|garage|garasi|pavilion|gazebo|pendopo|hall|aula|cottage|cabin|kabin|bungalow|kos|kost|mushola|musholla|pura|vihara|klenteng|stadion|bandara|terminal|stasiun)\b/i],
  ['site', /\b(site|tapak|lahan|kavling|ground|tanah|lawn|halaman|yard)\b/i],
];
const PART_HINTS = [
  ['window', /\b(window|jendela|kaca|glass|glazing|curtain ?wall|bovenlicht|boven)\b/i], ['door', /\b(door|pintu|gate)\b/i], ['roof', /\b(roof|atap|genteng|genting)\b/i],
  ['column', /\b(column|kolom|pillar|tiang|pilar)\b/i], ['stair', /\b(stair|stairs|tangga|step|undakan)\b/i], ['rail', /\b(rail|railing|reling|pagar|fence|balustrade|handrail)\b/i],
  ['floor', /\b(floor|lantai|slab|plat)\b/i], ['wall', /\b(wall|dinding|tembok)\b/i], ['pool', /\b(pool|kolam)\b/i],
];
const kindOfName = (s) => { for (const [k, re] of NAME_HINTS) if (re.test(s)) return k; return null; };
const partOfName = (s) => { for (const [k, re] of PART_HINTS) if (re.test(s)) return k; return null; };

// ---------------------------------------------------------------- random
export function rng(seed) { let a = seed >>> 0 || 1; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
const pickW = (r, arr) => { const tot = arr.reduce((s, x) => s + x[3], 0); let x = r() * tot; for (const a of arr) { x -= a[3]; if (x <= 0) return a; } return arr[0]; };

// ---------------------------------------------------------------- collect objects + face records
function visTag(model, t) { const x = model.tags.get(t || 0); return !x || x.visible !== false; }
function faceRec(ents, entsKey, f, m, nm, hint) {
  const P = (id) => ents.P(id).clone().applyMatrix4(m);
  const outer = f.loops[0].map(P);
  const holes = f.loops.slice(1).map((l) => l.map(P));
  const n = f.n.clone().applyMatrix3(nm).normalize();
  const { u, v } = basis(n);
  const o2 = outer.map((p) => [p.dot(u), p.dot(v)]);
  let area = Math.abs(area2(o2));
  for (const h of holes) area -= Math.abs(area2(h.map((p) => [p.dot(u), p.dot(v)])));
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const c = new THREE.Vector3();
  for (let i = 0; i < outer.length; i++) { const [a, b] = o2[i]; if (a < u0) u0 = a; if (a > u1) u1 = a; if (b < v0) v0 = b; if (b > v1) v1 = b; const p = outer[i]; if (p.z < z0) z0 = p.z; if (p.z > z1) z1 = p.z; c.add(p); }
  c.divideScalar(outer.length || 1);
  const vertical = Math.abs(n.z) < 0.2;
  return { ents, entsKey, f, n, c, outer, holes, area: Math.max(0, area), w: u1 - u0, h: v1 - v0, zmin: z0, zmax: z1, vertical,
    minExt: Math.min(u1 - u0, v1 - v0), maxExt: Math.max(u1 - u0, v1 - v0), tri: f.loops.length === 1 && f.loops[0].length === 3, hint };
}
function newObj(key, names, inst) { return { key, names, inst, faces: [], box: new THREE.Box3() }; }
function walk(model, ents, entsKey, m, obj, hint, out, seen, depth = 0) {
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  for (const f of ents.faces.values()) {
    if (f.hidden || !visTag(model, f.tag)) continue;
    const r = faceRec(ents, entsKey, f, m, nm, hint);
    obj.faces.push(r);
  }
  if (depth > 12) return;
  for (const inst of ents.insts.values()) {
    if (inst.hidden || !visTag(model, inst.tag)) continue;
    const def = model.defs.get(inst.def); if (!def) continue;
    const name = [inst.name, def.name, def.libId].filter(Boolean).join(' ');
    const mm = m.clone().multiply(inst.m);
    const k = kindOfName(name);
    // a car / tree / person / chair / house nested inside a bigger group is its own object
    if (k && k !== obj.nameKind) {
      const o = newObj(obj.key + '/' + inst.id, [name], inst); o.nameKind = k; o.display = inst.name || def.name;
      walk(model, def.ents, def.id, mm, o, null, out, seen, depth + 1);
      out.push(o); continue;
    }
    walk(model, def.ents, def.id, mm, obj, partOfName(name) || hint, out, seen, depth + 1);
  }
}
function looseClusters(ents) {
  // faces joined by shared edges
  const par = new Map(); const find = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
  for (const id of ents.faces.keys()) par.set(id, id);
  for (const e of ents.edges.values()) { if (e.faces.size < 2) continue; const [a, ...rest] = [...e.faces]; for (const b of rest) { const ra = find(a), rb = find(b); if (ra !== rb) par.set(ra, rb); } }
  const cl = new Map();
  for (const id of ents.faces.keys()) { const r = find(id); if (!cl.has(r)) cl.set(r, []); cl.get(r).push(id); }
  return [...cl.values()];
}
export function collectObjects(model) {
  const out = [];
  for (const inst of model.root.insts.values()) {
    if (inst.hidden || !visTag(model, inst.tag)) continue;
    const def = model.defs.get(inst.def); if (!def) continue;
    const name = [inst.name, def.name, def.libId].filter(Boolean).join(' ');
    const o = newObj('i' + inst.id, [name], inst); o.nameKind = kindOfName(name); o.libId = def.libId; o.display = inst.name || def.name;
    walk(model, def.ents, def.id, inst.m.clone(), o, partOfName(name), out, null);
    out.push(o);
  }
  const I = new THREE.Matrix4(), NM = new THREE.Matrix3();
  for (const ids of looseClusters(model.root)) {
    const o = newObj('c' + Math.min(...ids), [''], null);
    for (const id of ids) { const f = model.root.faces.get(id); if (f.hidden || !visTag(model, f.tag)) continue; o.faces.push(faceRec(model.root, 'root', f, I, NM, null)); }
    out.push(o);
  }
  for (const o of out) finish(o);
  return out.filter((o) => o.faces.length);
}
function finish(o) {
  o.box.makeEmpty();
  let tri = 0, area = 0;
  for (const r of o.faces) { for (const p of r.outer) o.box.expandByPoint(p); if (r.tri) tri += r.area; area += r.area; }
  o.area = area; o.triFrac = area ? tri / area : 0;
  o.meshy = o.faces.length > 60 && o.triFrac > 0.45;
  o.size = o.box.isEmpty() ? new THREE.Vector3() : o.box.getSize(new THREE.Vector3());
  o.long = o.size.x >= o.size.y ? 0 : 1; // 0: X is the long axis
}

// ---------------------------------------------------------------- kind detection
function zBandExtent(o, lo, hi) {
  const z0 = o.box.min.z, H = o.size.z || 1; const b = new THREE.Box3();
  for (const r of o.faces) for (const p of r.outer) { const t = (p.z - z0) / H; if (t >= lo && t <= hi) b.expandByPoint(p); }
  if (b.isEmpty()) return 0; const s = b.getSize(new THREE.Vector3()); return Math.max(s.x, s.y);
}
function groundClusters(o) {
  // where along the long axis the object touches the ground (wheels)
  const z0 = o.box.min.z, H = o.size.z, ax = o.long ? 'y' : 'x', L = o.size[ax] || 1, s0 = o.box.min[ax];
  const bins = new Array(50).fill(0);
  for (const r of o.faces) for (const p of r.outer) if (p.z < z0 + H * 0.035) bins[Math.min(49, Math.floor(((p[ax] - s0) / L) * 50))]++;
  const cl = []; let cur = null;
  for (let i = 0; i < 50; i++) { if (bins[i]) { if (!cur) cur = { a: i, b: i, n: 0 }; cur.b = i; cur.n += bins[i]; } else if (cur) { cl.push(cur); cur = null; } }
  if (cur) cl.push(cur);
  return cl.map((c) => ({ s: s0 + ((c.a + c.b + 1) / 2 / 50) * L, len: ((c.b - c.a + 1) / 50) * L }));
}
export function detectKind(o) {
  if (o.nameKind) return o.nameKind;
  if (o.libId === 'person') return 'person';
  if (o.libId === 'tree') return 'plant';
  if (o.libId === 'car') return 'vehicle';
  const s = o.size, L = Math.max(s.x, s.y), W = Math.min(s.x, s.y), H = s.z;
  if (H < 350 && L > 2000) return 'site';
  if (H >= 1050 && H <= 2150 && L <= 950 && o.meshy) return 'person';
  if (H > 1400 && zBandExtent(o, 0, 0.22) < 0.35 * zBandExtent(o, 0.45, 1) && o.meshy) return 'plant';
  if (L >= 2400 && L <= 22000 && W >= 1100 && W <= 3300 && H >= 900 && H <= 4800 && L / W >= 1.65) {
    const g = groundClusters(o);
    const spread = g.length >= 2 ? Math.abs(g[g.length - 1].s - g[0].s) / L : 0;
    if (o.meshy || spread > 0.45) return 'vehicle';
  }
  if (L >= 3000 && H >= 2100) return 'building';
  if (H >= 2100 && o.area > 25e6) return 'building';
  if (L <= 3300 && H <= 2600) return o.meshy && !flatTop(o) ? 'generic' : 'furniture';
  return o.meshy ? 'generic' : 'building';
}
function flatTop(o) {
  let up = 0; for (const r of o.faces) if (r.n.z > 0.95 && r.c.z > o.box.min.z + o.size.z * 0.3) up += r.area;
  return up > 0.15 * o.size.x * o.size.y;
}

// ---------------------------------------------------------------- which faces still need paint
function satOf(hex) { const c = new THREE.Color(hex); const hsl = {}; c.getHSL(hsl); return { s: hsl.s, l: hsl.l }; }
function needsPaint(model, o, scope) {
  if (scope === 'all') return new Set(o.faces);
  const mats = new Set(o.faces.map((r) => r.f.mat).filter((x) => x != null));
  // grey placeholder colours (an Image to 3D mesh whose photo colours could not be read) count as unpainted
  let placeholder = false;
  const defName = o.inst ? model.defs.get(o.inst.def)?.name : null;
  const aiNamed = (m) => defName && m.name && m.name.startsWith(defName + ' ');
  if (mats.size && mats.size <= 3) {
    placeholder = [...mats].every((id) => { const m = model.materials.get(id); if (!m || m.tex) return false; const { s } = satOf(m.color); return s < 0.14 && (m.opacity ?? 1) >= 1 && (o.meshy || aiNamed(m)); });
  }
  return new Set(o.faces.filter((r) => r.f.mat == null || placeholder));
}

// ---------------------------------------------------------------- plan
export function planAutoPaint(model, opts = {}) {
  const objs = collectObjects(model);
  for (const o of objs) o.autoKind = detectKind(o);
  // loose pieces touching a building (a roof, a floating slab…) belong to it
  const bld = objs.filter((o) => o.autoKind === 'building');
  for (const o of objs) {
    if (o.autoKind === 'building' || o.nameKind || !bld.length) continue;
    if (!['furniture', 'generic', 'site'].includes(o.autoKind) || o.meshy) continue;
    const b = o.box.clone().expandByScalar(300);
    const host = bld.find((x) => x.box.intersectsBox(b)); if (!host) continue;
    const L = Math.max(o.size.x, o.size.y);
    if (o.box.min.z > host.box.min.z + 1800 || o.size.z > 2000 || L > 4000) o.autoKind = 'building';
  }
  for (const o of objs) o.kind = (opts.kinds && opts.kinds[o.key]) || o.autoKind;
  const seed = opts.seed ?? 7;
  const style = resolveStyle(opts.style || 'auto', objs, seed);
  const assign = [], frames = [], done = new Set();
  const add = (r, role, spec) => { const k = r.entsKey + ':' + r.f.id; if (done.has(k)) return; done.add(k); assign.push({ entsKey: r.entsKey, fid: r.f.id, role, spec }); };
  // buildings are painted together (shared ground level, roof height, floor levels)
  const buildings = objs.filter((o) => o.kind === 'building');
  if (buildings.length) {
    const need = new Set(); for (const o of buildings) for (const r of needsPaint(model, o, opts.scope)) need.add(r);
    if (need.size) {
      const all = buildings.flatMap((o) => o.faces);
      const roles = classifyBuilding(all, model);
      const B = BUILDING[style];
      for (const r of all) if (need.has(r)) { const role = roles.get(r) || 'wall'; add(r, role, B[role] || COMMON[role] || B.wall); if (role === 'glass' || role === 'door') frames.push(frameOf(r, role)); }
    }
  }
  for (const o of objs) {
    if (o.kind === 'building') continue;
    const need = needsPaint(model, o, opts.scope); if (!need.size) continue;
    const r0 = rng(hashStr(o.key) ^ seed);
    const out = CLASSIFY[o.kind]?.(o, r0, opts) || CLASSIFY.generic(o, r0, opts);
    for (const r of o.faces) if (need.has(r)) { const x = out.get(r) || out.default; if (x) add(r, x.role, x.spec); }
  }
  return {
    style, assign, frames: frames.filter(Boolean),
    objects: objs.map((o) => ({ key: o.key, name: (o.display || o.names[0] || '').trim() || (o.inst ? 'Komponen' : 'Geometri lepas'), kind: o.kind, autoKind: o.autoKind, faces: o.faces.length, size: o.size.toArray() })),
  };
}
function resolveStyle(style, objs, seed) {
  if (style !== 'auto' && BUILDING[style]) return style;
  // flat roofs read as minimalis, pitched as tropis
  let flat = 0, slope = 0;
  for (const o of objs) if (o.autoKind === 'building') for (const r of o.faces) { if (r.n.z > 0.94 && r.c.z > o.box.min.z + o.size.z * 0.6) flat += r.area; else if (r.n.z > 0.2 && r.n.z <= 0.94) slope += r.area; }
  if (flat + slope === 0) return seed % 2 ? 'tropis' : 'minimalis';
  return slope > flat * 0.6 ? 'tropis' : 'minimalis';
}
// Big flat faces (a bus side drawn as one face) cannot be part body, part window. Before painting,
// vehicles get their large faces cut along the belt line, window line, light line… (soft edges).
const BANDS = { big: [0.06, 0.14, 0.36, 0.45, 0.9], car: [0.06, 0.26, 0.5, 0.57, 0.9] };
export function prepareAutoPaint(model, opts = {}) {
  let cuts = 0;
  for (const o of collectObjects(model)) {
    const kind = (opts.kinds && opts.kinds[o.key]) || detectKind(o);
    if (kind !== 'vehicle') continue;
    if (!needsPaint(model, o, opts.scope).size) continue;
    const H = o.size.z, z0 = o.box.min.z; if (H < 300) continue;
    const big = H > 2400 || Math.max(o.size.x, o.size.y) > 7000;
    const tall = o.faces.filter((r) => r.zmax - r.zmin > H * 0.2 && Math.abs(r.n.z) < 0.8);
    if (!tall.length) continue;
    const byEnts = new Map(); for (const r of tall) { if (!byEnts.has(r.ents)) byEnts.set(r.ents, { ids: new Set(), r }); byEnts.get(r.ents).ids.add(r.f.id); }
    const inv = o.inst ? o.inst.m.clone().invert() : new THREE.Matrix4();
    for (const [ents, { ids }] of byEnts) {
      // local frame of that geometry (instances of vehicles stand upright: z maps on its own)
      const lb = new THREE.Box3(); for (const v of ents.verts.values()) lb.expandByPoint(v.p);
      const pad = lb.getSize(new THREE.Vector3()).length();
      const cutters = (big ? BANDS.big : BANDS.car).map((t) => {
        const z = new THREE.Vector3(o.box.getCenter(new THREE.Vector3()).x, o.box.getCenter(new THREE.Vector3()).y, z0 + t * H).applyMatrix4(inv).z;
        const n = new THREE.Vector3(0, 0, 1);
        return { loops: [[new THREE.Vector3(lb.min.x - pad, lb.min.y - pad, z), new THREE.Vector3(lb.max.x + pad, lb.min.y - pad, z), new THREE.Vector3(lb.max.x + pad, lb.max.y + pad, z), new THREE.Vector3(lb.min.x - pad, lb.max.y + pad, z)]], n, d: z };
      });
      const before = new Set(ents.edges.keys());
      cuts += intersectFaces(ents, facesAsCutters(model, ents, [...ids]), cutters);
      for (const e of ents.edges.values()) {
        if (before.has(e.id) || e.faces.size !== 2) continue;
        const [f, g] = [...e.faces].map((x) => ents.faces.get(x));
        if (f && g && f.n.dot(g.n) > 0.94) { e.soft = true; e.smooth = true; }
      }
      ents.touch();
    }
  }
  return cuts;
}
export function applyAutoPaint(model, plan) {
  const ids = new Map(), touched = new Set();
  const matId = (spec) => {
    const k = JSON.stringify(spec); let id = ids.get(k); if (id != null) return id;
    for (const m of model.materials.values()) if (m.name === spec.name && m.color === spec.color && (m.tex || null) === spec.tex) { ids.set(k, m.id); return m.id; }
    id = nid();
    const m = { id, name: spec.name, color: spec.color, tex: spec.tex, tw: spec.tw || 1000, th: spec.th || 1000, opacity: spec.opacity ?? 1 };
    if (spec.pbr) m.pbr = { ...spec.pbr };
    model.materials.set(id, m); ids.set(k, id); return id;
  };
  let n = 0;
  for (const a of plan.assign) {
    const ents = a.entsKey === 'root' ? model.root : model.defs.get(+a.entsKey)?.ents || model.defs.get(a.entsKey)?.ents; if (!ents) continue;
    const f = ents.faces.get(a.fid); if (!f) continue;
    const id = matId(a.spec);
    f.mat = id; f.back = id; n++;
    touched.add(ents);
  }
  for (const e of touched) e.touch();
  return n;
}

// ---------------------------------------------------------------- buildings
function heightMaps(faces, box, N = 96) {
  const sx = (box.max.x - box.min.x) || 1, sy = (box.max.y - box.min.y) || 1, cs = Math.max(sx, sy) / N;
  const nx = Math.max(1, Math.ceil(sx / cs)), ny = Math.max(1, Math.ceil(sy / cs));
  const hi = new Float32Array(nx * ny).fill(-Infinity), lo = new Float32Array(nx * ny).fill(Infinity);
  const tri = (a, b, c) => {
    const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - box.min.x) / cs)), x1 = Math.min(nx - 1, Math.floor((Math.max(a.x, b.x, c.x) - box.min.x) / cs));
    const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y, c.y) - box.min.y) / cs)), y1 = Math.min(ny - 1, Math.floor((Math.max(a.y, b.y, c.y) - box.min.y) / cs));
    const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y); if (Math.abs(d) < 1e-6) return;
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const px = box.min.x + (i + 0.5) * cs, py = box.min.y + (j + 0.5) * cs;
      const w1 = ((b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y)) / d, w2 = ((c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y)) / d, w3 = 1 - w1 - w2;
      if (w1 < -0.02 || w2 < -0.02 || w3 < -0.02) continue;
      const z = w1 * a.z + w2 * b.z + w3 * c.z, k = j * nx + i;
      if (z > hi[k]) hi[k] = z; if (z < lo[k]) lo[k] = z;
    }
  };
  for (const r of faces) { if (r.vertical) continue; for (const t of triOf(r)) tri(t[0], t[1], t[2]); }
  const cell = (p) => { const i = Math.floor((p.x - box.min.x) / cs), j = Math.floor((p.y - box.min.y) / cs); return i >= 0 && j >= 0 && i < nx && j < ny ? j * nx + i : -1; };
  const samples = (r) => triOf(r).slice(0, 7).map((t) => new THREE.Vector3().add(t[0]).add(t[1]).add(t[2]).divideScalar(3));
  // share of the face with nothing above it (eaves may overhang part of a terrace)
  return {
    topFrac: (r) => { const s = samples(r); if (!s.length) return 1; let n = 0; for (const p of s) { const k = cell(p); if (k < 0 || hi[k] <= p.z + 60) n++; } return n / s.length; },
  };
}
function triOf(r) {
  if (r._tri) return r._tri;
  const { u, v } = basis(r.n);
  const o2 = r.outer.map((p) => [p.dot(u), p.dot(v)]), h2 = r.holes.map((h) => h.map((p) => [p.dot(u), p.dot(v)]));
  const all = r.outer.concat(...r.holes);
  const t = r.outer.length === 3 && !r.holes.length ? [[0, 1, 2]] : triangulate2(o2, h2);
  r._tri = t.map((x) => [all[x[0]], all[x[1]], all[x[2]]]).sort((a, b) => triArea(b) - triArea(a));
  return r._tri;
}
const triArea = (t) => new THREE.Vector3().subVectors(t[1], t[0]).cross(new THREE.Vector3().subVectors(t[2], t[0])).length() / 2;

function classifyBuilding(faces, model) {
  void model;
  const box = new THREE.Box3(); for (const r of faces) for (const p of r.outer) box.expandByPoint(p);
  const z0 = box.min.z, H = Math.max(1, box.max.z - z0);
  const hm = heightMaps(faces, box);
  const roles = new Map();
  // walls footprint + floor levels
  const wb = new THREE.Box3(); let wallTop = z0;
  for (const r of faces) if (r.vertical && r.h > 1500) { for (const p of r.outer) wb.expandByPoint(p); wallTop = Math.max(wallTop, r.zmax); }
  const floors = [z0];
  for (const r of faces) if (r.n.z > 0.94 && r.area > 2e6) floors.push(r.c.z);
  floors.sort((a, b) => a - b);
  const floorBelow = (z) => { let f = z0; for (const x of floors) if (x <= z + 150) f = x; return f; };
  const byFace = new Map(); for (const r of faces) if (!byFace.has(r.entsKey + ':' + r.f.id)) byFace.set(r.entsKey + ':' + r.f.id, r);
  const recOf = (ents, entsKey, fid) => byFace.get(entsKey + ':' + fid);
  const panels = openingPanels(faces, recOf);
  // the main ground / floor level: the biggest up-facing surface in the lower part
  let groundZ = z0, gA = 0;
  for (const r of faces) if (r.n.z > 0.94 && r.c.z < z0 + H * 0.4 && r.area > gA) { gA = r.area; groundZ = r.c.z; }
  const outside = (r) => (wb.isEmpty() ? Infinity : Math.max(wb.min.x - minOf(r, 'x'), maxOf(r, 'x') - wb.max.x, wb.min.y - minOf(r, 'y'), maxOf(r, 'y') - wb.max.y));
  for (const r of faces) {
    const nz = r.n.z, hint = r.hint;
    let role = null;
    if (hint === 'window' || hint === 'door') role = partRole(r, hint);
    else if (panels.has(r)) role = r.zmin - floorBelow(r.zmin) < 260 && r.h >= 1750 && r.h <= 2900 && r.w <= 1600 ? 'door' : 'glass';
    else if (hint === 'rail') role = 'rail';
    else if (hint === 'column') role = 'column';
    else if (hint === 'stair') role = 'stair';
    else if (hint === 'pool') role = nz > 0.9 ? 'water' : 'poolTile';
    if (!role) {
      if (Math.abs(nz) > 0.94) {
        // a face drawn on the ground often points down (SketchUp habit): judge by what is above it
        const top = hm.topFrac(r) >= 0.5;
        const upVisible = nz > 0 || top;
        if (upVisible) {
          const beyond = outside(r);
          if (r.c.z < groundZ - 300 && isRecess(r, recOf)) role = 'poolTile';
          else if (r.c.z <= z0 + 650 && r.area > 12e6 && beyond > 1500) role = 'ground';
          else if (r.c.z <= z0 + 650 && beyond > 400) role = 'terrace';
          else if (top && r.c.z > z0 + Math.min(2300, H * 0.45)) role = r.minExt < 420 ? 'cap' : 'roofFlat';
          else if (r.minExt < 420 && r.maxExt > 500) role = isStep(r, faces) ? 'stair' : 'cap';
          else role = r.c.z < z0 + 700 && beyond > 0 ? 'terrace' : 'floor';
        } else role = r.c.z <= z0 + 40 ? 'base' : outside(r) > 100 ? 'soffit' : 'ceiling';
      } else if (nz > 0.2) role = r.c.z > z0 + H * 0.35 || r.zmin > z0 + 2000 ? 'roof' : 'ramp';
      else if (nz < -0.2) role = 'soffit';
      else {
        if (r.zmax <= groundZ + 20 && r.zmin < groundZ - 300) role = 'poolTile';
        else if (r.zmax <= z0 + 700 && r.h < 720 && H > 2500) role = 'plinth';
        else if (r.h >= 100 && r.h <= 240 && r.w >= 600 && r.zmax < z0 + H * 0.6 && isRiser(r, faces)) role = 'stair';
        else if (r.h < 460 && r.w > 900 && r.c.z > z0 + H * 0.55 && r.zmin >= wallTop - 700) role = 'fascia';
        else if (r.w < 460 && r.h > 2000 && isColumn(r, recOf)) role = 'column';
        else role = 'wall';
      }
    }
    roles.set(r, role);
  }
  return roles;
}
const minOf = (r, a) => { let m = Infinity; for (const p of r.outer) if (p[a] < m) m = p[a]; return m; };
const maxOf = (r, a) => { let m = -Infinity; for (const p of r.outer) if (p[a] > m) m = p[a]; return m; };
function partRole(r, hint) {
  // faces of a window/door component: the big thin faces are glass / leaf, the rest is frame
  if (hint === 'door') {
    if (r.vertical && r.h > 1500 && r.w > 500) return r.w > 1500 ? 'glass' : 'door';
    return 'frame';
  }
  if (r.vertical && r.w > 250 && r.h > 250 && r.area > 0.12e6) return 'glass';
  return 'frame';
}
function edgeNeighbours(r, recOf) {
  const out = [];
  const ents = r.ents, f = r.f;
  f.loops.forEach((loop, li) => {
    const W = li === 0 ? r.outer : r.holes[li - 1];
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length], e = getEdge(ents, a, b); if (!e) continue;
      const len = W[i].distanceTo(W[(i + 1) % W.length]);
      for (const gid of e.faces) if (gid !== f.id) { const q = recOf(ents, r.entsKey, gid); if (q) out.push({ q, len, outer: li === 0 }); }
    }
  });
  return out;
}
function isRecess(r, recOf) {
  // every outer edge meets a wall going up: a sunken floor (pool)
  let per = 0, held = 0;
  for (let i = 0; i < r.outer.length; i++) per += r.outer[i].distanceTo(r.outer[(i + 1) % r.outer.length]);
  for (const { q, len, outer } of edgeNeighbours(r, recOf)) if (outer && q.vertical && q.zmax > r.c.z + 250) held += len;
  return held >= per * 0.9;
}
function openingPanels(faces, recOf) {
  // vertical rectangles inside a wall (flush, or pushed in with reveals around them)
  const out = new Set();
  const wallish = (q) => q.vertical && q.area > 2.5e6;
  for (const r of faces) {
    if (!r.vertical || r.holes.length || r.outer.length > 10 || r.w < 300 || r.h < 300 || r.w > 4500 || r.h > 3200) continue;
    let per = 0; for (let i = 0; i < r.outer.length; i++) per += r.outer[i].distanceTo(r.outer[(i + 1) % r.outer.length]);
    let held = 0, flush = false, recess = false;
    for (const { q, len } of edgeNeighbours(r, recOf)) {
      const dot = q.n.dot(r.n);
      if (dot > 0.995 && Math.abs(q.n.dot(q.c) - r.n.dot(r.c)) < 2 && q.area > r.area * 1.5 && wallish(q)) { held += len; flush = true; }
      else if (Math.abs(dot) < 0.08 && Math.min(q.w, q.h) < 650) {
        // a reveal: does it lead to a wall face in front of the panel?
        const lead = edgeNeighbours(q, recOf).some(({ q: w }) => w !== r && w.n.dot(r.n) > 0.995 && wallish(w) && (w.n.dot(w.c) - r.n.dot(r.c)) > 5 && (w.n.dot(w.c) - r.n.dot(r.c)) < 650);
        if (lead) { held += len; recess = true; }
      }
    }
    if ((flush || recess) && held >= per * 0.55) out.add(r);
  }
  return out;
}
function isColumn(r, recOf) {
  const nb = edgeNeighbours(r, recOf).filter(({ q }) => q.vertical && Math.abs(q.n.dot(r.n)) < 0.1);
  return nb.length >= 2 && nb.every(({ q }) => q.w < 700);
}
function isRiser(r, faces) { return faces.some((q) => q.n.z > 0.94 && Math.abs(q.zmax - r.zmax) < 15 && q.minExt < 450 && q.outer.some((p) => r.outer.some((s) => p.distanceTo(s) < 5))); }
function isStep(r, faces) { return faces.some((q) => q.vertical && q.h >= 100 && q.h <= 240 && Math.abs(q.zmax - r.c.z) < 15 && q.outer.some((p) => r.outer.some((s) => p.distanceTo(s) < 5))); }
function frameOf(r, role) {
  if (!r.vertical) return null;
  return { pts: r.outer.map((p) => p.toArray()), n: r.n.toArray(), role };
}

// ---------------------------------------------------------------- vehicles, furniture, plants, people, sites, other things
const CLASSIFY = {
  vehicle(o, R) {
    const out = new Map();
    const z0 = o.box.min.z, H = Math.max(1, o.size.z), ax = o.long ? 'y' : 'x', lat = o.long ? 'x' : 'y';
    const L = o.size[ax], W = o.size[lat], s0 = o.box.min[ax], t0 = (o.box.min[lat] + o.box.max[lat]) / 2;
    const big = H > 2400 || L > 7000; // bus / truck
    // paint
    let paint, paint2 = null;
    if (big) {
      paint = S('Cat Bus Putih', pick(R, ['#f1f1ee', '#e9e9e4', '#f4f2ea']), null, 1000, 1000, 1, { r: 0.3, cc: 1, ccr: 0.05 });
      const lv = pick(R, LIVERY); paint2 = S('Cat Livery', lv, null, 1000, 1000, 1, { r: 0.3, cc: 1, ccr: 0.05 });
    } else {
      const c = pickW(R, CAR_COLORS);
      paint = S('Cat Mobil ' + c[0], c[1], null, 1000, 1000, 1, { m: c[2] ? 0.55 : 0.05, r: 0.3, cc: 1, ccr: 0.04 });
    }
    // wheels from where the body touches the ground
    let g = groundClusters(o).filter((c) => c.len < L * 0.35);
    if (g.length < 2) g = big ? [{ s: s0 + L * 0.2 }, { s: s0 + L * 0.78 }] : [{ s: s0 + L * 0.18 }, { s: s0 + L * 0.8 }];
    const wr = Math.max(240, Math.min(620, big ? H * 0.16 : H * 0.22));
    // which end is the front: the cabin (high part) sits away from the front on cars
    let sc = 0, nc = 0; for (const r of o.faces) for (const p of r.outer) if (p.z > z0 + H * 0.82) { sc += p[ax]; nc++; }
    const mid = s0 + L / 2; let front = 1;
    if (nc && Math.abs(sc / nc - mid) > L * 0.03) front = sc / nc < mid ? 1 : -1;
    const fwd = new THREE.Vector3(); fwd[ax] = front;
    const latV = new THREE.Vector3(); latV[lat] = 1;
    for (const r of o.faces) {
      const zr = (r.c.z - z0) / H, s = r.c[ax], t = r.c[lat] - t0;
      const nl = Math.abs(r.n.dot(latV)), nf = r.n.dot(fwd), nb = -nf;
      let role = 'paint';
      let wheel = null; for (const c of g) { const d = Math.hypot(s - c.s, r.c.z - (z0 + wr)); if (d < wr * 1.08) { wheel = d; break; } }
      if (wheel != null && (nl > 0.45 || r.c.z < z0 + wr * 0.55)) role = wheel < wr * 0.58 && nl > 0.7 ? 'rim' : 'tire';
      else if (zr < 0.06 || (r.n.z < -0.6 && zr < 0.3)) role = 'under';
      else if (big) {
        if (nl > 0.6 && zr > 0.45 && zr < 0.9) role = 'glass';
        else if ((nf > 0.5 || nb > 0.5) && zr > 0.38 && zr < 0.93) role = 'glass';
        else if ((nf > 0.55 || nb > 0.55) && zr > 0.08 && zr < 0.22 && Math.abs(t) > W * 0.28) role = nf > 0 ? 'light' : 'tail';
        else if (nl > 0.5 && zr > 0.14 && zr < 0.36) role = 'paint2';
        else if ((nf > 0.6 || nb > 0.6) && zr < 0.12) role = 'trim';
      } else {
        if (nl > 0.55 && zr > 0.58 && zr < 0.9) role = 'glass';
        else if ((nf > 0.25 || nb > 0.25) && r.n.z < 0.88 && zr > 0.56 && zr < 0.93 && Math.abs(t) < W * 0.46) role = 'glass';
        else if ((nf > 0.55 || nb > 0.55) && zr > 0.28 && zr < 0.5 && Math.abs(t) > W * 0.24) role = nf > 0 ? 'light' : 'tail';
        else if (nf > 0.6 && zr > 0.18 && zr < 0.42 && Math.abs(t) < W * 0.22) role = 'trim';
        else if ((nf > 0.6 || nb > 0.6) && zr < 0.26) role = 'trim';
      }
      out.set(r, { role, spec: role === 'paint' ? paint : role === 'paint2' ? paint2 || paint : VEH[role] });
    }
    return out;
  },
  furniture(o, R) {
    const out = new Map();
    const nm = o.names.join(' ').toLowerCase();
    const z0 = o.box.min.z, H = Math.max(1, o.size.z), L = Math.max(o.size.x, o.size.y);
    const sofa = /sofa|couch/.test(nm) || (!/meja|table|desk|lemari|cabinet|bed|kasur|ranjang|chair|kursi/.test(nm) && L > 1400 && H < 1050 && H > 600 && o.meshy);
    const bed = /bed|kasur|ranjang/.test(nm) || (L >= 1800 && Math.min(o.size.x, o.size.y) >= 850 && H < 1400 && !sofa && !/meja|table/.test(nm));
    const table = /meja|table|desk/.test(nm);
    const cabinet = /lemari|cabinet|wardrobe|cupboard|rak|shelf|bookcase|nakas|drawer/.test(nm);
    const fabric = S('Kain ' + (sofa ? 'Sofa' : 'Jok'), pick(R, FABRICS), 'fabric', 300);
    const wood = pick(R, [FURN.wood, FURN.woodDark, FURN.woodLight]);
    // legs: thin parts near the floor
    const legZ = z0 + Math.min(H * 0.35, 450);
    const coverLow = coverage(o, 0.03, Math.min(0.3, 400 / H));
    for (const r of o.faces) {
      const zr = (r.c.z - z0) / H; let role = 'wood', spec = wood;
      const legsy = coverLow < 0.3 && r.c.z < legZ && r.area < 0.15e6;
      if (bed) { if (zr > 0.25 && zr < 0.62 && !(r.vertical && r.h > H * 0.5)) { role = 'mattress'; spec = r.n.z > 0.9 && zr > 0.5 ? FURN.mattress : FURN.mattress; } else if (zr >= 0.55 && r.area < 0.4e6 && !r.vertical) { role = 'pillow'; spec = FURN.pillow; } }
      else if (sofa) { if (legsy || zr < 0.08) { role = 'leg'; spec = FURN.woodDark; } else { role = 'fabric'; spec = fabric; } }
      else if (table) { if (legsy) { role = 'leg'; spec = pick(R, [wood, FURN.metal]); } }
      else if (cabinet) { if (r.area < 4000 && !r.vertical) { role = 'handle'; spec = FURN.chrome; } }
      else if (legsy) { role = 'leg'; spec = wood; }
      out.set(r, { role, spec });
    }
    return out;
  },
  plant(o, R) {
    const out = new Map();
    const z0 = o.box.min.z, H = Math.max(1, o.size.z), c = o.box.getCenter(new THREE.Vector3());
    const R0 = Math.max(o.size.x, o.size.y) / 2 || 1;
    const nm = o.names.join(' ').toLowerCase();
    const flowery = /bunga|flower|bougenvil|kamboja|frangipani|mawar|rose/.test(nm);
    const fl = pick(R, PLANT.flower);
    for (const r of o.faces) {
      const zr = (r.c.z - z0) / H, rad = Math.hypot(r.c.x - c.x, r.c.y - c.y) / R0;
      let role = 'leaf', spec = R() < 0.5 ? PLANT.leaf : PLANT.leaf2;
      if (/pot/.test(nm) && zr < 0.25) { role = 'pot'; spec = PLANT.pot; }
      else if (zr < 0.45 && rad < 0.22) { role = 'bark'; spec = PLANT.bark; }
      else if (flowery && r.n.z > 0.3 && zr > 0.55 && R() < 0.45) { role = 'flower'; spec = fl; }
      out.set(r, { role, spec });
    }
    return out;
  },
  person(o, R) {
    const out = new Map();
    const z0 = o.box.min.z, H = Math.max(1, o.size.z), c = o.box.getCenter(new THREE.Vector3());
    const half = Math.max(o.size.x, o.size.y) / 2 || 1;
    const skin = S('Kulit', pick(R, SKIN), null, 1000, 1000, 1, { r: 0.6 }), hair = S('Rambut', '#1c1917', null, 1000, 1000, 1, { r: 0.5 });
    const shirt = S('Baju', pick(R, SHIRT), 'fabric', 200), pants = S('Celana', pick(R, PANTS), 'fabric', 200), shoes = S('Sepatu', pick(R, ['#1b1b1d', '#efefec', '#5a3b2a']), null, 1000, 1000, 1, { r: 0.45 });
    for (const r of o.faces) {
      const zr = (r.c.z - z0) / H, side = Math.hypot(r.c.x - c.x, r.c.y - c.y) / half;
      let role, spec;
      if (zr > 0.935 && r.n.z > -0.2) { role = 'hair'; spec = hair; }
      else if (zr > 0.83) { role = 'skin'; spec = skin; }
      else if (zr > 0.47) { if (side > 0.62 && zr < 0.62) { role = 'skin'; spec = skin; } else { role = 'shirt'; spec = shirt; } }
      else if (zr > 0.05) { role = 'pants'; spec = pants; }
      else { role = 'shoes'; spec = shoes; }
      out.set(r, { role, spec });
    }
    return out;
  },
  site(o) {
    const out = new Map();
    for (const r of o.faces) {
      if (r.n.z > 0.5 || r.n.z < -0.94) out.set(r, r.area > 4e6 && r.minExt > 1500 ? { role: 'ground', spec: COMMON.ground } : { role: 'paving', spec: COMMON.paving });
      else out.set(r, { role: 'curb', spec: COMMON.curb });
    }
    return out;
  },
  generic(o, R) {
    const out = new Map();
    const H = o.size.z, small = Math.max(o.size.x, o.size.y, H) < 1500;
    let main;
    if (o.meshy) main = H > 1500 ? GENERIC.stone : S('Keramik Glasir', pick(R, ['#f2f0ea', '#2f5f7a', '#b4472f', '#d9c7a1', '#3e5d3a']), null, 1000, 1000, 1, { r: 0.16 });
    else main = small ? GENERIC.wood : GENERIC.main[0];
    // separate parts (by face colour groups we cannot know) → main for big faces, accent for tiny details
    const acc = S('Aksen', pick(R, GENERIC.accent), null, 1000, 1000, 1, { r: 0.45 });
    const big = o.area / Math.max(1, o.faces.length);
    for (const r of o.faces) out.set(r, !o.meshy && r.area < big * 0.05 && o.faces.length > 12 ? { role: 'accent', spec: acc } : { role: 'main', spec: main });
    return out;
  },
};
function coverage(o, lo, hi) {
  // fraction of the footprint filled by geometry in a height band (legs → small)
  const z0 = o.box.min.z, H = o.size.z || 1, N = 24, g = new Uint8Array(N * N);
  const bx = o.box.min.x, by = o.box.min.y, sx = o.size.x || 1, sy = o.size.y || 1;
  for (const r of o.faces) for (const p of r.outer) {
    const t = (p.z - z0) / H; if (t < lo || t > hi) continue;
    g[Math.min(N - 1, Math.floor(((p.y - by) / sy) * N)) * N + Math.min(N - 1, Math.floor(((p.x - bx) / sx) * N))] = 1;
  }
  let n = 0; for (const x of g) n += x; return n / (N * N);
}
export { BUILDING, COMMON, VEH, PLANT, FURN };
