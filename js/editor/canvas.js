// The editing surface: page SVG, selection handles, pointer tools, snapping,
// zoom, inline text editing and keyboard shortcuts.
import { svg, h, PX_PER_MM, clamp, simplify, uid, isTyping, toast } from '../util.js';
import { paperOverlay, nearestLineY, writingBox, tiltAt, rulingLines, lineCount, lineAt } from '../paper.js';
import { inkDefs, objectElement, objTransform, pageContent } from './render.js';
import * as S from '../state.js';
import { printableRect, activeProfile } from '../print.js';
import { livePaper, commitPaper } from '../paperedit.js';
import { getUnit, fmtLen } from '../ui/controls.js';

const { state, bus } = S;
let ws, stage, wrap, pageSvg, contentG, uiG, editor;
let drag = null;
let spaceDown = false;
let guides = [];

const scale = () => state.zoom * PX_PER_MM; // screen px per mm
const paper = () => state.project.paper;

export function initCanvas() {
  ws = document.getElementById('workspace');
  stage = document.getElementById('stage');
  wrap = h('div.page-wrap');
  stage.append(wrap);
  pageSvg = svg('svg', { class: 'page-svg' });
  wrap.append(pageSvg);

  bus.on('change', renderAll);
  bus.on('page', renderAll);
  bus.on('project', () => { renderAll(); requestAnimationFrame(zoomFit); });
  bus.on('fonts', renderAll);
  bus.on('stage', renderAll);
  bus.on('selection', () => { drawUI(); });
  bus.on('zoom', () => { sizePage(); drawUI(); drawRulers(); positionEditor(); });
  bus.on('paperEdit', () => {
    if (state.paperEdit && state.editingId) commitEditor();
    ws.classList.toggle('paper-edit', state.paperEdit);
    renderAll();
  });
  bus.on('tool', () => { ws.dataset.tool = state.tool; });

  pageSvg.addEventListener('pointerdown', onDown);
  pageSvg.addEventListener('dblclick', onDblClick);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  ws.addEventListener('pointerdown', (e) => {
    if (e.target === ws || e.target === stage) {
      if (spaceDown || e.button === 1) return startPan(e);
      if (state.tool === 'select') S.setSelection([]);
    }
  });
  ws.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceDown = false; ws.classList.remove('panning'); } });
  window.addEventListener('resize', () => positionEditor());
  ws.addEventListener('scroll', () => positionEditor());

  // Drag-and-drop from the Insert panel and image files.
  wrap.addEventListener('dragover', (e) => e.preventDefault());
  wrap.addEventListener('drop', onDrop);
}

// ---------- rendering ----------
function sizePage() {
  const p = paper();
  pageSvg.setAttribute('viewBox', `0 0 ${p.w} ${p.h}`);
  pageSvg.style.width = p.w * scale() + 'px';
  pageSvg.style.height = p.h * scale() + 'px';
}

export function renderAll() {
  if (!state.project) return;
  const p = paper();
  sizePage();
  pageSvg.replaceChildren();
  pageSvg.append(inkDefs());
  // The overlay toggle hides only the ruling; a plain sheet stays for contrast.
  // Lines are always shown while editing the paper itself.
  pageSvg.append(state.project.view.overlay || state.paperEdit ? paperOverlay(p) : svg('rect', { width: p.w, height: p.h, fill: p.bg || '#fdfdfb' }));
  if (state.paperEdit) {
    const wb = writingBox(p), m = p.margins;
    pageSvg.append(svg('rect', { class: 'margin-box', x: wb.x, y: m.top, width: wb.w, height: p.h - m.top - m.bottom }));
  }
  if (state.project.view.printable !== false) {
    // Non-printing guide: the printer can't reach outside this box.
    const r = printableRect(activeProfile(), p);
    pageSvg.append(svg('rect', { class: 'printable-area', x: r.x, y: r.y, width: r.w, height: r.h }));
  }
  contentG = pageContent(S.page(), { project: state.project, editor: true });
  pageSvg.append(contentG);
  uiG = svg('g', { class: 'ui' });
  pageSvg.append(uiG);
  drawUI();
  drawRulers();
  positionEditor();
}

// ---------- Edit Paper mode ----------
// Rulers in real units along the top and left edges of the sheet.
function drawRulers() {
  wrap?.querySelectorAll('.ruler').forEach((e) => e.remove());
  if (!state.paperEdit || !state.project) return;
  const p = paper(), k = scale(), u = getUnit();
  const minor = u === 'in' ? 25.4 / 16 : 1; // mm per minor tick
  const per = u === 'in' ? 16 : 10; // minor ticks per labelled tick
  const half = per / 2;
  const make = (len, horiz) => {
    const L = len * k;
    const s = svg('svg', { class: 'ruler ' + (horiz ? 'top' : 'left'), width: horiz ? L : 20, height: horiz ? 20 : L });
    let d = '';
    const dense = minor * k < 4;
    for (let i = 0; i * minor <= len + 1e-6; i++) {
      const major = i % per === 0, mid = i % half === 0;
      if (dense && !major && !mid && i % 2) continue;
      const t = major ? 11 : mid ? 7 : 4;
      const pos = (i * minor * k).toFixed(1);
      d += horiz ? `M${pos} 20v${-t}` : `M20 ${pos}h${-t}`;
      if (major && i) {
        const v = u === 'in' ? i / per : u === 'cm' ? i / per : i;
        const tx = svg('text', horiz ? { x: +pos + 2, y: 9 } : { x: 2, y: +pos - 2 });
        tx.textContent = String(v);
        s.append(tx);
      }
    }
    s.prepend(svg('path', { d }));
    return s;
  };
  wrap.append(make(p.w, true), make(p.h, false));
}

