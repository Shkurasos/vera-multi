import React, { useEffect, useState } from 'react';
import { Box, Typography, Button, CircularProgress, Tooltip } from '@mui/material';
import { useStickerStore } from '../store/stickerStore';
import { useThemeStore } from '../store/themeStore';
import { useMiniAppStore } from '../store/miniAppStore';
import type { Sticker } from '../services/api';

/** /uploads/... → абсолютный адрес (как resolveFileUrl в MessageBubble). */
export function resolveStickerUrl(url?: string): string {
  const value = String(url || '');
  if (/^\/uploads\/stickers\/[A-Za-z0-9-]+\.webp$/.test(value)) return window.location.origin + value;
  return '';
}

/**
 * Панель стикеров у поля ввода: вкладки наборов из своей панели, сетка
 * стикеров. Пустая панель предлагает открыть мини-приложение стикеров.
 */
export default function StickerPicker({ onPick, disabled }: { onPick: (sticker: Sticker) => void; disabled?: boolean }) {
  const theme = useThemeStore((s) => s.theme);
  const { installed, loaded, loading, error, load } = useStickerStore();
  const openMiniApp = useMiniAppStore((s) => s.open);
  const [packId, setPackId] = useState<string | null>(null);

  useEffect(() => { void load(); }, [load]);
  const pack = installed.find((p) => p.id === packId) || installed[0];

  if (!loaded) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        {loading ? <CircularProgress size={22} /> : <Typography sx={{ color: theme.textSec, fontSize: 13 }}>{error || 'Стикеры не загрузились'}</Typography>}
      </Box>
    );
  }

  if (!installed.length) {
    return (
      <Box sx={{ p: 2, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'center' }}>
        <Typography sx={{ color: theme.textSec, fontSize: 13 }}>У вас пока нет стикеров</Typography>
        <Button size="small" variant="outlined" onClick={() => openMiniApp({ kind: 'stickers' })} sx={{ textTransform: 'none' }}>
          Открыть стикеры
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      <Box role="tablist" aria-label="Наборы стикеров" sx={{ display: 'flex', gap: 0.5, overflowX: 'auto', pb: 0.75, mb: 0.75, borderBottom: `1px solid ${theme.border}` }}>
        {installed.map((p) => {
          const active = p.id === pack?.id;
          const cover = p.stickers[0];
          return (
            <Tooltip key={p.id} title={p.title}>
              <Box component="button" type="button" role="tab" aria-selected={active} aria-label={p.title} onClick={() => setPackId(p.id)}
                sx={{ all: 'unset', flexShrink: 0, width: 36, height: 36, borderRadius: 1.5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  bgcolor: active ? theme.accent + '33' : 'transparent', '&:hover': { bgcolor: theme.bgHover }, '&:focus-visible': { outline: `2px solid ${theme.accent}` } }}>
                {cover
                  ? <img src={resolveStickerUrl(cover.fileUrl)} alt="" style={{ width: 28, height: 28, objectFit: 'contain' }} />
                  : <Typography sx={{ fontSize: 11, color: theme.textSec }}>{p.title.slice(0, 2)}</Typography>}
              </Box>
            </Tooltip>
          );
        })}
        <Tooltip title="Управлять стикерами">
          <Box component="button" type="button" aria-label="Открыть мини-приложение стикеров" onClick={() => openMiniApp({ kind: 'stickers' })}
            sx={{ all: 'unset', flexShrink: 0, width: 36, height: 36, borderRadius: 1.5, cursor: 'pointer', textAlign: 'center', lineHeight: '36px', color: theme.textSec, fontSize: 20,
              '&:hover': { bgcolor: theme.bgHover }, '&:focus-visible': { outline: `2px solid ${theme.accent}` } }}>
            +
          </Box>
        </Tooltip>
      </Box>
      {pack && pack.stickers.length === 0 && (
        <Typography sx={{ color: theme.textSec, fontSize: 13, textAlign: 'center', py: 2 }}>В наборе «{pack.title}» пока нет стикеров</Typography>
      )}
      <Box role="tabpanel" sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0.5, maxHeight: 260, overflowY: 'auto' }}>
        {pack?.stickers.map((s) => (
          <Box key={s.id} component="button" type="button" disabled={disabled} aria-label={`Отправить стикер ${s.emoji}`} onClick={() => onPick(s)}
            sx={{ all: 'unset', aspectRatio: '1', borderRadius: 1.5, cursor: disabled ? 'default' : 'pointer', p: 0.5, boxSizing: 'border-box',
              transition: 'transform .1s', '&:hover:not(:disabled)': { bgcolor: theme.bgHover, transform: 'scale(1.06)' }, '&:focus-visible': { outline: `2px solid ${theme.accent}` } }}>
            <img src={resolveStickerUrl(s.fileUrl)} alt={s.emoji} loading="lazy" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}
