import React, { useState } from 'react';
import { Box, Typography, IconButton, Button, Chip, TextField, InputAdornment } from '@mui/material';
import { Close, Face, Search } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { SHOP_CATALOG, ShopCategory, useShopStore, selectShopItem } from '../store/shopStore';
import { RARITY_META, buildShopRingSx, buildPlaqueSx } from '../utils/rarityStyles';

interface Props {
  onClose: () => void;
}

const CATEGORY_META: { id: ShopCategory | 'all'; label: string; icon: React.ReactNode }[] = [
  { id: 'all', label: 'Всё', icon: <Search sx={{ fontSize: 14 }} /> },
  { id: 'profile', label: 'Обводка профиля', icon: <Face sx={{ fontSize: 14 }} /> },
  { id: 'selfcard', label: 'Плашка сообщений', icon: <Face sx={{ fontSize: 14 }} /> },
  { id: 'bubble', label: 'Пузыри', icon: <Face sx={{ fontSize: 14 }} /> },
];

function selfcardThumbSx(val: any, accent: string): Record<string, any> {
  const base: Record<string, any> = {
    fontSize: 11, fontWeight: 700, px: 1, py: 0.5, borderRadius: 1,
    color: accent, bgcolor: accent + '14', border: `1px solid ${accent}2E`,
    letterSpacing: 0.4,
  };
  if (!val) return base;
  if (val.type === 'rarity') return buildPlaqueSx(val.rarity, accent);
  if (val.type === 'gradient') {
    return { ...base, background: `linear-gradient(90deg, ${accent}, ${accent}80)`, color: '#fff', border: 'none', boxShadow: `0 2px 8px ${accent}44`, fontWeight: 700 };
  }
  if (val.type === 'badge') {
    return { ...base, bgcolor: accent, color: '#fff', border: 'none', borderRadius: 999, px: 1.5 };
  }
  return base;
}

function bubbleThumbSx(val: any, accent: string): Record<string, any> {
  const base: Record<string, any> = { color: '#fff', fontSize: 12, fontWeight: 600 };
  if (!val) return base;
  switch (val.type) {
    case 'neon': return { ...base, border: `1px solid ${accent}`, boxShadow: `0 0 14px ${accent}aa` };
    case 'glass': return { ...base, background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.22)', backdropFilter: 'blur(8px)' };
    case 'shadow': return { ...base, boxShadow: '0 10px 24px rgba(0,0,0,0.45)' };
    case 'gradient': return { ...base, background: val.gradient };
    case 'minimal': return { ...base, background: 'transparent', border: `1px solid ${accent}66` };
    case 'retro': return { ...base, background: '#fffde7', color: '#3e3a2a', border: '1px solid #e0d98c' };
    case 'candy': return { ...base, background: 'linear-gradient(120deg,#f9a8d4,#a5f3fc,#bbf7d0)', color: '#3b1f33' };
    case 'mono': return { ...base, background: '#161616', border: '1px solid #3d3d3d' };
    case 'aurora': return { ...base, background: 'linear-gradient(120deg,#43e97b,#38f9d7,#4facfe,#a18cd1)' };
    case 'cyber': return { ...base, background: '#0d0d1a', border: `1px solid ${accent}`, boxShadow: `0 0 14px ${accent}88` };
    default: return { ...base, background: `linear-gradient(135deg, ${accent}, ${accent}99)` };
  }
}
/**
 * ИНВЕНТАРЬ VERA.
 * Все предметы бесплатны и сразу открыты (исходя из isOwned).
 * Магазин, покупки и пополнение удалены.
 */
