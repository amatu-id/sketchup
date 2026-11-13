// Automatic site around the model: ground, plot with lawn/garden/driveway/fence, street with
// sidewalks, lamps, trees, people and cars, neighbours, and a distant background (hills or city).
// Everything is placed in the model's world frame (mm, Z up) and keeps clear of the model.
import * as THREE from 'three';
import { rnd, grassSet, asphaltSet, concreteSet, paverSet, soilSet, macroNoise, waterNormal } from './textures.js';
import * as E from './entourage.js';

const V2 = (x, y) => new THREE.Vector2(x, y);

// ---------------------------------------------------------------- occupancy of the model (what sticks up / what covers the ground)
export class Occupancy {
  constructor(box, cs = 250, margin = 60000) {
    this.cs = cs;
    this.x0 = box.min.x - margin; this.y0 = box.min.y - margin;
    this.nx = Math.ceil((box.max.x - box.min.x + 2 * margin) / cs); this.ny = Math.ceil((box.max.y - box.min.y + 2 * margin) / cs);
    const lim = 900; if (this.nx > lim || this.ny > lim) { const k = Math.max(this.nx, this.ny) / lim; this.cs *= k; this.nx = Math.ceil(this.nx / k); this.ny = Math.ceil(this.ny / k); }
    this.solid = new Uint8Array(this.nx * this.ny); this.cover = new Uint8Array(this.nx * this.ny);
    this.gz = box.min.z;
  }
  tri(a, b, c, solid) {
    const cs = this.cs, x0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - this.x0) / cs)), x1 = Math.min(this.nx - 1, Math.floor((Math.max(a.x, b.x, c.x) - this.x0) / cs));
    const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y, c.y) - this.y0) / cs)), y1 = Math.min(this.ny - 1, Math.floor((Math.max(a.y, b.y, c.y) - this.y0) / cs));
    const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      let inside;
      if (Math.abs(d) < 1e-3) inside = true; // edge-on (vertical) triangle: mark its bounding cells
      else {
        const px = this.x0 + (i + 0.5) * cs, py = this.y0 + (j + 0.5) * cs, e = cs * 0.75 / Math.sqrt(Math.abs(d));
        const w1 = ((b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y)) / d, w2 = ((c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y)) / d;
        inside = w1 >= -e && w2 >= -e && 1 - w1 - w2 >= -e;
      }
      if (inside) { const k = j * this.nx + i; this.cover[k] = 1; if (solid) this.solid[k] = 1; }
    }
  }
  addMesh(mesh) {
    const g = mesh.geometry, p = g.attributes.position, ix = g.index, m = mesh.matrixWorld;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), n = ix ? ix.count : p.count;
    for (let t = 0; t < n; t += 3) {
      const a = ix ? ix.getX(t) : t, b = ix ? ix.getX(t + 1) : t + 1, c = ix ? ix.getX(t + 2) : t + 2;
      A.fromBufferAttribute(p, a).applyMatrix4(m); B.fromBufferAttribute(p, b).applyMatrix4(m); C.fromBufferAttribute(p, c).applyMatrix4(m);
      this.tri(A, B, C, Math.max(A.z, B.z, C.z) > this.gz + 120);
    }
  }
  // distance (mm) from each cell to the nearest solid cell
  dist() {
    if (this._d) return this._d;
    const { nx, ny } = this, INF = 1e9, d = new Float32Array(nx * ny);
    for (let i = 0; i < d.length; i++) d[i] = this.solid[i] ? 0 : INF;
    const s = 1, dg = Math.SQRT2;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; let v = d[k]; if (i) v = Math.min(v, d[k - 1] + s); if (j) { v = Math.min(v, d[k - nx] + s); if (i) v = Math.min(v, d[k - nx - 1] + dg); if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + dg); } d[k] = v; }
    for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) { const k = j * nx + i; let v = d[k]; if (i < nx - 1) v = Math.min(v, d[k + 1] + s); if (j < ny - 1) { v = Math.min(v, d[k + nx] + s); if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + dg); if (i) v = Math.min(v, d[k + nx - 1] + dg); } d[k] = v; }
    for (let i = 0; i < d.length; i++) d[i] *= this.cs;
    return (this._d = d);
  }
  k(x, y) { const i = Math.floor((x - this.x0) / this.cs), j = Math.floor((y - this.y0) / this.cs); return i < 0 || j < 0 || i >= this.nx || j >= this.ny ? -1 : j * this.nx + i; }
  clear(x, y) { const k = this.k(x, y); return k < 0 ? 1e9 : this.dist()[k]; }
  covered(x, y) { const k = this.k(x, y); return k >= 0 && this.cover[k] === 1; }
  // extents of what covers the ground (incl. the model's own terraces / lawns)
  coverBox() { const b = new THREE.Box2(); for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) if (this.cover[j * this.nx + i]) b.expandByPoint(V2(this.x0 + (i + 0.5) * this.cs, this.y0 + (j + 0.5) * this.cs)); return b; }
}

// ---------------------------------------------------------------- local frame: u along the street, v towards the street
class Frame {
  constructor(c, f) { this.c = c; this.f = f.clone().normalize(); this.s = V2(this.f.y, -this.f.x); }
  w(u, v) { return V2(this.c.x + this.s.x * u + this.f.x * v, this.c.y + this.s.y * u + this.f.y * v); }
  l(p) { const dx = p.x - this.c.x, dy = p.y - this.c.y; return V2(dx * this.s.x + dy * this.s.y, dx * this.f.x + dy * this.f.y); }
  yawU() { return Math.atan2(this.s.y, this.s.x); } // +X → +u
  faceF() { return Math.atan2(this.f.x, -this.f.y); } // −Y (fronts of houses / people) → +v
}

