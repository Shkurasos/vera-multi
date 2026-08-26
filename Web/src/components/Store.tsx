import React, { useState } from 'react';
import { Box, Typography, IconButton, Button, Chip } from '@mui/material';
import { Close, Storefront, Lock, Check, Palette, Wallpaper, Face, AccountCircle } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { SHOP_CATALOG, ShopCategory, useShopStore, selectShopItem, SHOP_CURRENCY } from '../store/shopStore';

interface Props {
  onClose: () => void;
}

const CATEGORY_META: { id: ShopCategory; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: 'profile', label: 'Обводка профиля', icon: <Face />, hint: 'Кастомные обводки аватарки' },
  { id: 'selfcard', label: 'Плашка своих сообщений', icon: <AccountCircle />, hint: 'Как подписаны ваши сообщения у других' },
  { id: 'theme', label: 'Режимы тем', icon: <Palette />, hint: 'Доп. режимы для тем и обоев' },
  { id: 'wallpaper', label: 'Обои', icon: <Wallpaper />, hint: 'Умные и динамические обои' },
];

/**
 * МАГАЗИН (закрытые возможности).
 * Плашка, открывается как плеер-оверлей. Каталог принадлежит издателю (только нам).
 * Сейчас все товары бесплатные — цены и серверная покупка появятся позже.
 */
