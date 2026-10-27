import { useEffect, useState } from 'react';

/**
 * Текущая ширина окна с подпиской на resize.
 *
 * Читать window.innerWidth прямо в рендере нельзя: компонент не узнаёт о
 * смене размера окна и держит устаревшее значение, пока его не перерисует
 * что-то другое. После сворачивания/разворачивания окна раскладка из-за этого
 * расходилась (например, ширина боковой панели плеера и отступ под неё).
 */
export default function useWindowWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth));
  useEffect(() => {
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setWidth(window.innerWidth));
    };
    window.addEventListener('resize', update);
    // Значение могло измениться между первым рендером и подпиской.
    update();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
    };
  }, []);
  return width;
}
