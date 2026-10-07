/**
 * Встроенные фото/фоны обоев от админа (общие для всех).
 *
 * Заводские `base-*` лежат в `baseWallpapers.ts` и попадают в галерею через
 * STOCK_WALLPAPERS. Здесь — то, что добавил админ: загруженные файлы и фоны-
 * градиенты. Они приходят с сервера (`GET /api/themes/wallpapers`) и дописываются
 * в тот же список, поэтому в UI их видно рядом с заводскими.
 *
 * Стор НЕ персистится: фото — это файлы на сервере, в localStorage им не место.
 */

import { create } from 'zustand';
import { wallpapersApi } from '../services/api';

export type AdminWallpaper = {
  id: string;
  name: string;
  type: 'photo' | 'base';
  /** Для photo — ссылка на загруженный файл. */
  url?: string;
  /** Для base — css значения background (градиент/цвета). */
  css?: string;
  light?: boolean;
};

/**
 * Правка заводского фона: сервер не может изменить файл в бандле клиента,
 * поэтому хранит правку «поверх бандла» — что именно переопределено.
 */
export type AdminWallpaperOverride = { name?: string; light?: boolean; css?: string; url?: string };

export type AdminWallpaperCatalog = {
  items: AdminWallpaper[];
  /** Заводские id, убранные из галереи у всех («удаление» вшитого фона). */
  hidden: string[];
  overrides: Record<string, AdminWallpaperOverride>;
};

type AdminWallpapersState = {
  items: AdminWallpaper[];
  hidden: string[];
  overrides: Record<string, AdminWallpaperOverride>;
  loading: boolean;
  load: () => Promise<void>;
  /** Применить каталог (ответ сервера или событие `wallpapers:updated`). */
  apply: (catalog?: Partial<AdminWallpaperCatalog> | null) => void;
  removeLocal: (id: string) => void;
};

/** Нормализует пришедший каталог: мусорные записи не должны ломать галерею. */
export function normalizeAdminWallpapers(raw?: { items?: AdminWallpaper[] } | null): AdminWallpaper[] {
  const items = Array.isArray(raw?.items) ? raw!.items : [];
  const seen = new Set<string>();
  const out: AdminWallpaper[] = [];
  for (const it of items) {
    if (!it || typeof it.id !== 'string' || !it.id) continue;
    if (it.type !== 'photo' && it.type !== 'base') continue;
    // Фото обязано ссылаться на загруженный файл, фон — иметь css.
    if (it.type === 'photo' && typeof it.url !== 'string') continue;
    if (it.type === 'base' && (typeof it.css !== 'string' || !it.css)) continue;
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push({ id: it.id, name: it.name || 'Фон', type: it.type, url: it.url, css: it.css, light: !!it.light });
  }
  return out;
}

/**
 * Скрытые заводские id.
 *
 * 'none' отсеиваем: это сброс выбора, а не фон — если его скрыть, у всех
 * пропадёт возможность выключить обои в галерее.
 */
export function normalizeHidden(raw?: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of raw) {
    if (typeof id !== 'string' || !id || id === 'none' || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Правки заводских фонов: оставляем только поля, которые реально применимы. */
export function normalizeOverrides(raw?: unknown): Record<string, AdminWallpaperOverride> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, AdminWallpaperOverride> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof id !== 'string' || !id || id === 'none' || !value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const o: AdminWallpaperOverride = {};
    if (typeof v.name === 'string' && v.name.trim()) o.name = v.name.trim();
    if (typeof v.light === 'boolean') o.light = v.light;
    // css/url приходят с сервера и рисуются у всех — проверяем форму здесь же,
    // чтобы битая правка не превратилась в невидимый фон.
    if (typeof v.css === 'string' && v.css.trim() && !/url\s*\(|@|;|\{|\}|</i.test(v.css)) o.css = v.css.trim();
    if (typeof v.url === 'string' && v.url.startsWith('/uploads/wallpapers/')) o.url = v.url;
    if (Object.keys(o).length) out[id] = o;
  }
  return out;
}

export const useAdminWallpapers = create<AdminWallpapersState>((set, get) => ({
  items: [],
  hidden: [],
  overrides: {},
  loading: false,
  load: async () => {
    // Токена нет (или это не браузер) — показываем только заводские фоны.
    if (typeof localStorage === 'undefined') return;
    let token: string | null = null;
    try { token = localStorage.getItem('vera_token'); } catch { return; }
    if (!token) return;
    set({ loading: true });
    try {
      const res = await wallpapersApi.get();
      get().apply(res.data?.wallpapers);
    } catch {
      // Офлайн или сервер без ручки — заводской каталог остаётся.
    } finally {
      set({ loading: false });
    }
  },
  apply: (catalog) => set({
    items: normalizeAdminWallpapers(catalog),
    hidden: normalizeHidden(catalog?.hidden),
    overrides: normalizeOverrides(catalog?.overrides),
  }),
  removeLocal: (id) => set({
    items: get().items.filter((w) => w.id !== id),
    hidden: normalizeHidden([...get().hidden, id]),
  }),
}));

/** Встроенные фото/фоны админа (или пустой список, пока не загрузились). */
export function useAdminWallpaperItems(): AdminWallpaper[] {
  return useAdminWallpapers((s) => s.items);
}

/** Скрытые админом заводские фоны. */
export function useAdminHiddenWallpapers(): string[] {
  return useAdminWallpapers((s) => s.hidden);
}

/** Правки, наложенные админом на заводские фоны. */
export function useAdminWallpaperOverrides(): Record<string, AdminWallpaperOverride> {
  return useAdminWallpapers((s) => s.overrides);
}

/* ── Загрузка и сокет ─────────────────────────────────────────────────────── */

let bound = false;

/**
 * Подписка на `wallpapers:updated`: админ добавил или удалил фон — галерея
 * обновляется у всех онлайн без перезагрузки. Повторные вызовы не добавляют
 * вторую подписку, а если сокета ещё нет — подписка не «застревает» и будет
 * установлена при следующем вызове (после входа).
 */
export function bindAdminWallpapersSocket(): void {
  if (bound || typeof window === 'undefined') return;
  import('../services/socket')
    .then(({ getSocket }) => {
      const socket = getSocket?.() as { on?: (e: string, h: (p: any) => void) => void } | null;
      if (!socket?.on) { bound = false; return; }
      socket.on('wallpapers:updated', (payload: any) => {
        useAdminWallpapers.getState().apply(payload?.wallpapers);
      });
      bound = true;
    })
    .catch(() => { bound = false; });
}

/** Забрать каталог обоев с сервера (после входа или переподключения). */
export function refreshAdminWallpapers(): void {
  if (typeof window === 'undefined' || typeof useAdminWallpapers.getState !== 'function') return;
  void useAdminWallpapers.getState().load();
}

// Только в браузере: в тестовом vm-контексте нет ни localStorage, ни сокета,
// и модуль должен просто подниматься без побочных запросов.
if (typeof window !== 'undefined') {
  bindAdminWallpapersSocket();
  refreshAdminWallpapers();
}