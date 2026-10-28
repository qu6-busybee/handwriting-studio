// Places analysed blocks onto ruled notebook pages. Every text box sits on
// the blue lines, between the red margins and the top/bottom boundaries, at
// the chosen handwriting size. Pages are added as needed — text is never
// shrunk to fit and never runs past the bottom of the sheet. Objects already
// on a page (pictures, boxes the user moved) are flowed around, not covered.
//
// Each placed text box remembers what it was (o.flow) so AI edits can turn
// the pages back into blocks and lay them out again.
import * as S from '../state.js';
import { uid, PX_PER_MM } from '../util.js';
import { writingBox, rulingLines, lineAt, tiltAt } from '../paper.js';
import { layoutText } from '../handwriting/engine.js';

const { state } = S;
const IN = 25.4;

// start: 'after' (below existing content on the current page), 'newpage',
// or { page, y } to continue from a given height (used when reflowing).
// A block may carry: hw (keep its handwriting settings), size (text size
// relative to normal), ai (mark the result as AI-generated).
export function placeBlocks(blocks, { start = 'after', indentParagraphs = true, gapParagraphs = false, images = [], tag = {} } = {}) {
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
  const reuse = typeof start === 'object';
  const fixed = new Set(pages.flatMap((pg) => pg.objects.filter((o) => !o.hidden).map((o) => o.id)));
  let pageIdx = typeof start === 'object' ? start.page : state.pageIndex;
  let k = 0; // next slot on the current page
  let used = false; // something already sits above k on this page
  const created = [];
  const placed = [];

  // Slots covered by objects that were on the page before this run.
  const blockCache = new Map();
  const blockedOn = (pg) => {
    if (!blockCache.has(pg)) {
      const set = new Set();
      for (const o of pg.objects) {
        if (!fixed.has(o.id) || o.hidden) continue;
        if (o.x > wb.x + wb.w - 1 || o.x + o.w < wb.x + 1) continue; // outside the writing area
        slots.forEach((i, si) => {
          const y = lineAt(p, i);
          if (o.y < y + p.spacing * 0.2 && o.y + o.h > y - fb) set.add(si);
        });
      }
      blockCache.set(pg, set);
    }
    return blockCache.get(pg);
  };
  const blocked = (si) => blockedOn(pages[pageIdx]).has(si);

  function newPage() {
    // When reflowing, continue onto the pages that follow (flowing around
    // anything placed there by hand) before adding new ones.
    if (reuse && pageIdx + 1 < pages.length) {
      pageIdx += 1;
      k = 0;
      used = false;
      return;
    }
    const pg = { id: uid('pg'), objects: [] };
    pages.splice(pageIdx + 1, 0, pg);
    pageIdx += 1;
    created.push(pg);
    k = 0;
    used = false;
  }
  // Move k to the next free slot (new page when the page is full).
  function free() {
    while (k < slots.length && blocked(k)) { k++; used = true; }
    if (k >= slots.length) { newPage(); free(); }
  }
  const remaining = () => { let n = 0; while (k + n < slots.length && !blocked(k + n)) n++; return n; };

  if (typeof start === 'object') {
    k = slots.findIndex((i) => lineAt(p, i) - fb >= start.y - 0.6);
    used = k > 0;
    if (k < 0) newPage();
  } else {
    const existing = pages[pageIdx].objects.filter((o) => !o.hidden);
    if (start === 'newpage' && existing.length) newPage();
    else if (existing.length) {
      const bottom = Math.max(...existing.map((o) => o.y + o.h));
      k = slots.findIndex((i) => lineAt(p, i) - fb >= bottom + 0.5);
      used = true;
      if (k < 0) newPage();
    }
  }

  const hwFor = (extra = {}) => ({ ...d, seed: (Math.random() * 1e9) | 0, mistakes: 0, ...extra });
  const linesOf = (text, w, hw) => {
    const o = { id: 'measure', text, w, hw };
    return layoutText(o, { writerSeed: project.writer.seed, paper: p, clean: true })?.lineCount || 1;
  };
  let meta = {}; // what the current block is (stored on each piece)
  const addText = (text, x, w, hw, name) => {
    free();
    const i = slots[k];
    const cx = x + w / 2;
    const o = { id: uid(), type: 'text', name, x, y: lineAt(p, i) + tiltAt(p, cx) - fb, w, h: p.spacing, rot: angle, opacity: 1, text, hw, ...tag };
    if (meta.ai) o.ai = true;
    o.flow = { ...meta, x: o.x, y: o.y };
    meta = { ...meta, cont: true }; // later pieces continue the same block
    pages[pageIdx].objects.push(o);
    placed.push(o);
    used = true;
    return o;
  };
  const skip = (n) => { k += n; if (k >= slots.length) newPage(); };
  // Make room for n lines together: next free run on this page, or a new page.
  const ensure = (n) => {
    for (let guard = 0; guard < 200; guard++) {
      free();
      const r = remaining();
      if (r >= n || !used) return; // nothing above it: a new page wouldn't help
      k += r;
      if (k >= slots.length) newPage();
    }
  };

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
      if (!fits) { k += remaining(); if (k >= slots.length) newPage(); free(); continue; }
      addText(fits, x, w, hw, name);
      k += remaining();
      if (k >= slots.length) newPage();
      free();
      hw = { ...hw, seed: (Math.random() * 1e9) | 0 };
      text = rest.replace(/^\t/, '');
      n = linesOf(text, w, hw);
    }
    if (text) { addText(text, x, w, hw, name); skip(n); }
  }

  const blank = () => { if (used) skip(1); };
  const isHead = (b) => b && (b.type === 'heading' || b.type === 'subheading');

  // Puts existing objects (a picture, or a drawing with its labels) on the
  // next free lines, centred, moving them as one.
  function placeObjects(objs, name) {
    const x0 = Math.min(...objs.map((o) => o.x)), y0 = Math.min(...objs.map((o) => o.y));
    const w = Math.max(...objs.map((o) => o.x + o.w)) - x0, h = Math.max(...objs.map((o) => o.y + o.h)) - y0;
    const n = Math.ceil((h + p.spacing * 0.3) / p.spacing);
    if (used) blank();
    ensure(n);
    free();
    const dx = wb.x + Math.max(0, (wb.w - w) / 2) - x0, dy = lineAt(p, slots[k]) - p.spacing * 0.85 - y0;
    for (const o of objs) {
      o.x += dx; o.y += dy;
      if (name) o.name ||= name;
      o.flow = { type: 'figure', x: o.x, y: o.y, group: objs.length > 1 };
      pages[pageIdx].objects.push(o);
      placed.push(o);
    }
    used = true;
    skip(n);
  }

  blocks.forEach((b, bi) => {
    const next = blocks[bi + 1];
    meta = { type: b.type, marker: b.marker, indent: b.indent, ai: b.ai || undefined, size: b.size || undefined };
    // Text size relative to normal (headings default larger).
    const sized = (hw, f) => (f && f !== 1 ? { ...hw, sizeRatio: (d.sizeRatio || 0.37) * f, size: d.size * f } : hw);
    // Keep handwriting chosen earlier for this block (style, seed…).
    const own = () => sized(b.hw || hwFor(), b.size);
    switch (b.type) {
      case 'pagebreak':
        if (used) newPage();
        break;
      case 'heading':
      case 'subheading': {
        const big = b.type === 'heading';
        const hw = sized(b.hw || hwFor(), b.size || (big ? 1.25 : 1.1));
        const n = linesOf(b.text, wb.w, hw);
        if (used) blank();
        // Keep a heading with at least two lines of what follows it.
        const following = next && !isHead(next) && next.text ? Math.min(2, linesOf(next.text, wb.w, hwFor())) : 0;
        ensure(n + following);
        addText(b.text, wb.x, wb.w, hw, big ? 'Heading' : 'Subheading');
        skip(n);
        break;
      }
      case 'paragraph':
        if (gapParagraphs && used && bi > 0 && blocks[bi - 1].type === 'paragraph') blank();
        flow((indentParagraphs ? '\t' : '') + b.text, wb.x, wb.w, own(), 'Paragraph');
        break;
      case 'list': {
        const x = wb.x + b.indent * step;
        flow(`${b.marker} ${b.text}`, x, wb.w - b.indent * step, own(), 'List item', { keep: 4 });
        break;
      }
      case 'definition':
        flow(`__${b.term}__: ${b.def}`, wb.x, wb.w, own(), 'Definition', { keep: 6 });
        break;
      case 'question': {
        const n = linesOf(b.text, wb.w, hwFor());
        const ans = next?.type === 'answer' ? Math.min(2, linesOf(next.text, wb.w - step, hwFor())) : 0;
        if (used && bi > 0 && !isHead(blocks[bi - 1])) blank();
        ensure(n + ans); // keep the question with the start of its answer
        flow(b.text, wb.x, wb.w, own(), 'Question', { keep: n });
        break;
      }
      case 'answer':
        flow(b.text, wb.x + step, wb.w - step, own(), 'Answer', { keep: 4 });
        break;
      case 'equation': {
        const x = wb.x + step * 2;
        const hw = b.hw || hwFor({ neatness: Math.max(d.neatness, 0.7) });
        const n = linesOf(b.text, wb.w - step * 2, hw);
        ensure(n);
        addText(b.text, x, wb.w - step * 2, hw, 'Equation');
        skip(n);
        break;
      }
      case 'table': {
        if (used) blank();
        const cols = Math.max(...b.rows.map((r) => r.length));
        const colW = wb.w / cols;
        meta = { type: 'table' };
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
        const asset = uid('a');
        project.assets[asset] = img.src;
        placeObjects([{ id: uid(), type: 'image', name: 'Diagram', asset, x: 0, y: 0, w, h, rot: 0, opacity: 1, ...tag }]);
        break;
      }
      case 'objects': // existing objects (pictures, drawings) placed in the flow
        if (b.objs?.length) placeObjects(b.objs);
        break;
      default:
        flow(b.text, wb.x, wb.w, own(), 'Text');
    }
  });

  return { placed, created, lastPage: pageIdx };
}

