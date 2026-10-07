import React, { useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';

export default function ExternalSiteDialog({ url, onClose }: { url: string; onClose: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  return <Dialog open fullScreen={confirmed} fullWidth maxWidth="sm" onClose={onClose}>
    <DialogTitle>{confirmed ? url : 'Внешний сайт — экспериментальная функция'}</DialogTitle>
    <DialogContent sx={confirmed ? { p: 0, display: 'flex' } : undefined}>
      {confirmed ? <iframe title={url} src={url} sandbox="allow-forms allow-scripts" referrerPolicy="no-referrer" style={{ flex: 1, width: '100%', height: '100%', border: 0 }} /> :
        <Alert severity="warning">{url}<br />Сторонний сайт может быть небезопасен и отслеживать ваши действия. Некоторые сайты запрещают встраивание.</Alert>}
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>{confirmed ? 'Закрыть сайт' : 'Отмена'}</Button>
      {!confirmed && <Button onClick={() => setConfirmed(true)}>Продолжить</Button>}
    </DialogActions>
  </Dialog>;
}