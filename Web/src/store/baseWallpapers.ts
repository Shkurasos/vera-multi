/**
 * БАЗОВЫЕ ФОНЫ ТЕМ.
 *
 * Это «родные» фоны Vera: они уже встроены в темы, включаются вместе с ними
 * и не занимают места ни в localStorage, ни в сборке — каждый фон описан
 * градиентами и инлайновым SVG, а строка CSS собирается лениво, в момент
 * первого обращения (см. `defineBase`).
 *
 * Зачем они в каталоге обоев: пользователь может выбрать базовый фон любой
 * темы вручную — как и стоковое фото, только без загрузки по сети.
 *
 * Каждый фон — это либо сцена (небо + силуэт города + отражение), либо
 * узор (плитка с иконками), либо мягкий градиент. Один и тот же «тип»
 * фона узнаётся по построению: сцены строятся через `scene()`, узоры —
 * через `tile()`, градиенты — через `mesh()`.
 */

/** Готовый базовый фон: css — строка `background` для слоя под сообщениями. */
export interface BaseWallpaper {
  id: string;
  name: string;
  /**
   * CSS `background` (несколько слоёв, первый — сверху).
   * Собирается лениво: строка считается при первом обращении.
   */
  readonly css: string;
  /** Светлый фон: слой яркости поверх него делается белым, а не чёрным. */
  light?: boolean;
}

/* ── Инфраструктура ─────────────────────────────────────────────────────── */

/**
 * Компактное кодирование SVG для `url("data:image/svg+xml,…")`.
 *
 * Обычный encodeURIComponent раздувает фон втрое: пробел becomes %20,
 * кавычка — %22. Здесь мы переводим атрибуты в одинарные кавычки (внутри
 * css-строки они безопасны) и возвращаем безопасные символы как есть —
 * итоговый css получается в несколько раз короче и парсится быстрее.
 * Символ % остаётся закодированным, иначе «100%» в svg сломалось бы.
 */
function encodeSvg(svg: string): string {
  return encodeURIComponent(svg.replace(/"/g, "'"))
    .replace(/%20/g, ' ')
    .replace(/%22/g, "'")
    .replace(/%3D/g, '=')
    .replace(/%3A/g, ':')
    .replace(/%2C/g, ',')
    .replace(/%2F/g, '/')
    .replace(/%3B/g, ';')
    .replace(/%28/g, '(')
    .replace(/%29/g, ')');
}

/** Инлайновый SVG как CSS-слой `url("data:image/svg+xml,…")`. */
function svgUrl(body: string, w: number, h: number): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width="${w}" height="${h}" ` +
    `viewBox='0 0 ${w} ${h}'>${body}</svg>`;
  return `url("data:image/svg+xml,${encodeSvg(svg)}")`;
}

/** Псевдослучай с фиксированным зерном: фон одинаков при каждом рендере. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Плитка узора: SVG фиксированного размера, повторяется по всей области. */
function tile(body: string, w: number, h: number): string {
  return svgUrl(body, w, h);
}

/** Мягкое цветовое пятно — базовый кирпич всех градиентных фонов. */
function blob(color: string, x: string, y: string, size: string, alpha: string): string {
  return `radial-gradient(${size} at ${x} ${y}, ${color}${alpha} 0%, ${color}00 72%)`;
}

/**
 * Мягкий градиент: базовый цвет + несколько пятен.
 * `spots` — [цвет, X, Y, размер, альфа].
 */
function mesh(base: string, spots: [string, string, string, string, string][]): string {
  return [...spots.map((s) => blob(...s)), base].join(', ');
}

/** Звёздное небо для тёмных фонов. */
function stars(color: string, seed: number, count = 64, w = 1200, h = 700): string {
  const r = rng(seed);
  let dots = '';
  for (let i = 0; i < count; i++) {
    dots += `<circle cx="${(r() * w).toFixed(1)}" cy="${(r() * h).toFixed(1)}" ` +
      `r="${(0.5 + r() * 1.7).toFixed(2)}" opacity="${(0.2 + r() * 0.7).toFixed(2)}"/>`;
  }
  return tile(`<g fill="${color}">${dots}</g>`, w, h);
}

/**
 * Плёночное зерно — общая лёгкая фактура для плоских заливок.
 * Считается лениво: строка data-URI не нужна, пока зерно реально не показали.
 */
let grainCache: string | null = null;
function GRAIN(): string {
  if (grainCache === null) {
    grainCache = svgUrl(
      `<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3"/></filter>` +
      `<rect width="100%" height="100%" filter="url(#n)" opacity="0.42"/>`,
      140,
      140,
    );
  }
  return grainCache;
}

