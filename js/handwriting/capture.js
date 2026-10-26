// Personal handwriting: draw letters, scan a filled-in template, or load a font.
// Glyphs are stored in normalised units (x-height = 1, baseline y = 0, y down).
import { h, svg, uid, toast, pickFile, readFile, bufToB64, simplify, SVG_NS } from '../util.js';
import { openModal } from '../ui/modal.js';
import { saveCustomStyle, getStyle } from './styles.js';
import { printSheets } from '../print.js';

/* global opentype */

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const PUNCT = '.,;:!?\'"-()&/';
export const CHARSET = LOWER + UPPER + DIGITS + PUNCT;

// polyline (units) -> smooth cmds
function strokeCmds(pts) {
  if (pts.length === 1) return [{ type: 'M', x: pts[0][0], y: pts[0][1] }, { type: 'L', x: pts[0][0] + 0.01, y: pts[0][1] }];
  const out = [{ type: 'M', x: pts[0][0], y: pts[0][1] }];
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i], [nx, ny] = pts[i + 1];
    out.push({ type: 'Q', x1: x, y1: y, x: (x + nx) / 2, y: (y + ny) / 2 });
  }
  const l = pts[pts.length - 1];
  out.push({ type: 'L', x: l[0], y: l[1] });
  return out;
}

// Shift a glyph so its left edge sits at a small bearing; compute advance.
function normaliseGlyph(cmds, mode) {
  let minX = Infinity, maxX = -Infinity;
  for (const c of cmds) for (const k of ['x', 'x1', 'x2']) if (k in c) { minX = Math.min(minX, c[k]); maxX = Math.max(maxX, c[k]); }
  if (!isFinite(minX)) return null;
  const lsb = 0.08, dx = lsb - minX;
  const moved = cmds.map((c) => {
    const o = { ...c };
    for (const k of ['x', 'x1', 'x2']) if (k in o) o[k] = +(o[k] + dx).toFixed(4);
    for (const k of ['y', 'y1', 'y2']) if (k in o) o[k] = +o[k].toFixed(4);
    return o;
  });
  return { cmds: moved, adv: +(maxX - minX + lsb * 2.4).toFixed(4), mode };
}

const cmdsToD = (cmds, k = 1, ox = 0, oy = 0) => cmds.map((c) => {
  const p = (x, y) => `${(ox + x * k).toFixed(2)} ${(oy + y * k).toFixed(2)}`;
  if (c.type === 'Z') return 'Z';
  if (c.type === 'Q') return `Q${p(c.x1, c.y1)} ${p(c.x, c.y)}`;
  if (c.type === 'C') return `C${p(c.x1, c.y1)} ${p(c.x2, c.y2)} ${p(c.x, c.y)}`;
  return c.type + p(c.x, c.y);
}).join('');

