import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Box, Typography, TextField, Button, InputAdornment, IconButton } from '@mui/material';
import { ContentCopy } from '@mui/icons-material';
import { useThemeStore, CUSTOM_THEME_ID_START, Theme, themeToLink, themeFromLink, snapshotThemeSettings } from '../store/themeStore';
import { aiApi } from '../services/botsApi';
import { communityThemesApi, CommunityTheme } from '../services/api';
import { useShopStore } from '../store/shopStore';
import VpIcon from './VpIcon';
import {
  WallpaperPanel, SoundPanel, UiStylePanel, AnimationsPanel, AppearancePanel, LayoutPanel,
  ThemeSettingsLayer,
} from './ThemeSettingsPanels';
import { autoBubbleGradient, regenerateAutoGradient, bubbleBackground } from '../utils/bubbleGradient';

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

function ColorField({ label, value, onChange }: ColorFieldProps) {
  const safeColor = value && value.match(/^#[0-9a-fA-F]{3,8}$/) ? value : '#888888';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <input
        type="color"
        value={safeColor}
        onChange={e => onChange(e.target.value)}
        style={{ width: 32, height: 26, padding: 0, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'none', flexShrink: 0 }}
      />
      <span style={{ fontSize: 12, flex: 1, whiteSpace: 'nowrap' }}>{label}</span>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: 100, fontSize: 11, padding: '2px 6px', borderRadius: 4,
          border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.07)',
          color: 'inherit', fontFamily: 'monospace',
        }}
      />
    </div>
  );
}

