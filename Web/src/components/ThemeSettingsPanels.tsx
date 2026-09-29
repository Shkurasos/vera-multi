import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Button, Slider, Switch, Alert, ThemeProvider, createTheme, useTheme,
  ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import { RestartAlt, TextFields, ViewSidebar } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import {
  useUserSettingsStore, type SidePos, type VertPos, type PlayerPos, type Density,
} from '../store/userSettingsStore';
import { useUiPrefsStore, ICON_PACKS, UI_STYLES, CHAT_SHAPES } from '../store/uiPrefsStore';
import { useAnimStore, ANIM_GROUPS } from '../store/animStore';
import { useChatBgPrefsStore, STOCK_WALLPAPERS } from '../store/chatBgPrefsStore';
import WallpaperSettingsDialog from './WallpaperSettingsDialog';
import { GlobalSoundSettingsContent } from './GlobalSoundSettingsDialog';
import LayoutDesignerDialog from './LayoutDesignerDialog';
import BubbleSettingsControls from './BubbleSettingsControls';
import FontPicker from './FontPicker';
import { APP_FONT_OPTIONS } from '../utils/appFont';

/**
 * Вкладки настроек, которые живут В ТЕМЕ: обои, звук, иконки и стиль,
 * анимации, внешний вид и макет. Раньше эти секции жили в SettingsDialog,
 * теперь они редактируются в центрированном редакторе тем и сохраняются в
 * Theme.settings (snapshotThemeSettings → applyThemeSettings).
 *
 * Панели работают с привычными сторами напрямую: правки видны сразу, а при
 * сохранении темы текущие значения снимаются снимком в тему — поэтому весь
 * существующий код рендера (обои, data-атрибуты иконок/анимаций, звуки,
 * раскладка) продолжает работать без изменений.
 */

// ── Слой порталов над плашкой редактора ──────────────────────────────────────
// Плашка редактора — оверлей с z-index 9999, а MUI по умолчанию ставит
// модальные окна на 1300. Поэтому всё, что открывается ИЗ редактора (диалог
// обоев, конструктор макета, списки шрифтов, тултипы), оказывалось под
// плашкой и не нажималось. Вложенный ThemeProvider с завышенной шкалой
// поднимает и само окно, и его тултипы/меню.
export function ThemeSettingsLayer({ children }: { children: React.ReactNode }) {
  const outer = useTheme();
  const elevated = useMemo(
    () => createTheme(outer, { zIndex: { modal: 10100, popper: 10100, snackbar: 10200, tooltip: 10200 } }),
    [outer],
  );
  return <ThemeProvider theme={elevated}>{children}</ThemeProvider>;
}

function RowToggle({ label, hint, checked, onChange }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  const theme = useThemeStore((s) => s.theme);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.5 }}>
      <Box sx={{ minWidth: 0, pr: 1 }}>
        <Typography sx={{ fontSize: 14, color: theme.text }}>{label}</Typography>
        {hint && <Typography sx={{ fontSize: 12, color: theme.textSec }}>{hint}</Typography>}
      </Box>
      <Switch checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </Box>
  );
}

/** Заголовок секции внутри вкладки. */
function PanelTitle({ children }: { children: React.ReactNode }) {
  const theme = useThemeStore((s) => s.theme);
  return (
    <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 1 }}>{children}</Typography>
  );
}

// ── Обои для всех чатов ────────────────────────────────────────────────────────
export function WallpaperPanel() {
  const theme = useThemeStore((s) => s.theme);
  const [open, setOpen] = useState(false);
  const stockId = useChatBgPrefsStore((s) => s.globalStockWallpaper);
  const photoName = useChatBgPrefsStore((s) => s.userPhotoName);
  const stock = STOCK_WALLPAPERS.find((w) => w.id === stockId);
  const title = stockId === 'custom-photo'
    ? (photoName || 'Своё фото')
    : stockId === 'custom-live'
      ? 'Своё видео'
      : (stock?.name || 'Без обоев');
  return (
    <Box>
      <PanelTitle>Обои применяются ко всем чатам, в которых не установлены свои.</PanelTitle>
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, mb: 1.5,
        border: `1px solid ${theme.border}`, borderRadius: 2, bgcolor: theme.bgInput,
      }}>
        <Box sx={{
          width: 56, height: 40, borderRadius: 1.5, flexShrink: 0,
          border: `1px solid ${theme.border}`, bgcolor: theme.bgHover,
          backgroundImage: stock?.url ? `url(${stock.url})` : undefined,
          backgroundSize: 'cover', backgroundPosition: 'center',
        }} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 14, color: theme.text, fontWeight: 600 }} noWrap>{title}</Typography>
          <Typography sx={{ fontSize: 12, color: theme.textSec }}>Текущие обои темы</Typography>
        </Box>
      </Box>
      <Button variant="contained" onClick={() => setOpen(true)}
        sx={{ bgcolor: theme.accent, textTransform: 'none', borderRadius: 2, '&:hover': { bgcolor: theme.accent } }}>
        🖼️ Открыть обои
      </Button>
      <Alert severity="info" sx={{ mt: 1.5, fontSize: 12 }}>
        Здесь же — свои фото и видео. Выбор сохраняется вместе с темой и применяется при её переключении.
      </Alert>
      <WallpaperSettingsDialog open={open} onClose={() => setOpen(false)} forceGlobal />
    </Box>
  );
}

