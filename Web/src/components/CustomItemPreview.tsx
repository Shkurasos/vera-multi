import React from 'react';
import { Box } from '@mui/material';
import type { CustomSpec } from '../services/api';
import { specToStyle } from '../utils/customStyle';

interface Props {
  spec: CustomSpec;
  label?: string;
  size?: number;
}

/**
 * Универсальная превьюшка кастомного предмета. Используется в редакторе и
 * в карточках магазина. Показывает круглую/скруглённую плашку с указанным
 * стилем и опциональным текстом/эмодзи внутри.
 */
export default function CustomItemPreview({ spec, label, size = 120 }: Props) {
  const style = specToStyle(spec);
  return (
    <Box
      sx={{
        width: size, height: size,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', userSelect: 'none',
        transition: 'all 0.15s ease',
        ...style,
      }}
    >
      <Box sx={{ fontSize: size / 4 }}>
        {spec.emoji || label || ''}
      </Box>
    </Box>
  );
}
