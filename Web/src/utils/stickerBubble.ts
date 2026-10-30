import type { ShopItem } from '../store/shopStore';
import { PACK_ART } from './packArt';
import { artDataUrl } from './collectionArt';
import { THEMED_MATERIALS } from './themedSkin';
import { RARITY_META } from './rarityStyles';
import { SKIN_STUDS, FALLBACK_STUD } from './skinStuds';

/**
 * Пузыри-«стикеры»: светлая заливка, выразительная обводка и наклейки,
 * выглядывающие за край. Вся палитра выводится из одного акцента, поэтому
 * в режиме «под тему» пузырь перекрашивается целиком, а не только по краю,
 * и одинаково читается на светлом и тёмном фоне чата.
 */

type Rgb = [number, number, number];

export interface SkinPalette {
  fill: string; fill2: string; badge: string; line: string; ink: string;
  accent: string; accent2: string; line2: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function parseHex(value?: string): Rgb | null {
  const m = /^#([\da-f]{3}|[\da-f]{6})(?:[\da-f]{2})?$/i.exec((value || '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1];
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

function hsl(h: number, s: number, l: number): string {
  const H = ((h % 360) + 360) % 360, S = clamp(s, 0, 1), L = clamp(l, 0, 1);
  const k = (n: number) => (n + H / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

const hueOf = (hex: string) => toHsl(parseHex(hex) ?? [0, 0, 0])[0];

/** Тот же цвет, повёрнутый по кругу оттенков. */
export function shiftHue(hex: string, deg: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [h, s, l] = toHsl(rgb);
  return hsl(h + deg, s, l);
}

/** Светлая заливка, тёмные обводка и текст: контраст текста высокий на любом оттенке. */
export function skinPalette(accent: string, accent2?: string): SkinPalette {
  const [h, s] = toHsl(parseHex(accent) ?? [84, 220, 228]);
  const second = parseHex(accent2 || '');
  const [h2, s2] = second ? toHsl(second) : [h + 40, s];
  // Серые акценты остаются серыми: насыщенность не накручиваем.
  const sat = (src: number, lo: number, hi: number) => src < 0.1 ? src : clamp(src, lo, hi);
  return {
    fill: hsl(h, sat(s, 0.35, 0.75), 0.95),
    fill2: hsl(h + 6, sat(s, 0.35, 0.7), 0.88),
    badge: hsl(h, sat(s, 0.4, 0.8), 0.78),
    line: hsl(h, sat(s, 0.25, 0.6), 0.24),
    ink: hsl(h, sat(s, 0.2, 0.45), 0.13),
    accent: hsl(h, sat(s, 0.5, 0.85), 0.58),
    accent2: hsl(h2, sat(s2, 0.5, 0.85), 0.6),
    line2: hsl(h2, sat(s2, 0.3, 0.6), 0.3),
  };
}

export type Family = 'games' | 'corp' | 'street' | 'culture' | 'myths' | 'nightmare' | 'ashes' | 'rarity' | 'legacy';

export const familyOf = (key: string): Family => {
  if (key.startsWith('r-')) return 'rarity';
  const prefix = key.split('-')[0];
  return (['games', 'corp', 'street', 'culture', 'myths', 'nightmare', 'ashes'] as string[]).includes(prefix)
    ? prefix as Family : 'legacy';
};

// Старые пузыри без своего материала: ключевой цвет и (для переливов) второй.
const LEGACY_ACCENTS: Record<string, [string, string?]> = {
  neon: ['#00c8e6'], glass: ['#7cc4e4'], shadow: ['#5b6478'], minimal: ['#7d8794'],
  rounded: ['#5fc9b0'], sharp: ['#ff7d4d'], retro: ['#d9b440'], candy: ['#f080b8', '#7fd8ef'],
  mono: ['#6b6b6b'], aurora: ['#3fd98a', '#a18cd1'], cyber: ['#f5d90a', '#00d5f0'],
  'gradient-sunset': ['#f7971e', '#ff4870'], 'gradient-ocean': ['#1f7fe0'], 'gradient-forest': ['#4f9a6c'],
  'gradient-lava': ['#ff5a1f'], 'gradient-ice': ['#3fc8ee'], 'gradient-gold': ['#e0ad1f'],
  'neon-pink': ['#ff2e9a'], holographic: ['#6fd8d2', '#f59ad8'],
};

// Скины коллекций без своего материала: без этого цвет брался из редкости,
// и два скина одной редкости (корона и Грааль) выглядели одинаково.
const SKIN_ACCENTS: Record<string, string> = {
  'myths-crown': '#d9a33b', 'myths-chalice': '#c9495a', 'myths-shield': '#5f8fc4', 'myths-key': '#7fa66a',
  'myths-scepter': '#8f6fd8', 'myths-lantern': '#4fc7b0', 'myths-tome': '#c25a7c', 'myths-ring': '#e07a3a',
  'nightmare-nova': '#f2c14e', 'nightmare-moon': '#9aa7c4', 'nightmare-comet': '#5fb8ff', 'nightmare-void': '#7a5cff',
  'nightmare-orbit': '#e8a25a', 'nightmare-aurora': '#4fe0a0', 'nightmare-nebula': '#e66fd0', 'nightmare-meteor': '#ff6a3d',
  'ashes-amethyst': '#9b6be0', 'ashes-topaz': '#f0b43c', 'ashes-emerald': '#3cc47a', 'ashes-quartz': '#a8b8c8',
  'ashes-ruby': '#e0405a', 'ashes-opal': '#6fd0d8', 'ashes-sapphire': '#3f6fe0', 'ashes-obsidian': '#5a5070',
};

/** Наклейка коллекции: viewBox 46×20, линия y=10 совпадает с краем пузыря. */
function decoration(family: Family, p: SkinPalette): { body: string; at: 'top' | 'bottom' } {
  const L = p.line, A = p.accent;
  switch (family) {
    case 'games': return { at: 'bottom', body:
      `<path d="M4 8V4h4v2h2V4h4v4h-2v2h-2v2H8v-2H6V8z" fill="${A}" stroke="${L}" stroke-width="1.4"/>` +
      `<rect x="19" y="7" width="6" height="6" fill="#fff" stroke="${L}" stroke-width="1.4"/>` +
      `<rect x="28" y="10" width="4" height="4" fill="${A}" stroke="${L}" stroke-width="1.2"/><rect x="35" y="6" width="3" height="3" fill="${L}"/>` };
    case 'corp': return { at: 'top', body:
      `<path d="M9 17V6a4 4 0 0 1 8 0v9a2.4 2.4 0 0 1-4.8 0V7" fill="none" stroke="${L}" stroke-width="2" stroke-linecap="round"/>` +
      `<rect x="22" y="5" width="19" height="9" rx="2" fill="${A}" stroke="${L}" stroke-width="1.5"/><path d="M26 9.5h11" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>` };
    case 'street': return { at: 'bottom', body:
      `<path d="M2 9H44V11Q41 11 40.5 13V16.5a2 2 0 0 1-4 0V12Q34 11 31 12V18a2.5 2.5 0 0 1-5 0V12Q21 11 17 12V14.5a2 2 0 0 1-4 0V12Q7 11 2 11Z" fill="${A}" stroke="${L}" stroke-width="1.4" stroke-linejoin="round"/>` +
      `<circle cx="8" cy="17" r="1.6" fill="${A}" stroke="${L}" stroke-width="1"/>` };
    case 'culture': return { at: 'bottom', body:
      `<path d="M9 8h9v11l-4.5-3.5L9 19z" fill="${A}" stroke="${L}" stroke-width="1.5" stroke-linejoin="round"/>` +
      `<path d="M21 8h7v8l-3.5-2.8L21 16z" fill="#fff" stroke="${L}" stroke-width="1.5" stroke-linejoin="round"/>` };
    case 'myths': return { at: 'bottom', body:
      `<path d="M4 13Q23 5 42 13" fill="none" stroke="${L}" stroke-width="1.6" stroke-linecap="round"/>` +
      [[10, 8.6, -35], [16, 11.4, 30], [23, 6.6, -10], [30, 11.2, -30], [36, 8.8, 35]].map(([x, y, r]) =>
        `<ellipse cx="${x}" cy="${y}" rx="3.4" ry="1.6" transform="rotate(${r} ${x} ${y})" fill="${A}" stroke="${L}" stroke-width="1"/>`).join('') };
    case 'nightmare': return { at: 'top', body:
      `<path d="M9 3l1.6 5.4L16 10l-5.4 1.6L9 17l-1.6-5.4L2 10l5.4-1.6z" fill="#fff" stroke="${L}" stroke-width="1.3" stroke-linejoin="round"/>` +
      `<path d="M20 4l.8 2.2L23 7l-2.2.8L20 10l-.8-2.2L17 7l2.2-.8z" fill="${A}" stroke="${L}" stroke-width="1"/>` +
      `<circle cx="34" cy="11" r="4.5" fill="${A}" stroke="${L}" stroke-width="1.4"/><ellipse cx="34" cy="11" rx="9" ry="2.6" fill="none" stroke="${L}" stroke-width="1.3" transform="rotate(-18 34 11)"/>` };
    case 'ashes': return { at: 'bottom', body:
      `<path d="M5 8l3-4h8l3 4-7 9z" fill="${A}" stroke="${L}" stroke-width="1.4" stroke-linejoin="round"/>` +
      `<path d="M5 8h14M9.5 8L12 17l2.5-9M8 4l1.5 4M16 4l-1.5 4" fill="none" stroke="${L}" stroke-width=".9"/>` +
      `<path d="M24 11l2-2.6h5l2 2.6-4.5 6z" fill="#fff" stroke="${L}" stroke-width="1.3" stroke-linejoin="round"/>` };
    case 'rarity': return { at: 'top', body:
      `<path d="M8 3l1.4 4.6L14 9l-4.6 1.4L8 15l-1.4-4.6L2 9l4.6-1.4z" fill="${A}" stroke="${L}" stroke-width="1.2" stroke-linejoin="round"/>` +
      `<path d="M19 6l.8 2.2 2.2.8-2.2.8L19 12l-.8-2.2L16 9l2.2-.8z" fill="#fff" stroke="${L}" stroke-width="1"/><circle cx="26" cy="12" r="1.5" fill="${L}"/>` };
    default: return { at: 'top', body:
      `<circle cx="8" cy="10" r="5" fill="#fff" fill-opacity=".85" stroke="${L}" stroke-width="1.4"/><circle cx="6.4" cy="8.4" r="1.3" fill="#fff"/>` +
      `<circle cx="18" cy="6" r="3" fill="${A}" stroke="${L}" stroke-width="1.2"/><circle cx="25" cy="11" r="1.8" fill="#fff" stroke="${L}" stroke-width="1"/>` };
  }
}

/** Лёгкий узор коллекции поверх заливки: [картинка, размер]. */
function pattern(family: Family, p: SkinPalette): [string, string] {
  switch (family) {
    case 'games': return [`repeating-linear-gradient(90deg, ${p.line}0f 0 1px, transparent 1px 10px)`, 'auto'];
    case 'corp': return [`repeating-linear-gradient(0deg, ${p.line}12 0 1px, transparent 1px 12px)`, 'auto'];
    case 'street': return [`radial-gradient(circle at 3px 3px, ${p.line}22 1.2px, transparent 1.8px)`, '13px 11px'];
    case 'culture': return [`repeating-linear-gradient(135deg, ${p.line}0f 0 1px, transparent 1px 10px)`, 'auto'];
    case 'myths': return [`radial-gradient(ellipse at 50% 130%, ${p.accent}45, transparent 65%)`, 'auto'];
    case 'nightmare': return [`radial-gradient(circle at 4px 4px, ${p.line}33 0.9px, transparent 1.5px)`, '19px 15px'];
    case 'ashes': return [`linear-gradient(125deg, transparent 55%, #ffffffb0 56%, transparent 68%)`, 'auto'];
    case 'rarity': return [`radial-gradient(ellipse at 100% 0%, ${p.accent}40, transparent 60%)`, 'auto'];
    default: return [`radial-gradient(ellipse at 0% 100%, ${p.accent2}33, transparent 60%)`, 'auto'];
  }
}

const svgUrl = (viewBox: string, body: string) =>
  `url("${artDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`)}")`;

/** Круглый значок пака, наклеенный на угол пузыря с лёгким наклоном. */
function emblem(path: string, p: SkinPalette, tilt: number): string {
  return svgUrl('0 0 100 100', `<g transform="rotate(${tilt} 50 50)">` +
    `<circle cx="50" cy="53" r="42" fill="${p.line}"/>` +
    `<circle cx="50" cy="48" r="42" fill="${p.badge}" stroke="${p.line}" stroke-width="6"/>` +
    `<g transform="translate(21 19) scale(.58)"><path d="${path}" fill="none" stroke="${p.line}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></g>` +
    `<path d="M25 36A28 28 0 0 1 38 21" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".85"/></g>`);
}

type Layer = { image: string; size: string; repeat: string; clip: string; pos: string; anim?: 'band' | 'edge' };

/**
 * Обводка скина = обводка коллекции + своя отделка скина.
 * Заливку не трогаем: текст лежит на чистом фоне коллекции.
 * Отделка — внутренний кант цветом скина. С редкостью растёт:
 * 1 — тонкий кант, 2 — кант толще, 3 — кант с бликом,
 * 4 — двойной кант, 5 — двойной двухцветный кант (переливается вместе с рамкой).
 */
export function trimShadow(p: SkinPalette, tier: number, alt = false): string {
  const a = alt ? p.accent2 : p.accent;
  const b = alt ? p.accent : p.accent2;
  switch (clamp(tier, 1, 5)) {
    case 1: return `inset 0 0 0 1px ${a}99`;
    case 2: return `inset 0 0 0 2px ${a}`;
    case 3: return `inset 0 0 0 2px ${a}, inset 0 0 0 3px #ffffffcc`;
    case 4: return `inset 0 0 0 2px ${a}, inset 0 0 0 4px ${p.fill}, inset 0 0 0 5px ${a}`;
    default: return `inset 0 0 0 2px ${a}, inset 0 0 0 4px ${p.fill}, inset 0 0 0 5.5px ${b}`;
  }
}

/**
 * Фишки скина на линии обводки — того же масштаба, что искорки коллекции.
 * Мотив свой у каждого скина (см. skinStuds), число растёт с редкостью (1…5). Центр каждой
 * фишки лежит на линии рамки: за край она выступает лишь на пару пикселей.
 */
// Середины сторон и низ справа: мимо скруглённых углов, значка пака и искорок коллекции.
const STUD_SLOTS = ['100% 50%', '0% 50%', '50% 100%', '50% 0%', 'right 28px bottom 0'];
export const STUD_SIZE = 10;

export function perimeterStuds(key: string, p: SkinPalette, tier: number): { image: string; position: string } {
  const n = clamp(tier, 1, 5);
  // Мотив — суть скина: костёр, пропуск, баллончик, маски, комета, рубин…
  const motif = SKIN_STUDS[key] ?? FALLBACK_STUD;
  const images = STUD_SLOTS.slice(0, n).map((_, i) =>
    // У легенды фишки чередуют оба цвета скина.
    svgUrl('0 0 10 10', motif(n >= 5 && i % 2 ? p.accent2 : p.accent, p.line)));
  return { image: images.join(', '), position: STUD_SLOTS.slice(0, n).join(', ') };
}

interface Recipe { accent: string; accent2?: string; tier: number; shimmer: number }

function recipeOf(item: ShopItem, key: string): Recipe {
  const m = THEMED_MATERIALS[key];
  const legacy = LEGACY_ACCENTS[key];
  const preview = typeof item.previewColor === 'string' ? item.previewColor.match(/#[\da-f]{6}/i)?.[0] : undefined;
  const accent = m?.accent ?? SKIN_ACCENTS[key] ?? legacy?.[0] ?? item.value?.color ?? preview ?? '#54dce4';
  const accent2 = m?.accent2 ?? legacy?.[1];
  const order = item.rarity ? RARITY_META[item.rarity].order : accent2 ? 5 : 2;
  return { accent, accent2, tier: clamp(order, 1, 5), shimmer: m?.shimmer ?? 12 };
}

// Стиль зависит только от пака и акцента: в ленте сотни сообщений с одним скином.
const cache = new Map<string, Record<string, any>>();

/** Пузырь пака. themeAccent — акцент активной темы (режим «под тему»). */
export function stickerBubble(item: ShopItem, themeAccent?: string): Record<string, any> {
  const key: string = item.value.pack;
  const base = recipeOf(item, key);
  let { accent, accent2 } = base;
  if (themeAccent && parseHex(themeAccent)) {
    // Пара цветов сохраняет своё соотношение, но строится от акцента темы.
    if (accent2) accent2 = shiftHue(themeAccent, hueOf(accent2) - hueOf(accent));
    accent = themeAccent;
  }
  const id = `${key}|${accent}|${accent2 ?? ''}|${base.tier}`;
  const hit = cache.get(id);
  if (hit) return hit;

  const p = skinPalette(accent, accent2);
  const family = familyOf(key);
  const legend = base.tier >= 5;
  const tilt = ([...key].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 25) - 12;
  const art = PACK_ART[`pack-${key}`];
  const deco = decoration(family, p);
  const [patternImage, patternSize] = pattern(family, p);

  const layers: Layer[] = [
    ...(legend ? [{ image: 'linear-gradient(110deg, transparent 40%, #ffffff99 50%, transparent 60%)', size: '300% 100%', repeat: 'no-repeat', clip: 'padding-box', pos: '', anim: 'band' as const }] : []),
    { image: patternImage, size: patternSize, repeat: 'repeat', clip: 'padding-box', pos: '0 0' },
    { image: `linear-gradient(180deg, ${p.fill}, ${p.fill2})`, size: '100% 100%', repeat: 'no-repeat', clip: 'padding-box', pos: '0 0' },
    // Легендарная обводка — перетекающий градиент двух цветов под прозрачной рамкой.
    ...(legend ? [{ image: `linear-gradient(110deg, ${p.line}, ${p.accent} 25%, ${p.line2} 50%, ${p.accent2} 75%, ${p.line})`, size: '300% 100%', repeat: 'no-repeat', clip: 'border-box', pos: '', anim: 'edge' as const }] : []),
  ];
  const position = (band: string, edge: string) =>
    layers.map(l => l.anim === 'band' ? band : l.anim === 'edge' ? edge : l.pos).join(', ');

  // Ступени редкости: от мягкой тени до «наклейки» с офсетом и светящейся легенды.
  const shadows = [
    `0 1px 0 ${p.line}1f, 0 3px 10px ${p.line}1a`,
    `inset 0 2px 0 #ffffffb3, 0 3px 10px ${p.line}1f`,
    `inset 0 2px 0 #ffffffb3, 3px 3px 0 ${p.line}`,
    `inset 0 2px 0 #ffffffb3, 0 0 0 3px ${p.fill}, 0 0 0 4.5px ${p.line}, 4px 5px 0 1.5px ${p.line}40`,
    `inset 0 2px 0 #ffffffb3, 0 4px 14px ${p.accent}59`,
  ];
  // Внутренний кант скина поверх обводки коллекции.
  const boxShadow = `${trimShadow(p, base.tier)}, ${shadows[base.tier - 1]}`;
  const studs = perimeterStuds(key, p, base.tier);
  // inset считается от внутреннего края рамки: центр фишки — на середине её линии.
  const studInset = `-${(legend ? 2.5 : 2) / 2 + STUD_SIZE / 2}px`;
  const animation = `veraSticker-${key}-${accent.slice(1)}`;

  const style: Record<string, any> = {
    position: 'relative', isolation: 'isolate', letterSpacing: 0,
    color: p.ink, backgroundColor: p.fill2,
    border: legend ? '2.5px solid transparent' : `2px solid ${p.line}`,
    backgroundImage: layers.map(l => l.image).join(', '),
    backgroundSize: layers.map(l => l.size).join(', '),
    backgroundRepeat: layers.map(l => l.repeat).join(', '),
    backgroundClip: layers.map(l => l.clip).join(', '),
    backgroundOrigin: 'border-box',
    backgroundPosition: position('100% 0', '0% 0'),
    boxShadow, backdropFilter: 'none', textShadow: 'none',
    animation: legend ? `${animation} ${base.shimmer}s ease-in-out infinite` : 'none',
    // Наклейки выходят за край: место сверху и без обрезки paint containment.
    marginTop: '12px', contentVisibility: 'visible',
    // Фишки скина на линии обводки.
    '&::before': {
      content: '""', display: 'block', position: 'absolute', pointerEvents: 'none', zIndex: 1,
      inset: studInset,
      backgroundImage: studs.image, backgroundRepeat: 'no-repeat',
      backgroundSize: `${STUD_SIZE}px ${STUD_SIZE}px`, backgroundPosition: studs.position,
    },
    '&::after': {
      content: '""', position: 'absolute', pointerEvents: 'none', zIndex: -1,
      top: '-15px', right: '-9px', bottom: '-11px', left: '-6px',
      backgroundImage: [art ? emblem(art.path, p, tilt) : 'none', svgUrl('0 0 46 20', deco.body)].join(', '),
      backgroundRepeat: 'no-repeat',
      backgroundSize: '28px 28px, 46px 20px',
      backgroundPosition: `right top, left 18px ${deco.at === 'top' ? 'top 4px' : 'bottom 0'}`,
    },
    '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
  };
  if (legend) {
    style[`@keyframes ${animation}`] = {
      '0%,100%': { backgroundPosition: position('100% 0', '0% 0'), boxShadow },
      '50%': { backgroundPosition: position('0% 0', '100% 0'), boxShadow: `${trimShadow(p, base.tier, true)}, inset 0 2px 0 #ffffffb3, 0 4px 16px ${p.accent2}66` },
    };
  }
  cache.set(id, style);
  return style;
}