// ── Звук уведомления по умолчанию ──────────────────────────────────────────────
export function SoundPanel() {
  return (
    <Box>
      <GlobalSoundSettingsContent />
      <Alert severity="info" sx={{ mt: 1.5, fontSize: 12 }}>
        Звук и громкость сохраняются вместе с темой. Чаты со своими звуками не зависят от этой настройки.
      </Alert>
    </Box>
  );
}

// ── Иконки и стиль интерфейса ──────────────────────────────────────────────────
export function UiStylePanel() {
  const theme = useThemeStore((s) => s.theme);
  const {
    iconPack, uiStyle, chatShape, chatBorder, chatFill,
    setIconPack, setUiStyle, setChatShape, setChatBorder, setChatFill,
  } = useUiPrefsStore();
  return (
    <Box>
      <PanelTitle>Пак иконок</PanelTitle>
      <ToggleButtonGroup exclusive fullWidth size="small" value={iconPack}
        onChange={(_, v) => v && setIconPack(v)}
        sx={{ mb: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
        {ICON_PACKS.map((p) => (
          <ToggleButton key={p.id} value={p.id}
            sx={{
              flex: '1 1 45%', textTransform: 'none', color: theme.text,
              borderColor: theme.border,
              '&.Mui-selected': { bgcolor: theme.accent + '25', color: theme.text, borderColor: theme.accent },
            }}>
            {p.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 2 }}>
        {ICON_PACKS.find((p) => p.id === iconPack)?.desc}
      </Typography>

      <PanelTitle>Стиль интерфейса</PanelTitle>
      <ToggleButtonGroup exclusive fullWidth size="small" value={uiStyle}
        onChange={(_, v) => v && setUiStyle(v)}
        sx={{ flexWrap: 'wrap', gap: 0.5 }}>
        {UI_STYLES.map((u) => (
          <ToggleButton key={u.id} value={u.id}
            sx={{
              flex: '1 1 30%', textTransform: 'none', color: theme.text,
              borderColor: theme.border,
              '&.Mui-selected': { bgcolor: theme.accent + '25', color: theme.text, borderColor: theme.accent },
            }}>
            {u.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography sx={{ fontSize: 12, color: theme.textSec, mt: 1, mb: 2 }}>
        {UI_STYLES.find((u) => u.id === uiStyle)?.desc}
      </Typography>

      <PanelTitle>Вид чатов</PanelTitle>
      <ToggleButtonGroup exclusive fullWidth size="small" value={chatShape}
        onChange={(_, v) => v && setChatShape(v)}
        sx={{ flexWrap: 'wrap', gap: 0.5 }}>
        {CHAT_SHAPES.map((d) => (
          <ToggleButton key={d.id} value={d.id}
            sx={{
              // Превью формы карточки прямо на кнопке.
              borderRadius: `${d.radius}px !important`,
              flex: '1 1 30%', textTransform: 'none', color: theme.text,
              borderColor: theme.border,
              '&.Mui-selected': { bgcolor: theme.accent + '25', color: theme.text, borderColor: theme.accent },
            }}>
            {d.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography sx={{ fontSize: 12, color: theme.textSec, mt: 1 }}>
        {CHAT_SHAPES.find((d) => d.id === chatShape)?.desc}
      </Typography>
      <Box sx={{ mt: 1.5 }}>
        <RowToggle label="Обводка карточек" hint="Выключите, чтобы убрать рамку вокруг чатов совсем"
          checked={chatBorder} onChange={setChatBorder} />
        <RowToggle label="Заливка карточек" hint="Выключите — строка станет простой полосой во всю ширину"
          checked={chatFill} onChange={setChatFill} />
      </Box>
      <Alert severity="info" sx={{ mt: 1.5, fontSize: 12 }}>
        Иконки и стиль сохраняются вместе с темой и применяются при её переключении.
      </Alert>
    </Box>
  );
}

// ── Анимации ───────────────────────────────────────────────────────────────────
export function AnimationsPanel() {
  const theme = useThemeStore((s) => s.theme);
  const { enabled: animEnabled, set: setAnim, setAll: setAllAnims } = useAnimStore();
  const allAnimsOn = ANIM_GROUPS.every((g) => animEnabled[g.key]);
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 14, color: theme.text }}>Анимации интерфейса</Typography>
          <Typography sx={{ fontSize: 12, color: theme.textSec }}>
            Плавные микровзаимодействия в стиле Apple
          </Typography>
        </Box>
        <Switch checked={allAnimsOn} onChange={(e) => setAllAnims(e.target.checked)} />
      </Box>
      <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 1 }}>
        Выключите только те, которые не нравятся, — остальные продолжат работать.
      </Typography>
      {ANIM_GROUPS.map((g) => (
        <RowToggle key={g.key} label={`${g.emoji} ${g.label}`} hint={g.desc}
          checked={!!animEnabled[g.key]} onChange={(v) => setAnim(g.key, v)} />
      ))}
      <Alert severity="info" sx={{ mt: 1, fontSize: 12 }}>
        Набор анимаций сохраняется вместе с темой. Если в системе включен режим Reduce Motion,
        все анимации автоматически отключаются.
      </Alert>
    </Box>
  );
}

// ── Внешний вид ────────────────────────────────────────────────────────────────
export function AppearancePanel() {
  const theme = useThemeStore((s) => s.theme);
  const s = useUserSettingsStore();
  return (
    <Box>
      <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>Яркость</Typography>
      <Slider min={0.5} max={1.5} step={0.05} value={s.brightness}
        onChange={(_, v) => s.set('brightness', Array.isArray(v) ? v[0] : v)}
        valueLabelDisplay="auto" valueLabelFormat={(v) => `${Math.round(v * 100)}%`} />
      <Typography sx={{ fontSize: 13, color: theme.textSec, mt: 2, mb: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <TextFields fontSize="small" /> Масштаб текста
      </Typography>
      <Slider min={0.8} max={1.6} step={0.05} value={s.textScale}
        onChange={(_, v) => s.set('textScale', Array.isArray(v) ? v[0] : v)}
        valueLabelDisplay="auto" valueLabelFormat={(v) => `${Math.round(v * 100)}%`} />
      <Typography sx={{ fontSize: 13, color: theme.textSec, mt: 2, mb: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <TextFields fontSize="small" /> Шрифт всего приложения
      </Typography>
      <FontPicker
        value={s.globalFontFamily}
        onChange={(value) => s.set('globalFontFamily', value)}
        baseOptions={APP_FONT_OPTIONS}
        manage
        ariaLabel="Шрифт всего приложения"
        hint="Меняет весь текст: кнопки, меню, заголовки, настройки и сообщения. Применяется сразу и сохраняется. Выбранный шрифт имеет приоритет над шрифтами чатов; «По умолчанию» возвращает индивидуальные настройки."
      />
      <Alert severity="info" sx={{ mt: 1.5, fontSize: 12 }}>
        Яркость, масштаб и шрифт сохраняются вместе с темой.
      </Alert>
    </Box>
  );
}

// ── Макет ──────────────────────────────────────────────────────────────────────
export function LayoutPanel() {
  const theme = useThemeStore((s) => s.theme);
  const s = useUserSettingsStore();
  const [designerOpen, setDesignerOpen] = useState(false);
  const [sidebarWidthMax, setSidebarWidthMax] = useState(() => Math.max(200, Math.floor(window.innerWidth / 10) * 5));
  useEffect(() => {
    const update = () => setSidebarWidthMax(Math.max(200, Math.floor(window.innerWidth / 10) * 5));
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  const effectiveSidebarWidth = Math.min(s.layout.sidebarWidth, sidebarWidthMax);
  const toggles = (value: string, onChange: (v: string) => void, items: [string, string][]) => (
    <ToggleButtonGroup exclusive size="small" fullWidth value={value} onChange={(_, v) => v && onChange(v)}>
      {items.map(([val, label]) => <ToggleButton key={val} value={val}>{label}</ToggleButton>)}
    </ToggleButtonGroup>
  );
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Button variant="contained" onClick={() => setDesignerOpen(true)}
        sx={{ bgcolor: theme.accent, textTransform: 'none', borderRadius: 2, '&:hover': { bgcolor: theme.accent } }}>
        🎨 Открыть визуальный конструктор
      </Button>

      <Box>
        <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>Сторона панели чатов (десктоп)</Typography>
        {toggles(s.layout.sidebarSide, (v) => s.setLayout('sidebarSide', v as SidePos),
          [['left', 'Слева'], ['right', 'Справа'], ['top', 'Сверху'], ['bottom', 'Снизу']])}
      </Box>

      <Box>
        <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>Нижняя навигация (мобильный)</Typography>
        {toggles(s.layout.mobileNavPos, (v) => s.setLayout('mobileNavPos', v as VertPos),
          [['bottom', 'Снизу'], ['top', 'Сверху']])}
      </Box>

      <Box>
        <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>Плеер</Typography>
        {toggles(s.layout.playerPos, (v) => s.setLayout('playerPos', v as PlayerPos),
          [['bottom', 'Снизу'], ['top', 'Сверху'], ['left', 'Слева'], ['right', 'Справа']])}
      </Box>

      <Box>
        <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>Шапка чата</Typography>
        {toggles(s.layout.chatHeaderPos, (v) => s.setLayout('chatHeaderPos', v as VertPos),
          [['top', 'Сверху'], ['bottom', 'Снизу']])}
      </Box>

      <Box>
        <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>Поле ввода чата</Typography>
        {toggles(s.layout.chatInputPos, (v) => s.setLayout('chatInputPos', v as VertPos),
          [['bottom', 'Снизу'], ['top', 'Сверху']])}
      </Box>

      <Box>
        <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>Плотность интерфейса</Typography>
        {toggles(s.layout.density, (v) => s.setLayout('density', v as Density),
          [['compact', 'Компактно'], ['cozy', 'Обычно'], ['roomy', 'Просторно']])}
      </Box>

      <Box>
        <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>
          Скругление углов окна чата и панелей — {s.layout.radius}px
        </Typography>
        <Slider min={0} max={28} step={1} value={s.layout.radius}
          onChange={(_, v) => s.setLayout('radius', Array.isArray(v) ? v[0] : v)} />
      </Box>

      <Box>
        <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>
          Скругление пузырей сообщений — {s.layout.bubbleRadius}px
        </Typography>
        <Slider min={4} max={30} step={1} value={s.layout.bubbleRadius}
          onChange={(_, v) => s.setLayout('bubbleRadius', Array.isArray(v) ? v[0] : v)} />
        <Typography sx={{ fontSize: 11, color: theme.textSec }}>
          Маленькие значения выглядят строже, большие — мягче и дружелюбнее.
        </Typography>
      </Box>

      <Box>
        <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>
          Пузыри сообщений по умолчанию для всех чатов
        </Typography>
        <BubbleSettingsControls value={{
          enabled: s.layout.bubbleEnabled ?? true,
          maxWidth: s.layout.messageMaxWidth,
          textSize: s.layout.bubbleTextSize ?? 15,
          padding: s.layout.bubblePadding ?? 6,
        }} onChange={patch => {
          if (patch.enabled !== undefined) s.setLayout('bubbleEnabled', patch.enabled);
          if (patch.maxWidth !== undefined) s.setLayout('messageMaxWidth', patch.maxWidth);
          if (patch.textSize !== undefined) s.setLayout('bubbleTextSize', patch.textSize);
          if (patch.padding !== undefined) s.setLayout('bubblePadding', patch.padding);
        }} />
        <Typography sx={{ fontSize: 11, color: theme.textSec }}>
          Применяются к чатам без собственных настроек. Для отдельного чата: ⋮ → Настройки отображения.
        </Typography>
      </Box>

      <Box>
        <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 0.5 }}>
          Ширина боковой панели — {effectiveSidebarWidth}px
        </Typography>
        <Slider min={200} max={sidebarWidthMax} step={5} value={Math.min(s.layout.sidebarWidth, sidebarWidthMax)}
          onChange={(_, v) => s.setLayout('sidebarWidth', Array.isArray(v) ? v[0] : v)} />
      </Box>

      <RowToggle label="Показывать вкладки (Диалоги / Архив / Группы)"
        checked={s.layout.showTabs} onChange={(v) => s.setLayout('showTabs', v)} />
      <RowToggle label="Показывать аватары в списке чатов"
        checked={s.layout.showAvatarsInList} onChange={(v) => s.setLayout('showAvatarsInList', v)} />

      <Alert severity="info" sx={{ fontSize: 12 }}>
        Панель чатов можно также перетаскивать за правый край мышью — ширина сохранится.
        Всё вместе сохраняется в теме.
      </Alert>
      <Button variant="outlined" startIcon={<RestartAlt />} onClick={() => s.resetLayout()}
        sx={{ color: theme.text, borderColor: theme.border, textTransform: 'none' }}>
        Сбросить макет по умолчанию
      </Button>

      <LayoutDesignerDialog open={designerOpen} onClose={() => setDesignerOpen(false)} />
    </Box>
  );
}



