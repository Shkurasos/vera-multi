import React, { useEffect, useState, useCallback } from 'react';
import { Box, Typography, IconButton, Tooltip } from '@mui/material';
import { Close, ContentCopy } from '@mui/icons-material';
import { useAuthStore } from '../store/authStore';

/**
 * DEV-оверлей инспектора элементов.
 * Активируется только у пользователей с user.isDev === true (DEV_IPS на сервере).
 *
 * Как открыть: зажми Ctrl и кликни ПКМ по любому элементу — откроется панель
 * с путём в DOM, классами, id, react-компонентом (если найден в fiber),
 * ближайшим data-testid и кнопкой «Скопировать» для передачи ассистенту.
 */

interface Snapshot {
  tag: string;
  id: string;
  classes: string;
  testId: string;
  componentName: string;
  domPath: string;
  textPreview: string;
  x: number;
  y: number;
}

// Пробуем достать имя React-компонента из fiber (внутренний ключ __reactFiber$...).
function getReactComponentName(el: Element): string {
  try {
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
    if (!key) return '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fiber: any = (el as any)[key];
    while (fiber) {
      const t = fiber.type;
      if (typeof t === 'function' && t.name) return t.name;
      if (t && typeof t === 'object' && t.displayName) return t.displayName;
      if (t && typeof t === 'object' && t.render?.name) return t.render.name;
      fiber = fiber.return;
    }
  } catch {}
  return '';
}

function buildDomPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && cur !== document.body && depth < 6) {
    let seg = cur.tagName.toLowerCase();
    if (cur.id) seg += `#${cur.id}`;
    else if (cur.className && typeof cur.className === 'string') {
      const cls = cur.className.trim().split(/\s+/).slice(0, 2).join('.');
      if (cls) seg += `.${cls}`;
    }
    parts.unshift(seg);
    cur = cur.parentElement;
    depth++;
  }
  return parts.join(' > ');
}

export default function DevInspector() {
  const isDev = useAuthStore(s => !!s.user?.isDev);
  const [snap, setSnap] = useState<Snapshot | null>(null);

  const onContextMenu = useCallback((e: MouseEvent) => {
    if (!e.ctrlKey) return;
    const target = e.target as Element | null;
    if (!target) return;
    // Не перехватываем клик по самому оверлею.
    if ((target as HTMLElement).closest('[data-dev-inspector]')) return;
    e.preventDefault();
    e.stopPropagation();
    const cls = typeof target.className === 'string' ? target.className : '';
    setSnap({
      tag: target.tagName.toLowerCase(),
      id: target.id || '',
      classes: cls,
      testId: target.getAttribute('data-testid') || '',
      componentName: getReactComponentName(target),
      domPath: buildDomPath(target),
      textPreview: (target.textContent || '').trim().slice(0, 160),
      x: e.clientX,
      y: e.clientY,
    });
  }, []);

  useEffect(() => {
    if (!isDev) return;
    window.addEventListener('contextmenu', onContextMenu, true);
    return () => window.removeEventListener('contextmenu', onContextMenu, true);
  }, [isDev, onContextMenu]);

  if (!isDev || !snap) return null;

  const dump = JSON.stringify(
    {
      component: snap.componentName || '(нет)',
      tag: snap.tag,
      id: snap.id,
      classes: snap.classes,
      testId: snap.testId,
      domPath: snap.domPath,
      textPreview: snap.textPreview,
    },
    null,
    2,
  );

  const copy = () => {
    try { navigator.clipboard.writeText(dump); } catch {}
  };

  // Позиционируем панель рядом с курсором, но не за экраном.
  const W = 380;
  const H = 260;
  const left = Math.min(snap.x + 12, window.innerWidth - W - 8);
  const top = Math.min(snap.y + 12, window.innerHeight - H - 8);

  return (
    <Box
      data-dev-inspector
      sx={{
        position: 'fixed', left, top, width: W, maxHeight: H,
        zIndex: 99999, bgcolor: 'rgba(15,15,25,0.96)', color: '#e6e6f0',
        border: '1px solid rgba(124,106,247,0.5)', borderRadius: 2,
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)', p: 1.5,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        overflow: 'auto',
      }}
    >
      <Box display="flex" alignItems="center" gap={1} mb={1}>
        <Typography variant="caption" sx={{ color: '#7C6AF7', fontWeight: 700, flex: 1 }}>
          DEV INSPECTOR
        </Typography>
        <Tooltip title="Скопировать JSON">
          <IconButton size="small" onClick={copy} sx={{ color: '#7C6AF7' }}>
            <ContentCopy fontSize="small" />
          </IconButton>
        </Tooltip>
        <IconButton size="small" onClick={() => setSnap(null)} sx={{ color: '#e6e6f0' }}>
          <Close fontSize="small" />
        </IconButton>
      </Box>
      <Typography component="pre" sx={{
        m: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        color: '#e6e6f0',
      }}>{dump}</Typography>
    </Box>
  );
}
