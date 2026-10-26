import { isNewBuild, useUpdateStore } from '../store/updateStore';

// Подставляется Vite (define в vite.config.ts): id сборки или 'dev'.
declare const __VERA_BUILD_ID__: string;

export const LOCAL_BUILD_ID: string = typeof __VERA_BUILD_ID__ === 'string' ? __VERA_BUILD_ID__ : 'dev';

const POLL_MS = 5 * 60 * 1000;
// Не дёргаем сервер чаще раза в минуту при частом переключении вкладок.
const MIN_GAP_MS = 60 * 1000;

let lastCheck = 0;

/**
 * Спрашивает у сервера buildId раздаваемого клиента и отмечает обновление
 * в сторе. Ошибки сети молча игнорируются — проверка повторится позже.
 * Возвращает true, если обновление найдено.
 */
export async function checkForUpdate(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (LOCAL_BUILD_ID === 'dev') return false;
  lastCheck = Date.now();
  try {
    const res = await fetchImpl('/api/client-version', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return false;
    const data = await res.json();
    const remoteId = typeof data?.buildId === 'string' ? data.buildId : null;
    if (!isNewBuild(LOCAL_BUILD_ID, remoteId)) return false;
    useUpdateStore.getState().markAvailable(remoteId as string);
    return true;
  } catch {
    return false;
  }
}

/** Периодическая проверка + при возврате во вкладку и восстановлении сети. */
export function startUpdatePolling(): () => void {
  if (LOCAL_BUILD_ID === 'dev') return () => {};
  const maybeCheck = () => {
    if (document.visibilityState === 'hidden') return;
    if (Date.now() - lastCheck < MIN_GAP_MS) return;
    void checkForUpdate();
  };
  const timer = window.setInterval(maybeCheck, POLL_MS);
  document.addEventListener('visibilitychange', maybeCheck);
  window.addEventListener('online', maybeCheck);
  void checkForUpdate();
  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', maybeCheck);
    window.removeEventListener('online', maybeCheck);
  };
}

/**
 * Применить обновление. UI и на ПК (Electron), и на Android грузится с
 * сервера, поэтому достаточно перезагрузить страницу: index.html отдаётся
 * с no-cache и тянет новые хешированные ассеты.
 */
export function applyUpdate(): void {
  window.location.reload();
}
