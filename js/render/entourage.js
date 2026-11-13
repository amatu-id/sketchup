// Procedural entourage for renders: trees, palms, shrubs, hedges, grass, people, cars, scooters,
// street furniture and neighbourhood buildings. All sizes in millimetres, Z up, models face +Y.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { rnd, leafCard, flowerCard, palmCard, barkSet, facadeCard, plateCard, towerCard } from './textures.js';
import { textureCanvas } from '../core/materials.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 0, 1);

// ---------------------------------------------------------------- materials (shared, cached)
const mats = new Map();
export function mat(key, make) { let m = mats.get(key); if (!m) { m = make(); mats.set(key, m); } return m; }
export function disposeEntourage() { for (const m of mats.values()) m.dispose(); mats.clear(); for (const g of geoCache.values()) for (const x of Object.values(g)) x?.dispose?.(); geoCache.clear(); }
const std = (key, o) => mat(key, () => new THREE.MeshStandardMaterial(o));
const phys = (key, o) => mat(key, () => new THREE.MeshPhysicalMaterial(o));
const geoCache = new Map();
// cached geometry is shared by every render: mark it so a scene rebuild does not dispose it
function markShared(x) { if (!x || typeof x !== 'object') return; if (x.isBufferGeometry) { x.userData.shared = true; return; } for (const v of Object.values(x)) if (v && typeof v === 'object' && !v.isMaterial) { if (v.isBufferGeometry) v.userData.shared = true; else if (Array.isArray(v)) v.forEach((p) => p?.geo && (p.geo.userData.shared = true)); } }
const cacheGeo = (key, make) => { let g = geoCache.get(key); if (!g) { g = make(); markShared(g); geoCache.set(key, g); } return g; };
function leafMat(kind, seed, flower) {
  const key = 'leaf:' + kind + seed + (flower || '');
  return mat(key, () => {
    const t = flower ? flowerCard(flower, seed).map : leafCard(kind, seed).map;
    return new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.78, metalness: 0, envMapIntensity: 0.7 });
  });
}
function barkMat(color = '#5b4632') { return mat('bark' + color, () => { const b = barkSet(color); const m = new THREE.MeshStandardMaterial({ map: b.map, normalMap: b.normalMap, roughness: 0.95 }); m.map.repeat.set(2, 3); m.normalMap.repeat.set(2, 3); return m; }); }

// ---------------------------------------------------------------- geometry helpers
// tube along points with per-point radius, uv: u around, v along (in metres)
export function taperTube(pts, radii, seg = 8) {
  const pos = [], nor = [], uv = [], idx = [];
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], t = (i < pts.length - 1 ? pts[i + 1].clone().sub(p) : p.clone().sub(pts[i - 1])).normalize();
    if (i) len += p.distanceTo(pts[i - 1]);
    const a = Math.abs(t.z) < 0.9 ? UP : V(1, 0, 0);
    const n1 = a.clone().cross(t).normalize(), n2 = t.clone().cross(n1).normalize();
    for (let k = 0; k <= seg; k++) {
      const an = (k / seg) * Math.PI * 2, d = n1.clone().multiplyScalar(Math.cos(an)).addScaledVector(n2, Math.sin(an));
      pos.push(p.x + d.x * radii[i], p.y + d.y * radii[i], p.z + d.z * radii[i]); nor.push(d.x, d.y, d.z); uv.push(k / seg, len / 1000);
    }
  }
  for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < seg; k++) { const a = i * (seg + 1) + k, b = a + seg + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}
function curvePts(a, b, bend, n = 6) {
  const out = []; for (let i = 0; i <= n; i++) { const t = i / n; const p = a.clone().lerp(b, t); p.addScaledVector(bend, Math.sin(t * Math.PI)); out.push(p); } return out;
}
// leaf cards: quads at given centres, normals bent away from the crown centre (volumetric shading)
function cards(list, centre, squash = 1) {
  const pos = [], nor = [], uv = [], idx = [];
  const q = new THREE.Quaternion();
  for (const c of list) {
    q.setFromEuler(new THREE.Euler(c.rx, c.ry, c.rz));
    const ux = V(1, 0, 0).applyQuaternion(q).multiplyScalar(c.s / 2), uy = V(0, 1, 0).applyQuaternion(q).multiplyScalar(c.s / 2);
    const n = c.p.clone().sub(centre); n.z /= squash; n.normalize(); const cn = ux.clone().cross(uy).normalize();
    const nn = n.clone().multiplyScalar(0.8).addScaledVector(cn, Math.sign(cn.dot(n) || 1) * 0.2).normalize();
    const b = pos.length / 3;
    for (const [sx, sy, u, v] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]) {
      const p = c.p.clone().addScaledVector(ux, sx).addScaledVector(uy, sy);
      pos.push(p.x, p.y, p.z); nor.push(nn.x, nn.y, nn.z); uv.push(u, v);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}
const randUnit = (R) => { const z = R() * 2 - 1, a = R() * Math.PI * 2, r = Math.sqrt(1 - z * z); return V(Math.cos(a) * r, Math.sin(a) * r, z); };
function std3(g) { if (!g.index) g = mergeVertices(g); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); if (!g.attributes.normal) g.computeVertexNormals(); return g; }
function merged(list) { const g = mergeGeometries(list.map((x) => { let y = x.index ? x : mergeVertices(x); for (const k of Object.keys(y.attributes)) if (!['position', 'normal', 'uv'].includes(k)) y.deleteAttribute(k); return std3(y); }), false); for (const x of list) x.dispose(); return g; }

