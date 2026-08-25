import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box } from '@mui/material';
import { useThemeStore } from '../store/themeStore';

/**
 * Общий экран настроек пользователя. Пока служит контейнером для будущих
 * секций (приватность, уведомления, экспорт данных и т.п.). Открывается
 * шестерёнкой в ProfilePage.
 */
export default function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme } = useThemeStore();
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm"
      PaperProps={{ sx: { bgcolor: theme.bg, color: theme.text, border: `1px solid ${theme.border}`, borderRadius: 3 } }}>
      <DialogTitle sx={{ fontWeight: 700 }}>Настройки</DialogTitle>
      <DialogContent dividers sx={{ bgcolor: theme.bgChat }}>
        <Box sx={{ py: 2 }}>
          <Typography sx={{ fontSize: 14, color: theme.textSec, mb: 1 }}>
            Здесь появятся общие настройки приложения.
          </Typography>
          <Typography sx={{ fontSize: 13, color: theme.textSec }}>
            Индивидуальный звук уведомлений для чата настраивается в меню чата
            (три точки в шапке → «🔔 Свой звук уведомления»).
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ color: theme.textSec }}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}
