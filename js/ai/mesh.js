// Turns an AI-generated mesh (GLB, normalised size, often 100k+ triangles) into a light,
// coloured, upright mesh for the edge/face engine. Pure array maths so it also runs in node.
//
//   raw  = { pos: Float32Array(n*3), idx: Uint32Array(m*3), col: Float32Array(n*3)|null }  (glTF axes, Y up)
//   mesh = same shape after weld/simplify; colours are 0..1 sRGB

// ---------------------------------------------------------------- weld & simplify
export function weld(raw) {
  const { pos, idx, col } = raw, n = pos.length / 3;
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = pos[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  const diag = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1, q = diag * 1e-6;
  const key = new Map(), remap = new Uint32Array(n), P = [], C = [], cnt = [];
  for (let i = 0; i < n; i++) {
    const k = Math.round(pos[i * 3] / q) + ',' + Math.round(pos[i * 3 + 1] / q) + ',' + Math.round(pos[i * 3 + 2] / q);
    let j = key.get(k);
    if (j == null) { j = cnt.length; key.set(k, j); cnt.push(0); P.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); if (col) C.push(0, 0, 0); }
    if (col) { C[j * 3] += col[i * 3]; C[j * 3 + 1] += col[i * 3 + 1]; C[j * 3 + 2] += col[i * 3 + 2]; }
    cnt[j]++; remap[i] = j;
  }
  if (col) for (let j = 0; j < cnt.length; j++) { C[j * 3] /= cnt[j]; C[j * 3 + 1] /= cnt[j]; C[j * 3 + 2] /= cnt[j]; }
  const I = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = remap[idx[t]], b = remap[idx[t + 1]], c = remap[idx[t + 2]];
    if (a !== b && b !== c && a !== c) I.push(a, b, c);
  }
  return { pos: new Float32Array(P), idx: new Uint32Array(I), col: col ? new Float32Array(C) : null };
}

// drop vertices no triangle uses
export function compact(m) {
  const n = m.pos.length / 3, map = new Int32Array(n).fill(-1), P = [], C = [];
  const I = new Uint32Array(m.idx.length);
  for (let t = 0; t < m.idx.length; t++) {
    const v = m.idx[t];
    if (map[v] < 0) { map[v] = P.length / 3; P.push(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]); if (m.col) C.push(m.col[v * 3], m.col[v * 3 + 1], m.col[v * 3 + 2]); }
    I[t] = map[v];
  }
  return { pos: new Float32Array(P), idx: I, col: m.col ? new Float32Array(C) : null };
}