/**
 * Собирает слои `background` в корректном порядке.
 *
 * Правило CSS: цвет допустим ТОЛЬКО в последнем слое. Шаблоны вроде mesh()
 * возвращают «градиенты + базовый цвет» одной строкой, и вызывающий код
 * дописывал после неё ещё слои — цвет оказывался в середине, и браузер
 * отбрасывал весь `background` целиком: фон не рисовался вообще (Полёт, Линии,
 * Линии тёмные). Здесь цвет отделяется и уходит в конец, где он и обязан быть.
 */
function compose(css: string): string {
  const layers: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = '';
  for (const ch of css) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { layers.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) layers.push(cur.trim());

  const isColor = (l: string) =>
    /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%deg/]+\)|[a-z]+)$/i.test(l);
  const colors = layers.filter(isColor);
  const images = layers.filter((l) => !isColor(l));
  return [...images, ...colors].join(', ');
}

/**
 * Ленивая обёртка: CSS считается только когда фон действительно показан.
 * Без этого все ~38 фонов собирались бы при импорте модуля.
 */
function defineBase(def: { id: string; name: string; light?: boolean }, build: () => string): BaseWallpaper {
  let cached: string | null = null;
  return {
    id: def.id,
    name: def.name,
    light: def.light,
    get css() {
      if (cached === null) cached = compose(build());
      return cached;
    },
  };
}


/* ── Узоры из иконок ───────────────────────────────────────────────────── */

/**
 * Контурные иконки в одном шрифтовом стиле (сетка 24×24, центр 12,12).
 * Один словарь переиспользуется несколькими узорами: у «пузырей», «переписки»
 * и «путешествий» просто разные наборы имён.
 */
const GLYPHS: Record<string, string> = {
  bubble: 'M4 6a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-7l-5 4v-4H7a3 3 0 0 1-3-3z',
  bubble2: 'M3 8a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H9l-4 3v-3a3 3 0 0 1-2-3z',
  mail: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l9 6 9-6',
  photo: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 16l5-5 4 4 3-3 6 6M16.5 9.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  video: 'M4 6h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM16 10l5-3v10l-5-3z',
  user: 'M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  users: 'M9 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 20a7 7 0 0 1 14 0M17 12a3 3 0 1 0 0-6M16 20h6a6 6 0 0 0-3-5.2',
  heart: 'M12 20s-7-4.4-7-9.3A4 4 0 0 1 12 8a4 4 0 0 1 7 2.7C19 15.6 12 20 12 20z',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z',
  plus: 'M12 5v14M5 12h14',
  check: 'M4 12.5l5 5L20 6.5',
  paperclip: 'M20 11l-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 6',
  pencil: 'M4 20l1-4L16 5l3 3L8 19l-4 1zM14 7l3 3',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19a2 2 0 0 1 2-2h13v4H6a2 2 0 0 1-2-2z',
  camera: 'M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  cup: 'M4 8h12v6a6 6 0 0 1-12 0zM16 9h2a2.5 2.5 0 0 1 0 5h-2M4 21h14',
  plane: 'M21 4L3 11l7 3 3 7z',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
  mountain: 'M2 20l7-12 4.5 7.5L16 11l6 9zM7 20l4-6',
  wave: 'M2 9c3-2.5 5 2.5 8 0s5 2.5 8 0M2 15c3-2.5 5 2.5 8 0s5 2.5 8 0',
  pin: 'M12 22s7-7.6 7-12a7 7 0 1 0-14 0c0 4.4 7 12 7 12zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z',
  drop: 'M12 3s6 6.6 6 10.5a6 6 0 0 1-12 0C6 9.6 12 3 12 3z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
  moon: 'M20 14A8.5 8.5 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20 14z',
  cloud: 'M7 19h10a4 4 0 0 0 .4-8A6 6 0 0 0 6 9.5 4 4 0 0 0 7 19z',
  note: 'M9 18V6l11-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM20 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  dinosaur: 'M4 18c0-5 4-9 9-9 3.5 0 6 2 7 4.5l2 .5-2 1.5c0 2-2 3.5-4.5 3.5H6zM15 8l1.5-3 1 3M7 18v2M18 16v2',
  fries: 'M9 3v6M13 3v6M17 4v5M6 10h12l-1.5 10h-9z',
  question: 'M9 9a3 3 0 1 1 4 3v2M13 18h.01',
  smile: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  leaf: 'M5 19C4 10 9 4 20 4c0 11-6 15-15 15zM5 19c3-6 7-9 12-11',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l4 2',
  bag: 'M5 8h14l1 12H4zM9 8V6a3 3 0 0 1 6 0v2',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7S9 3 7 5s5 2 5 2zM12 7s3-4 5-2-5 2-5 2z',
  gamepad: 'M7 12h4M9 10v4M15.5 11.5h.01M18 14h.01M6 8h12a4 4 0 0 1 3.9 5l-1 3a2 2 0 0 1-3.6.5L16 15H8l-1.3 1.5A2 2 0 0 1 3.1 16l-1-3A4 4 0 0 1 6 8z',
  rocket: 'M12 2c3 2.5 4.5 6 4.5 10L14 15h-4L7.5 12C7.5 8 9 4.5 12 2zM12 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM9.5 15l-2 6 4.5-2 4.5 2-2-6',
};

