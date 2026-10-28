// Version history: a saved copy of the project before every AI change (and
// whenever the user saves one). Kept in IndexedDB beside the project, so the
// project itself stays small. Pictures live in project.assets, which versions
// share, so restoring never loses an image.
import { h, toast } from '../util.js';
import * as S from '../state.js';
import * as store from '../store.js';
import { openModal, confirmDialog } from '../ui/modal.js';

const { state } = S;
const MAX = 30;
const key = () => `versions:${state.project.id}`;
const FIELDS = ['name', 'paper', 'pages', 'writer', 'view', 'stage', 'print', 'ai'];

export async function listVersions() {
  try { return (await store.get('kv', key())) || []; } catch { return []; }
}

export async function saveVersion(label) {
  const p = state.project;
  const data = JSON.stringify(Object.fromEntries(FIELDS.map((f) => [f, p[f]])));
  const list = await listVersions();
  if (list[0]?.data === data) return; // nothing changed since the last one
  const pages = p.pages.length;
  const words = p.pages.reduce((n, pg) => n + pg.objects.reduce((m, o) => m + (o.text ? o.text.split(/\s+/).filter(Boolean).length : 0), 0), 0);
  list.unshift({ at: Date.now(), label, pages, words, data });
  await store.put('kv', key(), list.slice(0, MAX));
}

export async function restoreVersion(v) {
  await saveVersion('Before restoring an earlier version');
  Object.assign(state.project, JSON.parse(v.data));
  state.pageIndex = Math.min(state.pageIndex, state.project.pages.length - 1);
  S.commit(); // undoable
  S.setPage(state.pageIndex);
  S.bus.emit('stage');
  S.bus.emit('project');
}

const when = (t) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export async function openHistory() {
  const m = openModal('Version history');
  m.el.classList.add('history');
  const list = h('div.ver-list');
  const render = async () => {
    const vs = await listVersions();
    list.replaceChildren(...(vs.length ? vs.map((v) => h('div.ver',
      h('div.grow', h('div', v.label), h('div.muted.small', `${when(v.at)} · ${v.pages} page${v.pages === 1 ? '' : 's'} · ${v.words} words`)),
      h('button.btn.small', { on: { click: async () => {
        if (await confirmDialog('Restore this version? Your current pages are saved as a version first, so you can come back to them.', 'Restore')) {
          await restoreVersion(v);
          m.close();
          toast('Version restored');
        }
      } } }, 'Restore'))) : [h('p.muted.small', 'No versions yet. A version is saved automatically before every AI change.')]));
  };
  m.body.append(h('p.muted.small', 'A copy is saved automatically before every AI change. Undo (Ctrl Z) also works for recent edits.'), list);
  m.foot.append(
    h('button.btn', { on: { click: async () => { await saveVersion('Saved by you'); render(); toast('Version saved'); } } }, 'Save current version'),
    h('button.btn.primary', { on: { click: m.close } }, 'Done'));
  render();
}