// remove tiny floating bits (AI meshes often carry crumbs around the object)
export function dropCrumbs(m, minShare = 0.004) {
  const nt = m.idx.length / 3, par = new Int32Array(m.pos.length / 3).map((_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < nt; t++) { const a = find(m.idx[t * 3]), b = find(m.idx[t * 3 + 1]), c = find(m.idx[t * 3 + 2]); par[b] = a; par[find(c)] = a; }
  const area = new Map(); let total = 0;
  for (let t = 0; t < nt; t++) { const r = find(m.idx[t * 3]), a = triArea(m.pos, m.idx, t); area.set(r, (area.get(r) || 0) + a); total += a; }
  const keep = [];
  for (let t = 0; t < nt; t++) if (area.get(find(m.idx[t * 3])) >= total * minShare) keep.push(m.idx[t * 3], m.idx[t * 3 + 1], m.idx[t * 3 + 2]);
  if (keep.length === m.idx.length || keep.length < 30) return m;
  return compact({ ...m, idx: new Uint32Array(keep) });
}

export async function simplify(Simp, m, targetTris) {
  await Simp.ready;
  const nt = m.idx.length / 3;
  if (nt <= targetTris) return m;
  const target = Math.max(3, Math.floor(targetTris) * 3);
  let I;
  if (m.col) [I] = Simp.simplifyWithAttributes(m.idx, m.pos, 3, m.col, 3, [0.6, 0.6, 0.6], null, target, 1, []);
  else [I] = Simp.simplify(m.idx, m.pos, 3, target, 1, []);
  // some meshes (holes, non-manifold seams) stop early: finish with the sloppy simplifier
  if (I.length > target * 1.6 && Simp.simplifySloppy) { const [J] = Simp.simplifySloppy(I, m.pos, 3, null, target, 1); if (J.length >= 30) I = J; }
  return compact({ ...m, idx: I });
}

// ---------------------------------------------------------------- geometry helpers
export function triArea(P, I, t) {
  const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
  const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}
export function triNormal(P, I, t, out = [0, 0, 0]) {
  const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
  const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
  out[0] = nx / l; out[1] = ny / l; out[2] = nz / l; return out;
}
export function bounds(P) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { const v = P[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  return { mn, mx, size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
}
// apply a 3x3 row-major matrix in place
export function rotate(P, R) {
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    P[i] = R[0] * x + R[1] * y + R[2] * z; P[i + 1] = R[3] * x + R[4] * y + R[5] * z; P[i + 2] = R[6] * x + R[7] * y + R[8] * z;
  }
  return P;
}
export const mul3 = (A, B) => { const C = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return C; };
export const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
export const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
export const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
export const apply3 = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
// glTF (Y up, front +Z)  ->  Amatu Sketch (Z up, front faces −Y)
export const GLTF_TO_SKETCH = rotX(Math.PI / 2);

// ---------------------------------------------------------------- upright (meshes made in the photo's camera frame)
function hull2(pts) {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
// smallest-area enclosing rectangle of a 2D point set → { area, angle }
export function minRect(pts) {
  const h = hull2(pts.slice());
  let best = { area: Infinity, angle: 0 };
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(-ang), s = Math.sin(-ang);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of h) { const x = p[0] * c - p[1] * s, y = p[0] * s + p[1] * c; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const area = (x1 - x0) * (y1 - y0);
    if (area < best.area) best = { area, angle: ang };
  }
  return best;
}
// Finds the tilt (pitch about X, roll about Z, glTF axes) that stands the object upright:
// furniture & products sit in a box, so the tilt with the smallest bounding box wins.
// cam = direction from the object to the photo's camera (glTF axes); the side the camera saw ends up in front (+Z).
export function uprightRotation(m, cam = [0, 0, 1]) {
  const n = m.pos.length / 3, step = Math.max(1, Math.floor(n / 1500)), S = [];
  for (let i = 0; i < n; i += step) S.push([m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]]);
  const score = (pitch, roll) => {
    const R = mul3(rotZ(roll), rotX(pitch));
    let y0 = Infinity, y1 = -Infinity; const flat = [];
    for (const v of S) { const w = apply3(R, v); if (w[1] < y0) y0 = w[1]; if (w[1] > y1) y1 = w[1]; flat.push([w[0], w[2]]); }
    const r = minRect(flat);
    return { vol: r.area * (y1 - y0), yaw: r.angle, R };
  };
  let best = null;
  for (let p = -20; p <= 60; p += 4) for (let r = -16; r <= 16; r += 4) { const s = score((p * Math.PI) / 180, (r * Math.PI) / 180); if (!best || s.vol < best.vol) best = { ...s, p, r }; }
  for (let p = best.p - 3; p <= best.p + 3; p += 1) for (let r = best.r - 3; r <= best.r + 3; r += 1) { const s = score((p * Math.PI) / 180, (r * Math.PI) / 180); if (s.vol < best.vol) best = { ...s, p, r }; }
  // yaw: square the footprint to the axes, then turn by quarter turns so the camera side faces +Z
  let R = mul3(rotY(best.yaw), best.R);
  const c = apply3(R, cam), al = Math.atan2(c[0], c[2]);
  R = mul3(rotY(-Math.round(al / (Math.PI / 2)) * (Math.PI / 2)), R);
  return { R, cam: apply3(R, cam), pitch: best.p, roll: best.r };
}
// quarter turn about the vertical (sketch Z) that brings a camera azimuth within ±45° of the front
export const quarterTurn = (th) => -Math.round(th / (Math.PI / 2)) * (Math.PI / 2);

// ---------------------------------------------------------------- photo pose & colours (shape-only engines)
// Camera looking at the object from azimuth th (0 = front, + = to the right) and elevation ph, in sketch axes (Z up, front −Y).
export function camBasis(th, ph) {
  const u = [Math.sin(th) * Math.cos(ph), -Math.cos(th) * Math.cos(ph), Math.sin(ph)]; // object → camera
  const f = [-u[0], -u[1], -u[2]];
  let r = [f[1], -f[0], 0]; const rl = Math.hypot(r[0], r[1]) || 1; r = [r[0] / rl, r[1] / rl, 0];
  const up = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { u, f, r, up };
}
// rasterise triangles (screen coords already fitted to a W×H grid) into a coverage mask or z-buffer
function raster(sx, sy, sz, I, W, H, zbuf, cover) {
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const ax = sx[a], ay = sy[a], bx = sx[b], by = sy[b], cx = sx[c], cy = sy[c];
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax); if (Math.abs(area) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area, w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area, w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const k = y * W + x;
      if (cover) cover[k] = 1;
      if (zbuf) { const z = w0 * sz[a] + w1 * sz[b] + w2 * sz[c]; if (z < zbuf[k]) zbuf[k] = z; }
    }
  }
}
// fit a box (x0,y0,x1,y1) into a G×G grid keeping aspect, with a margin
const fitBox = (x0, y0, x1, y1, G, m = 0.06) => { const w = x1 - x0 || 1e-9, h = y1 - y0 || 1e-9, s = (G * (1 - 2 * m)) / Math.max(w, h); return { s, ox: G / 2 - ((x0 + x1) / 2) * s, oy: G / 2 - ((y0 + y1) / 2) * s }; };

