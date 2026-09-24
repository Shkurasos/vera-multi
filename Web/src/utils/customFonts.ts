/**
 * Чистые помощники для своих шрифтов (файлы .ttf / .otf / .woff / .woff2).
 *
 * Держим их без React и без браузерных API: так их использует и стор
 * (`customFontsStore`), и UI (`FontPicker`), и их можно покрыть unit-тестами
 * (см. `customFonts.test.cjs`).
 */

/** Какие расширения принимаем. Пополнять в одном месте — UI берёт из этого. */
export const SUPPORTED_FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2'] as const;

/** Значение для `<input accept>` — собирается из списка расширений. */
export const FONT_FILE_ACCEPT = SUPPORTED_FONT_EXTENSIONS.map((ext) => `.${ext}`).join(',');

/** Предел размера файла: 12 МБ хватает любому шрифту, а IndexedDB не пухнет. */
export const MAX_FONT_FILE_SIZE = 12 * 1024 * 1024;

/** Системный «запасной» шрифт, если свой не загрузился (или его нет на устройстве). */
export const FONT_FAMILY_FALLBACK = 'system-ui, "Segoe UI", sans-serif';

/** Расширение файла в нижнем регистре ('' — если расширения нет). */
export function fontFileExtension(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec((fileName || '').trim());
  return match ? match[1].toLowerCase() : '';
}

/** Поддерживаем ли такой файл (проверяем по расширению). */
export function isSupportedFontFile(fileName: string): boolean {
  return (SUPPORTED_FONT_EXTENSIONS as readonly string[]).includes(fontFileExtension(fileName));
}

/**
 * Имя семейства из имени файла: убираем путь и расширение, выкидываем символы,
 * которые ломают CSS внутри `@font-face { font-family: "…" }`.
 */
export function sanitizeFontFamily(fileName: string): string {
  const base = ((fileName || '').trim().split(/[\\/]/).pop() || '').trim();
  return base
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/["'\\;{}()<>,\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

/**
 * CSS-значение `font-family` для своего шрифта: имя в кавычках плюс системный
 * запасной вариант. Именно это значение храним в настройках (глобально и на чат).
 */
export function customFontCss(family: string, fallback: string = FONT_FAMILY_FALLBACK): string {
  const safe = (family || '').replace(/["'\\\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!safe) return fallback;
  return `"${safe}", ${fallback}`;
}

/**
 * Проверка выбранного файла до чтения в память.
 * `null` — файл годится; иначе готовый текст ошибки для UI.
 */
export function checkFontFile(file: { name: string; size: number } | null | undefined): string | null {
  if (!file) return 'Файл не выбран';
  if (!isSupportedFontFile(file.name)) return 'Поддерживаются только .ttf, .otf, .woff и .woff2';
  if (!file.size) return 'Файл пустой';
  if (file.size > MAX_FONT_FILE_SIZE) {
    return `Файл больше ${Math.round(MAX_FONT_FILE_SIZE / (1024 * 1024))} МБ — выберите шрифт полегче`;
  }
  if (!sanitizeFontFamily(file.name)) return 'Не удалось прочитать название шрифта из имени файла';
  return null;
}

/** Человекочитаемый размер файла для списка своих шрифтов. */
export function formatFontSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 КБ';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
