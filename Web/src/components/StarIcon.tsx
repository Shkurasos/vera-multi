import React from 'react';
import { SvgIcon, SvgIconProps } from '@mui/material';

/**
 * Кастомная иконка звезды для "Избранного".
 * Адаптируется под акцентный цвет темы через sx prop.
 */
export default function StarIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <path
        d="M12 2 L15.09 8.26 L22 9.27 L17 14.14 L18.18 21.02 L12 17.77 L5.82 21.02 L7 14.14 L2 9.27 L8.91 8.26 Z"
        fill="currentColor"
      />
    </SvgIcon>
  );
}