// ---------------------------------------------------------------- materials for site surfaces
const smat = new Map();
const SM = (k, make) => { let m = smat.get(k); if (!m) { m = make(); smat.set(k, m); } return m; };
export function disposeSite() { for (const m of smat.values()) m.dispose(); smat.clear(); }
function surf(set, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normalMap || null, roughness: opts.rough ?? 0.92, color: opts.color || '#ffffff', normalScale: new THREE.Vector2(opts.ns ?? 1, opts.ns ?? 1) });
  if (opts.macro) addMacro(m, opts.macro);
  return m;
}
// low-frequency colour variation in world space so tiling never shows
function addMacro(m, amt = 0.35) {
  const tex = macroNoise();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uMacro = { value: tex };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos; uniform sampler2D uMacro;')
      .replace('#include <map_fragment>', `#include <map_fragment>
      { float mA = texture2D(uMacro, vWPos.xy / 47000.0).r, mB = texture2D(uMacro, vWPos.xy / 9100.0 + 0.37).r;
        float k = mix(1.0 - ${amt.toFixed(2)}, 1.0 + ${(amt * 0.6).toFixed(2)}, mA * 0.65 + mB * 0.35);
        diffuseColor.rgb *= k; diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.08, 1.0, 0.82), clamp((mA - 0.55) * 2.0, 0.0, 1.0) * 0.5); }`);
  };
  m.customProgramCacheKey = () => 'macro' + amt;
}
const M = {
  grass: () => SM('grass', () => { const s = grassSet(); const m = surf(s, { macro: 0.32, ns: 0.8 }); return m; }),
  asphalt: () => SM('asphalt', () => surf(asphaltSet(), { macro: 0.18, rough: 0.9 })),
  sidewalk: () => SM('sidewalk', () => surf(paverSet('tile', '#b8b3aa'), { rough: 0.85, macro: 0.12 })),
  paver: () => SM('paver', () => surf(paverSet('paver', '#9a9087'), { rough: 0.85, macro: 0.12 })),
  paverRed: () => SM('paverRed', () => surf(paverSet('paver', '#a0705a'), { rough: 0.85, macro: 0.1 })),
  concrete: () => SM('concrete', () => surf(concreteSet('#b4b1aa'), { rough: 0.88 })),
  curb: () => SM('curb', () => surf(concreteSet('#c2beb6', 'curb'), { rough: 0.85 })),
  soil: () => SM('soil', () => surf(soilSet(), { rough: 1 })),
  deck: () => SM('deck', () => surf(paverSet('deck', '#8a6141'), { rough: 0.6 })),
  stone: () => SM('stonepath', () => surf(paverSet('tile', '#8c877f'), { rough: 0.8 })),
  line: () => SM('roadline', () => new THREE.MeshStandardMaterial({ color: '#eceae2', roughness: 0.6 })),
  yellow: () => SM('roadyellow', () => new THREE.MeshStandardMaterial({ color: '#e2b532', roughness: 0.6 })),
  wall: (c) => SM('fw' + c, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 })),
  bars: () => SM('bars', () => new THREE.MeshStandardMaterial({ color: '#1f2124', metalness: 0.6, roughness: 0.4 })),
  water: () => SM('pond', () => new THREE.MeshPhysicalMaterial({ color: '#1d4b56', roughness: 0.04, metalness: 0, normalMap: waterNormal(), normalScale: new THREE.Vector2(0.35, 0.35), clearcoat: 1, clearcoatRoughness: 0.03 })),
  cyc: () => SM('cyc', () => new THREE.MeshStandardMaterial({ color: '#dcdcd8', roughness: 0.92 })),
};
// flat rectangle in local frame coordinates, world-space UVs
function rect(F, u0, v0, u1, v1, z, mat, tile = 1000, rot = 0) {
  const a = F.w(u0, v0), b = F.w(u1, v0), c = F.w(u1, v1), d = F.w(u0, v1);
  const pos = [a.x, a.y, z, b.x, b.y, z, c.x, c.y, z, d.x, d.y, z];
  const uvf = (p) => { if (!rot) return [p.x / tile, p.y / tile]; const l = F.l(p); return [l.x / tile, l.y / tile]; };
  const uv = [...uvf(a), ...uvf(b), ...uvf(c), ...uvf(d)];
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(windingUp(pos) ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; return m;
}
const windingUp = (p) => (p[3] - p[0]) * (p[7] - p[1]) - (p[4] - p[1]) * (p[6] - p[0]) > 0;
// a box in the local frame (curbs, low walls…)
function lbox(F, u0, v0, u1, v1, z0, z1, mat, tile = 1000) {
  const L = Math.abs(u1 - u0), W = Math.abs(v1 - v0), H = z1 - z0;
  const g = new THREE.BoxGeometry(L, W, H);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(L, W) / tile, uv.getY(i) * Math.max(H, W) / tile);
  const m = new THREE.Mesh(g, mat); const c = F.w((u0 + u1) / 2, (v0 + v1) / 2);
  m.position.set(c.x, c.y, (z0 + z1) / 2); m.rotation.z = F.yawU(); m.castShadow = true; m.receiveShadow = true; return m;
}

// ---------------------------------------------------------------- instancing helper
class Instances {
  constructor() { this.map = new Map(); }
  add(parts, key, x, y, z, yaw = 0, s = 1, opts = {}) {
    let e = this.map.get(key); if (!e) { e = { parts, list: [], shadow: opts.shadow !== false }; this.map.set(key, e); }
    e.list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), yaw), new THREE.Vector3(s * (opts.sx || 1), s * (opts.sy || 1), s * (opts.sz || 1))));
  }
  build(group) {
    for (const e of this.map.values()) for (const p of e.parts.parts) {
      const im = new THREE.InstancedMesh(p.geo, p.mat, e.list.length);
      e.list.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true; im.castShadow = e.shadow; im.receiveShadow = true;
      if (p.noAO) im.userData.noAO = true;
      im.computeBoundingSphere(); group.add(im);
    }
  }
}

// ---------------------------------------------------------------- keep the line of sight to the model clear
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function makeView(cam, box) {
  const E = V2(cam.eye.x, cam.eye.y);
  if (E.x > box.min.x && E.x < box.max.x && E.y > box.min.y && E.y < box.max.y) return { blocks: () => false, close: () => false };
  const mid = Math.atan2(cam.target.y - E.y, cam.target.x - E.x);
  const cs = [V2(box.min.x, box.min.y), V2(box.max.x, box.min.y), V2(box.max.x, box.max.y), V2(box.min.x, box.max.y)];
  const rel = cs.map((c) => wrapA(Math.atan2(c.y - E.y, c.x - E.x) - mid));
  const a0 = Math.min(...rel), a1 = Math.max(...rel);
  const near = Math.hypot(Math.max(box.min.x - E.x, 0, E.x - box.max.x), Math.max(box.min.y - E.y, 0, E.y - box.max.y));
  return {
    // something of radius r at p sits between the camera and the model
    blocks(p, r = 0) { const d = p.distanceTo(E); if (d > near + r) return false; const a = wrapA(Math.atan2(p.y - E.y, p.x - E.x) - mid), m = Math.atan2(r, Math.max(d, 1)) + 0.05; return a > a0 - m && a < a1 + m; },
    close(p, d) { return p.distanceTo(E) < d; },
  };
}