let measureEl;
function showMeasure(e, text) {
  measureEl ||= document.body.appendChild(h('div.measure'));
  measureEl.textContent = text;
  Object.assign(measureEl.style, { left: e.clientX + 14 + 'px', top: e.clientY + 14 + 'px', display: 'block' });
}
const hideMeasure = () => measureEl && (measureEl.style.display = 'none');

// Handles: drag the first line, the line-spacing handle, the red margin and
// any extra vertical lines. Wide invisible strokes make them easy to grab.
function drawPaperHandles() {
  const p = paper(), k = 1 / scale();
  const grab = (attrs, name) => uiG.append(svg('line', { ...attrs, class: 'p-hit', 'data-handle': name, 'stroke-width': 10 * k, style: `cursor:${attrs.x1 === attrs.x2 ? 'ew' : 'ns'}-resize` }));
  const chip = (x, y, text, cls, name) => {
    const g = svg('g', { class: 'p-chip ' + cls, 'data-handle': name, transform: `translate(${x} ${y}) scale(${k})` });
    g.append(svg('rect', { x: 0, y: -9, width: text.length * 6.2 + 12, height: 18, rx: 9 }));
    const t = svg('text', { x: 6, y: 4 });
    t.textContent = text;
    g.append(t);
    uiG.append(g);
  };
  const lines = rulingLines(p).filter((l) => !l.partial);
  const n = lineCount(p);
  const special = (i, name, label, cls) => {
    const l = lines.find((x) => x.i === i);
    if (!l) return;
    const at = (x) => l.y + tiltAt(p, x);
    grab({ x1: l.x1, x2: l.x2, y1: at(l.x1), y2: at(l.x2) }, name);
    uiG.append(svg('line', { class: 'p-hl ' + cls, x1: l.x1, x2: l.x2, y1: at(l.x1), y2: at(l.x2), 'stroke-width': 1.5 * k }));
    chip(p.w - 70 * k, at(p.w - 40 * k), label, cls, name);
  };
  special(0, 'p-first', 'First line', 'first');
  const ki = Math.min(n - 2, 5);
  if (ki >= 1) special(ki, 'p-spacing', 'Spacing', 'spacing');
  // The last line moves on its own; the other lines keep their spacing.
  if (n >= 2) special(n - 1, 'p-last', 'Last line', 'last');
  const vgrab = (x, name, label) => {
    grab({ x1: x, x2: x, y1: 0, y2: p.h }, name);
    chip(x + 3 * k, 14 * k + (name === 'p-margin' ? 0 : 22 * k), label, 'margin', name);
  };
  if (p.marginStyle.show) vgrab(p.margin, 'p-margin', 'Red line');
  if (p.rightLine?.show) {
    const rx = p.w - p.rightLine.x;
    grab({ x1: rx, x2: rx, y1: 0, y2: p.h }, 'p-rmargin');
    chip(rx - 130 * k, 14 * k, 'Right-side red line', 'rmargin', 'p-rmargin');
  }
  p.extraMargins.forEach((e, i) => vgrab(e.x, 'p-extra-' + i, `Line ${i + 2}`));
}

function paperDrag(d, pt, e) {
  const p = paper();
  // Inches snap to 1/64 in (clean fractions); metric to 0.05 mm. Shift = free.
  const st = getUnit() === 'in' ? 25.4 / 64 : 0.05;
  const snap = (v) => (e.shiftKey ? v : Math.round(v / st) * st);
  if (d.handle === 'p-last') {
    const n = lineCount(p);
    const prev = lineAt(p, n - 2);
    const v = snap(clamp(pt.y - tiltAt(p, pt.x) - prev, 0.5, p.h - prev));
    livePaper((pp) => { pp.last.custom = true; pp.last.gap = v; });
    showMeasure(e, `Last line: ${fmtLen(v)} below the line above · ${fmtLen(p.h - prev - v)} from bottom`);
  } else if (d.handle === 'p-first') {
    const v = snap(clamp(pt.y - tiltAt(p, pt.x), 0, p.h));
    livePaper((pp) => { pp.firstLine = v; });
    showMeasure(e, `First line: ${fmtLen(v)} from top`);
  } else if (d.handle === 'p-spacing') {
    const v = snap(clamp((pt.y - tiltAt(p, pt.x) - p.firstLine) / d.k, 2, 40));
    livePaper((pp) => { pp.spacing = v; });
    showMeasure(e, `Line spacing: ${fmtLen(v)}`);
  } else if (d.handle === 'p-margin') {
    const v = snap(clamp(pt.x, 0, p.w));
    livePaper((pp) => { pp.margin = v; });
    showMeasure(e, `Red Line Margin: ${fmtLen(v)} from left`);
  } else if (d.handle === 'p-rmargin') {
    const v = snap(clamp(p.w - pt.x, 0, p.w));
    livePaper((pp) => { pp.rightLine.x = v; });
    showMeasure(e, `Right-Side Red Line Margin: ${fmtLen(v)} from right`);
  } else if (d.handle.startsWith('p-extra-')) {
    const i = +d.handle.slice(8);
    const v = snap(clamp(pt.x, 0, p.w));
    livePaper((pp) => { pp.extraMargins[i].x = v; });
    showMeasure(e, `Vertical line: ${fmtLen(v)} from left`);
  }
}

