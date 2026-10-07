/**
 * Геометрия кадрирования фото — чистые функции без DOM.
 *
 * Вынесено отдельно от диалога, потому что это единственная часть кроппера,
 * где легко ошибиться незаметно: сдвиг на пиксель — и обрезанное фото уже не
 * совпадает с тем, что пользователь видел в рамке. Плюс так её можно
 * прогнать обычными тестами без браузера.
 *
 * Модель простая: картинка вписана в рамку (contain), поверх — зум и сдвиг.
 * Зум никогда не опускается ниже «только что закрывает рамку», поэтому в
 * кадре не может оказаться пустого места по краям.
 */

/** Размер в пикселях. */
export interface CropSize {
  width: number;
  height: number;
}

/** Прямоугольник в пикселях исходника. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Насколько можно приблизить сверх «плотно вписать». */
export const MAX_CROP_ZOOM = 4;

/** Масштаб, при котором картинка целиком помещается в рамку. */
export function fitScale(src: CropSize, frame: CropSize): number {
  if (!src.width || !src.height) return 1;
  return Math.min(frame.width / src.width, frame.height / src.height);
}

/**
 * Минимальный зум, при котором картинка накрывает рамку целиком.
 * Для пропорциональной рамки равен 1, для несовпадающей — больше единицы.
 */
export function coverZoom(src: CropSize, frame: CropSize): number {
  if (!src.width || !src.height || !frame.width || !frame.height) return 1;
  const fw = frame.width / src.width;
  const fh = frame.height / src.height;
  return Math.max(fw, fh) / Math.min(fw, fh);
}

/** Зажать зум в [минимальный, максимальный]. */
export function clampZoom(zoom: number, min: number): number {
  return Math.max(min, Math.min(MAX_CROP_ZOOM, Number.isFinite(zoom) ? zoom : min));
}

/** Размер картинки на экране при текущем зуме. */
export function drawnSize(src: CropSize, frame: CropSize, zoom: number): CropSize {
  const fit = fitScale(src, frame);
  return { width: src.width * fit * zoom, height: src.height * fit * zoom };
}

/**
 * Зажать значение в [lo, hi].
 *
 * `+ 0` здесь не украшение: при lo = -0 и v < lo результат Math.max тоже -0,
 * и любой потребитель, сравнивающий через Object.is (например assert.strict),
 * счёл бы -0 не равным 0. Нормализуем один раз здесь.
 */
const clamp = (lo: number, hi: number, v: number) =>
  Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : 0)) + 0;

/** Зажать сдвиг так, чтобы картинка всегда закрывала рамку. */
export function clampPan(
  offset: { x: number; y: number },
  drawn: CropSize,
  frame: CropSize,
): { x: number; y: number } {
  const slackX = Math.max(0, (drawn.width - frame.width) / 2);
  const slackY = Math.max(0, (drawn.height - frame.height) / 2);
  return { x: clamp(-slackX, slackX, offset.x), y: clamp(-slackY, slackY, offset.y) };
}

/** Где окажется левый верхний угол картинки относительно рамки. */
export function imageOrigin(
  src: CropSize,
  frame: CropSize,
  zoom: number,
  offset: { x: number; y: number },
): { x: number; y: number } {
  const drawn = drawnSize(src, frame, zoom);
  return {
    x: (frame.width - drawn.width) / 2 + offset.x,
    y: (frame.height - drawn.height) / 2 + offset.y,
  };
}

/**
 * Прямоугольник исходника, попадающий в рамку, — его и вырезаем в canvas.
 * Это ровно то, что пользователь видел, поэтому рамка и кадр не разойдутся.
 */
export function cropSourceRect(
  src: CropSize,
  frame: CropSize,
  zoom: number,
  offset: { x: number; y: number },
): CropRect {
  const origin = imageOrigin(src, frame, zoom, offset);
  const k = drawnSize(src, frame, zoom).width / src.width;
  // Считаем кадр, потом вдвигаем его внутрь исходника целиком: иначе из-за
  // дробной погрешности на кадр попадал бы кусок за краем картинки, и canvas
  // молча отдал бы пустые пиксели по краю.
  const width = Math.max(1, Math.min(src.width, frame.width / k));
  const height = Math.max(1, Math.min(src.height, frame.height / k));
  return {
    x: Math.max(0, Math.min(src.width - width, -origin.x / k)),
    y: Math.max(0, Math.min(src.height - height, -origin.y / k)),
    width,
    height,
  };
}

/** Размер сохраняемой картинки: длинная сторона не больше maxSide. */
export function outputSize(rect: CropRect, maxSide = 1440): CropSize {
  const scale = Math.min(1, maxSide / Math.max(rect.width, rect.height));
  return {
    width: Math.max(1, Math.round(rect.width * scale)),
    height: Math.max(1, Math.round(rect.height * scale)),
  };
}

/** Пропорции рамки: w/h. */
export type AspectKey = 'free' | '9:16' | '3:4' | '1:1' | '16:9';

export const CROP_ASPECTS: Array<{ key: AspectKey; label: string; ratio: number | null }> = [
  { key: 'free', label: 'Свободно', ratio: null },
  { key: '9:16', label: '9:16', ratio: 9 / 16 },
  { key: '3:4', label: '3:4', ratio: 3 / 4 },
  { key: '1:1', label: '1:1', ratio: 1 },
  { key: '16:9', label: '16:9', ratio: 16 / 9 },
];

/**
 * Размер рамки под пропорции: вписывается в доступную область, не выходит за
 * неё. «Свободно» берёт пропорции самой картинки — обрезать тогда нечего.
 */
export function frameSize(
  box: CropSize,
  ratio: number | null,
  src: CropSize | null,
): CropSize {
  if (!ratio) {
    if (!src || !src.width || !src.height) return { width: box.width, height: box.height };
    const k = Math.min(box.width / src.width, box.height / src.height);
    return { width: Math.round(src.width * k), height: Math.round(src.height * k) };
  }
  let width = box.width;
  let height = width / ratio;
  if (height > box.height) {
    height = box.height;
    width = height * ratio;
  }
  return { width: Math.round(width), height: Math.round(height) };
}