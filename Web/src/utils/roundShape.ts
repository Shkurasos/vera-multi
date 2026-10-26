// Форма кружка (видеосообщения), как в ВК: выбирает отправитель при записи.
// Форма зашита в имя файла — так её видят все клиенты без новых полей в БД:
//   video-note.webm         → круг (старые кружки и значение по умолчанию)
//   video-note-heart.webm   → сердце и т.д.
// Все контуры заданы в viewBox 0..100 и начинаются в «12 часов», идут по
// часовой стрелке — по ним же рисуется кольцо прогресса (pathLength = 1).

export type RoundShape = 'circle' | 'squircle' | 'heart';

export const ROUND_SHAPES: { id: RoundShape; label: string }[] = [
  { id: 'circle', label: 'Круг' },
  { id: 'squircle', label: 'Квадрат' },
  { id: 'heart', label: 'Сердце' },
];

const NOTE_RE = /^video-note(?:-(squircle|heart))?\.(webm|mp4)$/;

export function normalizeRoundShape(v: unknown): RoundShape {
  return v === 'squircle' || v === 'heart' ? v : 'circle';
}

/** Это кружок? Узнаём по имени файла (mimeType у старых записей бывает text/plain). */
export function isRoundNoteName(name: string | undefined | null): boolean {
  return NOTE_RE.test(name || '');
}

/** Форма кружка по имени файла; null — это не кружок. */
export function roundShapeFromName(name: string | undefined | null): RoundShape | null {
  const m = NOTE_RE.exec(name || '');
  return m ? normalizeRoundShape(m[1]) : null;
}

/** Имя файла для записи: у круга — прежнее, чтобы старые клиенты его узнавали. */
export function roundNoteFileName(shape: RoundShape, ext: 'webm' | 'mp4'): string {
  const s = normalizeRoundShape(shape);
  return s === 'circle' ? `video-note.${ext}` : `video-note-${s}.${ext}`;
}

const f = (n: number) => Math.round(n * 100) / 100;

/**
 * Обрезка видео по форме. Круг — обычный border-radius (как раньше), прочие
 * формы — SVG-маской во весь блок: она тянется вместе с размером кружка.
 */
export function roundShapeMaskSx(shape: RoundShape): Record<string, string> {
  const s = normalizeRoundShape(shape);
  if (s === 'circle') return { borderRadius: '50%' };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${roundShapePath(s)}" fill="#000"/></svg>`;
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  return {
    WebkitMaskImage: url, maskImage: url,
    WebkitMaskSize: '100% 100%', maskSize: '100% 100%',
    WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
  };
}

/**
 * Доля пути (0..1), ближайшая к точке (x, y) в координатах viewBox.
 * `samples` — заранее снятые точки контура через равные доли длины.
 */
export function nearestFraction(x: number, y: number, samples: { x: number; y: number }[]): number {
  if (!samples.length) return 0;
  let best = 0;
  let bestD = Infinity;
  for (let k = 0; k < samples.length; k++) {
    const d = (samples[k].x - x) ** 2 + (samples[k].y - y) ** 2;
    if (d < bestD) { bestD = d; best = k; }
  }
  return best / samples.length;
}

/**
 * Контур формы, отступивший от края на `inset` (в единицах viewBox 0..100).
 * inset = 0 — маска видео, inset = половина толщины кольца — само кольцо.
 */
export function roundShapePath(shape: RoundShape, inset = 0): string {
  const i = inset;
  const lo = i;
  const hi = 100 - i;
  switch (normalizeRoundShape(shape)) {
    case 'squircle': {
      const r = 26 - i;
      return [
        `M50 ${f(lo)}`,
        `H${f(hi - r)}`, `A${f(r)} ${f(r)} 0 0 1 ${f(hi)} ${f(lo + r)}`,
        `V${f(hi - r)}`, `A${f(r)} ${f(r)} 0 0 1 ${f(hi - r)} ${f(hi)}`,
        `H${f(lo + r)}`, `A${f(r)} ${f(r)} 0 0 1 ${f(lo)} ${f(hi - r)}`,
        `V${f(lo + r)}`, `A${f(r)} ${f(r)} 0 0 1 ${f(lo + r)} ${f(lo)}`,
        'Z',
      ].join(' ');
    }
    case 'heart': {
      // Сердце масштабируем к центру: так отступ одинаков со всех сторон.
      const k = (100 - 2 * i) / 100;
      const p = (x: number, y: number) => `${f(50 + (x - 50) * k)} ${f(50 + (y - 50) * k)}`;
      return [
        `M${p(50, 22)}`,
        `C${p(60, 4)} ${p(98, 4)} ${p(98, 36)}`,
        `C${p(98, 64)} ${p(68, 80)} ${p(50, 97)}`,
        `C${p(32, 80)} ${p(2, 64)} ${p(2, 36)}`,
        `C${p(2, 4)} ${p(40, 4)} ${p(50, 22)}`,
        'Z',
      ].join(' ');
    }
    default: {
      const r = 50 - i;
      return `M50 ${f(lo)} A${f(r)} ${f(r)} 0 1 1 50 ${f(hi)} A${f(r)} ${f(r)} 0 1 1 50 ${f(lo)} Z`;
    }
  }
}