// ---------------------------------------------------------------- trees
// variant → { parts: [{ geo, mat, shadow }] } built once and instanced by the site
export const TREES = {
  rindang: { label: 'Pohon rindang (trembesi)', H: 8500 },
  mangga: { label: 'Pohon mangga', H: 6500 },
  ketapang: { label: 'Ketapang kencana', H: 7000 },
  kelapa: { label: 'Kelapa', H: 9000 },
  palem: { label: 'Palem kuning', H: 3600 },
  cemara: { label: 'Cemara', H: 7500 },
  kamboja: { label: 'Kamboja', H: 3800 },
};
export function treeParts(kind, seed = 1) {
  return cacheGeo('tree:' + kind + seed, () => {
    const R = rnd(seed * 131 + kind.length * 7);
    switch (kind) {
      case 'kelapa': return palm(R, { H: 8000 + R() * 2500, fronds: 15, frondL: 4200, stems: 1, bend: 900 + R() * 900 });
      case 'palem': return palm(R, { H: 3200 + R() * 900, fronds: 7, frondL: 1700, stems: 5, bend: 250 });
      case 'cemara': return conifer(R, { H: 6500 + R() * 2500, r: 1400 + R() * 500 });
      case 'kamboja': return broadleaf(R, { H: 3600 + R() * 800, crownR: 2000, crownH: 1600, trunkH: 1100, trunkR: 130, limbs: 5, kind: 'frangi', flower: '#f7f3ea', cards: 120, cardS: 1000, spread: 1.25 });
      case 'ketapang': return broadleaf(R, { H: 7000 + R() * 1500, crownR: 2400, crownH: 4200, trunkH: 1900, trunkR: 140, limbs: 6, kind: 'small', cards: 380, cardS: 1100, tiers: true });
      case 'mangga': return broadleaf(R, { H: 6000 + R() * 1500, crownR: 3000, crownH: 3800, trunkH: 1700, trunkR: 190, limbs: 5, kind: 'dark', cards: 420, cardS: 1300 });
      default: return broadleaf(R, { H: 8000 + R() * 2500, crownR: 5200, crownH: 4300, trunkH: 2600, trunkR: 300, limbs: 6, kind: 'broad', cards: 640, cardS: 1600, spread: 1.15 });
    }
  });
}
function broadleaf(R, o) {
  const top = V((R() - 0.5) * 300, (R() - 0.5) * 300, o.trunkH);
  const wood = [taperTube(curvePts(V(), top, V((R() - 0.5) * 200, (R() - 0.5) * 200, 0), 6), [1.35, 1.1, 1, 0.95, 0.9, 0.85, 0.8].map((k) => k * o.trunkR), 10)];
  const cz = o.trunkH + o.crownH * 0.5, centre = V(top.x, top.y, cz);
  const tips = [];
  for (let i = 0; i < o.limbs; i++) {
    const a = (i / o.limbs) * Math.PI * 2 + R() * 0.8, sp = (o.spread || 1) * (0.55 + R() * 0.35);
    const dir = V(Math.cos(a) * sp, Math.sin(a) * sp, 0.55 + R() * 0.5).normalize();
    const L = Math.hypot(o.crownR * 0.75, o.crownH * 0.45) * (0.6 + R() * 0.3);
    const end = top.clone().addScaledVector(dir, L);
    end.z = Math.min(end.z, cz + o.crownH * 0.35);
    wood.push(taperTube(curvePts(top, end, V(0, 0, L * 0.12), 5), [0.55, 0.48, 0.4, 0.33, 0.26, 0.2].map((k) => k * o.trunkR), 7));
    for (let j = 0; j < 3; j++) {
      const from = top.clone().lerp(end, 0.45 + j * 0.25), d2 = dir.clone().add(randUnit(R).multiplyScalar(0.7)).normalize(); d2.z = Math.abs(d2.z) * 0.6 + 0.2;
      const e2 = from.clone().addScaledVector(d2.normalize(), L * (0.35 + R() * 0.25));
      wood.push(taperTube([from, from.clone().lerp(e2, 0.5).add(V(0, 0, 60)), e2], [0.2, 0.13, 0.06].map((k) => k * o.trunkR), 5));
      tips.push(e2);
    }
    tips.push(end);
  }
  // foliage: most cards around branch tips, the rest fill the crown shell
  const list = [];
  for (let i = 0; i < o.cards; i++) {
    let p;
    if (i < o.cards * 0.6) { const t = tips[i % tips.length]; p = t.clone().add(randUnit(R).multiplyScalar(o.cardS * (0.4 + R() * 0.8))); }
    else { const u = randUnit(R), r = 0.62 + Math.cbrt(R()) * 0.38; p = V(centre.x + u.x * o.crownR * r, centre.y + u.y * o.crownR * r, centre.z + u.z * o.crownH * 0.5 * r); }
    if (o.tiers) p.z = Math.round((p.z - o.trunkH) / 900) * 900 + o.trunkH + (R() - 0.5) * 300;
    if (p.z < o.trunkH * 0.95) p.z = o.trunkH * 0.95 + R() * 300;
    list.push({ p, s: o.cardS * (0.7 + R() * 0.6), rx: R() * Math.PI, ry: R() * Math.PI, rz: R() * Math.PI });
  }
  const leaves = cards(list, centre, o.crownH / (2 * o.crownR));
  const parts = [{ geo: merged(wood), mat: barkMat(o.kind === 'frangi' ? '#7a6a58' : '#5b4632'), key: 'wood' }, { geo: leaves, mat: leafMat(o.kind, 1), key: 'leaf', noAO: true }];
  if (o.flower) {
    const fl = []; for (let i = 0; i < 26; i++) { const t = tips[i % tips.length]; fl.push({ p: t.clone().add(randUnit(R).multiplyScalar(300)).add(V(0, 0, 200)), s: 650, rx: R() * 0.6, ry: R() * 0.6, rz: R() * 6 }); }
    parts.push({ geo: cards(fl, centre, 1), mat: leafMat('small', 3, o.flower), key: 'flower', noAO: true });
  }
  return { parts, H: o.trunkH + o.crownH, R: o.crownR };
}
function palm(R, o) {
  const parts = [], fr = [], trunks = [], nuts = [];
  for (let s = 0; s < o.stems; s++) {
    const a = R() * Math.PI * 2, off = o.stems > 1 ? 180 + R() * 220 : 0, H = o.H * (o.stems > 1 ? 0.65 + R() * 0.35 : 1);
    const base = V(Math.cos(a) * off, Math.sin(a) * off, 0), lean = V(Math.cos(a), Math.sin(a), 0).multiplyScalar(o.bend * (0.6 + R() * 0.8));
    const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(base.clone().addScaledVector(lean, t * t).add(V(0, 0, H * t))); }
    const r0 = o.stems > 1 ? 45 : 170;
    trunks.push(taperTube(pts, pts.map((_, i) => r0 * (1.25 - (i / 10) * 0.45)), o.stems > 1 ? 6 : 10));
    const crown = pts[10];
    const n = o.fronds + Math.floor(R() * 3);
    for (let k = 0; k < n; k++) {
      const az = (k / n) * Math.PI * 2 + R() * 0.3, up = 0.35 + R() * 0.75 - (k % 3) * 0.25, L = o.frondL * (0.75 + R() * 0.4);
      fr.push(frond(crown, az, up, L, L * 0.3, R));
    }
    if (o.stems === 1) for (let k = 0; k < 6; k++) { const g = new THREE.SphereGeometry(130, 10, 8); const a2 = R() * 6.28; g.translate(crown.x + Math.cos(a2) * 180, crown.y + Math.sin(a2) * 180, crown.z - 250 - R() * 150); nuts.push(g); }
  }
  parts.push({ geo: merged(trunks), mat: mat('palmtrunk', () => { const b = barkSet('#7d7266'); const m = new THREE.MeshStandardMaterial({ map: b.map, normalMap: b.normalMap, roughness: 0.95 }); return m; }), key: 'wood' });
  parts.push({ geo: merged(fr), mat: mat('frond' + (o.stems > 1 ? 'y' : ''), () => new THREE.MeshStandardMaterial({ map: palmCard(o.stems > 1 ? 2 : 1).map, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.75, color: o.stems > 1 ? new THREE.Color(1.08, 1.05, 0.8) : new THREE.Color(1, 1, 1) })), key: 'leaf', noAO: true });
  if (nuts.length) parts.push({ geo: merged(nuts), mat: std('nut', { color: '#5f6b2c', roughness: 0.7 }), key: 'nut' });
  return { parts, H: o.H, R: o.frondL * 0.8 };
}
function frond(base, az, up, L, W, R) {
  // a ribbon that rises then droops, leaflets texture along it
  const seg = 9, pos = [], nor = [], uv = [], idx = [];
  const dir = V(Math.cos(az), Math.sin(az), 0), side = V(-Math.sin(az), Math.cos(az), 0);
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, x = t * L, z = (up * t - (0.9 + R() * 0.05) * t * t) * L * 0.55;
    const c = base.clone().addScaledVector(dir, x).add(V(0, 0, z));
    const w = W * Math.sin(Math.min(1, t * 1.15 + 0.05) * Math.PI) * 0.5 + 30, droop = -t * W * 0.25;
    const tw = 0.25 + t * 0.35; // leaflets fold down along the frond
    const s1 = side.clone().multiplyScalar(w).add(V(0, 0, droop - w * tw)), s2 = side.clone().multiplyScalar(-w).add(V(0, 0, droop - w * tw));
    const a = c.clone().add(s1), b = c.clone().add(s2);
    pos.push(a.x, a.y, a.z, c.x, c.y, c.z + 20, b.x, b.y, b.z); for (let k = 0; k < 3; k++) nor.push(0, 0, 1);
    uv.push(1, t, 0.5, t, 0, t);
  }
  for (let i = 0; i < seg; i++) { const a = i * 3; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function conifer(R, o) {
  const wood = [taperTube([V(), V(0, 0, o.H * 0.5), V(0, 0, o.H)], [140, 90, 20], 8)];
  const list = [], centre = V(0, 0, o.H * 0.5);
  const layers = 14;
  for (let l = 0; l < layers; l++) {
    const t = l / layers, z = 900 + t * (o.H - 1100), r = o.r * (1 - t) * (0.85 + R() * 0.3) + 150;
    const n = Math.max(4, Math.round(26 * (1 - t) + 4));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + R(), rr = r * (0.4 + R() * 0.6);
      list.push({ p: V(Math.cos(a) * rr, Math.sin(a) * rr, z + (R() - 0.5) * 300), s: 700 + r * 0.35, rx: 1.2 + R() * 0.6, ry: R() * 0.5, rz: a });
    }
  }
  return { parts: [{ geo: merged(wood), mat: barkMat('#4e3d2e'), key: 'wood' }, { geo: cards(list, centre, 2.5), mat: leafMat('dark', 2), key: 'leaf', noAO: true }], H: o.H, R: o.r };
}

