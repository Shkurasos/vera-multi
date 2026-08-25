import React, { useState } from 'react';
import { Box, Typography, Button, IconButton, Tooltip, TextField, Chip } from '@mui/material';
import { ContentCopy, Check, Edit, Delete, Add, Palette, Close } from '@mui/icons-material';
import { useThemeStore, THEMES, Theme, themeToLink, themeFromLink, CUSTOM_THEME_ID_START } from '../store/themeStore';
import { ThemeEditor } from './ThemeEditor';

interface Props {
  onClose: () => void;
}

// Мини-превью темы (цветовая карточка)
function ThemeCard({ t, active, onApply, onEdit, onDelete, onCopyLink }: {
  t: Theme;
  active: boolean;
  onApply: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onCopyLink: () => void;
}) {
  const isCustom = t.id >= CUSTOM_THEME_ID_START;

  return (
    <Box sx={{
      borderRadius: 2.5,
      border: `2px solid ${active ? t.accent : 'rgba(255,255,255,0.08)'}`,
      background: t.bgSidebar || t.bg,
      overflow: 'hidden',
      cursor: 'pointer',
      transition: 'transform 0.2s, box-shadow 0.2s, border-color 0.2s',
      '&:hover': {
        transform: 'translateY(-4px)',
        boxShadow: `0 16px 40px ${t.accent}44`,
        borderColor: t.accent,
      },
      position: 'relative',
    }} onClick={onApply}>
      {/* Превью-полоска с цветами */}
      <Box sx={{ display: 'flex', height: 56 }}>
        <Box sx={{ flex: 1, background: t.bg }} />
        <Box sx={{ flex: 1, background: t.bgSidebar || t.bg }} />
        <Box sx={{ flex: 1, background: t.bgChat || t.bg }} />
        <Box sx={{ flex: 1, background: t.bgBubbleOwn }} />
        <Box sx={{ flex: 1, background: t.bgBubbleOther }} />
      </Box>
      {/* Акцентная полоска */}
      <Box sx={{ height: 5, background: t.accent }} />

      <Box sx={{ p: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{
            width: 14, height: 14, borderRadius: '50%',
            background: t.accent, flexShrink: 0,
            boxShadow: `0 0 10px ${t.accent}`,
          }} />
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: t.text, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {t.name}
          </Typography>
          {active && <Check sx={{ fontSize: 16, color: t.accent }} />}
        </Box>
        <Typography sx={{ fontSize: 11, color: t.textSec, mt: 0.5 }}>
          {isCustom ? '⭐ Моя тема' : 'Встроенная'}
        </Typography>
      </Box>

      {/* Кнопки действий */}
      <Box sx={{
        position: 'absolute', top: 6, right: 6,
        display: 'flex', gap: 0.5, opacity: 0, transition: 'opacity 0.2s',
        '&:hover': { opacity: 1 },
      }} onClick={(e) => e.stopPropagation()}>
        <Tooltip title="Копировать ссылку">
          <IconButton size="small" onClick={onCopyLink} sx={{ bgcolor: 'rgba(0,0,0,0.6)', color: '#fff', '&:hover': { bgcolor: 'rgba(0,0,0,0.8)' } }}>
            <ContentCopy sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
        {isCustom && onEdit && (
          <Tooltip title="Редактировать">
            <IconButton size="small" onClick={onEdit} sx={{ bgcolor: 'rgba(0,0,0,0.6)', color: '#fff', '&:hover': { bgcolor: 'rgba(0,0,0,0.8)' } }}>
              <Edit sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
        {isCustom && onDelete && (
          <Tooltip title="Удалить">
            <IconButton size="small" onClick={onDelete} sx={{ bgcolor: 'rgba(0,0,0,0.6)', color: '#f87171', '&:hover': { bgcolor: 'rgba(0,0,0,0.8)' } }}>
              <Delete sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Box>
  );
}

export function ThemeMarketplace({ onClose }: Props) {
  const { themeId, theme, setTheme, customThemes, saveCustomTheme, deleteCustomTheme } = useThemeStore();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTheme, setEditingTheme] = useState<Theme | null>(null);
  const [importLink, setImportLink] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const allThemes = [...THEMES, ...customThemes];

  const handleApply = (t: Theme) => {
    setTheme(t.id);
  };

  const handleCopyLink = (t: Theme) => {
    const link = themeToLink(t);
    if (link) {
      navigator.clipboard.writeText(link);
      setCopied(t.id.toString());
      setTimeout(() => setCopied(null), 2000);
    }
  };

  const handleImport = () => {
    const parsed = themeFromLink(importLink);
    if (!parsed) { alert('Неверная ссылка на тему'); return; }
    saveCustomTheme(parsed);
    setTheme(parsed.id);
    setImportLink('');
  };

  const handleCreateNew = () => {
    setEditingTheme(null);
    setEditorOpen(true);
  };

  const handleEdit = (t: Theme) => {
    setEditingTheme(t);
    setEditorOpen(true);
  };

  const handleDelete = (id: number) => {
    if (confirm('Удалить эту тему?')) {
      deleteCustomTheme(id);
    }
  };

  return (
    <Box sx={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 2,
      backdropFilter: 'blur(6px)',
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      {/* Центральная плашка */}
      <Box sx={{
        background: theme.bgSidebar || theme.bg,
        backgroundImage: theme.sidebarGradient || undefined,
        color: theme.text,
        borderRadius: 4,
        width: '100%',
        maxWidth: 860,
        maxHeight: '88vh',
        overflowY: 'auto',
        padding: 3,
        boxSizing: 'border-box',
        border: `1px solid ${theme.border}`,
        boxShadow: `0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px ${theme.accent}22 inset`,
        position: 'relative',
      }}>
        {/* Шапка */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{
              width: 40, height: 40, borderRadius: 3,
              background: `linear-gradient(135deg, ${theme.accent}, ${theme.accent}88)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 8px 24px ${theme.accent}44`,
            }}>
              <Palette sx={{ color: '#fff', fontSize: 22 }} />
            </Box>
            <Box>
              <Typography sx={{ fontSize: 20, fontWeight: 800 }}>Магазин тем</Typography>
              <Typography sx={{ fontSize: 12, color: theme.textSec }}>Выберите тему или создайте свою</Typography>
            </Box>
          </Box>
          <IconButton onClick={onClose} sx={{ color: theme.text, opacity: 0.6, '&:hover': { opacity: 1, bgcolor: theme.bgHover } }}>
            <Close />
          </IconButton>
        </Box>

        {/* Кнопки действий */}
        <Box sx={{ display: 'flex', gap: 1, mb: 2.5, flexWrap: 'wrap' }}>
          <Button
            size="small"
            variant="contained"
            startIcon={<Add />}
            onClick={handleCreateNew}
            sx={{
              bgcolor: theme.accent, color: '#001018', textTransform: 'none',
              borderRadius: 999, px: 2, fontWeight: 600,
              '&:hover': { bgcolor: theme.accent + 'CC' },
            }}
          >
            Создать свою тему
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<Palette />}
            onClick={() => { setEditingTheme(theme); setEditorOpen(true); }}
            sx={{ color: theme.accent, borderColor: theme.accent + '50', textTransform: 'none', borderRadius: 999, px: 2 }}
          >
            Редактор текущей
          </Button>
        </Box>

        {/* Импорт по ссылке */}
        <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
          <TextField
            size="small"
            fullWidth
            placeholder="Вставьте ссылку на тему для импорта..."
            value={importLink}
            onChange={(e) => setImportLink(e.target.value)}
            sx={{
              '& .MuiOutlinedInput-root': {
                bgcolor: theme.bgInput, color: theme.text, fontSize: 12, borderRadius: 2,
                '& fieldset': { borderColor: theme.border },
                '&:hover fieldset': { borderColor: theme.accent + '66' },
              },
            }}
          />
          <Button
            size="small"
            variant="outlined"
            onClick={handleImport}
            disabled={!importLink.trim()}
            sx={{ color: theme.accent, borderColor: theme.accent + '50', textTransform: 'none', whiteSpace: 'nowrap', borderRadius: 2 }}
          >
            Импорт
          </Button>
        </Box>

        {/* Сетка тем */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography sx={{ fontSize: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Все темы
          </Typography>
          <Chip
            size="small"
            label={`${allThemes.length} шт.`}
            sx={{ bgcolor: theme.bgHover, color: theme.textSec, fontSize: 11, height: 22 }}
          />
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 2 }}>
          {allThemes.map(t => (
            <ThemeCard
              key={t.id}
              t={t}
              active={themeId === t.id}
              onApply={() => handleApply(t)}
              onEdit={t.id >= CUSTOM_THEME_ID_START ? () => handleEdit(t) : undefined}
              onDelete={t.id >= CUSTOM_THEME_ID_START ? () => handleDelete(t.id) : undefined}
              onCopyLink={() => handleCopyLink(t)}
            />
          ))}
        </Box>

        {/* Подсказка */}
        <Box sx={{
          mt: 3, p: 1.5, borderRadius: 2,
          bgcolor: theme.bgHover, border: `1px solid ${theme.border}`,
          display: 'flex', alignItems: 'center', gap: 1,
        }}>
          <Typography sx={{ fontSize: 12, color: theme.textSec }}>
            💡 Нажмите на тему, чтобы применить. Создавайте свои темы и делитесь ссылками с друзьями!
          </Typography>
        </Box>
      </Box>

      {/* Редактор тем */}
      {editorOpen && (
        <ThemeEditor
          onClose={() => setEditorOpen(false)}
          initialTheme={editingTheme || undefined}
        />
      )}
    </Box>
  );
}