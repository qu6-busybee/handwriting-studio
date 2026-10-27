// Notebook paper: presets, geometry and the non-printing ruling overlay.
// All measurements are millimetres. See docs/PAPER.md for sources and notes.
import { svg } from './util.js';

const IN = 25.4;

// Typical values. Brands differ by a millimetre or two, which is why every
// field is editable and paper can be adjusted directly on the canvas.
export const PAPER_PRESETS = [
  { id: 'filler-wide', name: 'Loose-leaf · Wide ruled', size: '8 × 10½ in', w: 8 * IN, h: 10.5 * IN, spacing: (11 / 32) * IN, firstLine: 1 * IN, lines: 27, margin: 1.25 * IN, rightLimit: 6, holes: true },
  { id: 'filler-college', name: 'Loose-leaf · College ruled', size: '8 × 10½ in', w: 8 * IN, h: 10.5 * IN, spacing: (9 / 32) * IN, firstLine: 1 * IN, lines: 33, margin: 1.25 * IN, rightLimit: 6, holes: true },
  { id: 'letter-wide', name: 'US Letter · Wide ruled', size: '8½ × 11 in', w: 8.5 * IN, h: 11 * IN, spacing: (11 / 32) * IN, firstLine: 1 * IN, lines: 29, margin: 1.25 * IN, rightLimit: 6, holes: true },
  { id: 'letter-college', name: 'US Letter · College ruled', size: '8½ × 11 in', w: 8.5 * IN, h: 11 * IN, spacing: (9 / 32) * IN, firstLine: 1 * IN, lines: 35, margin: 1.25 * IN, rightLimit: 6, holes: true },
  { id: 'letter-narrow', name: 'US Letter · Narrow ruled', size: '8½ × 11 in', w: 8.5 * IN, h: 11 * IN, spacing: 0.25 * IN, firstLine: 1 * IN, lines: 39, margin: 1.25 * IN, rightLimit: 6, holes: true },
  { id: 'a4-8mm', name: 'A4 · 8 mm feint & margin', size: '210 × 297 mm', w: 210, h: 297, spacing: 8, firstLine: 30, lines: 33, margin: 25, rightLimit: 8, holes: false },
  { id: 'a4-7mm', name: 'A4 · 7 mm feint & margin', size: '210 × 297 mm', w: 210, h: 297, spacing: 7, firstLine: 30, lines: 37, margin: 25, rightLimit: 8, holes: false },
  { id: 'a5-7mm', name: 'A5 · 7 mm notebook', size: '148 × 210 mm', w: 148, h: 210, spacing: 7, firstLine: 20, lines: 26, margin: 20, rightLimit: 6, holes: false },
];

const LOOK = {
  bg: '#fdfdfb',
  lineStyle: { color: '#9cc3e4', width: 0.22, opacity: 1, start: 0, end: null, angle: 0 },
  marginStyle: { show: true, color: '#e79a9a', width: 0.3, opacity: 1, start: 0, end: null },
};

// Fills in fields added after the first version so older projects keep working.
export function normalizePaper(p) {
  p.orientation ||= p.w > p.h ? 'landscape' : 'portrait';
  p.bg ||= LOOK.bg;
  p.lineStyle = { ...LOOK.lineStyle, ...(p.lineStyle || {}) };
  p.marginStyle = { ...LOOK.marginStyle, ...(p.marginStyle || {}) };
  p.extraMargins ||= [];
  p.autoLines ??= false;
  p.margins ||= { top: 6, bottom: 8, left: p.margin + 1.5, right: p.rightLimit ?? 6, linkLeft: true };
  if (p.margins.linkLeft) p.margins.left = (p.marginStyle.show ? p.margin : 0) + 1.5;
  p.rightLimit = p.margins.right;
  return p;
}

const geometryOf = (pr) => ({ w: pr.w, h: pr.h, spacing: pr.spacing, firstLine: pr.firstLine, lines: pr.lines, margin: pr.margin, rightLimit: pr.rightLimit, holes: pr.holes });

export function paperFromPreset(id) {
  const pr = allPresets().find((x) => x.id === id) || PAPER_PRESETS[0];
  const base = pr.paper ? JSON.parse(JSON.stringify(pr.paper)) : geometryOf(pr);
  return normalizePaper({ ...base, presetId: pr.id });
}

// Switching to a standard preset changes size and ruling but keeps the
// line/margin appearance; a saved preset restores everything it stored.
export function applyPreset(paper, id) {
  const pr = allPresets().find((x) => x.id === id);
  if (!pr) return;
  if (pr.paper) {
    for (const k of Object.keys(paper)) delete paper[k];
    Object.assign(paper, paperFromPreset(id));
  } else {
    Object.assign(paper, geometryOf(pr), { presetId: id, autoLines: false, orientation: pr.w > pr.h ? 'landscape' : 'portrait' });
    paper.margins = { ...paper.margins, right: pr.rightLimit, linkLeft: true };
    normalizePaper(paper);
  }
}

