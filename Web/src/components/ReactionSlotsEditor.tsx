import React, { useEffect, useState } from 'react';
import { Box, Button, Typography, Tooltip } from '@mui/material';
import { useThemeStore } from '../store/themeStore';
import { UI_PROFILE_INNER_RADIUS } from '../store/uiPrefsStore';
import {
  REACTION_SKIN_PACKS, REACTION_SLOT_COUNT, STOCK_REACTIONS, reactionLabel, useReactionSkinStore,
} from '../store/reactionSkinStore';
import { RARITY_META } from '../utils/rarityStyles';
import ReactionGlyph from './ReactionGlyph';

/**
 * 10 слотов быстрых реакций. Клик по слоту выбирает его, затем клик по
 * реакции снизу ставит её в слот. Если реакция уже стоит в другом слоте —
 * слоты меняются местами (сервер требует уникальности).
 */
export default function ReactionSlotsEditor() {
  const { theme } = useThemeStore();
  const { owned, slots, setSlots } = useReactionSkinStore();
  const [active, setActive] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Профиль сам подтягивает слоты и скины с сервера — не зависит от инвентаря.
  useEffect(() => { void useReactionSkinStore.getState().load().catch(() => undefined); }, []);

  const save = async (next: string[]) => {
    setSaving(true); setError('');
    try { await setSlots(next); }
    catch (e: any) { setError(e?.response?.data?.message || 'Не удалось сохранить реакции'); }
    finally { setSaving(false); }
  };
  const place = (value: string) => {
    if (saving || slots[active] === value) return;
    const next = [...slots];
    const other = next.indexOf(value);
    if (other >= 0) next[other] = next[active];
    next[active] = value;
    // Слот остаётся выбранным: реакции ставятся в любые слоты, не по порядку.
    void save(next);
  };

  const ownedPacks = REACTION_SKIN_PACKS
    .map(pack => ({ ...pack, reactions: pack.reactions.filter(r => (owned[r.id] || 0) > 0) }))
    .filter(pack => pack.reactions.length);

  const cell = (value: string, selected: boolean, onClick: () => void, label: string, accent?: string) => (
    <Tooltip key={label} title={reactionLabel(value)}>
      <Box component="button" type="button" onClick={onClick} disabled={saving} aria-label={label} aria-pressed={selected}
        sx={{
          width: 36, height: 36, display: 'grid', placeItems: 'center', fontSize: 20, cursor: 'pointer',
          borderRadius: UI_PROFILE_INNER_RADIUS, bgcolor: selected ? theme.bgActive : theme.bgInput, color: theme.text,
          border: `1px solid ${selected ? theme.accent : accent || theme.border}`,
          '&:focus-visible': { outline: `2px solid ${theme.accent}`, outlineOffset: 1 },
          '&:disabled': { opacity: 0.6, cursor: 'default' },
        }}>
        <ReactionGlyph value={value} />
      </Box>
    </Tooltip>
  );

  return <Box>
    <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.5 }}>Быстрые реакции · выберите слот, затем реакцию</Typography>
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 36px)', gap: 0.5, mb: 1 }}>
      {slots.map((value, index) => cell(value, index === active, () => setActive(index), `Слот ${index + 1}: ${reactionLabel(value)}`))}
    </Box>
    <Typography sx={{ fontSize: 11, color: theme.textSec, mb: 0.25 }}>Стандартные</Typography>
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
      {STOCK_REACTIONS.map(value => cell(value, false, () => place(value), `Поставить ${value} в слот ${active + 1}`))}
    </Box>
    {ownedPacks.length ? ownedPacks.map(pack => <Box key={pack.id} sx={{ mb: 1 }}>
      <Typography sx={{ fontSize: 11, color: pack.color, mb: 0.25 }}>{pack.name}</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {pack.reactions.map(skin => cell(skin.id, false, () => place(skin.id), `Поставить ${skin.name} (${RARITY_META[skin.rarity]?.label || skin.rarity}) в слот ${active + 1}`, RARITY_META[skin.rarity]?.color))}
      </Box>
    </Box>) : <Typography sx={{ fontSize: 12, color: theme.textSec }}>Скины реакций выпадают из кейса «Скины реакций» на торговой площадке.</Typography>}
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Button size="small" disabled={saving || slots.every((v, i) => v === STOCK_REACTIONS[i])} onClick={() => void save([...STOCK_REACTIONS])}
        sx={{ textTransform: 'none', color: theme.textSec, fontSize: 12 }}>Сбросить реакции</Button>
      {error && <Typography role="alert" color="error" sx={{ fontSize: 12 }}>{error}</Typography>}
    </Box>
  </Box>;
}
