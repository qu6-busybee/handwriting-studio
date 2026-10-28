// "Hand-Drawn Images": turn a photo, screenshot, diagram or chart into a
// simple pen or pencil illustration made of vector strokes. The original
// picture is kept with the drawing so it can be redrawn in another style.
import { h, toast, uid, svg, readFile, debounce, smoothPath, acceptFiles, dropBox } from '../util.js';
import * as S from '../state.js';
import { openModal } from '../ui/modal.js';
import { writingBox } from '../paper.js';
import { traceImage, diagramStrokes, DRAW_STYLES } from './trace.js';
import { can, upgradeDialog } from '../plan.js';
import { ask, imageBlock, costLabel, getKey } from '../layout/claude.js';
import { DIAGRAM, diagramObjects } from '../ai/common.js';
import { INK_PRESETS } from '../handwriting/pens.js';

const { state } = S;

const SLIDERS = [
  ['detail', 'Detail'], ['simplicity', 'Simplify'], ['smoothness', 'Smoothness'], ['shading', 'Shading'], ['darkness', 'Darkness'],
];

// target: an existing drawing to redraw, or an image object to convert.
export function openHandDrawn(target = null) {
  if (!can('drawings')) return upgradeDialog('drawings');
  const m = openModal('Hand-Drawn Images', { wide: true });
  m.el.classList.add('draw-dialog');
  const existing = target?.type === 'drawing' ? target : null;
  let src = existing ? state.project.assets[existing.source] : target?.type === 'image' ? state.project.assets[target.asset] : null;
  let styleId = existing?.drawStyle && DRAW_STYLES[existing.drawStyle] ? existing.drawStyle : 'ballpoint';
  let set = { ...DRAW_STYLES[styleId], removeBg: true, ...(existing?.settings || {}) };
  if (existing) Object.assign(set, { color: existing.stroke, width: existing.strokeWidth, darkness: existing.darkness, pen: existing.pen });
  let result = null; // { strokes, aspect, labels? }
  let seq = 0;

  const stage = h('div.draw-stage');
  const status = h('div.ai-status');

  const show = () => {
    if (!src) {
      stage.replaceChildren(dropBox('Drag and drop an image here, or click to browse', 'Photo, screenshot, diagram or chart · Ctrl V pastes one', pick));
      return;
    }
    const orig = h('img.draw-orig', { src, alt: 'Original' });
    const W = 100, H = result ? 100 * result.aspect : 75;
    const view = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'draw-svg' });
    if (result) {
      const alpha = 0.35 + set.darkness * 0.65;
      for (const [shade, f, op] of [[false, 1, 1], [true, 0.6, 0.7]]) {
        const d = result.strokes.filter((s) => (s.s < 1) === shade).map((s) => smoothPath(s.p.map(([u, v]) => [u * W, v * H]))).join('');
        // Line width shown at the size the drawing is inserted (about 9 cm).
        if (d) view.append(svg('path', { d, fill: 'none', stroke: set.color, 'stroke-width': set.width * f * (100 / 90), 'stroke-opacity': alpha * op, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      }
      for (const l of result.labels || []) view.append(svg('text', { x: l.u * W, y: l.v * H, 'font-size': 3.2, 'text-anchor': 'middle', fill: set.color, 'font-family': 'Arimo, sans-serif' }, document.createTextNode(l.text)));
    }
    stage.replaceChildren(h('div.draw-pair', h('figure', orig, h('figcaption', 'Original')), h('figure', view, h('figcaption', result?.labels ? 'Redrawn by Claude' : 'Hand-drawn'))));
  };

  const retrace = debounce(async () => {
    if (!src) return show();
    const mine = ++seq;
    status.textContent = 'Drawing…';
    try {
      const r = await traceImage(src, set);
      if (mine !== seq) return;
      result = r;
      status.textContent = `${r.strokes.length} strokes. Drag the sliders to change the look.`;
    } catch (e) {
      if (mine !== seq) return;
      result = null;
      status.textContent = e.message;
    }
    show();
  }, 180);

  async function useFile(file) {
    if (!file || !/^image\//.test(file.type)) return toast('Choose a PNG, JPEG, GIF or WebP image');
    src = await readFile(file);
    result = null;
    retrace();
  }
  function pick() {
    const i = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp' });
    i.onchange = () => useFile(i.files[0]);
    i.click();
  }
  acceptFiles(m.el, (fs) => useFile(fs[0]), (f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type));

  // ---------- controls ----------
  const sliders = new Map();
  const styleSel = h('select', { on: { change: () => { styleId = styleSel.value; set = { ...DRAW_STYLES[styleId], removeBg: set.removeBg }; syncControls(); retrace(); } } },
    ...Object.entries(DRAW_STYLES).map(([k, s]) => h('option', { value: k }, s.label)));
  styleSel.value = styleId;
  const colorIn = h('input', { type: 'color', value: set.color, on: { input: () => { set.color = colorIn.value; show(); } } });
  const swatches = h('div.swatches', ...INK_PRESETS.slice(0, 6).map((c) => h('button.swatch', { title: c.name, style: { background: c.color }, on: { click: () => { set.color = c.color; colorIn.value = c.color; show(); } } })));
  const width = h('input', { type: 'range', min: 0.15, max: 1.2, step: 0.05, value: set.width, on: { input: () => { set.width = +width.value; show(); } } });
  const bg = h('input', { type: 'checkbox', checked: set.removeBg, on: { change: () => { set.removeBg = bg.checked; retrace(); } } });
  for (const [k, label] of SLIDERS) {
    const el = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: set[k], on: { input: () => { set[k] = +el.value; if (k === 'darkness') show(); else retrace(); } } });
    sliders.set(k, h('label.field', h('span', label), el));
  }
  function syncControls() {
    for (const [k] of SLIDERS) sliders.get(k).querySelector('input').value = set[k];
    width.value = set.width;
    colorIn.value = set.color;
  }

  const simplifyBtn = h('button.btn', { title: 'Remove small details, keep the main shapes', on: { click: () => { Object.assign(set, { simplicity: 0.88, detail: 0.18, shading: 0, smoothness: Math.max(set.smoothness, 0.8) }); syncControls(); retrace(); } } }, 'Simplify Drawing');

  // Claude can redraw a diagram as clean shapes with editable labels.
  const claudeBtn = h('button.btn', { title: 'Best for scientific diagrams and charts: keeps the important structures and labels', on: { click: async () => {
    if (!src) return toast('Add an image first');
    if (!getKey()) return toast('Add your Anthropic API key in Build Project or Edit Project first', 4000);
    claudeBtn.disabled = true;
    try {
      const r = await ask({
        system: 'You redraw pictures as simple, recognisable hand-drawn line diagrams for a student\'s notebook. Keep the important structures and every label that matters; drop decoration, texture and colour. Use a grid 100 wide; "height" fits the picture\'s proportions (20–160). Shapes: line / arrow / polyline / curve (points along it) / rect (two corners) / circle or ellipse (centre, then a point giving the radii). At most 40 shapes and 15 labels; labels are short and placed at their centre point. "title" names what is shown.',
        content: [imageBlock(src), { type: 'text', text: 'Redraw this picture as a clean hand-drawn diagram.' }],
        schema: DIAGRAM,
        status: 'Claude is redrawing the picture…',
      }, { onStatus: (s) => { status.textContent = s; } });
      seq++; // ignore any trace still running
      const d = diagramStrokes(r.data, set.wobble ?? 0.5);
      result = { ...d, spec: r.data };
      status.textContent = `Redrawn by Claude: ${r.data.title} (${costLabel(r)}). Labels become editable text.`;
      show();
    } catch (e) {
      status.textContent = e.message;
    } finally {
      claudeBtn.disabled = false;
    }
  } } }, 'Redraw with Claude');

  const insert = () => {
    if (!result) return toast(src ? 'Wait for the drawing to finish' : 'Add an image first');
    const p = state.project;
    const wb = writingBox(p.paper);
    const asset = existing?.source || (target?.type === 'image' ? target.asset : null) || uid('a');
    p.assets[asset] ||= src;
    const look = { stroke: set.color, strokeWidth: set.width, pen: set.pen, darkness: set.darkness, texture: true, drawStyle: styleId, source: asset, settings: { detail: set.detail, simplicity: set.simplicity, smoothness: set.smoothness, shading: set.shading, removeBg: set.removeBg, wobble: set.wobble } };
    if (result.spec) {
      // Claude's version: a drawing plus label text boxes, grouped.
      const objs = diagramObjects(result.spec, result.spec.title);
      Object.assign(objs[0], look, { spec: result.spec });
      const anchor = existing || target;
      const ox = anchor ? anchor.x : wb.x + (wb.w - objs[0].w) / 2, oy = anchor ? anchor.y : (p.paper.margins?.top ?? 20) + p.paper.spacing;
      for (const o of objs) { o.x += ox; o.y += oy; }
      if (anchor) S.page().objects = S.page().objects.filter((o) => o.id !== anchor.id && !(anchor.groupId && o.groupId === anchor.groupId));
      S.addObjects(objs);
    } else if (existing) {
      Object.assign(existing, look, { strokes: result.strokes, h: existing.w * result.aspect });
      delete existing.spec;
      S.commit();
    } else {
      const w = target ? target.w : Math.min(wb.w * 0.6, 90);
      const o = { id: uid(), type: 'drawing', name: 'Drawing', x: target ? target.x : wb.x + (wb.w - w) / 2, y: target ? target.y : (p.paper.margins?.top ?? 20) + p.paper.spacing, w, h: w * result.aspect, rot: target?.rot || 0, opacity: 1, strokes: result.strokes, ...look };
      if (target) S.page().objects = S.page().objects.filter((x) => x.id !== target.id);
      S.addObjects([o]);
    }
    m.close();
    toast('Drawing added. Drag, resize or rotate it like any object.');
  };

  m.body.classList.add('draw-layout');
  m.body.append(
    h('div.draw-left', stage, status),
    h('div.draw-right',
      h('div.row', h('button.btn', { on: { click: pick } }, src ? 'Change image…' : 'Choose image…'), h('span.muted.small', 'or paste')),
      h('label.field', h('span', 'Style'), styleSel),
      h('div.field', h('span', 'Colour'), h('div.row.tight', swatches, colorIn)),
      h('label.field', h('span', 'Line thickness'), width),
      ...sliders.values(),
      h('label.check', bg, 'Remove background'),
      h('div.btn-row', simplifyBtn, claudeBtn)));
  m.foot.append(
    h('span.muted.small.grow', 'Drawn on your device as vector lines, so it prints sharp. “Redraw with Claude” sends the picture to Anthropic.'),
    h('button.btn', { on: { click: m.close } }, 'Cancel'),
    h('button.btn.primary', { on: { click: insert } }, existing || target ? 'Replace' : 'Insert drawing'));
  show();
  if (src) retrace();
}
