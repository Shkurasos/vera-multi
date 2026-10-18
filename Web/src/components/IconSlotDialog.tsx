/**
 * Диалог одного слота пака: чем заменить иконку — другой иконкой, эмодзи /
 * текстом или картинкой (нарисовать, загрузить, обрезать). По смыслу ничего
 * не проверяется: «Поиск» может стать котом.
 */
import React, { useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  TextField, ToggleButton, ToggleButtonGroup, InputAdornment,
} from '@mui/material';
import { Search, RestartAlt } from '@mui/icons-material';
import { ICON_SLOTS } from '../mui-icons-shim';
import { useThemeStore } from '../store/themeStore';
import { sanitizeIcon, type CustomIcon } from '../utils/iconPackFormat';
import { slotLabel, slotMatches } from '../utils/iconSlots';
import PackIcon, { NO_REPLACEMENTS } from './PackIcon';
import IconSlotImageTab from './IconSlotImageTab';

type Mode = 'mui' | 'text' | 'image';

export default function IconSlotDialog({ slot, base, current, onApply, onClose }: {
  slot: string; base: string; current?: CustomIcon;
  /** null — вернуть исходную иконку. */
  onApply: (icon: CustomIcon | null) => void;
  onClose: () => void;
}) {
  const theme = useThemeStore((s) => s.theme);
  const [mode, setMode] = useState<Mode>(current?.kind || 'mui');
  const [query, setQuery] = useState('');
  const [text, setText] = useState(current?.kind === 'text' ? current.text : '');
  const [image, setImage] = useState(current?.kind === 'image' ? current.src : '');
  const [tint, setTint] = useState(current?.kind === 'image' ? !!current.tint : false);
  const slots = useMemo(() => ICON_SLOTS.filter((s) => slotMatches(s, query)), [query]);
  const btnSx = {
    textTransform: 'none', color: theme.text, borderColor: theme.border,
    '&.Mui-selected': { bgcolor: theme.accent + '25', color: theme.text, borderColor: theme.accent },
  } as const;
  const applyText = () => {
    const icon = sanitizeIcon({ kind: 'text', text });
    if (icon) onApply(icon);
  };
  const applyImage = () => {
    const icon = sanitizeIcon({ kind: 'image', src: image, tint });
    if (icon) onApply(icon);
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: { bgcolor: theme.bg, color: theme.text, border: `1px solid ${theme.border}` } }}>
      <DialogTitle sx={{ pb: 1, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <PackIcon slot={slot} base={base} icons={NO_REPLACEMENTS} size={28} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700 }}>{slotLabel(slot)}</Typography>
          <Typography sx={{ fontSize: 12, color: theme.textSec }}>Слот {slot}</Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        <ToggleButtonGroup exclusive fullWidth size="small" value={mode} onChange={(_, v) => v && setMode(v)} sx={{ mb: 1.5 }}>
          <ToggleButton value="mui" sx={btnSx}>Другая иконка</ToggleButton>
          <ToggleButton value="text" sx={btnSx}>Эмодзи / текст</ToggleButton>
          <ToggleButton value="image" sx={btnSx}>Картинка</ToggleButton>
        </ToggleButtonGroup>

        {mode === 'mui' && (
          <>
            <TextField size="small" fullWidth placeholder="Найти иконку" value={query} onChange={(e) => setQuery(e.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }}
              sx={{ mb: 1 }} />
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(44px, 1fr))', gap: 0.5, maxHeight: 300, overflowY: 'auto' }}>
              {slots.map((s) => (
                <Button key={s} title={slotLabel(s)} aria-label={slotLabel(s)}
                  onClick={() => onApply(s === slot ? null : { kind: 'mui', name: s })}
                  sx={{
                    minWidth: 0, height: 44, color: theme.text, border: `1px solid ${theme.border}`, borderRadius: 1.5,
                    ...(current?.kind === 'mui' && current.name === s ? { borderColor: theme.accent, bgcolor: theme.accent + '25' } : {}),
                  }}>
                  <PackIcon slot={s} base={base} icons={NO_REPLACEMENTS} />
                </Button>
              ))}
            </Box>
          </>
        )}

        {mode === 'text' && (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField size="small" autoFocus fullWidth label="Эмодзи или 1–4 символа" value={text}
              onChange={(e) => setText(e.target.value)} inputProps={{ maxLength: 16 }}
              onKeyDown={(e) => { if (e.key === 'Enter') applyText(); }} />
            <Box sx={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.accent }}>
              {text.trim() && <PackIcon slot={slot} base={base} icons={{ [slot]: { kind: 'text', text: text.trim() } }} size={32} />}
            </Box>
          </Box>
        )}

        {mode === 'image' && <IconSlotImageTab image={image} tint={tint} onImage={setImage} onTint={setTint} />}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
        <Button startIcon={<RestartAlt />} onClick={() => onApply(null)} disabled={!current}
          sx={{ textTransform: 'none', color: theme.textSec }}>Вернуть исходную</Button>
        <Box>
          <Button onClick={onClose} sx={{ color: theme.text }}>Отмена</Button>
          {mode === 'text' && <Button onClick={applyText} disabled={!text.trim()} sx={{ color: theme.accent }}>Применить</Button>}
          {mode === 'image' && <Button onClick={applyImage} disabled={!image} sx={{ color: theme.accent }}>Применить</Button>}
        </Box>
      </DialogActions>
    </Dialog>
  );
}
