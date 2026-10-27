// "Paper Settings" panel (right side, shown in Edit Paper mode). Every control
// updates the canvas live; releasing it records one undo step.
import { h, toast } from '../util.js';
import * as S from '../state.js';
import { applyPreset, presetOptions, saveUserPreset, deleteUserPreset, userPresets, setOrientation, lineCount, writingBox, paperFromPreset } from '../paper.js';
import { livePaper, commitPaper } from '../paperedit.js';
import { section, slider, lenSlider, numField, toggle, select, segmented, colorRow, getUnit, setUnit } from './controls.js';
import { activeProfile, profiles, openPrintPreview } from '../print.js';

const { state } = S;
const RULE_COLORS = [{ name: 'Blue', color: '#9cc3e4' }, { name: 'Grey', color: '#b9bec6' }, { name: 'Green', color: '#a8d5b5' }, { name: 'Purple', color: '#c4b5e8' }];
const MARGIN_COLORS = [{ name: 'Red', color: '#e79a9a' }, { name: 'Pink', color: '#f0b3c8' }, { name: 'Blue', color: '#9cc3e4' }, { name: 'Grey', color: '#b9bec6' }];
const BG_COLORS = [{ name: 'White', color: '#fdfdfb' }, { name: 'Cream', color: '#fbf6e6' }, { name: 'Grey', color: '#eeeeee' }, { name: 'Blue tint', color: '#f1f6fb' }];

