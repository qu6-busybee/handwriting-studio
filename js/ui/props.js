// Right-hand properties panel: shows only what applies to the selection.
import { h } from '../util.js';
import * as S from '../state.js';
import { presetOptions, writingBox } from '../paper.js';
import { getUnit, setUnit } from './controls.js';
import { allStyles } from '../handwriting/styles.js';
import { section, slider, numField, toggle, select, segmented, colorRow, iconBtn, syncers, syncAll } from './controls.js';
import { openCalibration } from '../print.js';
import { aabb, startEditing } from '../editor/canvas.js';
import { icon } from './icons.js';
import { paperPanel } from './paperpanel.js';
import { hwSettings } from './hwpanel.js';
import { PENS, INK_PRESETS } from '../handwriting/pens.js';
import { openPaperLibrary } from './paperstudio.js';
import { commitPaper } from '../paperedit.js';
import { applyPreset, paperLabel } from '../paper.js';
import { rulingName } from '../units.js';
import { can, gate, upgradeDialog, proBadge } from '../plan.js';
import { openHandDrawn } from '../drawing/drawdlg.js';
import { openEditProject } from '../ai/editor.js';
import { openHistory } from '../ai/history.js';
import { checklistView } from '../ai/builder.js';

const { state, bus } = S;
let root;

export function initProps() {
  root = document.getElementById('rightpanel');
  for (const ev of ['selection', 'page', 'project', 'styles', 'stage', 'editing', 'paperEdit', 'step', 'plan']) bus.on(ev, build);
  bus.on('history', () => {
    // Paper settings can change shape on undo (e.g. extra lines); rebuild
    // unless the user is typing in the panel.
    if (state.paperEdit && !root.contains(document.activeElement)) build();
    else syncAll();
  });
  bus.on('live', () => syncAll());
  build();
}

const live = () => bus.emit('change');
const done = () => S.commit();

export function styleOptions() {
  const cats = [['neat', 'Neat'], ['casual', 'Casual'], ['rushed', 'Rushed'], ['cursive', 'Cursive']];
  const all = allStyles();
  const out = cats.map(([k, label]) => ({ group: label, items: all.filter((s) => s.font && s.category === k).map((s) => ({ value: s.id, label: s.name })) }));
  const mine = all.filter((s) => !s.font);
  if (mine.length) out.push({ group: 'Your handwriting', items: mine.map((s) => ({ value: s.id, label: s.name })) });
  return out;
}

function build() {
  if (!root || !state.project) return;
  syncers.clear();
  const sel = S.selected();
  const body = h('div.props');
  if (state.paperEdit) body.append(...paperPanel(build, openPaperLibrary));
  else if (!sel.length) body.append(...pageProps().filter(Boolean));
  else if (sel.length === 1) body.append(...objectProps(sel[0]));
  else body.append(...multiProps(sel));
  root.replaceChildren(body);
}

// The document's handwriting: writer defaults plus every text box that
// hasn't been given its own style, edited together.
const documentTargets = () => [{ hw: state.project.writer.defaults }, ...state.project.pages.flatMap((pg) => pg.objects.filter((o) => o.type === 'text' && !o.hw.custom))];

function documentHandwriting() {
  const p = state.project;
  return section('Handwriting for the whole document', [
    h('p.muted.small', can('perElement') ? 'Applies to every text box. Select a text box to give it its own style (Pro).' : 'Applies to every text box on every page.'),
    ...hwSettings(documentTargets(), { rebuild: build, defaults: true }),
    h('button.btn.block', { title: 'A different person: changes everyone’s letter habits and slant', on: { click: () => { p.writer.seed = (Math.random() * 1e9) | 0; done(); } } }, 'New writer'),
  ]);
}

