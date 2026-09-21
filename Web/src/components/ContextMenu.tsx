import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, Typography } from '@mui/material';
import { useThemeStore } from '../store/themeStore';

export interface ContextMenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean; // рисуется линия ПЕРЕД этим пунктом
  hint?: string;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  title?: string;
}

/**
 * Единая плашка контекстного меню (Steam-like):
 * — стеклянный фон, скруглённые углы 14,
 * — иконка слева, лейбл, опциональный hint справа,
 * — hover: подсветка akcent'ом и лёгкий сдвиг вправо,
 * — плавное появление (fade + scale),
 * — авто-позиционирование, чтобы не вылезать за экран,
 * — закрытие по клику снаружи и по Escape.
 */
export default function ContextMenu({ x, y, items, onClose, title }: Props) {
  const { theme } = useThemeStore();
  const [pos, setPos] = useState({ x, y });
  const [ready, setReady] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    // Корректируем позицию, чтобы плашка не выходила за пределы окна
    const el = ref.current;
    if (!el) return;
    // Layout dimensions are not affected by the opening scale animation.
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const nx = Math.max(8, Math.min(x, vw - width - 8));
    const ny = Math.max(8, Math.min(y, vh - height - 8));
    setPos({ x: nx, y: ny });
    setReady(true);
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // clientX/clientY use viewport coordinates. A portal prevents transformed
  // message/list ancestors from becoming the fixed menu's containing block.
  return createPortal(
    <Box
      onClick={onClose}
      onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      sx={{ position: 'fixed', inset: 0, zIndex: 2000 }}>
      <Box
        ref={ref}
        onClick={(e) => e.stopPropagation()}
        sx={{
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          minWidth: 220,
          maxWidth: 'calc(100vw - 16px)',
          maxHeight: 'calc(100vh - 16px)',
          boxSizing: 'border-box',
          bgcolor: theme.bgHeader + 'F2',
          backdropFilter: 'blur(14px) saturate(140%)',
          WebkitBackdropFilter: 'blur(14px) saturate(140%)',
          border: `1px solid ${theme.border}`,
          borderRadius: 3,
          boxShadow: '0 20px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04) inset',
          p: 0.75,
          opacity: ready ? 1 : 0,
          transform: ready ? 'scale(1)' : 'scale(0.96)',
          transformOrigin: 'top left',
          transition: 'opacity 120ms ease, transform 140ms cubic-bezier(.2,.9,.3,1.2)',
          overflowY: 'auto',
        }}>
        {title && (
          <Typography sx={{
            fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
            color: theme.textSec, px: 1.5, py: 0.75,
          }}>{title}</Typography>
        )}
        {items.map((it) => (
          <React.Fragment key={it.key}>
            {it.divider && (
              <Box sx={{ height: 1, bgcolor: theme.border, my: 0.5, mx: 0.5, opacity: 0.6 }} />
            )}
            <Box
              onClick={() => { if (!it.disabled) { it.onClick(); onClose(); } }}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1.25,
                px: 1.25, py: 1,
                borderRadius: 2,
                cursor: it.disabled ? 'not-allowed' : 'pointer',
                color: it.disabled ? theme.textSec : (it.danger ? '#ff6b6b' : theme.text),
                opacity: it.disabled ? 0.5 : 1,
                fontSize: 14,
                transition: 'background-color 120ms ease, transform 120ms ease, color 120ms ease',
                '&:hover': it.disabled ? {} : {
                  bgcolor: it.danger ? 'rgba(255,80,80,0.12)' : theme.accent + '22',
                  color: it.danger ? '#ff6b6b' : theme.text,
                  transform: 'translateX(2px)',
                },
                '& svg': { fontSize: 18, color: 'inherit', opacity: 0.85 },
              }}>
              {it.icon}
              <Typography sx={{ flex: 1, fontSize: 14, color: 'inherit' }}>{it.label}</Typography>
              {it.hint && (
                <Typography sx={{ fontSize: 11, color: theme.textSec, opacity: 0.7 }}>{it.hint}</Typography>
              )}
            </Box>
          </React.Fragment>
        ))}
      </Box>
    </Box>,
    document.body
  );
}
