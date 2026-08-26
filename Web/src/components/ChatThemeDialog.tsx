import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Box, Button, Typography, Divider } from '@mui/material';
import { Lock, Storefront, Check, DeleteOutline } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { useChatThemeStore, CHAT_THEME_PRESETS } from '../store/chatThemeStore';
import { useShopStore, SHOP_CURRENCY } from '../store/shopStore';

interface Props {
  chatId: string | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Персональная тема для одного чата. Платная функция магазина:
 * если «Персональные темы» не куплены — показываем замок и кнопку в магазин.
 */
const PERCHAT_ITEM_ID = 'chat-theme';

export default function ChatThemeDialog({ chatId, open, onClose }: Props) {
  const { theme } = useThemeStore();
  const owned = useShopStore((s) => s.isOwned(PERCHAT_ITEM_ID));
  const setOpenStore = useShopStore((s) => s.setOpen);
  const setChatTheme = useChatThemeStore((s) => s.setChatTheme);
  const removeChatTheme = useChatThemeStore((s) => s.removeChatTheme);
  const current = useChatThemeStore((s) => (chatId ? s.themes[chatId] : undefined));

  const apply = (p: typeof CHAT_THEME_PRESETS[number]) => {
    if (!chatId || !owned) return;
    setChatTheme(chatId, {
      accent: p.accent, bubbleOwn: p.bubbleOwn, bubbleOther: p.bubbleOther, bg: p.bg, presetName: p.name,
    });
    onClose();
  };

  const remove = () => {
    if (chatId) removeChatTheme(chatId);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs"
      PaperProps={{ sx: { bgcolor: theme.bgHeader, color: theme.text, borderRadius: 3 } }}>
      <DialogTitle sx={{ fontSize: 17, fontWeight: 700, pb: 1 }}>
        Персональная тема чата
      </DialogTitle>
      <DialogContent dividers sx={{ borderColor: theme.border }}>
        {!owned ? (
          <Box sx={{ textAlign: 'center', py: 2 }}>
            <Box sx={{
              width: 64, height: 64, borderRadius: '50%', mx: 'auto', mb: 2,
              bgcolor: theme.bgHover, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Lock sx={{ color: theme.textSec, fontSize: 30 }} />
            </Box>
            <Typography sx={{ fontSize: 15, fontWeight: 600 }}>Функция платная</Typography>
            <Typography sx={{ fontSize: 12, color: theme.textSec, mt: 1, mb: 2 }}>
              Персональные темы для контактов продаются в магазине издателя.
            </Typography>
            <Button variant="contained" startIcon={<Storefront />} onClick={() => { onClose(); setOpenStore(true); }}
              sx={{ bgcolor: theme.accent, color: '#001018', textTransform: 'none', borderRadius: 999, px: 3 }}>
              Открыть магазин
            </Button>
          </Box>
        ) : (
          <>
            <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 1 }}>Выберите оформление для этого чата</Typography>
            {current?.presetName && (
              <Box sx={{
                mb: 1.5, p: 1, borderRadius: 2, bgcolor: theme.accent + '1a',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Check sx={{ fontSize: 18, color: theme.accent }} />
                  <Typography sx={{ fontSize: 13, color: theme.text }}>Установлено: {current.presetName}</Typography>
                </Box>
                <Button size="small" startIcon={<DeleteOutline />} onClick={remove}
                  sx={{ color: '#f44336', textTransform: 'none', fontSize: 12 }}>Сбросить</Button>
              </Box>
            )}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              {CHAT_THEME_PRESETS.map((p) => {
                const activePreset = current?.presetName === p.name;
                return (
                  <Box key={p.id} onClick={() => apply(p)} sx={{
                    borderRadius: 2, p: 1.5, cursor: 'pointer', border: `1px solid ${activePreset ? p.accent : theme.border}`,
                    bgcolor: theme.bgHover, textAlign: 'center',
                    '&:hover': { borderColor: p.accent },
                  }}>
                    <Box sx={{ height: 44, borderRadius: 1.5, mb: 1,
                      background: `linear-gradient(135deg, ${p.bg}, ${p.accent})` }} />
                    <Typography sx={{ fontSize: 12, fontWeight: 600 }}>{p.name}</Typography>
                  </Box>
                );
              })}
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ bgcolor: theme.bgHeader, justifyContent: 'space-between' }}>
        <Typography sx={{ fontSize: 11, color: theme.textSec, pl: 1 }}>
          {owned ? 'Разблокировано ✓' : `Нужно купить · ${'250'} ${SHOP_CURRENCY}`}
        </Typography>
        <Button onClick={onClose} sx={{ color: theme.textSec, textTransform: 'none' }}>Закрыть</Button>
      </DialogActions>
      <Divider />
    </Dialog>
  );
}