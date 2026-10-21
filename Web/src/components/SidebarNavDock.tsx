import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';

/**
 * Слой панели кнопок сайдбара. Питомец (MainLayout) лежит на zIndex 30 в корне
 * страницы, а сайдбар — внутри контейнера с zIndex 1 и сам создаёт контекст
 * наложения (backdrop-filter). Поэтому панель выносится порталом в body и
 * встаёт над питомцем и картинкой, и областью нажатий.
 * Ниже диалогов MUI (1300) и подсказок (1500).
 */
export const SIDEBAR_NAV_LAYER = 40;

interface Props {
  /** Отступы места под панель внутри сайдбара. */
  slotSx?: SxProps<Theme>;
  /** Внешний вид самой панели. */
  panelSx: SxProps<Theme>;
  children: React.ReactNode;
}

interface DockRect { left: number; top: number; width: number }

const asArray = (sx?: SxProps<Theme>) => (sx === undefined ? [] : Array.isArray(sx) ? sx : [sx]);

/**
 * В сайдбаре остаётся пустое место нужной высоты, а панель рисуется
 * position: fixed ровно поверх него и следует за ним при ресайзе/переносе.
 */
export default function SidebarNavDock({ slotSx, panelSx, children }: Props) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<() => void>(() => {});
  const [rect, setRect] = useState<DockRect | null>(null);
  const [height, setHeight] = useState(0);

  const rafRef = useRef(0);

  measureRef.current = () => {
    const slot = slotRef.current;
    const panel = panelRef.current;
    if (!slot || !panel) return;
    const r = slot.getBoundingClientRect();
    // Округляем: во время CSS-анимации ширины сайдбара доли пикселя меняются
    // при каждом чтении, и без округления каждый замер давал новый рендер.
    const next = { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width) };
    setRect((prev) => (prev && prev.left === next.left && prev.top === next.top && prev.width === next.width
      ? prev
      : next));
    const h = panel.offsetHeight;
    setHeight((prev) => (prev === h ? prev : h));
  };

  // Замер — не чаще раза в кадр. Раньше он шёл синхронно в useLayoutEffect
  // на каждый рендер: при смене ширины сайдбара (анимация width .2s) каждый
  // замер видел новый rect → setState → снова рендер и замер, и React падал
  // с «Maximum update depth exceeded».
  const scheduleMeasure = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      measureRef.current();
    });
  };

  // Сайдбар перерисовывается при смене стороны/раскладки: место могло сдвинуться.
  useLayoutEffect(() => { scheduleMeasure(); });

  useLayoutEffect(() => {
    // Первый замер сразу, чтобы панель не мигнула невидимой лишний кадр.
    measureRef.current();
    window.addEventListener('resize', scheduleMeasure);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(scheduleMeasure);
      // Само место, панель (её высота), сайдбар (ширина, высота от плеера).
      [slotRef.current, panelRef.current, slotRef.current?.parentElement].forEach((el) => { if (el) ro?.observe(el); });
    }
    return () => {
      window.removeEventListener('resize', scheduleMeasure);
      ro?.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Box ref={slotRef} aria-hidden sx={[{ height, flexShrink: 0 }, ...asArray(slotSx)]} />
      {createPortal(
        <Box
          ref={panelRef}
          sx={[
            ...asArray(panelSx),
            {
              position: 'fixed',
              left: rect?.left ?? 0,
              top: rect?.top ?? 0,
              width: rect?.width ?? 0,
              boxSizing: 'border-box',
              zIndex: SIDEBAR_NAV_LAYER,
              // До первого замера позиция неизвестна — не мигаем в углу.
              visibility: rect ? 'visible' : 'hidden',
            },
          ]}
        >
          {children}
        </Box>,
        document.body,
      )}
    </>
  );
}
