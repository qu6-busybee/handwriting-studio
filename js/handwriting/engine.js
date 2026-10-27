// Handwriting engine: lays out text and produces ink paths (in mm, relative to
// the text box) with writer-consistent habits plus per-instance variation.
//
// Variation layers, from most stable to most random:
//   writer seed  -> slant and per-letter habits shared by every page
//   object seed  -> line tilt, drift, warp field, per-glyph jitter
//   warp field   -> smooth spatial noise applied in line space, so repeated
//                   letters deform differently while cursive joins stay joined
import { rng, gauss, hash, makeNoise, clamp } from '../util.js';
import { getProvider, fallbackProvider, cleanProvider, getStyle } from './styles.js';

export const MANNERS = {
  neat: { rot: 1.1, scale: 0.035, base: 0.09, warp: 0.04, space: 0.1, tilt: 0.12, drift: 0.25, start: 0.3, compress: 1, slant: 0 },
  casual: { rot: 2.3, scale: 0.06, base: 0.17, warp: 0.065, space: 0.18, tilt: 0.3, drift: 0.5, start: 0.6, compress: 1, slant: 0 },
  rushed: { rot: 3.4, scale: 0.085, base: 0.26, warp: 0.09, space: 0.3, tilt: 0.6, drift: 0.9, start: 1.0, compress: 0.93, slant: 5 },
};

const NORMALISE = [[/[‘’‛]/g, "'"], [/[“”]/g, '"'], [/…/g, '...'], [/[–—]/g, '-'], [/ /g, ' ']];

// ~~strike~~ and __underline__ markup -> paragraphs of words of {ch, strike, under}
export function parseText(text) {
  for (const [re, s] of NORMALISE) text = text.replace(re, s);
  const paras = [];
  let words = [], word = [], strike = false, under = false;
  const flush = (spaceFlags) => {
    if (word.length) words.push({ chars: word, gapStrike: spaceFlags?.strike, gapUnder: spaceFlags?.under });
    word = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (text.startsWith('~~', i)) { strike = !strike; i++; continue; }
    if (text.startsWith('__', i)) { under = !under; i++; continue; }
    if (c === '\r') continue;
    if (c === '\n') { flush(); paras.push(words); words = []; continue; }
    if (c === '\t') { flush(); words.push({ indent: true, chars: [] }); continue; }
    if (c === ' ') { flush({ strike, under }); continue; }
    word.push({ ch: c, strike, under });
  }
  flush();
  paras.push(words);
  return paras;
}

function misspell(chars, r) {
  const c = chars.map((x) => ({ ...x, strike: true }));
  const i = 1 + Math.floor(r() * (c.length - 2));
  const k = r();
  if (k < 0.45 && i + 1 < c.length) [c[i], c[i + 1]] = [c[i + 1], c[i]];
  else if (k < 0.75) c.splice(i, 1);
  else c.splice(i, 0, { ...c[i] });
  return c;
}

function injectMistakes(paras, rate, seed) {
  if (!rate) return paras;
  const r = rng(hash(seed, 'mistakes'));
  return paras.map((words) => {
    const out = [];
    for (const w of words) {
      const plain = w.chars.map((c) => c.ch).join('');
      if (!w.indent && /^[A-Za-z]{4,}[.,;:!?]?$/.test(plain) && !w.chars[0].strike && r() < rate * 0.12) {
        const letters = w.chars.filter((c) => /[A-Za-z]/.test(c.ch));
        out.push({ chars: misspell(letters, r) });
      }
      out.push(w);
    }
    return out;
  });
}

const fmt = (n) => (Math.round(n * 100) / 100).toString();

