/* ─── Офлайн-сессия ─────────────────────────────────────────────────────────
 * navigator.onLine не видит, что сервер недоступен при живом Wi-Fi (нет
 * интернета, сервер выключен). Поэтому authStore, не дозвавшись сервера,
 * выставляет флаг сам, а API, сторы и плеер читают его отсюда.
 */

let serverUnreachable = false;

export function setAppOffline(value: boolean): void {
  serverUnreachable = value;
}

/** Без сети или сервер не отвечает — работаем с локальными данными. */
export function isAppOffline(): boolean {
  return serverUnreachable || (typeof navigator !== 'undefined' && navigator.onLine === false);
}
