import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import { reportsApi, AdminChatLookup as LookupResult } from '../services/api';

const attachmentUrl = (a: any) => String(a?.fileUrl || a?.url || '');
const isImage = (a: any) => /^image\//.test(a?.mimeType || '') || /\.(png|jpe?g|gif|webp)$/i.test(attachmentUrl(a));

/**
 * Просмотр чата администратором по ссылке /#/chat/<id>: вся история,
 * включая удалённые сообщения и вложения. Каждое открытие пишется в журнал.
 * request — ссылка, открытая из жалобы; n меняется, чтобы повторное нажатие
 * на ту же ссылку тоже перезагружало чат.
 */
export default function AdminChatLookup({ request }: { request?: { link: string; n: number } | null }) {
  const [link, setLink] = useState('');
  const [data, setData] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const open = async (value: string, offset = 0) => {
    if (!value.trim()) return;
    setLoading(true);
    setError('');
    try {
      const { data: page } = await reportsApi.lookupChat(value.trim(), offset);
      setData((prev) => (offset && prev ? { ...page, messages: [...prev.messages, ...page.messages] } : page));
    } catch (e: any) {
      if (!offset) setData(null);
      setError(e.response?.data?.message || 'Не удалось открыть чат');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!request?.link) return;
    setLink(request.link);
    void open(request.link);
  }, [request?.n]);

  return (
    <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0 }}>
      <Typography variant="h6">Чат по ссылке</Typography>
      <Stack direction="row" spacing={1}>
        <TextField
          size="small" fullWidth
          label="Ссылка на чат"
          placeholder="https://…/#/chat/…"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void open(link); }}
        />
        <Button variant="contained" onClick={() => open(link)} disabled={loading || !link.trim()}>Открыть</Button>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {data && (
        <>
          <Box>
            <Typography variant="subtitle2">
              {data.chat.name || 'Личный чат'} {data.chat.type ? `· ${data.chat.type}` : ''}
              {data.chat.deleted && <Chip size="small" color="error" label="Чат удалён" sx={{ ml: 1 }} />}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Участники: {data.members.map((m) => `@${m.username}`).join(', ') || 'нет'} · Сообщений: {data.total}
            </Typography>
          </Box>
          <Stack spacing={1} sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 1, bgcolor: 'background.default', borderRadius: 1 }}>
            {data.messages.map((msg: any) => (
              <Box key={msg.id} sx={{ p: 1, bgcolor: 'background.paper', borderRadius: 1, opacity: msg.isDeleted ? 0.85 : 1 }}>
                <Typography variant="caption" color="text.secondary">
                  @{msg.sender?.username || msg.senderId} • {msg.createdAt ? new Date(msg.createdAt).toLocaleString('ru-RU') : ''}
                </Typography>
                {msg.isDeleted && <Chip size="small" color="error" variant="outlined" label="Удалено" sx={{ ml: 1, height: 18 }} />}
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {msg.text || msg.content || (msg.attachments?.length ? '' : '(сообщение без текста)')}
                </Typography>
                {(msg.attachments || []).map((a: any, i: number) => {
                  const url = attachmentUrl(a);
                  if (!/^\/uploads\//.test(url)) {
                    return <Typography key={i} variant="caption" display="block">{a.fileName || a.mimeType || 'Вложение'}</Typography>;
                  }
                  return isImage(a)
                    ? <Box key={i} component="a" href={url} target="_blank" rel="noopener noreferrer">
                        <Box component="img" src={url} alt={a.fileName || 'Вложение'} sx={{ maxWidth: '100%', maxHeight: 240, borderRadius: 1, mt: 0.5 }} />
                      </Box>
                    : <Button key={i} size="small" href={url} target="_blank" rel="noopener noreferrer">{a.fileName || a.originalName || 'Вложение'}</Button>;
                })}
              </Box>
            ))}
            {data.messages.length < data.total && (
              <Button size="small" disabled={loading} onClick={() => open(link, data.messages.length)}>Загрузить ещё</Button>
            )}
          </Stack>
        </>
      )}
      {loading && !data && <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}><CircularProgress size={24} /></Box>}
    </Stack>
  );
}
