// Paper workflow: Library → Create/Select → Customize → Review & Save → Use.
//  1. openPaperLibrary(): saved presets + starting templates, with
//     select / edit / duplicate / rename / delete and "+ Create New Paper".
//  2. openPaperStudio(): large live preview with draggable lines and a
//     compact settings panel. The draft auto-saves so nothing is lost.
//  3. Review: the exact paper plus a summary, then Save Preset or Save & Use.
import { h, svg, toast, clamp } from '../util.js';
import * as S from '../state.js';
import {
  PAPER_PRESETS, userPresets, paperFromPreset, applyPreset, saveUserPreset, updateUserPreset, renameUserPreset,
  duplicatePreset, deleteUserPreset, paperOverlay, normalizePaper, rulingLines, lineCount, lineAt, tiltAt, bottomGap, writingBox, paperLabel,
} from '../paper.js';
import { rulingName, sizeName } from '../units.js';
import { openModal, confirmDialog } from './modal.js';
import { paperSections, lineSel } from './paperpanel.js';
import { commitPaper } from '../paperedit.js';
import { fmtLen, getUnit, syncAll, syncers } from './controls.js';
import { icon } from './icons.js';

const { state } = S;
const DRAFT_KEY = 'hws.paperDraft';
const clone = (o) => JSON.parse(JSON.stringify(o));
const loadDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; } };
const saveDraft = (d) => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* storage full or blocked */ } };
const clearDraft = () => localStorage.removeItem(DRAFT_KEY);

function thumb(paper) {
  const p = normalizePaper(clone(paper));
  const s = svg('svg', { viewBox: `0 0 ${p.w} ${p.h}`, class: 'paper-thumb' });
  s.append(paperOverlay(p));
  return s;
}

// Apply a preset to the current project, or start a new project with it.
function usePreset(id, forNewProject) {
  if (forNewProject) {
    const p = S.createProject(id);
    if (state.project) p.writer = clone(state.project.writer);
    S.loadProject(p);
  } else {
    commitPaper((pp) => applyPreset(pp, id));
  }
  const pr = [...PAPER_PRESETS, ...userPresets()].find((x) => x.id === id);
  toast(`Using “${pr?.name || 'paper'}”`);
}

