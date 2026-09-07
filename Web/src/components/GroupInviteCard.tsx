import React, { useState } from 'react';
import { Box, Avatar, Typography, Button, CircularProgress } from '@mui/material';
import { Groups } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import { chatsApi } from '../services/api';
import { useNavigate } from 'react-router-dom';

export interface GroupInvitePayload {
  token: string;
  groupId: string;
  groupName: string;
  inviterId: string;
  inviterName: string;
  inviteeId: string;
  state: 'pending' | 'accepted' | 'declined';
}

function parsePayload(attachment: any): GroupInvitePayload | null {
  const raw = attachment?.data;
  if (!raw) return null;
  try {
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!p || !p.token || !p.groupId) return null;
    return {
      token: String(p.token),
      groupId: String(p.groupId),
      groupName: String(p.groupName || 'Группа'),
      inviterId: String(p.inviterId || ''),
      inviterName: String(p.inviterName || ''),
      inviteeId: String(p.inviteeId || ''),
      state: (p.state === 'accepted' || p.state === 'declined') ? p.state : 'pending',
    };
  } catch { return null; }
}

export default function GroupInviteCard({ attachment }: { attachment: any }) {
  const { theme } = useThemeStore();
  const { user } = useAuthStore();
  const { loadChats } = useChatStore();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const payload = parsePayload(attachment);

  if (!payload) return null;

  const isInvitee = user?.id === payload.inviteeId;
  const canRespond = isInvitee && payload.state === 'pending';

  async function accept() {
    if (!payload) return;
    setBusy(true);
    try {
      await chatsApi.acceptInvite(payload.token);
      await loadChats();
      navigate(`/chat/${payload.groupId}`);
    } catch (e) { console.error(e); }
    finally { setBusy(false); }
  }

  async function decline() {
    if (!payload) return;
    setBusy(true);
    try { await chatsApi.declineInvite(payload.token); }
    catch (e) { console.error(e); }
    finally { setBusy(false); }
  }

  const stateLabel = payload.state === 'accepted'
    ? 'Приглашение принято'
    : payload.state === 'declined'
    ? 'Приглашение отклонено'
    : null;

  return (
    <Box sx={{
      mt: 0.75, p: 1.25, borderRadius: 2,
      border: `1px solid ${theme.border}`,
      bgcolor: theme.bgHover,
      minWidth: 240, maxWidth: 320,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <Avatar sx={{ width: 40, height: 40, bgcolor: theme.accent + '55' }}>
          <Groups sx={{ color: theme.accent }} />
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: theme.text, lineHeight: 1.3 }} noWrap>
            {payload.groupName}
          </Typography>
          <Typography sx={{ fontSize: 12, color: theme.textSec }} noWrap>
            Пригласил: {payload.inviterName}
          </Typography>
        </Box>
      </Box>
      {stateLabel ? (
        <Typography sx={{ mt: 1, fontSize: 12, color: theme.textSec, fontStyle: 'italic' }}>
          {stateLabel}
        </Typography>
      ) : canRespond ? (
        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          <Button
            size="small"
            variant="contained"
            disabled={busy}
            onClick={accept}
            sx={{
              flex: 1, textTransform: 'none', fontSize: 13,
              bgcolor: theme.accent, '&:hover': { bgcolor: theme.accent },
            }}
          >
            {busy ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : 'Принять'}
          </Button>
          <Button
            size="small"
            variant="outlined"
            disabled={busy}
            onClick={decline}
            sx={{
              flex: 1, textTransform: 'none', fontSize: 13,
              color: theme.textSec, borderColor: theme.border,
            }}
          >
            Отклонить
          </Button>
        </Box>
      ) : (
        <Typography sx={{ mt: 1, fontSize: 12, color: theme.textSec, fontStyle: 'italic' }}>
          Ожидает ответа
        </Typography>
      )}
    </Box>
  );
}