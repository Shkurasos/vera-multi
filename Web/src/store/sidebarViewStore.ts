import { create } from 'zustand';

/**
 * Показан ли архивный список чатов.
 *
 * Режим включается кнопкой «Архив», которая есть и в нижней панели сайдбара
 * на ПК, и в нижней навигации на телефоне. Это два разных компонента, поэтому
 * состояние вынесено в отдельный стор — иначе кнопка на телефоне не знала бы,
 * что список уже переключён.
 *
 * Намеренно без persist: это временный режим просмотра, а не настройка.
 */
interface SidebarViewState {
  archiveView: boolean;
  setArchiveView: (value: boolean) => void;
  toggleArchiveView: () => void;
}

export const useSidebarViewStore = create<SidebarViewState>()((set) => ({
  archiveView: false,
  setArchiveView: (value) => set({ archiveView: value }),
  toggleArchiveView: () => set((s) => ({ archiveView: !s.archiveView })),
}));