// ---------------------------------------------------------------- the generator
export function buildSite(ctx) {
  // ctx: { box (Box3 of the model), occ (Occupancy), kind, cam {eye, target}, opt, renderer }
  const { box, occ, opt } = ctx, R = rnd((opt.seed || 1) * 7777 + 13);
  const gz = box.min.z;
  const g = new THREE.Group(); g.name = 'site';
  const inst = new Instances();
  const P = new Placer(occ, R);
  P.view = ctx.view = makeView(ctx.cam, box);
  const out = { group: g, focus: box.clone(), lamps: [], kind: ctx.kind, lawn: [] };
  const c3 = box.getCenter(new THREE.Vector3()), c = V2(c3.x, c3.y);
  const size = box.getSize(new THREE.Vector3());
  const camDir = V2(ctx.cam.eye.x - c.x, ctx.cam.eye.y - c.y);
  const preset = choosePreset(opt.preset, ctx.kind, size);
  out.preset = preset;
  if (preset === 'studio') { studio(ctx, g, out); return out; }
  // ground
  const groundMat = M.grass();
  const ground = rect(new Frame(V2(0, 0), V2(0, 1)), c.x - 3e6, c.y - 3e6, c.x + 3e6, c.y + 3e6, gz - 30, groundMat, grassSet().tile);
  ground.name = 'ground'; g.add(ground);
  if (preset === 'kota') street(ctx, g, inst, P, out, R, c, size, camDir);
  else if (preset === 'taman') park(ctx, g, inst, P, out, R, c, size);
  else residential(ctx, g, inst, P, out, R, c, size, camDir);
  // background
  if (opt.background !== 'none') background(ctx, g, inst, R, c, Math.max(size.x, size.y), preset === 'kota' || opt.background === 'city');
  inst.build(g);
  if (opt.grass3d !== false) grass3d(ctx, g, P, out, R);
  out.focus.expandByVector(new THREE.Vector3(9000, 9000, 0));
  return out;
}
function choosePreset(p, kind, size) {
  if (p && p !== 'auto') return p;
  const L = Math.max(size.x, size.y);
  if (kind === 'vehicle') return 'kota';
  if (kind === 'building') return L > 90000 ? 'taman' : 'rumah';
  return 'taman';
}
class Placer {
  constructor(occ, R) { this.occ = occ; this.R = R; this.items = []; this.zones = []; }
  zone(F, u0, v0, u1, v1, pad = 0) { this.zones.push({ F, u0: Math.min(u0, u1) - pad, u1: Math.max(u0, u1) + pad, v0: Math.min(v0, v1) - pad, v1: Math.max(v0, v1) + pad }); }
  inZone(p) { for (const z of this.zones) { const l = z.F.l(p); if (l.x > z.u0 && l.x < z.u1 && l.y > z.v0 && l.y < z.v1) return true; } return false; }
  ok(p, r, model = r, tall = true) { if (this.occ.clear(p.x, p.y) < model || this.occ.covered(p.x, p.y)) return false; if (this.inZone(p)) return false; if (tall && this.view?.blocks(p, r)) return false; for (const it of this.items) if (it.p.distanceTo(p) < it.r + r) return false; return true; }
  take(p, r) { this.items.push({ p: p.clone(), r }); }
}

