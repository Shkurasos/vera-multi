import { create } from 'zustand';

/**
 * Доступно ли обновление веб-клиента.
 *
 * available  — сервер раздаёт сборку с другим buildId;
 * remoteId   — buildId этой сборки;
 * dismissed  — пользователь нажал «Позже»: всплывашка скрыта, а пункт
 *              «Доступно обновление» остаётся в настройках до перезагрузки.
 *
 * Без persist: после перезагрузки клиент уже новый, и флаг не нужен.
 * Если позже выйдет ещё одна сборка (другой remoteId), всплывашка
 * покажется снова.
 */
interface UpdateState {
  available: boolean;
  remoteId: string | null;
  dismissed: boolean;
  markAvailable: (remoteId: string) => void;
  dismiss: () => void;
}

/** Новая ли сборка на сервере. Пустые id и dev-сборка обновлений не ждут. */
export function isNewBuild(localId: string | null | undefined, remoteId: string | null | undefined): boolean {
  if (!localId || !remoteId || localId === 'dev') return false;
  return localId !== remoteId;
}

export const useUpdateStore = create<UpdateState>()((set) => ({
  available: false,
  remoteId: null,
  dismissed: false,
  markAvailable: (remoteId) => set((s) => (
    s.available && s.remoteId === remoteId
      ? s
      : { available: true, remoteId, dismissed: false }
  )),
  dismiss: () => set((s) => (s.available ? { dismissed: true } : s)),
}));