// ---------- nothing selected ----------
function pageProps() {
  const p = state.project;
  if (p.step === 3) return [documentHandwriting()];
  return [
    p.ai?.checklist?.length ? section('AI draft', [
      h('p.muted.small', 'What the rubric asks for, and whether the draft covers it. Text marked “To add” needs your own information.'),
      checklistView(p.ai.checklist),
      h('div.btn-row',
        h('button.btn', { on: { click: () => (can('editProject') ? openEditProject() : upgradeDialog('editProject')) } }, 'Edit with AI…'),
        h('button.btn', { on: { click: openHistory } }, 'History')),
    ], { collapsible: true, open: true }) : null,
    section('Paper', [
      h('div.paper-summary', h('strong', paperLabel(p.paper)), h('span.muted.small', rulingName(p.paper.spacing))),
      h('div.btn-row',
        h('button.btn', { on: { click: () => S.setStep(1) } }, 'Change paper'),
        h('button.btn', { on: { click: () => S.setPaperEdit(true) } }, 'Adjust on page')),
      h('p.muted.small', 'The lines and margins are a guide only. By default, printing outputs just your writing.'),
      toggle('Show notebook lines', () => p.view.overlay, (v) => { p.view.overlay = v; done(); }, 'Never printed in “Handwriting only” mode'),
      toggle('Show printable area', () => p.view.printable !== false, (v) => { p.view.printable = v; done(); }, 'Dashed box: your printer can’t print outside it'),
      toggle('Snap text to lines', () => p.view.snapLines !== false, (v) => { p.view.snapLines = v; done(); }),
      segmented('Units', getUnit, [['in', 'in'], ['mm', 'mm'], ['cm', 'cm']], (v) => { setUnit(v); build(); }),
      h('button.btn.block', { on: { click: openCalibration } }, 'Calibrate printer…'),
    ]),
    section('Shortcuts', [h('div.shortcuts',
      ...[['T', 'Text'], ['P', 'Pen'], ['R / O / L / A', 'Shapes'], ['Dbl-click', 'Edit text'], ['Ctrl D', 'Duplicate'], ['Ctrl G', 'Group'], ['Alt-drag', 'Copy'], ['Space-drag', 'Pan'], ['Ctrl wheel', 'Zoom']]
        .map(([k, v]) => h('div', h('kbd', k), h('span', v))))], { collapsible: true, open: false }),
  ];
}

