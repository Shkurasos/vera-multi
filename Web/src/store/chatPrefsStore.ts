import { create } from 'zustand';
import { clampBubble } from '../utils/bubbleSettings';
import { persist } from 'zustand/middleware';
import { Message } from '../types';
import { enableStoreSync } from '../services/storeSyncSimple';

interface ChatPrefsState {
  clearBubbleSettings: (chatId: string) => void;
  bubbleSettings: Record<string, { enabled?: boolean; maxWidth?: number; textSize?: number; padding?: number }>;
  // Arrays for JSON serialization
  pinnedIds: string[];
  archivedIds: string[];
  mutedIds: string[];
  // pinnedMessages per chat: chatId -> Message | null
  pinnedMessages: Record<string, Message | null>;

  togglePin: (chatId: string) => void;
  toggleArchive: (chatId: string) => void;
  toggleMute: (chatId: string) => void;
  setPinnedMessage: (chatId: string, message: Message | null) => void;
  setBubbleSettings: (chatId: string, settings: ChatPrefsState['bubbleSettings'][string]) => void;

  isPinned: (chatId: string) => boolean;
  isArchived: (chatId: string) => boolean;
  isMuted: (chatId: string) => boolean;
}

export const useChatPrefsStore = create<ChatPrefsState>()(
  persist(
    (set, get) => ({
      pinnedIds: [],
      archivedIds: [],
      mutedIds: [],
      pinnedMessages: {},
      bubbleSettings: {},
      clearBubbleSettings: (chatId) => set(s => {
        const bubbleSettings = { ...s.bubbleSettings };
        delete bubbleSettings[chatId];
        return { bubbleSettings };
      }),

      isPinned: (chatId) => get().pinnedIds.includes(chatId),
      isArchived: (chatId) => get().archivedIds.includes(chatId),
      isMuted: (chatId) => get().mutedIds.includes(chatId),

      togglePin: (chatId) => set((s) => ({
        pinnedIds: s.pinnedIds.includes(chatId)
          ? s.pinnedIds.filter(id => id !== chatId)
          : [...s.pinnedIds, chatId],
      })),

      toggleArchive: (chatId) => set((s) => ({
        archivedIds: s.archivedIds.includes(chatId)
          ? s.archivedIds.filter(id => id !== chatId)
          : [...s.archivedIds, chatId],
      })),

      toggleMute: (chatId) => set((s) => ({
        mutedIds: s.mutedIds.includes(chatId)
          ? s.mutedIds.filter(id => id !== chatId)
          : [...s.mutedIds, chatId],
      })),

      setPinnedMessage: (chatId, message) => set((s) => ({
        pinnedMessages: { ...s.pinnedMessages, [chatId]: message },
      })),
      setBubbleSettings: (chatId, settings) => set((s) => ({
        bubbleSettings: { ...s.bubbleSettings, [chatId]: { ...s.bubbleSettings[chatId], ...settings,
          ...(settings.maxWidth !== undefined ? { maxWidth: clampBubble('maxWidth', settings.maxWidth) } : {}),
          ...(settings.textSize !== undefined ? { textSize: clampBubble('textSize', settings.textSize) } : {}),
          ...(settings.padding !== undefined ? { padding: clampBubble('padding', settings.padding) } : {}),
        } },
      })),
    }),
    { name: 'vera-chat-prefs' }
  )
);

// Подключаем синхронизацию между устройствами
if (typeof window !== 'undefined') {
  enableStoreSync('chat-prefs', useChatPrefsStore);
}
