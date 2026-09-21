// Outbox — очередь исходящих сообщений на случай оффлайна.
// Хранится в localStorage (persist) чтобы пережить перезагрузку.
// Каждое сообщение имеет status: 'pending' | 'sending' | 'failed'.
// При появлении сети или через интервал flushOutbox() пытается отправить
// сообщения по одному через messagesApi.send. При успехе кладёт реальное
// сообщение в chatStore и удаляет запись из очереди.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { messagesApi } from '../services/api';
import { useChatStore } from './chatStore';
import { useAuthStore } from './authStore';
import type { Message } from '../types';
import { registerAccountStore } from '../services/storeSyncSimple';
import { saveArchivedMessages } from '../services/localArchive';

export interface OutboxItem {
  clientTempId: string;
  chatId: string;
  content: string;
  replyToId?: string;
  createdAt: string;
  status: 'pending' | 'sending' | 'failed';
  attempts: number;
  lastError?: string;
}

interface OutboxState {
  items: OutboxItem[];
  isOnline: boolean;
  enqueue: (item: Omit<OutboxItem, 'status' | 'attempts' | 'createdAt'> & { createdAt?: string }) => void;
  remove: (clientTempId: string) => void;
  markFailed: (clientTempId: string, err: string) => void;
  setOnline: (online: boolean) => void;
  flush: () => Promise<void>;
}

export const useOutboxStore = create<OutboxState>()(
  persist(
    (set, get) => ({
      items: [],
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,

      enqueue: (item) => {
        const full: OutboxItem = {
          clientTempId: item.clientTempId,
          chatId: item.chatId,
          content: item.content,
          replyToId: item.replyToId,
          createdAt: item.createdAt || new Date().toISOString(),
          status: 'pending',
          attempts: 0,
        };
        set((s) => ({ items: [...s.items.filter(i => i.clientTempId !== full.clientTempId), full] }));
        // Пытаемся отправить сразу — если сеть есть, улетит мгновенно.
        void get().flush();
      },

      remove: (clientTempId) => {
        set((s) => ({ items: s.items.filter((i) => i.clientTempId !== clientTempId) }));
      },

      markFailed: (clientTempId, err) => {
        set((s) => ({
          items: s.items.map((i) =>
            i.clientTempId === clientTempId
              ? { ...i, status: 'failed', lastError: err, attempts: i.attempts + 1 }
              : i,
          ),
        }));
      },

      setOnline: (online) => {
        set({ isOnline: online });
        if (online) void get().flush();
      },

      flush: async () => {
        const { items } = get();
        if (!items.length) return;
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        // Отправляем по одному в порядке очереди.
        for (const item of items) {
          const current = get().items.find(i => i.clientTempId === item.clientTempId);
          if (!current || current.status === 'sending') continue;
          set((s) => ({
            items: s.items.map((i) =>
              i.clientTempId === item.clientTempId ? { ...i, status: 'sending' } : i,
            ),
          }));
          try {
            const res = await messagesApi.send(item.chatId, {
              text: item.content,
              replyToId: item.replyToId,
              clientTempId: item.clientTempId,
            } as any);
            const saved: Message | undefined = res?.data;
            if (!saved?.id) throw new Error('Нет подтверждения сохранения');
            await saveArchivedMessages([saved]);
            // Заменяем pending-заглушку в chatStore на реальное сообщение.
            useChatStore.setState((state) => {
              const list = state.messages[item.chatId] || [];
              const filtered = list.filter((m) => m.id !== item.clientTempId && m.id !== saved.id);
              const withReal = saved
                ? [...filtered, saved]
                : filtered;
              return { messages: { ...state.messages, [item.chatId]: withReal } };
            });
            // Убираем из outbox.
            set((s) => ({ items: s.items.filter((i) => i.clientTempId !== item.clientTempId) }));
          } catch (e: any) {
            const msg = e?.response?.data?.message || e?.message || 'network error';
            get().markFailed(item.clientTempId, msg);
            // При сетевой ошибке — прекращаем цикл, попробуем позже.
            break;
          }
        }
      },
    }),
    { name: 'vera_outbox',
      onRehydrateStorage: () => state => {
        if (state) state.items = state.items.map(item => ({ ...item, status: 'pending' }));
      },
    },
  ),
);

registerAccountStore('outbox', useOutboxStore);

// ─── Автозапуск: слушаем online/offline + периодический ретрай ─────────────
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => useOutboxStore.getState().setOnline(true));
  window.addEventListener('offline', () => useOutboxStore.getState().setOnline(false));
  // Ретрай раз в 15 секунд для случая когда сервер недоступен, а сеть есть.
  setInterval(() => {
    const user = useAuthStore.getState().user;
    if (!user) return;
    void useOutboxStore.getState().flush();
  }, 15000);
}