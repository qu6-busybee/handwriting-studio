// Turns a picture into hand-drawn pen strokes, entirely in the browser:
// background removal → blur (simplify) → edge detection → thin edge chains →
// smoothed polylines with a little hand wobble, plus optional hatch shading
// for dark areas. The result is vector strokes, so it prints sharp.
import { simplify, rng } from '../util.js';

// The six drawing styles and their starting settings.
export const DRAW_STYLES = {
  ballpoint: { label: 'Blue ballpoint sketch', color: '#22408f', pen: 'ballpoint', width: 0.35, detail: 0.5, simplicity: 0.4, smoothness: 0.5, shading: 0, darkness: 0.85, wobble: 0.6 },
  outline: { label: 'Black pen outline', color: '#1d1d24', pen: 'gel', width: 0.45, detail: 0.4, simplicity: 0.55, smoothness: 0.6, shading: 0, darkness: 0.95, wobble: 0.5 },
  pencil: { label: 'Pencil sketch', color: '#47494f', pen: 'pencil', width: 0.3, detail: 0.6, simplicity: 0.35, smoothness: 0.45, shading: 0.5, darkness: 0.75, wobble: 0.7 },
  minimal: { label: 'Minimal line drawing', color: '#1d1d24', pen: 'finetip', width: 0.35, detail: 0.22, simplicity: 0.85, smoothness: 0.85, shading: 0, darkness: 0.9, wobble: 0.4 },
  notebook: { label: 'Notebook diagram', color: '#22408f', pen: 'ballpoint', width: 0.4, detail: 0.38, simplicity: 0.6, smoothness: 0.7, shading: 0.12, darkness: 0.85, wobble: 0.5 },
  technical: { label: 'Technical diagram', color: '#1d1d24', pen: 'finetip', width: 0.3, detail: 0.55, simplicity: 0.5, smoothness: 0.92, shading: 0, darkness: 0.95, wobble: 0.1 },
};

export const loadImage = (src) => new Promise((res, rej) => {
  const i = new Image();
  i.onload = () => res(i);
  i.onerror = () => rej(new Error('That image could not be opened.'));
  i.src = src;
});