// mask: { w, h, a: Uint8Array alpha 0..255 } of the photo cut-out
export function maskGrid(mask, G) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < mask.h; y++) for (let x = 0; x < mask.w; x++) if (mask.a[y * mask.w + x] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const F = fitBox(x0, y0, x1 + 1, y1 + 1, G), g = new Uint8Array(G * G);
  for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
    const x = Math.floor((gx + 0.5 - F.ox) / F.s), y = Math.floor((gy + 0.5 - F.oy) / F.s);
    if (x >= 0 && y >= 0 && x < mask.w && y < mask.h && mask.a[y * mask.w + x] > 127) g[gy * G + gx] = 1;
  }
  return { g, box: [x0, y0, x1 + 1, y1 + 1] };
}
function project(P, B) {
  const n = P.length / 3, sx = new Float32Array(n), sy = new Float32Array(n), sz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    sx[i] = x * B.r[0] + y * B.r[1] + z * B.r[2]; sy[i] = -(x * B.up[0] + y * B.up[1] + z * B.up[2]); sz[i] = x * B.f[0] + y * B.f[1] + z * B.f[2];
  }
  return { sx, sy, sz };
}
function silhouetteIoU(P, I, th, ph, M, G) {
  const B = camBasis(th, ph), { sx, sy, sz } = project(P, B);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < sx.length; i++) { if (sx[i] < x0) x0 = sx[i]; if (sx[i] > x1) x1 = sx[i]; if (sy[i] < y0) y0 = sy[i]; if (sy[i] > y1) y1 = sy[i]; }
  const F = fitBox(x0, y0, x1, y1, G);
  for (let i = 0; i < sx.length; i++) { sx[i] = sx[i] * F.s + F.ox; sy[i] = sy[i] * F.s + F.oy; }
  const cov = new Uint8Array(G * G); raster(sx, sy, sz, I, G, G, null, cov);
  let inter = 0, uni = 0;
  for (let k = 0; k < cov.length; k++) { const a = cov[k], b = M[k]; if (a && b) inter++; if (a || b) uni++; }
  // aspect ratio of the two boxes must agree too (fitBox hides scale)
  return uni ? inter / uni : 0;
}
// Which way was the photo taken? Searches azimuth/elevation whose silhouette best matches the cut-out.
export function photoPose(m, mask) {
  const G = 64, MG = maskGrid(mask, G); if (!MG) return null;
  let best = { iou: -1 };
  for (let a = 0; a < 360; a += 10) for (const e of [0, 12, 24, 36, 50]) {
    const iou = silhouetteIoU(m.pos, m.idx, (a * Math.PI) / 180, (e * Math.PI) / 180, MG.g, G);
    if (iou > best.iou) best = { iou, a, e };
  }
  const coarse = best.iou;
  for (let a = best.a - 8; a <= best.a + 8; a += 2) for (let e = Math.max(-6, best.e - 8); e <= best.e + 8; e += 2) {
    const iou = silhouetteIoU(m.pos, m.idx, (a * Math.PI) / 180, (e * Math.PI) / 180, MG.g, G);
    if (iou > best.iou) best = { iou, a, e };
  }
  return { th: (best.a * Math.PI) / 180, ph: (best.e * Math.PI) / 180, iou: best.iou, coarse, box: MG.box };
}

