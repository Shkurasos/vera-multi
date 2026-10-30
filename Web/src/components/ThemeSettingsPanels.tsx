import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Button, Switch, Alert, ThemeProvider, createTheme, useTheme,
  ToggleButton, ToggleButtonGroup, TextField, useMediaQuery,
} from '@mui/material';
import { RestartAlt, Chat, Palette, Settings } from '@mui/icons-material';
import { IconPackOverrideContext } from '../iconPackContext';
import { useThemeStore, themeBaseWallpaperId } from '../store/themeStore';
import {
  useUserSettingsStore, type SidePos, type VertPos, type PlayerPos, type Density, type DesktopNavStyle, type LayoutSettings,
  type WallClockPos, type WallClockDatePos, type WallClockSecondsPos, type WallClockHudMode, type ChatDateAlign,
  normalizeHudUrl, WALL_CLOCK_HUD_HTML_MAX, WALL_CLOCK_HUD_HEIGHT_LIMITS,
} from '../store/userSettingsStore';
import {
  useUiPrefsStore, ICON_PACKS, UI_MODES, CHAT_SHAPES, SQUIRCLE_LIMITS, SQUIRCLE_SWITCH_RANGE, NAV_OPACITY_LIMITS, NAV_HEIGHT_LIMITS,
} from '../store/uiPrefsStore';
import { useAnimStore, ANIM_GROUPS } from '../store/animStore';
import { useChatBgPrefsStore, useAllStockWallpapers, wallpaperCssClass } from '../store/chatBgPrefsStore';
import WallpaperSettingsDialog from './WallpaperSettingsDialog';
import ChatListWallpaperPanel from './ChatListWallpaperPanel';
import GapWallpaperPanel from './GapWallpaperPanel';
import { GlobalSoundSettingsContent } from './GlobalSoundSettingsDialog';
import LayoutDesignerDialog from './LayoutDesignerDialog';
import BubbleSettingsControls from './BubbleSettingsControls';
import { resolveMetaPair } from '../utils/bubbleSettings';
import FontPicker from './FontPicker';
import { APP_FONT_OPTIONS } from '../utils/appFont';
import CustomIconPacksPanel from './CustomIconPacksPanel';
import { SettingRow, SettingSlider, SettingSection, choiceGroupSx } from './SettingRow';
import { ROUND_SHAPES, normalizeRoundShape } from '../utils/roundShape';
import {
  AVATAR_PALETTE_MODES, MAX_CUSTOM_AVATAR_COLORS, avatarPalette, avatarFill, type AvatarPaletteMode,
} from '../utils/avatarColors';

/** Пример для поля своего HUD: часы, которые берут время и цвет из сообщений приложения. */
const HUD_HTML_EXAMPLE = `<div id="t" style="font:700 64px sans-serif;text-align:center"></div>
<script>
addEventListener('message', (e) => {
  const d = e.data; if (!d || d.type !== 'vera-clock') return;
  const el = document.getElementById('t');
  el.style.color = d.color;
  el.textContent = new Date(d.now).toLocaleTimeString(d.locale, { hour: '2-digit', minute: '2-digit' });
});
</script>`;

/**
 * Вкладки настроек, которые живут В ТЕМЕ: обои, иконки, стиль, анимации,
 * внешний вид, часы, сообщения, макет и звук. Они редактируются в
 * центрированном редакторе тем и сохраняются в Theme.settings
 * (snapshotThemeSettings → applyThemeSettings).
 *
 * Панели работают с привычными сторами напрямую: правки видны сразу, а при
 * сохранении темы текущие значения снимаются снимком в тему.
 *
 * Разметка — строки SettingRow: название слева, контрол справа, между
 * строками тонкая линия. Подписи строк совпадают с индексом поиска
 * (utils/themeEditorSearch.ts) — по ним поиск находит строку на экране.
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

function RowToggle({ label, hint, checked, onChange, disabled }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void;
  /** Зависимая настройка выключена — переключатель гасится и не нажимается. */
  disabled?: boolean;
}) {
  return (
    <SettingRow label={label} hint={hint} disabled={disabled}>
      <Switch checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)}
        inputProps={{ 'aria-label': label }} />
    </SettingRow>
  );
}

/** Подсказка под группой строк — мелким серым, без рамки Alert. */
function PanelNote({ children }: { children: React.ReactNode }) {
  const theme = useThemeStore((s) => s.theme);
  return <Typography sx={{ fontSize: 12, color: theme.textSec, mt: 1.5 }}>{children}</Typography>;
}

/** Общий вид групп кнопок-вариантов во всех строках (см. choiceGroupSx). */
function useToggleSx() {
  const theme = useThemeStore((s) => s.theme);
  return choiceGroupSx(theme);
}

