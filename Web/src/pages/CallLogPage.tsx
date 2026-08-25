import { useEffect, useState } from 'react';
import { Box, Typography, List, ListItem, ListItemText, Chip, Paper, Alert } from '@mui/material';
import { peer, isPeerAvailable, CallLogEntry } from '../services/peer';

/*
 * CallLogPage — история звонков (audio/video), которую копит `peer.listCallLog`.
 * Запись создаётся в ядре при открытии/закрытии WebRTC-сессии (see rtc.js).
 */
export default function CallLogPage() {
  const [items, setItems] = useState<CallLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPeerAvailable()) return;
    peer.listCallLog().then((r) => setItems(r as CallLogEntry[])).catch((e) => setError(e.message));
    const off = peer.on('session-close', () => {
      peer.listCallLog().then((r) => setItems(r as CallLogEntry[])).catch(() => {});
    });
    return () => { try { off(); } catch {} };
  }, []);

  if (!isPeerAvailable()) {
    return <Box p={4}><Alert severity="warning">История звонков доступна только в приложении Vera.</Alert></Box>;
  }

  return (
    <Box p={4} maxWidth={800} mx="auto">
      <Typography variant="h5" mb={2}>История звонков</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper sx={{ p: 2 }}>
        {items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">Здесь появятся ваши звонки.</Typography>
        ) : (
          <List>
            {items.map((c) => (
              <ListItem key={c.id} secondaryAction={<Chip label={c.direction === 'in' ? 'входящий' : 'исходящий'} size="small" />}>
                <ListItemText
                  primary={c.peer?.slice(0, 16) + '…'}
                  secondary={
                    new Date(c.startedAt).toLocaleString() + ' · ' + c.kind +
                    (c.endedAt ? ' · ' + Math.round((c.endedAt - c.startedAt) / 1000) + 's' : ' · оборвано')
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
      </Paper>
    </Box>
  );
}
