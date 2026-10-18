/** Каталог паков иконок сообщества: поиск, установка, скачивание файлом, удаление своих. */
import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button, Typography, TextField, IconButton, Tooltip, InputAdornment } from '@mui/material';
import { Search, Download, Delete } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { useUiPrefsStore } from '../store/uiPrefsStore';
import { useIconPackStore } from '../store/iconPackStore';
import { useAuthStore } from '../store/authStore';
import { communityIconPacksApi, type CommunityIconPack } from '../services/api';
import { sanitizePack } from '../utils/iconPackFormat';
import { KNOWN_SLOTS, downloadPackFile, previewSlots } from './iconPackPanelUtils';
import PackIcon from './PackIcon';

export default function CommunityIconPacks({ onMessage }: { onMessage: (m: string) => void }) {
  const theme = useThemeStore((s) => s.theme);
  const userId = useAuthStore((s) => (s.user as any)?.id);
  const createPack = useIconPackStore((s) => s.createPack);
  const setCustomPack = useUiPrefsStore((s) => s.setCustomPack);
  const [items, setItems] = useState<CommunityIconPack[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (q: string) => {
    try { setItems((await communityIconPacksApi.list(q)).data.packs || []); }
    catch { onMessage('Не удалось загрузить каталог паков'); }
    finally { setLoaded(true); }
  }, [onMessage]);
  useEffect(() => { void load(''); }, [load]);

  const fetchPack = async (item: CommunityIconPack, install: boolean) => {
    const res = await communityIconPacksApi.get(item.id, install);
    const parsed = sanitizePack(res.data.pack, KNOWN_SLOTS);
    if (!parsed) throw new Error('Пак повреждён');
    return parsed;
  };
  const install = async (item: CommunityIconPack) => {
    setBusy(true);
    try {
      const parsed = await fetchPack(item, true);
      setCustomPack(createPack(item.name, parsed.base, parsed.icons));
      onMessage(`«${item.name}» установлен и включён — его можно править как свой`);
    } catch (e: any) { onMessage(e?.response?.data?.message || e?.message || 'Не удалось установить пак'); }
    finally { setBusy(false); }
  };
  const saveFile = async (item: CommunityIconPack) => {
    try { downloadPackFile(item.name, (await communityIconPacksApi.get(item.id)).data.pack); }
    catch { onMessage('Не удалось скачать пак'); }
  };
  const remove = async (item: CommunityIconPack) => {
    if (!window.confirm(`Удалить публикацию «${item.name}»?`)) return;
    try { await communityIconPacksApi.remove(item.id); await load(query); }
    catch (e: any) { onMessage(e?.response?.data?.message || 'Не удалось удалить публикацию'); }
  };

  return (
    <Box sx={{ mt: 2.5, pt: 2, borderTop: `1px solid ${theme.border}` }}>
      <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 1 }}>Паки сообщества</Typography>
      <TextField size="small" fullWidth placeholder="Найти пак" value={query} onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void load(query); }} sx={{ mb: 1 }}
        InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }} />
      <Box sx={{ display: 'grid', gap: 1, maxHeight: 360, overflowY: 'auto' }}>
        {items.map((item) => (
          <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, border: `1px solid ${theme.border}`, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', gap: 0.5, color: theme.accent, flexShrink: 0 }}>
              {previewSlots(item.preview, 3).map((s) => <PackIcon key={s} slot={s} base={item.base} icons={item.preview} size={20} />)}
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography noWrap sx={{ fontSize: 14, fontWeight: 600, color: theme.text }}>{item.name}</Typography>
              <Typography noWrap sx={{ fontSize: 11, color: theme.textSec }}>
                {item.description || item.authorName} · иконок {item.iconCount} · установок {item.downloads}
              </Typography>
            </Box>
            <Button size="small" variant="outlined" disabled={busy} onClick={() => void install(item)}
              sx={{ textTransform: 'none', borderRadius: 2, color: theme.accent, borderColor: theme.accent, flexShrink: 0 }}>Поставить</Button>
            <Tooltip title="Скачать файлом"><IconButton size="small" aria-label="Скачать пак файлом" onClick={() => void saveFile(item)} sx={{ color: theme.textSec }}><Download fontSize="small" /></IconButton></Tooltip>
            {item.authorId === String(userId) && (
              <Tooltip title="Удалить публикацию"><IconButton size="small" aria-label="Удалить публикацию" onClick={() => void remove(item)} sx={{ color: '#f87171' }}><Delete fontSize="small" /></IconButton></Tooltip>
            )}
          </Box>
        ))}
        {loaded && !items.length && <Typography sx={{ fontSize: 12, color: theme.textSec }}>Публикаций пока нет.</Typography>}
      </Box>
    </Box>
  );
}