export function paperPanel(rebuild) {
  const p = state.project.paper;
  const live = (fn) => (v) => livePaper((pp) => fn(pp, v));
  const done = () => commitPaper();
  const set = (fn) => (v) => commitPaper((pp) => fn(pp, v));
  const len = (label, get, fn, min, max, tip) => lenSlider(label, get, { min, max, onInput: live(fn), onCommit: done, tip });
  const field = (label, get, fn) => numField(label, get, { onChange: set(fn) });
  const opacity = (get, fn) => slider('Opacity', get, { min: 0.05, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%', onInput: live(fn), onCommit: done });

  const presetName = h('input', { type: 'text', placeholder: 'Preset name' });
  const isUser = p.presetId?.startsWith('user-');
  const prof = activeProfile();

  return [
    h('div.panel-head', h('h3', 'Paper settings'), h('button.btn.small.primary', { on: { click: () => S.setPaperEdit(false) } }, 'Done')),
    h('p.muted.small', 'Drag the first line, the spacing line or the margin on the page, or set exact values here. Hold Shift while dragging for finer steps.'),

    section('Paper size', [
      select('Preset', () => p.presetId, presetOptions(p), (v) => { commitPaper((pp) => applyPreset(pp, v)); rebuild(); }),
      segmented('Units', getUnit, [['in', 'in'], ['mm', 'mm'], ['cm', 'cm']], (v) => { setUnit(v); rebuild(); S.bus.emit('zoom'); }),
      h('div.grid2',
        field('Width', () => p.w, (pp, v) => { pp.w = Math.max(50, v); pp.presetId = 'custom'; }),
        field('Height', () => p.h, (pp, v) => { pp.h = Math.max(50, v); pp.presetId = 'custom'; })),
      segmented('Orientation', () => p.orientation, [['portrait', 'Portrait'], ['landscape', 'Landscape']], (v) => { commitPaper((pp) => setOrientation(pp, v)); rebuild(); }),
      h('h5', 'Writing margins'),
      h('div.grid2',
        field('Top', () => p.margins.top, (pp, v) => { pp.margins.top = Math.max(0, v); }),
        field('Bottom', () => p.margins.bottom, (pp, v) => { pp.margins.bottom = Math.max(0, v); }),
        numField('Left', () => p.margins.left, { onChange: set((pp, v) => { pp.margins.left = Math.max(0, v); pp.margins.linkLeft = false; }), disabled: p.margins.linkLeft }),
        field('Right', () => p.margins.right, (pp, v) => { pp.margins.right = Math.max(0, v); })),
      toggle('Left margin follows the red line', () => p.margins.linkLeft, (v) => { commitPaper((pp) => { pp.margins.linkLeft = v; }); rebuild(); }),
      colorRow('Paper colour', () => p.bg, (v, c) => (c ? set((pp) => { pp.bg = v; })() : livePaper((pp) => { pp.bg = v; })), { presets: BG_COLORS }),
      h('p.muted.small', 'Paper colour is only shown on screen. It is never printed.'),
      h('h5', 'Printer-safe area'),
      numField('Edge', () => prof.edge ?? 4.2, { onChange: (v) => {
        const list = profiles().map((x) => (x.id === prof.id ? { ...x, edge: Math.max(0, v) } : x));
        localStorage.setItem('hws.printerProfiles', JSON.stringify(list));
        prof.edge = Math.max(0, v);
        S.bus.emit('change');
      } }),
      toggle('Show printable area', () => state.project.view.printable !== false, (v) => { state.project.view.printable = v; S.commit(); }),
      h('p.muted.small', `Saved with the printer profile “${prof.name}”. Printer calibration is separate from these paper settings.`),
      h('h5', 'Presets'),
      h('div.row.tight', presetName, h('button.btn.small', { on: { click: () => {
        const name = presetName.value.trim();
        if (!name) return toast('Give the preset a name first');
        p.presetId = saveUserPreset(name, p);
        S.commit();
        toast(`Saved paper preset “${name}”`);
        rebuild();
      } } }, 'Save preset')),
      h('div.btn-row',
        h('button.btn.small', { title: 'Restore the selected preset’s measurements', on: { click: () => {
          const id = p.presetId && p.presetId !== 'custom' ? p.presetId : 'filler-wide';
          commitPaper((pp) => { const keep = pp.presetId; Object.keys(pp).forEach((k) => delete pp[k]); Object.assign(pp, paperFromPreset(id)); pp.presetId = keep === 'custom' ? id : keep; });
          rebuild();
        } } }, 'Reset to preset'),
        isUser && h('button.btn.small.ghost', { on: { click: () => { deleteUserPreset(p.presetId); p.presetId = 'custom'; S.commit(); rebuild(); } } }, 'Delete preset')),
      userPresets().length ? null : h('p.muted.small', 'Saved presets appear in the Preset list in every project.'),
    ].filter(Boolean), { collapsible: true, open: true }),

    section('Horizontal lines', [
      toggle('Show lines', () => state.project.view.overlay, (v) => { state.project.view.overlay = v; S.commit(); }, 'Never printed unless you choose a paper-template print mode'),
      len('Line spacing', () => p.spacing, (pp, v) => { pp.spacing = Math.max(2, v); pp.presetId = 'custom'; }, 3, 15),
      len('First line', () => p.firstLine, (pp, v) => { pp.firstLine = Math.max(0, v); pp.presetId = 'custom'; }, 0, Math.min(90, p.h / 2), 'Distance from the top edge'),
      toggle('Count lines automatically', () => p.autoLines, (v) => { commitPaper((pp) => { if (!v) pp.lines = lineCount(pp); pp.autoLines = v; }); rebuild(); }, 'Fill down to the bottom margin'),
      numField('Lines', () => lineCount(p), { unit: 'lines', step: 1, disabled: p.autoLines, onChange: set((pp, v) => { pp.lines = Math.max(0, Math.round(v)); }) }),
      slider('Thickness', () => p.lineStyle.width, { min: 0.05, max: 1, step: 0.01, unit: 'mm', onInput: live((pp, v) => { pp.lineStyle.width = v; }), onCommit: done }),
      colorRow('Colour', () => p.lineStyle.color, (v, c) => (c ? set((pp) => { pp.lineStyle.color = v; })() : livePaper((pp) => { pp.lineStyle.color = v; })), { presets: RULE_COLORS }),
      opacity(() => p.lineStyle.opacity, (pp, v) => { pp.lineStyle.opacity = v; }),
      len('Lines start at', () => p.lineStyle.start || 0, (pp, v) => { pp.lineStyle.start = Math.max(0, v); }, 0, p.w / 2, 'Distance from the left edge'),
      len('Lines end at', () => p.lineStyle.end ?? p.w, (pp, v) => { pp.lineStyle.end = Math.min(pp.w, v); }, p.w / 2, p.w, 'Distance from the left edge'),
      slider('Angle', () => p.lineStyle.angle || 0, { min: -3, max: 3, step: 0.05, unit: '°', onInput: live((pp, v) => { pp.lineStyle.angle = v; }), onCommit: done, tip: 'Match paper whose lines are printed slightly crooked' }),
    ], { collapsible: true, open: true }),

    section('Vertical margins', [
      toggle('Show red margin', () => p.marginStyle.show, (v) => { commitPaper((pp) => { pp.marginStyle.show = v; }); rebuild(); }),
      len('From left edge', () => p.margin, (pp, v) => { pp.margin = Math.max(0, v); pp.presetId = 'custom'; }, 0, p.w / 2),
      slider('Thickness', () => p.marginStyle.width, { min: 0.05, max: 1.2, step: 0.01, unit: 'mm', onInput: live((pp, v) => { pp.marginStyle.width = v; }), onCommit: done }),
      colorRow('Colour', () => p.marginStyle.color, (v, c) => (c ? set((pp) => { pp.marginStyle.color = v; })() : livePaper((pp) => { pp.marginStyle.color = v; })), { presets: MARGIN_COLORS }),
      opacity(() => p.marginStyle.opacity, (pp, v) => { pp.marginStyle.opacity = v; }),
      len('Starts at', () => p.marginStyle.start || 0, (pp, v) => { pp.marginStyle.start = Math.max(0, v); }, 0, p.h / 2, 'Distance from the top edge'),
      len('Ends at', () => p.marginStyle.end ?? p.h, (pp, v) => { pp.marginStyle.end = Math.min(pp.h, v); }, p.h / 2, p.h, 'Distance from the top edge'),
      h('h5', 'Extra vertical lines'),
      ...p.extraMargins.map((e, i) => h('div.extra-line',
        len(`Line ${i + 2}`, () => e.x, (pp, v) => { pp.extraMargins[i].x = Math.max(0, Math.min(pp.w, v)); }, 0, p.w),
        h('button.icon-btn.tiny', { title: 'Remove', on: { click: () => { commitPaper((pp) => pp.extraMargins.splice(i, 1)); rebuild(); } } }, '✕'))),
      h('button.btn.small', { on: { click: () => { commitPaper((pp) => pp.extraMargins.push({ x: Math.min(pp.w - 10, pp.margin + 6), color: pp.marginStyle.color, width: pp.marginStyle.width, opacity: pp.marginStyle.opacity })); rebuild(); } } }, '+ Add vertical line'),
    ], { collapsible: true, open: false }),

    section('Alignment', [
      toggle('Snap text to lines', () => state.project.view.snapLines !== false, (v) => { state.project.view.snapLines = v; S.commit(); }, 'Text baselines lock onto the ruled lines. Hold Alt while dragging to place freely.'),
      toggle('Snap to margins', () => state.project.view.snapMargin !== false, (v) => { state.project.view.snapMargin = v; S.commit(); }, 'The red margin and writing margins act as snapping edges'),
      toggle('Size follows line spacing', () => !!state.project.writer.defaults.autoSize, (v) => { state.project.writer.defaults.autoSize = v; S.commit(); rebuild(); }, 'For new text: letters scale with the ruling'),
      state.project.writer.defaults.autoSize && slider('Letter height', () => state.project.writer.defaults.sizeRatio || 0.37, { min: 0.2, max: 0.6, step: 0.01, fmt: (v) => Math.round(v * 100) + '%', onInput: (v) => { state.project.writer.defaults.sizeRatio = v; }, onCommit: () => S.commit(), tip: 'Lowercase height as a share of the line spacing' }),
      h('button.btn.small', { title: 'Make every text box that follows the ruling size itself to the lines', on: { click: () => {
        const d = state.project.writer.defaults;
        for (const pg of state.project.pages) for (const o of pg.objects) if (o.type === 'text' && o.hw.followLines !== false) Object.assign(o.hw, { autoSize: true, sizeRatio: d.sizeRatio || 0.37 });
        S.commit();
        toast('All ruled text now sizes to the line spacing');
      } } }, 'Fit all text to the lines'),
      h('p.muted.small', 'Text sitting on a line keeps its line when you change spacing or the first line, and text at the margins follows them. Undo restores everything.'),
    ].filter(Boolean), { collapsible: true, open: false }),

    section('Printing', [
      segmented('', () => state.project.print.mode, [['ink', 'Handwriting only'], ['template', 'Paper only'], ['both', 'Both']], (v) => { state.project.print.mode = v; S.commit(); rebuild(); }),
      h('p.muted.small', {
        ink: 'For real lined paper: only your writing prints. The lines, margin and paper colour stay on screen.',
        template: 'Prints just the lines and margins on blank paper, so you can make your own ruled sheets.',
        both: 'Prints your writing together with the lines and margins on blank paper.',
      }[state.project.print.mode]),
      h('button.btn.block', { on: { click: openPrintPreview } }, 'Print preview…'),
    ], { collapsible: true, open: false }),
  ];
}