// ---------- pages -> blocks (for AI editing and reflow) ----------

// A text box placed by placeBlocks can be laid out again if it hasn't been
// moved by hand since.
export const isFlowing = (o) => !!o.flow && Math.abs(o.x - o.flow.x) < 0.05 && Math.abs(o.y - o.flow.y) < 0.05 && o.flow.type !== 'table';

// Reading order: page, then top to bottom, then left to right.
export function readingOrder(project = state.project) {
  const out = [];
  project.pages.forEach((pg, pi) => {
    [...pg.objects].filter((o) => !o.hidden).sort((a, b) => (Math.abs(a.y - b.y) > 1 ? a.y - b.y : a.x - b.x)).forEach((o) => out.push({ o, page: pi }));
  });
  return out;
}

// Rebuilds a placed text box's block from its current text (the user may
// have edited it), undoing what placement added (tab, bullet, term markup).
export function blockOf(o) {
  const f = o.flow || {};
  const t = o.text || '';
  switch (f.type) {
    case 'paragraph': return { type: 'paragraph', text: t.replace(/^\t/, '') };
    case 'list': {
      const marker = f.marker || '•';
      return { type: 'list', marker, indent: f.indent || 0, text: t.startsWith(marker + ' ') ? t.slice(marker.length + 1) : t };
    }
    case 'definition': {
      const m = t.match(/^__(.+?)__:\s*([\s\S]*)$/);
      return m ? { type: 'definition', term: m[1], def: m[2], text: `${m[1]}: ${m[2]}` } : { type: 'paragraph', text: t };
    }
    case 'heading': case 'subheading': case 'question': case 'answer': case 'equation': return { type: f.type, text: t };
    default: return { type: 'paragraph', text: t };
  }
}
