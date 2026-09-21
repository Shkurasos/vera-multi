import { Box, FormControlLabel, Slider, Switch, Typography } from '@mui/material';

import { bubbleLimits, BubbleSettings, clampBubble } from '../utils/bubbleSettings';
export default function BubbleSettingsControls({ value, onChange }: {
  value: BubbleSettings; onChange: (patch: Partial<BubbleSettings>) => void;
}) {
  return <Box>
    <FormControlLabel label="Показывать пузыри сообщений" control={<Switch checked={value.enabled} onChange={(_, enabled) => onChange({ enabled })} />} />
    {(['maxWidth', 'padding', 'textSize'] as const).map(key => <Box key={key} sx={{ mb: 2 }}>
      <Typography variant="body2">{key === 'maxWidth' ? 'Максимальная ширина пузыря' : key === 'padding' ? 'Высота пузыря (отступ сверху и снизу)' : 'Размер текста'}: {value[key]}{key === 'maxWidth' ? '%' : 'px'}</Typography>
      <Slider aria-label={key === 'maxWidth' ? 'Ширина пузыря' : key === 'padding' ? 'Высота пузыря' : 'Размер текста'} min={bubbleLimits[key][0]} max={bubbleLimits[key][1]} step={1} value={clampBubble(key, value[key])} onChange={(_, v) => onChange({ [key]: clampBubble(key, v as number) })} />
    </Box>)}
  </Box>;
}