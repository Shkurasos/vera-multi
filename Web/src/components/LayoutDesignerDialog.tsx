import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box,
  Slider, Stack, ToggleButton, ToggleButtonGroup, IconButton, Tooltip, Divider,
  useMediaQuery,
} from '@mui/material';
import { Close, RestartAlt, SwapHoriz, Undo } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import {
  useUserSettingsStore, LayoutSettings,
  SidePos, VertPos, Density,
} from '../store/userSettingsStore';

/**
 * Визуальный конструктор макета: схематичное превью,
 * где основные блоки можно перетаскивать/переключать,
 * а также слайдеры для точной настройки размеров.
 * Все изменения пишутся в userSettingsStore.layout и применяются
 * ко всему реальному интерфейсу в реальном времени.
 */

type Props = { open: boolean; onClose: () => void };

const PRESETS: { id: string; label: string; layout: Partial<LayoutSettings> }[] = [
  { id: 'default', label: 'Обычный',
    layout: { sidebarSide: 'left', sidebarWidth: 300, chatHeaderPos: 'top', chatInputPos: 'bottom',
              density: 'cozy', radius: 10, chatOuterMargin: 8, bubbleRadius: 14 } },
  { id: 'compact', label: 'Компактный',
    layout: { sidebarSide: 'left', sidebarWidth: 240, chatHeaderPos: 'top', chatInputPos: 'bottom',
              density: 'compact', radius: 6, chatOuterMargin: 4, bubbleRadius: 10 } },
  { id: 'roomy', label: 'Просторный',
    layout: { sidebarSide: 'left', sidebarWidth: 340, chatHeaderPos: 'top', chatInputPos: 'bottom',
              density: 'roomy', radius: 16, chatOuterMargin: 14, bubbleRadius: 20 } },
  { id: 'right', label: 'Панель справа',
    layout: { sidebarSide: 'right', sidebarWidth: 300, chatHeaderPos: 'top', chatInputPos: 'bottom',
              density: 'cozy', radius: 10, chatOuterMargin: 8, bubbleRadius: 14 } },
];

const PREVIEW_W = 520;
const PREVIEW_H = 340;
const SIDEBAR_PREVIEW_MIN = 60;
const SIDEBAR_PREVIEW_MAX = 220;
const REAL_MIN = 200;
const REAL_MAX = 520;

function realToPreview(real: number) {
  const t = (real - REAL_MIN) / (REAL_MAX - REAL_MIN);
  return SIDEBAR_PREVIEW_MIN + t * (SIDEBAR_PREVIEW_MAX - SIDEBAR_PREVIEW_MIN);
}
function previewToReal(preview: number) {
  const t = (preview - SIDEBAR_PREVIEW_MIN) / (SIDEBAR_PREVIEW_MAX - SIDEBAR_PREVIEW_MIN);
  return Math.round(REAL_MIN + t * (REAL_MAX - REAL_MIN));
}