function glyphThumb(g, size = 54) {
  const s = svg('svg', { viewBox: '-0.2 -2.4 3 3.6', width: size, height: size });
  s.append(svg('line', { x1: -0.2, x2: 2.8, y1: 0, y2: 0, stroke: '#9cc3e4', 'stroke-width': 0.03 }));
  s.append(g.mode === 'stroke'
    ? svg('path', { d: cmdsToD(g.cmds), fill: 'none', stroke: '#22408f', 'stroke-width': 0.09, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
    : svg('path', { d: cmdsToD(g.cmds), fill: '#22408f' }));
  return s;
}

// ---------- 1. Draw your letters ----------
export function openDrawStudio(existingId) {
  const existing = existingId && getStyle(existingId);
  const rec = existing ? JSON.parse(JSON.stringify(existing)) : { id: uid('hs'), name: 'My handwriting', kind: 'glyphs', category: 'casual', glyphs: {}, space: 0.9 };
  let cur = 'a';
  let strokes = [];
  const m = openModal('Draw your letters', { wide: true });

  const W = 560, H = 300, XH = 64, BASE = 200, LEFT = 60;
  const cv = h('canvas.pad', { width: W * 2, height: H * 2 });
  cv.style.width = W + 'px';
  cv.style.height = H + 'px';
  const ctx = cv.getContext('2d');
  ctx.scale(2, 2);

  const drawGuides = () => {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fdfdfb';
    ctx.fillRect(0, 0, W, H);
    const line = (y, c, dash) => { ctx.strokeStyle = c; ctx.setLineDash(dash || []); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); };
    line(BASE - XH * 2.1, '#e1e7ef', [4, 4]);
    line(BASE - XH, '#c7d6ea', [6, 4]);
    line(BASE, '#8fb7de');
    line(BASE + XH * 0.9, '#e1e7ef', [4, 4]);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.font = `${XH * 2.6}px Inter, sans-serif`;
    ctx.fillText(cur, LEFT + 260, BASE);
    ctx.strokeStyle = '#1d2f6f';
    ctx.lineWidth = 3;
    ctx.lineCap = ctx.lineJoin = 'round';
    for (const s of strokes) {
      ctx.beginPath();
      s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (s.length === 1) ctx.lineTo(s[0][0] + 0.1, s[0][1]);
      ctx.stroke();
    }
  };

  let drawing = null;
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const r = cv.getBoundingClientRect();
    drawing = [[e.clientX - r.left, e.clientY - r.top]];
    strokes.push(drawing);
    drawGuides();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const r = cv.getBoundingClientRect();
    drawing.push([e.clientX - r.left, e.clientY - r.top]);
    drawGuides();
  });
  cv.addEventListener('pointerup', () => (drawing = null));

  const saveVariant = () => {
    if (!strokes.length) return toast('Draw the letter first');
    const cmds = strokes.flatMap((s) => strokeCmds(simplify(s, 0.8).map(([x, y]) => [(x - LEFT) / XH, (y - BASE) / XH])));
    const g = normaliseGlyph(cmds, 'stroke');
    (rec.glyphs[cur] ||= []).push(g);
    strokes = [];
    refresh();
  };
  const next = () => {
    const i = CHARSET.indexOf(cur);
    cur = CHARSET[(i + 1) % CHARSET.length];
    strokes = [];
    refresh();
  };

  const charGrid = h('div.char-grid');
  const variants = h('div.variants');
  const refresh = () => {
    charGrid.replaceChildren(...[...CHARSET].map((c) => h('button' + (c === cur ? '.on' : '') + (rec.glyphs[c]?.length ? '.done' : ''), { title: `${rec.glyphs[c]?.length || 0} sample(s)`, on: { click: () => { cur = c; strokes = []; refresh(); } } }, c)));
    variants.replaceChildren(h('span.muted', `Samples of “${cur}”: `), ...(rec.glyphs[cur] || []).map((g, i) => h('div.variant', glyphThumb(g), h('button.icon-btn.tiny', { title: 'Remove', on: { click: () => { rec.glyphs[cur].splice(i, 1); refresh(); } } }, '✕'))));
    drawGuides();
  };

  const nameIn = h('input', { type: 'text', value: rec.name });
  m.body.append(h('div.draw-layout',
    h('div', h('p.muted', 'Write each character on the guides: the blue line is the baseline and the dashed line is the top of lowercase letters. Add 2–3 samples of common letters for natural variety.'), charGrid),
    h('div.pad-col', cv,
      h('div.row',
        h('button.btn', { on: { click: () => { strokes.pop(); drawGuides(); } } }, 'Undo stroke'),
        h('button.btn', { on: { click: () => { strokes = []; drawGuides(); } } }, 'Clear'),
        h('span.grow'),
        h('button.btn', { on: { click: saveVariant } }, 'Add sample'),
        h('button.btn.primary', { on: { click: () => { if (strokes.length) saveVariant(); next(); } } }, 'Add & next →')),
      variants)));
  m.foot.append(h('label.inline', 'Style name ', nameIn), h('button.btn.primary', { on: { click: async () => {
    if (!Object.keys(rec.glyphs).length) return toast('Draw at least a few letters first');
    rec.name = nameIn.value || 'My handwriting';
    await saveCustomStyle(rec);
    toast(`Saved “${rec.name}”. Letters you haven't drawn use a matching fallback.`, 3500);
    m.close();
  } } }, 'Save style'));
  m.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName !== 'INPUT') { e.preventDefault(); if (strokes.length) saveVariant(); next(); } });
  refresh();
}

