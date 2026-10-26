// Project model, selection, undo/redo history and autosave.
import { Emitter, uid, debounce } from './util.js';
import { paperFromPreset, writingBox } from './paper.js';
import * as store from './store.js';

export const bus = new Emitter();

export const INKS = [
  { name: 'Blue ballpoint', color: '#22408f' },
  { name: 'Black ballpoint', color: '#1d1d24' },
  { name: 'Blue gel', color: '#1f4fc4' },
  { name: 'Red', color: '#b3262e' },
];

export const PENCILS = [
  { name: 'HB pencil', color: '#47494f' },
  { name: '2B pencil', color: '#323338' },
  { name: '2H pencil', color: '#66686e' },
];

export const DEFAULT_HW = {
  style: 'nanum',
  pen: 'ballpoint', // ballpoint | gel | pencil
  manner: 'casual',
  size: 3.2, // x-height in mm
  color: INKS[0].color,
  neatness: 0.55,
  slant: 0,
  letterSpacing: 0,
  wordSpacing: 1,
  lineSpacing: 0, // 0 = follow the paper ruling
  followLines: true,
  drift: 0.5,
  inkVar: 0.5,
  weight: 0.05,
  penWidth: 0.42, // stroke width for drawn-glyph styles
  texture: true,
  mistakes: 0,
  seed: 1,
};

export const state = {
  project: null,
  pageIndex: 0,
  selection: new Set(),
  zoom: 1,
  tool: 'select',
  editingId: null,
  saveStatus: 'saved',
};

const randSeed = () => (Math.random() * 1e9) | 0;

export function createProject(presetId = 'filler-wide') {
  const paper = paperFromPreset(presetId);
  return {
    v: 1,
    id: uid('p'),
    name: 'Untitled notebook page',
    created: Date.now(),
    updated: Date.now(),
    paper,
    pages: [{ id: uid('pg'), objects: [] }],
    writer: { seed: randSeed(), defaults: { ...DEFAULT_HW, size: +(paper.spacing * 0.37).toFixed(2) } },
    assets: {},
    view: { overlay: true, printable: true },
    stage: 'edit', // 'edit' = clean typed layout, 'handwriting' = generated
  };
}

// ---------- two-stage workflow ----------
// A text box shows handwriting only when the project is in the handwriting
// stage AND its content still matches what was approved at generation time.
// Handwriting settings (style, size, ink…) can change freely afterwards.
export const contentSig = (o) => JSON.stringify([o.text || '', Math.round(o.w * 10)]);
export const isGenerated = (o) => state.project.stage === 'handwriting' && !!o.gen && o.gen.sig === contentSig(o);
export const isStale = (o) => o.type === 'text' && state.project.stage === 'handwriting' && !isGenerated(o) && !!(o.text || '').trim();

export function staleCount() {
  if (state.project.stage !== 'handwriting') return 0;
  return state.project.pages.reduce((n, pg) => n + pg.objects.filter(isStale).length, 0);
}

// Approves the current content of every text box (or just `objs`) and
// switches the project to the handwriting stage.
export function generateHandwriting(objs) {
  const list = objs || state.project.pages.flatMap((pg) => pg.objects.filter((o) => o.type === 'text'));
  for (const o of list) {
    if (o.type !== 'text') continue;
    const fresh = o.gen && o.gen.sig === contentSig(o);
    if (!fresh) o.gen = { sig: contentSig(o), at: Date.now() };
  }
  state.project.stage = 'handwriting';
  commit();
  bus.emit('stage');
}

export function regenerate(objs) {
  for (const o of objs) {
    if (o.type !== 'text') continue;
    o.hw.seed = randSeed();
    o.gen = { sig: contentSig(o), at: Date.now() };
  }
  if (state.project.stage !== 'handwriting') state.project.stage = 'handwriting';
  commit();
  bus.emit('stage');
}

export function backToEditing() {
  state.project.stage = 'edit';
  commit();
  bus.emit('stage');
}

