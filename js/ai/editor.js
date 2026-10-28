// AI Edit Project: natural-language changes to the project ("make the
// introduction shorter", "turn these definitions into a numbered list").
// Claude proposes revised blocks; the user sees a preview of every change and
// accepts or rejects it. Accepted changes are laid out again on the pages
// (adding or removing pages as needed); boxes the user positioned by hand
// stay where they are. A version is saved first, and Undo works too.
import { h, toast } from '../util.js';
import * as S from '../state.js';
import { openModal } from '../ui/modal.js';
import { ask, costLabel, getKey } from '../layout/claude.js';
import { placeBlocks, readingOrder, blockOf, isFlowing } from '../layout/place.js';
import { can, upgradeDialog } from '../plan.js';
import { BLOCK_SCHEMA, BLOCK_RULES, HONESTY, keyBox, toPlaceable } from './common.js';
import { saveVersion } from './history.js';

const { state } = S;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'blocks'],
  properties: {
    summary: { type: 'string' },
    blocks: { type: 'array', items: BLOCK_SCHEMA },
  },
};

const SYSTEM = `You edit a school project that is laid out on notebook pages, following the student's instruction.

You receive the whole document as blocks in reading order. Each has an "id", the "page" it is on, and "in_scope". Change only in-scope blocks; the others are context.

Return in "blocks" the complete new sequence that replaces ALL in-scope blocks, in order:
- Keep the "id" of every block you keep or revise. Use "" for new blocks.
- Copy unchanged blocks exactly (same text, type and fields).
- A block you leave out is deleted. Only delete when the instruction asks for it or clearly implies it.
- Figures (pictures and drawings) are blocks of type "figure": keep them with the same id, and put them where they belong. To redraw a diagram (e.g. "simplify the diagram"), return a "diagram" block with the figure's id.
- To move something onto a later page you may add "pagebreak" blocks.
- Blocks marked "fixed" were positioned by hand: you may change their text but they stay where they are.
"summary": one or two plain sentences describing what you changed.

${HONESTY}

${BLOCK_RULES}`;

// The document as items in reading order. Pieces of one paragraph that
// continue across pages are joined; drawings with their labels are one item.
export function documentItems() {
  const items = [];
  const groups = new Map();
  let last = null;
  for (const { o, page } of readingOrder()) {
    if (o.groupId) {
      if (groups.has(o.groupId)) { groups.get(o.groupId).objs.push(o); continue; }
      const it = { kind: 'figure', objs: [o], page, flowing: isFlowing(o) };
      groups.set(o.groupId, it);
      items.push(it);
      last = null;
      continue;
    }
    if (o.type !== 'text') {
      items.push({ kind: 'figure', objs: [o], page, flowing: isFlowing(o) });
      last = null;
      continue;
    }
    const flowing = isFlowing(o);
    if (o.flow?.cont && last?.flowing && flowing) { last.objs.push(o); continue; }
    last = { kind: 'text', objs: [o], page, flowing };
    items.push(last);
  }
  items.forEach((it, i) => {
    it.id = `b${i + 1}`;
    if (it.kind !== 'text') return;
    const o = it.objs[0];
    it.block = o.flow ? blockOf(o) : { type: 'paragraph', text: o.text || '' };
    for (const piece of it.objs.slice(1)) {
      const t = piece.text.trim();
      if (it.block.type === 'definition') it.block.def += ' ' + t;
      it.block.text += ' ' + t;
    }
    if (it.block.type === 'definition') it.block.text = `${it.block.term}: ${it.block.def}`;
  });
  return items;
}

const describe = (it) => {
  if (it.kind === 'figure') {
    const main = it.objs.find((o) => o.type !== 'text') || it.objs[0];
    const labels = it.objs.filter((o) => o.type === 'text').map((o) => o.text);
    return `${main.type === 'image' ? 'picture' : main.type === 'drawing' ? 'drawing' : 'shape'}: ${main.name || ''}${labels.length ? ` (labels: ${labels.join(', ')})` : ''}`;
  }
  return it.block.text;
};

function forClaude(items, inScope) {
  return items.map((it) => {
    const base = { id: it.id, page: it.page + 1, in_scope: inScope.has(it), fixed: !it.flowing || undefined };
    if (it.kind === 'figure') {
      const drawing = it.objs.find((o) => o.spec);
      return { ...base, type: 'figure', text: describe(it), diagram: drawing ? drawing.spec : undefined };
    }
    const b = it.block;
    const d = state.project.writer.defaults;
    const size = it.objs[0].flow?.size || (it.objs[0].hw.sizeRatio && d.sizeRatio ? +(it.objs[0].hw.sizeRatio / d.sizeRatio).toFixed(2) : 1);
    return { ...base, type: b.type, text: b.text, term: b.term, definition: b.def, marker: b.marker, indent: b.indent, size };
  });
}

