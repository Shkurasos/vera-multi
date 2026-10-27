import React, { useEffect, useRef, useState, lazy, Suspense, forwardRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box, IconButton, Dialog, Button, Slide,
} from '@mui/material';
import type { TransitionProps } from '@mui/material/transitions';
import {
  Chat as ChatIcon,
  LibraryMusic,
  AccountCircle,
  Palette,
  Archive,
  ArrowBack,
} from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { useSidebarViewStore } from '../store/sidebarViewStore';
import { useMobileNavStore } from '../store/mobileNavStore';
import type { NavKey } from '../utils/mobileNav';
import { UI_NAV_RADIUS, UI_NAV_INNER_RADIUS, NAV_HEIGHT_LIMITS, navPanelBackground, useUiPrefsStore } from '../store/uiPrefsStore';
import { useProfileOpenStore } from '../store/profileOpenStore';
import MusicLibrary from './MusicLibrary';
import { SLIDE_IN_MS, SLIDE_OUT_MS, SLIDE_EASE, leaveSlidePage } from '../utils/slidePanel';

const ThemeEditor = lazy(() => import('./ThemeEditor').then(m => ({ default: m.ThemeEditor })));

/** Музыка выезжает справа и уезжает туда же — как профиль и редактор темы. */
const SlideFromRight = forwardRef(function SlideFromRight(
  props: TransitionProps & { children: React.ReactElement },
  ref: React.Ref<unknown>,
) {
  return <Slide direction="left" ref={ref} easing={SLIDE_EASE} {...props} />;
});

// Высота панели — ползунок «Высота нижней панели» (uiPrefsStore.navHeight).
export const MOBILE_NAV = { HEIGHT: NAV_HEIGHT_LIMITS.def };
/** Ниже этой высоты панели подписи под иконками не влезают — остаются иконки. */
const LABELS_MIN_HEIGHT = 60;

/** Сколько держать палец, чтобы кнопку можно было двигать. */
const LONG_PRESS_MS = 450;
/** Сдвиг пальца до срабатывания, после которого это уже не удержание. */
const MOVE_TOLERANCE_PX = 10;

interface PressState {
  key: NavKey;
  pointerId: number;
  x: number;
  y: number;
  timer: number;
  dragging: boolean;
}