export default function LayoutDesignerDialog({ open, onClose }: Props) {
  const { theme } = useThemeStore();
  const layout = useUserSettingsStore((s) => s.layout);
  const setLayout = useUserSettingsStore((s) => s.setLayout);
  const resetLayout = useUserSettingsStore((s) => s.resetLayout);
  const fullScreen = useMediaQuery('(max-width: 700px)');

  const previewRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<null | 'sidebar-resize'>(null);
  const [flashPreset, setFlashPreset] = useState<string | null>(null);
  const [dragSide, setDragSide] = useState<boolean>(false);

  // Снапшот layout на момент открытия — для кнопки «Отменить изменения».
  const initialLayoutRef = useRef<LayoutSettings | null>(null);
  useEffect(() => {
    if (open && !initialLayoutRef.current) {
      initialLayoutRef.current = { ...layout };
    }
    if (!open) initialLayoutRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const revertChanges = useCallback(() => {
    const snap = initialLayoutRef.current;
    if (!snap) return;
    (Object.keys(snap) as (keyof LayoutSettings)[]).forEach((k) => {
      setLayout(k, snap[k] as any);
    });
  }, [setLayout]);

  const onResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging('sidebar-resize');
  }, []);
  const onResizeMove = useCallback((e: React.PointerEvent) => {
    if (dragging !== 'sidebar-resize') return;
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) return;
    const local = layout.sidebarSide === 'right'
      ? rect.right - e.clientX
      : e.clientX - rect.left;
    const clamped = Math.min(Math.max(local, SIDEBAR_PREVIEW_MIN), SIDEBAR_PREVIEW_MAX);
    setLayout('sidebarWidth', previewToReal(clamped));
  }, [dragging, layout.sidebarSide, setLayout]);
  const onResizeEnd = useCallback(() => setDragging(null), []);

  const onSidebarDragStart = useCallback((e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragSide(true);
  }, []);
  const onSidebarDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragSide) return;
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) return;
    const midX = rect.left + rect.width / 2;
    const nextSide: SidePos = e.clientX > midX ? 'right' : 'left';
    if (nextSide !== layout.sidebarSide) setLayout('sidebarSide', nextSide);
  }, [dragSide, layout.sidebarSide, setLayout]);
  const onSidebarDragEnd = useCallback(() => setDragSide(false), []);

  useEffect(() => {
    if (!flashPreset) return;
    const t = setTimeout(() => setFlashPreset(null), 700);
    return () => clearTimeout(t);
  }, [flashPreset]);

  const previewSidebarW = realToPreview(layout.sidebarWidth);
  const previewChatX = layout.sidebarSide === 'left' ? previewSidebarW : 0;
  const previewChatW = PREVIEW_W - previewSidebarW;
  const sidebarLeft = layout.sidebarSide === 'left' ? 0 : PREVIEW_W - previewSidebarW;
  const HEADER_H = 34;
  const INPUT_H = 40;
  const marginPx = Math.round(layout.chatOuterMargin * 0.6);
  const radiusPx = Math.min(layout.radius, 18);

  const applyPreset = (p: typeof PRESETS[number]) => {
    Object.entries(p.layout).forEach(([k, v]) => setLayout(k as keyof LayoutSettings, v as any));
    setFlashPreset(p.id);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" fullScreen={fullScreen}
      PaperProps={{ sx: { bgcolor: theme.bg, color: theme.text, border: `1px solid ${theme.border}`, borderRadius: 3 } }}>
      <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        🎨 Визуальный конструктор макета
        <IconButton size="small" onClick={onClose} sx={{ color: theme.textSec }}>
          <Close />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ bgcolor: theme.bgChat }}>
        <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 1.5 }}>
          Перетащите панель чатов на другую сторону, потяните её край, кликните шапку или поле ввода — превью
          и весь интерфейс обновятся в реальном времени.
        </Typography>

        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
          <Box ref={previewRef} sx={{
            position: 'relative', width: PREVIEW_W, maxWidth: '100%', height: PREVIEW_H,
            bgcolor: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 2,
            overflow: 'hidden', userSelect: 'none', touchAction: 'none',
          }}>
            {/* Сайдбар */}
            <Box
              onPointerDown={onSidebarDragStart}
              onPointerMove={onSidebarDragMove}
              onPointerUp={onSidebarDragEnd}
              onPointerCancel={onSidebarDragEnd}
              sx={{
                position: 'absolute', top: 0, bottom: 0,
                left: sidebarLeft, width: previewSidebarW,
                background: theme.sidebarGradient || theme.bgSidebar || theme.bgHeader,
                borderRight: layout.sidebarSide === 'left' ? `1px solid ${theme.border}` : 'none',
                borderLeft: layout.sidebarSide === 'right' ? `1px solid ${theme.border}` : 'none',
                cursor: 'grab',
                transition: dragging || dragSide ? 'none' : 'left 220ms ease, width 180ms ease',
                display: 'flex', flexDirection: 'column', p: 1, gap: 0.5,
              }}
            >
              <Box sx={{ height: 18, bgcolor: theme.bgHover, borderRadius: 1, opacity: 0.85 }} />
              {[0,1,2,3,4].map((i) => (
                <Box key={i} sx={{ height: 22, bgcolor: theme.bgHover, borderRadius: 1, opacity: 0.55 - i * 0.05 }} />
              ))}
              <Box sx={{
                position: 'absolute', bottom: 6, left: 6, right: 6,
                fontSize: 10, textAlign: 'center', color: theme.textSec,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5,
                opacity: 0.7,
              }}>
                <SwapHoriz sx={{ fontSize: 12 }} /> потяни
              </Box>
            </Box>

            {/* Ручка ресайза сайдбара */}
            <Box
              onPointerDown={onResizeStart}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeEnd}
              onPointerCancel={onResizeEnd}
              sx={{
                position: 'absolute', top: 0, bottom: 0,
                left: layout.sidebarSide === 'left' ? previewSidebarW - 4 : PREVIEW_W - previewSidebarW - 4,
                width: 8, cursor: 'ew-resize', zIndex: 3,
                '&:hover::after, &:active::after': { opacity: 1 },
                '&::after': {
                  content: '""', position: 'absolute', inset: 0,
                  background: theme.accent, opacity: 0, transition: 'opacity 160ms ease',
                },
              }}
            />


            {/* Область чата */}
            <Box sx={{
              position: 'absolute',
              top: marginPx, bottom: marginPx,
              left: previewChatX + marginPx, width: previewChatW - marginPx * 2,
              bgcolor: theme.bgChat, border: `1px solid ${theme.border}`,
              borderRadius: `${radiusPx}px`, overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
              transition: dragging ? 'none' : 'all 200ms ease',
            }}>
              <Box
                onClick={() => setLayout('chatHeaderPos', layout.chatHeaderPos === 'top' ? 'bottom' : 'top')}
                sx={{
                  order: layout.chatHeaderPos === 'bottom' ? 3 : 0,
                  height: HEADER_H, flexShrink: 0, bgcolor: theme.bgHeader,
                  borderBottom: layout.chatHeaderPos === 'top' ? `1px solid ${theme.border}` : 'none',
                  borderTop: layout.chatHeaderPos === 'bottom' ? `1px solid ${theme.border}` : 'none',
                  display: 'flex', alignItems: 'center', gap: 0.7, px: 1, cursor: 'pointer',
                  '&:hover': { bgcolor: theme.bgHover },
                }}
              >
                <Box sx={{ width: 18, height: 18, borderRadius: '50%', bgcolor: theme.accent }} />
                <Box sx={{ flex: 1, height: 8, bgcolor: theme.bgHover, borderRadius: 1 }} />
                <Typography sx={{ fontSize: 9, color: theme.textSec }}>
                  шапка · {layout.chatHeaderPos === 'top' ? 'сверху' : 'снизу'}
                </Typography>
              </Box>

              <Box sx={{
                order: 2, flex: 1, minHeight: 0,
                display: 'flex', flexDirection: 'column', gap: 0.6, p: 1,
                background: `linear-gradient(180deg, ${theme.bgChat}, ${theme.bg})`,
                overflow: 'hidden',
              }}>
                {[
                  { own: false, w: '55%' }, { own: true, w: '45%' },
                  { own: false, w: '70%' }, { own: true, w: '38%' },
                ].map((m, i) => (
                  <Box key={i} sx={{
                    alignSelf: m.own ? 'flex-end' : 'flex-start',
                    width: m.w, height: 14,
                    bgcolor: m.own ? theme.accent : ((theme as any).bgBubbleOther || theme.bgHover),
                    borderRadius: m.own
                      ? `${layout.bubbleRadius}px ${layout.bubbleRadius}px 4px ${layout.bubbleRadius}px`
                      : `${layout.bubbleRadius}px ${layout.bubbleRadius}px ${layout.bubbleRadius}px 4px`,
                    opacity: 0.9,
                  }} />
                ))}
              </Box>

              <Box
                onClick={() => setLayout('chatInputPos', layout.chatInputPos === 'bottom' ? 'top' : 'bottom')}
                sx={{
                  order: layout.chatInputPos === 'top' ? 1 : 4,
                  height: INPUT_H, flexShrink: 0, bgcolor: theme.bgHeader,
                  borderTop: layout.chatInputPos === 'bottom' ? `1px solid ${theme.border}` : 'none',
                  borderBottom: layout.chatInputPos === 'top' ? `1px solid ${theme.border}` : 'none',
                  display: 'flex', alignItems: 'center', gap: 0.7, px: 1, cursor: 'pointer',
                  position: 'relative',
                  '&:hover': { bgcolor: theme.bgHover },
                }}
              >
                <Box sx={{ flex: 1, height: 20, bgcolor: (theme as any).bgInput || theme.bgHover, borderRadius: 2 }} />
                <Box sx={{ width: 22, height: 22, borderRadius: '50%', bgcolor: theme.accent }} />
                <Typography sx={{ fontSize: 9, color: theme.textSec, position: 'absolute', bottom: 2, right: 8 }}>
                  ввод · {layout.chatInputPos === 'bottom' ? 'снизу' : 'сверху'}
                </Typography>
              </Box>
            </Box>
          </Box>
        </Box>

        <Divider sx={{ borderColor: theme.border, my: 2 }} />

        <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 1, fontWeight: 600 }}>
          Быстрые пресеты
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, mb: 2 }}>
          {PRESETS.map((p) => (
            <Button key={p.id} size="small" variant="outlined"
              onClick={() => applyPreset(p)}
              sx={{
                textTransform: 'none', borderRadius: 2,
                color: flashPreset === p.id ? '#fff' : theme.text,
                bgcolor: flashPreset === p.id ? theme.accent : 'transparent',
                borderColor: theme.border,
                '&:hover': { borderColor: theme.accent, bgcolor: theme.accent + '18' },
              }}>
              {p.label}
            </Button>
          ))}
        </Stack>

        <Stack spacing={2}>
          <Box>
            <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>
              Ширина панели чатов — {layout.sidebarWidth}px
            </Typography>
            <Slider min={REAL_MIN} max={REAL_MAX} step={5} value={layout.sidebarWidth}
              onChange={(_, v) => setLayout('sidebarWidth', Array.isArray(v) ? v[0] : v)} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>
              Скругление углов окна — {layout.radius}px
            </Typography>
            <Slider min={0} max={28} step={1} value={layout.radius}
              onChange={(_, v) => setLayout('radius', Array.isArray(v) ? v[0] : v)} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>
              Скругление пузырьков сообщений — {layout.bubbleRadius}px
            </Typography>
            <Slider min={4} max={28} step={1} value={layout.bubbleRadius}
              onChange={(_, v) => setLayout('bubbleRadius', Array.isArray(v) ? v[0] : v)} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>
              Внешний отступ окна чата — {layout.chatOuterMargin}px
            </Typography>
            <Slider min={0} max={24} step={1} value={layout.chatOuterMargin}
              onChange={(_, v) => setLayout('chatOuterMargin', Array.isArray(v) ? v[0] : v)} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>Плотность интерфейса</Typography>
            <ToggleButtonGroup exclusive size="small" fullWidth
              value={layout.density}
              onChange={(_, v) => v && setLayout('density', v as Density)}>
              <ToggleButton value="compact">Компактно</ToggleButton>
              <ToggleButton value="cozy">Обычно</ToggleButton>
              <ToggleButton value="roomy">Просторно</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>Плеер</Typography>
            <ToggleButtonGroup exclusive size="small" fullWidth
              value={layout.playerPos}
              onChange={(_, v) => v && setLayout('playerPos', v as VertPos)}>
              <ToggleButton value="bottom">Снизу</ToggleButton>
              <ToggleButton value="top">Сверху</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>Сторона панели чатов (десктоп)</Typography>
            <ToggleButtonGroup exclusive size="small" fullWidth
              value={layout.sidebarSide}
              onChange={(_, v) => v && setLayout('sidebarSide', v as SidePos)}>
              <ToggleButton value="left"><SwapHoriz sx={{ mr: 0.5, fontSize: 16 }} />Слева</ToggleButton>
              <ToggleButton value="right">Справа<SwapHoriz sx={{ ml: 0.5, fontSize: 16 }} /></ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>Мобильная нижняя навигация</Typography>
            <ToggleButtonGroup exclusive size="small" fullWidth
              value={layout.mobileNavPos}
              onChange={(_, v) => v && setLayout('mobileNavPos', v as VertPos)}>
              <ToggleButton value="bottom">Снизу</ToggleButton>
              <ToggleButton value="top">Сверху</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>Отображение списка чатов</Typography>
            <Stack direction="row" spacing={1}>
              <ToggleButton size="small" selected={layout.showAvatarsInList}
                onClick={() => setLayout('showAvatarsInList', !layout.showAvatarsInList)}
                value="avatars" sx={{ flex: 1, textTransform: 'none' }}>
                Аватары
              </ToggleButton>
              <ToggleButton size="small" selected={layout.showTabs}
                onClick={() => setLayout('showTabs', !layout.showTabs)}
                value="tabs" sx={{ flex: 1, textTransform: 'none' }}>
                Вкладки
              </ToggleButton>
            </Stack>
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ bgcolor: theme.bg, borderTop: `1px solid ${theme.border}` }}>
        <Tooltip title="Вернуть настройки макета по умолчанию">
          <Button startIcon={<RestartAlt />} onClick={resetLayout}
            sx={{ color: theme.textSec, textTransform: 'none' }}>
            Сбросить
          </Button>
        </Tooltip>
        <Tooltip title="Откатить все изменения, сделанные в этом диалоге">
          <Button startIcon={<Undo />} onClick={revertChanges}
            sx={{ color: theme.textSec, textTransform: 'none' }}>
            Отменить изменения
          </Button>
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" onClick={onClose}
          sx={{ bgcolor: theme.accent, textTransform: 'none', '&:hover': { bgcolor: theme.accent } }}>
          Готово
        </Button>
      </DialogActions>
    </Dialog>
  );
}
