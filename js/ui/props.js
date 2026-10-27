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
import { commitPaper } from '../paperedit.js';
import { applyPreset } from '../paper.js';

const { state, bus } = S;
let root;

export function initProps() {
  root = document.getElementById('rightpanel');
  for (const ev of ['selection', 'page', 'project', 'styles', 'stage', 'editing', 'paperEdit']) bus.on(ev, build);
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
  if (state.paperEdit) body.append(...paperPanel(build));
  else if (!sel.length) body.append(...pageProps());
  else if (sel.length === 1) body.append(...objectProps(sel[0]));
  else body.append(...multiProps(sel));
  root.replaceChildren(body);
}

// ---------- handwriting controls shared by single and multi selection ----------
function hwControls(objs, { full = true } = {}) {
  const o0 = objs[0];
  const get = (k) => () => o0.hw[k];
  const set = (k) => (v) => { objs.forEach((o) => (o.hw[k] = v)); live(); };
  const setC = (k) => (v) => { set(k)(v); done(); };
  const out = [stageNote(objs)];
  out.push(
    select('Style', get('style'), styleOptions(), setC('style')),
    segmented('Manner', get('manner'), [['neat', 'Neat'], ['casual', 'Casual'], ['rushed', 'Rushed']], setC('manner')),
    penControls(objs, (k, v) => { objs.forEach((o) => (o.hw[k] = v)); }),
    toggle('Size follows lines', () => !!o0.hw.autoSize, (v) => { set('autoSize')(v); done(); build(); }, 'Letters scale with the paper’s line spacing'),
    o0.hw.autoSize
      ? slider('Letter height', () => o0.hw.sizeRatio || 0.37, { min: 0.2, max: 0.6, step: 0.01, fmt: (v) => Math.round(v * 100) + '%', onInput: set('sizeRatio'), onCommit: done, tip: 'Lowercase height as a share of the line spacing' })
      : slider('Letter size', get('size'), { min: 1.2, max: 9, step: 0.05, unit: 'mm', onInput: set('size'), onCommit: done, tip: 'Height of lowercase letters (x-height)' }),
    slider('Neatness', get('neatness'), { min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%', onInput: set('neatness'), onCommit: done }),
  );
  if (!full) return out;
  if (state.project.stage === 'handwriting') {
    out.push(h('button.btn.block', { title: 'Write this section again with fresh natural variation', on: { click: () => S.regenerate(objs) } }, icon('shuffle', 15), objs.length > 1 ? 'Regenerate these sections' : 'Regenerate this section'));
  }
  out.push(section('Advanced handwriting', [
    slider('Slant', get('slant'), { min: -20, max: 25, step: 0.5, unit: '°', onInput: set('slant'), onCommit: done }),
    slider('Letter spacing', get('letterSpacing'), { min: -0.6, max: 1.5, step: 0.02, unit: 'mm', onInput: set('letterSpacing'), onCommit: done }),
    slider('Word spacing', get('wordSpacing'), { min: 0.4, max: 2.5, step: 0.05, unit: '×', onInput: set('wordSpacing'), onCommit: done }),
    toggle('Sit on ruled lines', get('followLines'), (v) => { set('followLines')(v); done(); }, 'Line spacing matches the paper and the text snaps to the blue lines'),
    slider('Line spacing', () => o0.hw.lineSpacing || state.project.paper.spacing, { min: 3, max: 20, step: 0.05, unit: 'mm', onInput: set('lineSpacing'), onCommit: done, tip: 'Overrides the paper ruling' }),
    h('button.btn.small.link', { on: { click: () => { set('lineSpacing')(0); done(); } } }, 'Reset to paper ruling'),
    slider('Baseline drift', get('drift'), { min: 0, max: 1.5, step: 0.01, onInput: set('drift'), onCommit: done }),
    slider('Ink variation', get('inkVar'), { min: 0, max: 1, step: 0.01, onInput: set('inkVar'), onCommit: done }),
    slider('Pen weight', get('weight'), { min: 0, max: 0.35, step: 0.01, unit: 'mm', onInput: set('weight'), onCommit: done, tip: 'Thickens font-based styles' }),
    slider('Pen width', get('penWidth'), { min: 0.15, max: 1.2, step: 0.01, unit: 'mm', onInput: set('penWidth'), onCommit: done, tip: 'Stroke width for drawn styles and cross-outs' }),
    toggle('Ink texture', get('texture'), (v) => { set('texture')(v); done(); }),
    slider('Natural mistakes', get('mistakes'), { min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%', onInput: set('mistakes'), onCommit: done, tip: 'Occasionally misspells a word, crosses it out and rewrites it' }),
  ], { collapsible: true, open: false }));
  return out;
}

// Explains what the user is looking at in each stage.
function stageNote(objs) {
  if (state.project.stage !== 'handwriting') {
    return h('p.stage-note', 'Shown as plain text while you edit. These settings apply when you click ', h('b', 'Generate Handwriting'), '.');
  }
  const stale = objs.filter(S.isStale);
  if (!stale.length) return null;
  return h('div.stage-note.warn', `${stale.length > 1 ? 'Some text has' : 'This text has'} changed since it was generated, so it’s shown as plain text. `,
    h('button.btn.small', { on: { click: () => S.generateHandwriting(stale) } }, 'Generate this section'));
}

// Pen type + matching colours (ink presets or graphite grades).
function penControls(objs, setAll) {
  const o0 = objs[0];
  const pen = () => o0.hw.pen || 'ballpoint';
  const wrap = h('div');
  const draw = () => wrap.replaceChildren(
    segmented('Pen', pen, [['ballpoint', 'Ballpoint'], ['gel', 'Gel'], ['pencil', 'Pencil']], (v) => {
      const wasPencil = pen() === 'pencil';
      setAll('pen', v);
      if (v === 'pencil' && !wasPencil) setAll('color', S.PENCILS[0].color);
      if (v !== 'pencil' && wasPencil) setAll('color', S.INKS[0].color);
      done();
      draw();
    }),
    colorRow(pen() === 'pencil' ? 'Graphite' : 'Ink', () => o0.hw.color, (v, commit) => { setAll('color', v); live(); if (commit) done(); }, { presets: pen() === 'pencil' ? S.PENCILS : S.INKS }),
  );
  draw();
  return wrap;
}

// ---------- nothing selected: page + writer ----------
function pageProps() {
  const p = state.project;
  const d = p.writer.defaults;
  const setD = (k) => (v) => { d[k] = v; };
  return [
    section('Paper', [
      select('', () => p.paper.presetId, presetOptions(p.paper), (v) => {
        commitPaper((pp) => applyPreset(pp, v));
        d.size = +(p.paper.spacing * 0.37).toFixed(2);
        build();
      }),
      h('p.muted.small', 'The lines, margin and paper colour are a guide only. By default, printing outputs just your writing, because your real paper already has the lines.'),
      toggle('Show notebook lines', () => p.view.overlay, (v) => { p.view.overlay = v; done(); }, 'Never printed in “Handwriting only” mode'),
      toggle('Show printable area', () => p.view.printable !== false, (v) => { p.view.printable = v; done(); }, 'Dashed box: your printer can’t print outside it'),
      toggle('Snap text to lines', () => p.view.snapLines !== false, (v) => { p.view.snapLines = v; done(); }),
      segmented('Units', getUnit, [['in', 'in'], ['mm', 'mm'], ['cm', 'cm']], (v) => { setUnit(v); build(); }),
      h('div.btn-row',
        h('button.btn', { on: { click: () => S.setPaperEdit(true) } }, 'Paper settings…'),
        h('button.btn', { on: { click: openCalibration } }, 'Calibrate printer…')),
    ]),
    section('Writer', [
      h('p.muted.small', 'New text uses these settings. Every page shares one writer identity, so letters keep the same habits throughout.'),
      select('Default style', () => d.style, styleOptions(), (v) => { d.style = v; done(); }),
      segmented('Manner', () => d.manner, [['neat', 'Neat'], ['casual', 'Casual'], ['rushed', 'Rushed']], (v) => { d.manner = v; done(); }),
      d.autoSize
        ? slider('Letter height', () => d.sizeRatio || 0.37, { min: 0.2, max: 0.6, step: 0.01, fmt: (v) => Math.round(v * 100) + '%', onInput: setD('sizeRatio'), onCommit: done, tip: 'Share of the line spacing (set in Paper settings → Alignment)' })
        : slider('Letter size', () => d.size, { min: 1.2, max: 9, step: 0.05, unit: 'mm', onInput: setD('size'), onCommit: done }),
      penControls([{ hw: d }], (k, v) => { d[k] = v; }),
      slider('Neatness', () => d.neatness, { min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%', onInput: setD('neatness'), onCommit: done }),
      h('div.btn-row',
        h('button.btn', { title: 'Apply style, manner, size, ink and neatness to every text box', on: { click: () => {
          for (const pg of p.pages) for (const o of pg.objects) if (o.type === 'text') Object.assign(o.hw, { style: d.style, manner: d.manner, size: d.size, autoSize: !!d.autoSize, sizeRatio: d.sizeRatio || 0.37, pen: d.pen, color: d.color, neatness: d.neatness });
          done();
        } } }, 'Apply to all text'),
        h('button.btn', { title: 'A different person: changes everyone’s letter habits and slant', on: { click: () => { p.writer.seed = (Math.random() * 1e9) | 0; done(); } } }, 'New writer')),
    ]),
    section('Shortcuts', [h('div.shortcuts',
      ...[['T', 'Text'], ['P', 'Pen'], ['R / O / L / A', 'Shapes'], ['Dbl-click', 'Edit text'], ['Ctrl D', 'Duplicate'], ['Ctrl G', 'Group'], ['Alt-drag', 'Copy'], ['Space-drag', 'Pan'], ['Ctrl wheel', 'Zoom']]
        .map(([k, v]) => h('div', h('kbd', k), h('span', v))))], { collapsible: true, open: false }),
  ];
}

// ---------- single object ----------
function objectProps(o) {
  const out = [];
  if (o.type === 'text') {
    const ta = h('textarea.text-input', { rows: 5, value: o.text, placeholder: 'Type your text…', spellcheck: true });
    ta.addEventListener('input', () => { o.text = ta.value; live(); });
    ta.addEventListener('change', done);
    syncers.add(() => { if (ta.isConnected && document.activeElement !== ta) ta.value = o.text; });
    out.push(section('Text', [ta, h('p.muted.small', 'Tab = paragraph indent · ~~crossed out~~ · __underlined__'),
      h('button.btn.small.link', { on: { click: () => startEditing(o.id) } }, 'Edit on the page')]));
    ta.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('\t', ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); } });
    out.push(section('Handwriting', hwControls([o])));
  } else if (o.type === 'shape') {
    out.push(section(o.name || 'Shape', shapeControls([o])));
  } else if (o.type === 'path') {
    out.push(section(o.highlighter ? 'Highlight' : 'Drawing', [
      colorRow('Colour', () => o.stroke, (v, c) => { o.stroke = v; live(); if (c) done(); }, { presets: o.highlighter ? HL : undefined }),
      slider('Width', () => o.strokeWidth, { min: 0.15, max: 8, step: 0.05, unit: 'mm', onInput: (v) => { o.strokeWidth = v; live(); }, onCommit: done }),
    ]));
  } else if (o.type === 'image') {
    out.push(section('Image', [h('p.muted.small', 'Images print exactly as shown. Use PNGs with transparent backgrounds for stickers or diagrams.')]));
  }
  out.push(geometry(o), arrangeSection([o]));
  return out;
}

const HL = [{ name: 'Yellow', color: '#f2df3c' }, { name: 'Green', color: '#8be08b' }, { name: 'Pink', color: '#f59cc9' }, { name: 'Blue', color: '#8ecdf5' }];

function shapeControls(objs) {
  const o0 = objs[0];
  const set = (k) => (v) => { objs.forEach((o) => (o[k] = v)); live(); };
  const isHL = o0.shape === 'highlight';
  return [
    !isHL && colorRow('Stroke', () => o0.stroke, (v, c) => { set('stroke')(v); if (c) done(); }),
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
  if (texts.length) out.push(section(`Handwriting (${texts.length} text)`, hwControls(texts, { full: true })));
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