/**
 * Плитка из набора контурных иконок: сетка с джиттером позиции и поворота,
 * чтобы узор не читался как таблица. `fill` включает заливку (для «пузырей»).
 */
function iconTile(names: string[], color: string, opts: {
  cols: number; cell: number; stroke: number; seed: number; fill?: string;
}): string {
  const { cols, cell, stroke, seed, fill } = opts;
  const r = rng(seed);
  const rows = Math.ceil(names.length / cols);
  let body = '';
  names.forEach((name, i) => {
    const d = GLYPHS[name];
    if (!d) return;
    const col = i % cols, row = Math.floor(i / cols);
    const cx = col * cell + cell / 2 + (r() - 0.5) * cell * 0.3;
    const cy = row * cell + cell / 2 + (r() - 0.5) * cell * 0.3;
    const s = (cell * (0.34 + r() * 0.16)) / 24;
    const rot = (r() - 0.5) * 34;
    body += `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${rot.toFixed(1)}) ` +
      `scale(${s.toFixed(3)}) translate(-12 -12)" fill="${fill || 'none'}" stroke="${color}" ` +
      `stroke-width="${(stroke / s).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="${d}"/></g>`;
  });
  return tile(body, cols * cell, rows * cell);
}


/* ── Каталог ────────────────────────────────────────────────────────────── */

/**
 * Базовые фоны Vera. Порядок задаёт порядок в галерее обоев.
 *
 * Первые десять воспроизводят фирменные заставки Vera (пиксельный город,
 * сакура, пузыри, переписка, путешествия, школа, полёт, мята, аврора,
 * линии) — остальные собраны по их типам, чтобы набор можно было
 * пополнять, не ломая уже настроенные темы: id неизменны.
 */
