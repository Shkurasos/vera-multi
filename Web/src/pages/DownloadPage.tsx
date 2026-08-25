import { useEffect, useMemo, useState } from 'react';
import { Box, Typography, Paper, Button, Stack, Alert, CircularProgress, Chip } from '@mui/material';
import { Download as DownloadIcon } from '@mui/icons-material';
import { downloadsApi } from '../services/api';

type Platform = 'win' | 'mac' | 'linux' | 'other';
interface DownloadFile { platform: Platform; filename: string; size: number; url: string; }

function detectPlatform(): Platform {
  const ua = navigator.userAgent || '';
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
  win: 'Windows', mac: 'macOS', linux: 'Linux', other: 'Другое',
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
    const g: Record<Platform, DownloadFile[]> = { win: [], mac: [], linux: [], other: [] };
    (files || []).forEach((f) => g[f.platform].push(f));
    return g;
  }, [files]);

  const recommended = files?.find((f) => f.platform === myPlatform);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#1a1a2e', color: '#F5F7FF', p: 3 }}>
      <Box sx={{ maxWidth: 720, mx: 'auto' }}>
        <Typography variant="h4" fontWeight={800} mb={1}
          sx={{ background: 'linear-gradient(135deg, #C084FC, #7C6AF7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Скачать Vera Desktop
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={3}>
          Десктоп-приложение синхронизируется с веб-версией и работает как второе устройство аккаунта.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {files === null && !error && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress sx={{ color: '#7C6AF7' }} />
          </Box>
        )}

        {files && files.length === 0 && (
          <Alert severity="info">
            Установщики ещё не загружены на сервер. Администратор должен положить файлы в <code>Server/public/downloads/</code>.
          </Alert>
        )}

        {recommended && (
          <Paper sx={{ p: 3, mb: 3, bgcolor: 'rgba(124,106,247,0.12)', border: '1px solid rgba(124,106,247,0.4)', borderRadius: 3 }}>
            <Stack direction="row" alignItems="center" spacing={2} justifyContent="space-between" flexWrap="wrap">
              <Box>
                <Chip label={`Ваша платформа: ${PLATFORM_LABEL[myPlatform]}`} size="small" sx={{ mb: 1, bgcolor: 'rgba(124,106,247,0.3)', color: '#fff' }} />
                <Typography fontWeight={600}>{recommended.filename}</Typography>
                <Typography variant="caption" color="text.secondary">{formatSize(recommended.size)}</Typography>
              </Box>
              <Button variant="contained" size="large" startIcon={<DownloadIcon />}
                href={recommended.url} download
                sx={{ bgcolor: '#7C6AF7', ':hover': { bgcolor: '#6a58e8' } }}>
                Скачать
              </Button>
            </Stack>
          </Paper>
        )}

        {(['win', 'mac', 'linux', 'other'] as Platform[]).map((p) => grouped[p].length > 0 && (
          <Box key={p} mb={2}>
            <Typography variant="subtitle2" color="text.secondary" mb={1}>{PLATFORM_LABEL[p]}</Typography>
            <Stack spacing={1}>
              {grouped[p].map((f) => (
                <Paper key={f.filename} sx={{ p: 2, bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 2 }}>
                  <Stack direction="row" alignItems="center" spacing={2} justifyContent="space-between">
                    <Box sx={{ minWidth: 0 }}>
                      <Typography noWrap>{f.filename}</Typography>
                      <Typography variant="caption" color="text.secondary">{formatSize(f.size)}</Typography>
                    </Box>
                    <Button variant="outlined" startIcon={<DownloadIcon />} href={f.url} download
                      sx={{ color: '#C084FC', borderColor: 'rgba(192,132,252,0.5)' }}>
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
