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
  firstName: string;
  lastName: string;
  username: string;
  bio: string;
  birthDate: string;
  country: string;
  region: string;
  city: string;
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
    { name: 'vera-profile-draft' }
  )
);

// Подключаем синхронизацию между устройствами
if (typeof window !== 'undefined') {
  enableStoreSync('profileDraft', useProfileDraftStore);
}