export const BASE_WALLPAPERS: BaseWallpaper[] = [

  // ── Заставки Vera ──────────────────────────────────────────────────────

  // ── Фоны по типу заставок ──────────────────────────────────────────────


  // ── Тематические фоны под конкретные темы ───────────────────────────────


  // ── Фотографии-референсы (public/wallpapers/*.jpg) ─────────────────────────

  // Растровые обои подключаются относительным путём: при base: './' и HashRouter

  // документ всегда лежит в корне каталога, поэтому ./wallpapers/x.jpg резолвится

  // и в dev, и в file://-сборке Electron. Цвет-подложка идёт последним слоем.

  defineBase({ id: 'base-photo-black-waves', name: 'Чёрные волны' }, () =>
    'url(./wallpapers/black-waves.jpg), #0a0a0c'),

  defineBase({ id: 'base-photo-pastel-triangles', name: 'Пастельные треугольники', light: true }, () =>
    'url(./wallpapers/pastel-triangles.jpg), #f4f6fa'),

  defineBase({ id: 'base-photo-pastel-waves', name: 'Пастельные волны', light: true }, () =>
    'url(./wallpapers/pastel-waves.jpg), #f6f4fb'),

  defineBase({ id: 'base-photo-teal-icons', name: 'Бирюзовые иконки' }, () =>
    'url(./wallpapers/teal-icons.jpg), #06343e'),

  defineBase({ id: 'base-photo-formulas', name: 'Формулы у доски' }, () =>
    'url(./wallpapers/formulas.jpg), #0d1117'),

  defineBase({ id: 'base-photo-red-icons', name: 'Красные иконки' }, () =>
    'url(./wallpapers/red-icons.jpg), #171f33'),

  defineBase({ id: 'base-photo-doodle-chat', name: 'Дудлы переписки', light: true }, () =>
    'url(./wallpapers/doodle-chat.jpg), #f7f7f8'),

  defineBase({ id: 'base-photo-sketch-66', name: 'Скетч-66' }, () =>
    'url(./wallpapers/sketch-66.jpg), #0b0b0c'),

  defineBase({ id: 'base-photo-blue-bubbles', name: 'Синие пузыри', light: true }, () =>
    'url(./wallpapers/blue-bubbles.jpg), #f3f7fd'),
/* ── Фоны, загруженные админом и сделанные стоковыми ────────────────────
   *
   * Раньше эти фото жили только в uploads и в гагалее админа: тема не могла
   * сослаться на такой фон, не завязываясь на строку БД (а её id меняется при
   * пере-выкладке, и темы рассыпались бы). Файлы сжаты до 1920px и лежат в
   * бандле, поэтому ссылки на них переживают и сброс диска, и смену сервера.
   *
   * Подложка под фото — цвет, который видно, пока картинка грузится и на
   * полях, если фон не совсем в размер. Светлый «Середчки» помечен light:
   * по нему текст должен быть тёмным, иначе не читается.
   */
  defineBase({ id: 'base-photo-vd', name: 'Vd' }, () =>
    'url(./wallpapers/vd.jpg), #0a0a0e'),

  defineBase({ id: 'base-photo-sakura', name: 'Сакура' }, () =>
    'url(./wallpapers/sakura.jpg), #241019'),

  defineBase({ id: 'base-photo-o', name: 'Тёмный круг' }, () =>
    'url(./wallpapers/o.jpg), #101014'),

  defineBase({ id: 'base-photo-gorod', name: 'Город' }, () =>
    'url(./wallpapers/gorod.png), #14161c'),

  defineBase({ id: 'base-photo-prikoolnyy', name: 'Прикольный' }, () =>
    'url(./wallpapers/prikoolnyy.jpg), #10131a'),

  defineBase({ id: 'base-photo-znaki', name: 'Знаки' }, () =>
    'url(./wallpapers/znaki.jpg), #12151c'),

  defineBase({ id: 'base-photo-vasap', name: 'Васап' }, () =>
    'url(./wallpapers/vasap.jpg), #1a1712'),

  defineBase({ id: 'base-photo-living', name: 'Living' }, () =>
    'url(./wallpapers/living.jpg), #0b0d0c'),

  defineBase({ id: 'base-photo-nightgame', name: 'NightGame' }, () =>
    'url(./wallpapers/nightgame.jpg), #0a0a12'),

  defineBase({ id: 'base-photo-seredchki', name: 'Середчки', light: true }, () =>
    'url(./wallpapers/seredchki.jpg), #e8e6e2'),

  defineBase({ id: 'base-photo-social-icons', name: 'Соцсети' }, () =>
    'url(./wallpapers/social-icons.jpg), #101114'),

  defineBase({ id: 'base-photo-paper-plane', name: 'Бумажный самолёт' }, () =>
    'url(./wallpapers/paper-plane.jpg), #0a2a5e'),

  defineBase({ id: 'base-photo-doodle-scribble', name: 'Ночные дудлы' }, () =>
    'url(./wallpapers/doodle-scribble.jpg), #151329'),


  // ── Новые паттернные фоны в стиле фотографий-референсов ────────────────────

  // Те же приёмы, что и у референсов: плитка контурных иконок поверх мягкой

  // заливки. Каждый фон повторяет палитру своей темы (см. themeStore).


  defineBase({ id: 'base-deep-night', name: 'Глубокая ночь' }, () => [
    `${stars('#9db4e8', 1101, 52)} 0 0 / 1200px 700px repeat`,
    iconTile(['moon', 'star', 'cloud', 'star', 'moon', 'star'], '#ffb86b',
      { cols: 4, cell: 128, stroke: 4, seed: 1101 }),
    mesh('#05070f', [
      ['#131c3a', '28%', '18%', '50%', '44'],
      ['#070a16', '84%', '86%', '48%', '46'],
    ]),
  ].join(', ')),


  defineBase({ id: 'base-indigo-gold', name: 'Индиго и золото' }, () => [
    `${stars('#ffd98a', 1104, 56)} 0 0 / 1200px 700px repeat`,
    iconTile(['star', 'sparkle', 'note', 'star', 'sparkle', 'star'], '#fbbf24',
      { cols: 4, cell: 132, stroke: 4, seed: 1104 }),
    mesh('#0a0a26', [
      ['#171748', '26%', '16%', '52%', '46'],
      ['#07071c', '84%', '86%', '48%', '46'],
    ]),
  ].join(', ')),


  defineBase({ id: 'base-cherry-night', name: 'Тёмная вишня' }, () => [
    iconTile(['heart', 'heart', 'sparkle', 'leaf', 'heart', 'star'], '#e74c3c',
      { cols: 4, cell: 120, stroke: 4.5, seed: 1105, fill: '#6b1515' }),
    mesh('#140808', [
      ['#3a1010', '26%', '18%', '50%', '46'],
      ['#1a0a0a', '84%', '86%', '46%', '46'],
    ]),
  ].join(', ')),


  defineBase({ id: 'base-lavender-dream', name: 'Лавандовый сон' }, () => [
    iconTile(['sparkle', 'star', 'heart', 'cloud', 'star', 'sparkle'], '#a78bfa',
      { cols: 4, cell: 126, stroke: 4.5, seed: 1106, fill: '#5b3fb0' }),
    mesh('#15101f', [
      ['#2c2150', '26%', '18%', '50%', '46'],
      ['#120e1c', '84%', '86%', '46%', '46'],
    ]),
  ].join(', ')),


  defineBase({ id: 'base-ocean-depth', name: 'Океанская глубь' }, () => [
    iconTile(['wave', 'drop', 'mountain', 'wave', 'moon', 'drop'], '#3b82f6',
      { cols: 4, cell: 124, stroke: 4.5, seed: 1107 }),
    mesh('#06101f', [
      ['#0f2a5c', '28%', '18%', '52%', '46'],
      ['#050b16', '84%', '86%', '48%', '46'],
    ]),
  ].join(', ')),


  defineBase({ id: 'base-sand-shore', name: 'Песчаный берег', light: true }, () => [
    iconTile(['sun', 'wave', 'cloud', 'pin', 'drop', 'star'], '#c98a4b',
      { cols: 4, cell: 128, stroke: 4, seed: 1108 }),
    mesh('#faf3ea', [
      ['#f3e6d4', '24%', '16%', '50%', '56'],
      ['#fffaf3', '84%', '86%', '46%', '58'],
    ]),
  ].join(', ')),


  defineBase({ id: 'base-smoky-rose', name: 'Дымчато-розовая' }, () => [
    GRAIN(),
    iconTile(['leaf', 'heart', 'sparkle', 'star', 'leaf', 'heart'], '#f472b6',
      { cols: 4, cell: 122, stroke: 4.5, seed: 1109 }),
    mesh('#171014', [
      ['#3d1a28', '26%', '18%', '50%', '46'],
      ['#140e12', '84%', '86%', '46%', '46'],
    ]),
  ].join(', ')),


  defineBase({ id: 'base-jade-dark', name: 'Тёмный нефрит' }, () => [
    iconTile(['leaf', 'drop', 'sparkle', 'star', 'leaf', 'moon'], '#10b981',
      { cols: 4, cell: 124, stroke: 4.5, seed: 1110 }),
    mesh('#071510', [
      ['#0b3a2a', '26%', '16%', '50%', '46'],
      ['#04120c', '84%', '86%', '46%', '46'],
    ]),
  ].join(', ')),


  defineBase({ id: 'base-emerald-night', name: 'Ночной изумруд' }, () => [
    iconTile(['leaf', 'star', 'drop', 'leaf', 'sparkle', 'moon'], '#2ecc71',
      { cols: 4, cell: 126, stroke: 4.5, seed: 1111, fill: '#1a6b3a' }),
    mesh('#061410', [
      ['#0d3324', '28%', '18%', '50%', '46'],
      ['#040f0b', '84%', '86%', '46%', '46'],
    ]),
  ].join(', ')),


  defineBase({ id: 'base-cosmic-velvet', name: 'Космический бархат' }, () => [
    `${stars('#d8ccff', 1113, 70)} 0 0 / 1200px 700px repeat`,
    iconTile(['sparkle', 'star', 'rocket', 'star', 'moon', 'sparkle'], '#8b5cf6',
      { cols: 4, cell: 140, stroke: 4, seed: 1113 }),
    mesh('#0a0814', [
      ['#241a4e', '26%', '18%', '50%', '46'],
      ['#0a0812', '84%', '86%', '46%', '46'],
    ]),
  ].join(', ')),


  defineBase({ id: 'base-coral-branch', name: 'Коралловая ветвь' }, () => [
    iconTile(['wave', 'drop', 'sun', 'leaf', 'wave', 'star'], '#f43f5e',
      { cols: 4, cell: 124, stroke: 4.5, seed: 1115 }),
    mesh('#1a0d10', [
      ['#4a1420', '26%', '18%', '50%', '46'],
      ['#150a0e', '84%', '86%', '46%', '46'],
    ]),
  ].join(', ')),

  // ── Фоны для оставшихся тем ────────────────────────────────────────────

  defineBase({ id: 'base-paper-cream', name: 'Кремовая бумага', light: true }, () =>
    [GRAIN(), mesh('#f4f1ea', [['#ffffff','18%','12%','46%','66'],['#e6dfd1','82%','78%','52%','52']])].join(', ')),
  defineBase({ id: 'base-mist-silver', name: 'Серебряная дымка', light: true }, () =>
    [iconTile(['cloud', 'drop', 'sparkle'], '#aab3bd', { cols: 8, cell: 150, stroke: 1.1, seed: 21 }), mesh('#dfe3e8', [['#ffffff','22%','20%','58%','72'],['#c6ccd5','78%','74%','56%','46']])].join(', ')),
  defineBase({ id: 'base-neon-magenta', name: 'Неоновая фуксия' }, () =>
    [iconTile(['sparkle','star','heart','drop'], '#ff5ce1', { cols: 9, cell: 132, stroke: 1.2, seed: 71 }), mesh('#1a0716', [['#ff2ec4','24%','18%','52%','3a'],['#7a1fff','80%','80%','56%','30']])].join(', ')),
  defineBase({ id: 'base-chalk-crimson', name: 'Алый мел' }, () =>
    [GRAIN(), mesh('#1c0d10', [['#7a1220','20%','16%','50%','44'],['#3d0b12','78%','82%','54%','40']])].join(', ')),
  defineBase({ id: 'base-abyss-ice', name: 'Бездна и лёд' }, () =>
    [stars('#bfe6ff', 43, 46), mesh('#050a16', [['#123a6b','26%','22%','54%','3c'],['#0d6b8f','80%','78%','50%','2c']])].join(', ')),
  defineBase({ id: 'base-gold-vault', name: 'Золотой сейф' }, () =>
    [GRAIN(), mesh('#15110a', [['#7a5a16','22%','16%','50%','40'],['#3a2c0c','80%','82%','52%','44']])].join(', ')),
  defineBase({ id: 'base-vk-blue', name: 'VK синий', light: true }, () =>
    [iconTile(['user', 'users', 'mail', 'heart'], '#7ba4dd', { cols: 8, cell: 150, stroke: 1.3, seed: 33 }), mesh('#eef3fb', [['#ffffff','20%','16%','52%','70'],['#cfe0f7','80%','80%','54%','50']])].join(', ')),
  defineBase({ id: 'base-x-ink', name: 'X чернила' }, () =>
    [iconTile(['sparkle', 'star', 'plus'], '#ffffff', { cols: 7, cell: 170, stroke: 1, seed: 47 }), mesh('#0a0a0a', [['#ffffff','30%','24%','46%','10'],['#1c1c1c','76%','80%','52%','60']])].join(', ')),
  defineBase({ id: 'base-fb-light', name: 'Facebook светлый', light: true }, () =>
    [iconTile(['users', 'heart', 'photo', 'smile'], '#8fabd2', { cols: 8, cell: 148, stroke: 1.2, seed: 59 }), mesh('#f0f4fa', [['#ffffff','24%','18%','50%','72'],['#d6e2f2','78%','78%','54%','52']])].join(', ')),
  defineBase({ id: 'base-discord-blurple', name: 'Discord блюрпл' }, () =>
    [iconTile(['gamepad', 'gift', 'smile'], '#8b93f8', { cols: 8, cell: 150, stroke: 1.4, seed: 67 }), mesh('#1e2028', [['#5865f2','24%','18%','54%','34'],['#2b2d3a','80%','80%','52%','52']])].join(', ')),
  defineBase({ id: 'base-tg-night', name: 'Telegram ночной' }, () =>
    [iconTile(['plane', 'paperclip', 'check'], '#4d8fc4', { cols: 8, cell: 150, stroke: 1.3, seed: 79 }), mesh('#10161f', [['#1d5c8f','22%','16%','52%','38'],['#16304a','80%','80%','54%','46']])].join(', ')),
];

