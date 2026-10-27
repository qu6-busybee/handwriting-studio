// Top bar, left tool rail and left panels (Insert, Handwriting, Pages, Layers).
import { h, svg, debounce, pickFile, readFile } from '../util.js';
import { icon } from './icons.js';
import * as S from '../state.js';
import { setZoom, zoomFit, insertItem, insertImage } from '../editor/canvas.js';
import { pageContent, inkDefs } from '../editor/render.js';
import { paperOverlay } from '../paper.js';
import { layoutText } from '../handwriting/engine.js';
import { PRESET_STYLES, customStyles, ensureProvider, deleteCustomStyle } from '../handwriting/styles.js';
import { openDrawStudio, openScanStudio, uploadFontStyle } from '../handwriting/capture.js';
import { openPrintPreview, openCalibration, openExamplePrint, exportPDF, exportPNG, saveProjectFile, openProjectFile, openProjectList, openNewProject } from '../print.js';
import { alignButtons, align } from './props.js';
import { confirmDialog } from './modal.js';

const { state, bus } = S;

// ---------- menus ----------
let openMenu = null;
function menu(btn, items) {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openMenu) { const was = openMenu.btn === btn; closeMenu(); if (was) return; }
    const m = h('div.menu', ...items().map((it) => (it === '-' ? h('div.menu-sep') : h('button.menu-item', { disabled: it.disabled, on: { click: () => { closeMenu(); it.run(); } } }, h('span', it.label), it.key && h('kbd', it.key)))));
    const r = btn.getBoundingClientRect();
    Object.assign(m.style, { left: r.left + 'px', top: r.bottom + 4 + 'px' });
    document.body.append(m);
    openMenu = { el: m, btn };
  });
}
function closeMenu() { openMenu?.el.remove(); openMenu = null; }
document.addEventListener('pointerdown', (e) => { if (openMenu && !openMenu.el.contains(e.target) && e.target !== openMenu.btn) closeMenu(); });

const tbtn = (name, title, onClick) => h('button.icon-btn', { title, 'aria-label': title, on: { click: onClick } }, icon(name));

