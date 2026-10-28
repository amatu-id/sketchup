// Length formatting & parsing (Model Info > Units). Internal unit: mm.
const F = { mm: 1, cm: 10, m: 1000, km: 1e6, in: 25.4, '"': 25.4, ft: 304.8, "'": 304.8 };

export class Units {
  constructor(model) { this.model = model; }
  get u() { return this.model.units; }
  format(mm, opts = {}) {
    const u = this.u.unit, p = opts.precision ?? this.u.precision;
    if (u === 'arch') {
      const inch = mm / 25.4, ft = Math.floor(Math.abs(inch) / 12), rest = Math.abs(inch) - ft * 12;
      return (mm < 0 ? '-' : '') + (ft ? ft + "' " : '') + rest.toFixed(Math.min(p, 3)) + '"';
    }
    const k = F[u] || 1;
    const v = mm / k;
    const s = v.toFixed(p);
    const show = opts.unit ?? this.u.showUnit ?? true;
    return (Math.abs(v - Number(s)) > 1e-9 && opts.approx !== false ? '~ ' : '') + s + (show ? ' ' + u : '');
  }
  formatArea(mm2) {
    const u = this.u.unit === 'arch' ? 'ft' : this.u.unit, k = F[u] || 1;
    const v = mm2 / (k * k);
    const unit = u === 'mm' ? 'm' : u;
    const kk = F[unit];
    return (mm2 / (kk * kk)).toFixed(u === 'mm' ? 2 : Math.max(2, this.u.precision)) + ' ' + unit + '²' + (v < 0 ? '' : '');
  }
  formatVolume(mm3) { return (mm3 / 1e9).toFixed(3) + ' m³'; }
  // parse "1200", "1.2m", "120cm", "4'6\"", "1/2\"" → mm (null if invalid)
  parse(str) {
    str = String(str).trim().toLowerCase();
    if (!str) return null;
    const ft = str.match(/^(-?[\d.]+)\s*'\s*(?:([\d.]+)\s*"?)?$/);
    if (ft) return parseFloat(ft[1]) * 304.8 + (ft[2] ? parseFloat(ft[2]) * 25.4 : 0);
    const m = str.match(/^(-?[\d.]+(?:\/[\d.]+)?)\s*(mm|cm|m|km|in|"|ft|')?$/);
    if (!m) return null;
    let v = m[1].includes('/') ? m[1].split('/').reduce((a, b) => parseFloat(a) / parseFloat(b)) : parseFloat(m[1]);
    if (!isFinite(v)) return null;
    const unit = m[2] || (this.u.unit === 'arch' ? 'in' : this.u.unit);
    return v * (F[unit] || 1);
  }
  // VCB lists such as "3000;2000" or "3000,2000" (SketchUp uses the list separator)
  parseList(str) {
    const parts = String(str).split(/[;x×]|,(?=\s*-?[\d.])/i).map((s) => s.trim()).filter(Boolean);
    return parts.map((p) => this.parse(p));
  }
}