/** Найти базовый фон по id — его хранят и темы, и галерея обоев. */
export function findBaseWallpaper(id?: string | null): BaseWallpaper | undefined {
  if (!id) return undefined;
  return BASE_WALLPAPERS.find((w) => w.id === id);
}

/** CSS фона по id или `none`, если id неизвестен (старая ссылка, удалённый фон). */
export function baseWallpaperCss(id?: string | null): string {
  return findBaseWallpaper(id)?.css || 'none';
}

/** Светлый ли фон — от этого зависит цвет слоя яркости поверх обоев. */
export function isLightBaseWallpaper(id?: string | null): boolean {
  return !!findBaseWallpaper(id)?.light;
}

/* ── Классы вместо инлайновых стилей ────────────────────────────────────── */

/**
 * Почему не `background: css` прямо в sx.
 *
 * Строка фона — это десятки килобайт (градиенты + data-URI с SVG). Emotion на
 * каждом рендере сериализует объект стилей и хеширует результат, поэтому
 * многосоткибайтовая строка в `sx` означала хеширование всей картинки на
 * каждом кадре — интерфейс подлагивал при любом ререндере чата.
 *
 * Поэтому каждый фон один раз кладётся в общий <style> под своим классом, а
 * компоненты берут короткий `className`. Дальше emotion хеширует пару
 * символов, а правило с фоном не пересобирается.
 */
