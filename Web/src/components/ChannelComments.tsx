import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Typography, Box, Alert } from '@mui/material';
import { messagesApi } from '../services/api';
import { Message } from '../types';
import { useChatStore } from '../store/chatStore';
import { useAuthStore } from '../store/authStore';
import { hasGroupRight } from '../services/groupPermissions';
import { useThemeStore } from '../store/themeStore';

export default function ChannelComments({ post }: { post: Message }) {
  const theme = useThemeStore(s => s.theme);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [reply, setReply] = useState<Message | null>(null);
  const [reactionBusy, setReactionBusy] = useState<string | null>(null);
  const [reactionPicker, setReactionPicker] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pending = post.id.startsWith('temp-');
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [comments, setComments] = useState<Message[]>([]);
  const live = useChatStore(s => s.messages[post.chatId]);
  const userId = useAuthStore(s => s.user?.id);
  const member = useChatStore(s => s.chats.find(c => c.id === post.chatId)?.members.find(m => m.userId === userId));
  const author = (m: Message) => m.sender?.firstName || m.sender?.username || 'Пользователь';
  async function react(message: Message, emoji: string) {
    if (reactionBusy) return;
    setReactionBusy(message.id); setError('');
    try {
      const { data } = await messagesApi.addReaction(post.chatId, message.id, emoji);
      setComments(current => current.map(m => m.id === message.id ? { ...m, reactions: data.reactions } : m));
      setReactionPicker(null);
    } catch { setError('Не удалось изменить реакцию'); }
    finally { setReactionBusy(null); }
  }
  async function moderate(message: Message, remove: boolean) {
    try {
      if (remove) {
        await messagesApi.delete(message.id);
        useChatStore.getState().removeMessage(message.id, post.chatId);
        setComments(current => current.filter(m => m.id !== message.id));
        if (reply?.id === message.id) setReply(null);
      } else {
        const value = window.prompt('Редактировать комментарий', message.content || '');
        if (value === null) return;
        const result = await messagesApi.edit(message.id, value);
        useChatStore.getState().updateMessage(result.data);
        setComments(current => current.map(m => m.id === message.id ? result.data : m));
      }
    } catch (e: any) { setError(e.response?.data?.message || 'Не удалось изменить комментарий'); }
  }
  useEffect(() => {
    if (!open || pending) return;
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      try {
        const result = await messagesApi.getComments(post.chatId, post.id);
        if (!cancelled) setComments(result.data);
      } catch { if (!cancelled) setError('Не удалось загрузить комментарии'); }
      finally { if (!cancelled) setLoading(false); }
    };
    void load();
    const timer = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(timer); };
   }, [open, post.chatId, post.id, live, pending]);
  async function send() {
    if (!text.trim() || busy || pending) return;
    setBusy(true); setError('');
    try {
      const result = await messagesApi.send(post.chatId, { text: text.trim(), replyToId: post.id, commentReplyToId: reply?.id });
      useChatStore.getState().addMessage(result.data);
      setComments(current => current.some(m => m.id === result.data.id) ? current : [...current, result.data]);
      setReply(null);
      setText('');
    } catch (e: any) { setError(e.response?.data?.message || 'Не удалось отправить комментарий'); }
    finally { setBusy(false); }
  }
  return <>
    <Button
      fullWidth
      disabled={pending}
      onClick={() => setOpen(true)}
      sx={{
        display: 'flex', justifyContent: 'flex-start',
        minWidth: 0, minHeight: 44, px: '14px', py: 1,
        borderRadius: 0,
        borderBottomLeftRadius: 'inherit', borderBottomRightRadius: 'inherit',
        color: 'inherit', fontSize: 13, fontWeight: 500,
        textTransform: 'none', textAlign: 'left', overflowWrap: 'anywhere',
        '&::before': {
          content: '""', position: 'absolute', top: 0, left: 0, right: 0,
          height: '1px', bgcolor: 'currentColor', opacity: 0.18,
        },
        '&:hover': { bgcolor: 'rgba(128, 128, 128, 0.12)' },
        '&.Mui-focusVisible': { outline: '2px solid currentColor', outlineOffset: '-3px' },
        '&.Mui-disabled': { color: 'inherit', opacity: 0.5 },
      }}
    >
      {pending ? 'Публикация отправляется…' : 'Комментарии'}
    </Button>
    <Dialog onContextMenu={e => e.stopPropagation()} open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm"
      PaperProps={{ sx: {
        bgcolor: theme.bg, color: theme.text, backgroundImage: 'none', border: `1px solid ${theme.border}`,
        borderRadius: 3, m: { xs: 1, sm: 4 }, width: { xs: 'calc(100% - 16px)', sm: '100%' },
        maxHeight: 'calc(100dvh - 32px)',
        '& .MuiButton-root': { textTransform: 'none', minHeight: 36, color: theme.accent, '&:hover': { bgcolor: theme.bgHover }, '&.Mui-disabled': { color: theme.textSec, opacity: 0.6 } },
      } }}>
      <DialogTitle sx={{ bgcolor: theme.bgHeader, borderBottom: `1px solid ${theme.border}`, px: 2, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography component="span" sx={{ fontSize: 18, fontWeight: 600 }}>Комментарии</Typography>
        <Button onClick={() => setOpen(false)}>Закрыть</Button>
      </DialogTitle>
      <DialogContent sx={{ bgcolor: theme.bgChat, p: { xs: 1.5, sm: 2 }, '&:first-of-type': { pt: 2 } }}>
        <Box sx={{ p: 1.5, mb: 2, borderLeft: `3px solid ${theme.accent}`, bgcolor: theme.bgHeader, borderRadius: 1 }}>
          <Typography sx={{ color: theme.accent, fontSize: 12, mb: 0.5 }}>Публикация</Typography>
          <Typography sx={{ fontSize: 14, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 120, overflowY: 'auto' }}>{post.content || 'Публикация с вложением'}</Typography>
        </Box>
        {loading && !comments.length && <Typography role="status" sx={{ color: theme.textSec, py: 2 }}>Загрузка комментариев…</Typography>}
        {!loading && !comments.length && <Typography sx={{ color: theme.textSec, py: 2 }}>Пока нет комментариев. Напишите первым.</Typography>}
        {comments.map(m => {
          const own = m.senderId === userId;
          const quoted = comments.find(c => c.id === m.commentReplyToId);
          return <Box key={m.id} sx={{ mb: 2, minWidth: 0 }}>
            <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: theme.bgBubbleOther, color: theme.bubbleOtherText || theme.text, border: `1px solid ${theme.border}`, borderLeft: own ? `3px solid ${theme.accent}` : undefined }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 1, mb: 0.75 }}>
                <Typography sx={{ fontWeight: 600, fontSize: 14, overflowWrap: 'anywhere', flex: 1, minWidth: 0 }}>{author(m)}{own ? ' · Вы' : ''}</Typography>
                <Typography sx={{ fontSize: 11, opacity: 0.7 }}>{new Date(m.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}{m.isEdited ? ' · изменено' : ''}</Typography>
              </Box>
              {m.commentReplyToId && <Box sx={{ borderLeft: '2px solid currentColor', pl: 1, mb: 1, opacity: 0.8 }}>
                <Typography sx={{ fontSize: 12, fontWeight: 600 }}>{quoted ? `Ответ: ${author(quoted)}` : 'Ответ на удалённый комментарий'}</Typography>
                {quoted && <Typography sx={{ fontSize: 13, overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{quoted.content}</Typography>}
              </Box>}
              <Typography sx={{ fontSize: 15, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.content}</Typography>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
              {m.reactions?.map(r => <Button key={r.emoji} size="small" disabled={reactionBusy === m.id} aria-label={`Реакция ${r.emoji}: ${r.count}`} aria-pressed={r.userIds.includes(userId || '')} onClick={() => void react(m, r.emoji)} sx={{ bgcolor: r.userIds.includes(userId || '') ? theme.bgActive : theme.bgHeader, border: `1px solid ${theme.border}`, borderRadius: 5, minWidth: 48 }}>{r.emoji} {r.count}</Button>)}
              <Button size="small" disabled={busy} onClick={() => { setReply(m); inputRef.current?.focus(); }}>Ответить</Button>
              <Button size="small" aria-expanded={reactionPicker === m.id} onClick={() => setReactionPicker(reactionPicker === m.id ? null : m.id)}>Реакция</Button>
              {(own || hasGroupRight(member, 'editMessages')) && <Button size="small" onClick={() => moderate(m, false)}>Редактировать</Button>}
              {(own || hasGroupRight(member, 'deleteMessages')) && <Button size="small" onClick={() => moderate(m, true)}>Удалить</Button>}
            </Box>
            {reactionPicker === m.id && <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, p: 0.5, bgcolor: theme.bgHeader, borderRadius: 2 }}>
              {['👍', '❤️', '🔥', '😂', '😮', '😢', '🎉', '👎'].map(emoji => <Button key={emoji} disabled={!!reactionBusy} aria-label={`Поставить реакцию ${emoji}`} onClick={() => void react(m, emoji)} sx={{ minWidth: 40, minHeight: 40, fontSize: 22 }}>{emoji}</Button>)}
            </Box>}
          </Box>;
        })}
      </DialogContent>
      <DialogActions sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 1, p: 2, bgcolor: theme.bgHeader, borderTop: `1px solid ${theme.border}`, '& > :not(:first-of-type)': { ml: 0 } }}>
        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
        {reply && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, borderLeft: `3px solid ${theme.accent}`, pl: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}><Typography sx={{ color: theme.accent, fontSize: 12 }}>Ответ: {author(reply)}</Typography><Typography noWrap sx={{ fontSize: 13, color: theme.textSec }}>{reply.content}</Typography></Box>
          <Button disabled={busy} onClick={() => setReply(null)}>Отмена</Button>
        </Box>}
        <TextField inputRef={inputRef} fullWidth multiline minRows={2} maxRows={5} label={reply ? 'Ваш ответ' : 'Комментарий'} value={text} disabled={busy} onChange={e => setText(e.target.value)} inputProps={{ maxLength: 10000 }} sx={{
          '& .MuiOutlinedInput-root': { bgcolor: theme.bgInput, color: theme.text, '& fieldset': { borderColor: theme.border }, '&:hover fieldset': { borderColor: theme.accent }, '&.Mui-focused fieldset': { borderColor: theme.accent } },
          '& .MuiInputLabel-root': { color: theme.textSec }, '& .MuiInputLabel-root.Mui-focused': { color: theme.accent },
          '& .MuiInputBase-input.Mui-disabled': { WebkitTextFillColor: theme.textSec },
        }} />
        <Button sx={{ alignSelf: 'flex-end' }} disabled={busy || !text.trim() || pending} onClick={() => void send()}>{busy ? 'Отправка…' : 'Отправить'}</Button>
      </DialogActions>
    </Dialog>
  </>;
}