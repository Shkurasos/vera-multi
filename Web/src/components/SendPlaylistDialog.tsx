import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Dialog, DialogTitle, DialogContent, DialogActions,
  Button, List, ListItem, ListItemAvatar, Avatar, ListItemText, CircularProgress,
} from '@mui/material';
import { Send, Chat } from '@mui/icons-material';
import { useChatStore } from '../store/chatStore';
import { useAuthStore } from '../store/authStore';
import { messagesApi } from '../services/api';
import { useThemeStore } from '../store/themeStore';
import { Playlist } from '../types';

interface Props {
  open: boolean;
  playlist: Playlist | null;
  onClose: () => void;
}

/**
 * Диалог «Отправить плейлист в чат». Выбирает чат и шлёт сообщение
 * с аттачментом application/x-vera-playlist (payload в JSON внутри data).
 */
export default function SendPlaylistDialog({ open, playlist, onClose }: Props) {
  const theme = useThemeStore((s) => s.theme);
  const { user } = useAuthStore();
  const { chats, loadChats } = useChatStore();
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { if (open) loadChats(); }, [open, loadChats]);

  const send = async (chatId: string) => {
    if (!playlist || sending) return;
    setSending(chatId);
    setError('');
    const tracks = (playlist.tracks || []).map((e) => ({
      id: e.track.id,
      title: e.track.title,
      artist: e.track.artist,
    }));
    const attachment = {
      mimeType: 'application/x-vera-playlist',
      fileName: `${playlist.name}.vera-playlist`,
      data: JSON.stringify({
        playlistId: playlist.id,
        name: playlist.name,
        ownerName: user?.firstName || user?.username || undefined,
        tracks,
      }),
    };
    try {
      await messagesApi.send(chatId, { attachments: [attachment] });
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Не удалось отправить');
      setSending(null);
    }
  };

  return (
    <Dialog open={open} onClose={() => !sending && onClose()} fullWidth maxWidth="sm" PaperProps={{ sx: { bgcolor: theme.bg, borderRadius: 3 } }}>
      <DialogTitle sx={{ color: theme.text, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Send sx={{ color: theme.accent }} /> Отправить «{playlist?.name}» в чат
      </DialogTitle>
      <DialogContent dividers>
        {chats.length === 0 ? (
          <Typography sx={{ color: theme.textSec, textAlign: 'center', py: 3 }}>Нет чатов для отправки</Typography>
        ) : (
          <List dense sx={{ maxHeight: 380, overflowY: 'auto' }}>
            {chats.filter((c) => c && c.id).map((c) => (
              <ListItem key={c.id} button onClick={() => send(c.id)} sx={{ bgcolor: theme.bgInput, borderRadius: 2, mb: 1 }}>
                <ListItemAvatar>
                  <Avatar src={c.avatarUrl} variant="rounded" sx={{ bgcolor: theme.accent + '20', color: theme.accent }}>
                    <Chat />
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={<Typography sx={{ color: theme.text, fontWeight: 600 }} noWrap>{c.name || 'Чат'}</Typography>}
                  secondary={<Typography sx={{ color: theme.textSec, fontSize: 12 }} noWrap>{c.type === 'private' ? 'Личный чат' : c.type === 'group' ? 'Группа' : 'Канал'}</Typography>}
                />
                {sending === c.id && <CircularProgress size={18} sx={{ ml: 1 }} />}
              </ListItem>
            ))}
          </List>
        )}
        {error && <Typography sx={{ color: '#e57373', fontSize: 13 }}>{error}</Typography>}
        <Box sx={{ mt: 1, color: theme.textSec }}>
          <Typography sx={{ fontSize: 12 }}>Получатели увидят плейлист «{playlist?.name}» ({playlist?.tracks?.length || 0} треков) и смогут скачать его ZIP.</Typography>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 2.5, pb: 2 }}>
        <Button onClick={onClose} disabled={!!sending} sx={{ color: theme.textSec, textTransform: 'none' }}>Отмена</Button>
      </DialogActions>
    </Dialog>
  );
}