// clean = true is the editing stage: a plain digital font with no handwriting
// effects. Both stages wrap with the clean font's metrics, so generating
// handwriting never changes the line breaks the user approved.
// offsets[k]: extra mm for the k-th line of the box, when the paper's lines
// are irregular (custom last line, individually adjusted lines).
export function layoutText(obj, { writerSeed, paper, clean = false, offsets = null }) {
  const hw = obj.hw;
  const cp = cleanProvider();
  const prov = clean ? cp : getProvider(hw.style);
  const fb = fallbackProvider();
  if (!prov || !fb || !cp) return null;

  const style = getStyle(hw.style);
  const J = clean ? 0 : 1; // switches every handwriting effect off
  const cursive = !clean && style?.category === 'cursive';
  const manner = MANNERS[hw.manner] || MANNERS.casual;
  const mess = clean ? 0 : clamp((1 - hw.neatness) * 2, 0, 2);
  // Line spacing comes from the paper unless the box overrides it; with
  // autoSize the letters scale with it (e.g. 8.7 mm → 7.1 mm ruling).
  const lsBase = hw.lineSpacing > 0 ? hw.lineSpacing : hw.followLines !== false ? paper.spacing : 0;
  const size = Math.max(0.5, hw.autoSize && lsBase ? lsBase * (hw.sizeRatio || 0.37) : hw.size);
  const ls = lsBase || size * 2.7;
  const firstBaseline = ls * 0.74;
  const maxW = Math.max(size * 2, obj.w);
  const comp = clean ? 1 : manner.compress;

  const pickFrom = (p) => (ch) => (p.has(ch) ? p : fb.has(ch) ? fb : null);
  const pick = pickFrom(prov);
  const habit = (ch) => {
    const r = rng(hash(writerSeed, 'habit', ch));
    return { s: gauss(r) * 0.04 * J, rot: gauss(r) * 1.6 * J, dy: gauss(r) * 0.05 * J, slant: gauss(r) * 2.2 * J, v: r() };
  };
  const habits = new Map();
  const habitOf = (ch) => habits.get(ch) || (habits.set(ch, habit(ch)), habits.get(ch));

  // Nominal word widths (before jitter) with a given provider.
  const indentW = 12.7;
  const measureWith = (base, k) => {
    const pk = pickFrom(base);
    return (w) => {
      if (w.indent) return indentW;
      let x = 0, prev = null;
      for (const c of w.chars) {
        const p = pk(c.ch);
        if (!p) { x += size * 0.6; continue; }
        const g = p.glyph(c.ch, 0);
        x += g.adv * size * k + hw.letterSpacing + (prev && p === base ? base.kern(prev, g) * size : 0);
        prev = g;
      }
      return x;
    };
  };
  const measureClean = measureWith(cp, 1);
  const measure = measureWith(prov, comp);
  const cleanSpace = Math.max(cp.space, 0.55) * size * hw.wordSpacing;
  const spaceW = Math.max(prov.space, 0.55) * size * hw.wordSpacing * comp;

  let lines = [];
  for (const words of parseText(obj.text || '')) {
    let cur = [], curW = 0;
    for (const w of words) {
      const ww = measureClean(w);
      if (cur.length && curW + cleanSpace + ww > maxW) {
        lines.push(cur);
        cur = [];
        curW = 0;
      }
      if (w.indent && !cur.length) { cur.push(w); curW = ww; continue; }
      curW += (cur.length ? cleanSpace : 0) + ww;
      cur.push(w);
    }
    lines.push(cur);
  }
  // Mistakes are added after wrapping so they never move line breaks.
  if (!clean) lines = injectMistakes(lines, hw.mistakes, hw.seed);

  // Generation
  const r = rng(hash(hw.seed, writerSeed));
  const wr = rng(hash(writerSeed, 'slant'));
  const writerSlant = gauss(wr) * 3 * J;
  const nx = makeNoise(hash(hw.seed, 'wx'));
  const ny = makeNoise(hash(hw.seed, 'wy'));
  const dn = makeNoise(hash(hw.seed, 'drift'));
  const warpAmp = (0.02 + manner.warp * mess) * size * J;
  const warpF = 1 / (size * 1.1);
  const cursiveK = cursive ? 0.3 : 1;

  const paths = []; // {fill, stroke, op, wt}
  const spans = []; // for strike/underline: {line, x0, x1, strike, under, baseY}

  lines.forEach((line, li) => {
    const baseY = firstBaseline + li * ls + (offsets?.[li] || 0);
    const tilt = Math.tan(((gauss(r) * manner.tilt * mess) * Math.PI) / 180);
    const x0 = Math.abs(gauss(r)) * manner.start * mess * 0.8;
    let x = x0;
    const driftAt = (X) => dn(X * 0.035, li * 3.7) * manner.drift * hw.drift * size * 0.22 * J;
    // A writer squeezes letters to finish a line rather than re-wrapping it.
    const natural = line.reduce((s, w, i) => s + measure(w) + (i ? spaceW : 0), x0);
    const fit = natural > maxW ? Math.max(0.78, maxW / natural) : 1;

    line.forEach((w, wi) => {
      if (wi > 0) {
        const gap = spaceW * fit * (1 + gauss(r) * manner.space * mess);
        const prev = line[wi - 1];
        if (!prev.indent && !w.indent) spans.push({ line: li, x0: x, x1: x + gap, strike: !!prev.gapStrike && w.chars[0]?.strike, under: !!prev.gapUnder && w.chars[0]?.under, baseY });
        x += gap;
      }
      if (w.indent) { x += indentW; return; }
      const wordSlant = (hw.slant + manner.slant) * J + writerSlant + gauss(r) * 1.2 * mess;
      // Pen pressure: per-word ink density and stroke weight.
      const op = 1 - hw.inkVar * 0.3 * r() * J;
      const wt = 1 + (r() - 0.5) * 0.7 * hw.inkVar * J;
      let fillD = '', strokeD = '';
      let prevG = null;

      for (const c of w.chars) {
        const p = pick(c.ch);
        if (!p) { x += size * 0.6; continue; }
        const hb = habitOf(c.ch);
        const g = p.glyph(c.ch, (hb.v + r() * 0.999) % 1);
        if (prevG && p === prov) x += prov.kern(prevG, g) * size;
        prevG = g;

        const s = 1 + gauss(r) * manner.scale * mess * (cursive ? 0.6 : 1) + hb.s;
        const sx = s * comp * fit * (1 + gauss(r) * 0.025 * mess);
        const rot = ((gauss(r) * manner.rot * mess + hb.rot) * cursiveK * Math.PI) / 180;
        const dy = (gauss(r) * manner.base * mess * (cursive ? 0.5 : 1) + hb.dy) * size + driftAt(x);
        const tanS = Math.tan(((wordSlant + hb.slant * cursiveK) * Math.PI) / 180);
        const cos = Math.cos(rot), sin = Math.sin(rot);
        const cx = (g.adv * size * sx) / 2, cy = -size / 2;
        const gx = x;

        const tf = (u, v) => {
          let px = u * size * sx, py = v * size * s;
          const rx = px - cx, ry = py - cy;
          px = cx + rx * cos - ry * sin;
          py = cy + rx * sin + ry * cos;
          px -= py * tanS;
          let X = gx + px;
          let Y = baseY + dy + py + (X - x0) * tilt;
          X += nx(X * warpF, Y * warpF) * warpAmp;
          Y += ny(X * warpF, Y * warpF) * warpAmp;
          return fmt(X) + ' ' + fmt(Y);
        };
        let d = '';
        for (const cm of g.cmds) {
          if (cm.type === 'Z') d += 'Z';
          else if (cm.type === 'M' || cm.type === 'L') d += cm.type + tf(cm.x, cm.y);
          else if (cm.type === 'Q') d += 'Q' + tf(cm.x1, cm.y1) + ' ' + tf(cm.x, cm.y);
          else if (cm.type === 'C') d += 'C' + tf(cm.x1, cm.y1) + ' ' + tf(cm.x2, cm.y2) + ' ' + tf(cm.x, cm.y);
        }
        if (g.mode === 'stroke') strokeD += d; else fillD += d;

        const adv = g.adv * size * sx + hw.letterSpacing * fit + gauss(r) * 0.04 * size * mess;
        spans.push({ line: li, x0: x, x1: x + adv, strike: c.strike, under: c.under, baseY: baseY + driftAt(x) });
        x += adv;
      }
      paths.push({ fill: fillD, stroke: strokeD, op, wt });
    });
  });

  const marks = buildMarks(spans, size, hw, r, clean);
  const height = firstBaseline + (lines.length - 1) * ls + (offsets?.[lines.length - 1] || 0) + ls * 0.36;
  return { paths, marks, height, firstBaseline, lineCount: lines.length };
}

