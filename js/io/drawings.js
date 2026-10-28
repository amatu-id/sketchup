// Working drawings: vector hidden-line projection (GPU depth buffer + edge sampling), sheets, PDF / DXF / SVG output.
import * as THREE from 'three';
import { walkGeometry, sectionSegments, sectionFill } from '../core/section.js';
import { entsBox } from '../core/ops.js';
import { basis, triangulate2 } from '../core/geom.js';
import { DXF } from './dxf.js';

const DEPTH_VS = `varying float vD;
#include <common>
#include <clipping_planes_pars_vertex>
void main(){ vec4 mvPosition = modelViewMatrix * vec4(position,1.0); vD = -mvPosition.z; gl_Position = projectionMatrix * mvPosition;
#include <clipping_planes_vertex>
}`;
const DEPTH_FS = `varying float vD;
#include <clipping_planes_pars_fragment>
void main(){
#include <clipping_planes_fragment>
gl_FragColor = vec4(vD, 1.0, 0.0, 1.0); }`;

// ---------------------------------------------------------------- geometry gathering
export function gather(app, opts = {}) {
  const model = app.model, tris = [], edges = [], softs = [];
  const visTag = (t) => { const x = model.tags.get(t || 0); return !x || x.visible !== false; };
  walkGeometry(model, (ents, m) => {
    const W = new Map(), w = (id) => { let p = W.get(id); if (!p) { p = ents.P(id).clone().applyMatrix4(m); W.set(id, p); } return p; };
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const fn = new Map();
    for (const f of ents.faces.values()) {
      if (f.hidden || !visTag(f.tag)) continue;
      const { u, v } = basis(f.n);
      const l2 = f.loops.map((l) => l.map((id) => { const p = ents.P(id); return [p.dot(u), p.dot(v)]; }));
      const all = f.loops.flat();
      for (const t of triangulate2(l2[0], l2.slice(1))) tris.push(w(all[t[0]]), w(all[t[1]]), w(all[t[2]]));
      fn.set(f.id, f.n.clone().applyMatrix3(nm).normalize());
    }
    for (const e of ents.edges.values()) {
      if (e.hidden || !visTag(e.tag)) continue;
      const a = w(e.a), b = w(e.b);
      if (e.soft) { if (e.faces.size === 2) { const [f1, f2] = [...e.faces]; if (fn.has(f1) && fn.has(f2)) softs.push({ a, b, n1: fn.get(f1), n2: fn.get(f2) }); } continue; }
      edges.push({ a, b, tag: e.tag });
    }
  }, opts);
  return { tris, edges, softs };
}

