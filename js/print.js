// Printing, printer calibration, PDF/PNG export and project files.
import { h, svg, uid, download, toast, round, pickFile, readFile, hash, SVG_NS } from './util.js';
import { paperOverlay, lineYs, lineCount, tiltAt, PAPER_PRESETS, applyPreset, paperLabel, writingBox, userPresets, saveUserPreset, deleteUserPreset } from './paper.js';
import { UNITS } from './ui/controls.js';
import { fmtNum, parseLength } from './units.js';
import { commitPaper } from './paperedit.js';
import { inkDefs, pageContent } from './editor/render.js';
import { ensureProvider, embedStyles, importStyles } from './handwriting/styles.js';
import { openModal } from './ui/modal.js';
import * as S from './state.js';
import * as store from './store.js';

const { state } = S;
const IN = 25.4;

// ---------- printer profiles ----------
export const MEDIA = {
  paper: { name: 'Same as notebook paper' },
  letter: { name: 'US Letter (8.5 × 11 in)', w: 215.9, h: 279.4 },
  a4: { name: 'A4 (210 × 297 mm)', w: 210, h: 297 },
};
// edge: the printer's unprintable border in mm (most inkjets/lasers: 3–6 mm).
const DEFAULT_PROFILE = { id: 'default', name: 'Default printer', media: 'paper', feed: 'left', edge: 4.2, ox: 0, oy: 0, sx: 1, sy: 1, nx: 0, ny: 0 };

export function profiles() {
  try {
    const list = JSON.parse(localStorage.getItem('hws.printerProfiles') || '[]');
    return list.length ? list : [{ ...DEFAULT_PROFILE }];
  } catch { return [{ ...DEFAULT_PROFILE }]; }
}
const saveProfiles = (list) => localStorage.setItem('hws.printerProfiles', JSON.stringify(list));
export function activeProfile() {
  const id = localStorage.getItem('hws.activeProfile');
  const list = profiles();
  return list.find((p) => p.id === id) || list[0];
}
const setActive = (id) => {
  localStorage.setItem('hws.activeProfile', id);
  S.bus.emit('change'); // editor redraws the printable-area box
};

export function mediaSize(profile, paper) {
  const m = MEDIA[profile.media];
  return m && m.w ? { w: m.w, h: m.h } : { w: paper.w, h: paper.h };
}

const feedX = (profile, paper) => {
  const m = mediaSize(profile, paper);
  return profile.feed === 'center' ? (m.w - paper.w) / 2 : profile.feed === 'right' ? m.w - paper.w : 0;
};

// The part of the notebook sheet the printer can reach, in notebook mm.
export function printableRect(profile, paper) {
  const m = mediaSize(profile, paper);
  const e = profile.edge ?? 4.2;
  const fx = feedX(profile, paper);
  const x = Math.max(0, e - fx), y = Math.max(0, e);
  const x2 = Math.min(paper.w, m.w - e - fx), y2 = Math.min(paper.h, m.h - e);
  return { x, y, w: x2 - x, h: y2 - y };
}

// Objects (on the given pages) that extend outside the printable area.
export function clippedObjects(pages, profile = activeProfile()) {
  const r = printableRect(profile, state.project.paper);
  const out = [];
  pages.forEach((pg, i) => {
    for (const o of pg.objects) {
      if (o.hidden) continue;
      const c = Math.cos((o.rot || 0) * Math.PI / 180), s = Math.sin((o.rot || 0) * Math.PI / 180);
      const hw = (Math.abs(o.w * c) + Math.abs(o.h * s)) / 2, hh = (Math.abs(o.w * s) + Math.abs(o.h * c)) / 2;
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
      if (cx - hw < r.x - 0.01 || cy - hh < r.y - 0.01 || cx + hw > r.x + r.w + 0.01 || cy + hh > r.y + r.h + 0.01) out.push({ page: i, o });
    }
  });
  return out;
}

// Content in notebook coordinates -> coordinates sent to the printer.
// Measured printer model: landed = sent * s + o. We send (p - o) / s,
// then add the feed offset (where the notebook sits on the media) and nudges.
export function printMatrix(profile, paper, corrected = true) {
  const fx = feedX(profile, paper);
  if (!corrected) return `matrix(1 0 0 1 ${fx} 0)`;
  const sx = profile.sx || 1, sy = profile.sy || 1;
  return `matrix(${1 / sx} 0 0 ${1 / sy} ${-profile.ox / sx + fx + profile.nx} ${-profile.oy / sy + profile.ny})`;
}