/** Строка с выбором одного из вариантов. */
function ChoiceRow({ label, hint, value, onChange, items, stacked }: {
  label: string; hint?: React.ReactNode; value: string; onChange: (v: string) => void;
  items: [string, string][]; stacked?: boolean;
}) {
  const sx = useToggleSx();
  return (
    <SettingRow label={label} hint={hint} stacked={stacked} wide>
      <ToggleButtonGroup exclusive size="small" fullWidth value={value} onChange={(_, v) => v && onChange(v)} sx={sx}>
        {items.map(([val, text]) => <ToggleButton key={val} value={val}>{text}</ToggleButton>)}
      </ToggleButtonGroup>
    </SettingRow>
  );
}

// ── Обои для всех чатов ────────────────────────────────────────────────────────
export function WallpaperPanel() {
  const theme = useThemeStore((s) => s.theme);
  const [open, setOpen] = useState(false);
  // Показываем РОДНОЙ фон темы, а не 'none' из стора обоев: тема приходит со
  // своим фоном сразу, и в панели он должен быть виден выбранным, иначе панель
  // врала бы, что обоев нет.
  const themeBaseId = useThemeStore((s) => themeBaseWallpaperId(s));
  const chosenStockId = useChatBgPrefsStore((s) => s.globalStockWallpaper);
  const stockId = (!chosenStockId || chosenStockId === 'none') && themeBaseId
    ? themeBaseId
    : chosenStockId;
  const photoName = useChatBgPrefsStore((s) => s.userPhotoName);
  // Превью обоев темы должно видеть и фоны админа: раньше тут бралась константа
  // STOCK_WALLPAPERS, и выбранный загруженный фон показывался как «Без обоев».
  const stockWallpapers = useAllStockWallpapers();
  const stock = stockWallpapers.find((w) => w.id === stockId);
  // Базовый фон темы — общий класс из <style>, поэтому в sx только класс.
  const baseClass = wallpaperCssClass(stock);
  const stockUrl = stock && 'url' in stock ? stock.url : undefined;
  const title = stockId === 'custom-photo'
    ? (photoName || 'Своё фото')
    : stockId === 'custom-live'
      ? 'Своё видео'
      : (stock?.name || 'Без обоев');
  return (
    <Box>
      <SettingSection title="Обои чатов" hint="Применяются ко всем чатам, в которых не установлены свои." />
      <SettingRow label="Текущие обои темы" hint={title}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box className={baseClass} aria-hidden sx={{
            width: 56, height: 40, borderRadius: 1.5, flexShrink: 0,
            border: `1px solid ${theme.border}`, bgcolor: theme.bgHover,
            backgroundImage: stockUrl ? `url(${stockUrl})` : undefined,
            backgroundSize: 'cover', backgroundPosition: 'center',
          }} />
          <Button variant="contained" onClick={() => setOpen(true)}
            sx={{ bgcolor: theme.accent, textTransform: 'none', borderRadius: 2, '&:hover': { bgcolor: theme.accent } }}>
            🖼️ Открыть обои
          </Button>
        </Box>
      </SettingRow>
      <PanelNote>
        Базовые фоны тем уже включены в каждую тему — здесь их можно заменить
        на другие стоковые, свои фото или видео. Выбор сохраняется вместе с темой.
      </PanelNote>
      <WallpaperSettingsDialog open={open} onClose={() => setOpen(false)} forceGlobal />

      <SettingSection title="Обои списка чатов" />
      <Box sx={{ py: 1.25, borderBottom: `1px solid ${theme.border}` }}>
        <ChatListWallpaperPanel />
      </Box>

      <SettingSection title="Обои промежутков" hint="Фото по краям окна чата, в зазоре между ним и панелями. Рисуются только полосы, а не всё фото." />
      <GapWallpaperPanel />
    </Box>
  );
}

// ── Звук уведомления по умолчанию ──────────────────────────────────────────────
export function SoundPanel() {
  const theme = useThemeStore((s) => s.theme);
  return (
    <Box>
      <SettingSection title="Звук уведомлений по умолчанию" />
      <Box sx={{ py: 1.25, borderBottom: `1px solid ${theme.border}` }}>
        <GlobalSoundSettingsContent />
      </Box>
      <PanelNote>
        Звук и громкость сохраняются вместе с темой. Чаты со своими звуками не зависят от этой настройки.
      </PanelNote>
    </Box>
  );
}

