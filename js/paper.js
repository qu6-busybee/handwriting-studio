// Notebook paper: presets, geometry and the non-printing ruling overlay.
// All measurements are millimetres. See docs/PAPER.md for sources and notes.
import { svg } from './util.js';
import { sizeName } from './units.js';

const IN = 25.4;

// Typical values. Brands differ by a millimetre or two, which is why every
// field is editable and paper can be adjusted directly on the canvas.
export const PAPER_PRESETS = [
  { id: 'letter-blank', name: 'Blank printer paper · US Letter', size: '8 1/2 × 11 in', w: 8.5 * IN, h: 11 * IN, spacing: (5 / 16) * IN, firstLine: 1.25 * IN, lines: 28, margin: 1 * IN, rightLimit: 1 * IN, holes: false, blank: true },
  { id: 'a4-blank', name: 'Blank printer paper · A4', size: '210 × 297 mm', w: 210, h: 297, spacing: 8, firstLine: 30, lines: 31, margin: 25, rightLimit: 25, holes: false, blank: true },
  { id: 'filler-wide', name: 'Loose-leaf · Wide ruled', size: '8 × 10 1/2 in', w: 8 * IN, h: 10.5 * IN, spacing: (11 / 32) * IN, firstLine: 1 * IN, lines: 27, margin: 1.25 * IN, rightLimit: 0.25 * IN, holes: true },
  { id: 'filler-college', name: 'Loose-leaf · College ruled', size: '8 × 10 1/2 in', w: 8 * IN, h: 10.5 * IN, spacing: (9 / 32) * IN, firstLine: 1 * IN, lines: 33, margin: 1.25 * IN, rightLimit: 0.25 * IN, holes: true },
  { id: 'letter-wide', name: 'US Letter · Wide ruled', size: '8 1/2 × 11 in', w: 8.5 * IN, h: 11 * IN, spacing: (11 / 32) * IN, firstLine: 1 * IN, lines: 29, margin: 1.25 * IN, rightLimit: 0.25 * IN, holes: true },
  { id: 'letter-college', name: 'US Letter · College ruled', size: '8 1/2 × 11 in', w: 8.5 * IN, h: 11 * IN, spacing: (9 / 32) * IN, firstLine: 1 * IN, lines: 35, margin: 1.25 * IN, rightLimit: 0.25 * IN, holes: true },
  { id: 'letter-narrow', name: 'US Letter · Narrow ruled', size: '8 1/2 × 11 in', w: 8.5 * IN, h: 11 * IN, spacing: 0.25 * IN, firstLine: 1 * IN, lines: 39, margin: 1.25 * IN, rightLimit: 0.25 * IN, holes: true },
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
  p.margins ||= { top: 0.25 * IN, bottom: 0.3125 * IN, left: p.margin + IN / 16, right: p.rightLimit ?? 0.25 * IN, linkLeft: true };
  p.margins.linkLeft = true; // text always starts just right of the red line
  p.margins.freeRight ??= p.margins.right; // writing limit used when not wrapping at the right red line
  // Right-side red line: the back-of-sheet margin showing faintly through the
  // paper. x is measured from the RIGHT edge. Faded by default.
  p.rightLine = { show: true, x: p.margin, width: p.marginStyle.width, color: p.marginStyle.color, opacity: 0.3, wrap: true, ...(p.rightLine || {}) };
  // Text starts 1/16 in right of the red line; on blank paper, at the margin.
  p.margins.left = p.blank ? p.margin : (p.marginStyle.show ? p.margin : 0) + IN / 16;
  p.margins.right = p.rightLine.show && p.rightLine.wrap ? p.rightLine.x + IN / 16 : p.margins.freeRight;
  p.rightLimit = p.margins.right;
  // Real paper is rarely perfect at the bottom: the last line can have its
  // own gap, length or be hidden, without touching the regular spacing.
  p.last = { custom: false, gap: p.spacing, hidden: false, start: null, end: null, ...(p.last || {}) };
  p.lineOverrides ||= {}; // { [lineIndex]: { dy, hidden } } for individual irregular lines
  p.partials ||= []; // extra partial lines: [{ y, start, end }]
  return p;
}

