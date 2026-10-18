/**
 * Редактор своего пака: сетка всех слотов (поиск по-русски — «звонок»,
 * «три точки», «архив»…), основа пака и имя. Правки живут в черновике и
 * видны сразу; в пак попадают по «Сохранить».
 */
import React, { useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  TextField, MenuItem, InputAdornment, FormControlLabel, Switch,
} from '@mui/material';
import { Search } from '@mui/icons-material';
import { ICON_SLOTS } from '../mui-icons-shim';
import { useThemeStore } from '../store/themeStore';
import { ICON_PACKS } from '../store/uiPrefsStore';
import { useIconPackStore } from '../store/iconPackStore';
import { BASE_PACK_IDS, MAX_PACK_NAME, type BasePackId, type CustomIcon, type CustomIconPack } from '../utils/iconPackFormat';
import { slotLabel, slotMatches } from '../utils/iconSlots';
import PackIcon from './PackIcon';
import IconSlotDialog from './IconSlotDialog';

export default function IconPackEditorDialog({ pack, onClose }: { pack: CustomIconPack; onClose: () => void }) {
  const theme = useThemeStore((s) => s.theme);
  const savePack = useIconPackStore((s) => s.savePack);
  const [name, setName] = useState(pack.name);
  const [base, setBase] = useState<BasePackId>(pack.base);
  const [icons, setIcons] = useState<Record<string, CustomIcon>>(pack.icons);
  const [query, setQuery] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [slot, setSlot] = useState<string | null>(null);
  const dirty = name !== pack.name || base !== pack.base || icons !== pack.icons;

  const slots = useMemo(
    () => ICON_SLOTS.filter((s) => slotMatches(s, query) && (!onlyChanged || icons[s])),
    [query, onlyChanged, icons],
  );
  const changed = Object.keys(icons).length;

  const apply = (s: string, icon: CustomIcon | null) => {
    setIcons((prev) => {
      const next = { ...prev };
      if (icon) next[s] = icon; else delete next[s];
      return next;
    });
    setSlot(null);
  };
  const save = () => {
    savePack({ id: pack.id, name: name.trim() || 'Мой пак', base, icons });
    onClose();
  };
  const close = () => {
    if (dirty && !window.confirm('Закрыть без сохранения?')) return;
    onClose();
  };

  return (
    <Dialog open onClose={close} maxWidth="md" fullWidth
      PaperProps={{ sx: { bgcolor: theme.bg, color: theme.text, border: `1px solid ${theme.border}`, height: 'min(86vh, 760px)' } }}>
      <DialogTitle sx={{ pb: 1 }}>Редактор пака иконок</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: '4px !important' }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <TextField size="small" label="Название" value={name} onChange={(e) => setName(e.target.value)}
            inputProps={{ maxLength: MAX_PACK_NAME }} sx={{ flex: '2 1 200px' }} />
          <TextField size="small" select label="Основа (стиль остальных)" value={base}
            onChange={(e) => setBase(e.target.value as BasePackId)} sx={{ flex: '1 1 180px' }}>
            {BASE_PACK_IDS.map((id) => (
              <MenuItem key={id} value={id}>{ICON_PACKS.find((p) => p.id === id)?.label || id}</MenuItem>
            ))}
          </TextField>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField size="small" placeholder="Поиск: звонок, три точки, архив…" value={query}
            onChange={(e) => setQuery(e.target.value)} sx={{ flex: '1 1 240px' }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }} />
          <FormControlLabel sx={{ mr: 0 }}
            control={<Switch size="small" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 13 }}>Только изменённые ({changed})</Typography>} />
        </Box>
        <Typography sx={{ fontSize: 12, color: theme.textSec }}>
          Нажмите на любую иконку, чтобы заменить её. Незаменённые берутся из основы.
        </Typography>
        <SlotGrid slots={slots} base={base} icons={icons} onPick={setSlot} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
        <Button onClick={() => { if (window.confirm('Убрать все замены в паке?')) setIcons({}); }} disabled={!changed}
          sx={{ textTransform: 'none', color: theme.textSec }}>Сбросить все</Button>
        <Box>
          <Button onClick={close} sx={{ color: theme.text }}>Отмена</Button>
          <Button variant="contained" onClick={save}
            sx={{ bgcolor: theme.accent, textTransform: 'none', '&:hover': { bgcolor: theme.accent } }}>Сохранить</Button>
        </Box>
      </DialogActions>
      {slot && (
        <IconSlotDialog slot={slot} base={base} current={icons[slot]}
          onApply={(icon) => apply(slot, icon)} onClose={() => setSlot(null)} />
      )}
    </Dialog>
  );
}


/** Сетка слотов: иконка в стиле пака + русская подпись. */
function SlotGrid({ slots, base, icons, onPick }: {
  slots: string[]; base: string; icons: Record<string, CustomIcon>; onPick: (slot: string) => void;
}) {
  const theme = useThemeStore((s) => s.theme);
  return (
    <Box sx={{
      flex: 1, minHeight: 0, overflowY: 'auto', display: 'grid', gap: 0.75,
      gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', alignContent: 'start',
    }}>
      {slots.map((s) => (
        <Button key={s} onClick={() => onPick(s)} aria-label={`Заменить: ${slotLabel(s)}`}
          sx={{
            flexDirection: 'column', gap: 0.5, py: 1, px: 0.5, minWidth: 0, textTransform: 'none',
            color: theme.text, border: `1px solid ${icons[s] ? theme.accent : theme.border}`, borderRadius: 2,
            bgcolor: icons[s] ? theme.accent + '18' : 'transparent',
          }}>
          <Box sx={{ color: theme.accent, height: 28, display: 'flex', alignItems: 'center' }}>
            <PackIcon slot={s} base={base} icons={icons} size={26} />
          </Box>
          <Typography sx={{ fontSize: 11, lineHeight: 1.2, textAlign: 'center', color: theme.textSec, wordBreak: 'break-word' }}>
            {slotLabel(s)}
          </Typography>
        </Button>
      ))}
      {!slots.length && <Typography sx={{ fontSize: 13, color: theme.textSec }}>Ничего не найдено.</Typography>}
    </Box>
  );
}
