// "AI Auto-Layout" dialog: paste/type text, import files, add images (read
// with on-device OCR or placed as diagrams), review the detected structure,
// then lay it all out on the notebook pages in plain editing mode.
import { h, toast, debounce, readFile } from '../util.js';
import * as S from '../state.js';
import { openModal } from '../ui/modal.js';
import { seg } from '../print.js';
import { analyze, summarize, BLOCK_TYPES } from './analyze.js';
import { placeBlocks } from './place.js';
import { paperLabel } from '../paper.js';
import { recognize, getKey, setKey, isRemembered, MODEL } from './claude.js';
import { can, upgradeDialog } from '../plan.js';

const { state } = S;

// Third-party libraries are loaded only when needed (exact versions, CDN).
const LIBS = {
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  mammoth: 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js',
};
const loaded = {};
function loadScript(key) {
  loaded[key] ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = LIBS[key];
    s.onload = res;
    s.onerror = () => rej(new Error(`Could not load ${key} (are you offline?)`));
    document.head.append(s);
  });
  return loaded[key];
}

async function ocr(dataUrl, onProgress) {
  await loadScript('tesseract');
  const worker = await window.Tesseract.createWorker('eng', 1, {
    logger: (m) => { if (m.status === 'recognizing text') onProgress(Math.round(m.progress * 100)); },
  });
  try {
    const { data } = await worker.recognize(dataUrl);
    return data.text.replace(/\n{3,}/g, '\n\n').trim();
  } finally {
    await worker.terminate();
  }
}

async function readDocument(file) {
  if (/\.docx$/i.test(file.name)) {
    await loadScript('mammoth');
    const r = await window.mammoth.extractRawText({ arrayBuffer: await readFile(file, 'buffer') });
    return r.value;
  }
  return readFile(file, 'text');
}

const imageSize = (src) => new Promise((res) => {
  const i = new Image();
  i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight });
  i.onerror = () => res({ w: 800, h: 600 });
  i.src = src;
});

