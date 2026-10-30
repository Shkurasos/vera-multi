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
import ProfilePinnedPlaylistBar from './ProfilePinnedPlaylistBar';
import ReportUserDialog from './ReportUserDialog';
import { SHOP_CATALOG, useShopStore } from '../store/shopStore';
import { useUserSettingsStore } from '../store/userSettingsStore';
import { buildShopRingSx } from '../utils/rarityStyles';
import { skinColors } from '../utils/skinColors';
import { usePetStore } from '../store/petStore';
import PetArtwork from './PetArtwork';
import { useAvatarFill } from '../hooks/useAvatarColor';

function initials(n: string) { return (n || '?').split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2); }

interface Props { user: User | null; open: boolean; onClose: () => void; }

function InfoRow({ icon, label, value, theme, pre }: any) {
  return (
    <Box display="flex" alignItems="flex-start" gap={1.5} sx={{ mb: { xs: 1.25, sm: 2 } }}>
      {icon}
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.3 }}>{label}</Typography>
        <Typography sx={{ fontSize: { xs: 14, sm: 15 }, color: theme.text, whiteSpace: pre ? 'pre-wrap' : 'normal', overflowWrap: 'anywhere' }}>{value}</Typography>
      </Box>
    </Box>
  );
}

export default function UserProfileModal({ user, open, onClose }: Props) {
  const theme = useThemeStore((s) => s.theme);
  const navigate = useNavigate();
  // Только нужные поля: профиль открывается поверх чата и раньше перерисовывался
  // на каждое сообщение в любом чате (подписка на весь chatStore).
  const setActiveChat = useChatStore((s) => s.setActiveChat);
  const loadChats = useChatStore((s) => s.loadChats);
  const onlineUsers = useChatStore((s) => s.onlineUsers);
  const me = useAuthStore((s) => s.user);
  const myCustom = useProfileCustomizationStore();
  const [remoteCustom, setRemoteCustom] = React.useState<any>(null);
  const [reportOpen, setReportOpen] = React.useState(false);
  React.useEffect(() => { setReportOpen(false); }, [user?.id, open]);
  // Аватарка без фото — тот же цвет, что у человека в списке чатов.
  const avatarFillSx = useAvatarFill(user?.id);
  const [toast, setToast] = React.useState<{ message: string; severity: 'success' | 'error' | 'info' } | null>(null);

  const isMe = user?.id === me?.id;
  const ownRing = useShopStore(s => s.activeRing);
  const colorModes = useShopStore(s => s.colorModes);
  const showOwnSkins = useUserSettingsStore(s => s.showOwnSkins !== false);
  const showOthersSkins = useUserSettingsStore(s => s.showOthersSkins !== false);
  const othersSkinColor = useUserSettingsStore(s => s.othersSkinColor);
  const [remoteRing, setRemoteRing] = React.useState<{ userId: string; id: string } | null>(null);
  // Закреплённая музыка чужого профиля: свежие id берём с сервера, чтобы
  // мини-плеер был виден другим (снапшот из сообщения может быть устаревшим).
  const [remotePinned, setRemotePinned] = React.useState<{ userId: string; playlistId: string | null; trackId: string | null } | null>(null);
  // Экипированный питомец чужого профиля — публичное поле из GET /api/users/:id.
  const [remotePet, setRemotePet] = React.useState<{ id: string; settings?: { size?: number } } | null>(null);
  const myPet = usePetStore((s) => s.equippedPet);
  React.useEffect(() => {
    setRemoteRing(null);
    setRemotePinned(null);
    setRemotePet(null);
    if (!open || !user || isMe) return;
    let cancelled = false;
    const userId = user.id;
    usersApi.getById(userId).then(({ data }) => {
      if (cancelled) return;
      setRemoteRing({ userId, id: data.activeRing || '' });
      setRemotePet(data.equippedPet || null);
      setRemotePinned({
        userId,
        playlistId: data.pinnedPlaylistId ?? null,
        trackId: data.pinnedTrackId ?? null,
      });
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
  // «Настройки отображения»: скрытые скины не показываем и в карточке профиля.
  const ringShown = isMe ? showOwnSkins : showOthersSkins;
  const ringSx = ringShown && ringItem && !ringItem.stock
    ? skinColors(buildShopRingSx(ringItem.value, accent, false, 4), ringItem, accent, isMe ? colorModes[ringItem.id] === 'theme' : othersSkinColor !== 'stock')
    : {};
  const isBannerVideo = !!custom?.bannerUrl && (/^data:video\//i.test(custom.bannerUrl) || /\.(mp4|webm|mov)$/i.test(custom.bannerUrl));
  const banner = custom?.bannerUrl && !isBannerVideo
    ? `url(${custom.bannerUrl}) center/cover`
    : `linear-gradient(135deg, ${custom?.bannerColor || accent}, ${accent})`;
  const ic = (I: any) => <I sx={{ fontSize: 20, color: theme.textSec, mt: 0.2 }} />;

  async function handleMessage() {
    // Как в Telegram: открываем личку, а на сервере она появится с первым сообщением.
    const chat = useChatStore.getState().openDirectDraft(user!);
    setActiveChat(chat);
    navigate(`/chat/${chat.id}`);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" PaperProps={{
      sx: {
        bgcolor: theme.bgChat, color: theme.text, borderRadius: 3, overflow: 'hidden', position: 'relative',
        // Прокручивается содержимое, а не рамка: кнопка закрытия всегда на виду.
        display: 'flex', flexDirection: 'column',
        // На телефоне профиль занимает почти весь экран и не вылезает за края.
        m: { xs: 1.5, sm: 4 },
        width: { xs: 'calc(100% - 24px)', sm: 'calc(100% - 64px)' },
        maxHeight: {
          xs: 'calc(100% - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
          sm: 'calc(100% - 64px)',
        },
      },
    }}>
      <IconButton onClick={onClose} aria-label="Закрыть профиль" sx={{
        position: 'absolute', top: 8, right: 8, zIndex: 2, color: '#fff',
        bgcolor: 'rgba(0,0,0,0.35)', '&:hover': { bgcolor: 'rgba(0,0,0,0.55)' },
      }}><Close /></IconButton>
      {/* Тело профиля: всё ниже кнопки закрытия скроллится внутри карточки. */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
      <Box sx={{ position: 'relative', height: { xs: 96, sm: 140 }, background: banner, overflow: 'hidden' }}>
        {isBannerVideo && (
          <video src={custom.bannerUrl} autoPlay loop muted playsInline
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
      </Box>
      {/* Питомец выглядывает из-за правого края с наклоном к профилю на 45°. */}
      {(() => {
        const peek = isMe ? myPet : (remotePet?.id ? remotePet : null);
        if (!peek) return null;
        const peekSize = peek.settings?.size || 72;
        return (
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              right: -Math.round(peekSize * 0.35),
              top: '46%',
              transform: 'translateY(-50%)',
              zIndex: 1,
              pointerEvents: 'none',
              animation: 'veraPetPeekIn .7s ease both, veraPetPeekSway 4s ease-in-out .7s infinite',
              '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
            }}
          >
            <Box sx={{ transform: 'rotate(-45deg)', transformOrigin: 'center' }}>
              <PetArtwork petId={peek.id} size={peekSize} />
            </Box>
          </Box>
        );
      })()}
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: { xs: -5, sm: -7 }, px: { xs: 2, sm: 3 } }}>
        <Avatar src={user.avatarUrl || undefined} sx={{
          width: { xs: 80, sm: 112 }, height: { xs: 80, sm: 112 }, fontSize: { xs: 30, sm: 40 }, ...avatarFillSx,
          border: `4px solid ${theme.bgChat}`, boxShadow: `0 0 24px ${accent}70`,
          ...ringSx,
        }}>{initials(displayName)}</Avatar>
        <Typography sx={{ mt: { xs: 1, sm: 1.5 }, fontSize: { xs: 19, sm: 22 }, fontWeight: 700, color: theme.text, textAlign: 'center' }}>{displayName}</Typography>
        <Typography sx={{ fontSize: 14, color: accent }}>@{user.username}</Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <Chip size="small" label={isOnline ? 'В сети' : 'Не в сети'} sx={{
            bgcolor: (isOnline ? theme.online : theme.textSec) + '22', color: theme.text,
          }} />
        </Stack>
        <ActivityLine userId={user.id} />
        <ProfilePinnedPlaylistBar
          ownerId={user.id}
          pinnedPlaylistId={isMe
            ? user.pinnedPlaylistId
            : remotePinned?.userId === user.id ? remotePinned.playlistId : user.pinnedPlaylistId}
          pinnedTrackId={isMe
            ? user.pinnedTrackId
            : remotePinned?.userId === user.id ? remotePinned.trackId : user.pinnedTrackId}
        />
      </Box>
      <Box sx={{ px: { xs: 2, sm: 3 }, py: { xs: 1.5, sm: 2 } }}>
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
            sx={{ bgcolor: accent, '&:hover': { bgcolor: accent + 'CC' }, borderRadius: 2.5, fontSize: { xs: 14, sm: 15 }, py: { xs: 0.9, sm: 1.2 }, textTransform: 'none', mt: 1, whiteSpace: 'nowrap' }}>
            Написать сообщение
          </Button>
        )}
      </Box>
      <Divider sx={{ borderColor: theme.border }} />
      {!isMe && <Button fullWidth color="error" onClick={() => setReportOpen(true)} sx={{ py: { xs: 0.75, sm: 1 } }}>Пожаловаться</Button>}
      {reportOpen && <ReportUserDialog key={user.id} targetId={user.id} onClose={() => setReportOpen(false)} onSent={() => {
        setReportOpen(false); setToast({ message: 'Жалоба отправлена администрации', severity: 'success' });
      }} />}
      <Box sx={{ px: { xs: 2, sm: 3 }, pb: { xs: 2, sm: 3 } }}>
        <ProfileCommentsWall targetUserId={user.id} targetUserName={displayName} />
      </Box>
      </Box>
      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={toast?.severity || 'info'} sx={{ bgcolor: theme.bgHeader, color: theme.text, border: `1px solid ${theme.border}` }}>
          {toast?.message}
        </Alert>
      </Snackbar>
    </Dialog>
  );
}
