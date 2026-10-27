// Writing instruments and how ink/graphite looks on paper.
// Every look is a vector path plus an SVG filter built per object, so the
// texture strength, pencil softness etc. can be tuned continuously.
import { svg, clamp } from '../util.js';

// add: extra stroke width (mm) around font outlines; op: base opacity;
// kind: which texture recipe; vary: how much pressure changes the weight.
export const PENS = {
  ballpoint: { label: 'Ballpoint', add: 0, op: 1, kind: 'ball', vary: 1 },
  gel: { label: 'Gel pen', add: 0.06, op: 1, kind: 'gel', vary: 0.8 },
  fountain: { label: 'Fountain pen', add: 0.05, op: 0.96, kind: 'fountain', vary: 1.8 },
  finetip: { label: 'Fine-tip pen', add: -0.03, op: 1, kind: 'gel', vary: 0.5 },
  mechpencil: { label: 'Mechanical pencil', add: 0, op: 0.86, kind: 'pencil', grain: 7.5, vary: 0.8 },
  pencil: { label: 'Graphite pencil', add: 0.05, op: 0.92, kind: 'pencil', grain: 4.5, vary: 1.3 },
  marker: { label: 'Marker', add: 0.32, op: 0.9, kind: 'marker', vary: 0.4 },
};
export const isPencil = (pen) => PENS[pen]?.kind === 'pencil';

export const INK_PRESETS = [
  { name: 'Standard blue', color: '#22408f' },
  { name: 'Dark blue', color: '#1a2a6c' },
  { name: 'Light blue', color: '#3d6fd6' },
  { name: 'Black', color: '#1d1d24' },
  { name: 'Blue-black', color: '#1f2a44' },
  { name: 'Red', color: '#b3262e' },
  { name: 'Green', color: '#1f7a3d' },
  { name: 'Purple', color: '#5b2d8f' },
];
export const GRAPHITE_PRESETS = [
  { name: 'HB', color: '#47494f' },
  { name: '2B', color: '#323338' },
  { name: '2H', color: '#66686e' },
];

// Ink darkness: 0.5 = as chosen, higher mixes toward black, lower toward white.
export function shade(hex, darkness = 0.5) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m || Math.abs(darkness - 0.5) < 1e-3) return hex;
  const n = parseInt(m[1], 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const t = clamp((darkness - 0.5) * 1.3, -0.65, 0.65);
  const to = t > 0 ? 0 : 255, k = Math.abs(t);
  r = Math.round(r + (to - r) * k); g = Math.round(g + (to - g) * k); b = Math.round(b + (to - b) * k);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

// Resolved drawing parameters for a text box's handwriting settings.
export function penLook(hw) {
  const pen = PENS[hw.pen] || PENS.ballpoint;
  const pressure = hw.pressure ?? 0.5; // 0 light … 1 heavy
  // Weight factor 0.6…1.4 at neutral sensitivity; flexible nibs react more.
  const pk = Math.max(0.3, 1 + (pressure - 0.5) * 0.8 * pen.vary);
  const soft = isPencil(hw.pen) ? (hw.softness ?? 0.5) : 0;
  return {
    pen,
    weight: Math.max(0, (hw.weight ?? 0.05) + pen.add + soft * 0.06) * pk,
    penWidth: (hw.penWidth ?? 0.42) * (pk * 0.5 + 0.5) * (pen.kind === 'marker' ? 2.2 : pen === PENS.finetip ? 0.7 : 1),
    opacity: clamp(pen.op * (0.86 + pressure * 0.22) * (isPencil(hw.pen) ? 0.9 + soft * 0.12 : 1), 0.2, 1) * (hw.opacity ?? 1),
    color: (c) => shade(c, hw.darkness ?? 0.5),
    texture: typeof hw.texture === 'number' ? hw.texture : hw.texture === false ? 0 : 0.5,
    soft,
  };
}

const alphaMatrix = (k, b) => `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${-k} ${b}`;

// Builds the texture filter for one object. t = texture 0..1.
export function inkFilter(id, penKey, t, soft = 0.5) {
  const pen = PENS[penKey] || PENS.ballpoint;
  const f = svg('filter', { id, x: '-6%', y: '-25%', width: '112%', height: '150%', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
  const add = (tag, a) => f.append(svg(tag, a));
  const rough = (freq, scale, seed) => {
    add('feTurbulence', { type: 'fractalNoise', baseFrequency: freq, numOctaves: '2', seed, result: 'edge' });
    add('feDisplacementMap', { in: 'SourceGraphic', in2: 'edge', scale: scale.toFixed(3), xChannelSelector: 'R', yChannelSelector: 'G', result: 'rough' });
  };
  if (pen.kind === 'pencil') {
    rough('1.4', 0.08 + 0.08 * t, '9');
    const freq = (pen.grain || 5) - soft * 2.5; // softer graphite = coarser grain
    const k = 0.8 + 1.4 * t;
    add('feTurbulence', { type: 'fractalNoise', baseFrequency: freq.toFixed(2), numOctaves: '2', seed: '3', result: 'grain' });
    add('feColorMatrix', { in: 'grain', type: 'matrix', values: alphaMatrix(k, 1 + k * 0.42), result: 'grainA' });
    add('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.45', numOctaves: '1', seed: '21', result: 'press' });
    add('feColorMatrix', { in: 'press', type: 'matrix', values: alphaMatrix(0.3 + 0.6 * t, 1.1 + 0.3 * t), result: 'pressA' });
    add('feComposite', { in: 'grainA', in2: 'pressA', operator: 'arithmetic', k1: '1', k2: '0', k3: '0', k4: '0', result: 'mask' });
    add('feComposite', { in: 'rough', in2: 'mask', operator: 'in' });
  } else if (pen.kind === 'gel') {
    rough('1.2', 0.03 + 0.08 * t, '6');
  } else if (pen.kind === 'marker') {
    rough('0.9', 0.04 + 0.06 * t, '5');
    add('feGaussianBlur', { in: 'rough', stdDeviation: '0.04', result: 'soft' });
    add('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.3', numOctaves: '1', seed: '8', result: 'den' });
    add('feColorMatrix', { in: 'den', type: 'matrix', values: alphaMatrix(0.5 * t, 1 + 0.25 * t), result: 'denA' });
    add('feComposite', { in: 'soft', in2: 'denA', operator: 'in' });
  } else if (pen.kind === 'fountain') {
    // Wet ink: smooth edges, pooling where the nib slows down.
    rough('1.0', 0.04 + 0.06 * t, '12');
    add('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.35', numOctaves: '2', seed: '17', result: 'den' });
    add('feColorMatrix', { in: 'den', type: 'matrix', values: alphaMatrix(1.1 * t, 1 + 0.55 * t), result: 'denA' });
    add('feComposite', { in: 'rough', in2: 'denA', operator: 'in' });
  } else {
    // Ballpoint: slightly rough edges and patchy ink.
    rough('1.7', 0.05 + 0.14 * t, '4');
    add('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.6', numOctaves: '2', seed: '11', result: 'den' });
    add('feColorMatrix', { in: 'den', type: 'matrix', values: alphaMatrix(1.4 * t, 1 + 0.7 * t), result: 'denA' });
    add('feComposite', { in: 'rough', in2: 'denA', operator: 'in' });
  }
  return f;
}