export function openEditProject() {
  if (!can('editProject')) return upgradeDialog('editProject');
  const sel = new Set(state.selection);
  const m = openModal('Edit Project');
  m.el.classList.add('ai-dialog', 'ai-edit');
  const instr = h('textarea.ai-instr', { rows: 3, placeholder: 'Tell the AI what to change. For example: “Make the introduction shorter, add more detail about condensation, and simplify the diagram.”' });
  let scope = sel.size ? 'selection' : 'project';
  const status = h('div.ai-status');
  const preview = h('div.ai-preview');
  const go = h('button.btn.primary', { on: { click: () => propose() } }, 'Propose changes');
  const syncGo = () => { go.disabled = !getKey(); };

  const scopes = [['selection', `Selection${sel.size ? ` (${sel.size})` : ''}`], ['page', 'This page'], ['project', 'Whole project']];
  const segEl = h('div.seg', ...scopes.map(([v, l]) => h('button', { class: scope === v ? 'on' : '', disabled: v === 'selection' && !sel.size, on: { click: (e) => { scope = v; segEl.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === e.currentTarget)); } } }, l)));

  async function propose() {
    const text = instr.value.trim();
    if (!text) return toast('Describe the change first');
    const items = documentItems();
    if (!items.some((it) => it.kind === 'text')) return toast('There’s no text on the pages to edit yet');
    const inScope = new Set(items.filter((it) =>
      scope === 'project' ? true
        : scope === 'page' ? it.page === state.pageIndex
          : it.objs.some((o) => sel.has(o.id))));
    // Figures positioned by hand are context only.
    for (const it of inScope) if (it.kind === 'figure' && !it.flowing) inScope.delete(it);
    if (!inScope.size) return toast('Nothing to edit in this scope');
    go.disabled = true;
    preview.replaceChildren();
    const doc = JSON.stringify(forClaude(items, inScope));
    try {
      const r = await ask({
        system: SYSTEM,
        content: [{ type: 'text', text: `Document:\n${doc}\n\nScope: ${scope === 'project' ? 'the whole project' : scope === 'page' ? `page ${state.pageIndex + 1}` : 'the selected blocks'}.\n\nInstruction: ${text}` }],
        schema: SCHEMA,
        status: 'Working on your changes…',
      }, { onStatus: (s) => { status.textContent = s; } });
      status.textContent = `${r.data.summary} (${costLabel(r)})`;
      showPreview(items, inScope, r.data.blocks, text);
    } catch (e) {
      status.textContent = `${e.message} Nothing was changed.`;
    } finally {
      syncGo();
    }
  }

  function showPreview(items, inScope, blocks, text) {
    const byId = new Map(items.map((it) => [it.id, it]));
    const kept = new Set(blocks.map((b) => b.id).filter((id) => byId.has(id)));
    const removed = [...inScope].filter((it) => !kept.has(it.id));
    const rows = [];
    let same = 0;
    for (const b of blocks) {
      const old = byId.get(b.id);
      const newText = b.type === 'diagram' ? `Diagram: ${b.text || b.diagram?.title || ''}` : b.type === 'figure' ? describe(old || { kind: 'figure', objs: [] }) : b.type === 'pagebreak' ? 'New page' : b.type === 'definition' ? `${b.term}: ${b.definition}` : b.text;
      if (!old) rows.push(h('div.chg.add', h('b', 'Added'), h('div', newText)));
      else if (old.kind === 'figure' && b.type === 'figure') same++;
      else if (old.kind === 'text' && old.block.text === (b.type === 'definition' ? `${b.term}: ${b.definition}` : b.text) && old.block.type === b.type && Math.abs((b.size || 1) - (old.objs[0].flow?.size || 1)) < 0.02) same++;
      else rows.push(h('div.chg.mod', h('b', old.kind === 'figure' ? 'Redrawn' : 'Changed'), h('div.old', describe(old)), h('div', newText)));
    }
    for (const it of removed) rows.push(h('div.chg.del', h('b', 'Removed'), h('div.old', describe(it))));
    if (!rows.length) { preview.replaceChildren(h('p.muted.small', 'No changes were proposed. Try describing the change differently.')); return; }
    preview.replaceChildren(
      h('h4', 'Proposed changes'),
      h('div.chg-list', ...rows),
      same ? h('p.muted.small', `${same} other block${same === 1 ? '' : 's'} unchanged.`) : null,
      removed.length ? h('p.warn.small', `This removes ${removed.length} block${removed.length === 1 ? '' : 's'}. A version is saved first, so you can restore it from Version history.`) : null,
      h('div.row.end',
        h('button.btn', { on: { click: () => { preview.replaceChildren(); status.textContent = 'Changes rejected. Nothing was changed.'; } } }, 'Reject'),
        h('button.btn.primary', { on: { click: async () => {
          await applyEdit(items, inScope, blocks, text);
          m.close();
        } } }, 'Accept changes')));
  }

  m.body.append(
    instr,
    h('div.field', h('span', 'Change'), segEl),
    keyBox(syncGo),
    status,
    preview);
  m.foot.append(h('button.btn', { on: { click: m.close } }, 'Close'), go);
  syncGo();
  setTimeout(() => instr.focus(), 0);
}

