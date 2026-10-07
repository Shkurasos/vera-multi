/**
 * Прото доска: совместный холст с карточками, нитями и фотографиями.
 *
 * В отличие от прежней версии, доска больше не хранится в IndexedDB. Она
 * общее состояние группы, поэтому правда живёт на сервере: пока карточки лежали
 * в браузере, приглашённый открывал свою пустую доску, а «только просмотр» и
 * «редактирование» было не поверх чего разделять.
 *
 * Правила и геометрия вынесены сюда и покрыты тестами: иначе «новые» и
 * «популярные» незаметно путаются, а нить, привязанная к центру карточки,
 * выглядит паутиной.
 */

/** Доска шириной и высотой в «мировых» пикселях: холст больше экрана. */
export const BOARD_W = 2600;
export const BOARD_H = 1800;

/**
 * Границы размера доски.
 *
 * Размер стал настраиваемым (кнопки ± в HUD), поэтому нужны потолок и пол:
 * без пола доску можно было бы сжать в точку и потерять все карточки, а без
 * потолка — растянуть на десятки тысяч пикселей и грузить пустоту.
 */
export const BOARD_MIN_W = 1200;
export const BOARD_MIN_H = 900;
export const BOARD_MAX_W = 8000;
export const BOARD_MAX_H = 6000;
/** Шаг одной кнопки «+»/«−». */
export const BOARD_STEP = 300;

/** Размеры и поворот карточки: те же границы, что и у серверного санитайзера. */
export const ITEM_MIN_SIZE = 40;
export const ITEM_MAX_SIZE = 4000;
export const ITEM_MAX_ROTATION = 30;

export type DeskItemKind = 'photo' | 'note' | 'message' | 'folder';

export interface DeskItem {
  id: string;
  kind: DeskItemKind;
  /** Левый верхний угол в координатах доски. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Поворот в градусах: карточки на пробке висят криво. */
  rotation: number;
  /** Порядок наложения. */
  z: number;
  /** Текст заметки или содержимое приколотого сообщения. */
  text?: string;
  /** Подпись под фотографией. */
  caption?: string;
  /** Ссылка на фото в /uploads/proto — файлы лежат на сервере, не в браузере. */
  photoUrl?: string;
  /** Автор, если приколото сообщение из чата. */
  author?: string;
  /**
   * Папка, в которой лежит карточка.
   *
   * Ссылка по id, а не вложенный список: папку можно двигать, и тогда её
   * содержимое обязано ехать вместе с ней — со вложенностью пришлось бы
   * пересобирать дерево на каждое движение мыши.
   */
  folderId?: string;
  createdAt: number;
}

export interface DeskThread {
  id: string;
  from: string;
  to: string;
  color: string;
}

export interface DeskBoard {
  items: DeskItem[];
  threads: DeskThread[];
  updatedAt: number;
  /**
   * Размер холста в мировых пикселях.
   *
   * Раньше размер был константой, и холст нельзя было ни расширить под новые
   * улики, ни убрать лишнее место. Хранится вместе с доской, поэтому размер
   * общий у всех участников, а не «у меня так, у тебя так».
   */
  width: number;
  height: number;
}

/** Право на доске. Владелец один, остальным выдают просмотр или редактирование. */
export type DeskLevel = 'owner' | 'editor' | 'viewer';

/** Что мне можно на этой доске. Приходит с сервера вместе с доской. */
export interface DeskRights {
  myLevel: DeskLevel | null;
  canEdit: boolean;
  canManage: boolean;
  members: Array<{ userId: string; level: DeskLevel; user?: { id: string; username?: string | null; firstName?: string | null; lastName?: string | null; avatarUrl?: string | null } | null }>;
}

/** Палитра нитей. */
export const THREAD_COLORS = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#ecf0f1'];

/**
 * Привести размер холста в допустимые границы.
 *
 * Отдельно от resizeBoard, потому что размер приходит ещё и с сервера: там
 * тоже могут прислать ерунду, а доска с нулевой шириной не рисуется вовсе.
 */
export function boardSize(width?: number, height?: number): { width: number; height: number } {
  const w = Number(width);
  const h = Number(height);
  return {
    width: Number.isFinite(w) ? Math.min(BOARD_MAX_W, Math.max(BOARD_MIN_W, Math.round(w))) : BOARD_W,
    height: Number.isFinite(h) ? Math.min(BOARD_MAX_H, Math.max(BOARD_MIN_H, Math.round(h))) : BOARD_H,
  };
}

export function emptyBoard(): DeskBoard {
  return { items: [], threads: [], updatedAt: 0, width: BOARD_W, height: BOARD_H };
}

