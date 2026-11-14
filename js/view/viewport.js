// WebGL viewport: scene graph, camera & navigation, picking, overlays.
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { buildEnts, surfaceMaterial, clearMatCache } from './builder.js';
import { entsBox, splitSel } from '../core/ops.js';
import { sectionSegments, sectionFill } from '../core/section.js';
import { basis, triangulate2 } from '../core/geom.js';
import { Overlay } from './overlay.js';

const SKY_FS = `
uniform mat4 uInvProj; uniform mat4 uCamWorld; uniform vec3 uBg; uniform vec3 uSky; uniform vec3 uGround;
uniform float uUseSky; uniform float uUseGround; uniform float uGroundAlpha; varying vec2 vNdc;
void main(){
  vec4 p = uInvProj * vec4(vNdc, 1.0, 1.0); p /= p.w;
  vec3 dir = normalize((uCamWorld * vec4(p.xyz, 0.0)).xyz);
  vec3 c = uBg;
  if (dir.z >= 0.0) { if (uUseSky > 0.5) { vec3 hz = mix(uSky, vec3(1.0), 0.55); c = mix(hz, uSky, smoothstep(0.0, 0.45, dir.z)); } }
  else if (uUseGround > 0.5) { c = mix(uBg, uGround, uGroundAlpha * smoothstep(0.0, 0.02, -dir.z)); }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;
const SKY_VS = `varying vec2 vNdc; void main(){ vNdc = position.xy; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const STIPPLE_FS = `uniform vec3 uColor; uniform float uStep;
void main(){ vec2 p = floor(gl_FragCoord.xy / uStep); if (mod(p.x, 2.0) > 0.5 || mod(p.y, 2.0) > 0.5) discard; gl_FragColor = vec4(uColor, 1.0); }`;
const STIPPLE_VS = `#include <common>
#include <clipping_planes_pars_vertex>
void main(){ vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;
#include <clipping_planes_vertex>
}`;

export class Viewport {
  constructor(app, el) {
    this.app = app; this.el = el;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, stencil: false }));
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.localClippingEnabled = true;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.autoClear = false;
    r.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(r.domElement);
    r.domElement.className = 'gl';
    this.overlay = new Overlay(this, el);
    this.scene = new THREE.Scene();
    this.persp = new THREE.PerspectiveCamera(35, 1, 10, 1e7); this.persp.up.set(0, 0, 1);
    this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1e7); this.orthoCam.up.set(0, 0, 1);
    this.cam = { eye: new THREE.Vector3(-7000, -9500, 6500), target: new THREE.Vector3(1500, 1500, 600), fov: 35, ortho: false, orthoH: 8000, upHint: new THREE.Vector3(0, 1, 0), twoPoint: false };
    // background
    this.bgScene = new THREE.Scene(); this.bgCam = new THREE.Camera();
    this.skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, depthWrite: false, depthTest: false, uniforms: {
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uBg: { value: new THREE.Color() }, uSky: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uUseSky: { value: 1 }, uUseGround: { value: 0 }, uGroundAlpha: { value: 0.5 } } });
    this.bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.skyMat));
    // lights
    this.ambient = new THREE.AmbientLight(0xffffff, 1.4);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.7);
    this.sun.shadow.mapSize.set(4096, 4096); this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 2;
    this.scene.add(this.ambient, this.sun, this.sun.target);
    this.modelGroup = new THREE.Group(); this.helpers = new THREE.Group(); this.selGroup = new THREE.Group(); this.toolGroup = new THREE.Group();
    this.scene.add(this.modelGroup, this.helpers, this.selGroup, this.toolGroup);
    this.groundShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.35, depthWrite: false }));
    this.groundShadow.receiveShadow = true; this.groundShadow.renderOrder = -1; this.groundShadow.visible = false;
    this.scene.add(this.groundShadow);
    // line materials
    this.lineMats = [];
    this.edgeMat = this.lm({ color: 0x1a1a1a, linewidth: 1 });
    this.edgeMatAxis = this.lm({ color: 0xffffff, linewidth: 1, vertexColors: true });
    this.edgeMatFade = this.lm({ color: 0xa9adb3, linewidth: 1, transparent: true, opacity: 0.7 });
    this.softMat = this.lm({ color: 0x6b7280, linewidth: 1, dashed: true, dashSize: 60, gapSize: 60, transparent: true, opacity: 0.8 });
    this.backEdgeMat = this.lm({ color: 0x6b6b6b, linewidth: 1, dashed: true, dashSize: 40, gapSize: 40, depthFunc: THREE.GreaterDepth, transparent: true, opacity: 0.6 });
    this.selEdgeMat = this.lm({ color: 0x0b57ff, linewidth: 2.2, depthTest: true });
    this.hoverEdgeMat = this.lm({ color: 0x3d8bff, linewidth: 2, transparent: true, opacity: 0.85 });
    this.cutMat = this.lm({ color: 0x050505, linewidth: 3.2 });
    this.ctxBoxMat = this.lm({ color: 0x5f6672, linewidth: 1, dashed: true, dashSize: 6, gapSize: 6, worldUnits: false });
    this.stipple = new THREE.ShaderMaterial({ vertexShader: STIPPLE_VS, fragmentShader: STIPPLE_FS, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, uniforms: { uColor: { value: new THREE.Color(0x0b57ff) }, uStep: { value: 1.5 * r.getPixelRatio() } }, clipping: true });
    this.hoverStipple = this.stipple.clone(); this.hoverStipple.uniforms.uColor.value = new THREE.Color(0x6aa6ff); this.hoverStipple.uniforms.uStep.value = 2 * r.getPixelRatio();
    this.raycaster = new THREE.Raycaster();
    this.dirty = true; this.frozen = false; this.anim = null;
    this.index = { pts: new Float32Array(0), kinds: new Uint8Array(0), edges: new Float32Array(0), erefs: [], prefs: [], guides: [] };
    this.clip = null;
    const ro = new ResizeObserver(() => this.resize()); ro.observe(el);
    this.resize();
    this.bindInput();
    const loop = () => { requestAnimationFrame(loop); this.tick(); };
    requestAnimationFrame(loop);
    window.addEventListener('sk-redraw', () => this.requestRender());
  }
  lm(o) { const m = new LineMaterial(o); this.lineMats.push(m); return m; }
  get camera() { return this.cam.ortho ? this.orthoCam : this.persp; }
  requestRender() { this.dirty = true; }

  resize() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px'; this.renderer.domElement.style.height = h + 'px';
    for (const m of this.lineMats) m.resolution.set(w, h);
    this.overlay.resize(w, h);
    this.applyCamera(); this.requestRender();
    // setSize cleared the drawing buffer: render before this frame is shown, not one frame later (blank flash)
    if (this.app.model) { try { this.dirty = false; this.render(); } catch { this.dirty = true; } }
  }

  // ------------------------------------------------------------ camera
  sceneBox() {
    if (!this._box || this._boxV !== this.app.geomVersion) {
      this._box = entsBox(this.app.model, this.app.model.root, new THREE.Matrix4(), new THREE.Box3(), { visibleOnly: true });
      this._boxV = this.app.geomVersion;
    }
    return this._box;
  }
  applyCamera() {
    const c = this.cam, aspect = this.w / this.h;
    const fwd = c.target.clone().sub(c.eye);
    const dist = fwd.length() || 1; fwd.divideScalar(dist);
    const vertical = Math.abs(fwd.z) > 0.9999;
    const up = vertical ? c.upHint.clone() : new THREE.Vector3(0, 0, 1);
    const box = this.sceneBox();
    const r = box.isEmpty() ? 20000 : Math.max(2000, box.getSize(new THREE.Vector3()).length());
    const dBox = box.isEmpty() ? dist : box.distanceToPoint(c.eye);
    const p = this.persp;
    p.position.copy(c.eye); p.up.copy(up); p.lookAt(c.target);
    p.fov = c.fov; p.aspect = aspect;
    p.near = Math.max(1, Math.min(dBox * 0.5, dist * 0.05)); if (dBox < 1) p.near = Math.max(1, Math.min(50, dist * 0.02));
    p.far = Math.max(dist, dBox) + r * 6 + 2e5;
    if (c.twoPoint && !vertical) {
      // keep verticals vertical: look horizontally and shift the lens
      const hf = new THREE.Vector3(fwd.x, fwd.y, 0).normalize();
      p.lookAt(c.eye.clone().add(hf));
      const ang = Math.asin(fwd.z);
      const shift = Math.tan(ang) / Math.tan(THREE.MathUtils.degToRad(c.fov) / 2);
      p.updateProjectionMatrix();
      p.projectionMatrix.elements[9] = shift; p.projectionMatrixInverse.copy(p.projectionMatrix).invert();
    } else p.updateProjectionMatrix();
    const o = this.orthoCam, H = c.orthoH;
    o.left = (-H * aspect) / 2; o.right = (H * aspect) / 2; o.top = H / 2; o.bottom = -H / 2;
    const back = r * 4 + dist;
    o.position.copy(c.target).addScaledVector(fwd, -back); o.up.copy(up); o.lookAt(c.target);
    o.near = 1; o.far = back * 2 + r * 4; o.updateProjectionMatrix();
    this.persp.updateMatrixWorld(); this.orthoCam.updateMatrixWorld();
    this.requestRender();
    this.app.emit?.('camera');
  }
  viewDir() { return this.cam.target.clone().sub(this.cam.eye).normalize(); }
  pivotAt(x, y) {
    const hit = this.pickFace(x, y);
    if (hit) return hit.point;
    const ray = this.rayAt(x, y), n = this.viewDir();
    const t = this.cam.target.clone().sub(ray.o).dot(n) / ray.d.dot(n);
    return ray.o.clone().addScaledVector(ray.d, t > 0 ? t : this.cam.eye.distanceTo(this.cam.target));
  }
  orbit(dx, dy, pivot) {
    const c = this.cam, k = 0.0065;
    pivot = pivot || c.target;
    const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -dx * k);
    const rot = (p) => p.sub(pivot).applyQuaternion(qz).add(pivot);
    rot(c.eye); rot(c.target); c.upHint.applyQuaternion(qz);
    const fwd = c.target.clone().sub(c.eye).normalize();
    const vertical = Math.abs(fwd.z) > 0.9999;
    const right = fwd.clone().cross(vertical ? c.upHint : new THREE.Vector3(0, 0, 1)).normalize();
    const qx = new THREE.Quaternion().setFromAxisAngle(right, -dy * k);
    const ne = c.eye.clone().sub(pivot).applyQuaternion(qx).add(pivot);
    const nt = c.target.clone().sub(pivot).applyQuaternion(qx).add(pivot);
    const nf = nt.clone().sub(ne).normalize();
    if (Math.abs(nf.z) < 0.9995 && right.dot(nf.clone().cross(new THREE.Vector3(0, 0, 1))) > 0) { c.eye.copy(ne); c.target.copy(nt); }
    if (Math.abs(c.target.clone().sub(c.eye).normalize().z) < 0.9999) c.upHint.copy(right.clone().cross(nf).normalize());
    this.applyCamera();
  }
  pan(dx, dy, depthPoint) {
    const c = this.cam, cam = this.camera;
    const fwd = this.viewDir();
    let wpp;
    if (c.ortho) wpp = c.orthoH / this.h;
    else { const depth = depthPoint ? depthPoint.clone().sub(c.eye).dot(fwd) : c.eye.distanceTo(c.target); wpp = (2 * Math.max(depth, 1) * Math.tan(THREE.MathUtils.degToRad(c.fov) / 2)) / this.h; }
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const mv = right.multiplyScalar(-dx * wpp).add(up.multiplyScalar(dy * wpp));
    c.eye.add(mv); c.target.add(mv);
    this.applyCamera();
  }
  zoomAt(factor, x, y) {
    const c = this.cam;
    const p = x == null ? c.target.clone() : this.pivotAt(x, y);
    if (c.ortho) {
      const before = this.worldAtScreenOrtho(x ?? this.w / 2, y ?? this.h / 2);
      c.orthoH = Math.max(1, c.orthoH * factor);
      this.applyCamera();
      const after = this.worldAtScreenOrtho(x ?? this.w / 2, y ?? this.h / 2);
      const d = before.sub(after); c.eye.add(d); c.target.add(d);
      this.applyCamera(); return;
    }
    const d = p.clone().sub(c.eye);
    const dist = d.length();
    let move = d.multiplyScalar(1 - factor);
    if (factor < 1 && dist * factor < 20) move = new THREE.Vector3();
    c.eye.add(move); c.target.add(move);
    // keep target in front at a sensible distance
    const fwd = this.viewDir(); const td = c.target.clone().sub(c.eye).dot(fwd);
    if (td < dist * 0.2) c.target.copy(c.eye).addScaledVector(fwd, Math.max(dist * factor, 100));
    this.applyCamera();
  }
  worldAtScreenOrtho(x, y) {
    const ndc = new THREE.Vector3((x / this.w) * 2 - 1, -(y / this.h) * 2 + 1, 0);
    return ndc.unproject(this.orthoCam);
  }
  fov(deg) { this.cam.fov = Math.max(1, Math.min(120, deg)); this.applyCamera(); }
  setOrtho(on) {
    const c = this.cam; if (c.ortho === on) return;
    if (on) c.orthoH = 2 * c.eye.distanceTo(c.target) * Math.tan(THREE.MathUtils.degToRad(c.fov) / 2);
    else { const d = c.orthoH / (2 * Math.tan(THREE.MathUtils.degToRad(c.fov) / 2)); c.eye.copy(c.target).addScaledVector(this.viewDir(), -d); }
    c.ortho = on; this.applyCamera();
  }
  zoomExtents(box, animate = true) {
    box = box || this.sceneBox();
    if (box.isEmpty()) box = new THREE.Box3(new THREE.Vector3(-2000, -2000, 0), new THREE.Vector3(6000, 6000, 3000));
    const ctr = box.getCenter(new THREE.Vector3()), rad = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 100);
    const fwd = this.viewDir();
    const aspect = this.w / this.h;
    const half = THREE.MathUtils.degToRad(this.cam.fov) / 2;
    const fit = Math.min(half, Math.atan(Math.tan(half) * aspect));
    const dist = (rad / Math.sin(fit)) * 1.02;
    const to = { eye: ctr.clone().addScaledVector(fwd, -dist), target: ctr, orthoH: (2 * rad * 1.05) / Math.min(1, aspect) };
    this.animateTo(to, animate ? 350 : 0);
  }
  standardView(name) {
    const box = this.sceneBox();
    const ctr = box.isEmpty() ? new THREE.Vector3(1500, 1500, 500) : box.getCenter(new THREE.Vector3());
    const dirs = { top: [0, 0, -1], bottom: [0, 0, 1], front: [0, 1, 0], back: [0, -1, 0], left: [1, 0, 0], right: [-1, 0, 0], iso: [1, 1, -0.82] };
    const fwd = new THREE.Vector3(...dirs[name]).normalize();
    const d = this.cam.eye.distanceTo(this.cam.target);
    this.cam.upHint.set(0, 1, 0);
    if (name === 'bottom') this.cam.upHint.set(0, -1, 0);
    this.animateTo({ eye: ctr.clone().addScaledVector(fwd, -d), target: ctr }, 0);
    this.zoomExtents(null, false);
    this.app.emit?.('view', name);
  }
  animateTo(to, ms = 400) {
    const c = this.cam;
    const from = { eye: c.eye.clone(), target: c.target.clone(), orthoH: c.orthoH, fov: c.fov };
    if (!ms) { c.eye.copy(to.eye); c.target.copy(to.target); if (to.orthoH) c.orthoH = to.orthoH; if (to.fov) c.fov = to.fov; this.applyCamera(); return; }
    this.anim = { from, to, t0: performance.now(), ms };
  }
  saveCamera() { const c = this.cam; return { eye: c.eye.toArray(), target: c.target.toArray(), fov: c.fov, ortho: c.ortho, orthoH: c.orthoH, upHint: c.upHint.toArray(), twoPoint: c.twoPoint }; }
  loadCamera(s, ms = 0) {
    if (!s) return;
    this.cam.ortho = !!s.ortho; this.cam.twoPoint = !!s.twoPoint; this.cam.upHint.fromArray(s.upHint || [0, 1, 0]);
    this.animateTo({ eye: new THREE.Vector3(...s.eye), target: new THREE.Vector3(...s.target), orthoH: s.orthoH, fov: s.fov }, ms);
  }
  pushHistory() {
    const h = (this.camHist = this.camHist || { list: [], i: -1 });
    const s = JSON.stringify(this.saveCamera());
    if (h.list[h.i] === s) return;
    h.list = h.list.slice(0, h.i + 1); h.list.push(s); if (h.list.length > 50) h.list.shift(); h.i = h.list.length - 1;
  }
  prevView() { const h = this.camHist; if (!h || h.i <= 0) return; h.i--; this.loadCamera(JSON.parse(h.list[h.i]), 300); }
  nextView() { const h = this.camHist; if (!h || h.i >= h.list.length - 1) return; h.i++; this.loadCamera(JSON.parse(h.list[h.i]), 300); }

  // ------------------------------------------------------------ picking
  rayAt(x, y) {
    const ndc = new THREE.Vector2((x / this.w) * 2 - 1, -(y / this.h) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return { o: this.raycaster.ray.origin.clone(), d: this.raycaster.ray.direction.clone() };
  }
  project(p) {
    const v = p.clone().project(this.camera);
    return { x: ((v.x + 1) / 2) * this.w, y: ((1 - v.y) / 2) * this.h, z: v.z, behind: v.z > 1 || v.z < -1 };
  }
  pickFace(x, y, opts = {}) {
    const ndc = new THREE.Vector2((x / this.w) * 2 - 1, -(y / this.h) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables || [], false);
    for (const h of hits) {
      const ud = h.object.userData;
      if (this.clip && this.clip.distanceToPoint(h.point) < -0.5) continue;
      if (opts.skip && opts.skip(ud)) continue;
      const fid = ud.tri[h.faceIndex];
      const f = ud.ents.faces.get(fid); if (!f) continue;
      const nm = new THREE.Matrix3().getNormalMatrix(h.object.matrixWorld);
      return { point: h.point.clone(), dist: h.distance, faceId: fid, face: f, ents: ud.ents, path: ud.path, matrix: h.object.matrixWorld.clone(), normal: f.n.clone().applyMatrix3(nm).normalize(), back: ud.back };
    }
    return null;
  }

  // ------------------------------------------------------------ scene build
  rebuild() {
    const app = this.app, model = app.model, st = model.style;
    this.modelGroup.clear();
    this.pickables = [];
    const hiddenTags = [...model.tags.values()].filter((t) => t.visible === false).map((t) => t.id).join(',');
    const key = `${st.hidden ? 1 : 0}|${hiddenTags}|${app.matVersion}`;
    const ctx = app.ctxPath;
    this.computeClip();
    const clip = this.clip ? [this.clip] : null;
    const clipKey = this.clip ? this.clip.normal.toArray().join(',') + this.clip.constant : '';
    for (const m of [this.edgeMat, this.edgeMatAxis, this.edgeMatFade, this.softMat, this.backEdgeMat, this.selEdgeMat, this.hoverEdgeMat]) m.clippingPlanes = clip;
    this.stipple.clippingPlanes = clip; this.hoverStipple.clippingPlanes = clip;
    const edgeColor = new THREE.Color(st.edgeRGB);
    this.edgeMat.color.copy(edgeColor);
    const shadows = model.shadow.on;
    const visTag = (t) => { const x = model.tags.get(t || 0); return !x || x.visible !== false; };
    const rec = (ents, parent, path, instMat, inCtx) => {
      const b = buildEnts(ents, model, key);
      const fade = ctx.length > 0 && !inCtx && st.fadeOthers;
      const mk = (geo, keys, tri, side, back) => {
        if (!geo.index || !geo.index.count) return;
        const mats = keys.map((k) => surfaceMaterial(model, k, { side, instMat, fade, matVersion: app.matVersion, clip, clipKey }));
        const mesh = new THREE.Mesh(geo, mats);
        mesh.userData = { ents, path, tri, back, inCtx };
        mesh.castShadow = shadows && model.shadow.onFaces !== false; mesh.receiveShadow = shadows;
        if (st.faceMode === 'wire') mesh.visible = false;
        parent.add(mesh); this.pickables.push(mesh);
      };
      mk(b.front, b.frontKeys, b.frontTri, THREE.FrontSide, false);
      mk(b.back, b.backKeys, b.backTri, THREE.BackSide, true);
      if (st.edges || st.faceMode === 'wire') {
        if (b.hasEdges) {
          const ls = new LineSegments2(b.edges, fade ? this.edgeMatFade : st.edgeColor === 'axis' ? this.edgeMatAxis : this.edgeMat);
          ls.userData = { edges: true }; parent.add(ls);
          if (st.backEdges && st.faceMode !== 'wire' && !st.xray) { const be = new LineSegments2(b.edges, this.backEdgeMat); be.computeLineDistances(); parent.add(be); }
        }
      }
      if (b.hasSoft && st.hidden) { const sl = new LineSegments2(b.soft, this.softMat); sl.computeLineDistances(); parent.add(sl); }
      for (const inst of ents.insts.values()) {
        if (!visTag(inst.tag)) continue;
        if (inst.hidden && !st.hidden) continue;
        const def = model.defs.get(inst.def); if (!def) continue;
        const o = new THREE.Group(); o.matrixAutoUpdate = false; o.matrix.copy(inst.m);
        o.userData = { inst: inst.id, faceCam: def.faceCam };
        parent.add(o);
        const np = [...path, inst.id];
        const nowIn = inCtx || (ctx.length && np.length === ctx.length && np.every((x, i) => x === ctx[i]));
        rec(def.ents, o, np, inst.mat ?? instMat, nowIn && (ctx.length <= np.length));
      }
    };
    rec(model.root, this.modelGroup, [], null, ctx.length === 0);
    this.modelGroup.updateMatrixWorld(true);
    this.updateFaceCam();
    this.rebuildHelpers();
    if (!this.frozen) this.buildIndex();
    this.updateLights();
    this.rebuildSelection();
    this.requestRender();
  }
  updateFaceCam() {
    const fwd = this.viewDir();
    const ang = Math.atan2(-fwd.x, fwd.y);
    this.modelGroup.traverse((o) => {
      if (!o.userData.faceCam) return;
      const inst = this.app.findInst(o.userData.inst); if (!inst) return;
      const pos = new THREE.Vector3().setFromMatrixPosition(inst.m);
      o.matrix.copy(new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z).multiply(new THREE.Matrix4().makeRotationZ(ang)));
    });
    this.modelGroup.updateMatrixWorld(true);
  }
  computeClip() {
    this.clip = null; this.activeSection = null;
    const model = this.app.model;
    const id = model.activeSection;
    if (id == null) return;
    const found = this.app.findSection(id);
    if (!found) { model.activeSection = null; return; }
    const { sec, matrix } = found;
    const p = sec.p.clone().applyMatrix4(matrix), n = sec.n.clone().transformDirection(matrix);
    this.clip = new THREE.Plane(n.clone().negate(), n.dot(p));
    this.activeSection = { p, n, d: n.dot(p), id };
  }
  rebuildHelpers() {
    const app = this.app, model = app.model, st = model.style;
    this.helpers.clear();
    // axes
    if (st.axes) {
      const ax = model.axesM || new THREE.Matrix4();
      const o = new THREE.Vector3().setFromMatrixPosition(ax);
      const L = 1e6;
      const cols = [0xd62d20, 0x0f9d58, 0x1e5bd8];
      for (let i = 0; i < 3; i++) {
        const d = new THREE.Vector3().setFromMatrixColumn(ax, i).normalize();
        const pos = new LineSegmentsGeometry().setPositions([o.x, o.y, o.z, o.x + d.x * L, o.y + d.y * L, o.z + d.z * L]);
        const neg = new LineSegmentsGeometry().setPositions([o.x, o.y, o.z, o.x - d.x * L, o.y - d.y * L, o.z - d.z * L]);
        const m1 = this.lm({ color: cols[i], linewidth: 1.4 }), m2 = this.lm({ color: cols[i], linewidth: 1.2, dashed: true, dashSize: 8, gapSize: 6, worldUnits: false });
        m1.resolution.set(this.w, this.h); m2.resolution.set(this.w, this.h);
        const l2 = new LineSegments2(neg, m2); l2.computeLineDistances();
        this.helpers.add(new LineSegments2(pos, m1), l2);
      }
    }
    // guides, sections (collect world positions)
    this.annots = [];
    const gl = [];
    const visTag = (t) => { const x = model.tags.get(t || 0); return !x || x.visible !== false; };
    const walk = (ents, m, path) => {
      for (const g of ents.guides.values()) {
        if (!st.guides) break;
        const p = g.p.clone().applyMatrix4(m);
        if (g.kind === 'line') { const d = g.dir.clone().transformDirection(m), L = 2e5; gl.push(p.x - d.x * L, p.y - d.y * L, p.z - d.z * L, p.x + d.x * L, p.y + d.y * L, p.z + d.z * L); }
        else this.annots.push({ type: 'gpoint', p, key: 'g' + g.id, path });
      }
      for (const d of ents.dims.values()) if (visTag(d.tag)) this.annots.push({ type: 'dim', a: d.a.clone().applyMatrix4(m), b: d.b.clone().applyMatrix4(m), off: d.off.clone().transformDirection(m).multiplyScalar(d.off.length()), text: d.text, key: 'd' + d.id, path, kind: d.kind, r: d.r });
      for (const t of ents.texts.values()) if (visTag(t.tag)) this.annots.push({ type: 'text', p: t.p.clone().applyMatrix4(m), at: t.at ? t.at.clone().applyMatrix4(m) : null, text: t.text, key: 't' + t.id, path, screen: t.screen, sx: t.sx, sy: t.sy });
      for (const s of ents.sections.values()) if (st.sectionPlanes) this.addSectionGizmo(s, m, path);
      for (const inst of ents.insts.values()) {
        if ((inst.hidden && !st.hidden) || !visTag(inst.tag)) continue;
        const d = model.defs.get(inst.def); if (d) walk(d.ents, m.clone().multiply(inst.m), [...path, inst.id]);
      }
    };
    walk(model.root, new THREE.Matrix4(), []);
    if (gl.length) {
      const g = new LineSegmentsGeometry().setPositions(gl);
      const m = this.lm({ color: 0x51565e, linewidth: 1, dashed: true, dashSize: 7, gapSize: 5, worldUnits: false, transparent: true, opacity: 0.9 });
      m.resolution.set(this.w, this.h);
      const l = new LineSegments2(g, m); l.computeLineDistances(); this.helpers.add(l);
    }
    // context box
    if (app.ctxPath.length) {
      const { ents, matrix } = app.ctxInfo();
      const b = entsBox(model, ents, new THREE.Matrix4());
      if (!b.isEmpty()) {
        b.expandByScalar(Math.max(5, b.getSize(new THREE.Vector3()).length() * 0.01));
        this.helpers.add(this.boxLines(b, matrix, this.ctxBoxMat));
      }
    }
    // section cut lines + fill
    if (this.activeSection && st.sectionCuts) {
      const { n, d } = this.activeSection;
      const segs = sectionSegments(model, n, d);
      if (segs.length) {
        const g = new LineSegmentsGeometry().setPositions(segs.flatMap(([a, b]) => [a.x, a.y, a.z, b.x, b.y, b.z]));
        this.helpers.add(new LineSegments2(g, this.cutMat));
        if (st.sectionFill) {
          const { pos } = sectionFill(segs, n, d);
          if (pos.length) {
            const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: st.sectionFillRGB, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
            this.helpers.add(mesh);
          }
        }
      }
    }
    // ground shadow plane
    const box = this.sceneBox();
    const sz = box.isEmpty() ? 20000 : box.getSize(new THREE.Vector3()).length() * 6 + 5000;
    const c = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    this.groundShadow.scale.set(sz, sz, 1); this.groundShadow.position.set(c.x, c.y, 0);
  }
  addSectionGizmo(s, m, path) {
    const p = s.p.clone().applyMatrix4(m), n = s.n.clone().transformDirection(m);
    const { u, v } = basis(n);
    const box = this.sceneBox();
    const R = box.isEmpty() ? 2000 : Math.max(600, box.getSize(new THREE.Vector3()).length() * 0.18);
    const pts = [];
    const corner = (a, b) => p.clone().addScaledVector(u, a * R).addScaledVector(v, b * R);
    const sq = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    for (let i = 0; i < 4; i++) pts.push(...sq[i].toArray(), ...sq[(i + 1) % 4].toArray());
    // arrows at the corners pointing along n (the viewed side)
    for (const c of sq) {
      const t = c.clone().addScaledVector(n, -R * 0.25);
      pts.push(...c.toArray(), ...t.toArray());
      const side = c.clone().sub(p).normalize().multiplyScalar(R * 0.06);
      pts.push(...t.toArray(), ...t.clone().addScaledVector(n, R * 0.08).add(side).toArray());
      pts.push(...t.toArray(), ...t.clone().addScaledVector(n, R * 0.08).sub(side).toArray());
    }
    const active = this.app.model.activeSection === s.id;
    const sel = this.app.ctxPathEq(path) && this.app.sel.has('s' + s.id);
    const mat = this.lm({ color: sel ? 0x0b57ff : active ? 0xe67e22 : 0x9a9a9a, linewidth: active ? 2 : 1.4 });
    mat.resolution.set(this.w, this.h);
    const l = new LineSegments2(new LineSegmentsGeometry().setPositions(pts), mat);
    l.userData = { section: s.id, path };
    this.helpers.add(l);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2 * R, 2 * R), new THREE.MeshBasicMaterial({ color: active ? 0xf0a050 : 0xb0b0b0, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
    plane.position.copy(p); plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, n));
    this.helpers.add(plane);
    (this.sectionHandles = this.sectionHandles || []).push({ id: s.id, path, p, n, R, sq });
  }
  boxLines(b, matrix, mat) {
    const c = [
      [b.min.x, b.min.y, b.min.z], [b.max.x, b.min.y, b.min.z], [b.max.x, b.max.y, b.min.z], [b.min.x, b.max.y, b.min.z],
      [b.min.x, b.min.y, b.max.z], [b.max.x, b.min.y, b.max.z], [b.max.x, b.max.y, b.max.z], [b.min.x, b.max.y, b.max.z],
    ].map((a) => new THREE.Vector3(...a).applyMatrix4(matrix));
    const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    const l = new LineSegments2(new LineSegmentsGeometry().setPositions(E.flatMap(([i, j]) => [...c[i].toArray(), ...c[j].toArray()])), mat);
    l.computeLineDistances();
    return l;
  }

  // ------------------------------------------------------------ selection display
  rebuildSelection() {
    this.selGroup.clear();
    const app = this.app;
    const { ents, matrix } = app.ctxInfo();
    const sel = app.sel;
    const addSel = (keys, stip, emat) => {
      const s = splitSel(keys);
      const pos = [];
      for (const id of s.faces) {
        const f = ents.faces.get(id); if (!f) continue;
        const { u, v } = basis(f.n);
        const l2 = f.loops.map((l) => l.map((x) => { const p = ents.P(x); return [p.dot(u), p.dot(v)]; }));
        const all = f.loops.flat();
        for (const t of triangulate2(l2[0], l2.slice(1))) for (const k of t) { const p = ents.P(all[k]).clone().applyMatrix4(matrix); pos.push(p.x, p.y, p.z); }
      }
      if (pos.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); this.selGroup.add(new THREE.Mesh(g, stip)); }
      const ep = [];
      for (const id of s.edges) { const e = ents.edges.get(id); if (!e) continue; const a = ents.P(e.a).clone().applyMatrix4(matrix), b = ents.P(e.b).clone().applyMatrix4(matrix); ep.push(a.x, a.y, a.z, b.x, b.y, b.z); }
      if (ep.length) this.selGroup.add(new LineSegments2(new LineSegmentsGeometry().setPositions(ep), emat));
      for (const id of s.insts) {
        const inst = ents.insts.get(id); if (!inst) continue;
        const def = app.model.defs.get(inst.def); if (!def) continue;
        const b = entsBox(app.model, def.ents, new THREE.Matrix4());
        if (b.isEmpty()) continue;
        const mm = matrix.clone().multiply(inst.m);
        this.selGroup.add(this.boxLines(b, mm, inst.locked ? this.lm({ color: 0xd62d20, linewidth: 1.6 }) : emat));
      }
      const gp = [];
      for (const id of s.guides) {
        const g = ents.guides.get(id); if (!g || g.kind !== 'line') continue;
        const p = g.p.clone().applyMatrix4(matrix), d = g.dir.clone().transformDirection(matrix);
        gp.push(...p.clone().addScaledVector(d, -2e5).toArray(), ...p.clone().addScaledVector(d, 2e5).toArray());
      }
      if (gp.length) this.selGroup.add(new LineSegments2(new LineSegmentsGeometry().setPositions(gp), emat));
    };
    addSel(sel, this.stipple, this.selEdgeMat);
    if (app.hover && app.hover.size) addSel(app.hover, this.hoverStipple, this.hoverEdgeMat);
    for (const m of this.lineMats) m.resolution.set(this.w, this.h);
    this.requestRender();
  }

  // ------------------------------------------------------------ inference index
  buildIndex() {
    const app = this.app, model = app.model;
    const pts = [], kinds = [], prefs = [], edges = [], erefs = [], guides = [];
    const visTag = (t) => { const x = model.tags.get(t || 0); return !x || x.visible !== false; };
    const walk = (ents, m, path) => {
      const W = new Map();
      const w = (id) => { let p = W.get(id); if (!p) { p = ents.P(id).clone().applyMatrix4(m); W.set(id, p); } return p; };
      for (const e of ents.edges.values()) {
        if (!visTag(e.tag) || ((e.soft || e.hidden) && !model.style.hidden)) continue;
        const a = w(e.a), b = w(e.b);
        edges.push(a.x, a.y, a.z, b.x, b.y, b.z); erefs.push({ ents, id: e.id, path });
        if (e.curve == null) { pts.push((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); kinds.push(2); prefs.push({ ents, edge: e.id, path }); }
      }
      for (const [id, s] of ents.vedges) {
        if (!s.size) continue;
        let vis = false; for (const eid of s) { const e = ents.edges.get(eid); if (!e.soft && !e.hidden && visTag(e.tag)) { vis = true; break; } }
        if (!vis) continue;
        const p = w(id); pts.push(p.x, p.y, p.z); kinds.push(1); prefs.push({ ents, v: id, path });
      }
      for (const c of ents.curves.values()) { const p = c.center.clone().applyMatrix4(m); pts.push(p.x, p.y, p.z); kinds.push(3); prefs.push({ ents, curve: c.id, path }); }
      for (const g of ents.guides.values()) {
        if (!model.style.guides) break;
        const p = g.p.clone().applyMatrix4(m);
        if (g.kind === 'line') guides.push({ p, d: g.dir.clone().transformDirection(m), id: g.id, path });
        else { pts.push(p.x, p.y, p.z); kinds.push(4); prefs.push({ ents, guide: g.id, path }); }
      }
      for (const inst of ents.insts.values()) {
        if ((inst.hidden && !model.style.hidden) || !visTag(inst.tag)) continue;
        const d = model.defs.get(inst.def); if (d) walk(d.ents, m.clone().multiply(inst.m), [...path, inst.id]);
      }
    };
    walk(model.root, new THREE.Matrix4(), []);
    this.index = { pts: Float32Array.from(pts), kinds: Uint8Array.from(kinds), prefs, edges: Float32Array.from(edges), erefs, guides };
  }

  // ------------------------------------------------------------ lights / shadows / fog
  updateLights() {
    const model = this.app.model, sh = model.shadow, st = model.style;
    const dir = sunDirection(model.geo, sh);
    const box = this.sceneBox();
    const c = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const R = box.isEmpty() ? 10000 : Math.max(2000, box.getSize(new THREE.Vector3()).length());
    const lightDir = dir.z > 0.05 ? dir : new THREE.Vector3(0.3, -0.5, 0.8).normalize();
    this.sun.position.copy(c).addScaledVector(lightDir, R * 2);
    this.sun.target.position.copy(c);
    this.sun.target.updateMatrixWorld();
    const L = (sh.light ?? 80) / 100, D = (sh.dark ?? 45) / 100;
    this.sun.intensity = 0.4 + L * 1.9; this.ambient.intensity = 0.55 + D * 1.7;
    const s = this.sun.shadow.camera;
    s.left = -R * 1.2; s.right = R * 1.2; s.top = R * 1.2; s.bottom = -R * 1.2; s.near = 1; s.far = R * 5; s.updateProjectionMatrix();
    this.sun.castShadow = !!sh.on && dir.z > 0;
    this.groundShadow.visible = !!sh.on && sh.onGround !== false && dir.z > 0;
    this.groundShadow.material.opacity = 0.15 + (1 - D) * 0.4;
    this.renderer.shadowMap.needsUpdate = true;
    // fog
    const f = model.fog;
    if (f.on) {
      const d0 = this.cam.eye.distanceTo(c);
      this.scene.fog = new THREE.Fog(f.useBg ? st.bg : f.color, Math.max(1, d0 - R + 2 * R * f.start), Math.max(2, d0 - R + 2 * R * f.end));
    } else this.scene.fog = null;
  }

  // ------------------------------------------------------------ render
  tick() {
    if (this.anim) {
      const a = this.anim, t = Math.min(1, (performance.now() - a.t0) / a.ms), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.cam.eye.lerpVectors(a.from.eye, a.to.eye, e); this.cam.target.lerpVectors(a.from.target, a.to.target, e);
      if (a.to.orthoH) this.cam.orthoH = a.from.orthoH + (a.to.orthoH - a.from.orthoH) * e;
      if (a.to.fov) this.cam.fov = a.from.fov + (a.to.fov - a.from.fov) * e;
      this.applyCamera();
      if (t >= 1) { this.anim = null; this.app.emit?.('camera-end'); }
    }
    if (!this.dirty || this.suspended) return;
    this.dirty = false;
    this.render();
  }
  render() {
    const r = this.renderer, model = this.app.model, st = model.style;
    this.skyMat.uniforms.uInvProj.value.copy(this.persp.projectionMatrixInverse);
    this.skyMat.uniforms.uCamWorld.value.copy(this.persp.matrixWorld);
    this.skyMat.uniforms.uBg.value.set(st.bg); this.skyMat.uniforms.uSky.value.set(st.skyRGB); this.skyMat.uniforms.uGround.value.set(st.groundRGB);
    this.skyMat.uniforms.uUseSky.value = st.sky ? 1 : 0; this.skyMat.uniforms.uUseGround.value = st.ground ? 1 : 0; this.skyMat.uniforms.uGroundAlpha.value = st.groundOpacity ?? 0.5;
    if (this.modelGroup.children.length && this._faceCamDir !== this.viewDir().toArray().join()) { this._faceCamDir = this.viewDir().toArray().join(); this.updateFaceCam(); }
    r.clear();
    r.render(this.bgScene, this.bgCam);
    r.render(this.scene, this.camera);
    this.overlay.draw();
  }
  snapshot(w, h, opts = {}) {
    const ow = this.w, oh = this.h;
    const pr = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    for (const m of this.lineMats) m.resolution.set(w, h);
    const oldW = this.w, oldH = this.h; this.w = w; this.h = h; this.applyCamera();
    this.overlay.resize(w, h, 1);
    this.render();
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (!opts.transparent) { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
    g.drawImage(this.renderer.domElement, 0, 0, w, h);
    g.drawImage(this.overlay.canvas, 0, 0, w, h);
    this.renderer.setPixelRatio(pr);
    this.w = oldW; this.h = oldH;
    this.resize();
    void ow; void oh;
    return c;
  }

  // ------------------------------------------------------------ input
  // navigation preferences (Preferences › Navigation); older files only had trackpad/invertZoom/zoomSpeed
  navCfg() {
    const s = this.app.settings || {}, o = { ...NAV_DEFAULTS };
    for (const k of Object.keys(NAV_DEFAULTS)) if (s[k] != null) o[k] = s[k];
    if (s.wheelMode == null && s.trackpad === false) o.wheelMode = 'mouse';
    return o;
  }
  // orbit / pan with the sensitivity of the input device that produced the movement
  navOrbit(dx, dy, pivot, src = 'mouse') {
    const N = this.navCfg(), k = src === 'touch' ? N.touchOrbitSpeed : src === 'trackpad' ? N.tpOrbitSpeed : N.orbitSpeed;
    this.orbit(dx * k * (N.invertOrbitX ? -1 : 1), dy * k * (N.invertOrbitY ? -1 : 1), pivot);
  }
  navPan(dx, dy, pivot, src = 'mouse') {
    const N = this.navCfg(), k = src === 'touch' ? N.touchPanSpeed : src === 'trackpad' ? N.tpPanSpeed : N.panSpeed;
    this.pan(dx * k, dy * k, pivot);
  }
  navPivot(x, y, src = 'mouse') {
    const m = this.navCfg().orbitPivot;
    return m === 'center' || (m === 'auto' && src === 'trackpad') ? this.pivotAt(this.w / 2, this.h / 2) : this.pivotAt(x, y);
  }
  // true when a wheel event most likely comes from a trackpad two-finger swipe
  isTrackpadWheel(e) {
    const m = this.navCfg().wheelMode;
    if (m === 'mouse') return false;
    if (m === 'trackpad') return true;
    return e.deltaMode === 0 && (Math.abs(e.deltaX) > 0.01 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 40);
  }
  bindInput() {
    const el = this.renderer.domElement, app = this.app;
    el.tabIndex = 0;
    const pos = (e) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    let nav = null; const touches = new Map(); let gest = null;
    const evOf = (e) => { const p = pos(e); return { x: p.x, y: p.y, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, button: e.button, buttons: e.buttons, raw: e, time: performance.now() }; };
    el.addEventListener('pointerdown', (e) => {
      el.focus({ preventScroll: true });
      app.ui?.closeMenus();
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, pos(e));
        if (touches.size >= 2) { gest = this.gestureState(touches); app.tool?.cancelDrag?.(); return; }
      }
      if (e.button === 1 || (e.button === 0 && e.pointerType === 'mouse' && app.spaceNav)) {
        e.preventDefault();
        const p = pos(e);
        const now = performance.now();
        if (e.button === 1 && this._lastMid && now - this._lastMid < 320) { const hit = this.pickFace(p.x, p.y); if (hit) { const d = hit.point.clone().sub(this.cam.target); this.animateTo({ eye: this.cam.eye.clone().add(d), target: hit.point }, 250); } this._lastMid = 0; return; }
        this._lastMid = now;
        const panFirst = this.navCfg().middleButton === 'pan';
        nav = { x: p.x, y: p.y, pivot: this.navPivot(p.x, p.y), panFirst, moved: false };
        el.setPointerCapture(e.pointerId);
        app.setCursor(e.shiftKey !== panFirst ? 'pan' : 'orbit', true);
        return;
      }
      if (e.button === 2) { this._rdown = pos(e); return; }
      el.setPointerCapture(e.pointerId);
      app.toolEvent('down', evOf(e));
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
        touches.set(e.pointerId, pos(e));
        if (gest && touches.size >= 2) { this.applyGesture(gest, touches); return; }
      }
      if (nav) {
        const p = pos(e), dx = p.x - nav.x, dy = p.y - nav.y; nav.x = p.x; nav.y = p.y; nav.moved = true;
        if (e.shiftKey !== nav.panFirst) this.navPan(dx, dy, nav.pivot); else this.navOrbit(dx, dy, nav.pivot);
        return;
      }
      app.toolEvent('move', evOf(e));
    });
    const up = (e) => {
      if (e.pointerType === 'touch') {
        touches.delete(e.pointerId);
        // a finger lifted: restart the gesture from the remaining fingers so the view does not jump
        if (gest) { gest = touches.size >= 2 ? this.gestureState(touches) : null; if (!gest) this.pushHistory(); return; }
      }
      if (nav) { nav = null; app.setCursor(null, true); this.pushHistory(); return; }
      if (e.button === 2) {
        const p = pos(e);
        if (this._rdown && Math.hypot(p.x - this._rdown.x, p.y - this._rdown.y) < 5) app.contextMenu(evOf(e));
        this._rdown = null; return;
      }
      app.toolEvent('up', evOf(e));
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', (e) => { touches.delete(e.pointerId); gest = null; nav = null; });
    el.addEventListener('dblclick', (e) => app.toolEvent('dbl', evOf(e)));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerleave', () => { app.toolEvent('leave', {}); });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e), N = this.navCfg();
      const px = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
      const zx = N.zoomToCursor ? p.x : this.w / 2, zy = N.zoomToCursor ? p.y : this.h / 2;
      // trackpad pinch arrives as ctrl+wheel with small deltas; Ctrl + mouse wheel has big notches
      if (e.ctrlKey && e.deltaMode === 0 && Math.abs(e.deltaY) < 50) { this.zoomAt(Math.exp(e.deltaY * 0.012 * N.pinchSpeed), zx, zy); return; }
      if (!e.ctrlKey && this.isTrackpadWheel(e)) {
        const inv = N.tpInvert ? -1 : 1, dx = -e.deltaX * inv * px, dy = -e.deltaY * inv * px;
        if ((N.tpSwipe === 'pan') !== e.shiftKey) this.navPan(dx, dy, this.pivotAt(p.x, p.y), 'trackpad');
        else {
          if (!this._tpPivot || performance.now() - this._tpT > 250) this._tpPivot = this.navPivot(p.x, p.y, 'trackpad');
          this._tpT = performance.now();
          this.navOrbit(dx * 0.9, dy * 0.9, this._tpPivot, 'trackpad');
        }
        return;
      }
      const d = (e.deltaY || (e.shiftKey ? e.deltaX : 0)) * px;
      const f = Math.exp(Math.max(-400, Math.min(400, d)) * 0.0016 * (N.invertZoom ? -1 : 1) * (N.zoomSpeed || 1));
      this.zoomAt(f, zx, zy);
    }, { passive: false });
    // Safari trackpad gestures (pinch, and twist when enabled)
    let gs = 1, gr = 0;
    el.addEventListener('gesturestart', (e) => { e.preventDefault(); gs = 1; gr = 0; });
    el.addEventListener('gesturechange', (e) => {
      e.preventDefault(); const p = pos(e), N = this.navCfg();
      if (e.scale > 0) this.zoomAt(Math.pow(gs / e.scale, N.pinchSpeed), p.x, p.y);
      gs = e.scale;
      if (N.touchTwist && e.rotation != null) { const da = e.rotation - gr; gr = e.rotation; if (Math.abs(da) < 30) this.navOrbit((-da * Math.PI) / 180 / 0.0065, 0, this.navPivot(p.x, p.y, 'trackpad'), 'trackpad'); }
    });
    el.addEventListener('gestureend', (e) => e.preventDefault());
  }
  gestureState(touches) {
    const pts = [...touches.values()];
    const c = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    const d = pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    const a = pts.length >= 2 ? Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) : 0;
    return { c, d, a, n: pts.length, pivot: this.navPivot(c.x, c.y, 'touch') };
  }
  applyGesture(g, touches) {
    const s = this.gestureState(touches), N = this.navCfg();
    const dx = s.c.x - g.c.x, dy = s.c.y - g.c.y;
    // two fingers do the chosen action (orbit by default), three fingers the other one
    const panNow = (N.touchTwoFinger === 'pan') === (s.n < 3);
    if (s.n < 3) {
      if (g.d > 0 && s.d > 0 && Math.abs(s.d - g.d) > 1) this.zoomAt(Math.pow(g.d / s.d, N.touchPinchSpeed), s.c.x, s.c.y);
      if (N.touchTwist && g.d > 40 && s.d > 40) {
        let da = s.a - g.a; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
        if (Math.abs(da) > 0.002) this.orbit((-da / 0.0065) * (N.invertOrbitX ? -1 : 1), 0, g.pivot);
      }
    }
    if (Math.abs(dx) + Math.abs(dy) > 0) { if (panNow) this.navPan(dx, dy, g.pivot, 'touch'); else this.navOrbit(dx, dy, g.pivot, 'touch'); }
    g.c = s.c; g.d = s.d; g.a = s.a;
  }
}

