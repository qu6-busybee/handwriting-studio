// Shared pieces for the AI Project Builder and AI Edit Project: the block
// format Claude writes, the API key box, and turning blocks into objects.
import { h, toast, uid, readFile } from '../util.js';
import * as S from '../state.js';
import { getKey, setKey, isRemembered, MODEL } from '../layout/claude.js';
import { diagramStrokes, DRAW_STYLES } from '../drawing/trace.js';
import { writingBox } from '../paper.js';
import { layoutText } from '../handwriting/engine.js';

const { state } = S;

export const DIAGRAM = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'height', 'shapes', 'labels'],
  properties: {
    title: { type: 'string' },
    height: { type: 'number' },
    shapes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind', 'points'], properties: {
      kind: { type: 'string', enum: ['line', 'arrow', 'polyline', 'curve', 'rect', 'circle', 'ellipse'] },
      points: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
    } } },
    labels: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['x', 'y', 'text'], properties: { x: { type: 'number' }, y: { type: 'number' }, text: { type: 'string' } } } },
  },
};

export const BLOCK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'type', 'text', 'term', 'definition', 'marker', 'indent', 'size', 'rows', 'diagram'],
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['heading', 'subheading', 'paragraph', 'list', 'definition', 'question', 'answer', 'equation', 'table', 'diagram', 'figure', 'placeholder', 'pagebreak'] },
    text: { type: 'string' },
    term: { type: 'string' },
    definition: { type: 'string' },
    marker: { type: 'string' },
    indent: { type: 'integer' },
    size: { type: 'number' },
    rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
    diagram: { anyOf: [{ type: 'null' }, DIAGRAM] },
  },
};

export const BLOCK_RULES = `Block types:
- heading (one main title), subheading (section headings), paragraph, list (one item per block: "marker" is "•" or "1." etc., "indent" 0–2), definition ("term" + "definition"), question / answer, equation (plain characters, e.g. x^2, ×, ÷), table ("rows", first row = header).
- placeholder: something only the student can supply. "text" says exactly what to add, e.g. "Add your own observation from the experiment".
- diagram: a simple hand-drawable line diagram in "diagram": a grid 100 wide and "height" tall (40–120). "shapes": line / arrow / polyline / curve (points along it) / rect (two corners) / circle or ellipse (centre, then a point giving the radii). "labels": short words placed at x, y (the label's centre). At most 25 shapes and 10 labels; keep it clean and recognisable, like a student's notebook sketch. "text" = a one-line caption.
- figure: an existing picture or drawing, referenced by "id".
- pagebreak: start a new page (only when really needed).
Fields that don't apply: "" for strings, 0 for indent, 1 for size, [] for rows, null for diagram. "size" is the text size relative to normal (1); use it only when asked to make something bigger or smaller.
Write plain text only: no Markdown, no asterisks or #. Lists use list blocks.`;

export const HONESTY = `Never invent facts you are unsure of, quotations, citations, sources, URLs, statistics, data, or personal experiences and opinions of the student. Use only well-established general knowledge and what the student provided. Where something only the student can give is needed, write a placeholder block instead.`;

// ---------- API key ----------
export function keyBox(onChange) {
  const box = h('div.ai-key');
  const render = () => {
    if (getKey()) {
      box.replaceChildren(h('span.muted.small.grow', `Using your Anthropic key (${MODEL}). ${isRemembered() ? 'Saved in this browser.' : 'Kept for this session.'}`),
        h('button.btn.small.ghost', { on: { click: () => { setKey(null); render(); onChange?.(); } } }, 'Remove key'));
    } else {
      const keyIn = h('input', { type: 'password', placeholder: 'Anthropic API key (sk-ant-…)', autocomplete: 'off', spellcheck: false });
      const remember = h('input', { type: 'checkbox' });
      box.replaceChildren(
        h('p.muted.small', 'These AI tools use your own Anthropic API key. It stays in this browser and is sent only to Anthropic; usage is billed to your Anthropic account.'),
        h('div.row', keyIn, h('label.check', remember, 'Remember'), h('button.btn', { on: { click: () => {
          const k = keyIn.value.trim();
          if (!/^sk-ant-/.test(k)) return toast('That doesn’t look like an Anthropic API key (sk-ant-…)');
          setKey(k, remember.checked);
          render();
          onChange?.();
        } } }, 'Use key')));
    }
  };
  render();
  return box;
}

// ---------- files for Claude ----------
// Reads a file into a content block: PDFs and images go to Claude as they
// are (real document and image understanding); Word and text files as text.
export async function fileToContent(file, readText) {
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    const url = await readFile(file);
    return { kind: 'pdf', name: file.name, block: { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: url.split(',')[1] }, title: file.name } };
  }
  if (/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
    const url = await readFile(file);
    return { kind: 'image', name: file.name, src: url, block: { type: 'image', source: { type: 'base64', media_type: file.type, data: url.split(',')[1] } } };
  }
  const text = await readText(file);
  return { kind: 'text', name: file.name, block: { type: 'text', text: `File “${file.name}”:\n\n${text}` } };
}