/**
 * Имя группы, которое включает режим доски.
 *
 * Правило простое: название начинается с вертикальной черты — «| Дело»,
 * «| Ограбление». Так группа помечается доской независимо от её названия,
 * поэтому переименовать её можно как угодно и доска не пропадёт.
 *
 * Раньше правило было другим: «proto»/«desk» в начале названия. От него
 * отказались — приходилось угадывать слово-маркер, а «Прото» в названии группы
 * («Прототипы», «Прото доска») превращало обычный чат в доску.
 *
 * Проверяем по началу, а не по вхождению: иначе «Работа | в отделе» стала бы
 * доской. Старые «proto»/«desk» больше не считаются досками: иначе группа,
 * которую переименовали ради обычного общения, так и осталась бы доской.
 */
export function isDeskName(name?: string | null): boolean {
  return /^\s*\|/.test(name || '');
}

/**
 * Ограничить карточку пределами холста, чтобы её нельзя было утащить в никуда.
 *
 * Размер холста передаётся явно: он у каждой доски свой, и при жёстко
 * зашитом BOARD_W карточка на расширенной доске всё равно не пустила бы дальше
 * старого края. Значения по умолчанию оставлены для старых вызовов и тестов.
 */
export function clampItem(item: DeskItem, boardW: number = BOARD_W, boardH: number = BOARD_H): DeskItem {
  const w = Number.isFinite(item.w)
    ? Math.max(ITEM_MIN_SIZE, Math.min(ITEM_MAX_SIZE, item.w))
    : 240;
  const h = Number.isFinite(item.h)
    ? Math.max(ITEM_MIN_SIZE, Math.min(ITEM_MAX_SIZE, item.h))
    : 170;
  const rotation = Number.isFinite(item.rotation)
    ? Math.max(-ITEM_MAX_ROTATION, Math.min(ITEM_MAX_ROTATION, item.rotation))
    : 0;
  return {
    ...item,
    w,
    h,
    rotation,
    // Правая нижняя граница считается от края холста, но не может стать
    // отрицательной: иначе на доске уже карточки, а мы вдруг сжали её так,
    // что места для них не осталось, и x/y уехали бы в минус.
    x: Math.max(0, Math.min(Math.max(0, boardW - w), item.x)),
    y: Math.max(0, Math.min(Math.max(0, boardH - h), item.y)),
  };
}

/** Следующий слой поверх всех. */
export function nextZ(board: DeskBoard): number {
  return board.items.reduce((max, i) => Math.max(max, i.z), 0) + 1;
}

export function addItem(board: DeskBoard, item: DeskItem): DeskBoard {
  // Слой назначает здесь, а не вызывающий: иначе карточка, добавленная с
  // тем же z, что и старая, уезжает под неё — новый элемент всегда сверху.
  const size = boardSize(board.width, board.height);
  return { ...board, items: [...board.items, clampItem({ ...item, z: nextZ(board) }, size.width, size.height)] };
}

export function updateItem(board: DeskBoard, id: string, patch: Partial<DeskItem>): DeskBoard {
  const size = boardSize(board.width, board.height);
  return {
    ...board,
    items: board.items.map((i) => (i.id === id ? clampItem({ ...i, ...patch }, size.width, size.height) : i)),
  };
}

/** Изменить размер относительно центра карточки, не обходя общий санитайзер. */
export function scaleItem(board: DeskBoard, id: string, factor: number): DeskBoard {
  const item = board.items.find((i) => i.id === id);
  if (!item || !Number.isFinite(factor) || factor <= 0) return board;
  const w = Math.max(ITEM_MIN_SIZE, Math.min(ITEM_MAX_SIZE, item.w * factor));
  const h = Math.max(ITEM_MIN_SIZE, Math.min(ITEM_MAX_SIZE, item.h * factor));
  return updateItem(board, id, {
    x: item.x - (w - item.w) / 2,
    y: item.y - (h - item.h) / 2,
    w,
    h,
  });
}

/** Повернуть карточку на небольшой шаг; updateItem ограничивает итоговый угол. */
export function rotateItem(board: DeskBoard, id: string, delta: number): DeskBoard {
  const item = board.items.find((i) => i.id === id);
  if (!item || !Number.isFinite(delta)) return board;
  return updateItem(board, id, { rotation: item.rotation + delta });
}

/**
 * Удалить карточку вместе со всеми её нитями.
 *
 * Это главное, что легко забыть: без чистки связей нити повисают в пустоту и
 * рисуются к нулевым координатам.
 */