async function ensureAllProviders(pages) {
  const ids = new Set();
  for (const pg of pages) for (const o of pg.objects) if (o.type === 'text') ids.add(o.hw.style);
  await Promise.all([...ids].map((id) => ensureProvider(id).catch(() => {})));
}

// Builds a standalone SVG for one page. Printed/exported output is content
// only: never the paper colour, ruling, margin or holes (withPaper is for
// on-screen previews). handwriting=true forces generated output.
export const printMode = () => state.project.print?.mode || 'ink';
export const PRINT_MODES = [['ink', 'Handwriting only'], ['template', 'Paper template only'], ['both', 'Handwriting + paper']];

function pageSvg(pg, { profile, withPaper = false, corrected = true, handwriting, printable, mode = printMode() } = {}) {
  const paper = state.project.paper;
  const m = profile ? mediaSize(profile, paper) : { w: paper.w, h: paper.h };
  const root = svg('svg', { xmlns: SVG_NS, width: `${m.w}mm`, height: `${m.h}mm`, viewBox: `0 0 ${m.w} ${m.h}` });
  root.append(inkDefs());
  const g = svg('g', { transform: profile ? printMatrix(profile, paper, corrected) : null });
  if (withPaper) g.append(paperOverlay(paper));
  // Print modes: 'ink' = writing only (default, for real lined paper),
  // 'template' = lines and margins only, 'both' = lines plus writing.
  else if (mode !== 'ink') g.append(paperOverlay(paper, { print: true }));
  if (printable) {
    const r = printableRect(printable, paper);
    g.append(svg('rect', { x: r.x, y: r.y, width: r.w, height: r.h, fill: 'none', stroke: '#c07a2c', 'stroke-width': 0.3, 'stroke-dasharray': '2 1.5', opacity: 0.8 }));
  }
  if (mode !== 'template') g.append(pageContent(pg, { project: state.project, editor: false, handwriting }));
  root.append(g);
  return root;
}

async function svgToCanvas(root, dpi) {
  const w = parseFloat(root.getAttribute('width')), hh = parseFloat(root.getAttribute('height'));
  const str = new XMLSerializer().serializeToString(root);
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = Math.round((w / IN) * dpi);
  c.height = Math.round((hh / IN) * dpi);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

const pagesFor = (range) => (range === 'current' ? [S.page()] : state.project.pages);
const safeName = () => (state.project.name || 'handwriting').replace(/[^\w\- ]+/g, '').trim() || 'handwriting';

// ---------- printing ----------
export async function printPages({ range = 'all', profile = activeProfile(), testPage = null } = {}) {
  const pages = testPage ? [] : pagesFor(range);
  await ensureAllProviders(pages);
  const m = mediaSize(profile, state.project.paper);
  const sheets = testPage ? [testPage] : pages.map((pg) => pageSvg(pg, { profile }));
  return printSheets(sheets, m);
}

// Prints SVG sheets at exact physical size with zero page margins.
export async function printSheets(sheets, m) {
  const root = document.getElementById('print-root');
  root.replaceChildren();
  for (const s of sheets) {
    s.setAttribute('width', `${m.w}mm`);
    s.setAttribute('height', `${m.h}mm`);
    root.append(h('div.print-sheet', { style: { width: `${m.w}mm`, height: `${m.h}mm` } }, s));
  }
  let st = document.getElementById('page-size-style');
  if (!st) { st = h('style#page-size-style'); document.head.append(st); }
  st.textContent = `@page { size: ${m.w}mm ${m.h}mm; margin: 0; }`;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.print();
}

// ---------- exports ----------
export async function exportPDF({ range = 'all', dpi = 300, profile = null } = {}) {
  if (!window.jspdf) return toast('PDF library is still loading — try again in a moment');
  const pages = pagesFor(range);
  await ensureAllProviders(pages);
  const paper = state.project.paper;
  const m = profile ? mediaSize(profile, paper) : { w: paper.w, h: paper.h };
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: [m.w, m.h], orientation: m.w > m.h ? 'landscape' : 'portrait', compress: true });
  for (let i = 0; i < pages.length; i++) {
    toast(`Rendering page ${i + 1} of ${pages.length}…`, 10000);
    const c = await svgToCanvas(pageSvg(pages[i], { profile }), dpi);
    if (i) pdf.addPage([m.w, m.h], m.w > m.h ? 'landscape' : 'portrait');
    pdf.addImage(c, 'PNG', 0, 0, m.w, m.h, undefined, 'FAST');
  }
  pdf.save(`${safeName()}.pdf`);
  toast('PDF downloaded');
}

