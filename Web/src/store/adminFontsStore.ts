/**
 * Общие стоковые шрифты админа: файлы лежат на сервере, шрифт доступен всем.
 *
 * Свои шрифты пользователя (`customFontsStore`) живут в IndexedDB устройства и
 * видны только ему; эти приходят с сервера и выглядят как обычные стоковые —
 * выбираются без загрузки файла.
 */

import { create } from 'zustand';
import { fontsApi } from '../services/api';
import { customFontCss } from '../utils/customFonts';

export type AdminFont = { id: string; name: string; family: string; url: string };

type AdminFontsState = {
  items: AdminFont[];
  load: () => Promise<void>;
  apply: (catalog?: { items?: AdminFont[] } | null) => void;
};

/** Принимает только то, что годится для @font-face; остальное — мимо. */
export function normalizeAdminFonts(raw?: { items?: AdminFont[] } | null): AdminFont[] {
  const items = Array.isArray(raw?.items) ? raw!.items : [];
  const seen = new Set<string>();
  const out: AdminFont[] = [];
  for (const f of items) {
    if (!f || typeof f.id !== 'string' || !f.id) continue;
    if (typeof f.family !== 'string' || !f.family.trim()) continue;
    if (typeof f.url !== 'string' || !f.url.startsWith('/uploads/fonts/')) continue;
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push({ id: f.id, name: f.name || f.family, family: f.family, url: f.url });
  }
  return out;
}

/**
 * Правило `@font-face` для общего шрифта.
 *
 * Вынесено отдельно и чистым: правило собирается из данных с сервера, а сломанная
 * строка здесь тихо ломает ВСЕ шрифты страницы — браузер перестаёт разбирать
 * блок. Поэтому family/url проходят через ту же очистку, что и у своих шрифтов.
 */
export function adminFontFaceRule(family: string, url: string): string {
  const css = customFontCss(family);
  // customFontCss возвращает `"Имя", fallback` — берём только имя в кавычках.
  const quoted = css.split(',')[0].trim();
  if (!quoted || !/^\s*"[^"]*"\s*$/.test(quoted)) return '';
  if (!/^\/uploads\/fonts\/[A-Za-z0-9._-]+$/.test(url)) return '';
  // Кавычки внутри имени разорвали бы правило, а скобки и «;» — тем более.
  // Сервер имя уже чистит, но данные приходят из сети: не доверяем ни второму.
  if (/["'\\{}<>;]/.test(family)) return '';
  // format обязан соответствовать расширению: браузер проверяет его и молча
  // откажется применять шрифт при несовпадении (woff2 под видом truetype — как раз
  // этот случай).
  const ext = url.slice(url.lastIndexOf('.')).toLowerCase();
  const format = { '.ttf': 'truetype', '.otf': 'opentype', '.woff': 'woff', '.woff2': 'woff2' }[ext];
  if (!format) return '';
  return `@font-face{font-family:${quoted};src:url(${url}) format("${format}");font-display:swap;}`;
}

const STYLE_ATTR = 'data-vera-admin-fonts';

/**
 * Кладёт @font-face всех общих шрифтов в один <style>.
 *
 * Правила пишутся целиком, а не дописываются по одному: при перезагрузке
 * страницы или событии сокета список меняется, и дописывание оставляло бы в
 * файле шрифты, которых больше нет в каталоге.
 */
function injectFontFaces(items: AdminFont[]): void {
  if (typeof document === 'undefined' || !document.head) return;
  let el = document.head.querySelector<HTMLStyleElement>(`style[${STYLE_ATTR}]`);
  if (!el) {
    el = document.createElement('style');
    el.setAttribute(STYLE_ATTR, '');
    document.head.appendChild(el);
  }
  el.textContent = items.map((f) => adminFontFaceRule(f.family, f.url)).filter(Boolean).join('\n');
}

export const useAdminFonts = create<AdminFontsState>((set, get) => ({
  items: [],
  load: async () => {
    if (typeof localStorage === 'undefined') return;
    let token: string | null = null;
    try { token = localStorage.getItem('vera_token'); } catch { return; }
    if (!token) return;
    try {
      const res = await fontsApi.get();
      get().apply(res.data?.fonts);
    } catch {
      // Офлайн или сервер без ручки — остаются стоковые системные шрифты.
    }
  },
  apply: (catalog) => {
    const items = normalizeAdminFonts(catalog);
    injectFontFaces(items);
    set({ items });
  },
}));

/** Общие шрифты админа как готовые опции выбора (значение — CSS для font-family). */
export function useAdminFontOptions(): { value: string; label: string }[] {
  const items = useAdminFonts((s) => s.items);
  return items.map((f) => ({ value: customFontCss(f.family), label: `${f.name} · общий` }));
}

/* ── Загрузка и сокет ─────────────────────────────────────────────────────── */

let bound = false;

export function bindAdminFontsSocket(): void {
  if (bound || typeof window === 'undefined') return;
  import('../services/socket')
    .then(({ getSocket }) => {
      const socket = getSocket?.() as { on?: (e: string, h: (p: any) => void) => void } | null;
      if (!socket?.on) { bound = false; return; }
      socket.on('fonts:updated', (payload: any) => {
        useAdminFonts.getState().apply(payload?.fonts);
      });
      bound = true;
    })
    .catch(() => { bound = false; });
}

export function refreshAdminFonts(): void {
  if (typeof window === 'undefined' || typeof useAdminFonts.getState !== 'function') return;
  void useAdminFonts.getState().load();
}

if (typeof window !== 'undefined') {
  bindAdminFontsSocket();
  refreshAdminFonts();
}