export default function Store({ onClose }: Props) {
  const { theme } = useThemeStore();
  const { enabled, activeRing, activeSelfCard, isOwned, purchase } = useShopStore();
  const [activeCat, setActiveCat] = useState<ShopCategory | 'all'>('all');
  const [tab, setTab] = useState<'inventory' | 'shop'>('inventory');

  const items = SHOP_CATALOG
    .filter(i => activeCat === 'all' || i.category === activeCat)
    .filter(i => (tab === 'inventory' ? isOwned(i.id) : true));
  const isActive = (id: string) => id === activeRing || id === activeSelfCard;

  return (
    <Box sx={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 2,
      backdropFilter: 'blur(8px)',
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      {/* Плашка */}
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
              <Storefront sx={{ color: '#fff', fontSize: 22 }} />
            </Box>
            <Box>
              <Typography sx={{ fontSize: 20, fontWeight: 800 }}>Магазин VERA</Typography>
              <Typography sx={{ fontSize: 12, color: theme.textSec }}>
                Эксклюзивные возможности от издателя
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {!enabled && <Chip size="small" icon={<Lock sx={{ fontSize: 13 }} />} label="Закрыто" sx={{ bgcolor: theme.bgHover, color: theme.textSec, fontSize: 11, height: 24 }} />}
<IconButton onClick={onClose} sx={{ color: theme.text, opacity: 0.6, '&:hover': { opacity: 1, bgcolor: theme.bgHover } }}>
              <Close />
            </IconButton>
          </Box>
        </Box>

        {/* Табы: Инвентарь / Магазин */}
        <Box sx={{ display: 'flex', gap: 0.5, p: 0.5, bgcolor: theme.bgHover, borderRadius: 999, mb: 2, width: 'fit-content' }}>
          {(['inventory', 'shop'] as const).map((t) => (
            <Button key={t} size="small" onClick={() => setTab(t)}
              sx={{
                bgcolor: tab === t ? theme.accent : 'transparent',
                color: tab === t ? '#001018' : theme.textSec,
                textTransform: 'none', borderRadius: 999, px: 2.5, fontSize: 12, minHeight: 32,
                '&:hover': { bgcolor: tab === t ? theme.accent : theme.bg + '88' },
              }}>
              {t === 'inventory' ? 'Мой инвентарь' : 'Магазин'}
            </Button>
          ))}
        </Box>

        {/* Категории */}
        <Box sx={{ display: 'flex', gap: 1, mb: 2.5, flexWrap: 'wrap' }}>
          <Button size="small" onClick={() => setActiveCat('all')}
            sx={{ bgcolor: activeCat === 'all' ? theme.accent : 'transparent',
                  color: activeCat === 'all' ? '#001018' : theme.textSec,
                  border: `1px solid ${theme.border}`, textTransform: 'none', borderRadius: 999, px: 2, fontSize: 12,
                  '&:hover': { borderColor: theme.accent } }}>
            Всё
          </Button>
          {CATEGORY_META.map(c => (
            <Button key={c.id} size="small" onClick={() => setActiveCat(c.id)} startIcon={c.icon}
              sx={{ bgcolor: activeCat === c.id ? theme.accent : 'transparent',
                color: activeCat === c.id ? '#001018' : theme.textSec,
                border: `1px solid ${theme.border}`, textTransform: 'none', borderRadius: 999, px: 2, fontSize: 12,
                '&:hover': { borderColor: theme.accent } }}>
              {c.label}
            </Button>
          ))}
        </Box>

        {/* Пояснение активной категории */}
        <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 2 }}>
          {activeCat === 'all'
            ? 'Выберите категорию, чтобы посмотреть, что предлагает издатель.'
            : CATEGORY_META.find(c => c.id === activeCat)?.hint}
        </Typography>

        {/* Сетка товаров */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 2 }}>
          {items.map(item => {
            const isActiveItem = isActive(item.id);
            const owned = isOwned(item.id);
            const paid = item.price && item.price > 0;
            return (
              <Box key={item.id} onClick={() => { if (owned) selectShopItem(item.id); }}
                sx={{
                  borderRadius: 3, p: 2,
                  cursor: owned ? 'pointer' : 'default',
                  bgcolor: theme.bgHover, border: `1px solid ${isActive(item.id) ? theme.accent : theme.border}`,
                  display: 'flex', flexDirection: 'column', gap: 1.5, position: 'relative', overflow: 'hidden',
                  transition: 'border-color 0.2s, transform 0.15s',
                  ...(owned ? { '&:hover': { borderColor: theme.accent + '88', transform: 'translateY(-1px)' } } : {}),
                }}>
                {!owned && (
                  <Box sx={{
                    position: 'absolute', top: 0, right: 0, p: 0.5, pl: 1,
                    borderBottomLeftRadius: 10,
                    bgcolor: '#00000088', color: '#fff', display: 'flex', alignItems: 'center', gap: 0.4,
                    zIndex: 2,
                  }}>
                    <Lock sx={{ fontSize: 12 }} />
                  </Box>
                )}
                {/* Превью */}
                <Box sx={{
                  height: 70, borderRadius: 2,
                  background: item.previewColor
                    ? (item.previewColor.startsWith('linear') ? item.previewColor
                      : `radial-gradient(circle at 30% 40%, ${item.previewColor}, ${theme.bgSidebar || theme.bg})`)
                    : `linear-gradient(135deg, ${theme.bgInput}, ${theme.bgChat})`,
                  border: `1px solid ${theme.border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  filter: owned ? 'none' : 'grayscale(1) blur(0.4px)',
                }}>
                  <Typography sx={{
                    width: 44, height: 44, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, fontWeight: 700, color: theme.text,
                    background: item.previewColor && item.previewColor.startsWith('linear')
                      ? item.previewColor : theme.bgHeader,
                    border: item.previewColor && !item.previewColor.startsWith('linear')
                      ? `4px solid ${item.previewColor}` : `2px solid ${theme.border}`,
                  }}>V</Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 15, fontWeight: 700 }}>{item.name}</Typography>
                  <Typography sx={{ fontSize: 12, color: theme.textSec, mt: 0.5, minHeight: 32 }}>
                    {item.description}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 'auto', gap: 1 }}>
                  {paid && !owned ? (
                    <Button size="small" variant="contained"
                      onClick={(e) => { e.stopPropagation(); purchase(item.id); selectShopItem(item.id); }}
                      sx={{ bgcolor: theme.accent, color: '#001018', textTransform: 'none', borderRadius: 999, px: 1.5, '&:hover': { bgcolor: theme.accent + 'BB' } }}>
                      Купить · {item.price} {SHOP_CURRENCY}
                    </Button>
                  ) : (
                    <Chip size="small" icon={isActive(item.id) ? <Check sx={{ fontSize: 14 }} /> : undefined}
                      label={isActive(item.id) ? 'Активно' : (owned ? 'Открыто' : 'Куплено')}
                      sx={{ bgcolor: isActive(item.id) ? theme.accent + '22' : theme.bgInput, color: theme.textSec,
                        fontSize: 11, height: 24, border: isActive(item.id) ? `1px solid ${theme.accent}` : 'none' }} />
                  )}
                  {paid && <Typography sx={{ fontSize: 11, color: theme.textSec, whiteSpace: 'nowrap' }}>{item.price} {SHOP_CURRENCY}</Typography>}
                </Box>
              </Box>
            );
          })}
        </Box>

        {/* Подпись */}
        <Box sx={{ mt: 3, display: 'flex', alignItems: 'center', gap: 1.5, px: 1 }}>
          <Storefront sx={{ fontSize: 20, color: theme.accent }} />
          <Typography sx={{ fontSize: 12, color: theme.textSec }}>
            Раздел издателя: часть возможностей платная. Купленное закрепляется и доступно сразу. Покупка локальная — серверная привязка появится позже.
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

/**
 * Глобальный портал магазина: рендерит плашку, когда useShopStore.open === true.
 * Используется в App.tsx над всеми маршрутами — как плеер.
 */
export function StoreOpen() {
  const open = useShopStore((s) => s.open);
  const setOpen = useShopStore((s) => s.setOpen);
  if (!open) return null;
  return <Store onClose={() => setOpen(false)} />;
}