// ---------- top bar ----------
export function initTopbar() {
  const bar = document.getElementById('topbar');
  const name = h('input.proj-name', { type: 'text', title: 'Project name', spellcheck: false });
  name.addEventListener('change', () => { state.project.name = name.value || 'Untitled'; S.commit(); });
  const fileBtn = h('button.text-btn', 'File');
  menu(fileBtn, () => [
    { label: 'New project…', run: openNewProject },
    { label: 'Open…', run: openProjectList },
    { label: 'Open from file…', run: openProjectFile },
    { label: 'Save a copy to file', run: saveProjectFile },
    '-',
    { label: 'Download PDF', run: () => exportPDF() },
    { label: 'Download transparent PNG', run: () => exportPNG() },
    '-',
    { label: 'Print…', key: 'Ctrl P', run: openPrintPreview },
    { label: 'Example print…', run: openExamplePrint },
    { label: 'Paper & printer calibration…', run: openCalibration },
  ]);
  const undo = tbtn('undo', 'Undo (Ctrl+Z)', S.undo);
  const redo = tbtn('redo', 'Redo (Ctrl+Shift+Z)', S.redo);
  const zoomLbl = h('button.text-btn.zoom-lbl', { title: 'Zoom options' });
  menu(zoomLbl, () => [
    { label: 'Fit page', key: 'Ctrl 0', run: zoomFit },
    ...[0.5, 1, 1.5, 2, 3].map((z) => ({ label: `${z * 100}%`, run: () => setZoom(z) })),
  ]);
  const alignBtn = h('button.icon-btn', { title: 'Align & distribute' }, icon('align-left'));
  menu(alignBtn, () => {
    const n = state.selection.size;
    return [
      ...[['left', 'Align left'], ['center', 'Align centre'], ['right', 'Align right'], ['top', 'Align top'], ['middle', 'Align middle'], ['bottom', 'Align bottom']].map(([k, l]) => ({ label: l, disabled: !n, run: () => align(k) })),
      '-',
      { label: 'Distribute horizontally', disabled: n < 3, run: () => align('dist-h') },
      { label: 'Distribute vertically', disabled: n < 3, run: () => align('dist-v') },
    ];
  });
  const linesBtn = tbtn('ruled', 'Show / hide notebook lines (never printed)', () => { state.project.view.overlay = !state.project.view.overlay; S.commit(); });
  const paperBtn = h('button.text-btn.paper-btn', { title: 'Paper settings: size, lines, margins (edit on the page)', on: { click: () => S.setPaperEdit(!state.paperEdit) } }, icon('grid', 16), 'Paper');

  // Floating bar over the canvas while editing the paper.
  const paperBar = h('div.paper-bar',
    h('span', 'Editing paper — drag the first line, spacing line or margin'),
    tbtn('undo', 'Undo (Ctrl+Z)', S.undo),
    tbtn('redo', 'Redo (Ctrl+Shift+Z)', S.redo),
    h('button.btn.small.primary', { on: { click: () => S.setPaperEdit(false) } }, 'Done'));
  document.getElementById('app').append(paperBar);
  bus.on('paperEdit', () => {
    paperBar.classList.toggle('show', state.paperEdit);
    paperBtn.classList.toggle('on', state.paperEdit);
    if (state.paperEdit) document.getElementById('app').classList.remove('no-right');
  });
  const status = h('span.save-status');
  const leftT = tbtn('panel-left', 'Toggle left panel', () => document.getElementById('app').classList.toggle('no-left'));
  const rightT = tbtn('panel-right', 'Toggle properties panel', () => document.getElementById('app').classList.toggle('no-right'));

  // Two-stage workflow: edit in plain text, then approve with "Generate Handwriting".
  const stageBox = h('div.stage-box');
  const stageChip = h('span.stage-chip');
  const updStage = () => {
    const hwStage = state.project.stage === 'handwriting';
    const stale = S.staleCount();
    stageChip.textContent = hwStage ? 'Handwriting' : 'Editing';
    stageChip.className = 'stage-chip ' + (hwStage ? 'hw' : 'edit');
    stageChip.title = hwStage ? 'Showing generated handwriting' : 'Plain text while you arrange the page — nothing is handwritten yet';
    stageBox.replaceChildren(stageChip, ...(hwStage
      ? [
        stale && h('button.btn.accent-ghost', { title: 'Text changed since it was generated', on: { click: () => S.generateHandwriting() } }, icon('feather', 15), `Regenerate changed (${stale})`),
        h('button.btn.ghost', { title: 'Return to plain-text editing (your handwriting settings are kept)', on: { click: S.backToEditing } }, 'Back to editing'),
      ]
      : [h('button.btn.generate', { title: 'Approve the layout and turn all text into handwriting', on: { click: () => S.generateHandwriting() } }, icon('feather', 15), 'Generate Handwriting')]
    ).filter(Boolean));
  };

  bar.append(
    h('div.brand', icon('feather', 20)),
    name, fileBtn,
    h('div.tsep'), undo, redo,
    h('div.tsep'), tbtn('zoom-out', 'Zoom out (Ctrl+−)', () => setZoom(state.zoom / 1.2)), zoomLbl, tbtn('zoom-in', 'Zoom in (Ctrl+=)', () => setZoom(state.zoom * 1.2)), tbtn('fit', 'Fit page (Ctrl+0)', zoomFit),
    h('div.tsep'), alignBtn, linesBtn, paperBtn,
    h('div.grow'),
    stageBox,
    h('div.grow'),
    status,
    tbtn('calibrate', 'Paper & printer calibration', openCalibration),
    h('button.text-btn', { title: 'Print a sample page to test alignment on your paper', on: { click: openExamplePrint } }, 'Example Print'),
    h('button.btn.primary.print-btn', { title: 'Print preview (Ctrl+P)', on: { click: openPrintPreview } }, icon('printer', 16), 'Print'),
    h('div.tsep'), leftT, rightT,
  );

  const upd = () => {
    if (!state.project) return;
    if (document.activeElement !== name) name.value = state.project.name;
    undo.disabled = !S.canUndo();
    redo.disabled = !S.canRedo();
    linesBtn.classList.toggle('on', !!state.project.view.overlay);
    updStage();
  };
  bus.on('history', upd);
  bus.on('project', upd);
  bus.on('zoom', () => (zoomLbl.textContent = Math.round(state.zoom * 100) + '%'));
  bus.on('saved', () => {
    status.textContent = { saved: 'Saved', saving: 'Saving…', error: 'Not saved' }[state.saveStatus];
    status.className = 'save-status ' + state.saveStatus;
  });
  upd();
}