const elOf = (id) => contentG?.querySelector(`[data-id="${id}"]`);

function refreshObjects(objs) {
  for (const o of objs) {
    const old = elOf(o.id);
    if (!old) continue;
    old.replaceWith(objectElement(o, { project: state.project, editor: true }));
  }
}
function moveObjects(objs) {
  for (const o of objs) elOf(o.id)?.setAttribute('transform', objTransform(o));
}

// ---------- geometry ----------
const rad = (d) => (d * Math.PI) / 180;
function corners(o) {
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2, c = Math.cos(rad(o.rot || 0)), s = Math.sin(rad(o.rot || 0));
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
    const x = (a * o.w) / 2, y = (b * o.h) / 2;
    return [cx + x * c - y * s, cy + x * s + y * c];
  });
}
function aabb(objs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of objs) for (const [x, y] of corners(o)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function toPage(e) {
  const pt = pageSvg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const p = pt.matrixTransform(pageSvg.getScreenCTM().inverse());
  return { x: p.x, y: p.y };
}
function toScreen(x, y) {
  const pt = pageSvg.createSVGPoint();
  pt.x = x;
  pt.y = y;
  return pt.matrixTransform(pageSvg.getScreenCTM());
}

// ---------- selection UI ----------
function drawUI() {
  if (!uiG) return;
  uiG.replaceChildren();
  if (state.paperEdit) return drawPaperHandles();
  const k = 1 / scale();
  for (const gl of guides) {
    uiG.append(svg('line', gl.axis === 'x' ? { x1: gl.v, x2: gl.v, y1: 0, y2: paper().h } : { y1: gl.v, y2: gl.v, x1: 0, x2: paper().w }, ));
    uiG.lastChild.setAttribute('class', 'guide');
    uiG.lastChild.setAttribute('stroke-width', k);
  }
  if (drag?.type === 'marquee' && drag.rect) {
    const r = drag.rect;
    uiG.append(svg('rect', { class: 'marquee', x: r.x, y: r.y, width: r.w, height: r.h, 'stroke-width': k }));
  }
  const sel = S.selected().filter((o) => !o.hidden);
  if (!sel.length || state.tool !== 'select') return;
  // outline each selected object
  for (const o of sel) {
    uiG.append(svg('polygon', { class: 'sel-outline', points: corners(o).map((p) => p.join(',')).join(' '), 'stroke-width': k * (sel.length > 1 ? 1 : 1.5) }));
  }
  if (sel.some((o) => o.locked)) return;
  const single = sel.length === 1 ? sel[0] : null;
  const box = single || { ...aabb(sel), rot: 0 };
  if (!single) uiG.append(svg('rect', { class: 'sel-box', x: box.x, y: box.y, width: box.w, height: box.h, 'stroke-width': k }));
  const textOnly = single?.type === 'text';
  const handles = textOnly ? ['w', 'e'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const hs = 8 * k;
  const g = svg('g', { transform: objTransform({ ...box, rot: box.rot || 0 }) });
  const pos = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
  g.append(svg('line', { class: 'rot-stem', x1: box.w / 2, y1: 0, x2: box.w / 2, y2: -22 * k, 'stroke-width': k }));
  g.append(svg('circle', { class: 'handle rot', 'data-handle': 'rot', cx: box.w / 2, cy: -22 * k, r: 5 * k, 'stroke-width': k }));
  for (const name of handles) {
    const [u, v] = pos[name];
    g.append(svg('rect', { class: `handle h-${name}`, 'data-handle': name, x: u * box.w - hs / 2, y: v * box.h - hs / 2, width: hs, height: hs, rx: 1.5 * k, 'stroke-width': k }));
  }
  uiG.append(g);
}

// ---------- pointer handling ----------
function startPan(e) {
  drag = { type: 'pan', sx: e.clientX, sy: e.clientY, l: ws.scrollLeft, t: ws.scrollTop };
  ws.classList.add('panning');
  e.preventDefault();
}

function onDown(e) {
  if (e.button === 1 || spaceDown) return startPan(e);
  if (e.button !== 0) return;
  if (state.editingId) commitEditor();
  const p = toPage(e);
  const tool = state.tool;

  if (state.paperEdit) {
    // Content is locked while the paper is being edited.
    const ph = e.target.closest('[data-handle]')?.dataset.handle;
    if (ph?.startsWith('p-')) {
      drag = { type: 'paper', handle: ph, k: Math.min(lineCount(paper()) - 2, 5) };
      e.preventDefault();
    }
    return;
  }

  if (tool === 'pen' || tool === 'highlighter') {
    drag = { type: 'draw', pts: [[p.x, p.y]], el: svg('path', { class: 'draft', fill: 'none', stroke: tool === 'highlighter' ? '#f2df3c' : state.project.writer.defaults.color, 'stroke-width': tool === 'highlighter' ? 4.5 : 0.45, 'stroke-opacity': tool === 'highlighter' ? 0.4 : 1, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }) };
    uiG.append(drag.el);
    pageSvg.setPointerCapture(e.pointerId);
    return;
  }
  if (tool !== 'select') {
    drag = { type: 'create', tool, start: p, cur: p };
    return;
  }

  const handle = e.target.closest('[data-handle]')?.dataset.handle;
  const sel = S.selected();
  if (handle) {
    const box = sel.length === 1 ? { ...sel[0] } : { ...aabb(sel), rot: 0 };
    drag = { type: handle === 'rot' ? 'rotate' : 'resize', handle, start: p, box, orig: sel.map((o) => JSON.parse(JSON.stringify(o))), moved: false };
    return;
  }

  const hit = e.target.closest('[data-id]');
  const obj = hit && S.findObj(hit.dataset.id);
  if (obj && !obj.locked) {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      const ids = S.expandGroups([obj.id]);
      const next = new Set(state.selection);
      const allIn = [...ids].every((i) => next.has(i));
      ids.forEach((i) => (allIn ? next.delete(i) : next.add(i)));
      S.setSelection(next, { expand: false });
      if (allIn) return;
    } else if (!state.selection.has(obj.id)) S.setSelection([obj.id]);
    const objs = S.selected().filter((o) => !o.locked);
    drag = { type: 'move', start: p, orig: objs.map((o) => ({ id: o.id, x: o.x, y: o.y })), objs, moved: false, alt: e.altKey };
  } else {
    if (!e.shiftKey) S.setSelection([]);
    drag = { type: 'marquee', start: p, base: new Set(state.selection) };
  }
}

function onMove(e) {
  if (!drag) return;
  if (drag.type === 'pan') {
    ws.scrollLeft = drag.l - (e.clientX - drag.sx);
    ws.scrollTop = drag.t - (e.clientY - drag.sy);
    return;
  }
  const p = toPage(e);
  if (drag.type === 'paper') return paperDrag(drag, p, e);
  const dx = p.x - drag.start?.x, dy = p.y - drag.start?.y;
  if (drag.type === 'draw') {
    const last = drag.pts[drag.pts.length - 1];
    if (Math.hypot(p.x - last[0], p.y - last[1]) > 0.15) drag.pts.push([p.x, p.y]);
    drag.el.setAttribute('d', 'M' + drag.pts.map((q) => q.map((n) => n.toFixed(2)).join(' ')).join('L'));
    return;
  }
  if (!drag.moved && Math.hypot(dx, dy) * scale() < 3) return;
  drag.moved = true;

  if (drag.type === 'move') {
    if (drag.alt && !drag.cloned) {
      // Alt-drag duplicates, leaving the originals in place.
      const copies = S.cloneObjects(drag.objs, 0, 0);
      S.page().objects.push(...copies);
      drag.objs = copies;
      drag.orig = copies.map((o) => ({ id: o.id, x: o.x, y: o.y }));
      state.selection = new Set(copies.map((o) => o.id));
      drag.cloned = true;
      renderAll();
    }
    let [sx, sy] = snapMove(drag, dx, dy, e.altKey && !drag.alt);
    drag.orig.forEach((o0, i) => { drag.objs[i].x = o0.x + sx; drag.objs[i].y = o0.y + sy; });
    moveObjects(drag.objs);
    drawUI();
    bus.emit('live');
  } else if (drag.type === 'resize') doResize(p, e.shiftKey);
  else if (drag.type === 'rotate') doRotate(p, e.shiftKey);
  else if (drag.type === 'marquee') {
    const r = { x: Math.min(drag.start.x, p.x), y: Math.min(drag.start.y, p.y), w: Math.abs(dx), h: Math.abs(dy) };
    drag.rect = r;
    const hits = S.page().objects.filter((o) => {
      if (o.locked || o.hidden) return false;
      const b = aabb([o]);
      return b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y;
    }).map((o) => o.id);
    S.setSelection(new Set([...drag.base, ...hits]));
  } else if (drag.type === 'create') {
    drag.cur = p;
    const r = { x: Math.min(drag.start.x, p.x), y: Math.min(drag.start.y, p.y), w: Math.abs(dx), h: Math.abs(dy) };
    uiG.querySelector('.draft')?.remove();
    uiG.append(svg('rect', { class: 'draft marquee', x: r.x, y: r.y, width: r.w, height: r.h, 'stroke-width': 1 / scale() }));
  }
}

function onUp(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  guides = [];
  if (d.type === 'paper') {
    hideMeasure();
    return commitPaper();
  }
  ws.classList.remove('panning');
  if (d.type === 'draw') return finishDraw(d);
  if (d.type === 'create') return finishCreate(d, e);
  if (d.type === 'marquee') return drawUI();
  if (d.moved && (d.type === 'move' || d.type === 'resize' || d.type === 'rotate')) {
    S.commit();
  } else drawUI();
}

// ---------- snapping ----------
function snapTargets(excludeIds) {
  const p = paper();
  const wb = writingBox(p);
  const xs = [0, p.w / 2, p.w];
  // The red margin and writing margins are optional snapping boundaries.
  if (state.project.view.snapMargin !== false) {
    xs.push(wb.x, wb.x + wb.w);
    if (p.marginStyle?.show !== false) xs.push(p.margin);
    if (p.rightLine?.show) xs.push(p.w - p.rightLine.x);
    for (const e of p.extraMargins || []) xs.push(e.x);
  }
  const ys = [0, p.h / 2, p.h];
  for (const o of S.page().objects) {
    if (excludeIds.has(o.id) || o.hidden) continue;
    const b = aabb([o]);
    xs.push(b.x, b.x + b.w / 2, b.x + b.w);
    ys.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { xs, ys };
}

function snapMove(d, dx, dy, disable) {
  if (disable) return [dx, dy];
  const tol = 6 / scale();
  const ids = new Set(d.objs.map((o) => o.id));
  const origObjs = d.objs.map((o, i) => ({ ...o, x: d.orig[i].x + dx, y: d.orig[i].y + dy }));
  const b = aabb(origObjs);
  const { xs, ys } = snapTargets(ids);
  let bestX = null, bestY = null;
  for (const [v, off] of [[b.x, 0], [b.x + b.w / 2, b.w / 2], [b.x + b.w, b.w]]) {
    for (const t of xs) if (Math.abs(t - v) < tol && (!bestX || Math.abs(t - v) < Math.abs(bestX.d))) bestX = { d: t - v, v: t };
  }
  // Text that follows the ruling locks its first baseline to a ruled line.
  // (Hold Alt while dragging to place text freely.)
  const angle = paper().lineStyle?.angle || 0;
  const lead = d.objs.find((o) => o.type === 'text' && o.hw.followLines !== false && Math.abs((o.rot || 0) - angle) < 0.01);
  if (lead && state.project.view.snapLines !== false) {
    const i = d.objs.indexOf(lead);
    const fb = (lead.hw.lineSpacing > 0 ? lead.hw.lineSpacing : paper().spacing) * 0.74;
    const base = d.orig[i].y + dy + fb;
    const cx = d.orig[i].x + dx + lead.w / 2;
    bestY = { d: nearestLineY(paper(), base, cx) - base, v: null };
  } else {
    for (const v of [b.y, b.y + b.h / 2, b.y + b.h]) {
      for (const t of ys) if (Math.abs(t - v) < tol && (!bestY || Math.abs(t - v) < Math.abs(bestY.d))) bestY = { d: t - v, v: t };
    }
  }
  guides = [];
  if (bestX) guides.push({ axis: 'x', v: bestX.v });
  if (bestY?.v != null) guides.push({ axis: 'y', v: bestY.v });
  return [dx + (bestX?.d || 0), dy + (bestY?.d || 0)];
}

// ---------- resize / rotate ----------
function doResize(p, keepAspect) {
  const { handle, box, orig } = drag;
  const objs = orig.map((o) => S.findObj(o.id));
  const minS = 1;
  const r = rad(box.rot || 0), c = Math.cos(r), s = Math.sin(r);
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  // pointer in the box's local (unrotated, centred) frame
  const lx = (p.x - cx) * c + (p.y - cy) * s;
  const ly = -(p.x - cx) * s + (p.y - cy) * c;
  let l = -box.w / 2, rr = box.w / 2, t = -box.h / 2, b = box.h / 2;
  const isText = objs.length === 1 && objs[0].type === 'text';
  if (handle.includes('w')) l = Math.min(lx, rr - minS);
  if (handle.includes('e')) rr = Math.max(lx, l + minS);
  if (!isText) {
    if (handle.includes('n')) t = Math.min(ly, b - minS);
    if (handle.includes('s')) b = Math.max(ly, t + minS);
  }
  let nw = rr - l, nh = b - t;
  if (keepAspect && handle.length === 2 && !isText) {
    const k = Math.max(nw / box.w, nh / box.h);
    nw = box.w * k;
    nh = box.h * k;
    if (handle.includes('w')) l = rr - nw; else rr = l + nw;
    if (handle.includes('n')) t = b - nh; else b = t + nh;
  }
  const lcx = (l + rr) / 2, lcy = (t + b) / 2;
  const ncx = cx + lcx * c - lcy * s, ncy = cy + lcx * s + lcy * c;
  if (objs.length === 1) {
    const o = objs[0];
    o.w = nw;
    if (!isText) o.h = nh;
    o.x = ncx - nw / 2;
    o.y = isText ? orig[0].y : ncy - nh / 2; // text height follows its content
  } else {
    const sx = nw / box.w, sy = nh / box.h;
    const nx0 = ncx - nw / 2, ny0 = ncy - nh / 2;
    objs.forEach((o, i) => {
      const o0 = orig[i];
      const ocx = o0.x + o0.w / 2, ocy = o0.y + o0.h / 2;
      const ncx2 = nx0 + (ocx - box.x) * sx, ncy2 = ny0 + (ocy - box.y) * sy;
      o.w = Math.max(minS, o0.w * sx);
      if (o.type === 'text') {
        if (handle.length === 2) {
          const k = Math.sqrt(sx * sy);
          o.hw.size = Math.max(0.8, o0.hw.size * k);
          o.hw.sizeRatio = (o0.hw.sizeRatio || 0.37) * k;
        }
      } else o.h = Math.max(minS, o0.h * sy);
      o.x = ncx2 - o.w / 2;
      o.y = ncy2 - (o.type === 'text' ? o0.h * sy : o.h) / 2;
    });
  }
  refreshObjects(objs);
  drawUI();
  bus.emit('live');
}

function doRotate(p, snap) {
  const { box, orig, start } = drag;
  const objs = orig.map((o) => S.findObj(o.id));
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  let delta = ((Math.atan2(p.y - cy, p.x - cx) - Math.atan2(start.y - cy, start.x - cx)) * 180) / Math.PI;
  if (objs.length === 1) {
    let a = (orig[0].rot || 0) + delta;
    a = snap ? Math.round(a / 15) * 15 : Math.abs(a % 90) < 1.5 || Math.abs(a % 90) > 88.5 ? Math.round(a / 90) * 90 : a;
    objs[0].rot = ((a % 360) + 360) % 360;
  } else {
    if (snap) delta = Math.round(delta / 15) * 15;
    const c = Math.cos(rad(delta)), s = Math.sin(rad(delta));
    objs.forEach((o, i) => {
      const o0 = orig[i];
      const ox = o0.x + o0.w / 2 - cx, oy = o0.y + o0.h / 2 - cy;
      o.x = cx + ox * c - oy * s - o.w / 2;
      o.y = cy + ox * s + oy * c - o.h / 2;
      o.rot = (((o0.rot || 0) + delta) % 360 + 360) % 360;
    });
  }
  moveObjects(objs);
  drawUI();
  bus.emit('live');
}

// ---------- creation ----------
function finishDraw(d) {
  d.el.remove();
  if (d.pts.length < 2) return;
  const pts = simplify(d.pts, 0.08);
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const w = Math.max(0.5, Math.max(...xs) - x0), hgt = Math.max(0.5, Math.max(...ys) - y0);
  const hl = d.el.getAttribute('stroke-opacity') === '0.4';
  S.addObjects([{
    id: uid(), type: 'path', name: hl ? 'Highlight' : 'Drawing', x: x0, y: y0, w, h: hgt, rot: 0, opacity: 1,
    points: pts.map(([x, y]) => [(x - x0) / w, (y - y0) / hgt]),
    stroke: d.el.getAttribute('stroke'), strokeWidth: +d.el.getAttribute('stroke-width'), highlighter: hl, texture: !hl,
  }], { select: false });
}

function finishCreate(d) {
  uiG.querySelector('.draft')?.remove();
  const { start, cur, tool } = d;
  const dragged = Math.hypot(cur.x - start.x, cur.y - start.y) * scale() > 6;
  const r = { x: Math.min(start.x, cur.x), y: Math.min(start.y, cur.y), w: Math.abs(cur.x - start.x), h: Math.abs(cur.y - start.y) };
  if (tool === 'text') {
    const o = S.newTextObject();
    const wb = writingBox(paper());
    if (dragged) { o.x = r.x; o.w = Math.max(10, r.w); }
    else {
      o.x = Math.max(o.x, Math.min(start.x, paper().w - 30));
      o.w = Math.max(20, wb.x + wb.w - o.x);
    }
    o.y = nearestLineY(paper(), start.y) - paper().spacing * 0.74;
    S.addObjects([o]);
    S.setTool('select');
    startEditing(o.id);
    return;
  }
  const shape = tool.replace('shape:', '');
  const o = S.newShape(shape);
  if (dragged) Object.assign(o, { x: r.x, y: r.y, w: Math.max(2, r.w), h: ['line', 'arrow', 'double-arrow', 'underline'].includes(shape) ? o.h : Math.max(2, r.h) });
  else Object.assign(o, { x: start.x - o.w / 2, y: start.y - o.h / 2 });
  if (shape === 'highlight') Object.assign(o, { fill: '#f2df3c', h: dragged ? o.h : 6, texture: false });
  S.addObjects([o]);
  S.setTool('select');
}

// Insert from the left panel (click or drop). pos is in page mm, optional.
export function insertItem(kind, pos) {
  const p = paper();
  const at = pos || { x: p.w / 2, y: p.h / 3 };
  if (kind.startsWith('text')) {
    const o = S.newTextObject();
    const fb = p.spacing * 0.74;
    if (kind === 'text-word') { o.w = 40; o.text = 'word'; }
    if (kind === 'text-heading') { o.text = 'Title'; o.hw.sizeRatio = +((o.hw.sizeRatio || 0.37) * 1.3).toFixed(3); o.hw.size = +(o.hw.size * 1.3).toFixed(2); o.w = 90; }
    if (pos) o.x = clamp(pos.x - (kind === 'text' ? 0 : o.w / 2), 0, p.w - 10);
    else if (kind !== 'text') o.x = p.w / 2 - o.w / 2;
    o.y = nearestLineY(p, pos ? pos.y : p.firstLine + p.spacing * 2) - fb;
    if (kind === 'text') o.w = Math.min(o.w, p.w - o.x - p.margins.right);
    S.addObjects([o]);
    if (kind === 'text') startEditing(o.id);
    return;
  }
  const o = S.newShape(kind);
  if (kind === 'highlight') Object.assign(o, { fill: '#f2df3c', w: 40, h: 6, texture: false });
  o.x = at.x - o.w / 2;
  o.y = at.y - o.h / 2;
  S.addObjects([o]);
}

export async function insertImage(dataUrl, pos) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode().catch(() => {});
  const p = paper();
  const w = Math.min(p.w * 0.5, (img.naturalWidth || 400) / PX_PER_MM / 2);
  const hgt = w * ((img.naturalHeight || 300) / (img.naturalWidth || 400));
  const asset = uid('a');
  state.project.assets[asset] = dataUrl;
  const at = pos || { x: p.w / 2, y: p.h / 2 };
  S.addObjects([{ id: uid(), type: 'image', name: 'Image', asset, x: at.x - w / 2, y: at.y - hgt / 2, w, h: hgt, rot: 0, opacity: 1 }]);
}

async function onDrop(e) {
  e.preventDefault();
  const pos = toPage(e);
  const kind = e.dataTransfer.getData('application/x-hws');
  if (kind) return insertItem(kind, pos);
  const file = e.dataTransfer.files?.[0];
  if (file && file.type.startsWith('image/')) {
    const { readFile } = await import('../util.js');
    insertImage(await readFile(file), pos);
  }
}

// ---------- text editing ----------
function onDblClick(e) {
  const hit = e.target.closest('[data-id]');
  const o = hit && S.findObj(hit.dataset.id);
  if (o?.type === 'text' && !o.locked) startEditing(o.id);
}

export function startEditing(id) {
  const o = S.findObj(id);
  if (!o) return;
  if (state.editingId) commitEditor();
  state.editingId = id;
  S.setSelection([id], { expand: false });
  editor = h('div.text-editor',
    h('textarea', { value: o.text, placeholder: 'Type here. ~~cross out~~  __underline__', spellcheck: true }),
    h('div.te-hint', 'Esc or click away to finish · Ctrl+Enter new box below'));
  const ta = editor.querySelector('textarea');
  ta.addEventListener('input', () => {
    o.text = ta.value;
    refreshObjects([o]);
    drawUI();
    positionEditor();
  });
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); commitEditor(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commitEditor();
      const n = S.newTextObject({ x: o.x, w: o.w, hw: { ...o.hw, seed: (Math.random() * 1e9) | 0 } });
      n.y = o.y + o.h + paper().spacing * 0.64;
      n.y = nearestLineY(paper(), n.y + paper().spacing * 0.74) - paper().spacing * 0.74;
      S.addObjects([n]);
      startEditing(n.id);
    }
  });
  ta.addEventListener('blur', () => setTimeout(() => { if (editor && !editor.contains(document.activeElement)) commitEditor(); }, 0));
  document.body.append(editor);
  positionEditor();
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  bus.emit('editing');
}

