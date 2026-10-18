/**
 * Будильники карточек доски.
 *
 * Раз в секунду смотрим, у каких карточек время будильника уже наступило, и
 * «звоним»: повторяющийся звук + системное уведомление. Звонок длится, пока
 * пользователь не нажмёт «Выключить».
 *
 * Выключенные срабатывания помним в localStorage по ключу «id@время»: у
 * зрителя нет права снять alarmAt с доски, и без этой отметки будильник
 * звенел бы ему после каждой перезагрузки страницы.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { alarmKey, dueAlarms, type DeskBoard, type DeskItem } from '../utils/deskBoard';
import { playDefaultChime } from '../utils/notificationSound';
import { showAlarmNotification } from '../services/notifications';

const STORAGE_KEY = 'vera-desk-alarms-dismissed';
/** Сколько отметок держим: старые срабатывания больше не нужны. */
const MAX_DISMISSED = 200;
const CHECK_MS = 1000;
const RING_MS = 1300;

function loadDismissed(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.filter((v) => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveDismissed(set: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set).slice(-MAX_DISMISSED)));
  } catch { /* приватный режим / переполнение — просто не запомним */ }
}

/** Короткое описание карточки для уведомления. */
export function alarmLabel(item: DeskItem): string {
  const text = (item.kind === 'photo' ? item.caption : item.text) || '';
  const short = text.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (short) return short;
  return item.kind === 'photo' ? 'Фото на доске' : item.kind === 'message' ? 'Сообщение на доске' : 'Заметка на доске';
}

export function useDeskAlarms(
  board: DeskBoard,
  opts: { chatId?: string; chatName?: string; canEdit: boolean; clearAlarm: (id: string) => void },
) {
  const [ringing, setRinging] = useState<DeskItem | null>(null);
  const dismissedRef = useRef<Set<string>>(loadDismissed());
  const boardRef = useRef(board);
  boardRef.current = board;
  const notifiedRef = useRef<Notification | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Проверка наступивших будильников.
  useEffect(() => {
    const check = () => {
      if (ringing) return;
      const due = dueAlarms(boardRef.current, Date.now(), dismissedRef.current)[0];
      if (!due) return;
      setRinging(due);
      notifiedRef.current?.close();
      notifiedRef.current = showAlarmNotification({
        title: `⏰ ${optsRef.current.chatName || 'Доска'}`,
        body: alarmLabel(due),
        chatId: optsRef.current.chatId,
      });
    };
    check();
    const timer = window.setInterval(check, CHECK_MS);
    return () => window.clearInterval(timer);
  }, [ringing]);

  // Звук звонка, пока будильник не выключен.
  useEffect(() => {
    if (!ringing) return;
    playDefaultChime(1);
    const timer = window.setInterval(() => playDefaultChime(1), RING_MS);
    return () => window.clearInterval(timer);
  }, [ringing]);

  // Карточку удалили или будильник переставили, пока он звенел — замолкаем.
  useEffect(() => {
    if (!ringing) return;
    const current = board.items.find((i) => i.id === ringing.id);
    if (!current || current.alarmAt !== ringing.alarmAt) {
      notifiedRef.current?.close();
      notifiedRef.current = null;
      setRinging(null);
    }
  }, [board, ringing]);

  useEffect(() => () => { notifiedRef.current?.close(); }, []);

  const dismiss = useCallback(() => {
    if (!ringing) return;
    dismissedRef.current.add(alarmKey(ringing));
    saveDismissed(dismissedRef.current);
    notifiedRef.current?.close();
    notifiedRef.current = null;
    // Редактор снимает будильник с доски, чтобы значок исчез у всех.
    if (optsRef.current.canEdit) optsRef.current.clearAlarm(ringing.id);
    setRinging(null);
  }, [ringing]);

  return { ringing, dismiss };
}