const CLASS_ATTR = 'data-vera-base-wallpapers';
const classById = new Map<string, string>();
const ruleById = new Map<string, string>();
/**
 * Какие id уже записаны в конкретный <style>.
 *
 * Именно Set на элемент, а не `sheet.querySelector('.класс')`: внутри <style>
 * лежит ТЕКСТ, а не DOM-элементы, поэтому querySelector по классу всегда
 * возвращал null. Из-за этого правило дописывалось заново при КАЖДОМ обращении
 * (а вызывается это на каждом рендере галереи и чата): <style> рос без предела,
 * браузер в какой-то момент начинал молча отбрасывать новые правила — и обои
 * переставали появляться, хотя класс на элементе стоял.
 */
const writtenBySheet = new WeakMap<HTMLStyleElement, Set<string>>();
let sheetEl: HTMLStyleElement | null = null;

function wallpaperStyleSheet(): HTMLStyleElement | null {
  if (typeof document === 'undefined' || !document.head) return null;
  // Элемент могли удалить вместе с пересборкой head — тогда создаём заново.
  if (!sheetEl || !sheetEl.isConnected) {
    sheetEl = document.head.querySelector<HTMLStyleElement>(`style[${CLASS_ATTR}]`)
      || document.createElement('style');
    if (!sheetEl.getAttribute(CLASS_ATTR)) sheetEl.setAttribute(CLASS_ATTR, '');
    if (!sheetEl.parentNode) document.head.appendChild(sheetEl);
  }
  return sheetEl;
}

