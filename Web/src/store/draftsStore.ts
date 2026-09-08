import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { enableStoreSync } from '../services/storeSyncSimple';

interface DraftsState {
  drafts: Record<string, string>; // chatId -> draft text
  setDraft: (chatId: string, text: string) => void;
  getDraft: (chatId: string) => string;
  clearDraft: (chatId: string) => void;
}

export const useDraftsStore = create<DraftsState>()(
  persist(
    (set, get) => ({
      drafts: {},
      
      setDraft: (chatId, text) => {
        const trimmed = text.trim();
        if (!trimmed) {
          // Если текст пустой, удаляем черновик
          set((s) => {
            const { [chatId]: _, ...rest } = s.drafts;
            return { drafts: rest };
          });
        } else {
          set((s) => ({ drafts: { ...s.drafts, [chatId]: text } }));
        }
      },
      
      getDraft: (chatId) => get().drafts[chatId] || '',
      
      clearDraft: (chatId) => {
        set((s) => {
          const { [chatId]: _, ...rest } = s.drafts;
          return { drafts: rest };
        });
      },
    }),
    { name: 'vera-drafts' }
  )
);

// Подключаем синхронизацию между устройствами
if (typeof window !== 'undefined') {
  enableStoreSync('drafts', useDraftsStore);
}