// ---------- Step 1: library ----------
export function openPaperLibrary({ forNewProject = false } = {}) {
  const m = openModal(forNewProject ? 'New project · Choose your paper' : 'Paper library', { wide: true });
  m.el.classList.add('library');
  const currentId = state.project?.paper.presetId;

  const card = (pr, mine) => {
    const isCurrent = !forNewProject && pr.id === currentId;
    const paper = pr.paper || paperFromPreset(pr.id);
    const use = () => { m.close(); usePreset(pr.id, forNewProject); };
    return h('div.pcard' + (isCurrent ? '.current' : ''),
      h('button.pcard-preview', { title: 'Use this paper', on: { click: use } }, thumb(paper)),
      h('div.pcard-info',
        h('strong', pr.name),
        h('span', sizeName(paper.w, paper.h)),
        h('span.muted', rulingName(paper.spacing)),
        isCurrent && h('span.badge.on', 'In use')),
      h('div.pcard-actions',
        h('button.btn.small.primary', { title: isCurrent ? 'Apply again (resets any on-page tweaks)' : 'Use this paper', on: { click: use } }, 'Use'),
        mine
          ? h('button.icon-btn.tiny', { title: 'Edit', on: { click: () => { m.close(); openPaperStudio({ paper: pr.paper, name: pr.name, editingId: pr.id, forNewProject }); } } }, icon('pen', 14))
          : h('button.icon-btn.tiny', { title: 'Customize (creates your own copy)', on: { click: () => { m.close(); openPaperStudio({ paper: paperFromPreset(pr.id), name: `My ${pr.name}`, forNewProject }); } } }, icon('pen', 14)),
        h('button.icon-btn.tiny', { title: 'Duplicate', on: { click: () => { duplicatePreset(pr.id); render(); } } }, icon('copy', 14)),
        mine && h('button.icon-btn.tiny', { title: 'Rename', on: { click: () => renameDialog(pr, render) } }, icon('type', 14)),
        mine && h('button.icon-btn.tiny.danger', { title: 'Delete', on: { click: async () => { if (await confirmDialog(`Delete the paper preset “${pr.name}”? Projects already using it keep their paper.`)) { deleteUserPreset(pr.id); render(); } } } }, icon('trash', 14))));
  };

  const body = h('div');
  const render = () => {
    const mine = userPresets().sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const draft = loadDraft();
    body.replaceChildren(...[
      h('div.lib-head',
        h('p.muted', forNewProject ? 'Pick the paper you will print on. You can change it later.' : 'Pick a paper for this project, or create one that matches your notebook exactly.'),
        h('button.btn.primary', { on: { click: () => {
          m.close();
          const base = state.project && !forNewProject ? state.project.paper : paperFromPreset('filler-wide');
          openPaperStudio({ paper: base, name: 'My paper', forNewProject });
        } } }, '+ Create New Paper')),
      draft && h('div.draft-banner',
        h('span', 'Unsaved paper: ', h('b', draft.name || 'My paper')),
        h('button.btn.small', { on: { click: () => { m.close(); openPaperStudio({ ...draft, resume: true }); } } }, 'Resume'),
        h('button.btn.small.ghost', { on: { click: () => { clearDraft(); render(); } } }, 'Discard')),
      forNewProject && state.project && h('div.draft-banner',
        h('span', 'Same paper as the current project: ', h('b', paperLabel(state.project.paper))),
        h('button.btn.small.primary', { on: { click: () => {
          m.close();
          const p = S.createProject('filler-wide');
          p.paper = clone(state.project.paper);
          p.writer = clone(state.project.writer);
          S.loadProject(p);
        } } }, 'Use')),
      h('h3', 'Your papers'),
      mine.length
        ? h('div.pgrid', ...mine.map((pr) => card(pr, true)))
        : h('p.muted.small.empty', 'No saved papers yet. Create one, or customize a template below.'),
      h('h3', 'Starting templates'),
      h('div.pgrid', ...PAPER_PRESETS.map((pr) => card(pr, false))),
    ].filter((x) => x != null && x !== false));
  };
  render();
  m.body.append(body);
  if (!forNewProject && state.project) {
    m.foot.append(
      h('span.muted.small.grow', 'Need a quick tweak? Adjust this project’s paper directly on the page.'),
      h('button.btn', { on: { click: () => { m.close(); S.setPaperEdit(true); } } }, 'Adjust on page'));
  }
}