const geometryOf = (pr) => ({ w: pr.w, h: pr.h, spacing: pr.spacing, firstLine: pr.firstLine, lines: pr.lines, margin: pr.margin, rightLimit: pr.rightLimit, holes: pr.holes });

// Blank printer paper: no visible lines or red margins. The ruling is still
// there as invisible guides, so text keeps even rows and plain 1 in margins.
const blankLook = () => ({
  blank: true,
  lineStyle: { ...LOOK.lineStyle, opacity: 0 },
  marginStyle: { ...LOOK.marginStyle, show: false },
  rightLine: { show: false, x: 0, width: LOOK.marginStyle.width, color: LOOK.marginStyle.color, opacity: 0.3, wrap: false },
});
const ruledLook = () => ({ blank: false, lineStyle: { ...LOOK.lineStyle }, marginStyle: { ...LOOK.marginStyle } });

export function paperFromPreset(id) {
  const pr = allPresets().find((x) => x.id === id) || PAPER_PRESETS[0];
  const base = pr.paper ? JSON.parse(JSON.stringify(pr.paper)) : { ...geometryOf(pr), ...(pr.blank ? blankLook() : {}) };
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
    paper.margins = { ...paper.margins, freeRight: pr.rightLimit, linkLeft: true };
    paper.rightLine = { ...(paper.rightLine || {}), x: pr.margin }; // back-side margin mirrors the front
    // Switching between blank and ruled paper swaps the look as well.
    if (pr.blank) Object.assign(paper, blankLook());
    else if (paper.blank) Object.assign(paper, ruledLook(), { rightLine: { ...paper.rightLine, show: true, wrap: true } });
    normalizePaper(paper);
  }
}

// ---------- saved presets (this browser) ----------
export function userPresets() {
  try { return JSON.parse(localStorage.getItem('hws.paperPresets') || '[]'); } catch { return []; }
}
const writePresets = (list) => localStorage.setItem('hws.paperPresets', JSON.stringify(list));
const sizeLabel = (p) => sizeName(p.w, p.h);
const record = (id, name, paper) => {
  const copy = JSON.parse(JSON.stringify(paper));
  delete copy.presetId;
  return { id, name, size: sizeLabel(paper), w: paper.w, h: paper.h, paper: copy, updated: Date.now() };
};
// Always creates a new preset (never overwrites an existing one).
export function saveUserPreset(name, paper) {
  const id = 'user-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  writePresets([...userPresets(), record(id, name, paper)]);
  return id;
}
// Overwrites an existing saved preset (used when editing that preset).
export function updateUserPreset(id, name, paper) {
  writePresets(userPresets().map((p) => (p.id === id ? record(id, name, paper) : p)));
}
export function renameUserPreset(id, name) {
  writePresets(userPresets().map((p) => (p.id === id ? { ...p, name } : p)));
}
export function duplicatePreset(id) {
  const src = allPresets().find((p) => p.id === id);
  if (!src) return null;
  const names = new Set(userPresets().map((p) => p.name));
  let name = `${src.name} copy`;
  for (let k = 2; names.has(name); k++) name = `${src.name} copy ${k}`;
  return saveUserPreset(name, paperFromPreset(id));
}
export function deleteUserPreset(id) {
  writePresets(userPresets().filter((p) => p.id !== id));
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

// Every ruled line with its final position (before tilt) and extent.
// Regular lines follow firstLine + i × spacing; the last line may use its own
// gap; any line may carry an individual offset or be hidden.
export function rulingLines(paper) {
  const n = lineCount(paper);
  const ls = paper.lineStyle || {}, last = paper.last || {};
  const out = [];
  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1;
    let y = paper.firstLine + i * paper.spacing;
    if (isLast && n >= 2 && last.custom) y = paper.firstLine + (n - 2) * paper.spacing + last.gap;
    const ov = paper.lineOverrides?.[i];
    if (ov?.dy) y += ov.dy;
    if (y > paper.h + 1e-6) continue;
    out.push({
      i, y, last: isLast,
      x1: Math.max(0, (isLast && last.start != null ? last.start : ls.start) || 0),
      x2: Math.min(paper.w, (isLast && last.end != null ? last.end : ls.end) ?? paper.w),
      hidden: !!ov?.hidden || (isLast && !!last.hidden),
    });
  }
  (paper.partials || []).forEach((pl, k) => {
    if (pl.y <= paper.h) out.push({ i: null, k, y: pl.y, x1: Math.max(0, pl.start ?? 0), x2: Math.min(paper.w, pl.end ?? paper.w / 2), partial: true });
  });
  return out;
}

