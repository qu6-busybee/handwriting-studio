import * as S from './state.js';
import * as store from './store.js';
import { initStyles } from './handwriting/styles.js';
import { initCanvas, initClipboard } from './editor/canvas.js';
import { initTopbar, initLeft, initStepView } from './ui/panels.js';
import { initProps } from './ui/props.js';
import { openPrintPreview } from './print.js';

const WELCOME = `Welcome to Handwriting Studio

	Drag this text box anywhere, double-click to edit it, and pick a different style on the left. The notebook lines are only a guide; they are never printed.

Mistakes can be ~~crossed~~ out and words can be __underlined__.`;

async function boot() {
  await initStyles().catch((e) => console.error('Fonts failed to load', e));

  let project = null;
  try {
    const last = await store.get('kv', 'lastProject');
    if (last) project = await store.get('projects', last);
  } catch (e) {
    console.warn('Storage unavailable', e);
  }

  initTopbar();
  initStepView();
  initLeft();
  initCanvas();
  initProps();
  initClipboard();

  if (project) S.loadProject(project);
  else {
    const p = S.createProject('filler-wide');
    S.loadProject(p);
    const o = S.newTextObject({ text: WELCOME });
    o.y = p.paper.firstLine + p.paper.spacing - p.paper.spacing * 0.74;
    S.addObjects([o], { select: false });
    S.resetHistory();
  }

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      openPrintPreview();
    }
  });
  window.addEventListener('beforeunload', () => S.saveNow());
  document.getElementById('app').classList.remove('loading');
}

boot();
