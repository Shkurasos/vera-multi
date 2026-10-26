import { useEffect, useMemo, useState } from 'react';
import { Box, Typography, Paper, Button, Stack, Alert, CircularProgress, Chip, alpha } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { Download as DownloadIcon } from '@mui/icons-material';
import { downloadsApi } from '../services/api';
import PwaInstall from '../components/PwaInstall';

type Platform = 'win' | 'mac' | 'linux' | 'android' | 'other';
interface DownloadFile { platform: Platform; filename: string; size: number; url: string; }

function detectPlatform(): Platform {
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'other';
  if (/Windows/i.test(ua)) return 'win';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'mac';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return 'other';
}

function formatSize(bytes: number): string {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${mb.toFixed(1)} MB`;
}

const PLATFORM_LABEL: Record<Platform, string> = {
  win: 'ПК — Windows', mac: 'macOS', linux: 'Linux', android: 'Android', other: 'Другое',
};

export default function DownloadPage() {
  const [files, setFiles] = useState<DownloadFile[] | null>(null);
  const [error, setError] = useState('');
  const myPlatform = useMemo(detectPlatform, []);

  useEffect(() => {
    downloadsApi.list()
      .then((res) => setFiles(res.data.files || []))
      .catch((e: any) => setError(e?.response?.data?.message || e?.message || 'Не удалось получить список'));
  }, []);

  const grouped = useMemo(() => {
    const g: Record<Platform, DownloadFile[]> = { win: [], mac: [], linux: [], android: [], other: [] };
    (files || []).forEach((f) => (g[f.platform] || g.other).push(f));
    return g;
  }, [files]);

  const recommended = files?.find((f) => f.platform === myPlatform);

  return (
    // Цвета — из палитры MUI, которая собрана из темы пользователя (muiPalette.ts).
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', color: 'text.primary', p: 3 }}>
      <Box sx={{ maxWidth: 720, mx: 'auto' }}>
        <Typography variant="h4" fontWeight={800} mb={1}
          sx={{ background: (t: Theme) => `linear-gradient(135deg, ${t.palette.primary.light}, ${t.palette.primary.main})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Установить VERA
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={3}>
          Приложения для ПК и Android синхронизируются с веб-версией и работают как отдельные устройства аккаунта. Последние сообщения, музыка, аватары и тема доступны и без сети.
        </Typography>

        <PwaInstall />
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {files === null && !error && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        )}

        {files && files.length === 0 && (
          <Alert severity="info">
            Установщики ещё не загружены на сервер. Администратор должен положить файлы в <code>Server/public/downloads/</code>.
          </Alert>
        )}

        {recommended && (
          <Paper sx={{ p: 3, mb: 3, bgcolor: (t: Theme) => alpha(t.palette.primary.main, 0.12), border: (t: Theme) => `1px solid ${alpha(t.palette.primary.main, 0.4)}`, borderRadius: 3 }}>
            <Stack direction="row" alignItems="center" spacing={2} justifyContent="space-between" flexWrap="wrap">
              <Box>
                <Chip label={`Ваша платформа: ${PLATFORM_LABEL[myPlatform]}`} size="small" sx={{ mb: 1, bgcolor: (t: Theme) => alpha(t.palette.primary.main, 0.3), color: 'text.primary' }} />
                <Typography fontWeight={600}>{recommended.filename}</Typography>
                <Typography variant="caption" color="text.secondary">{formatSize(recommended.size)}</Typography>
              </Box>
              <Button variant="contained" size="large" startIcon={<DownloadIcon />}
                href={recommended.url} download>
                Скачать
              </Button>
            </Stack>
          </Paper>
        )}

        {(['win', 'android', 'mac', 'linux', 'other'] as Platform[]).map((p) => grouped[p].length > 0 && (
          <Box key={p} mb={2}>
            <Typography variant="subtitle2" color="text.secondary" mb={1}>{PLATFORM_LABEL[p]}</Typography>
            <Stack spacing={1}>
              {grouped[p].map((f) => (
                <Paper key={f.filename} sx={{ p: 2, bgcolor: 'action.hover', border: 1, borderColor: 'divider', borderRadius: 2 }}>
                  <Stack direction="row" alignItems="center" spacing={2} justifyContent="space-between">
                    <Box sx={{ minWidth: 0 }}>
                      <Typography noWrap>{f.filename}</Typography>
                      <Typography variant="caption" color="text.secondary">{formatSize(f.size)}</Typography>
                    </Box>
                    <Button variant="outlined" startIcon={<DownloadIcon />} href={f.url} download>
                      Скачать
                    </Button>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