// ---------- accessors ----------
export const project = () => state.project;
export const page = () => state.project.pages[state.pageIndex];
export const findObj = (id, pg = page()) => pg.objects.find((o) => o.id === id);
export const selected = () => page().objects.filter((o) => state.selection.has(o.id));
export const selectedOne = () => {
  const s = selected();
  return s.length === 1 ? s[0] : null;
};

// Selecting one member of a group selects the whole group.
export function expandGroups(ids) {
  const set = new Set(ids);
  const groups = new Set(page().objects.filter((o) => set.has(o.id) && o.groupId).map((o) => o.groupId));
  if (groups.size) for (const o of page().objects) if (o.groupId && groups.has(o.groupId)) set.add(o.id);
  return set;
}

export function setSelection(ids, { expand = true } = {}) {
  const valid = new Set(page().objects.map((o) => o.id));
  const set = expand ? expandGroups([...ids].filter((i) => valid.has(i))) : new Set([...ids].filter((i) => valid.has(i)));
  state.selection = set;
  bus.emit('selection');
}

export function setPage(i) {
  state.pageIndex = Math.max(0, Math.min(state.project.pages.length - 1, i));
  state.selection = new Set();
  state.editingId = null;
  bus.emit('page');
  bus.emit('selection');
}

export function setTool(t) {
  state.tool = t;
  bus.emit('tool');
}

// ---------- history ----------
let past = [];
let future = [];
const snap = () => JSON.stringify({ name: state.project.name, paper: state.project.paper, pages: state.project.pages, writer: state.project.writer, view: state.project.view, stage: state.project.stage });

export function resetHistory() {
  past = [snap()];
  future = [];
  bus.emit('history');
}

export function commit() {
  const s = snap();
  if (past[past.length - 1] === s) return;
  past.push(s);
  if (past.length > 150) past.shift();
  future = [];
  bus.emit('history');
  bus.emit('change');
  scheduleSave();
}

function restore(s) {
  Object.assign(state.project, JSON.parse(s));
  state.pageIndex = Math.min(state.pageIndex, state.project.pages.length - 1);
  setSelection([...state.selection]);
  bus.emit('change');
  bus.emit('page');
  bus.emit('history');
  scheduleSave();
}

export const canUndo = () => past.length > 1;
export const canRedo = () => future.length > 0;
export function undo() {
  if (!canUndo()) return;
  future.push(past.pop());
  restore(past[past.length - 1]);
}
export function redo() {
  if (!canRedo()) return;
  const s = future.pop();
  past.push(s);
  restore(s);
}

// ---------- persistence ----------
const save = debounce(async () => {
  const p = state.project;
  p.updated = Date.now();
  try {
    await store.put('projects', p.id, JSON.parse(JSON.stringify(p)));
    await store.put('kv', 'lastProject', p.id);
    state.saveStatus = 'saved';
  } catch (e) {
    console.error(e);
    state.saveStatus = 'error';
  }
  bus.emit('saved');
}, 700);

export function scheduleSave() {
  state.saveStatus = 'saving';
  bus.emit('saved');
  save();
}
export const saveNow = () => save.flush();

export function loadProject(p) {
  state.project = p;
  state.pageIndex = 0;
  state.selection = new Set();
  state.editingId = null;
  p.view ||= { overlay: true };
  if (p.view.printable == null) p.view.printable = true;
  p.assets ||= {};
  p.stage ||= 'edit';
  resetHistory();
  bus.emit('project');
  bus.emit('change');
  bus.emit('page');
  bus.emit('selection');
  scheduleSave();
}

// ---------- object actions ----------
export function newTextObject(props = {}) {
  const p = state.project;
  const wb = writingBox(p.paper);
  return {
    id: uid(),
    type: 'text',
    name: 'Text',
    x: wb.x,
    y: p.paper.firstLine,
    w: wb.w,
    h: p.paper.spacing,
    rot: 0,
    opacity: 1,
    text: '',
    hw: { ...p.writer.defaults, seed: randSeed() },
    ...props,
  };
}