export async function exportPNG({ range = 'all', dpi = 300, withPaper = false } = {}) {
  const pages = pagesFor(range);
  await ensureAllProviders(pages);
  for (let i = 0; i < pages.length; i++) {
    const c = await svgToCanvas(pageSvg(pages[i], { withPaper }), dpi);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    download(blob, `${safeName()}-page-${(range === 'current' ? state.pageIndex : i) + 1}.png`);
  }
  toast(pages.length > 1 ? `${pages.length} PNGs downloaded` : 'PNG downloaded');
}

// ---------- preview ----------
// Preview A: on the virtual notebook paper. Preview B: exactly what the
// printer outputs — ink only, on plain white.
function previewFigure(pg, mode, caption, extra = {}) {
  const s = pageSvg(pg, { withPaper: mode === 'paper', ...extra });
  s.removeAttribute('width');
  s.removeAttribute('height');
  if (mode !== 'paper') s.prepend(svg('rect', { width: '100%', height: '100%', fill: '#fff' }));
  return h('figure.preview-page', s, h('figcaption', caption));
}

const modeSeg = (value, onChange) => seg([['paper', 'A · On notebook paper'], ['ink', 'B · Printer output']], value, onChange);
const modeHint = (view) => {
  if (view === 'paper') return 'The blue lines, red margin and paper colour are shown for alignment only.';
  return {
    ink: 'Exactly what is sent to the printer: only your writing. No lines, margin or paper colour.',
    template: 'Exactly what is sent to the printer: only the lines and margins (no writing, no paper colour).',
    both: 'Exactly what is sent to the printer: your writing plus the lines and margins, for blank paper.',
  }[printMode()];
};
const printModeField = (onChange) => h('label.field', h('span', 'What to print'),
  seg(PRINT_MODES.map(([k, l]) => [k, l.replace('Paper template only', 'Paper only').replace('Handwriting + paper', 'Both')]), printMode(), (v) => { state.project.print.mode = v; S.commit(); onChange(); }));

const printDialogNote = () => h('div.note', h('strong', 'In the print dialog'),
  h('ul',
    h('li', 'Scale: 100% / Actual size — never “Fit to page”'),
    h('li', 'Margins: None'),
    h('li', 'Paper size: ', h('b', describeMedia())),
    h('li', 'Turn off headers and footers')));

function profileRow(onChange, m) {
  const sel = h('select', { on: { change: (e) => { setActive(e.target.value); onChange(); } } }, ...profiles().map((p) => h('option', { value: p.id }, p.name)));
  sel.value = activeProfile().id;
  return h('label.field', h('span', 'Printer profile'), h('div.row', sel, h('button.btn.small', { on: { click: () => { m.close(); openCalibration(); } } }, 'Calibrate…')));
}