function positionEditor() {
  if (!editor || !state.editingId) return;
  const o = S.findObj(state.editingId);
  if (!o) return commitEditor();
  const b = aabb([o]);
  const bl = toScreen(b.x, b.y + b.h), br = toScreen(b.x + b.w, b.y + b.h);
  const wsr = ws.getBoundingClientRect();
  const w = Math.max(320, Math.min(br.x - bl.x, 640));
  let top = bl.y + 8;
  const left = clamp(bl.x, wsr.left + 8, wsr.right - w - 8);
  if (top + 150 > wsr.bottom) top = toScreen(b.x, b.y).y - 158;
  Object.assign(editor.style, { left: left + 'px', top: clamp(top, wsr.top + 8, wsr.bottom - 150) + 'px', width: w + 'px' });
}

export function commitEditor() {
  if (!editor) return;
  const ed = editor;
  editor = null;
  state.editingId = null;
  ed.remove();
  S.commit();
  bus.emit('editing');
}

// ---------- zoom ----------
export function setZoom(z, anchor) {
  const old = state.zoom;
  z = clamp(z, 0.25, 6);
  if (Math.abs(z - old) < 1e-4) return;
  const wr = ws.getBoundingClientRect();
  const ax = anchor ? anchor.x - wr.left : wr.width / 2;
  const ay = anchor ? anchor.y - wr.top : wr.height / 2;
  const cx = (ws.scrollLeft + ax) / old, cy = (ws.scrollTop + ay) / old;
  state.zoom = z;
  bus.emit('zoom');
  ws.scrollLeft = cx * z - ax;
  ws.scrollTop = cy * z - ay;
}
export function zoomFit() {
  const p = paper();
  const wr = ws.getBoundingClientRect();
  const z = Math.min((wr.width - 80) / (p.w * PX_PER_MM), (wr.height - 64) / (p.h * PX_PER_MM));
  state.zoom = clamp(z, 0.25, 6);
  bus.emit('zoom');
  ws.scrollTop = 0;
  ws.scrollLeft = (ws.scrollWidth - ws.clientWidth) / 2;
}

