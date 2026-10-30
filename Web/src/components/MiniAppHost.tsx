import React, { Suspense, lazy, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Typography } from '@mui/material';
import { Close } from '@mui/icons-material';
import { useMiniAppStore } from '../store/miniAppStore';
import { useThemeStore } from '../store/themeStore';

const StickersMiniApp = lazy(() => import('./StickersMiniApp'));

/** Сайт мини-приложения внешнего бота: сначала предупреждение, потом фрейм-песочница. */
function WebMiniApp({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const theme = useThemeStore((s) => s.theme);
  const [confirmed, setConfirmed] = useState(false);
  let host = '';
  try { host = new URL(url).host; } catch { host = url; }
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" fullScreen={confirmed}
      PaperProps={{ sx: { bgcolor: theme.bgHeader, color: theme.text } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontWeight: 700 }}>{title}</Typography>
          <Typography noWrap sx={{ fontSize: 12, color: theme.textSec }}>{host}</Typography>
        </Box>
        <IconButton aria-label="Закрыть мини-приложение" onClick={onClose} sx={{ color: theme.textSec }}><Close /></IconButton>
      </DialogTitle>
      <DialogContent sx={confirmed ? { p: 0, display: 'flex' } : undefined}>
        {confirmed ? (
          // Без allow-same-origin сайт не прочитает cookie и хранилище Vera.
          <iframe title={title} src={url} sandbox="allow-scripts allow-forms allow-popups"
            referrerPolicy="no-referrer" allow="clipboard-write"
            style={{ flex: 1, width: '100%', height: '100%', border: 0, background: '#fff' }} />
        ) : (
          <Alert severity="info">
            Мини-приложение бота откроет сайт {host}. Сайт получит ваше имя и ник в Vera, но не доступ к аккаунту.
          </Alert>
        )}
      </DialogContent>
      {!confirmed && (
        <DialogActions>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="contained" onClick={() => setConfirmed(true)}>Открыть</Button>
        </DialogActions>
      )}
    </Dialog>
  );
}

/** Окно открытого мини-приложения, одно на всё приложение. */
export default function MiniAppHost() {
  const current = useMiniAppStore((s) => s.current);
  const close = useMiniAppStore((s) => s.close);
  if (!current) return null;
  if (current.kind === 'stickers') {
    return (
      <Suspense fallback={null}>
        <StickersMiniApp onClose={close} packName={current.packName} />
      </Suspense>
    );
  }
  return <WebMiniApp key={current.url} url={current.url} title={current.title} onClose={close} />;
}