// ---------- left rail + panels ----------
const TABS = [
  ['insert', 'plus', 'Insert'],
  ['hand', 'feather', 'Handwriting'],
  ['pages', 'pages', 'Pages'],
  ['layers', 'layers', 'Layers'],
];
let tab = 'insert';
let panel;

export function initLeft() {
  const rail = document.getElementById('rail');
  panel = document.getElementById('leftpanel');
  const app = document.getElementById('app');
  const btns = TABS.map(([id, ic, label]) => {
    const b = h('button.rail-btn', { title: label, 'aria-label': label, on: { click: () => {
      if (tab === id && !app.classList.contains('no-left')) app.classList.add('no-left');
      else { app.classList.remove('no-left'); tab = id; renderPanel(); }
      upd();
    } } }, icon(ic, 20), h('span', label));
    b.dataset.tab = id;
    return b;
  });
  const upd = () => btns.forEach((b) => b.classList.toggle('on', b.dataset.tab === tab && !app.classList.contains('no-left')));
  rail.append(...btns);
  upd();
  renderPanel();
  const re = debounce(() => { if (tab === 'pages' || tab === 'layers') renderPanel(); }, 250);
  bus.on('change', re);
  bus.on('page', renderPanel);
  bus.on('selection', () => { if (tab === 'layers' || tab === 'hand') renderPanel(); });
  bus.on('tool', () => { if (tab === 'insert') renderPanel(); });
  bus.on('styles', () => { if (tab === 'hand') renderPanel(); });
  bus.on('project', renderPanel);
}

function renderPanel() {
  if (!state.project) return;
  const fn = { insert: insertPanel, hand: handPanel, pages: pagesPanel, layers: layersPanel }[tab];
  panel.replaceChildren(fn());
}

function tile(kind, ic, label, extra = {}) {
  return h('button.tile', {
    draggable: true,
    title: extra.title || `${label} — click to add, or drag onto the page`,
    on: {
      click: () => insertItem(kind),
      dragstart: (e) => { e.dataTransfer.setData('application/x-hws', kind); e.dataTransfer.effectAllowed = 'copy'; },
    },
  }, icon(ic, 20), h('span', label));
}

function toolBtn(tool, ic, label, key) {
  return h('button.tile' + (state.tool === tool ? '.on' : ''), { title: `${label} (${key})`, on: { click: () => S.setTool(state.tool === tool ? 'select' : tool) } }, icon(ic, 20), h('span', label));
}

