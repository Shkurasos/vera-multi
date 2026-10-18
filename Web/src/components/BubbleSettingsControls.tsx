import { Box, FormControlLabel, Slider, Switch, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';

import { bubbleLimits, BubbleMetaPos, BubbleSettings, clampBubble } from '../utils/bubbleSettings';

// Подписи вариантов «где время и галочки». Схема ниже — мини-превью:
// «▭» — текст, «12:00✓» — время с галочкой.
const META_OPTIONS: { value: BubbleMetaPos; label: string; title: string }[] = [
  { value: 'inlineRight', label: 'Текст 12:00✓', title: 'В строке с текстом, справа' },
  { value: 'inlineLeft', label: '12:00✓ Текст', title: 'В строке с текстом, слева' },
  { value: 'belowRight', label: 'Снизу →', title: 'Отдельной строкой снизу справа' },
  { value: 'belowLeft', label: '← Снизу', title: 'Отдельной строкой снизу слева' },
  { value: 'belowWall', label: 'У стенки', title: 'Отдельной строкой со стороны стенки: у своих справа, у чужих слева' },
];

export default function BubbleSettingsControls({ value, onChange }: {
  value: BubbleSettings; onChange: (patch: Partial<BubbleSettings>) => void;
}) {
  return <Box>
    <FormControlLabel label="Показывать пузыри сообщений" control={<Switch checked={value.enabled} onChange={(_, enabled) => onChange({ enabled })} />} />
    <FormControlLabel
      label="Выравнивание по стенке (текст прижат к своей стороне)"
      control={<Switch checked={value.wallAlign} onChange={(_, wallAlign) => onChange({ wallAlign })} />}
    />
    <Box sx={{ mb: 2 }}>
      <Typography variant="body2" id="bubble-meta-pos-label" sx={{ mb: 0.5 }}>Время и галочки в пузыре</Typography>
      <ToggleButtonGroup
        exclusive size="small" fullWidth
        aria-labelledby="bubble-meta-pos-label"
        value={value.metaPos}
        onChange={(_, v) => v && onChange({ metaPos: v as BubbleMetaPos })}
        sx={{ flexWrap: 'wrap', '& .MuiToggleButton-root': { textTransform: 'none', fontSize: 12, px: 0.75 } }}
      >
        {META_OPTIONS.map(o => (
          <ToggleButton key={o.value} value={o.value} title={o.title} aria-label={o.title}>{o.label}</ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
    {(['maxWidth', 'padding', 'textSize'] as const).map(key => <Box key={key} sx={{ mb: 2 }}>
      <Typography variant="body2">{key === 'maxWidth' ? 'Максимальная ширина пузыря' : key === 'padding' ? 'Высота пузыря (отступ сверху и снизу)' : 'Размер текста'}: {value[key]}{key === 'maxWidth' ? '%' : 'px'}</Typography>
      <Slider aria-label={key === 'maxWidth' ? 'Ширина пузыря' : key === 'padding' ? 'Высота пузыря' : 'Размер текста'} min={bubbleLimits[key][0]} max={bubbleLimits[key][1]} step={1} value={clampBubble(key, value[key])} onChange={(_, v) => onChange({ [key]: clampBubble(key, v as number) })} />
    </Box>)}
  </Box>;
}