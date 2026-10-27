// Handwriting Settings: pen & ink, intensity, style and variation, with a
// live sample. Used for selected text boxes and for the writer defaults.
import { h, svg, toast } from '../util.js';
import * as S from '../state.js';
import { layoutText } from '../handwriting/engine.js';
import { PENS, INK_PRESETS, GRAPHITE_PRESETS, penLook, inkFilter, isPencil } from '../handwriting/pens.js';
import { allStyles, ensureProvider } from '../handwriting/styles.js';
import { section, slider, toggle, select, segmented, colorRow } from './controls.js';

const { state } = S;
const SAMPLE = 'The quick brown fox jumps over the lazy dog.';
const pct = (v) => Math.round(v * 100) + '%';

// Live preview: always rendered as finished handwriting, independent of the
// document's editing stage (the document itself is not changed).
function preview(get) {
  const box = h('div.hw-preview');
  let fid = 'pv-' + Math.random().toString(36).slice(2, 7);
  const draw = () => {
    const g0 = get();
    const size = g0.autoSize ? 8 * (g0.sizeRatio || 0.37) : g0.size; // shown at its real proportions
    const hw = { ...g0, mistakes: 0, followLines: false, lineSpacing: 0, autoSize: false, size: Math.min(4, Math.max(2.2, size)) };
    const o = { id: 'preview', text: SAMPLE, w: 120, hw };
    const lay = layoutText(o, { writerSeed: state.project.writer.seed, paper: state.project.paper });
    if (!lay) { ensureProvider(hw.style).then(draw).catch(() => {}); return; }
    const look = penLook(hw);
    // Crop to the ink so the sample fills the preview width.
    let maxX = 10;
    for (const p of lay.paths) for (const m of (p.fill + p.stroke).matchAll(/[MLQC](-?[\d.]+)/g)) maxX = Math.max(maxX, +m[1]);
    const s = svg('svg', { viewBox: `-1 -1 ${maxX + 3} ${lay.height + 2}`, class: 'hw-preview-svg' });
    const g = svg('g', { opacity: look.opacity });
    if (look.texture > 0) {
      s.append(svg('defs', {}, inkFilter(fid, hw.pen, look.texture, look.soft)));
      g.setAttribute('filter', `url(#${fid})`);
    }
    g.append(svg('rect', { width: 120, height: lay.height, fill: 'none' }));
    for (const p of lay.paths) {
      const col = look.color(p.color || hw.color);
      if (p.fill) g.append(svg('path', { d: p.fill, fill: col, 'fill-opacity': p.op, stroke: look.weight > 0 ? col : null, 'stroke-width': look.weight * (p.wt || 1) || null, 'stroke-linejoin': 'round' }));
      if (p.stroke) g.append(svg('path', { d: p.stroke, fill: 'none', stroke: col, 'stroke-width': look.penWidth * (p.wt || 1), 'stroke-linecap': 'round' }));
    }
    s.append(g);
    box.replaceChildren(s);
  };
  draw();
  return { el: box, draw };
}

function styleOptions(cursive) {
  const all = allStyles().filter((s) => (s.font ? (cursive ? s.category === 'cursive' : s.category !== 'cursive') : true));
  const cats = cursive ? [['cursive', 'Cursive']] : [['neat', 'Neat'], ['casual', 'Casual'], ['rushed', 'Rushed']];
  const out = cats.map(([k, label]) => ({ group: label, items: all.filter((s) => s.font && s.category === k).map((s) => ({ value: s.id, label: s.name })) }));
  const mine = all.filter((s) => !s.font);
  if (mine.length) out.push({ group: 'Your handwriting', items: mine.map((s) => ({ value: s.id, label: s.name })) });
  return out;
}
const isCursive = (id) => allStyles().find((s) => s.id === id)?.category === 'cursive';

