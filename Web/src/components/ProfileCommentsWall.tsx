import React from 'react';
import { Box, Avatar, Typography, TextField, IconButton, Stack, Tooltip } from '@mui/material';
import { Delete, Send, ThumbUpAlt, ThumbDownAlt, ThumbUpOffAlt, ThumbDownOffAlt } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { UI_PROFILE_INNER_RADIUS } from '../store/uiPrefsStore';
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
  likes?: number;
  dislikes?: number;
  myVote?: 'like' | 'dislike' | null;
}

type CommentSort = 'new' | 'old' | 'likes';

function scoreOf(c: ProfileComment): number {
  return (c.likes || 0) - (c.dislikes || 0);
}

function sortComments(items: ProfileComment[], sort: CommentSort): ProfileComment[] {
  const copy = [...items];
  if (sort === 'old') return copy.sort((a, b) => a.ts - b.ts);
  if (sort === 'likes') return copy.sort((a, b) => scoreOf(b) - scoreOf(a) || b.ts - a.ts);
  return copy.sort((a, b) => b.ts - a.ts);
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
 * GET/POST/DELETE /api/users/:id/comments, голос — POST .../vote.
 * Обновления в реальном времени — profileComment:new / :deleted / :voted.
 */
export default function ProfileCommentsWall({ targetUserId, targetUserName }: Props) {
  const { theme } = useThemeStore();
  const { user: me } = useAuthStore();
  const [items, setItems] = React.useState<ProfileComment[]>([]);
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [sort, setSort] = React.useState<CommentSort>('new');
  const shown = React.useMemo(() => sortComments(items, sort), [items, sort]);

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
    const onVote = (v: { id: string; targetUserId: string; likes: number; dislikes: number; myVote: ProfileComment['myVote']; voterId: string }) => {
      if (v.targetUserId !== targetUserId) return;
      setItems((prev) => prev.map((x) => (
        x.id === v.id
          ? { ...x, likes: v.likes, dislikes: v.dislikes, myVote: v.voterId === me?.id ? v.myVote : x.myVote }
          : x
      )));
    };
    s.on('profileComment:new', onNew);
    s.on('profileComment:deleted', onDel);
    s.on('profileComment:voted', onVote);
    return () => {
      s.off('profileComment:new', onNew);
      s.off('profileComment:deleted', onDel);
      s.off('profileComment:voted', onVote);
    };
  }, [targetUserId, me?.id]);

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

  async function vote(c: ProfileComment, value: 'like' | 'dislike') {
    if (!me) return;
    const next = c.myVote === value ? null : value;
    const likes = (c.likes || 0) - (c.myVote === 'like' ? 1 : 0) + (next === 'like' ? 1 : 0);
    const dislikes = (c.dislikes || 0) - (c.myVote === 'dislike' ? 1 : 0) + (next === 'dislike' ? 1 : 0);
    setItems((prev) => prev.map((x) => (x.id === c.id ? { ...x, likes, dislikes, myVote: next } : x)));
    try {
      const r = await api.post<{ likes: number; dislikes: number; myVote: ProfileComment['myVote'] }>(
        `/users/${targetUserId}/comments/${c.id}/vote`,
        { value },
      );
      setItems((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...r.data } : x)));
    } catch {
      reload();
    }
  }

  return (
    <Box sx={{ mt: { xs: 2, sm: 3 } }}>
      <Typography sx={{ fontSize: { xs: 14, sm: 15 }, fontWeight: 700, color: theme.text, mb: { xs: 1, sm: 1.5 } }}>
        Стена комментариев{targetUserName ? ` · ${targetUserName}` : ''}
      </Typography>

      {me && (
        <Box sx={{
          display: 'flex', gap: 0.75, alignItems: 'flex-end',
          bgcolor: theme.bgHeader, border: `1px solid ${theme.border}`,
          borderRadius: UI_PROFILE_INNER_RADIUS, p: { xs: 1, sm: 1.25 }, mb: { xs: 1.5, sm: 2 },
        }}>
          <Avatar 
            src={me.avatarUrl || undefined} 
            sx={{ 
              width: { xs: 32, sm: 40 }, 
              height: { xs: 32, sm: 40 }, 
              flexShrink: 0,
              bgcolor: theme.accent + '80',
            }}
          >
            {(me.username || '?')[0]}
          </Avatar>
          <TextField
            fullWidth 
            multiline 
            minRows={1} 
            maxRows={4} 
            size="small"
            placeholder="Оставить комментарий…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }}
            sx={{
              flex: 1,
              minWidth: 0,
              '& .MuiOutlinedInput-root': {
                backgroundColor: theme.bg,
                color: theme.text,
                fontSize: 14,
                borderRadius: UI_PROFILE_INNER_RADIUS,
                '& fieldset': { borderColor: theme.border },
                '&:hover fieldset': { borderColor: theme.textSec + '80' },
                '&.Mui-focused fieldset': { borderColor: theme.accent },
                '& textarea::placeholder': { color: theme.textSec, opacity: 1 },
              },
            }}
          />
          <IconButton 
            onClick={submit} 
            disabled={busy || !text.trim()} 
            sx={{ 
              color: theme.accent,
              flexShrink: 0,
              alignSelf: 'flex-end',
              width: 34,
              height: 34,
              '&.Mui-disabled': { color: theme.textSec + '55' },
            }}
          >
            <Send sx={{ fontSize: 20 }} />
          </IconButton>
        </Box>
      )}

      {items.length > 1 && (
        <Box sx={{ display: 'flex', gap: 0.5, mb: 1.5, flexWrap: 'wrap' }}>
          {([
            ['new', 'Новые'],
            ['old', 'Старые'],
            ['likes', 'По лайкам'],
          ] as const).map(([key, label]) => (
            <Box
              key={key}
              component="button"
              type="button"
              onClick={() => setSort(key)}
              sx={{
                border: `1px solid ${sort === key ? theme.accent : theme.border}`,
                bgcolor: sort === key ? theme.accent + '22' : 'transparent',
                color: sort === key ? theme.accent : theme.textSec,
                borderRadius: 99,
                px: 1.25,
                py: 0.35,
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {label}
            </Box>
          ))}
        </Box>
      )}

      {items.length === 0 && (
        <Typography sx={{ color: theme.textSec, fontSize: 13, textAlign: 'center', py: 3 }}>
          Пока никто не оставил комментариев.
        </Typography>
      )}

      <Stack spacing={1.5}>
        {shown.map((c) => (
          <Box key={c.id} sx={{
            display: 'flex', 
            gap: 1.25, 
            p: 1.25, 
            borderRadius: UI_PROFILE_INNER_RADIUS,
            bgcolor: theme.bgHeader, 
            border: `1px solid ${theme.border}`,
            alignItems: 'flex-start',
          }}>
            <Avatar 
              src={c.authorAvatar || undefined} 
              sx={{ 
                width: 34, 
                height: 34, 
                flexShrink: 0,
                bgcolor: theme.accent + '60',
              }}
            >
              {(c.authorName || '?')[0]}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Typography sx={{ 
                  fontSize: 13, 
                  fontWeight: 700, 
                  color: theme.text,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {c.authorName}
                </Typography>
                <Typography sx={{ 
                  fontSize: 11, 
                  color: theme.textSec,
                  flexShrink: 0,
                }}>
                  {timeAgo(c.ts)}
                </Typography>
              </Box>
              <Typography sx={{ 
                fontSize: 14, 
                color: theme.text, 
                whiteSpace: 'pre-wrap', 
                wordBreak: 'break-word',
                overflowWrap: 'break-word',
              }}>
                {c.text}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, mt: 0.5, ml: -0.75 }}>
                <Tooltip title={c.myVote === 'like' ? 'Убрать лайк' : 'Лайк'}>
                  <IconButton size="small" onClick={() => vote(c, 'like')} sx={{ color: c.myVote === 'like' ? theme.accent : theme.textSec }}>
                    {c.myVote === 'like' ? <ThumbUpAlt sx={{ fontSize: 16 }} /> : <ThumbUpOffAlt sx={{ fontSize: 16 }} />}
                  </IconButton>
                </Tooltip>
                <Typography sx={{ fontSize: 12, color: theme.textSec, minWidth: 12 }}>{c.likes || 0}</Typography>
                <Tooltip title={c.myVote === 'dislike' ? 'Убрать дизлайк' : 'Дизлайк'}>
                  <IconButton size="small" onClick={() => vote(c, 'dislike')} sx={{ color: c.myVote === 'dislike' ? '#e57373' : theme.textSec }}>
                    {c.myVote === 'dislike' ? <ThumbDownAlt sx={{ fontSize: 16 }} /> : <ThumbDownOffAlt sx={{ fontSize: 16 }} />}
                  </IconButton>
                </Tooltip>
                <Typography sx={{ fontSize: 12, color: theme.textSec, minWidth: 12 }}>{c.dislikes || 0}</Typography>
              </Box>
            </Box>
            {canDelete(c) && (
              <Tooltip title="Удалить">
                <IconButton 
                  size="small" 
                  onClick={() => remove(c.id)} 
                  sx={{ 
                    color: theme.textSec, 
                    flexShrink: 0,
                    mt: -0.5,
                  }}
                >
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
