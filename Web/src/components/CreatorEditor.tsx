import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Box, Typography, TextField, Button, Slider, Switch,
  FormControlLabel, MenuItem, Select, InputLabel, FormControl,
  IconButton, Stack, Divider, Tab, Tabs, Alert,
} from '@mui/material';
import { Close } from '@mui/icons-material';
import type { CustomItem, CustomSpec, CustomCategory } from '../services/api';
import { DEFAULT_CUSTOM_SPEC } from '../utils/customStyle';
import CustomItemPreview from './CustomItemPreview';

interface Props {
  open: boolean;
  initial?: CustomItem | null;
  onClose: () => void;
  onSave: (dto: {
    category: CustomCategory;
    name: string;
    description: string;
    price: number;
    spec: CustomSpec;
  }) => Promise<void> | void;
  saving?: boolean;
  isAdmin?: boolean;
}

const CATEGORIES: { id: CustomCategory; label: string }[] = [
  { id: 'profile',   label: 'Обводка профиля' },
  { id: 'selfcard',  label: 'Плашка сообщений' },
  { id: 'wallpaper', label: 'Обои' },
  { id: 'bubble',    label: 'Пузырь чата' },
];

/**
 * Визуальный конструктор кастомных предметов.
 * Все правки редактируют локальную копию spec; итог отправляется через onSave.
 * Live-превью справа рендерит `CustomItemPreview`.
 */
export default function CreatorEditor({ open, initial, onClose, onSave, saving, isAdmin }: Props) {
  const [tab, setTab] = useState<'bg' | 'border' | 'fx' | 'meta'>('bg');
  const [category, setCategory] = useState<CustomCategory>(initial?.category || 'profile');
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [price, setPrice] = useState<number>(initial?.price ?? 100);
  const [spec, setSpec] = useState<CustomSpec>(initial?.spec || DEFAULT_CUSTOM_SPEC);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setCategory(initial?.category || 'profile');
    setName(initial?.name || '');
    setDescription(initial?.description || '');
    setPrice(initial?.price ?? 100);
    setSpec(initial?.spec || DEFAULT_CUSTOM_SPEC);
    setError('');
    setTab('bg');
  }, [open, initial]);

  const update = <K extends keyof CustomSpec>(key: K, value: CustomSpec[K]) => {
    setSpec(s => ({ ...s, [key]: value }));
  };
  const patch = <K extends keyof CustomSpec>(key: K, patch: Partial<CustomSpec[K]>) => {
    setSpec(s => ({ ...s, [key]: { ...(s[key] as any), ...patch } }));
  };

  const handleSave = async () => {
    setError('');
    const nm = name.trim();
    if (!nm) { setError('Название обязательно.'); return; }
    if (price < 20 || price > 20000) { setError('Цена от 20 до 20000 ВП.'); return; }
    try {
      await onSave({ category, name: nm, description: description.trim(), price, spec });
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Не удалось сохранить.');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>
          {initial ? 'Редактировать предмет' : 'Создать предмет'}
        </Typography>
        <IconButton onClick={onClose}><Close /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 260px' }, gap: 3 }}>
          <Box>
            <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
              <Tab label="Фон" value="bg" />
              <Tab label="Рамка" value="border" />
              <Tab label="Эффекты" value="fx" />
              <Tab label="Мета" value="meta" />
            </Tabs>

            {tab === 'bg' && <BgEditor spec={spec} patch={patch} />}
            {tab === 'border' && <BorderEditor spec={spec} patch={patch} />}
            {tab === 'fx' && <FxEditor spec={spec} patch={patch} update={update} />}
            {tab === 'meta' && (
              <MetaEditor
                category={category} setCategory={setCategory}
                name={name} setName={setName}
                description={description} setDescription={setDescription}
                price={price} setPrice={setPrice}
                spec={spec} update={update} patch={patch}
                isAdmin={isAdmin}
              />
            )}
          </Box>
          <Box sx={{ position: { md: 'sticky' }, top: 0, alignSelf: 'start' }}>
            <Typography variant="caption" color="text.secondary">Превью</Typography>
            <Box sx={{
              mt: 1, p: 3, borderRadius: 2,
              background: 'repeating-conic-gradient(#2a2a3a 0% 25%, #1e1e2e 0% 50%) 50% / 20px 20px',
              display: 'flex', justifyContent: 'center',
            }}>
              <CustomItemPreview spec={spec} label={name || '?'} size={140} />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
              Цена: <b>{price} ВП</b>{!isAdmin && ' (комиссия 15%)'}
            </Typography>
            {!isAdmin && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Автору с покупки: <b>{Math.floor(price * 0.85)} ВП</b>
              </Typography>
            )}
          </Box>
        </Box>
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Отмена</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? 'Сохраняем...' : 'Сохранить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}


/* ── Sub-editors ────────────────────────────────────────────────────────── */

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Typography variant="body2" sx={{ minWidth: 100 }}>{label}</Typography>
      <input
        type="color"
        value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#7c6af7'}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 40, height: 32, border: 'none', background: 'transparent', cursor: 'pointer' }}
      />
      <TextField size="small" value={value} onChange={e => onChange(e.target.value)} sx={{ width: 120 }} />
    </Stack>
  );
}
function NumField({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}: {value}</Typography>
      <Slider value={value} min={min} max={max} step={step} onChange={(_, v) => onChange(Number(v))} />
    </Box>
  );
}

