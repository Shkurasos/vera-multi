/**
 * Контраст текста на цветном фоне.
 *
 * Палитра MUI в приложении всегда собрана в режиме 'dark' (text.primary =
 * '#F5F7FF'), а фон меню/диалогов подставляется из пользовательской темы.
 * Поэтому в светлых темах «дефолтный» текст MUI оказывается белым по
 * светлому фону и пропадает. Яркость фона решает, какой текст читаем.
 *
 * Функции чистые (без React/DOM), поэтому покрыты тестами `contrast.test.cjs`.
 */

/** Относительная яркость 0..1 (по Rec. 709), для строк #rgb/#rrggbb. */
export function colorLuminance(color: string): number {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((color || '').trim());
  if (!match) return 0;
  let body = match[1];
  if (body.length === 3) body = body.split('').map((ch) => ch + ch).join('');
  const r = parseInt(body.slice(0, 2), 16) / 255;
  const g = parseInt(body.slice(2, 4), 16) / 255;
  const b = parseInt(body.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Светлый ли цвет — порог 0.6, тот же, что у isLightColor. */
export function isLightColor(color: string): boolean {
  return colorLuminance(color) > 0.6;
}

/**
 * Читаемый цвет текста поверх фона: тёмный на светлом, светлый на тёмном.
 * Розовым/жёлтым акцентам светлых тем достаётся тёмный текст вместо белого.
 */
export function readableTextOn(background: string, dark = '#0B0B10', light = '#FFFFFF'): string {
  return isLightColor(background) ? dark : light;
}