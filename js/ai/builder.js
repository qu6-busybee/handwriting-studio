// AI Project Builder: the student gives the rubric, instructions, notes and
// reference files; Claude writes a complete draft (with a requirements
// checklist and questions about anything missing) and the draft is laid out
// on the notebook pages as ordinary editable Arial text boxes.
import { h, toast, uid, acceptFiles } from '../util.js';
import * as S from '../state.js';
import { openModal } from '../ui/modal.js';
import { ask, costLabel, getKey } from '../layout/claude.js';
import { readDocument } from '../layout/autolayout.js';
import { placeBlocks } from '../layout/place.js';
import { paperLabel } from '../paper.js';
import { can, upgradeDialog } from '../plan.js';
import { BLOCK_SCHEMA, BLOCK_RULES, HONESTY, keyBox, fileToContent, toPlaceable, wordsPerPage } from './common.js';
import { saveVersion } from './history.js';

const { state } = S;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'checklist', 'questions', 'blocks'],
  properties: {
    title: { type: 'string' },
    checklist: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['requirement', 'status', 'note'], properties: {
      requirement: { type: 'string' },
      status: { type: 'string', enum: ['addressed', 'needs_input', 'not_addressed'] },
      note: { type: 'string' },
    } } },
    questions: { type: 'array', items: { type: 'string' } },
    blocks: { type: 'array', items: BLOCK_SCHEMA },
  },
};

const SYSTEM = `You write complete school project drafts inside a notebook app. The draft is placed on lined notebook paper as typed text; the student reviews and edits it, then it is converted to handwriting and printed.

You receive the student's materials: rubric or grading criteria, instructions, notes, reference documents and images, and a description of what they want.

1. Read every requirement first: required sections, topics, questions to answer, length, formatting, and how it is graded. Put each one in "checklist" with an honest status: "addressed" only if the draft really covers it (say where in "note"); "needs_input" if it needs something only the student has; "not_addressed" if the draft doesn't cover it (say why). If there is no rubric, list the requirements from the instructions and description.
2. Write the complete draft in "blocks", in order. Follow any required structure and order; otherwise use a sensible one: a title, an introduction, sections with subheadings, and a conclusion. Address every relevant criterion. Match the required length; if none is given, choose a length that suits the assignment. Write clearly and naturally at the level the assignment implies. Follow the student's description closely.
3. ${HONESTY}
4. If essential information is missing (for example the topic or the length is unclear), add short questions to "questions" (at most 5). Still write the best draft you can. Leave "questions" empty when nothing essential is missing.
5. Include a diagram block when the assignment asks for a diagram or when one clearly helps. If the student supplied a picture they want included (images are numbered), use a figure block with id "image N".
6. "title" = a short name for the project. Every block's "id" is "".

${BLOCK_RULES}`;

