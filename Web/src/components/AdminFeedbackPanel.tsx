import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Button, Chip, Alert, CircularProgress, Stack, ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import { adminApi, FeedbackItem } from '../services/api';

type Filter = 'new' | 'all';

/** Раздел админ-панели: отзывы, идеи и баги, присланные через /feedback в /hub. */
export default function AdminFeedbackPanel() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [filter, setFilter] = useState<Filter>('new');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setItems((await adminApi.listFeedback()).data || []);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Не удалось загрузить отзывы');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const mark = async (item: FeedbackItem, read: boolean) => {
    setBusyId(item.id);
    try {
      const { data } = await adminApi.markFeedback(item.id, read);
      setItems((list) => list.map((f) => (f.id === item.id ? data : f)));
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Не удалось обновить отзыв');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item: FeedbackItem) => {
    if (!window.confirm('Удалить этот отзыв?')) return;
    setBusyId(item.id);
    try {
      await adminApi.deleteFeedback(item.id);
      setItems((list) => list.filter((f) => f.id !== item.id));
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Не удалось удалить отзыв');
    } finally {
      setBusyId(null);
    }
  };

  const reward = async (item: FeedbackItem) => {
    const warn = item.detailed === false
      ? 'Отзыв короткий и, возможно, не полностью расписан. Всё равно наградить автора 50 ВП?'
      : 'Наградить автора этого отзыва 50 ВП?';
    if (!window.confirm(warn)) return;
    setBusyId(item.id);
    setError('');
    setInfo('');
    try {
      const { data } = await adminApi.rewardFeedback(item.id);
      setItems((list) => list.map((f) => (f.id === item.id ? data.feedback : f)));
      setInfo(`Начислено ${data.amount} ВП автору ${item.username ? '@' + item.username : item.userId}.`);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Не удалось начислить награду');
    } finally {
      setBusyId(null);
    }
  };

  const newCount = items.filter((f) => f.status === 'new').length;
  const shown = filter === 'new' ? items.filter((f) => f.status === 'new') : items;

  return (
    <Box sx={{ p: 2, mb: 3, borderRadius: 3, border: '1px solid #ffffff22' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h6">💬 Отзывы, идеи и баги {newCount > 0 && <Chip size="small" color="primary" label={`новых: ${newCount}`} sx={{ ml: 1 }} />}</Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_, v) => v && setFilter(v)}>
            <ToggleButton value="new">Новые</ToggleButton>
            <ToggleButton value="all">Все ({items.length})</ToggleButton>
          </ToggleButtonGroup>
          <Button size="small" onClick={load} disabled={loading}>
            {loading ? <CircularProgress size={16} /> : 'Обновить'}
          </Button>
        </Box>
      </Box>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Пользователи присылают их командой /feedback в чате с Hub.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {info && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setInfo('')}>{info}</Alert>}
      {!loading && !shown.length && (
        <Typography sx={{ color: 'text.secondary' }}>
          {filter === 'new' ? 'Новых отзывов нет.' : 'Отзывов пока нет.'}
        </Typography>
      )}
      <Stack spacing={1.5} sx={{ maxHeight: 480, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        {shown.map((f) => (
          <Box key={f.id} sx={{
            p: 1.5, borderRadius: 2,
            bgcolor: f.status === 'new' ? 'rgba(80,140,255,0.10)' : 'rgba(255,255,255,0.04)',
            border: '1px solid', borderColor: f.status === 'new' ? 'rgba(80,140,255,0.35)' : 'rgba(255,255,255,0.08)',
          }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
              <Typography variant="subtitle2">
                {f.username ? `@${f.username}` : f.userId}
                {f.status === 'new' && <Chip size="small" label="новый" color="primary" sx={{ ml: 1, height: 20 }} />}
                {f.rewarded && <Chip size="small" label="награждён 50 ВП" color="success" sx={{ ml: 1, height: 20 }} />}
                {!f.rewarded && f.detailed === false && <Chip size="small" label="коротко" color="warning" variant="outlined" sx={{ ml: 1, height: 20 }} />}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {new Date(f.createdAt).toLocaleString('ru-RU')}
              </Typography>
            </Box>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', mb: 1 }}>{f.text}</Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button size="small" disabled={busyId === f.id} onClick={() => mark(f, f.status === 'new')}>
                {f.status === 'new' ? 'Прочитано' : 'Вернуть в новые'}
              </Button>
              <Button size="small" color="success" variant="outlined" disabled={busyId === f.id || !!f.rewarded}
                onClick={() => reward(f)}>
                {f.rewarded ? 'Награда выдана' : 'Наградить 50 ВП'}
              </Button>
              <Button size="small" color="error" disabled={busyId === f.id} onClick={() => remove(f)}>Удалить</Button>
            </Box>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
