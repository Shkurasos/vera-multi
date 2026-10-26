// Своя верхняя панель окна вместо браузерной/системной.
//
// Где она появляется:
//  • Electron — окно без системного заголовка (titleBarStyle: 'hidden'),
//    кнопки «свернуть/развернуть/закрыть» рисует ОС поверх нашей полосы
//    (titleBarOverlay), а их цвет мы подгоняем под тему по IPC.
//  • Установленное PWA в режиме Window Controls Overlay — то же самое, только
//    цвет кнопок берётся из <meta name="theme-color">.
// В обычной вкладке браузера и на телефоне панели нет.

export const TITLE_BAR_HEIGHT = 32;

const HEX6 = /^#[0-9a-f]{6}$/i;

function hex2(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

/**
 * Непрозрачный #rrggbb из цвета темы. Системные кнопки окна прозрачность не
 * понимают, а градиенты/var() им не передать — для них берём запасной цвет.
 */
export function opaqueHex(color: string | undefined | null, fallback = '#000000'): string {
  const v = (color || '').trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (hex) {
    let body = hex[1];
    if (body.length === 3 || body.length === 4) body = body.split('').map((c) => c + c).join('');
    if (body.length === 6 || body.length === 8) return `#${body.slice(0, 6).toLowerCase()}`;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(v);
  if (rgb) return `#${hex2(+rgb[1])}${hex2(+rgb[2])}${hex2(+rgb[3])}`;
  return HEX6.test(fallback) ? fallback.toLowerCase() : '#000000';
}

/** Цвета полосы и системных кнопок для текущей темы. */
export function titleBarColors(theme: { bgHeader?: string; bg?: string; text?: string }): { color: string; symbolColor: string } {
  const color = opaqueHex(theme.bgHeader, opaqueHex(theme.bg, '#000000'));
  return { color, symbolColor: opaqueHex(theme.text, '#ffffff') };
}

/** Строгая проверка на стороне Electron: в setTitleBarOverlay идёт только #rrggbb. */
export function isSafeHex(v: unknown): v is string {
  return typeof v === 'string' && HEX6.test(v);
}
