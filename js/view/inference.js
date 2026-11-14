// SketchUp-style inference engine: endpoints, midpoints, on-edge, on-face, axis/parallel locks, from-point tracking.
import * as THREE from 'three';
import { lineRay, segSeg, rayPlane } from '../core/geom.js';
import { COL } from './overlay.js';

const AX = [
  { name: 'Red', color: COL.red }, { name: 'Green', color: COL.green }, { name: 'Blue', color: COL.blue },
];

export class Inference {
  constructor(app) { this.app = app; this.tracked = []; this.refEdge = null; }
  get view() { return this.app.view; }
  reset() { this.tracked = []; this.refEdge = null; }
  axes() {
    const m = this.app.model.axesM || new THREE.Matrix4();
    return [0, 1, 2].map((i) => new THREE.Vector3().setFromMatrixColumn(m, i).normalize());
  }
  axisInfo(dir) {
    const ax = this.axes();
    for (let i = 0; i < 3; i++) if (Math.abs(ax[i].dot(dir)) > 0.99999) return AX[i];
    return { name: null, color: COL.magenta };
  }
  scopeLabel(ref) {
    if (!ref || !ref.path) return '';
    const ctx = this.app.ctxPath;
    if (ref.path.length <= ctx.length) return '';
    const inst = this.app.findInst(ref.path[ctx.length]);
    const d = inst && this.app.model.defs.get(inst.def);
    return d ? (d.group ? ' in Group' : ' in Component') : '';
  }