// ---------- single object ----------
function objectProps(o) {
  const out = [];
  const step3 = state.project.step === 3;
  if (o.type === 'text' && step3) {
    // Step 3: handwriting for this box (Pro) or the document (Basic).
    if (can('perElement')) out.push(section('Handwriting for this text box', hwSettings([o], { rebuild: build, element: true })));
    else {
      out.push(h('div.stage-note', 'Basic applies handwriting to the whole document. ', h('button.btn.small.link', { on: { click: () => upgradeDialog('perElement') } }, 'Per-element styles'), ' ', proBadge()));
      out.push(documentHandwriting());
    }
    out.push(geometry(o));
    return out;
  }
  if (o.type === 'text') {
    const ta = h('textarea.text-input', { rows: 5, value: o.text, placeholder: 'Type your text…', spellcheck: true });
    ta.addEventListener('input', () => { o.text = ta.value; live(); });
    ta.addEventListener('change', done);
    syncers.add(() => { if (ta.isConnected && document.activeElement !== ta) ta.value = o.text; });
    out.push(section('Text', [ta, h('p.muted.small', 'Tab = paragraph indent · ~~crossed out~~ · __underlined__ · [red]coloured words[/] (blue, black, red, green, purple, darkblue, lightblue, blueblack or #hex)'),
      h('button.btn.small.link', { on: { click: () => startEditing(o.id) } }, 'Edit on the page')]));
    ta.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('\t', ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); } });
    out.push(h('p.muted.small.step-hint', 'Typed in an Arial-style font. Choose handwriting in Step 3.'));
  } else if (o.type === 'shape') {
    out.push(section(o.name || 'Shape', shapeControls([o])));
  } else if (o.type === 'path') {
    out.push(section(o.highlighter ? 'Highlight' : 'Drawing', [
      !o.highlighter && instrumentSelect([o]),
      colorRow('Colour', () => o.stroke, (v, c) => { o.stroke = v; live(); if (c) done(); }, { presets: o.highlighter ? HL : INK_PRESETS }),
      slider('Width', () => o.strokeWidth, { min: 0.15, max: 8, step: 0.05, unit: 'mm', onInput: (v) => { o.strokeWidth = v; live(); }, onCommit: done }),
      !o.highlighter && gate(slider('Pen pressure', () => o.pressure ?? 0.5, { min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%', onInput: (v) => { o.pressure = v; live(); }, onCommit: done }), 'advancedInk'),
    ].filter(Boolean)));
  } else if (o.type === 'image') {
    out.push(section('Image', [h('p.muted.small', 'Images print exactly as shown. Use PNGs with transparent backgrounds for stickers or diagrams.'),
      h('button.btn.block', { on: { click: () => (can('drawings') ? openHandDrawn(o) : upgradeDialog('drawings')) } }, 'Turn into hand-drawn sketch…', !can('drawings') && proBadge())]));
  } else if (o.type === 'drawing') {
    out.push(section('Hand-drawn image', [
      instrumentSelect([o]),
      colorRow('Pen colour', () => o.stroke, (v, c) => { o.stroke = v; live(); if (c) done(); }, { presets: INK_PRESETS }),
      slider('Line thickness', () => o.strokeWidth, { min: 0.15, max: 1.5, step: 0.05, unit: 'mm', onInput: (v) => { o.strokeWidth = v; live(); }, onCommit: done }),
      slider('Darkness', () => o.darkness ?? 0.85, { min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%', onInput: (v) => { o.darkness = v; live(); }, onCommit: done }),
      o.source && h('button.btn.block', { on: { click: () => (can('drawings') ? openHandDrawn(o) : upgradeDialog('drawings')) } }, 'Redraw in another style…', !can('drawings') && proBadge()),
      h('p.muted.small', 'Vector lines: stays sharp when printed. Add labels and arrows with the Text and Arrow tools.'),
    ].filter(Boolean)));
  }
  if (o.ai && !step3) out.unshift(h('div.ai-note', 'Written by AI. Check it before you hand it in.'));
  out.push(geometry(o), arrangeSection([o]));
  return out;
}

// Shapes and drawings can use any writing instrument (e.g. a pencil diagram).
function instrumentSelect(objs) {
  return gate(instrumentSelectRaw(objs), 'advancedInk');
}
function instrumentSelectRaw(objs) {
  return select('Instrument', () => objs[0].pen || 'ballpoint', Object.entries(PENS).map(([k, p]) => ({ value: k, label: p.label })), (v) => {
    objs.forEach((o) => {
      if (PENS[v].kind === 'pencil' && PENS[o.pen || 'ballpoint'].kind !== 'pencil') o.stroke = '#47494f';
      o.pen = v;
    });
    done();
  });
}

const HL = [{ name: 'Yellow', color: '#f2df3c' }, { name: 'Green', color: '#8be08b' }, { name: 'Pink', color: '#f59cc9' }, { name: 'Blue', color: '#8ecdf5' }];

function shapeControls(objs) {
  const o0 = objs[0];
  const set = (k) => (v) => { objs.forEach((o) => (o[k] = v)); live(); };
  const isHL = o0.shape === 'highlight';
  return [
    !isHL && instrumentSelect(objs),
    !isHL && colorRow('Stroke', () => o0.stroke, (v, c) => { set('stroke')(v); if (c) done(); }, { presets: INK_PRESETS }),
    !isHL && gate(slider('Pen pressure', () => o0.pressure ?? 0.5, { min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%', onInput: set('pressure'), onCommit: done }), 'advancedInk'),
    !isHL && slider('Stroke width', () => o0.strokeWidth, { min: 0.15, max: 3, step: 0.05, unit: 'mm', onInput: set('strokeWidth'), onCommit: done }),
    ['rect', 'ellipse', 'triangle', 'star', 'highlight'].includes(o0.shape) && colorRow('Fill', () => o0.fill, (v, c) => { set('fill')(v); if (c) done(); }, { allowNone: !isHL, presets: isHL ? HL : undefined }),
    !isHL && toggle('Hand-drawn', () => o0.handDrawn !== false, (v) => { set('handDrawn')(v); done(); }),
    !isHL && h('button.btn.block', { on: { click: () => { objs.forEach((o) => (o.seed = (Math.random() * 1e9) | 0)); done(); } } }, 'Redraw'),
  ].filter(Boolean);
}

function geometry(o) {
  const set = (k) => (v) => { o[k] = v; done(); };
  return section('Position', [
    h('div.grid2',
      numField('X', () => o.x, { onChange: set('x') }),
      numField('Y', () => o.y, { onChange: set('y') }),
      numField('W', () => o.w, { onChange: (v) => set('w')(Math.max(1, v)) }),
      numField('H', () => o.h, { onChange: (v) => set('h')(Math.max(1, v)), disabled: o.type === 'text' }),
      numField('Rotate', () => o.rot || 0, { unit: '°', step: 1, onChange: set('rot') }),
      numField('Opacity', () => (o.opacity ?? 1) * 100, { unit: '%', step: 5, onChange: (v) => set('opacity')(Math.max(0, Math.min(100, v)) / 100) })),
    o.type === 'text' && h('button.btn.small.link', { on: { click: () => { const wb = writingBox(state.project.paper); o.x = wb.x; o.w = wb.w; o.rot = 0; done(); } } }, 'Fit between margin and right edge'),
  ].filter(Boolean), { collapsible: true, open: true });
}

function arrangeSection(objs) {
  const locked = objs.every((o) => o.locked);
  const grouped = objs.some((o) => o.groupId);
  return section('Arrange', [
    h('div.btn-row.icons',
      iconBtn('up', 'Bring to front (Ctrl+Shift+])', () => S.arrange('front')),
      iconBtn('right', 'Bring forward (Ctrl+])', () => S.arrange('forward')),
      iconBtn('down', 'Send to back (Ctrl+Shift+[)', () => S.arrange('back')),
      iconBtn('copy', 'Duplicate (Ctrl+D)', S.duplicateSelected),
      iconBtn(locked ? 'unlock' : 'lock', locked ? 'Unlock' : 'Lock', () => { objs.forEach((o) => (o.locked = !locked)); done(); bus.emit('selection'); }),
      objs.length > 1 && iconBtn('group', grouped ? 'Ungroup (Ctrl+Shift+G)' : 'Group (Ctrl+G)', () => { grouped ? S.ungroupSelected() : S.groupSelected(); bus.emit('selection'); }),
      iconBtn('trash', 'Delete (Del)', S.deleteSelected, '.danger')),
  ]);
}

// ---------- multiple ----------
function multiProps(objs) {
  const texts = objs.filter((o) => o.type === 'text');
  const shapes = objs.filter((o) => o.type === 'shape');
  const out = [section(`${objs.length} objects`, [alignButtons()])];
  if (texts.length && state.project.step === 3) {
    if (can('perElement')) out.push(section(`Handwriting for ${texts.length} text boxes`, hwSettings(texts, { rebuild: build, element: true })));
    else out.push(documentHandwriting());
  }
  if (shapes.length) out.push(section(`Shapes (${shapes.length})`, shapeControls(shapes)));
  out.push(arrangeSection(objs));
  return out;
}

export function alignButtons() {
  return h('div.btn-row.icons',
    iconBtn('align-left', 'Align left', () => align('left')),
    iconBtn('align-center', 'Align centre', () => align('center')),
    iconBtn('align-right', 'Align right', () => align('right')),
    iconBtn('align-top', 'Align top', () => align('top')),
    iconBtn('align-middle', 'Align middle', () => align('middle')),
    iconBtn('align-bottom', 'Align bottom', () => align('bottom')),
    iconBtn('dist-h', 'Distribute horizontally', () => align('dist-h')),
    iconBtn('dist-v', 'Distribute vertically', () => align('dist-v')));
}

// Aligns to the selection box, or to the writing area for a single object.
export function align(mode) {
  const objs = S.selected().filter((o) => !o.locked);
  if (!objs.length) return;
  const p = state.project.paper;
  const wb = writingBox(p);
  const ref = objs.length > 1 ? aabb(objs) : { x: wb.x, y: 0, w: wb.w, h: p.h };
  const boxes = objs.map((o) => ({ o, b: aabb([o]) }));
  if (mode === 'dist-h' || mode === 'dist-v') {
    if (objs.length < 3) return;
    const hz = mode === 'dist-h';
    boxes.sort((a, b) => (hz ? a.b.x - b.b.x : a.b.y - b.b.y));
    const total = boxes.reduce((s, x) => s + (hz ? x.b.w : x.b.h), 0);
    const span = hz ? ref.w : ref.h;
    const gap = (span - total) / (boxes.length - 1);
    let pos = hz ? ref.x : ref.y;
    for (const { o, b } of boxes) {
      if (hz) o.x += pos - b.x; else o.y += pos - b.y;
      pos += (hz ? b.w : b.h) + gap;
    }
  } else {
    for (const { o, b } of boxes) {
      if (mode === 'left') o.x += ref.x - b.x;
      if (mode === 'center') o.x += ref.x + ref.w / 2 - (b.x + b.w / 2);
      if (mode === 'right') o.x += ref.x + ref.w - (b.x + b.w);
      if (mode === 'top') o.y += ref.y - b.y;
      if (mode === 'middle') o.y += ref.y + ref.h / 2 - (b.y + b.h / 2);
      if (mode === 'bottom') o.y += ref.y + ref.h - (b.y + b.h);
    }
  }
  done();
}