function BgEditor({ spec, patch }: { spec: CustomSpec; patch: any }) {
  return (
    <Stack spacing={2}>
      <FormControl size="small">
        <InputLabel>Тип фона</InputLabel>
        <Select label="Тип фона" value={spec.bg.type} onChange={e => patch('bg', { type: e.target.value as any })}>
          <MenuItem value="solid">Сплошной</MenuItem>
          <MenuItem value="linear">Линейный градиент</MenuItem>
          <MenuItem value="radial">Радиальный градиент</MenuItem>
        </Select>
      </FormControl>
      <ColorField label="Цвет 1" value={spec.bg.color1} onChange={v => patch('bg', { color1: v })} />
      {spec.bg.type !== 'solid' && (
        <ColorField label="Цвет 2" value={spec.bg.color2} onChange={v => patch('bg', { color2: v })} />
      )}
      {spec.bg.type === 'linear' && (
        <NumField label="Угол градиента" value={spec.bg.angle} min={0} max={360} onChange={v => patch('bg', { angle: v })} />
      )}
    </Stack>
  );
}

function BorderEditor({ spec, patch }: { spec: CustomSpec; patch: any }) {
  return (
    <Stack spacing={2}>
      <NumField label="Толщина" value={spec.border.width} min={0} max={12} onChange={v => patch('border', { width: v })} />
      <NumField label="Скругление углов" value={spec.border.radius} min={0} max={64} onChange={v => patch('border', { radius: v })} />
      <ColorField label="Цвет" value={spec.border.color} onChange={v => patch('border', { color: v })} />
      <FormControl size="small">
        <InputLabel>Стиль</InputLabel>
        <Select label="Стиль" value={spec.border.style} onChange={e => patch('border', { style: e.target.value as any })}>
          <MenuItem value="solid">Сплошная</MenuItem>
          <MenuItem value="dashed">Пунктир</MenuItem>
          <MenuItem value="dotted">Точки</MenuItem>
          <MenuItem value="double">Двойная</MenuItem>
        </Select>
      </FormControl>
    </Stack>
  );
}

function FxEditor({ spec, patch, update }: { spec: CustomSpec; patch: any; update: any }) {
  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2">Свечение</Typography>
      <FormControlLabel
        control={<Switch checked={spec.glow.enabled} onChange={e => patch('glow', { enabled: e.target.checked })} />}
        label="Включить свечение"
      />
      {spec.glow.enabled && (
        <>
          <ColorField label="Цвет свечения" value={spec.glow.color} onChange={v => patch('glow', { color: v })} />
          <NumField label="Интенсивность" value={spec.glow.intensity} min={0} max={40} onChange={v => patch('glow', { intensity: v })} />
        </>
      )}
      <Divider />
      <Typography variant="subtitle2">Тень</Typography>
      <FormControlLabel
        control={<Switch checked={spec.shadow.enabled} onChange={e => patch('shadow', { enabled: e.target.checked })} />}
        label="Включить тень"
      />
      {spec.shadow.enabled && (
        <>
          <NumField label="Смещение X" value={spec.shadow.x} min={-40} max={40} onChange={v => patch('shadow', { x: v })} />
          <NumField label="Смещение Y" value={spec.shadow.y} min={-40} max={40} onChange={v => patch('shadow', { y: v })} />
          <NumField label="Размытие" value={spec.shadow.blur} min={0} max={80} onChange={v => patch('shadow', { blur: v })} />
          <ColorField label="Цвет тени" value={spec.shadow.color} onChange={v => patch('shadow', { color: v })} />
        </>
      )}
      <Divider />
      <FormControl size="small">
        <InputLabel>Анимация</InputLabel>
        <Select label="Анимация" value={spec.animation} onChange={e => update('animation', e.target.value as any)}>
          <MenuItem value="none">Нет</MenuItem>
          <MenuItem value="pulse">Пульсация</MenuItem>
          <MenuItem value="shimmer">Блик</MenuItem>
          <MenuItem value="float">Парение</MenuItem>
        </Select>
      </FormControl>
      <NumField label="Прозрачность" value={spec.opacity} min={0.1} max={1} step={0.05} onChange={v => update('opacity', v)} />
      <NumField label="Отступы" value={spec.padding} min={0} max={40} onChange={v => update('padding', v)} />
    </Stack>
  );
}

function MetaEditor(props: any) {
  const { category, setCategory, name, setName, description, setDescription, price, setPrice, spec, update, patch, isAdmin } = props;
  return (
    <Stack spacing={2}>
      <FormControl size="small">
        <InputLabel>Категория</InputLabel>
        <Select label="Категория" value={category} onChange={e => setCategory(e.target.value)}>
          {CATEGORIES.map(c => <MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>)}
        </Select>
      </FormControl>
      <TextField label="Название" size="small" value={name} onChange={e => setName(e.target.value)} inputProps={{ maxLength: 60 }} />
      <TextField label="Описание" size="small" multiline minRows={2} maxRows={5} value={description} onChange={e => setDescription(e.target.value)} inputProps={{ maxLength: 300 }} />
      <TextField
        label={`Цена в ВП${isAdmin ? '' : ' (комиссия 15%)'}`}
        size="small" type="number"
        value={price}
        onChange={e => setPrice(Math.floor(Number(e.target.value) || 0))}
        inputProps={{ min: 20, max: 20000 }}
      />
      <TextField label="Эмодзи в превью (опционально)" size="small" value={spec.emoji} onChange={e => update('emoji', e.target.value.slice(0, 8))} />
      <ColorField label="Цвет текста" value={spec.text.color} onChange={v => patch('text', { color: v })} />
      <FormControl size="small">
        <InputLabel>Начертание</InputLabel>
        <Select label="Начертание" value={spec.text.weight} onChange={e => patch('text', { weight: e.target.value as any })}>
          {['300','400','500','600','700','800'].map(w => <MenuItem key={w} value={w}>{w}</MenuItem>)}
        </Select>
      </FormControl>
    </Stack>
  );
}

