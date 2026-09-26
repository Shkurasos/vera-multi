import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { enableStoreSync } from '../services/storeSyncSimple';

/**
 * «Мои скины» для отдельных чатов (инфопанель → «Мои скины в этом чате»).
 *
 * Значение слота — id предмета из SHOP_CATALOG:
 *   ключа нет   — как в профиле (глобально надетый скин);
 *   ''          — «без скина» именно в этом чате;
 *   'bubble-…'  — конкретный свой скин.
 *
 * Применяются ТОЛЬКО к моим собственным сообщениям этого чата
 * (см. MessageBubble) и синхронизируются между моими устройствами.
 */

export type ChatSkinSlot = 'ring' | 'selfcard' | 'bubble';

export interface ChatSkinOverride {
  ring?: string;
  selfcard?: string;
  bubble?: string;
}

interface ChatSkinState {
  overrides: Record<string, ChatSkinOverride>;
  /** Задать скин слота; undefined — вернуть «как в профиле». */
  setChatSkin: (chatId: string, slot: ChatSkinSlot, value: string | undefined) => void;
  /** Убрать все переопределения чата. */
  clearChatSkins: (chatId: string) => void;
  getOverride: (chatId: string) => ChatSkinOverride | undefined;
  /** id скина для слота с учётом переопределения (fallback — глобальный). */
  getSkinId: (chatId: string, slot: ChatSkinSlot, fallback: string) => string;
}

export const useChatSkinStore = create<ChatSkinState>()(
  persist(
    (set, get) => ({
      overrides: {},
      setChatSkin: (chatId, slot, value) => set((s) => {
        const current: ChatSkinOverride = { ...(s.overrides[chatId] || {}) };
        if (value === undefined) delete current[slot];
        else current[slot] = value;
        const overrides = { ...s.overrides };
        if (Object.keys(current).length) overrides[chatId] = current;
        else delete overrides[chatId];
        return { overrides };
      }),
      clearChatSkins: (chatId) => set((s) => {
        if (!s.overrides[chatId]) return s;
        const overrides = { ...s.overrides };
        delete overrides[chatId];
        return { overrides };
      }),
      getOverride: (chatId) => get().overrides[chatId],
      getSkinId: (chatId, slot, fallback) => {
        const override = get().overrides[chatId];
        if (override && slot in override) return override[slot] as string;
        return fallback;
      },
    }),
    { name: 'vera-chat-skins', version: 1 },
  ),
);

// Синхронизация «моих скинов» между устройствами одной учётной записи.
if (typeof window !== 'undefined') {
  enableStoreSync('chat-skins', useChatSkinStore);
}
