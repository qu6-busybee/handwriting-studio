// Form controls for the properties panel. Each control can register a sync()
// so values refresh after undo/drag without rebuilding (and losing focus).
import { h, round } from '../util.js';
import { icon } from './icons.js';
import { INKS } from '../state.js';
import { fmtNum, fmtUnit, parseLength } from '../units.js';

export const syncers = new Set();
export function syncAll() {
  for (const s of syncers) s();
}
const reg = (el, fn) => {
  syncers.add(() => { if (!el.isConnected) return; if (!el.contains(document.activeElement)) fn(); });
};

export function section(title, content, { open = true, collapsible = false } = {}) {
  if (!collapsible) return h('section.psec', h('h4', title), ...content);
  const d = h('details.psec', h('summary', h('h4', title)), ...content);
  d.open = open;
  return d;
}

// slider + editable number
export function slider(label, get, { min, max, step = 0.01, unit = '', fmt, onInput, onCommit, tip }) {
  const show = (v) => (fmt ? fmt(v) : round(v, 2));
  const range = h('input', { type: 'range', min, max, step, value: get() });
  const num = h('input.num', { type: 'text', value: show(get()) });
  range.addEventListener('input', () => { num.value = show(+range.value); onInput(+range.value); });
  range.addEventListener('change', () => onCommit());
  num.addEventListener('change', () => {
    let v = parseFloat(num.value);
    if (isNaN(v)) v = get();
    if (fmt && fmt(1).endsWith('%')) v /= 100;
    onInput(v);
    onCommit();
    range.value = v;
    num.value = show(v);
  });
  const el = h('div.ctl.slider', { title: tip || null }, h('label', label), range, h('div.numwrap', num, unit && h('span.unit', unit)));
  reg(el, () => { range.value = get(); num.value = show(get()); });
  return el;
}

// Display units for lengths. Stored values are always millimetres.
export const UNITS = {
  in: { k: 25.4, dp: 3, step: 0.01, label: 'in' },
  mm: { k: 1, dp: 2, step: 0.1, label: 'mm' },
  cm: { k: 10, dp: 3, step: 0.01, label: 'cm' },
};
export const getUnit = () => (UNITS[localStorage.getItem('hws.unit')] ? localStorage.getItem('hws.unit') : 'in');
export const setUnit = (u) => localStorage.setItem('hws.unit', u);
export const unitInfo = () => UNITS[getUnit()];
// "1 1/2 in", "11/32 in", or "0.402 in (10.21 mm)" when not a clean fraction.
export function fmtLen(mm) {
  const u = getUnit();
  const clean = u !== 'in' || /^-?\d+( \d+\/\d+)?$|^-?\d+\/\d+$/.test(fmtNum(mm, 'in'));
  return fmtUnit(mm, u, { withMm: !clean });
}

// Length fields are text boxes so fractions can be typed: "1 1/2", "1/12",
// "8.5", or with a unit ("21 mm"). unit 'mm' marks a length.
export function numField(label, get, { step = 0.1, unit = 'mm', onChange, disabled, tip }) {
  const len = unit === 'mm';
  const u = getUnit();
  const show = () => (len ? fmtNum(get(), u) : String(round(get(), 1)));
  const inp = h('input.num', { type: 'text', inputmode: 'decimal', value: show(), disabled, title: len && u === 'in' ? 'Fractions work: 1 1/2, 3/8, 1/12' : null });
  inp.addEventListener('change', () => {
    const v = len ? parseLength(inp.value, u) : parseFloat(inp.value);
    if (isNaN(v)) { inp.value = show(); return; }
    onChange(v);
    inp.value = show();
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const d = (len ? (u === 'in' ? 25.4 / 32 : u === 'cm' ? 1 : 0.1) : step) * (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1);
    onChange(get() + d);
    inp.value = show();
  });
  const el = h('label.ctl.numf', { title: tip || null }, h('span', label), h('div.numwrap', inp, h('span.unit', len ? u : unit)));
  reg(el, () => { inp.value = show(); });
  return el;
}

