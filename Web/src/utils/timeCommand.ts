/**
 * Разбор команды чата `/time ЧЧ:ММ:СС "текст"`.
 *
 * Кавычки принимаем любые из привычных: "…", «…», „…“, “…”. Без кавычек
 * текст тоже берём — остаток строки после времени.
 *
 * Возвращает:
 *  - null — это не команда /time (обычное сообщение);
 *  - { error } — команда, но записана неверно (сырой текст не отправляем);
 *  - { delayMs, text } — можно ставить в очередь.
 */
export type TimeCommand = { delayMs: number; text: string } | { error: string };

/** Совпадает с сервером: 99:59:59. */
export const MAX_TIME_DELAY_MS = (99 * 3600 + 59 * 60 + 59) * 1000;

const COMMAND = /^\/time(?:\s|$)/i;
const BODY = /^\/time\s+(\d{1,2}):(\d{1,2}):(\d{1,2})\s+([\s\S]+)$/i;
const QUOTES: Array<[string, string]> = [['"', '"'], ['«', '»'], ['„', '“'], ['“', '”'], ["'", "'"]];

export const TIME_USAGE = 'Формат: /time ЧЧ:ММ:СС "текст"';

function unquote(raw: string): string {
  const s = raw.trim();
  for (const [open, close] of QUOTES) {
    if (s.length >= 2 && s.startsWith(open) && s.endsWith(close)) return s.slice(open.length, s.length - close.length).trim();
  }
  return s;
}

export function parseTimeCommand(input: string): TimeCommand | null {
  const source = input.trim();
  if (!COMMAND.test(source)) return null;
  const m = BODY.exec(source);
  if (!m) return { error: TIME_USAGE };
  const [h, min, sec] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (min > 59 || sec > 59) return { error: 'Минуты и секунды — от 00 до 59' };
  const delayMs = (h * 3600 + min * 60 + sec) * 1000;
  if (delayMs < 1000) return { error: 'Задержка должна быть не меньше секунды' };
  if (delayMs > MAX_TIME_DELAY_MS) return { error: 'Максимальная задержка — 99:59:59' };
  const text = unquote(m[4]);
  if (!text) return { error: 'Пустое сообщение' };
  return { delayMs, text };
}

/** «через 1 ч 5 мин 3 с» — для подтверждения. */
export function formatDelay(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [h && `${h} ч`, m && `${m} мин`, s && `${s} с`].filter(Boolean);
  return parts.length ? parts.join(' ') : '0 с';
}
