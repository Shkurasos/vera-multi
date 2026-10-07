/**
 * Мост между слоем часов и лентой сообщений.
 *
 * Часы лежат отдельным слоем поверх обоев, и сообщения их просто перекрывают.
 * Чтобы «отодвигать» перекрывающие сообщения, нужно знать, ГДЕ именно находятся
 * часы. Слой публикует свои границы здесь, а пузыри их читают.
 *
 * Отдельный стор, а не пропсы через ChatWindow: сообщений в экране десятки, и
 * каждой строке через три компонента передавать прямоугольник — лишняя работа
 * на каждом рендере ленты. Здесь подписчиков тоже немного — только видимые
 * сообщения (остальные не смонтированы).
 */
import { create } from 'zustand';

export interface ClockRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** Положение блока: от него зависит, в какую сторону отодвигать. */
  pos: 'center' | 'top' | 'bottom';
}

interface ClockLayoutState {
  /** Границы блока часов в координатах окна; null — часов нет или функция выключена. */
  rect: ClockRect | null;
  /**
   * Счётчик «позиция ленты изменилась». Растёт при прокрутке: без него
   * сообщение узнает о сдвиге только при собственном ререндере, а при прокрутке
   * его позиция меняется без перерисовки — и сдвиг от часов остался бы старым.
   */
  tick: number;
  setRect: (r: ClockRect | null) => void;
  bump: () => void;
}

export const useClockLayout = create<ClockLayoutState>((set) => ({
  rect: null,
  tick: 0,
  setRect: (rect) => set((st) => {
    // Прямоугольник публикуется на каждый тик часов, хотя он почти не меняется.
    // Без сравнения каждая секунда перерисовывала бы все видимые сообщения.
    const prev = st.rect;
    if (prev === rect) return st;
    if (prev && rect
      && Math.abs(prev.top - rect.top) < 0.5 && Math.abs(prev.bottom - rect.bottom) < 0.5
      && Math.abs(prev.left - rect.left) < 0.5 && Math.abs(prev.right - rect.right) < 0.5) {
      return st;
    }
    return { rect };
  }),
  bump: () => set((st) => ({ tick: st.tick + 1 })),
}));

/** Прямоугольник в координатах окна. */
export interface Box4 {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Насколько сдвинуть сообщение ВБОК, чтобы оно не закрывало часы.
 *
 * Сдвиг только горизонтальный, и это принципиально. Вертикальный зазор растягивал
 * бы ленту: суммарная высота сообщений росла, полоса прокрутки уезжала, и самое
 * нижнее сообщение оказывалось за краем экрана — «посмотреть его» становилось
 * невозможно. Горизонтальный сдвиг рисуется трансформацией и вообще не участвует
 * в раскладке: высота ленты не меняется, прокрутка и нижнее сообщение остаются
 * на месте.
 *
 * Возвращает 0, если перекрытия нет, часов нет или сдвинуться некуда.
 * Считает по ИСХОДНОЙ позиции сообщения (без уже применённого сдвига), иначе
 * получится зацикливание: сдвинули — перекрытие исчезло — вернули назад.
 */
export function clockAvoidShift(
  rect: ClockRect | null,
  box: Box4,
  /** Границы доступной области (строка ленты): за её пределы не выезжаем. */
  area: { left: number; right: number },
): number {
  if (!rect) return 0;
  const GAP = 12;
  // Часы стоят по центру и не на всю ширину: сообщение у края экрана их не
  // задевает вовсе, и двигать его незачем.
  const overlapY = Math.min(box.bottom, rect.bottom) - Math.max(box.top, rect.top);
  const overlapX = Math.min(box.right, rect.right) - Math.max(box.left, rect.left);
  if (overlapY <= 0 || overlapX <= 0) return 0;

  // Сколько стоит уйти вправо и влево. Оба числа положительные: это длина
  // пути, знак задаётся в конце.
  const toRight = rect.right + GAP - box.left;
  const toLeft = box.right - (rect.left - GAP);
  const fitsRight = box.right + toRight <= area.right + 1;
  const fitsLeft = box.left - toLeft >= area.left - 1;

  // Берём сторону с меньшим ходом — сообщение уходит минимально далеко.
  if (toRight <= toLeft && fitsRight) return toRight;
  if (toLeft < toRight && fitsLeft) return -toLeft;
  // «Дешёвая» сторона не помещается (своё сообщение у самого края) — другая
  // всё же лучше, чем закрытые часы.
  if (fitsRight) return toRight;
  if (fitsLeft) return -toLeft;
  // Не помещается ни одна сторона: на узком экране под часы не остаётся места.
  return 0;
}