// ---------------------------------------------------------------- shrubs, hedges, flowers, grass
export function bushParts(kind = 'hijau', seed = 1) {
  return cacheGeo('bush:' + kind + seed, () => {
    const R = rnd(seed * 17 + kind.length), r = kind === 'kecil' ? 380 : 650 + R() * 250, h = r * (kind === 'tinggi' ? 2.2 : 1.25);
    const list = [], centre = V(0, 0, h * 0.5);
    const n = kind === 'kecil' ? 40 : 90;
    for (let i = 0; i < n; i++) { const u = randUnit(R), k = 0.55 + R() * 0.45; list.push({ p: V(u.x * r * k, u.y * r * k, Math.max(120, h * 0.5 + u.z * h * 0.5 * k)), s: r * 0.85, rx: R() * 3, ry: R() * 3, rz: R() * 3 }); }
    const flower = { bugenvil: '#d6378a', soka: '#d9302b', alamanda: '#f0c419', melati: '#f6f3ea' }[kind];
    const core = new THREE.SphereGeometry(r * 0.62, 12, 8); core.scale(1, 1, h / (r * 2) * 1.4); core.translate(0, 0, h * 0.45);
    const parts = [
      { geo: std3(core), mat: std('bushcore', { color: '#24401a', roughness: 1 }), key: 'core' },
      { geo: cards(list, centre, h / (2 * r)), mat: leafMat(flower ? 'small' : kind === 'tinggi' ? 'dark' : 'hedge', 1, flower), key: 'leaf', noAO: true },
    ];
    return { parts, H: h, R: r };
  });
}
// a 1 m hedge segment (instanced along fences), height H
export function hedgeParts(H = 1000, D = 550) {
  return cacheGeo('hedge:' + H + D, () => {
    const R = rnd(H + D), list = [], c = V(0, 0, H / 2);
    for (let i = 0; i < 60; i++) {
      const f = Math.floor(R() * 5); let p;
      if (f === 0) p = V((R() - 0.5) * 1000, (R() - 0.5) * D, H - 40);
      else if (f < 3) p = V((R() - 0.5) * 1000, (f === 1 ? 1 : -1) * D / 2, 150 + R() * (H - 200));
      else p = V((R() - 0.5) * 1000, (R() - 0.5) * D * 0.8, 150 + R() * (H - 200));
      list.push({ p, s: 520, rx: f === 0 ? Math.PI / 2 + (R() - 0.5) : (R() - 0.5) * 0.8, ry: (R() - 0.5) * 0.8, rz: f === 0 ? R() * 6 : f < 3 ? 0 : R() * 6 });
    }
    const core = new THREE.BoxGeometry(1000, D * 0.85, H * 0.92); core.translate(0, 0, H * 0.46);
    return { parts: [{ geo: std3(core), mat: mat('hedgecore', () => new THREE.MeshStandardMaterial({ map: leafCard('hedge', 3).map, color: '#6f8f5f', roughness: 1 })), key: 'core' }, { geo: cards(list, c, 0.8), mat: leafMat('hedge', 2), key: 'leaf', noAO: true }], H, R: 500 };
  });
}
export function flowerBedParts(color = '#d6378a', seed = 1) {
  return cacheGeo('bed:' + color + seed, () => {
    const R = rnd(seed * 3 + 11), list = [];
    for (let i = 0; i < 26; i++) list.push({ p: V((R() - 0.5) * 900, (R() - 0.5) * 900, 120 + R() * 220), s: 380, rx: 1.2 + R() * 0.6, ry: R() * 0.5, rz: R() * 6 });
    return { parts: [{ geo: cards(list, V(0, 0, -400), 1), mat: leafMat('small', 4, color), key: 'leaf', noAO: true }], H: 350, R: 500 };
  });
}
export function grassTuft() {
  return cacheGeo('tuft', () => {
    const R = rnd(77), pos = [], nor = [], col = [], idx = [];
    for (let b = 0; b < 5; b++) {
      const a = R() * Math.PI * 2, h = 55 + R() * 75, w = 5 + R() * 3, lean = 12 + R() * 28, ox = (R() - 0.5) * 50, oy = (R() - 0.5) * 50;
      const d = V(Math.cos(a), Math.sin(a), 0), s = V(-Math.sin(a), Math.cos(a), 0), base = pos.length / 3;
      for (let k = 0; k <= 3; k++) {
        const t = k / 3, ww = w * (1 - t * 0.85), c = V(ox, oy, 0).addScaledVector(d, lean * t * t).add(V(0, 0, h * t));
        for (const sg of [-1, 1]) { const p = c.clone().addScaledVector(s, ww * sg); pos.push(p.x, p.y, p.z); nor.push(d.x * 0.3, d.y * 0.3, 0.95); const g = 0.45 + t * 0.55; col.push(g, g, g); }
      }
      for (let k = 0; k < 3; k++) { const i = base + k * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
    return g;
  });
}
export function grassMat() { return mat('grassblade', () => new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })); }
export function spikyParts(seed = 1) {
  // pandan bali / agave style rosette
  return cacheGeo('spiky:' + seed, () => {
    const R = rnd(seed + 40), list = [];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + R() * 0.4, up = 0.6 + R() * 0.9, L = 700 + R() * 500;
      list.push(frondBlade(a, up, L, 55));
    }
    return { parts: [{ geo: merged(list), mat: std('spiky', { color: '#4f7d36', roughness: 0.6, side: THREE.DoubleSide }), key: 'leaf' }], H: 900, R: 700 };
  });
}
function frondBlade(az, up, L, W) {
  const pos = [], idx = [], seg = 6, d = V(Math.cos(az), Math.sin(az), 0), s = V(-Math.sin(az), Math.cos(az), 0);
  for (let i = 0; i <= seg; i++) { const t = i / seg, c = d.clone().multiplyScalar(t * L * 0.6).add(V(0, 0, (up * t - 0.5 * t * t) * L)); const w = W * (1 - t); for (const sg of [-1, 1]) { const p = c.clone().addScaledVector(s, w * sg); pos.push(p.x, p.y, p.z); } }
  for (let i = 0; i < seg; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}

// ---------------------------------------------------------------- people
const SKIN = ['#e6bf9c', '#d2a27b', '#bb8761', '#9a6644', '#7d5236'];
const HAIR = ['#151210', '#1f1814', '#2b1f17', '#3a2a1c', '#5a4030'];
const TOPS = ['#f3f3f1', '#1e2c4d', '#1b1b1d', '#a12e2e', '#6e7378', '#2f6f63', '#d0912f', '#5b4fa6', '#7e9cc7', '#d9d2c3', '#3f5e3a', '#c2577a'];
const BOTTOMS = ['#2c4670', '#1b1c1f', '#8b7a5e', '#4a4f56', '#2e3a52', '#6b5b4a', '#d8d1c2'];
const HIJAB = ['#d8c3b5', '#2f3b55', '#9a3f57', '#e9e2d4', '#4b6b67', '#7b5e8f', '#c79a5c'];
export function makePerson(seed = 1, pose = 'stand') {
  const R = rnd(seed * 7919 + 3), female = R() < 0.48, H = female ? 1560 + R() * 120 : 1640 + R() * 140, k = H / 1700;
  const skinC = SKIN[Math.floor(R() * SKIN.length)], skin = std('skin' + skinC, { color: skinC, roughness: 0.62 });
  const hairC = HAIR[Math.floor(R() * HAIR.length)], top = TOPS[Math.floor(R() * TOPS.length)], bottom = BOTTOMS[Math.floor(R() * BOTTOMS.length)];
  const hijab = female && R() < 0.45, dress = female && !hijab && R() < 0.35, longSkirt = hijab && R() < 0.6;
  const parts = { skin: [], hair: [], top: [], bottom: [], shoe: [] };
  const walk = pose === 'walk' ? 1 : 0, sw = walk ? 0.32 + R() * 0.12 : 0, ph = R() < 0.5 ? 1 : -1;
  // torso
  const tp = [[0, 900], [152, 905], [160, 960], [146, 1060], [160, 1180], [176, 1290], [168, 1370], [120, 1420], [55, 1450], [0, 1455]].map(([r, z]) => new THREE.Vector2(r * (female ? 0.94 : 1), z));
  const torso = new THREE.LatheGeometry(tp, 18); torso.rotateX(Math.PI / 2); torso.scale(1, 0.62, 1); parts.top.push(torso);
  if (female) { const b = new THREE.SphereGeometry(62, 10, 8); b.scale(1.3, 0.9, 0.85); b.translate(0, -78, 1270); parts.top.push(b); }
  // hips
  const hp = [[0, 780], [150, 790], [168, 860], [160, 930], [0, 935]].map(([r, z]) => new THREE.Vector2(r, z));
  const hips = new THREE.LatheGeometry(hp, 16); hips.rotateX(Math.PI / 2); hips.scale(1, 0.68, 1); parts.bottom.push(hips);
  // legs
  for (const s of [-1, 1]) {
    const a = sw * s * ph, hip = V(s * 88, 0, 860), knee = hip.clone().add(V(0, Math.sin(a) * 420, -Math.cos(a) * 420));
    const shin = a < 0 && walk ? a * 0.2 - 0.35 : a; const ankle = knee.clone().add(V(0, Math.sin(shin) * 400, -Math.cos(shin) * 400));
    const lift = Math.min(0, ankle.z - 70); ankle.z -= lift; knee.z -= lift * 0.5;
    parts.bottom.push(limb(hip, knee, 76, 58), limb(knee, ankle, 56, 42));
    const shoe = new RoundedBoxGeometry(105, 255, 85, 2, 30); shoe.translate(ankle.x, ankle.y - 70, Math.max(42, ankle.z - 40)); parts.shoe.push(shoe);
  }
  if (dress || longSkirt) {
    const sk = [[0, longSkirt ? 90 : 430], [longSkirt ? 230 : 210, longSkirt ? 100 : 440], [175, 900], [150, 1000], [0, 1005]].map(([r, z]) => new THREE.Vector2(r, z));
    const g = new THREE.LatheGeometry(sk, 18); g.rotateX(Math.PI / 2); g.scale(1, 0.8, 1); (dress ? parts.top : parts.bottom).push(g);
  }
  // arms
  for (const s of [-1, 1]) {
    const a = -sw * s * ph * 0.9, sh = V(s * 182, 0, 1385), el = sh.clone().add(V(s * 25, Math.sin(a) * 300, -Math.cos(a) * 300));
    const fa = a + (walk ? 0.25 : 0.1), wr = el.clone().add(V(s * 10, Math.sin(fa) * 270, -Math.cos(fa) * 270));
    const sleeve = R() < 0.5 && !hijab;
    parts.top.push(limb(sh, sleeve ? sh.clone().lerp(el, 0.55) : el, 52, 46));
    if (sleeve) parts.skin.push(limb(sh.clone().lerp(el, 0.5), el, 44, 40));
    (hijab ? parts.top : sleeve ? parts.skin : parts.top).push(limb(el, wr, 40, 34));
    const hand = new THREE.SphereGeometry(44, 10, 8); hand.scale(0.8, 0.6, 1.15); hand.translate(wr.x, wr.y, wr.z - 50); parts.skin.push(hand);
  }
  // neck + head
  const neck = new THREE.CylinderGeometry(46, 52, 110, 12); neck.rotateX(Math.PI / 2); neck.translate(0, 0, 1475); parts.skin.push(neck);
  const head = new THREE.SphereGeometry(102, 20, 16); head.scale(0.88, 0.98, 1.12); head.translate(0, 8, 1595); parts.skin.push(head);
  const nose = new THREE.SphereGeometry(18, 8, 6); nose.scale(0.8, 1, 1.2); nose.translate(0, -92, 1585); parts.skin.push(nose);
  if (hijab) {
    // open at the face (−Y): sphere phi = π/2 ends up at −Y after the rotation
    const hj = new THREE.SphereGeometry(118, 20, 16, Math.PI / 2 + 0.6, Math.PI * 2 - 1.2, 0, Math.PI * 0.8); hj.rotateX(Math.PI / 2); hj.scale(0.92, 1.02, 1.12); hj.translate(0, 18, 1600);
    const drape = new THREE.LatheGeometry([[0, 1330], [230, 1335], [180, 1420], [110, 1500], [0, 1505]].map(([r, z]) => new THREE.Vector2(r, z)), 18); drape.rotateX(Math.PI / 2); drape.scale(1, 0.7, 1);
    const hjm = std('hijab' + HIJAB[seed % HIJAB.length], { color: HIJAB[seed % HIJAB.length], roughness: 0.85 });
    parts.hijab = { geos: [hj, drape], mat: hjm };
  } else {
    const long = female && R() < 0.7;
    const hr = new THREE.SphereGeometry(108, 18, 12, 0, Math.PI * 2, 0, Math.PI * (long ? 0.62 : 0.5)); hr.rotateX(Math.PI / 2);
    hr.scale(0.92, 1.02, 1.14); hr.translate(0, 18, 1612); parts.hair.push(hr);
    if (long) { const back = new RoundedBoxGeometry(190, 70, 300, 2, 30); back.translate(0, 60, 1450); parts.hair.push(back); }
  }
  const g = new THREE.Group();
  const add = (list, m) => { if (!list.length) return; const mesh = new THREE.Mesh(merged(list), m); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); };
  add(parts.skin, skin); add(parts.hair, std('hair' + hairC, { color: hairC, roughness: 0.55 }));
  add(parts.top, std('top' + top, { color: top, roughness: 0.85 })); add(parts.bottom, std('bot' + bottom, { color: bottom, roughness: 0.85 }));
  add(parts.shoe, std('shoe' + (seed % 3), { color: ['#1b1b1d', '#efefec', '#5a3b2a'][seed % 3], roughness: 0.5 }));
  if (parts.hijab) add(parts.hijab.geos, parts.hijab.mat);
  g.scale.setScalar(k);
  g.userData.radius = 300;
  return g;
}
function limb(a, b, r0, r1) {
  const d = b.clone().sub(a), L = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, L, 10, 1, false); g.translate(0, L / 2, 0);
  const cap = new THREE.SphereGeometry(r0, 10, 6); const g2 = mergeGeometries([g.toNonIndexed(), cap.toNonIndexed()]);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize());
  g2.applyQuaternion(q); g2.translate(a.x, a.y, a.z);
  g.dispose(); cap.dispose();
  return g2;
}

