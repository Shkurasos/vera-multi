import React, { useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Button,
  TextField, MenuItem, Slider, Typography, Stack, IconButton, Tooltip,
} from '@mui/material';
import { Close, RestartAlt, Image as ImageIcon, Inventory2 } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { ActivityKind, useProfileCustomizationStore } from '../store/profileCustomizationStore';
import { useShopStore } from '../store/shopStore';

interface Props { open: boolean; onClose: () => void; }

export default function ProfileCustomizeDialog({ open, onClose }: Props) {
  const { theme } = useThemeStore();
  const c = useProfileCustomizationStore();
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const openShopTab = () => {
    const s = useShopStore.getState();
    s.setTab('inventory');
    s.setOpen(true);
  };

  async function pickBanner(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const data = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result || ''));
      r.onerror = () => rej(r.error);
      r.readAsDataURL(f);
    });
    c.set('bannerUrl', data);
  }

  const isBannerVideo = !!c.bannerUrl && (/^data:video\//i.test(c.bannerUrl) || /\.(mp4|webm|mov)$/i.test(c.bannerUrl));

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" PaperProps={{ sx: { bgcolor: theme.bgHeader, color: theme.text } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1.25 }}>
        <Box sx={{ flex: 1, fontSize: 16 }}>Кастомизация профиля</Box>
        <Tooltip title="Сбросить">
          <IconButton onClick={() => c.reset()} size="small" sx={{ color: theme.textSec }}><RestartAlt fontSize="small" /></IconButton>
        </Tooltip>
        <IconButton onClick={onClose} size="small" sx={{ color: theme.textSec }}><Close fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ borderColor: theme.border }}>
        <Stack spacing={1.25}>
          {/* Баннер: превью слева, кнопки справа в строку */}
          <Box>
            <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.5 }}>Баннер</Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <Box sx={{ position: 'relative', width: 96, height: 48, borderRadius: 1.5, flexShrink: 0, overflow: 'hidden',
                background: (!c.bannerUrl || isBannerVideo) ? `linear-gradient(135deg, ${c.bannerColor}, ${theme.accent})` : `url(${c.bannerUrl}) center/cover`,
                border: `1px solid ${theme.border}` }}>
                {isBannerVideo && <video src={c.bannerUrl} autoPlay loop muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              </Box>
              <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                <Button component="label" size="small" startIcon={<ImageIcon sx={{ fontSize: 16 }} />} variant="outlined" sx={{ textTransform: 'none', py: 0.4, fontSize: 12 }}>
                  Загрузить
                  <input ref={bannerInputRef} hidden type="file" accept="image/*,video/*" onChange={pickBanner} />
                </Button>
                {c.bannerUrl && (
                  <Button size="small" onClick={() => c.set('bannerUrl', '')} sx={{ textTransform: 'none', color: theme.textSec, fontSize: 12 }}>Убрать</Button>
                )}
                <TextField type="color" size="small" value={c.bannerColor} onChange={(e) => c.set('bannerColor', e.target.value)} sx={{ width: 36, '& .MuiOutlinedInput-input': { p: 0.5 } }} />
              </Stack>
            </Stack>
          </Box>

          {/* Акцент + Прозрачность — в одну строку */}
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.4 }}>Акцент карточки</Typography>
              <Stack direction="row" spacing={0.75} alignItems="center">
                <TextField type="color" size="small" value={c.cardAccent || theme.accent} onChange={(e) => c.set('cardAccent', e.target.value)} sx={{ width: 36, '& .MuiOutlinedInput-input': { p: 0.5 } }} />
                <Button size="small" onClick={() => c.set('cardAccent', '')} sx={{ textTransform: 'none', color: theme.textSec, fontSize: 12 }}>Из темы</Button>
              </Stack>
            </Box>
            <Box sx={{ flex: 1.2 }}>
              <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.4 }}>Прозрачность: {Math.round(c.cardOpacity * 100)}%</Typography>
              <Slider size="small" min={0.3} max={1} step={0.05} value={c.cardOpacity} onChange={(_, v) => c.set('cardOpacity', v as number)}
                sx={{ '& .MuiSlider-thumb': { width: 12, height: 12 } }} />
            </Box>
          </Stack>

          {/* Витрина */}
          <TextField
            label="Витрина"
            value={c.showcase} onChange={(e) => c.set('showcase', e.target.value)}
            multiline minRows={2} maxRows={4} size="small" fullWidth
            helperText="Цитата, статус, достижения"
          />

          {/* Статус активности — в одну строку */}
          <Box>
            <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.4 }}>Статус активности</Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                select size="small" value={c.activityKind}
                onChange={(e) => c.set('activityKind', e.target.value as ActivityKind)}
                sx={{ minWidth: 130 }}
              >
                <MenuItem value="off">Скрыто</MenuItem>
                <MenuItem value="auto">Авто (плеер)</MenuItem>
                <MenuItem value="playing">Играет в</MenuItem>
                <MenuItem value="watching">Смотрит</MenuItem>
                <MenuItem value="listening">Слушает</MenuItem>
                <MenuItem value="custom">Свой текст</MenuItem>
              </TextField>
              <TextField
                size="small" fullWidth
                placeholder={c.activityKind === 'auto' ? 'Берётся из плеера' : 'Что показать'}
                disabled={c.activityKind === 'auto' || c.activityKind === 'off'}
                value={c.activityText}
                onChange={(e) => c.set('activityText', e.target.value)}
              />
            </Stack>
          </Box>

          {/* Косметика */}
          <Button
            fullWidth size="small" variant="outlined"
            startIcon={<Inventory2 sx={{ fontSize: 18 }} />}
            onClick={() => { openShopTab(); onClose(); }}
            sx={{ textTransform: 'none', color: theme.text, borderColor: theme.border, '&:hover': { borderColor: theme.accent } }}
          >
            Мой инвентарь
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ py: 1 }}>
        <Button onClick={onClose} sx={{ color: theme.accent }}>Готово</Button>
      </DialogActions>
    </Dialog>
  );
}
