import React from 'react';
import { Box, Avatar, Typography, IconButton, Dialog, Divider, Button, Stack, Chip, Snackbar, Alert } from '@mui/material';
import { Close, Phone, Info, Cake, LocationOn, Message } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { User } from '../types';
import { useNavigate } from 'react-router-dom';
import { chatsApi, usersApi } from '../services/api';
import { useChatStore } from '../store/chatStore';
import { useAuthStore } from '../store/authStore';
import { useProfileCustomizationStore } from '../store/profileCustomizationStore';
import ProfileCommentsWall from './ProfileCommentsWall';
import ActivityLine from './ActivityLine';
import ReportUserDialog from './ReportUserDialog';
import { SHOP_CATALOG, useShopStore } from '../store/shopStore';
import { buildShopRingSx } from '../utils/rarityStyles';
import { skinColors } from '../utils/skinColors';

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
  const myCustom = useProfileCustomizationStore();
  const [remoteCustom, setRemoteCustom] = React.useState<any>(null);
  const [reportOpen, setReportOpen] = React.useState(false);
  React.useEffect(() => { setReportOpen(false); }, [user?.id, open]);
  const [toast, setToast] = React.useState<{ message: string; severity: 'success' | 'error' | 'info' } | null>(null);

  const isMe = user?.id === me?.id;
  const ownRing = useShopStore(s => s.activeRing);
  const colorModes = useShopStore(s => s.colorModes);
  const [remoteRing, setRemoteRing] = React.useState<{ userId: string; id: string } | null>(null);
  React.useEffect(() => {
    setRemoteRing(null);
    if (!open || !user || isMe) return;
    let cancelled = false;
    const userId = user.id;
    usersApi.getById(userId).then(({ data }) => {
      if (!cancelled) setRemoteRing({ userId, id: data.activeRing || '' });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, user?.id, isMe]);
  // Для чужого профиля тянем кастомизацию с сервера, для своего — из локального store.
  React.useEffect(() => {
    if (!open || !user || isMe) { setRemoteCustom(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem('vera_token');
        const r = await fetch(`/api/users/${user.id}/customization`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: 'include',
        });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setRemoteCustom(j?.data || null);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [open, user?.id, isMe]);

  if (!user) return null;
  const custom: any = isMe ? myCustom : (remoteCustom || {});
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.username;
  const isOnline = onlineUsers?.has?.(user.id);
  const accent = (custom?.cardAccent) ? custom.cardAccent : theme.accent;
  const ringId = isMe ? ownRing : remoteRing?.userId === user.id ? remoteRing.id : user.activeRing;
  const ringItem = SHOP_CATALOG.find(i => i.applyKey === 'avatarRing' && i.id === ringId);
  const ringSx = ringItem && !ringItem.stock
    ? skinColors(buildShopRingSx(ringItem.value, accent, false, 4), ringItem, accent, isMe && colorModes[ringItem.id] === 'theme')
    : {};
  const isBannerVideo = !!custom?.bannerUrl && (/^data:video\//i.test(custom.bannerUrl) || /\.(mp4|webm|mov)$/i.test(custom.bannerUrl));
  const banner = custom?.bannerUrl && !isBannerVideo
    ? `url(${custom.bannerUrl}) center/cover`
    : `linear-gradient(135deg, ${custom?.bannerColor || accent}, ${accent})`;
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
      <Box sx={{ position: 'relative', height: 140, background: banner, overflow: 'hidden' }}>
        {isBannerVideo && (
          <video src={custom.bannerUrl} autoPlay loop muted playsInline
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        <IconButton onClick={onClose} sx={{
          position: 'absolute', top: 8, right: 8, color: '#fff',
          bgcolor: 'rgba(0,0,0,0.35)', '&:hover': { bgcolor: 'rgba(0,0,0,0.55)' },
        }}><Close /></IconButton>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: -7, px: 3 }}>
        <Avatar src={user.avatarUrl || undefined} sx={{
          width: 112, height: 112, fontSize: 40, bgcolor: accent + '80',
          border: `4px solid ${theme.bgChat}`, boxShadow: `0 0 24px ${accent}70`,
          ...ringSx,
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
        {custom?.showcase && (
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
      {!isMe && <Button color="error" onClick={() => setReportOpen(true)}>Пожаловаться</Button>}
      {reportOpen && <ReportUserDialog key={user.id} targetId={user.id} onClose={() => setReportOpen(false)} onSent={() => {
        setReportOpen(false); setToast({ message: 'Жалоба отправлена администрации', severity: 'success' });
      }} />}
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
