// Render engine: the model with physically based materials, placed in a generated site under a
// physical sky. Image-based light from the sky, soft sun shadows, ambient occlusion, bloom, filmic
// tone mapping and progressive accumulation (anti-aliasing + soft shadows) for clean stills.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { basis, triangulate2 } from '../core/geom.js';
import { modelFromJSON, modelToJSON } from '../core/model.js';
import { modelTextures, waterNormal } from './textures.js';
import { SkyDome, SKY_PRESETS, sunFor, sunLight } from './sky.js';
import { Occupancy, buildSite, disposeSite } from './site.js';
import { planAutoPaint, applyAutoPaint, prepareAutoPaint, collectObjects, detectKind } from './autopaint.js';
import * as E from './entourage.js';

export const DEFAULTS = {
  preset: 'auto', sky: 'cerah', hour: null, turn: 0, sunMode: 'kamera', cover: null, haze: null, seed: 1,
  trees: 0.6, people: 0.5, cars: 0.5, road: true, fence: true, neighbors: true, background: 'auto', grass3d: true,
  autopaint: true, style: 'auto',
  exposure: 0, contrast: 1.06, saturation: 1.08, warmth: 0.1, vignette: 0.35, bloom: 0.22, ao: true, aoAmount: 1, softness: 1, sharpen: 0.25,
  tone: 'aces', verticals: true, previewScale: 1,
};

// ---------------------------------------------------------------- materials from the model
const ROUGH = { plaster: 0.92, concrete: 0.88, brick: 0.9, blocks: 0.9, stone: 0.85, granite: 0.32, marble: 0.16, tile: 0.22, checker: 0.25, wood: 0.55, parquet: 0.38, siding: 0.68, roof: 0.62, shingle: 0.85, metal: 0.42, brushed: 0.35, rust: 0.82, asphalt: 0.95, soil: 1, gravel: 0.95, paving: 0.85, grass: 0.95, water: 0.03, fabric: 0.95, leather: 0.5, bark: 0.95, leaves: 0.75, image: 0.7 };
const METAL = { brushed: 1, metal: 0.35, rust: 0.25 };
const METAL_NAME = /\b(steel|besi|metal|alumin|aluminium|aluminum|stainless|krom|chrome|logam|seng|baja|kuningan|brass|tembaga|copper|silver)\b/i;
const GLASS_NAME = /\b(glass|kaca|glazing)\b/i, WATER_NAME = /\b(water|air|kolam|pool)\b/i;
class MatLib {
  constructor(model) { this.model = model; this.cache = new Map(); }
  get(key, side = 'front') {
    const k = key + side; let m = this.cache.get(k); if (m) return m;
    m = this.make(key); this.cache.set(k, m); return m;
  }
  make(key) {
    if (key === 'default') return new THREE.MeshStandardMaterial({ color: '#efeee9', roughness: 0.82 });
    const mt = this.model.materials.get(+key);
    if (!mt) return new THREE.MeshStandardMaterial({ color: '#efeee9', roughness: 0.82 });
    const p = mt.pbr || {}, kind = mt.tex || null, name = mt.name || '';
    const tex = kind ? modelTextures(mt) : null;
    const opacity = mt.opacity ?? 1;
    const isWater = p.water || kind === 'water' || (WATER_NAME.test(name) && opacity < 1);
    const isGlass = !isWater && (p.glass || (opacity < 1 && (GLASS_NAME.test(name) || !kind)));
    let m;
    if (isWater) {
      const n = waterNormal();
      m = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(mt.color).lerp(new THREE.Color('#1f6f86'), 0.4), roughness: 0.04, metalness: 0, transmission: 0.85, thickness: 900, ior: 1.33,
        attenuationColor: new THREE.Color(mt.color).lerp(new THREE.Color('#1a7c94'), 0.5), attenuationDistance: 2600, normalMap: n, normalScale: new THREE.Vector2(0.25, 0.25) });
      m.userData.noShadow = true;
    } else if (isGlass) {
      const tint = new THREE.Color(mt.color), dark = opacity > 0.55;
      m = new THREE.MeshPhysicalMaterial({ color: tint.clone().lerp(new THREE.Color(1, 1, 1), dark ? 0.2 : 0.55), roughness: 0.02, metalness: 0, transmission: dark ? 0.55 : 0.92, thickness: 0, ior: 1.52, specularIntensity: 1, envMapIntensity: 1.15 });
      m.userData.noShadow = true;
    } else {
      const physical = p.cc || p.sheen;
      const o = {
        color: tex ? '#ffffff' : mt.color, map: tex?.map || null, normalMap: tex?.normalMap || null,
        roughness: p.r ?? ROUGH[kind] ?? 0.6, metalness: p.m ?? METAL[kind] ?? (METAL_NAME.test(name) && !kind ? 0.7 : 0),
      };
      if (p.e) { o.emissive = new THREE.Color(p.ec || mt.color); o.emissiveIntensity = p.e; }
      m = physical ? new THREE.MeshPhysicalMaterial({ ...o, clearcoat: p.cc || 0, clearcoatRoughness: p.ccr ?? 0.05 }) : new THREE.MeshStandardMaterial(o);
      if (opacity < 1) { m.transparent = true; m.opacity = opacity; m.depthWrite = opacity > 0.6; }
      if (kind === 'leaves') { m.side = THREE.DoubleSide; }
    }
    return m;
  }
  dispose() { for (const m of this.cache.values()) m.dispose(); this.cache.clear(); }
}

