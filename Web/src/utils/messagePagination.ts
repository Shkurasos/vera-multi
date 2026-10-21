/**
 * Пагинация истории чата вверх: чистые функции без React/DOM, чтобы их можно
 * было проверить в node-тестах.
 *
 * Схема: в DOM рендерится окно последних N сообщений. Когда до верха ленты
 * остаётся ~PREFETCH_AHEAD_MESSAGES сообщений, окно расширяется на
 * RENDER_STEP; когда локальные сообщения кончились — догружается страница
 * с сервера (`GET /messages/:chatId?before=&limit=`).
 */

/** Размер страницы, запрашиваемой у сервера при прокрутке вверх. */
export const OLDER_PAGE_SIZE = 80;

/** За сколько сообщений до верха начинаем догрузку (требование: 20–30). */
export const PREFETCH_AHEAD_MESSAGES = 25;

/** На сколько сообщений расширяется окно рендера за один шаг. */
export const RENDER_STEP = 50;

/** Пока высоты не измерены — средняя высота сообщения, px. */
const FALLBACK_MESSAGE_HEIGHT = 64;
const MIN_THRESHOLD_PX = 600;
const MAX_THRESHOLD_PX = 6000;

/**
 * Порог (px от верха контента), ниже которого начинаем догрузку.
 * Высота считается по средней высоте уже отрисованных сообщений, чтобы
 * «25 сообщений» значили одно и то же и в чате с текстом, и в чате с фото.
 */
export function prefetchThresholdPx(
  scrollHeight: number,
  renderedCount: number,
  aheadMessages: number = PREFETCH_AHEAD_MESSAGES,
): number {
  const avg = renderedCount > 0 && scrollHeight > 0
    ? scrollHeight / renderedCount
    : FALLBACK_MESSAGE_HEIGHT;
  return Math.min(MAX_THRESHOLD_PX, Math.max(MIN_THRESHOLD_PX, Math.round(avg * aheadMessages)));
}

/** Нужно ли догружать: пользователь ближе порога к верху. */
export function shouldPrefetchOlder(scrollTop: number, thresholdPx: number): boolean {
  return scrollTop <= thresholdPx;
}

/**
 * Курсор `before` для следующей страницы: createdAt самого раннего
 * подтверждённого сообщения. Локальные заглушки (`temp-*`) пропускаем —
 * их время клиентское и может обогнать серверное.
 */
export function oldestCursor(messages: ReadonlyArray<{ id: string; createdAt?: string }>): string | undefined {
  for (const m of messages) {
    if (!m || !m.createdAt || String(m.id).startsWith('temp-')) continue;
    return m.createdAt;
  }
  return undefined;
}

/** Следующий размер окна рендера при шаге вверх (не больше всей истории). */
export function nextRenderLimit(current: number, total: number, step: number = RENDER_STEP): number {
  return Math.min(total, current + step);
}

/**
 * Компенсация prepend: якорный элемент (первое отрисованное сообщение)
 * сдвинулся вниз в контенте на (newAbsTop − oldAbsTop) — на столько же
 * сдвигаем scrollTop, и картинка на экране не меняется.
 */
export function compensatedScrollTop(currentScrollTop: number, oldAbsTop: number, newAbsTop: number): number {
  return currentScrollTop + (newAbsTop - oldAbsTop);
}