export const lineYs = (paper) => rulingLines(paper).filter((l) => !l.hidden && !l.partial).map((l) => l.y);

// Position of line i, continuing the regular rhythm beyond the printed lines
// so text above the first or below the last line still snaps consistently.
export function lineAt(paper, i) {
  const n = lineCount(paper);
  if (i < 0 || n === 0) return paper.firstLine + i * paper.spacing;
  if (i < n) {
    const l = rulingLines(paper).find((x) => x.i === i);
    if (l) return l.y;
    return paper.firstLine + i * paper.spacing;
  }
  return lineAt(paper, n - 1) + (i - n + 1) * paper.spacing;
}

export function nearestLineIndex(paper, y, x = paper.w / 2) {
  const t = tiltAt(paper, x);
  const g = Math.round((y - t - paper.firstLine) / paper.spacing);
  let best = g, bd = Infinity;
  for (let i = g - 2; i <= g + 2; i++) {
    const d = Math.abs(lineAt(paper, i) + t - y);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Nearest ruled line to y at horizontal position x (honours irregular lines).
export function nearestLineY(paper, y, x = paper.w / 2) {
  return lineAt(paper, nearestLineIndex(paper, y, x)) + tiltAt(paper, x);
}

// Baseline offsets (mm) for a paragraph starting on line i0: how far each of
// its lines sits from the regular rhythm. Empty when the paper is regular.
export function baselineOffsets(paper, i0, count = 80) {
  const irregular = paper.last?.custom || Object.keys(paper.lineOverrides || {}).length;
  if (!irregular) return null;
  const out = [];
  for (let k = 0; k < count; k++) out.push(+(lineAt(paper, i0 + k) - (paper.firstLine + (i0 + k) * paper.spacing)).toFixed(4));
  return out.some((v) => v) ? out : null;
}

// Distance from the last printed line to the bottom edge of the sheet.
export function bottomGap(paper) {
  const ls = rulingLines(paper).filter((l) => !l.partial);
  return ls.length ? paper.h - ls[ls.length - 1].y : paper.h;
}

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
  const lines = svg('g', { stroke: ls.color, 'stroke-width': ls.width, 'stroke-opacity': ls.opacity });
  for (const l of rulingLines(paper)) {
    if (l.hidden) continue;
    lines.append(svg('line', { x1: l.x1, x2: l.x2, y1: l.y + tiltAt(paper, l.x1), y2: l.y + tiltAt(paper, l.x2) }));
  }
  g.append(lines);
  const ms = paper.marginStyle;
  const vline = (x, st) => svg('line', { x1: x, x2: x, y1: Math.max(0, ms.start || 0), y2: Math.min(paper.h, ms.end ?? paper.h), stroke: st.color || ms.color, 'stroke-width': st.width ?? ms.width, 'stroke-opacity': st.opacity ?? ms.opacity });
  if (ms.show && paper.margin > 0) g.append(vline(paper.margin, ms));
  const rl = paper.rightLine;
  if (rl?.show && rl.x > 0 && rl.x < paper.w) g.append(vline(paper.w - rl.x, rl));
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
