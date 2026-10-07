/**
 * Стандартный звук прихода сообщения.
 *
 * Синтезируется через Web Audio, а не грузится файлом: у записи сэмпла есть
 * автор, и даже «похожий на айфоновский» риск — копия. Здесь звук собирается из
 * формул, поэтому он наш по определению и весит ноль байт.
 *
 * Характер — мягкий «тинг» с короткой атакой и долгим затуханием, как у
 * стеклянного уведомления. Отличия от «айфоновского» сознательные и
 * материальные: своя квинта, свой набор обертонов, своя огибающая и лёгкий
 * расстрой по высоте при каждом проигрывании — так повтор подряд сообщений не
 * звучит механически.
 *
 * Файл был продублирован в App.tsx и ChatWindow.tsx двумя почти одинаковыми
 * копиями; теперь синтез живёт здесь один.
 */

/** Одна нота плана: момент старта, частота, длительность и громкость. */
export interface VoiceNote {
  /** С какого момента звучит, сек. */
  at: number;
  freq: number;
  /** Длительность, сек. */
  dur: number;
  gain: number;
  /** Обертоны: множитель частоты и свой уровень (0..1). */
  partials: { ratio: number; level: number }[];
}

/** Квинта вместо «родного» интервала: узнаваемо по характеру, но не копия. */
const NOTE_A = 784.0;  // G5 — открывающая нота
const NOTE_B = 1174.7; // D6 — отвечающая на квинту выше
/** Задержка второй ноты: она должна «догонять» первую, а не спорить с ней. */
const SECOND_AT = 0.085;

/**
 * План звука: чистые числа, без браузерных API — так его можно покрыть
 * unit-тестами (`notificationSound.test.cjs`).
 *
 * @param volume громкость 0..1
 * @param driftCents лёгкий расстрой в центах, чтобы повторы не слипались
 */
export function notificationVoice(volume = 1, driftCents = 0): VoiceNote[] {
  const v = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
  const detune = Math.pow(2, driftCents / 1200);
  // Обертоны: октава и квинта с разными уровнями — стеклянный, не колокольный.
  const partials = [
    { ratio: 1, level: 1 },
    { ratio: 2.01, level: 0.28 },
    { ratio: 3.02, level: 0.1 },
  ];
  return [
    { at: 0, freq: NOTE_A * detune, dur: 0.42, gain: 0.5 * v, partials },
    { at: SECOND_AT, freq: NOTE_B * detune, dur: 0.5, gain: 0.42 * v, partials },
  ];
}

/**
 * Случайный расстрой для очередного проигрывания: пара центов — слышно живым,
 * но узнать конкретную запись по нему нельзя.
 */
export function nextDrift(random: () => number = Math.random): number {
  return (random() * 2 - 1) * 2;
}

/** Мягкая огибающая: быстрая атака, экспоненциальный спад. */
function envelope(gain: GainNode, ctx: AudioContext, at: number, dur: number, peak: number): void {
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(peak, at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
}

let sharedCtx: AudioContext | null = null;

/**
 * Один AudioContext на всё приложение: новый на каждое сообщение давал
 * подтормаживания (это уже было в старой копии в ChatWindow).
 */
export function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!sharedCtx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      sharedCtx = new Ctx();
    }
    // Браузеры держат контекст в suspended, пока не было жеста пользователя.
    if (sharedCtx.state === 'suspended') void sharedCtx.resume().catch(() => {});
    return sharedCtx;
  } catch {
    return null;
  }
}

/** Проигрывает план. Возвращает false, если звук сыграть нечем. */
export function playVoice(notes: VoiceNote[]): boolean {
  const ctx = getAudioContext();
  if (!ctx || !notes.length) return false;
  try {
    for (const note of notes) {
      // Общий фильтр на ноту: он убирает резкость, из-за которой дешёвый
      // «пик» звучит как треск, а не как уведомление.
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 5200;
      filter.Q.value = 0.7;

      const amp = ctx.createGain();
      const at = ctx.currentTime + note.at;
      envelope(amp, ctx, at, note.dur, Math.max(0.0002, note.gain));
      filter.connect(amp);
      amp.connect(ctx.destination);

      for (const p of note.partials) {
        const osc = ctx.createOscillator();
        // Треугольная основа даёт мягкий «деревянный» тембр; синус добавляет
        // округлость верхних обертонов.
        osc.type = p.ratio === 1 ? 'triangle' : 'sine';
        osc.frequency.value = note.freq * p.ratio;
        const partGain = ctx.createGain();
        partGain.gain.value = p.level;
        osc.connect(partGain);
        partGain.connect(filter);
        osc.start(at);
        osc.stop(at + note.dur + 0.02);
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Основная точка входа: громкость 0 — полностью выключено. */
export function playDefaultChime(volume = 1, random: () => number = Math.random): boolean {
  if (!(volume > 0)) return false;
  return playVoice(notificationVoice(volume, nextDrift(random)));
}

/** Звук примера в настройках: без случайного расстройка, ровно один. */
export function playChimePreview(volume = 1): boolean {
  return playVoice(notificationVoice(volume, 0));
}

/** Освободить контекст при уходе со страницы. */
export function disposeNotificationSound(): void {
  try {
    void sharedCtx?.close();
  } catch { /* уже закрыт */ }
  sharedCtx = null;
}