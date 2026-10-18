/** Строка своего пака: превью, включить, редактировать, копия, файл, публикация. */
import React, { useState } from 'react';
import { Box, Button, Typography, TextField, IconButton, Tooltip } from '@mui/material';
import { Edit, Delete, ContentCopy, Download, Publish, Check } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { communityIconPacksApi } from '../services/api';
import { packToFile, type CustomIconPack } from '../utils/iconPackFormat';
import { previewSlots } from './iconPackPanelUtils';
import PackIcon from './PackIcon';

export default function MyIconPackRow({ pack, active, onToggle, onEdit, onCopy, onDownload, onRemove, onMessage }: {
  pack: CustomIconPack; active: boolean;
  onToggle: () => void; onEdit: () => void; onCopy: () => void; onDownload: () => void; onRemove: () => void;
  onMessage: (m: string) => void;
}) {
  const theme = useThemeStore((s) => s.theme);
  const [publishing, setPublishing] = useState(false);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const count = Object.keys(pack.icons).length;

  const publish = async () => {
    setBusy(true);
    try {
      await communityIconPacksApi.publish(packToFile(pack), pack.name, description);
      onMessage(`Пак «${pack.name}» опубликован`);
      setPublishing(false); setDescription('');
    } catch (e: any) {
      onMessage(e?.response?.data?.message || 'Не удалось опубликовать пак');
    } finally { setBusy(false); }
  };

  return (
    <Box sx={{ p: 1, border: `1px solid ${active ? theme.accent : theme.border}`, borderRadius: 2, bgcolor: active ? theme.accent + '14' : 'transparent' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ display: 'flex', gap: 0.5, color: theme.accent, flexShrink: 0 }}>
          {previewSlots(pack.icons, 4).map((s) => <PackIcon key={s} slot={s} base={pack.base} icons={pack.icons} size={20} />)}
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap sx={{ fontSize: 14, fontWeight: 600, color: theme.text }}>{pack.name}</Typography>
          <Typography sx={{ fontSize: 11, color: theme.textSec }}>Заменено иконок: {count}</Typography>
        </Box>
        <Button size="small" variant={active ? 'contained' : 'outlined'} startIcon={active ? <Check /> : undefined} onClick={onToggle}
          sx={{ textTransform: 'none', borderRadius: 2, flexShrink: 0, ...(active
            ? { bgcolor: theme.accent, '&:hover': { bgcolor: theme.accent } }
            : { color: theme.text, borderColor: theme.border }) }}>
          {active ? 'Включён' : 'Включить'}
        </Button>
      </Box>
      <Box sx={{ display: 'flex', gap: 0.25, mt: 0.5, flexWrap: 'wrap' }}>
        <Tooltip title="Редактировать"><IconButton size="small" aria-label="Редактировать пак" onClick={onEdit} sx={{ color: theme.textSec }}><Edit fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Сделать копию"><IconButton size="small" aria-label="Сделать копию пака" onClick={onCopy} sx={{ color: theme.textSec }}><ContentCopy fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Скачать файлом"><IconButton size="small" aria-label="Скачать пак файлом" onClick={onDownload} sx={{ color: theme.textSec }}><Download fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Выложить в каталог"><span><IconButton size="small" aria-label="Выложить пак в каталог" disabled={!count} onClick={() => setPublishing((v) => !v)} sx={{ color: theme.textSec }}><Publish fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="Удалить"><IconButton size="small" aria-label="Удалить пак" onClick={onRemove} sx={{ color: '#f87171', ml: 'auto' }}><Delete fontSize="small" /></IconButton></Tooltip>
      </Box>
      {publishing && (
        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          <TextField size="small" fullWidth placeholder="Описание (необязательно)" value={description}
            onChange={(e) => setDescription(e.target.value)} inputProps={{ maxLength: 300 }} />
          <Button size="small" variant="contained" disabled={busy} onClick={() => void publish()}
            sx={{ textTransform: 'none', bgcolor: theme.accent, '&:hover': { bgcolor: theme.accent } }}>Опубликовать</Button>
        </Box>
      )}
    </Box>
  );
}
