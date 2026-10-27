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
import { openPrintPreview, openCalibration, openExamplePrint, exportPDF, exportPNG, saveProjectFile, openProjectFile, openProjectList } from '../print.js';
import { alignButtons, align } from './props.js';
import { openPaperLibrary, libraryView } from './paperstudio.js';
import { getPlan, setPlan, isPro, can, upgradeDialog, proBadge } from '../plan.js';
import { openAutoLayout } from '../layout/autolayout.js';
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
// Left: project + undo/zoom. Centre: the three steps. Right: what the
// current step needs (Continue / Generate / Print) and the plan.
const STEPS = [[1, 'Choose Paper'], [2, 'Add Content'], [3, 'Handwriting & Print']];

export function newProject() {
  const p = S.createProject('filler-wide');
  if (state.project) {
    p.paper = JSON.parse(JSON.stringify(state.project.paper));
    p.writer = JSON.parse(JSON.stringify(state.project.writer));
  }
  S.loadProject(p); // starts at Step 1
}

export function initTopbar() {
  const bar = document.getElementById('topbar');
  const app = document.getElementById('app');
  const name = h('input.proj-name', { type: 'text', title: 'Project name', spellcheck: false });
  name.addEventListener('change', () => { state.project.name = name.value || 'Untitled'; S.commit(); });
  const fileBtn = h('button.text-btn', 'File');
  menu(fileBtn, () => [
    { label: 'New project', run: newProject },
    { label: 'Open…', run: openProjectList },
    { label: 'Open from file…', run: openProjectFile },
    { label: 'Save a copy to file', run: saveProjectFile },
    '-',
    { label: 'Download PDF', run: () => exportPDF() },
    { label: 'Download transparent PNG', run: () => exportPNG() },
    { label: 'Print…', key: 'Ctrl P', run: openPrintPreview },
    '-',
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
  const editTools = h('div.tb-group', h('div.tsep'), tbtn('zoom-out', 'Zoom out (Ctrl+−)', () => setZoom(state.zoom / 1.2)), zoomLbl, tbtn('zoom-in', 'Zoom in (Ctrl+=)', () => setZoom(state.zoom * 1.2)), tbtn('fit', 'Fit page (Ctrl+0)', zoomFit), h('div.tsep'), alignBtn, linesBtn);

  // Floating bar over the canvas while editing the paper on the page.
  const paperBar = h('div.paper-bar',
    h('span', 'Editing paper — drag the first line, spacing line or margins'),
    tbtn('undo', 'Undo (Ctrl+Z)', S.undo),
    tbtn('redo', 'Redo (Ctrl+Shift+Z)', S.redo),
    h('button.btn.small.primary', { on: { click: () => S.setPaperEdit(false) } }, 'Done'));
  app.append(paperBar);
  bus.on('paperEdit', () => {
    paperBar.classList.toggle('show', state.paperEdit);
    if (state.paperEdit) app.classList.remove('no-right');
  });

  const stepper = h('nav.stepper-main', { 'aria-label': 'Steps' });
  const actions = h('div.tb-actions');
  const planBtn = h('button.plan-chip', { title: 'Plan (test mode)' });
  menu(planBtn, () => [
    { label: `${getPlan() === 'pro' ? '✓ ' : ''}Pro`, run: () => setPlan('pro') },
    { label: `${getPlan() === 'basic' ? '✓ ' : ''}Basic`, run: () => setPlan('basic') },
    '-',
    { label: 'Test mode: switches features only. No accounts or payments.', disabled: true, run: () => {} },
  ]);
  const status = h('span.save-status');
  const leftT = tbtn('panel-left', 'Toggle left panel', () => app.classList.toggle('no-left'));
  const rightT = tbtn('panel-right', 'Toggle properties panel', () => app.classList.toggle('no-right'));

  bar.append(
    h('div.brand', icon('feather', 20)),
    name, fileBtn,
    h('div.tsep'), undo, redo,
    editTools,
    h('div.grow'),
    stepper,
    h('div.grow'),
    status,
    actions,
    planBtn,
    h('div.tb-group.panel-toggles', h('div.tsep'), leftT, rightT),
  );

  const renderStepper = () => {
    const cur = state.project.step;
    stepper.replaceChildren(...STEPS.flatMap(([n, label], i) => [
      i ? h('span.step-arrow', '→') : null,
      h('button.step-tab' + (n === cur ? '.on' : '') + (n < cur ? '.done' : ''), { on: { click: () => S.setStep(n) } }, h('b', String(n)), h('span.tb-lbl2', label)),
    ]).filter(Boolean));
  };

  const renderActions = () => {
    const step = state.project.step;
    app.classList.remove('step-1', 'step-2', 'step-3');
    app.classList.add('step-' + step);
    editTools.hidden = step === 1;
    alignBtn.hidden = linesBtn.hidden = step !== 2;
    if (step === 1) {
      actions.replaceChildren(h('button.btn.primary', { on: { click: () => S.setStep(2) } }, 'Continue to Editor →'));
    } else if (step === 2) {
      actions.replaceChildren(
        h('button.btn.al-btn', { title: 'AI Auto-Layout: paste text or upload images and let it organize your pages', on: { click: () => (can('aiLayout') ? openAutoLayout() : upgradeDialog('aiLayout')) } }, icon('feather', 15), 'AI Auto-Layout', !isPro() && proBadge()),
        h('button.btn.primary', { on: { click: () => S.setStep(3) } }, 'Continue to Handwriting →'));
    } else {
      const hwStage = state.project.stage === 'handwriting';
      const stale = S.staleCount();
      actions.replaceChildren(...[
        hwStage
          ? stale && h('button.btn.accent-ghost', { title: 'Text changed since it was generated', on: { click: () => S.generateHandwriting() } }, `Regenerate changed (${stale})`)
          : h('button.btn.generate', { title: 'Turn all text into handwriting', on: { click: () => S.generateHandwriting() } }, icon('feather', 15), 'Generate Handwriting'),
        hwStage && h('button.btn.ghost', { title: 'Show plain text again (handwriting settings are kept)', on: { click: S.backToEditing } }, 'Show typed text'),
        h('button.text-btn', { title: 'Print a sample page to test alignment on your paper', on: { click: openExamplePrint } }, 'Example Print'),
        h('button.btn.primary.print-btn', { title: 'Print or download (Ctrl+P)', on: { click: openPrintPreview } }, icon('printer', 16), 'Print'),
      ].filter(Boolean));
    }
    planBtn.replaceChildren(isPro() ? h('span.pro-badge', 'PRO') : h('span.basic-badge', 'BASIC'), h('span.plan-note', 'test'));
  };

  const upd = () => {
    if (!state.project) return;
    if (document.activeElement !== name) name.value = state.project.name;
    undo.disabled = !S.canUndo();
    redo.disabled = !S.canRedo();
    linesBtn.classList.toggle('on', !!state.project.view.overlay);
    renderStepper();
    renderActions();
  };
  for (const ev of ['history', 'project', 'step', 'stage', 'plan']) bus.on(ev, upd);
  bus.on('zoom', () => (zoomLbl.textContent = Math.round(state.zoom * 100) + '%'));
  bus.on('saved', () => {
    status.textContent = { saved: 'Saved', saving: 'Saving…', error: 'Not saved' }[state.saveStatus];
    status.className = 'save-status ' + state.saveStatus;
  });
  upd();
}

// ---------- Step 1 screen: the paper library ----------
export function initStepView() {
  const view = document.getElementById('stepview');
  const render = () => {
    if (state.project?.step !== 1) { view.replaceChildren(); return; }
    view.replaceChildren(h('div.step1',
      h('div.step1-head', h('h1', 'Choose your paper'), h('p.muted', 'Pick the notebook paper you will print on, or create one that matches it exactly.')),
      libraryView({ embedded: true })));
  };
  for (const ev of ['step', 'project', 'styles']) bus.on(ev, render);
  bus.on('change', () => { if (state.project?.step === 1) render(); });
  render();
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
  // Step 2 is for content, Step 3 for handwriting: each shows its own tools.
  const TABS_FOR = { 1: [], 2: ['insert', 'pages', 'layers'], 3: ['hand', 'pages'] };
  const upd = () => {
    const allowed = TABS_FOR[state.project?.step || 2];
    btns.forEach((b) => {
      b.hidden = !allowed.includes(b.dataset.tab);
      b.classList.toggle('on', b.dataset.tab === tab && !app.classList.contains('no-left'));
    });
  };
  bus.on('step', () => {
    const allowed = TABS_FOR[state.project.step];
    if (allowed.length && !allowed.includes(tab)) tab = allowed[0];
    upd();
    renderPanel();
  });
  bus.on('plan', () => renderPanel());
  rail.append(...btns);
  upd();
  renderPanel();
  const re = debounce(() => { if (tab === 'pages' || tab === 'layers') renderPanel(); }, 250);
  bus.on('change', re);
  bus.on('page', renderPanel);
  bus.on('selection', () => { if (tab === 'layers' || tab === 'hand') renderPanel(); });
  bus.on('tool', () => { if (tab === 'insert') renderPanel(); });
  bus.on('styles', () => { if (tab === 'hand') renderPanel(); });
  bus.on('project', () => { bus.emit('step'); });
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
    h('button.btn.block.al-cta', { title: 'Paste text or add images and have it arranged across the pages', on: { click: () => (can('aiLayout') ? openAutoLayout() : upgradeDialog('aiLayout')) } }, icon('feather', 16), 'AI Auto-Layout…', !isPro() && proBadge()),
    h('p.muted.small', 'Typed text uses an Arial-style font. You’ll choose handwriting in Step 3.'),
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

// Pro with text selected: style just that text. Otherwise: the whole document.
function applyStyle(id) {
  const st = PRESET_STYLES.find((s) => s.id === id);
  if ((st?.premium || !st) && !can('premiumStyles')) return upgradeDialog(st ? 'premiumStyles' : 'customHandwriting');
  const texts = can('perElement') ? S.selected().filter((o) => o.type === 'text') : [];
  if (texts.length) texts.forEach((o) => { o.hw.style = id; o.hw.custom = true; });
  else applyDocumentSetting({ style: id });
  S.commit();
  renderPanel();
}

// Document-wide handwriting change: new text plus every text box that hasn't
// been given its own style (Pro per-element styles are left alone).
export function applyDocumentSetting(patch) {
  Object.assign(state.project.writer.defaults, patch);
  for (const pg of state.project.pages) for (const o of pg.objects) if (o.type === 'text' && !o.hw.custom) Object.assign(o.hw, patch);
}

function handPanel() {
  const texts = can('perElement') ? S.selected().filter((o) => o.type === 'text') : [];
  const current = texts[0]?.hw.style || state.project.writer.defaults.style;
  const locked = (st) => (st.premium || !st.font) && !can('premiumStyles');
  const card = (st, mine) => h('div.style-card' + (st.id === current ? '.on' : '') + (locked(st) ? '.locked' : ''),
    h('button.style-main', { title: locked(st) ? 'Pro style' : texts.length ? 'Apply to selected text' : 'Use for the whole document', on: { click: () => applyStyle(st.id) } },
      stylePreview(st), h('span.style-name', st.name, locked(st) && proBadge())),
    mine && h('div.style-actions',
      st.kind === 'glyphs' && st.glyphs && !Object.values(st.glyphs).some((v) => v.some((g) => g.mode === 'fill')) && h('button.icon-btn.tiny', { title: 'Edit letters', on: { click: () => openDrawStudio(st.id) } }, icon('pen', 14)),
      h('button.icon-btn.tiny', { title: 'Delete style', on: { click: async () => { if (await confirmDialog(`Delete “${st.name}”? Text using it falls back to Ballpoint.`)) deleteCustomStyle(st.id); } } }, icon('trash', 14))));
  const groups = [['neat', 'Neat'], ['casual', 'Casual'], ['rushed', 'Rushed'], ['cursive', 'Cursive']];
  const pro = (fn) => () => (can('customHandwriting') ? fn() : upgradeDialog('customHandwriting'));
  return h('div.lp',
    h('p.muted.small', texts.length ? `Click a style to apply it to ${texts.length > 1 ? texts.length + ' text boxes' : 'the selected text'}.` : 'Click a style to use it for the whole document.' + (can('perElement') ? ' Select a text box first to style just that box.' : '')),
    ...groups.flatMap(([k, l]) => [h('h3', l), h('div.style-list', ...PRESET_STYLES.filter((s) => s.category === k).map((s) => card(s)))]),
    h('h3', 'Your handwriting ', !can('customHandwriting') && proBadge()),
    h('div.style-list', ...customStyles().map((s) => card(s, true))),
    h('div.btn-col' + (can('customHandwriting') ? '' : '.locked'),
      h('button.btn.block', { on: { click: pro(() => openDrawStudio()) } }, icon('pen', 16), 'Draw your letters'),
      h('button.btn.block', { on: { click: pro(openScanStudio) } }, icon('grid', 16), 'Scan a sample sheet'),
      h('button.btn.block', { on: { click: pro(uploadFontStyle) } }, icon('upload', 16), 'Upload a handwriting font')),
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
