import React from 'react';
import { Box, Avatar, Typography, TextField, Button, IconButton, Stack, Tooltip } from '@mui/material';
import { Delete, Send } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { addComment, deleteComment, listComments, ProfileComment } from '../services/profileCommentsStorage';

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
 * Steam-style стена комментариев. Хранение локальное (IndexedDB) — синк по P2P
 * запланирован отдельно и подключается сверху без изменения UI.
 */
export default function ProfileCommentsWall({ targetUserId, targetUserName }: Props) {
  const { theme } = useThemeStore();
  const { user: me } = useAuthStore();
  const [items, setItems] = React.useState<ProfileComment[]>([]);
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const reload = React.useCallback(() => {
    listComments(targetUserId).then(setItems).catch(() => setItems([]));
  }, [targetUserId]);

  React.useEffect(() => { reload(); }, [reload]);

  const canDelete = (c: ProfileComment) => !!me && (c.authorId === me.id || targetUserId === me.id);

  async function submit() {
    const t = text.trim();
    if (!t || !me) return;
    setBusy(true);
    try {
      await addComment({
        targetUserId,
        authorId: me.id,
        authorName: [me.firstName, me.lastName].filter(Boolean).join(' ') || me.username,
        authorAvatar: me.avatarUrl,
        text: t,
      });
      setText('');
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await deleteComment(id);
    reload();
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

      <Typography sx={{ mt: 1.5, fontSize: 11, color: theme.textSec, textAlign: 'center' }}>
        Комментарии хранятся локально на этом устройстве. Синхронизация по P2P — в разработке.
      </Typography>
    </Box>
  );
}
