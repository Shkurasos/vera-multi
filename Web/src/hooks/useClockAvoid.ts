/**
 * Плавно отодвигает сообщение ВБОК, если оно закрывает часы.
 *
 * Работает и для своих, и для чужих сообщений: подключается к корню строки и к
 * самому пузырю, до ветвления на свои/чужие — перекрывают часы они оба.
 *
 * Сдвиг задаётся трансформацией, а не зазором: трансформация не участвует в
 * раскладке, поэтому лента не растёт, прокрутка не уезжает и самое нижнее
 * сообщение остаётся на экране.
 *
 * Тонкость с расчётом: сдвиг сам смещает прямоугольник пузыря. Если мерить текущие
 * координаты, получится зацикливание — сдвинули, перекрытие исчезло, вернули назад.
 * Поэтому из замера вычитается уже применённый сдвиг: все проверки идут по
 * ИСХОДНОЙ позиции, а результат неизменен.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useUserSettingsStore } from '../store/userSettingsStore';
import { useClockLayout, clockAvoidShift } from '../store/wallClockLayout';

export function useClockAvoid(
  bubbleRef: RefObject<HTMLElement | null>,
  rowRef: RefObject<HTMLElement | null>,
): number {
  const rect = useClockLayout((s) => s.rect);
  const tick = useClockLayout((s) => s.tick);
  const enabled = useUserSettingsStore((s) => s.wallClockAvoid);
  const [shift, setShift] = useState(0);
  // Текущий сдвиг держим ещё и в ref: в эффекте он нужен, чтобы отнять его от
  // замера, а setState в том же проходе недоступен.
  const shiftRef = useRef(0);

  useLayoutEffect(() => {
    if (!enabled || !rect) {
      if (shiftRef.current !== 0) { shiftRef.current = 0; setShift(0); }
      return;
    }
    const bubble = bubbleRef.current;
    const row = rowRef.current;
    if (!bubble || !row) return;
    const b = bubble.getBoundingClientRect();
    const a = row.getBoundingClientRect();
    const cur = shiftRef.current;
    // Возвращаем координаты к исходным — сдвигает только transform.
    const box = {
      top: b.top, bottom: b.bottom,
      left: b.left - cur, right: b.right - cur,
    };
    const next = clockAvoidShift(rect, box, { left: a.left, right: a.right });
    // Перерисовываем только при реальном изменении: тик приходит на каждый кадр
    // прокрутки, и без этой проверки лента дёргалась бы заново.
    if (Math.abs(next - cur) > 0.5) { shiftRef.current = next; setShift(next); }
  }, [enabled, rect, tick, bubbleRef, rowRef]);

  return enabled ? shift : 0;
}
