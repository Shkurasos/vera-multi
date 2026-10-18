import React, { useEffect, useState } from 'react';
import { Slider, Stack, TextField, type SliderProps } from '@mui/material';

/**
 * Слайдер с маленьким полем ввода справа: значение можно перетащить или
 * вписать числом. Ввод применяется по Enter или при уходе фокуса, значение
 * зажимается в [min, max] и привязывается к шагу.
 *
 * `scale` — множитель для отображения в поле: для долей (0.5…1.5) удобнее
 * вводить проценты (50…150), поэтому там передаётся scale={100}.
 */
type Props = Omit<SliderProps, 'value' | 'onChange' | 'min' | 'max' | 'step' | 'scale'> & {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  scale?: number;
  /** Подпись поля для скринридеров; по умолчанию берётся aria-label слайдера. */
  inputLabel?: string;
};

/** Убирает хвосты float-арифметики (0.1 + 0.2 → 0.3) по точности шага. */
function roundTo(v: number, step: number): number {
  const decimals = (String(step).split('.')[1] || '').length;
  return Number(v.toFixed(decimals));
}

export default function SliderWithInput({
  value, onChange, min, max, step = 1, scale = 1, inputLabel, sx, disabled, ...rest
}: Props) {
  const toText = (v: number) => String(roundTo(v * scale, step * scale < 1 ? step * scale : 1));
  const [text, setText] = useState(toText(value));

  // Слайдер и внешние сбросы меняют value — поле следует за ним.
  useEffect(() => { setText(toText(value)); }, [value, scale]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    const parsed = parseFloat(text.replace(',', '.'));
    if (!Number.isFinite(parsed)) { setText(toText(value)); return; }
    const clamped = Math.min(max, Math.max(min, parsed / scale));
    const snapped = roundTo(min + Math.round((clamped - min) / step) * step, step);
    const next = Math.min(max, Math.max(min, snapped));
    setText(toText(next));
    if (next !== value) onChange(next);
  };

  const ariaLabel = inputLabel || (rest as { 'aria-label'?: string })['aria-label'] || 'Значение';

  return (
    // flex: 1, minWidth: 0 — внутри строкового Stack (иконки громкости рядом)
    // слайдер иначе схлопывается до нуля: поле ввода 72px не даёт стеку
    // сузиться, а слайдер с flex:1 вытесняется. В обычном блоке flex:1
    // безвреден — родитель не флекс.
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
      <Slider
        {...rest}
        value={value}
        min={min} max={max} step={step}
        disabled={disabled}
        onChange={(_, v) => onChange(roundTo(Array.isArray(v) ? v[0] : v, step))}
        sx={[{ flex: 1, minWidth: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}
      />
      <TextField
        size="small"
        type="number"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { setText(toText(value)); (e.target as HTMLInputElement).blur(); }
        }}
        inputProps={{
          min: min * scale, max: max * scale, step: step * scale,
          'aria-label': ariaLabel, inputMode: 'decimal',
        }}
        sx={{
          width: 72, flexShrink: 0,
          '& .MuiInputBase-root': { height: 30, fontSize: 13 },
          '& input': { textAlign: 'center', px: 0.75, py: 0.5 },
        }}
      />
    </Stack>
  );
}