// ── Иконки ─────────────────────────────────────────────────────────────────────
export function IconsPanel() {
  const theme = useThemeStore((s) => s.theme);
  const { iconPack, setIconPack } = useUiPrefsStore();
  const { iconSize, set } = useUserSettingsStore();
  return (
    <Box>
      <SettingSection title="Пак иконок" hint={ICON_PACKS.find((p) => p.id === iconPack)?.desc} />
      <Box data-setting-label="Пак иконок" sx={{ py: 1.25, borderBottom: `1px solid ${theme.border}` }}>
        <ToggleButtonGroup exclusive fullWidth size="small" value={iconPack}
          onChange={(_, v) => v && setIconPack(v)}
          aria-label="Пак иконок"
          sx={choiceGroupSx(theme)}>
          {ICON_PACKS.map((p) => (
            <ToggleButton key={p.id} value={p.id}
              sx={{
                // Две колонки; превью иконок слева от названия.
                flex: '1 1 45% !important', gap: 1, justifyContent: 'flex-start',
                fontSize: '13px !important', py: '7px !important', color: theme.text,
              }}>
              {/* Превью в стиле самого пака, а не текущего (см. IconPackOverrideContext). */}
              <IconPackOverrideContext.Provider value={p.id}>
                <Box component="span" data-icon-preview={p.id} aria-hidden
                  sx={{ display: 'inline-flex', gap: 0.5, color: theme.accent, '& .MuiSvgIcon-root': { fontSize: 20 } }}>
                  <Chat /><Palette /><Settings />
                </Box>
              </IconPackOverrideContext.Provider>
              {p.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      <SettingSlider
        label="Размер иконок"
        hint="Размер иконок интерфейса в пикселях (16..40)"
        value={iconSize}
        onChange={(v) => set('iconSize', v)}
        min={16}
        max={40}
        step={2}
      />

      <SettingSection title="Свои паки" />
      <Box sx={{ py: 1.25, borderBottom: `1px solid ${theme.border}` }}>
        <CustomIconPacksPanel />
      </Box>
      <PanelNote>Иконки сохраняются вместе с темой и применяются при её переключении.</PanelNote>
    </Box>
  );
}

// ── Стиль интерфейса ───────────────────────────────────────────────────────────
// Радиусы действуют на весь интерфейс: карточки, настройки, меню, пузыри.
const SQUIRCLE_ROWS = [
  ['surface', 'Скругление углов основного экрана', 'px'],
  ['profile', 'Скругление плашек профиля', 'px'],
  ['avatar', 'Скругление аватарок', '%'],
  ['bubble', 'Скругление сообщений', 'px'],
  ['nav', 'Скругление нижней панели', 'px'],
] as const;

export function UiStylePanel() {
  const theme = useThemeStore((s) => s.theme);
  const toggleSx = useToggleSx();
  const {
    chatShape, chatBorder, chatFill, squircle, uiModes, navOpacity, navHeight,
    setUiStyle, setUiMode, setChatShape, setChatBorder, setChatFill, setSquircleRadius, setNavOpacity, setNavHeight,
  } = useUiPrefsStore();
  // Скругление есть только у «телефонной» панели: на ПК — при стиле «Как на
  // телефоне», на узком экране (< md) нижняя панель всегда такая.
  const desktopNavStyle = useUserSettingsStore((s) => s.layout.desktopNavStyle ?? 'compact');
  const smallScreen = useMediaQuery(useTheme().breakpoints.down('md'));
  const navRoundable = desktopNavStyle === 'phone' || smallScreen;
  return (
    <Box>
      <SettingSection title="Скругления" hint={`Аватарки: 0% — квадрат, 50% — круг. При углах до ${SQUIRCLE_SWITCH_RANGE.max}px переключатели тоже становятся квадратными.`} />
      {SQUIRCLE_ROWS.filter(([key]) => key !== 'nav' || navRoundable).map(([key, label, unit]) => (
        <SettingSlider key={key} label={`${label}, ${unit}`}
          hint={key === 'nav' ? 'Профиль, музыка, редактор, архив' : undefined}
          min={SQUIRCLE_LIMITS[key].min} max={SQUIRCLE_LIMITS[key].max} step={1}
          value={squircle[key]}
          onChange={(v) => setSquircleRadius(key, v)} />
      ))}
      <SettingSlider label="Непрозрачность нижней панели, %"
        hint="И компактная строка иконок, и «Как на телефоне»"
        min={NAV_OPACITY_LIMITS.min} max={NAV_OPACITY_LIMITS.max} step={1}
        value={navOpacity}
        onChange={(v) => setNavOpacity(v)} />
      <SettingSlider label="Высота нижней панели, px"
        hint="Профиль, музыка, редактор, архив — в обоих стилях панели. Ниже 60px — без подписей"
        min={NAV_HEIGHT_LIMITS.min} max={NAV_HEIGHT_LIMITS.max} step={1}
        value={navHeight}
        onChange={(v) => setNavHeight(v)} />
      <SettingRow label="Сбросить стиль" hint="Вернуть скругления, непрозрачность и высоту панели по умолчанию">
        <Button size="small" startIcon={<RestartAlt />} onClick={() => setUiStyle('default')}
          sx={{ textTransform: 'none', color: theme.textSec }}>
          Сбросить
        </Button>
      </SettingRow>

      <SettingSection title="Режимы" />
      {UI_MODES.map((m) => (
        <RowToggle key={m.id} label={m.label} hint={m.desc}
          checked={uiModes[m.id]} onChange={(v) => setUiMode(m.id, v)} />
      ))}

      <SettingSection title="Карточки чатов" />
      <SettingRow label="Вид чатов" hint={CHAT_SHAPES.find((d) => d.id === chatShape)?.desc} stacked>
        <ToggleButtonGroup exclusive fullWidth size="small" value={chatShape}
          onChange={(_, v) => v && setChatShape(v)}
          sx={{ ...toggleSx, gap: 0.5 }}>
          {CHAT_SHAPES.map((d) => (
            <ToggleButton key={d.id} value={d.id}
              sx={{
                // Превью формы карточки прямо на кнопке (радиус — через
                // переменную, её читает общий вид группы choiceGroupSx).
                '--vera-choice-radius': `${d.radius}px`,
                flex: '1 1 30%',
              }}>
              {d.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </SettingRow>
      <RowToggle label="Обводка карточек" hint="Выключите, чтобы убрать рамку вокруг чатов совсем"
        checked={chatBorder} onChange={setChatBorder} />
      <RowToggle label="Заливка карточек" hint="Выключите — строка станет простой полосой во всю ширину"
        checked={chatFill} onChange={setChatFill} />

      <AvatarColorsSection />
      <PanelNote>Стиль сохраняется вместе с темой и применяется при её переключении.</PanelNote>
    </Box>
  );
}

// ── Цвета аватарок без фото ───────────────────────────────────────────────────
/** Превью: несколько кружков с инициалами в текущей палитре. */
const AVATAR_PREVIEW = ['Hub', 'Новые идеи', 'Скины', 'Доработки баги', 'Канал', 'Vera AI'];

function AvatarColorsSection() {
  const theme = useThemeStore((s) => s.theme);
  const toggleSx = useToggleSx();
  const { avatarPalette: mode, avatarColors, avatarGradient, setAvatarPalette, setAvatarColors, setAvatarGradient } = useUiPrefsStore();
  const palette = useMemo(() => avatarPalette(mode, theme.accent, avatarColors), [mode, theme.accent, avatarColors]);
  const [draftColor, setDraftColor] = useState('#e17076');
  // «Свои» стартуют с текущей палитры, чтобы было что править, а не пустота.
  const pickMode = (m: AvatarPaletteMode) => {
    if (m === 'custom' && avatarColors.length === 0) setAvatarColors(palette);
    setAvatarPalette(m);
  };
  const updateColor = (i: number, value: string) => {
    const next = [...avatarColors];
    next[i] = value;
    setAvatarColors(next);
  };
  const removeColor = (i: number) => setAvatarColors(avatarColors.filter((_, j) => j !== i));
  const addColor = () => setAvatarColors([...avatarColors, draftColor]);
  const swatchSx = { width: 34, height: 34, p: 0, border: `1px solid ${theme.border}`, borderRadius: '50%', cursor: 'pointer', bgcolor: 'transparent', overflow: 'hidden' } as const;

  return (
    <>
      <SettingSection title="Цвета аватарок" hint="Для чатов и людей без фото. Цвет закреплён за собеседником и одинаков везде." />
      <SettingRow label="Палитра аватарок" hint={AVATAR_PALETTE_MODES.find((m) => m.id === mode)?.desc} stacked>
        <ToggleButtonGroup exclusive fullWidth size="small" value={mode}
          onChange={(_, v) => v && pickMode(v)} sx={toggleSx}>
          {AVATAR_PALETTE_MODES.map((m) => <ToggleButton key={m.id} value={m.id}>{m.label}</ToggleButton>)}
        </ToggleButtonGroup>
      </SettingRow>
      {mode === 'custom' && (
        <SettingRow label="Свои цвета" hint={`До ${MAX_CUSTOM_AVATAR_COLORS} цветов. Нажмите на кружок, чтобы изменить, × — чтобы убрать.`} stacked>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
            {avatarColors.map((c, i) => (
              // key по индексу: при смене цвета поле не пересоздаётся, и выбор цвета не закрывается.
              <Box key={i} sx={{ position: 'relative' }}>
                <Box component="input" type="color" value={c} aria-label={`Цвет ${i + 1}`}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateColor(i, e.target.value)}
                  sx={swatchSx} />
                <Box component="button" type="button" aria-label={`Убрать цвет ${i + 1}`} onClick={() => removeColor(i)}
                  sx={{
                    position: 'absolute', top: -6, right: -6, width: 18, height: 18, p: 0, lineHeight: '16px',
                    borderRadius: '50%', border: `1px solid ${theme.border}`, bgcolor: theme.bgSidebar,
                    color: theme.text, fontSize: 12, cursor: 'pointer',
                  }}>×</Box>
              </Box>
            ))}
            {avatarColors.length < MAX_CUSTOM_AVATAR_COLORS && (
              <>
                <Box component="input" type="color" value={draftColor} aria-label="Новый цвет"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraftColor(e.target.value)} sx={swatchSx} />
                <Button size="small" onClick={addColor} sx={{ textTransform: 'none' }}>Добавить</Button>
              </>
            )}
          </Box>
        </SettingRow>
      )}
      <RowToggle label="Градиент на аватарках" hint="Мягкий перелив вместо ровной заливки"
        checked={avatarGradient} onChange={setAvatarGradient} />
      <Box aria-hidden sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', py: 1.25 }}>
        {AVATAR_PREVIEW.map((name, i) => {
          const fill = avatarFill(palette[i % palette.length], avatarGradient);
          return (
            <Box key={name} sx={{
              width: 40, height: 40, borderRadius: 'var(--vera-sq-avatar, 50%)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600,
              backgroundColor: fill.bgcolor, backgroundImage: fill.backgroundImage, color: fill.color,
            }}>
              {name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)}
            </Box>
          );
        })}
      </Box>
    </>
  );
}

// ── Анимации ───────────────────────────────────────────────────────────────────
export function AnimationsPanel() {
  const { enabled: animEnabled, set: setAnim, setAll: setAllAnims } = useAnimStore();
  const allAnimsOn = ANIM_GROUPS.every((g) => animEnabled[g.key]);
  return (
    <Box>
      <SettingSection title="Общее" />
      <RowToggle label="Все анимации интерфейса" hint="Плавные микровзаимодействия в стиле Apple"
        checked={allAnimsOn} onChange={setAllAnims} />
      <SettingSection title="По отдельности" hint="Выключите только те, которые не нравятся, — остальные продолжат работать." />
      {ANIM_GROUPS.map((g) => (
        <RowToggle key={g.key} label={`${g.emoji} ${g.label}`} hint={g.desc}
          checked={!!animEnabled[g.key]} onChange={(v) => setAnim(g.key, v)} />
      ))}
      <PanelNote>
        Набор анимаций сохраняется вместе с темой. Если в системе включен режим Reduce Motion,
        все анимации автоматически отключаются.
      </PanelNote>
    </Box>
  );
}

// ── Внешний вид ────────────────────────────────────────────────────────────────
export function AppearancePanel() {
  const theme = useThemeStore((s) => s.theme);
  const s = useUserSettingsStore();
  return (
    <Box>
      <SettingSection title="Экран" />
      <SettingSlider label="Яркость, %" min={0.5} max={1.5} step={0.05} value={s.brightness}
        onChange={(v) => s.set('brightness', v)}
        valueLabelDisplay="auto" scale={100} />
      <SettingSlider label="Масштаб текста, %" min={0.8} max={1.6} step={0.05} value={s.textScale}
        onChange={(v) => s.set('textScale', v)}
        valueLabelDisplay="auto" scale={100} />

      <SettingSection title="Шрифт" />
      <Box data-setting-label="Шрифт всего приложения" sx={{ py: 1.25, borderBottom: `1px solid ${theme.border}` }}>
        <Typography sx={{ fontSize: 14, color: theme.text, mb: 1 }}>Шрифт всего приложения</Typography>
        <FontPicker
          value={s.globalFontFamily}
          onChange={(value) => s.set('globalFontFamily', value)}
          baseOptions={APP_FONT_OPTIONS}
          manage
          ariaLabel="Шрифт всего приложения"
          hint="Меняет весь текст: кнопки, меню, заголовки, настройки и сообщения. Применяется сразу и сохраняется. Выбранный шрифт имеет приоритет над шрифтами чатов; «По умолчанию» возвращает индивидуальные настройки."
        />
      </Box>
      <PanelNote>Яркость, масштаб и шрифт сохраняются вместе с темой. Часы на обоях — во вкладке «Часы».</PanelNote>
    </Box>
  );
}

// ── Часы и календарь на обоях ──────────────────────────────────────────────────
export function ClockPanel() {
  const theme = useThemeStore((s) => s.theme);
  const s = useUserSettingsStore();
  const toggleSx = useToggleSx();
  const off = !s.wallClockEnabled;
  return (
    <Box>
      <SettingSection title="Часы" />
      <RowToggle
        label="Обои с календарём и часами"
        hint="Дата и время поверх фона чата — шрифт берётся из темы/чата"
        checked={s.wallClockEnabled}
        onChange={(v) => s.set('wallClockEnabled', v)}
      />
      <RowToggle
        label="Отодвигать сообщения из-под часов (Ex)"
        hint="Экспериментально: сообщения уходят вбок. Функция ещё дорабатывается, возможны сбои"
        checked={s.wallClockAvoid}
        disabled={!s.wallClockEnabled}
        onChange={(v) => s.set('wallClockAvoid', v)}
      />

      <SettingSection title="Где показывать часы" />
      {([['dialogs', 'Диалоги'], ['board', 'Доски'], ['groups', 'Группы'], ['channels', 'Каналы']] as const).map(([kind, label]) => (
        <RowToggle key={kind} label={label} disabled={off}
          checked={s.wallClockChats?.[kind] !== false}
          onChange={(v) => s.set('wallClockChats', { dialogs: true, board: true, groups: true, channels: true, ...s.wallClockChats, [kind]: v })}
        />
      ))}

      <SettingSection title="Расположение" />
      {/* Сетка 3×3 повторяет экран: сверху / по середине / снизу × слева / центр / справа. */}
      <SettingRow label="Расположение на обоях" disabled={off}
        hint="Часы идут поверх любых обоев чата; сверху и снизу добавлен отступ, чтобы не мешать шапке и полю ввода.">
        <ToggleButtonGroup
          exclusive size="small" disabled={off}
          value={s.wallClockPos}
          onChange={(_, v: WallClockPos | null) => { if (v) s.set('wallClockPos', v); }}
          sx={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 44px)', gap: 0.5,
            '& .MuiToggleButton-root': {
              fontSize: 16, py: 0.25, color: theme.textSec,
              border: `1px solid ${theme.border} !important`, borderRadius: '6px !important', m: 0,
              '&.Mui-selected': { bgcolor: theme.accent + '25', color: theme.text, borderColor: `${theme.accent} !important` },
            },
          }}
        >
          <ToggleButton value="topLeft" aria-label="Сверху слева" title="Сверху слева">↖</ToggleButton>
          <ToggleButton value="top" aria-label="Сверху" title="Сверху">↑</ToggleButton>
          <ToggleButton value="topRight" aria-label="Сверху справа" title="Сверху справа">↗</ToggleButton>
          <ToggleButton value="middleLeft" aria-label="По середине слева" title="По середине слева">←</ToggleButton>
          <ToggleButton value="center" aria-label="По середине" title="По середине">•</ToggleButton>
          <ToggleButton value="middleRight" aria-label="По середине справа" title="По середине справа">→</ToggleButton>
          <ToggleButton value="bottomLeft" aria-label="Снизу слева" title="Снизу слева">↙</ToggleButton>
          <ToggleButton value="bottom" aria-label="Снизу" title="Снизу">↓</ToggleButton>
          <ToggleButton value="bottomRight" aria-label="Снизу справа" title="Снизу справа">↘</ToggleButton>
        </ToggleButtonGroup>
      </SettingRow>
      <SettingRow label="Где стоит дата" disabled={off} wide>
        <ToggleButtonGroup
          exclusive size="small" fullWidth disabled={off} sx={toggleSx}
          value={s.wallClockDatePos}
          onChange={(_, v: WallClockDatePos | null) => { if (v) s.set('wallClockDatePos', v); }}
        >
          <ToggleButton value="above">Над временем</ToggleButton>
          <ToggleButton value="below">Под временем</ToggleButton>
          <ToggleButton value="left">Слева</ToggleButton>
          <ToggleButton value="right">Справа</ToggleButton>
        </ToggleButtonGroup>
      </SettingRow>

      <SettingSection title="Размеры" />
      <SettingSlider label="Размер времени, %" disabled={off}
        min={0.6} max={1.6} step={0.05} value={s.wallClockTimeScale}
        onChange={(v) => s.set('wallClockTimeScale', v)}
        valueLabelDisplay="auto" scale={100}
      />
      <SettingSlider label="Размер даты, %" disabled={off}
        min={0.6} max={1.6} step={0.05} value={s.wallClockDateScale}
        onChange={(v) => s.set('wallClockDateScale', v)}
        valueLabelDisplay="auto" scale={100}
      />

      <SettingSection title="Секунды" />
      <SettingRow label="Показывать секунды" disabled={off}>
        <Switch
          checked={s.wallClockSeconds} disabled={off} inputProps={{ 'aria-label': 'Показывать секунды' }}
          onChange={(e) => s.set('wallClockSeconds', e.target.checked)}
        />
      </SettingRow>
      {s.wallClockSeconds && (
        <>
          <SettingRow label="Где стоят секунды" disabled={off} stacked>
            <ToggleButtonGroup
              exclusive size="small" fullWidth disabled={off} sx={toggleSx}
              value={s.wallClockSecondsPos}
              onChange={(_, v: WallClockSecondsPos | null) => { if (v) s.set('wallClockSecondsPos', v); }}
            >
              <ToggleButton value="above">Над временем</ToggleButton>
              <ToggleButton value="below">Под временем</ToggleButton>
              <ToggleButton value="left">Слева</ToggleButton>
              <ToggleButton value="right">Справа</ToggleButton>
              <ToggleButton value="topLeft">Сверху слева</ToggleButton>
              <ToggleButton value="topRight">Сверху справа</ToggleButton>
              <ToggleButton value="bottomLeft">Снизу слева</ToggleButton>
              <ToggleButton value="bottomRight">Снизу справа</ToggleButton>
            </ToggleButtonGroup>
          </SettingRow>
          <SettingSlider label="Размер секунд, %" disabled={off}
            min={0.6} max={1.6} step={0.05} value={s.wallClockSecondsScale}
            onChange={(v) => s.set('wallClockSecondsScale', v)}
            valueLabelDisplay="auto" scale={100}
          />
        </>
      )}

      <SettingSection title="Свой HUD" />
      <SettingRow label="Свой HUD вместо часов" disabled={off} wide>
        <ToggleButtonGroup
          exclusive size="small" fullWidth disabled={off} sx={toggleSx}
          value={s.wallClockHudMode || 'builtin'}
          onChange={(_, v: WallClockHudMode | null) => { if (v) s.set('wallClockHudMode', v); }}
        >
          <ToggleButton value="builtin">Встроенные</ToggleButton>
          <ToggleButton value="html">Свой HTML</ToggleButton>
          <ToggleButton value="url">Ссылка</ToggleButton>
        </ToggleButtonGroup>
      </SettingRow>
      {s.wallClockHudMode === 'html' && (
        <Box sx={{ py: 1.25, borderBottom: `1px solid ${theme.border}` }}>
          <TextField
            fullWidth multiline minRows={4} maxRows={12} size="small"
            label="HTML / CSS / JS"
            value={s.wallClockHudHtml || ''}
            onChange={(e) => s.set('wallClockHudHtml', e.target.value.slice(0, WALL_CLOCK_HUD_HTML_MAX))}
            placeholder={HUD_HTML_EXAMPLE}
            helperText={`${(s.wallClockHudHtml || '').length} / ${WALL_CLOCK_HUD_HTML_MAX}. Код работает в изолированном окне без доступа к приложению. Каждую секунду приходит сообщение { type: 'vera-clock', now, locale, color, colorSec, fontFamily }.`}
            inputProps={{ spellCheck: false, style: { fontFamily: 'monospace', fontSize: 12 } }}
          />
        </Box>
      )}
      {s.wallClockHudMode === 'url' && (
        <Box sx={{ py: 1.25, borderBottom: `1px solid ${theme.border}` }}>
          <TextField
            fullWidth size="small"
            label="Ссылка на HUD"
            placeholder="https://example.com/clock.html"
            value={s.wallClockHudUrl || ''}
            onChange={(e) => s.set('wallClockHudUrl', e.target.value.slice(0, 2048))}
            error={!!(s.wallClockHudUrl || '').trim() && !normalizeHudUrl(s.wallClockHudUrl)}
            helperText={(s.wallClockHudUrl || '').trim() && !normalizeHudUrl(s.wallClockHudUrl)
              ? 'Нужна ссылка http:// или https://'
              : 'Сторонний сайт видит ваш IP. Многие сайты запрещают встраивание, тогда будет пусто.'}
          />
        </Box>
      )}
      {s.wallClockHudMode && s.wallClockHudMode !== 'builtin' && (
        <SettingSlider label="Высота HUD, px" disabled={off}
          min={WALL_CLOCK_HUD_HEIGHT_LIMITS.min} max={WALL_CLOCK_HUD_HEIGHT_LIMITS.max} step={10}
          value={s.wallClockHudHeight}
          onChange={(v) => s.set('wallClockHudHeight', v)}
          valueLabelDisplay="auto"
        />
      )}
      <PanelNote>Часы и HUD сохраняются вместе с темой.</PanelNote>
    </Box>
  );
}

// ── Сообщения ──────────────────────────────────────────────────────────────────
export function MessagesPanel() {
  const s = useUserSettingsStore();
  return (
    <Box>
      <SettingSection title="Пузыри сообщений"
        hint="Применяются к чатам без собственных настроек. Для отдельного чата: ⋮ → Настройки отображения." />
      <BubbleSettingsControls variant="rows" value={{
        enabled: s.layout.bubbleEnabled ?? true,
        maxWidth: s.layout.messageMaxWidth,
        textSize: s.layout.bubbleTextSize ?? 15,
        padding: s.layout.bubblePadding ?? 6,
        wallAlign: s.layout.bubbleWallAlign ?? false,
        metaPosOwn: resolveMetaPair({ metaPos: s.layout.bubbleMetaPos, metaPosOwn: s.layout.bubbleMetaPosOwn, metaPosOther: s.layout.bubbleMetaPosOther }).own,
        metaPosOther: resolveMetaPair({ metaPos: s.layout.bubbleMetaPos, metaPosOwn: s.layout.bubbleMetaPosOwn, metaPosOther: s.layout.bubbleMetaPosOther }).other,
      }} onChange={patch => {
        if (patch.wallAlign !== undefined) s.setLayout('bubbleWallAlign', patch.wallAlign);
        if (patch.metaPosOwn !== undefined) s.setLayout('bubbleMetaPosOwn', patch.metaPosOwn);
        if (patch.metaPosOther !== undefined) s.setLayout('bubbleMetaPosOther', patch.metaPosOther);
        if (patch.enabled !== undefined) s.setLayout('bubbleEnabled', patch.enabled);
        if (patch.maxWidth !== undefined) s.setLayout('messageMaxWidth', patch.maxWidth);
        if (patch.textSize !== undefined) s.setLayout('bubbleTextSize', patch.textSize);
        if (patch.padding !== undefined) s.setLayout('bubblePadding', patch.padding);
      }} />

      <SettingSection title="Лента" />
      <ChoiceRow label="Плашка даты в ленте сообщений"
        value={s.chatDateAlign ?? 'center'} onChange={(v) => s.set('chatDateAlign', v as ChatDateAlign)}
        items={[['left', 'Слева'], ['center', 'По центру'], ['right', 'Справа']]} />
      <ChoiceRow label="Форма кружков"
        hint="Видеосообщения, которые вы отправляете. Форму можно сменить и во время записи."
        value={s.roundShape ?? 'circle'} onChange={(v) => s.set('roundShape', normalizeRoundShape(v))}
        items={ROUND_SHAPES.map((r) => [r.id, r.label] as [string, string])} />
      <ChoiceRow label="Текст у фото"
        hint="Где подпись к фото: над изображением или под ним"
        value={s.layout.photoTextPos}
        onChange={(v) => s.setLayout('photoTextPos', v as 'top' | 'bottom')}
        items={[['top', 'Текст над фото'], ['bottom', 'Текст под фото']]} />
      <PanelNote>Всё вместе сохраняется в теме.</PanelNote>
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
  return (
    <Box>
      <SettingSection title="Конструктор" />
      <SettingRow label="Визуальный конструктор" hint="Перетаскивайте панели мышью — изменения видны сразу">
        <Button variant="contained" onClick={() => setDesignerOpen(true)}
          sx={{ bgcolor: theme.accent, textTransform: 'none', borderRadius: 2, '&:hover': { bgcolor: theme.accent } }}>
          🎨 Открыть
        </Button>
      </SettingRow>

      <SettingSection title="Расположение панелей" />
      <ChoiceRow label="Сторона панели чатов (десктоп)"
        value={s.layout.sidebarSide} onChange={(v) => s.setLayout('sidebarSide', v as SidePos)}
        items={[['left', 'Слева'], ['right', 'Справа'], ['top', 'Сверху'], ['bottom', 'Снизу']]} />
      <ChoiceRow label="Нижняя навигация (мобильный)"
        value={s.layout.mobileNavPos} onChange={(v) => s.setLayout('mobileNavPos', v as VertPos)}
        items={[['bottom', 'Снизу'], ['top', 'Сверху']]} />
      <ChoiceRow label="Нижняя панель сайдбара (десктоп)"
        hint="«Как на телефоне» — парящая плашка с подписями под иконками. Скругление углов — во вкладке «Стиль»."
        value={s.layout.desktopNavStyle ?? 'compact'} onChange={(v) => s.setLayout('desktopNavStyle', v as DesktopNavStyle)}
        items={[['compact', 'Компактная'], ['phone', 'Как на телефоне']]} />
      <ChoiceRow label="Плеер"
        hint="«Слева» и «Справа» — отдельная панель у края окна. «В инфопанели» — внутри панели информации о чате."
        value={s.layout.playerPos} onChange={(v) => s.setLayout('playerPos', v as PlayerPos)}
        items={[['bottom', 'Снизу'], ['top', 'Сверху'], ['left', 'Слева'], ['right', 'Справа'], ['info', 'В инфопанели']]} />
      <ChoiceRow label="Шапка чата"
        value={s.layout.chatHeaderPos} onChange={(v) => s.setLayout('chatHeaderPos', v as VertPos)}
        items={[['top', 'Сверху'], ['bottom', 'Снизу']]} />
      <ChoiceRow label="Шапка чата на телефоне"
        hint="«Сплошная» — тёмная полоса во всю ширину. «Остров» — круглые кнопки и плашка с именем из матового стекла поверх обоев."
        value={s.layout.mobileHeaderStyle ?? 'solid'} onChange={(v) => s.setLayout('mobileHeaderStyle', v as LayoutSettings['mobileHeaderStyle'])}
        items={[['solid', 'Сплошная'], ['island', 'Остров']]} />
      <ChoiceRow label="Поле ввода чата"
        value={s.layout.chatInputPos} onChange={(v) => s.setLayout('chatInputPos', v as VertPos)}
        items={[['bottom', 'Снизу'], ['top', 'Сверху']]} />

      <SettingSection title="Размеры" />
      <ChoiceRow label="Плотность интерфейса"
        value={s.layout.density} onChange={(v) => s.setLayout('density', v as Density)}
        items={[['compact', 'Компактно'], ['cozy', 'Обычно'], ['roomy', 'Просторно']]} />
      <SettingSlider label="Скругление углов окна чата и панелей, px"
        min={0} max={28} step={1} value={s.layout.radius}
        onChange={(v) => s.setLayout('radius', v)} />
      <SettingSlider label="Ширина боковой панели, px"
        hint="Панель чатов можно также перетаскивать за правый край мышью — ширина сохранится."
        min={200} max={sidebarWidthMax} step={5} value={Math.min(s.layout.sidebarWidth, sidebarWidthMax)}
        onChange={(v) => s.setLayout('sidebarWidth', v)} />

      <SettingSection title="Список чатов" />
      <RowToggle label="Показывать вкладки (Диалоги / Архив / Группы)"
        checked={s.layout.showTabs} onChange={(v) => s.setLayout('showTabs', v)} />
      <RowToggle label="Показывать аватары в списке чатов"
        checked={s.layout.showAvatarsInList} onChange={(v) => s.setLayout('showAvatarsInList', v)} />

      <SettingSection title="Сброс" />
      <SettingRow label="Сбросить макет" hint="Вернуть расположение и размеры по умолчанию">
        <Button variant="outlined" startIcon={<RestartAlt />} onClick={() => s.resetLayout()}
          sx={{ color: theme.text, borderColor: theme.border, textTransform: 'none' }}>
          Сбросить макет по умолчанию
        </Button>
      </SettingRow>
      <PanelNote>Всё вместе сохраняется в теме. Пузыри сообщений и плашка даты — во вкладке «Сообщения».</PanelNote>

      <LayoutDesignerDialog open={designerOpen} onClose={() => setDesignerOpen(false)} />
    </Box>
  );
}