function insertPanel() {
  return h('div.lp',
    h('h3', 'Text'),
    h('div.tiles',
      tile('text', 'type', 'Text box', { title: 'A text box spanning the writing area' }),
      tile('text-heading', 'type', 'Heading'),
      tile('text-word', 'type', 'Word')),
    h('h3', 'Draw'),
    h('div.tiles',
      toolBtn('select', 'cursor', 'Select', 'V'),
      toolBtn('text', 'type', 'Text tool', 'T'),
      toolBtn('pen', 'pen', 'Pen', 'P'),
      toolBtn('highlighter', 'highlight', 'Highlighter', 'H')),
    h('h3', 'Shapes & marks'),
    h('div.tiles',
      ...[['rect', 'rect', 'Box'], ['ellipse', 'ellipse', 'Circle'], ['triangle', 'triangle', 'Triangle'], ['line', 'line', 'Line'], ['arrow', 'arrow', 'Arrow'], ['double-arrow', 'double-arrow', 'Two-way'],
        ['star', 'star', 'Star'], ['check', 'check', 'Check'], ['cross', 'cross', 'Cross'], ['underline', 'underline', 'Squiggle'], ['bracket', 'bracket', 'Brace'], ['highlight', 'highlight', 'Highlight']]
        .map(([k, ic, l]) => tile(k, ic, l))),
    h('h3', 'Media'),
    h('div.tiles', h('button.tile', { title: 'Insert an image (or paste / drop one on the page)', on: { click: async () => { const f = await pickFile('image/*'); if (f) insertImage(await readFile(f)); } } }, icon('image', 20), h('span', 'Image'))),
  );
}

// ---------- handwriting styles ----------
const SAMPLE = 'The quick brown fox';
function stylePreview(style) {
  const s = svg('svg', { viewBox: '0 0 62 11', class: 'style-preview' });
  const draw = () => {
    const o = { id: 'preview-' + style.id, text: SAMPLE, w: 200, hw: { ...state.project.writer.defaults, style: style.id, size: 2.6, seed: 7, followLines: false, lineSpacing: 9, texture: false, mistakes: 0 } };
    const lay = layoutText(o, { writerSeed: state.project.writer.seed, paper: state.project.paper });
    if (!lay) return false;
    s.replaceChildren(...lay.paths.flatMap((p) => [
      p.fill && svg('path', { d: p.fill, fill: 'currentColor' }),
      p.stroke && svg('path', { d: p.stroke, fill: 'none', stroke: 'currentColor', 'stroke-width': 0.35, 'stroke-linecap': 'round' }),
    ].filter(Boolean)));
    return true;
  };
  if (!draw()) ensureProvider(style.id).then(draw).catch(() => {});
  return s;
}

function applyStyle(id) {
  const texts = S.selected().filter((o) => o.type === 'text');
  if (texts.length) texts.forEach((o) => (o.hw.style = id));
  else state.project.writer.defaults.style = id;
  S.commit();
  renderPanel();
}

function handPanel() {
  const texts = S.selected().filter((o) => o.type === 'text');
  const current = texts[0]?.hw.style || state.project.writer.defaults.style;
  const card = (st, mine) => h('div.style-card' + (st.id === current ? '.on' : ''),
    h('button.style-main', { title: texts.length ? 'Apply to selected text' : 'Use for new text', on: { click: () => applyStyle(st.id) } },
      stylePreview(st), h('span.style-name', st.name)),
    mine && h('div.style-actions',
      st.kind === 'glyphs' && st.glyphs && !Object.values(st.glyphs).some((v) => v.some((g) => g.mode === 'fill')) && h('button.icon-btn.tiny', { title: 'Edit letters', on: { click: () => openDrawStudio(st.id) } }, icon('pen', 14)),
      h('button.icon-btn.tiny', { title: 'Delete style', on: { click: async () => { if (await confirmDialog(`Delete “${st.name}”? Text using it falls back to Ballpoint.`)) deleteCustomStyle(st.id); } } }, icon('trash', 14))));
  const groups = [['neat', 'Neat'], ['casual', 'Casual'], ['rushed', 'Rushed'], ['cursive', 'Cursive']];
  return h('div.lp',
    h('p.muted.small', texts.length ? `Click a style to apply it to ${texts.length > 1 ? texts.length + ' text boxes' : 'the selected text'}.` : 'Click a style to use it for new text. Select text first to change it.'),
    ...groups.flatMap(([k, l]) => [h('h3', l), h('div.style-list', ...PRESET_STYLES.filter((s) => s.category === k).map((s) => card(s)))]),
    h('h3', 'Your handwriting'),
    h('div.style-list', ...customStyles().map((s) => card(s, true))),
    h('div.btn-col',
      h('button.btn.block', { on: { click: () => openDrawStudio() } }, icon('pen', 16), 'Draw your letters'),
      h('button.btn.block', { on: { click: openScanStudio } }, icon('grid', 16), 'Scan a sample sheet'),
      h('button.btn.block', { on: { click: uploadFontStyle } }, icon('upload', 16), 'Upload a handwriting font')),
  );
}

