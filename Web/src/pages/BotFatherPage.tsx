import React, { useEffect, useState } from 'react';
import {
  Box, Typography, TextField, Button, List, ListItem, ListItemText,
  Dialog, DialogTitle, DialogContent, DialogActions, Chip, IconButton, Tooltip,
} from '@mui/material';
import { ContentCopy, Refresh, Delete, Add } from '@mui/icons-material';
import { useAuthStore } from '../store/authStore';
import { botsApi } from '../services/botsApi';
import { Bot } from '../types/bots';
import { motion } from '../styles/motion';

export default function BotFatherPage() {
  const { user } = useAuthStore();
  const [bots, setBots] = useState<Bot[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      const res = await botsApi.getMyBots();
      setBots(res.data || []);
    } catch {}
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!newName.trim() || !newUsername.trim()) return;
    setLoading(true);
    try {
      await botsApi.createBot(newName.trim(), newUsername.trim());
      setCreateOpen(false);
      setNewName('');
      setNewUsername('');
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.message || 'Ошибка создания бота');
    } finally {
      setLoading(false);
    }
  };

  const copyToken = (token: string) => {
    navigator.clipboard?.writeText(token);
  };

  return (
    <Box sx={{ p: 3, color: '#fff' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>🤖 BotFather</Typography>
        <Button variant="contained" startIcon={<Add />} onClick={() => setCreateOpen(true)}>Новый бот</Button>
      </Box>

      <Typography sx={{ color: 'text.secondary', mb: 2 }}>
        Создавай и управляй своими ботами прямо здесь. Или используй чат с @botfather в мессенджере.
      </Typography>

      <List sx={{ bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 3, border: '1px solid rgba(255,255,255,0.08)' }}>
        {bots.length === 0 && (
          <ListItem><ListItemText primary="Пока нет ботов. Создай первого!" /></ListItem>
        )}
        {bots.map((bot) => (
          <ListItem key={bot.id} sx={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <ListItemText
              primary={<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography fontWeight={600}>@{bot.username}</Typography>
                <Chip label={bot.isActive ? 'активен' : 'выключен'} size="small" color={bot.isActive ? 'success' : 'default'} />
              </Box>}
              secondary={bot.name + (bot.description ? ' — ' + bot.description : '')}
            />
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Tooltip title="Скопировать токен">
                <IconButton onClick={() => copyToken(bot.secretToken)}><ContentCopy fontSize="small" /></IconButton>
              </Tooltip>
              <Tooltip title="Новый токен">
                <IconButton><Refresh fontSize="small" /></IconButton>
              </Tooltip>
            </Box>
          </ListItem>
        ))}
      </List>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)}>
        <DialogTitle>Создать бота</DialogTitle>
        <DialogContent sx={{ minWidth: 340 }}>
          <TextField fullWidth margin="dense" label="Имя бота" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <TextField fullWidth margin="dense" label="Username (без @)" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="my_bot" />
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
            Username: 3-32 символа, латиница, цифры и _
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Отмена</Button>
          <Button variant="contained" disabled={loading} onClick={handleCreate}>Создать</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}