// ---------------------------------------------------------------- geometry from the model (front + back, grouped by material)
function entsGeometry(ents, model, instMat) {
  const tags = model.tags, visTag = (t) => { const x = tags.get(t || 0); return !x || x.visible !== false; };
  const par = new Map(); const find = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
  for (const f of ents.faces.keys()) par.set(f, f);
  for (const e of ents.edges.values()) { if (!e.smooth || e.faces.size !== 2) continue; const [a, b] = [...e.faces]; const ra = find(a), rb = find(b); if (ra !== rb) par.set(ra, rb); }
  const vn = new Map();
  for (const f of ents.faces.values()) { const g = find(f.id); for (const l of f.loops) for (const v of l) { const k = v + ':' + g; let n = vn.get(k); if (!n) vn.set(k, (n = new THREE.Vector3())); n.add(f.n); } }
  const groups = new Map(); // key → { pos, nor, uv }
  const G = (k) => { let o = groups.get(k); if (!o) groups.set(k, (o = { pos: [], nor: [], uv: [] })); return o; };
  const dk = instMat != null ? String(instMat) : 'default';
  for (const f of ents.faces.values()) {
    if (f.hidden || !visTag(f.tag)) continue;
    const { u, v } = basis(f.n);
    const l2 = f.loops.map((l) => l.map((id) => { const p = ents.P(id); return [p.dot(u), p.dot(v)]; }));
    const tris = f.loops[0].length === 3 && f.loops.length === 1 ? [[0, 1, 2]] : triangulate2(l2[0], l2.slice(1));
    if (!tris.length) continue;
    const ids = f.loops.flat(), g = find(f.id);
    const fk = f.mat != null ? String(f.mat) : dk, bk = f.back != null ? String(f.back) : fk;
    const fm = model.materials.get(+fk), bm = model.materials.get(+bk);
    for (const [key, mm, back] of [[fk, fm, false], [bk, bm, true]]) {
      const o = G(key), tw = mm?.tw || 1000, th = mm?.th || 1000, uo = f.uv || null;
      const P = [], N = [], U = [];
      for (const id of ids) {
        const p = ents.P(id); P.push(p);
        const n = vn.get(id + ':' + g); let nn = n && n.lengthSq() > 1e-9 ? n.clone().normalize() : f.n.clone(); if (nn.dot(f.n) < 0.5) nn = f.n.clone();
        if (back) nn.negate(); N.push(nn);
        let su = p.dot(u), sv = p.dot(v);
        if (uo) { const c = Math.cos(uo.r || 0), s = Math.sin(uo.r || 0); const x = su - (uo.ox || 0), y = sv - (uo.oy || 0); su = (x * c + y * s) / (uo.sx || 1); sv = (-x * s + y * c) / (uo.sy || 1); }
        U.push(su / tw, sv / th);
      }
      for (const t of tris) {
        const tt = back ? [t[0], t[2], t[1]] : t;
        for (const i of tt) { const p = P[i], n = N[i]; o.pos.push(p.x, p.y, p.z); o.nor.push(n.x, n.y, n.z); o.uv.push(U[i * 2], U[i * 2 + 1]); }
      }
    }
  }
  const out = [];
  for (const [key, o] of groups) {
    if (!o.pos.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(o.nor, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(o.uv, 2));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    out.push({ key, geo });
  }
  return out;
}
function buildModel(model, lib) {
  const group = new THREE.Group(); group.name = 'model';
  const cache = new Map(), meshes = [], proxies = [];
  const tags = model.tags, visTag = (t) => { const x = tags.get(t || 0); return !x || x.visible !== false; };
  const rec = (ents, parent, instMat, key) => {
    const ck = key + '|' + (instMat ?? '');
    let parts = cache.get(ck); if (!parts) { parts = entsGeometry(ents, model, instMat); cache.set(ck, parts); }
    for (const p of parts) {
      const mat = lib.get(p.key);
      const mesh = new THREE.Mesh(p.geo, mat); mesh.castShadow = !mat.userData.noShadow; mesh.receiveShadow = true;
      parent.add(mesh); meshes.push(mesh);
    }
    for (const inst of ents.insts.values()) {
      if (inst.hidden || !visTag(inst.tag)) continue;
      const def = model.defs.get(inst.def); if (!def) continue;
      if (['person', 'tree', 'car'].includes(def.libId)) { proxies.push({ inst, def, parent }); continue; }
      const o = new THREE.Group(); o.matrixAutoUpdate = false; o.matrix.copy(inst.m); parent.add(o);
      rec(def.ents, o, inst.mat ?? instMat, def.id);
    }
  };
  rec(model.root, group, null, 'root');
  group.updateMatrixWorld(true);
  // library 2D people / trees / car blocks become 3D entourage
  for (const { inst, def, parent } of proxies) {
    const w = parent.matrixWorld.clone().multiply(inst.m), pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); w.decompose(pos, q, s);
    const yaw = new THREE.Euler().setFromQuaternion(q, 'ZYX').z;
    let o;
    if (def.libId === 'person') { o = E.makePerson(inst.id, inst.id % 2 ? 'walk' : 'stand'); o.rotation.z = yaw; }
    else if (def.libId === 'car') { o = E.makeCar(['sedan', 'mpv', 'suv', 'hatch'][inst.id % 4], inst.id); o.scale.setScalar(Math.abs(s.x) * 4600 / (o.userData.L || 4600)); o.rotation.z = yaw; }
    else {
      const kind = ['mangga', 'ketapang', 'rindang', 'kelapa'][inst.id % 4], tp = E.treeParts(kind, 1 + (inst.id % 2));
      o = new THREE.Group(); for (const p of tp.parts) { const m = new THREE.Mesh(p.geo, p.mat); m.castShadow = true; m.receiveShadow = true; if (p.noAO) m.userData.noAO = true; o.add(m); }
      o.scale.setScalar(Math.abs(s.z) * 5000 / tp.H);
    }
    o.position.copy(pos); group.add(o);
    o.traverse((m) => { if (m.isMesh) meshes.push(m); });
  }
  group.updateMatrixWorld(true);
  return { group, meshes };
}