export function removeItem(board: DeskBoard, id: string): DeskBoard {
  // Удалённую папку нельзя оставлять в ссылках карточек: они ссылались бы в
  // пустоту. Сами карточки остаются на доске — стирать папку не должно значить
  // стирать всё, что в ней лежало.
  return {
    ...board,
    items: board.items
      .filter((i) => i.id !== id)
      .map((i) => (i.folderId === id ? { ...i, folderId: undefined } : i)),
    threads: board.threads.filter((t) => t.from !== id && t.to !== id),
  };
}

/** Связь между двумя карточками. Повторы и петли не создаём. */
export function addThread(board: DeskBoard, from: string, to: string, color: string): DeskBoard {
  if (from === to) return board;
  const exists = board.threads.some(
    (t) => (t.from === from && t.to === to) || (t.from === to && t.to === from),
  );
  if (exists) return board;
  const thread: DeskThread = { id: `t-${from}-${to}-${board.threads.length}`, from, to, color };
  return { ...board, threads: [...board.threads, thread] };
}

export function removeThread(board: DeskBoard, id: string): DeskBoard {
  return { ...board, threads: board.threads.filter((t) => t.id !== id) };
}

/** Поднять карточку наверх. */
export function bringToFront(board: DeskBoard, id: string): DeskBoard {
  return updateItem(board, id, { z: nextZ(board) });
}

/** Размеры карточки по умолчанию: у фото — под пропорции снимка. */
export function defaultSize(kind: DeskItemKind, photoAspect?: number): { w: number; h: number } {
  if (kind === 'folder') return { w: 520, h: 380 };
  if (kind === 'photo') {
    const aspect = photoAspect && photoAspect > 0 ? photoAspect : 1;
    const w = 220;
    return { w, h: Math.round(w / aspect) + 34 }; // +34 — полоска под подпись
  }
  if (kind === 'message') return { w: 260, h: 150 };
  return { w: 240, h: 170 };
}

export type Point = { x: number; y: number };

/** Центр карточки. */
export function itemCenter(item: DeskItem): Point {
  return { x: item.x + item.w / 2, y: item.y + item.h / 2 };
}

/**
 * Точка на рамке карточки по направлению к цели.
 *
 * Нить крепится к краю карточки, а не к центру: линия из центра выглядит как
 * паутина и перечёркивает текст. Считаем пересечение луча «центр → цель» с
 * прямоугольником и берём ту грань, до которой луч дошёл раньше.
 */
export function edgePoint(item: DeskItem, toward: Point): Point {
  const c = itemCenter(item);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = item.w / 2;
  const hh = item.h / 2;
  // Насколько далеко можно уйти по каждой оси, прежде чем выйдем за грань.
  const scaleX = dx === 0 ? Infinity : hw / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : hh / Math.abs(dy);
  const k = Math.min(scaleX, scaleY);
  return { x: c.x + dx * k, y: c.y + dy * k };
}

/**
 * SVG-путь нити: слегка провисает, как настоящая верёвка на пробке.
 *
 * Величина провиса растёт с длиной (но с потолком): иначе короткие нити
 * выглядели бы натянутыми струнами, а длинные уходили бы в пол.
 */
export function threadPath(a: DeskItem, b: DeskItem): string {
  if (a.id === b.id) return '';
  const p1 = edgePoint(a, itemCenter(b));
  const p2 = edgePoint(b, itemCenter(a));
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const sag = Math.min(48, dist * 0.12);
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  // Контрольная точка смещается вниз: нить висит под собственным весом.
  return `M ${p1.x} ${p1.y} Q ${mx} ${my + sag} ${p2.x} ${p2.y}`;
}

/**
 * Свободное место под новую карточку: спираль от центра.
 *
 * Без этого все карточки появлялись бы стопкой в одной точке, и растаскивать
 * их пришлось бы вручную.
 */
export function findFreeSpot(board: DeskBoard, w: number, h: number): Point {
  const size = boardSize(board.width, board.height);
  const centre = { x: size.width / 2 - w / 2, y: size.height / 2 - h / 2 };
  const step = 60;
  for (let ring = 0; ring < 14; ring++) {
    for (let i = 0; i < 8; i++) {
      const x = centre.x + Math.cos((i / 8) * Math.PI * 2) * ring * step;
      const y = centre.y + Math.sin((i / 8) * Math.PI * 2) * ring * step * 0.7;
      const spot = {
        x: Math.max(0, Math.min(Math.max(0, size.width - w), x)),
        y: Math.max(0, Math.min(Math.max(0, size.height - h), y)),
      };
      const clashes = board.items.some(
        (it) => Math.abs(it.x - spot.x) < w * 0.6 && Math.abs(it.y - spot.y) < h * 0.6,
      );
      if (!clashes) return spot;
    }
  }
  return { x: centre.x, y: centre.y };
}