// ---------------------------------------------------------------- residential
function residential(ctx, g, inst, P, out, R, c, size, camDir) {
  const { box, occ, opt } = ctx, gz = box.min.z;
  const ax = Math.abs(camDir.x) > Math.abs(camDir.y) ? V2(Math.sign(camDir.x) || 1, 0) : V2(0, Math.sign(camDir.y) || 1);
  const F = new Frame(c, ax);
  // building extents in the frame (raised geometry) and what covers the ground
  const corners = [V2(box.min.x, box.min.y), V2(box.max.x, box.min.y), V2(box.max.x, box.max.y), V2(box.min.x, box.max.y)].map((p) => F.l(p));
  let u0 = Math.min(...corners.map((p) => p.x)), u1 = Math.max(...corners.map((p) => p.x)), v0 = Math.min(...corners.map((p) => p.y)), v1 = Math.max(...corners.map((p) => p.y));
  const cb = occ.coverBox(); if (!cb.isEmpty()) { const cc = [V2(cb.min.x, cb.min.y), V2(cb.max.x, cb.min.y), V2(cb.max.x, cb.max.y), V2(cb.min.x, cb.max.y)].map((p) => F.l(p)); u0 = Math.min(u0, ...cc.map((p) => p.x)); u1 = Math.max(u1, ...cc.map((p) => p.x)); v0 = Math.min(v0, ...cc.map((p) => p.y)); v1 = Math.max(v1, ...cc.map((p) => p.y)); }
  const bw = u1 - u0, bd = v1 - v0;
  const big = Math.max(bw, bd) > 60000;
  const frontYard = clamp(bd * 0.38, 4500, 9000), side = clamp(bw * 0.16, 2200, 4500), back = clamp(bd * 0.25, 3000, 7000);
  const pu0 = u0 - side, pu1 = u1 + side, pv0 = v0 - back, pv1 = v1 + frontYard;
  const walk = 1700, strip = 900, curbW = 150, roadW = 7000, curbH = 140;
  const vCurb = pv1 + walk + strip, vRoad0 = vCurb + curbW, vRoad1 = vRoad0 + roadW, vOpp = vRoad1 + curbW;
  const roadZ = gz - 25, walkZ = roadZ + curbH;
  const UL = -260000, UR = 260000;
  const doRoad = opt.road !== false;
  out.focus.union(new THREE.Box3(new THREE.Vector3(...F.w(pu0, pv0).toArray(), gz), new THREE.Vector3(...F.w(pu1, vRoad1).toArray(), gz + 1)));
  // keep-out zones
  if (doRoad) { P.zone(F, UL, pv1, UR, vOpp + strip + walk); }
  // driveway (in the wider side yard if there is room, else in front)
  const dwW = 3000, dwSide = (R() < 0.5 ? -1 : 1);
  let dw;
  if (side >= 3400) dw = dwSide < 0 ? [pu0 + 300, v1 - Math.min(bd * 0.5, 6000), pu0 + 300 + dwW, pv1] : [pu1 - 300 - dwW, v1 - Math.min(bd * 0.5, 6000), pu1 - 300, pv1];
  else dw = dwSide < 0 ? [u0 + 400, v1, u0 + 400 + dwW, pv1] : [u1 - 400 - dwW, v1, u1 - 400, pv1];
  const dwMat = R() < 0.5 ? M.paver() : M.concrete();
  g.add(rect(F, dw[0], Math.max(dw[1], v1 - 200), dw[2], dw[3], gz - 12, dwMat, 1000, 1));
  P.zone(F, dw[0], dw[1], dw[2], dw[3], 200);
  // footpath from the gate to the front of the building
  const pathU = clamp((dw[0] + dw[2]) / 2 < (u0 + u1) / 2 ? (u0 + u1) / 2 + bw * 0.12 : (u0 + u1) / 2 - bw * 0.12, u0 + 700, u1 - 700);
  const stones = R() < 0.5;
  if (stones) for (let v = v1 + 400; v < pv1 - 300; v += 650) { const s = rect(F, pathU - 450, v, pathU + 450, v + 450, gz - 14, M.stone(), 600, 1); g.add(s); }
  else g.add(rect(F, pathU - 600, v1, pathU + 600, pv1, gz - 14, M.paverRed(), 1000, 1));
  P.zone(F, pathU - 700, v1, pathU + 700, pv1, 100);
  // garden bed along the front of the building
  const bedV0 = v1 + 150, bedV1 = v1 + 1050;
  for (const [a, b] of splitAround([u0 - 200, u1 + 200], [[dw[0] - 300, dw[2] + 300], [pathU - 800, pathU + 800]])) {
    if (b - a < 900) continue;
    g.add(rect(F, a, bedV0, b, bedV1, gz - 20, M.soil(), 1200, 1));
    g.add(lbox(F, a, bedV1 - 60, b, bedV1, gz - 30, gz + 90, M.curb(), 1200));
    P.zone(F, a, bedV0, b, bedV1, 0);
    for (let u = a + 450; u < b - 300; u += 650 + R() * 350) {
      const p = F.w(u, (bedV0 + bedV1) / 2 + (R() - 0.5) * 250);
      if (occ.clear(p.x, p.y) < 300) continue;
      const k = R(), kind = k < 0.25 ? 'bugenvil' : k < 0.45 ? 'soka' : k < 0.55 ? 'alamanda' : 'kecil';
      inst.add(E.bushParts(kind, 1), 'bush' + kind, p.x, p.y, gz - 20, R() * 6.28, 0.6 + R() * 0.5);
      if (R() < 0.35) { const q = F.w(u + 300, bedV1 - 250); inst.add(E.spikyParts(1), 'spiky', q.x, q.y, gz - 20, R() * 6, 0.5 + R() * 0.3); }
    }
  }
  // fence: front low wall + black bars, gaps at the gate and the driveway; hedges on the sides and back
  if (opt.fence !== false && !big) {
    const wallC = '#e8e2d5';
    for (const [a, b] of splitAround([pu0, pu1], [[dw[0] - 100, dw[2] + 100], [pathU - 650, pathU + 650]])) {
      if (b - a < 200) continue;
      g.add(lbox(F, a, pv1 - 160, b, pv1, gz - 30, gz + 550, M.wall(wallC), 1000));
      for (let u = a + 60; u < b - 40; u += 130) { const p = F.w(u, pv1 - 80); const bar = new THREE.Mesh(barGeo(), M.bars()); bar.position.set(p.x, p.y, gz + 550 + 450); bar.castShadow = true; g.add(bar); }
      g.add(lbox(F, a, pv1 - 140, b, pv1 - 20, gz + 1430, gz + 1480, M.bars(), 1000));
      for (const u of [a, b]) g.add(lbox(F, u - 150, pv1 - 200, u + 150, pv1 + 40, gz - 30, gz + 1650, M.wall(wallC), 800));
    }
    const hp = E.hedgeParts(1500, 600);
    for (const uu of [pu0, pu1]) for (let v = pv0 + 500; v < pv1 - 700; v += 1000) { const p = F.w(uu, v); inst.add(hp, 'hedgeS', p.x, p.y, gz - 30, F.yawU() + Math.PI / 2, 1); }
    for (let u = pu0 + 500; u < pu1 - 400; u += 1000) { const p = F.w(u, pv0); inst.add(hp, 'hedgeS', p.x, p.y, gz - 30, F.yawU(), 1); }
    P.zone(F, pu0 - 500, pv0 - 500, pu0 + 500, pv1, 0); P.zone(F, pu1 - 500, pv0 - 500, pu1 + 500, pv1, 0); P.zone(F, pu0, pv0 - 500, pu1, pv0 + 500, 0);
  }
  out.lawn.push({ F, u0: pu0 + 300, v0: pv0 + 300, u1: pu1 - 300, v1: pv1 - 250 });
  // trees in the yard
  const dens = opt.trees ?? 0.6;
  const yardTrees = Math.round((3 + bw / 6000) * (0.4 + dens));
  const tryTree = (u, v, kind, rr, s = 1) => { const p = F.w(u, v); if (!P.ok(p, rr * s * 0.6, rr * s * 0.85)) return false; P.take(p, rr * s * 0.5); const sd = 1 + Math.floor(R() * 2); inst.add(E.treeParts(kind, sd), 'tree' + kind + sd, p.x, p.y, gz - 30, R() * 6.28, s); return true; };
  const frontKinds = ['kamboja', 'palem', 'ketapang', 'kamboja'], backKinds = ['mangga', 'rindang', 'kelapa', 'mangga'];
  for (let i = 0, n = 0; i < 60 && n < yardTrees; i++) {
    const front = i % 2 === 0;
    const u = pu0 + 800 + R() * (pu1 - pu0 - 1600), v = front ? v1 + 1400 + R() * Math.max(500, frontYard - 2600) : pv0 + 900 + R() * Math.max(400, v0 - pv0 - 1200);
    const kind = (front ? frontKinds : backKinds)[Math.floor(R() * 4)];
    const tp = E.treeParts(kind, 1);
    if (tryTree(u, v, kind, tp.R, 0.75 + R() * 0.35)) n++;
  }
  // a car on the driveway, a scooter by the porch
  if ((opt.cars ?? 0.6) > 0.15 && (dw[3] - dw[1]) > 5200) {
    const car = E.makeCar(['mpv', 'suv', 'hatch', 'sedan'][Math.floor(R() * 4)], 1 + Math.floor(R() * 999));
    const p = F.w((dw[0] + dw[2]) / 2, (dw[1] + dw[3]) / 2 + 300);
    const yaw = Math.atan2(F.f.y, F.f.x) + (R() < 0.5 ? Math.PI : 0);
    car.position.set(p.x, p.y, gz - 12); car.rotation.z = yaw; car.position.x -= Math.cos(yaw) * car.userData.L / 2; car.position.y -= Math.sin(yaw) * car.userData.L / 2;
    g.add(car);
  }
  // people in the yard
  const ppl = opt.people ?? 0.5;
  if (ppl > 0.1) {
    const n = 1 + Math.round(ppl * 2);
    for (let i = 0; i < n; i++) { const v = v1 + 1500 + R() * (frontYard - 2800), u = pathU + (R() - 0.5) * 2600; const p = F.w(u, v); if (!P.ok(p, 350, 350, false) || ctx.view.close(p, 7000)) continue; P.take(p, 400); person(g, p, gz - 14, F.faceF() + Math.PI + (R() - 0.5) * 2.4, R); }
  }
  if (doRoad) streetBand(ctx, g, inst, P, out, R, F, { pv1, walk, strip, curbW, roadW, vCurb, vRoad0, vRoad1, vOpp, roadZ, walkZ, UL, UR, gz, gates: [[dw[0], dw[2]]] });
  // neighbours on both sides and across the street
  if (opt.neighbors !== false && !big) {
    let uL = pu0, uR = pu1;
    for (let i = 0; i < 3; i++) {
      for (const sgn of [-1, 1]) {
        const wN = 10000 + R() * 5000;
        const a = sgn < 0 ? uL - wN : uR, b = a + wN;
        if (sgn < 0) uL = a; else uR = b;
        neighbour(ctx, g, inst, P, R, F, a, b, pv1, gz, false);
      }
    }
    if (doRoad) { for (let u = pu0 - 16000; u < pu1 + 16000;) { const wN = 10000 + R() * 5000; neighbour(ctx, g, inst, P, R, F, u, u + wN, vOpp + strip + walk, gz, true); u += wN; } }
  }
}
function splitAround([a, b], holes) {
  let segs = [[a, b]];
  for (const [h0, h1] of holes) { const n = []; for (const [s, e] of segs) { if (h1 <= s || h0 >= e) { n.push([s, e]); continue; } if (h0 > s) n.push([s, h0]); if (h1 < e) n.push([h1, e]); } segs = n; }
  return segs;
}
let _bar; const barGeo = () => { if (!_bar) { _bar = new THREE.BoxGeometry(28, 28, 900); _bar.userData.shared = true; } return _bar; };
function person(g, p, z, yaw, R) {
  const m = E.makePerson(1 + Math.floor(R() * 99999), R() < 0.55 ? 'walk' : 'stand');
  m.position.set(p.x, p.y, z); m.rotation.z = yaw; g.add(m); return m;
}
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