export function openPrintPreview() {
  const m = openModal('Print preview', { wide: true });
  const opts = { range: 'all', mode: 'ink', dpi: 300 };
  const list = h('div.preview-pages');
  const hint = h('p.muted.small');
  const warnings = h('div');

  const draw = async () => {
    const pages = pagesFor(opts.range);
    await ensureAllProviders(pages);
    hint.textContent = modeHint(opts.mode);
    list.replaceChildren(...pages.map((pg, i) => previewFigure(pg, opts.mode, `Page ${(opts.range === 'current' ? state.pageIndex : i) + 1}`, { printable: opts.mode === 'paper' ? activeProfile() : null })));
    const w = [];
    if (printMode() === 'template') {
      // Nothing written prints in this mode.
    } else if (state.project.stage !== 'handwriting') {
      w.push(h('div.note.warn', 'Handwriting hasn’t been generated yet, so text would print in a plain font. ',
        h('button.btn.small.generate', { on: { click: () => { S.generateHandwriting(); draw(); } } }, 'Generate Handwriting')));
    } else if (S.staleCount()) {
      w.push(h('div.note.warn', `${S.staleCount()} text box(es) changed since generation and would print in a plain font. `,
        h('button.btn.small', { on: { click: () => { S.generateHandwriting(); draw(); } } }, 'Regenerate changed')));
    }
    const clipped = printMode() === 'template' ? [] : clippedObjects(pages);
    if (clipped.length) w.push(h('div.note.warn', `${clipped.length} item(s) reach outside the printable area and may be cut off by the printer.`));
    warnings.replaceChildren(...w);
  };

  const side = h('div.preview-side',
    warnings,
    printModeField(draw),
    h('label.field', h('span', 'Preview'), modeSeg(opts.mode, (v) => { opts.mode = v; draw(); })),
    hint,
    h('label.field', h('span', 'Pages'), seg([['all', 'All pages'], ['current', 'This page']], opts.range, (v) => { opts.range = v; draw(); })),
    profileRow(draw, m),
    printDialogNote(),
    h('button.btn.primary.block', { on: { click: () => { m.close(); printPages({ range: opts.range }); } } }, 'Print'),
    h('div.sep'),
    h('label.field', h('span', 'Export resolution'), seg([[200, '200 dpi'], [300, '300 dpi'], [600, '600 dpi']], opts.dpi, (v) => { opts.dpi = v; })),
    h('button.btn.block', { on: { click: () => exportPDF({ range: opts.range, dpi: opts.dpi }) } }, 'Download PDF'),
    h('button.btn.block', { on: { click: () => exportPDF({ range: opts.range, dpi: opts.dpi, profile: activeProfile() }) } }, 'Download PDF for this printer'),
    h('button.btn.block', { on: { click: () => exportPNG({ range: opts.range, dpi: opts.dpi }) } }, 'Download transparent PNG'),
  );
  m.body.classList.add('preview-layout');
  m.body.append(list, side);
  draw();
}

// ---------- example print ----------
// A throwaway sample page (never added to the project) in the writer's
// current style, used to check alignment on real paper before printing.
function examplePage() {
  const p = state.project.paper;
  const d = state.project.writer.defaults;
  const wb = writingBox(p);
  const fb = p.spacing * 0.74;
  const top = (line) => p.firstLine + line * p.spacing - fb;
  const T = (id, text, x, line, w) => ({ id: 'example-' + id, type: 'text', x, y: top(line) + tiltAt(p, x + w / 2), w, h: p.spacing, rot: p.lineStyle?.angle || 0, opacity: 1, text, hw: { ...d, followLines: true, lineSpacing: 0, mistakes: 0, seed: hash('example', id) } });
  const Sh = (id, shape, x, y, w, hh) => ({ id: 'example-' + id, type: 'shape', shape, x, y, w, h: hh, rot: 0, opacity: 1, stroke: d.color, strokeWidth: d.pen === 'pencil' ? 0.5 : 0.42, fill: 'none', handDrawn: true, pen: d.pen, seed: hash('example', id) });
  const last = Math.max(13, lineCount(p) - 1);
  const objs = [
    T('title', 'Example print', wb.x, 0, wb.w),
    T('para', 'This short paragraph spans several ruled lines. Check that every baseline sits on a blue line and that each line starts just right of the red margin.', wb.x, 2, wb.w),
    T('w1', 'alpha', wb.x, 7, 28),
    T('w2', 'beta', wb.x + 48, 7, 24),
    T('w3', 'gamma', wb.x + 92, 7, 30),
    Sh('ring', 'ellipse', wb.x + 42, top(7) + fb - p.spacing * 0.85, 26, p.spacing * 1.1),
    Sh('arrow', 'arrow', wb.x + 18, top(7) + fb - p.spacing * 0.3, 22, 4),
    T('letters', 'A   b   C   d   E   f   g   h', wb.x, 9, wb.w),
    Sh('box', 'rect', wb.x, top(11) + fb - p.spacing * 0.9, 40, p.spacing * 1.25),
    T('boxed', 'diagram', wb.x + 4, 11, 36),
    Sh('check', 'check', wb.x + 52, top(11) + fb - p.spacing * 0.7, 6, 5),
    Sh('tri', 'triangle', wb.x + 66, top(11) + fb - p.spacing * 0.85, 10, p.spacing * 0.85),
    T('end', 'Bottom line: check alignment here too.', wb.x, last, wb.w),
  ];
  return { id: 'example', objects: objs };
}