function onWheel(e) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    setZoom(state.zoom * Math.exp(-e.deltaY * 0.0022), { x: e.clientX, y: e.clientY });
  }
}

// ---------- keyboard ----------
function nudge(dx, dy) {
  const objs = S.selected().filter((o) => !o.locked);
  if (!objs.length) return;
  objs.forEach((o) => { o.x += dx; o.y += dy; });
  S.commit();
}

const TOOL_KEYS = { v: 'select', t: 'text', r: 'shape:rect', o: 'shape:ellipse', l: 'shape:line', a: 'shape:arrow', p: 'pen', h: 'highlighter' };

function onKey(e) {
  if (isTyping() || document.querySelector('.modal')) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (e.code === 'Space' && !spaceDown) { spaceDown = true; ws.classList.add('panning'); e.preventDefault(); return; }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? S.redo() : S.undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); S.redo(); return; }
  if (mod && k === 'd') { e.preventDefault(); S.duplicateSelected(); return; }
  if (mod && k === 'a') { e.preventDefault(); S.setSelection(S.page().objects.filter((o) => !o.locked && !o.hidden).map((o) => o.id)); return; }
  if (mod && k === 'g') { e.preventDefault(); e.shiftKey ? S.ungroupSelected() : S.groupSelected(); return; }
  if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(state.zoom * 1.2); return; }
  if (mod && e.key === '-') { e.preventDefault(); setZoom(state.zoom / 1.2); return; }
  if (mod && e.key === '0') { e.preventDefault(); zoomFit(); return; }
  if (mod && e.key === ']') { e.preventDefault(); S.arrange(e.shiftKey ? 'front' : 'forward'); return; }
  if (mod && e.key === '[') { e.preventDefault(); S.arrange(e.shiftKey ? 'back' : 'backward'); return; }
  if (mod && k === 's') { e.preventDefault(); S.saveNow(); toast('Saved in this browser'); return; }
  if (mod) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); S.deleteSelected(); return; }
  if (e.key === 'Escape') {
    if (state.paperEdit) return S.setPaperEdit(false);
    S.setSelection([]);
    S.setTool('select');
    return;
  }
  if (state.paperEdit) return; // only undo/redo/zoom while editing paper
  if (e.key === 'Enter' || e.key === 'F2') {
    const o = S.selectedOne();
    if (o?.type === 'text') { e.preventDefault(); startEditing(o.id); }
    return;
  }
  const step = e.shiftKey ? 5 : 0.5;
  if (e.key === 'ArrowLeft') { e.preventDefault(); return nudge(-step, 0); }
  if (e.key === 'ArrowRight') { e.preventDefault(); return nudge(step, 0); }
  if (e.key === 'ArrowUp') { e.preventDefault(); return nudge(0, e.shiftKey ? -paper().spacing : -step); }
  if (e.key === 'ArrowDown') { e.preventDefault(); return nudge(0, e.shiftKey ? paper().spacing : step); }
  if (TOOL_KEYS[k] && !e.altKey) S.setTool(TOOL_KEYS[k]);
}