export function openAutoLayout() {
  if (!can('aiLayout')) return upgradeDialog('aiLayout');
  const m = openModal('AI Auto-Layout', { wide: true });
  m.el.classList.add('autolayout');
  const opts = { start: 'after', joinLines: true, indentParagraphs: true, gapParagraphs: false };
  // Every added image, numbered from 1. ⟦diagram n⟧ places it on the page;
  // ⟦image n⟧ marks an image that Claude should read.
  const images = []; // { n, src, w, h, name }
  let blocks = [];
  let claudeBlocks = null; // structure returned by Claude (until the text changes)
  let overrides = new Map(); // block index -> chosen type

  const ta = h('textarea.al-input', { placeholder: 'Paste or type your notes, an essay, definitions, a list, questions and answers…\n\nOr add images / a document with the buttons below.', spellcheck: true });
  const status = h('div.al-status');
  const summary = h('div.al-summary');
  const source = h('div.al-source');
  const list = h('div.al-blocks');
  const claudeBox = h('div.al-claude');

  const insertAtCursor = (text) => {
    const pos = ta.selectionStart ?? ta.value.length;
    const before = ta.value.slice(0, pos).replace(/\s*$/, '');
    const after = ta.value.slice(pos).replace(/^\s*/, '');
    ta.value = (before ? before + '\n\n' : '') + text + (after ? '\n\n' + after : '');
    ta.dispatchEvent(new Event('input'));
  };

  const render = () => {
    const current = claudeBlocks || blocks;
    source.textContent = claudeBlocks ? 'Structure from Claude' : 'Structure from built-in rules';
    source.className = 'al-source' + (claudeBlocks ? ' claude' : '');
    summary.textContent = current.length ? `Found: ${summarize(current)}` : '';
    list.replaceChildren(...current.slice(0, 300).map((b, i) => {
      const sel = h('select.al-type', {}, ...Object.entries(BLOCK_TYPES).filter(([k]) => k !== 'image' && k !== 'table').map(([k, l]) => h('option', { value: k }, l)));
      if (b.type === 'table' || b.type === 'image') { sel.disabled = true; sel.append(h('option', { value: b.type }, BLOCK_TYPES[b.type])); }
      sel.value = overrides.get(i) || b.type;
      sel.addEventListener('change', () => overrides.set(i, sel.value));
      const text = b.type === 'table' ? `${b.rows.length} rows × ${Math.max(...b.rows.map((r) => r.length))} columns` : b.type === 'image' ? `${images[b.image - 1]?.name || 'image'}${b.claudeImage && b.text ? ` — ${b.text}` : ''}` : b.text;
      return h('div.al-block.t-' + b.type, sel, h('span', text.length > 140 ? text.slice(0, 140) + '…' : text));
    }));
  };
  const refresh = debounce(() => {
    blocks = analyze(ta.value, { joinLines: opts.joinLines });
    render();
  }, 250);
  ta.addEventListener('input', () => {
    if (claudeBlocks) {
      claudeBlocks = null;
      overrides = new Map();
      status.textContent = 'Text changed: showing the built-in structure again. Run “Recognize with Claude” to update.';
    }
    refresh();
  });

  const addImages = async () => {
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', multiple: true });
    input.onchange = async () => {
      for (const file of input.files) {
        const src = await readFile(file);
        const choice = await askImageUse(file.name, !!getKey());
        if (!choice) continue;
        if (choice === 'ocr') {
          status.textContent = `Reading text from ${file.name}… (first use downloads the OCR engine, ~10 MB)`;
          try {
            const text = await ocr(src, (pct) => { status.textContent = `Reading text from ${file.name}… ${pct}%`; });
            insertAtCursor(text || '');
            status.textContent = text ? `Added text from ${file.name}. Check it; OCR can misread characters.` : `No text found in ${file.name}.`;
          } catch (e) {
            status.textContent = `Couldn’t read ${file.name}: ${e.message}`;
          }
          continue;
        }
        const size = await imageSize(src);
        images.push({ n: images.length + 1, src, ...size, name: file.name });
        insertAtCursor(choice === 'diagram' ? `⟦diagram ${images.length}⟧` : `⟦image ${images.length}⟧`);
        if (choice === 'claude') status.textContent = `${file.name} will be read by Claude. Click “Recognize with Claude” when your content is ready.`;
      }
    };
    input.click();
  };

  const importDoc = () => {
    const input = h('input', { type: 'file', accept: '.txt,.md,.markdown,.csv,.tsv,.docx,text/plain' });
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      try {
        let text = await readDocument(f);
        if (/\.csv$/i.test(f.name)) text = text.split('\n').map((l) => l.split(',').join('\t')).join('\n');
        insertAtCursor(text);
        status.textContent = `Imported ${f.name}.`;
      } catch (e) {
        status.textContent = `Couldn’t import ${f.name}: ${e.message}`;
      }
    };
    input.click();
  };

  // ---------- Claude (optional) ----------
  const runClaude = async (btn) => {
    const used = new Set([...ta.value.matchAll(/⟦(?:image|diagram) (\d+)⟧/g)].map((x) => +x[1]));
    const toSend = images.filter((im) => used.has(im.n));
    if (!ta.value.replace(/⟦(?:image|diagram) \d+⟧/g, '').trim() && !toSend.length) return toast('Add some content first');
    btn.disabled = true;
    try {
      const res = await recognize({ text: ta.value, images: toSend }, { onStatus: (s) => { status.textContent = s; } });
      claudeBlocks = res.blocks;
      overrides = new Map();
      render();
      const u = res.usage;
      status.textContent = `Claude found ${res.blocks.length} pieces (${(u.input_tokens || 0).toLocaleString()} in / ${(u.output_tokens || 0).toLocaleString()} out tokens, about $${res.cost.toFixed(res.cost < 0.1 ? 3 : 2)}). Review them, then lay out.`;
    } catch (e) {
      status.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  };

  const renderClaude = () => {
    if (getKey()) {
      const btn = h('button.btn.block.claude-go', { on: { click: () => runClaude(btn) } }, 'Recognize with Claude');
      claudeBox.replaceChildren(
        h('h4', 'Claude (optional)'),
        btn,
        h('p.muted.small', `Sends the text and any images marked “Read with Claude” to Anthropic (${MODEL}) using your key. Billed to your Anthropic account. Better than the built-in rules for photos, handwriting, tables and messy text.`),
        h('div.row.tight', h('span.muted.small.grow', isRemembered() ? 'Key saved in this browser.' : 'Key kept for this session only.'),
          h('button.btn.small.ghost', { on: { click: () => { setKey(null); renderClaude(); toast('API key removed from this browser'); } } }, 'Remove key')));
    } else {
      const keyIn = h('input', { type: 'password', placeholder: 'sk-ant-…', autocomplete: 'off', spellcheck: false });
      const remember = h('input', { type: 'checkbox' });
      claudeBox.replaceChildren(
        h('h4', 'Claude (optional)'),
        h('p.muted.small', 'Add your own Anthropic API key to have Claude read images and recognise structure. Your key stays in this browser and is only sent to Anthropic. Usage is billed to your Anthropic account.'),
        keyIn,
        h('label.check', remember, 'Remember on this device'),
        h('button.btn.block', { on: { click: () => {
          const k = keyIn.value.trim();
          if (!/^sk-ant-/.test(k)) return toast('That doesn’t look like an Anthropic API key (sk-ant-…)');
          setKey(k, remember.checked);
          renderClaude();
          toast('Claude is ready');
        } } }, 'Use this key'));
    }
  };
  renderClaude();

  const run = () => {
    const current = claudeBlocks || blocks;
    if (!current.length) return toast('Add some content first');
    if (!claudeBlocks && /⟦image \d+⟧/.test(ta.value)) return toast('Some images are set to be read by Claude. Click “Recognize with Claude” first, or remove them.', 5000);
    const final = current.map((b, i) => (overrides.has(i) && overrides.get(i) !== b.type ? retype(b, overrides.get(i)) : b));
    try {
      const res = placeBlocks(final, { ...opts, images });
      if (state.project.stage === 'handwriting') state.project.stage = 'edit'; // review the layout first
      S.commit();
      S.bus.emit('stage');
      // Show the page where the new content begins.
      const firstPage = state.project.pages.findIndex((pg) => pg.objects.includes(res.placed[0]));
      S.setPage(Math.max(0, firstPage));
      S.setSelection(res.placed.map((o) => o.id), { expand: false });
      m.close();
      const pagesUsed = new Set(res.placed.map((o) => state.project.pages.findIndex((pg) => pg.objects.includes(o)))).size;
      toast(`Placed ${res.placed.length} item${res.placed.length === 1 ? '' : 's'} on ${pagesUsed} page${pagesUsed === 1 ? '' : 's'}${res.created.length ? ` (${res.created.length} new)` : ''}. Review, then Generate Handwriting.`, 5000);
    } catch (e) {
      toast(e.message, 5000);
    }
  };

  m.body.classList.add('al-layout');
  m.body.append(
    h('div.al-left',
      ta,
      h('div.row',
        h('button.btn', { on: { click: addImages } }, 'Add images…'),
        h('button.btn', { on: { click: importDoc } }, 'Import document…'),
        h('span.muted.small', '.txt, .md, .csv, .docx')),
      status),
    h('div.al-right',
      h('p.small.muted', `Paper: ${paperLabel(state.project.paper)}. Content is placed on the blue lines between the red margins, using your handwriting size. New pages are added as needed.`),
      h('label.field', h('span', 'Start'), seg([['after', 'After existing content'], ['newpage', 'On a new page']], opts.start, (v) => { opts.start = v; })),
      h('label.check', h('input', { type: 'checkbox', checked: true, on: { change: (e) => { opts.joinLines = e.target.checked; refresh(); } } }), 'Join lines that were wrapped when copied'),
      h('label.check', h('input', { type: 'checkbox', checked: true, on: { change: (e) => { opts.indentParagraphs = e.target.checked; } } }), 'Indent paragraphs'),
      h('label.check', h('input', { type: 'checkbox', on: { change: (e) => { opts.gapParagraphs = e.target.checked; } } }), 'Blank line between paragraphs'),
      claudeBox,
      h('h4', 'Detected structure'),
      source,
      summary,
      h('p.muted.small', 'Change a type if it was guessed wrong. Your wording is never changed.'),
      list));
  m.foot.append(
    h('span.muted.small.grow', 'Content appears as plain text so you can review it. Nothing is handwritten until you click Generate Handwriting.'),
    h('button.btn', { on: { click: m.close } }, 'Cancel'),
    h('button.btn.primary', { on: { click: run } }, 'Auto-Organize'));
  render();
  setTimeout(() => ta.focus(), 0);
}

