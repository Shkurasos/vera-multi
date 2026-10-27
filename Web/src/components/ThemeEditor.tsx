import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Box, Typography, TextField, Button, InputAdornment, IconButton, useMediaQuery } from '@mui/material';
import { ContentCopy } from '@mui/icons-material';
import { useThemeStore, CUSTOM_THEME_ID_START, Theme, themeToLink, themeFromLink, snapshotThemeSettings } from '../store/themeStore';
import { aiApi } from '../services/botsApi';
import { communityThemesApi, CommunityTheme } from '../services/api';
import { useShopStore } from '../store/shopStore';
import VpIcon from './VpIcon';
import {
  WallpaperPanel, SoundPanel, IconsPanel, UiStylePanel, AnimationsPanel, AppearancePanel, ClockPanel, MessagesPanel, LayoutPanel,
  ThemeSettingsLayer,
} from './ThemeSettingsPanels';
import { autoBubbleGradient, regenerateAutoGradient, bubbleBackground } from '../utils/bubbleGradient';
import {
  TAB_GROUPS, SETTINGS_TABS, TAB_LABELS, searchSettings, findSettingElement,
  type SettingsTabId, type SettingsIndexEntry,
} from '../utils/themeEditorSearch';
import { UI_MODES } from '../store/uiPrefsStore';
import { readableTextOn } from '../utils/contrast';
import { ANIM_GROUPS } from '../store/animStore';
import { SLIDE_MEDIA, SLIDE_IN_MS, SLIDE_OUT_MS, SLIDE_EASE, SLIDE_KEYFRAMES_CSS, slideAllowed } from '../utils/slidePanel';

// ─── Последняя вкладка редактора ──────────────────────────────────────────────
// Список и группы вкладок — в utils/themeEditorSearch.ts (там же индекс поиска).
type EditorTab = SettingsTabId;
const EDITOR_TABS: readonly EditorTab[] = SETTINGS_TABS;
const LAST_TAB_KEY = 'vera-theme-editor-tab';
function readLastEditorTab(): EditorTab {
  try {
    const saved = localStorage.getItem(LAST_TAB_KEY);
    if (saved && (EDITOR_TABS as readonly string[]).includes(saved)) return saved as EditorTab;
  } catch {}
  return 'theme';
}

/** Строки панелей, которые строятся из сторов, — тоже ищутся. */
const DYNAMIC_SEARCH_ENTRIES: readonly SettingsIndexEntry[] = [
  ...UI_MODES.map((m) => ({ tab: 'ui' as const, label: m.label, keywords: `режим ${m.desc}` })),
  ...ANIM_GROUPS.map((g) => ({ tab: 'anim' as const, label: `${g.emoji} ${g.label}`, keywords: `анимация ${g.desc}` })),
];

// ─── SVG паттерны ─────────────────────────────────────────────────────────────
function svgUrl(content: string) {
  return 'url("data:image/svg+xml,' + encodeURIComponent(content) + '")';
}

export const PATTERN_LIST: { id: string; label: string; fn: (c: string) => string }[] = [
  { id: 'none',       label: 'Нет',          fn: () => '' },
  { id: 'dots',       label: 'Точки',        fn: c => svgUrl('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\'><circle cx=\'12\' cy=\'12\' r=\'1.2\' fill=\'' + c + '\'/></svg>') },
  { id: 'grid',       label: 'Сетка',        fn: c => svgUrl('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'20\' height=\'20\'><path d=\'M20 0 L0 0 0 20\' fill=\'none\' stroke=\'' + c + '\' stroke-width=\'0.5\'/></svg>') },
  { id: 'diamonds',   label: 'Ромбы',        fn: c => svgUrl('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\'><path d=\'M12 2 L22 12 L12 22 L2 12 Z\' fill=\'none\' stroke=\'' + c + '\' stroke-width=\'0.8\'/></svg>') },
  { id: 'waves',      label: 'Волны',        fn: c => svgUrl('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'60\' height=\'20\'><path d=\'M0 10 Q15 0 30 10 Q45 20 60 10\' fill=\'none\' stroke=\'' + c + '\' stroke-width=\'0.8\'/></svg>') },
  { id: 'hexagons',   label: 'Гексагоны',    fn: c => svgUrl('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'40\' height=\'46\'><polygon points=\'20,2 38,12 38,34 20,44 2,34 2,12\' fill=\'none\' stroke=\'' + c + '\' stroke-width=\'0.7\'/></svg>') },
  { id: 'stars',      label: 'Звёзды',       fn: c => svgUrl('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'32\' height=\'32\'><text x=\'50%\' y=\'55%\' dominant-baseline=\'middle\' text-anchor=\'middle\' font-size=\'10\' fill=\'' + c + '\'>✦</text></svg>') },
  { id: 'crosses',    label: 'Кресты',       fn: c => svgUrl('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'20\' height=\'20\'><line x1=\'10\' y1=\'4\' x2=\'10\' y2=\'16\' stroke=\'' + c + '\' stroke-width=\'0.7\'/><line x1=\'4\' y1=\'10\' x2=\'16\' y2=\'10\' stroke=\'' + c + '\' stroke-width=\'0.7\'/></svg>') },
  { id: 'flowers',    label: 'Цветы',        fn: c => svgUrl('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'36\' height=\'36\'><circle cx=\'18\' cy=\'12\' r=\'3\' fill=\'' + c + '\' opacity=\'0.5\'/><circle cx=\'24\' cy=\'18\' r=\'3\' fill=\'' + c + '\' opacity=\'0.5\'/><circle cx=\'18\' cy=\'24\' r=\'3\' fill=\'' + c + '\' opacity=\'0.5\'/><circle cx=\'12\' cy=\'18\' r=\'3\' fill=\'' + c + '\' opacity=\'0.5\'/><circle cx=\'18\' cy=\'18\' r=\'2.5\' fill=\'' + c + '\' opacity=\'0.7\'/></svg>') },
  { id: 'triangles',  label: 'Треугольники', fn: c => svgUrl('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'28\' height=\'28\'><polygon points=\'14,3 25,24 3,24\' fill=\'none\' stroke=\'' + c + '\' stroke-width=\'0.7\'/></svg>') },
  { id: 'diagonals',  label: 'Диагонали',    fn: c => svgUrl('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\'><line x1=\'0\' y1=\'12\' x2=\'12\' y2=\'0\' stroke=\'' + c + '\' stroke-width=\'0.6\'/></svg>') },
  { id: 'scales',     label: 'Чешуя',        fn: c => svgUrl('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'40\' height=\'20\'><path d=\'M0 20 Q10 10 20 20 Q30 10 40 20\' fill=\'none\' stroke=\'' + c + '\' stroke-width=\'0.7\'/></svg>') },
  { id: 'snowflakes', label: 'Снежинки',     fn: c => svgUrl('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'36\' height=\'36\'><line x1=\'18\' y1=\'4\' x2=\'18\' y2=\'32\' stroke=\'' + c + '\' stroke-width=\'0.7\'/><line x1=\'4\' y1=\'18\' x2=\'32\' y2=\'18\' stroke=\'' + c + '\' stroke-width=\'0.7\'/><line x1=\'7\' y1=\'7\' x2=\'29\' y2=\'29\' stroke=\'' + c + '\' stroke-width=\'0.7\'/><line x1=\'29\' y1=\'7\' x2=\'7\' y2=\'29\' stroke=\'' + c + '\' stroke-width=\'0.7\'/><circle cx=\'18\' cy=\'18\' r=\'2\' fill=\'' + c + '\'/></svg>') },
  { id: 'moons',      label: 'Луны',         fn: c => svgUrl('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'32\' height=\'32\'><path d=\'M20,16 A8,8 0 1,1 16,8 A6,6 0 1,0 20,16 Z\' fill=\'' + c + '\' opacity=\'0.4\'/></svg>') },
  { id: 'leaves',     label: 'Листья',       fn: c => svgUrl('<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'40\' height=\'40\'><path d=\'M5,35 Q20,5 35,5 Q35,20 20,30 Q12,35 5,35 Z\' fill=\'none\' stroke=\'' + c + '\' stroke-width=\'0.8\'/></svg>') },
];

