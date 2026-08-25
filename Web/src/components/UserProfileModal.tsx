import React from 'react';
import {
  Box, Avatar, Typography, IconButton, Dialog,
  Divider, Button, Stack, Chip, Snackbar, Alert,
} from '@mui/material';
import { Close, Phone, Info, Cake, LocationOn, Message, Star, ThumbUp, RemoveCircleOutline, Report } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { ReputationVoteValue, User, UserReputationSummary } from '../types';
import { useNavigate } from 'react-router-dom';
import { chatsApi, usersApi } from '../services/api';
import { useChatStore } from '../store/chatStore';
import { useAuthStore } from '../store/authStore';

function getInitials(name: string): string {
  if (!name) return '?';
  return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

interface Props {
  user: User | null;
  open: boolean;
  onClose: () => void;
}

export default function UserProfileModal({ user, open, onClose }: Props) {
  const { theme } = useThemeStore();
  const navigate = useNavigate();
  const { setActiveChat, loadChats, onlineUsers } = useChatStore();
  const { user: me } = useAuthStore();
  const [reputation, setReputation] = React.useState<UserReputationSummary | null>(null);
  const [ratingBusy, setRatingBusy] = React.useState(false);
  const [toast, setToast] = React.useState<{ message: string; severity: 'success' | 'error' | 'info' } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    if (!open || !user?.id) return;
    usersApi.getReputation(user.id)
      .then((res) => { if (!cancelled) setReputation(res.data); })
      .catch(() => { if (!cancelled) setReputation(null); });
    return () => { cancelled = true; };
  }, [open, user?.id]);

  if (!user) return null;

  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.username;

  async function handleRate(value: ReputationVoteValue) {
    if (!user || user.id === me?.id) return;
    const previous = reputation;
    const currentVote = reputation?.myVote ?? null;
    if (currentVote === value) {
      setToast({ message: 'Эта оценка уже выбрана', severity: 'info' });
      return;
    }

    // Мгновенно подсвечиваем выбранную кнопку, чтобы клик сразу был заметен.
    setReputation({
      userId: user.id,
      reputationScore: reputation?.reputationScore ?? user.reputationScore ?? 0,
      successfulDialogsCount: reputation?.successfulDialogsCount ?? user.successfulDialogsCount ?? 0,
      complaintsCount: reputation?.complaintsCount ?? user.complaintsCount ?? 0,
      positiveRatingsCount: reputation?.positiveRatingsCount ?? 0,
      neutralRatingsCount: reputation?.neutralRatingsCount ?? 0,
      negativeRatingsCount: reputation?.negativeRatingsCount ?? 0,
      communityTrustScore: reputation?.communityTrustScore ?? user.communityTrustScore ?? 0,
      myVote: value,
    });
    try {
      setRatingBusy(true);
      const res = await usersApi.rateUser(user.id, value);
      setReputation(res.data);
      setToast({ message: 'Оценка сохранена', severity: 'success' });
    } catch (e) {
      console.error(e);
      setReputation(previous);
      setToast({ message: 'Не удалось сохранить оценку. Проверьте, запущен ли сервер.', severity: 'error' });
    } finally {
      setRatingBusy(false);
    }
  }

  async function handleMessage() {
    try {
      const res = await chatsApi.createDirect(user!.id);
      await loadChats();
      setActiveChat(res.data);
      navigate(`/chat/${res.data.id}`);
      onClose();
    } catch (e) { console.error(e); }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: theme.bgHeader,
          border: `1px solid ${theme.border}`,
          borderRadius: 3,
          overflow: 'hidden',
        },
      }}
    >
      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={3000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert onClose={() => setToast(null)} severity={toast?.severity || 'info'} variant="filled">
          {toast?.message || ''}
        </Alert>
      </Snackbar>

      {/* Header gradient */}
      <Box sx={{
        background: `linear-gradient(135deg, ${theme.accent}40, ${theme.bgHeader})`,
        pt: 4, pb: 3,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5,
        position: 'relative',
      }}>
        <IconButton
          onClick={onClose}
          size="small"
          sx={{ position: 'absolute', top: 8, right: 8, color: theme.textSec }}
        >
          <Close sx={{ fontSize: 20 }} />
        </IconButton>

        <Avatar
          src={user.avatarUrl || undefined}
          sx={{
            width: 90, height: 90, fontSize: 32,
            bgcolor: theme.accent,
            border: `3px solid ${theme.accent}`,
            boxShadow: `0 0 20px ${theme.accent}60`,
          }}
        >
          {getInitials(displayName)}
        </Avatar>

        <Box textAlign="center">
          <Typography sx={{ fontSize: 22, fontWeight: 700, color: theme.text }}>
            {displayName}
          </Typography>
          <Typography sx={{ fontSize: 15, color: theme.accent }}>
            @{user.username}
          </Typography>
          <Typography sx={{
            fontSize: 14, mt: 0.5,
            color: onlineUsers.has(user.id) ? theme.online : theme.textSec,
          }}>
            {onlineUsers.has(user.id) ? '● в сети' : '○ не в сети'}
          </Typography>
        </Box>
      </Box>

      <Divider sx={{ borderColor: theme.border }} />

      {/* Info */}
      <Box sx={{ px: 3, py: 2 }}>

        <Box sx={{
          p: 2, mb: 2, borderRadius: 2.5,
          bgcolor: theme.bg,
          border: `1px solid ${theme.border}`,
        }}>
          <Box display="flex" alignItems="center" gap={1} mb={1.5}>
            <Star sx={{ fontSize: 20, color: theme.accent }} />
            <Typography sx={{ fontSize: 15, color: theme.text, fontWeight: 700 }}>
              Reputation: {reputation?.reputationScore ?? user.reputationScore ?? 0}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap mb={user.id !== me?.id ? 1.5 : 0}>
            <Chip size="small" label={`Success: ${reputation?.successfulDialogsCount ?? user.successfulDialogsCount ?? 0}`} sx={{ bgcolor: `${theme.online}22`, color: theme.text }} />
            <Chip size="small" label={`Complaints: ${reputation?.complaintsCount ?? user.complaintsCount ?? 0}`} sx={{ bgcolor: '#ff525222', color: theme.text }} />
            <Chip size="small" label={`Trust: ${reputation?.communityTrustScore ?? user.communityTrustScore ?? 0}`} sx={{ bgcolor: `${theme.accent}22`, color: theme.text }} />
          </Stack>
          {user.id !== me?.id && (
            <Stack direction="row" spacing={1}>
              <Button size="small" disabled={ratingBusy} variant={reputation?.myVote === 'positive' ? 'contained' : 'outlined'} startIcon={<ThumbUp />} onClick={() => handleRate('positive')} sx={{ textTransform: 'none' }}>Good</Button>
              <Button size="small" disabled={ratingBusy} variant={reputation?.myVote === 'neutral' ? 'contained' : 'outlined'} startIcon={<RemoveCircleOutline />} onClick={() => handleRate('neutral')} sx={{ textTransform: 'none' }}>Neutral</Button>
              <Button size="small" disabled={ratingBusy} color="error" variant={reputation?.myVote === 'negative' ? 'contained' : 'outlined'} startIcon={<Report />} onClick={() => handleRate('negative')} sx={{ textTransform: 'none' }}>Report</Button>
            </Stack>
          )}
        </Box>

        {user.bio && (
          <Box display="flex" alignItems="flex-start" gap={1.5} mb={2}>
            <Info sx={{ fontSize: 20, color: theme.textSec, mt: 0.2 }} />
            <Box>
              <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.3 }}>О себе</Typography>
              <Typography sx={{ fontSize: 15, color: theme.text, whiteSpace: 'pre-wrap' }}>{user.bio}</Typography>
            </Box>
          </Box>
        )}

        {user.phone && (
          <Box display="flex" alignItems="flex-start" gap={1.5} mb={2}>
            <Phone sx={{ fontSize: 20, color: theme.textSec, mt: 0.2 }} />
            <Box>
              <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.3 }}>Телефон</Typography>
              <Typography sx={{ fontSize: 15, color: theme.text }}>{user.phone}</Typography>
            </Box>
          </Box>
        )}

        {user.birthDate && (
          <Box display="flex" alignItems="flex-start" gap={1.5} mb={2}>
            <Cake sx={{ fontSize: 20, color: theme.textSec, mt: 0.2 }} />
            <Box>
              <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.3 }}>День рождения</Typography>
              <Typography sx={{ fontSize: 15, color: theme.text }}>{user.birthDate}</Typography>
            </Box>
          </Box>
        )}

        {(user.city || user.country) && (
          <Box display="flex" alignItems="flex-start" gap={1.5} mb={2}>
            <LocationOn sx={{ fontSize: 20, color: theme.textSec, mt: 0.2 }} />
            <Box>
              <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.3 }}>Местоположение</Typography>
              <Typography sx={{ fontSize: 15, color: theme.text }}>
                {[user.city, user.region, user.country].filter(Boolean).join(', ')}
              </Typography>
            </Box>
          </Box>
        )}
      </Box>

      <Divider sx={{ borderColor: theme.border }} />

      <Box sx={{ px: 3, py: 2 }}>
        <Button
          fullWidth
          variant="contained"
          startIcon={<Message />}
          onClick={handleMessage}
          sx={{
            bgcolor: theme.accent,
            '&:hover': { bgcolor: theme.accent + 'CC' },
            borderRadius: 2.5,
            fontSize: 15,
            py: 1.2,
            textTransform: 'none',
          }}
        >
          Написать сообщение
        </Button>
      </Box>
    </Dialog>
  );
}