// ---------------------------------------------------------------- hidden line removal
export function hiddenLine(app, cam, W, H, g, opts = {}) {
  const r = app.view.renderer;
  const clip = opts.clip ? [opts.clip] : [];
  const scene = new THREE.Scene();
  const pos = new Float32Array(g.tris.length * 3); g.tris.forEach((p, i) => { pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z; });
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.ShaderMaterial({ vertexShader: DEPTH_VS, fragmentShader: DEPTH_FS, side: THREE.DoubleSide, clipping: true, clippingPlanes: clip });
  scene.add(new THREE.Mesh(geo, mat));
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  const oldClear = r.getClearColor(new THREE.Color()), oldA = r.getClearAlpha();
  r.setRenderTarget(rt); r.setClearColor(new THREE.Color(0, 0, 0), 0); r.clear(); r.render(scene, cam); r.setRenderTarget(null);
  r.setClearColor(oldClear, oldA);
  const buf = new Float32Array(W * H * 4);
  r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
  rt.dispose(); geo.dispose(); mat.dispose();
  // reference depth at a pixel with a slope allowance (grazing faces & silhouettes of curved surfaces)
  const depthAt = (px, py) => {
    let mn = Infinity, mx = -Infinity, c = Infinity;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const x = px + i, y = py + j; if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const o = (y * W + x) * 4; if (buf[o + 1] < 0.5) continue;
      const d = buf[o]; if (d < mn) mn = d; if (d > mx) mx = d; if (!i && !j) c = d;
    }
    if (mn === Infinity) return Infinity;
    const g = (mx - mn) / 2;
    return (isFinite(c) ? c : mn) + g * 2;
  };
  cam.updateMatrixWorld(); const inv = cam.matrixWorldInverse;
  const proj = (p) => { const v = p.clone().project(cam); return { x: v.x, y: v.y, d: -p.clone().applyMatrix4(inv).z }; };
  const viewDir = new THREE.Vector3(); cam.getWorldDirection(viewDir);
  // pixel size in depth units (for tolerance)
  const span = cam.isOrthographicCamera ? (cam.right - cam.left) / W : 1;
  const tol = (d) => (cam.isOrthographicCamera ? span * 2.5 : d * 0.004) + 0.5;
  const out = [];
  const clipSeg = (a, b) => {
    if (!opts.clip) return [a, b];
    const n = opts.clip.normal, c = opts.clip.constant;
    const da = n.dot(a) + c, db = n.dot(b) + c;
    if (da < 0 && db < 0) return null;
    if (da >= 0 && db >= 0) return [a, b];
    const x = a.clone().lerp(b, da / (da - db));
    return da >= 0 ? [a, x] : [x, b];
  };
  const doEdge = (a0, b0, kind) => {
    const s = clipSeg(a0, b0); if (!s) return;
    const [a, b] = s;
    const pa = proj(a), pb = proj(b);
    const pxLen = Math.hypot((pb.x - pa.x) * W / 2, (pb.y - pa.y) * H / 2);
    const n = Math.max(2, Math.min(4000, Math.ceil(pxLen / 1.2)));
    let run = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n, p = a.clone().lerp(b, t), q = proj(p);
      const px = Math.floor(((q.x + 1) / 2) * W), py = Math.floor(((q.y + 1) / 2) * H);
      const vis = q.d <= depthAt(px, py) + tol(q.d);
      if (vis) { if (!run) run = { s: q, e: q }; else run.e = q; }
      else if (run) { out.push([run.s.x, run.s.y, run.e.x, run.e.y, kind]); run = null; }
    }
    if (run) out.push([run.s.x, run.s.y, run.e.x, run.e.y, kind]);
  };
  for (const e of g.edges) doEdge(e.a, e.b, 'v');
  // silhouettes of smooth surfaces
  for (const s of g.softs) {
    const m = s.a.clone().add(s.b).multiplyScalar(0.5);
    const d = cam.isOrthographicCamera ? viewDir : m.clone().sub(cam.position).normalize();
    if (Math.sign(s.n1.dot(d)) !== Math.sign(s.n2.dot(d))) doEdge(s.a, s.b, 'p');
  }
  return { segs: out, proj };
}

// ---------------------------------------------------------------- views
const VIEWS = {
  plan: { dir: [0, 0, -1], up: [0, 1, 0], title: 'DENAH', cut: true },
  top: { dir: [0, 0, -1], up: [0, 1, 0], title: 'TAMPAK ATAS' },
  front: { dir: [0, 1, 0], up: [0, 0, 1], title: 'TAMPAK DEPAN' },
  back: { dir: [0, -1, 0], up: [0, 0, 1], title: 'TAMPAK BELAKANG' },
  left: { dir: [1, 0, 0], up: [0, 0, 1], title: 'TAMPAK SAMPING KIRI' },
  right: { dir: [-1, 0, 0], up: [0, 0, 1], title: 'TAMPAK SAMPING KANAN' },
  secx: { dir: [0, 1, 0], up: [0, 0, 1], title: 'POTONGAN A – A', section: 'y' },
  secy: { dir: [1, 0, 0], up: [0, 0, 1], title: 'POTONGAN B – B', section: 'x' },
  iso: { dir: [1, 1, -0.82], up: [0, 0, 1], title: 'PERSPEKTIF ISOMETRI', iso: true },
};

