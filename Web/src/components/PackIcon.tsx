/**
 * Иконка слота в стиле нужного пака с нужными заменами — для превью в
 * редакторе паков и в каталоге. data-icon-preview включает CSS стилевого
 * пака (рельеф, неон…) только внутри превью.
 */
import React from 'react';
import { Box } from '@mui/material';
import { IconBySlot } from '../mui-icons-shim';
import { CustomIconsOverrideContext, IconPackOverrideContext } from '../iconPackContext';
import type { CustomIcon } from '../utils/iconPackFormat';

export const NO_REPLACEMENTS: Record<string, CustomIcon> = {};

export default function PackIcon({ slot, base, icons, size = 24 }: {
  slot: string; base: string; icons: Record<string, CustomIcon>; size?: number;
}) {
  return (
    <IconPackOverrideContext.Provider value={base}>
      <CustomIconsOverrideContext.Provider value={icons}>
        <Box component="span" data-icon-preview={base} aria-hidden
          sx={{ display: 'inline-flex', '& .MuiSvgIcon-root': { fontSize: size } }}>
          <IconBySlot slot={slot} />
        </Box>
      </CustomIconsOverrideContext.Provider>
    </IconPackOverrideContext.Provider>
  );
}