export function openProjectBuilder() {
  if (!can('buildProject')) return upgradeDialog('buildProject');
  const m = openModal('Build Project', { wide: true });
  m.el.classList.add('ai-dialog');
  const files = []; // { kind, name, block, src? }
  const wpp = wordsPerPage();

  const desc = h('textarea.ai-desc', { rows: 5, placeholder: 'Describe the project. For example: “Create a detailed project about the water cycle. Include an introduction, explanations of evaporation, condensation, precipitation and collection, plus a labeled diagram. Use clear, simple language.”' });
  const notes = h('textarea.ai-notes', { rows: 4, placeholder: 'Your notes, details to include, facts from class, required formatting… (optional)' });
  const fileList = h('div.ai-files');
  const status = h('div.ai-status');
  const result = h('div.ai-result');
  const hasContent = state.project.pages.some((pg) => pg.objects.length);
  let where = hasContent ? 'newpage' : 'start';

  const renderFiles = () => fileList.replaceChildren(...files.map((f, i) => h('span.ai-file', `${f.kind === 'pdf' ? 'PDF' : f.kind === 'image' ? `Image ${imageNo(f)}` : 'Text'} · ${f.name}`,
    h('button.x', { title: 'Remove', on: { click: () => { files.splice(i, 1); renderFiles(); } } }, '×'))));
  const imageNo = (f) => files.filter((x) => x.kind === 'image').indexOf(f) + 1;

  const addFiles = (list) => {
    (async () => {
      for (const file of list) {
        try {
          files.push(await fileToContent(file, readDocument));
        } catch (e) {
          toast(`Couldn’t read ${file.name}: ${e.message}`, 4000);
        }
      }
      renderFiles();
    })();
  };
  const pick = () => {
    const input = h('input', { type: 'file', multiple: true, accept: '.pdf,.docx,.txt,.md,.csv,image/png,image/jpeg,image/gif,image/webp' });
    input.onchange = () => addFiles([...input.files]);
    input.click();
  };
  acceptFiles(m.el, addFiles, (f) => /\.(pdf|docx|txt|md|markdown|csv)$/i.test(f.name) || /^image\/(png|jpeg|gif|webp)$/.test(f.type));

  const go = h('button.btn.primary', { on: { click: () => generate() } }, 'Generate Draft');
  const syncGo = () => { go.disabled = !getKey(); };

  let lastQuestions = [];
  const answers = [];

  async function generate(extra = '') {
    if (!desc.value.trim() && !files.length && !notes.value.trim()) return toast('Describe the project or add your materials first');
    go.disabled = true;
    result.replaceChildren();
    const content = [];
    files.forEach((f) => {
      if (f.kind === 'image') content.push({ type: 'text', text: `Image ${imageNo(f)} (${f.name}):` });
      content.push(f.block);
    });
    content.push({ type: 'text', text: [
      `Project description:\n${desc.value.trim() || '(none — use the materials)'}`,
      notes.value.trim() && `Student's notes and details:\n${notes.value.trim()}`,
      extra && `Answers to your earlier questions:\n${extra}`,
      `Paper: ${paperLabel(state.project.paper)}. About ${wpp} words fit on one page at the student's handwriting size.`,
    ].filter(Boolean).join('\n\n') });
    try {
      const r = await ask({ system: SYSTEM, content, schema: SCHEMA, effort: 'high', status: 'Reading your materials and writing the draft…' }, { onStatus: (s) => { status.textContent = s; } });
      showResult(r);
    } catch (e) {
      status.textContent = `${e.message} Nothing on your pages was changed.`;
    } finally {
      syncGo();
    }
  }

  function showResult(r) {
    const d = r.data;
    status.textContent = `Draft ready: ${d.blocks.length} pieces (${costLabel(r)}).`;
    lastQuestions = d.questions || [];
    const inputs = lastQuestions.map(() => h('input', { placeholder: 'Your answer (optional)' }));
    const place = () => placeDraft(d);
    result.replaceChildren(
      checklistView(d.checklist),
      lastQuestions.length ? h('div.ai-questions', h('h4', 'Claude has a few questions'),
        ...lastQuestions.map((q, i) => h('label.field.col', h('span', q), inputs[i]))) : null,
      h('div.row.end',
        lastQuestions.length && h('button.btn', { on: { click: () => {
          answers.push(...lastQuestions.map((q, i) => inputs[i].value.trim() && `Q: ${q}\nA: ${inputs[i].value.trim()}`).filter(Boolean));
          if (!answers.length) return toast('Answer at least one question, or place the draft as it is');
          generate(answers.join('\n\n'));
        } } }, 'Answer and rewrite'),
        h('button.btn.primary', { on: { click: place } }, lastQuestions.length ? 'Place draft anyway' : 'Place draft on pages')));
    if (!lastQuestions.length) place();
  }

  async function placeDraft(d) {
    // Pictures the student supplied, available as "image N" figures, at
    // their real proportions.
    const images = new Map();
    const pics = files.filter((f) => f.kind === 'image');
    for (const [i, f] of pics.entries()) {
      const img = await new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = f.src; });
      const ratio = img ? img.naturalHeight / img.naturalWidth : 0.75;
      images.set(`image ${i + 1}`, () => {
        const asset = uid('a');
        state.project.assets[asset] = f.src;
        return { id: uid(), type: 'image', name: f.name, asset, x: 0, y: 0, w: 80, h: 80 * ratio, rot: 0, opacity: 1, ai: true };
      });
    }
    const blocks = toPlaceable(d.blocks, { images });
    if (!blocks.length) return toast('The draft was empty. Try describing the project in more detail.');
    await saveVersion('Before AI draft');
    const p = state.project;
    try {
      let start = 'newpage';
      if (where === 'replace') { p.pages = [{ id: uid('pg'), objects: [] }]; S.setPage(0); start = { page: 0, y: 0 }; }
      else if (where === 'start') { S.setPage(0); start = 'after'; }
      else S.setPage(p.pages.length - 1);
      const res = placeBlocks(blocks, { start, tag: { ai: true } });
      if (p.stage === 'handwriting') p.stage = 'edit';
      if (!hasContent || where === 'replace') p.name = d.title || p.name;
      p.ai = { checklist: d.checklist, questions: lastQuestions, at: Date.now() };
      S.commit();
      S.bus.emit('stage');
      S.bus.emit('project');
      const first = p.pages.findIndex((pg) => pg.objects.includes(res.placed[0]));
      S.setPage(Math.max(0, first));
      m.close();
      const pagesUsed = new Set(res.placed.map((o) => p.pages.findIndex((pg) => pg.objects.includes(o)))).size;
      const open = d.checklist.filter((c) => c.status !== 'addressed').length;
      toast(`Draft placed on ${pagesUsed} page${pagesUsed === 1 ? '' : 's'}. ${open ? `${open} requirement${open === 1 ? '' : 's'} still need${open === 1 ? 's' : ''} your input — see the checklist.` : 'Review it, then continue to handwriting.'}`, 6000);
    } catch (e) {
      toast(e.message, 5000);
    }
  }

  const seg = (opts) => h('div.seg', ...opts.map(([v, l]) => {
    const b = h('button', { class: where === v ? 'on' : '', on: { click: () => { where = v; b.parentNode.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); } } }, l);
    return b;
  }));

  m.body.append(
    h('div.ai-col',
      h('label.field.col', h('span', 'What should the project be?'), desc),
      h('div.field.col', h('span', 'Rubric, instructions and reference files'),
        h('div.row', h('button.btn', { on: { click: pick } }, 'Add files…'), h('span.muted.small', 'PDF, Word, text or images. You can also drop files here or paste them.')),
        fileList),
      h('label.field.col', h('span', 'Notes and details'), notes),
      hasContent && h('div.field', h('span', 'Put the draft'), seg([['newpage', 'On new pages'], ['replace', 'Replace all pages']])),
      keyBox(syncGo),
      status,
      result));
  m.foot.append(
    h('span.muted.small.grow', `Paper: ${paperLabel(state.project.paper)}. The draft appears as typed text you can edit. Claude won’t invent sources or personal experiences.`),
    h('button.btn', { on: { click: m.close } }, 'Cancel'),
    go);
  syncGo();
  setTimeout(() => desc.focus(), 0);
}

export function checklistView(list = []) {
  if (!list.length) return null;
  const icon = { addressed: '✓', needs_input: '!', not_addressed: '○' };
  return h('div.ai-check', h('h4', 'Requirements checklist'),
    ...list.map((c) => h('div.ck.' + c.status, h('span.ck-i', icon[c.status] || '•'), h('div', h('div', c.requirement), c.note && h('div.muted.small', c.note)))));
}
