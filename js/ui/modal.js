import { h } from '../util.js';
import { icon } from './icons.js';

// Opens a modal; returns { el, body, foot, close }.
export function openModal(title, { wide = false, onClose } = {}) {
  const body = h('div.modal-body');
  const foot = h('div.modal-foot');
  const close = () => {
    back.remove();
    window.removeEventListener('keydown', esc, true);
    onClose?.();
  };
  const esc = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.stopPropagation(); close(); } };
  const el = h('div.modal' + (wide ? '.wide' : ''),
    h('div.modal-head', h('h2', title), h('button.icon-btn', { title: 'Close', on: { click: close } }, icon('x'))),
    body, foot);
  const back = h('div.modal-back', { on: { pointerdown: (e) => { if (e.target === back) close(); } } }, el);
  document.getElementById('modal-root').append(back);
  window.addEventListener('keydown', esc, true);
  return { el, body, foot, close };
}

export function confirmDialog(message, okLabel = 'Delete') {
  return new Promise((res) => {
    const m = openModal('Are you sure?', { onClose: () => res(false) });
    m.body.append(h('p', message));
    m.foot.append(
      h('button.btn', { on: { click: () => { m.close(); } } }, 'Cancel'),
      h('button.btn.danger', { on: { click: () => { res(true); m.close(); } } }, okLabel),
    );
  });
}
