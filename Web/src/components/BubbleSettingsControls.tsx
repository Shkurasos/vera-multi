import { Box, FormControlLabel, Slider, Switch, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';

import { bubbleLimits, BubbleMetaPos, BubbleSettings, clampBubble } from '../utils/bubbleSettings';
import { useThemeStore } from '../store/themeStore';
import { SettingRow, SettingSlider } from './SettingRow';

const SIZE_ROWS = [
  ['maxWidth', 'Максимальная ширина пузыря, %'],
  ['padding', 'Высота пузыря, px'],
  ['textSize', 'Размер текста, px'],
] as const;

/** Сетка 3×3: куда поставить время и галочки внутри пузыря. */
const META_CELLS: { value: BubbleMetaPos; glyph: string; title: string }[] = [
  { value: 'topLeft', glyph: '↖', title: 'Сверху слева' },
  { value: 'top', glyph: '↑', title: 'Сверху' },
  { value: 'topRight', glyph: '↗', title: 'Сверху справа' },
  { value: 'middleLeft', glyph: '←', title: 'По середине слева' },
  { value: 'center', glyph: '•', title: 'По середине' },
  { value: 'middleRight', glyph: '→', title: 'По середине справа' },
  { value: 'bottomLeft', glyph: '↙', title: 'Снизу слева' },
  { value: 'bottom', glyph: '↓', title: 'Снизу' },
  { value: 'bottomRight', glyph: '↘', title: 'Снизу справа' },
];

function MetaPosGrid({ labelId, value, onChange }: {
  labelId: string; value: BubbleMetaPos; onChange: (v: BubbleMetaPos) => void;
}) {
  const theme = useThemeStore((s) => s.theme);
  return (
    <ToggleButtonGroup
      exclusive size="small"
      aria-labelledby={labelId}
      value={value}
      onChange={(_, v: BubbleMetaPos | null) => { if (v) onChange(v); }}
      sx={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 44px)', gap: 0.5,
        '& .MuiToggleButton-root': {
          fontSize: 16, py: 0.25, color: theme.textSec,
          border: `1px solid ${theme.border} !important`, borderRadius: '6px !important', m: 0,
          '&.Mui-selected': { bgcolor: theme.accent + '25', color: theme.text, borderColor: `${theme.accent} !important` },
        },
      }}
    >
      {META_CELLS.map(c => (
        <ToggleButton key={c.value} value={c.value} title={c.title} aria-label={c.title}>{c.glyph}</ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

/** Те же настройки строками SettingRow: подписи совпадают с индексом поиска редактора тем. */
function BubbleSettingsRows({ value, onChange }: {
  value: BubbleSettings; onChange: (patch: Partial<BubbleSettings>) => void;
}) {
  return <Box>
    <SettingRow label="Показывать пузыри сообщений">
      <Switch checked={value.enabled} onChange={(_, enabled) => onChange({ enabled })}
        inputProps={{ 'aria-label': 'Показывать пузыри сообщений' }} />
    </SettingRow>
    <SettingRow label="Выравнивание по стенке" hint="Текст прижат к своей стороне">
      <Switch checked={value.wallAlign} onChange={(_, wallAlign) => onChange({ wallAlign })}
        inputProps={{ 'aria-label': 'Выравнивание по стенке' }} />
    </SettingRow>
    <SettingRow label="Время и галочки в своём сообщении" labelId="bubble-meta-pos-own-row-label"
      hint="Где в вашем пузыре стоят время и галочки: сверху, по середине или снизу.">
      <MetaPosGrid labelId="bubble-meta-pos-own-row-label" value={value.metaPosOwn}
        onChange={(v) => onChange({ metaPosOwn: v })} />
    </SettingRow>
    <SettingRow label="Время и галочки в чужом сообщении" labelId="bubble-meta-pos-other-row-label"
      hint="То же для сообщений собеседника — настраивается отдельно.">
      <MetaPosGrid labelId="bubble-meta-pos-other-row-label" value={value.metaPosOther}
        onChange={(v) => onChange({ metaPosOther: v })} />
    </SettingRow>
    {SIZE_ROWS.map(([key, label]) => (
      <SettingSlider key={key} label={label}
        hint={key === 'maxWidth' ? 'Не действует на сообщения с фото и видео: там ширина — это ширина самого фото.' : undefined}
        min={bubbleLimits[key][0]} max={bubbleLimits[key][1]} step={1}
        value={clampBubble(key, value[key])}
        onChange={(v) => onChange({ [key]: clampBubble(key, v) })} />
    ))}
  </Box>;
}

export default function BubbleSettingsControls({ value, onChange, variant = 'stack' }: {
  value: BubbleSettings; onChange: (patch: Partial<BubbleSettings>) => void;
  /** 'rows' — строками «название слева, контрол справа» для редактора тем. */
  variant?: 'stack' | 'rows';
}) {
  if (variant === 'rows') return <BubbleSettingsRows value={value} onChange={onChange} />;
  return <Box>
    <FormControlLabel label="Показывать пузыри сообщений" control={<Switch checked={value.enabled} onChange={(_, enabled) => onChange({ enabled })} />} />
    <FormControlLabel
      label="Выравнивание по стенке (текст прижат к своей стороне)"
      control={<Switch checked={value.wallAlign} onChange={(_, wallAlign) => onChange({ wallAlign })} />}
    />
    <Box sx={{ mb: 2 }}>
      <Typography variant="body2" id="bubble-meta-pos-own-label" sx={{ mb: 0.5 }}>Время и галочки в своём сообщении</Typography>
      <MetaPosGrid labelId="bubble-meta-pos-own-label" value={value.metaPosOwn}
        onChange={(v) => onChange({ metaPosOwn: v })} />
    </Box>
    <Box sx={{ mb: 2 }}>
      <Typography variant="body2" id="bubble-meta-pos-other-label" sx={{ mb: 0.5 }}>Время и галочки в чужом сообщении</Typography>
      <MetaPosGrid labelId="bubble-meta-pos-other-label" value={value.metaPosOther}
        onChange={(v) => onChange({ metaPosOther: v })} />
    </Box>
    {(['maxWidth', 'padding', 'textSize'] as const).map(key => <Box key={key} sx={{ mb: 2 }}>
      <Typography variant="body2">{key === 'maxWidth' ? 'Максимальная ширина пузыря' : key === 'padding' ? 'Высота пузыря (отступ сверху и снизу)' : 'Размер текста'}: {value[key]}{key === 'maxWidth' ? '%' : 'px'}</Typography>
      {key === 'maxWidth' && <Typography variant="caption" sx={{ display: 'block', opacity: 0.7 }}>На сообщения с фото и видео не действует — ширина берётся по фото.</Typography>}
      <Slider aria-label={key === 'maxWidth' ? 'Ширина пузыря' : key === 'padding' ? 'Высота пузыря' : 'Размер текста'} min={bubbleLimits[key][0]} max={bubbleLimits[key][1]} step={1} value={clampBubble(key, value[key])} onChange={(_, v) => onChange({ [key]: clampBubble(key, v as number) })} />
    </Box>)}
  </Box>;
}