/** Дописывает правило один раз на каждый <style>: повторные вызовы — no-op. */
function ensureRule(id: string, rule: string): void {
  const sheet = wallpaperStyleSheet();
  if (!sheet) return;
  let written = writtenBySheet.get(sheet);
  if (!written) {
    written = new Set<string>();
    writtenBySheet.set(sheet, written);
  }
  if (written.has(id)) return;
  sheet.appendChild(document.createTextNode(rule));
  written.add(id);
}

/**
 * Правило фона.
 *
 * `cover`/`center` дописываем ВСЕГДА, как было изначально. Пробовали убирать их
 * для слоёв с собственной раскладкой (`url(...) 0 0 / 1200px 700px repeat`) —
 * и фоны с плитками (Аврора, Полёт, Пиксельный город) стали рисоваться в
 * натуральную величину, то есть в маленькой плитке галереи был виден только
 * угол узора. Возврат к cover — единственное, что работало у всех.
 */
function wallpaperRule(cls: string, css: string): string {
  return `.${cls}{background:${css};background-size:cover;background-position:center;}`;
}

/**
 * CSS-класс для фона, добавленного админом (загруженный градиент/заливка).
 *
 * Отдельная функция, а не расширение каталога: `BASE_WALLPAPERS` — константа
 * модуля, а админские фоны приходят с сервера уже после загрузки приложения.
 * Правило кладётся в тот же общий <style> и по тем же правилам (cover/center,
 * одно правило на id), иначе фон админа вёл бы себя не так, как заводской.
 */
