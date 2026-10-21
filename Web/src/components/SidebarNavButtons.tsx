import React, { useEffect, useRef, useState } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import { useMobileNavStore } from '../store/mobileNavStore';
import type { NavKey } from '../utils/mobileNav';
import { membranePressSx } from '../styles/motion';
import { UI_NAV_INNER_RADIUS, useUiPrefsStore, compactNavButtonPx, compactNavIconPx } from '../store/uiPrefsStore';

/**
 * Кнопки нижней панели сайдбара на ПК (профиль, музыка, редактор, архив).
 * Порядок меняется перетаскиванием: зажал кнопку мышкой и повёл. На сенсорном
 * экране ноутбука работает удержание, как в мобильной навигации.
 */
export interface SidebarNavItem {
  title: string;
  /** Короткая подпись под иконкой в виде «как на телефоне». */
  label?: string;
  icon: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}

interface Props {
  items: Record<NavKey, SidebarNavItem>;
  color: string;
  accent: string;
  /** compact — строка иконок; phone — кнопки с подписями, как в MobileBottomNav. */
  variant?: 'compact' | 'phone';
}

/** Мышью: сдвиг с зажатой кнопкой, после которого начинается перетаскивание. */
const DRAG_THRESHOLD_PX = 5;
/** Пальцем/пером: сколько держать до перетаскивания (как в MobileBottomNav). */
const LONG_PRESS_MS = 450;
/** Пальцем: сдвиг до удержания означает, что это не long-press. */
const TOUCH_TOLERANCE_PX = 10;

interface PressState {
  key: NavKey;
  pointerId: number;
  mouse: boolean;
  x: number;
  y: number;
  timer: number;
  dragging: boolean;
}