// Colours every triangle from the photo seen from `pose`; hidden triangles take their neighbours' colours.
// img: { w, h, d: Uint8ClampedArray RGBA } (the cut-out, alpha = object)
export function projectColors(m, pose, img) {
  const P = m.pos, I = m.idx, nt = I.length / 3, B = camBasis(pose.th, pose.ph), { sx, sy, sz } = project(P, B);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < sx.length; i++) { if (sx[i] < x0) x0 = sx[i]; if (sx[i] > x1) x1 = sx[i]; if (sy[i] < y0) y0 = sy[i]; if (sy[i] > y1) y1 = sy[i]; }
  // map projected box onto the photo's object box
  const [bx0, by0, bx1, by1] = pose.box, bw = bx1 - bx0, bh = by1 - by0;
  const s = Math.min(bw / (x1 - x0 || 1), bh / (y1 - y0 || 1));
  const ox = (bx0 + bx1) / 2 - ((x0 + x1) / 2) * s, oy = (by0 + by1) / 2 - ((y0 + y1) / 2) * s;
  // z-buffer in photo pixels (downscaled)
  const Z = Math.min(1, 384 / Math.max(img.w, img.h)), W = Math.ceil(img.w * Z), H = Math.ceil(img.h * Z);
  const gx = new Float32Array(sx.length), gy = new Float32Array(sx.length);
  for (let i = 0; i < sx.length; i++) { gx[i] = (sx[i] * s + ox) * Z; gy[i] = (sy[i] * s + oy) * Z; }
  const zb = new Float32Array(W * H).fill(Infinity); raster(gx, gy, sz, I, W, H, zb, null);
  const size = Math.max(x1 - x0, y1 - y0), eps = size * 0.02;
  const col = new Float32Array(nt * 3), known = new Uint8Array(nt), nrm = [0, 0, 0];
  const r = Math.max(1, Math.round(Math.max(img.w, img.h) / 300));
  for (let t = 0; t < nt; t++) {
    triNormal(P, I, t, nrm);
    const facing = nrm[0] * B.u[0] + nrm[1] * B.u[1] + nrm[2] * B.u[2];
    if (facing < 0.08) continue;
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    const cx = (gx[a] + gx[b] + gx[c]) / 3, cy = (gy[a] + gy[b] + gy[c]) / 3, cz = (sz[a] + sz[b] + sz[c]) / 3;
    const zx = Math.min(W - 1, Math.max(0, Math.floor(cx))), zy = Math.min(H - 1, Math.max(0, Math.floor(cy)));
    if (cz > zb[zy * W + zx] + eps) continue; // something sits in front of it
    const px = Math.round(cx / Z), py = Math.round(cy / Z);
    let R = 0, G = 0, Bc = 0, wsum = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const X = px + dx, Y = py + dy; if (X < 0 || Y < 0 || X >= img.w || Y >= img.h) continue;
      const k = (Y * img.w + X) * 4, al = img.d[k + 3] / 255; if (al < 0.5) continue;
      R += img.d[k] * al; G += img.d[k + 1] * al; Bc += img.d[k + 2] * al; wsum += al;
    }
    if (wsum < 0.5) continue;
    col[t * 3] = R / wsum / 255; col[t * 3 + 1] = G / wsum / 255; col[t * 3 + 2] = Bc / wsum / 255; known[t] = 1;
  }
  fillUnknown(I, nt, col, known);
  return col;
}
// breadth-first spread of colours from coloured triangles to their uncoloured neighbours
export function fillUnknown(I, nt, col, known) {
  const emap = new Map(), adj = Array.from({ length: nt }, () => []);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const a = I[t * 3 + k], b = I[t * 3 + ((k + 1) % 3)], key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
    const o = emap.get(key); if (o == null) emap.set(key, t); else { adj[t].push(o); adj[o].push(t); }
  }
  // shared vertices also connect (thin parts with open seams)
  const vt = new Map();
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const v = I[t * 3 + k]; let l = vt.get(v); if (!l) vt.set(v, (l = [])); l.push(t); }
  let q = []; for (let t = 0; t < nt; t++) if (known[t]) q.push(t);
  if (!q.length) { for (let t = 0; t < nt; t++) { col[t * 3] = col[t * 3 + 1] = col[t * 3 + 2] = 0.78; } return; }
  while (q.length) {
    const nq = [], acc = new Map();
    for (const t of q) {
      const nb = new Set(adj[t]); for (let k = 0; k < 3; k++) for (const u of vt.get(I[t * 3 + k])) nb.add(u);
      for (const u of nb) { if (known[u]) continue; let a = acc.get(u); if (!a) { acc.set(u, (a = [0, 0, 0, 0])); nq.push(u); } a[0] += col[t * 3]; a[1] += col[t * 3 + 1]; a[2] += col[t * 3 + 2]; a[3]++; }
    }
    for (const [u, a] of acc) { col[u * 3] = a[0] / a[3]; col[u * 3 + 1] = a[1] / a[3]; col[u * 3 + 2] = a[2] / a[3]; known[u] = 1; }
    q = nq;
  }
  for (let t = 0; t < nt; t++) if (!known[t]) { col[t * 3] = col[t * 3 + 1] = col[t * 3 + 2] = 0.78; }
}
// per-triangle colour from per-vertex colours (textured engines)
export function faceColors(m) {
  const nt = m.idx.length / 3, col = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) col[t * 3 + k] = (m.col[m.idx[t * 3] * 3 + k] + m.col[m.idx[t * 3 + 1] * 3 + k] + m.col[m.idx[t * 3 + 2] * 3 + k]) / 3;
  return col;
}