// ---------- pages ----------
function thumb(pg) {
  const p = state.project.paper;
  const s = svg('svg', { viewBox: `0 0 ${p.w} ${p.h}`, class: 'thumb-svg' });
  s.append(inkDefs(), paperOverlay(p), pageContent(pg, { project: state.project, editor: false }));
  s.querySelectorAll('[filter]').forEach((e) => e.removeAttribute('filter'));
  return s;
}

function pagesPanel() {
  const pages = state.project.pages;
  return h('div.lp',
    h('div.lp-head', h('h3', `Pages (${pages.length})`), h('button.btn.small', { on: { click: () => S.addPage() } }, icon('plus', 14), 'Add')),
    h('div.page-list', ...pages.map((pg, i) => h('div.page-item' + (i === state.pageIndex ? '.on' : ''),
      h('button.page-thumb', { title: `Go to page ${i + 1}`, on: { click: () => S.setPage(i) } }, thumb(pg)),
      h('div.page-meta',
        h('span', String(i + 1)),
        h('div.page-actions',
          h('button.icon-btn.tiny', { title: 'Move up', disabled: i === 0, on: { click: () => S.movePage(i, -1) } }, icon('up', 14)),
          h('button.icon-btn.tiny', { title: 'Move down', disabled: i === pages.length - 1, on: { click: () => S.movePage(i, 1) } }, icon('down', 14)),
          h('button.icon-btn.tiny', { title: 'Duplicate page', on: { click: () => S.duplicatePage(i) } }, icon('copy', 14)),
          h('button.icon-btn.tiny', { title: 'Delete page', on: { click: async () => { if (!pages[i].objects.length || (await confirmDialog(`Delete page ${i + 1}?`))) S.deletePage(i); } } }, icon('trash', 14)))))),
    ));
}

// ---------- layers ----------
function describe(o) {
  if (o.type === 'text') return (o.text || '').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Empty text';
  return o.name || o.type;
}
function layersPanel() {
  const objs = [...state.project.pages[state.pageIndex].objects].reverse();
  const ic = { text: 'type', shape: 'rect', path: 'pen', image: 'image' };
  return h('div.lp',
    h('h3', 'Layers'),
    !objs.length && h('p.muted.small', 'Nothing on this page yet.'),
    h('div.layer-list', ...objs.map((o) => h('div.layer' + (state.selection.has(o.id) ? '.on' : '') + (o.hidden ? '.dim' : ''),
      h('button.layer-main', { on: { click: (e) => {
        if (e.shiftKey || e.ctrlKey) { const s = new Set(state.selection); s.has(o.id) ? s.delete(o.id) : s.add(o.id); S.setSelection(s, { expand: false }); }
        else S.setSelection([o.id]);
      } } }, icon(o.type === 'shape' ? o.shape : ic[o.type], 15), h('span', describe(o)), o.groupId && h('span.badge', 'group')),
      h('button.icon-btn.tiny', { title: o.hidden ? 'Show' : 'Hide', on: { click: () => { o.hidden = !o.hidden; S.commit(); } } }, icon(o.hidden ? 'eye-off' : 'eye', 14)),
      h('button.icon-btn.tiny', { title: o.locked ? 'Unlock' : 'Lock', on: { click: () => { o.locked = !o.locked; S.commit(); } } }, icon(o.locked ? 'lock' : 'unlock', 14))))),
    state.selection.size > 0 && h('div', h('h3', 'Align'), alignButtons()),
  );
}
