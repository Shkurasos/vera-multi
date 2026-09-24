import React, { useState, useCallback, useRef } from 'react';
import { Box, Typography, TextField, Button, InputAdornment, IconButton } from '@mui/material';
import { ContentCopy } from '@mui/icons-material';
import { useThemeStore, THEMES, CUSTOM_THEME_ID_START, Theme, themeToLink, themeFromLink } from '../store/themeStore';
import { aiApi } from '../services/botsApi';
import { useShopStore } from '../store/shopStore';
import VpIcon from './VpIcon';

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

function makeId() {
  return CUSTOM_THEME_ID_START + (Date.now() % 9000000);
}

interface Props {
  onClose: () => void;
  onGoChats?: () => void;
  initialTheme?: Theme;
  onApply?: (theme: Theme) => void;
}

export function ThemeEditor({ onClose, onGoChats, initialTheme, onApply }: Props) {
  const { theme, customThemes, saveCustomTheme, deleteCustomTheme, setTheme, themeId } = useThemeStore();

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
    if (onApply) {
      onApply(draft);
    } else {
      saveCustomTheme(draft);
      setTheme(draft.id);
    }
    onClose();
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
    background: draft.bubbleOwnGradient || draft.bgBubbleOwn,
    color: draft.bubbleOwnText || '#fff',
    boxShadow: draft.bubbleOwnShadow || undefined,
    borderRadius: '14px 14px 4px 14px', padding: '6px 12px', fontSize: 13,
  };
  const previewOther: React.CSSProperties = {
    alignSelf: 'flex-start', maxWidth: '72%',
    background: draft.bgBubbleOther,
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
  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 9999,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12,
  };
  const modal: React.CSSProperties = {
    background: theme.bgSidebar, color: theme.text,
    borderRadius: 12, width: '100%', maxWidth: 820, maxHeight: '92vh',
    overflowY: 'auto', padding: 18, boxSizing: 'border-box',
    border: '1px solid ' + theme.border,
    boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
  };
  const sectionLabel: React.CSSProperties = {
    fontSize: 11, opacity: 0.55, textTransform: 'uppercase',
    letterSpacing: '0.06em', marginBottom: 8, marginTop: 16, fontWeight: 700,
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '5px 9px', borderRadius: 7,
    border: '1px solid ' + theme.border, background: theme.bgInput,
    color: theme.text, fontSize: 13, boxSizing: 'border-box',
  };
  const patternBtnBase: React.CSSProperties = {
    padding: '3px 9px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: '1px solid',
  };

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modal}>
        {/* Шапка */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>🎨 Редактор темы</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
             {THEMES.map(bt => (
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

         {/* Импорт/экспорт темы */}
         <div style={{ marginBottom: 14 }}>
           <div style={sectionLabel}>Ссылка на тему</div>
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

        {/* Название */}
        <div style={sectionLabel}>Название темы</div>
        <input
          value={draft.name}
          onChange={e => upd('name', e.target.value)}
          style={{ ...inputStyle, marginBottom: 14 }}
        />

        {/* ИИ-генератор темы */}
        <div style={{
          marginBottom: 16, padding: 12, borderRadius: 10,
          border: '1px solid ' + theme.accent + '44',
          background: `linear-gradient(135deg, ${theme.accent}10, transparent)`,
        }}>
          <div style={{ ...sectionLabel, marginTop: 0, color: theme.accent, opacity: 0.9, display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
            ✨ Генерация темы ИИ (10 <VpIcon size={13} /> / тема)
          </div>
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
            <ColorField label="Сайдбар"           value={draft.bgSidebar} onChange={v => upd('bgSidebar', v)} />
            <ColorField label="Область чата"      value={draft.bgChat}    onChange={v => upd('bgChat', v)} />
            <ColorField label="Хедер"             value={draft.bgHeader}  onChange={v => upd('bgHeader', v)} />
            <ColorField label="Поле ввода"        value={draft.bgInput}   onChange={v => upd('bgInput', v)} />
            <ColorField label="Ховер-фон"         value={draft.bgHover}   onChange={v => upd('bgHover', v)} />
            <ColorField label="Активный элемент"  value={draft.bgActive}  onChange={v => upd('bgActive', v)} />

            <div style={sectionLabel}>Пузыри сообщений</div>
            <ColorField label="Свой пузырь"          value={draft.bgBubbleOwn}
              onChange={v => setDraft(d => ({ ...d, bgBubbleOwn: v, bubbleOwnGradient: '' }))} />
            <ColorField label="Чужой пузырь"         value={draft.bgBubbleOther} onChange={v => upd('bgBubbleOther', v)} />
            <ColorField label="Текст своего пузыря"  value={draft.bubbleOwnText || '#ffffff'} onChange={v => upd('bubbleOwnText', v)} />
            <ColorField label="Текст чужого пузыря"  value={draft.bubbleOtherText || draft.text} onChange={v => upd('bubbleOtherText', v)} />

            <div style={sectionLabel}>Время сообщений и чатов</div>
            <ColorField label="Время на сообщениях"  value={draft.messageTimeColor || draft.bubbleOtherText || draft.text} onChange={v => upd('messageTimeColor', v)} />
            <ColorField label="Время в списке чатов" value={draft.chatTimeColor || draft.textSec} onChange={v => upd('chatTimeColor', v)} />
            {(!draft.messageTimeColor || !draft.chatTimeColor) && (
              <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 6 }}>
                Пока цвет не задан: на сообщениях — цвет текста пузыря, в списке чатов — «Вторичный текст».
              </div>
            )}
            <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 6 }}>
              «Время на сообщениях» — цифры времени в пузыре (и у своих, и у чужих, а также пометка «(изменено)»).
              «Время в списке чатов» — время справа от имени в списке слева.
            </div>

            <div style={{ ...sectionLabel, marginTop: 12 }}>Градиент своего пузыря (CSS)</div>
            <input
              value={draft.bubbleOwnGradient || ''}
              onChange={e => upd('bubbleOwnGradient', e.target.value)}
              placeholder="linear-gradient(135deg, #7c6af7, #4a3f9f)"
              style={{ ...inputStyle, fontSize: 11, fontFamily: 'monospace' }}
            />
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
          </div>
        </div>

        {/* Кнопки */}
        <div style={{ display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
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
}