function streetBand(ctx, g, inst, P, out, R, F, s) {
  const { opt } = ctx;
  const { pv1, walk, strip, curbW, roadW, vCurb, vRoad0, vRoad1, vOpp, roadZ, walkZ, UL, UR, gz } = s;
  // road + markings
  g.add(rect(F, UL, vRoad0 - 10, UR, vRoad1 + 10, roadZ, M.asphalt(), asphaltSet().tile));
  const mid = (vRoad0 + vRoad1) / 2;
  for (let u = UL; u < UR; u += 8000) g.add(rect(F, u, mid - 60, u + 3000, mid + 60, roadZ + 3, M.line(), 1000));
  for (const v of [vRoad0 + 250, vRoad1 - 250]) g.add(rect(F, UL, v - 50, UR, v + 50, roadZ + 3, M.line(), 1000));
  // curbs, sidewalks, planting strips (both sides)
  for (const side of [0, 1]) {
    const vc0 = side ? vRoad1 : vCurb, vc1 = vc0 + curbW;
    g.add(lbox(F, UL, vc0, UR, vc1, roadZ - 50, walkZ, M.curb(), 1500));
    const st0 = side ? vc1 : pv1 + walk, st1 = side ? vc1 + strip : vCurb;
    const w0 = side ? st1 : pv1, w1 = side ? st1 + walk : pv1 + walk;
    g.add(rect(F, UL, w0, UR, w1, walkZ, M.sidewalk(), paverSet('tile').tile, 1));
    g.add(lbox(F, UL, w0 - 20, UR, w1 + 20, roadZ - 60, walkZ - 2, M.curb(), 1500));
    g.add(rect(F, UL, st0, UR, st1, walkZ - 30, M.grass(), grassSet().tile));
    g.add(lbox(F, UL, st0, UR, st1, roadZ - 60, walkZ - 32, M.soil(), 1500));
    out.lawn.push({ F, u0: -40000, v0: st0 + 50, u1: 40000, v1: st1 - 50, z: walkZ - 30 });
    // street trees, lamps
    const treeEvery = 9000 + (1 - (opt.trees ?? 0.6)) * 9000;
    for (let u = -90000 + R() * 3000; u < 90000; u += treeEvery * (0.8 + R() * 0.4)) {
      const p = F.w(u, (st0 + st1) / 2); if (s.gates.some(([a, b]) => u > a - 1500 && u < b + 1500) && !side) continue;
      if (ctx.view.blocks(p, 2800)) continue;
      const kind = ['ketapang', 'mangga', 'ketapang', 'rindang'][Math.floor(R() * 4)];
      inst.add(E.treeParts(kind, 1 + (side ? 1 : 0)), 'stree' + kind + side, p.x, p.y, walkZ - 30, R() * 6.28, 0.75 + R() * 0.35);
      P.take(p, 1200);
    }
    for (let u = -90000 + side * 15000; u < 90000; u += 30000) {
      const p = F.w(u + 4000, side ? st0 + 250 : st1 - 250);
      if (ctx.view.blocks(p, 400)) continue;
      inst.add(E.streetLamp(), 'lamp', p.x, p.y, walkZ, F.yawU() + (side ? Math.PI : 0), 1); // arm over the road
      out.lamps.push(new THREE.Vector3(p.x, p.y, walkZ + 7300));
    }
    // people walking along the sidewalk
    const n = Math.round((opt.people ?? 0.5) * 9);
    for (let i = 0; i < n; i++) {
      const u = (R() - 0.5) * 50000, v = w0 + 300 + R() * (walk - 600), p = F.w(u, v);
      if (ctx.view.close(p, 9000) || (ctx.view.blocks(p, 400) && ctx.view.close(p, 16000))) continue;
      const dir = R() < 0.5 ? 1 : -1;
      person(g, p, walkZ, Math.atan2(F.s.x * dir, -F.s.y * dir), R);
      if (R() < 0.3) { const q = F.w(u + 600, v + (R() - 0.5) * 300); person(g, q, walkZ, Math.atan2(F.s.x * dir, -F.s.y * dir), R); }
    }
  }
  // traffic (keep left), a few parked cars
  const nc = Math.round((opt.cars ?? 0.6) * 8);
  const used = [];
  for (let i = 0; i < nc; i++) {
    const far = R() < 0.5, dir = far ? 1 : -1, lane = far ? mid + 1750 : mid - 1750;
    const u = (R() - 0.5) * 120000; if (used.some((x) => Math.abs(x.u - u) < 9000 && x.l === lane)) continue;
    { const q = F.w(u, lane); if (ctx.view.close(q, 14000) || (ctx.view.blocks(q, 2600) && ctx.view.close(q, 45000))) continue; }
    used.push({ u, l: lane });
    const car = R() < 0.12 ? E.makeScooter(1 + Math.floor(R() * 99)) : E.makeCar(['sedan', 'mpv', 'suv', 'hatch', 'mpv', 'van'][Math.floor(R() * 6)], 1 + Math.floor(R() * 9999));
    const p = F.w(u, lane + (R() - 0.5) * 300), yaw = F.yawU() + (dir > 0 ? 0 : Math.PI);
    car.position.set(p.x - Math.cos(yaw) * (car.userData.L || 0) / 2, p.y - Math.sin(yaw) * (car.userData.L || 0) / 2, roadZ);
    car.rotation.z = yaw; g.add(car);
  }
  void strip; void vOpp; void gz;
}
function neighbour(ctx, g, inst, P, R, F, a, b, vFront, gz, across) {
  const w = b - a, house = E.makeHouse(1 + Math.floor(R() * 9999), { w: Math.min(12000, w - 3000), d: 9000 + R() * 4000 });
  const d = house.userData.d, setback = 3500 + R() * 2500;
  const um = (a + b) / 2, vm = across ? vFront + setback + d / 2 : vFront - setback - d / 2;
  const p = F.w(um, vm);
  if (ctx.view?.blocks(p, Math.max(w, d) * 0.55)) return;
  house.position.set(p.x, p.y, gz - 30); house.rotation.z = F.faceF() + (across ? Math.PI : 0);
  g.add(house);
  P.take(p, Math.max(w, d) * 0.45);
  // a fence + a tree per plot
  const vf = across ? vFront : vFront - 150, hp = E.hedgeParts(1100, 500);
  for (let u = a + 600; u < b - 600; u += 1000) { if (Math.abs(u - um) < 1800) continue; const q = F.w(u, vf + (across ? 150 : 0)); inst.add(hp, 'hedgeN', q.x, q.y, gz - 30, F.yawU(), 1); }
  const t = F.w(a + 1500 + R() * (w - 3000), across ? vFront + 2200 : vFront - 2200);
  if (ctx.view?.blocks(t, 3500)) return;
  const kind = ['mangga', 'kelapa', 'ketapang', 'palem', 'kamboja'][Math.floor(R() * 5)];
  inst.add(E.treeParts(kind, 2), 'ntree' + kind, t.x, t.y, gz - 30, R() * 6.28, 0.8 + R() * 0.3);
}