// ---------- 2. Scan a template ----------
// Letter sheet; marks stay ≥ 8 mm from edges so printers don't clip them.
const TPL = { w: 215.9, h: 279.4, cols: 9, cw: 20, ch: 18.5, gx: 17.95, gy: 34, base: 12.5, xh: 5, inset: 1.3 };
const TPL_CHARS = LOWER + LOWER + UPPER + DIGITS + PUNCT;
TPL.rows = Math.ceil(TPL_CHARS.length / TPL.cols);
const markCentres = () => {
  const gw = TPL.cols * TPL.cw, gh = TPL.rows * TPL.ch;
  return [[TPL.gx - 7, TPL.gy - 7], [TPL.gx + gw + 7, TPL.gy - 7], [TPL.gx + gw + 7, TPL.gy + gh + 7], [TPL.gx - 7, TPL.gy + gh + 7]];
};

function templateSheet() {
  const root = svg('svg', { xmlns: SVG_NS, viewBox: `0 0 ${TPL.w} ${TPL.h}` });
  const t = (x, y, s, size, fill = '#000') => { const e = svg('text', { x, y, 'font-size': size, fill, 'font-family': 'sans-serif' }); e.textContent = s; root.append(e); };
  t(TPL.gx, 14, 'Handwriting Studio — handwriting sample sheet', 4.2);
  t(TPL.gx, 20.5, 'Use the pen you print with. Sit letters on the blue baseline; lowercase reaches the dashed line. Stay inside the boxes.', 2.7, '#555');
  t(TPL.gx, 25, 'Scan or photograph the whole sheet flat and straight, including the four black squares.', 2.7, '#555');
  for (const [x, y] of markCentres()) root.append(svg('rect', { x: x - 3, y: y - 3, width: 6, height: 6, fill: '#000' }));
  [...TPL_CHARS].forEach((c, i) => {
    const x = TPL.gx + (i % TPL.cols) * TPL.cw, y = TPL.gy + Math.floor(i / TPL.cols) * TPL.ch;
    root.append(svg('rect', { x, y, width: TPL.cw, height: TPL.ch, fill: 'none', stroke: '#d2d2d2', 'stroke-width': 0.2 }));
    root.append(svg('line', { x1: x + 1, x2: x + TPL.cw - 1, y1: y + TPL.base, y2: y + TPL.base, stroke: '#9fd4f2', 'stroke-width': 0.25 }));
    root.append(svg('line', { x1: x + 1, x2: x + TPL.cw - 1, y1: y + TPL.base - TPL.xh, y2: y + TPL.base - TPL.xh, stroke: '#bfe3f7', 'stroke-width': 0.2, 'stroke-dasharray': '1 1' }));
    const e = svg('text', { x: x + 1.2, y: y + 3.2, 'font-size': 2.6, fill: '#bdbdbd', 'font-family': 'sans-serif' });
    e.textContent = c;
    root.append(e);
  });
  return root;
}

function solveHomography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [X, Y] = src[i], [x, y] = dst[i];
    A.push([X, Y, 1, 0, 0, 0, -x * X, -x * Y]); b.push(x);
    A.push([0, 0, 0, X, Y, 1, -y * X, -y * Y]); b.push(y);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const hm = b.map((v, i) => v / A[i][i]);
  return (X, Y) => {
    const w = hm[6] * X + hm[7] * Y + 1;
    return [(hm[0] * X + hm[1] * Y + hm[2]) / w, (hm[3] * X + hm[4] * Y + hm[5]) / w];
  };
}