// ---------------------------------------------------------------- cars
export const CAR_TYPES = {
  sedan: { L: 4550, W: 1760, H: 1450, wr: 315, clr: 150, belt: 0.64, hood: 0.6, roofF: 0.52, roofR: 0.24, ws: 0.69, rearW: 0.12, rear: 'sedan' },
  hatch: { L: 3950, W: 1700, H: 1520, wr: 300, clr: 160, belt: 0.6, hood: 0.58, roofF: 0.58, roofR: 0.1, ws: 0.73, rear: 'hatch' },
  mpv: { L: 4420, W: 1740, H: 1700, wr: 315, clr: 190, belt: 0.56, hood: 0.52, roofF: 0.66, roofR: 0.05, ws: 0.8, rear: 'hatch' },
  suv: { L: 4720, W: 1860, H: 1780, wr: 370, clr: 210, belt: 0.58, hood: 0.6, roofF: 0.62, roofR: 0.06, ws: 0.76, rear: 'hatch' },
  van: { L: 4700, W: 1700, H: 1980, wr: 300, clr: 180, belt: 0.5, hood: 0.42, roofF: 0.84, roofR: 0.03, ws: 0.9, rear: 'hatch' },
};
const CAR_PAINT = [['#eef0f1', 0, 30], ['#b8bdc2', 1, 18], ['#141619', 1, 17], ['#55595e', 1, 13], ['#a3161c', 1, 8], ['#1d3561', 1, 6], ['#6b5443', 1, 3], ['#2c4a3a', 1, 3], ['#e0b21c', 0, 2]];
export function makeCar(type = 'sedan', seed = 1) {
  const R = rnd(seed * 31 + type.length), T = CAR_TYPES[type] || CAR_TYPES.sedan;
  let x = R() * 100, pc = CAR_PAINT[0]; for (const c of CAR_PAINT) { x -= c[2]; if (x <= 0) { pc = c; break; } }
  const paint = phys('paint' + pc[0], { color: pc[0], metalness: pc[1] ? 0.6 : 0.05, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.04 });
  const geo = cacheGeo('car:' + type, () => carGeometry(T));
  const g = new THREE.Group();
  const add = (gg, m) => { const mesh = new THREE.Mesh(gg, m); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); };
  add(geo.body, paint);
  add(geo.glass, phys('carglass2', { color: '#05070a', metalness: 0, roughness: 0.06, envMapIntensity: 1.0 }));
  add(geo.tire, std('tire', { color: '#151515', roughness: 0.88 }));
  add(geo.rim, std('rim', { color: '#b9bec4', metalness: 1, roughness: 0.25 }));
  add(geo.trim, std('trim', { color: '#1c1d20', roughness: 0.55 }));
  add(geo.head, std('headl', { color: '#e9eef2', emissive: '#fff4e0', emissiveIntensity: 0.4, roughness: 0.08, metalness: 0.2 }));
  add(geo.tail, std('taill', { color: '#8e1015', emissive: '#ff2010', emissiveIntensity: 0.25, roughness: 0.15 }));
  const plateTxt = `${['B', 'D', 'L', 'AB', 'F', 'N', 'H'][Math.floor(R() * 7)]} ${1000 + Math.floor(R() * 8999)} ${String.fromCharCode(65 + Math.floor(R() * 26), 65 + Math.floor(R() * 26), 65 + Math.floor(R() * 26))}`;
  add(geo.plate, mat('plate' + plateTxt, () => new THREE.MeshStandardMaterial({ map: plateCard(plateTxt).map, roughness: 0.4 })));
  g.userData.radius = Math.hypot(T.L, T.W) / 2; g.userData.L = T.L; g.userData.W = T.W;
  return g;
}
function carGeometry(T) {
  const { L, W, H, wr, clr } = T;
  const belt = H * T.belt, hood = H * T.hood, xr1 = L * T.roofF, xr0 = L * T.roofR, xw = L * T.ws;
  const wf = L - L * 0.18, wb = L * 0.2; // wheel centres
  const s = new THREE.Shape();
  const ar = wr + 55;
  s.moveTo(70, clr + 60);
  if (T.rear === 'sedan') { s.lineTo(0, clr + 300); s.quadraticCurveTo(-10, belt - 40, 90, belt - 10); s.lineTo(L * T.rearW, belt + 30); s.quadraticCurveTo(L * (T.roofR - 0.03), H - 30, xr0 + 120, H); }
  else { s.lineTo(0, clr + 300); s.lineTo(15, belt); s.quadraticCurveTo(30, H - 40, xr0 + 120, H); }
  s.lineTo(xr1 - 150, H); s.quadraticCurveTo(xr1 + 60, H - 15, xr1 + 120, H - 70);
  s.lineTo(xw, hood + 40); s.quadraticCurveTo(L * 0.86, hood + 10, L - 90, hood - 40); s.quadraticCurveTo(L + 15, hood - 70, L, hood - 230);
  s.lineTo(L - 10, clr + 230); s.quadraticCurveTo(L, clr + 40, L - 110, clr + 40);
  s.lineTo(wf + ar, clr + 40); s.absarc(wf, wr, ar, 0, Math.PI, false); s.lineTo(wf - ar, clr + 40);
  s.lineTo(wb + ar, clr + 40); s.absarc(wb, wr, ar, 0, Math.PI, false); s.lineTo(wb - ar, clr + 40);
  s.lineTo(70, clr + 40); s.lineTo(70, clr + 60);
  const bev = 45;
  let body = new THREE.ExtrudeGeometry(s, { depth: W - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: 28, bevelSegments: 3, curveSegments: 14 });
  body.rotateX(Math.PI / 2); body.translate(0, (W - 2 * bev) / 2, 0); // shape y → z, extrusion → −y … +y
  // tumblehome: the cabin leans in
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) { const z = p.getZ(i); if (z > belt) { const t = Math.min(1, (z - belt) / (H - belt)); p.setY(i, p.getY(i) * (1 - 0.09 * t * t)); } }
  body.deleteAttribute('normal'); body.deleteAttribute('uv');
  body = mergeVertices(body, 0.5); body = toCreasedNormals(body, Math.PI / 5);
  const halfW = W / 2;
  const sideY = (z) => { const t = z > belt ? Math.min(1, (z - belt) / (H - belt)) : 0; return halfW * (1 - 0.09 * t * t); };
  // side windows (two, split by the B pillar), windscreen, rear window
  const glass = [];
  const rearTopX = T.rear === 'sedan' ? xr0 + 140 : xr0 + 150, rearBotX = T.rear === 'sedan' ? L * T.rearW + 120 : 110;
  const bx = (xr0 + xr1) / 2 + L * 0.02;
  const winA = [[rearBotX + 90, belt + 45], [rearTopX + 40, H - 70], [bx - 50, H - 70], [bx - 50, belt + 45]];
  const winB = [[bx + 50, belt + 45], [bx + 50, H - 70], [xr1 - 80, H - 75], [xw - 180, belt + 60]];
  const seal = [];
  const grow = (poly, d) => { const cx = poly.reduce((a, q) => a + q[0], 0) / poly.length, cz = poly.reduce((a, q) => a + q[1], 0) / poly.length; return poly.map(([x, z]) => { const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) || 1; return [x + (dx / l) * d, z + (dz / l) * d]; }); };
  for (const sg of [-1, 1]) for (const w of [winA, winB]) { glass.push(sidePanel(w, (z) => sg * (sideY(z) + 7), sg)); seal.push(sidePanel(grow(w, 42), (z) => sg * (sideY(z) + 3), sg)); }
  glass.push(slopePanel([xw - 40, hood + 55], [xr1 + 90, H - 60], sideY, 115));
  glass.push(slopePanel(T.rear === 'sedan' ? [rearBotX + 40, belt + 50] : [35, belt + 40], [rearTopX, H - 40], sideY, 115));
  seal.push(slopePanel([xw - 10, hood + 35], [xr1 + 120, H - 35], sideY, 70, 4));
  seal.push(slopePanel(T.rear === 'sedan' ? [rearBotX + 15, belt + 30] : [22, belt + 20], [rearTopX + 30, H - 20], sideY, 70, 4));
  // wheels
  const tire = [], rim = [];
  const tp = [[wr * 0.66, -95], [wr * 0.93, -100], [wr, -78], [wr, 78], [wr * 0.93, 100], [wr * 0.66, 95]].map(([r, y]) => new THREE.Vector2(r, y));
  for (const x of [wb, wf]) for (const sg of [-1, 1]) {
    const t = new THREE.LatheGeometry(tp, 28); t.translate(x, 0, 0); t.rotateY(0); const yy = sg * (halfW - 115);
    const tt = t.clone(); tt.translate(0, yy, wr); tire.push(tt); t.dispose();
    const r = new THREE.CylinderGeometry(wr * 0.66, wr * 0.66, 150, 24); r.translate(x, yy - sg * 20, wr); rim.push(r);
    for (let k = 0; k < 5; k++) { const sp = new THREE.BoxGeometry(wr * 1.15, 18, 52); sp.rotateY((k / 5) * Math.PI); sp.translate(x, yy + sg * 62, wr); rim.push(sp); }
  }
  // trim: bumpers, grille, mirrors, sills, door seams, underbody
  const trim = [];
  const box = (w, d, h, x, y, z, rr = 20) => { const b = new RoundedBoxGeometry(w, d, h, 2, rr); b.translate(x, y, z); return b; };
  trim.push(box(160, W * 0.94, 220, L - 30, 0, clr + 150, 40), box(150, W * 0.94, 200, 40, 0, clr + 160, 40));
  trim.push(box(40, W * 0.42, 150, L - 5, 0, hood - 230, 15));
  for (const sg of [-1, 1]) { trim.push(box(160, 110, 90, xw - 90, sg * (halfW + 40), belt + 70, 25)); trim.push(box(wf - wb - 2 * ar, 30, 70, (wb + wf) / 2, sg * (halfW - 8), clr + 75, 10)); trim.push(box(6, 4, belt - clr - 160, bx, sg * (halfW + 1), (belt + clr + 120) / 2, 1)); }
  trim.push(box(wf - wb, W * 0.8, 120, (wb + wf) / 2, 0, clr + 40, 20));
  // lights + plates
  const head = [], tail = [], plate = [];
  for (const sg of [-1, 1]) { head.push(box(70, 330, 95, L - 25, sg * (halfW - 260), hood - 150, 25)); tail.push(box(60, 300, 110, 12, sg * (halfW - 220), belt - 120, 25)); }
  // plate text reads left→right for someone facing it: front plate normal +X, rear −X
  const pl = (x, ry) => { const q = new THREE.PlaneGeometry(400, 110); q.rotateX(Math.PI / 2); q.rotateZ(Math.PI / 2 + ry); q.translate(x, 0, clr + 250); return q; };
  plate.push(pl(L + 18, 0), pl(-18, Math.PI));
  trim.push(...seal);
  return { body, glass: merged(glass), tire: merged(tire), rim: merged(rim), trim: merged(trim), head: merged(head), tail: merged(tail), plate: merged(plate) };
}
function sidePanel(poly, yOf, sg) {
  const pts = poly.map(([x, z]) => new THREE.Vector2(x, z));
  const tri = THREE.ShapeUtils.triangulateShape(pts, []);
  const pos = [], idx = [];
  for (const [x, z] of poly) pos.push(x, yOf(z), z);
  for (const t of tri) idx.push(...(sg > 0 ? t : [t[0], t[2], t[1]]));
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  if (g.attributes.normal.getY(0) * sg < 0) { g.setIndex(idx.map((_, i) => idx[i - (i % 3) + [0, 2, 1][i % 3]])); g.computeVertexNormals(); }
  return g;
}
function slopePanel(a, b, sideY, inset, lift = 8) {
  const pos = [], idx = [0, 1, 2, 0, 2, 3];
  const [x0, z0] = a, [x1, z1] = b, y0 = sideY(z0) - inset, y1 = sideY(z1) - inset;
  const dx = x1 - x0, dz = z1 - z0;
  const n = V(dz, 0, -dx).normalize(); if (n.z < 0) n.negate();
  const P = (x, y, z) => { pos.push(x + n.x * lift, y, z + n.z * lift); };
  P(x0, -y0, z0); P(x0, y0, z0); P(x1, y1, z1); P(x1, -y1, z1);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  if (g.attributes.normal.getZ(0) < 0) { g.setIndex([0, 2, 1, 0, 3, 2]); g.computeVertexNormals(); }
  return g;
}
export function makeScooter(seed = 1) {
  const R = rnd(seed * 5 + 2), col = ['#c62828', '#1b1c1f', '#eeeeea', '#1565c0', '#6d6f72'][Math.floor(R() * 5)];
  const body = phys('scoot' + col, { color: col, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 });
  const g = new THREE.Group(), list = [], dark = [], tires = [];
  const b = (w, d, h, x, y, z, r = 30) => { const q = new RoundedBoxGeometry(w, d, h, 2, r); q.translate(x, y, z); return q; };
  list.push(b(260, 1100, 300, 0, 0, 480, 80), b(240, 300, 600, 0, 520, 650, 60), b(320, 520, 120, 0, -260, 760, 50));
  dark.push(b(300, 560, 70, 0, -250, 840, 30), b(560, 50, 40, 0, 600, 1050, 15), b(60, 60, 600, 0, 620, 760, 20));
  for (const y of [-520, 560]) { const t = new THREE.TorusGeometry(220, 55, 10, 24); t.rotateY(Math.PI / 2); t.translate(0, y, 225); tires.push(t); }
  for (const [gg, m] of [[merged(list), body], [merged(dark), std('trim', { color: '#1c1d20', roughness: 0.55 })], [merged(tires), std('tire', { color: '#151515', roughness: 0.88 })]]) { const mesh = new THREE.Mesh(gg, m); mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); }
  g.userData.radius = 700;
  return g;
}
export function makeBus(seed = 1) {
  const R = rnd(seed + 99), L = 11000, W = 2480, H = 3150, lv = ['#c62828', '#1565c0', '#2e7d32', '#f9a825', '#6a1b9a', '#ef6c00'][Math.floor(R() * 6)];
  const g = new THREE.Group();
  const body = new RoundedBoxGeometry(L, W, H - 450, 4, 180); body.translate(L / 2, 0, 450 + (H - 450) / 2);
  const stripe = new RoundedBoxGeometry(L - 200, W + 10, 420, 2, 60); stripe.translate(L / 2, 0, 900);
  const glass = new RoundedBoxGeometry(L - 600, W + 16, 1050, 2, 60); glass.translate(L / 2 + 100, 0, 2350);
  const ws = new THREE.BoxGeometry(40, W - 200, 1300); ws.translate(L + 6, 0, 2200);
  const tires = [];
  for (const x of [2300, 8600]) for (const sg of [-1, 1]) { const t = new THREE.CylinderGeometry(500, 500, 300, 24); t.translate(x, sg * (W / 2 - 160), 500); tires.push(t); }
  const add = (gg, m) => { const mesh = new THREE.Mesh(gg, m); mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); };
  add(body, phys('buswhite', { color: '#f1f1ee', roughness: 0.3, clearcoat: 1 })); add(stripe, phys('bus' + lv, { color: lv, roughness: 0.3, clearcoat: 1 }));
  add(merged([glass, ws]), phys('carglass', { color: '#0b0f12', roughness: 0.03, clearcoat: 1 })); add(merged(tires), std('tire', { color: '#151515', roughness: 0.88 }));
  g.userData.radius = L / 2; g.userData.L = L; g.userData.W = W;
  return g;
}