// settings: detail, simplicity, smoothness, shading, wobble (0..1), removeBg.
// Returns { strokes: [{ p: [[u, v]…], s }], aspect } with u, v in 0..1.
export async function traceImage(src, set) {
  const img = await loadImage(src);
  const maxDim = Math.round(180 + set.detail * 340);
  const sc = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(8, Math.round(img.naturalWidth * sc)), H = Math.max(8, Math.round(img.naturalHeight * sc));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.fillStyle = '#fff';
  cx.fillRect(0, 0, W, H);
  cx.drawImage(img, 0, 0, W, H);
  const px = cx.getImageData(0, 0, W, H).data;
  const N = W * H;

  // Luminance, and a background mask (colour close to the border colour).
  let L = new Float32Array(N);
  for (let i = 0; i < N; i++) L[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
  const bg = new Uint8Array(N);
  if (set.removeBg) {
    const border = [];
    for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x);
    for (let y = 0; y < H; y++) border.push(y * W, y * W + W - 1);
    const med = [0, 1, 2].map((c) => border.map((i) => px[i * 4 + c]).sort((a, b) => a - b)[border.length >> 1]);
    // Flood from the border through pixels close to the background colour.
    const near = (i) => Math.abs(px[i * 4] - med[0]) + Math.abs(px[i * 4 + 1] - med[1]) + Math.abs(px[i * 4 + 2] - med[2]) < 70;
    const stack = border.filter(near);
    for (const i of stack) bg[i] = 1;
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i / W) | 0;
      for (const j of [x > 0 && i - 1, x < W - 1 && i + 1, y > 0 && i - W, y < H - 1 && i + W]) {
        if (j !== false && !bg[j] && near(j)) { bg[j] = 1; stack.push(j); }
      }
    }
    for (let i = 0; i < N; i++) if (bg[i]) L[i] = 1;
  }

  // Blur: more simplicity = fewer, bolder shapes.
  const r = Math.round(1 + set.simplicity * 3.5);
  L = boxBlur(boxBlur(L, W, H, r), W, H, r);

  // Sobel gradients, then thin edges with non-maximum suppression.
  const G = new Float32Array(N), D = new Uint8Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const gx = L[i - W + 1] + 2 * L[i + 1] + L[i + W + 1] - L[i - W - 1] - 2 * L[i - 1] - L[i + W - 1];
    const gy = L[i + W - 1] + 2 * L[i + W] + L[i + W + 1] - L[i - W - 1] - 2 * L[i - W] - L[i - W + 1];
    G[i] = Math.hypot(gx, gy);
    const a = ((Math.atan2(gy, gx) * 180) / Math.PI + 180) % 180;
    D[i] = a < 22.5 || a >= 157.5 ? 0 : a < 67.5 ? 1 : a < 112.5 ? 2 : 3;
  }
  const off = [[1, -1], [W + 1, -W - 1], [W, -W], [W - 1, -W + 1]];
  const T = new Float32Array(N);
  for (let i = W; i < N - W; i++) {
    const [a, b] = off[D[i]];
    if (G[i] >= G[i + a] && G[i] >= G[i + b]) T[i] = G[i];
  }
  // Keep edges at least a fraction as strong as the strongest ones; more
  // "detail" lowers the bar so fainter edges are drawn too.
  const vals = [];
  for (let i = 0; i < N; i++) if (T[i] > 0.02) vals.push(T[i]);
  vals.sort((a, b) => b - a);
  const top = vals[Math.floor(vals.length * 0.02)] || 1;
  const hi = Math.max(0.04, top * (0.06 + (1 - set.detail) * 0.34)), lo = hi * 0.5;
  const E = new Uint8Array(N);
  const stack = [];
  for (let i = 0; i < N; i++) if (T[i] >= hi) { E[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop();
    for (const j of nbrs(i, W, H)) if (!E[j] && T[j] >= lo) { E[j] = 1; stack.push(j); }
  }

  // Follow connected edge pixels into chains.
  const chains = [];
  const seen = new Uint8Array(N);
  const count = (i) => nbrs(i, W, H).filter((j) => E[j]).length;
  const walk = (s) => {
    const out = [s];
    seen[s] = 1;
    let cur = s, dir = null;
    for (;;) {
      let best = -1, bs = -9;
      for (const j of nbrs(cur, W, H)) {
        if (!E[j] || seen[j]) continue;
        const d = [(j % W) - (cur % W), ((j / W) | 0) - ((cur / W) | 0)];
        const sc2 = dir ? d[0] * dir[0] + d[1] * dir[1] : 0; // prefer going straight
        if (sc2 > bs) { bs = sc2; best = j; }
      }
      if (best < 0) break;
      dir = [(best % W) - (cur % W), ((best / W) | 0) - ((cur / W) | 0)];
      seen[best] = 1;
      out.push(best);
      cur = best;
    }
    return out;
  };
  for (let i = 0; i < N; i++) if (E[i] && !seen[i] && count(i) <= 1) chains.push(walk(i));
  for (let i = 0; i < N; i++) if (E[i] && !seen[i]) chains.push(walk(i));

  const minLen = 3 + set.simplicity * 22;
  const eps = 0.5 + set.smoothness * 1.6;
  const R = rng(W * 31 + H);
  const wob = set.wobble ?? 0.5;
  const strokes = [];
  let total = 0;
  for (const c of chains) {
    if (c.length < minLen) continue;
    let pts = c.map((i) => [i % W, (i / W) | 0]);
    pts = simplify(pts, eps);
    // A hand never retraces a line perfectly: drift a little along the stroke.
    const amp = wob * 0.35;
    let ox = 0, oy = 0;
    pts = pts.map(([x, y]) => { ox = ox * 0.7 + (R() - 0.5) * amp; oy = oy * 0.7 + (R() - 0.5) * amp; return [x + ox, y + oy]; });
    strokes.push({ p: pts, s: 1 });
    total += pts.length;
  }

  // Hatch shading for dark areas (pencil-style), drawn as lighter strokes.
  if (set.shading > 0) {
    const gap = 3 + (1 - set.shading) * 6;
    const dark = 0.28 + set.shading * 0.32;
    const hatch = (dx, dy, thresh) => {
      const len = W + H;
      for (let t = -H; t < W + H; t += gap) {
        let run = [];
        for (let s = 0; s < len; s += 1) {
          const x = t + s * dx, y = s * dy;
          const xi = Math.round(x), yi = Math.round(y);
          const inside = xi >= 0 && yi >= 0 && xi < W && yi < H;
          const on = inside && !bg[yi * W + xi] && L[yi * W + xi] < thresh;
          if (on) run.push([x, y]);
          if ((!on || s === len - 1) && run.length) {
            if (run.length > 3) { strokes.push({ p: [run[0], run[run.length - 1]], s: 0.6 }); total += 2; }
            run = [];
          }
        }
      }
    };
    hatch(0.7, 0.7, dark);
    hatch(-0.7, 0.7, dark - 0.18);
  }
  if (!strokes.length) throw new Error('No clear shapes were found. Try more detail or turn off background removal.');
  if (total > 30000) throw new Error('This picture is very busy. Lower the detail or raise “Simplify”.');
  return { strokes: normalise(strokes, W, H), aspect: H / W };
}