// Project one view into 2D model units. Returns {lines:[{x1,y1,x2,y2,k}], fills:[[x,y,...]], box:{x0,y0,x1,y1}, title}
export function projectView(app, id, opts = {}) {
  const model = app.model;
  const box = entsBox(model, model.root, new THREE.Matrix4(), new THREE.Box3(), { visibleOnly: true });
  if (box.isEmpty()) return null;
  let spec, clip = null, cutPlane = null, title;
  if (id.startsWith('sp:')) {
    const s = app.findSection(+id.slice(3)); if (!s) return null;
    const p = s.sec.p.clone().applyMatrix4(s.matrix), n = s.sec.n.clone().transformDirection(s.matrix);
    const dir = n.clone().negate();
    const up = Math.abs(n.z) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    spec = { dir, up }; title = 'POTONGAN ' + (s.sec.symbol ? `${s.sec.symbol} – ${s.sec.symbol}` : s.sec.name || '');
    if (Math.abs(n.z) > 0.9 && n.z > 0) title = 'DENAH (' + (s.sec.name || 'potongan') + ')';
    clip = new THREE.Plane(n.clone().negate(), n.dot(p)); cutPlane = { n, d: n.dot(p) };
  } else {
    const v = VIEWS[id]; if (!v) return null;
    spec = { dir: new THREE.Vector3(...v.dir).normalize(), up: new THREE.Vector3(...v.up) }; title = v.title;
    const c = box.getCenter(new THREE.Vector3());
    if (v.cut) { const z = Math.min(box.max.z - 1, box.min.z + (opts.cutZ ?? 1200)); const n = new THREE.Vector3(0, 0, 1); clip = new THREE.Plane(n.clone().negate(), z); cutPlane = { n, d: z }; title += ` (potong +${(z / 1000).toFixed(2)})`; }
    if (v.section === 'y') { const n = new THREE.Vector3(0, -1, 0); clip = new THREE.Plane(n.clone().negate(), n.dot(c)); cutPlane = { n, d: n.dot(c) }; }
    if (v.section === 'x') { const n = new THREE.Vector3(-1, 0, 0); clip = new THREE.Plane(n.clone().negate(), n.dot(c)); cutPlane = { n, d: n.dot(c) }; }
  }
  const dir = spec.dir.clone().normalize();
  const right = dir.clone().cross(spec.up).normalize(); const camUp = dir.clone().negate().cross(right).normalize();
  // extents in view coords
  const corners = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
  const us = corners.map((p) => p.dot(right)), vs = corners.map((p) => p.dot(camUp)), ds = corners.map((p) => p.dot(dir));
  const pad = Math.max(10, (Math.max(...us) - Math.min(...us) + Math.max(...vs) - Math.min(...vs)) * 0.01);
  const umin = Math.min(...us) - pad, umax = Math.max(...us) + pad, vmin = Math.min(...vs) - pad, vmax = Math.max(...vs) + pad;
  const center = box.getCenter(new THREE.Vector3());
  const depth = Math.max(...ds) - Math.min(...ds);
  const cam = new THREE.OrthographicCamera(umin - center.dot(right), umax - center.dot(right), vmax - center.dot(camUp), vmin - center.dot(camUp), 1, depth * 2 + 20);
  cam.position.copy(center).addScaledVector(dir, -(depth + 10)); cam.up.copy(camUp); cam.lookAt(center); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  const aspect = (umax - umin) / (vmax - vmin);
  const MAX = opts.res || 3072;
  const W = Math.max(64, Math.round(aspect >= 1 ? MAX : MAX * aspect)), H = Math.max(64, Math.round(aspect >= 1 ? MAX / aspect : MAX));
  const g = opts.geom || gather(app);
  const { segs } = hiddenLine(app, cam, W, H, g, { clip });
  const toUV = (x, y) => [umin + ((x + 1) / 2) * (umax - umin), vmin + ((y + 1) / 2) * (vmax - vmin)];
  const lines = segs.map(([x1, y1, x2, y2, k]) => { const a = toUV(x1, y1), b = toUV(x2, y2); return { x1: a[0], y1: a[1], x2: b[0], y2: b[1], k }; }).filter((l) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 0.5);
  const fills = [];
  if (cutPlane) {
    const cs = sectionSegments(model, cutPlane.n, cutPlane.d);
    for (const [a, b] of cs) lines.push({ x1: a.dot(right), y1: a.dot(camUp), x2: b.dot(right), y2: b.dot(camUp), k: 'c' });
    if (opts.hatch !== false) {
      const { pos } = sectionFill(cs, cutPlane.n, cutPlane.d);
      for (let i = 0; i + 8 < pos.length; i += 9) fills.push([0, 3, 6].flatMap((k) => { const p = new THREE.Vector3(pos[i + k], pos[i + k + 1], pos[i + k + 2]); return [p.dot(right), p.dot(camUp)]; }));
    }
  }
  // user dimensions & texts parallel to the view plane
  const annots = [];
  if (opts.userDims !== false) {
    walkGeometry(model, (ents, m) => {
      for (const d of ents.dims.values()) {
        const a = d.a.clone().applyMatrix4(m), b = d.b.clone().applyMatrix4(m), off = d.off.clone().transformDirection(m).multiplyScalar(d.off.length());
        const ab = b.clone().sub(a);
        if (Math.abs(ab.clone().normalize().dot(dir)) > 0.02 || Math.abs(off.clone().normalize().dot(dir)) > 0.2) continue;
        if (clip && (clip.distanceToPoint(a) < -1 || clip.distanceToPoint(b) < -1)) continue;
        annots.push({ t: 'dim', a: [a.dot(right), a.dot(camUp)], b: [b.dot(right), b.dot(camUp)], off: [off.dot(right), off.dot(camUp)], text: d.text, len: a.distanceTo(b) });
      }
      for (const t of ents.texts.values()) {
        if (t.screen || !t.at) continue;
        const at = t.at.clone().applyMatrix4(m), p = t.p.clone().applyMatrix4(m);
        if (clip && clip.distanceToPoint(at) < -1) continue;
        annots.push({ t: 'text', at: [at.dot(right), at.dot(camUp)], p: [p.dot(right), p.dot(camUp)], text: t.text });
      }
    });
  }
  const bb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const l of lines) { bb.x0 = Math.min(bb.x0, l.x1, l.x2); bb.x1 = Math.max(bb.x1, l.x1, l.x2); bb.y0 = Math.min(bb.y0, l.y1, l.y2); bb.y1 = Math.max(bb.y1, l.y1, l.y2); }
  if (!isFinite(bb.x0)) return null;
  return { id, title, lines, fills, annots, box: bb, isPlan: dir.z < -0.9, isIso: !!VIEWS[id]?.iso, levels: dir.z === 0 ? { z0: box.min.z, z1: box.max.z } : null, vaxisZ: Math.abs(camUp.z) > 0.99 };
}

