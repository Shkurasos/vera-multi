import React from 'react';
import { Box, Avatar, Typography, TextField, IconButton, Stack, Tooltip } from '@mui/material';
import { Delete, Send } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import api from '../services/api';
import { getSocket } from '../services/socket';

export interface ProfileComment {
  id: string;
  targetUserId: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string | null;
  text: string;
  ts: number;
}

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}с назад`;
  if (s < 3600) return `${Math.floor(s / 60)}м назад`;
  if (s < 86400) return `${Math.floor(s / 3600)}ч назад`;
  return new Date(ts).toLocaleDateString();
}

interface Props {
  targetUserId: string;
  targetUserName?: string;
}

/**
 * Steam-style стена комментариев. Хранение серверное:
 * GET/POST/DELETE /api/users/:id/comments. Обновления в реальном времени —
 * по сокету profileComment:new / profileComment:deleted.
 */
export default function ProfileCommentsWall({ targetUserId, targetUserName }: Props) {
  const { theme } = useThemeStore();
  const { user: me } = useAuthStore();
  const [items, setItems] = React.useState<ProfileComment[]>([]);
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const reload = React.useCallback(() => {
    api.get<ProfileComment[]>(`/users/${targetUserId}/comments`)
      .then((r) => setItems(Array.isArray(r.data) ? r.data : []))
      .catch(() => setItems([]));
  }, [targetUserId]);

  React.useEffect(() => { reload(); }, [reload]);

  React.useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onNew = (c: ProfileComment) => {
      if (c.targetUserId !== targetUserId) return;
      setItems((prev) => (prev.some((x) => x.id === c.id) ? prev : [c, ...prev]));
    };
    const onDel = ({ id, targetUserId: t }: { id: string; targetUserId: string }) => {
      if (t !== targetUserId) return;
      setItems((prev) => prev.filter((x) => x.id !== id));
    };
    s.on('profileComment:new', onNew);
    s.on('profileComment:deleted', onDel);
    return () => {
      s.off('profileComment:new', onNew);
      s.off('profileComment:deleted', onDel);
    };
  }, [targetUserId]);

  const canDelete = (c: ProfileComment) => !!me && (c.authorId === me.id || targetUserId === me.id);

  async function submit() {
    const t = text.trim();
    if (!t || !me) return;
    setBusy(true);
    try {
      const r = await api.post<ProfileComment>(`/users/${targetUserId}/comments`, { text: t });
      setText('');
      setItems((prev) => (prev.some((x) => x.id === r.data.id) ? prev : [r.data, ...prev]));
    } catch {
      // тихо: серверная ошибка не критична для UI
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.delete(`/users/${targetUserId}/comments/${id}`);
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch {}
  }

  return (
    <Box sx={{ mt: 3 }}>
      <Typography sx={{ fontSize: 15, fontWeight: 700, color: theme.text, mb: 1.5 }}>
        Стена комментариев{targetUserName ? ` · ${targetUserName}` : ''}
      </Typography>

      {me && (
        <Box sx={{
          display: 'flex', gap: 1, alignItems: 'flex-start',
          bgcolor: theme.bgHeader, border: `1px solid ${theme.border}`,
          borderRadius: 2, p: 1.25, mb: 2,
        }}>
          <Avatar src={me.avatarUrl || undefined} sx={{ width: 34, height: 34, bgcolor: theme.accent + '80' }}>
            {(me.firstName || me.username || '?')[0]}
          </Avatar>
          <TextField
            fullWidth multiline minRows={1} maxRows={4} size="small"
            placeholder="Оставить комментарий…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }}
            InputProps={{ sx: { color: theme.text, fontSize: 14 } }}
          />
          <IconButton onClick={submit} disabled={busy || !text.trim()} sx={{ color: theme.accent }}>
            <Send fontSize="small" />
          </IconButton>
        </Box>
      )}

      {items.length === 0 && (
        <Typography sx={{ color: theme.textSec, fontSize: 13, textAlign: 'center', py: 3 }}>
          Пока никто не оставил комментариев.
        </Typography>
      )}

      <Stack spacing={1}>
        {items.map((c) => (
          <Box key={c.id} sx={{
            display: 'flex', gap: 1.25, p: 1.25, borderRadius: 2,
            bgcolor: theme.bgHeader, border: `1px solid ${theme.border}`,
          }}>
            <Avatar src={c.authorAvatar || undefined} sx={{ width: 34, height: 34, bgcolor: theme.accent + '60' }}>
              {(c.authorName || '?')[0]}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: theme.text }}>{c.authorName}</Typography>
                <Typography sx={{ fontSize: 11, color: theme.textSec }}>{timeAgo(c.ts)}</Typography>
              </Box>
              <Typography sx={{ fontSize: 14, color: theme.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {c.text}
              </Typography>
            </Box>
            {canDelete(c) && (
              <Tooltip title="Удалить">
                <IconButton size="small" onClick={() => remove(c.id)} sx={{ color: theme.textSec, alignSelf: 'flex-start' }}>
                  <Delete fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