export default function SidebarNavButtons({ items, color, accent, variant = 'compact' }: Props) {
  const phone = variant === 'phone';
  // Ползунок «Высота нижней панели»: при 70 кнопка прежние 54px.
  const navHeight = useUiPrefsStore((s) => s.navHeight);
  const phoneLabels = navHeight >= 60;
  const order = useMobileNavStore((s) => s.desktopOrder);
  const moveDesktop = useMobileNavStore((s) => s.moveDesktop);
  const [dragKey, setDragKey] = useState<NavKey | null>(null);
  // DOM-порядок на время перетаскивания заморожен, места меняет CSS `order`:
  // если React переставит узел с захваченным указателем, захват слетит.
  const [frozenOrder, setFrozenOrder] = useState<NavKey[] | null>(null);
  const press = useRef<PressState | null>(null);
  const suppressClick = useRef(false);
  const itemEls = useRef<Partial<Record<NavKey, HTMLElement | null>>>({});

  useEffect(() => () => {
    if (press.current) window.clearTimeout(press.current.timer);
  }, []);

  const startDrag = (key: NavKey) => {
    if (!press.current) return;
    press.current.dragging = true;
    setFrozenOrder(useMobileNavStore.getState().desktopOrder);
    setDragKey(key);
  };

  const endPress = () => {
    const p = press.current;
    if (!p) return;
    window.clearTimeout(p.timer);
    // После перетаскивания браузер пришлёт click: его надо съесть.
    if (p.dragging) suppressClick.current = true;
    press.current = null;
    setDragKey(null);
    setFrozenOrder(null);
  };

  const onPointerDown = (key: NavKey) => (e: React.PointerEvent<HTMLElement>) => {
    const mouse = e.pointerType === 'mouse';
    if (mouse && e.button !== 0) return;
    if (press.current) window.clearTimeout(press.current.timer);
    suppressClick.current = false;
    const timer = mouse ? 0 : window.setTimeout(() => startDrag(key), LONG_PRESS_MS);
    press.current = { key, pointerId: e.pointerId, mouse, x: e.clientX, y: e.clientY, timer, dragging: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* старые браузеры */ }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (!p.dragging) {
      const dist = Math.hypot(e.clientX - p.x, e.clientY - p.y);
      if (p.mouse) {
        if (dist < DRAG_THRESHOLD_PX) return;
        startDrag(p.key);
      } else {
        if (dist > TOUCH_TOLERANCE_PX) {
          window.clearTimeout(p.timer);
          press.current = null;
        }
        return;
      }
    }
    // Кнопки стоят строкой или столбиком, поэтому сверяем обе оси.
    for (const [k, el] of Object.entries(itemEls.current) as [NavKey, HTMLElement | null][]) {
      if (!el || k === p.key) continue;
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        moveDesktop(p.key, k);
        break;
      }
    }
  };

  const onItemClick = (onClick: () => void) => () => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    onClick();
  };

  const renderItem = (key: NavKey) => {
    const { title, label, icon, onClick, active } = items[key];
    const dragging = dragKey === key;
    return (
      <Box
        key={key}
        ref={(el: HTMLElement | null) => { itemEls.current[key] = el; }}
        sx={{
          display: 'flex', order: order.indexOf(key), position: 'relative', zIndex: dragging ? 1 : 0,
          // На «телефонной» плашке кнопки делят ширину поровну.
          // В строке/столбике иконок кнопки не сжимаются.
          ...(phone ? { flex: 1, minWidth: 0, justifyContent: 'center' } : { flexShrink: 0 }),
        }}
      >
        {/* Пока что-то тащат, подсказки только мешают. */}
        <Tooltip title={dragKey ? '' : title}>
          <IconButton
            aria-label={title}
            aria-grabbed={dragging || undefined}
            onClick={onItemClick(onClick)}
            onPointerDown={onPointerDown(key)}
            onPointerMove={onPointerMove}
            onPointerUp={endPress}
            onPointerCancel={endPress}
            onLostPointerCapture={endPress}
            onContextMenu={(e) => { if (press.current?.dragging) e.preventDefault(); }}
            // Иначе браузер может начать нативное перетаскивание иконки.
            onDragStart={(e) => e.preventDefault()}
            sx={{
              color: active || dragging ? accent : color,
              ...membranePressSx,
              touchAction: 'none',
              userSelect: 'none', WebkitUserSelect: 'none',
              cursor: dragging ? 'grabbing' : 'pointer',
              bgcolor: dragging ? `${accent}33` : phone && active ? `${accent}20` : undefined,
              boxShadow: dragging ? `0 6px 18px rgba(0,0,0,.35), 0 0 0 1px ${accent}66` : undefined,
              transform: dragging ? 'scale(1.12)' : undefined,
              // membranePressSx сжимает кнопку на :active, а её как раз держат.
              ...(dragging ? { '&:active': { transform: 'scale(1.12)' } } : {}),
              // Вид «как на телефоне»: иконка с подписью, как в MobileBottomNav.
              ...(phone ? {
                width: '100%', maxWidth: 76, height: navHeight - 16, borderRadius: UI_NAV_INNER_RADIUS,
                display: 'flex', flexDirection: 'column', gap: 0.25,
                '&:hover': { bgcolor: `${accent}18` },
                '& .MuiSvgIcon-root': { fontSize: 24 },
              } : {
                // Компактная строка: размер кнопки тоже от ползунка высоты (при 70 — 40px).
                width: compactNavButtonPx(navHeight), height: compactNavButtonPx(navHeight),
                '& .MuiSvgIcon-root': { fontSize: compactNavIconPx(navHeight) },
              }),
            }}
          >
            {icon}
            {phone && phoneLabels && (
              <Box component="span" sx={{ fontSize: 10, lineHeight: 1, whiteSpace: 'nowrap' }}>
                {label ?? title}
              </Box>
            )}
          </IconButton>
        </Tooltip>
      </Box>
    );
  };

  return <>{(frozenOrder ?? order).map(renderItem)}</>;
}
