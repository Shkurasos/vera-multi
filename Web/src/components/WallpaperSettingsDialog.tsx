import React, { useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  IconButton, Alert,
} from '@mui/material';
import { Close, DeleteOutline, UploadFile, Movie } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import {
  useChatBgPrefsStore, STOCK_WALLPAPERS,
  CUSTOM_PHOTO_WALLPAPER_ID, CUSTOM_LIVE_WALLPAPER_ID,
} from '../store/chatBgPrefsStore';
import { saveLiveBg, clearLiveBg, hasLiveBg } from '../services/chatLiveBgStorage';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Читает файл как data URL. */
function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

/** Уменьшает изображение до maxSide и возвращает JPEG data URL. */
function resizeImage(rawUrl: string, maxSide = 1920): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(rawUrl); return; }
      ctx.drawImage(img, 0, 0, w, h);
      try { resolve(canvas.toDataURL('image/jpeg', 0.85)); }
      catch { resolve(rawUrl); }
    };
    img.onerror = () => resolve(rawUrl);
    img.src = rawUrl;
  });
}

/**
 * Диалог выбора глобальных обоев (применяются ко всем чатам по умолчанию).
 * Позволяет выбрать стоковые обои или загрузить свои (фото / видео).
 */
export default function WallpaperSettingsDialog({ open, onClose }: Props) {
  const theme = useThemeStore((s) => s.theme);
  const globalStockWallpaper = useChatBgPrefsStore((s) => s.globalStockWallpaper);
  const setGlobalStockWallpaper = useChatBgPrefsStore((s) => s.setGlobalStockWallpaper);
  const userPhotoWallpaper = useChatBgPrefsStore((s) => s.userPhotoWallpaper);
  const userPhotoName = useChatBgPrefsStore((s) => s.userPhotoName);
  const setUserPhotoWallpaper = useChatBgPrefsStore((s) => s.setUserPhotoWallpaper);
  const clearUserPhotoWallpaper = useChatBgPrefsStore((s) => s.clearUserPhotoWallpaper);
  const bumpLiveBg = useChatBgPrefsStore((s) => s.bumpLiveBg);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [liveExists, setLiveExists] = useState<boolean>(() => hasLiveBg());

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr(null);
    if (file.size > 8 * 1024 * 1024) {
      setErr('Файл слишком большой. Максимум 8 МБ.');
      return;
    }
    try {
      setBusy(true);
      const raw = await readAsDataURL(file);
      const url = await resizeImage(raw, 1920);
      setUserPhotoWallpaper(url, file.name);
      setGlobalStockWallpaper(CUSTOM_PHOTO_WALLPAPER_ID);
    } catch (ex: any) {
      setErr(ex?.message || 'Не удалось загрузить фото');
    } finally {
      setBusy(false);
    }
  };

  const handleVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr(null);
    if (file.size > 30 * 1024 * 1024) {
      setErr('Видео слишком большое. Максимум 30 МБ.');
      return;
    }
    try {
      setBusy(true);
      await saveLiveBg(file);
      setLiveExists(true);
      setGlobalStockWallpaper(CUSTOM_LIVE_WALLPAPER_ID);
      bumpLiveBg(); // заставит открытые чаты перезагрузить видео
    } catch (ex: any) {
      setErr(ex?.message || 'Не удалось сохранить видео');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveLive = async () => {
    await clearLiveBg();
    setLiveExists(false);
    if (globalStockWallpaper === CUSTOM_LIVE_WALLPAPER_ID) setGlobalStockWallpaper('none');
    bumpLiveBg();
  };

  const handleRemovePhoto = () => {
    clearUserPhotoWallpaper();
    if (globalStockWallpaper === CUSTOM_PHOTO_WALLPAPER_ID) setGlobalStockWallpaper('none');
  };
return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: theme.bgHeader,
          border: `1px solid ${theme.border}`,
          borderRadius: 3,
        },
      }}
    >
      <DialogTitle
        sx={{
          color: theme.text,
          fontSize: 18,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pb: 2,
        }}
      >
        🖼️ Глобальные обои для всех чатов
        <IconButton onClick={onClose} size="small" sx={{ color: theme.textSec }}>
          <Close />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ pb: 2 }}>
        <Typography sx={{ color: theme.textSec, fontSize: 13, mb: 2 }}>
          Выберите обои, которые будут применяться ко всем чатам по умолчанию.
          В конкретном чате можно установить свои обои через меню «⋮».
        </Typography>

        {/* Скрытые input'ы для загрузки файлов */}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*,.png,.jpg,.jpeg,.webp"
          style={{ display: 'none' }}
          onChange={handlePhoto}
        />
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*,.mp4,.webm,.mov"
          style={{ display: 'none' }}
          onChange={handleVideo}
        />

        {/* Кнопки загрузки своих обоев */}
        <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            startIcon={<UploadFile />}
            onClick={() => photoInputRef.current?.click()}
            disabled={busy}
            sx={{ color: theme.accent, borderColor: theme.accent, '&:hover': { borderColor: theme.accent, bgcolor: theme.accent + '14' } }}
          >
            Загрузить своё фото
          </Button>
          <Button
            variant="outlined"
            startIcon={<Movie />}
            onClick={() => videoInputRef.current?.click()}
            disabled={busy}
            sx={{ color: theme.accent, borderColor: theme.accent, '&:hover': { borderColor: theme.accent, bgcolor: theme.accent + '14' } }}
          >
            Загрузить своё видео (MP4)
          </Button>
        </Box>

        {err && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr(null)}>{err}</Alert>}
        {busy && <Typography sx={{ color: theme.textSec, fontSize: 13, mb: 1 }}>⏳ Обработка…</Typography>}