function randomMixedPattern(ids: string[], color: string) {
  const patterns = ids.map(id => PATTERN_LIST.find(p => p.id === id)).filter(Boolean) as typeof PATTERN_LIST;
  if (!patterns.length) return '';
  const size = 150 + Math.floor(Math.random() * 90);
  const cols = 3 + Math.floor(Math.random() * 2);
  const rows = 3 + Math.floor(Math.random() * 2);
  const cellW = size / cols, cellH = size / rows;
  const shapes = Array.from({ length: cols * rows }, (_, i) => {
    const p = patterns[i % patterns.length];
    const raw = decodeURIComponent(p.fn(color)).replace(/^url\("data:image\/svg\+xml,|"\)$/g, '');
    const inner = raw.replace(/<svg[^>]*>|<\/svg>/g, '');
    const x = (i % cols) * cellW + cellW / 2 + (Math.random() - 0.5) * cellW * 0.35;
    const y = Math.floor(i / cols) * cellH + cellH / 2 + (Math.random() - 0.5) * cellH * 0.35;
    const angle = Math.floor(Math.random() * 360);
    const scale = 0.28 + Math.random() * 0.32;
    return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${angle}) scale(${scale}) translate(-20 -20)" opacity="${(0.35 + Math.random() * 0.35).toFixed(2)}">${inner}</g>`;
  }).join('');
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${shapes}</svg>`);
}

function patternBackgroundSize(pattern?: string, min = 860, max = 1400): string | undefined {
  if (!pattern) return undefined;
  const layers = Math.max(1, (pattern.match(/url\(/g) || []).length);
  const low = Math.max(200, Math.min(min, max));
  const high = Math.max(low, Math.max(min, max));
  return Array.from({ length: layers }, (_, index) => {
    const size = layers === 1 ? high : low + ((high - low) * index) / (layers - 1);
    return `${size}px ${size}px`;
  }).join(', ');
}

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
}

/** Строка настройки в духе CS2: название слева, элемент управления справа. */
function settingRowStyle(border: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 16, padding: '12px 2px', borderBottom: '1px solid ' + border,
  };
}

function ColorField({ label, value, onChange, bare }: ColorFieldProps) {
  const theme = useThemeStore((s) => s.theme);
  const safeColor = value && value.match(/^#[0-9a-fA-F]{3,8}$/) ? value : '#888888';
  const rowStyle: React.CSSProperties = bare
    ? { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, padding: '6px 0 0' }
    : settingRowStyle(theme.border);
  return (
    <div style={rowStyle}>
      {!bare && <span style={{ fontSize: 14.5, opacity: 0.92, minWidth: 0 }}>{label}</span>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <input
          type="color"
          value={safeColor}
          onChange={e => onChange(e.target.value)}
          style={{ width: 36, height: 28, padding: 0, border: '1px solid ' + theme.border, borderRadius: 5, cursor: 'pointer', background: 'none' }}
        />
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{
            width: 104, fontSize: 12.5, fontWeight: 700, textAlign: 'center', padding: '5px 8px', borderRadius: 5,
            border: '1px solid ' + theme.border, background: theme.bgInput,
            color: theme.text, fontFamily: 'monospace', letterSpacing: '0.04em', textTransform: 'uppercase', boxSizing: 'border-box',
          }}
        />
      </div>
    </div>
  );
}

interface ColorFieldProps { label: string; value: string; onChange: (v: string) => void; bare?: boolean }

/**
 * Цвет пузыря вместе с галочкой «градиент».
 *
 * Галочка — это и есть переключатель режима: стоит — рисуем градиент, снята —
 * сплошной цвет. Отдельного поля «включить/выключить» не заводим: состояние
 * галочки выводится из наличия строки градиента, поэтому лишних рассинхронов
 * «галочка стоит, а градиент пустой» не бывает по определению.
 *
 * Галочка появляется только когда цвет разбирается: для hsl() и `var()` градиент
 * построить не из чего, и галочка смотрелась бы рабочей, а ничего бы не делала.
 */
function BubbleColorField({
  label, color, gradient, onColor, onGradient,
}: {
  label: string;
  color: string;
  gradient?: string;
  onColor: (v: string) => void;
  onGradient: (v: string) => void;
}) {
  const on = !!gradient;
  // Считаем, что градиент нам по силам, ровно если из цвета выйдет не пустота.
  const canGradient = autoBubbleGradient(color) !== color;
  const toggleGradient = () => onGradient(on ? '' : autoBubbleGradient(color));
  const theme = useThemeStore((s) => s.theme);

  return (
    <div style={{ padding: '10px 2px 12px', borderBottom: '1px solid ' + theme.border }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14.5, opacity: 0.92, flex: 1, minWidth: 120 }}>{label}</span>
        <label
          style={{
            display: 'flex', alignItems: 'center', gap: 5, cursor: canGradient ? 'pointer' : 'default',
            fontSize: 12, opacity: canGradient ? 0.9 : 0.4, userSelect: 'none', flexShrink: 0,
          }}
          title={canGradient ? 'Градиент вместо сплошного цвета' : 'Этот цвет нельзя превратить в градиент'}
        >
          <input
            type="checkbox"
            checked={on}
            disabled={!canGradient}
            onChange={toggleGradient}
            style={{ width: 15, height: 15, cursor: canGradient ? 'pointer' : 'default', margin: 0 }}
          />
          градиент
        </label>
      </div>
      <ColorField
        label=""
        bare
        value={on ? autoBubbleGradient(color) : color}
        onChange={v => {
          // Галочка снята — поле правит сплошной цвет. Стоит — градиент
          // пересобирается под новый цвет, но рукописный CSS не трогаем.
          if (on) onGradient(regenerateAutoGradient(v, color, gradient));
          else onColor(v);
        }}
      />
      {on && (
        <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>
          Галочка снята — снова сплошной цвет. Свой CSS можно вписать в поле ниже.
        </div>
      )}
    </div>
  );
}

function makeId() {
  return CUSTOM_THEME_ID_START + (Date.now() % 9000000);
}

function communityAssetUrl(url: string | null) {
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : window.location.origin + (url.startsWith('/') ? url : '/' + url);
}

function CommunityThemesPanel({
  draft, theme, saveCustomTheme, setTheme,
}: { draft: Theme; theme: Theme; saveCustomTheme: (theme: Theme) => void; setTheme: (id: number) => void }) {
  const [items, setItems] = useState<CommunityTheme[]>([]);
  const [query, setQuery] = useState('');
  const [name, setName] = useState(draft.name || 'Тема сообщества');
  const [description, setDescription] = useState('');
  const [preview, setPreview] = useState<File>();
  const [asset, setAsset] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async (q = query) => {
    try { setItems((await communityThemesApi.list(q)).data.themes || []); }
    catch { setMessage('Не удалось загрузить каталог'); }
  }, [query]);
  useEffect(() => { void load(''); }, [load]);

  const upload = async () => {
    setBusy(true); setMessage('');
    try {
      const blob = new Blob([JSON.stringify({ ...draft, settings: draft.settings || undefined })], { type: 'application/json' });
      await communityThemesApi.upload(blob, name, description, preview, asset);
      setDescription(''); setPreview(undefined); setAsset(undefined); setMessage('Тема опубликована'); await load();
    } catch (e: any) { setMessage(e?.response?.data?.message || 'Ошибка публикации'); }
    finally { setBusy(false); }
  };
  const install = async (item: CommunityTheme) => {
    setBusy(true); setMessage('');
    try {
      const result = await communityThemesApi.install(item.id);
      const installed = { ...result.data.theme.theme, id: makeId(), name: item.name } as Theme;
      saveCustomTheme(installed); setTheme(installed.id); setMessage(`«${item.name}» установлена`);
    } catch (e: any) { setMessage(e?.response?.data?.message || 'Не удалось установить тему'); }
    finally { setBusy(false); }
  };
  const remove = async (item: CommunityTheme) => {
    if (!window.confirm(`Удалить публикацию «${item.name}»?`)) return;
    try { await communityThemesApi.remove(item.id); await load(); }
    catch (e: any) { setMessage(e?.response?.data?.message || 'Не удалось удалить публикацию'); }
  };
  const downloadTheme = async (item: CommunityTheme) => {
    try {
      const response = await communityThemesApi.download(item.id);
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a'); link.href = url; link.download = `${item.name.replace(/[^a-z0-9_-]+/gi, '_') || 'theme'}.json`;
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch { setMessage('Не удалось скачать тему'); }
  };

  return <div>
    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Темы комьюнити</div>
    <div style={{ fontSize: 12, opacity: .65, marginBottom: 12 }}>Публикуйте тему вместе с превью, обоями или шрифтом.</div>
    <div style={{ display: 'grid', gap: 7, marginBottom: 16 }}>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Название темы" style={{ padding: 8, borderRadius: 6, border: `1px solid ${theme.border}`, background: theme.bgInput, color: theme.text }} />
      <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Описание" style={{ padding: 8, borderRadius: 6, border: `1px solid ${theme.border}`, background: theme.bgInput, color: theme.text }} />
      <label style={{ fontSize: 12 }}>Превью <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => setPreview(e.target.files?.[0])} /></label>
      <label style={{ fontSize: 12 }}>Фото или шрифт <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,.ttf,.otf,.woff,.woff2" onChange={e => setAsset(e.target.files?.[0])} /></label>
      <button disabled={busy || !name.trim()} onClick={() => void upload()} style={{ padding: '8px 12px', border: 0, borderRadius: 7, background: theme.accent, color: readableTextOn(theme.accent), cursor: 'pointer' }}>Опубликовать текущую тему</button>
    </div>
    <div style={{ display: 'flex', gap: 7, marginBottom: 12 }}>
      <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void load(); }} placeholder="Поиск по каталогу" style={{ flex: 1, padding: 8, borderRadius: 6, border: `1px solid ${theme.border}`, background: theme.bgInput, color: theme.text }} />
      <button onClick={() => void load()} style={{ padding: '6px 10px', borderRadius: 6, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, cursor: 'pointer' }}>Найти</button>
    </div>
    {message && <div style={{ fontSize: 12, color: theme.accent, marginBottom: 8 }}>{message}</div>}
    <div style={{ display: 'grid', gap: 8 }}>
      {items.map(item => <div key={item.id} onClick={() => void install(item)} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 8, border: `1px solid ${theme.border}`, borderRadius: 7, cursor: 'pointer' }}>
        {item.previewUrl ? <img src={communityAssetUrl(item.previewUrl)} alt="" style={{ width: 54, height: 42, objectFit: 'cover', borderRadius: 5 }} /> : <div style={{ width: 54, height: 42, background: item.theme?.accent || theme.accent, borderRadius: 5 }} />}
        <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontWeight: 600 }}>{item.name}</div><div style={{ fontSize: 11, opacity: .65, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description || `Автор: ${item.authorName}`} · {item.downloads} установок</div></div>
        <button onClick={(e) => { e.stopPropagation(); void install(item); }} disabled={busy} style={{ padding: '6px 9px', border: `1px solid ${theme.accent}`, borderRadius: 6, background: 'transparent', color: theme.accent, cursor: 'pointer' }}>Установить</button>
        <button onClick={() => void downloadTheme(item)} style={{ padding: '6px 9px', border: `1px solid ${theme.border}`, borderRadius: 6, background: 'transparent', color: theme.text, cursor: 'pointer' }}>JSON</button>
        {item.assetUrl && <a href={communityAssetUrl(item.assetUrl)} download style={{ fontSize: 12, color: theme.accent }}>Скачать</a>}
        <button onClick={(e) => { e.stopPropagation(); void remove(item); }} title="Удалить свою публикацию" style={{ border: 0, background: 'transparent', color: '#f87171', cursor: 'pointer' }}>×</button>
      </div>)}
      {!items.length && <div style={{ fontSize: 12, opacity: .6 }}>Публикаций пока нет.</div>}
    </div>
  </div>;
}

interface Props {
  onClose: () => void;
  onGoChats?: () => void;
  initialTheme?: Theme;
  onApply?: (theme: Theme) => void;
  /**
   * 'app' — редактор всей темы; 'chat' — только то, что реально рисует окно
   * чата. Список оставленных полей сверен с обращениями к `theme.*` в
   * ChatWindow/MessageBubble, а не выбран на глаз.
   */
  mode?: 'app' | 'chat';
  /**
   * Дополнительный элемент в шапке плашки. Редактору чата нужен переключатель
   * «применять тему», но самому редактору знать про чат незачем — передаём
   * готовый элемент, чтобы не оборачивать плашку ещё одним полноэкранным окном.
   */
  headerExtra?: React.ReactNode;
}

export function ThemeEditor({ onClose: closeNow, onGoChats: goChatsNow, initialTheme, onApply, mode = 'app', headerExtra }: Props) {
  const isChat = mode === 'chat';
  // На телефоне редактор — полноэкранный экран, который выезжает справа и
  // уезжает туда же. Закрытие ждёт конца анимации, потом зовёт родителя.
  const mobile = useMediaQuery(SLIDE_MEDIA);
  const [leaving, setLeaving] = useState(false);
  const leaveThen = (cb: () => void) => {
    if (leaving) return;
    if (!slideAllowed()) { cb(); return; }
    setLeaving(true);
    window.setTimeout(cb, SLIDE_OUT_MS);
  };
  const onClose = () => leaveThen(closeNow);
  const onGoChats = goChatsNow && (() => leaveThen(goChatsNow));
  const { theme, customThemes, saveCustomTheme, deleteCustomTheme, setTheme, themeId, builtinThemes } = useThemeStore();

  const [draft, setDraft] = useState<Theme>(() => {
    // Если передан initialTheme (из магазина) — используем его
    if (initialTheme) return { ...initialTheme };
    if (themeId >= CUSTOM_THEME_ID_START) return { ...theme };
    return {
      ...theme,
      id: makeId(),
      name: 'Моя тема',
      chatPattern: '',
      chatPatternSizeMin: 860,
      chatPatternSizeMax: 1400,
      bubbleOwnGradient: theme.bubbleOwnGradient || '',
      bubbleOtherGradient: theme.bubbleOtherGradient || '',
      bubbleOwnShadow: theme.bubbleOwnShadow || '',
      bubbleOtherShadow: theme.bubbleOtherShadow || '',
      sidebarGradient: theme.sidebarGradient || '',
      headerGradient: theme.headerGradient || '',
      bubbleOwnText: theme.bubbleOwnText || '#ffffff',
    };
  });

  const [patternId, setPatternId] = useState('none');
  const [patternColor, setPatternColor] = useState('#7c6af7');
  const [patternIds, setPatternIds] = useState<string[]>([]);
  const [themeLink, setThemeLink] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  // Вкладки редактора: первая — сама тема, остальные — настройки (обои, звук,
  // иконки, анимации, внешний вид, макет). В режиме чата доступна только вкладка
  // «Тема» — палитра и фон чата. Остальные настройки (обои, звук, шрифт)
  // настраиваются через меню чата отдельно (они в per-chat сторах).
  // Последняя открытая вкладка запоминается (только для темы приложения),
  // чтобы редактор открывался там, где его закрыли.
  const [tab, setTabState] = useState<EditorTab>(() => (isChat ? 'theme' : readLastEditorTab()));
  const setTab = useCallback((next: EditorTab) => {
    setTabState(next);
    if (!isChat) {
      try { localStorage.setItem(LAST_TAB_KEY, next); } catch {}
    }
  }, [isChat]);

  // ── Поиск по настройкам ──────────────────────────────────────────────────
  // Выбор результата открывает нужную вкладку, а после её отрисовки строка
  // находится по подписи, прокручивается в центр и коротко подсвечивается.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchActive, setSearchActive] = useState(0);
  const [pendingJump, setPendingJump] = useState<SettingsIndexEntry | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const searchResults = React.useMemo(
    () => (isChat ? [] : searchSettings(searchQuery, DYNAMIC_SEARCH_ENTRIES)),
    [searchQuery, isChat],
  );
  const jumpTo = useCallback((entry: SettingsIndexEntry) => {
    setTab(entry.tab);
    setPendingJump(entry);
    setSearchOpen(false);
  }, [setTab]);
  useEffect(() => {
    if (!pendingJump || pendingJump.tab !== tab) return;
    // Панель могла ещё не отрисоваться — ждём кадр.
    const raf = requestAnimationFrame(() => {
      const el = findSettingElement(bodyRef.current, pendingJump.label);
      setPendingJump(null);
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.animate?.(
        [{ backgroundColor: theme.accent + '33' }, { backgroundColor: 'transparent' }],
        { duration: 1400, easing: 'ease-out' },
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [pendingJump, tab, theme.accent]);

  const handleAiGenerate = async () => {
    const desc = aiPrompt.trim();
    if (!desc) { setAiError('Опишите желаемую тему'); return; }
    setAiLoading(true); setAiError('');
    try {
      const res = await aiApi.generateTheme(desc);
      const t = (res.data as any).theme as Theme;
      // Сохраняем id/имя пользователя, заливаем остальные поля из ИИ
      setDraft(d => ({ ...t, id: d.id, name: t.name || d.name }));
      setPatternId('none');
      const balance = (res.data as any).balance;
      if (typeof balance === 'number') useShopStore.getState().setBalance(balance);
    } catch (e: any) {
      setAiError(e?.response?.data?.message || 'Ошибка генерации');
    } finally {
      setAiLoading(false);
    }
  };

  const upd = useCallback((key: keyof Theme, val: string) => {
    setDraft(d => ({ ...d, [key]: val }));
  }, []);

  const applyPattern = useCallback((pid: string, color: string) => {
    const p = PATTERN_LIST.find(x => x.id === pid);
    if (!p) return;
    setDraft(d => ({ ...d, chatPattern: p.fn(color) || undefined }));
    setPatternId(pid);
    setPatternColor(color);
  }, []);
  const togglePattern = (id: string) => {
    const next = patternIds.includes(id) ? patternIds.filter(x => x !== id) : [...patternIds, id];
    setPatternIds(next);
    setDraft(d => ({ ...d, chatPattern: randomMixedPattern(next, patternColor) || undefined }));
  };

  const handleSave = () => {
    // Закрываем в finally: раньше onClose() стоял после сохранения, и любая
    // ошибка внутри (например переполнение localStorage при записи темы)
    // прерывала функцию до закрытия — окно редактора оставалось висеть, а
    // пользователь не понимал, что кнопка «вообще не работает».
    try {
      if (onApply) {
        onApply(draft);
      } else {
        // Настройки темы (обои, звук, иконки/стиль, анимации, внешний вид, макет)
        // снимаются с текущих сторов и живут внутри темы: при её переключении
        // applyThemeSettings запишет их обратно. В режиме чата их не трогаем —
        // это глобальные настройки, а не свойства отдельного чата.
        const saved: Theme = isChat ? draft : { ...draft, settings: snapshotThemeSettings() };
        saveCustomTheme(saved);
        setTheme(saved.id);
      }
    } finally {
      onClose();
    }
  };

  const handleDelete = (id: number) => {
    deleteCustomTheme(id);
  };

  const generateLink = () => {
    const link = themeToLink(draft);
    setThemeLink(link);
    try { navigator.clipboard.writeText(link); } catch {}
  };

  const importLink = () => {
    const raw = prompt('Вставьте ссылку на тему');
    if (!raw) return;
    const parsed = themeFromLink(raw);
    if (!parsed) { alert('Неверная ссылка'); return; }
    setDraft(parsed);
    setPatternId('none');
    setThemeLink('');
  };

  const handleLoad = (t: Theme) => {
    setDraft({ ...t });
    setPatternId('none');
  };

  // ── Превью ──────────────────────────────────────────────────────────────
  const previewChat: React.CSSProperties = {
    background: draft.bgChat || draft.bg,
    backgroundImage: draft.chatPattern || undefined,
    backgroundRepeat: 'repeat',
    backgroundSize: patternBackgroundSize(draft.chatPattern, draft.chatPatternSizeMin, draft.chatPatternSizeMax),
    borderRadius: 8, padding: '10px 12px', minHeight: 110,
    display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6,
  };
  const previewOwn: React.CSSProperties = {
    alignSelf: 'flex-end', maxWidth: '72%',
    background: bubbleBackground(draft.bgBubbleOwn, draft.bubbleOwnGradient),
    color: draft.bubbleOwnText || '#fff',
    boxShadow: draft.bubbleOwnShadow || undefined,
    borderRadius: '14px 14px 4px 14px', padding: '6px 12px', fontSize: 13,
  };
  const previewOther: React.CSSProperties = {
    alignSelf: 'flex-start', maxWidth: '72%',
    background: bubbleBackground(draft.bgBubbleOther, draft.bubbleOtherGradient),
    color: draft.bubbleOtherText || draft.text,
    boxShadow: draft.bubbleOtherShadow || undefined,
    borderRadius: '14px 14px 14px 4px', padding: '6px 12px', fontSize: 13,
  };
  // Время в превью — чтобы выбранный цвет было видно сразу.
  const previewTimeBase: React.CSSProperties = { fontSize: 10, marginTop: 2, textAlign: 'right' };
  const previewTimeOwn: React.CSSProperties = {
    ...previewTimeBase,
    color: draft.messageTimeColor || draft.bubbleOwnText || '#fff',
    opacity: draft.messageTimeColor ? 1 : 0.75,
  };
  const previewTimeOther: React.CSSProperties = {
    ...previewTimeBase,
    color: draft.messageTimeColor || draft.bubbleOtherText || draft.text,
    opacity: draft.messageTimeColor ? 1 : 0.75,
  };

  // ── Стили модалки ───────────────────────────────────────────────────────
  // Плавающая панель поверх всего: отступы от краёв, размытие фона, своя
  // высота. Раньше это была карточка 820 px с прокруткой — половина
  // настроек уезжала за экран.
  const overlay: React.CSSProperties = mobile ? {
    // Телефон: экран целиком, без полей — каждый пиксель под настройки.
    position: 'fixed', inset: 0, zIndex: 9999,
    display: 'flex', alignItems: 'stretch',
    background: leaving ? 'transparent' : 'rgba(0,0,0,0.35)',
    transition: `background ${SLIDE_OUT_MS}ms ${SLIDE_EASE}`,
  } : {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: 'rgba(0,0,0,0.55)',
    backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
    display: 'flex', alignItems: 'stretch', justifyContent: 'center',
    padding: 'max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left))',
  };
  const modal: React.CSSProperties = mobile ? {
    background: theme.sidebarGradient || theme.bgSidebar, color: theme.text,
    width: '100%', height: '100%',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)',
    boxSizing: 'border-box',
    animation: `veraSlideInRight ${SLIDE_IN_MS}ms ${SLIDE_EASE}`,
    transform: leaving ? 'translateX(100%)' : undefined,
    transition: `transform ${SLIDE_OUT_MS}ms ${SLIDE_EASE}`,
  } : {
    background: theme.sidebarGradient || theme.bgSidebar, color: theme.text,
    backdropFilter: 'blur(22px) saturate(1.35)', WebkitBackdropFilter: 'blur(22px) saturate(1.35)',
    borderRadius: 22, width: '100%',
    // Плашка на весь экран: маленькие поля по краям, приложение видно вокруг —
    // так редактор не упирается в панель чатов и не режет половину секций.
    maxWidth: 'min(1680px, 100%)', height: '100%',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    border: '1px solid ' + theme.border,
    boxShadow: '0 28px 80px rgba(0,0,0,0.55)',
  };
  // Прокручиваемая середина между закреплённой шапкой и кнопками.
  const plateBody: React.CSSProperties = {
    flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
    padding: mobile ? '10px 14px 16px' : '18px 20px 20px', boxSizing: 'border-box',
    WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain',
  };
  const plateFooter: React.CSSProperties = {
    flexShrink: 0, display: 'flex', gap: mobile ? 8 : 10, justifyContent: 'space-between',
    alignItems: 'center', flexWrap: mobile ? 'nowrap' : 'wrap', padding: mobile ? '8px 12px' : '12px 20px',
    borderTop: '1px solid ' + theme.border,
    background: 'rgba(0,0,0,0.18)',
  };
  // Заголовок секции — как «Video» в настройках CS2: спокойный текст
  // над группой строк, без рамок и заглавных букв.
  const sectionLabel: React.CSSProperties = {
    fontSize: 13.5, color: theme.textSec, marginBottom: 2, marginTop: 26, fontWeight: 500,
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '5px 9px', borderRadius: 7,
    border: '1px solid ' + theme.border, background: theme.bgInput,
    color: theme.text, fontSize: 13, boxSizing: 'border-box',
  };
  const patternBtnBase: React.CSSProperties = {
    padding: '3px 9px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: '1px solid',
  };
  // Плашка темы в шапке редактора: видно и что СЕЙЧАС стоит, и что
  // НАСТРАИВАЕТСЯ. Раньше здесь было только имя черновика, поэтому в разделах
  // настроек («Обои», «Звук», «Внешний вид»…) было невозможно понять, к какой
  // теме относится правка.
  const themeBadge: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 260,
    padding: '3px 9px', borderRadius: 999, fontSize: 12,
    border: '1px solid ' + theme.border, background: theme.bgInput,
    color: theme.text, boxSizing: 'border-box',
  };
  const badgeDot: React.CSSProperties = {
    width: 8, height: 8, borderRadius: 2, flexShrink: 0,
  };
  // В режиме чата в сторе лежит тема приложения, а не чата — показывать её
  // как «сейчас стоит» было бы враньём, поэтому там только имя черновика.
  const activeThemeName = isChat ? null : (theme?.name || 'Без темы');
  const editingThemeName = draft.name || 'Без названия';
  // Совпадают ли темы: если нет, правки ещё не записаны в стоящую тему.
  const sameAsActive = !isChat && draft.id === themeId;

  // ── Навигация ─────────────────────────────────────────────────────────────
  // Разделы — горизонтальной полосой сверху, как в настройках CS2, но
  // сгруппированы: «Темы | Оформление | Интерфейс | Звук». Группы разделены
  // вертикальной чертой и подписаны мелким текстом, вкладки внутри группы
  // идут плотно. Справа — поиск по всем настройкам.
  // Контент — колонкой по центру, с ограничением по ширине: на широком
  // экране строки растягивались бы в бесконечность, а в CS2 список настроек
  // занимает аккуратную среднюю полосу.
  const editorContent: React.CSSProperties = { flex: 1, minWidth: 0, width: '100%', maxWidth: 1080, margin: '0 auto' };
  const tabGroups = isChat ? [{ title: 'Тема', tabs: [['theme', 'Тема']] as const }] : TAB_GROUPS;
  const tabButton = (id: EditorTab, label: string) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      style={{
        border: 'none', cursor: 'pointer', padding: mobile ? '9px 12px' : '7px 12px', borderRadius: 6,
        flexShrink: 0, minHeight: mobile ? 36 : undefined,
        background: tab === id ? theme.accent : 'transparent',
        // На светлом акценте белые буквы сливаются — берём читаемый цвет.
        color: tab === id ? readableTextOn(theme.accent) : theme.textSec,
        fontSize: 12, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
        fontFamily: 'inherit', whiteSpace: 'nowrap', lineHeight: 1.2,
        transition: 'background .15s, color .15s',
      }}
      onMouseEnter={e => { if (tab !== id) e.currentTarget.style.color = theme.text; }}
      onMouseLeave={e => { if (tab !== id) e.currentTarget.style.color = theme.textSec; }}
    >{label}</button>
  );
  const searchBox = !isChat && (
    <div style={{ position: 'relative', flex: mobile ? '1 1 auto' : '0 1 280px', minWidth: 180 }}>
      <input
        type="search"
        role="combobox"
        aria-expanded={searchOpen && searchQuery.trim() !== ''}
        aria-controls="theme-editor-search-results"
        aria-label="Поиск по настройкам"
        placeholder="🔍 Поиск настройки…"
        value={searchQuery}
        onChange={e => { setSearchQuery(e.target.value); setSearchOpen(true); setSearchActive(0); }}
        onFocus={() => setSearchOpen(true)}
        // Задержка — чтобы клик по результату успел сработать до закрытия.
        onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSearchActive(i => Math.min(i + 1, searchResults.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSearchActive(i => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter' && searchResults[searchActive]) { e.preventDefault(); jumpTo(searchResults[searchActive]); }
          else if (e.key === 'Escape') { setSearchQuery(''); setSearchOpen(false); }
        }}
        style={{ ...inputStyle, padding: '7px 11px', borderRadius: 8 }}
      />
      {searchOpen && searchQuery.trim() !== '' && (
        <div
          id="theme-editor-search-results"
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0, left: 0, zIndex: 5,
            maxHeight: 360, overflowY: 'auto', padding: 4, borderRadius: 8,
            background: theme.bgSidebar, border: '1px solid ' + theme.border,
            boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
          }}
        >
          {searchResults.length === 0 && (
            <div style={{ padding: '8px 10px', fontSize: 12.5, opacity: 0.6 }}>Ничего не найдено</div>
          )}
          {searchResults.map((r, i) => (
            <div
              key={r.tab + r.label}
              role="option"
              aria-selected={i === searchActive}
              onMouseDown={e => { e.preventDefault(); jumpTo(r); }}
              onMouseEnter={() => setSearchActive(i)}
              style={{
                display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline',
                padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
                background: i === searchActive ? theme.bgHover : 'transparent',
              }}
            >
              <span style={{ fontSize: 13, color: theme.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
              <span style={{ fontSize: 11, color: theme.textSec, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{TAB_LABELS[r.tab]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
  const nav = mobile ? (
    // Телефон: все разделы одной строкой с горизонтальной прокруткой и поиск
    // под ней. Подписи групп и подсказка съедали треть экрана.
    <nav aria-label="Разделы редактора" style={{
      flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6,
      padding: '6px 0 8px', borderBottom: '1px solid ' + theme.border,
      background: 'rgba(0,0,0,0.18)',
    }}>
      <div style={{
        display: 'flex', gap: 4, overflowX: 'auto', overflowY: 'hidden',
        padding: '0 12px', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch',
      }}>
        {tabGroups.flatMap(g => g.tabs.map(([id, label]) => tabButton(id, label)))}
      </div>
      {searchBox && <div style={{ display: 'flex', padding: '0 12px' }}>{searchBox}</div>}
    </nav>
  ) : (
    <nav aria-label="Разделы редактора" style={{
      flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'stretch',
      gap: 6, padding: '8px 16px', borderBottom: '1px solid ' + theme.border,
      background: 'rgba(0,0,0,0.18)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'stretch', flexWrap: 'wrap', rowGap: 6, minWidth: 0 }}>
          {tabGroups.map((g, gi) => (
            <div key={g.title} role="group" aria-label={g.title} style={{
              display: 'flex', flexDirection: 'column', gap: 2, padding: '0 10px',
              borderLeft: gi > 0 ? '1px solid ' + theme.border : 'none',
            }}>
              <span aria-hidden style={{ fontSize: 10, color: theme.textSec, opacity: 0.6, letterSpacing: '0.08em', textTransform: 'uppercase', paddingLeft: 12, userSelect: 'none' }}>{g.title}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                {g.tabs.map(([id, label]) => tabButton(id, label))}
              </div>
            </div>
          ))}
        </div>
        {searchBox}
      </div>
      {!isChat && (
        <div style={{ fontSize: 11, lineHeight: 1.4, opacity: 0.5, textAlign: 'center' }}>
          Оформление, интерфейс и звук — настройки этой темы. У каждой темы свои.
        </div>
      )}
    </nav>
  );

  const content = (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      {mobile && <style>{SLIDE_KEYFRAMES_CSS}</style>}
      <div style={modal}>
        {/* Шапка */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: mobile ? 8 : 12, padding: mobile ? '6px 6px 6px 14px' : '14px 20px', borderBottom: '1px solid ' + theme.border }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: mobile ? 15 : 16, fontWeight: 700 }}>{isChat ? '🎨 Оформление чата' : '🎨 Редактор темы'}</h2>
            {/* Какая тема стоит и какая настраивается — видно в ЛЮБОМ разделе,
                а не только на вкладке «Тема». Иначе в «Обоях» или «Звуке» было
                невозможно понять, к какой теме относится правка. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: mobile ? 3 : 5, flexWrap: mobile ? 'nowrap' : 'wrap', minWidth: 0, overflow: 'hidden' }}>
              {activeThemeName !== null && (
                <span style={themeBadge} title="Тема, применённая в приложении прямо сейчас">
                  <span style={{ ...badgeDot, background: theme.accent }} />
                  <span style={{ opacity: 0.6 }}>Стоит:</span>
                  <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {activeThemeName}
                  </span>
                </span>
              )}
              <span style={themeBadge} title="Тема, которую вы сейчас редактируете">
                <span style={{ ...badgeDot, background: draft.accent || theme.accent }} />
                <span style={{ opacity: 0.6 }}>{activeThemeName !== null ? 'Настраивается:' : 'Тема чата:'}</span>
                <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {editingThemeName}
                </span>
              </span>
              {!sameAsActive && !isChat && !mobile && (
                <span style={{ fontSize: 11, opacity: 0.55 }}>изменения ещё не применены</span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: mobile ? 2 : 8, flexShrink: 0 }}>
            {headerExtra}
            {onGoChats && (
              <button
                onClick={onGoChats}
                style={{ background: 'none', border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.accent, padding: '6px 10px', cursor: 'pointer', fontSize: 13, minHeight: mobile ? 36 : undefined }}
              >Чаты</button>
            )}
            <button
              onClick={onClose}
              aria-label="Закрыть редактор"
              style={{ background: 'none', border: 'none', color: theme.text, fontSize: 22, cursor: 'pointer', opacity: 0.6, lineHeight: 1, minWidth: mobile ? 44 : undefined, minHeight: mobile ? 44 : undefined }}
            >×</button>
          </div>
        </div>

        {nav}

        <div style={plateBody} ref={bodyRef}>
         <div style={editorContent}>
         {tab === 'theme' && (
         <>
         {/* Мои сохранённые темы */}
         {!onApply && customThemes.length > 0 && (
           <div style={{ marginBottom: 14 }}>
             <div style={sectionLabel}>Мои темы</div>
             <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
               {customThemes.map(ct => (
                 <div
                   key={ct.id}
                   style={{
                     display: 'flex', alignItems: 'center', gap: 4,
                     background: themeId === ct.id ? theme.accent + '28' : theme.bgHover,
                     border: '1px solid ' + (themeId === ct.id ? theme.accent : theme.border),
                     borderRadius: 8, padding: '3px 10px', fontSize: 13,
                   }}
                 >
                   <div style={{ width: 10, height: 10, borderRadius: 3, background: ct.accent, marginRight: 2, flexShrink: 0 }} />
                   <span style={{ cursor: 'pointer' }} onClick={() => { setTheme(ct.id); handleLoad(ct); }}>{ct.name}</span>
                   <button onClick={() => handleLoad(ct)} title="Редактировать" style={{ background: 'none', border: 'none', color: theme.accent, cursor: 'pointer', fontSize: 12, padding: '0 2px', lineHeight: 1 }}>✏</button>
                   <button onClick={() => handleDelete(ct.id)} title="Удалить" style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 12, padding: '0 2px', lineHeight: 1 }}>✕</button>
                   <button onClick={() => { const l = themeToLink(ct); setThemeLink(l); try { navigator.clipboard.writeText(l); } catch {} }} title="Копировать ссылку" style={{ background: 'none', border: 'none', color: theme.textSec, cursor: 'pointer', fontSize: 12, padding: '0 2px', lineHeight: 1 }}>🔗</button>
                 </div>
               ))}
             </div>
           </div>
         )}

         {/* Встроенные темы — их можно сразу установить */}
         <div style={{ marginBottom: 14 }}>
           <div style={sectionLabel}>Встроенные темы</div>
           <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
             {builtinThemes.map(bt => (
               <button
                 key={bt.id}
                onClick={() => { if (!onApply) setTheme(bt.id); handleLoad(bt); }}
                 title="Установить тему"
                 style={{
                   display: 'inline-flex', alignItems: 'center', gap: 5,
                   background: themeId === bt.id ? theme.accent + '28' : theme.bgHover,
                   border: '1px solid ' + (themeId === bt.id ? theme.accent : theme.border),
                   borderRadius: 8, padding: '5px 10px', fontSize: 13,
                   color: theme.text, cursor: 'pointer',
                 }}
               >
                 <span style={{ width: 10, height: 10, borderRadius: 3, background: bt.accent }} />
                 {bt.name}
               </button>
             ))}
           </div>
         </div>

         {/* Импорт/экспорт темы — только для общей темы: в чате это способ
    перенести ссылку, а не свойство самого чата. */}
{!isChat && (
           <details style={{ marginBottom: 14, padding: '10px 12px', border: `1px solid ${theme.border}`, borderRadius: 10 }}>
             <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: theme.textSec }}>
               Ссылка на тему
             </summary>
             <div style={{ marginTop: 10 }}>
             <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
               <Button size="small" variant="outlined" onClick={generateLink} sx={{ color: theme.accent, borderColor: theme.accent + '50', textTransform: 'none' }}>Скопировать ссылку текущей</Button>
               <Button size="small" variant="text" onClick={importLink} sx={{ color: theme.textSec, textTransform: 'none' }}>Импорт по ссылке</Button>
             </Box>
             {themeLink && (
               <TextField
                 size="small"
                 fullWidth
                 sx={{ mt: 1, '& .MuiOutlinedInput-root': { bgcolor: theme.bgInput, color: theme.text, fontSize: 12 } }}
                 value={themeLink}
                 onChange={(e) => setThemeLink(e.target.value)}
                 InputProps={{ endAdornment: <InputAdornment position="end"><IconButton size="small" onClick={() => { navigator.clipboard.writeText(themeLink); }} sx={{ color: theme.textSec }}><ContentCopy sx={{ fontSize: 16 }} /></IconButton></InputAdornment> } }
               />
             )}
             </div>
           </details>
)}

{/* Название */}
        <div style={sectionLabel}>Название темы</div>
        <input
          value={draft.name}
          onChange={e => upd('name', e.target.value)}
          style={{ ...inputStyle, marginBottom: 14 }}
        />

        {/* ИИ-генератор темы — генерирует палитру всего приложения, чату она
            ни к чему, поэтому в режиме чата блока нет. */}
        {!isChat && (
        <details style={{
          marginBottom: 18, padding: '10px 12px', borderRadius: 10,
          border: '1px solid ' + theme.accent + '33',
          background: `linear-gradient(135deg, ${theme.accent}0D, transparent)`,
        }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: theme.accent }}>
            ✨ Сгенерировать тему по описанию
            <span style={{ opacity: 0.6, fontWeight: 400, fontSize: 11.5, marginLeft: 6 }}>10 <VpIcon size={12} /> / тема</span>
          </summary>
          <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={aiPrompt}
              onChange={e => { setAiPrompt(e.target.value); setAiError(''); }}
              placeholder="Опишите тему: например «неоновый киберпанк» или «нежные пастельные тона»"
              disabled={aiLoading}
              style={{ ...inputStyle, flex: '1 1 260px' }}
              onKeyDown={e => { if (e.key === 'Enter' && !aiLoading) handleAiGenerate(); }}
            />
            <button
              onClick={handleAiGenerate}
              disabled={aiLoading || !aiPrompt.trim()}
              style={{
                padding: '6px 16px', borderRadius: 7, border: 'none',
                background: aiLoading ? theme.bgHover : theme.accent,
                color: aiLoading ? theme.text : readableTextOn(theme.accent), fontSize: 13, fontWeight: 600,
                cursor: aiLoading ? 'wait' : 'pointer',
                opacity: aiPrompt.trim() ? 1 : 0.5,
              }}
            >
              {aiLoading ? 'Генерирую…' : 'Сгенерировать'}
            </button>
          </div>
          {aiError && (
            <div style={{ fontSize: 12, color: '#f87171', marginTop: 6 }}>{aiError}</div>
          )}
          <div style={{ fontSize: 11, opacity: 0.55, marginTop: 6 }}>
            Меняет всю палитру, градиенты и тени. После генерации можно доработать вручную.
          </div>
          </div>
        </details>
        )}

        {/* Основная сетка: одная колонка строк во всю ширину — как в CS2:
            слева название настройки, справа её значение или контрол. */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>

          {/* Левая колонка */}
          <div>
            <div style={sectionLabel}>Основные цвета</div>
            <ColorField label="Фон приложения"    value={draft.bg}        onChange={v => upd('bg', v)} />
            <ColorField label="Основной текст"    value={draft.text}      onChange={v => upd('text', v)} />
            <ColorField label="Акцент"            value={draft.accent}    onChange={v => upd('accent', v)} />
            <ColorField label="Вторичный текст"   value={draft.textSec}   onChange={v => upd('textSec', v)} />
            <ColorField label="Онлайн-точка"      value={draft.online}    onChange={v => upd('online', v)} />

            <div style={sectionLabel}>Зоны интерфейса</div>
            {/* Сайдбар и «активный элемент» в окне чата не рисуются — в режиме
                чата эти поля убираем, чтобы не предлагать то, что не видно. */}
            {!isChat && <ColorField label="Сайдбар"           value={draft.bgSidebar} onChange={v => upd('bgSidebar', v)} />}
            <ColorField label="Область чата"      value={draft.bgChat}    onChange={v => upd('bgChat', v)} />
            <ColorField label="Хедер"             value={draft.bgHeader}  onChange={v => upd('bgHeader', v)} />
            <ColorField label="Поле ввода"        value={draft.bgInput}   onChange={v => upd('bgInput', v)} />
            <ColorField label="Ховер-фон"         value={draft.bgHover}   onChange={v => upd('bgHover', v)} />
            {!isChat && <ColorField label="Активный элемент"  value={draft.bgActive}  onChange={v => upd('bgActive', v)} />}

            <div style={sectionLabel}>Пузыри сообщений</div>
            {/* Галочка «градиент» — единственный переключатель режима: снята, и пузырь
                сплошной; стоит, и рисуется градиентом из этого же цвета. */}
            <BubbleColorField
              label="Свой пузырь"
              color={draft.bgBubbleOwn}
              gradient={draft.bubbleOwnGradient}
              onColor={v => setDraft(d => ({ ...d, bgBubbleOwn: v, bubbleOwnGradient: '' }))}
              onGradient={v => setDraft(d => ({ ...d, bubbleOwnGradient: v }))}
            />
            <BubbleColorField
              label="Чужой пузырь"
              color={draft.bgBubbleOther}
              gradient={draft.bubbleOtherGradient}
              onColor={v => setDraft(d => ({ ...d, bgBubbleOther: v, bubbleOtherGradient: '' }))}
              onGradient={v => setDraft(d => ({ ...d, bubbleOtherGradient: v }))}
            />
            <ColorField label="Текст своего пузыря"  value={draft.bubbleOwnText || '#ffffff'} onChange={v => upd('bubbleOwnText', v)} />
            <ColorField label="Текст чужого пузыря"  value={draft.bubbleOtherText || draft.text} onChange={v => upd('bubbleOtherText', v)} />

            {/* Рукописный CSS: поле есть только у включённого градиента, иначе оно
                правило «галочка снята — сплошной цвет» молча нарушало бы. */}
            <div style={{ ...sectionLabel, marginTop: 12 }}>Градиенты (CSS)</div>
            {draft.bubbleOwnGradient && (
              <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 4 }}>Свой пузырь</div>
            )}
            <input
              value={draft.bubbleOwnGradient || ''}
              onChange={e => upd('bubbleOwnGradient', e.target.value)}
              placeholder="linear-gradient(135deg, #7c6af7, #4a3f9f)"
              style={{ ...inputStyle, fontSize: 11, fontFamily: 'monospace' }}
            />
            {draft.bubbleOtherGradient && (
              <div style={{ fontSize: 11, opacity: 0.55, margin: '8px 0 4px' }}>Чужой пузырь</div>
            )}
            <input
              value={draft.bubbleOtherGradient || ''}
              onChange={e => upd('bubbleOtherGradient', e.target.value)}
              placeholder="linear-gradient(135deg, #2a2a35, #16161d)"
              style={{ ...inputStyle, fontSize: 11, fontFamily: 'monospace' }}
            />
            <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>
              Пока галочка не стоит, поле пустое и градиент не применяется
            </div>

            <div style={sectionLabel}>Время сообщений</div>
            <ColorField label="Время на сообщениях"  value={draft.messageTimeColor || draft.bubbleOtherText || draft.text} onChange={v => upd('messageTimeColor', v)} />
            {!isChat && <ColorField label="Время в списке чатов" value={draft.chatTimeColor || draft.textSec} onChange={v => upd('chatTimeColor', v)} />}
            {(!draft.messageTimeColor || (!isChat && !draft.chatTimeColor)) && (
              <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 6 }}>
                Пока цвет не задан: на сообщениях — цвет текста пузыря{!isChat && ', в списке чатов — «Вторичный текст»'}.
              </div>
            )}
            {isChat && (
              <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 6 }}>
                «Время в списке чатов» здесь не нужно: в чате списка нет.
              </div>
            )}
            <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 6 }}>
              «Время на сообщениях» — цифры времени в пузыре (и у своих, и у чужих, а также пометка «(изменено)»).
              «Время в списке чатов» — время справа от имени в списке слева.
            </div>

            </div>

          {/* Правая колонка */}
          <div>
            <div style={sectionLabel}>Паттерн фона чата</div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', padding: '12px 2px', borderBottom: '1px solid ' + theme.border }}>
              <span style={{ fontSize: 14.5, opacity: 0.92, paddingTop: 5 }}>Рисунки</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, justifyContent: 'flex-end', maxWidth: 420 }}>
                {PATTERN_LIST.filter(p => p.id !== 'none').map(p => (
                  // Переключение — через onChange самой галочки. Раньше стоял
                  // onClick на <label>: клик по подписи браузер дублирует на
                  // галочку, обработчик срабатывал дважды и выбор тут же
                  // отменялся — по названию рисунок не выбирался.
                  <label
                    key={p.id}
                    style={{
                      ...patternBtnBase,
                      background: patternIds.includes(p.id) ? theme.accent : theme.bgHover,
                      color: patternIds.includes(p.id) ? readableTextOn(theme.accent) : theme.text,
                      borderColor: patternIds.includes(p.id) ? theme.accent : theme.border,
                    }}
                  ><input type="checkbox" checked={patternIds.includes(p.id)} onChange={() => togglePattern(p.id)} /> {p.label}</label>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 16, padding: '12px 2px', borderBottom: '1px solid ' + theme.border }}>
              <Button size="small" variant="outlined" onClick={() => setDraft(d => ({ ...d, chatPattern: randomMixedPattern(patternIds, patternColor) || undefined }))} sx={{ textTransform: 'none', color: theme.accent }}>🎲 Перемешать рисунки</Button>
            </div>

            {patternId !== 'none' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 2px', borderBottom: '1px solid ' + theme.border }}>
                <span style={{ fontSize: 14.5, opacity: 0.92 }}>Цвет паттерна</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="color"
                    value={patternColor}
                    onChange={e => { setPatternColor(e.target.value); setDraft(d => ({ ...d, chatPattern: randomMixedPattern(patternIds, e.target.value) || undefined })); }}
                    style={{ width: 36, height: 28, padding: 0, border: '1px solid ' + theme.border, borderRadius: 5, cursor: 'pointer', background: 'none' }}
                  />
                  <span style={{ fontSize: 12.5, fontFamily: 'monospace', opacity: 0.7, fontWeight: 700, textTransform: 'uppercase' }}>{patternColor}</span>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', padding: '12px 2px', borderBottom: '1px solid ' + theme.border }}>
              <span style={{ fontSize: 14.5, opacity: 0.92 }}>Размер паттерна</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                <TextField
                  size="small"
                  type="number"
                  label="От, px"
                  value={draft.chatPatternSizeMin ?? 860}
                  onChange={e => setDraft(d => ({ ...d, chatPatternSizeMin: Math.max(200, Number(e.target.value) || 200) }))}
                  inputProps={{ min: 200, max: 4000, step: 20 }}
                  sx={{ width: 120 }}
                />
                <TextField
                  size="small"
                  type="number"
                  label="До, px"
                  value={draft.chatPatternSizeMax ?? 1400}
                  onChange={e => setDraft(d => ({ ...d, chatPatternSizeMax: Math.max(200, Number(e.target.value) || 200) }))}
                  inputProps={{ min: 200, max: 4000, step: 20 }}
                  sx={{ width: 120 }}
                />
              </div>
            </div>
            <div style={{ fontSize: 11, opacity: 0.55, marginTop: 6, marginLeft: 2 }}>
              Для нескольких рисунков размеры распределяются между этими значениями
            </div>

            <div style={{ padding: '12px 2px', borderBottom: '1px solid ' + theme.border, marginTop: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, cursor: 'pointer' }}>
                <span style={{ fontSize: 14.5, opacity: 0.92 }}>Отключить фоновые пузыри (blobs)</span>
                <input
                  type="checkbox"
                  checked={draft.disableBackgroundBlobs || false}
                  onChange={e => setDraft(d => ({ ...d, disableBackgroundBlobs: e.target.checked }))}
                  style={{ width: 17, height: 17, cursor: 'pointer', flexShrink: 0, accentColor: theme.accent }}
                />
              </label>
              <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>
                Убирает размытые светящиеся пузыри на заднем плане чата
              </div>
            </div>

            <div style={{ padding: '12px 2px', borderBottom: '1px solid ' + theme.border }}>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, cursor: 'pointer' }}>
                <span style={{ fontSize: 14.5, opacity: 0.92 }}>Отключить фоновое свечение</span>
                <input
                  type="checkbox"
                  checked={draft.disableBackgroundGlow || false}
                  onChange={e => setDraft(d => ({ ...d, disableBackgroundGlow: e.target.checked }))}
                  style={{ width: 17, height: 17, cursor: 'pointer', flexShrink: 0, accentColor: theme.accent }}
                />
              </label>
              <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>
                Убирает мягкое мятное свечение за всеми слоями
              </div>
            </div>

            <div style={sectionLabel}>Фоновое свечение</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 2px', borderBottom: '1px solid ' + theme.border }}>
              <span style={{ fontSize: 14.5, opacity: 0.92 }}>Цвет</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="color"
                  value={draft.backgroundGlowColor || '#8FE3CF'}
                  onChange={e => setDraft(d => ({ ...d, backgroundGlowColor: e.target.value }))}
                  style={{ width: 36, height: 28, padding: 0, border: '1px solid ' + theme.border, borderRadius: 5, cursor: 'pointer', background: 'none' }}
                />
                <span style={{ fontSize: 12.5, fontFamily: 'monospace', opacity: 0.7, fontWeight: 700, textTransform: 'uppercase' }}>{draft.backgroundGlowColor || '#8FE3CF'}</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 2px', borderBottom: '1px solid ' + theme.border }}>
              <span style={{ fontSize: 14.5, opacity: 0.92 }}>Интенсивность</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round((draft.backgroundGlowIntensity ?? 0.18) * 100)}
                  onChange={e => setDraft(d => ({ ...d, backgroundGlowIntensity: parseInt(e.target.value, 10) / 100 }))}
                  style={{ width: 200, cursor: 'pointer', accentColor: theme.accent }}
                />
                <span style={{
                  fontSize: 13, fontWeight: 600, minWidth: 52, textAlign: 'center',
                  border: '1px solid ' + theme.border, borderRadius: 5, padding: '4px 6px', background: theme.bgInput,
                }}>
                  {Math.round((draft.backgroundGlowIntensity ?? 0.18) * 100)}%
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 2px', borderBottom: '1px solid ' + theme.border, marginTop: 8 }}>
              <span style={{ fontSize: 14.5, opacity: 0.92 }}>Отделка поверхностей (Finish)</span>
              <select
                value={draft.finish || 'solid'}
                onChange={e => setDraft(d => ({ ...d, finish: e.target.value as any }))}
                style={{
                  padding: '7px 10px', borderRadius: 6, fontSize: 13, minWidth: 210, flexShrink: 0,
                  border: `1px solid ${theme.border}`, background: theme.bgInput, color: theme.text,
                  cursor: 'pointer', fontFamily: 'inherit', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600,
                }}
              >
                <option value="solid">Обычная (Solid)</option>
                <option value="glass">Стеклянная (Glass)</option>
                <option value="matte">Матовая (Matte)</option>
                <option value="metal">Металлик (Metal)</option>
              </select>
            </div>
            {draft.finish && draft.finish !== 'solid' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 2px', borderBottom: '1px solid ' + theme.border }}>
                <span style={{ fontSize: 14.5, opacity: 0.92 }}>Интенсивность</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round((draft.finishAmount ?? 0.5) * 100)}
                    onChange={e => setDraft(d => ({ ...d, finishAmount: parseInt(e.target.value) / 100 }))}
                    style={{ width: 200, cursor: 'pointer', accentColor: theme.accent }}
                  />
                  <span style={{
                    fontSize: 13, fontWeight: 600, minWidth: 52, textAlign: 'center',
                    border: '1px solid ' + theme.border, borderRadius: 5, padding: '4px 6px', background: theme.bgInput,
                  }}>
                    {Math.round((draft.finishAmount ?? 0.5) * 100)}%
                  </span>
                </div>
              </div>
            )}

            <div style={sectionLabel}>Превью чата</div>
            <div style={{
              ...previewChat,
              ...(draft.chatBgImage ? {
                backgroundImage: `url(${draft.chatBgImage})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
              } : {}),
              position: 'relative',
              overflow: 'hidden',
            }}>
              {/* затемняющий слой поверх фото */}
              {draft.chatBgImage && (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: `rgba(0,0,0,${1 - (draft.chatBgImageOpacity ?? 0.35)})`,
                  zIndex: 0,
                }} />
              )}
              {/* паттерн поверх фото */}
              {draft.chatBgImage && draft.chatPattern && (
                <div style={{
                  position: 'absolute', inset: 0,
                  backgroundImage: draft.chatPattern,
                  backgroundRepeat: 'repeat',
                  backgroundSize: patternBackgroundSize(draft.chatPattern, draft.chatPatternSizeMin, draft.chatPatternSizeMax),
                  zIndex: 1,
                }} />
              )}
              <div style={{ ...previewOther, position: 'relative', zIndex: 2 }}>Привет! 👋 Как дела?<div style={previewTimeOther}>12:45</div></div>
              <div style={{ ...previewOwn, position: 'relative', zIndex: 2 }}>Отлично, спасибо 😊<div style={previewTimeOwn}>12:45</div></div>
              <div style={{ ...previewOther, position: 'relative', zIndex: 2 }}>Vera — твой мессенджер<div style={previewTimeOther}>12:46</div></div>
              <div style={{ ...previewOwn, position: 'relative', zIndex: 2 }}>Красивая тема! 🎨<div style={previewTimeOwn}>12:46 · изменено</div></div>
            </div>
            {!isChat && (
            <>
            <div style={{ ...sectionLabel, marginTop: 14 }}>Превью сайдбара</div>
            <div style={{
              background: draft.sidebarGradient || draft.bgSidebar,
              borderRadius: 8, padding: '8px 12px',
              border: '1px solid ' + draft.border,
            }}>
              {['Диалог 1', 'Диалог 2', 'Диалог 3'].map((n, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9,
                    padding: '5px 7px', borderRadius: 8, marginBottom: 3,
                    background: i === 0 ? draft.bgActive : 'transparent',
                    color: draft.text,
                  }}
                >
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: draft.accent + '60', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{n}</div>
                      <div style={{ fontSize: 11, color: draft.chatTimeColor || draft.textSec }}>12:45</div>
                    </div>
                    <div style={{ fontSize: 11, color: draft.textSec }}>Последнее сообщение...</div>
                  </div>
                </div>
              ))}
            </div>
            </>
            )}
          </div>
        </div>

        </>
        )}
        {tab === 'community' && !isChat && (
          <CommunityThemesPanel draft={draft} theme={theme} saveCustomTheme={saveCustomTheme} setTheme={setTheme} />
        )}
        {tab !== 'theme' && tab !== 'community' && (
          // Всё, что открывается из этих вкладок (диалог обоев, конструктор
          // макета, списки шрифтов), обязано быть ВЫШЕ плашки редактора.
          <ThemeSettingsLayer>
            {tab === 'wallpaper' && <WallpaperPanel />}
            {tab === 'sound' && <SoundPanel />}
            {tab === 'icons' && <IconsPanel />}
            {tab === 'ui' && <UiStylePanel />}
            {tab === 'anim' && <AnimationsPanel />}
            {tab === 'look' && <AppearancePanel />}
            {tab === 'clock' && <ClockPanel />}
            {tab === 'messages' && <MessagesPanel />}
            {tab === 'layout' && <LayoutPanel />}
          </ThemeSettingsLayer>
        )}
         </div>
        </div>

        {/* Кнопки */}
        <div style={plateFooter}>
          {!mobile && (
          <div style={{ fontSize: 11.5, opacity: 0.55, marginRight: 'auto' }}>
            Правки видны сразу. «Сохранить и применить» записывает их в эту тему.
          </div>
          )}
          <button
            onClick={() => setDraft(d => ({ ...d, id: makeId(), name: d.name + ' (копия)' }))}
            style={{
              padding: mobile ? '10px 8px' : '9px 18px', borderRadius: 6,
              flex: mobile ? 1 : undefined, minHeight: mobile ? 44 : undefined,
              border: '1px solid ' + theme.border,
              background: 'transparent', color: theme.text,
              cursor: 'pointer', fontSize: 12, fontWeight: 700,
              letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'inherit',
              transition: 'border-color .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = theme.textSec; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = theme.border; }}
          >
            Сохранить как копию
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: mobile ? '10px 8px' : '9px 22px', borderRadius: 6, border: 'none',
              flex: mobile ? 1.4 : undefined, minHeight: mobile ? 44 : undefined,
              background: theme.accent, color: readableTextOn(theme.accent),
              cursor: 'pointer', fontSize: 12, fontWeight: 700,
              letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'inherit',
            }}
          >
            💾 Сохранить и применить
          </button>
        </div>
      </div>
    </div>
  );

  // Портал в body — обязателен: редактор монтируется внутри сайдбара, а его
  // корневой Box с backdrop-filter становится containing block для
  // position:fixed. Без портала оверлей рисовался в панели чатов: узкий и
  // низкий. С порталом плашка всегда на весь экран, откуда бы её ни открыли.
  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
