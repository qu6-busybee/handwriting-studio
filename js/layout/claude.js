// Optional Claude-powered structure recognition for Auto-Layout.
// Runs only when the user adds their own Anthropic API key. The key stays in
// this browser (memory, or localStorage if "remember" is ticked) and requests
// go straight from the browser to the Anthropic API.
import { BLOCK_TYPES } from './analyze.js';

// Pinned SDK build (ES module from the jsDelivr CDN, loaded on first use).
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.133.0/+esm';
export const MODEL = 'claude-opus-5-5';
const PRICE = { input: 4, output: 20 }; // USD per million tokens (Claude Opus 5.5)
const KEY_STORE = 'hws.claudeKey';

let sessionKey = null;
export function getKey() {
  if (sessionKey) return sessionKey;
  try { return localStorage.getItem(KEY_STORE) || null; } catch { return null; }
}
export function setKey(key, remember) {
  sessionKey = key || null;
  try {
    if (key && remember) localStorage.setItem(KEY_STORE, key);
    else localStorage.removeItem(KEY_STORE);
  } catch { /* storage blocked: keep it for this session only */ }
}
export const isRemembered = () => { try { return !!localStorage.getItem(KEY_STORE); } catch { return false; } };

let sdkPromise;
const loadSdk = () => (sdkPromise ||= import(SDK_URL).then((m) => m.default));

// Every block has the same fields so the schema can be strict; unused fields
// are empty. Types mirror the built-in analyzer, plus "image" to place one of
// the supplied pictures as a diagram.
const TYPES = Object.keys(BLOCK_TYPES);
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['blocks'],
  properties: {
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'text', 'term', 'definition', 'marker', 'indent', 'rows', 'image'],
        properties: {
          type: { type: 'string', enum: TYPES },
          text: { type: 'string' },
          term: { type: 'string' },
          definition: { type: 'string' },
          marker: { type: 'string' },
          indent: { type: 'integer' },
          rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
          image: { type: 'integer' },
        },
      },
    },
  },
};

const SYSTEM = `You prepare study notes to be handwritten on lined notebook paper.
You receive typed text and/or images (screenshots, photos of notes, worksheets, textbook pages).
Your job is to transcribe and label the content's structure. You must not rewrite, paraphrase, summarise, translate, correct, reorder or drop anything: keep every word exactly as written, in the original order. Only fix line breaks that come from copying or from the image layout (join lines that belong to one sentence or paragraph).

Label each piece with one type:
- heading / subheading: titles and section headings.
- paragraph: running text.
- list: one bullet or numbered item. Put its bullet or number in "marker" exactly as written (use "•" for any bullet symbol), the item text in "text", and its nesting level in "indent" (0 = top level).
- definition: a term with its meaning. "term" = the term, "definition" = the meaning, "text" = the whole line as written.
- question / answer: keep each answer directly after its question; keep any "Q:"/"A:" or numbering in "text".
- table: put every row in "rows" (first row = header if there is one); "text" may be empty.
- equation: a calculation or formula, transcribed exactly (use plain characters, e.g. x^2, sqrt(), ×, ÷).
- image: a drawing, diagram, chart or figure that cannot be written as text. Set "image" to the number of the supplied image that contains it, and put a short label in "text". Use this only for real figures, never for text.
For every block, fill unused fields with "" (strings), 0 (indent, image) or [] (rows).
Where a text marker like ⟦image 2⟧ appears, the content of image 2 belongs at that position: transcribe its text there, using "image" blocks only for figures inside it.
Where a marker like ⟦diagram 3⟧ appears, the user wants image 3 placed as a picture at that position: output one "image" block with image = 3 there and do not transcribe it.`;

// An image (data URL) as a content block.
export function imageBlock(src, name = 'image') {
  const m = /^data:(image\/(png|jpeg|gif|webp));base64,(.+)$/.exec(src);
  if (!m) throw new Error(`${name}: only PNG, JPEG, GIF or WebP images can be sent.`);
  return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[3] } };
}