// ---------------------------------------------------------------- sheet composition (paper mm)
const PAPER = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594] };
const SCALES = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000, 2000];

export function composeSheet(app, view, sheetNo, total, opts) {
  const [PW, PH] = PAPER[opts.paper] || PAPER.A3;
  const prims = [];
  const L = (x1, y1, x2, y2, w = 0.25, layer = 'KOP', dash = null) => prims.push({ t: 'l', x1, y1, x2, y2, w, layer, dash });
  const T = (x, y, text, size = 3, o = {}) => prims.push({ t: 't', x, y, text: String(text), size, align: o.align || 'left', bold: !!o.bold, layer: o.layer || 'TEKS', rot: o.rot || 0 });
  const R = (x, y, w, h, lw = 0.35, layer = 'KOP') => { L(x, y, x + w, y, lw, layer); L(x + w, y, x + w, y + h, lw, layer); L(x + w, y + h, x, y + h, lw, layer); L(x, y + h, x, y, lw, layer); };
  // frame: binding margin 20 left, 8 others; title block column at right
  const mL = 20, mO = 8, tbW = Math.min(70, PW * 0.2);
  R(mL, mO, PW - mL - mO, PH - 2 * mO, 0.6);
  const tbX = PW - mO - tbW;
  L(tbX, mO, tbX, PH - mO, 0.5);
  // drawing area
  const area = { x0: mL + 8, y0: mO + 14, x1: tbX - 8, y1: PH - mO - 12 };
  const bw = view.box.x1 - view.box.x0, bh = view.box.y1 - view.box.y0;
  const dimRoom = opts.dims && !view.isIso ? 22 : 4;
  const availW = area.x1 - area.x0 - dimRoom * 2, availH = area.y1 - area.y0 - dimRoom * 2;
  let scale = opts.scale;
  if (scale === 'auto' || !scale) { const need = Math.max(bw / availW, bh / availH); scale = SCALES.find((s) => s >= need) || Math.ceil(need); }
  const k = 1 / scale;
  const cx = (area.x0 + area.x1) / 2, cy = (area.y0 + area.y1) / 2 + 3;
  const ox = cx - ((view.box.x0 + view.box.x1) / 2) * k, oy = cy - ((view.box.y0 + view.box.y1) / 2) * k;
  const X = (u) => ox + u * k, Y = (v) => oy + v * k;
  for (const f of view.fills) prims.push({ t: 'f', pts: [X(f[0]), Y(f[1]), X(f[2]), Y(f[3]), X(f[4]), Y(f[5])], layer: 'ARSIR' });
  for (const l of view.lines) prims.push({ t: 'l', x1: X(l.x1), y1: Y(l.y1), x2: X(l.x2), y2: Y(l.y2), w: l.k === 'c' ? 0.6 : l.k === 'p' ? 0.3 : 0.18, layer: l.k === 'c' ? 'GARIS-POTONG' : 'GARIS-TAMPAK' });
  const fmt = (mm) => (opts.unit === 'm' ? (mm / 1000).toFixed(2) : String(Math.round(mm)));
  // dimension helper (paper coords): from (x1,y1) to (x2,y2), offset perpendicular "off" mm
  const dim = (u1, v1, u2, v2, offPaper, label, layer = 'DIMENSI') => {
    const x1 = X(u1), y1 = Y(v1), x2 = X(u2), y2 = Y(v2);
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy); if (len < 1) return;
    const nx = -dy / len, ny = dx / len;
    const ax = x1 + nx * offPaper, ay = y1 + ny * offPaper, bx = x2 + nx * offPaper, by = y2 + ny * offPaper;
    const ext = 1.5 * Math.sign(offPaper || 1);
    L(x1 + nx * Math.sign(offPaper) * 1, y1 + ny * Math.sign(offPaper) * 1, ax + nx * ext, ay + ny * ext, 0.13, layer);
    L(x2 + nx * Math.sign(offPaper) * 1, y2 + ny * Math.sign(offPaper) * 1, bx + nx * ext, by + ny * ext, 0.13, layer);
    L(ax - (dx / len) * 1.2, ay - (dy / len) * 1.2, bx + (dx / len) * 1.2, by + (dy / len) * 1.2, 0.13, layer);
    for (const [px, py] of [[ax, ay], [bx, by]]) L(px - 0.9, py - 0.9, px + 0.9, py + 0.9, 0.35, layer);
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    const rot = ang > 90.1 || ang < -89.9 ? ang + 180 : ang;
    const tx = (ax + bx) / 2 + nx * 1.4 * Math.sign(offPaper || 1), ty = (ay + by) / 2 + ny * 1.4 * Math.sign(offPaper || 1);
    T(tx, ty, label, 2.2, { align: 'center', layer, rot });
  };
  if (opts.dims && !view.isIso) {
    const b = view.box;
    // overall
    dim(b.x0, b.y0, b.x1, b.y0, -14, fmt(bw)); dim(b.x0, b.y0, b.x0, b.y1, 14, fmt(bh));
    // chain dimensions from line endpoints (cut lines preferred)
    const src = view.lines.some((l) => l.k === 'c') ? view.lines.filter((l) => l.k === 'c') : view.lines;
    const uniq = (vals, ext) => { vals.sort((a, c) => a - c); const o = []; const tol = Math.max(20, ext * 0.012, 7 * scale); for (const v of vals) if (!o.length || v - o[o.length - 1] > tol) o.push(v); return o; };
    const xs = uniq(src.flatMap((l) => [l.x1, l.x2]), bw), ys = uniq(src.flatMap((l) => [l.y1, l.y2]), bh);
    if (xs.length > 2 && xs.length <= 18) for (let i = 0; i + 1 < xs.length; i++) dim(xs[i], b.y0, xs[i + 1], b.y0, -7, fmt(xs[i + 1] - xs[i]));
    if (ys.length > 2 && ys.length <= 18) for (let i = 0; i + 1 < ys.length; i++) dim(b.x0, ys[i], b.x0, ys[i + 1], 7, fmt(ys[i + 1] - ys[i]));
    // level markers on elevations / sections
    if (view.vaxisZ && view.levels) {
      for (const z of [...new Set([0, ...ys.length <= 8 ? ys : [b.y0, b.y1]])].filter((z) => z >= b.y0 - 1 && z <= b.y1 + 1)) {
        const px = X(b.x1) + 6, py = Y(z);
        L(px - 2, py, px + 12, py, 0.13, 'DIMENSI'); L(px, py, px + 1.6, py + 2.2, 0.13, 'DIMENSI'); L(px + 1.6, py + 2.2, px - 1.6, py + 2.2, 0.13, 'DIMENSI'); L(px - 1.6, py + 2.2, px, py, 0.13, 'DIMENSI');
        T(px + 2.5, py + 1.2, (z >= 0 ? '+' : '') + (z / 1000).toFixed(2), 2.2, { layer: 'DIMENSI' });
      }
    }
  }
  // user dims & texts
  for (const a of view.annots) {
    if (a.t === 'dim') {
      const offP = Math.hypot(a.off[0], a.off[1]) * k;
      const dx = a.b[0] - a.a[0], dy = a.b[1] - a.a[1];
      const sgn = Math.sign(-dy * a.off[0] + dx * a.off[1]) || 1;
      dim(a.a[0], a.a[1], a.b[0], a.b[1], sgn * offP, a.text || fmt(a.len));
    } else if (a.t === 'text') {
      L(X(a.at[0]), Y(a.at[1]), X(a.p[0]), Y(a.p[1]), 0.13, 'TEKS'); T(X(a.p[0]) + 1, Y(a.p[1]) + 1, a.text, 2.5);
    }
  }
  // view title under drawing
  const ty = Math.max(area.y0 - 6, Y(view.box.y0) - (opts.dims && !view.isIso ? 26 : 8));
  T(cx, ty, view.title, 4, { align: 'center', bold: true });
  L(cx - 30, ty - 1.6, cx + 30, ty - 1.6, 0.35);
  T(cx, ty - 5.5, view.isIso ? 'TANPA SKALA' : `SKALA 1 : ${scale}`, 2.6, { align: 'center' });
  // north arrow on plans
  if (view.isPlan) {
    const nx = area.x1 - 12, ny = area.y1 - 14;
    prims.push({ t: 'c', x: nx, y: ny, r: 6, w: 0.25, layer: 'KOP' });
    L(nx, ny - 5, nx, ny + 7, 0.35); L(nx, ny + 7, nx - 2.5, ny + 1, 0.35); L(nx, ny + 7, nx + 2.5, ny + 1, 0.35);
    T(nx, ny + 9, 'U', 3, { align: 'center', bold: true });
  }
  // title block
  const info = app.model.info, now = new Date();
  const rows = [
    ['PROYEK', info.name || app.fileName || '-', 22], ['PEMILIK', info.client || '-', 14], ['LOKASI', info.location || '-', 14],
    ['JUDUL GAMBAR', view.title, 18], ['SKALA', view.isIso ? 'TANPA SKALA' : `1 : ${scale}`, 11], ['TANGGAL', now.toLocaleDateString('id-ID'), 11],
    ['DIGAMBAR', info.author || '-', 11], ['DIPERIKSA', info.checker || '-', 11], ['NO. LEMBAR', `A-${String(sheetNo).padStart(2, '0')}  /  ${total}`, 14],
  ];
  let y = PH - mO;
  T(tbX + tbW / 2, y - 8, 'AMATU SKETCH', 3.6, { align: 'center', bold: true });
  T(tbX + tbW / 2, y - 12.5, 'GAMBAR KERJA', 2.4, { align: 'center' });
  y -= 16; L(tbX, y, tbX + tbW, y, 0.35);
  for (const [lab, val, hgt] of rows) {
    T(tbX + 2, y - 3.2, lab, 1.9, { layer: 'KOP' });
    const words = String(val).split(' '); let line = '', ly = y - 7.5; const maxC = Math.floor(tbW / 1.9);
    for (const w of words) { if ((line + ' ' + w).trim().length > maxC) { T(tbX + 2, ly, line.trim(), 3, { bold: true }); ly -= 3.8; line = w; } else line += ' ' + w; }
    if (line.trim()) T(tbX + 2, ly, line.trim(), 3, { bold: true });
    y -= hgt; L(tbX, y, tbX + tbW, y, 0.25);
  }
  T(tbX + 2, mO + 4, 'Dibuat dengan Amatu Sketch', 1.8, { layer: 'KOP' });
  return { w: PW, h: PH, prims, scale };
}