// objs: text objects (or [{ hw: writer.defaults }]). opts.defaults = true for
// the writer defaults (no regenerate/restore buttons).
export function hwSettings(objs, { rebuild, defaults = false } = {}) {
  const o0 = objs[0];
  const hw = () => o0.hw;
  let pv;
  const live = () => { pv?.draw(); S.bus.emit('change'); };
  const done = () => { pv?.draw(); S.commit(); };
  const set = (k) => (v) => { objs.forEach((o) => (o.hw[k] = v)); live(); };
  const setC = (k) => (v) => { objs.forEach((o) => (o.hw[k] = v)); done(); };
  const sl = (label, k, def, opts) => slider(label, () => hw()[k] ?? def, { min: 0, max: 1, step: 0.01, fmt: pct, onInput: set(k), onCommit: done, ...opts });
  pv = preview(hw);

  const pen = hw().pen || 'ballpoint';
  const pencil = isPencil(pen);
  const hex = h('input.hex', { type: 'text', value: hw().color, maxlength: 7, title: 'HEX colour, e.g. #22408f' });
  hex.addEventListener('change', () => { if (/^#[0-9a-f]{6}$/i.test(hex.value.trim())) setC('color')(hex.value.trim()); else hex.value = hw().color; });

  const out = [pv.el];
  if (!defaults) out.push(stageNote(objs));

  out.push(section('Pen & ink', [
    select('Instrument', () => pen, Object.entries(PENS).map(([k, p]) => ({ value: k, label: p.label })), (v) => {
      const wasPencil = isPencil(pen), nowPencil = isPencil(v);
      objs.forEach((o) => {
        o.hw.pen = v;
        if (nowPencil && !wasPencil) o.hw.color = GRAPHITE_PRESETS[0].color;
        if (!nowPencil && wasPencil) o.hw.color = INK_PRESETS[0].color;
      });
      done();
      rebuild();
    }),
    colorRow(pencil ? 'Graphite' : 'Ink colour', () => hw().color, (v, c) => { objs.forEach((o) => (o.hw.color = v)); hex.value = v; c ? done() : live(); }, { presets: pencil ? GRAPHITE_PRESETS : INK_PRESETS }),
    h('label.ctl.hexrow', h('span', 'HEX'), hex),
    sl('Ink darkness', 'darkness', 0.5, { tip: 'Lighter or darker than the chosen colour' }),
    sl('Pen pressure', 'pressure', 0.5, { tip: 'Heavier pressure: thicker, darker strokes' }),
    slider('Stroke thickness', () => hw().weight ?? 0.05, { min: 0, max: 0.35, step: 0.01, unit: 'mm', onInput: set('weight'), onCommit: done }),
    pencil && sl('Pencil softness', 'softness', 0.5, { tip: 'Soft graphite: darker, grainier, slightly wider' }),
    sl('Opacity', 'opacity', 1, { min: 0.2 }),
  ].filter(Boolean)));

  out.push(section('Handwriting style', [
    segmented('Type', () => (isCursive(hw().style) ? 'cursive' : 'print'), [['print', 'Print'], ['cursive', 'Cursive']], (v) => {
      const want = v === 'cursive';
      if (want !== isCursive(hw().style)) {
        const first = styleOptions(want).flatMap((g) => g.items)[0];
        if (first) setC('style')(first.value);
      }
      rebuild();
    }),
    select('Style', () => hw().style, styleOptions(isCursive(hw().style)), setC('style')),
    toggle('Size follows lines', () => !!hw().autoSize, (v) => { objs.forEach((o) => (o.hw.autoSize = v)); done(); rebuild(); }, 'Letters scale with the paper’s line spacing'),
    hw().autoSize
      ? slider('Letter size', () => hw().sizeRatio || 0.37, { min: 0.2, max: 0.6, step: 0.01, fmt: pct, onInput: set('sizeRatio'), onCommit: done, tip: 'Lowercase height as a share of the line spacing' })
      : slider('Letter size', () => hw().size, { min: 1.2, max: 9, step: 0.05, unit: 'mm', onInput: set('size'), onCommit: done }),
    sl('Neatness', 'neatness', 0.55),
    sl('Writing speed', 'speed', 0.5, { tip: 'Faster writing: looser letters, more slant and spacing changes' }),
    slider('Slant', () => hw().slant || 0, { min: -20, max: 25, step: 0.5, unit: '°', onInput: set('slant'), onCommit: done }),
    slider('Word spacing', () => hw().wordSpacing ?? 1, { min: 0.4, max: 2.5, step: 0.05, unit: '×', onInput: set('wordSpacing'), onCommit: done }),
    slider('Letter spacing', () => hw().letterSpacing ?? 0, { min: -0.6, max: 1.5, step: 0.02, unit: 'mm', onInput: set('letterSpacing'), onCommit: done }),
  ]));

  out.push(section('Natural variation', [
    h('p.muted.small', 'Keep these subtle for writing that looks natural but stays readable.'),
    slider('Ink consistency', () => 1 - (hw().inkVar ?? 0.5), { min: 0, max: 1, step: 0.01, fmt: pct, onInput: (v) => set('inkVar')(1 - v), onCommit: done, tip: 'How evenly ink is laid down' }),
    sl('Stroke variation', 'strokeVar', 0.5, { tip: 'Thickness changes from letter to letter' }),
    slider('Ink texture', () => (typeof hw().texture === 'number' ? hw().texture : hw().texture === false ? 0 : 0.5), { min: 0, max: 1, step: 0.01, fmt: pct, onInput: set('texture'), onCommit: done }),
    slider('Baseline variation', () => hw().baseVar ?? 1, { min: 0, max: 2, step: 0.05, fmt: pct, onInput: set('baseVar'), onCommit: done }),
    slider('Letter shape variation', () => hw().shapeVar ?? 1, { min: 0, max: 2, step: 0.05, fmt: pct, onInput: set('shapeVar'), onCommit: done }),
    slider('Line-to-line consistency', () => 1 - (hw().lineVar ?? 1) / 2, { min: 0, max: 1, step: 0.01, fmt: pct, onInput: (v) => set('lineVar')((1 - v) * 2), onCommit: done, tip: 'Higher: every line starts and tilts the same way' }),
    sl('Baseline drift', 'drift', 0.5),
    sl('Natural mistakes', 'mistakes', 0, { tip: 'Occasionally misspells a word, crosses it out and rewrites it' }),
    toggle('Sit on ruled lines', () => hw().followLines !== false, (v) => { objs.forEach((o) => (o.hw.followLines = v)); done(); }),
  ], { collapsible: true, open: false }));

  const actions = h('div.btn-col');
  if (!defaults && state.project.stage === 'handwriting') {
    actions.append(h('button.btn', { title: 'Write this section again with fresh natural variation', on: { click: () => S.regenerate(objs) } }, objs.length > 1 ? 'Regenerate these sections' : 'Regenerate this section'));
    if (objs.some((o) => o.gen)) actions.append(h('button.btn', { title: 'Show this box as plain typed text again (your text is unchanged)', on: { click: () => { objs.forEach((o) => delete o.gen); done(); rebuild(); } } }, 'Restore typed text'));
  }
  actions.append(h('button.btn', { title: 'Copy these handwriting settings to every text box on every page', on: { click: () => applyToDocument(o0.hw) } }, 'Apply to entire document'));
  out.push(actions);
  if (!defaults) out.push(h('p.muted.small', 'Tip: while editing text, select words and pick a colour, or “Rewrite words” after generating.'));
  return out.filter(Boolean);
}

const PER_BOX = new Set(['seed', 'wordSeeds']);
export function applyToDocument(src) {
  const copy = Object.fromEntries(Object.entries(src).filter(([k]) => !PER_BOX.has(k)));
  for (const pg of state.project.pages) for (const o of pg.objects) if (o.type === 'text') Object.assign(o.hw, copy);
  Object.assign(state.project.writer.defaults, copy);
  S.commit();
  toast('Applied to every text box and to new text');
}

function stageNote(objs) {
  if (state.project.stage !== 'handwriting') {
    return h('p.stage-note', 'Shown as plain text while you edit. The sample above shows how it will look after ', h('b', 'Generate Handwriting'), '.');
  }
  const stale = objs.filter(S.isStale);
  if (!stale.length) return null;
  return h('div.stage-note.warn', `${stale.length > 1 ? 'Some text has' : 'This text has'} changed since it was generated, so it’s shown as plain text. `,
    h('button.btn.small', { on: { click: () => S.generateHandwriting(stale) } }, 'Generate this section'));
}