const adminRuleById = new Map<string, string>();
const adminClassById = new Map<string, string>();

export function adminWallpaperClass(id: string, css: string): string {
  if (!id || !css) return '';
  // Ключ — пара id+css, а не только id: правило пишется в общий <style> один раз
  // на ключ (см. ensureRule). При перезаливке фона тем же id правило должно
  // обновиться, а не молча пропуститься как «уже записанное».
  const key = `${id}|${css}`;
  const cached = adminClassById.get(key);
  const rule = adminRuleById.get(key);
  if (cached && rule) {
    // <style> мог быть пересоздан (перезагрузка): правило надо вернуть.
    ensureRule(key, rule);
    return cached;
  }
  // Класс остаётся от id, поэтому перезаливка обновляет уже существующий
  // элемент, а не плодит новые классы в разметке.
  const cls = `vera-bw-${id.replace(/[^a-z0-9]+/gi, '-')}`;
  const nextRule = wallpaperRule(cls, css);
  adminRuleById.set(key, nextRule);
  adminClassById.set(key, cls);
  ensureRule(key, nextRule);
  return cls;
}

/**
 * CSS-класс фона по id (создаётся при первом обращении) или '' для чужих id.
 * Класс ставит фон на весь элемент с cover/center.
 */
export function baseWallpaperClass(id?: string | null): string {
  const found = findBaseWallpaper(id);
  if (!found) return '';
  const cached = classById.get(found.id);
  if (cached) {
    // <style> мог быть пересоздан (перезагрузка, смена разметки head): правило
    // тогда надо вернуть, иначе фон молча пропадёт. ensureRule допишет его
    // ровно один раз на новый элемент.
    ensureRule(found.id, ruleById.get(found.id)!);
    return cached;
  }

  const cls = `vera-bw-${found.id.replace(/[^a-z0-9]+/gi, '-')}`;
  const rule = wallpaperRule(cls, found.css);
  ruleById.set(found.id, rule);
  classById.set(found.id, cls);
  ensureRule(found.id, rule);
  return cls;
}