// ---------------------------------------------------------------- PDF
export async function sheetsToPDF(sheets, name) {
  const { jsPDF } = window.jspdf;
  const first = sheets[0];
  const doc = new jsPDF({ orientation: first.w > first.h ? 'landscape' : 'portrait', unit: 'mm', format: [first.w, first.h] });
  sheets.forEach((s, i) => {
    if (i) doc.addPage([s.w, s.h], s.w > s.h ? 'landscape' : 'portrait');
    const Y = (y) => s.h - y;
    for (const p of s.prims) {
      if (p.t === 'f') { doc.setFillColor(p.fill || '#4a4a4a'); doc.setDrawColor(p.fill || '#4a4a4a'); doc.setLineWidth(0.01); doc.triangle(p.pts[0], Y(p.pts[1]), p.pts[2], Y(p.pts[3]), p.pts[4], Y(p.pts[5]), 'FD'); }
    }
    for (const p of s.prims) {
      if (p.t === 'l') { doc.setDrawColor(p.color || '#000000'); doc.setLineWidth(p.w); if (p.dash) doc.setLineDashPattern(p.dash, 0); doc.line(p.x1, Y(p.y1), p.x2, Y(p.y2)); if (p.dash) doc.setLineDashPattern([], 0); }
      else if (p.t === 'c') { doc.setDrawColor('#000000'); doc.setLineWidth(p.w); doc.circle(p.x, Y(p.y), p.r); }
      else if (p.t === 't') { doc.setFont('helvetica', p.bold ? 'bold' : 'normal'); doc.setFontSize(p.size / 0.3528); doc.setTextColor('#000000'); doc.text(p.text, p.x, Y(p.y), { align: p.align, angle: p.rot || 0, baseline: 'bottom' }); }
      else if (p.t === 'img') doc.addImage(p.data, 'JPEG', p.x, Y(p.y + p.h), p.w, p.h);
    }
  });
  doc.setProperties({ title: name, creator: 'Amatu Sketch' });
  return doc.output('blob');
}

