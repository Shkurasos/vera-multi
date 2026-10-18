import { useEffect, useState } from 'react';

/** Серверный минимум размера питомца — ниже него не опускается ничего. */
export const MIN_PET_SIZE = 36;

export function getMaxPetSize(): number {
  if (typeof window === 'undefined') return 120;
  // visualViewport до первой раскладки окна (старт Electron, свёрнутое окно)
  // может отдать ноль — тогда берём window-метрики, а не схлопываемся до 1 px.
  const vvWidth = Number(window.visualViewport?.width) || 0;
  const vvHeight = Number(window.visualViewport?.height) || 0;
  const width = vvWidth > 0 ? vvWidth : window.innerWidth;
  const height = vvHeight > 0 ? vvHeight : window.innerHeight;
  const raw = Math.min(width, height) / 5;
  // Потолок никогда не опускается ниже серверного минимума: иначе поле размера
  // в профиле зажималось в [1..1], каждый blur сохранял питомцу минимум, и
  // менять размер становилось невозможно.
  return Number.isFinite(raw) && raw > MIN_PET_SIZE ? Math.floor(raw) : MIN_PET_SIZE;
}

export default function useMaxPetSize(): number {
  const [size, setSize] = useState(getMaxPetSize);
  useEffect(() => {
    const update = () => setSize(getMaxPetSize());
    const viewport = window.visualViewport;
    window.addEventListener('resize', update);
    viewport?.addEventListener('resize', update);
    // Первый замер может попасть на неразложенное окно — перепроверяем после
    // кадра и через короткую паузу, когда геометрия уже честная.
    const raf = requestAnimationFrame(update);
    const timer = setTimeout(update, 250);
    return () => {
      window.removeEventListener('resize', update);
      viewport?.removeEventListener('resize', update);
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, []);
  return size;
}