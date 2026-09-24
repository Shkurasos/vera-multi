import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, Divider as MuiDivider, MenuItem, Select, Tooltip, Typography,
} from '@mui/material';
import { useThemeStore } from '../store/themeStore';
import { useCustomFontsStore } from '../store/customFontsStore';
import { FONT_FILE_ACCEPT, customFontCss, formatFontSize } from '../utils/customFonts';

export interface FontOption {
  /** Значение для настроек: CSS font-family или служебное ('inherit' / 'default'). */
  value: string;
  label: string;
}

interface Props {
  /** Текущее выбранное значение. */
  value: string;
  onChange: (value: string) => void;
  /** Встроенные варианты — свои шрифты добавляются к ним автоматически. */
  baseOptions: FontOption[];
  /** Показывать загрузку и удаление своих шрифтов. */
  manage?: boolean;
  /** Пояснение под селектом. */
  hint?: string;
  /** Компактные отступы — для модалок настроек чата. */
  dense?: boolean;
  ariaLabel?: string;
}

/**
 * Выбор шрифта + управление своими шрифтами: один компонент на «шрифт всего
 * приложения» (SettingsDialog) и на шрифты чата (ChatWindow). Файлы своих
 * шрифтов лежат в IndexedDB (см. customFontsStore), поэтому список везде общий.
 */
export default function FontPicker({
  value, onChange, baseOptions, manage, hint, dense, ariaLabel,
}: Props) {
  const theme = useThemeStore((s) => s.theme);
  const fonts = useCustomFontsStore((s) => s.fonts);
  const busy = useCustomFontsStore((s) => s.busy);
  const error = useCustomFontsStore((s) => s.error);
  const hydrate = useCustomFontsStore((s) => s.hydrate);
  const addFont = useCustomFontsStore((s) => s.addFont);
  const removeFont = useCustomFontsStore((s) => s.removeFont);
  const clearError = useCustomFontsStore((s) => s.clearError);
  const fileRef = useRef<HTMLInputElement>(null);

  // Шрифты читаются из IndexedDB; повторный вызов безопасен (см. hydrate).
  useEffect(() => { void hydrate(); }, [hydrate]);

  const customOptions = fonts.map((font) => ({ font, value: customFontCss(font.family) }));
  // Шрифт могли удалить или он загружен на другом устройстве — показываем
  // значение как есть, чтобы селект не выглядел пустым.
  const known = baseOptions.some((option) => option.value === value)
    || customOptions.some((option) => option.value === value);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    const font = await addFont(file);
    if (font) onChange(customFontCss(font.family));
  };

  return (
    <Box>
      <Select
        fullWidth
        size="small"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputProps={ariaLabel ? { 'aria-label': ariaLabel } : undefined}
        // Превью шрифтов в меню остаются своими даже когда глобальный шрифт
        // применяется через `!important` (см. utils/appFont.ts).
        MenuProps={{ PaperProps: { 'data-font-preview': true } as React.HTMLAttributes<HTMLDivElement> }}
        sx={{ fontFamily: value, '& .MuiSelect-select': dense ? { py: 1 } : undefined }}
      >
        {baseOptions.map((option) => (
          <MenuItem key={option.value} value={option.value} sx={{ fontFamily: option.value }}>
            {option.label}
          </MenuItem>
        ))}
        {customOptions.length > 0 && <MuiDivider />}
        {customOptions.map(({ font, value: css }) => (
          <MenuItem key={font.id} value={css} sx={{ fontFamily: css }}>
            {font.fileName} · свой
          </MenuItem>
        ))}
        {!known && (
          <MenuItem value={value} sx={{ fontFamily: value }}>{value} · нет на устройстве</MenuItem>
        )}
      </Select>

      {manage && (
        <>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept={FONT_FILE_ACCEPT}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              void pickFile(file);
            }}
          />
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mt: 1 }}>
            <Button
              variant="outlined"
              size="small"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              sx={{ color: theme.accent, borderColor: theme.accent + '60', textTransform: 'none', borderRadius: 2 }}
            >
              📁 {busy ? 'Сохраняю…' : 'Загрузить свой шрифт'}
            </Button>
            <Typography sx={{ fontSize: 11, color: theme.textSec }}>
              .ttf / .otf / .woff / .woff2, до 12 МБ
            </Typography>
          </Box>
          {fonts.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
              {fonts.map((font) => (
                <Tooltip key={font.id} title={`${font.family} · ${formatFontSize(font.size)}`}>
                  <Chip
                    disabled={busy}
                    onDelete={() => void removeFont(font.id)}
                    label={(
                      <Box component="span" data-font-preview sx={{ fontFamily: customFontCss(font.family), fontSize: 12 }}>
                        {font.fileName}
                      </Box>
                    )}
                    sx={{ bgcolor: theme.bgInput, color: theme.text, border: `1px solid ${theme.border}` }}
                  />
                </Tooltip>
              ))}
            </Box>
          )}
          <Typography sx={{ fontSize: 11, color: theme.textSec, mt: 0.5 }}>
            Свои шрифты хранятся локально на этом устройстве и доступны и в приложении, и в чатах.
          </Typography>
        </>
      )}

      {manage && error && (
        <Alert severity="error" sx={{ mt: 1, fontSize: 12 }} onClose={clearError}>{error}</Alert>
      )}
      {hint && <Alert severity="info" sx={{ mt: 1, fontSize: 12 }}>{hint}</Alert>}
    </Box>
  );
}
