// Human-friendly measurements. Everything is stored in millimetres at full
// precision; inches are *displayed* as clean fractions ("8 1/2 in",
// "11/32 in", "1/12 in") only when the fraction is exact, otherwise as a
// short decimal. Typed input accepts fractions, decimals and unit suffixes.

const MM_PER = { in: 25.4, mm: 1, cm: 10 };
// Denominators tried in order, so the simplest exact fraction wins.
const DENOMS = [1, 2, 4, 8, 16, 32, 64, 3, 6, 12, 24, 5, 10, 20];
const EXACT = 2e-5; // inches (~0.0005 mm): only truly exact fractions qualify

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// 8.5 -> "8 1/2", 0.34375 -> "11/32", 0.0833333 -> "1/12", 0.402 -> "0.402"
export function fmtInches(inches) {
  const sign = inches < -1e-9 ? '-' : '';
  const v = Math.abs(inches);
  for (const d of DENOMS) {
    const n = Math.round(v * d);
    if (Math.abs(n / d - v) < EXACT) {
      const whole = Math.floor(n / d), rem = n - whole * d;
      if (!rem) return sign + whole;
      const g = gcd(rem, d);
      return sign + (whole ? whole + ' ' : '') + rem / g + '/' + d / g;
    }
  }
  return sign + String(+v.toFixed(3));
}

// Number only (no unit label) in the given unit.
export function fmtNum(mm, unit) {
  if (unit === 'in') return fmtInches(mm / 25.4);
  if (unit === 'cm') return String(+(mm / 10).toFixed(3));
  return String(+mm.toFixed(2));
}

// "1 1/2 in" / "8.73 mm"; for inches that aren't a clean fraction the mm
// value is added so nothing looks arbitrarily rounded.
export function fmtUnit(mm, unit, { withMm = false } = {}) {
  const s = `${fmtNum(mm, unit)} ${unit}`;
  if (!withMm || unit === 'mm') return s;
  return `${s} (${+mm.toFixed(2)} mm)`;
}

// Parses "1 1/2", "1-1/2", "1/12", "8.5", "3/4in", "21.6 mm", "2 cm", 8½.
// Returns millimetres, or NaN if it can't be read.
export function parseLength(text, unit) {
  let s = String(text).trim().toLowerCase()
    .replace(/½/g, ' 1/2').replace(/¼/g, ' 1/4').replace(/¾/g, ' 3/4').replace(/⅛/g, ' 1/8')
    .replace(/[”"]|inches|inch/g, 'in').replace(/\s+/g, ' ').trim();
  let u = unit;
  const m = s.match(/(in|mm|cm)$/);
  if (m) { u = m[1]; s = s.slice(0, -m[1].length).trim(); }
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1).trim();
  let v;
  let mm;
  if ((mm = s.match(/^(\d+(?:\.\d+)?)[\s-]+(\d+)\/(\d+)$/))) v = +mm[1] + +mm[2] / +mm[3];
  else if ((mm = s.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/))) v = +mm[1] / +mm[2];
  else if (/^\d*\.?\d+$/.test(s)) v = +s;
  else return NaN;
  if (!isFinite(v)) return NaN;
  return (neg ? -v : v) * MM_PER[u];
}

// Ruling description from line spacing, e.g. "Wide ruled · 11/32 in".
export function rulingName(spacing, blank = false) {
  if (blank) return 'Blank · no lines';
  const known = [[(11 / 32) * 25.4, 'Wide ruled'], [(9 / 32) * 25.4, 'College ruled'], [0.25 * 25.4, 'Narrow ruled'], [8, '8 mm ruled'], [7, '7 mm ruled']];
  const k = known.find(([s]) => Math.abs(s - spacing) < 0.02);
  const inch = fmtInches(spacing / 25.4);
  const metric = Math.abs(spacing - Math.round(spacing)) < 0.01;
  const size = metric && !/\//.test(inch) ? `${+spacing.toFixed(2)} mm` : `${inch} in`;
  return k ? `${k[1]} · ${k[1].includes('mm') ? `${+spacing.toFixed(2)} mm` : size}` : `Custom ruling · ${size}`;
}

// "8 × 10 1/2 in" or "210 × 297 mm" (metric when both sides are whole mm).
export function sizeName(w, h) {
  const metric = Math.abs(w - Math.round(w)) < 0.01 && Math.abs(h - Math.round(h)) < 0.01 && !/^\d+( \d+\/\d+)?$/.test(fmtInches(w / 25.4));
  return metric ? `${Math.round(w)} × ${Math.round(h)} mm` : `${fmtInches(w / 25.4)} × ${fmtInches(h / 25.4)} in`;
}