export function openExamplePrint() {
  const m = openModal('Example Print', { wide: true });
  const pg = examplePage();
  let mode = 'paper';
  const list = h('div.preview-pages');
  const hint = h('p.muted.small');
  const draw = async () => {
    await ensureProvider(state.project.writer.defaults.style).catch(() => {});
    hint.textContent = modeHint(mode);
    list.replaceChildren(previewFigure(pg, mode, mode === 'paper' ? 'Preview A — on notebook paper' : 'Preview B — printer output', { handwriting: true, printable: mode === 'paper' ? activeProfile() : null }));
  };
  const side = h('div.preview-side',
    h('p.small', 'A sample page in your current handwriting style, pen and paper settings. Print it on a real sheet, then compare it with the blue lines and red margin.'),
    h('label.field', h('span', 'Preview'), modeSeg(mode, (v) => { mode = v; draw(); })),
    hint,
    profileRow(draw, m),
    printDialogNote(),
    h('button.btn.primary.block', { on: { click: () => {
      const prof = activeProfile();
      printSheets([pageSvg(pg, { profile: prof, handwriting: true })], mediaSize(prof, state.project.paper));
    } } }, 'Print Test Page'),
    h('div.note', h('strong', 'If it doesn’t line up'),
      h('ul',
        h('li', 'Whole page shifted: use the nudge controls in calibration'),
        h('li', 'Error grows down or across the page: run the measured calibration (scale)'),
        h('li', 'Lines drift steadily: re-measure your line spacing'))),
    h('button.btn.block', { on: { click: () => { m.close(); openCalibration(); } } }, 'Open calibration…'),
  );
  m.body.classList.add('preview-layout');
  m.body.append(list, side);
  draw();
}

function describeMedia() {
  const p = activeProfile();
  const paper = state.project.paper;
  if (p.media !== 'paper') return MEDIA[p.media].name;
  return `${round(paper.w / IN, 2)} × ${round(paper.h / IN, 2)} in (${round(paper.w, 1)} × ${round(paper.h, 1)} mm) — add it as a custom size if needed`;
}

export function seg(items, value, onChange) {
  const el = h('div.seg');
  for (const [v, label] of items) {
    const b = h('button', { class: v === value ? 'on' : '', on: { click: () => { el.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); onChange(v); } } }, label);
    el.append(b);
  }
  return el;
}

// ---------- calibration ----------
const A = 19.05; // crosshair inset: exactly 3/4 in, so expected values read cleanly on an inch ruler

function testSheet(profile, corrected) {
  const paper = state.project.paper;
  const m = mediaSize(profile, paper);
  const root = svg('svg', { xmlns: SVG_NS, viewBox: `0 0 ${m.w} ${m.h}` });
  const g = svg('g', { transform: printMatrix(profile, paper, corrected), stroke: '#000', 'stroke-width': 0.2, fill: 'none' });
  const cross = (x, y, label) => {
    g.append(svg('path', { d: `M${x - 6} ${y}H${x + 6}M${x} ${y - 6}V${y + 6}` }));
    g.append(svg('circle', { cx: x, cy: y, r: 2.5 }));
    const t = svg('text', { x: x + 3.5, y: y - 3, 'font-size': 3.2, fill: '#000', stroke: 'none', 'font-family': 'sans-serif' });
    t.textContent = label;
    g.append(t);
  };
  cross(A, A, 'A');
  cross(paper.w - A, paper.h - A, 'B');
  // 100 mm rulers
  const rx = A, ry = A + 18;
  g.append(svg('path', { d: `M${rx} ${ry}H${rx + 100}` }));
  for (let i = 0; i <= 100; i++) g.append(svg('path', { d: `M${rx + i} ${ry}v${i % 10 ? -1.2 : -2.8}` }));
  const vx = A + 14, vy = A + 26;
  g.append(svg('path', { d: `M${vx} ${vy}V${vy + 100}` }));
  for (let i = 0; i <= 100; i++) g.append(svg('path', { d: `M${vx} ${vy + i}h${i % 10 ? 1.2 : 2.8}` }));
  // ruling ticks near the right edge and margin ticks at top/bottom
  for (const y of lineYs(paper)) g.append(svg('path', { d: `M${paper.w - 26} ${y}h12` }));
  g.append(svg('path', { d: `M${paper.margin} 4v10M${paper.margin} ${paper.h - 14}v10` }));
  const lines = [
    corrected ? 'VERIFICATION PAGE (calibration applied)' : 'CALIBRATION TEST PAGE (no correction)',
    `Paper: ${paperLabel(paper)}`,
    'Measure from the LEFT and TOP edges of the sheet to the centre of A and B.',
    'Right-edge ticks should sit on the blue lines; top/bottom ticks on the red margin.',
    'Horizontal and vertical rulers are exactly 100 mm.',
  ];
  lines.forEach((s, i) => {
    const t = svg('text', { x: A + 24, y: A + 50 + i * 6, 'font-size': 3.4, fill: '#000', stroke: 'none', 'font-family': 'sans-serif' });
    t.textContent = s;
    g.append(t);
  });
  root.append(g);
  return root;
}