// ---------------------------------------------------------------- street furniture
export function streetLamp() {
  return cacheGeo('lamp', () => {
    const pole = taperTube([V(), V(0, 0, 3500), V(0, 0, 6800), V(0, 350, 7350), V(0, 1300, 7450)], [85, 70, 58, 50, 45], 10);
    const head = new RoundedBoxGeometry(260, 620, 110, 2, 40); head.translate(0, 1500, 7400);
    const base = new THREE.CylinderGeometry(150, 170, 500, 16); base.rotateX(Math.PI / 2); base.translate(0, 0, 250);
    const lens = new THREE.PlaneGeometry(200, 520); lens.rotateX(Math.PI); lens.translate(0, 1500, 7342);
    return { parts: [{ geo: merged([pole, head, base]), mat: std('lampmetal', { color: '#3a3e44', metalness: 0.6, roughness: 0.45 }), key: 'pole' }, { geo: std3(lens), mat: std('lamplens', { color: '#fffaf0', emissive: '#fff3d6', emissiveIntensity: 0.2, roughness: 0.2 }), key: 'lens' }], H: 7500, R: 300 };
  });
}
export function benchParts() {
  return cacheGeo('bench', () => {
    const wood = [], metal = [];
    for (let i = 0; i < 4; i++) { const b = new RoundedBoxGeometry(1800, 90, 35, 1, 8); b.translate(0, -180 + i * 110, 440); wood.push(b); }
    for (let i = 0; i < 2; i++) { const b = new RoundedBoxGeometry(1800, 35, 90, 1, 8); b.translate(0, 230, 620 + i * 140); wood.push(b); }
    for (const x of [-750, 750]) { const l = new THREE.BoxGeometry(50, 480, 50); l.translate(x, 0, 400); metal.push(l); const a = new THREE.BoxGeometry(50, 50, 440); a.translate(x, -200, 220); metal.push(a); const c = new THREE.BoxGeometry(50, 50, 820); c.translate(x, 220, 410); metal.push(c); }
    return { parts: [{ geo: merged(wood), mat: mat('benchwood', () => new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(textureCanvas('wood', '#9b6a3c', 256)), roughness: 0.6 })), key: 'wood' }, { geo: merged(metal), mat: std('lampmetal', { color: '#3a3e44', metalness: 0.6, roughness: 0.45 }), key: 'metal' }], H: 900, R: 950 };
  });
}
export function binParts() {
  return cacheGeo('bin', () => {
    const c = new THREE.CylinderGeometry(260, 230, 900, 18, 1, true); c.rotateX(Math.PI / 2); c.translate(0, 0, 450);
    const t = new THREE.TorusGeometry(260, 25, 8, 18); t.translate(0, 0, 900);
    return { parts: [{ geo: merged([c, t]), mat: std('bin', { color: '#2f5f3f', metalness: 0.3, roughness: 0.5, side: THREE.DoubleSide }), key: 'bin' }], H: 900, R: 300 };
  });
}
export function bollardParts() {
  return cacheGeo('bollard', () => { const c = new THREE.CylinderGeometry(90, 100, 800, 14); c.rotateX(Math.PI / 2); c.translate(0, 0, 400); return { parts: [{ geo: std3(c), mat: std('bollard', { color: '#4a4d52', metalness: 0.5, roughness: 0.4 }), key: 'b' }], H: 800, R: 120 }; });
}