  find(x, y, o = {}) {
    const v = this.view, cam = v.camera, W = v.w, H = v.h;
    const R = o.radius || 11;
    const ray = v.rayAt(x, y);
    const hit = o.noFace ? null : v.pickFace(x, y, { skip: o.skipFace });
    const hitT = hit ? hit.dist : Infinity;
    const occluded = (p) => {
      if (!hit || o.xray || this.app.model.style.xray) return false;
      const t = p.clone().sub(ray.o).dot(ray.d);
      return t > hitT + Math.max(2, hitT * 0.004);
    };
    const M = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements;
    const proj = (px, py, pz, out) => {
      const cw = M[3] * px + M[7] * py + M[11] * pz + M[15];
      if (cw <= 1e-9) return false;
      out.x = (((M[0] * px + M[4] * py + M[8] * pz + M[12]) / cw + 1) / 2) * W;
      out.y = ((1 - (M[1] * px + M[5] * py + M[9] * pz + M[13]) / cw) / 2) * H;
      return true;
    };
    const s = { x: 0, y: 0 }, s2 = { x: 0, y: 0 };
    const idx = v.index;
    // ----- points
    let bp = null, bd = R * R;
    if (!o.noPoints) {
      const P = idx.pts, K = idx.kinds;
      for (let i = 0, n = K.length; i < n; i++) {
        if (!proj(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], s)) continue;
        const dx = s.x - x, dy = s.y - y;
        let d2 = dx * dx + dy * dy;
        if (d2 > R * R * 1.8) continue;
        if (K[i] === 1) d2 *= 0.55; else if (K[i] === 3) d2 *= 0.8;
        if (d2 >= bd) continue;
        if (o.exclude && o.exclude(idx.prefs[i])) continue;
        const p = new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        if (occluded(p)) continue;
        bd = d2; bp = { i, kind: K[i], p };
      }
    }
    // ----- edges
    let be = null, bed = 8 * 8;
    if (!o.noEdges) {
      const E = idx.edges;
      for (let j = 0, n = E.length / 6; j < n; j++) {
        if (!proj(E[j * 6], E[j * 6 + 1], E[j * 6 + 2], s) || !proj(E[j * 6 + 3], E[j * 6 + 4], E[j * 6 + 5], s2)) continue;
        const ex = s2.x - s.x, ey = s2.y - s.y, l2 = ex * ex + ey * ey;
        let t = l2 ? ((x - s.x) * ex + (y - s.y) * ey) / l2 : 0; t = Math.max(0, Math.min(1, t));
        const qx = s.x + ex * t - x, qy = s.y + ey * t - y, d2 = qx * qx + qy * qy;
        if (d2 >= bed) continue;
        if (o.excludeEdge && o.excludeEdge(idx.erefs[j])) continue;
        const a = new THREE.Vector3(E[j * 6], E[j * 6 + 1], E[j * 6 + 2]), b = new THREE.Vector3(E[j * 6 + 3], E[j * 6 + 4], E[j * 6 + 5]);
        const r = segSeg(a, b, ray.o, ray.o.clone().addScaledVector(ray.d, 1e8));
        if (occluded(r.c1)) continue;
        bed = d2; be = { j, a, b, p: r.c1, ref: idx.erefs[j] };
      }
    }
    // ----- guide lines
    let bg = null, bgd = 8 * 8;
    if (!o.noGuides) for (const gl of idx.guides) {
      const r = lineRay(gl.p, gl.d, ray.o, ray.d); if (!r || r.t < 0) continue;
      if (!proj(r.p.x, r.p.y, r.p.z, s)) continue;
      const d2 = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d2 < bgd && !occluded(r.p)) { bgd = d2; bg = { p: r.p, g: gl }; }
    }
    if (bp && (bp.kind === 1 || bp.kind === 2 || bp.kind === 3)) this.track(bp.p);
    if (be) this.refEdge = { dir: be.b.clone().sub(be.a).normalize(), a: be.a, b: be.b };

    const start = o.start;
    const res = (r) => { r.hit = hit; r.ray = ray; return r; };
    const ptRes = () => {
      const ref = idx.prefs[bp.i];
      const map = { 1: ['end', 'Endpoint', COL.end], 2: ['mid', 'Midpoint', COL.mid], 3: ['center', 'Center', COL.end], 4: ['gpoint', 'Guide Point', COL.black] };
      const [type, label, color] = map[bp.kind];
      return res({ p: bp.p.clone(), type, label: label + this.scopeLabel(ref), color, ref });
    };
    // ----- locked direction (arrow keys / shift)
    if (start && o.lockDir) {
      const dir = o.lockDir.clone().normalize();
      const info = this.axisInfo(dir);
      let p, label = info.name ? `On ${info.name} Axis` : 'Parallel to Edge';
      const lines = [];
      if (bp) { p = start.clone().addScaledVector(dir, bp.p.clone().sub(start).dot(dir)); lines.push([bp.p, p, COL.gray, 1, [3, 3]]); label += ' / ' + ptRes().label; }
      else if (be) { const r = segSeg(start.clone().addScaledVector(dir, -1e7), start.clone().addScaledVector(dir, 1e7), be.a, be.b); if (r.parallel) { const q = lineRay(start, dir, ray.o, ray.d); p = q ? q.p : r.c1; } else p = r.c1; }
      else { const r = lineRay(start, dir, ray.o, ray.d); p = r ? r.p : start.clone(); }
      lines.push([start.clone().addScaledVector(dir, -1e5), start.clone().addScaledVector(dir, 1e5), info.color, 2, [7, 5]]);
      return res({ p, type: 'axis', label, color: info.color, dir, lines, locked: true });
    }
    // ----- locked plane
    if (o.lockPlane) {
      const { n, d } = o.lockPlane;
      let p = null;
      if (bp) p = bp.p.clone().addScaledVector(n, d - n.dot(bp.p));
      else p = rayPlane(ray.o, ray.d, n, d) || rayPlane(ray.o, ray.d.clone().negate(), n, d);
      if (p) return res({ p, type: bp ? (bp.kind === 1 ? 'end' : 'mid') : hit && Math.abs(hit.normal.dot(n)) > 0.9999 ? 'face' : 'free', label: bp ? (bp.kind === 1 ? 'Endpoint' : 'Midpoint') : hit && Math.abs(hit.normal.dot(n)) > 0.9999 ? 'On Face' : '', color: bp ? (bp.kind === 1 ? COL.end : COL.mid) : COL.face, locked: true });
    }
    if (bp && !(o.axisFirst && start)) return ptRes();
    // ----- axis / parallel / from-point candidates
    let ac = null;
    if (start && !o.noAxis) {
      const dirs = this.axes().map((d, i) => ({ d, info: AX[i], label: `On ${AX[i].name} Axis` }));
      if (this.refEdge) {
        const rd = this.refEdge.dir;
        if (!dirs.some((x) => Math.abs(x.d.dot(rd)) > 0.9999)) dirs.push({ d: rd.clone(), info: { color: COL.magenta }, label: 'Parallel to Edge' });
        const pz = o.planeN ? rd.clone().cross(o.planeN) : rd.clone().cross(new THREE.Vector3(0, 0, 1));
        if (pz.lengthSq() > 1e-6 && !dirs.some((x) => Math.abs(x.d.dot(pz.normalize())) > 0.9999)) dirs.push({ d: pz.normalize(), info: { color: COL.magenta }, label: 'Perpendicular to Edge' });
      }
      for (const c of dirs) {
        const r = lineRay(start, c.d, ray.o, ray.d); if (!r) continue;
        if (!proj(r.p.x, r.p.y, r.p.z, s)) continue;
        if (!proj(start.x, start.y, start.z, s2)) continue;
        if (Math.hypot(s.x - s2.x, s.y - s2.y) < 6) continue;
        const dd = Math.hypot(s.x - x, s.y - y);
        if (dd < 13 && (!ac || dd < ac.dd)) ac = { ...c, p: r.p, dd };
      }
    }
    let fc = null;
    if (!o.noFrom) for (const q of this.tracked) {
      if (start && q.distanceTo(start) < 1e-3) continue;
      for (let i = 0; i < 3; i++) {
        const d = this.axes()[i];
        const r = lineRay(q, d, ray.o, ray.d); if (!r) continue;
        if (!proj(r.p.x, r.p.y, r.p.z, s)) continue;
        const dd = Math.hypot(s.x - x, s.y - y);
        if (dd < 9 && (!fc || dd < fc.dd)) fc = { q, d, i, p: r.p, dd };
      }
    }
    if (bp) return ptRes();
    if (ac && fc && Math.abs(ac.d.dot(fc.d)) < 0.999) {
      const r = segSeg(start.clone().addScaledVector(ac.d, -1e7), start.clone().addScaledVector(ac.d, 1e7), fc.q.clone().addScaledVector(fc.d, -1e7), fc.q.clone().addScaledVector(fc.d, 1e7));
      if (r.dist < 1) {
        return res({ p: r.c1, type: 'axis', label: ac.label + ' / From Point', color: ac.info.color, dir: ac.d,
          lines: [[start, r.c1, ac.info.color, 2, [7, 5]], [fc.q, r.c1, AX[fc.i].color, 1.2, [2, 4]]] });
      }
    }
    if (be) {
      if (ac) {
        const r = segSeg(start.clone().addScaledVector(ac.d, -1e7), start.clone().addScaledVector(ac.d, 1e7), be.a, be.b);
        // an edge lying along the axis line itself: stay under the cursor on that edge (segSeg of collinear lines is arbitrary)
        if (r.dist < 1 && r.parallel) return res({ p: be.p, type: 'edge', label: ac.label + ' / On Edge', color: ac.info.color, dir: ac.d, lines: [[start, be.p, ac.info.color, 2, [7, 5]]], edge: be.ref, edgeA: be.a, edgeB: be.b });
        if (r.dist < 1) return res({ p: r.c1, type: 'intersect', label: ac.label + ' / On Edge', color: ac.info.color, dir: ac.d, lines: [[start, r.c1, ac.info.color, 2, [7, 5]]], edge: be.ref });
      }
      return res({ p: be.p, type: 'edge', label: 'On Edge' + this.scopeLabel(be.ref), color: COL.edge, edge: be.ref, edgeA: be.a, edgeB: be.b });
    }
    if (ac) return res({ p: ac.p, type: 'axis', label: ac.label, color: ac.info.color, dir: ac.d, lines: [[start, ac.p, ac.info.color, 2, [7, 5]]] });
    if (fc) {
      let p = fc.p;
      if (hit) { const r = lineRay(fc.q, fc.d, ray.o, ray.d); if (r) p = r.p; }
      return res({ p, type: 'from', label: 'From Point', color: AX[fc.i].color, lines: [[fc.q, p, AX[fc.i].color, 1.2, [2, 4]]] });
    }
    if (bg) return res({ p: bg.p, type: 'guide', label: 'On Guide', color: COL.black });
    if (hit && !o.noFace) return res({ p: hit.point.clone(), type: 'face', label: 'On Face' + this.scopeLabel({ path: hit.path }), color: COL.face, normal: hit.normal });
    // ----- free space
    let p = null;
    if (start) {
      if (o.planeN) p = rayPlane(ray.o, ray.d, o.planeN, o.planeN.dot(start));
      if (!p && Math.abs(ray.d.z) > 0.08) p = rayPlane(ray.o, ray.d, new THREE.Vector3(0, 0, 1), start.z);
      if (!p) { const n = new THREE.Vector3(ray.d.x, ray.d.y, 0).normalize(); p = rayPlane(ray.o, ray.d, n, n.dot(start)); }
    } else {
      const gz = o.groundZ ?? 0;
      p = rayPlane(ray.o, ray.d, new THREE.Vector3(0, 0, 1), gz);
      if (!p || p.distanceTo(ray.o) > v.camera.far * 0.5) { const n = v.viewDir(); p = rayPlane(ray.o, ray.d, n.clone().negate(), -n.dot(v.cam.target)) || ray.o.clone().addScaledVector(ray.d, v.cam.eye.distanceTo(v.cam.target)); }
    }
    return res({ p: p || ray.o.clone(), type: 'free', label: '', color: COL.gray });
  }
  // nearest visible edge under the cursor (for selection)
  pickEdge(x, y, R = 6, hit = undefined) {
    const v = this.view, cam = v.camera, W = v.w, H = v.h, idx = v.index;
    if (hit === undefined) hit = v.pickFace(x, y);
    const ray = v.rayAt(x, y);
    const M = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements;
    const pr = (px, py, pz, o) => { const cw = M[3] * px + M[7] * py + M[11] * pz + M[15]; if (cw <= 1e-9) return false; o.x = (((M[0] * px + M[4] * py + M[8] * pz + M[12]) / cw + 1) / 2) * W; o.y = ((1 - (M[1] * px + M[5] * py + M[9] * pz + M[13]) / cw) / 2) * H; return true; };
    const s = { x: 0, y: 0 }, s2 = { x: 0, y: 0 }, E = idx.edges;
    let best = null, bd = R * R;
    for (let j = 0, n = E.length / 6; j < n; j++) {
      if (!pr(E[j * 6], E[j * 6 + 1], E[j * 6 + 2], s) || !pr(E[j * 6 + 3], E[j * 6 + 4], E[j * 6 + 5], s2)) continue;
      const ex = s2.x - s.x, ey = s2.y - s.y, l2 = ex * ex + ey * ey;
      let t = l2 ? ((x - s.x) * ex + (y - s.y) * ey) / l2 : 0; t = Math.max(0, Math.min(1, t));
      const d2 = (s.x + ex * t - x) ** 2 + (s.y + ey * t - y) ** 2;
      if (d2 >= bd) continue;
      const a = new THREE.Vector3(E[j * 6], E[j * 6 + 1], E[j * 6 + 2]), b = new THREE.Vector3(E[j * 6 + 3], E[j * 6 + 4], E[j * 6 + 5]);
      const r = segSeg(a, b, ray.o, ray.o.clone().addScaledVector(ray.d, 1e8));
      const tt = r.c1.clone().sub(ray.o).dot(ray.d);
      if (hit && !this.app.model.style.xray && tt > hit.dist + Math.max(2, hit.dist * 0.004)) continue;
      bd = d2; best = { ref: idx.erefs[j], p: r.c1, dist: tt };
    }
    return best;
  }
  track(p) {
    if (this.tracked.some((q) => q.distanceTo(p) < 1e-3)) return;
    this.tracked.unshift(p.clone());
    if (this.tracked.length > 3) this.tracked.pop();
  }
}