export function openCalibration() {
  const m = openModal('Paper & printer calibration', { wide: true });
  const paper = state.project.paper;
  let prof = { ...activeProfile() };
  let unit = UNITS[localStorage.getItem('hws.unit')] ? localStorage.getItem('hws.unit') : 'in';
  const U = () => UNITS[unit].k;
  // Display strings use clean fractions in inches ("1 1/4"); callbacks get
  // numbers in the chosen unit. Typed fractions are accepted.
  const show = (mm) => fmtNum(mm, unit);
  const num = (val, on, step) => h('input', {
    type: 'text', inputmode: 'decimal', value: val,
    on: { change: (e) => on(step === 1 ? parseFloat(e.target.value) : parseLength(e.target.value, unit) / U()) },
  });

  const body = h('div.calib');
  const render = () => {
    const profSel = h('select', { on: { change: (e) => { prof = { ...profiles().find((p) => p.id === e.target.value) }; setActive(prof.id); render(); } } },
      ...profiles().map((p) => h('option', { value: p.id }, p.name)));
    profSel.value = prof.id;

    const setPaper = (k, v) => {
      if (isNaN(v)) return;
      commitPaper((pp) => { pp[k] = v * (k === 'lines' ? 1 : U()); pp.presetId = 'custom'; if (k === 'lines') pp.autoLines = false; });
      render();
    };
    const preset = h('select', { on: { change: (e) => { if (e.target.value !== 'custom') { commitPaper((pp) => applyPreset(pp, e.target.value)); render(); } } } },
      h('optgroup', { label: 'Standard' }, ...PAPER_PRESETS.map((p) => h('option', { value: p.id }, `${p.name} · ${p.size}`))),
      userPresets().length && h('optgroup', { label: 'Saved' }, ...userPresets().map((p) => h('option', { value: p.id }, `${p.name} · ${p.size}`))),
      h('option', { value: 'custom' }, 'Custom (measured, not saved)'));
    preset.value = paper.presetId;
    const presetName = h('input', { type: 'text', placeholder: 'e.g. Five Star wide ruled' });
    const isUser = paper.presetId.startsWith('user-');

    // "measure my paper": first and last line + count -> spacing
    const meas = { first: paper.firstLine / U(), last: (paper.firstLine + (lineCount(paper) - 1) * paper.spacing) / U(), count: lineCount(paper) };

    const measured = { ax: '', ay: '', bx: '', by: '' };

    body.replaceChildren(
      h('div.unit-row', h('span', 'Units'), seg([['in', 'inches'], ['mm', 'millimetres'], ['cm', 'centimetres']], unit, (v) => { unit = v; localStorage.setItem('hws.unit', v); render(); })),
      step(1, 'Your notebook paper', 'Pick the closest type, then correct any measurement with a ruler.',
        h('label.field', h('span', 'Paper type'), preset),
        h('div.grid3',
          fld('Sheet width', num(show(paper.w), (v) => setPaper('w', v))),
          fld('Sheet height', num(show(paper.h), (v) => setPaper('h', v))),
          fld('Line spacing', num(show(paper.spacing), (v) => setPaper('spacing', v), unit === 'in' ? 0.001 : 0.01)),
          fld('Top edge → first line', num(show(paper.firstLine), (v) => setPaper('firstLine', v))),
          fld('Left edge → red margin', num(show(paper.margin), (v) => setPaper('margin', v))),
          fld('Number of lines', num(lineCount(paper), (v) => setPaper('lines', Math.round(v)), 1)),
        ),
        h('div.row',
          presetName,
          h('button.btn.small', { on: { click: () => {
            const name = presetName.value.trim();
            if (!name) return toast('Name this paper first');
            paper.presetId = saveUserPreset(name, paper);
            S.commit();
            render();
            toast(`Saved paper “${name}”`);
          } } }, 'Save as paper preset'),
          isUser && h('button.btn.small.ghost', { on: { click: () => { deleteUserPreset(paper.presetId); paper.presetId = 'custom'; S.commit(); render(); } } }, 'Delete this preset')),
        h('details.sub', h('summary', 'Measure spacing precisely (recommended)'),
          h('p.muted', 'Measuring across many lines averages out ruler error. Measure from the top edge of the sheet to the first and last blue lines.'),
          h('div.grid3',
            fld('Top → first line', num(show(meas.first * U()), (v) => (meas.first = v))),
            fld('Top → last line', num(show(meas.last * U()), (v) => (meas.last = v))),
            fld('Lines counted', num(meas.count, (v) => (meas.count = v), 1))),
          h('button.btn.small', { on: { click: () => {
            if (meas.count < 2 || !(meas.last > meas.first)) return toast('Check the measurements');
            commitPaper((pp) => {
              pp.firstLine = meas.first * U();
              pp.spacing = ((meas.last - meas.first) * U()) / (meas.count - 1);
              pp.lines = Math.round(meas.count);
              pp.autoLines = false;
              pp.presetId = 'custom';
            });
            render();
            toast(`Line spacing set to ${round(paper.spacing, 3)} mm`);
          } } }, 'Use these measurements')),
      ),
      step(2, 'Printer and paper feed', 'How the notebook sheet goes into your printer.',
        h('div.grid3',
          fld('Profile', profSel),
          fld('Paper size in print dialog', h('select', { on: { change: (e) => { prof.media = e.target.value; render(); } } }, ...Object.entries(MEDIA).map(([k, v]) => h('option', { value: k, selected: prof.media === k }, v.name)))),
          fld('Sheet sits against', h('select', { on: { change: (e) => { prof.feed = e.target.value; render(); } } },
            ...[['left', 'Left guide'], ['center', 'Centre (both guides)'], ['right', 'Right guide']].map(([k, v]) => h('option', { value: k, selected: prof.feed === k }, v)))),
          fld('Unprintable edge', num(show(prof.edge ?? 4.2), (v) => { if (!isNaN(v)) { prof.edge = v * U(); render(); } })),
        ),
        h('p.muted.small', 'Most printers can’t print within 3–6 mm (⅛–¼ in) of the edges. The editor shows this as a dashed box so nothing gets clipped.'),
      ),
      step(3, 'Print the test page', 'Print it on a sheet of your notebook paper (or plain paper of the same size).',
        h('div.row',
          h('button.btn', { on: { click: () => printPages({ profile: prof, testPage: testSheet(prof, false) }) } }, 'Print test page'),
          h('span.muted', 'Use 100% scale and no margins.'))),
      step(4, 'Enter what you measured', `From the sheet's left and top edges to the centre of each crosshair. Expected: A = ${show(A)}, ${show(A)} · B = ${show(paper.w - A)}, ${show(paper.h - A)} (${unit}).`,
        h('div.grid4',
          fld('A from left', num('', (v) => (measured.ax = v))),
          fld('A from top', num('', (v) => (measured.ay = v))),
          fld('B from left', num('', (v) => (measured.bx = v))),
          fld('B from top', num('', (v) => (measured.by = v)))),
        h('button.btn.small', { on: { click: () => {
          const { ax, ay, bx, by } = measured;
          if ([ax, ay, bx, by].some((v) => v === '' || isNaN(v))) return toast('Enter all four measurements');
          const k = U();
          prof.sx = ((bx - ax) * k) / (paper.w - 2 * A);
          prof.sy = ((by - ay) * k) / (paper.h - 2 * A);
          prof.ox = ax * k - A * prof.sx;
          prof.oy = ay * k - A * prof.sy;
          prof.nx = prof.ny = 0;
          render();
          toast('Correction calculated — print the verification page to check');
        } } }, 'Calculate correction'),
        h('p.muted', `Current correction: scale ${round(prof.sx * 100, 2)}% × ${round(prof.sy * 100, 2)}%, offset ${show(prof.ox)}, ${show(prof.oy)} ${unit}.`),
      ),
      step(5, 'Fine-tune and verify', 'Nudge where the ink lands, then print the verification page on notebook paper.',
        h('div.row',
          nudger('Move right / left', prof.nx, (v) => { prof.nx = v; render(); }),
          nudger('Move down / up', prof.ny, (v) => { prof.ny = v; render(); })),
        h('div.row',
          h('button.btn', { on: { click: () => printPages({ profile: prof, testPage: testSheet(prof, true) }) } }, 'Print verification page'),
          h('button.btn.ghost', { on: { click: () => { Object.assign(prof, { ox: 0, oy: 0, sx: 1, sy: 1, nx: 0, ny: 0 }); render(); } } }, 'Reset correction'))),
    );

    const nameIn = h('input', { type: 'text', value: prof.name });
    m.foot.replaceChildren(
      h('label.inline', 'Profile name ', nameIn),
      h('button.btn', { on: { click: () => { prof = { ...prof, id: uid('pr'), name: nameIn.value || 'New printer' }; persist(); } } }, 'Save as new'),
      h('button.btn.primary', { on: { click: () => { prof.name = nameIn.value || prof.name; persist(); m.close(); } } }, 'Save profile'),
    );
  };

  const persist = () => {
    const list = profiles().filter((p) => p.id !== prof.id);
    list.push(prof);
    saveProfiles(list);
    setActive(prof.id); // also redraws the editor's printable area
    toast(`Saved “${prof.name}”`);
    render();
  };

  const nudger = (label, val, on) => h('div.nudger', h('span', label),
    h('button.btn.small', { on: { click: () => on(round(val - 0.25, 2)) } }, '−0.25'),
    h('b', `${val >= 0 ? '+' : ''}${val.toFixed(2)} mm`),
    h('button.btn.small', { on: { click: () => on(round(val + 0.25, 2)) } }, '+0.25'));

  m.body.append(body);
  render();
}

