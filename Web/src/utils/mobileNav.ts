/**
 * Порядок кнопок нижней навигации на телефоне.
 *
 * Пользователь меняет его, зажимая кнопку и ведя пальцем. Здесь только
 * чистые функции без React и стора, чтобы их можно было проверить тестом.
 */
export const NAV_KEYS = ['editor', 'profile', 'music', 'archive'] as const;
export type NavKey = typeof NAV_KEYS[number];

/** Порядок по умолчанию: 1 — редактор, 2 — профиль, 3 — музыка, 4 — архив. */
export const DEFAULT_NAV_ORDER: NavKey[] = [...NAV_KEYS];

/** На ПК (нижняя панель сайдбара) исторически: профиль, музыка, редактор, архив. */
export const DEFAULT_DESKTOP_NAV_ORDER: NavKey[] = ['profile', 'music', 'editor', 'archive'];

export const isNavKey = (v: unknown): v is NavKey =>
  typeof v === 'string' && (NAV_KEYS as readonly string[]).includes(v);

/**
 * Приводит сохранённый порядок к корректному: выкидывает мусор и дубли,
 * дописывает недостающие кнопки в конец (например, если в новой версии
 * появилась кнопка, которой не было в localStorage).
 */
export function normalizeNavOrder(raw: unknown, fallback: readonly NavKey[] = NAV_KEYS): NavKey[] {
  const out: NavKey[] = [];
  if (Array.isArray(raw)) {
    for (const k of raw) if (isNavKey(k) && !out.includes(k)) out.push(k);
  }
  // Недостающие дописываются в порядке по умолчанию для этой панели.
  for (const k of [...fallback, ...NAV_KEYS]) if (!out.includes(k)) out.push(k);
  return out;
}

/**
 * Переносит кнопку `key` на место кнопки `target`; остальные сдвигаются.
 * При перетаскивании на соседа это и есть обмен местами.
 */
export function moveNavKey(order: readonly NavKey[], key: NavKey, target: NavKey): NavKey[] {
  const base = normalizeNavOrder(order);
  if (key === target) return base;
  const to = base.indexOf(target);
  const rest = base.filter((k) => k !== key);
  rest.splice(to, 0, key);
  return rest;
}