function retype(b, type) {
  const text = b.type === 'definition' ? b.text : b.text;
  if (type === 'list') return { type, text, marker: '•', indent: 0 };
  if (type === 'definition') {
    const m = text.match(/^(.{1,48}?)\s*(?::|\s[-–—]\s)\s*(.+)$/);
    return m ? { type, term: m[1], def: m[2], text } : { type: 'paragraph', text };
  }
  return { type, text };
}

function askImageUse(name, claudeReady) {
  return new Promise((res) => {
    const m = openModal('How should this image be used?', { onClose: () => res(null) });
    m.body.append(h('p', h('b', name)), h('ul.muted.small.choices',
      h('li', h('b', 'Read text (on device)'), ': turns a clear screenshot of typed text into editable text. Nothing leaves your computer.'),
      claudeReady && h('li', h('b', 'Read with Claude'), ': best for photos, handwritten notes, tables and worksheets. Sent to Anthropic with your API key.'),
      h('li', h('b', 'Place as diagram'), ': puts the picture itself on the page.')));
    const pick = (v) => () => { res(v); m.close(); };
    m.foot.append(
      h('button.btn', { on: { click: pick('diagram') } }, 'Place as diagram'),
      h('button.btn' + (claudeReady ? '' : '.primary'), { on: { click: pick('ocr') } }, 'Read text (on device)'),
      claudeReady && h('button.btn.primary', { on: { click: pick('claude') } }, 'Read with Claude'));
  });
}
