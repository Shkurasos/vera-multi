import React, { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box, List, ListItemButton, ListItemIcon, ListItemText, Divider } from '@mui/material';
import { Link as LinkIcon, DevicesOther, ChevronRight } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useThemeStore } from '../store/themeStore';
import InviteLinkDialog from './InviteLinkDialog';

/**
 * Общий экран настроек пользователя. Открывается шестерёнкой в ProfilePage.
 * Содержит доступ к инвайт-ссылке и списку устройств.
 */
export default function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme } = useThemeStore();
  const navigate = useNavigate();
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm"
        PaperProps={{ sx: { bgcolor: theme.bg, color: theme.text, border: `1px solid ${theme.border}`, borderRadius: 3 } }}>
        <DialogTitle sx={{ fontWeight: 700 }}>Настройки</DialogTitle>
        <DialogContent dividers sx={{ bgcolor: theme.bgChat, p: 0 }}>
          <List sx={{ py: 0 }}>
            <ListItemButton onClick={() => setInviteOpen(true)} sx={{ py: 1.5 }}>
              <ListItemIcon sx={{ color: theme.accent, minWidth: 40 }}><LinkIcon /></ListItemIcon>
              <ListItemText
                primary="Моя ссылка для приглашения"
                secondary="Поделиться контактом или добавить друга"
                primaryTypographyProps={{ sx: { color: theme.text, fontWeight: 600 } }}
                secondaryTypographyProps={{ sx: { color: theme.textSec, fontSize: 12 } }}
              />
              <ChevronRight sx={{ color: theme.textSec }} />
            </ListItemButton>
            <Divider sx={{ borderColor: theme.border }} />
            <ListItemButton onClick={() => { onClose(); navigate('/devices'); }} sx={{ py: 1.5 }}>
              <ListItemIcon sx={{ color: theme.accent, minWidth: 40 }}><DevicesOther /></ListItemIcon>
              <ListItemText
                primary="Устройства"
                secondary="Привязанные устройства и QR-код"
                primaryTypographyProps={{ sx: { color: theme.text, fontWeight: 600 } }}
                secondaryTypographyProps={{ sx: { color: theme.textSec, fontSize: 12 } }}
              />
              <ChevronRight sx={{ color: theme.textSec }} />
            </ListItemButton>
          </List>
          <Box sx={{ px: 2, py: 1.5 }}>
            <Typography sx={{ fontSize: 12, color: theme.textSec }}>
              Индивидуальные звуки уведомлений настраиваются в меню чата (три точки в шапке → «🔔 Уведомления чата»).
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} sx={{ color: theme.textSec }}>Закрыть</Button>
        </DialogActions>
      </Dialog>
      <InviteLinkDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </>
  );
}