// ─── Размер холста ────────────────────────────────────────────────────────────

/**
 * Изменить размер доски на дельту, с потолком и полом.
 *
 * Дельтой, а не абсолютным значением: кнопка «+» должна означать «ещё немного»,
 * а текущий размер хранится уже в трёх местах (доска, сервер, все участники),
 * и его нельзя было бы задавать снаружи.
 */
export function resizeBoard(board: DeskBoard, dw: number, dh: number): DeskBoard {
  const size = boardSize(board.width + dw, board.height + dh);
  return { ...board, width: size.width, height: size.height };
}

// ─── Папки ────────────────────────────────────────────────────────────────────

/** Папки доски. Остальные карточки лежат прямо на пробке. */
export function foldersOf(board: DeskBoard): DeskItem[] {
  return board.items.filter((i) => i.kind === 'folder');
}

/** Сколько карточек в папке — показываем на её ярлыке. */
export function countInFolder(board: DeskBoard, folderId: string): number {
  return board.items.filter((i) => i.folderId === folderId).length;
}

/**
 * Папка под точку (по центру карточки), в которую можно положить карточку.
 *
 * Сама перетаскиваемая карточка исключена: иначе она «нашла бы» себя и
 * положила сама себя. Из нескольких подходящих берём ту, что выше остальных —
 * иначе карточка попадала бы в нижнюю папку, а визуально лежит в верхней.
 */
export function folderAt(board: DeskBoard, point: Point, excludeId?: string): DeskItem | null {
  let best: DeskItem | null = null;
  for (const f of foldersOf(board)) {
    if (f.id === excludeId) continue;
    const inside = point.x >= f.x && point.x <= f.x + f.w
      && point.y >= f.y && point.y <= f.y + f.h;
    if (!inside) continue;
    if (!best || f.z > best.z) best = f;
  }
  return best;
}

/**
 * Положить карточку в папку (или вынуть, если folderId нет).
 *
 * Папка в папку не кладётся: folderId всегда ссылается на карточку с
 * kind 'folder', а вложенность здесь была бы циклами при перетаскивании.
 */
export function assignToFolder(board: DeskBoard, itemId: string, folderId?: string | null): DeskBoard {
  const item = board.items.find((i) => i.id === itemId);
  if (!item) return board;
  if (folderId === itemId) return board;
  const target = folderId ? board.items.find((i) => i.id === folderId && i.kind === 'folder') : null;
  return {
    ...board,
    items: board.items.map((i) => (i.id === itemId ? { ...i, folderId: target ? target.id : undefined } : i)),
  };
}

/**
 * Перетащить карточку и «сложить» её в папку, если она туда попала.
 *
 * Отдельной функцией, а не в updateItem: правило «центр внутри папки = она в
 * папке» должно сработать один раз — при отпускании мыши. Проверять его на
 * каждом движении нельзя, иначе карточка «залипала» бы в папке, из которой её
 * вытащили за угол.
 */
export function dropItem(board: DeskBoard, itemId: string, x: number, y: number): DeskBoard {
  const item = board.items.find((i) => i.id === itemId);
  if (!item) return board;
  const folder = item.kind === 'folder' ? null : folderAt(board, { x, y }, itemId);
  return assignToFolder(updateItem(board, itemId, { x, y }), itemId, folder?.id ?? null);
}

/**
 * Сдвинуть папку вместе со всем, что в ней лежит.
 *
 * Смещение, а не абсолютные координата: дети помнят своё положение ОТНОСИТЕЛЬНО
 * папки. Если бы мы пересчитывали им координаты от края папки, то карточка,
 * специально вынесенная за её край, прыгала бы обратно при каждом сдвиге.
 */
export function moveFolder(board: DeskBoard, folderId: string, x: number, y: number): DeskBoard {
  const folder = board.items.find((i) => i.id === folderId);
  if (!folder || folder.kind !== 'folder') return board;
  const dx = x - folder.x;
  const dy = y - folder.y;
  const size = boardSize(board.width, board.height);
  const next = clampItem({ ...folder, x, y }, size.width, size.height);
  const realDx = next.x - folder.x;
  const realDy = next.y - folder.y;
  return {
    ...board,
    items: board.items.map((i) => {
      if (i.id === folderId) return { ...i, x: next.x, y: next.y };
      if (i.folderId !== folderId) return i;
      return clampItem({ ...i, x: i.x + realDx, y: i.y + realDy }, size.width, size.height);
    }),
  };
}

/** Карточки папки — нужно, чтобы отрисовать их поверх неё. */
export function itemsOfFolder(board: DeskBoard, folderId: string): DeskItem[] {
  return board.items.filter((i) => i.folderId === folderId);
}