import React from 'react';
import { Box, Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, FormControlLabel, Switch, TextField, Slider, Typography, ToggleButtonGroup, ToggleButton, Alert } from '@mui/material';
import { MusicVisualizerSettings, VisualizerPlacement, VisualizerReactiveMode, VisualizerStyle, VisualizerTheme, visualizerThemes } from '../store/musicVisualizerStore';

interface Props {
  open: boolean;
  title: string;
  settings: MusicVisualizerSettings;
  onChange: (patch: Partial<MusicVisualizerSettings>) => void;
  onClose: () => void;
  systemAudioReactive?: boolean;
  onSystemAudioReactiveChange?: (v: boolean) => void;
}

export default function MusicVisualizerSettingsDialog({ open, title, settings, onChange, onClose, systemAudioReactive, onSystemAudioReactiveChange }: Props) {
  const setTheme = (theme: VisualizerTheme) => {
    const preset = visualizerThemes[theme];
    onChange(theme === 'custom' ? { theme } : { theme, color: preset.color, secondaryColor: preset.secondaryColor });
  };

  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" scroll="paper" PaperProps={{ sx: { maxHeight: '92vh' } }}>
    <DialogTitle>{title}</DialogTitle>
    <DialogContent dividers sx={{ overflowY: 'auto' }}>
      <Stack spacing={2.2} sx={{ pt: 1 }}>
        <Alert severity="info" sx={{ py: 0.5 }}>
          Расширенные настройки теперь сверху: положение, размер зоны, длина волны и размер свечения.
        </Alert>
        <FormControlLabel control={<Switch checked={settings.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />} label="Включить подсветку" />
        {onSystemAudioReactiveChange && (
          <Box sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.default' }}>
            <FormControlLabel
              control={<Switch checked={!!systemAudioReactive} onChange={(e) => onSystemAudioReactiveChange(e.target.checked)} />}
              label="Реагировать на звук устройства"
            />
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              Подсветка будет анимироваться под любой звук, а не только под трек плеера. При включении откроется системный диалог — выберите экран и обязательно отметьте «Поделиться звуком».
            </Typography>
          </Box>
        )}
        <Box sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'primary.main', bgcolor: 'background.default' }}>
          <Typography fontWeight={800} fontSize={15} mb={0.5}>Расширенные настройки</Typography>
          <Typography variant="caption" color="text.secondary">Можно точно поставить подсветку в любое место экрана.</Typography>
        </Box>
        <Box sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.default' }}>
          <Typography fontWeight={700} fontSize={13} mb={1}>Положение на экране</Typography>
          <div><Typography variant="caption">Горизонтально: {settings.x}%</Typography><Slider min={0} max={100} step={1} value={settings.x} onChange={(_, v) => onChange({ x: v as number })} /></div>
          <div><Typography variant="caption">Вертикально: {settings.y}%</Typography><Slider min={0} max={100} step={1} value={settings.y} onChange={(_, v) => onChange({ y: v as number })} /></div>
        </Box>
        <Box sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.default' }}>
          <Typography fontWeight={700} fontSize={13} mb={1}>Размер подсветки</Typography>
          <div><Typography variant="caption">Ширина зоны: {settings.width}% экрана</Typography><Slider min={8} max={100} step={1} value={settings.width} onChange={(_, v) => onChange({ width: v as number })} /></div>
          <div><Typography variant="caption">Высота зоны: {settings.height}px</Typography><Slider min={24} max={600} step={4} value={settings.height} onChange={(_, v) => onChange({ height: v as number })} /></div>
          <div><Typography variant="caption">Длина волны/полос: {settings.waveLength}%</Typography><Slider min={20} max={220} step={5} value={settings.waveLength} onChange={(_, v) => onChange({ waveLength: v as number })} /></div>
          <div><Typography variant="caption">Размер свечения: {settings.glowSize}%</Typography><Slider min={20} max={220} step={5} value={settings.glowSize} onChange={(_, v) => onChange({ glowSize: v as number })} /></div>
        </Box>
        <div><Typography variant="caption">Тема подсветки</Typography><ToggleButtonGroup exclusive fullWidth size="small" value={settings.theme} onChange={(_, v: VisualizerTheme | null) => v && setTheme(v)}>{Object.entries(visualizerThemes).map(([key, theme]) => <ToggleButton key={key} value={key}><Box sx={{ width: 14, height: 14, borderRadius: '50%', mr: 0.7, background: `linear-gradient(135deg, ${theme.color}, ${theme.secondaryColor})`, border: '1px solid rgba(255,255,255,.35)' }} />{theme.label}</ToggleButton>)}</ToggleButtonGroup></div>
        <Stack direction="row" spacing={2}>
          <TextField label="Основной свет" type="color" value={settings.color} onChange={(e) => onChange({ theme: 'custom', color: e.target.value })} fullWidth />
          <TextField label="Второй свет" type="color" value={settings.secondaryColor} onChange={(e) => onChange({ theme: 'custom', secondaryColor: e.target.value })} fullWidth />
        </Stack>
        <div><Typography variant="caption">Сила свечения</Typography><Slider min={0.1} max={1.5} step={0.05} value={settings.intensity} onChange={(_, v) => onChange({ intensity: v as number })} /></div>
        <div><Typography variant="caption">Чувствительность к музыке</Typography><Slider min={0.4} max={2.5} step={0.05} value={settings.sensitivity} onChange={(_, v) => onChange({ sensitivity: v as number })} /></div>
        <div><Typography variant="caption">Прозрачность</Typography><Slider min={0.05} max={1} step={0.05} value={settings.opacity} valueLabelDisplay="auto" onChange={(_, v) => onChange({ opacity: v as number })} /></div>
        <div><Typography variant="caption">На что реагировать</Typography><ToggleButtonGroup exclusive fullWidth size="small" value={settings.mode} onChange={(_, v: VisualizerReactiveMode | null) => v && onChange({ mode: v })}><ToggleButton value="bass">Басс</ToggleButton><ToggleButton value="beat">Бит</ToggleButton><ToggleButton value="volume">Громкость</ToggleButton><ToggleButton value="spectrum">Спектр</ToggleButton></ToggleButtonGroup></div>
        <div><Typography variant="caption">Где показывать</Typography><ToggleButtonGroup exclusive fullWidth size="small" value={settings.placement} onChange={(_, v: VisualizerPlacement | null) => v && onChange({ placement: v })}><ToggleButton value="bottom">Снизу</ToggleButton><ToggleButton value="top">Сверху</ToggleButton><ToggleButton value="sides">По бокам</ToggleButton><ToggleButton value="full">Фон</ToggleButton><ToggleButton value="player">Плеер</ToggleButton></ToggleButtonGroup></div>
        <div><Typography variant="caption">Режим отображения</Typography><ToggleButtonGroup exclusive fullWidth size="small" value={settings.style} onChange={(_, v: VisualizerStyle | null) => v && onChange({ style: v })}><ToggleButton value="glow">Свечение</ToggleButton><ToggleButton value="bars">Полосы</ToggleButton><ToggleButton value="pulse">Пульс</ToggleButton><ToggleButton value="wave">Волны</ToggleButton></ToggleButtonGroup></div>
      </Stack>
    </DialogContent>
    <DialogActions><Button onClick={onClose}>Готово</Button></DialogActions>
  </Dialog>;
}