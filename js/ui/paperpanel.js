// Paper settings, built once and used in two places:
//  - the Paper Studio (editing a draft preset), and
//  - Edit Paper mode on the canvas (editing the current project's paper).
// A target adapter decides where changes go:
//   { paper(), live(fn), commit(fn), rebuild() }
import { h, toast } from '../util.js';
import * as S from '../state.js';
import { setOrientation, lineCount, rulingLines, lineAt, bottomGap, paperLabel } from '../paper.js';
import { livePaper, commitPaper } from '../paperedit.js';
import { section, slider, lenSlider, numField, toggle, select, segmented, colorRow, getUnit, setUnit, fmtLen } from './controls.js';
import { activeProfile, profiles, openPrintPreview } from '../print.js';

const { state } = S;
const RULE_COLORS = [{ name: 'Blue', color: '#9cc3e4' }, { name: 'Grey', color: '#b9bec6' }, { name: 'Green', color: '#a8d5b5' }, { name: 'Purple', color: '#c4b5e8' }];
const MARGIN_COLORS = [{ name: 'Red', color: '#e79a9a' }, { name: 'Pink', color: '#f0b3c8' }, { name: 'Blue', color: '#9cc3e4' }, { name: 'Grey', color: '#b9bec6' }];
const BG_COLORS = [{ name: 'White', color: '#fdfdfb' }, { name: 'Cream', color: '#fbf6e6' }, { name: 'Grey', color: '#eeeeee' }, { name: 'Blue tint', color: '#f1f6fb' }];
const IN = 25.4;
export const START_SIZES = [
  ['8 1/2 × 11 in', 8.5 * IN, 11 * IN],
  ['8 × 10 1/2 in', 8 * IN, 10.5 * IN],
  ['A4', 210, 297],
  ['A5', 148, 210],
];

// Currently selected line in "Individual lines" (shared with the studio preview).
export const lineSel = { i: 1 };