// ---------------------------------------------------------------- street scene (vehicles) and park (small objects)
function street(ctx, g, inst, P, out, R, c, size, camDir) {
  const { box, opt } = ctx, gz = box.min.z;
  const along = size.x >= size.y ? V2(1, 0) : V2(0, 1);
  // frame: u along the vehicle, v across; put the camera side as +v
  let f = V2(-along.y, along.x); if (f.dot(camDir) < 0) f.negate();
  const F = new Frame(c, f);
  const W = Math.min(size.x, size.y), lane = 3500, roadW = 2 * lane + 2 * 2500; // parking | lane | lane (vehicle here) | parking
  const vRoad0 = -(2500 + lane + lane / 2), vRoad1 = vRoad0 + roadW;
  const roadZ = gz - 3, curbH = 150, walkZ = roadZ + curbH, walk = 3500, strip = 900;
  const UL = -260000, UR = 260000;
  out.focus.union(new THREE.Box3(new THREE.Vector3(...F.w(-25000, vRoad0 - walk).toArray(), gz), new THREE.Vector3(...F.w(25000, vRoad1 + walk).toArray(), gz + 1)));
  P.zone(F, UL, vRoad0, UR, vRoad1);
  g.add(rect(F, UL, vRoad0, UR, vRoad1, roadZ, M.asphalt(), asphaltSet().tile));
  const mid = (vRoad0 + vRoad1) / 2;
  for (let u = UL; u < UR; u += 8000) g.add(rect(F, u, mid - 60, u + 3000, mid + 60, roadZ + 3, M.line(), 1000));
  for (const v of [vRoad0 + 2500, vRoad1 - 2500]) for (let u = UL; u < UR; u += 6000) g.add(rect(F, u, v - 50, u + 5000, v + 50, roadZ + 3, M.line(), 1000));
  void W;
  for (const side of [-1, 1]) {
    const v0 = side < 0 ? vRoad0 - 150 : vRoad1, v1 = v0 + 150;
    g.add(lbox(F, UL, v0, UR, v1, roadZ - 60, walkZ, M.curb(), 1500));
    const w0 = side < 0 ? v0 - walk : v1, w1 = side < 0 ? v0 : v1 + walk;
    g.add(rect(F, UL, w0, UR, w1, walkZ, M.sidewalk(), paverSet('tile').tile, 1));
    g.add(lbox(F, UL, w0, UR, w1, roadZ - 60, walkZ - 2, M.curb(), 1500));
    P.zone(F, UL, Math.min(w0, w1) - 200, UR, Math.max(w0, w1) + 200);
    // trees in pits + lamps along the curb
    for (let u = -90000 + R() * 4000; u < 90000; u += 11000 + R() * 4000) {
      const p = F.w(u, side < 0 ? w1 - strip / 2 : w0 + strip / 2);
      if (ctx.view.blocks(p, 2800)) continue;
      g.add(rect(F, u - 600, side < 0 ? w1 - strip : w0, u + 600, side < 0 ? w1 : w0 + strip, walkZ + 4, M.soil(), 1000, 1));
      inst.add(E.treeParts(['ketapang', 'mangga', 'ketapang'][Math.floor(R() * 3)], 2), 'ktree' + side, p.x, p.y, walkZ, R() * 6.28, 0.8 + R() * 0.3);
    }
    for (let u = -90000 + (side > 0 ? 12000 : 0); u < 90000; u += 24000) { const p = F.w(u, side < 0 ? w1 - 300 : w0 + 300); if (ctx.view.blocks(p, 400)) continue; inst.add(E.streetLamp(), 'lamp', p.x, p.y, walkZ, F.yawU() + (side < 0 ? 0 : Math.PI), 1); out.lamps.push(new THREE.Vector3(p.x, p.y, walkZ + 7300)); }
    // shop rows behind the sidewalk
    for (let u = -110000; u < 110000;) {
      const units = 3 + Math.floor(R() * 4), row = E.makeShopRow(1 + Math.floor(R() * 9999), units), w = row.userData.w, d = row.userData.d;
      const vb = side < 0 ? Math.min(w0, w1) - d / 2 - 200 : Math.max(w0, w1) + d / 2 + 200;
      const p = F.w(u + w / 2, vb);
      if (ctx.view.blocks(p, Math.max(w, d) * 0.5)) { u += w; continue; }
      row.position.set(p.x, p.y, walkZ - 2); row.rotation.z = F.faceF() + (side < 0 ? 0 : Math.PI);
      g.add(row); u += w + (R() < 0.3 ? 6000 : 0);
    }
    // pedestrians + parked scooters
    const n = Math.round((opt.people ?? 0.5) * 12);
    for (let i = 0; i < n; i++) { const u = (R() - 0.5) * 60000, v = (side < 0 ? Math.min(w0, w1) : Math.max(w0, w1)) - side * (strip + 400 + R() * (walk - strip - 900)), p = F.w(u, v); if (ctx.view.close(p, 8000) || (ctx.view.blocks(p, 400) && ctx.view.close(p, 15000))) continue; const d = R() < 0.5 ? 1 : -1; person(g, p, walkZ, Math.atan2(F.s.x * d, -F.s.y * d), R); }
    for (let i = 0; i < 4; i++) { const sc = E.makeScooter(1 + Math.floor(R() * 99)); const p = F.w((R() - 0.5) * 50000, side < 0 ? Math.min(w0, w1) + 600 : Math.max(w0, w1) - 600); if (ctx.view.close(p, 12000) || ctx.view.blocks(p, 900)) continue; sc.position.set(p.x, p.y, walkZ); sc.rotation.z = F.yawU() + Math.PI / 2 + (R() - 0.5) * 0.3; g.add(sc); }
  }
  // traffic around the main vehicle (keep left), never on top of it
  const nc = Math.round((opt.cars ?? 0.6) * 10), half = Math.max(size.x, size.y) / 2 + 4500;
  const used = [];
  for (let i = 0; i < nc; i++) {
    const far = R() < 0.5, lv = far ? mid + lane / 2 : mid - lane / 2, u = (R() - 0.5) * 110000;
    if (Math.abs(u) < half + 3000 && Math.abs(lv) < W + 2500) continue;
    if (used.some((x) => Math.abs(x.u - u) < 9500 && x.l === lv)) continue;
    { const q = F.w(u, lv); if (ctx.view.close(q, 14000) || (ctx.view.blocks(q, 2600) && ctx.view.close(q, 45000))) continue; }
    used.push({ u, l: lv });
    const car = R() < 0.1 ? E.makeBus(1 + Math.floor(R() * 99)) : E.makeCar(['sedan', 'mpv', 'suv', 'hatch', 'van'][Math.floor(R() * 5)], 1 + Math.floor(R() * 9999));
    const yaw = F.yawU() + (far ? 0 : Math.PI), p = F.w(u, lv);
    car.position.set(p.x - Math.cos(yaw) * (car.userData.L || 0) / 2, p.y - Math.sin(yaw) * (car.userData.L || 0) / 2, roadZ); car.rotation.z = yaw; g.add(car);
  }
}
function park(ctx, g, inst, P, out, R, c, size) {
  const { box, opt } = ctx, gz = box.min.z, F = new Frame(c, V2(0, 1));
  const rad = Math.max(3200, Math.hypot(size.x, size.y) * 0.85);
  // round plaza under/around the object + paths out
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(rad, 64), M.paver()); plaza.position.set(c.x, c.y, gz - 8); plaza.receiveShadow = true;
  const uv = plaza.geometry.attributes.uv, pp = plaza.geometry.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, pp.getX(i) / 1000, pp.getY(i) / 1000);
  g.add(plaza);
  const ring = new THREE.Mesh(new THREE.RingGeometry(rad, rad + 250, 64), M.curb()); ring.position.set(c.x, c.y, gz - 4); ring.receiveShadow = true; g.add(ring);
  P.zone(F, -rad - 300, -rad - 300, rad + 300, rad + 300);
  const nPath = 4, a0 = R() * Math.PI;
  for (let i = 0; i < nPath; i++) {
    const a = a0 + (i / nPath) * Math.PI * 2, d = V2(Math.cos(a), Math.sin(a)), Fp = new Frame(c, d);
    g.add(rect(Fp, -1000, rad, 1000, rad + 60000, gz - 10, M.paverRed(), 1000, 1));
    P.zone(Fp, -1300, rad, 1300, rad + 60000);
    for (let v = rad + 6000; v < rad + 50000; v += 18000) { const p = Fp.w(1400, v); inst.add(E.streetLamp(), 'lamp', p.x, p.y, gz - 10, a + Math.PI, 0.6); out.lamps.push(new THREE.Vector3(p.x, p.y, gz + 4400)); }
  }
  // benches facing the centre, flower beds
  for (let i = 0; i < 6; i++) {
    const a = a0 + Math.PI / 4 + (i / 6) * Math.PI * 2, p = V2(c.x + Math.cos(a) * (rad - 800), c.y + Math.sin(a) * (rad - 800));
    if (ctx.occ.clear(p.x, p.y) < 1200) continue;
    inst.add(E.benchParts(), 'bench', p.x, p.y, gz - 8, a - Math.PI / 2, 1); // seat faces the centre
  }
  for (let i = 0; i < 8; i++) {
    const a = a0 + Math.PI / 4 + (i / 8) * Math.PI * 2, p = V2(c.x + Math.cos(a) * (rad + 2600), c.y + Math.sin(a) * (rad + 2600));
    const col = ['#d6378a', '#f0c419', '#d9302b', '#8d4ab8', '#f6f3ea'][i % 5];
    for (let k = 0; k < 5; k++) { const q = V2(p.x + (R() - 0.5) * 1800, p.y + (R() - 0.5) * 1800); inst.add(E.flowerBedParts(col, 1 + (i % 3)), 'fbed' + col + (i % 3), q.x, q.y, gz - 30, R() * 6, 1); }
    inst.add(E.bushParts('bugenvil', 1), 'bushbugenvil', p.x, p.y, gz - 30, R() * 6, 0.9);
    P.take(p, 1500);
  }
  out.focus.union(new THREE.Box3(new THREE.Vector3(c.x - rad - 8000, c.y - rad - 8000, gz), new THREE.Vector3(c.x + rad + 8000, c.y + rad + 8000, gz + 1)));
  // trees scattered on the lawn, denser further out
  const n = Math.round(70 * (0.3 + (opt.trees ?? 0.6)));
  for (let i = 0, k = 0; i < n * 4 && k < n; i++) {
    const a = R() * Math.PI * 2, r = rad + 7000 + Math.pow(R(), 0.8) * 70000, p = V2(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
    const kind = ['rindang', 'mangga', 'ketapang', 'kelapa', 'cemara', 'rindang'][Math.floor(R() * 6)], tp = E.treeParts(kind, 1);
    if (!P.ok(p, tp.R * 0.5, tp.R)) continue;
    P.take(p, tp.R * 0.45); inst.add(tp, 'ptree' + kind, p.x, p.y, gz - 30, R() * 6.28, 0.8 + R() * 0.4); k++;
  }
  // a pond
  if (R() < 0.6) {
    const a = R() * Math.PI * 2, r = rad + 16000, p = V2(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
    if (P.ok(p, 6000, 6000, false)) { const pond = new THREE.Mesh(new THREE.CircleGeometry(5500, 48), M.water()); pond.scale.set(1.4, 1, 1); pond.rotation.z = R() * 3; pond.position.set(p.x, p.y, gz - 18); g.add(pond); const edge = new THREE.Mesh(new THREE.RingGeometry(5500, 5900, 48), M.stone()); edge.scale.copy(pond.scale); edge.rotation.z = pond.rotation.z; edge.position.set(p.x, p.y, gz - 14); g.add(edge); P.take(p, 8000); }
  }
  // people strolling on the plaza and the paths
  const np = Math.round((opt.people ?? 0.5) * 10);
  for (let i = 0; i < np; i++) {
    const onPlaza = R() < 0.5, a = R() * Math.PI * 2, r = onPlaza ? rad * (0.55 + R() * 0.4) : rad + 3000 + R() * 25000;
    let p = V2(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
    if (!onPlaza) { const k = Math.round((a - a0) / (Math.PI * 2 / nPath)), aa = a0 + k * (Math.PI * 2 / nPath); p = V2(c.x + Math.cos(aa) * r + Math.sin(aa) * (R() - 0.5) * 1200, c.y + Math.sin(aa) * r - Math.cos(aa) * (R() - 0.5) * 1200); }
    if (ctx.occ.clear(p.x, p.y) < 800) continue;
    person(g, p, gz - 8, R() * 6.28, R);
  }
  out.lawn.push({ circle: true, c, r0: rad + 300, r1: rad + 26000 });
}

// ---------------------------------------------------------------- distant background
function background(ctx, g, inst, R, c, L, city) {
  const gz = ctx.box.min.z, r0 = Math.max(260000, L * 4), r1 = r0 * 5;
  // rolling hills ring
  const seg = 160, rings = 18, pos = [], col = [], idx = [];
  const n2 = (x, y) => Math.sin(x * 1.7 + Math.sin(y * 1.3)) * 0.5 + Math.sin(x * 4.1 + y * 2.3) * 0.25 + Math.sin(x * 9.3 - y * 7.1) * 0.12;
  for (let j = 0; j <= rings; j++) {
    const t = j / rings, r = r0 + (r1 - r0) * Math.pow(t, 1.4);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, x = Math.cos(a), y = Math.sin(a);
      const h = Math.max(0, (n2(a * 2.0, t * 3) * 0.5 + 0.55)) * r * 0.075 * Math.pow(t, 0.6) * (city ? 0.35 : 1);
      pos.push(c.x + x * r, c.y + y * r, gz - 60 + h);
      const forest = 0.5 + 0.5 * Math.sin(a * 13 + t * 7);
      col.push(0.16 + 0.06 * forest, 0.24 + 0.08 * forest, 0.12);
    }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) { const a = j * (seg + 1) + i, b = a + seg + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); hg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); hg.setIndex(idx); hg.computeVertexNormals();
  const hills = new THREE.Mesh(hg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })); hills.name = 'hills'; hills.userData.noAO = true; g.add(hills);
  // tree line just in front of the hills (cheap trees, no shadows)
  const n = 260;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + R() * 0.02, r = r0 * (0.55 + R() * 0.4);
    const kind = ['rindang', 'mangga', 'kelapa', 'ketapang'][Math.floor(R() * 4)];
    inst.add(E.treeParts(kind, 3), 'far' + kind, c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, gz - 30, R() * 6.28, 1 + R() * 0.8, { shadow: false });
  }
  if (city) {
    for (let i = 0; i < 46; i++) {
      const a = R() * Math.PI * 2, r = r0 * (0.75 + R() * 1.1), t = E.makeTower(1 + Math.floor(R() * 999));
      t.position.set(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, gz - 30); t.rotation.z = R() * 3; g.add(t);
    }
  }
}

