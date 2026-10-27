// Turns page objects into SVG. Used by the editor, thumbnails, print and export.
import { svg, rng, gauss, smoothPath } from '../util.js';
import { layoutText } from '../handwriting/engine.js';
import { contentSig } from '../state.js';
import { nearestLineIndex, lineAt, tiltAt, baselineOffsets } from '../paper.js';

const textCache = new Map(); // `${id}|${clean}` -> { sig, out }

// Per-line baseline offsets when the box sits on irregular ruling
// (custom last line or individually adjusted lines).
function rulingOffsets(o, paper) {
  if (o.hw.followLines === false || o.hw.lineSpacing > 0) return null;
  const base = o.y + paper.spacing * 0.74, cx = o.x + o.w / 2;
  const i0 = nearestLineIndex(paper, base, cx);
  if (Math.abs(lineAt(paper, i0) + tiltAt(paper, cx) - base) > paper.spacing * 0.2) return null;
  return baselineOffsets(paper, i0);
}

export function textLayout(o, project, clean = false) {
  const offsets = rulingOffsets(o, project.paper);
  const sig = JSON.stringify([o.text, o.hw, o.w, project.writer.seed, project.paper.spacing, offsets]);
  const key = o.id + '|' + clean;
  const c = textCache.get(key);
  if (c && c.sig === sig) return c.out;
  const out = layoutText(o, { writerSeed: project.writer.seed, paper: project.paper, clean, offsets });
  if (out) textCache.set(key, { sig, out });
  return out;
}

// ctx.handwriting === true forces generated output (example print);
// otherwise it follows the project stage and each box's approval.
export function stageOn(ctx) {
  return ctx.handwriting ?? ctx.project.stage === 'handwriting';
}
export function textIsHandwritten(o, ctx) {
  if (ctx.handwriting) return true;
  return stageOn(ctx) && !!o.gen && o.gen.sig === contentSig(o);
}