function nbrs(i, W, H) {
  const x = i % W, y = (i / W) | 0, out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < W && ny < H) out.push(ny * W + nx);
  }
  return out;
}

function boxBlur(src, W, H, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < W) { s += src[y * W + xx]; n++; } }
    tmp[y * W + x] = s / n;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < H) { s += tmp[yy * W + x]; n++; } }
    out[y * W + x] = s / n;
  }
  return out;
}

const r4 = (v) => Math.round(v * 1e4) / 1e4;
function normalise(strokes, W, H) {
  return strokes.map((st) => ({ p: st.p.map(([x, y]) => [r4(x / W), r4(y / H)]), s: st.s }));
}

// A diagram described by Claude (shapes and labels on a 0–100 grid) as
// hand-drawn strokes. Labels are returned separately so they stay editable
// text boxes. Lines get a slight hand wobble so nothing looks ruler-perfect.
export function diagramStrokes(spec, wobble = 0.5) {
  const W = 100, H = Math.max(20, Math.min(160, spec.height || 70));
  const R = rng((spec.title || '').length * 977 + 13);
  const strokes = [];
  const jitter = (pts) => pts.map(([x, y]) => [x + (R() - 0.5) * 0.35 * wobble, y + (R() - 0.5) * 0.35 * wobble]);
  const line = (a, b) => {
    const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
    return Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  };
  for (const sh of spec.shapes || []) {
    const P = (sh.points || []).filter((p) => Array.isArray(p) && p.length >= 2).map(([x, y]) => [+x, +y]);
    if (!P.length) continue;
    switch (sh.kind) {
      case 'ellipse': case 'circle': {
        const [c, e] = P.length > 1 ? P : [P[0], [P[0][0] + 5, P[0][1] + 5]];
        const rx = Math.abs(e[0] - c[0]) || 5, ry = sh.kind === 'circle' ? rx : Math.abs(e[1] - c[1]) || rx;
        const n = 28, a0 = R() * 6.28;
        strokes.push({ p: jitter(Array.from({ length: n + 2 }, (_, i) => [c[0] + rx * Math.cos(a0 + (i / n) * 6.3), c[1] + ry * Math.sin(a0 + (i / n) * 6.3)])), s: 1 });
        break;
      }
      case 'rect': {
        const [a, b] = P.length > 1 ? P : [P[0], [P[0][0] + 10, P[0][1] + 10]];
        const c = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]], [a[0], a[1]]];
        strokes.push({ p: jitter(c.slice(1).flatMap((q, i) => line(c[i], q))), s: 1 });
        break;
      }
      case 'curve':
        if (P.length > 1) strokes.push({ p: jitter(P), s: 1 });
        break;
      default: { // line, polyline, arrow
        if (P.length < 2) break;
        const pts = P.slice(1).flatMap((q, i) => line(P[i], q));
        strokes.push({ p: jitter(pts), s: 1 });
        if (sh.kind === 'arrow') {
          const [a, b] = [P[P.length - 2], P[P.length - 1]];
          const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L2 = 3;
          strokes.push({ p: jitter([[b[0] - L2 * Math.cos(ang - 0.45), b[1] - L2 * Math.sin(ang - 0.45)], b, [b[0] - L2 * Math.cos(ang + 0.45), b[1] - L2 * Math.sin(ang + 0.45)]]), s: 1 });
        }
      }
    }
  }
  const labels = (spec.labels || []).filter((l) => l.text).map((l) => ({ u: +l.x / W, v: +l.y / H, text: String(l.text) }));
  return { strokes: normalise(strokes, W, H), aspect: H / W, labels };
}