// ---------------------------------------------------------------- 3D grass near the model
function grass3d(ctx, g, P, out, R) {
  const { occ, opt } = ctx, box = ctx.box, gz = box.min.z;
  const c = box.getCenter(new THREE.Vector3());
  const maxN = Math.round((opt.grassN || 55000) * (opt.quality === 'low' ? 0.35 : 1));
  const reach = Math.max(16000, Math.min(32000, Math.hypot(box.max.x - box.min.x, box.max.y - box.min.y) * 0.9 + 9000));
  const ms = [], col = [];
  const inLawn = (p) => out.lawn.some((z) => { if (z.circle) { const d = p.distanceTo(z.c); return d > z.r0 && d < z.r1; } const l = z.F.l(p); return l.x > z.u0 && l.x < z.u1 && l.y > z.v0 && l.y < z.v1; });
  const zOf = (p) => { for (const z of out.lawn) if (!z.circle && z.z != null) { const l = z.F.l(p); if (l.x > z.u0 && l.x < z.u1 && l.y > z.v0 && l.y < z.v1) return z.z; } return gz - 30; };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 0, 1), color = new THREE.Color();
  for (let i = 0; i < maxN * 3 && ms.length < maxN; i++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * reach, p = new THREE.Vector2(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
    if (!inLawn(p) || occ.covered(p.x, p.y) || occ.clear(p.x, p.y) < 150 || P.inZone(p)) continue;
    // fewer tufts far away (they still help at grazing angles)
    if (R() > 1.15 - r / reach) continue;
    const k = 0.75 + R() * 0.7;
    q.setFromAxisAngle(up, R() * 6.28); s.set(k, k, k * (0.8 + R() * 0.5));
    m.compose(new THREE.Vector3(p.x, p.y, zOf(p) - 2), q, s); ms.push(m.clone());
    color.setRGB(0.32 + R() * 0.12, 0.47 + R() * 0.15, 0.17 + R() * 0.06); col.push(color.clone());
  }
  if (!ms.length) return;
  const im = new THREE.InstancedMesh(E.grassTuft(), E.grassMat(), ms.length);
  ms.forEach((x, i) => { im.setMatrixAt(i, x); im.setColorAt(i, col[i]); });
  im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.receiveShadow = true; im.castShadow = false; im.userData.noAO = true; im.computeBoundingSphere();
  im.name = 'grass3d'; g.add(im);
}

