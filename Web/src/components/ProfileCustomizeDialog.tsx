import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Button,
  TextField, MenuItem, Slider, Typography, Stack, IconButton, Tooltip,
} from '@mui/material';
import { Close, RestartAlt, Image as ImageIcon, Inventory2, Storefront } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { ActivityKind, useProfileCustomizationStore } from '../store/profileCustomizationStore';
import { useShopStore } from '../store/shopStore';

interface Props { open: boolean; onClose: () => void; }

/**
 * Диалог кастомизации профиля в стиле Steam:
 *   баннер (файл или цвет), акцент, прозрачность карточки,
 *   витрина (showcase-текст), статус активности (Discord-подобно).
 */
export default function ProfileCustomizeDialog({ open, onClose }: Props) {
  const { theme } = useThemeStore();
  const c = useProfileCustomizationStore();

  // Открыть магазин на нужной вкладке (общий store, поэтому синхронизируется везде).
  const openShopTab = (tab: 'inventory' | 'shop') => {
    const s = useShopStore.getState();
    s.setTab(tab);
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

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" PaperProps={{ sx: { bgcolor: theme.bgHeader, color: theme.text } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ flex: 1 }}>Кастомизация профиля</Box>
        <Tooltip title="Сбросить">
          <IconButton onClick={() => c.reset()} sx={{ color: theme.textSec }}><RestartAlt /></IconButton>
        </Tooltip>
        <IconButton onClick={onClose} sx={{ color: theme.textSec }}><Close /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ borderColor: theme.border }}>
        <Stack spacing={2.5}>
          {/* Косметика магазина: две отдельные точки входа */}
          <Box>
            <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 1 }}>Косметика</Typography>
            <Stack direction="row" spacing={1}>
              <Button
                fullWidth size="small" variant="outlined"
                startIcon={<Inventory2 />}
                onClick={() => { openShopTab('inventory'); onClose(); }}
                sx={{ textTransform: 'none', color: theme.text, borderColor: theme.border, '&:hover': { borderColor: theme.accent } }}
              >
                Мой инвентарь
              </Button>
              <Button
                fullWidth size="small" variant="contained"
                startIcon={<Storefront />}
                onClick={() => { openShopTab('shop'); onClose(); }}
                sx={{ textTransform: 'none', bgcolor: theme.accent, color: '#001018', '&:hover': { bgcolor: theme.accent + 'BB' } }}
              >
                Магазин
              </Button>
            </Stack>
          </Box>

          <Box>
            <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 1 }}>Баннер</Typography>
            <Box sx={{
              height: 90, borderRadius: 2, mb: 1,
              background: c.bannerUrl ? `url(${c.bannerUrl}) center/cover` : `linear-gradient(135deg, ${c.bannerColor}, ${theme.accent})`,
              border: `1px solid ${theme.border}`,
            }} />
            <Stack direction="row" spacing={1} alignItems="center">
              <Button component="label" size="small" startIcon={<ImageIcon />} variant="outlined" sx={{ textTransform: 'none' }}>
                Загрузить
                <input hidden type="file" accept="image/*" onChange={pickBanner} />
              </Button>
              <Button size="small" onClick={() => c.set('bannerUrl', '')} sx={{ textTransform: 'none', color: theme.textSec }}>
                Убрать картинку
              </Button>
              <TextField
                type="color" size="small" value={c.bannerColor}
                onChange={(e) => c.set('bannerColor', e.target.value)}
                sx={{ width: 60 }}
              />
            </Stack>
          </Box>

          <Box>
            <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 1 }}>Акцент карточки (пусто — из темы)</Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                type="color" size="small" value={c.cardAccent || theme.accent}
                onChange={(e) => c.set('cardAccent', e.target.value)}
                sx={{ width: 60 }}
              />
              <Button size="small" onClick={() => c.set('cardAccent', '')} sx={{ textTransform: 'none', color: theme.textSec }}>
                Из темы
              </Button>
            </Stack>
          </Box>

          <Box>
            <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 1 }}>Прозрачность карточки: {Math.round(c.cardOpacity * 100)}%</Typography>
            <Slider min={0.3} max={1} step={0.05} value={c.cardOpacity} onChange={(_, v) => c.set('cardOpacity', v as number)} />
          </Box>

          <TextField
            label="Витрина (произвольный текст)"
            value={c.showcase} onChange={(e) => c.set('showcase', e.target.value)}
            multiline minRows={2} maxRows={6} size="small" fullWidth
            helperText="Например: любимая цитата, статус, достижения"
          />

          <Box>
            <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 1 }}>Статус активности</Typography>
            <Stack direction="row" spacing={1}>
              <TextField
                select size="small" value={c.activityKind}
                onChange={(e) => c.set('activityKind', e.target.value as ActivityKind)}
                sx={{ width: 180 }}
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
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ color: theme.accent }}>Готово</Button>
      </DialogActions>
    </Dialog>
  );
}
