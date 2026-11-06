import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { enableStoreSync } from '../services/storeSyncSimple';

/**
 * Черновик редактора профиля.
 *
 * Поведение:
 * - При первом заходе в профиль (без черновика) — всегда стандартный вид.

 * - Режим редактирования включается только по кнопке («Редактировать»)/?edit=1..
 * - Если пользователь обновил страницу в редакторе или случайно вышел—
 *   при повторном заходе режим редактирования восстанавливается вместе со всем,
 *   что было напечатано (как черновики сообщений в чатах).
 * - После успешного сохранения или намеренной отмены черновик очищается.

 * Черновик хранится только когда форма отличается от данных профиля,
 * чтобы «первый заход» всегда показывал стандартный вид..
 */
export interface ProfileDraftForm {
  username: string;
  bio: string;
}

interface ProfileDraftState {
  draft: { form: ProfileDraftForm; ts: number } | null;
  saveDraft: (form: ProfileDraftForm) => void;
  clearDraft: () => void;
}

export const useProfileDraftStore = create<ProfileDraftState>()(
  persist(
    (set) => ({
      draft: null,
      saveDraft: (form) => set({ draft: { form, ts: Date.now() } }),
      clearDraft: () => set({ draft: null }),
    }),
    { name: 'vera-profile-draft', version: 1,
      // v0 хранил ФИО, дату рождения и местоположение. Оставляем только ник и описание.
      migrate: (persisted: any) => {
        const form = persisted?.draft?.form;
        if (!form) return { draft: null } as any;
        return { draft: { form: { username: String(form.username || ''), bio: String(form.bio || '') }, ts: persisted.draft.ts || Date.now() } } as any;
      },
    }
  )
);

// Подключаем синхронизацию между устройствами
if (typeof window !== 'undefined') {
  enableStoreSync('profileDraft', useProfileDraftStore);
}