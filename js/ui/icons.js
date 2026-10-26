// Simple 24px stroke icons (Lucide-style shapes, drawn for this app).
const P = {
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  'zoom-in': 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3M11 8v6M8 11h6',
  'zoom-out': 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3M8 11h6',
  fit: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
  printer: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  x: 'M18 6 6 18M6 6l12 12',
  type: 'M4 7V4h16v3M9 20h6M12 4v16',
  rect: 'M4 5h16v14H4z',
  ellipse: 'M12 4c4.97 0 9 3.58 9 8s-4.03 8-9 8-9-3.58-9-8 4.03-8 9-8z',
  triangle: 'M12 4 21 20H3z',
  line: 'M4 19 20 5',
  arrow: 'M4 12h16M14 6l6 6-6 6',
  'double-arrow': 'M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4',
  star: 'm12 3 2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.4l-5.6 2.9 1.1-6.2L3 9.7l6.2-.9z',
  check: 'M4 12.5 9.5 18 20 6',
  cross: 'M5 5l14 14M19 5 5 19',
  underline: 'M3 15c3-4 5 4 8 0s5-4 8 0 2 0 2 0',
  bracket: 'M15 3c-3 0-4 1-4 4v2c0 2-1 3-3 3 2 0 3 1 3 3v2c0 3 1 4 4 4',
  highlight: 'M9 11l-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4',
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  image: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M21 15l-5-5L5 21',
  layers: 'm12 2 10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5',
  pages: 'M8 3h10a2 2 0 0 1 2 2v12M4 7h10a2 2 0 0 1 2 2v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z',
  plus: 'M12 5v14M5 12h14',
  insert: 'M12 5v14M5 12h14',
  copy: 'M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  up: 'm18 15-6-6-6 6',
  down: 'm6 9 6 6 6-6',
  right: 'm9 18 6-6-6-6',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  'eye-off': 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.1 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.8-1',
  'align-left': 'M4 3v18M8 7h12v4H8zM8 13h7v4H8z',
  'align-center': 'M12 3v18M6 7h12v4H6zM8.5 13h7v4h-7z',
  'align-right': 'M20 3v18M4 7h12v4H4zM9 13h7v4H9z',
  'align-top': 'M3 4h18M7 8h4v12H7zM13 8h4v7h-4z',
  'align-middle': 'M3 12h18M7 6h4v12H7zM13 8.5h4v7h-4z',
  'align-bottom': 'M3 20h18M7 4h4v12H7zM13 9h4v7h-4z',
  'dist-h': 'M4 3v18M20 3v18M10 7h4v10h-4z',
  'dist-v': 'M3 4h18M3 20h18M7 10h10v4H7z',
  group: 'M3 3h7v7H3zM14 14h7v7h-7zM14 3h7v7h-7zM3 14h7v7H3z',
  ruled: 'M4 3h16v18H4zM4 8h16M4 12h16M4 16h16M8 3v18',
  calibrate: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  shuffle: 'M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
  'panel-left': 'M3 3h18v18H3zM9 3v18',
  'panel-right': 'M3 3h18v18H3zM15 3v18',
  cursor: 'm4 4 7 17 2.5-7.5L21 11z',
  feather: 'M20.2 12.2a6 6 0 0 0-8.5-8.5L5 10.5V19h8.5zM16 8 2 22M17.5 15H9',
  more: 'M12 6h.01M12 12h.01M12 18h.01',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
  cloud: 'M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 0 1 0 9z',
  grid: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
};

export function icon(name, size = 18) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('class', 'ic');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<path d="${P[name] || P.more}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>`;
  return s;
}