// ---------------------------------------------------------------- flat, clean colour regions
// triangle neighbours across shared edges, with the cosine between their normals
export function faceNeighbours(m) {
  const I = m.idx, nt = I.length / 3, N = new Float32Array(nt * 3), n = [0, 0, 0];
  for (let t = 0; t < nt; t++) { triNormal(m.pos, I, t, n); N[t * 3] = n[0]; N[t * 3 + 1] = n[1]; N[t * 3 + 2] = n[2]; }
  const emap = new Map(), adj = Array.from({ length: nt }, () => []);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const a = I[t * 3 + k], b = I[t * 3 + ((k + 1) % 3)], key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
    const o = emap.get(key);
    if (o == null) emap.set(key, t);
    else { const c = N[t * 3] * N[o * 3] + N[t * 3 + 1] * N[o * 3 + 1] + N[t * 3 + 2] * N[o * 3 + 2]; adj[t].push(o, c); adj[o].push(t, c); }
  }
  return adj;
}
// evens out photo lighting/noise between neighbours that lie in (nearly) the same surface
export function smoothColors(adj, col, wts, iters = 3, cosLim = 0.9) {
  const nt = wts.length; let a = col, b = new Float32Array(col.length);
  for (let it = 0; it < iters; it++) {
    for (let t = 0; t < nt; t++) {
      let w = wts[t] * 1.5 + 1e-12, r = a[t * 3] * w, g = a[t * 3 + 1] * w, bl = a[t * 3 + 2] * w;
      const L = adj[t];
      for (let i = 0; i < L.length; i += 2) { if (L[i + 1] < cosLim) continue; const u = L[i], wu = wts[u] + 1e-12; r += a[u * 3] * wu; g += a[u * 3 + 1] * wu; bl += a[u * 3 + 2] * wu; w += wu; }
      b[t * 3] = r / w; b[t * 3 + 1] = g / w; b[t * 3 + 2] = bl / w;
    }
    [a, b] = [b, a];
  }
  return a;
}
// majority filter of material labels: lone specks take the material around them
export function cleanLabels(adj, label, wts, iters = 3, cosLim = 0.6) {
  const nt = label.length; let a = Uint8Array.from(label);
  for (let it = 0; it < iters; it++) {
    const b = Uint8Array.from(a); let changed = 0;
    for (let t = 0; t < nt; t++) {
      const score = new Map([[a[t], wts[t] * 1.2]]), L = adj[t];
      for (let i = 0; i < L.length; i += 2) { if (L[i + 1] < cosLim) continue; const u = L[i]; score.set(a[u], (score.get(a[u]) || 0) + wts[u]); }
      let best = a[t], bs = -1; for (const [l, v] of score) if (v > bs) { bs = v; best = l; }
      if (best !== a[t]) { b[t] = best; changed++; }
    }
    a = b; if (!changed) break;
  }
  return a;
}
// drop palette entries no triangle uses any more
export function prunePalette(pal, label) {
  const used = [...new Set(label)].sort((x, y) => x - y), map = new Map(used.map((l, i) => [l, i]));
  return { centers: used.map((l) => pal.centers[l]), share: used.map((l) => pal.share[l]), label: Uint8Array.from(label, (l) => map.get(l)) };
}