// navigation defaults (Preferences › Navigation)
export const NAV_DEFAULTS = {
  // mouse
  orbitSpeed: 1, panSpeed: 1, zoomSpeed: 1, invertZoom: false, invertOrbitX: false, invertOrbitY: false, zoomToCursor: true, middleButton: 'orbit', orbitPivot: 'auto',
  // trackpad
  // two-finger swipe (scroll) at 70 % by default — 100 % felt too fast on a MacBook trackpad
  wheelMode: 'auto', tpSwipe: 'orbit', tpOrbitSpeed: 0.7, tpPanSpeed: 0.7, pinchSpeed: 1, tpInvert: false,
  // touch screen
  touchTwoFinger: 'orbit', touchOrbitSpeed: 1, touchPanSpeed: 1, touchPinchSpeed: 1, touchTwist: false,
};

// ---------------------------------------------------------------- sun
export function sunDirection(geo, sh) {
  const lat = THREE.MathUtils.degToRad(geo.lat || 0);
  const doy = Math.floor((Date.UTC(2026, (sh.month || 6) - 1, sh.day || 21) - Date.UTC(2026, 0, 0)) / 864e5);
  const decl = THREE.MathUtils.degToRad(-23.44 * Math.cos(((2 * Math.PI) / 365) * (doy + 10)));
  // solar time from local clock time using longitude vs time-zone meridian
  const solar = (sh.hour ?? 12) + ((geo.lon || 0) - 15 * (geo.tz ?? 7)) / 15;
  const ha = THREE.MathUtils.degToRad(15 * (solar - 12));
  const alt = Math.asin(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha));
  let az = Math.atan2(-Math.sin(ha), Math.tan(decl) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha)); // from north, clockwise
  az += THREE.MathUtils.degToRad(geo.north || 0);
  return new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)).normalize();
}
