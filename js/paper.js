// Notebook paper presets and the on-screen ruling overlay.
// All measurements are millimetres. See docs/PAPER.md for sources and notes.
import { svg } from './util.js';

const IN = 25.4;

// Typical values. Brands differ by a millimetre or two, which is why every
// field is editable and the "measure my paper" helper exists.
export const PAPER_PRESETS = [
  { id: 'filler-wide', name: 'Wide ruled filler', size: '8 × 10½ in', w: 8 * IN, h: 10.5 * IN, spacing: (11 / 32) * IN, firstLine: 1 * IN, lines: 27, margin: 1.25 * IN, rightLimit: 6, holes: true },
  { id: 'filler-college', name: 'College ruled filler', size: '8 × 10½ in', w: 8 * IN, h: 10.5 * IN, spacing: (9 / 32) * IN, firstLine: 1 * IN, lines: 33, margin: 1.25 * IN, rightLimit: 6, holes: true },
  { id: 'letter-wide', name: 'Wide ruled', size: 'Letter 8½ × 11 in', w: 8.5 * IN, h: 11 * IN, spacing: (11 / 32) * IN, firstLine: 1 * IN, lines: 29, margin: 1.25 * IN, rightLimit: 6, holes: true },
  { id: 'letter-college', name: 'College ruled', size: 'Letter 8½ × 11 in', w: 8.5 * IN, h: 11 * IN, spacing: (9 / 32) * IN, firstLine: 1 * IN, lines: 35, margin: 1.25 * IN, rightLimit: 6, holes: true },
  { id: 'letter-narrow', name: 'Narrow ruled', size: 'Letter 8½ × 11 in', w: 8.5 * IN, h: 11 * IN, spacing: 0.25 * IN, firstLine: 1 * IN, lines: 39, margin: 1.25 * IN, rightLimit: 6, holes: true },
  { id: 'a4-8mm', name: 'Feint & margin 8 mm', size: 'A4 210 × 297 mm', w: 210, h: 297, spacing: 8, firstLine: 30, lines: 33, margin: 25, rightLimit: 8, holes: false },
  { id: 'a4-7mm', name: 'Feint & margin 7 mm', size: 'A4 210 × 297 mm', w: 210, h: 297, spacing: 7, firstLine: 30, lines: 37, margin: 25, rightLimit: 8, holes: false },
  { id: 'a5-7mm', name: 'Notebook 7 mm', size: 'A5 148 × 210 mm', w: 148, h: 210, spacing: 7, firstLine: 20, lines: 26, margin: 20, rightLimit: 6, holes: false },
];

// Paper the user measured and saved (kept in this browser).
export function userPresets() {
  try { return JSON.parse(localStorage.getItem('hws.paperPresets') || '[]'); } catch { return []; }
}
export function saveUserPreset(name, paper) {
  const id = 'user-' + Date.now().toString(36);
  const sizeLabel = `${(paper.w / IN).toFixed(2)} × ${(paper.h / IN).toFixed(2)} in`;
  const list = [...userPresets(), { id, name, size: sizeLabel, w: paper.w, h: paper.h, spacing: paper.spacing, firstLine: paper.firstLine, lines: paper.lines, margin: paper.margin, rightLimit: paper.rightLimit, holes: paper.holes }];
  localStorage.setItem('hws.paperPresets', JSON.stringify(list));
  return id;
}
export function deleteUserPreset(id) {
  localStorage.setItem('hws.paperPresets', JSON.stringify(userPresets().filter((p) => p.id !== id)));
}
export const allPresets = () => [...PAPER_PRESETS, ...userPresets()];

export function paperFromPreset(id) {
  const p = allPresets().find((x) => x.id === id) || PAPER_PRESETS[0];
  return { presetId: p.id, w: p.w, h: p.h, spacing: p.spacing, firstLine: p.firstLine, lines: p.lines, margin: p.margin, rightLimit: p.rightLimit, holes: p.holes };
}

export const paperLabel = (paper) => {
  const p = allPresets().find((x) => x.id === paper.presetId);
  return p ? `${p.name} · ${p.size}` : `Custom ${(paper.w / IN).toFixed(2)} × ${(paper.h / IN).toFixed(2)} in`;
};

export function presetOptions(paper) {
  const opts = [{ group: 'Standard', items: PAPER_PRESETS.map((x) => ({ value: x.id, label: `${x.name} · ${x.size}` })) }];
  const mine = userPresets();
  if (mine.length) opts.push({ group: 'Saved', items: mine.map((x) => ({ value: x.id, label: `${x.name} · ${x.size}` })) });
  if (paper.presetId === 'custom') opts.push({ value: 'custom', label: 'Custom (measured, not saved)' });
  return opts;
}

export function lineYs(paper) {
  const ys = [];
  for (let i = 0; i < paper.lines; i++) {
    const y = paper.firstLine + i * paper.spacing;
    if (y > paper.h) break;
    ys.push(y);
  }
  return ys;
}

// Nearest ruled line to y; lines continue upward/downward past the printed
// range so text above the first line still snaps to the same rhythm.
export function nearestLineY(paper, y) {
  const i = Math.round((y - paper.firstLine) / paper.spacing);
  return paper.firstLine + i * paper.spacing;
}

// Writing area between the margin line and the right writing limit.
export const writingBox = (paper) => ({ x: paper.margin + 1.5, w: paper.w - paper.margin - 1.5 - paper.rightLimit });

// Visual-only overlay: paper colour, blue rules, red margin, punch holes.
export function paperOverlay(paper) {
  const g = svg('g', { class: 'paper-overlay' });
  g.append(svg('rect', { x: 0, y: 0, width: paper.w, height: paper.h, fill: '#fdfdfb' }));
  const rule = '#9cc3e4';
  for (const y of lineYs(paper)) {
    g.append(svg('line', { x1: 0, x2: paper.w, y1: y, y2: y, stroke: rule, 'stroke-width': 0.22 }));
  }
  if (paper.margin > 0) {
    g.append(svg('line', { x1: paper.margin, x2: paper.margin, y1: 0, y2: paper.h, stroke: '#e79a9a', 'stroke-width': 0.3 }));
  }
  if (paper.holes) {
    // Standard 3-hole punch: 4¼ in centres, ~3/8 in from the edge.
    const cy = paper.h / 2;
    for (const dy of [-108, 0, 108]) {
      g.append(svg('circle', { cx: 9.5, cy: cy + dy, r: 3.2, fill: '#2a2b2f', opacity: 0.12 }));
    }
  }
  return g;
}
