import { useRef } from 'react';
import type { PointerEvent, KeyboardEvent } from 'react';

type Position = { x: number; y: number };

// A little pointer jitter is a tap; crossing this distance is always a drag,
// even when the pointer subsequently returns to its starting position.
export const PET_DRAG_THRESHOLD = 6;

// Зона прилипания к стене в долях половины питомца (1 — прилипает, как только
// край питомца коснулся стены). Верх и низ липнут слабее: питомец сначала
// упирается в стену и встаёт к ней вплотную, а прилипает, только если дотянуть
// его почти до самого края экрана.
export const PET_SNAP_SIDE = 1;
export const PET_SNAP_TOP_BOTTOM = 0.35;

// Store a docked edge as 0/100 so it survives resizing and reloading.
export function dockPet(position: Position, size: number, width: number, height: number): Position {
  const halfX = Math.min(50, size / 2 / Math.max(width, 1) * 100);
  const halfY = Math.min(50, size / 2 / Math.max(height, 1) * 100);
  const x = Math.max(0, Math.min(100, position.x));
  const y = Math.max(0, Math.min(100, position.y));
  const clampX = Math.max(halfX, Math.min(100 - halfX, x));
  const clampY = Math.max(halfY, Math.min(100 - halfY, y));
  // <= 1 — центр питомца внутри зоны прилипания этой стены.
  const horizontal = Math.min(x, 100 - x) / ((halfX || 1) * PET_SNAP_SIDE);
  const vertical = Math.min(y, 100 - y) / ((halfY || 1) * PET_SNAP_TOP_BOTTOM);
  if (horizontal <= 1 && horizontal <= vertical) {
    return { x: x < 50 ? 0 : 100, y: clampY };
  }
  if (vertical <= 1) {
    return { x: clampX, y: y < 50 ? 0 : 100 };
  }
  // Вне зон прилипания питомец не уходит за край экрана.
  return { x: clampX, y: clampY };
}

export function getPetDock(position: Position) {
  if (position.x <= 0) return 'left';
  if (position.x >= 100) return 'right';
  if (position.y <= 0) return 'top';
  if (position.y >= 100) return 'bottom';
  return null;
}

// Двойной тап по питомцу: правая половина — следующий трек, левая — предыдущий.
// Одиночный тап срабатывает сразу (без задержки), а второй тап в этом окне
// вместо повторного onTap вызывает onDoubleTap — тот сам компенсирует эффект
// первого тапа.
export const PET_DOUBLE_TAP_MS = 280;

export type PetTapSide = 'left' | 'right';

/** Половина питомца под курсором; без размеров элемента считаем правой. */
export function petTapSide(clientX: number, rect?: { left: number; width: number } | null): PetTapSide {
  if (!rect || !(rect.width > 0)) return 'right';
  return clientX < rect.left + rect.width / 2 ? 'left' : 'right';
}

export default function usePetInteraction({ position, size, onMove, onSave, onTap, onDoubleTap }: {
  position: Position;
  size: number;
  onMove: (position: Position) => void;
  onSave: (position: Position) => void;
  onTap: () => void;
  /**
   * Второй тап в течение PET_DOUBLE_TAP_MS после первого (первый уже вызвал onTap).
   * side — половина питомца, по которой пришёлся второй тап.
   */
  onDoubleTap?: (side: PetTapSide) => void;
}) {
  const gesture = useRef<{
    pointerId: number; x: number; y: number; initial: Position; next: Position; dragged: boolean;
  } | null>(null);
  // Время последнего одиночного тапа; null — ждать второго тапа не нужно.
  const lastTapAt = useRef<number | null>(null);

  const tap = (side: PetTapSide) => {
    const now = Date.now();
    if (onDoubleTap && lastTapAt.current !== null && now - lastTapAt.current <= PET_DOUBLE_TAP_MS) {
      lastTapAt.current = null; // третий тап снова считается одиночным
      onDoubleTap(side);
      return;
    }
    lastTapAt.current = now;
    onTap();
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.dragged && Math.hypot(dx, dy) < PET_DRAG_THRESHOLD) return;
    current.dragged = true;
    const width = Math.max(window.innerWidth, 1);
    const height = Math.max(window.innerHeight, 1);
    current.next = dockPet({
      x: current.initial.x + dx / width * 100,
      y: current.initial.y + dy / height * 100,
    }, size, width, height);
    onMove(current.next);
  };

  const cancel = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;
    gesture.current = null;
    if (current.dragged) onMove(current.initial);
  };

  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (!event.isPrimary || event.button !== 0 || gesture.current) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = {
        pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        initial: position, next: position, dragged: false,
      };
    },
    onPointerMove,
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      onPointerMove(event);
      gesture.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      // Внешний контейнер не поворачивается (крутится только тело у стены),
      // поэтому его прямоугольник честно делит питомца на левую и правую половины.
      if (!current.dragged) tap(petTapSide(event.clientX, event.currentTarget.getBoundingClientRect?.()));
      else if (current.next.x !== current.initial.x || current.next.y !== current.initial.y) onSave(current.next);
    },
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (!event.repeat && !gesture.current) onTap();
    },
  };
}