// ---------------------------------------------------------------- DXF (sheets placed side by side at real size)
export function sheetsToDXF(sheets) {
  const d = new DXF();
  for (const [n, c] of [['GARIS-TAMPAK', 7], ['GARIS-POTONG', 1], ['ARSIR', 8], ['DIMENSI', 3], ['TEKS', 2], ['KOP', 5]]) d.layer(n, c);
  let ox = 0;
  for (const s of sheets) {
    const k = s.scale || 1;
    const X = (x) => ox + x * k, Y = (y) => y * k;
    for (const p of s.prims) {
      if (p.t === 'l') d.line(X(p.x1), Y(p.y1), 0, X(p.x2), Y(p.y2), 0, p.layer);
      else if (p.t === 'f') d.solid([[X(p.pts[0]), Y(p.pts[1])], [X(p.pts[2]), Y(p.pts[3])], [X(p.pts[4]), Y(p.pts[5])]], p.layer);
      else if (p.t === 't') d.text(X(p.x), Y(p.y), p.size * k, p.text, p.layer, p.rot, p.align);
      else if (p.t === 'c') d.circle(X(p.x), Y(p.y), p.r * k, p.layer);
      else if (p.t === 'img') { /* raster views are omitted in DXF */ }
    }
    ox += (s.w + 40) * k;
  }
  return d.toString();
}

// ---------------------------------------------------------------- SVG of the current camera view (vector, hidden line)
export function viewToSVG(app) {
  const v = app.view, W = Math.round(v.w), H = Math.round(v.h);
  const g = gather(app);
  const clip = v.clip || null;
  const { segs } = hiddenLine(app, v.camera, Math.min(4096, W * 2), Math.min(4096, H * 2), g, { clip });
  const X = (x) => ((x + 1) / 2) * W, Y = (y) => ((1 - y) / 2) * H;
  const body = segs.map(([x1, y1, x2, y2, k]) => `<line x1="${X(x1).toFixed(2)}" y1="${Y(y1).toFixed(2)}" x2="${X(x2).toFixed(2)}" y2="${Y(y2).toFixed(2)}" stroke-width="${k === 'p' ? 1.6 : 1}"/>`).join('\n');
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#fff"/><g stroke="#000" stroke-linecap="round">${body}</g></svg>`, segs, W, H };
}
export { PAPER };
