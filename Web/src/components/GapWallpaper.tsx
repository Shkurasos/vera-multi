/**
 * Фото в промежутках вокруг окна чата (см. utils/gapWallpaper.ts).
 *
 * Рисуются только полосы толщиной в отступ окна чата, а не фото целиком под
 * интерфейсом: окно чата непрозрачное, и всё, что под ним, было бы лишней
 * работой для браузера. Общий фон с background-attachment: fixed склеивает
 * полосы в одну картинку, как будто фото лежит под всем окном.
 */
import React from 'react';
import { Box } from '@mui/material';
import { useChatBgPrefsStore } from '../store/chatBgPrefsStore';
import { usePhotoBgUrl } from '../hooks/usePhotoBgUrl';
import { gapBackground, gapStrips, hasLayoutGap } from '../utils/gapWallpaper';

export default function GapWallpaper({ margin }: { margin: number }) {
  const gapBg = useChatBgPrefsStore((s) => s.gapBg);
  const gapDim = useChatBgPrefsStore((s) => s.gapDim);
  // Без промежутка фото не грузим вовсе.
  const url = usePhotoBgUrl(hasLayoutGap(margin) ? gapBg : null);
  if (!url) return null;
  const background = gapBackground(url, gapDim);
  return (
    <Box aria-hidden data-gap-wallpaper sx={{
      position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
      // На узком экране отступа у окна чата нет (m: { xs: 0, md: … }).
      display: { xs: 'none', md: 'block' },
    }}>
      {gapStrips(margin).map((strip) => (
        <Box key={strip.key} sx={{
          position: 'absolute', ...strip.style,
          backgroundImage: background,
          backgroundSize: 'cover', backgroundPosition: 'center',
          backgroundAttachment: 'fixed',
          backgroundRepeat: 'no-repeat',
        }} />
      ))}
    </Box>
  );
}