// a face that lists a missing vertex must not stop the render
function sanitize(json) {
  const fix = (e) => { if (!e) return; const ids = new Set((e.v || []).map((v) => v[0])); e.f = (e.f || []).map((f) => ({ ...f, l: f.l.map((l) => l.filter((x) => ids.has(x))).filter((l) => l.length >= 3) })).filter((f) => f.l.length); };
  fix(json.root); for (const d of json.defs || []) fix(d.ents);
  return json;
}
// ---------------------------------------------------------------- post: blend + display shaders
const BLEND = { uniforms: { tNew: { value: null }, tAcc: { value: null }, uW: { value: 1 } }, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'uniform sampler2D tNew, tAcc; uniform float uW; varying vec2 vUv; void main(){ gl_FragColor = mix(texture2D(tAcc, vUv), texture2D(tNew, vUv), uW); }' };
const DISPLAY = {
  uniforms: { tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uContrast: { value: 1 }, uSat: { value: 1 }, uWarm: { value: 0 }, uVig: { value: 0 }, uSharp: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uContrast, uSat, uWarm, uVig, uSharp; varying vec2 vUv;
  void main(){
    vec2 px = 1.0 / uRes; vec3 c = texture2D(tDiffuse, vUv).rgb;
    if (uSharp > 0.0) { vec3 b = (texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb) * 0.25; c = c + (c - b) * uSharp; }
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uSat);
    c = (c - 0.5) * uContrast + 0.5;
    c *= vec3(1.0 + uWarm * 0.07, 1.0 + uWarm * 0.01, 1.0 - uWarm * 0.07);
    vec2 d = vUv - 0.5; d.x *= uRes.x / uRes.y; c *= mix(1.0, smoothstep(1.25, 0.25, length(d)), uVig);
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }` };
// ambient occlusion that ignores leaf cards, grass blades, the sky dome and far hills
// (their noisy depth would darken whole tree crowns)
class FoliageSafeGTAO extends GTAOPass {
  overrideVisibility() { super.overrideVisibility(); this.scene.traverse((o) => { if (o.userData.noAO) o.visible = false; }); }
}
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

// ---------------------------------------------------------------- engine
export class RenderEngine {
  constructor(app, canvas) {
    this.app = app; this.canvas = canvas;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance', stencil: false }));
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.shadowMap.autoUpdate = false;
    this.pmrem = new THREE.PMREMGenerator(r);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 50, 6e6); this.camera.up.set(0, 0, 1);
    this.sky = new SkyDome(); this.scene.add(this.sky.mesh);
    this.sun = new THREE.DirectionalLight(0xffffff, 3); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096); this.sun.shadow.bias = -0.00025;
    this.scene.add(this.sun, this.sun.target);
    this.fill = new THREE.HemisphereLight(0xdfe9ff, 0x5d6b45, 0); this.scene.add(this.fill);
    this.opt = { ...DEFAULTS };
    this.samples = 0; this.maxSamples = 24; this.dirty = true; this.moving = false;
    this.blend = new FullScreenQuad(new THREE.ShaderMaterial({ ...BLEND, uniforms: THREE.UniformsUtils.clone(BLEND.uniforms), depthTest: false, depthWrite: false }));
    this.display = new FullScreenQuad(new THREE.ShaderMaterial({ ...DISPLAY, uniforms: THREE.UniformsUtils.clone(DISPLAY.uniforms), depthTest: false, depthWrite: false }));
    this.status = '';
  }
  async init() {}
  // ------------------------------------------------------------ scene
  analyse() {
    const model = this.app.model;
    const objs = collectObjects(model); for (const o of objs) o.autoKind = detectKind(o);
    // the main object decides the default environment
    let main = null; for (const o of objs) if (!main || o.size.x * o.size.y * Math.max(o.size.z, 1) > main.size.x * main.size.y * Math.max(main.size.z, 1)) main = o;
    const kinds = new Set(objs.map((o) => o.autoKind));
    const kind = kinds.has('building') ? 'building' : main?.autoKind || 'generic';
    return { objs, kind };
  }
  build() {
    this.clearScene();
    const app = this.app, opt = this.opt;
    // a private copy of the model: Auto Paint for the render never touches the real one
    const model = modelFromJSON(sanitize(modelToJSON(app.model)));
    this.plan = null;
    if (opt.autopaint) { const o = { scope: 'unpainted', style: opt.style, seed: opt.seed }; try { prepareAutoPaint(model, o); } catch (e) { console.warn('Auto Paint split skipped', e); } this.plan = planAutoPaint(model, o); applyAutoPaint(model, this.plan); }
    this.lib = new MatLib(model);
    const { group, meshes } = buildModel(model, this.lib);
    this.modelGroup = group; this.scene.add(group);
    const box = new THREE.Box3(); for (const m of meshes) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld)); }
    if (box.isEmpty()) box.set(new THREE.Vector3(-1000, -1000, 0), new THREE.Vector3(1000, 1000, 1000));
    this.box = box;
    const info = this.analyse();
    this.kind = info.kind;
    // the site
    const occ = new Occupancy(box);
    for (const m of meshes) occ.addMesh(m);
    const cam = this.camState();
    this.viewAz = Math.atan2(cam.target.y - cam.eye.y, cam.target.x - cam.eye.x);
    const bg = opt.background === 'auto' ? 'hills' : opt.background;
    this.site = buildSite({ box, occ, kind: info.kind, cam, opt: { ...opt, background: bg }, renderer: this.renderer });
    this.scene.add(this.site.group);
    this.studio = !!this.site.studio;
    // what the cursor can land on (instanced grass/trees would make picking slow)
    this.pickables = [...meshes];
    this.site.group.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.name !== 'hills') this.pickables.push(o); });
    this.applySky();
    this.reset();
    return { kind: info.kind, preset: this.site.preset, painted: this.plan ? this.plan.assign.length : 0, objects: this.plan?.objects || info.objs.map((o) => ({ name: o.names[0], kind: o.autoKind })) };
  }
  clearScene() {
    for (const k of ['modelGroup']) if (this[k]) { this.scene.remove(this[k]); this[k].traverse((o) => { if (o.isMesh && !o.isInstancedMesh) o.geometry?.dispose?.(); }); this[k] = null; }
    if (this.site) { this.scene.remove(this.site.group); this.site.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); else if (o.isMesh && o.name !== 'grass3d' && !o.geometry.userData?.shared) o.geometry?.dispose?.(); }); this.site = null; }
    this.lib?.dispose(); this.lib = null;
  }
  // ------------------------------------------------------------ sky + light
  skyParams() {
    const o = this.opt, base = SKY_PRESETS[o.sky] || SKY_PRESETS.cerah;
    return { ...base, hour: o.hour ?? base.hour, cover: o.cover ?? base.cover, haze: o.haze ?? base.haze, seed: o.seed, gain: 0.4, ground: new THREE.Color(0.1, 0.12, 0.07) };
  }
  applySky() {
    const p = this.skyParams(), model = this.app.model;
    let sun = sunFor(model, p.hour, this.opt.sunMode === 'kamera' ? 0 : this.opt.turn);
    if (this.opt.sunMode === 'kamera') {
      // keep the real elevation for the hour, but bring the sun round behind the camera's shoulder so the facade we look at is lit
      const el = Math.asin(Math.min(1, Math.max(-1, sun.z)));
      const az = (this.viewAz ?? 0) + Math.PI + THREE.MathUtils.degToRad(38 + (this.opt.turn || 0));
      sun = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el));
    }
    if (sun.z < 0.02) sun.z = 0.02, sun.normalize();
    this.sunDir = sun.clone();
    const R = this.box ? this.box.getSize(new THREE.Vector3()).length() : 10000;
    this.sky.set(p, sun, 4.5e6);
    if (this.studio) {
      const env = this.pmrem.fromScene(new RoomEnvironment(), 0.04); this.envRT?.dispose(); this.envRT = env;
      this.scene.environment = env.texture; this.scene.environmentIntensity = 0.9; this.sky.mesh.visible = false;
      this.scene.background = new THREE.Color('#d9d9d6'); this.scene.fog = null;
      this.sun.color.set('#fff6ec'); this.sun.intensity = 2.2;
      this.fill.intensity = 0;
      this.sunDir = new THREE.Vector3(-0.35, -0.55, 0.76).normalize();
      if (this.camera) { const v = new THREE.Vector3().subVectors(this.camera.position, this.box.getCenter(new THREE.Vector3())).setZ(0).normalize(); this.sunDir.set(v.x * 0.5 - v.y * 0.35, v.y * 0.5 + v.x * 0.35, 0.78).normalize(); }
    } else {
      this.sky.mesh.visible = true; this.scene.background = null;
      this.scene.environment = this.sky.env(this.renderer, this.pmrem);
      const sl = sunLight(p, sun);
      this.sun.color.copy(sl.color); this.sun.intensity = 3.4 * sl.intensity;
      this.scene.environmentIntensity = 0.95 + p.overcast * 0.5;
      // fog = the colour of the horizon, density from haze
      const hz = this.sky.horizon(this.renderer);
      const dens = (0.32 + p.haze * 1.1) / 1.6e6;
      this.scene.fog = new THREE.FogExp2(hz.getHex() === 0 ? 0xc8d6e2 : 0xffffff, dens);
      if (hz.getHex()) this.scene.fog.color.setRGB(hz.r, hz.g, hz.b, THREE.LinearSRGBColorSpace);
      this.fill.intensity = 0;
    }
    this.renderer.toneMappingExposure = Math.pow(2, this.opt.exposure || 0) * (this.studio ? 1 : this.autoExposure(p, sun));
    this.renderer.toneMapping = this.opt.tone === 'agx' ? THREE.AgXToneMapping : this.opt.tone === 'neutral' ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
    void R;
    this.fitShadow();
    if (this.modelGroup) this.reflections();
    this.reset();
  }
  // local reflections: a cube capture of the site around the model, used by glass, paint, water and metal
  reflections() {
    if (this.studio || !this.box) return;
    const c = this.box.getCenter(new THREE.Vector3()); c.z = Math.min(this.box.max.z, this.box.min.z + 1700);
    const rt = this.probeRT || (this.probeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType }));
    const cc = new THREE.CubeCamera(100, 3e6, rt); cc.position.copy(c);
    this.scene.add(cc);
    const vis = this.modelGroup.visible; this.modelGroup.visible = false;
    this.sky.mesh.position.copy(c); this.sky.mesh.updateMatrixWorld();
    this.renderer.shadowMap.needsUpdate = true;
    cc.update(this.renderer, this.scene);
    this.modelGroup.visible = vis; this.scene.remove(cc);
    const old = this.probeEnv; this.probeEnv = this.pmrem.fromCubemap(rt.texture); old?.dispose();
    const glossy = (m) => m && (m.isMeshPhysicalMaterial || (m.isMeshStandardMaterial && (m.roughness < 0.3 || m.metalness > 0.5)));
    const seen = new Set();
    this.scene.traverse((o) => { if (!o.isMesh) return; for (const m of [].concat(o.material)) { if (seen.has(m) || !glossy(m) || m.alphaTest) continue; seen.add(m); m.envMap = this.probeEnv.texture; m.envMapIntensity = m.envMapIntensity || 1; m.needsUpdate = true; } });
    this.glossy = seen;
  }
  autoExposure(p, sun) {
    // keep golden hour / overcast as bright as noon, a touch moodier
    const low = 1 - THREE.MathUtils.smoothstep(sun.z, 0.05, 0.45);
    return 1 + low * 0.5 + p.overcast * 0.35;
  }
  fitShadow() {
    const focus = (this.site?.focus || this.box || new THREE.Box3(new THREE.Vector3(-1e4, -1e4, 0), new THREE.Vector3(1e4, 1e4, 1e4))).clone();
    focus.max.z = Math.max(focus.max.z, (this.box?.max.z || 0) + 8000);
    const c = focus.getCenter(new THREE.Vector3()), R = focus.getSize(new THREE.Vector3()).length() / 2;
    const s = Math.min(R, 120000);
    const d = (this.sunJ || this.sunDir).clone();
    this.sun.position.copy(c).addScaledVector(d, R * 2 + 10000); this.sun.target.position.copy(c); this.sun.target.updateMatrixWorld();
    const cam = this.sun.shadow.camera; cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s; cam.near = 100; cam.far = R * 4 + 20000; cam.updateProjectionMatrix();
    const texel = (2 * s) / this.sun.shadow.mapSize.x; this.sun.shadow.normalBias = texel * 1.2;
    this.renderer.shadowMap.needsUpdate = true;
  }
  // ------------------------------------------------------------ camera from the main viewport
  camState() { const c = this.app.view.cam; return { eye: c.eye.clone(), target: c.target.clone(), fov: c.fov, twoPoint: c.twoPoint }; }
  syncCamera() {
    const c = this.app.view.cam, cam = this.camera;
    cam.position.copy(c.eye); cam.up.set(0, 0, 1); cam.fov = c.fov; cam.lookAt(c.target);
    const dist = this.box ? Math.max(1, this.box.distanceToPoint(c.eye)) : c.eye.distanceTo(c.target);
    cam.near = Math.max(25, Math.min(400, dist * 0.25)); cam.far = 6e6;
    const fwd = c.target.clone().sub(c.eye).normalize();
    const two = (this.opt.verticals || c.twoPoint) && Math.abs(fwd.z) < 0.6 && !this.studioTop;
    if (two) cam.lookAt(c.eye.clone().add(new THREE.Vector3(fwd.x, fwd.y, 0)));
    cam.updateProjectionMatrix();
    if (two) { const shift = Math.tan(Math.asin(fwd.z)) / Math.tan(THREE.MathUtils.degToRad(c.fov) / 2); cam.projectionMatrix.elements[9] = shift; cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert(); }
    cam.updateMatrixWorld();
    const key = cam.matrixWorld.elements.join(',') + cam.projectionMatrix.elements.join(',');
    if (key !== this._camKey) { this._camKey = key; this.reset(); this.moving = true; clearTimeout(this._mv); this._mv = setTimeout(() => { this.moving = false; this.dirty = true; }, 180); }
  }
  // ------------------------------------------------------------ sizes + passes
  setSize(w, h) {
    w = Math.max(16, Math.floor(w)); h = Math.max(16, Math.floor(h));
    if (this.W === w && this.H === h) return;
    this.W = w; this.H = h;
    this.renderer.setPixelRatio(1); this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.makeComposer();
    this.reset();
  }
  makeComposer() {
    const { W, H, renderer } = this;
    this.composer?.dispose(); this.accA?.dispose(); this.accB?.dispose();
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
    const c = (this.composer = new EffectComposer(renderer, rt)); c.renderToScreen = false; c.setPixelRatio(1); c.setSize(W, H);
    c.addPass(new RenderPass(this.scene, this.camera));
    this.aoPass = null;
    if (this.opt.ao) {
      const ao = (this.aoPass = new FoliageSafeGTAO(this.scene, this.camera, W, H));
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = Math.min(1, 0.85 * (this.opt.aoAmount ?? 1));
      ao.updateGtaoMaterial({ radius: 650, distanceExponent: 1.4, thickness: 900, scale: Math.max(0.5, this.opt.aoAmount ?? 1), samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      c.addPass(ao);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), this.opt.bloom, 0.55, 0.9); c.addPass(this.bloom);
    c.addPass(new OutputPass());
    const o = { type: THREE.HalfFloatType, depthBuffer: false };
    this.accA = new THREE.WebGLRenderTarget(W, H, o); this.accB = new THREE.WebGLRenderTarget(W, H, o);
  }
  reset() { this.samples = 0; this.dirty = true; }
  // ------------------------------------------------------------ one sample
  sample() {
    const { renderer, camera } = this;
    const i = this.samples;
    // sub-pixel jitter + a slightly different point on the sun's disc → AA and soft shadows when averaged
    if (i > 0) {
      const jx = halton(i + 1, 2) - 0.5, jy = halton(i + 1, 3) - 0.5;
      camera.setViewOffset(this.W, this.H, jx, jy, this.W, this.H);
      const a = halton(i + 1, 5) * Math.PI * 2, r = Math.sqrt(halton(i + 1, 7)) * 0.012 * (this.opt.softness ?? 1);
      const t1 = new THREE.Vector3().crossVectors(this.sunDir, new THREE.Vector3(0, 0, 1)).normalize(), t2 = new THREE.Vector3().crossVectors(this.sunDir, t1).normalize();
      this.sunJ = this.sunDir.clone().addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r).normalize();
    } else { camera.clearViewOffset(); this.sunJ = null; }
    this.syncTwoPointAfterOffset();
    this.fitShadow();
    this.sky.follow(camera);
    this.composer.render();
    // accumulate
    const src = this.composer.readBuffer.texture;
    const bm = this.blend.material; bm.uniforms.tNew.value = src; bm.uniforms.tAcc.value = this.accA.texture; bm.uniforms.uW.value = 1 / (i + 1);
    renderer.setRenderTarget(this.accB); this.blend.render(renderer);
    [this.accA, this.accB] = [this.accB, this.accA];
    this.samples++;
    camera.clearViewOffset(); this.syncTwoPointAfterOffset();
  }
  syncTwoPointAfterOffset() {
    // setViewOffset rebuilt the projection: put the two-point lens shift back
    const c = this.app.view.cam, cam = this.camera, fwd = c.target.clone().sub(c.eye).normalize();
    if ((this.opt.verticals || c.twoPoint) && Math.abs(fwd.z) < 0.6) {
      cam.updateProjectionMatrix();
      cam.projectionMatrix.elements[9] += Math.tan(Math.asin(fwd.z)) / Math.tan(THREE.MathUtils.degToRad(c.fov) / 2);
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    }
  }
  show(target = null) {
    const d = this.display.material.uniforms, o = this.opt;
    d.tDiffuse.value = this.accA.texture; d.uRes.value.set(this.W, this.H);
    d.uContrast.value = o.contrast; d.uSat.value = o.saturation; d.uWarm.value = o.warmth; d.uVig.value = o.vignette; d.uSharp.value = o.sharpen;
    this.renderer.setRenderTarget(target); this.display.render(this.renderer);
  }
  // called every animation frame while the window is open
  frame() {
    if (!this.composer || this.busy || !this.sunDir) return false;
    this.syncCamera();
    const limit = this.moving ? 1 : this.maxSamples;
    if (this.samples >= limit && !this.dirty) return false;
    if (this.moving && this.samples >= 1) { this.reset(); }
    this.dirty = false;
    this.sample(); this.show();
    return true;
  }
  // ------------------------------------------------------------ still image
  async still(w, h, samples, onProgress, signal) {
    this.busy = true;
    const ow = this.W, oh = this.H, cs = this.canvas.style.cssText;
    const max = Math.min(this.renderer.capabilities.maxTextureSize, 8192);
    const k = Math.min(1, max / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
    this.canvas.style.width = this.canvas.clientWidth + 'px'; this.canvas.style.height = this.canvas.clientHeight + 'px';
    this.setSize(w, h); this.camera.aspect = w / h; this._camKey = null; this.syncCamera(); this.moving = false; clearTimeout(this._mv);
    this.reset();
    try {
      for (let i = 0; i < samples; i++) {
        if (signal?.aborted) throw new Error('cancelled');
        this.sample();
        onProgress?.((i + 1) / samples);
        if (i % 2 === 1) await new Promise((r) => setTimeout(r, 0));
      }
      this.show();
      const out = document.createElement('canvas'); out.width = w; out.height = h;
      out.getContext('2d').drawImage(this.canvas, 0, 0, w, h);
      return out;
    } finally {
      this.canvas.style.cssText = cs;
      this.setSize(ow, oh); this.camera.aspect = ow / oh; this._camKey = null; this.reset();
      this.busy = false;
    }
  }
  setOpt(patch) {
    const before = { ...this.opt }; Object.assign(this.opt, patch);
    const k = Object.keys(patch);
    const rebuild = k.some((x) => ['preset', 'seed', 'trees', 'people', 'cars', 'road', 'fence', 'neighbors', 'background', 'grass3d', 'autopaint', 'style'].includes(x) && before[x] !== this.opt[x]);
    const sky = k.some((x) => ['sky', 'hour', 'turn', 'sunMode', 'cover', 'haze', 'exposure', 'tone'].includes(x));
    if (k.includes('sunAim')) { const c = this.camState(); this.viewAz = Math.atan2(c.target.y - c.eye.y, c.target.x - c.eye.x); this.applySky(); return null; }
    if (k.includes('ao') && before.ao !== this.opt.ao) this.makeComposer();
    if (this.aoPass && k.includes('aoAmount')) { this.aoPass.blendIntensity = Math.min(1, 0.85 * this.opt.aoAmount); this.aoPass.updateGtaoMaterial({ scale: Math.max(0.5, this.opt.aoAmount) }); }
    if (this.bloom && k.includes('bloom')) this.bloom.strength = this.opt.bloom;
    if (rebuild) return this.build();
    if (sky) this.applySky();
    this.reset();
    return null;
  }
  pick(x, y) {
    // a point under the cursor (orbit pivot, focus)
    const ndc = new THREE.Vector2((x / this.canvas.clientWidth) * 2 - 1, -(y / this.canvas.clientHeight) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, this.camera);
    const hits = rc.intersectObjects(this.pickables || [], false);
    return hits[0]?.point || null;
  }
  dispose() {
    this.clearScene();
    this.composer?.dispose(); this.accA?.dispose(); this.accB?.dispose(); this.envRT?.dispose(); this.probeRT?.dispose(); this.probeEnv?.dispose();
    this.sky.dispose(); this.pmrem.dispose(); this.blend.dispose(); this.display.dispose();
    disposeSite();
    this.renderer.dispose(); this.renderer.forceContextLoss();
  }
}
