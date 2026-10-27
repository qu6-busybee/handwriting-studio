// Basic / Pro plan — TEST MODE.
// There are no accounts or payments yet: the plan is a local setting so the
// two tiers can be tried out. Defaults to Pro. When a real backend exists,
// replace getPlan() with the server's answer and enforce Pro features there.
import { h } from './util.js';
import { bus } from './state.js';
import { openModal } from './ui/modal.js';

const KEY = 'hws.testPlan';

// Which features each plan unlocks (single place to change later).
export const FEATURES = {
  aiLayout: 'pro', // AI Auto-Layout, image-to-text, automatic multi-page organisation
  premiumStyles: 'pro', // premium handwriting styles
  advancedInk: 'pro', // instruments, colour picker, darkness, pressure, texture, variation…
  perElement: 'pro', // different handwriting settings per text box
  customHandwriting: 'pro', // draw / scan / upload your own handwriting
};

export function getPlan() {
  try { return localStorage.getItem(KEY) === 'basic' ? 'basic' : 'pro'; } catch { return 'pro'; }
}
export function setPlan(p) {
  try { localStorage.setItem(KEY, p); } catch { /* ignore */ }
  bus.emit('plan');
}
export const isPro = () => getPlan() === 'pro';
export const can = (feature) => FEATURES[feature] !== 'pro' || isPro();

const COPY = {
  aiLayout: ['Save time with AI Auto-Layout', 'Paste text or upload images, and Pro will automatically organize your content across perfectly aligned notebook pages.'],
  premiumStyles: ['Premium handwriting styles', 'Pro unlocks the full handwriting library, including flowing cursive and quick, natural styles.'],
  advancedInk: ['More realistic ink with Pro', 'Gel, fountain pen and pencil effects, custom colours, ink darkness, pressure, texture and natural letter variation.'],
  perElement: ['Different styles per element', 'With Pro, a title can be black gel pen while the notes below are blue ballpoint.'],
  customHandwriting: ['Your own handwriting', 'Pro can learn your handwriting from drawn letters, a scanned sample sheet or a font file.'],
};

// One simple dialog, shown only when a Basic user clicks a Pro feature.
export function upgradeDialog(feature = 'aiLayout') {
  const [title, text] = COPY[feature] || COPY.aiLayout;
  const m = openModal(title);
  m.el.classList.add('upgrade');
  m.body.append(
    h('div.pro-hero', h('span.pro-badge.big', 'PRO')),
    h('p', text),
    h('ul.pro-list',
      h('li', 'AI Auto-Layout across as many pages as needed'),
      h('li', 'Read text from screenshots and photos'),
      h('li', 'Premium handwriting styles and realistic ink'),
      h('li', 'Different handwriting for each element')),
    h('p.muted.small', 'Test mode: there are no payments yet. “Upgrade to Pro” simply switches this browser to Pro.'));
  m.foot.append(
    h('button.btn', { on: { click: m.close } }, 'Not now'),
    h('button.btn.primary', { on: { click: () => { setPlan('pro'); m.close(); } } }, 'Upgrade to Pro'));
}

export const proBadge = () => h('span.pro-badge', 'PRO');

// Wraps a control so Basic users see it (with a PRO badge) but can't use it;
// clicking it opens the upgrade dialog instead.
export function gate(el, feature) {
  if (!el || can(feature)) return el;
  el.classList.add('locked');
  el.querySelectorAll('input, select, button, textarea').forEach((i) => { i.disabled = true; i.tabIndex = -1; });
  const label = el.querySelector('summary h4') || el.querySelector('label, .lbl, span');
  if (label) label.append(' ', proBadge());
  el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); upgradeDialog(feature); }, true);
  el.title = 'Pro feature';
  return el;
}