// ---------------------------------------------------------------- neighbourhood buildings
const WALLS = ['#ece6d8', '#f2efe8', '#e7dcc4', '#dfe3e0', '#efe4cf', '#d9d4c8', '#e6ded0', '#cfd8d3'];
const ROOFS = [['#9e4b2e', 'roof'], ['#7d3a28', 'roof'], ['#4a4d52', 'shingle'], ['#5b5f63', 'metal'], ['#8c3b26', 'roof']];
export function makeHouse(seed = 1, o = {}) {
  const R = rnd(seed * 211 + 5);
  const w = o.w || 7500 + R() * 4500, d = o.d || 9000 + R() * 4000, floors = o.floors || (R() < 0.4 ? 2 : 1), fh = 3200, H = floors * fh + 450;
  const wall = WALLS[Math.floor(R() * WALLS.length)], [rc, rk] = ROOFS[Math.floor(R() * ROOFS.length)];
  const g = new THREE.Group();
  const front = facadeCard({ wall, floors, bays: Math.max(2, Math.round(w / 2800)), door: true, seed, frame: R() < 0.5 ? '#3a2a20' : '#26282b' });
  const side = facadeCard({ wall, floors, bays: Math.max(2, Math.round(d / 3500)), door: false, seed: seed + 1, frame: '#3a2a20' });
  const mk = (tex) => new THREE.MeshStandardMaterial({ map: tex.map, roughness: 0.88 });
  const mf = mat('hf' + seed, () => mk(front)), ms = mat('hs' + seed, () => mk(side)), plain = std('hw' + wall, { color: wall, roughness: 0.9 });
  const box = new THREE.BoxGeometry(w, d, H - 450);
  // BoxGeometry groups: +x, −x, +y, −y, +z, −z → front faces −y
  const walls = new THREE.Mesh(box, [ms, ms, ms, mf, plain, plain]); walls.position.set(0, 0, 450 + (H - 450) / 2);
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(w + 120, d + 120, 450), std('plinth', { color: '#8d8a83', roughness: 0.9 })); plinth.position.z = 225;
  g.add(walls, plinth);
  // gable or hip roof with eaves
  const ov = 650, rh = Math.min(w, d) * 0.32, hip = R() < 0.5;
  const rw = w / 2 + ov, rd = d / 2 + ov, z0 = H;
  const roofTex = mat('rooft' + rc + rk, () => { const t = new THREE.CanvasTexture(textureCanvas(rk, rc, 512)); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(6, 6); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.75, side: THREE.DoubleSide }); });
  const pts = hip ? [[-rw, -rd, z0], [rw, -rd, z0], [rw, rd, z0], [-rw, rd, z0], [-rw * 0.35, 0, z0 + rh], [rw * 0.35, 0, z0 + rh]] : [[-rw, -rd, z0], [rw, -rd, z0], [rw, rd, z0], [-rw, rd, z0], [-rw, 0, z0 + rh], [rw, 0, z0 + rh]];
  const tris = hip ? [[0, 1, 5], [0, 5, 4], [2, 3, 4], [2, 4, 5], [1, 2, 5], [3, 0, 4]] : [[0, 1, 5], [0, 5, 4], [2, 3, 4], [2, 4, 5]];
  const rp = [], ruv = [];
  for (const t of tris) for (const i of t) { const p = pts[i]; rp.push(...p); ruv.push(p[0] / 3000, (p[1] + p[2]) / 3000); }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2)); rg.computeVertexNormals();
  const roof = new THREE.Mesh(rg, roofTex); g.add(roof);
  if (!hip) { const gp = [[-w / 2, -d / 2 + 1, H], [-w / 2, d / 2 - 1, H], [-w / 2, 0, H + rh - 40]]; const gg = new THREE.BufferGeometry(); const pp = [...gp.flat(), ...gp.map(([x, y, z]) => [-x, y, z]).reverse().flat()]; gg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3)); gg.computeVertexNormals(); g.add(new THREE.Mesh(gg, std('gable' + wall, { color: wall, roughness: 0.9, side: THREE.DoubleSide }))); }
  const fascia = new THREE.Mesh(new THREE.BoxGeometry(2 * rw, 2 * rd, 160), std('fascia', { color: '#4b3a2e', roughness: 0.7 })); fascia.position.z = z0 - 60; g.add(fascia);
  // porch canopy
  const porch = new THREE.Mesh(new THREE.BoxGeometry(w * 0.45, 1600, 120), std('fascia', { color: '#4b3a2e', roughness: 0.7 })); porch.position.set(0, -d / 2 - 800, 2900); g.add(porch);
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  g.userData = { w: w + 2 * ov, d: d + 2 * ov + 1600, H: H + rh };
  return g;
}
export function makeShopRow(seed = 1, units = 4) {
  const R = rnd(seed * 97 + 1), uw = 4500, floors = 2 + Math.floor(R() * 2), fh = 3600, w = uw * units, d = 14000, H = floors * fh;
  const wall = WALLS[Math.floor(R() * WALLS.length)];
  const front = facadeCard({ wall, floors, bays: units, shop: true, seed, frame: '#2a2c2f' });
  const g = new THREE.Group();
  const mf = mat('sf' + seed, () => new THREE.MeshStandardMaterial({ map: front.map, roughness: 0.8 })), plain = std('hw' + wall, { color: wall, roughness: 0.9 });
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, d, H), [plain, plain, plain, mf, plain, plain]); b.position.z = H / 2; g.add(b);
  const can = new THREE.Mesh(new THREE.BoxGeometry(w, 1400, 150), std('canopy', { color: '#5b6066', metalness: 0.4, roughness: 0.5 })); can.position.set(0, -d / 2 - 700, 3200); g.add(can);
  const par = new THREE.Mesh(new THREE.BoxGeometry(w, 300, 700), plain); par.position.set(0, -d / 2 + 150, H + 350); g.add(par);
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  g.userData = { w, d: d + 1400, H };
  return g;
}
export function makeTower(seed = 1) {
  const R = rnd(seed * 13 + 7), w = 18000 + R() * 22000, d = 16000 + R() * 16000, H = 35000 + R() * 110000;
  const tint = [[92, 112, 128], [120, 130, 138], [80, 98, 120], [140, 140, 132]][Math.floor(R() * 4)];
  const t = towerCard(seed, tint).map.clone(); t.needsUpdate = true; t.repeat.set(Math.max(1, Math.round(w / 9000)), Math.max(1, Math.round(H / 36000)));
  const m = mat('tower' + seed, () => new THREE.MeshStandardMaterial({ map: t, roughness: 0.35, metalness: 0.3 }));
  const top = std('towertop', { color: '#8d8f91', roughness: 0.8 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, d, H), [m, m, m, m, top, top]); mesh.position.z = H / 2;
  const g = new THREE.Group(); g.add(mesh); g.userData = { w, d, H };
  return g;
}