// Directed boundary edges with ink on the right, chained into closed loops.
// Consistent orientation means non-zero fill renders holes correctly.
function traceContours(mask, w, hh) {
  const ink = (x, y) => x >= 0 && y >= 0 && x < w && y < hh && mask[y * w + x];
  const edges = new Map();
  const add = (x1, y1, x2, y2) => {
    const k = x1 + ',' + y1;
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push([x2, y2]);
  };
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    if (!ink(x, y - 1)) add(x, y, x + 1, y);
    if (!ink(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!ink(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!ink(x - 1, y)) add(x, y + 1, x, y);
  }
  const loops = [];
  for (const [k, list] of edges) {
    while (list.length) {
      const [sx, sy] = k.split(',').map(Number);
      const loop = [[sx, sy]];
      let [cx, cy] = list.pop();
      let guard = 0;
      while (!(cx === sx && cy === sy) && guard++ < 1e6) {
        loop.push([cx, cy]);
        const nxt = edges.get(cx + ',' + cy);
        if (!nxt || !nxt.length) break;
        [cx, cy] = nxt.pop();
      }
      if (loop.length > 3) loops.push(loop);
    }
  }
  return loops;
}

const polyArea = (p) => p.reduce((a, [x, y], i) => { const [nx, ny] = p[(i + 1) % p.length]; return a + x * ny - nx * y; }, 0) / 2;

function chaikin(p, n = 2) {
  for (let k = 0; k < n; k++) {
    const q = [];
    for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length];
      q.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25], [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
    }
    p = q;
  }
  return p;
}

function extractCell(img, H, col, row) {
  const R = 10; // samples per mm
  const x0 = TPL.gx + col * TPL.cw + TPL.inset, y0 = TPL.gy + row * TPL.ch + TPL.inset;
  const cw = TPL.cw - TPL.inset * 2, chh = TPL.ch - TPL.inset * 2;
  const w = Math.round(cw * R), hh = Math.round(chh * R);
  const lum = new Float32Array(w * hh);
  const { data, width, height } = img;
  for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) {
    const [px, py] = H(x0 + i / R, y0 + j / R);
    const xi = Math.min(width - 1, Math.max(0, Math.round(px))), yi = Math.min(height - 1, Math.max(0, Math.round(py)));
    const o = (yi * width + xi) * 4;
    lum[j * w + i] = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) / 255;
  }
  const sorted = Float32Array.from(lum).sort();
  const white = sorted[Math.floor(sorted.length * 0.9)];
  const thr = white * 0.62;
  const mask = new Uint8Array(w * hh);
  let count = 0;
  for (let i = 0; i < mask.length; i++) if (lum[i] < thr) { mask[i] = 1; count++; }
  if (count < 25) return null;
  const loops = traceContours(mask, w, hh)
    .filter((l) => Math.abs(polyArea(l)) > 6)
    .map((l) => simplify(chaikin(l, 2), 0.35));
  if (!loops.length) return null;
  const baseY = TPL.base - TPL.inset;
  const cmds = [];
  for (const l of loops) {
    l.forEach(([x, y], i) => cmds.push({ type: i ? 'L' : 'M', x: x / R / TPL.xh, y: (y / R - baseY) / TPL.xh }));
    cmds.push({ type: 'Z' });
  }
  return normaliseGlyph(cmds, 'fill');
}

