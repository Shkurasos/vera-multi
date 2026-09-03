import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Box, Typography, IconButton, Tooltip } from '@mui/material';
import { Close, ContentCopy } from '@mui/icons-material';
import { useAuthStore } from '../store/authStore';

/**
 * DEV-оверлей инспектора элементов.
 * Активируется только у пользователей с user.isDev === true (DEV_IPS на сервере).
 *
 * Как открыть: наведись на элемент и нажми Z — откроется панель
 * с информацией о компоненте, его кодом, путём к файлу и структурой.
 */

interface Snapshot {
  tag: string;
  id: string;
  classes: string;
  testId: string;
  componentName: string;
  filePath: string;
  domPath: string;
  outerHTML: string;
  textPreview: string;
  props: Record<string, any>;
  x: number;
  y: number;
}

// Пробуем достать имя React-компонента и его props из fiber (внутренний ключ __reactFiber$...).
function getReactInfo(el: Element): { name: string; props: Record<string, any>; filePath: string } {
  try {
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
    if (!key) return { name: '', props: {}, filePath: '' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fiber: any = (el as any)[key];
    let componentName = '';
    let componentProps: Record<string, any> = {};
    let filePath = '';
    
    while (fiber) {
      const t = fiber.type;
      
      // Получаем имя компонента
      if (!componentName) {
        if (typeof t === 'function' && t.name) componentName = t.name;
        else if (t && typeof t === 'object' && t.displayName) componentName = t.displayName;
        else if (t && typeof t === 'object' && t.render?.name) componentName = t.render.name;
      }
      
      // Получаем props
      if (fiber.memoizedProps && Object.keys(fiber.memoizedProps).length > 0) {
        componentProps = { ...fiber.memoizedProps };
        // Убираем children для читаемости
        if ('children' in componentProps && typeof componentProps.children === 'object') {
          componentProps.children = '[React Element]';
        }
      }
      
      // Пытаемся найти путь к файлу через _debugSource
      if (fiber._debugSource) {
        const src = fiber._debugSource;
        if (src.fileName) {
          filePath = src.fileName.replace(/^.*\/src\//, 'src/');
          if (src.lineNumber) filePath += `:${src.lineNumber}`;
        }
      }
      
      if (componentName && filePath) break;
      fiber = fiber.return;
    }
    
    return { name: componentName, props: componentProps, filePath };
  } catch (e) {
    console.error('getReactInfo error:', e);
  }
  return { name: '', props: {}, filePath: '' };
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
  const [hoveredElement, setHoveredElement] = useState<Element | null>(null);
  const hoveredRef = useRef<Element | null>(null);

  // Отслеживание наведения мыши
  const onMouseMove = useCallback((e: MouseEvent) => {
    const target = e.target as Element | null;
    if (!target) return;
    // Не подсвечиваем сам оверлей
    if ((target as HTMLElement).closest('[data-dev-inspector]')) return;
    hoveredRef.current = target;
    setHoveredElement(target);
  }, []);

  // Отслеживание нажатия клавиши Z
  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key.toLowerCase() === 'z' && hoveredRef.current) {
      e.preventDefault();
      const target = hoveredRef.current;
      const cls = typeof target.className === 'string' ? target.className : '';
      const reactInfo = getReactInfo(target);
      
      // Получаем outerHTML (первые 500 символов для читаемости)
      let html = target.outerHTML || '';
      if (html.length > 500) html = html.slice(0, 500) + '...';
      
      setSnap({
        tag: target.tagName.toLowerCase(),
        id: target.id || '',
        classes: cls,
        testId: target.getAttribute('data-testid') || '',
        componentName: reactInfo.name,
        filePath: reactInfo.filePath,
        domPath: buildDomPath(target),
        outerHTML: html,
        textPreview: (target.textContent || '').trim().slice(0, 80),
        props: reactInfo.props,
        x: (target as HTMLElement).getBoundingClientRect().left,
        y: (target as HTMLElement).getBoundingClientRect().top,
      });
    }
  }, []);

  useEffect(() => {
    if (!isDev) return;
    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [isDev, onMouseMove, onKeyDown]);

  if (!isDev) return null;

  // Подсветка наведённого элемента
  const highlightBox = hoveredElement && !snap ? (() => {
    const rect = hoveredElement.getBoundingClientRect();
    return (
      <Box
        sx={{
          position: 'fixed',
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          border: '2px solid #7C6AF7',
          pointerEvents: 'none',
          zIndex: 99998,
          boxShadow: 'inset 0 0 0 2000px rgba(124,106,247,0.1)',
        }}
      />
    );
  })() : null;

  if (!snap) return highlightBox;

  const dump = JSON.stringify(
    {
      component: snap.componentName || '(нет)',
      file: snap.filePath || '(не найден)',
      tag: snap.tag,
      id: snap.id,
      classes: snap.classes,
      testId: snap.testId,
      domPath: snap.domPath,
      props: Object.keys(snap.props).length > 0 ? snap.props : '(нет)',
      html: snap.outerHTML,
    },
    null,
    2,
  );

  const copy = () => {
    try { navigator.clipboard.writeText(dump); } catch {}
  };

  // Позиционируем панель рядом с элементом, но не за экраном.
  const W = 500;
  const H = 400;
  const left = Math.min(snap.x + 12, window.innerWidth - W - 8);
  const top = Math.min(snap.y + 12, window.innerHeight - H - 8);

  return (
    <>
      {highlightBox}
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
            DEV INSPECTOR (нажми Z)
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
        
        {snap.filePath && (
          <Box sx={{ mb: 1, p: 1, bgcolor: 'rgba(124,106,247,0.15)', borderRadius: 1 }}>
            <Typography sx={{ fontSize: 11, color: '#7C6AF7', fontWeight: 700 }}>
              📁 {snap.filePath}
            </Typography>
          </Box>
        )}
        
        <Typography component="pre" sx={{
          m: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          color: '#e6e6f0',
        }}>{dump}</Typography>
      </Box>
    </>
  );
}