export default function MobileBottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useThemeStore();
  const navOpacity = useUiPrefsStore((s) => s.navOpacity);
  const navHeight = useUiPrefsStore((s) => s.navHeight);
  const showLabels = navHeight >= LABELS_MIN_HEIGHT;
  // Режим архива общий с сайдбаром: кнопка «Архив» переключает сам список чатов,
  // поэтому и панель, и список должны знать одно и то же состояние.
  const archiveView = useSidebarViewStore((s) => s.archiveView);
  const toggleArchiveView = useSidebarViewStore((s) => s.toggleArchiveView);
  const [musicOpen, setMusicOpen] = useState(false);
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);
  const [hiding, setHiding] = useState(false);

  // Порядок кнопок задаёт пользователь: зажал кнопку и повёл пальцем.
  const order = useMobileNavStore((s) => s.order);
  const moveNav = useMobileNavStore((s) => s.move);
  const [dragKey, setDragKey] = useState<NavKey | null>(null);
  // Пока кнопку ведут, DOM-порядок заморожен, а места меняются CSS-свойством
  // `order`. Если React переставит узлы прямо под пальцем, браузер может
  // потерять касание (pointercancel), и перетаскивание оборвётся.
  const [frozenOrder, setFrozenOrder] = useState<NavKey[] | null>(null);
  const press = useRef<PressState | null>(null);
  const suppressClick = useRef(false);
  const itemEls = useRef<Partial<Record<NavKey, HTMLElement | null>>>({});

  const activePath = location.pathname;
  const isChatSection = activePath === '/';

  useEffect(() => {
    setMusicOpen(false);
    setThemeEditorOpen(false);
    setHiding(false);
  }, [activePath]);

  // Панель не должна «залипать» невидимой: как только оверлеи (Музыка/Темы)
  // закрыты, снимаем анимационное скрытие. Раньше закрытие «Тем» оставляло
  // hiding=true, и нижняя навигация исчезала до перезагрузки страницы.
  useEffect(() => {
    if (!musicOpen && !themeEditorOpen) setHiding(false);
  }, [musicOpen, themeEditorOpen]);

  // Мобильные браузеры восстанавливают страницу из bfcache, не пересоздавая
  // React-состояние: при возврате на вкладку принудительно показываем панель.
  useEffect(() => {
    const restore = () => setHiding(false);
    const onVisible = () => { if (document.visibilityState === 'visible') setHiding(false); };
    window.addEventListener('pageshow', restore);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('pageshow', restore);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Таймер удержания не должен сработать после размонтирования.
  useEffect(() => () => {
    if (press.current) window.clearTimeout(press.current.timer);
  }, []);

  // В открытом чате нижняя навигация не должна перекрывать переписку.
  if (activePath.startsWith('/chat/')) return null;

  const hideForOpen = (callback: () => void) => {
    // Панель уезжает вниз одновременно с выездом экрана — без паузы перед
    // открытием: раньше ждали 220 мс, и открытие ощущалось медленным.
    setHiding(true);
    callback();
  };

  const openMusic = () => hideForOpen(() => setMusicOpen(true));
  const closeMusic = () => {
    setMusicOpen(false);
    setHiding(false);
  };
  const openThemeEditor = () => hideForOpen(() => setThemeEditorOpen(true));
  const openProfile = () => useProfileOpenStore.getState().setProfileOpen(true);

  // Закрытие «Тем» обязано вернуть панель на место (иначе она «залипала» скрытой).
  const closeThemeEditor = () => { setThemeEditorOpen(false); setHiding(false); };

  // Пока оверлей открыт или идёт анимация — панель скрыта; во всех остальных
  // случаях она обязана быть видимой.
  const navHidden = hiding || musicOpen || themeEditorOpen;

  const items: Record<NavKey, { active: boolean; label: string; onClick: () => void; icon: React.ReactNode }> = {
    editor: { active: themeEditorOpen, label: 'Редактор', onClick: openThemeEditor, icon: <Palette /> },
    profile: { active: useProfileOpenStore.getState().viewProfile, label: 'Профиль', onClick: openProfile, icon: <AccountCircle /> },
    music: { active: musicOpen, label: 'Музыка', onClick: openMusic, icon: <LibraryMusic /> },
    archive: { active: archiveView, label: 'Архив', onClick: toggleArchiveView, icon: <Archive /> },
  };

  const endPress = () => {
    const p = press.current;
    if (!p) return;
    window.clearTimeout(p.timer);
    // После перетаскивания браузер всё равно пришлёт click — его надо съесть,
    // иначе кнопка ещё и откроет свой раздел.
    if (p.dragging) suppressClick.current = true;
    press.current = null;
    setDragKey(null);
    setFrozenOrder(null);
  };

  const onPointerDown = (key: NavKey) => (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (press.current) window.clearTimeout(press.current.timer);
    suppressClick.current = false;
    const timer = window.setTimeout(() => {
      if (!press.current) return;
      press.current.dragging = true;
      setFrozenOrder(useMobileNavStore.getState().order);
      setDragKey(key);
      try { navigator.vibrate?.(15); } catch { /* вибрации может не быть */ }
    }, LONG_PRESS_MS);
    press.current = { key, pointerId: e.pointerId, x: e.clientX, y: e.clientY, timer, dragging: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* старые браузеры */ }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (!p.dragging) {
      // Палец уехал до срабатывания удержания — это не long-press.
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOLERANCE_PX) {
        window.clearTimeout(p.timer);
        press.current = null;
      }
      return;
    }
    // Ищем кнопку, над которой сейчас палец (по горизонтали: панель в одну строку).
    for (const [k, el] of Object.entries(itemEls.current) as [NavKey, HTMLElement | null][]) {
      if (!el || k === p.key) continue;
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right) {
        moveNav(p.key, k);
        break;
      }
    }
  };

  const onItemClick = (onClick: () => void) => () => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    onClick();
  };

  const renderItem = (key: NavKey) => {
    const { active, label, onClick, icon } = items[key];
    const dragging = dragKey === key;
    return (
      <Box
        key={key}
        ref={(el: HTMLElement | null) => { itemEls.current[key] = el; }}
        sx={{
          flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center', position: 'relative',
          order: order.indexOf(key),
          zIndex: dragging ? 1 : 0,
        }}
      >
        <IconButton
          aria-label={label}
          aria-grabbed={dragging || undefined}
          onClick={onItemClick(onClick)}
          onPointerDown={onPointerDown(key)}
          onPointerMove={onPointerMove}
          onPointerUp={endPress}
          onPointerCancel={endPress}
          onLostPointerCapture={endPress}
          // Удержание на Android открывает контекстное меню, на iOS — выноску.
          onContextMenu={(e) => e.preventDefault()}
          sx={{
            // Кнопка = высота панели минус py 0.75 (по 6px): при 70 — прежние 58.
            width: '100%', maxWidth: 76, height: navHeight - 12, borderRadius: UI_NAV_INNER_RADIUS,
            display: 'flex', flexDirection: 'column', gap: 0.25,
            color: active || dragging ? theme.accent : theme.textSec,
            bgcolor: dragging ? `${theme.accent}33` : active ? `${theme.accent}20` : 'transparent',
            '&:hover': { bgcolor: `${theme.accent}18` },
            '& .MuiSvgIcon-root': { fontSize: 25 },
            // Без этого браузер начнёт прокрутку и оборвёт перетаскивание.
            touchAction: 'none',
            userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
            transform: dragging ? 'scale(1.12)' : 'scale(1)',
            boxShadow: dragging ? `0 6px 18px rgba(0,0,0,.35), 0 0 0 1px ${theme.accent}66` : 'none',
            transition: 'transform 150ms ease, box-shadow 150ms ease, background-color 150ms ease',
          }}
        >
          {icon}
          {showLabels && <Box component="span" sx={{ fontSize: 10, lineHeight: 1, whiteSpace: 'nowrap' }}>{label}</Box>}
        </IconButton>
      </Box>
    );
  };

  if (!isChatSection) {
    return (
      <Box sx={{ display: { xs: 'flex', md: 'none' }, position: 'fixed', left: 12, bottom: 12, zIndex: 1400 }}>
        <Button
          aria-label="Вернуться в чаты"
          startIcon={<ChatIcon />}
          onClick={() => leaveSlidePage(() => navigate('/'))}
          sx={{
            minWidth: 48, height: 48, px: 1.5, color: theme.text, bgcolor: theme.bgSidebar,
            border: `1px solid ${theme.border}`, boxShadow: '0 8px 24px rgba(0,0,0,.35)',
          }}
        >
          Чаты
        </Button>
      </Box>
    );
  }

  return (
    <>
      <Box
        component="nav"
        aria-label="Навигация"
        sx={{
          display: { xs: 'flex', md: 'none' },
          position: 'fixed', left: 8, right: 8,
          bottom: 'max(8px, env(safe-area-inset-bottom))',
          minHeight: navHeight, px: 1, py: 0.75, boxSizing: 'border-box',
          zIndex: 1400, alignItems: 'center', justifyContent: 'space-around', gap: 0.5,
          // Ползунок «Скругление нижней панели» (стиль интерфейса).
          borderRadius: UI_NAV_RADIUS,
          ...navPanelBackground(theme.bgSidebar, theme.bg, navOpacity),
          backdropFilter: 'blur(22px) saturate(1.35)',
          border: `1px solid ${theme.border}`,
          boxShadow: '0 -6px 26px rgba(0,0,0,.28), 0 8px 24px rgba(0,0,0,.24)',
          transform: navHidden ? 'translateY(130%)' : 'translateY(0)',
          opacity: navHidden ? 0 : 1,
          pointerEvents: navHidden ? 'none' : 'auto',
          transition: 'transform 220ms ease, opacity 220ms ease',
        }}
      >
        {/* По умолчанию: 1 — редактор, 2 — профиль, 3 — музыка, 4 — архив.
            Порядок меняется удержанием кнопки и сохраняется (mobileNavStore).
            Пункта «Чаты» нет: панель показывается только на списке чатов. */}
        {(frozenOrder ?? order).map(renderItem)}
      </Box>

      <Dialog open={musicOpen} onClose={closeMusic} fullScreen
        TransitionComponent={SlideFromRight}
        transitionDuration={{ enter: SLIDE_IN_MS, exit: SLIDE_OUT_MS }}
        PaperProps={{ sx: {
          bgcolor: theme.bg, color: theme.text,
          // Общий zoom-fade диалогов (main.tsx) спорил бы с выездом сбоку.
          animation: 'none !important',
          pt: 'env(safe-area-inset-top)', pb: 'env(safe-area-inset-bottom)',
        } }}>
        {/* Компактная шапка: на телефоне каждая строка на счету. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5, py: 0.25, flexShrink: 0, borderBottom: `1px solid ${theme.border}` }}>
          <IconButton aria-label="Закрыть музыку" onClick={closeMusic} sx={{ color: theme.textSec, width: 44, height: 44 }}>
            <ArrowBack />
          </IconButton>
          <Box sx={{ flex: 1, fontSize: 17, fontWeight: 700 }}>Музыка и плейлисты</Box>
          <Button onClick={closeMusic} startIcon={<ChatIcon />} sx={{ color: theme.accent, minHeight: 40 }}>Чаты</Button>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}><MusicLibrary /></Box>
      </Dialog>

      <Suspense fallback={null}>
        {themeEditorOpen && (
          <ThemeEditor
            onClose={closeThemeEditor}
            onGoChats={() => { closeThemeEditor(); navigate('/'); }}
          />
        )}
      </Suspense>
    </>
  );
}