export async function applyEdit(items, inScope, blocks, instruction) {
  await saveVersion(`Before AI edit: “${instruction.length > 60 ? instruction.slice(0, 57) + '…' : instruction}”`);
  const p = state.project;
  const byId = new Map(items.map((it) => [it.id, it]));
  const scoped = items.filter((it) => inScope.has(it));
  const firstScope = items.indexOf(scoped[0]);

  // Hand-positioned text boxes are revised where they are.
  const consumed = new Set();
  for (const b of blocks) {
    const it = byId.get(b.id);
    if (!it || it.kind !== 'text' || it.flowing) continue;
    const o = it.objs[0];
    o.text = b.type === 'definition' ? `__${b.term}__: ${b.definition}` : b.type === 'list' ? `${b.marker || '•'} ${b.text}` : b.text;
    o.ai = true;
    consumed.add(b);
  }
  const keptIds = new Set(blocks.map((b) => b.id));
  for (const it of scoped) {
    if (!it.flowing && it.kind === 'text' && !keptIds.has(it.id)) removeObjs(it.objs);
  }

  // Everything that flows, from the first change to the end, is laid out
  // again: the revised blocks where the scope began, then the rest as it was.
  const flowBlocks = blocks.filter((b) => !consumed.has(b));
  const reflow = items.slice(firstScope).filter((it) => it.flowing);
  let start = null;
  if (!reflow.length && !flowBlocks.length) return finish();
  const anchor = reflow[0] || scoped[0];
  start = { page: anchor.page, y: Math.min(...anchor.objs.map((o) => o.y)) };

  const keep = new Map();
  const figures = new Map();
  for (const it of items) {
    if (it.kind === 'text') keep.set(it.id, { hw: it.objs[0].hw, ai: it.objs[0].ai, text: it.block.type === 'definition' ? `${it.block.term}: ${it.block.def}` : it.block.text });
    else if (it.flowing) figures.set(it.id, it.objs);
  }
  const revised = toPlaceable(flowBlocks, { keep, figures, ai: true });
  const sequence = [];
  let inserted = false;
  for (const it of reflow) {
    if (inScope.has(it)) {
      if (!inserted) { sequence.push(...revised); inserted = true; }
      continue;
    }
    if (!inserted && items.indexOf(it) > firstScope) { sequence.push(...revised); inserted = true; }
    sequence.push(it.kind === 'figure' ? { type: 'objects', objs: it.objs } : { ...it.block, hw: it.objs[0].hw, ai: it.objs[0].ai, size: it.objs[0].flow?.size });
  }
  if (!inserted) sequence.push(...revised);

  for (const it of reflow) removeObjs(it.objs);
  // Old figures replaced by a redrawn diagram are gone too.
  for (const b of flowBlocks) if (b.type === 'diagram' && byId.get(b.id)?.kind === 'figure') removeObjs(byId.get(b.id).objs);
  try {
    placeBlocks(sequence, { start });
  } catch (e) {
    toast(e.message, 5000);
  }
  // Drop pages left empty at the end.
  while (p.pages.length > 1 && !p.pages[p.pages.length - 1].objects.length && p.pages.length - 1 > start.page) p.pages.pop();
  finish();

  function finish() {
    if (p.stage === 'handwriting') p.stage = 'edit';
    S.commit();
    S.setPage(Math.min(start?.page ?? state.pageIndex, p.pages.length - 1));
    S.bus.emit('stage');
    toast('Changes applied. Undo or Version history can bring back the previous version.', 4500);
  }
}

function removeObjs(objs) {
  const ids = new Set(objs.map((o) => o.id));
  for (const pg of state.project.pages) pg.objects = pg.objects.filter((o) => !ids.has(o.id));
}
