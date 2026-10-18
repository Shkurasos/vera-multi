/**
 * «Свои паки» во вкладке «Иконки и стиль»: создать пак (с нуля или на основе
 * встроенного / своего), включить, редактировать, скачать файлом, загрузить
 * файл, выложить в каталог и поставить чужой пак из каталога.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, Typography, TextField, Alert, MenuItem } from '@mui/material';
import { Add, Upload } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { useUiPrefsStore, ICON_PACKS } from '../store/uiPrefsStore';
import { useIconPackStore } from '../store/iconPackStore';
import { BASE_PACK_IDS, packToFile, sanitizePack, type BasePackId, type CustomIconPack } from '../utils/iconPackFormat';
import { KNOWN_SLOTS, downloadPackFile } from './iconPackPanelUtils';
import IconPackEditorDialog from './IconPackEditorDialog';
import MyIconPackRow from './MyIconPackRow';
import CommunityIconPacks from './CommunityIconPacks';

export default function CustomIconPacksPanel() {
  const theme = useThemeStore((s) => s.theme);
  const { iconPack, customPack, setCustomPack } = useUiPrefsStore();
  const { packs, createPack, duplicatePack, deletePack, hydrated } = useIconPackStore();
  const [editing, setEditing] = useState<string | null>(null);
  const [newBase, setNewBase] = useState<string>('current');
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const list = Object.values(packs).sort((a, b) => b.updatedAt - a.updatedAt);
  const editingPack = editing ? packs[editing] : null;

  // Пак удалён (или не доехал на это устройство) — замены снимаются.
  useEffect(() => {
    if (hydrated && customPack && !packs[customPack]) setCustomPack(null);
  }, [hydrated, customPack, packs, setCustomPack]);

  const create = () => {
    let id: string | null = null;
    if (newBase.startsWith('pack:')) id = duplicatePack(newBase.slice(5));
    if (!id) {
      const base = newBase === 'current' ? iconPack : newBase;
      id = createPack('Мой пак', ((BASE_PACK_IDS as readonly string[]).includes(base) ? base : 'filled') as BasePackId);
    }
    setEditing(id);
  };

  const importFile = async (file: File) => {
    setMessage('');
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('Файл больше 8 МБ');
      let raw: unknown;
      try { raw = JSON.parse(await file.text()); } catch { throw new Error('Файл повреждён'); }
      const parsed = sanitizePack(raw, KNOWN_SLOTS);
      if (!parsed) throw new Error('Это не пак иконок');
      const id = createPack(parsed.name, parsed.base, parsed.icons);
      setCustomPack(id);
      setMessage(`Пак «${parsed.name}» загружен и включён${parsed.dropped ? ` (пропущено слотов: ${parsed.dropped})` : ''}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Не удалось загрузить пак');
    }
  };

  const remove = (p: CustomIconPack) => {
    if (!window.confirm(`Удалить пак «${p.name}»?`)) return;
    if (customPack === p.id) setCustomPack(null);
    deletePack(p.id);
  };

  const btn = { textTransform: 'none', borderRadius: 2 } as const;
  return (
    <Box>
      <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 1 }}>Свои паки</Typography>
      <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 1.5 }}>
        Заменяйте любую иконку чем угодно: другой иконкой, эмодзи, своим рисунком или фото. Свой пак ложится поверх выбранного выше.
      </Typography>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
        <TextField size="small" select label="Взять за основу" value={newBase} onChange={(e) => setNewBase(e.target.value)} sx={{ flex: '1 1 200px' }}>
          <MenuItem value="current">Текущий пак ({ICON_PACKS.find((p) => p.id === iconPack)?.label})</MenuItem>
          {BASE_PACK_IDS.map((id) => <MenuItem key={id} value={id}>{ICON_PACKS.find((p) => p.id === id)?.label || id}</MenuItem>)}
          {list.map((p) => <MenuItem key={p.id} value={`pack:${p.id}`}>Копия: {p.name}</MenuItem>)}
        </TextField>
        <Button variant="contained" startIcon={<Add />} onClick={create}
          sx={{ ...btn, bgcolor: theme.accent, '&:hover': { bgcolor: theme.accent } }}>Создать пак</Button>
        <Button variant="outlined" startIcon={<Upload />} onClick={() => fileRef.current?.click()}
          sx={{ ...btn, color: theme.text, borderColor: theme.border }}>Загрузить файл</Button>
        <input ref={fileRef} type="file" hidden accept=".json,application/json"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
      </Box>

      <Box sx={{ display: 'grid', gap: 1 }}>
        {list.map((p) => (
          <MyIconPackRow key={p.id} pack={p} active={customPack === p.id}
            onToggle={() => setCustomPack(customPack === p.id ? null : p.id)}
            onEdit={() => setEditing(p.id)} onCopy={() => duplicatePack(p.id)}
            onDownload={() => downloadPackFile(p.name, packToFile(p))} onRemove={() => remove(p)}
            onMessage={setMessage} />
        ))}
        {hydrated && !list.length && (
          <Typography sx={{ fontSize: 12, color: theme.textSec }}>Своих паков пока нет.</Typography>
        )}
      </Box>
      {message && <Alert severity="info" onClose={() => setMessage('')} sx={{ mt: 1.5, fontSize: 12 }}>{message}</Alert>}

      <CommunityIconPacks onMessage={setMessage} />
      {editingPack && <IconPackEditorDialog pack={editingPack} onClose={() => setEditing(null)} />}
    </Box>
  );
}