// ---------- saved presets (this browser) ----------
export function userPresets() {
  try { return JSON.parse(localStorage.getItem('hws.paperPresets') || '[]'); } catch { return []; }
}
const sizeLabel = (p) => `${(p.w / IN).toFixed(2)} × ${(p.h / IN).toFixed(2)} in`;
export function saveUserPreset(name, paper) {
  const id = 'user-' + Date.now().toString(36);
  const copy = JSON.parse(JSON.stringify(paper));
  delete copy.presetId;
  localStorage.setItem('hws.paperPresets', JSON.stringify([...userPresets(), { id, name, size: sizeLabel(paper), w: paper.w, h: paper.h, paper: copy }]));
  return id;
}
export function deleteUserPreset(id) {
  localStorage.setItem('hws.paperPresets', JSON.stringify(userPresets().filter((p) => p.id !== id)));
}
export const allPresets = () => [...PAPER_PRESETS, ...userPresets()];

export const paperLabel = (paper) => {
  const p = allPresets().find((x) => x.id === paper.presetId);
  return p ? `${p.name} · ${p.size}` : `Custom ${sizeLabel(paper)}`;
};

export function presetOptions(paper) {
  const opts = [{ group: 'Standard', items: PAPER_PRESETS.map((x) => ({ value: x.id, label: `${x.name} · ${x.size}` })) }];
  const mine = userPresets();
  if (mine.length) opts.push({ group: 'Saved', items: mine.map((x) => ({ value: x.id, label: `${x.name} · ${x.size}` })) });
  if (!allPresets().some((x) => x.id === paper.presetId)) opts.push({ value: paper.presetId || 'custom', label: 'Custom (not saved)' });
  return opts;
}

export function setOrientation(paper, o) {
  if (paper.orientation === o) return;
  [paper.w, paper.h] = [paper.h, paper.w];
  paper.orientation = o;
}

// ---------- ruling geometry ----------
// Lines may be tilted by a small angle, pivoting on the page's centre line.
export const tiltAt = (paper, x) => (x - paper.w / 2) * Math.tan(((paper.lineStyle?.angle || 0) * Math.PI) / 180);

export function lineCount(paper) {
  if (!paper.autoLines) return paper.lines;
  const bottom = paper.h - (paper.margins?.bottom ?? 8);
  return Math.max(0, Math.floor((bottom - paper.firstLine) / paper.spacing + 1e-6) + 1);
}

export function lineYs(paper) {
  const ys = [];
  const n = lineCount(paper);
  for (let i = 0; i < n; i++) {
    const y = paper.firstLine + i * paper.spacing;
    if (y > paper.h) break;
    ys.push(y);
  }
  return ys;
}

// Nearest ruled line to y at horizontal position x. The rhythm continues past
// the printed range so text above the first line still snaps consistently.
export function nearestLineY(paper, y, x = paper.w / 2) {
  const t = tiltAt(paper, x);
  const i = Math.round((y - t - paper.firstLine) / paper.spacing);
  return paper.firstLine + i * paper.spacing + t;
}
export const lineIndexAt = (paper, y, x = paper.w / 2) => (y - tiltAt(paper, x) - paper.firstLine) / paper.spacing;

// Writing area between the left and right margins.
export function writingBox(paper) {
  const m = paper.margins || { left: paper.margin + 1.5, right: paper.rightLimit };
  return { x: m.left, w: paper.w - m.left - m.right };
}

// The ruling as vector SVG. print=true omits the paper colour and punch holes
// (used only by the "Paper template" print modes).
export function paperOverlay(paper, { print = false } = {}) {
  normalizePaper(paper);
  const g = svg('g', { class: 'paper-overlay' });
  if (!print) g.append(svg('rect', { x: 0, y: 0, width: paper.w, height: paper.h, fill: paper.bg }));
  const ls = paper.lineStyle;
  const x1 = Math.max(0, ls.start || 0), x2 = Math.min(paper.w, ls.end ?? paper.w);
  const lines = svg('g', { stroke: ls.color, 'stroke-width': ls.width, 'stroke-opacity': ls.opacity });
  for (const y of lineYs(paper)) {
    lines.append(svg('line', { x1, x2, y1: y + tiltAt(paper, x1), y2: y + tiltAt(paper, x2) }));
  }
  g.append(lines);
  const ms = paper.marginStyle;
  const vline = (x, st) => svg('line', { x1: x, x2: x, y1: Math.max(0, ms.start || 0), y2: Math.min(paper.h, ms.end ?? paper.h), stroke: st.color || ms.color, 'stroke-width': st.width ?? ms.width, 'stroke-opacity': st.opacity ?? ms.opacity });
  if (ms.show && paper.margin > 0) g.append(vline(paper.margin, ms));
  for (const e of paper.extraMargins) g.append(vline(e.x, e));
  if (paper.holes && !print) {
    // Standard 3-hole punch: 4¼ in centres, ~3/8 in from the edge.
    const cy = paper.h / 2;
    for (const dy of [-108, 0, 108]) {
      g.append(svg('circle', { cx: 9.5, cy: cy + dy, r: 3.2, fill: '#2a2b2f', opacity: 0.12 }));
    }
  }
  return g;
}