interface ColorFieldProps { label: string; value: string; onChange: (v: string) => void }

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

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 12, flex: 1 }}>{label}</span>
        <label
          style={{
            display: 'flex', alignItems: 'center', gap: 5, cursor: canGradient ? 'pointer' : 'default',
            fontSize: 11, opacity: canGradient ? 0.9 : 0.4, userSelect: 'none', flexShrink: 0,
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
        value={on ? autoBubbleGradient(color) : color}
        onChange={v => {
          // Галочка снята — поле правит сплошной цвет. Стоит — градиент
          // пересобирается под новый цвет, но рукописный CSS не трогаем.
          if (on) onGradient(regenerateAutoGradient(v, color, gradient));
          else onColor(v);
        }}
      />
      {on && (
        <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>
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
    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Community Themes</div>
    <div style={{ fontSize: 12, opacity: .65, marginBottom: 12 }}>Публикуйте тему вместе с превью, обоями или шрифтом.</div>
    <div style={{ display: 'grid', gap: 7, marginBottom: 16 }}>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Название темы" style={{ padding: 8, borderRadius: 6, border: `1px solid ${theme.border}`, background: theme.bgInput, color: theme.text }} />
      <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Описание" style={{ padding: 8, borderRadius: 6, border: `1px solid ${theme.border}`, background: theme.bgInput, color: theme.text }} />
      <label style={{ fontSize: 12 }}>Превью <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => setPreview(e.target.files?.[0])} /></label>
      <label style={{ fontSize: 12 }}>Фото или шрифт <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,.ttf,.otf,.woff,.woff2" onChange={e => setAsset(e.target.files?.[0])} /></label>
      <button disabled={busy || !name.trim()} onClick={() => void upload()} style={{ padding: '8px 12px', border: 0, borderRadius: 7, background: theme.accent, color: '#fff', cursor: 'pointer' }}>Опубликовать текущую тему</button>
    </div>
    <div style={{ display: 'flex', gap: 7, marginBottom: 12 }}>
      <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void load(); }} placeholder="Поиск по каталогу" style={{ flex: 1, padding: 8, borderRadius: 6, border: `1px solid ${theme.border}`, background: theme.bgInput, color: theme.text }} />
      <button onClick={() => void load()} style={{ padding: '6px 10px', borderRadius: 6, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, cursor: 'pointer' }}>Найти</button>
    </div>
    {message && <div style={{ fontSize: 12, color: theme.accent, marginBottom: 8 }}>{message}</div>}
    <div style={{ display: 'grid', gap: 8 }}>
      {items.map(item => <div key={item.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 8, border: `1px solid ${theme.border}`, borderRadius: 7 }}>
        {item.previewUrl ? <img src={communityAssetUrl(item.previewUrl)} alt="" style={{ width: 54, height: 42, objectFit: 'cover', borderRadius: 5 }} /> : <div style={{ width: 54, height: 42, background: item.theme?.accent || theme.accent, borderRadius: 5 }} />}
        <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontWeight: 600 }}>{item.name}</div><div style={{ fontSize: 11, opacity: .65, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description || `Автор: ${item.authorName}`} · {item.downloads} установок</div></div>
        <button onClick={() => void install(item)} disabled={busy} style={{ padding: '6px 9px', border: `1px solid ${theme.accent}`, borderRadius: 6, background: 'transparent', color: theme.accent, cursor: 'pointer' }}>Установить</button>
        <button onClick={() => void downloadTheme(item)} style={{ padding: '6px 9px', border: `1px solid ${theme.border}`, borderRadius: 6, background: 'transparent', color: theme.text, cursor: 'pointer' }}>JSON</button>
        {item.assetUrl && <a href={communityAssetUrl(item.assetUrl)} download style={{ fontSize: 12, color: theme.accent }}>Скачать</a>}
        <button onClick={() => void remove(item)} title="Удалить свою публикацию" style={{ border: 0, background: 'transparent', color: '#f87171', cursor: 'pointer' }}>×</button>
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

export function ThemeEditor({ onClose, onGoChats, initialTheme, onApply, mode = 'app', headerExtra }: Props) {
  const isChat = mode === 'chat';
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
  // Вкладки редактора: первая — сама тема, остальные — настройки, которые
  // живут в теме (обои, звук, иконки, анимации, внешний вид, макет).
  // В режиме темы чата (isChat) эти настройки не относятся к чату — вкладок нет.
  const [tab, setTab] = useState<'theme' | 'community' | 'wallpaper' | 'sound' | 'ui' | 'anim' | 'look' | 'layout'>('theme');

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
  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: 'rgba(0,0,0,0.55)',
    backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
    display: 'flex', alignItems: 'stretch', justifyContent: 'center',
    padding: 'max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left))',
  };
  const modal: React.CSSProperties = {
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
    padding: '18px 20px 20px', boxSizing: 'border-box',
  };
  const plateFooter: React.CSSProperties = {
    flexShrink: 0, display: 'flex', gap: 10, justifyContent: 'space-between',
    alignItems: 'center', flexWrap: 'wrap', padding: '12px 20px',
    borderTop: '1px solid ' + theme.border,
    background: 'rgba(0,0,0,0.18)',
  };
  const sectionLabel: React.CSSProperties = {
    fontSize: 11, opacity: 0.55, textTransform: 'uppercase',
    letterSpacing: '0.06em', marginBottom: 10, marginTop: 24, fontWeight: 700,
    paddingBottom: 7, borderBottom: '1px solid ' + theme.border,
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
    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
  };
  // В режиме чата в сторе лежит тема приложения, а не чата — показывать её
  // как «сейчас стоит» было бы враньём, поэтому там только имя черновика.
  const activeThemeName = isChat ? null : (theme?.name || 'Без темы');
  const editingThemeName = draft.name || 'Без названия';
  // Совпадают ли темы: если нет, правки ещё не записаны в стоящую тему.
  const sameAsActive = !isChat && draft.id === themeId;

  // ── Навигация ─────────────────────────────────────────────────────────────
  const TABS: [typeof tab, string][] = [
    ['theme', 'Тема'], ['community', 'Community Themes'], ['wallpaper', 'Обои'], ['sound', 'Звук'],
    ['ui', 'Иконки и стиль'], ['anim', 'Анимации'], ['look', 'Внешний вид'], ['layout', 'Макет'],
  ];
  // Разделы — вертикальным списком слева, содержимое — справа. Горизонтальная
  // полоса из семи кнопок в 86vh выглядела сплошной кашей: в ней не найти
  // нужный раздел, а где ты сейчас — тоже не видно.
  const editorLayout: React.CSSProperties = { display: 'flex', gap: 18, alignItems: 'flex-start' };
  const navRail: React.CSSProperties = {
    width: 188, flexShrink: 0, alignSelf: 'stretch', display: 'flex', flexDirection: 'column',
    gap: 2, paddingRight: 16, borderRight: '1px solid ' + theme.border,
  };
  const navItem: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 10px',
    borderRadius: 9, border: 'none', background: 'transparent', color: theme.textSec,
    fontSize: 13.5, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
  };
  const editorContent: React.CSSProperties = { flex: 1, minWidth: 0 };
  const nav = (
    <nav style={navRail}>
      {(!isChat ? TABS : ([['theme', 'Тема']] as [typeof tab, string][])).map(([id, label]) => (
        <button
          key={id}
          onClick={() => setTab(id)}
          style={{
            ...navItem,
            ...(tab === id ? { background: theme.accent + '1F', color: theme.accent, fontWeight: 600 } : {}),
          }}
        >
          <span style={{
            width: 3, height: 14, borderRadius: 2, flexShrink: 0,
            background: tab === id ? theme.accent : 'transparent',
          }} />
          {label}
        </button>
      ))}
      {!isChat && (
        <div style={{ fontSize: 11, lineHeight: 1.45, opacity: 0.5, marginTop: 'auto', paddingTop: 16, paddingRight: 2 }}>
          Обои, звук, иконки, анимации, внешний вид и макет — настройки этой
          темы. У каждой темы они свои.
        </div>
      )}
    </nav>
  );

  const content = (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modal}>
        {/* Шапка */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 20px', borderBottom: '1px solid ' + theme.border }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>🎨 Редактор темы</h2>
            {/* Какая тема стоит и какая настраивается — видно в ЛЮБОМ разделе,
                а не только на вкладке «Тема». Иначе в «Обоях» или «Звуке» было
                невозможно понять, к какой теме относится правка. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
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
              {!sameAsActive && !isChat && (
                <span style={{ fontSize: 11, opacity: 0.55 }}>изменения ещё не применены</span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {headerExtra}
            {onGoChats && (
              <button
                onClick={onGoChats}
                style={{ background: 'none', border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.accent, padding: '6px 10px', cursor: 'pointer', fontSize: 13 }}
              >Чаты</button>
            )}
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: theme.text, fontSize: 22, cursor: 'pointer', opacity: 0.6, lineHeight: 1 }}
            >×</button>
          </div>
        </div>

        <div style={plateBody}>
         <div style={editorLayout}>
         {nav}
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
                   <div style={{ width: 10, height: 10, borderRadius: '50%', background: ct.accent, marginRight: 2, flexShrink: 0 }} />
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
                 <span style={{ width: 10, height: 10, borderRadius: '50%', background: bt.accent }} />
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
                color: '#fff', fontSize: 13, fontWeight: 600,
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

        {/* Основная сетка */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18, alignItems: 'start' }}>

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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
              {PATTERN_LIST.filter(p => p.id !== 'none').map(p => (
                <label
                  key={p.id}
                  onClick={() => togglePattern(p.id)}
                  style={{
                    ...patternBtnBase,
                    background: patternIds.includes(p.id) ? theme.accent : theme.bgHover,
                    color: patternIds.includes(p.id) ? '#fff' : theme.text,
                    borderColor: patternIds.includes(p.id) ? theme.accent : theme.border,
                  }}
                ><input type="checkbox" checked={patternIds.includes(p.id)} readOnly /> {p.label}</label>
              ))}
            </div>
            <Button size="small" variant="outlined" onClick={() => setDraft(d => ({ ...d, chatPattern: randomMixedPattern(patternIds, patternColor) || undefined }))} sx={{ textTransform: 'none', color: theme.accent }}>🎲 Перемешать рисунки</Button>

            {patternId !== 'none' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 12 }}>Цвет паттерна</span>
                <input
                  type="color"
                  value={patternColor}
                  onChange={e => { setPatternColor(e.target.value); setDraft(d => ({ ...d, chatPattern: randomMixedPattern(patternIds, e.target.value) || undefined })); }}
                  style={{ width: 34, height: 26, padding: 0, border: 'none', borderRadius: 4, cursor: 'pointer' }}
                />
                <span style={{ fontSize: 11, fontFamily: 'monospace', opacity: 0.7 }}>{patternColor}</span>
              </div>
            )}

            <div style={{ marginBottom: 12, marginTop: 10 }}>
              <div style={{ ...sectionLabel, marginBottom: 6 }}>Размер паттерна</div>
              <div style={{ display: 'flex', gap: 8 }}>
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
              <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>
                Для нескольких рисунков размеры распределяются между этими значениями
              </div>
            </div>

            <div style={{ marginBottom: 12, marginTop: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={draft.disableBackgroundBlobs || false}
                  onChange={e => setDraft(d => ({ ...d, disableBackgroundBlobs: e.target.checked }))}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <span style={{ color: theme.text }}>Отключить фоновые пузыри (blobs)</span>
              </label>
              <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4, marginLeft: 24 }}>
                Убирает размытые светящиеся пузыри на заднем плане чата
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={draft.disableBackgroundGlow || false}
                  onChange={e => setDraft(d => ({ ...d, disableBackgroundGlow: e.target.checked }))}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <span style={{ color: theme.text }}>Отключить фоновое свечение</span>
              </label>
              <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4, marginLeft: 24 }}>
                Убирает мягкое мятное свечение за всеми слоями
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, marginBottom: 8, color: theme.text }}>Фоновое свечение</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12 }}>Цвет</span>
                <input
                  type="color"
                  value={draft.backgroundGlowColor || '#8FE3CF'}
                  onChange={e => setDraft(d => ({ ...d, backgroundGlowColor: e.target.value }))}
                  style={{ width: 34, height: 26, padding: 0, border: 'none', borderRadius: 4, cursor: 'pointer' }}
                />
                <span style={{ fontSize: 11, fontFamily: 'monospace', opacity: 0.7 }}>{draft.backgroundGlowColor || '#8FE3CF'}</span>
              </div>
              <div style={{ fontSize: 12, marginBottom: 6, color: theme.textSec }}>
                Интенсивность: {Math.round((draft.backgroundGlowIntensity ?? 0.18) * 100)}%
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round((draft.backgroundGlowIntensity ?? 0.18) * 100)}
                onChange={e => setDraft(d => ({ ...d, backgroundGlowIntensity: parseInt(e.target.value, 10) / 100 }))}
                style={{ width: '100%', cursor: 'pointer' }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, marginBottom: 8, color: theme.text }}>Отделка поверхностей (Finish)</div>
              <select
                value={draft.finish || 'solid'}
                onChange={e => setDraft(d => ({ ...d, finish: e.target.value as any }))}
                style={{
                  width: '100%', padding: '6px 10px', borderRadius: 6, fontSize: 13,
                  border: `1px solid ${theme.border}`, background: theme.bgInput, color: theme.text,
                  cursor: 'pointer', marginBottom: 10,
                }}
              >
                <option value="solid">Обычная (Solid)</option>
                <option value="glass">Стеклянная (Glass)</option>
                <option value="matte">Матовая (Matte)</option>
                <option value="metal">Металлик (Metal)</option>
              </select>
              {draft.finish && draft.finish !== 'solid' && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12, marginBottom: 6, color: theme.textSec }}>
                    Интенсивность: {Math.round((draft.finishAmount ?? 0.5) * 100)}%
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round((draft.finishAmount ?? 0.5) * 100)}
                    onChange={e => setDraft(d => ({ ...d, finishAmount: parseInt(e.target.value) / 100 }))}
                    style={{ width: '100%', cursor: 'pointer' }}
                  />
                </div>
              )}
            </div>

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
            {tab === 'ui' && <UiStylePanel />}
            {tab === 'anim' && <AnimationsPanel />}
            {tab === 'look' && <AppearancePanel />}
            {tab === 'layout' && <LayoutPanel />}
          </ThemeSettingsLayer>
        )}
         </div>
         </div>
        </div>

        {/* Кнопки */}
        <div style={plateFooter}>
          <div style={{ fontSize: 11.5, opacity: 0.55, marginRight: 'auto' }}>
            Правки видны сразу. «Сохранить и применить» записывает их в эту тему.
          </div>
          <button
            onClick={() => setDraft(d => ({ ...d, id: makeId(), name: d.name + ' (копия)' }))}
            style={{
              padding: '8px 16px', borderRadius: 8,
              border: '1px solid ' + theme.border,
              background: 'transparent', color: theme.text,
              cursor: 'pointer', fontSize: 13,
            }}
          >
            Сохранить как копию
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: '8px 20px', borderRadius: 8, border: 'none',
              background: theme.accent, color: '#fff',
              cursor: 'pointer', fontSize: 13, fontWeight: 600,
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