// ---------- clipboard (system clipboard events) ----------
export function initClipboard() {
  const MARK = 'hwstudio/objects';
  const write = (e) => {
    const sel = S.selected();
    const assets = Object.fromEntries(sel.filter((o) => o.asset).map((o) => [o.asset, state.project.assets[o.asset]]));
    e.clipboardData.setData('text/plain', JSON.stringify({ [MARK]: sel, assets }));
    e.preventDefault();
  };
  document.addEventListener('copy', (e) => {
    if (isTyping() || !state.selection.size) return;
    write(e);
  });
  document.addEventListener('cut', (e) => {
    if (isTyping() || !state.selection.size) return;
    write(e);
    S.deleteSelected();
  });
  document.addEventListener('paste', async (e) => {
    if (isTyping()) return;
    const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      const { readFile } = await import('../util.js');
      return insertImage(await readFile(file));
    }
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    try {
      const data = JSON.parse(text);
      if (data[MARK]) {
        Object.assign(state.project.assets, data.assets || {});
        S.addObjects(S.cloneObjects(data[MARK], 5, 5));
        return;
      }
    } catch { /* plain text */ }
    const o = S.newTextObject({ text });
    const fb = paper().spacing * 0.74;
    o.y = nearestLineY(paper(), paper().firstLine) - fb;
    S.addObjects([o]);
  });
}

export const getSelectionBox = () => aabb(S.selected());
export { aabb };
