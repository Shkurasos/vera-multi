/**
 * Отпечаток устройства для анти-мультиаккаунтинга.
 *
 * 152-ФЗ: это НЕ персональные данные. Мы собираем только обезличенные
 * технические характеристики браузера и сразу превращаем их в необратимый
 * SHA-256-хэш. Из хэша нельзя восстановить ни имя, ни адрес, ни сам набор
 * характеристик — его можно лишь сравнить с другим хэшем («то же устройство?»).
 *
 * Сознательно НЕ используем canvas- и WebRTC-фингерпринтинг: это «серая зона»,
 * которую часть регуляторов трактует как скрытый сбор. Нам она не нужна.
 */

const FP_CACHE_KEY = 'vera_fp_hash';

/** Набор распространённых шрифтов, наличие которых проверяем без canvas. */
const PROBE_FONTS = [
  'Arial', 'Courier New', 'Georgia', 'Times New Roman', 'Verdana',
  'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Roboto', 'Helvetica',
  'Calibri', 'Cambria', 'Consolas', 'Comic Sans MS', 'Impact',
];

/**
 * Определяет установленные шрифты по изменению ширины эталонной строки
 * относительно базовых monospace/sans-serif/serif. Это измерение размеров
 * DOM-элемента, а не canvas: оно не читает пиксели и не даёт скрытых данных.
 */
function detectFonts(): string {
  if (typeof document === 'undefined') return '';
  const baseFonts = ['monospace', 'sans-serif', 'serif'];
  const text = 'mmmmmmmmmmlli';
  const size = '72px';
  const span = document.createElement('span');
  span.style.position = 'absolute';
  span.style.left = '-9999px';
  span.style.fontSize = size;
  span.style.lineHeight = 'normal';
  span.textContent = text;
  document.body.appendChild(span);

  const base: Record<string, { w: number; h: number }> = {};
  for (const b of baseFonts) {
    span.style.fontFamily = b;
    base[b] = { w: span.offsetWidth, h: span.offsetHeight };
  }

  const available: string[] = [];
  for (const font of PROBE_FONTS) {
    let detected = false;
    for (const b of baseFonts) {
      span.style.fontFamily = `'${font}',${b}`;
      if (span.offsetWidth !== base[b].w || span.offsetHeight !== base[b].h) {
        detected = true;
        break;
      }
    }
    if (detected) available.push(font);
  }
  document.body.removeChild(span);
  return available.join(',');
}

/** Собирает обезличенные характеристики в одну строку (до хэширования). */
function collectComponents(): string {
  const nav = typeof navigator !== 'undefined' ? navigator : ({} as Navigator);
  const scr = typeof screen !== 'undefined' ? screen : ({} as Screen);
  let timezone = '';
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* ignore */ }
  const parts = [
    nav.userAgent || '',
    (nav.language || '') + '|' + ((nav.languages || []).join(',')),
    timezone,
    `${scr.width || 0}x${scr.height || 0}x${scr.colorDepth || 0}`,
    (nav.platform || ''),
    String((nav as any).hardwareConcurrency || ''),
    String((nav as any).deviceMemory || ''),
    detectFonts(),
  ];
  return parts.join('§');
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Возвращает стабильный hex-хэш отпечатка устройства. Кэшируется в localStorage,
 * чтобы совпадал между сессиями. На сервер уходит ТОЛЬКО этот хэш (поле fpHash).
 */
export async function getDeviceFingerprintHash(): Promise<string> {
  try {
    const cached = localStorage.getItem(FP_CACHE_KEY);
    if (cached && /^[a-f0-9]{64}$/.test(cached)) return cached;
    const hash = await sha256Hex(collectComponents());
    localStorage.setItem(FP_CACHE_KEY, hash);
    return hash;
  } catch {
    // Если крипто/DOM недоступны — отпечаток просто не отправляется (лимит по IP остаётся).
    return '';
  }
}
