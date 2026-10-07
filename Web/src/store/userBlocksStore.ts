import { create } from 'zustand';
import { blocksApi, type BlockedUser } from '../services/api';

/**
 * Личные блокировки пользователей.
 *
 * Хранятся в одном сторе, потому что состояние нужно сразу двум экранам:
 * панели информации о чате (кнопка «Заблокировать») и строке ввода, которая у
 * заблокировавшего заменяется на «Разблокировать». Если бы каждый грузил свой
 * список, они бы расходились и кнопки показывали бы разное.
 *
 * Блокировка односторонняя: заблокированный может заблокировать в ответ, это
 * отдельная запись. Проверка «меня заблокировали» живёт отдельно (listBy),
 * потому что её видит уже другой человек.
 */
interface UserBlocksState {
  blockedIds: string[];
  blockedByIds: string[];
  loaded: boolean;
  load: () => Promise<void>;
  block: (userId: string) => Promise<void>;
  unblock: (userId: string) => Promise<void>;
  isBlocked: (userId: string) => boolean;
  isBlockedBy: (userId: string) => boolean;
  /** Есть ли у меня хоть одна блокировка — от этого зависит кнопка апелляции. */
  hasAnyBlock: () => boolean;
}

const ids = (list: BlockedUser[], key: 'blocked' | 'blocker') =>
  (list || [])
    .map((item) => item?.[key]?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

export const useUserBlocksStore = create<UserBlocksState>((set, get) => ({
  blockedIds: [],
  blockedByIds: [],
  loaded: false,

  load: async () => {
    try {
      const [mine, by] = await Promise.all([blocksApi.list(), blocksApi.listBy()]);
      set({ blockedIds: ids(mine.data, 'blocked'), blockedByIds: ids(by.data, 'blocked'), loaded: true });
    } catch {
      // Не авторизованы или сеть недоступна — пустые списки, чат работает как раньше.
      set({ loaded: true });
    }
  },

  block: async (userId) => {
    await blocksApi.block(userId);
    // Обновляем локально по ответу, не дожидаясь перезагрузки списка: кнопка
    // должна переключиться мгновенно, иначе она «мигает» второе нажатие.
    set((s) => ({ blockedIds: s.blockedIds.includes(userId) ? s.blockedIds : [...s.blockedIds, userId] }));
  },

  unblock: async (userId) => {
    await blocksApi.unblock(userId);
    set((s) => ({ blockedIds: s.blockedIds.filter((id) => id !== userId) }));
  },

  isBlocked: (userId) => get().blockedIds.includes(userId),
  isBlockedBy: (userId) => get().blockedByIds.includes(userId),
  hasAnyBlock: () => get().blockedByIds.length > 0,
}));
