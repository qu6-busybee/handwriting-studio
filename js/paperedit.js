// Paper changes as transactions: live updates while dragging or sliding,
// one undo step on commit, and text that keeps its place on the ruling.
import * as S from './state.js';
import { writingBox, lineIndexAt, tiltAt, normalizePaper } from './paper.js';

let txn = null; // { paper: snapshot, objs: Map(id -> original geometry) }

function begin() {
  if (txn) return;
  const p = S.state.project;
  txn = { paper: JSON.parse(JSON.stringify(p.paper)), objs: new Map() };
  for (const pg of p.pages) for (const o of pg.objects) if (o.type === 'text') txn.objs.set(o.id, { x: o.x, y: o.y, w: o.w, rot: o.rot || 0 });
}

export function livePaper(mutate) {
  begin();
  const paper = S.state.project.paper;
  mutate(paper);
  normalizePaper(paper);
  realign(txn.paper, paper, txn.objs);
  S.bus.emit('change');
}

export function commitPaper(mutate) {
  if (mutate) livePaper(mutate);
  if (!txn) return;
  txn = null;
  S.commit();
}

// Text that was sitting on a ruled line stays on the same line number, and
// text aligned to the writing margins follows them. Free-placed text, locked
// text and boxes with their own line spacing are left alone. Positions are
// always recomputed from the originals, so nothing drifts during a drag.
function realign(old, neu, origs) {
  const align = S.state.project.view.snapLines !== false;
  const ow = writingBox(old), nw = writingBox(neu);
  for (const pg of S.state.project.pages) {
    for (const o of pg.objects) {
      const o0 = origs.get(o.id);
      if (!o0 || o.locked) continue;
      let { x, w, y, rot } = o0;
      const leftAligned = Math.abs(o0.x - ow.x) < 0.6;
      const rightAligned = Math.abs(o0.x + o0.w - (ow.x + ow.w)) < 0.6;
      if (leftAligned) x = nw.x;
      if (rightAligned) w = nw.x + nw.w - x;
      else if (leftAligned) w = o0.x + o0.w - x;
      w = Math.max(10, w);
      if (align && o.hw.followLines !== false && !(o.hw.lineSpacing > 0)) {
        const cx0 = o0.x + o0.w / 2;
        const f = lineIndexAt(old, o0.y + old.spacing * 0.74, cx0);
        const idx = Math.round(f);
        if (Math.abs(f - idx) < 0.2) {
          y = neu.firstLine + idx * neu.spacing + tiltAt(neu, x + w / 2) - neu.spacing * 0.74;
          const oldA = old.lineStyle?.angle || 0;
          if (Math.abs(o0.rot - oldA) < 0.01) rot = neu.lineStyle.angle || 0;
        }
      }
      Object.assign(o, { x, w, y, rot });
    }
  }
}