const fld = (label, control) => h('label.field', h('span', label), control);
const step = (n, title, desc, ...content) => h('section.step', h('div.step-n', String(n)), h('div.step-c', h('h3', title), h('p.muted', desc), ...content));

// ---------- project files ----------
export async function saveProjectFile() {
  const p = JSON.parse(JSON.stringify(state.project));
  const used = new Set();
  for (const pg of p.pages) for (const o of pg.objects) {
    if (o.type === 'text') used.add(o.hw.style);
  }
  // Images, plus the original pictures that hand-drawn illustrations came from.
  const usedAssets = new Set(p.pages.flatMap((pg) => pg.objects.flatMap((o) => [o.asset, o.source]).filter(Boolean)));
  p.assets = Object.fromEntries(Object.entries(p.assets).filter(([k]) => usedAssets.has(k)));
  p.styles = embedStyles(used);
  download(new Blob([JSON.stringify(p)], { type: 'application/json' }), `${safeName()}.hwstudio.json`);
}

export async function openProjectFile() {
  const f = await pickFile('.json,.hwstudio');
  if (!f) return;
  try {
    const p = JSON.parse(await readFile(f, 'text'));
    if (!p.pages || !p.paper) throw new Error('Not a Handwriting Studio project');
    await importStyles(p.styles);
    delete p.styles;
    p.id = uid('p'); // never overwrite an existing local project
    S.loadProject(p);
    toast(`Opened “${p.name}”`);
  } catch (e) {
    toast('Could not open file: ' + e.message, 4000);
  }
}

export async function openProjectList() {
  const m = openModal('Your projects');
  const items = (await store.all('projects')).map((x) => x.value).sort((a, b) => b.updated - a.updated);
  const list = h('div.project-list');
  const fill = () => list.replaceChildren(...items.map((p) => h('div.project-item' + (p.id === state.project.id ? '.current' : ''),
    h('button.project-open', { on: { click: () => { S.loadProject(p); m.close(); } } },
      h('strong', p.name || 'Untitled'),
      h('span.muted', `${p.pages.length} page${p.pages.length > 1 ? 's' : ''} · ${new Date(p.updated).toLocaleString()}`)),
    p.id !== state.project.id && h('button.icon-btn', { title: 'Delete project', on: { click: async () => {
      await store.del('projects', p.id);
      items.splice(items.indexOf(p), 1);
      fill();
    } } }, '✕'))));
  fill();
  m.body.append(list);
  m.foot.append(h('button.btn', { on: { click: () => { m.close(); openProjectFile(); } } }, 'Open from file…'));
}