// ---------- blocks -> objects ----------
// A diagram block becomes a hand-drawn drawing plus editable label text
// boxes, grouped so they move together.
export function diagramObjects(spec, caption, tag = {}) {
  const p = state.project.paper;
  const wb = writingBox(p);
  const st = DRAW_STYLES.notebook;
  const { strokes, aspect, labels } = diagramStrokes(spec, st.wobble);
  const w = Math.min(wb.w * 0.8, 130);
  const hgt = w * aspect;
  const gid = uid('g');
  const draw = {
    id: uid(), type: 'drawing', name: caption ? `Diagram: ${caption}` : 'Diagram', x: 0, y: 0, w, h: hgt, rot: 0, opacity: 1,
    strokes, stroke: st.color, strokeWidth: st.width, pen: st.pen, darkness: st.darkness, texture: true,
    drawStyle: 'notebook', spec, groupId: gid, ...tag,
  };
  const d = state.project.writer.defaults;
  const hw = { ...d, sizeRatio: (d.sizeRatio || 0.37) * 0.8, size: d.size * 0.8, mistakes: 0 };
  const out = [draw];
  for (const l of labels) {
    const tw = Math.min(w * 0.6, measure(l.text, hw) + 2);
    out.push({ id: uid(), type: 'text', name: 'Label', x: Math.max(0, Math.min(w - tw, l.u * w - tw / 2)), y: l.v * hgt - p.spacing * 0.5, w: tw, h: p.spacing, rot: 0, opacity: 1, text: l.text, hw: { ...hw, seed: (Math.random() * 1e9) | 0 }, groupId: gid, label: true, ...tag });
  }
  return out;
}

// Width of one line of clean text, in mm.
function measure(text, hw) {
  let lo = 4, hi = 200;
  const lines = (w) => layoutText({ id: 'm', text, w, hw }, { writerSeed: state.project.writer.seed, paper: state.project.paper, clean: true })?.lineCount || 1;
  for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (lines(mid) > 1) lo = mid; else hi = mid; }
  return hi;
}

// Claude's blocks -> blocks the placement engine understands.
// figures: id -> array of existing objects (for edits).
export function toPlaceable(raw, { figures = new Map(), keep = new Map(), images = new Map(), ai = true } = {}) {
  const out = [];
  for (const b of raw) {
    const prev = keep.get(b.id); // earlier block with the same id
    const base = { ai: prev ? prev.ai || (prev.text !== b.text) : ai, size: b.size && Math.abs(b.size - 1) > 0.02 ? Math.max(0.6, Math.min(2, b.size)) : undefined, hw: prev?.hw };
    switch (b.type) {
      case 'pagebreak': out.push({ type: 'pagebreak' }); break;
      case 'figure': {
        const objs = figures.get(b.id);
        if (objs) out.push({ type: 'objects', objs });
        else if (images.has(b.id)) out.push({ type: 'objects', objs: [images.get(b.id)()] });
        break;
      }
      case 'diagram':
        if (b.diagram?.shapes?.length) out.push({ type: 'objects', objs: diagramObjects(b.diagram, b.text, ai ? { ai: true } : {}) });
        break;
      case 'placeholder':
        out.push({ ...base, type: 'paragraph', text: `[red][To add: ${b.text.replace(/^\[?to add:\s*/i, '').replace(/\]$/, '')}][/]`, placeholder: true });
        break;
      case 'table':
        if (b.rows?.length) out.push({ ...base, type: 'table', rows: b.rows, header: true });
        break;
      case 'definition':
        if (b.term && b.definition) out.push({ ...base, type: 'definition', term: b.term, def: b.definition, text: `${b.term}: ${b.definition}` });
        else if (b.text) out.push({ ...base, type: 'paragraph', text: b.text });
        break;
      case 'list':
        out.push({ ...base, type: 'list', marker: b.marker || '•', indent: Math.max(0, Math.min(2, b.indent | 0)), text: b.text });
        break;
      default:
        if (b.text?.trim()) out.push({ ...base, type: b.type, text: b.text.trim() });
    }
  }
  return out;
}

// Rough words that fit on one page at the current handwriting size.
export function wordsPerPage() {
  const p = state.project.paper;
  const wb = writingBox(p);
  const sample = 'The water cycle moves water between the land, the oceans and the air. '.repeat(8);
  const lines = layoutText({ id: 'm', text: sample, w: wb.w, hw: state.project.writer.defaults }, { writerSeed: 1, paper: p, clean: true })?.lineCount || 10;
  const perLine = sample.split(/\s+/).filter(Boolean).length / lines;
  const rows = Math.floor((p.h - (p.margins?.top ?? 20) - (p.margins?.bottom ?? 10)) / p.spacing);
  return Math.round(perLine * rows * 0.85);
}