// ---------------------------------------------------------------- studio backdrop
function studio(ctx, g, out) {
  const { box } = ctx, gz = box.min.z, c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const R0 = Math.max(6000, Math.max(size.x, size.y, size.z) * 2.2), W = R0 * 5, bend = R0 * 0.6;
  const dir = new THREE.Vector2(ctx.cam.eye.x - c.x, ctx.cam.eye.y - c.y).normalize();
  // floor → quarter curve → back wall, behind the model as seen from the camera
  const shape = []; const N = 24;
  shape.push([-R0 * 3, 0]); shape.push([R0, 0]);
  for (let i = 1; i <= N; i++) { const a = (i / N) * Math.PI / 2; shape.push([R0 + Math.sin(a) * bend, bend - Math.cos(a) * bend]); }
  shape.push([R0 + bend, R0 * 3]);
  const pos = [], idx = [];
  for (let i = 0; i < shape.length; i++) { const [d, z] = shape[i]; for (const w of [-W / 2, W / 2]) pos.push(d, w, z); }
  for (let i = 0; i < shape.length - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const cyc = new THREE.Mesh(geo, M.cyc()); cyc.receiveShadow = true; cyc.name = 'cyclorama';
  if (cyc.geometry.attributes.normal.getZ(0) < 0) { geo.setIndex(idx.map((_, i) => idx[i - (i % 3) + [0, 2, 1][i % 3]])); geo.computeVertexNormals(); }
  cyc.rotation.z = Math.atan2(-dir.y, -dir.x); cyc.position.set(c.x, c.y, gz - 2);
  g.add(cyc);
  out.focus = box.clone().expandByScalar(Math.max(2000, size.length() * 0.6));
  out.studio = true;
}