export function openScanStudio() {
  const m = openModal('Scan your handwriting', { wide: true });
  const stage = h('div.scan-stage');
  const results = h('div.scan-results');
  let imgData = null, pts = null, glyphs = null;

  const intro = h('div.scan-intro',
    h('ol',
      h('li', 'Print the sample sheet (Letter size, 100% scale).'),
      h('li', 'Fill every box with the pen you normally use.'),
      h('li', 'Scan or photograph it flat, then upload the image.'),
      h('li', 'Drag the four numbered dots onto the four black squares and extract.')),
    h('div.row',
      h('button.btn', { on: { click: () => printSheets([templateSheet()], { w: TPL.w, h: TPL.h }) } }, 'Print sample sheet'),
      h('button.btn.primary', { on: { click: upload } }, 'Upload scan or photo…')));

  async function upload() {
    const f = await pickFile('image/*');
    if (!f) return;
    const url = await readFile(f);
    const img = new Image();
    img.src = url;
    await img.decode();
    const maxSide = 2600;
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    imgData = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    const iw = c.width, ih = c.height;
    pts = [[0.06, 0.06], [0.94, 0.06], [0.94, 0.94], [0.06, 0.94]].map(([u, v]) => [u * iw, v * ih]);
    c.className = 'scan-img';
    const box = h('div.scan-box', c);
    const dots = pts.map((p, i) => {
      const d = h('div.scan-dot', String(i + 1));
      d.addEventListener('pointerdown', (e) => {
        d.setPointerCapture(e.pointerId);
        const mv = (ev) => {
          const r = c.getBoundingClientRect();
          pts[i] = [((ev.clientX - r.left) / r.width) * iw, ((ev.clientY - r.top) / r.height) * ih];
          place();
        };
        d.addEventListener('pointermove', mv);
        d.addEventListener('pointerup', () => d.removeEventListener('pointermove', mv), { once: true });
      });
      box.append(d);
      return d;
    });
    const place = () => dots.forEach((d, i) => Object.assign(d.style, { left: (pts[i][0] / iw) * 100 + '%', top: (pts[i][1] / ih) * 100 + '%' }));
    place();
    stage.replaceChildren(box, h('div.row', h('span.muted', '1 top-left · 2 top-right · 3 bottom-right · 4 bottom-left'), h('span.grow'), h('button.btn.primary', { on: { click: extract } }, 'Extract letters')));
  }

  function extract() {
    const H = solveHomography(markCentres(), pts);
    glyphs = {};
    let found = 0;
    [...TPL_CHARS].forEach((c, i) => {
      const g = extractCell(imgData, H, i % TPL.cols, Math.floor(i / TPL.cols));
      if (g) { (glyphs[c] ||= []).push(g); found++; }
    });
    results.replaceChildren(
      h('p.muted', `Found ${found} of ${TPL_CHARS.length} samples. Click a letter to discard a bad sample.`),
      h('div.scan-grid', ...Object.entries(glyphs).flatMap(([c, list]) => list.map((g, i) => {
        const cell = h('button.scan-cell', { title: c, on: { click: () => { cell.classList.toggle('off'); g.off = !g.off; } } }, glyphThumb(g, 48), h('span', c));
        return cell;
      }))));
    nameRow.hidden = false;
  }

  const nameIn = h('input', { type: 'text', value: 'My scanned handwriting' });
  const nameRow = h('div.row', { hidden: true }, h('label.inline', 'Style name ', nameIn), h('span.grow'), h('button.btn.primary', { on: { click: async () => {
    const clean = {};
    for (const [c, list] of Object.entries(glyphs)) {
      const keep = list.filter((g) => !g.off);
      if (keep.length) clean[c] = keep;
    }
    await saveCustomStyle({ id: uid('hs'), name: nameIn.value || 'My handwriting', kind: 'glyphs', category: 'casual', glyphs: clean, space: 0.95 });
    toast('Handwriting style saved');
    m.close();
  } } }, 'Save style'));
  m.body.append(intro, stage, results);
  m.foot.append(nameRow);
}

// Exposed for tests/debugging of the scan pipeline.
export const scanInternals = { TPL, TPL_CHARS, markCentres, templateSheet, solveHomography, extractCell };

// ---------- 3. Upload a font ----------
export async function uploadFontStyle() {
  const f = await pickFile('.ttf,.otf,.woff');
  if (!f) return;
  try {
    const buf = await readFile(f, 'buffer');
    const font = opentype.parse(buf);
    const name = font.names.fontFamily?.en || f.name.replace(/\.\w+$/, '');
    await saveCustomStyle({ id: uid('hs'), name, kind: 'font', category: 'casual', data: bufToB64(buf) });
    toast(`Added “${name}”`);
  } catch (e) {
    toast('That font could not be read (TTF, OTF or WOFF only): ' + e.message, 4000);
  }
}
