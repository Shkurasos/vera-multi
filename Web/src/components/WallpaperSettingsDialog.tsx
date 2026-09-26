import React, { useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  IconButton, Alert,
} from '@mui/material';
import { Close, DeleteOutline, UploadFile, Videocam } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { useChatStore } from '../store/chatStore';
import {
  useChatBgPrefsStore, STOCK_WALLPAPERS,
  CUSTOM_PHOTO_WALLPAPER_ID, CUSTOM_LIVE_WALLPAPER_ID,
} from '../store/chatBgPrefsStore';
import type { UserWallpaperItem } from '../store/chatBgPrefsStore';
import { saveLiveBg, clearLiveBg, hasLiveBg, getLiveBgBlob } from '../services/chatLiveBgStorage';
import {
  isPhotoBgKey, savePhotoBg, clearPhotoBg, loadPhotoBgUrl,
} from '../services/chatBgPhotoStorage';

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

/** Уникальный id своих обоев в списке. */
function newId(): string {
  return (crypto as any)?.randomUUID?.() || `wp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Диалог выбора глобальных обоев (применяются ко всем чатам по умолчанию).
 * Позволяет выбрать стоковые обои или загрузить свои (фото / видео).
 */
export default function WallpaperSettingsDialog({ open, onClose }: Props) {
  const theme = useThemeStore((s) => s.theme);
  const activeChatId = useChatStore((s) => s.activeChat?.id);
  const chatId = activeChatId;
  const scope = chatId || 'global';
  const prefs = useChatBgPrefsStore();
  const override = chatId ? prefs.perChatOverrides[chatId] : undefined;
  const globalStockWallpaper = chatId
    ? (override?.type === 'live' ? CUSTOM_LIVE_WALLPAPER_ID : override?.type === 'photo' ? CUSTOM_PHOTO_WALLPAPER_ID : override?.value || 'none')
    : prefs.globalStockWallpaper;
  const userPhotoWallpaper = chatId ? (override?.type === 'photo' ? override.value : null) : prefs.userPhotoWallpaper;
  const setGlobalStockWallpaper = (value: string) => {
    if (!chatId) { prefs.setGlobalStockWallpaper(value); return; }
    if (value === CUSTOM_LIVE_WALLPAPER_ID) prefs.setChatWallpaper(chatId, { type: 'live', value: scope });
    else if (value === CUSTOM_PHOTO_WALLPAPER_ID) {
      if (userPhotoWallpaper) prefs.setChatWallpaper(chatId, { type: 'photo', value: userPhotoWallpaper });
    } else prefs.setChatWallpaper(chatId, { type: 'stock', value });
  };
  const userPhotoName = useChatBgPrefsStore((s) => s.userPhotoName);
  const setUserPhotoWallpaper = useChatBgPrefsStore((s) => s.setUserPhotoWallpaper);
  const clearUserPhotoWallpaper = useChatBgPrefsStore((s) => s.clearUserPhotoWallpaper);
  const bumpLiveBg = useChatBgPrefsStore((s) => s.bumpLiveBg);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [liveExists, setLiveExists] = useState<boolean>(() => hasLiveBg());
  useEffect(() => { setLiveExists(hasLiveBg(scope)); setErr(null); }, [scope, open]);

  const applyCurrentToGlobal = async () => {
    if (!activeChatId || busy) return;
    const wallpaper = prefs.perChatOverrides[activeChatId]
      || useChatStore.getState().activeChat?.wallpaper
      || prefs.getChatWallpaper(activeChatId);
    setBusy(true);
    setErr(null);
    try {
      if (wallpaper?.type === 'live') {
        const blob = await getLiveBgBlob(wallpaper.value);
        if (!blob) throw new Error('Видео этого чата не найдено. Загрузите его заново.');
        await saveLiveBg(blob, 'global');
        // Легаси-ключ 'global' — на него смотрит плитка «Моё видео».
        prefs.setGlobalLiveWallpaper('global');
        bumpLiveBg();
        setLiveExists(true);
      } else if (wallpaper?.type === 'photo') {
        let photoValue = wallpaper.value;
        if (!isPhotoBgKey(photoValue)) {
          // dataURL (например, присланный из чата) переносим в IndexedDB.
          const key = `global:${newId()}`;
          await savePhotoBg(photoValue, key);
          photoValue = key;
        }
        prefs.setUserPhotoWallpaper(photoValue, 'Фото чата');
        prefs.setGlobalStockWallpaper(CUSTOM_PHOTO_WALLPAPER_ID);
        // Дублируем в список «Своих обоев», чтобы фото можно было выбрать снова.
        if (!(prefs.userWallpapers.global || []).some((i) => i.type === 'photo' && i.value === photoValue)) {
          prefs.addUserWallpaper('global', { id: newId(), name: 'Фото чата', type: 'photo', value: photoValue, createdAt: Date.now() });
        }
      } else {
        prefs.setGlobalStockWallpaper(wallpaper?.value || 'none');
      }
    } catch (ex: any) {
      setErr(ex?.message || 'Не удалось применить обои');
    } finally {
      setBusy(false);
    }
  };

  /** Что выбрано сейчас из «своих» обоев — для подсветки плиток. */
  const selectedUserPhotoValue = chatId
    ? (override?.type === 'photo' ? override.value : null)
    : (prefs.globalStockWallpaper === CUSTOM_PHOTO_WALLPAPER_ID ? prefs.userPhotoWallpaper : null);
  const selectedUserLiveValue = chatId
    ? (override?.type === 'live' ? override.value : null)
    : (prefs.globalStockWallpaper === CUSTOM_LIVE_WALLPAPER_ID ? (prefs.globalLiveValue || 'global') : null);

  /** Свои обои текущего scope + легаси-одиночные (загруженные до списка). */
  const myWallpapers: UserWallpaperItem[] = (() => {
    const items = prefs.userWallpapers[scope] || [];
    const legacy: UserWallpaperItem[] = [];
    if (!chatId && prefs.userPhotoWallpaper && !items.some((i) => i.type === 'photo' && i.value === prefs.userPhotoWallpaper)) {
      legacy.push({ id: 'legacy-photo', name: prefs.userPhotoName || 'Моё фото', type: 'photo', value: prefs.userPhotoWallpaper, createdAt: 0 });
    }
    if (liveExists && !items.some((i) => i.value === scope)) {
      legacy.push({ id: 'legacy-live', name: 'Моё видео', type: 'live', value: scope, createdAt: 0 });
    }
    return [...legacy, ...items];
  })();

  // Превью фото, лежащих в IndexedDB (value — ключ, а не dataURL).
  const [photoPreviews, setPhotoPreviews] = useState<Record<string, string>>({});
  const photoKeys = myWallpapers
    .filter((i) => i.type === 'photo' && isPhotoBgKey(i.value))
    .map((i) => i.value)
    .join('|');
  useEffect(() => {
    let cancelled = false;
    const keys = photoKeys ? photoKeys.split('|') : [];
    if (!keys.length) return;
    (async () => {
      for (const key of keys) {
        const url = await loadPhotoBgUrl(key);
        if (cancelled) return;
        if (url) setPhotoPreviews((prev) => (prev[key] === url ? prev : { ...prev, [key]: url }));
      }
    })();
    return () => { cancelled = true; };
  }, [photoKeys]);

  /** Применить выбранные из списка обои (сохраняется сразу, как и стоковые). */
  const selectUserWallpaper = (item: UserWallpaperItem) => {
    setErr(null);
    if (item.type === 'photo') {
      if (chatId) prefs.setChatWallpaper(chatId, { type: 'photo', value: item.value });
      else {
        setUserPhotoWallpaper(item.value, item.name);
        setGlobalStockWallpaper(CUSTOM_PHOTO_WALLPAPER_ID);
      }
    } else {
      if (chatId) prefs.setChatWallpaper(chatId, { type: 'live', value: item.value });
      else prefs.setGlobalLiveWallpaper(item.value);
      bumpLiveBg();
    }
  };

  const handlePhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setErr(null);
    setBusy(true);
    try {
      let last: UserWallpaperItem | null = null;
      for (const file of files) {
        if (file.size > 8 * 1024 * 1024) {
          setErr('Файл слишком большой. Максимум 8 МБ.');
          continue;
        }
        const raw = await readAsDataURL(file);
        const url = await resizeImage(raw, 1920);
        const id = newId();
        // Фото живёт в IndexedDB — в сторе/localStorage остаётся только ключ.
        const key = `${scope}:${id}`;
        await savePhotoBg(url, key);
        last = { id, name: file.name || 'Фото', type: 'photo', value: key, createdAt: Date.now() };
        prefs.addUserWallpaper(scope, last);
      }
      if (last) selectUserWallpaper(last);
    } catch (ex: any) {
      setErr(ex?.message || 'Не удалось загрузить фото');
    } finally {
      setBusy(false);
    }
  };

  const handleVideos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setErr(null);
    setBusy(true);
    try {
      let last: UserWallpaperItem | null = null;
      for (const file of files) {
        if (file.size > 30 * 1024 * 1024) {
          setErr('Видео слишком большое. Максимум 30 МБ.');
          continue;
        }
        const id = newId();
        // У каждого видео свой ключ в IndexedDB — можно хранить несколько сразу.
        const storageScope = `${scope}:${id}`;
        await saveLiveBg(file, storageScope);
        last = { id, name: file.name || 'Видео', type: 'live', value: storageScope, createdAt: Date.now() };
        prefs.addUserWallpaper(scope, last);
      }
      if (last) {
        setLiveExists(hasLiveBg(scope));
        selectUserWallpaper(last);
        bumpLiveBg(); // заставит открытые чаты перезагрузить видео
      }
    } catch (ex: any) {
      setErr(ex?.message || 'Не удалось сохранить видео');
    } finally {
      setBusy(false);
    }
  };

  /** Убрать свои обои; если они были выбраны — вернуть «без обоев». */
  const removeMyWallpaper = async (item: UserWallpaperItem) => {
    const isLegacy = item.id === 'legacy-photo' || item.id === 'legacy-live';
    const wasSelected = item.type === 'photo'
      ? selectedUserPhotoValue === item.value
      : selectedUserLiveValue === item.value;
    if (item.type === 'live') {
      await clearLiveBg(item.value);
      setLiveExists(hasLiveBg(scope));
      bumpLiveBg();
    }
    if (!isLegacy) prefs.removeUserWallpaper(scope, item.id);
    if (item.type === 'photo' && !chatId && (isLegacy || wasSelected)) clearUserPhotoWallpaper();
    if (wasSelected) {
      if (chatId) prefs.setChatWallpaper(chatId, { type: 'stock', value: 'none' });
      else prefs.setGlobalStockWallpaper('none');
    }
    if (item.type === 'photo' && isPhotoBgKey(item.value)) {
      // Удаляем blob только если на ключ больше никто не ссылается
      // (одно фото может быть и в общем списке, и в per-chat оверрайде).
      const st = useChatBgPrefsStore.getState();
      const referenced =
        st.userPhotoWallpaper === item.value ||
        Object.values(st.perChatOverrides).some((o) => o && o.type === 'photo' && o.value === item.value) ||
        Object.values(st.userWallpapers).some((list) => (list || []).some((i) => i.value === item.value));
      if (!referenced) await clearPhotoBg(item.value);
    }
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
        {chatId ? '🖼️ Обои этого чата' : '🖼️ Обои для всех чатов'}
        <IconButton onClick={onClose} size="small" sx={{ color: theme.textSec }}>
          <Close />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ pb: 2 }}>
        <Typography sx={{ color: theme.textSec, fontSize: 13, mb: 2 }}>
          {chatId ? 'Фото, видео и стандартные обои сохраняются только для открытого чата.' : 'Общий фон для чатов без индивидуальных обоев. Чтобы настроить один чат, откройте его.'}
        </Typography>
        {activeChatId && <Button disabled={busy} onClick={() => void applyCurrentToGlobal()} sx={{ mb: 2 }}>
          Сделать обои этого чата общими
        </Button>}
        <Typography sx={{ color: theme.textSec, fontSize: 12, mb: 2 }}>
          Выберите обои ниже — они сохранятся сразу.
          Общий фон используется в чатах без индивидуальных обоев.
        </Typography>

        {/* Скрытые input'ы для загрузки файлов (можно выбрать несколько сразу) */}
        <input
          ref={photoInputRef}
          type="file"
          multiple
          accept="image/*,.png,.jpg,.jpeg,.webp"
          style={{ display: 'none' }}
          onChange={handlePhotos}
        />
        <input
          ref={videoInputRef}
          type="file"
          multiple
          accept="video/*,.mp4,.webm,.mov"
          style={{ display: 'none' }}
          onChange={handleVideos}
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
            Загрузить фото (можно несколько)
          </Button>
          <Button
            variant="outlined"
            startIcon={<Videocam />}
            onClick={() => videoInputRef.current?.click()}
            disabled={busy}
            sx={{ color: theme.accent, borderColor: theme.accent, '&:hover': { borderColor: theme.accent, bgcolor: theme.accent + '14' } }}
          >
            Загрузить видео (можно несколько)
          </Button>
        </Box>

        {err && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr(null)}>{err}</Alert>}
        {busy && <Typography sx={{ color: theme.textSec, fontSize: 13, mb: 1 }}>⏳ Обработка…</Typography>}
        <Typography sx={{ color: theme.textSec, fontSize: 12, mb: 1, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Ваши обои
        </Typography>
        <Typography sx={{ color: theme.textSec, fontSize: 12, mb: 1.5 }}>
          Можно загрузить несколько обоев и переключаться между ними — выбранные применяются сразу.
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1.5, mb: 2 }}>
          {myWallpapers.map((item) => {
            const isSelected = item.type === 'photo'
              ? selectedUserPhotoValue === item.value
              : selectedUserLiveValue === item.value;
            return (
              <Box
                key={`${item.type}-${item.id}`}
                onClick={() => selectUserWallpaper(item)}
                sx={{
                  position: 'relative',
                  aspectRatio: '16/10',
                  borderRadius: 2,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  border: isSelected ? `3px solid ${theme.accent}` : `1px solid ${theme.border}`,
                  transition: 'all 0.2s ease',
                  '&:hover': { transform: 'scale(1.03)', boxShadow: `0 4px 16px ${theme.accent}40` },
                }}
              >
                {item.type === 'photo' ? (
                  <Box sx={{ width: '100%', height: '100%', backgroundImage: `url(${isPhotoBgKey(item.value) ? (photoPreviews[item.value] || '') : item.value})`, backgroundSize: 'cover', backgroundPosition: 'center', bgcolor: theme.bg }} />
                ) : (
                  <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.5, bgcolor: theme.bg, color: theme.textSec }}>
                    <Videocam sx={{ fontSize: 28 }} />
                    <Typography sx={{ fontSize: 10, fontWeight: 600 }}>Видео</Typography>
                  </Box>
                )}
                <Box sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, bgcolor: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 11, fontWeight: 600, py: 0.5, px: 1, textAlign: 'center', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  {item.name}
                </Box>
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); void removeMyWallpaper(item); }}
                  sx={{ position: 'absolute', top: 2, right: 2, bgcolor: 'rgba(0,0,0,0.6)', color: '#fff', '&:hover': { bgcolor: 'rgba(255,60,60,0.8)' } }}
                >
                  <DeleteOutline sx={{ fontSize: 15 }} />
                </IconButton>
                {isSelected && (
                  <Box sx={{ position: 'absolute', top: 4, left: 4, width: 22, height: 22, borderRadius: '50%', bgcolor: theme.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 'bold' }}>✓</Box>
                )}
              </Box>
            );
          })}
          {!myWallpapers.length && (
            <Typography sx={{ color: theme.textSec, fontSize: 12, gridColumn: '1 / -1' }}>
              Пока нет своих обоев — загрузите фото или видео выше.
            </Typography>
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