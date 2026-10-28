// 2D overlay canvas: inference markers, tooltips, tool previews, dimensions & text labels.
import * as THREE from 'three';

export const COL = { red: '#e0261b', green: '#119b3a', blue: '#1f5fe0', magenta: '#d01ad0', end: '#14b014', mid: '#0aa8c8', edge: '#e0261b', face: '#2357e8', guide: '#555', sel: '#0b57ff', black: '#111', orange: '#ec7a12', gray: '#7a7f87' };

export class Overlay {
  constructor(view, el) {
    this.view = view;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'overlay';
    el.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d');
    this.marker = null; // {p, type, label, color}
    this.lines = [];
  }
  resize(w, h, dpr) {
    dpr = dpr || Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.w = w; this.h = h;
  }
  P(p) { return this.view.project(p); }
  // clip a 3D segment against the camera near plane before projecting
  seg(a, b) {
    const cam = this.view.camera;
    const va = a.clone().applyMatrix4(cam.matrixWorldInverse), vb = b.clone().applyMatrix4(cam.matrixWorldInverse);
    const near = -(cam.near * 1.01);
    if (va.z > near && vb.z > near) return null;
    if (va.z > near) va.lerp(vb, (va.z - near) / (va.z - vb.z));
    else if (vb.z > near) vb.lerp(va, (vb.z - near) / (vb.z - va.z));
    const pa = va.applyMatrix4(cam.projectionMatrix), pb = vb.applyMatrix4(cam.projectionMatrix);
    return [{ x: ((pa.x + 1) / 2) * this.w, y: ((1 - pa.y) / 2) * this.h }, { x: ((pb.x + 1) / 2) * this.w, y: ((1 - pb.y) / 2) * this.h }];
  }
  line(a, b, color = COL.black, width = 1, dash = null) {
    const s = this.seg(a, b); if (!s) return;
    const g = this.g; g.save(); g.strokeStyle = color; g.lineWidth = width; if (dash) g.setLineDash(dash);
    g.beginPath(); g.moveTo(s[0].x, s[0].y); g.lineTo(s[1].x, s[1].y); g.stroke(); g.restore();
  }
  poly(pts, stroke = COL.black, fill = null, width = 1, dash = null, closed = true) {
    if (pts.length < 2) return;
    const g = this.g; g.save();
    if (dash) g.setLineDash(dash);
    const sp = pts.map((p) => this.P(p)); if (sp.some((q) => q.behind)) { g.restore(); for (let i = 0; i + 1 < pts.length + (closed ? 1 : 0) - 0; i++) { if (i + 1 >= pts.length && !closed) break; this.line(pts[i], pts[(i + 1) % pts.length], stroke, width, dash); } return; }
    g.beginPath(); g.moveTo(sp[0].x, sp[0].y); for (const q of sp.slice(1)) g.lineTo(q.x, q.y); if (closed) g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = width; g.stroke(); }
    g.restore();
  }
  dot(p, color, r = 4, shape = 'circle', fill = true) {
    const q = this.P(p); if (q.behind) return;
    this.dot2(q.x, q.y, color, r, shape, fill);
  }
  dot2(x, y, color, r = 4, shape = 'circle', fill = true) {
    const g = this.g; g.save(); g.lineWidth = 1.5; g.strokeStyle = shape === 'circle' && fill ? '#fff' : color; g.fillStyle = color;
    g.beginPath();
    if (shape === 'circle') g.arc(x, y, r, 0, Math.PI * 2);
    else if (shape === 'square') g.rect(x - r, y - r, r * 2, r * 2);
    else if (shape === 'diamond') { g.moveTo(x, y - r - 1); g.lineTo(x + r + 1, y); g.lineTo(x, y + r + 1); g.lineTo(x - r - 1, y); g.closePath(); }
    if (fill) { g.fill(); g.stroke(); } else { g.strokeStyle = color; g.stroke(); }
    g.restore();
  }
  tooltip(x, y, text) {
    const g = this.g; g.save(); g.font = '12px -apple-system, "Segoe UI", sans-serif';
    const w = g.measureText(text).width + 10;
    let tx = x + 14, ty = y + 18;
    if (tx + w > this.w) tx = x - w - 6; if (ty + 20 > this.h) ty = y - 26;
    g.fillStyle = 'rgba(255,255,236,0.96)'; g.strokeStyle = '#9a9a7a'; g.lineWidth = 1;
    g.beginPath(); g.rect(tx + 0.5, ty + 0.5, w, 19); g.fill(); g.stroke();
    g.fillStyle = '#222'; g.fillText(text, tx + 5, ty + 14);
    g.restore();
  }
  label(p, text, opts = {}) {
    const q = this.P(p); if (q.behind) return;
    this.label2(q.x, q.y, text, opts);
  }
  label2(x, y, text, opts = {}) {
    const g = this.g; g.save();
    g.font = `${opts.bold ? '600 ' : ''}${opts.size || 12}px -apple-system, "Segoe UI", sans-serif`;
    const w = g.measureText(text).width + 8, h = (opts.size || 12) + 6;
    const bx = x - (opts.align === 'left' ? 0 : w / 2), by = y - h / 2;
    if (opts.bg !== false) { g.fillStyle = opts.bg || 'rgba(255,255,255,0.92)'; g.fillRect(bx, by, w, h); }
    if (opts.border) { g.strokeStyle = opts.border; g.lineWidth = opts.sel ? 2 : 1; g.strokeRect(bx + 0.5, by + 0.5, w, h); }
    g.fillStyle = opts.color || '#111'; g.textBaseline = 'middle'; g.fillText(text, bx + 4, y + 0.5);
    g.restore();
    return { x: bx, y: by, w, h };
  }
  arrowHead(a, b, color, size = 8) {
    const s = this.seg(a, b); if (!s) return;
    const [p, q] = s; const ang = Math.atan2(q.y - p.y, q.x - p.x);
    const g = this.g; g.save(); g.fillStyle = color; g.beginPath(); g.moveTo(q.x, q.y);
    g.lineTo(q.x - size * Math.cos(ang - 0.4), q.y - size * Math.sin(ang - 0.4)); g.lineTo(q.x - size * Math.cos(ang + 0.4), q.y - size * Math.sin(ang + 0.4)); g.closePath(); g.fill(); g.restore();
  }
  draw() {
    const g = this.g, app = this.view.app;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    this.drawAnnots();
    app.tool?.draw?.(this);
    const m = this.marker;
    if (m) {
      for (const l of m.lines || []) this.line(l[0], l[1], l[2], l[3] || 1.5, l[4] || [6, 4]);
      if (m.p) {
        const q = this.P(m.p);
        if (!q.behind) {
          const shape = { end: 'circle', mid: 'circle', center: 'circle', edge: 'square', face: 'diamond', guide: 'square', gpoint: 'circle', intersect: 'circle' }[m.type];
          if (shape) this.dot2(q.x, q.y, m.color, m.type === 'face' ? 4.5 : 5, shape, m.type !== 'center');
          if (m.label && app.settings.tooltips !== false) this.tooltip(q.x, q.y, m.label);
        }
      }
    }
    if (app.rubber) {
      const r = app.rubber; g.save();
      g.strokeStyle = r.crossing ? '#1a1a1a' : '#1a1a1a'; g.setLineDash(r.crossing ? [5, 4] : []);
      g.fillStyle = r.crossing ? 'rgba(80,200,120,0.08)' : 'rgba(30,110,255,0.08)';
      g.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0); g.strokeRect(r.x0 + 0.5, r.y0 + 0.5, r.x1 - r.x0, r.y1 - r.y0); g.restore();
    }
  }
  drawAnnots() {
    const app = this.view.app, list = this.view.annots || [];
    const fmt = (x) => app.units.format(x);
    for (const a of list) {
      const sel = app.ctxPathEq(a.path) && app.sel.has(a.key);
      const col = sel ? COL.sel : '#111';
      if (a.type === 'dim') {
        const A = a.a.clone().add(a.off), B = a.b.clone().add(a.off);
        const ext = a.off.clone().normalize().multiplyScalar(Math.min(a.off.length() * 0.15, 80));
        if (a.kind === 'radius' || a.kind === 'diameter') {
          this.line(a.a, a.b, col, 1); this.arrowHead(a.a, a.b, col, 8);
          this.label(a.b, (a.kind === 'radius' ? 'R' : 'DIA ') + fmt(a.r), { border: sel ? COL.sel : null, sel });
          continue;
        }
        this.line(a.a, A.clone().add(ext), col, 1); this.line(a.b, B.clone().add(ext), col, 1);
        this.line(A, B, col, 1);
        this.arrowHead(B, A, col, 8); this.arrowHead(A, B, col, 8);
        const mid = A.clone().add(B).multiplyScalar(0.5);
        this.label(mid, a.text || fmt(a.a.distanceTo(a.b)), { border: sel ? COL.sel : null, sel });
      } else if (a.type === 'text') {
        if (a.screen) { this.label2(a.sx * this.w, a.sy * this.h, a.text, { align: 'left', bg: 'rgba(255,255,255,0.0)', size: 13, border: sel ? COL.sel : null }); continue; }
        if (a.at) { this.line(a.at, a.p, col, 1); this.dot(a.at, col, 2.5); }
        this.label(a.p, a.text, { border: sel ? COL.sel : '#999', sel });
      } else if (a.type === 'gpoint') {
        const q = this.P(a.p); if (q.behind) continue;
        const gg = this.g; gg.save(); gg.strokeStyle = sel ? COL.sel : '#555'; gg.lineWidth = 1.2; gg.beginPath(); gg.moveTo(q.x - 5, q.y - 5); gg.lineTo(q.x + 5, q.y + 5); gg.moveTo(q.x + 5, q.y - 5); gg.lineTo(q.x - 5, q.y + 5); gg.stroke(); gg.restore();
      }
    }
  }
}
export { THREE };
