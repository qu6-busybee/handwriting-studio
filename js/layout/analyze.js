// Structure recognition for Auto-Layout. Runs entirely on the device and
// never rewrites, summarises or drops content: it only labels each piece
// (heading, paragraph, list item, definition, question/answer, table row,
// equation, diagram) and re-joins lines that were hard-wrapped when copied.

export const BLOCK_TYPES = {
  heading: 'Heading',
  subheading: 'Subheading',
  paragraph: 'Paragraph',
  list: 'List item',
  definition: 'Definition',
  question: 'Question',
  answer: 'Answer',
  table: 'Table',
  equation: 'Equation',
  image: 'Diagram / image',
};

const LIST_RE = /^(\s*)([-*•▪◦·]|\d{1,3}[.)]|[a-zA-Z][.)]|\([a-zA-Z0-9]{1,3}\))\s+(.+)$/;
const DEF_RE = /^([A-Za-z][\w '’()/-]{0,48}?)\s*(?::|\s[-–—]\s)\s*(\S.*)$/;
const Q_RE = /^(Q\d*|Question\s*\d*)\s*[:.)]\s*(.*)$/i;
const A_RE = /^(A\d*|Ans(?:wer)?\s*\d*)\s*[:.)]\s*(.*)$/i;
const IMG_RE = /^⟦diagram (\d+)⟧$/;
const MATH = /[=<>≤≥±×÷√∑∫∞π^]/;

const words = (s) => s.trim().split(/\s+/).filter(Boolean);
const isAllCaps = (s) => /[A-Z]/.test(s) && s === s.toUpperCase() && /^[A-Z0-9 ,&'’:()/-]+$/.test(s);
const titleCase = (s) => words(s).filter((w) => /^[a-z]/.test(w) && w.length > 3).length === 0;

function tableCells(raw) {
  if (/^\s*\|.*\|\s*$/.test(raw)) {
    if (/^\s*\|[\s:|-]+\|\s*$/.test(raw)) return 'sep';
    return raw.trim().slice(1, -1).split('|').map((c) => c.trim());
  }
  if (raw.includes('\t')) {
    const cells = raw.split('\t').map((c) => c.trim()).filter((c, i, a) => c || (i > 0 && i < a.length - 1));
    if (cells.length >= 2) return cells;
  }
  return null;
}

function looksLikeEquation(t) {
  if (!MATH.test(t) || !t.includes('=') && !/[≤≥<>]/.test(t)) return false;
  const longWords = words(t).filter((w) => /^[A-Za-z]{4,}$/.test(w)).length;
  return longWords <= 1 && t.length <= 80;
}

function headingLevel(t, raw, prevBlank, nextBlankOrEnd, isFirst) {
  const md = raw.match(/^\s*(#{1,6})\s+(.+)$/);
  if (md) return md[1].length === 1 ? 1 : 2;
  const w = words(t);
  if (t.length > 70 || w.length > 10 || MATH.test(t)) return 0;
  if (/[.,;!?]$/.test(t) || /["“”]$/.test(t)) return 0;
  if (isAllCaps(t) && w.length <= 8) return 1;
  if (t.endsWith(':') && w.length <= 6) return 2;
  if (prevBlank && nextBlankOrEnd && titleCase(t) && w.length <= 8) return isFirst ? 1 : 2;
  if (isFirst && nextBlankOrEnd && w.length <= 8) return 1;
  return 0;
}

// text -> [{ type, text, level?, marker?, indent?, term?, def?, rows?, image? }]
export function analyze(text, { joinLines = true } = {}) {
  const lines = text.replace(/\r/g, '').replace(/ /g, ' ').split('\n');
  const blocks = [];
  let para = null; // open paragraph/answer block that wrapped lines may join
  let table = null;
  let lastQuestion = false;
  const blankAt = (i) => i < 0 || i >= lines.length || !lines[i].trim();
  const close = () => { para = null; };
  const push = (b) => { blocks.push(b); return b; };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\s+$/, '');
    const t = raw.trim();
    if (!t) { close(); table = null; lastQuestion = false; continue; }

    const img = t.match(IMG_RE);
    if (img) { close(); push({ type: 'image', image: +img[1], text: t }); continue; }

    const cells = tableCells(raw);
    if (cells) {
      close();
      if (cells === 'sep') { if (table) table.header = true; continue; }
      if (!table) table = push({ type: 'table', rows: [], text: '' });
      table.rows.push(cells);
      table.text = table.rows.map((r) => r.join(' | ')).join('\n');
      continue;
    }
    table = null;

    if (looksLikeEquation(t)) { close(); push({ type: 'equation', text: t }); continue; }

    // A short line counts as a heading when it stands alone or when structured
    // content (list, definitions, questions, table) starts right below it.
    const nl = lines[i + 1] || '';
    const structuredNext = LIST_RE.test(nl) || DEF_RE.test(nl.trim()) || Q_RE.test(nl.trim()) || !!tableCells(nl);
    const lvl = headingLevel(t, raw, blankAt(i - 1), blankAt(i + 1) || structuredNext, blocks.length === 0);
    if (lvl) { close(); push({ type: lvl === 1 ? 'heading' : 'subheading', text: t.replace(/^#{1,6}\s+/, '') }); lastQuestion = false; continue; }

    const q = t.match(Q_RE);
    if (q || (t.endsWith('?') && t.length <= 220 && !LIST_RE.test(raw) && !para)) {
      close();
      para = push({ type: 'question', text: t });
      lastQuestion = true;
      continue;
    }
    if (A_RE.test(t)) { close(); para = push({ type: 'answer', text: t }); lastQuestion = false; continue; }

    const li = raw.match(LIST_RE);
    if (li) {
      close();
      const indent = Math.min(3, Math.floor(li[1].replace(/\t/g, '    ').length / 2));
      const marker = /^[-*•▪◦·]$/.test(li[2]) ? '•' : li[2];
      para = push({ type: 'list', marker, indent, text: li[3] });
      continue;
    }

    // A new "Term: meaning" line starts a new definition, even right after one.
    const def = (!para || para.type === 'definition') && t.match(DEF_RE);
    if (def && words(def[1]).length <= 5 && def[2].length >= 2 && !/^(https?|www)/i.test(def[1])) {
      close();
      para = push({ type: 'definition', term: def[1].trim(), def: def[2].trim(), text: t });
      continue;
    }

    // The line after a question starts its answer; otherwise a hard-wrapped
    // line continues the open block.
    if (para && para.type !== 'question') {
      const sep = joinLines ? ' ' : '\n';
      if (para.type === 'definition') para.def += sep + t;
      para.text += sep + t;
      continue;
    }
    para = push({ type: lastQuestion ? 'answer' : 'paragraph', text: t });
    lastQuestion = false;
  }
  return blocks;
}

export function summarize(blocks) {
  const counts = {};
  for (const b of blocks) counts[b.type] = (counts[b.type] || 0) + (b.type === 'table' ? 0 : 1);
  const tables = blocks.filter((b) => b.type === 'table').length;
  const parts = Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${n} ${BLOCK_TYPES[k].toLowerCase()}${n > 1 ? 's' : ''}`);
  if (tables) parts.push(`${tables} table${tables > 1 ? 's' : ''}`);
  return parts.join(' · ') || 'Nothing yet';
}
