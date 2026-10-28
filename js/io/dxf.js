// Minimal AutoCAD R12 (AC1009) DXF writer — opens in AutoCAD, BricsCAD, LibreCAD, SketchUp Pro.
export class DXF {
  constructor() { this.layers = new Map([['0', 7]]); this.ents = []; }
  layer(name, color = 7) { this.layers.set(name, color); }
  n(x) { return (Math.round(x * 1e4) / 1e4).toString(); }
  ensure(l) { if (l && !this.layers.has(l)) this.layers.set(l, 7); return l || '0'; }
  line(x1, y1, z1, x2, y2, z2, layer) { this.ents.push(['0', 'LINE', '8', this.ensure(layer), '10', this.n(x1), '20', this.n(y1), '30', this.n(z1), '11', this.n(x2), '21', this.n(y2), '31', this.n(z2)]); }
  face3(a, b, c, d, layer) { const q = d || c; this.ents.push(['0', '3DFACE', '8', this.ensure(layer), '10', this.n(a[0]), '20', this.n(a[1]), '30', this.n(a[2]), '11', this.n(b[0]), '21', this.n(b[1]), '31', this.n(b[2]), '12', this.n(c[0]), '22', this.n(c[1]), '32', this.n(c[2]), '13', this.n(q[0]), '23', this.n(q[1]), '33', this.n(q[2])]); }
  solid(pts, layer) { const [a, b, c] = pts, d = pts[3] || c; this.ents.push(['0', 'SOLID', '8', this.ensure(layer), '10', this.n(a[0]), '20', this.n(a[1]), '30', '0', '11', this.n(b[0]), '21', this.n(b[1]), '31', '0', '12', this.n(d[0]), '22', this.n(d[1]), '32', '0', '13', this.n(c[0]), '23', this.n(c[1]), '33', '0']); }
  circle(x, y, r, layer) { this.ents.push(['0', 'CIRCLE', '8', this.ensure(layer), '10', this.n(x), '20', this.n(y), '30', '0', '40', this.n(r)]); }
  text(x, y, h, s, layer, rot = 0, align = 'left') {
    const ha = { left: 0, center: 1, right: 2 }[align] || 0;
    const e = ['0', 'TEXT', '8', this.ensure(layer), '10', this.n(x), '20', this.n(y), '30', '0', '40', this.n(h), '1', String(s).replace(/[\r\n]+/g, ' '), '50', this.n(rot || 0)];
    if (ha) e.push('72', String(ha), '11', this.n(x), '21', this.n(y), '31', '0');
    this.ents.push(e);
  }
  toString() {
    const o = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '9', '$MEASUREMENT', '70', '1', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', String(this.layers.size)];
    for (const [name, c] of this.layers) o.push('0', 'LAYER', '2', name, '70', '0', '62', String(c), '6', 'CONTINUOUS');
    o.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');
    for (const e of this.ents) o.push(...e);
    o.push('0', 'ENDSEC', '0', 'EOF');
    return o.join('\n') + '\n';
  }
}
