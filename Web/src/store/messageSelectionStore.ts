import { create } from 'zustand';

/**
 * Режим выделения сообщений (как в Telegram).
 *
 * Отдельный микро-стор по тому же принципу, что и messageHoverStore: каждый
 * пузырь читает булев селектор «выделен ли я», поэтому клик по одному
 * сообщению перерисовывает ровно один пузырь, а не всю ленту.
 */
interface MessageSelectionState {
  /** Чат, в котором включён режим; null — режим выключен. */
  chatId: string | null;
  /** Выделенные id (объект вместо массива — проверка за O(1) в селекторах). */
  ids: Record<string, true>;
  /** Порядок выделения не важен, но счётчик нужен панели действий. */
  count: number;
  start: (chatId: string, messageId: string) => void;
  toggle: (messageId: string) => void;
  clear: () => void;
}

export const useMessageSelectionStore = create<MessageSelectionState>((set, get) => ({
  chatId: null,
  ids: {},
  count: 0,
  start: (chatId, messageId) => set({ chatId, ids: { [messageId]: true }, count: 1 }),
  toggle: (messageId) => {
    const { chatId, ids } = get();
    if (!chatId) return;
    const next = { ...ids };
    if (next[messageId]) delete next[messageId];
    else next[messageId] = true;
    const count = Object.keys(next).length;
    // Сняли последнюю галочку — выходим из режима, как в Telegram.
    if (count === 0) set({ chatId: null, ids: {}, count: 0 });
    else set({ ids: next, count });
  },
  clear: () => {
    if (get().chatId !== null || get().count) set({ chatId: null, ids: {}, count: 0 });
  },
}));
