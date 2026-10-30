/**
 * Фишки на обводке пузыря: крошечный мотив, передающий суть каждого скина.
 * Рисуются в поле 10×10 (1 единица ≈ 1px), поэтому формы крупные и простые.
 * a — цвет скина, l — тёмная линия палитры.
 */
export type StudMotif = (a: string, l: string) => string;

const W = '#fff';
const sw = (l: string, w = 0.8) => `stroke="${l}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
const shape = (d: string, fill: string, l: string, w?: number) => `<path d="${d}" fill="${fill}" ${sw(l, w)}/>`;
const line = (d: string, color: string, w = 0.8) => `<path d="${d}" fill="none" ${sw(color, w)}/>`;
const dot = (cx: number, cy: number, r: number, fill: string, extra = '') => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${extra}/>`;
/** Неоновая линия: тёмная подложка + цветная трубка. */
const glow = (d: string, a: string, l: string, w = 1.2) => line(d, l, w + 1.2) + line(d, a, w);
/** Кольцо с тёмной окантовкой. */
const ring = (cx: number, cy: number, r: number, a: string, l: string) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${l}" stroke-width="2"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${a}" stroke-width=".9"/>`;

export const SKIN_STUDS: Record<string, StudMotif> = {
  // ── Игры ────────────────────────────────────────────────────────────────
  'games-blocks': (a, l) => shape('M1 3.5h8v3H6.5V9h-3V6.5H1z', a, l) + line('M3.5 3.5v3M6.5 3.5v3', l, 0.6),
  'games-plumber': (a, l) => shape('M1.2 5.6Q1.2 1 5 1t3.8 4.6z', a, l) + shape('M3.4 5.6h3.2V9H3.4z', W, l) + dot(3.3, 3.6, 0.8, W) + dot(6.7, 3.6, 0.8, W),
  'games-portal': (a, l) => `<ellipse cx="5" cy="5" rx="3" ry="4.2" fill="${a}" ${sw(l)}/><ellipse cx="5" cy="5" rx="1.5" ry="2.7" fill="${W}" ${sw(l, 0.5)}/>`,
  'games-bonfire': (a, l) => shape('M5 .8C7.6 3.4 8.4 5 8.4 6.4A3.4 3.4 0 0 1 1.6 6.4C1.6 4.8 2.6 3.6 3.6 2.8C3.6 4.4 4.4 5 4.4 5C5.2 3.8 5 2.4 5 .8z', a, l) + shape('M5 5.2C6 6.2 6.4 6.8 6.2 7.6A1.2 1.2 0 0 1 3.8 7.6C3.8 6.8 4.4 6 5 5.2z', W, l, 0.5),
  'games-dragon': (a, l) => shape('M.8 5Q5 .6 9.2 5Q5 9.4.8 5z', a, l) + `<path d="M5 2.4Q6.1 5 5 7.6Q3.9 5 5 2.4z" fill="${l}"/>`,
  'games-racer': (a, l) => `<path d="M1.2 1.2h7.6v7.6H1.2z" fill="${W}"/>` +
    `<path d="M1.2 1.2h2.53v2.53H1.2zM6.27 1.2H8.8v2.53H6.27zM3.73 3.73h2.54v2.54H3.73zM1.2 6.27h2.53V8.8H1.2zM6.27 6.27H8.8V8.8H6.27z" fill="${a}"/>` +
    line('M1.2 1.2h7.6v7.6H1.2z', l),
  'games-invader': (a, l) => shape('M2 2h1.2v1.2h3.6V2H8v1.2h1V6H8v1.2H6.8V8.4H5.6V7.2H4.4v1.2H3.2V7.2H2V6H1V3.2h1z', a, l, 0.6) + `<path d="M3.2 4h1.2v1.2H3.2zM5.6 4h1.2v1.2H5.6z" fill="${W}"/>`,
  'games-dungeon': (a, l) => shape('M5.2 4.3h4v1.4H8.4v1.6H7.2V5.7H5.2z', a, l, 0.6) + dot(3, 5, 2.2, a, sw(l)) + dot(3, 5, 0.8, W),
  'games-mech': (a, l) => shape('M5 .8l3.7 2.1v4.2L5 9.2 1.3 7.1V2.9z', a, l) + dot(5, 5, 1.6, W, sw(l, 0.6)),
  'games-crown': (a, l) => shape('M1 7.6L1.3 2.6 3.4 5 5 1.6 6.6 5 8.7 2.6 9 7.6z', a, l) + line('M1.2 8.8h7.6', l, 1),

  // ── Корпорация ──────────────────────────────────────────────────────────
  'corp-pass': (a, l) => shape('M1.5 2h7v6.6h-7z', W, l) + `<path d="M2.6 3.2h2.2v2.2H2.6z" fill="${a}"/>` + line('M5.6 3.6h1.8M5.6 5h1.2M2.6 7h4.8', l, 0.6) + shape('M4 1h2v1.4H4z', a, l, 0.5),
  'corp-tower': (a, l) => shape('M6.5 4h2v5h-2z', W, l, 0.6) + shape('M2.5 9V2.4L6.5 1v8z', a, l) + line('M3.6 3.6h1.8M3.6 5.2h1.8M3.6 6.8h1.8', W, 0.6),
  'corp-network': (a, l) => line('M2.5 2.5L5 5 7.5 2.5M5 5v3', l) + dot(2.5, 2.5, 1.3, a, sw(l, 0.6)) + dot(7.5, 2.5, 1.3, a, sw(l, 0.6)) + dot(5, 8, 1.3, a, sw(l, 0.6)) + dot(5, 5, 1.5, W, sw(l, 0.6)),
  'corp-contract': (a, l) => shape('M2 1h4.4L8 2.6V9H2z', W, l) + line('M6.4 1v1.6H8', l, 0.6) + line('M3.2 4h3.6M3.2 5.4h3.6', l, 0.5) + dot(6, 7.4, 1.1, a, sw(l, 0.5)),
  'corp-director': (a, l) => shape('M3.8 1h2.4l-.6 1.6L7 7.2 5 9.2 3 7.2l1.4-4.6z', a, l) + line('M4.4 2.6h1.2', l, 0.6),
  'corp-terminal': (a, l) => shape('M1 1.6h8v5.6H1z', l, l) + line('M2.4 3.2l1.4 1.2-1.4 1.2M4.8 5.6h2', a, 0.9) + line('M3.4 8.8h3.2M5 7.2v1.6', l),
  'corp-briefcase': (a, l) => line('M3.6 3.4V2.2h2.8v1.2', l) + shape('M1 3.4h8v5.2H1z', a, l) + line('M1 5.6h8', l, 0.6) + shape('M4.4 5h1.2v1.2H4.4z', W, l, 0.4),
  'corp-vault': (a, l) => dot(5, 5, 4, a, sw(l)) + line('M5 1.6v1.2M5 7.2v1.2M1.6 5h1.2M7.2 5h1.2', l, 0.6) + dot(5, 5, 2, W, sw(l, 0.6)) + line('M5 5l1-1', l, 0.7),
  'corp-satellite': (a, l) => line('M5 3.8V2M4 1.4Q5 2.6 6 1.4', l, 0.6) + shape('M.8 4h2.4v2H.8zM6.8 4h2.4v2H6.8z', a, l, 0.6) + shape('M3.6 3.6h2.8v2.8H3.6z', W, l),
  'corp-citadel': (a, l) => dot(5, 5, 4, a, sw(l)) + `<circle cx="5" cy="5" r="2.9" fill="none" stroke="${W}" stroke-width=".5"/>` + line('M6.2 3.6Q5 2.8 3.9 3.5Q3.4 4.4 5 5Q6.6 5.6 6.1 6.5Q5 7.2 3.8 6.4M5 2.4v5.2', l, 0.6),

  // ── Улица ───────────────────────────────────────────────────────────────
  'street-tag': (a, l) => glow('M1.4 6.4C2.6 1.6 3.6 8 4.8 3.4S7.4 6.8 8.6 2.8', a, l, 1.4) + line('M1.6 8.8h6.8', l, 0.6),
  'street-spray': (a, l) => shape('M4 1.6h2v1.8H4z', W, l, 0.6) + shape('M2.8 3.4h4.4V9.2H2.8z', a, l) + line('M2.8 5h4.4', W, 0.6) + dot(8.4, 1.4, 0.5, a) + dot(9.2, 2.6, 0.4, a) + dot(8.6, 3.6, 0.35, a),
  'street-stencil': (a, l) => shape('M1 3.8h4.2V1.4L9 5 5.2 8.6V6.2H1z', a, l) + line('M3.2 3.8v2.4', W, 0.7),
  'street-wildstyle': (a, l) => shape('M5.8.8L1.8 5.6h2.8L3.4 9.2l4.8-5.4H5.4z', a, l),
  'street-mural': (a, l) => shape('M1 1.2h8v3.6c0 1-1.2 1-1.2 0V7c0 1.4-1.6 1.4-1.6 0V4.8c0-.8-1.2-.8-1.2 0v.8c0 1.2-1.6 1.2-1.6 0V4.6C3.4 5.6 1 5.6 1 4.6z', a, l),
  'street-sticker': (a, l) => shape('M1.4 1.4h7.2v4.4L5.8 8.6H1.4z', a, l) + shape('M8.6 5.8H5.8v2.8z', W, l, 0.6) + dot(3.4, 4, 0.6, W) + dot(5.6, 4, 0.6, W),
  'street-poster': (a, l) => shape('M1.4 1h7.2v6.2l-1 1.2-1-1-1.2 1.4-1-1.2-1.2 1.2-1-1.2-.8.8z', W, l) + shape('M2.6 2.2h4.8v2.4H2.6z', a, l, 0.5) + line('M2.6 5.8h3.6', l, 0.6),
  'street-skate': (a, l) => `<rect x=".8" y="3" width="8.4" height="2.6" rx="1.3" fill="${a}" ${sw(l)}/>` + dot(2.8, 7.2, 1.1, W, sw(l, 0.6)) + dot(7.2, 7.2, 1.1, W, sw(l, 0.6)),
  'street-neon': (a, l) => glow('M5 8.4L1.8 5.2C.6 3.6 1.6 1.6 3.3 1.8 4.2 1.9 4.7 2.5 5 3 5.3 2.5 5.8 1.9 6.7 1.8 8.4 1.6 9.4 3.6 8.2 5.2z', a, l) + line('M5 8.4L1.8 5.2C.6 3.6 1.6 1.6 3.3 1.8 4.2 1.9 4.7 2.5 5 3 5.3 2.5 5.8 1.9 6.7 1.8 8.4 1.6 9.4 3.6 8.2 5.2z', W, 0.4),
  'street-crown': (a, l) => line('M2.4 6.2v2M5 6.2v2.8M7.6 6.2v1.4', l, 1.6) + line('M2.4 6.2v2M5 6.2v2.8M7.6 6.2v1.4', a, 0.8) + shape('M1.2 6.4L1.6 2 3.6 4 5 1.2 6.4 4 8.4 2 8.8 6.4z', a, l),

  // ── Культура ────────────────────────────────────────────────────────────
  'culture-book': (a, l) => shape('M5 2.6Q3.2 1.4 1 1.8v6Q3.2 7.4 5 8.6z', W, l) + shape('M5 2.6Q6.8 1.4 9 1.8v6Q6.8 7.4 5 8.6z', a, l),
  'culture-jazz': (a, l) => line('M5.1 7V1.2Q6.6 2.6 8.4 2.8', l, 0.9) + `<ellipse cx="3.4" cy="7.4" rx="1.9" ry="1.4" transform="rotate(-20 3.4 7.4)" fill="${a}" ${sw(l, 0.7)}/>`,
  'culture-theatre': (a, l) => shape('M1.4 1.6Q5 3 8.6 1.6V5.2Q8.6 8.6 5 8.6 1.4 8.6 1.4 5.2z', a, l) + line('M2.8 4.4Q3.6 3.6 4.4 4.4M5.6 4.4Q6.4 3.6 7.2 4.4M3.4 6.2Q5 7.6 6.6 6.2', W, 0.7),
  'culture-cinema': (a, l) => shape('M1.6 1h6.8v8H1.6z', l, l) +
    `<path d="M2.2 1.8h.9v1H2.2zM2.2 4.5h.9v1H2.2zM2.2 7.2h.9v1H2.2zM6.9 1.8h.9v1h-.9zM6.9 4.5h.9v1h-.9zM6.9 7.2h.9v1h-.9z" fill="${W}"/>` +
    `<path d="M3.7 2.2h2.6v5.6H3.7z" fill="${a}"/>`,
  'culture-heritage': (a, l) => line('M2.4 4v4M4.2 4v4M5.8 4v4M7.6 4v4', l) + shape('M1 3.4L5 1l4 2.4z', a, l) + shape('M1 8h8v1.2H1z', a, l, 0.6),
  'culture-ink': (a, l) => shape('M5 .8Q8 4.6 8 6.2A3 3 0 0 1 2 6.2Q2 4.6 5 .8z', l, l) + line('M3.6 6Q3.6 4.8 4.6 3.6', a, 0.8),
  'culture-gallery': (a, l) => shape('M1 1.4h8v7.2H1z', a, l) + shape('M2.2 2.6h5.6v4.8H2.2z', W, l, 0.5) + `<path d="M2.4 7.2L4.2 4.6 5.4 6 6.2 5.2 7.6 7.2z" fill="${a}"/>`,
  'culture-ballet': (a, l) => glow('M2 8.8C2 5.6 8 4.4 8 1.2', a, l) + dot(2, 8.8, 0.9, a, sw(l, 0.5)),
  'culture-orchestra': (a, l) => shape('M3.4 2.2L8.4 1v1.4L3.4 3.6z', l, l, 0.4) + line('M3.6 3v4.6M8.2 1.8v4.6', l) +
    `<ellipse cx="2.6" cy="7.6" rx="1.3" ry=".95" fill="${a}" ${sw(l, 0.6)}/><ellipse cx="7.2" cy="6.4" rx="1.3" ry=".95" fill="${a}" ${sw(l, 0.6)}/>`,
  'culture-observatory': (a, l) => line('M4.6 5.2L3 9M4.6 5.2L6.4 9', l) + shape('M1.4 5.2l5.6-3.4 1 1.6-5.6 3.4z', a, l, 0.7) + dot(8.8, 1.2, 0.55, a),

  // ── Древние реликвии ────────────────────────────────────────────────────
  'myths-crown': (a, l) => shape('M1.2 7.6V3l1.9 1.8L5 2l1.9 2.8L8.8 3v4.6z', a, l) + dot(1.2, 2.6, 0.7, W, sw(l, 0.5)) + dot(5, 1.6, 0.7, W, sw(l, 0.5)) + dot(8.8, 2.6, 0.7, W, sw(l, 0.5)) + dot(5, 5.8, 0.8, W),
  'myths-shield': (a, l) => shape('M5 .8l3.8 1.4V5Q8.8 8 5 9.2 1.2 8 1.2 5V2.2z', a, l) + line('M5 2v6M2.6 4.4h4.8', W, 0.8),
  'myths-scepter': (a, l) => line('M2.6 9.2L6.2 3.8', l, 1.2) + line('M2 6.6l2.4 1.4', l) + dot(6.8, 2.8, 1.8, a, sw(l, 0.7)) + dot(6.2, 2.2, 0.5, W),
  'myths-tome': (a, l) => shape('M1.8 1.2h6.4v7.6H1.8z', a, l) + line('M3 1.2v7.6', l, 0.6) + shape('M5.6 3l1 1.8-1 1.8-1-1.8z', W, l, 0.4),
  'myths-orb': (a, l) => shape('M2.6 7.4h4.8l.8 1.6H1.8z', l, l, 0.5) + dot(5, 4.2, 3.4, a, sw(l)) + line('M3.4 3.4Q3.8 2 5 1.8', W, 0.7),
  'myths-chalice': (a, l) => line('M5 5.6v2.4', l, 0.9) + shape('M1.8 1.4h6.4Q8.2 5.4 5 5.6 1.8 5.4 1.8 1.4z', a, l) + shape('M3 8h4v1H3z', a, l, 0.6),
  'myths-key': (a, l) => shape('M4.4 4.2h1.2V9.2H4.4zM5.6 6.6h1.4v.9H5.6zM5.6 8.1h1v.9h-1z', a, l, 0.5) + ring(5, 2.6, 1.8, a, l),
  'myths-lantern': (a, l) => line('M5 1v2M3.6 1.2h2.8', l, 0.7) + shape('M2.6 3h4.8v5H2.6z', a, l) + `<path d="M4.2 4.2h1.6v2.6H4.2z" fill="${W}"/>` + line('M2 8.8h6', l),
  'myths-ring': (a, l) => ring(5, 6, 2.8, a, l) + shape('M3.8 1.2h2.4L7 2.2 5 4 3 2.2z', W, l, 0.6),
  'myths-staff': (a, l) => shape('M6.6 1.2A3 3 0 1 0 6.8 6.2 2.4 2.4 0 1 1 6.6 1.2z', a, l, 0.6) + line('M4 9.2V4.4', l, 1.2) + dot(4, 3.6, 0.8, W, sw(l, 0.5)),

  // ── Космос ──────────────────────────────────────────────────────────────
  'nightmare-nova': (a, l) => shape('M5 .6Q5.6 4.4 9.4 5 5.6 5.6 5 9.4 4.4 5.6.6 5 4.4 4.4 5 .6z', a, l, 0.6) + dot(5, 5, 0.7, W),
  'nightmare-comet': (a, l) => `<path d="M5.8 4.2L.8 1.2 4.2 6z" fill="${a}" fill-opacity=".55"/>` + line('M5.4 4.6L1 1', a) + dot(6.6, 6.6, 2.4, a, sw(l)) + dot(6, 6, 0.6, W),
  'nightmare-orbit': (a, l) => dot(5, 5, 2.6, a, sw(l, 0.7)) +
    `<ellipse cx="5" cy="5" rx="4.4" ry="1.4" transform="rotate(-20 5 5)" fill="none" stroke="${l}" stroke-width="1.6"/>` +
    `<ellipse cx="5" cy="5" rx="4.4" ry="1.4" transform="rotate(-20 5 5)" fill="none" stroke="${W}" stroke-width=".6"/>`,
  'nightmare-nebula': (a, l) => shape('M2.6 7.6A1.9 1.9 0 0 1 2.4 3.8 2.6 2.6 0 0 1 7.2 3.4 2.1 2.1 0 0 1 7.6 7.6z', a, l) + line('M3.6 5.8Q5 4.6 6.4 5.8', W, 0.6),
  'nightmare-galaxy': (a, l) => glow('M5 5c0-.8 1.2-.8 1.2.2 0 1.2-1.8 1.4-2.4.2C3.2 4 5 2.6 6.6 3.2 8.6 4 8 7.6 5.4 8 2.4 8.4 1 5.6 1.8 3.4', a, l, 0.9) + dot(5.6, 5.2, 0.6, W),
  'nightmare-moon': (a, l) => shape('M6.4 1A4 4 0 1 0 9 6.6 3.2 3.2 0 0 1 6.4 1z', a, l) + dot(3.2, 5.4, 0.6, l, 'fill-opacity=".35"') + dot(4.6, 7.6, 0.45, l, 'fill-opacity=".35"'),
  'nightmare-void': (a, l) => `<ellipse cx="5" cy="5" rx="4.4" ry="1.9" fill="${a}" ${sw(l, 0.7)}/>` + dot(5, 5, 2.2, l) + line('M3 3.4Q5 2.2 7 3.4', W, 0.5),
  'nightmare-aurora': (a, l) => glow('M1 3.4Q3 1.8 5 3.4T9 3.4', a, l, 1) + glow('M1 6.6Q3 5 5 6.6T9 6.6', a, l, 1),
  'nightmare-meteor': (a, l) => line('M4.6 4.4L1 1M4 6L1.2 4.4M6 3.6L4.4.8', a, 0.7) + shape('M5.4 4.4l2.4-.6 1.2 1.8-.6 2.6-2.4.8-1.8-1.6z', a, l),
  'nightmare-supernova': (a, l) => shape('M5 .4l1 3 3-1-2 2.6 3 1-3 .6 1.4 2.8-2.8-1.4L5 9.6l-.6-2.6-2.8 1.4 1.4-2.8-3-.6 3-1-2-2.6 3 1z', a, l, 0.5) + dot(5, 5, 1.2, W),

  // ── Кристаллы ───────────────────────────────────────────────────────────
  'ashes-amethyst': (a, l) => shape('M2 3.6L3.6 5v3.8H1.2V5z', a, l, 0.6) + shape('M8 3.6L8.8 5v3.8H6.4V5z', a, l, 0.6) + shape('M5 .8l1.4 2v6H3.6v-6z', a, l) + line('M5 1.4v7', W, 0.4),
  'ashes-emerald': (a, l) => shape('M3.2 1h3.6L9 3.2v3.6L6.8 9H3.2L1 6.8V3.2z', a, l) + `<path d="M3.8 2.8h2.4l1 1v2.4l-1 1H3.8l-1-1V3.8z" fill="none" stroke="${W}" stroke-width=".5"/>`,
  'ashes-ruby': (a, l) => shape('M5 9L1.4 5.2C.2 3.6 1.2 1.2 3.2 1.4 4.2 1.5 4.7 2.2 5 2.8 5.3 2.2 5.8 1.5 6.8 1.4 8.8 1.2 9.8 3.6 8.6 5.2z', a, l) + line('M2.4 3.6L5 5.6 7.6 3.6M5 5.6V8.6', W, 0.45),
  'ashes-sapphire': (a, l) => shape('M5 .8Q8.4 4.6 8.4 6.2A3.4 3.4 0 0 1 1.6 6.2Q1.6 4.6 5 .8z', a, l) + line('M5 1.4L3.4 6.2 5 9 6.6 6.2z', W, 0.45),
  'ashes-diamond': (a, l) => shape('M2.6 1.6h4.8L9.2 3.8 5 9 .8 3.8z', a, l) + line('M.8 3.8h8.4M2.6 1.6l1.2 2.2L5 9l1.2-5.2 1.2-2.2M3.8 3.8L5 1.6l1.2 2.2', W, 0.45),
  'ashes-topaz': (a, l) => shape('M5 .6L8 2.6v4.8L5 9.4 2 7.4V2.6z', a, l) + line('M2 2.6l3 1.8 3-1.8M5 4.4v5', W, 0.45),
  'ashes-quartz': (a, l) => `<path d="M5 .4l1.8 2v6L5 9.6 3.2 8.4v-6z" fill="${a}"/>` + `<path d="M5 .4L3.2 2.4v6L5 9.6z" fill="${W}" fill-opacity=".7"/>` + line('M5 .4l1.8 2v6L5 9.6 3.2 8.4v-6z', l),
  'ashes-opal': (a, l) => `<ellipse cx="5" cy="5" rx="3.8" ry="4.2" fill="${a}" ${sw(l)}/>` + dot(3.8, 3.6, 0.8, W) + dot(6, 5.8, 0.6, W, 'fill-opacity=".7"') + dot(4.4, 6.8, 0.45, W, 'fill-opacity=".5"'),
  'ashes-obsidian': (a, l) => shape('M3.6.8l4 2 1.4 4-3.2 2.6-4.2-1.8.4-4.4z', l, l) + line('M3.6.8L5 5.2l4 1.6M5 5.2L1.6 7.6', a, 0.6),
  'ashes-moonstone': (a, l) => dot(5, 5, 4, a, sw(l)) + dot(5.6, 5.6, 2.4, W, 'fill-opacity=".3"') + `<path d="M2.8 3.4Q4.2 1.6 6.4 2.2 4.6 2.6 3.6 4.4z" fill="${W}"/>`,

  // ── Линейка редкостей: мотив по кодовому имени ──────────────────────────
  'r-common': (a, l) => `<rect x="1.6" y="1.6" width="6.8" height="6.8" rx="1.6" fill="${a}" ${sw(l)}/>` + dot(5, 5, 0.9, W),
  'r-uncommon': (a, l) => glow('M1 7L4 3l2 4 3-4', a, l, 1.1),
  'r-rare': (a, l) => shape('M2.6 2.6h4.8v4.8H2.6z', a, l) + line('M4 1v1.6M6 1v1.6M4 7.4V9M6 7.4V9M1 4h1.6M1 6h1.6M7.4 4H9M7.4 6H9', l, 0.6),
  'r-epic': (a, l) => `<ellipse cx="5" cy="5" rx="4" ry="1.5" transform="rotate(45 5 5)" fill="none" stroke="${l}" stroke-width="1.8"/>` +
    `<ellipse cx="5" cy="5" rx="4" ry="1.5" transform="rotate(-45 5 5)" fill="none" stroke="${l}" stroke-width="1.8"/>` +
    `<ellipse cx="5" cy="5" rx="4" ry="1.5" transform="rotate(45 5 5)" fill="none" stroke="${a}" stroke-width=".8"/>` +
    `<ellipse cx="5" cy="5" rx="4" ry="1.5" transform="rotate(-45 5 5)" fill="none" stroke="${a}" stroke-width=".8"/>` + dot(5, 5, 1.2, W, sw(l, 0.5)),
  'r-legendary': (a, l) => shape('M1.2 8V3.2L3.4 5.2 5 1.6l1.6 3.6 2.2-2V8z', a, l) + dot(5, 6.2, 0.8, W),
  'r-mythic': (a, l) => dot(5, 5, 4, l) + ring(5, 5, 2.6, a, l) + dot(5, 5, 0.9, a),
  'r-divine': (a, l) => `<ellipse cx="5" cy="2.8" rx="3.8" ry="1.5" fill="none" stroke="${l}" stroke-width="1.8"/><ellipse cx="5" cy="2.8" rx="3.8" ry="1.5" fill="none" stroke="${a}" stroke-width=".8"/>` +
    dot(5, 7, 1.8, W, sw(l, 0.6)),
  'r-transcendent': (a, l) => shape('M1 1.6h5.4v1.8H1zM3 4.1h6v1.8H3zM1.6 6.6h4.6v1.8H1.6z', a, l, 0.5) + `<path d="M6.4 1.6h1.4v1.8H6.4z" fill="${W}"/>`,
  'r-absolute': (a, l) => glow('M5 5c.8 0 1 1 .2 1.4-1.2.6-2.4-.6-2-1.8.6-1.6 3-1.8 4-.4 1.2 1.6.2 4-2 4.2', a, l, 0.8) + dot(5, 5, 0.6, W),
  'r-exclusive': (a, l) => shape('M5 .8L9.2 5 5 9.2.8 5z', a, l) + dot(5, 5, 1.2, W, sw(l, 0.5)) + dot(5, 5, 0.45, l),
  'r-crystal': (a, l) => shape('M3.4 9V3.4L4.6 1l1.2 2.4V9z', a, l) + shape('M6.2 9V5l1-1.6L8.2 5v4z', W, l, 0.6) + shape('M1.6 9V6l.9-1.4.9 1.4v3z', a, l, 0.6),
  'r-plasma': (a, l) => dot(5, 5, 4, a, sw(l)) + line('M5 5L2.6 2.8M5 5l2.8-1.4M5 5l-.6 3.2', W, 0.6) + dot(5, 5, 1, W),
  'r-digital': (a, l) => shape('M1.4 6h1.6v3H1.4zM4.2 3.6h1.6V9H4.2zM7 1.2h1.6V9H7z', a, l, 0.6),
  'r-relic': (a, l) => shape('M3.6 1h2.8v1.2L7.8 4.4Q8 8.6 5 9 2 8.6 2.2 4.4L3.6 2.2z', a, l) + line('M3 5.2h4', W, 0.6),
  'r-holo': (a, l) => `<rect x="2" y="2" width="6" height="6" transform="rotate(45 5 5)" fill="${a}" ${sw(l)}/>` + `<path d="M3.2 5L5 3.2l.8.8L4 5.8z" fill="${W}"/>`,
  'r-mechanic': (a, l) => shape('M4.2 .8h1.6l.3 1.3 1.2.5 1.1-.7 1.1 1.1-.7 1.1.5 1.2 1.3.3v1.6l-1.3.3-.5 1.2.7 1.1-1.1 1.1-1.1-.7-1.2.5-.3 1.3H4.2l-.3-1.3-1.2-.5-1.1.7-1.1-1.1.7-1.1-.5-1.2L.8 5.8V4.2l1.3-.3.5-1.2-.7-1.1 1.1-1.1 1.1.7 1.2-.5z', a, l, 0.5) +
    dot(5, 5, 1.4, W, sw(l, 0.5)),
  'r-royal': (a, l) => dot(5, 6, 3, a, sw(l)) + line('M5 .8v2.4M3.8 1.8h2.4', l, 0.9) + line('M2 6h6', W, 0.5),
  'r-anomaly': (a, l) => shape('M5 1l4.2 7.6H.8z', a, l) + line('M5 3.6v2.4', l, 1) + dot(5, 7.2, 0.55, l),
  'r-core': (a, l) => dot(5, 5, 4, W, sw(l, 0.6)) + dot(5, 5, 2.6, a, sw(l, 0.6)) + dot(5, 5, 1, l),
  'r-infinity': (a, l) => glow('M5 5C3.8 3 1.2 3 1.2 5S3.8 7 5 5 8.8 3 8.8 5 6.2 7 5 5z', a, l, 1),
  'r-cult': (a, l) => shape('M2 2h2v1h2V2h2v1h1v3H8v1H7v1H6v1H4V8H3V7H2V6H1V3h1z', a, l, 0.5),

  // ── Старые пузыри ───────────────────────────────────────────────────────
  'neon': (a, l) => glow('M1.6 8.4V1.6l6.8 6.8V1.6', a, l, 1),
  'neon-pink': (a, l) => glow('M5 1v8M1 5h8M2.2 2.2l5.6 5.6M7.8 2.2L2.2 7.8', a, l, 0.7),
  'glass': (a, l) => `<path d="M1.6 1.6h6.8v6.8H1.6z" fill="${a}" fill-opacity=".55" ${sw(l)}/>` + line('M3 6.4L6.4 3M3 4.4L4.4 3', W, 0.7),
  'shadow': (a, l) => `<path d="M3 3h6v6H3z" fill="${l}"/>` + shape('M1 1h6v6H1z', a, l),
  'minimal': (a, l) => `<rect x="1" y="4" width="8" height="2" rx="1" fill="${a}" ${sw(l, 0.6)}/>`,
  'rounded': (a, l) => `<rect x="1.4" y="2.4" width="7.2" height="5.2" rx="2.6" fill="${a}" ${sw(l)}/>`,
  'sharp': (a, l) => shape('M1 9L5 1l4 8-4-2.4z', a, l),
  'retro': (a, l) => shape('M1 2.4h8v5.8H1z', a, l) + shape('M2.2 3.4h4.2v3.8H2.2z', W, l, 0.5) + dot(7.6, 4.2, 0.5, l) + dot(7.6, 6, 0.5, l),
  'candy': (a, l) => shape('M1 2.6L3 4v2l-2 1.4zM9 2.6L7 4v2l2 1.4z', W, l, 0.6) + dot(5, 5, 2.2, a, sw(l)) + line('M4 4l2 2', W, 0.5),
  'mono': (a, l) => dot(5, 5, 4, W, sw(l)) + `<path d="M5 1a4 4 0 0 1 0 8z" fill="${a}"/>`,
  'aurora': (a, l) => glow('M2 8.8V4Q2.4 1.6 4 2.6M5 8.8V3.6Q5.4 1.2 7 2.2M8 8.8V5', a, l, 0.8),
  'cyber': (a, l) => glow('M1 5h3l1.4-2.6H9M4 5l1.4 2.6H9', a, l, 0.8) + dot(1.4, 5, 0.9, W, sw(l, 0.4)),
  'holographic': (a, l) => dot(4, 5, 2.8, a, `fill-opacity=".8" ${sw(l, 0.6)}`) + dot(6.2, 5, 2.8, W, `fill-opacity=".6" ${sw(l, 0.6)}`),
  'gradient-sunset': (a, l) => shape('M1.6 6.4a3.4 3.4 0 0 1 6.8 0z', a, l) + line('M1 8h8M2.6 9.2h4.8', l, 0.7),
  'gradient-ocean': (a, l) => glow('M.8 5.6Q2.2 3.6 3.6 5.6T6.4 5.6 9.2 5.6', a, l, 1.2),
  'gradient-forest': (a, l) => shape('M5 .8L8.2 5H6.6L8.6 7.8H1.4L3.4 5H1.8z', a, l) + line('M5 7.8v1.4', l, 1),
  'gradient-lava': (a, l) => shape('M1 9L3.6 3.4h2.8L9 9z', l, l) + shape('M4 3.4L5 1l1 2.4L5.4 6 5 4.4 4.6 6z', a, l, 0.4),
  'gradient-ice': (a, l) => glow('M5 1v8M1.6 3l6.8 4M1.6 7l6.8-4', a, l, 0.8),
  'gradient-gold': (a, l) => shape('M2.2 3.4h5.6l1.2 4H1z', a, l) + line('M3 5.4h1.6', W, 0.6),
};

/** Запасная фишка для скинов без своего мотива (старые и «по редкости»). */
export const FALLBACK_STUD: StudMotif = (a, l) => shape('M5 .8l1.1 3.1L9.2 5 6.1 6.1 5 9.2 3.9 6.1.8 5l3.1-1.1z', a, l);