export function paperSections(t, { open = {} } = {}) {
  const p = t.paper();
  const live = (fn) => (v) => t.live((pp) => fn(pp, v));
  const done = () => t.commit();
  const set = (fn) => (v) => t.commit((pp) => fn(pp, v));
  const len = (label, get, fn, min, max, tip) => lenSlider(label, get, { min, max, onInput: live(fn), onCommit: done, tip });
  const field = (label, get, fn, opts = {}) => numField(label, get, { onChange: set(fn), ...opts });
  const color = (label, get, fn, presets) => colorRow(label, get, (v, c) => (c ? t.commit((pp) => fn(pp, v)) : t.live((pp) => fn(pp, v))), { presets });
  const opacity = (get, fn) => slider('Opacity', get, { min: 0.05, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%', onInput: live(fn), onCommit: done });
  const custom = (pp) => { pp.presetId = pp.presetId?.startsWith('user-') ? pp.presetId : 'custom'; };

  const lines = rulingLines(p).filter((l) => !l.partial);
  const n = lineCount(p);
  const lastY = lines.length ? lines[lines.length - 1].y : 0;
  const prevY = n >= 2 ? lineAt(p, n - 2) : p.firstLine;
  if (lineSel.i >= n) lineSel.i = Math.max(0, n - 1);
  const ov = p.lineOverrides[lineSel.i] || {};
  const adjusted = Object.keys(p.lineOverrides).filter((k) => p.lineOverrides[k].dy || p.lineOverrides[k].hidden);

  return [
    section('Paper size', [
      h('div.chips', ...START_SIZES.map(([label, w, hh]) => h('button.chip' + (Math.abs(p.w - w) < 0.01 && Math.abs(p.h - hh) < 0.01 ? '.on' : ''), {
        on: { click: () => { t.commit((pp) => { pp.w = pp.orientation === 'landscape' ? hh : w; pp.h = pp.orientation === 'landscape' ? w : hh; custom(pp); }); t.rebuild(); } },
      }, label))),
      segmented('Units', getUnit, [['in', 'in'], ['mm', 'mm'], ['cm', 'cm']], (v) => { setUnit(v); t.rebuild(); S.bus.emit('zoom'); }),
      h('div.grid2',
        field('Width', () => p.w, (pp, v) => { pp.w = Math.max(50, v); custom(pp); }),
        field('Height', () => p.h, (pp, v) => { pp.h = Math.max(50, v); custom(pp); })),
      segmented('Orientation', () => p.orientation, [['portrait', 'Portrait'], ['landscape', 'Landscape']], (v) => { t.commit((pp) => setOrientation(pp, v)); t.rebuild(); }),
      h('h5', 'Margins'),
      h('div.grid2',
        field('Top', () => p.margins.top, (pp, v) => { pp.margins.top = Math.max(0, v); }),
        field('Bottom', () => p.margins.bottom, (pp, v) => { pp.margins.bottom = Math.max(0, v); })),
      // Both red lines: type exact values (fractions work) or drag them on the paper.
      h('div.margin-fields',
        field('Red Line Margin', () => p.margin, (pp, v) => { pp.margin = Math.max(0, Math.min(pp.w, v)); pp.marginStyle.show = true; custom(pp); }, { tip: 'Left red line, measured from the left edge' }),
        field('Right-Side Red Line Margin', () => p.rightLine.x, (pp, v) => { pp.rightLine.x = Math.max(0, Math.min(pp.w, v)); pp.rightLine.show = true; }, { tip: 'Faint red line showing through from the back, measured from the right edge' })),
      h('p.muted.small', 'Left line from the left edge; right-side line from the right edge.'),
      color('Paper colour', () => p.bg, (pp, v) => { pp.bg = v; }, BG_COLORS),
      h('p.muted.small', 'On screen only — never printed.'),
    ], { collapsible: true, open: open.size ?? true }),

    section('Blue lines', [
      len('Line spacing', () => p.spacing, (pp, v) => { pp.spacing = Math.max(2, v); custom(pp); }, 3, 15, 'Distance between lines'),
      len('First line', () => p.firstLine, (pp, v) => { pp.firstLine = Math.max(0, v); custom(pp); }, 0, Math.min(90, p.h / 2), 'Distance from the top edge'),
      toggle('Count lines automatically', () => p.autoLines, (v) => { t.commit((pp) => { if (!v) pp.lines = lineCount(pp); pp.autoLines = v; }); t.rebuild(); }, 'Fill down to the bottom margin'),
      numField('Number of lines', () => lineCount(p), { unit: 'lines', step: 1, disabled: p.autoLines, onChange: (v) => { t.commit((pp) => { pp.lines = Math.max(0, Math.round(v)); }); t.rebuild(); } }),
      slider('Thickness', () => p.lineStyle.width, { min: 0.05, max: 1, step: 0.01, unit: 'mm', onInput: live((pp, v) => { pp.lineStyle.width = v; }), onCommit: done }),
      color('Colour', () => p.lineStyle.color, (pp, v) => { pp.lineStyle.color = v; }, RULE_COLORS),
      opacity(() => p.lineStyle.opacity, (pp, v) => { pp.lineStyle.opacity = v; }),
      len('Lines start at', () => p.lineStyle.start || 0, (pp, v) => { pp.lineStyle.start = Math.max(0, v); }, 0, p.w / 2, 'From the left edge'),
      len('Lines end at', () => p.lineStyle.end ?? p.w, (pp, v) => { pp.lineStyle.end = Math.min(pp.w, v); }, p.w / 2, p.w, 'From the left edge'),
      slider('Angle', () => p.lineStyle.angle || 0, { min: -3, max: 3, step: 0.05, unit: '°', onInput: live((pp, v) => { pp.lineStyle.angle = v; }), onCommit: done, tip: 'For paper printed slightly crooked' }),
    ], { collapsible: true, open: open.lines ?? true }),

    section('Last line / bottom edge', [
      h('p.muted.small', 'Adjust the final line on its own. The other lines keep their spacing. You can also drag the last line on the preview.'),
      segmented('Last line', () => (p.last.custom ? 'custom' : 'standard'), [['standard', 'Standard spacing'], ['custom', 'Custom position']], (v) => {
        t.commit((pp) => { pp.last.custom = v === 'custom'; if (pp.last.custom && !(pp.last.gap > 0)) pp.last.gap = pp.spacing; });
        t.rebuild();
      }),
      p.last.custom && len('Gap above last line', () => p.last.gap, (pp, v) => { pp.last.gap = Math.max(0.5, v); }, 0.5, p.spacing * 3, 'Distance from the second-to-last line'),
      p.last.custom && field('Last line → bottom', () => bottomGap(p), (pp, v) => { pp.last.gap = Math.max(0.5, pp.h - Math.max(0, v) - prevY); }),
      !p.last.custom && h('p.small.info', `Last line → bottom edge: ${fmtLen(p.h - lastY)}`),
      toggle('Hide the last line', () => p.last.hidden, (v) => { t.commit((pp) => { pp.last.hidden = v; }); }, 'When your sheet ends before it'),
      len('Last line starts at', () => p.last.start ?? (p.lineStyle.start || 0), (pp, v) => { pp.last.start = Math.max(0, v); }, 0, p.w / 2),
      len('Last line ends at', () => p.last.end ?? (p.lineStyle.end ?? p.w), (pp, v) => { pp.last.end = Math.min(pp.w, v); }, 0, p.w, 'Shorten it if the line is cut off'),
      h('div.btn-row',
        (p.last.start != null || p.last.end != null) && h('button.btn.small', { on: { click: () => { t.commit((pp) => { pp.last.start = null; pp.last.end = null; }); t.rebuild(); } } }, 'Same length as other lines'),
        h('button.btn.small', { on: { click: () => {
          t.commit((pp) => pp.partials.push({ y: Math.min(pp.h - 1, lastY + pp.spacing), start: pp.lineStyle.start || 0, end: pp.w / 2 }));
          t.rebuild();
        } } }, '+ Add partial line')),
      ...p.partials.map((pl, k) => h('div.subcard',
        h('div.subcard-head', h('b', `Partial line ${k + 1}`), h('button.icon-btn.tiny', { title: 'Remove', on: { click: () => { t.commit((pp) => pp.partials.splice(k, 1)); t.rebuild(); } } }, '✕')),
        len('From top', () => pl.y, (pp, v) => { pp.partials[k].y = Math.max(0, Math.min(pp.h, v)); }, 0, p.h),
        len('Starts at', () => pl.start ?? 0, (pp, v) => { pp.partials[k].start = Math.max(0, v); }, 0, p.w),
        len('Ends at', () => pl.end ?? p.w / 2, (pp, v) => { pp.partials[k].end = Math.min(pp.w, v); }, 0, p.w))),
    ].filter(Boolean), { collapsible: true, open: open.last ?? true }),

    section('Individual lines', [
      h('p.muted.small', 'For paper with an uneven line or two. Pick a line (or click it on the preview) and nudge just that one.'),
      n > 0 && select('Line', () => String(lineSel.i), Array.from({ length: n }, (_, i) => ({ value: String(i), label: `Line ${i + 1}${i === 0 ? ' (first)' : i === n - 1 ? ' (last)' : ''}${p.lineOverrides[i]?.dy || p.lineOverrides[i]?.hidden ? ' — adjusted' : ''}` })), (v) => { lineSel.i = +v; t.rebuild(); }),
      n > 0 && len('Shift this line', () => ov.dy || 0, (pp, v) => { (pp.lineOverrides[lineSel.i] ||= {}).dy = v; }, -p.spacing / 2, p.spacing / 2, 'Up (−) or down (+) from its regular position'),
      n > 0 && toggle('Hide this line', () => !!ov.hidden, (v) => { t.commit((pp) => { (pp.lineOverrides[lineSel.i] ||= {}).hidden = v; }); t.rebuild(); }),
      adjusted.length > 0 && h('div.btn-row',
        h('button.btn.small', { on: { click: () => { t.commit((pp) => { delete pp.lineOverrides[lineSel.i]; }); t.rebuild(); } } }, 'Reset this line'),
        h('button.btn.small.ghost', { on: { click: () => { t.commit((pp) => { pp.lineOverrides = {}; }); t.rebuild(); } } }, `Reset all (${adjusted.length})`)),
    ].filter(Boolean), { collapsible: true, open: open.individual ?? false }),

    section('Red lines', [
      h('h5', 'Red Line Margin (left)'),
      toggle('Show', () => p.marginStyle.show, (v) => { t.commit((pp) => { pp.marginStyle.show = v; }); t.rebuild(); }),
      len('Red Line Margin', () => p.margin, (pp, v) => { pp.margin = Math.max(0, v); custom(pp); }, 0, p.w / 2, 'From the left edge'),
      slider('Thickness', () => p.marginStyle.width, { min: 0.05, max: 1.2, step: 0.01, unit: 'mm', onInput: live((pp, v) => { pp.marginStyle.width = v; }), onCommit: done }),
      color('Colour', () => p.marginStyle.color, (pp, v) => { pp.marginStyle.color = v; }, MARGIN_COLORS),
      opacity(() => p.marginStyle.opacity, (pp, v) => { pp.marginStyle.opacity = v; }),
      len('Starts at', () => p.marginStyle.start || 0, (pp, v) => { pp.marginStyle.start = Math.max(0, v); }, 0, p.h / 2, 'From the top edge (both red lines)'),
      len('Ends at', () => p.marginStyle.end ?? p.h, (pp, v) => { pp.marginStyle.end = Math.min(pp.h, v); }, p.h / 2, p.h, 'From the top edge (both red lines)'),

      h('h5', 'Right-Side Red Line Margin'),
      h('p.muted.small', 'The red line printed on the back of the sheet, showing faintly through the front.'),
      toggle('Show', () => p.rightLine.show, (v) => { t.commit((pp) => { pp.rightLine.show = v; }); t.rebuild(); }),
      len('Right-Side Red Line Margin', () => p.rightLine.x, (pp, v) => { pp.rightLine.x = Math.max(0, Math.min(pp.w, v)); }, 0, p.w / 2, 'From the right edge'),
      slider('Thickness', () => p.rightLine.width, { min: 0.05, max: 1.2, step: 0.01, unit: 'mm', onInput: live((pp, v) => { pp.rightLine.width = v; }), onCommit: done }),
      color('Colour', () => p.rightLine.color, (pp, v) => { pp.rightLine.color = v; }, MARGIN_COLORS),
      opacity(() => p.rightLine.opacity, (pp, v) => { pp.rightLine.opacity = v; }),
      toggle('Stop handwriting at this line', () => p.rightLine.wrap, (v) => { t.commit((pp) => { pp.rightLine.wrap = v; }); t.rebuild(); }, 'Text boxes that reach the right side wrap here instead of at the paper edge'),
      !(p.rightLine.show && p.rightLine.wrap) && field('Writing stops at', () => p.margins.freeRight, (pp, v) => { pp.margins.freeRight = Math.max(0, v); }, { tip: 'Distance from the right edge' }),
      h('p.muted.small', 'Both red lines are guides only. They never print in “Handwriting only” mode.'),

      h('h5', 'Extra vertical lines'),
      ...p.extraMargins.map((e, i) => h('div.extra-line',
        len(`Line ${i + 2}`, () => e.x, (pp, v) => { pp.extraMargins[i].x = Math.max(0, Math.min(pp.w, v)); }, 0, p.w),
        h('button.icon-btn.tiny', { title: 'Remove', on: { click: () => { t.commit((pp) => pp.extraMargins.splice(i, 1)); t.rebuild(); } } }, '✕'))),
      h('button.btn.small', { on: { click: () => { t.commit((pp) => pp.extraMargins.push({ x: Math.min(pp.w - 10, pp.margin + 6), color: pp.marginStyle.color, width: pp.marginStyle.width, opacity: pp.marginStyle.opacity })); t.rebuild(); } } }, '+ Add vertical line'),
    ].filter(Boolean), { collapsible: true, open: open.margin ?? false }),
  ];
}

// The canvas "Edit Paper" panel: the same sections applied live to the
// current project (text follows the lines), plus project-only options.
export function paperPanel(rebuild, openLibrary) {
  const t = { paper: () => state.project.paper, live: livePaper, commit: commitPaper, rebuild };
  const prof = activeProfile();
  return [
    h('div.panel-head', h('h3', 'Adjust paper on the page'), h('button.btn.small.primary', { on: { click: () => S.setPaperEdit(false) } }, 'Done')),
    h('p.muted.small', `${paperLabel(state.project.paper)}. Changes apply to this project only; save them as a preset from the library.`),
    h('button.btn.block', { on: { click: () => { S.setPaperEdit(false); openLibrary(); } } }, 'Paper library…'),
    ...paperSections(t, { open: { size: false, lines: true, last: false } }),
    section('Printer-safe area', [
      numField('Edge', () => prof.edge ?? 4.2, { onChange: (v) => {
        const list = profiles().map((x) => (x.id === prof.id ? { ...x, edge: Math.max(0, v) } : x));
        localStorage.setItem('hws.printerProfiles', JSON.stringify(list));
        prof.edge = Math.max(0, v);
        S.bus.emit('change');
      } }),
      toggle('Show printable area', () => state.project.view.printable !== false, (v) => { state.project.view.printable = v; S.commit(); }),
      h('p.muted.small', `Part of the printer profile “${prof.name}”, kept separate from the paper.`),
    ], { collapsible: true, open: false }),
    section('Alignment', [
      toggle('Snap text to lines', () => state.project.view.snapLines !== false, (v) => { state.project.view.snapLines = v; S.commit(); }, 'Hold Alt while dragging to place freely'),
      toggle('Snap to margins', () => state.project.view.snapMargin !== false, (v) => { state.project.view.snapMargin = v; S.commit(); }),
      toggle('Size follows line spacing', () => !!state.project.writer.defaults.autoSize, (v) => { state.project.writer.defaults.autoSize = v; S.commit(); rebuild(); }, 'For new text'),
      h('button.btn.small', { on: { click: () => {
        const d = state.project.writer.defaults;
        for (const pg of state.project.pages) for (const o of pg.objects) if (o.type === 'text' && o.hw.followLines !== false) Object.assign(o.hw, { autoSize: true, sizeRatio: d.sizeRatio || 0.37 });
        S.commit();
        toast('All ruled text now sizes to the line spacing');
      } } }, 'Fit all text to the lines'),
    ], { collapsible: true, open: false }),
    section('Printing', [
      segmented('', () => state.project.print.mode, [['ink', 'Handwriting only'], ['template', 'Paper only'], ['both', 'Both']], (v) => { state.project.print.mode = v; S.commit(); rebuild(); }),
      h('p.muted.small', {
        ink: 'For real lined paper: only your writing prints.',
        template: 'Prints just the lines and margins on blank paper.',
        both: 'Prints your writing together with the lines and margins on blank paper.',
      }[state.project.print.mode]),
      h('button.btn.block', { on: { click: openPrintPreview } }, 'Print preview…'),
    ], { collapsible: true, open: false }),
  ];
}
