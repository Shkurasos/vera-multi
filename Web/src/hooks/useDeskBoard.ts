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
  nextZ, removeItem, removeThread, resizeBoard, rotateItem, scaleItem, updateItem,
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
  const [board, setBoard] = useState<DeskBoard>(emptyBoard);
  const [rights, setRights] = useState<DeskRights>(NO_RIGHTS);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  // Актуальная доска для записи: замыкание таймера не должно видеть старый
  // стейт, иначе последнее движение мыши потерялось бы при сохранении.
  const latestRef = useRef<DeskBoard>(board);
  // Право редактирования в ref: расписание записи читает его на отправке, и
  // к тому моменту оно должно быть актуальным, а не захваченным в замыкании.
  const canEditRef = useRef(false);

  const apply = useCallback((next: DeskBoard) => {
    latestRef.current = next;
    setBoard(next);
  }, []);

  const load = useCallback(async () => {
    if (!chatId) { setReady(true); return; }
    try {
      const res = await protoBoardApi.get(chatId);
      const data = res.data;
      // Размер приходит с сервера и может отсутствовать у доски, созданной до
      // появления этой настройки, — тогда берём размер по умолчанию.
      const size = boardSize(data.width, data.height);
      apply({
        items: data.items || [],
        threads: data.threads || [],
        updatedAt: data.updatedAt || 0,
        width: size.width,
        height: size.height,
      });
      setRights({
        myLevel: data.myLevel ?? null,
        canEdit: !!data.canEdit,
        canManage: !!data.canManage,
        members: data.members || [],
      });
      canEditRef.current = !!data.canEdit;
      setError(null);
    } catch (e: any) {
      const status = e?.response?.status;
      setError(status === 403 ? 'Вам не открыта эта доска' : (e?.response?.data?.message || 'Не удалось загрузить доску'));
      setRights(NO_RIGHTS);
      canEditRef.current = false;
    } finally {
      setReady(true);
    }
  }, [chatId, apply]);

  // Загрузка при смене чата. Отменяем прошлую загрузку: при быстром
  // переключении ответ старого чата не должен перетереть новый.
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    apply(emptyBoard());
    void (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [chatId, apply, load]);

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
    addNote, addMessage, addPhoto, move, scale, rotate, patch, replacePhoto, drop, link, unlink, focus,
    addFolder, moveFolderTo, dropCard, resize,
    grant, setLevel, revoke, reload,
  };
}