import React from 'react';
import { Box, Avatar, Typography, IconButton, Dialog, Divider, Button, Stack, Chip, Snackbar, Alert } from '@mui/material';
import { Close, Phone, Info, Cake, LocationOn, Message } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { User } from '../types';
import { useNavigate } from 'react-router-dom';
import { chatsApi } from '../services/api';
import { useChatStore } from '../store/chatStore';
import { useAuthStore } from '../store/authStore';
import { useProfileCustomizationStore } from '../store/profileCustomizationStore';
import ProfileCommentsWall from './ProfileCommentsWall';
import ActivityLine from './ActivityLine';

function initials(n: string) { return (n || '?').split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2); }

interface Props { user: User | null; open: boolean; onClose: () => void; }

function InfoRow({ icon, label, value, theme, pre }: any) {
  return (
    <Box display="flex" alignItems="flex-start" gap={1.5} mb={2}>
      {icon}
      <Box>
        <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.3 }}>{label}</Typography>
        <Typography sx={{ fontSize: 15, color: theme.text, whiteSpace: pre ? 'pre-wrap' : 'normal' }}>{value}</Typography>
      </Box>
    </Box>
  );
}

export default function UserProfileModal({ user, open, onClose }: Props) {
  const { theme } = useThemeStore();
  const navigate = useNavigate();
  const { setActiveChat, loadChats, onlineUsers } = useChatStore();
  const { user: me } = useAuthStore();
  const custom = useProfileCustomizationStore();
  const [toast, setToast] = React.useState<{ message: string; severity: 'success' | 'error' | 'info' } | null>(null);

  if (!user) return null;
  const isMe = user.id === me?.id;
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.username;
  const isOnline = onlineUsers?.has?.(user.id);
  const accent = (isMe && custom.cardAccent) ? custom.cardAccent : theme.accent;
  const banner = isMe && custom.bannerUrl
    ? `url(${custom.bannerUrl}) center/cover`
    : `linear-gradient(135deg, ${isMe ? custom.bannerColor : accent}, ${accent})`;
  const ic = (I: any) => <I sx={{ fontSize: 20, color: theme.textSec, mt: 0.2 }} />;

  async function handleMessage() {
    try {
      const res = await chatsApi.createDirect(user!.id);
      await loadChats(); setActiveChat(res.data); navigate('/'); onClose();
    } catch { setToast({ message: 'Не удалось открыть чат', severity: 'error' }); }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" PaperProps={{
      sx: { bgcolor: theme.bgChat, color: theme.text, borderRadius: 3, overflow: 'hidden' },
    }}>
      <Box sx={{ position: 'relative', height: 140, background: banner }}>
        <IconButton onClick={onClose} sx={{
          position: 'absolute', top: 8, right: 8, color: '#fff',
          bgcolor: 'rgba(0,0,0,0.35)', '&:hover': { bgcolor: 'rgba(0,0,0,0.55)' },
        }}><Close /></IconButton>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: -7, px: 3 }}>
        <Avatar src={user.avatarUrl || undefined} sx={{
          width: 112, height: 112, fontSize: 40, bgcolor: accent + '80',
          border: `4px solid ${theme.bgChat}`, boxShadow: `0 0 24px ${accent}70`,
        }}>{initials(displayName)}</Avatar>
        <Typography sx={{ mt: 1.5, fontSize: 22, fontWeight: 700, color: theme.text }}>{displayName}</Typography>
        <Typography sx={{ fontSize: 14, color: accent }}>@{user.username}</Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <Chip size="small" label={isOnline ? 'В сети' : 'Не в сети'} sx={{
            bgcolor: (isOnline ? theme.online : theme.textSec) + '22', color: theme.text,
          }} />
        </Stack>
        <ActivityLine userId={user.id} />
      </Box>
      <Box sx={{ px: 3, py: 2 }}>
        {isMe && custom.showcase && (
          <Box sx={{
            p: 1.5, mb: 2, borderRadius: 2, whiteSpace: 'pre-wrap',
            bgcolor: theme.bgHeader, border: `1px solid ${accent}44`,
          }}>
            <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.5 }}>Витрина</Typography>
            <Typography sx={{ fontSize: 14, color: theme.text }}>{custom.showcase}</Typography>
          </Box>
        )}
        {user.bio && <InfoRow icon={ic(Info)} label="О себе" value={user.bio} theme={theme} pre />}
        {user.phone && <InfoRow icon={ic(Phone)} label="Телефон" value={user.phone} theme={theme} />}
        {user.birthDate && <InfoRow icon={ic(Cake)} label="День рождения" value={user.birthDate} theme={theme} />}
        {(user.city || user.country) && <InfoRow icon={ic(LocationOn)} label="Местоположение"
          value={[user.city, user.region, user.country].filter(Boolean).join(', ')} theme={theme} />}
        {!isMe && (
          <Button fullWidth variant="contained" startIcon={<Message />} onClick={handleMessage}
            sx={{ bgcolor: accent, '&:hover': { bgcolor: accent + 'CC' }, borderRadius: 2.5, fontSize: 15, py: 1.2, textTransform: 'none', mt: 1 }}>
            Написать сообщение
          </Button>
        )}
      </Box>
      <Divider sx={{ borderColor: theme.border }} />
      <Box sx={{ px: 3, pb: 3 }}>
        <ProfileCommentsWall targetUserId={user.id} targetUserName={displayName} />
      </Box>
      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={toast?.severity || 'info'} sx={{ bgcolor: theme.bgHeader, color: theme.text, border: `1px solid ${theme.border}` }}>
          {toast?.message}
        </Alert>
      </Snackbar>
    </Dialog>
  );
}
