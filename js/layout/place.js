// Places analysed blocks onto ruled notebook pages. Every text box sits on
// the blue lines, between the red margins and the top/bottom boundaries, at
// the chosen handwriting size. Pages are added as needed — text is never
// shrunk to fit and never runs past the bottom of the sheet.
import * as S from '../state.js';
import { uid, PX_PER_MM } from '../util.js';
import { writingBox, rulingLines, lineAt, tiltAt } from '../paper.js';
import { layoutText } from '../handwriting/engine.js';

const { state } = S;
const IN = 25.4;

export function placeBlocks(blocks, { start = 'after', indentParagraphs = true, gapParagraphs = false, images = [] } = {}) {
  const project = state.project;
  const p = project.paper;
  const d = project.writer.defaults;
  const wb = writingBox(p);
  const fb = p.spacing * 0.74;
  const angle = p.lineStyle?.angle || 0;
  const step = 0.375 * IN; // list/answer indent: 3/8 in

  // Usable ruled lines: visible, below the top boundary (with room for
  // ascenders) and above the bottom boundary.
  const slots = rulingLines(p)
    .filter((l) => !l.partial && !l.hidden && l.y - fb >= Math.max(0, p.margins.top - 0.01) && l.y <= p.h - p.margins.bottom)
    .map((l) => l.i);
  if (slots.length < 2) throw new Error('This paper has too few usable lines. Check the paper settings.');

  const pages = project.pages;
  let pageIdx = state.pageIndex;
  let k = 0; // next free slot on the current page
  const created = [];
  const placed = [];

  // Where to begin: after existing content on this page, or on a new page.
  const existing = pages[pageIdx].objects.filter((o) => !o.hidden);
  if (start === 'newpage' && existing.length) {
    newPage();
  } else if (existing.length) {
    const bottom = Math.max(...existing.map((o) => o.y + o.h));
    k = slots.findIndex((i) => lineAt(p, i) - fb >= bottom + 0.5);
    if (k < 0) newPage();
  }

  function newPage() {
    const pg = { id: uid('pg'), objects: [] };
    pages.splice(pageIdx + 1, 0, pg);
    pageIdx += 1;
    created.push(pg);
    k = 0;
  }
  const remaining = () => slots.length - k;
  const hwFor = (extra = {}) => ({ ...d, seed: (Math.random() * 1e9) | 0, mistakes: 0, ...extra });
  const linesOf = (text, w, hw) => {
    const o = { id: 'measure', text, w, hw };
    return layoutText(o, { writerSeed: project.writer.seed, paper: p, clean: true })?.lineCount || 1;
  };
  const addText = (text, x, w, hw, name) => {
    const i = slots[k];
    const cx = x + w / 2;
    const o = { id: uid(), type: 'text', name, x, y: lineAt(p, i) + tiltAt(p, cx) - fb, w, h: p.spacing, rot: angle, opacity: 1, text, hw };
    pages[pageIdx].objects.push(o);
    placed.push(o);
    return o;
  };
  const skip = (n) => { k += n; if (remaining() <= 0) newPage(); };
  const ensure = (n) => { if (remaining() < n && k > 0) newPage(); };

  // Fit as many words as possible into `maxLines`, return [fits, rest].
  function split(text, w, hw, maxLines) {
    const ws = text.split(/(?<=\s)/);
    let lo = 0, hi = ws.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (linesOf(ws.slice(0, mid).join(''), w, hw) <= maxLines) lo = mid; else hi = mid - 1;
    }
    return [ws.slice(0, lo).join('').trimEnd(), ws.slice(lo).join('').trimStart()];
  }

  // Place text that may continue across pages (paragraphs, long answers).
  function flow(text, x, w, hw, name, { keep = 0 } = {}) {
    let n = linesOf(text, w, hw);
    if (keep && n <= keep) ensure(n); // short blocks stay together
    else ensure(Math.min(n, 2)); // never leave a single orphan line
    while (n > remaining()) {
      const [fits, rest] = split(text, w, hw, remaining());
      if (!fits) { newPage(); continue; }
      addText(fits, x, w, hw, name);
      newPage();
      text = rest.replace(/^\t/, '');
      n = linesOf(text, w, hw);
    }
    if (text) { addText(text, x, w, hw, name); skip(n); }
  }

  const blank = () => { if (k > 0) skip(1); };

  blocks.forEach((b, bi) => {
    const next = blocks[bi + 1];
    switch (b.type) {
      case 'heading':
      case 'subheading': {
        const big = b.type === 'heading';
        const hw = hwFor({ sizeRatio: (d.sizeRatio || 0.37) * (big ? 1.25 : 1.1), size: d.size * (big ? 1.25 : 1.1) });
        const n = linesOf(b.text, wb.w, hw);
        if (k > 0) blank();
        // Keep a heading with at least two lines of what follows it.
        const following = next && next.type !== 'heading' && next.type !== 'subheading' ? Math.min(2, linesOf(next.text || '', wb.w, hwFor())) : 0;
        ensure(n + following);
        addText(b.text, wb.x, wb.w, hw, big ? 'Heading' : 'Subheading');
        skip(n);
        break;
      }
      case 'paragraph':
        if (gapParagraphs && k > 0 && bi > 0 && blocks[bi - 1].type === 'paragraph') blank();
        flow((indentParagraphs ? '\t' : '') + b.text, wb.x, wb.w, hwFor(), 'Paragraph');
        break;
      case 'list': {
        const x = wb.x + b.indent * step;
        flow(`${b.marker} ${b.text}`, x, wb.w - b.indent * step, hwFor(), 'List item', { keep: 4 });
        break;
      }
      case 'definition':
        flow(`__${b.term}__: ${b.def}`, wb.x, wb.w, hwFor(), 'Definition', { keep: 6 });
        break;
      case 'question': {
        const n = linesOf(b.text, wb.w, hwFor());
        const ans = next?.type === 'answer' ? Math.min(2, linesOf(next.text, wb.w - step, hwFor())) : 0;
        if (k > 0 && bi > 0 && blocks[bi - 1].type !== 'heading' && blocks[bi - 1].type !== 'subheading') blank();
        ensure(n + ans); // keep the question with the start of its answer
        flow(b.text, wb.x, wb.w, hwFor(), 'Question', { keep: n });
        break;
      }
      case 'answer':
        flow(b.text, wb.x + step, wb.w - step, hwFor(), 'Answer', { keep: 4 });
        break;
      case 'equation': {
        const x = wb.x + step * 2;
        const n = linesOf(b.text, wb.w - step * 2, hwFor());
        ensure(n);
        addText(b.text, x, wb.w - step * 2, hwFor({ neatness: Math.max(d.neatness, 0.7) }), 'Equation');
        skip(n);
        break;
      }
      case 'table': {
        if (k > 0) blank();
        const cols = Math.max(...b.rows.map((r) => r.length));
        const colW = wb.w / cols;
        b.rows.forEach((row, ri) => {
          const hw = hwFor();
          const cells = Array.from({ length: cols }, (_, c) => row[c] || '');
          const header = ri === 0 && (b.header || b.rows.length > 2);
          const texts = cells.map((c) => (header && c ? `__${c}__` : c));
          const n = Math.max(1, ...texts.map((c) => (c ? linesOf(c, colW - 2, hw) : 1)));
          ensure(n);
          texts.forEach((c, ci) => { if (c) addText(c, wb.x + ci * colW, colW - 2, { ...hw, seed: (Math.random() * 1e9) | 0 }, 'Table cell'); });
          skip(n);
        });
        blank();
        break;
      }
      case 'image': {
        const img = images[b.image - 1];
        if (!img) break;
        const w = Math.min(wb.w * 0.7, img.w / PX_PER_MM / 2 || wb.w * 0.5);
        const h = w * (img.h / img.w || 0.75);
        const n = Math.ceil((h + p.spacing * 0.3) / p.spacing);
        if (k > 0) blank();
        ensure(n);
        const asset = uid('a');
        project.assets[asset] = img.src;
        const o = { id: uid(), type: 'image', name: 'Diagram', asset, x: wb.x + (wb.w - w) / 2, y: lineAt(p, slots[k]) - p.spacing * 0.85, w, h, rot: 0, opacity: 1 };
        pages[pageIdx].objects.push(o);
        placed.push(o);
        skip(n);
        break;
      }
      default:
        flow(b.text, wb.x, wb.w, hwFor(), 'Text');
    }
  });

  return { placed, created, lastPage: pageIdx };
}