// Slider for quick changes plus a typed value for precision, in display units.
// min/max are millimetres; onInput receives millimetres. In inches the slider
// moves in 1/64 in steps so values land on clean fractions.
export function lenSlider(label, get, { min, max, onInput, onCommit, tip }) {
  const u = getUnit();
  const show = (mm) => fmtNum(mm, u);
  const step = u === 'in' ? 25.4 / 64 : u === 'cm' ? 0.1 : 0.05;
  const range = h('input', { type: 'range', min, max, step, value: get() });
  const num = h('input.num', { type: 'text', inputmode: 'decimal', value: show(get()), title: u === 'in' ? 'Fractions work: 1 1/2, 3/8, 1/12' : null });
  const snapStep = (v) => (u === 'in' ? Math.round(v / step) * step : v);
  range.addEventListener('input', () => { const v = snapStep(+range.value); num.value = show(v); onInput(v); });
  range.addEventListener('change', () => onCommit());
  num.addEventListener('change', () => {
    const v = parseLength(num.value, u);
    if (isNaN(v)) { num.value = show(get()); return; }
    onInput(v);
    onCommit();
    range.value = v;
    num.value = show(v);
  });
  const el = h('div.ctl.slider', { title: tip || null }, h('label', label), range, h('div.numwrap.wide', num, h('span.unit', u)));
  reg(el, () => { range.value = get(); num.value = show(get()); });
  return el;
}

export function toggle(label, get, onChange, tip) {
  const inp = h('input', { type: 'checkbox', checked: !!get() });
  inp.addEventListener('change', () => onChange(inp.checked));
  const el = h('label.ctl.toggle', { title: tip || null }, h('span', label), inp, h('span.switch'));
  reg(el, () => { inp.checked = !!get(); });
  return el;
}

export function select(label, get, options, onChange) {
  const sel = h('select', {}, ...options.map((o) => (o.group
    ? h('optgroup', { label: o.group }, ...o.items.map((i) => h('option', { value: i.value }, i.label)))
    : h('option', { value: o.value }, o.label))));
  sel.value = get();
  sel.addEventListener('change', () => onChange(sel.value));
  const el = h('label.ctl.sel', label && h('span', label), sel);
  reg(el, () => { sel.value = get(); });
  return el;
}

export function segmented(label, get, items, onChange) {
  const wrap = h('div.seg');
  const btns = items.map(([v, text, tip]) => {
    const b = h('button', { title: tip || null, on: { click: () => onChange(v) } }, text);
    b.dataset.v = v;
    wrap.append(b);
    return b;
  });
  const upd = () => btns.forEach((b) => b.classList.toggle('on', b.dataset.v === String(get())));
  upd();
  const el = h('div.ctl.segc', label && h('span.lbl', label), wrap);
  syncers.add(() => el.isConnected && upd());
  wrap.addEventListener('click', () => setTimeout(upd));
  return el;
}

export function colorRow(label, get, onChange, { allowNone = false, presets = INKS } = {}) {
  const wrap = h('div.swatches');
  const custom = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(get()) ? get() : '#000000', title: 'Custom colour' });
  custom.addEventListener('input', () => onChange(custom.value, false));
  custom.addEventListener('change', () => onChange(custom.value, true));
  const sw = presets.map((p) => {
    const b = h('button.sw', { title: p.name, style: { background: p.color }, on: { click: () => onChange(p.color, true) } });
    b.dataset.c = p.color;
    return b;
  });
  if (allowNone) {
    const n = h('button.sw.none', { title: 'None', on: { click: () => onChange('none', true) } });
    n.dataset.c = 'none';
    sw.unshift(n);
  }
  wrap.append(...sw, h('label.sw.custom', { title: 'Custom colour' }, custom));
  const upd = () => sw.forEach((b) => b.classList.toggle('on', b.dataset.c.toLowerCase() === String(get()).toLowerCase()));
  upd();
  const el = h('div.ctl.colors', h('span.lbl', label), wrap);
  syncers.add(() => el.isConnected && upd());
  wrap.addEventListener('click', () => setTimeout(upd));
  return el;
}

export const iconBtn = (name, title, onClick, cls = '') =>
  h('button.icon-btn' + cls, { title, 'aria-label': title, on: { click: onClick } }, icon(name));