// ---------------------------------------------------------------- palette (k-means in Oklab)
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
export function toLab(r, g, b) {
  r = lin(r); g = lin(g); b = lin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function fromLab(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const cl = (x) => Math.min(1, Math.max(0, gam(x)));
  return [cl(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), cl(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), cl(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
}
// returns { centers: [[r,g,b]...], label: Uint8Array per triangle }
export function palette(col, weight, k) {
  const n = weight.length, L = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const o = toLab(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]); L[i * 3] = o[0]; L[i * 3 + 1] = o[1]; L[i * 3 + 2] = o[2]; }
  let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const d2 = (i, c) => { const x = L[i * 3] - c[0], y = L[i * 3 + 1] - c[1], z = L[i * 3 + 2] - c[2]; return x * x + y * y + z * z; };
  let tw = 0; for (let i = 0; i < n; i++) tw += weight[i];
  const pick = (w) => { let r = rnd() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < n; i++) { r -= w[i]; if (r <= 0) return i; } return n - 1; };
  const j0 = pick(weight), C = [[L[j0 * 3], L[j0 * 3 + 1], L[j0 * 3 + 2]]];
  k = Math.max(1, Math.min(k, n));
  const dist = new Float64Array(n).fill(Infinity);
  while (C.length < k) {
    const c = C[C.length - 1]; const w = new Array(n);
    for (let i = 0; i < n; i++) { dist[i] = Math.min(dist[i], d2(i, c)); w[i] = dist[i] * weight[i]; }
    if (w.every((x) => x <= 1e-12)) break;
    const j = pick(w); C.push([L[j * 3], L[j * 3 + 1], L[j * 3 + 2]]);
  }
  const lab = new Uint8Array(n);
  for (let it = 0; it < 18; it++) {
    const acc = C.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) { let b = 0, bd = Infinity; for (let j = 0; j < C.length; j++) { const d = d2(i, C[j]); if (d < bd) { bd = d; b = j; } } lab[i] = b; const a = acc[b], w = weight[i]; a[0] += L[i * 3] * w; a[1] += L[i * 3 + 1] * w; a[2] += L[i * 3 + 2] * w; a[3] += w; }
    let moved = 0;
    acc.forEach((a, j) => { if (a[3] > 0) { const nc = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; moved += Math.hypot(nc[0] - C[j][0], nc[1] - C[j][1], nc[2] - C[j][2]); C[j] = nc; } });
    if (moved < 1e-4) break;
  }
  // merge near-identical centres, drop empty ones
  const used = new Map(), centers = [];
  const share = C.map(() => 0); for (let i = 0; i < n; i++) share[lab[i]] += weight[i];
  C.forEach((c, j) => {
    if (share[j] <= 0) return;
    const same = centers.findIndex((o) => Math.hypot(o.lab[0] - c[0], o.lab[1] - c[1], o.lab[2] - c[2]) < 0.025);
    if (same >= 0) { used.set(j, same); centers[same].w += share[j]; return; }
    used.set(j, centers.length); centers.push({ lab: c, w: share[j] });
  });
  for (let i = 0; i < n; i++) lab[i] = used.get(lab[i]) ?? 0;
  return { centers: centers.map((c) => fromLab(...c.lab)), share: centers.map((c) => c.w / (tw || 1)), label: lab };
}

// a friendly name for a material colour
const NAMES = [['Black', 25, 25, 25], ['Charcoal', 60, 62, 66], ['Gray', 128, 128, 128], ['Silver', 192, 192, 192], ['White', 245, 245, 245], ['Cream', 240, 230, 200], ['Beige', 215, 195, 160], ['Tan', 190, 150, 100], ['Brown', 130, 85, 45], ['Dark Brown', 75, 48, 28], ['Wood', 165, 110, 60], ['Red', 200, 40, 40], ['Maroon', 120, 25, 30], ['Orange', 235, 130, 40], ['Gold', 210, 170, 60], ['Yellow', 240, 215, 60], ['Olive', 120, 120, 50], ['Green', 60, 150, 70], ['Dark Green', 30, 80, 40], ['Teal', 30, 130, 130], ['Sky Blue', 120, 180, 230], ['Blue', 40, 90, 200], ['Navy', 25, 40, 90], ['Purple', 120, 60, 160], ['Pink', 235, 150, 180]];
export function colorName(rgb) {
  const q = toLab(...rgb); let best = 'Color', bd = Infinity;
  for (const [n, r, g, b] of NAMES) { const o = toLab(r / 255, g / 255, b / 255), d = Math.hypot(q[0] - o[0], q[1] - o[1], q[2] - o[2]); if (d < bd) { bd = d; best = n; } }
  return best;
}
export const hex = (rgb) => '#' + rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
