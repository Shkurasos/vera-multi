import React, { useEffect, useState } from 'react';
import {
  Box, Typography, TextField, Button, List, ListItem, ListItemText,
  Dialog, DialogTitle, DialogContent, DialogActions, IconButton, Tooltip, Alert,
} from '@mui/material';
import { ContentCopy, Refresh, Delete, Add } from '@mui/icons-material';
import { botsApi } from '../services/botsApi';
import { Bot } from '../types/bots';

/**
 * Боты пользователя. То же самое умеет чат с /hub; страница — для тех, кому
 * удобнее форма. Токен сервер показывает один раз: при создании и перевыпуске.
 */
export default function BotFatherPage() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shownToken, setShownToken] = useState<{ username: string; token: string } | null>(null);
  const [toDelete, setToDelete] = useState<Bot | null>(null);

  const load = async () => {
    try {
      const res = await botsApi.getMyBots();
      setBots(res.data || []);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Не удалось загрузить ботов');
    }
  };

  useEffect(() => { void load(); }, []);

  const handleCreate = async () => {
    if (!newName.trim() || !newUsername.trim()) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await botsApi.createBot(newName.trim(), newUsername.trim());
      setCreateOpen(false);
      setNewName('');
      setNewUsername('');
      setShownToken({ username: data.bot.username, token: data.token });
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Ошибка создания бота');
    } finally {
      setLoading(false);
    }
  };

  const reissue = async (bot: Bot) => {
    setError('');
    try {
      const { data } = await botsApi.reissueToken(bot.id);
      setShownToken({ username: bot.username, token: data.token });
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Не удалось выпустить токен');
    }
  };

  const remove = async () => {
    const bot = toDelete;
    setToDelete(null);
    if (!bot) return;
    try {
      await botsApi.deleteBot(bot.id);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Не удалось удалить бота');
    }
  };

  // Как и AdminToolsPage, скроллится сама: body и обёртка Routes в MainLayout
  // стоят на overflow: hidden, поэтому страница без overflowY не листается.
  return (
    <Box sx={{
      height: '100%', overflowY: 'auto', overscrollBehavior: 'contain',
      p: 3, color: '#fff', boxSizing: 'border-box',
      pb: { xs: 76, md: 3 }, // запас под мобильную нижнюю навигацию
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>🤖 Мои боты</Typography>
        <Button variant="contained" startIcon={<Add />} onClick={() => setCreateOpen(true)}>Новый бот</Button>
      </Box>

      <Typography sx={{ color: 'text.secondary', mb: 2 }}>
        Здесь можно создать бота и выпустить ему токен. То же самое умеет чат с /hub: найдите его в поиске по «/hub». Код бота
        запускается у вас и обращается к Vera через Bot API, подробности — команда /api в /hub.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <List sx={{ bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 3, border: '1px solid rgba(255,255,255,0.08)' }}>
        {bots.length === 0 && (
          <ListItem><ListItemText primary="Пока нет ботов. Создайте первого." /></ListItem>
        )}
        {bots.map((bot) => (
          <ListItem key={bot.id} sx={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <ListItemText
              primary={<Typography fontWeight={600}>/{bot.username}</Typography>}
              secondary={bot.name + (bot.hasWebhook ? ' · вебхук задан' : '')}
            />
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Tooltip title="Выпустить новый токен (старый перестанет работать)">
                <IconButton aria-label={`Новый токен для ${bot.username}`} onClick={() => reissue(bot)}><Refresh fontSize="small" /></IconButton>
              </Tooltip>
              <Tooltip title="Удалить бота">
                <IconButton aria-label={`Удалить ${bot.username}`} onClick={() => setToDelete(bot)} sx={{ color: '#f44336' }}><Delete fontSize="small" /></IconButton>
              </Tooltip>
            </Box>
          </ListItem>
        ))}
      </List>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)}>
        <DialogTitle>Создать бота</DialogTitle>
        <DialogContent sx={{ minWidth: 340 }}>
          <TextField fullWidth margin="dense" label="Имя бота" value={newName} onChange={(e) => setNewName(e.target.value)} inputProps={{ maxLength: 64 }} />
          <TextField fullWidth margin="dense" label="Ник бота" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="weather_bot" inputProps={{ maxLength: 32 }} />
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
            Ник: латиница, цифры и _, от 5 до 32 символов, с буквы и с «bot» на конце.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Отмена</Button>
          <Button variant="contained" disabled={loading} onClick={handleCreate}>Создать</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!shownToken} onClose={() => setShownToken(null)}>
        <DialogTitle>Токен /{shownToken?.username}</DialogTitle>
        <DialogContent sx={{ minWidth: 340 }}>
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            Скопируйте токен сейчас: он показывается один раз. С токеном кто угодно может писать от имени бота.
          </Alert>
          <TextField fullWidth value={shownToken?.token || ''} inputProps={{ readOnly: true, 'aria-label': 'Токен бота', style: { fontFamily: 'monospace', fontSize: 13 } }}
            onFocus={(e) => e.target.select()} />
        </DialogContent>
        <DialogActions>
          <Button startIcon={<ContentCopy />} onClick={() => { if (shownToken) void navigator.clipboard?.writeText(shownToken.token); }}>Скопировать</Button>
          <Button variant="contained" onClick={() => setShownToken(null)}>Готово</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!toDelete} onClose={() => setToDelete(null)}>
        <DialogTitle>Удалить /{toDelete?.username}?</DialogTitle>
        <DialogContent>
          <Typography>Токен перестанет работать, ник освободится. Восстановить бота нельзя.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setToDelete(null)}>Отмена</Button>
          <Button color="error" onClick={remove}>Удалить</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}