/**
 * Фото промежутков в редакторе тем (вкладка «Обои»).
 *
 * Фото видно только в зазоре вокруг окна чата. Если зазора нет (внешний
 * отступ окна чата 0), строка серая: показывать фото негде, и мы говорим,
 * что включить в «Макете».
 */
import React, { useMemo, useRef, useState } from 'react';
import { Box, Alert, Button, IconButton } from '@mui/material';
import { DeleteOutline, PhotoCamera } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { useChatBgPrefsStore } from '../store/chatBgPrefsStore';
import { useUserSettingsStore } from '../store/userSettingsStore';
import { savePhotoBg, clearPhotoBg } from '../services/chatBgPhotoStorage';
import { usePhotoBgUrl, usePhotoBgUrls } from '../hooks/usePhotoBgUrl';
import { GAP_DIM_LIMITS, GAP_PHOTO_MAX_SIDE, GAP_SCOPE, fitWithin, hasLayoutGap } from '../utils/gapWallpaper';
import { SettingRow, SettingSlider } from './SettingRow';

const MAX_FILE_SIZE = 25 * 1024 * 1024;

function newId(): string {
  return (crypto as any)?.randomUUID?.() || `gap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Сжимаем фото: в полосах по несколько px полный кадр с камеры не нужен. */
async function downscale(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode'));
      el.src = url;
    });
    const size = fitWithin(img.naturalWidth, img.naturalHeight, GAP_PHOTO_MAX_SIDE);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob || file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function GapWallpaperPanel() {
  const theme = useThemeStore((s) => s.theme);
  const margin = useUserSettingsStore((s) => s.layout.chatOuterMargin);
  const enabled = hasLayoutGap(margin);
  const gapBg = useChatBgPrefsStore((s) => s.gapBg);
  const gapDim = useChatBgPrefsStore((s) => s.gapDim);
  const all = useChatBgPrefsStore((s) => s.userWallpapers[GAP_SCOPE]);
  const items = useMemo(() => (all || []).filter((i) => i.type === 'photo'), [all]);
  const setGapBg = useChatBgPrefsStore((s) => s.setGapBg);
  const setGapDim = useChatBgPrefsStore((s) => s.setGapDim);
  const addUserWallpaper = useChatBgPrefsStore((s) => s.addUserWallpaper);
  const removeUserWallpaper = useChatBgPrefsStore((s) => s.removeUserWallpaper);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const urls = usePhotoBgUrls(items.map((i) => i.value));
  const currentUrl = usePhotoBgUrl(gapBg);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    if (!file.type.startsWith('image/')) { setError('Это не картинка'); return; }
    if (file.size > MAX_FILE_SIZE) { setError('Файл больше 25 МБ'); return; }
    setBusy(true);
    try {
      const blob = await downscale(file);
      const id = newId();
      const key = `${GAP_SCOPE}:${id}`;
      await savePhotoBg(blob, key);
      addUserWallpaper(GAP_SCOPE, { id, name: file.name || 'Моё фото', type: 'photo', value: key, createdAt: Date.now() });
      setGapBg(key);
    } catch {
      setError('Не удалось открыть фото');
    } finally {
      setBusy(false);
    }
  };

  const drop = async (id: string, key: string) => {
    removeUserWallpaper(GAP_SCOPE, id);
    if (useChatBgPrefsStore.getState().gapBg === key) setGapBg(null);
    // Файл стираем, только если его больше никто не использует.
    const st = useChatBgPrefsStore.getState();
    const stillUsed = st.chatListBg?.value === key
      || Object.values(st.perChatOverrides).some((o) => o?.value === key)
      || Object.values(st.userWallpapers).some((list) => (list || []).some((i) => i.value === key));
    if (!stillUsed) await clearPhotoBg(key);
  };

  const hint = enabled
    ? `Фото видно только в зазоре ${margin}px вокруг окна чата — как обводка.`
    : 'Промежутка нет: внешний отступ окна чата 0px. Увеличьте его в «Макете», чтобы фото появилось.';

  return (
    <Box>
      <SettingRow label="Фото в промежутках" hint={hint} disabled={!enabled}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          {/* Превью-рамка: фото только по краям, как в окне. */}
          <Box aria-hidden sx={{
            width: 56, height: 40, borderRadius: 1.5, flexShrink: 0, position: 'relative', overflow: 'hidden',
            border: `1px solid ${theme.border}`, bgcolor: theme.bgHover,
            backgroundImage: currentUrl ? `url(${currentUrl})` : undefined,
            backgroundSize: 'cover', backgroundPosition: 'center',
            filter: enabled ? undefined : 'grayscale(1)',
          }}>
            <Box sx={{ position: 'absolute', inset: 5, borderRadius: 1, bgcolor: theme.bgChat, border: `1px solid ${theme.border}` }} />
          </Box>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
          <Button variant="contained" disabled={!enabled || busy} startIcon={<PhotoCamera />}
            onClick={() => fileRef.current?.click()}
            sx={{ bgcolor: theme.accent, textTransform: 'none', borderRadius: 2, '&:hover': { bgcolor: theme.accent } }}>
            {busy ? 'Сжимаем…' : 'Добавить фото'}
          </Button>
          {gapBg && (
            <Button disabled={!enabled} onClick={() => setGapBg(null)} sx={{ color: theme.textSec, textTransform: 'none' }}>
              Убрать
            </Button>
          )}
        </Box>
      </SettingRow>
      {error ? <Alert severity="error" sx={{ mt: 1, fontSize: 12 }}>{error}</Alert> : null}
      {items.length > 0 && (
        <Box role="list" aria-label="Фото для промежутков" sx={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 1, mt: 1.5,
          opacity: enabled ? 1 : 0.5, filter: enabled ? undefined : 'grayscale(1)',
        }}>
          {items.map((it) => {
            const selected = gapBg === it.value;
            return (
              <Box key={it.id} role="listitem" sx={{ position: 'relative' }}>
                <Box component="button" type="button" disabled={!enabled}
                  aria-label={`Выбрать ${it.name}`} aria-pressed={selected}
                  onClick={() => setGapBg(it.value)}
                  sx={{
                    display: 'block', width: '100%', aspectRatio: '16 / 10', p: 0, borderRadius: 1.5,
                    cursor: enabled ? 'pointer' : 'default',
                    border: selected ? `2px solid ${theme.accent}` : `1px solid ${theme.border}`,
                    bgcolor: theme.bgHover,
                    backgroundImage: urls[it.value] ? `url(${urls[it.value]})` : undefined,
                    backgroundSize: 'cover', backgroundPosition: 'center',
                    '&:focus-visible': { outline: `2px solid ${theme.accent}`, outlineOffset: 2 },
                  }} />
                <IconButton size="small" aria-label={`Удалить ${it.name}`}
                  onClick={() => { void drop(it.id, it.value); }}
                  sx={{ position: 'absolute', top: 2, right: 2, p: 0.4, bgcolor: 'rgba(0,0,0,.6)', color: '#fff',
                    '&:hover': { bgcolor: 'rgba(0,0,0,.8)' } }}>
                  <DeleteOutline sx={{ fontSize: 15 }} />
                </IconButton>
              </Box>
            );
          })}
        </Box>
      )}
      {gapBg && (
        <SettingSlider label="Затемнение промежутков" disabled={!enabled}
          min={GAP_DIM_LIMITS.min} max={GAP_DIM_LIMITS.max} step={0.05} scale={100}
          value={gapDim} onChange={(v: number) => setGapDim(v)} />
      )}
    </Box>
  );
}