export default function Store({ onClose }: Props) {
  const { theme } = useThemeStore();
  const { activeRing, activeSelfCard, activeBubble } = useShopStore();
  const [activeCat, setActiveCat] = useState<ShopCategory | 'all'>('all');
  const [query, setQuery] = useState('');

  const isActive = (id: string) => id === activeRing || id === activeSelfCard || id === activeBubble;

  const items = SHOP_CATALOG
    .filter(i => activeCat === 'all' || i.category === activeCat)
    .filter(i => !query.trim() || i.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Box sx={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 2,
      backdropFilter: 'blur(8px)',
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <Box sx={{
        background: theme.bgSidebar || theme.bg,
        backgroundImage: theme.sidebarGradient || undefined,
        color: theme.text,
        borderRadius: 4,
        width: '100%', maxWidth: 860, maxHeight: '88vh', overflowY: 'auto',
        padding: 3, boxSizing: 'border-box',
        border: `1px solid ${theme.border}`,
        boxShadow: `0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px ${theme.accent}22 inset`,
        position: 'relative',
      }}>
        {/* Шапка */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{
              width: 40, height: 40, borderRadius: 3,
              background: `linear-gradient(135deg, ${theme.accent}, ${theme.accent}88)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 8px 24px ${theme.accent}44`,
            }}>
              <Face sx={{ color: '#fff', fontSize: 22 }} />
            </Box>
            <Box>
              <Typography sx={{ fontSize: 20, fontWeight: 800 }}>Инвентарь VERA</Typography>
              <Typography sx={{ fontSize: 12, color: theme.textSec }}>
                Вся косметика открыта — выберите и наденьте
              </Typography>
            </Box>
          </Box>
          <IconButton onClick={onClose} sx={{ color: theme.text, opacity: 0.6, '&:hover': { opacity: 1, bgcolor: theme.bgHover } }}>
            <Close />
          </IconButton>
        </Box>
{/* Поиск по названию */}
        <TextField
          fullWidth size="small" value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по названию..."
          InputProps={{
            startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 18, color: theme.textSec }} /></InputAdornment>,
          }}
          sx={{
            mb: 2,
            '& .MuiInputBase-root': { bgcolor: theme.bgHover, color: theme.text, borderRadius: 2, fontSize: 13 },
            '& .MuiOutlinedInput-notchedOutline': { borderColor: theme.border },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: theme.accent + '55' },
            '& .Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: theme.accent },
          }}
        />

        {/* Категории */}
        <Box sx={{ display: 'flex', gap: 1, mb: 2.5, flexWrap: 'wrap' }}>
          {CATEGORY_META.map(c => (
            <Button key={c.id} size="small" onClick={() => setActiveCat(c.id)} startIcon={c.icon}
              sx={{
                bgcolor: activeCat === c.id ? theme.accent : 'transparent',
                color: activeCat === c.id ? '#001018' : theme.textSec,
                border: `1px solid ${theme.border}`, textTransform: 'none', borderRadius: 999, px: 2, fontSize: 12,
                '&:hover': { borderColor: theme.accent },
              }}>
              {c.label}
            </Button>
          ))}
        </Box>

        {/* Сетка предметов */}
        {items.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6, opacity: 0.7 }}>
            <Typography sx={{ fontSize: 14, color: theme.textSec }}>Ничего не найдено</Typography>
          </Box>
        ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 2 }}>
          {items.map(item => {
            const isActiveItem = isActive(item.id);
            return (
              <Box key={item.id} onClick={() => selectShopItem(item.id)}
                sx={{
                  borderRadius: 3, p: 2,
                  cursor: 'pointer',
                  bgcolor: theme.bgHover, border: `1px solid ${isActiveItem ? theme.accent : theme.border}`,
                  display: 'flex', flexDirection: 'column', gap: 1.5, position: 'relative', overflow: 'hidden',
                  transition: 'border-color 0.2s, transform 0.15s',
                  '&:hover': { borderColor: theme.accent + '88', transform: 'translateY(-1px)' },
                }}>
                {/* Превью */}
                <Box sx={{
                  height: 70, borderRadius: 2,
                  position: 'relative', overflow: 'hidden',
                  border: `1px solid ${theme.border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {item.category === 'profile' ? (
                    <Box sx={{
                      position: 'relative', zIndex: 1,
                      width: 48, height: 48, borderRadius: '50%', bgcolor: theme.bgHeader,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      ...buildShopRingSx(item.value, theme.accent, false, 3),
                    }}>
                      <Typography sx={{ fontSize: 16, fontWeight: 800, color: theme.text }}>V</Typography>
                    </Box>
                  ) : item.category === 'selfcard' ? (
                    <Box sx={{
                      position: 'relative', zIndex: 1,
                      ...selfcardThumbSx(item.value, theme.accent),
                      px: 1.2, py: 0.6, fontSize: 12,
                    }}>
                      Вы
                    </Box>
                  ) : (
                    <Box sx={{
                      position: 'relative', zIndex: 1, maxWidth: '92%',
                      px: 1.5, py: 0.9, borderRadius: '16px 16px 4px 16px',
                      ...bubbleThumbSx(item.value, theme.accent),
                    }}>
                      Привет! 👋
                    </Box>
                  )}
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 15, fontWeight: 700 }}>{item.name}</Typography>
                  {item.rarity && (
                    <Typography sx={{
                      display: 'inline-block', mt: 0.5, px: 0.8, py: 0.2,
                      fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
                      color: '#fff', bgcolor: (RARITY_META[item.rarity]?.color || theme.accent) + '33',
                      border: `1px solid ${RARITY_META[item.rarity]?.color || theme.accent}`, borderRadius: 1,
                    }}>{RARITY_META[item.rarity]?.label || item.rarity}</Typography>
                  )}
                  <Typography sx={{ fontSize: 12, color: theme.textSec, mt: 0.5, minHeight: 32 }}>
                    {item.description}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', mt: 'auto', gap: 1 }}>
                  <Chip size="small" label={isActiveItem ? 'Активно ✓' : 'Надеть'}
                    sx={{
                      bgcolor: isActiveItem ? theme.accent + '22' : theme.bgInput,
                      color: isActiveItem ? theme.accent : theme.textSec,
                      fontSize: 11, height: 24, border: isActiveItem ? `1px solid ${theme.accent}` : 'none',
                    }} />
                </Box>
              </Box>
            );
          })}
        </Box>
        )}
      </Box>
    </Box>
  );
}

export function StoreOpen() {
  const open = useShopStore((s) => s.open);
  const setOpen = useShopStore((s) => s.setOpen);
  if (!open) return null;
  return <Store onClose={() => setOpen(false)} />;
}