export function newShape(shape, props = {}) {
  return {
    id: uid(),
    type: 'shape',
    shape,
    name: shape[0].toUpperCase() + shape.slice(1),
    x: 60, y: 60, w: 30, h: shape === 'line' || shape === 'arrow' || shape === 'double-arrow' || shape === 'underline' ? 4 : 20,
    rot: 0,
    opacity: 1,
    stroke: state.project.writer.defaults.color,
    strokeWidth: 0.45,
    fill: 'none',
    handDrawn: true,
    seed: randSeed(),
    ...props,
  };
}

export function addObjects(objs, { select = true } = {}) {
  page().objects.push(...objs);
  if (select) state.selection = new Set(objs.map((o) => o.id));
  commit();
  bus.emit('selection');
}

export function deleteSelected() {
  if (!state.selection.size) return;
  const pg = page();
  pg.objects = pg.objects.filter((o) => !state.selection.has(o.id) || o.locked);
  state.selection = new Set();
  commit();
  bus.emit('selection');
}

export function cloneObjects(objs, dx = 5, dy = 5) {
  const groupMap = new Map();
  return objs.map((o) => {
    const c = JSON.parse(JSON.stringify(o));
    c.id = uid();
    c.x += dx;
    c.y += dy;
    if (c.groupId) {
      if (!groupMap.has(c.groupId)) groupMap.set(c.groupId, uid('g'));
      c.groupId = groupMap.get(c.groupId);
    }
    if (c.hw) c.hw.seed = randSeed();
    if (c.seed) c.seed = randSeed();
    return c;
  });
}

export function duplicateSelected() {
  const objs = selected();
  if (!objs.length) return;
  addObjects(cloneObjects(objs));
}

export function groupSelected() {
  const objs = selected();
  if (objs.length < 2) return;
  const g = uid('g');
  objs.forEach((o) => (o.groupId = g));
  commit();
}
export function ungroupSelected() {
  selected().forEach((o) => delete o.groupId);
  commit();
}

// dir: 'front' | 'back' | 'forward' | 'backward'
export function arrange(dir) {
  const pg = page();
  const sel = state.selection;
  const list = pg.objects;
  if (dir === 'front') pg.objects = [...list.filter((o) => !sel.has(o.id)), ...list.filter((o) => sel.has(o.id))];
  else if (dir === 'back') pg.objects = [...list.filter((o) => sel.has(o.id)), ...list.filter((o) => !sel.has(o.id))];
  else if (dir === 'forward') {
    for (let i = list.length - 2; i >= 0; i--) if (sel.has(list[i].id) && !sel.has(list[i + 1].id)) [list[i], list[i + 1]] = [list[i + 1], list[i]];
  } else {
    for (let i = 1; i < list.length; i++) if (sel.has(list[i].id) && !sel.has(list[i - 1].id)) [list[i], list[i - 1]] = [list[i - 1], list[i]];
  }
  commit();
}

// ---------- pages ----------
export function addPage(after = state.pageIndex) {
  state.project.pages.splice(after + 1, 0, { id: uid('pg'), objects: [] });
  commit();
  setPage(after + 1);
}
export function duplicatePage(i = state.pageIndex) {
  const src = state.project.pages[i];
  state.project.pages.splice(i + 1, 0, { id: uid('pg'), objects: cloneObjects(src.objects, 0, 0) });
  commit();
  setPage(i + 1);
}
export function deletePage(i = state.pageIndex) {
  if (state.project.pages.length === 1) {
    state.project.pages[0].objects = [];
  } else state.project.pages.splice(i, 1);
  commit();
  setPage(Math.min(i, state.project.pages.length - 1));
}
export function movePage(i, dir) {
  const ps = state.project.pages;
  const j = i + dir;
  if (j < 0 || j >= ps.length) return;
  [ps[i], ps[j]] = [ps[j], ps[i]];
  commit();
  setPage(j);
}