// One structured request: sends `content` and returns the parsed JSON that
// matches `schema`, plus token usage and an estimated cost.
export async function ask({ system, content, schema, effort = 'medium', status = 'Claude is working…' }, { onStatus } = {}) {
  const key = getKey();
  if (!key) throw new Error('Add your Anthropic API key first.');
  onStatus?.('Loading the Anthropic SDK…');
  const Anthropic = await loadSdk();
  // The key belongs to the person using this page and is only sent to Anthropic.
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });

  onStatus?.(status);
  let response;
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // if a safety classifier declines, another model continues
      output_config: { effort, format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content }],
    });
    let chars = 0;
    stream.on('text', (t) => { chars += t.length; onStatus?.(`${status} (${Math.round(chars / 1000)}k characters written)`); });
    response = await stream.finalMessage();
  } catch (e) {
    throw new Error(friendlyError(e, Anthropic));
  }

  if (response.stop_reason === 'refusal') throw new Error('Claude declined to process this content.');
  if (response.stop_reason === 'max_tokens') throw new Error('The content is too long for one request. Split it into smaller parts.');
  const out = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(out); } catch { throw new Error('Claude returned an unreadable answer. Please try again.'); }

  const u = response.usage || {};
  const cost = ((u.input_tokens || 0) * PRICE.input + (u.output_tokens || 0) * PRICE.output) / 1e6;
  return { data: parsed, usage: u, cost };
}

export const costLabel = (r) => `${(r.usage.input_tokens || 0).toLocaleString()} in / ${(r.usage.output_tokens || 0).toLocaleString()} out tokens, about $${r.cost.toFixed(r.cost < 0.1 ? 3 : 2)}`;

// inputs: { text, images: [{ n, src, name }] } -> { blocks, usage, cost }
export async function recognize({ text, images }, { onStatus } = {}) {
  const content = [];
  for (const img of images) {
    content.push({ type: 'text', text: `Image ${img.n} (${img.name}):` }, imageBlock(img.src, img.name));
  }
  content.push({ type: 'text', text: text.trim() ? `Typed text:\n\n${text}` : 'There is no typed text; use only the images.' });
  const r = await ask({ system: SYSTEM, content, schema: SCHEMA, status: 'Claude is reading your content…' }, { onStatus });
  return { blocks: toBlocks(r.data.blocks || [], images), usage: r.usage, cost: r.cost };
}

function friendlyError(e, A) {
  if (e instanceof A.AuthenticationError) return 'That API key was rejected. Check it in the Anthropic Console.';
  if (e instanceof A.PermissionDeniedError) return 'This API key isn’t allowed to use this model.';
  if (e instanceof A.RateLimitError) return 'Rate limit reached. Wait a moment and try again.';
  if (e instanceof A.BadRequestError) return `The request was rejected: ${e.message}`;
  if (e instanceof A.APIConnectionError) return 'Couldn’t reach the Anthropic API. Check your connection.';
  if (e instanceof A.APIError) return `Anthropic API error (${e.status ?? 'unknown'}): ${e.message}`;
  return e?.message || String(e);
}

// Claude's blocks -> the same shape the built-in analyzer produces.
function toBlocks(raw, images) {
  const byN = new Map(images.map((im) => [im.n, im]));
  const out = [];
  for (const b of raw) {
    if (!TYPES.includes(b.type)) continue;
    if (b.type === 'table') {
      if (b.rows?.length) out.push({ type: 'table', rows: b.rows, header: true, text: b.rows.map((r) => r.join(' | ')).join('\n') });
    } else if (b.type === 'image') {
      if (byN.has(b.image)) out.push({ type: 'image', image: b.image, text: b.text || `image ${b.image}`, claudeImage: true });
    } else if (b.type === 'definition') {
      const term = b.term?.trim(), def = b.definition?.trim();
      out.push(term && def ? { type: 'definition', term, def, text: b.text || `${term}: ${def}` } : { type: 'paragraph', text: b.text });
    } else if (b.type === 'list') {
      out.push({ type: 'list', marker: b.marker || '•', indent: Math.max(0, Math.min(3, b.indent | 0)), text: b.text });
    } else if (b.text?.trim()) {
      out.push({ type: b.type, text: b.text.trim() });
    }
  }
  return out;
}
