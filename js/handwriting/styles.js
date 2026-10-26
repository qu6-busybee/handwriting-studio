// Handwriting style registry. A "provider" turns characters into glyph
// outlines in normalised units (x-height = 1, baseline at y = 0, y down).
import * as store from '../store.js';
import { bus } from '../state.js';
import { b64ToBuf } from '../util.js';

/* global opentype */

export const PRESET_STYLES = [
  { id: 'nanum', name: 'Ballpoint', font: 'nanum-pen-script', category: 'casual' },
  { id: 'caveat', name: 'Everyday', font: 'caveat', category: 'casual' },
  { id: 'indie', name: 'Rounded', font: 'indie-flower', category: 'casual' },
  { id: 'kalam', name: 'Neat print', font: 'kalam', category: 'neat' },
  { id: 'shadows', name: 'Light print', font: 'shadows-into-light', category: 'neat' },
  { id: 'grace', name: 'Quick print', font: 'covered-by-your-grace', category: 'rushed' },
  { id: 'reenie', name: 'Scrawl', font: 'reenie-beanie', category: 'rushed' },
  { id: 'zeyada', name: 'Hurried cursive', font: 'zeyada', category: 'rushed' },
  { id: 'cedarville', name: 'School cursive', font: 'cedarville-cursive', category: 'cursive' },
  { id: 'homemade', name: 'Loopy cursive', font: 'homemade-apple', category: 'cursive' },
  { id: 'dawning', name: 'Thin cursive', font: 'dawning-of-a-new-day', category: 'cursive' },
  { id: 'labelle', name: 'Flowing cursive', font: 'la-belle-aurore', category: 'cursive' },
];
const FALLBACK_FONT = 'kalam';
// Plain digital font for the editing stage; also drives line wrapping so the
// approved layout keeps its line breaks after handwriting is generated.
const CLEAN_FONT = 'inter';

const custom = new Map(); // id -> stored record
const providers = new Map(); // id -> provider
const loading = new Map(); // id -> promise
const fontCache = new Map(); // font file -> promise<opentype.Font>

export const allStyles = () => [...PRESET_STYLES, ...custom.values()];
export const getStyle = (id) => PRESET_STYLES.find((s) => s.id === id) || custom.get(id) || null;
export const customStyles = () => [...custom.values()];

export async function initStyles() {
  for (const { value } of await store.all('styles')) custom.set(value.id, value);
  await Promise.all([loadProvider(FALLBACK_FONT + '@fallback'), loadProvider(CLEAN_FONT + '@fallback')]);
}

const loadFontFile = (name) => {
  if (!fontCache.has(name)) {
    fontCache.set(name, fetch(`fonts/${name}.woff`).then((r) => {
      if (!r.ok) throw new Error(`Font ${name} failed to load`);
      return r.arrayBuffer();
    }).then((b) => opentype.parse(b)));
  }
  return fontCache.get(name);
};

function loadProvider(id) {
  if (providers.has(id)) return Promise.resolve(providers.get(id));
  if (loading.has(id)) return loading.get(id);
  const p = (async () => {
    let prov;
    if (id.endsWith('@fallback')) prov = fontProvider(await loadFontFile(id.split('@')[0]));
    else {
      const st = getStyle(id);
      if (!st) throw new Error('Unknown style ' + id);
      if (st.font) prov = fontProvider(await loadFontFile(st.font));
      else if (st.kind === 'font') prov = fontProvider(opentype.parse(b64ToBuf(st.data)));
      else prov = glyphSetProvider(st);
    }
    providers.set(id, prov);
    loading.delete(id);
    bus.emit('fonts', id);
    return prov;
  })();
  p.catch((e) => { console.error(e); loading.delete(id); });
  loading.set(id, p);
  return p;
}

// Synchronous accessor used during render; returns null and kicks off a
// load if the provider isn't ready (a 'fonts' event triggers re-render).
export function getProvider(id) {
  if (providers.has(id)) return providers.get(id);
  loadProvider(getStyle(id) ? id : 'nanum');
  return null;
}
export const ensureProvider = (id) => loadProvider(getStyle(id) ? id : 'nanum');
export const fallbackProvider = () => providers.get(FALLBACK_FONT + '@fallback') || null;
export const cleanProvider = () => providers.get(CLEAN_FONT + '@fallback') || null;

function fontProvider(font) {
  const xg = font.charToGlyph('x');
  let xh = 0;
  if (xg && xg.index !== 0) {
    const bb = xg.getBoundingBox();
    xh = bb.y2;
  }
  if (!(xh > 0)) xh = (font.tables.os2 && font.tables.os2.sxHeight) || font.unitsPerEm * 0.45;
  const cache = new Map();
  const toCmds = (cmds) => cmds.map((c) => {
    const o = { type: c.type };
    if ('x' in c) { o.x = c.x / xh; o.y = -c.y / xh; }
    if ('x1' in c) { o.x1 = c.x1 / xh; o.y1 = -c.y1 / xh; }
    if ('x2' in c) { o.x2 = c.x2 / xh; o.y2 = -c.y2 / xh; }
    return o;
  });
  const space = font.charToGlyph(' ');
  return {
    mode: 'fill',
    space: space && space.advanceWidth ? space.advanceWidth / xh : 0.8,
    has: (ch) => {
      const g = font.charToGlyph(ch);
      return !!g && g.index !== 0;
    },
    glyph(ch) {
      if (!cache.has(ch)) {
        const g = font.charToGlyph(ch);
        cache.set(ch, g && g.index !== 0 ? { cmds: toCmds(g.path.commands), adv: g.advanceWidth / xh, mode: 'fill', glyph: g } : null);
      }
      return cache.get(ch);
    },
    kern(a, b) {
      if (!a || !b || !a.glyph || !b.glyph) return 0;
      return font.getKerningValue(a.glyph, b.glyph) / xh;
    },
  };
}

function glyphSetProvider(rec) {
  return {
    mode: 'stroke',
    space: rec.space || 0.9,
    has: (ch) => !!rec.glyphs[ch]?.length,
    glyph(ch, r = 0) {
      const vs = rec.glyphs[ch];
      if (!vs || !vs.length) return null;
      return vs[Math.min(vs.length - 1, Math.floor(r * vs.length))];
    },
    kern: () => 0,
  };
}

export async function saveCustomStyle(rec) {
  custom.set(rec.id, rec);
  providers.delete(rec.id);
  await store.put('styles', rec.id, rec);
  bus.emit('styles');
  bus.emit('fonts', rec.id);
}
export async function deleteCustomStyle(id) {
  custom.delete(id);
  providers.delete(id);
  await store.del('styles', id);
  bus.emit('styles');
}

// For project files: embed custom styles the project uses, and import them back.
export const embedStyles = (ids) => [...ids].map((id) => custom.get(id)).filter(Boolean);
export async function importStyles(recs = []) {
  for (const r of recs) if (!custom.has(r.id)) await saveCustomStyle(r);
}
