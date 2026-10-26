/**
 * Палитра MUI из пользовательской темы.
 *
 * Базовая тема MUI собрана в режиме 'dark' (text.primary = #F5F7FF,
 * background.paper = тёмный), а цвета приложения задаёт themeStore. Пока
 * палитра не синхронизирована, любой компонент MUI без собственного `color`
 * (Typography, MenuItem, значение Select, DialogTitle…) рисует почти белый
 * текст — на светлых темах он пропадал.
 *
 * `background.paper` синхронизируется обязательно: он же подложка выпадающих
 * списков Select, иначе тёмный текст лёг бы на тёмный MUI-фон.
 *
 * Функция чистая (без React/DOM), покрыта тестами `muiPalette.test.cjs`.
 */

export interface AppThemeColors {
  text?: string;
  textSec?: string;
  bg?: string;
  bgHeader?: string;
  border?: string;
  bgHover?: string;
  bgActive?: string;
  accent?: string;
}

/** Тёмная палитра MUI — значения по умолчанию, если в теме поля нет. */
export const MUI_DARK_FALLBACK = {
  text: '#F5F7FF',
  textSec: '#8B94AA',
  bg: '#000000',
  bgHeader: 'rgba(8,12,24,0.86)',
  border: 'rgba(255,255,255,0.10)',
  bgHover: 'rgba(255,255,255,0.06)',
  bgActive: 'rgba(255,255,255,0.1)',
};

/**
 * Палитра MUI, согласованная с темой приложения.
 * Частично сохранённая тема (старый localStorage, тема с сервера) не должна
 * оставлять `undefined` — иначе текст исчезнет.
 */
export function muiPaletteFromTheme(appTheme: AppThemeColors | undefined) {
  const t = appTheme || {};
  const palette: Record<string, unknown> = {
    text: { primary: t.text || MUI_DARK_FALLBACK.text, secondary: t.textSec || MUI_DARK_FALLBACK.textSec },
    background: { default: t.bg || MUI_DARK_FALLBACK.bg, paper: t.bgHeader || t.bg || MUI_DARK_FALLBACK.bgHeader },
    divider: t.border || MUI_DARK_FALLBACK.border,
    action: { hover: t.bgHover || MUI_DARK_FALLBACK.bgHover, selected: t.bgActive || MUI_DARK_FALLBACK.bgActive },
  };
  // Акцент темы → primary (кнопки, ссылки, фокус полей, чипы) и info (синие
  // Alert). Раньше primary был всегда #00E5FF, и всё с color="primary"
  // оставалось бирюзовым при любой теме.
  const accent = accentColor(t.accent);
  if (accent) {
    palette.primary = accent;
    palette.info = accent;
  }
  return palette;
}

/** Нормализованный #rrggbb или null — MUI нужен разбираемый цвет (alpha() для hover). */
function parseHex(color: string | undefined): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec((color || '').trim());
  if (!m || (m[1].length === 3 && m[2])) return null;
  let body = m[1];
  if (body.length === 3) body = body.split('').map((ch) => ch + ch).join('');
  return [0, 2, 4].map((i) => parseInt(body.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex(rgb: number[]): string {
  return '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Смешивание с белым (amount > 0) или чёрным (amount < 0). */
function mix(rgb: [number, number, number], amount: number): string {
  const target = amount > 0 ? 255 : 0;
  const k = Math.abs(amount);
  return toHex(rgb.map((v) => v + (target - v) * k));
}

/**
 * Полный цвет MUI из акцента: light/dark/contrastText считаем сами — при
 * merge в createTheme старые значения из базовой темы (бирюзовые) иначе
 * остались бы на месте. Невалидный акцент (градиент, пусто) → null.
 */
export function accentColor(accent: string | undefined) {
  const rgb = parseHex(accent);
  if (!rgb) return null;
  const luminance = 0.2126 * (rgb[0] / 255) + 0.7152 * (rgb[1] / 255) + 0.0722 * (rgb[2] / 255);
  return {
    main: toHex(rgb),
    light: mix(rgb, 0.3),
    dark: mix(rgb, -0.25),
    // Тот же порог, что у isLightColor (contrast.ts).
    contrastText: luminance > 0.6 ? '#0B0B10' : '#FFFFFF',
  };
}