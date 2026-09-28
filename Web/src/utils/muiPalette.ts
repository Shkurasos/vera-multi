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
  return {
    text: { primary: t.text || MUI_DARK_FALLBACK.text, secondary: t.textSec || MUI_DARK_FALLBACK.textSec },
    background: { default: t.bg || MUI_DARK_FALLBACK.bg, paper: t.bgHeader || t.bg || MUI_DARK_FALLBACK.bgHeader },
    divider: t.border || MUI_DARK_FALLBACK.border,
    action: { hover: t.bgHover || MUI_DARK_FALLBACK.bgHover, selected: t.bgActive || MUI_DARK_FALLBACK.bgActive },
  };
}