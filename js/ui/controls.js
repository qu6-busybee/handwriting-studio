// Form controls for the properties panel. Each control can register a sync()
// so values refresh after undo/drag without rebuilding (and losing focus).
import { h, round } from '../util.js';
import { icon } from './icons.js';
import { INKS } from '../state.js';

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

// Display unit for lengths: inches or millimetres (stored values are always mm).
export const getUnit = () => localStorage.getItem('hws.unit') || 'in';
export const setUnit = (u) => localStorage.setItem('hws.unit', u);

// unit 'mm' marks a length, shown in the user's chosen unit.
export function numField(label, get, { step = 0.1, unit = 'mm', onChange, disabled }) {
  const len = unit === 'mm';
  const inch = len && getUnit() === 'in';
  const k = inch ? 25.4 : 1;
  const show = () => round(get() / k, inch ? 3 : 1);
  const inp = h('input.num', { type: 'number', step: inch ? 0.01 : step, value: show(), disabled });
  inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (!isNaN(v)) onChange(v * k); });
  const el = h('label.ctl.numf', h('span', label), h('div.numwrap', inp, h('span.unit', inch ? 'in' : unit)));
  reg(el, () => { inp.value = show(); });
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
