/**
 * Состояние прото доски: загрузка с сервера, правки и права.
 *
 * Все изменения идут через чистые функции из `utils/deskBoard`, а хук лишь
 * применяет их и планирует запись. Запись отложенная (debounce): при
 * перетаскивании карточки правки летят каждый кадр, и слать их на сервер на
 * каждое движение мыши нельзя — это превратило бы перетаскивание в слайд-шоу.
 *
 * Прав и общей правды нет: сервер — единственный источник, а хук только
 * показывает то, что пришло. Поэтому зрителю мы вообще не даём менять доску:
 * сервер всё равно отклонил бы запись, а интерфейс не должен обещать то, чего
 * не случится.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addItem, addThread, bringToFront, boardSize, defaultSize, dropItem, emptyBoard, findFreeSpot, moveFolder,
  nextZ, removeItem, removeThread, resizeBoard, rotateItem, scaleItem, setItemAlarm, updateItem,
  type DeskBoard, type DeskItem, type DeskItemKind, type DeskRights,
} from '../utils/deskBoard';
import { protoBoardApi } from '../services/api';
import { getSocket } from '../services/socket';

/** Задержка записи после последней правки. */
const SAVE_DEBOUNCE_MS = 800;

function newId(prefix: string): string {
  return (crypto as any)?.randomUUID?.() || `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const NO_RIGHTS: DeskRights = { myLevel: null, canEdit: false, canManage: false, members: [] };

/**
 * Кэш досок на время жизни вкладки.
 *
 * Без него каждое открытие доски начиналось с пустой пробки и ожидания
 * сервера — записки «загружались» заново при каждом входе. Теперь доска
 * показывается мгновенно из кэша, а свежая версия подтягивается в фоне.
 *
 * Кэш ограничен по числу досок (LRU): доска с сотнями карточек весит
 * заметно, держать в памяти все когда-либо открытые незачем.
 */
const CACHE_LIMIT = 8;
const boardCache = new Map<string, { board: DeskBoard; rights: DeskRights }>();

function cacheGet(chatId: string) {
  const hit = boardCache.get(chatId);
  if (hit) {
    // Перекладываем в конец — так Map работает как LRU.
    boardCache.delete(chatId);
    boardCache.set(chatId, hit);
  }
  return hit;
}

function cacheSet(chatId: string, entry: { board: DeskBoard; rights: DeskRights }) {
  boardCache.delete(chatId);
  boardCache.set(chatId, entry);
  while (boardCache.size > CACHE_LIMIT) {
    const oldest = boardCache.keys().next().value;
    if (oldest === undefined) break;
    boardCache.delete(oldest);
  }
}

export interface UseDeskBoard {
  board: DeskBoard;
  rights: DeskRights;
  /** Доска прочитана с сервера (иначе показывать нечего — идёт загрузка). */
  ready: boolean;
  /** Причина, по которой доска недоступна (нет прав / сеть). */
  error: string | null;
  addNote: (text: string) => void;
  addMessage: (text: string, author: string) => void;
  addPhoto: (file: File) => Promise<void>;
  move: (id: string, x: number, y: number) => void;
  scale: (id: string, factor: number) => void;
  rotate: (id: string, delta: number) => void;
  patch: (id: string, patch: Partial<DeskItem>) => void;
  /** Поставить будильник карточки (ms) или снять его (null). */
  setAlarm: (id: string, at: number | null) => void;
  replacePhoto: (id: string, file: File) => Promise<void>;
  drop: (id: string) => void;
  link: (from: string, to: string, color: string) => void;
  unlink: (id: string) => void;
  focus: (id: string) => void;
  /** Новая папка; возвращает её id, чтобы сразу выделить. */
  addFolder: (name?: string) => string;
  /** Сдвинуть папку вместе с содержимым. */
  moveFolderTo: (id: string, x: number, y: number) => void;
  /** Отпустить карточку: приземлилась и, если попала в папку, легла в неё. */
  dropCard: (id: string, x: number, y: number) => void;
  /** Изменить размер доски на дельту (кнопки «+»/«−» в HUD). */
  resize: (dw: number, dh: number) => void;
  grant: (userId: string, level: 'viewer' | 'editor') => Promise<void>;
  setLevel: (userId: string, level: 'viewer' | 'editor') => Promise<void>;
  revoke: (userId: string) => Promise<void>;
  /** Перечитать доску с сервера — нужно, когда права изменили со стороны. */
  reload: () => Promise<void>;
}

export function useDeskBoard(chatId?: string): UseDeskBoard {
  // Стартуем сразу с кэша, если доска уже открывалась: никакой пустой пробки.
  const [board, setBoard] = useState<DeskBoard>(() => (chatId && boardCache.get(chatId)?.board) || emptyBoard());
  const [rights, setRights] = useState<DeskRights>(() => (chatId && boardCache.get(chatId)?.rights) || NO_RIGHTS);
  const [ready, setReady] = useState(() => !!(chatId && boardCache.has(chatId)));
  // Текущий чат: ответ сервера для прошлого чата не должен перетереть новый.
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  // Актуальная доска для записи: замыкание таймера не должно видеть старый
  // стейт, иначе последнее движение мыши потерялось бы при сохранении.
  const latestRef = useRef<DeskBoard>(board);
  // Право редактирования в ref: расписание записи читает его на отправке, и
  // к тому моменту оно должно быть актуальным, а не захваченным в замыкании.
  const canEditRef = useRef(!!(chatId && boardCache.get(chatId)?.rights.canEdit));
  const rightsRef = useRef<DeskRights>(rights);

  const apply = useCallback((next: DeskBoard) => {
    latestRef.current = next;
    setBoard(next);
    // Каждая правка сразу попадает в кэш: вернувшись на доску, увидим её
    // такой, какой оставили, даже если запись на сервер ещё не ушла.
    if (chatIdRef.current) cacheSet(chatIdRef.current, { board: next, rights: rightsRef.current });
  }, []);

  const load = useCallback(async () => {
    if (!chatId) { setReady(true); return; }
    try {
      const res = await protoBoardApi.get(chatId);
      if (chatIdRef.current !== chatId) return; // успели переключиться на другой чат
      const data = res.data;
      const nextRights: DeskRights = {
        myLevel: data.myLevel ?? null,
        canEdit: !!data.canEdit,
        canManage: !!data.canManage,
        members: data.members || [],
      };
      rightsRef.current = nextRights;
      setRights(nextRights);
      canEditRef.current = nextRights.canEdit;
      setError(null);
      // Доска на сервере не менялась (тот же updatedAt) — не трогаем стейт.
      // Иначе сотни карточек перерисовывались бы на каждом открытии и на
      // каждом сокет-событии, даже когда менять нечего.
      const serverUpdatedAt = data.updatedAt || 0;
      if (serverUpdatedAt && serverUpdatedAt === latestRef.current.updatedAt) {
        cacheSet(chatId, { board: latestRef.current, rights: nextRights });
        return;
      }
      // Есть несохранённая локальная правка — свежая версия с сервера её бы
      // затёрла. Подождём: после записи придёт сокет-событие и мы перечитаем.
      if (timerRef.current !== null) return;
      // Размер приходит с сервера и может отсутствовать у доски, созданной до
      // появления этой настройки, — тогда берём размер по умолчанию.
      const size = boardSize(data.width, data.height);
      apply({
        items: data.items || [],
        threads: data.threads || [],
        updatedAt: serverUpdatedAt,
        width: size.width,
        height: size.height,
      });
    } catch (e: any) {
      if (chatIdRef.current !== chatId) return;
      const status = e?.response?.status;
      // Сеть отвалилась, а доска есть в кэше — показываем её, а не ошибку.
      if (status !== 403 && boardCache.has(chatId)) return;
      setError(status === 403 ? 'Вам не открыта эта доска' : (e?.response?.data?.message || 'Не удалось загрузить доску'));
      rightsRef.current = NO_RIGHTS;
      setRights(NO_RIGHTS);
      canEditRef.current = false;
      if (status === 403) boardCache.delete(chatId);
    } finally {
      if (chatIdRef.current === chatId) setReady(true);
    }
  }, [chatId, apply]);

  // Смена чата: доска из кэша показывается сразу, сервер — фоном.
  // Пустая пробка и «Загрузка» остаются только для первого открытия.
  useEffect(() => {
    const cached = chatId ? cacheGet(chatId) : undefined;
    setError(null);
    if (cached) {
      latestRef.current = cached.board;
      setBoard(cached.board);
      rightsRef.current = cached.rights;
      setRights(cached.rights);
      canEditRef.current = cached.rights.canEdit;
      setReady(true);
    } else {
      setReady(false);
      latestRef.current = emptyBoard();
      setBoard(latestRef.current);
      rightsRef.current = NO_RIGHTS;
      setRights(NO_RIGHTS);
      canEditRef.current = false;
    }
    void load();
  }, [chatId, load]);

  // Отложенная запись.
  const schedule = useCallback(() => {
    if (!chatId || !canEditRef.current) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const payload = latestRef.current;
      void protoBoardApi.save(chatId, {
        items: payload.items,
        threads: payload.threads,
        // Размер едет тем же запросом: отдельная точка «сохранить размер» была
        // бы лишней, а без него кнопки «+»/«−» терялись бы при перезагрузке.
        width: payload.width,
        height: payload.height,
      })
        .catch(() => { /* следующая правка попробует снова */ });
    }, SAVE_DEBOUNCE_MS);
  }, [chatId]);

  // На размонтировании дописываем хвост: иначе последняя правка потеряется.
  useEffect(() => () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      if (chatId && canEditRef.current) {
        const payload = latestRef.current;
        void protoBoardApi.save(chatId, {
          items: payload.items,
          threads: payload.threads,
          width: payload.width,
          height: payload.height,
        });
      }
    }
  }, [chatId]);
// PLACEHOLDER_HOOK_2

  /**
   * Общая обёртка: применить чистую функцию и запланировать запись.
   *
   * Проверка canEdit здесь, а не только в интерфейсе: горячие клавиши и
   * сокет-события тоже зовут mutate, и без проверки зритель смог бы писать
   * в доску мимо кнопок (сервер бы отклонил, но интерфейс врал бы).
   */
  const mutate = useCallback((fn: (b: DeskBoard) => DeskBoard) => {
    if (!canEditRef.current) return;
    apply(fn(latestRef.current));
    schedule();
  }, [apply, schedule]);

  const newCard = useCallback((kind: DeskItemKind, data: Partial<DeskItem>, w: number, h: number): DeskItem => {
    const spot = findFreeSpot(latestRef.current, w, h);
    return {
      id: newId(kind),
      kind,
      x: spot.x,
      y: spot.y,
      w,
      h,
      // Лёгкий наклон: ровные карточки на пробке выглядят ненастоящими.
      rotation: Math.round((Math.random() * 6 - 3) * 10) / 10,
      z: nextZ(latestRef.current),
      createdAt: Date.now(),
      ...data,
    };
  }, []);

  const addNote = useCallback((text: string) => {
    mutate((b) => addItem(b, newCard('note', { text }, 240, 170)));
  }, [mutate, newCard]);

  const addMessage = useCallback((text: string, author: string) => {
    mutate((b) => addItem(b, newCard('message', { text, author }, 260, 150)));
  }, [mutate, newCard]);

  /**
   * Фото уходит на сервер сразу и только потом появляется карточкой.
   *
   * Порядок именно такой: если сначала показать карточку, а потом грузить,
   * то при неудаче на пробке осталась бы пустая рамка без файла за ней.
   */
  const addPhoto = useCallback(async (file: File) => {
    if (!chatId || !canEditRef.current) return;
    const res = await protoBoardApi.uploadPhoto(chatId, file);
    const photoUrl: string = res.data.photoUrl;
    // Размеры под пропорции снимка, иначе фото растянется.
    const aspect = await new Promise<number>((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img.naturalWidth / (img.naturalHeight || 1)); };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(1); };
      img.src = url;
    });
    const w = 220;
    const h = Math.round(w / (aspect || 1)) + 34;
    mutate((b) => addItem(b, newCard('photo', { photoUrl, caption: file.name.replace(/\.[^.]+$/, '') }, w, h)));
  }, [chatId, mutate, newCard]);

  const move = useCallback((id: string, x: number, y: number) => {
    mutate((b) => updateItem(b, id, { x, y }));
  }, [mutate]);

  const scale = useCallback((id: string, factor: number) => {
    mutate((b) => scaleItem(b, id, factor));
  }, [mutate]);

  const rotate = useCallback((id: string, delta: number) => {
    mutate((b) => rotateItem(b, id, delta));
  }, [mutate]);

  const patch = useCallback((id: string, p: Partial<DeskItem>) => {
    mutate((b) => updateItem(b, id, p));
  }, [mutate]);

  const setAlarm = useCallback((id: string, at: number | null) => {
    mutate((b) => setItemAlarm(b, id, at));
  }, [mutate]);

  const replacePhoto = useCallback(async (id: string, file: File) => {
    if (!chatId || !canEditRef.current || !latestRef.current.items.some((i) => i.id === id && i.kind === 'photo')) return;
    const res = await protoBoardApi.uploadPhoto(chatId, file);
    mutate((b) => b.items.some((i) => i.id === id && i.kind === 'photo')
      ? updateItem(b, id, { photoUrl: String(res.data.photoUrl || '') }) : b);
  }, [chatId, mutate]);

  // Файл фото сносит сервер сам, когда карточка исчезла из доски при записи.
  // Убирать его отсюда нельзя: пока карточка на месте, фото ещё нужен.
  const drop = useCallback((id: string) => {
    mutate((b) => removeItem(b, id));
  }, [mutate]);

  const link = useCallback((from: string, to: string, color: string) => {
    mutate((b) => addThread(b, from, to, color));
  }, [mutate]);

  const unlink = useCallback((id: string) => mutate((b) => removeThread(b, id)), [mutate]);

  const focus = useCallback((id: string) => mutate((b) => bringToFront(b, id)), [mutate]);

  /** Новая папка под содержимое. Название можно поменять позже. */
  const addFolder = useCallback((name?: string) => {
    const size = defaultSize('folder');
    const folder = newCard('folder', { text: (name || '').trim() || 'Папка' }, size.w, size.h);
    mutate((b) => addItem(b, folder));
    return folder.id;
  }, [mutate, newCard]);

  const moveFolderTo = useCallback((id: string, x: number, y: number) => {
    mutate((b) => moveFolder(b, id, x, y));
  }, [mutate]);

  /** Отпускание карточки: проверяем папку именно в этот момент, а не на лету. */
  const dropCard = useCallback((id: string, x: number, y: number) => {
    mutate((b) => dropItem(b, id, x, y));
  }, [mutate]);

  const resize = useCallback((dw: number, dh: number) => {
    mutate((b) => resizeBoard(b, dw, dh));
  }, [mutate]);

  /** Права: после выдачи перечитываем доску, чтобы состав в панели был верным. */
  const grant = useCallback(async (userId: string, level: 'viewer' | 'editor') => {
    if (!chatId) return;
    await protoBoardApi.grant(chatId, userId, level);
    await load();
  }, [chatId, load]);

  const setLevel = useCallback(async (userId: string, level: 'viewer' | 'editor') => {
    if (!chatId) return;
    await protoBoardApi.setLevel(chatId, userId, level);
    await load();
  }, [chatId, load]);

  const revoke = useCallback(async (userId: string) => {
    if (!chatId) return;
    await protoBoardApi.revoke(chatId, userId);
    await load();
  }, [chatId, load]);

  const reload = useCallback(() => load(), [load]);

  /**
   * Доска общая, поэтому меняет её не только владелец с этой вкладки.
   * Без подписки на сокет второй участник увидел бы правки только после F5 —
   * а в нашей переписке он сидит на другом устройстве.
   */
  useEffect(() => {
    let alive = true;
    const s = getSocket();
    // Сокет может быть ещё не подключён: тогда доска обновится при следующем
    // открытии, но подписываться в пустоту бессмысленно.
    if (!s) return;
    const onUpdate = (p: { chatId?: string } | null) => {
      if (!alive) return;
      if (p?.chatId && p.chatId !== chatId) return;
      void load();
    };
    s.on('proto-board:updated', onUpdate);
    // Права могли отобрать у нас: тогда доска недоступна и её надо перечитать.
    s.on('proto-board:access', onUpdate);
    return () => {
      alive = false;
      s.off('proto-board:updated', onUpdate);
      s.off('proto-board:access', onUpdate);
    };
  }, [chatId, load]);

  return {
    board, rights, ready, error,
    addNote, addMessage, addPhoto, move, scale, rotate, patch, setAlarm, replacePhoto, drop, link, unlink, focus,
    addFolder, moveFolderTo, dropCard, resize,
    grant, setLevel, revoke, reload,
  };
}