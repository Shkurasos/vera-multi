import React, { useId } from 'react';
import { Box, Typography } from '@mui/material';
import { useThemeStore } from '../store/themeStore';
import SliderWithInput from './SliderWithInput';

/**
 * Строка настройки в духе настроек CS2: название слева, элемент управления
 * справа, между строками — тонкая линия. На узком экране контрол переносится
 * под название.
 *
 * data-setting-label — метка для поиска в редакторе тем: по ней он находит
 * строку и прокручивает к ней.
 */
export function SettingRow({ label, hint, children, stacked, wide, disabled, labelId }: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  /** Контрол под названием на всю ширину — для широких групп кнопок и полей. */
  stacked?: boolean;
  /** Контролу справа нужна ширина (ползунок, группа кнопок), а не только «по содержимому». */
  wide?: boolean;
  disabled?: boolean;
  /** Свой id подписи — если на него ссылается контрол через aria-labelledby. */
  labelId?: string;
}) {
  const theme = useThemeStore((s) => s.theme);
  const autoId = useId();
  const id = labelId || `setting-${autoId}`;
  return (
    <Box
      data-setting-label={label}
      sx={{
        display: 'flex', flexWrap: stacked ? 'nowrap' : 'wrap',
        flexDirection: stacked ? 'column' : 'row',
        alignItems: stacked ? 'stretch' : 'center', justifyContent: 'space-between',
        columnGap: 2, rowGap: 1, py: 1.25, px: 0.25,
        borderBottom: `1px solid ${theme.border}`,
        // Скругляем только верх (для подсветки из поиска): со скруглённым
        // низом линия-разделитель загибалась на концах.
        borderRadius: '6px 6px 0 0',
      }}
    >
      <Box sx={{ minWidth: 0, flex: stacked ? undefined : '1 1 220px' }}>
        <Typography id={id} sx={{ fontSize: 14, color: disabled ? theme.textSec : theme.text }}>{label}</Typography>
        {hint && <Typography component="div" sx={{ fontSize: 12, color: theme.textSec, mt: 0.25 }}>{hint}</Typography>}
      </Box>
      <Box
        role="group" aria-labelledby={id}
        sx={{
          display: 'flex', alignItems: 'center', justifyContent: stacked ? 'stretch' : 'flex-end',
          minWidth: 0, ml: stacked ? 0 : 'auto',
          flex: stacked ? undefined : wide ? '0 1 440px' : '0 0 auto',
          '& > *': stacked || wide ? { flex: 1, minWidth: 0 } : undefined,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

/**
 * Вид группы вариантов (ToggleButtonGroup): каждая кнопка — отдельная плашка,
 * при нехватке места кнопки переносятся на следующую строку.
 *
 * Склеенная группа MUI тут не годится: с fullWidth каждая кнопка получает
 * width: 100%, и при flexWrap: 'wrap' встаёт в свою строку — варианты шли
 * столбиком, а у средних кнопок пропадали левая рамка и скругления.
 * Скругление кнопки можно задать переменной --vera-choice-radius.
 */
export function choiceGroupSx(theme: { border: string; accent: string; text: string; textSec: string }) {
  return {
    flexWrap: 'wrap' as const,
    gap: 0.5,
    '& .MuiToggleButton-root': {
      flex: '1 1 auto', width: 'auto', minWidth: 0,
      margin: '0 !important',
      textTransform: 'none', fontSize: 12.5, lineHeight: 1.3, py: 0.625, px: 1.25,
      color: theme.textSec,
      border: `1px solid ${theme.border} !important`,
      borderRadius: 'var(--vera-choice-radius, 8px) !important',
      '&.Mui-selected': { bgcolor: theme.accent + '25', color: theme.text, borderColor: `${theme.accent} !important` },
      '&.Mui-selected:hover': { bgcolor: theme.accent + '35' },
    },
  };
}

/** Строка с ползунком и полем ввода справа. */
export function SettingSlider({ label, hint, disabled, ...slider }: {
  label: string;
  hint?: React.ReactNode;
} & React.ComponentProps<typeof SliderWithInput>) {
  return (
    <SettingRow label={label} hint={hint} disabled={disabled} wide>
      <SliderWithInput {...slider} disabled={disabled} aria-label={label} inputLabel={label} />
    </SettingRow>
  );
}

/** Заголовок группы строк — спокойный текст над ними, как «Video» в CS2. */
export function SettingSection({ title, hint }: { title: string; hint?: React.ReactNode }) {
  const theme = useThemeStore((s) => s.theme);
  return (
    <Box data-setting-label={title} sx={{ mt: 3.5, mb: 0.25, '&:first-of-type': { mt: 0 } }}>
      <Typography component="h3" sx={{ fontSize: 13.5, fontWeight: 600, color: theme.textSec, m: 0 }}>{title}</Typography>
      {hint && <Typography component="div" sx={{ fontSize: 12, color: theme.textSec, opacity: 0.85, mt: 0.25 }}>{hint}</Typography>}
    </Box>
  );
}