// Cross-outs and underlines drawn as quick pen strokes over runs of glyphs.
function buildMarks(spans, size, hw, r, clean) {
  const runs = (key) => {
    const out = [];
    let cur = null;
    for (const s of spans) {
      if (s[key] && cur && cur.line === s.line) { cur.x1 = s.x1; continue; }
      if (cur) out.push(cur);
      cur = s[key] ? { ...s } : null;
    }
    if (cur) out.push(cur);
    return out;
  };
  const marks = [];
  const w = Math.max(0.28, hw.penWidth * 0.85);
  const wob = (x0, x1, y, amp) => {
    const n = Math.max(3, Math.round((x1 - x0) / 2.5));
    const slope = gauss(r) * 0.04;
    let d = '';
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const X = x0 + (x1 - x0) * t;
      const Y = y + (X - x0) * slope + gauss(r) * amp;
      d += (i ? 'L' : 'M') + fmt(X) + ' ' + fmt(Y);
    }
    return d;
  };
  if (clean) {
    // Editing stage: plain typographic strikethrough and underline.
    const straight = (x0, x1, y) => `M${fmt(x0)} ${fmt(y)}L${fmt(x1)} ${fmt(y)}`;
    for (const run of runs('strike')) marks.push({ d: straight(run.x0, run.x1, run.baseY - size * 0.5), w: 0.25 });
    for (const run of runs('under')) marks.push({ d: straight(run.x0, run.x1, run.baseY + size * 0.35), w: 0.25 });
    return marks;
  }
  for (const run of runs('strike')) {
    const a = run.x0 - 0.4 - r() * 0.6, b = run.x1 + 0.3 + r() * 0.8;
    const y = run.baseY - size * (0.45 + gauss(r) * 0.08);
    const k = r();
    let d;
    if (k < 0.7) {
      d = wob(a, b, y, size * 0.05);
      if (k < 0.35) d += wob(a + 0.5, b - 0.3, y + size * 0.22, size * 0.05);
    } else {
      // scribble-out
      const top = run.baseY - size * 1.4, bot = run.baseY - size * 0.1;
      const step = size * 0.45;
      d = `M${fmt(a)} ${fmt(bot)}`;
      let up = true;
      for (let X = a + step; X < b + step; X += step) {
        d += `L${fmt(Math.min(X, b) + gauss(r) * 0.3)} ${fmt((up ? top : bot) + gauss(r) * size * 0.08)}`;
        up = !up;
      }
    }
    marks.push({ d, w });
  }
  for (const run of runs('under')) {
    marks.push({ d: wob(run.x0 - 0.3, run.x1 + 0.3, run.baseY + size * 0.42, size * 0.04), w });
  }
  return marks;
}