function renameDialog(pr, done) {
  const m = openModal('Rename paper');
  const inp = h('input', { type: 'text', value: pr.name });
  const ok = () => { const v = inp.value.trim(); if (!v) return; renameUserPreset(pr.id, v); m.close(); done(); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
  m.body.append(h('label.field', h('span', 'Name'), inp));
  m.foot.append(h('button.btn', { on: { click: m.close } }, 'Cancel'), h('button.btn.primary', { on: { click: ok } }, 'Rename'));
  setTimeout(() => inp.select(), 0);
}

// ---------- Steps 2 & 3: studio ----------
export function openPaperStudio({ paper, name = 'My paper', editingId = null, forNewProject = false }) {
  const draft = { paper: normalizePaper(clone(paper)), name, editingId, forNewProject };
  delete draft.paper.presetId;
  let step = 'edit';
  let zoom = 1;
  const past = [], future = [];
  let pending = null;

  const m = openModal(editingId ? `Edit paper · ${name}` : 'Create new paper', { wide: true });
  m.el.classList.add('studio');
  const stage = h('div.studio-stage');
  const side = h('div.studio-side');
  const steps = h('div.stepper');
  m.body.classList.add('studio-body');
  m.body.append(h('div.studio-main', steps, stage), side);

  const persist = () => saveDraft(draft);
  const begin = () => { if (!pending) pending = JSON.stringify(draft.paper); };
  const finish = () => {
    const now = JSON.stringify(draft.paper);
    if (pending && pending !== now) { past.push(pending); future.length = 0; }
    pending = null;
  };
  const t = {
    paper: () => draft.paper,
    live: (fn) => { begin(); fn(draft.paper); normalizePaper(draft.paper); drawPreview(); persist(); },
    commit: (fn) => { if (fn) { begin(); fn(draft.paper); normalizePaper(draft.paper); } finish(); drawPreview(); persist(); syncAll(); },
    rebuild: () => renderSide(),
  };
  const undo = () => { if (!past.length) return; future.push(JSON.stringify(draft.paper)); draft.paper = JSON.parse(past.pop()); renderAll(); persist(); };
  const redo = () => { if (!future.length) return; past.push(JSON.stringify(draft.paper)); draft.paper = JSON.parse(future.pop()); renderAll(); persist(); };

  const keys = (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.target.tagName === 'INPUT') return;
    if (e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); e.shiftKey ? redo() : undo(); }
    if (e.key.toLowerCase() === 'y') { e.preventDefault(); e.stopPropagation(); redo(); }
  };
  m.el.addEventListener('keydown', keys, true);
  m.el.tabIndex = -1;

  function renderSteps() {
    const item = (k, label, n) => h('span.step-pill' + (step === k ? '.on' : ''), h('b', n), label);
    steps.replaceChildren(
      h('button.step-pill.link', { on: { click: () => { m.close(); openPaperLibrary({ forNewProject }); } } }, h('b', '1'), 'Library'),
      h('span.step-sep', '›'), item('edit', 'Customize', '2'),
      h('span.step-sep', '›'), item('review', 'Review & save', '3'),
      h('span.grow'),
      h('button.icon-btn', { title: 'Zoom out', on: { click: () => { zoom = clamp(zoom / 1.25, 0.6, 4); drawPreview(); } } }, icon('zoom-out', 16)),
      h('button.icon-btn', { title: 'Fit', on: { click: () => { zoom = 1; drawPreview(); } } }, icon('fit', 16)),
      h('button.icon-btn', { title: 'Zoom in', on: { click: () => { zoom = clamp(zoom * 1.25, 0.6, 4); drawPreview(); } } }, icon('zoom-in', 16)));
  }

  function renderSide() {
    syncers.clear();
    if (step === 'edit') {
      side.replaceChildren(h('div.props', ...paperSections(t, { open: { individual: lineSel.open } })));
      m.foot.replaceChildren(
        h('button.btn.ghost', { title: 'Throw away this draft', on: { click: async () => { if (await confirmDialog('Discard this unsaved paper?', 'Discard')) { clearDraft(); m.close(); openPaperLibrary({ forNewProject }); } } } }, 'Discard'),
        h('span.grow.muted.small', 'Drafts save automatically. Drag lines on the preview; click a line to adjust just that one.'),
        h('button.icon-btn', { title: 'Undo (Ctrl+Z)', on: { click: undo } }, icon('undo', 16)),
        h('button.icon-btn', { title: 'Redo (Ctrl+Shift+Z)', on: { click: redo } }, icon('redo', 16)),
        h('button.btn.primary', { on: { click: () => { step = 'review'; renderAll(); } } }, 'Next: Review →'));
    } else {
      const p = draft.paper;
      const n = lineCount(p);
      const adjusted = Object.values(p.lineOverrides).filter((o) => o.dy || o.hidden).length;
      const row = (k, v) => h('div.sum-row', h('span', k), h('b', v));
      const nameIn = h('input', { type: 'text', value: draft.name, placeholder: 'e.g. My College Ruled Paper' });
      nameIn.addEventListener('input', () => { draft.name = nameIn.value; persist(); });
      const save = (andUse) => {
        const nm = nameIn.value.trim();
        if (!nm) { nameIn.focus(); return toast('Give your paper a name'); }
        draft.name = nm;
        let id = draft.editingId;
        if (id && userPresets().some((x) => x.id === id)) updateUserPreset(id, nm, p);
        else { id = saveUserPreset(nm, p); draft.editingId = id; }
        clearDraft();
        m.close();
        if (andUse) usePreset(id, forNewProject);
        else { toast(`Saved “${nm}” to your library`); openPaperLibrary({ forNewProject }); }
      };
      side.replaceChildren(h('div.review',
        h('h3', 'Review your paper'),
        h('p.muted.small', 'This is exactly the paper the editor, print preview and PDF will use.'),
        row('Size', `${sizeName(p.w, p.h)} · ${p.orientation}`),
        row('Ruling', rulingName(p.spacing)),
        row('First line from top', fmtLen(p.firstLine)),
        row('Number of lines', String(n)),
        row('Last line', p.last.hidden ? 'Hidden' : p.last.custom ? `Custom gap ${fmtLen(p.last.gap)}` : 'Standard spacing'),
        row('Last line → bottom edge', fmtLen(bottomGap(p))),
        row('Red margin', p.marginStyle.show ? `${fmtLen(p.margin)} from left` : 'Hidden'),
        row('Margins (T · B · L · R)', [p.margins.top, p.margins.bottom, p.margins.left, p.margins.right].map((v) => fmtLen(v).replace(/ \(.*\)/, '')).join(' · ')),
        adjusted ? row('Individually adjusted lines', String(adjusted)) : null,
        p.partials.length ? row('Partial lines', String(p.partials.length)) : null,
        h('label.field', h('span', 'Preset name'), nameIn),
        draft.editingId && userPresets().some((x) => x.id === draft.editingId) && h('p.muted.small', 'Saving updates this preset. Use Duplicate in the library to keep the old version.')));
      m.foot.replaceChildren(
        h('button.btn', { on: { click: () => { step = 'edit'; renderAll(); } } }, '← Back'),
        h('span.grow'),
        h('button.btn', { on: { click: () => save(false) } }, 'Save Preset'),
        h('button.btn.primary', { on: { click: () => save(true) } }, forNewProject ? 'Save & Start Project' : 'Save & Use'));
      setTimeout(() => { if (!nameIn.value || nameIn.value === 'My paper') nameIn.select(); }, 0);
    }
  }

  // ---------- live preview ----------
  let svgEl = null;
  function drawPreview() {
    const p = draft.paper;
    const pad = 12;
    const vw = p.w + pad + 4, vh = p.h + pad + 4;
    const r = stage.getBoundingClientRect();
    const fit = Math.max(0.5, Math.min((r.width - 32) / vw, (r.height - 24) / vh));
    const s = svg('svg', { class: 'studio-svg', viewBox: `${-pad} ${-pad} ${vw} ${vh}` });
    s.style.width = vw * fit * zoom + 'px';
    s.style.height = vh * fit * zoom + 'px';
    const k = 1 / (fit * zoom); // mm per screen px
    s.append(rulers(p, pad, k));
    s.append(svg('rect', { x: 0, y: 0, width: p.w, height: p.h, fill: '#000', opacity: 0.25, transform: 'translate(0.6 0.8)' }));
    s.append(paperOverlay(p));
    const wb = writingBox(p);
    s.append(svg('rect', { class: 'margin-box', x: wb.x, y: p.margins.top, width: wb.w, height: p.h - p.margins.top - p.margins.bottom }));
    if (step === 'edit') s.append(handles(p, k));
    s.append(dimensions(p, k));
    stage.replaceChildren(s);
    svgEl = s;
  }

  function rulers(p, pad, k) {
    const g = svg('g', { class: 'studio-ruler' });
    g.append(svg('rect', { x: -pad, y: -pad, width: p.w + pad, height: pad - 2, class: 'rbg' }));
    g.append(svg('rect', { x: -pad, y: -pad, width: pad - 2, height: p.h + pad, class: 'rbg' }));
    const u = getUnit();
    const minor = u === 'in' ? 25.4 / 8 : 1, per = u === 'in' ? 8 : 10;
    let d = '';
    const fs = Math.max(2.2, 9 * k);
    for (let i = 0; i * minor <= p.w + 1e-6; i++) {
      const x = i * minor, len = i % per === 0 ? 4 : i % (per / 2) === 0 ? 2.6 : 1.4;
      if (u !== 'in' && i % (per / 2) && minor / k < 4) continue;
      d += `M${x} -2v${-len}`;
      if (i % per === 0 && i) { const tx = svg('text', { x: x + 0.6, y: -pad + fs + 0.4, 'font-size': fs }); tx.textContent = u === 'in' ? i / per : u === 'cm' ? i / per : i; g.append(tx); }
    }
    for (let i = 0; i * minor <= p.h + 1e-6; i++) {
      const y = i * minor, len = i % per === 0 ? 4 : i % (per / 2) === 0 ? 2.6 : 1.4;
      if (u !== 'in' && i % (per / 2) && minor / k < 4) continue;
      d += `M-2 ${y}h${-len}`;
      if (i % per === 0 && i) { const tx = svg('text', { x: -pad + 0.6, y: y - 0.6, 'font-size': fs }); tx.textContent = u === 'in' ? i / per : u === 'cm' ? i / per : i; g.append(tx); }
    }
    g.append(svg('path', { d, 'stroke-width': Math.max(0.15, k) }));
    return g;
  }

  // Grab areas for every line, plus labelled chips for the special handles.
  function handles(p, k) {
    const g = svg('g', { class: 'studio-handles' });
    const lines = rulingLines(p);
    const n = lineCount(p);
    const ki = Math.min(5, n - 2);
    const hit = (attrs, drag, cursor) => g.append(svg('line', { ...attrs, class: 'shit', 'data-drag': drag, 'stroke-width': Math.max(1.6, 8 * k), style: `cursor:${cursor}` }));
    const chip = (x, y, text, cls, drag) => {
      const fs = 10 * k;
      const c = svg('g', { class: 'schip ' + cls, 'data-drag': drag, transform: `translate(${x} ${y})` });
      c.append(svg('rect', { x: 0, y: -fs * 0.95, width: (text.length * 0.6 + 1.2) * fs, height: fs * 1.9, rx: fs * 0.95 }));
      const tx = svg('text', { x: fs * 0.6, y: fs * 0.35, 'font-size': fs });
      tx.textContent = text;
      c.append(tx);
      g.append(c);
    };
    for (const l of lines) {
      const tl = (x) => l.y + tiltAt(p, x);
      const drag = l.partial ? `partial:${l.k}` : l.i === 0 ? 'first' : l.i === n - 1 ? 'last' : `line:${l.i}`;
      if (!l.partial && l.i === lineSel.i && lineSel.open) g.append(svg('line', { class: 'ssel', x1: l.x1, x2: l.x2, y1: tl(l.x1), y2: tl(l.x2), 'stroke-width': 3 * k }));
      if (l.hidden) g.append(svg('line', { class: 'shidden', x1: l.x1, x2: l.x2, y1: tl(l.x1), y2: tl(l.x2), 'stroke-width': 1.2 * k }));
      hit({ x1: l.x1, x2: l.x2, y1: tl(l.x1), y2: tl(l.x2) }, drag, 'ns-resize');
    }
    const firstL = lines.find((l) => l.i === 0);
    if (firstL) chip(p.w + 1.5 - 62 * k, firstL.y + tiltAt(p, p.w), 'First line', 'first', 'first');
    const spL = lines.find((l) => l.i === ki);
    if (ki >= 1 && spL) chip(p.w + 1.5 - 62 * k, spL.y + tiltAt(p, p.w), 'Spacing', 'spacing', 'spacing');
    const lastL = lines.find((l) => l.i === n - 1);
    if (n >= 2 && lastL) chip(p.w + 1.5 - 62 * k, lastL.y + tiltAt(p, p.w), 'Last line', 'last', 'last');
    if (p.marginStyle.show) {
      hit({ x1: p.margin, x2: p.margin, y1: 0, y2: p.h }, 'margin', 'ew-resize');
      chip(p.margin + 1.2, 6 + 14 * k, 'Margin', 'margin', 'margin');
    }
    p.extraMargins.forEach((e, i) => hit({ x1: e.x, x2: e.x, y1: 0, y2: p.h }, `extra:${i}`, 'ew-resize'));
    return g;
  }

  // Dimension callouts for the top and bottom gaps.
  function dimensions(p, k) {
    const g = svg('g', { class: 'studio-dims' });
    const lines = rulingLines(p).filter((l) => !l.partial);
    if (!lines.length) return g;
    const x = p.w - 6;
    const fs = 9 * k;
    const dim = (y1, y2, label) => {
      if (y2 - y1 < 0.5) return;
      g.append(svg('path', { d: `M${x} ${y1}V${y2}M${x - 1} ${y1}h2M${x - 1} ${y2}h2`, 'stroke-width': Math.max(0.15, 1.2 * k) }));
      const tx = svg('text', { x: x - 1.5, y: (y1 + y2) / 2 + fs * 0.35, 'font-size': fs, 'text-anchor': 'end' });
      tx.textContent = label;
      g.append(tx);
    };
    dim(0, lines[0].y, fmtLen(lines[0].y).replace(/ \(.*\)/, ''));
    const last = lines[lines.length - 1];
    dim(last.y, p.h, fmtLen(p.h - last.y).replace(/ \(.*\)/, ''));
    return g;
  }

  // ---------- dragging on the preview ----------
  let drag = null;
  let measureEl = null;
  const showMeasure = (e, text) => {
    measureEl ||= document.body.appendChild(h('div.measure'));
    measureEl.textContent = text;
    Object.assign(measureEl.style, { left: e.clientX + 14 + 'px', top: e.clientY + 14 + 'px', display: 'block' });
  };
  const toPaper = (e) => {
    const pt = svgEl.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svgEl.getScreenCTM().inverse());
  };
  // Inches snap to 1/64 in so dragged values read as clean fractions.
  const snap = (v, e) => {
    if (e.shiftKey) return v;
    const st = getUnit() === 'in' ? 25.4 / 64 : 0.1;
    return Math.round(v / st) * st;
  };

  stage.addEventListener('pointerdown', (e) => {
    const target = e.target.closest('[data-drag]');
    if (!target || step !== 'edit') return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    drag = { what: target.dataset.drag, x: e.clientX, y: e.clientY, moved: false };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 3) return;
    drag.moved = true;
    const pt = toPaper(e);
    const p = draft.paper;
    const n = lineCount(p);
    const ty = pt.y - tiltAt(p, pt.x);
    const [what, idx] = drag.what.split(':');
    if (what === 'first') {
      const v = snap(clamp(ty, 0, p.h), e);
      t.live((pp) => { pp.firstLine = v; });
      showMeasure(e, `First line: ${fmtLen(v)} from top`);
    } else if (what === 'spacing') {
      const ki = Math.min(5, n - 2);
      const v = snap(clamp((ty - p.firstLine) / ki, 2, 40), e);
      t.live((pp) => { pp.spacing = v; });
      showMeasure(e, `Line spacing: ${fmtLen(v)}`);
    } else if (what === 'last') {
      // Only the last line moves; the other lines keep their spacing.
      const prev = lineAt(p, n - 2);
      const v = snap(clamp(ty - prev, 0.5, p.h - prev), e);
      t.live((pp) => { pp.last.custom = true; pp.last.gap = v; });
      showMeasure(e, `Last line: ${fmtLen(v)} below line ${n - 1} · ${fmtLen(p.h - prev - v)} from bottom`);
    } else if (what === 'line') {
      const i = +idx;
      const v = snap(clamp(ty - (p.firstLine + i * p.spacing), -p.spacing, p.spacing), e);
      lineSel.i = i;
      lineSel.open = true;
      t.live((pp) => { (pp.lineOverrides[i] ||= {}).dy = v; });
      showMeasure(e, `Line ${i + 1}: ${v >= 0 ? '+' : '−'}${fmtLen(Math.abs(v))} from regular spacing`);
    } else if (what === 'margin') {
      const v = snap(clamp(pt.x, 0, p.w), e);
      t.live((pp) => { pp.margin = v; });
      showMeasure(e, `Red margin: ${fmtLen(v)} from left`);
    } else if (what === 'extra') {
      const v = snap(clamp(pt.x, 0, p.w), e);
      t.live((pp) => { pp.extraMargins[+idx].x = v; });
      showMeasure(e, `Vertical line: ${fmtLen(v)} from left`);
    } else if (what === 'partial' && +idx >= 0) {
      const v = snap(clamp(ty, 0, p.h), e);
      t.live((pp) => { pp.partials[+idx].y = v; });
      showMeasure(e, `Partial line: ${fmtLen(v)} from top`);
    }
  });
  stage.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (measureEl) measureEl.style.display = 'none';
    if (!d.moved) {
      // A click on a regular line selects it for individual adjustment.
      const [what, idx] = d.what.split(':');
      const n = lineCount(draft.paper);
      if (what === 'line' || what === 'first' || what === 'last') {
        lineSel.i = what === 'line' ? +idx : what === 'first' ? 0 : n - 1;
        lineSel.open = true;
        renderAll();
      }
      return;
    }
    t.commit();
    renderSide();
  });

  function renderAll() {
    renderSteps();
    renderSide();
    drawPreview();
  }

  const ro = new ResizeObserver(() => drawPreview());
  ro.observe(stage);
  const obs = new MutationObserver(() => { if (!m.el.isConnected) { ro.disconnect(); obs.disconnect(); if (measureEl) measureEl.remove(); } });
  obs.observe(document.getElementById('modal-root'), { childList: true });

  lineSel.open = false;
  persist();
  renderAll();
}