// Ink textures in mm units. Ballpoint: rough edges and patchy density.
// Gel: smooth, saturated. Pencil: graphite grain that breaks up the stroke.
export function inkDefs() {
  const attrs = (id) => ({ id, x: '-6%', y: '-25%', width: '112%', height: '150%', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
  const ball = svg('filter', attrs('hw-ink'),
    svg('feTurbulence', { type: 'fractalNoise', baseFrequency: '1.7', numOctaves: '2', seed: '4', result: 'grain' }),
    svg('feDisplacementMap', { in: 'SourceGraphic', in2: 'grain', scale: '0.14', xChannelSelector: 'R', yChannelSelector: 'G', result: 'rough' }),
    svg('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.6', numOctaves: '2', seed: '11', result: 'den' }),
    svg('feColorMatrix', { in: 'den', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.7 1.22', result: 'denA' }),
    svg('feComposite', { in: 'rough', in2: 'denA', operator: 'in' }),
  );
  const gel = svg('filter', attrs('hw-gel'),
    svg('feTurbulence', { type: 'fractalNoise', baseFrequency: '1.2', numOctaves: '1', seed: '6', result: 'grain' }),
    svg('feDisplacementMap', { in: 'SourceGraphic', in2: 'grain', scale: '0.08', xChannelSelector: 'R', yChannelSelector: 'G' }),
  );
  const pencil = svg('filter', attrs('hw-pencil'),
    svg('feTurbulence', { type: 'fractalNoise', baseFrequency: '1.4', numOctaves: '2', seed: '9', result: 'edge' }),
    svg('feDisplacementMap', { in: 'SourceGraphic', in2: 'edge', scale: '0.12', xChannelSelector: 'R', yChannelSelector: 'G', result: 'rough' }),
    svg('feTurbulence', { type: 'fractalNoise', baseFrequency: '6', numOctaves: '2', seed: '3', result: 'grain' }),
    svg('feColorMatrix', { in: 'grain', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.5 1.62', result: 'grainA' }),
    svg('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.45', numOctaves: '1', seed: '21', result: 'press' }),
    svg('feColorMatrix', { in: 'press', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.6 1.25', result: 'pressA' }),
    svg('feComposite', { in: 'grainA', in2: 'pressA', operator: 'arithmetic', k1: '1', k2: '0', k3: '0', k4: '0', result: 'mask' }),
    svg('feComposite', { in: 'rough', in2: 'mask', operator: 'in' }),
  );
  return svg('defs', {}, ball, gel, pencil);
}
const FILTER = { ballpoint: 'hw-ink', gel: 'hw-gel', pencil: 'hw-pencil' };

export const objTransform = (o) =>
  `translate(${o.x + o.w / 2} ${o.y + o.h / 2}) rotate(${o.rot || 0}) translate(${-o.w / 2} ${-o.h / 2})`;

export function objectElement(o, ctx) {
  const { project, editor } = ctx;
  const hwText = o.type === 'text' && textIsHandwritten(o, ctx);
  if (o.type === 'text') {
    const lay = textLayout(o, project, !hwText);
    if (lay) o.h = lay.height; // derived; not an undoable change
  }
  const g = svg('g', { 'data-id': o.id, transform: objTransform(o), opacity: o.opacity ?? 1 });
  if (editor) g.append(svg('rect', { class: 'hit', width: Math.max(o.w, 0.1), height: Math.max(o.h, 0.1), fill: 'transparent' }));
  const inner = svg('g', {});
  // An invisible box keeps the filter region sane for thin objects (lines).
  inner.append(svg('rect', { width: o.w, height: o.h, fill: 'none' }));
  // Ink effects appear only after "Generate Handwriting".
  const on = stageOn(ctx);
  const pen = o.type === 'text' ? o.hw.pen || 'ballpoint' : o.pen || 'ballpoint';
  const textured = o.type === 'text' ? hwText && o.hw.texture !== false : on && o.type !== 'image' && o.texture !== false;
  if (textured) inner.setAttribute('filter', `url(#${FILTER[pen] || 'hw-ink'})`);
  if (o.type === 'text') drawText(inner, o, ctx, hwText);
  else if (o.type === 'shape') drawShape(inner, o, on);
  else if (o.type === 'path') drawPath(inner, o);
  else if (o.type === 'image') {
    const href = project.assets[o.asset] || '';
    inner.append(svg('image', { href, width: o.w, height: o.h, preserveAspectRatio: 'none' }));
  }
  g.append(inner);
  return g;
}

function drawText(g, o, { project, editor }, handwritten) {
  const lay = textLayout(o, project, !handwritten);
  const hw = o.hw;
  if (editor && project.stage === 'handwriting' && !handwritten && o.text?.trim()) {
    // Changed since generation: shown as plain text until regenerated.
    g.append(svg('rect', { class: 'stale-box', x: -1, y: -1, width: o.w + 2, height: (lay?.height || o.h) + 2, rx: 1 }));
  }
  if (!lay) {
    if (editor) g.append(svg('text', { x: 0, y: (project.paper.spacing * 0.74), 'font-size': hw.size * 1.6, fill: '#9aa', 'font-family': 'sans-serif' }, document.createTextNode('Loading handwriting…')));
    return;
  }
  if (!o.text?.trim()) {
    if (editor) {
      const t = svg('text', { x: 1, y: lay.firstBaseline, 'font-size': hw.size * 1.4, fill: '#a7b0bd', 'font-family': 'Inter, sans-serif', 'font-style': 'italic' });
      t.textContent = 'Double-click to write';
      g.append(t);
    }
    return;
  }
  // Editing stage: crisp text in the ink colour, no pen effects.
  const pencil = handwritten && hw.pen === 'pencil';
  const baseOp = pencil ? 0.94 : 1;
  const weight = handwritten ? hw.weight + (pencil ? 0.06 : 0) : 0;
  for (const p of lay.paths) {
    const op = p.op * baseOp, wt = weight * (p.wt || 1);
    if (p.fill) g.append(svg('path', { d: p.fill, fill: hw.color, 'fill-opacity': op, stroke: wt > 0 ? hw.color : null, 'stroke-width': wt || null, 'stroke-opacity': op, 'stroke-linejoin': 'round' }));
    if (p.stroke) g.append(svg('path', { d: p.stroke, fill: 'none', stroke: hw.color, 'stroke-width': hw.penWidth * (p.wt || 1), 'stroke-opacity': op, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  }
  for (const m of lay.marks) {
    g.append(svg('path', { d: m.d, fill: 'none', stroke: hw.color, 'stroke-width': m.w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-opacity': 0.92 * baseOp }));
  }
}

// ---------- hand-drawn shapes ----------
function line(r, hd, x1, y1, x2, y2) {
  if (!hd) return `M${x1} ${y1}L${x2} ${y2}`;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const o1 = gauss(r) * 0.5, o2 = gauss(r) * 0.6;
  const ax = x1 - ux * o1 + gauss(r) * 0.15, ay = y1 - uy * o1 + gauss(r) * 0.15;
  const bx = x2 + ux * o2 + gauss(r) * 0.15, by = y2 + uy * o2 + gauss(r) * 0.15;
  const bow = gauss(r) * Math.min(len * 0.015, 1.2);
  const mx = (ax + bx) / 2 - uy * bow, my = (ay + by) / 2 + ux * bow;
  return `M${ax.toFixed(2)} ${ay.toFixed(2)}Q${mx.toFixed(2)} ${my.toFixed(2)} ${bx.toFixed(2)} ${by.toFixed(2)}`;
}

function poly(r, hd, pts, closed) {
  if (!hd) return 'M' + pts.map((p) => p.join(' ')).join('L') + (closed ? 'Z' : '');
  let d = '';
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    d += line(r, hd, a[0], a[1], b[0], b[1]);
  }
  return d;
}

export function shapePath(o, generated = true) {
  const r = rng(o.seed || 1);
  const { w, h } = o;
  const hd = generated && o.handDrawn !== false;
  const head = Math.min(4 + o.strokeWidth, Math.max(w, 6) * 0.3);
  switch (o.shape) {
    case 'rect':
    case 'highlight':
      return { d: poly(r, hd && o.shape === 'rect', [[0, 0], [w, 0], [w, h], [0, h]], true), closed: true };
    case 'triangle':
      return { d: poly(r, hd, [[w / 2, 0], [w, h], [0, h]], true), closed: true };
    case 'ellipse': {
      const n = 40, start = r() * Math.PI * 2, over = hd ? 0.25 + r() * 0.2 : 0;
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = start + (i / n) * (Math.PI * 2 + over);
        const k = hd ? 1 + gauss(r) * 0.012 + (i / n) * 0.02 : 1;
        pts.push([w / 2 + (Math.cos(t) * w * k) / 2, h / 2 + (Math.sin(t) * h * k) / 2]);
      }
      return { d: smoothPath(pts, !hd), closed: true };
    }
    case 'star': {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? 0.4 : 1;
        pts.push([w / 2 + (Math.cos(a) * w * rr) / 2, h / 2 + (Math.sin(a) * h * rr) / 2 + h * 0.06]);
      }
      return { d: poly(r, hd, pts, true), closed: true };
    }
    case 'line':
      return { d: line(r, hd, 0, h / 2, w, h / 2) };
    case 'arrow':
      return { d: line(r, hd, 0, h / 2, w, h / 2) + line(r, hd, w, h / 2, w - head, h / 2 - head * 0.55) + line(r, hd, w, h / 2, w - head, h / 2 + head * 0.55) };
    case 'double-arrow':
      return { d: line(r, hd, 0, h / 2, w, h / 2) + line(r, hd, w, h / 2, w - head, h / 2 - head * 0.55) + line(r, hd, w, h / 2, w - head, h / 2 + head * 0.55) + line(r, hd, 0, h / 2, head, h / 2 - head * 0.55) + line(r, hd, 0, h / 2, head, h / 2 + head * 0.55) };
    case 'check':
      return { d: smoothPath([[0, h * 0.55], [w * 0.18, h * 0.72], [w * 0.36, h], [w * 0.62, h * 0.45], [w, 0]].map(([x, y]) => [x + (hd ? gauss(r) * 0.3 : 0), y + (hd ? gauss(r) * 0.3 : 0)])) };
    case 'cross':
      return { d: line(r, hd, 0, 0, w, h) + line(r, hd, w, 0, 0, h) };
    case 'underline': {
      const pts = [];
      const n = Math.max(4, Math.round(w / 3));
      for (let i = 0; i <= n; i++) pts.push([(i / n) * w, h / 2 + Math.sin(i * 1.7 + r() * 2) * h * 0.25]);
      return { d: smoothPath(pts) };
    }
    case 'bracket':
      return { d: smoothPath([[w, 0], [w * 0.35, h * 0.05], [w * 0.35, h * 0.45], [0, h / 2], [w * 0.35, h * 0.55], [w * 0.35, h * 0.95], [w, h]]) };
    default:
      return { d: '' };
  }
}

function drawShape(g, o, generated) {
  const { d, closed } = shapePath(o, generated);
  const isHL = o.shape === 'highlight';
  g.append(svg('path', {
    d,
    fill: closed && o.fill && o.fill !== 'none' ? o.fill : 'none',
    'fill-opacity': isHL ? 0.4 : 1,
    stroke: isHL ? 'none' : o.stroke,
    'stroke-width': o.strokeWidth,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }));
}

function drawPath(g, o) {
  const pts = o.points.map(([u, v]) => [u * o.w, v * o.h]);
  g.append(svg('path', {
    d: smoothPath(pts),
    fill: 'none',
    stroke: o.stroke,
    'stroke-width': o.strokeWidth,
    'stroke-opacity': o.highlighter ? 0.4 : 1,
    'stroke-linecap': o.highlighter ? 'butt' : 'round',
    'stroke-linejoin': 'round',
  }));
}

// Content-only group for a page (no paper). editor=true adds hit areas.
export function pageContent(page, ctx) {
  const g = svg('g', { class: 'content' });
  for (const o of page.objects) {
    if (o.hidden) continue;
    g.append(objectElement(o, ctx));
  }
  return g;
}
