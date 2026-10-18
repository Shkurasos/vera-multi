/** Вкладка «Картинка» в диалоге слота: превью, редактор и перекраска. */
import React, { useState } from 'react';
import { Box, Button, Typography, FormControlLabel, Switch } from '@mui/material';
import { Image as ImageIcon, Edit } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import IconImageEditor, { CHECKER_BG } from './IconImageEditor';

export default function IconSlotImageTab({ image, tint, onImage, onTint }: {
  image: string; tint: boolean; onImage: (src: string) => void; onTint: (v: boolean) => void;
}) {
  const theme = useThemeStore((s) => s.theme);
  const [drawOpen, setDrawOpen] = useState(false);
  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
      <Box sx={{ ...CHECKER_BG, width: 96, height: 96, borderRadius: 2, flexShrink: 0 }}>
        {image && <img src={image} alt="Картинка иконки" style={{ width: 96, height: 96, display: 'block' }} />}
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start' }}>
        <Button size="small" startIcon={image ? <Edit /> : <ImageIcon />} onClick={() => setDrawOpen(true)}
          sx={{ textTransform: 'none', color: theme.accent }}>
          {image ? 'Изменить: дорисовать, обрезать' : 'Нарисовать или загрузить'}
        </Button>
        <FormControlLabel
          control={<Switch size="small" checked={tint} onChange={(e) => onTint(e.target.checked)} />}
          label={<Typography sx={{ fontSize: 13 }}>Красить в цвет иконки</Typography>} />
        <Typography sx={{ fontSize: 11, color: theme.textSec }}>
          Вкл — картинка станет силуэтом цвета кнопки. Выкл — как есть, в цвете.
        </Typography>
      </Box>
      <IconImageEditor open={drawOpen} initial={image || null}
        onDone={(src) => { onImage(src); setDrawOpen(false); }} onClose={() => setDrawOpen(false)} />
    </Box>
  );
}