<Typography sx={{ color: theme.textSec, fontSize: 12, mb: 1, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Ваши обои
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1.5, mb: 2 }}>
          {/* Своё фото */}
          {userPhotoWallpaper && (
            <Box
              onClick={() => setGlobalStockWallpaper(CUSTOM_PHOTO_WALLPAPER_ID)}
              sx={{
                position: 'relative',
                aspectRatio: '16/10',
                borderRadius: 2,
                overflow: 'hidden',
                cursor: 'pointer',
                border: globalStockWallpaper === CUSTOM_PHOTO_WALLPAPER_ID
                  ? `3px solid ${theme.accent}` : `1px solid ${theme.border}`,
                transition: 'all 0.2s ease',
                '&:hover': { transform: 'scale(1.03)', boxShadow: `0 4px 16px ${theme.accent}40` },
              }}
            >
              <Box sx={{ width: '100%', height: '100%', backgroundImage: `url(${userPhotoWallpaper})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
              <Box sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, bgcolor: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 11, fontWeight: 600, py: 0.5, px: 1, textAlign: 'center', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {userPhotoName || 'Моё фото'}
              </Box>
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); handleRemovePhoto(); }}
                sx={{ position: 'absolute', top: 2, right: 2, bgcolor: 'rgba(0,0,0,0.6)', color: '#fff', '&:hover': { bgcolor: 'rgba(255,60,60,0.8)' } }}
              >
                <DeleteOutline sx={{ fontSize: 15 }} />
              </IconButton>
              {globalStockWallpaper === CUSTOM_PHOTO_WALLPAPER_ID && (
                <Box sx={{ position: 'absolute', top: 4, left: 4, width: 22, height: 22, borderRadius: '50%', bgcolor: theme.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 'bold' }}>✓</Box>
              )}
            </Box>
          )}
          {/* Своё видео */}
          {liveExists && (
            <Box
              onClick={() => setGlobalStockWallpaper(CUSTOM_LIVE_WALLPAPER_ID)}
              sx={{
                position: 'relative',
                aspectRatio: '16/10',
                borderRadius: 2,
                overflow: 'hidden',
                cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 0.5,
                bgcolor: theme.bg,
                color: theme.textSec,
                border: globalStockWallpaper === CUSTOM_LIVE_WALLPAPER_ID
                  ? `3px solid ${theme.accent}` : `1px solid ${theme.border}`,
                transition: 'all 0.2s ease',
                '&:hover': { transform: 'scale(1.03)', boxShadow: `0 4px 16px ${theme.accent}40` },
              }}
            >
              <Movie sx={{ fontSize: 32 }} />
              <Typography sx={{ fontSize: 11, fontWeight: 600 }}>Моё видео</Typography>
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); handleRemoveLive(); }}
                sx={{ position: 'absolute', top: 2, right: 2, bgcolor: 'rgba(0,0,0,0.6)', color: '#fff', '&:hover': { bgcolor: 'rgba(255,60,60,0.8)' } }}
              >
                <DeleteOutline sx={{ fontSize: 15 }} />
              </IconButton>
              {globalStockWallpaper === CUSTOM_LIVE_WALLPAPER_ID && (
                <Box sx={{ position: 'absolute', top: 4, left: 4, width: 22, height: 22, borderRadius: '50%', bgcolor: theme.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 'bold' }}>✓</Box>
              )}
            </Box>
          )}
        </Box>
<Typography sx={{ color: theme.textSec, fontSize: 12, mb: 1, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Стоковые обои
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1.5 }}>
          {STOCK_WALLPAPERS.map((wp) => {
            const isSelected = globalStockWallpaper === wp.id;
            return (
              <Box
                key={wp.id}
                onClick={() => setGlobalStockWallpaper(wp.id)}
                sx={{
                  position: 'relative',
                  aspectRatio: '16/10',
                  borderRadius: 2,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  border: isSelected ? `3px solid ${theme.accent}` : `1px solid ${theme.border}`,
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    transform: 'scale(1.05)',
                    boxShadow: `0 4px 16px ${theme.accent}40`,
                  },
                }}
              >
                {wp.type === 'none' ? (
                  <Box
                    sx={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: theme.bg,
                      color: theme.textSec,
                      fontSize: 28,
                    }}
                  >
                    ✖️
                  </Box>
                ) : (
                  <Box
                    sx={{
                      width: '100%',
                      height: '100%',
                      backgroundImage: `url(${wp.url})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  />
                )}
                <Box
                  sx={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    bgcolor: 'rgba(0,0,0,0.7)',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 600,
                    py: 0.5,
                    px: 1,
                    textAlign: 'center',
                  }}
                >
                  {wp.name}
                </Box>
                {isSelected && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      bgcolor: theme.accent,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      fontSize: 14,
                      fontWeight: 'bold',
                    }}
                  >
                    ✓
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ color: theme.text }}>
          Закрыть
        </Button>
      </DialogActions>
    </Dialog>
  );
}