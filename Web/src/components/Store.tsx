import React, { useEffect, useState } from 'react';
import { Box, Button, Checkbox, Dialog, DialogContent, DialogTitle, FormControlLabel, MenuItem, TextField, Typography } from '@mui/material';
import { SHOP_CATALOG, ShopItem, selectShopItem, useShopStore } from '../store/shopStore';
import { caseCount, casePacks, drawPack, packChance, SkinPack, useLootStore } from '../store/lootStore';
import { CASE_CATALOG, CaseDefinition, findCase } from '../store/caseCatalog';
import { buildPlaqueSx, buildShopRingSx, RARITY_META } from '../utils/rarityStyles';
import { useThemeStore } from '../store/themeStore';
import { skinColors } from '../utils/skinColors';
import { bubbleSkin, selfcardSkin } from '../utils/bubbleSkin';
import PackArtwork from './PackArtwork';
import WalletTopup from './WalletTopup';
import { useAuthStore } from '../store/authStore';
import { packKeyFromItemId } from '../store/packCatalog';

const rarity = (p: SkinPack) => SHOP_CATALOG.find(i => i.id === p.ring)?.rarity || 'common';
const categories = [['all', 'Все'], ['case', 'Кейсы'], ['profile', 'Обводки'], ['selfcard', 'Плашки'], ['bubble', 'Пузыри']];

const CASE_BRANDS = {
  'case-elements': { eyebrow: 'PRIMAL / CONVERGENCE', badge: 'ELEMENTAL', accent: '#a8ffe7', secondary: '#ff996d', tertiary: '#8a83ff' },
  'case-eclipse': { eyebrow: 'UMBRA / BLACK SUN', badge: 'SINGULARITY', accent: '#ffe28a', secondary: '#a98cff', tertiary: '#5f4f92' },
  'case-games': { eyebrow: 'ARCADE / HALL OF FAME', badge: 'LEGENDS', accent: '#e3a7ff', secondary: '#55edff', tertiary: '#ff568d' },
} as const;

function CaseArt({ definition }: { definition: CaseDefinition }) {
  const { theme } = useThemeStore();
  const premium = definition.price === 500;
  const mid = definition.price === 100;
  const brand = CASE_BRANDS[definition.id as keyof typeof CASE_BRANDS];
  const accent = brand?.accent || (mid ? '#7de1ff' : definition.color);
  const secondary = brand?.secondary || (mid ? '#a56dff' : '#ff9d68');
  const tertiary = brand?.tertiary || '#ffffff';
  const title = definition.id === 'case-games' ? 'ЛЕГЕНДЫ ВИДЕОИГР' : definition.id === 'case-eclipse' ? 'ЗАТЕМНЕНИЕ' : definition.name.toLocaleUpperCase('ru');
  const eyebrow = brand?.eyebrow || (mid ? 'SIGNAL / SELECT SERIES' : 'VERA / CASE ARCHIVE');
  const badge = brand?.badge || (mid ? 'SELECT' : 'ENTRY');
  const price = Number.isSafeInteger(definition.price) ? `${definition.price} ВП` : 'ЦЕНА НЕ НАЗНАЧЕНА';
  return <Box sx={{ width: 'min(100%, 240px)', aspectRatio: '1.42', mx: 'auto', my: 2.5, p: 1.25, position: 'relative', overflow: 'hidden', border: `1px solid ${accent}aa`, borderRadius: premium ? 3 : 2, background: `radial-gradient(circle at 78% 16%, ${accent}55 0 2%, transparent 28%), radial-gradient(circle at 14% 88%, ${secondary}44, transparent 36%), linear-gradient(135deg, ${secondary}38, ${theme.bgInput} 48%, #070a12)`, boxShadow: `0 18px 42px ${secondary}35, inset 0 1px 0 #ffffff55`, '&:before': { content: '""', position: 'absolute', inset: 6, border: `1px solid ${accent}66`, borderRadius: 'inherit', pointerEvents: 'none' }, '&:after': { content: '""', position: 'absolute', width: '80%', height: 3, left: '-12%', bottom: 18, background: `linear-gradient(90deg, transparent, ${accent}, transparent)`, transform: 'rotate(-28deg)', opacity: premium ? 0.8 : 0.35, filter: 'blur(1px)' } }}>
    <Box sx={{ position: 'absolute', left: 12, top: 10, color: accent, fontSize: 8, fontWeight: 900, letterSpacing: 1.35 }}>{eyebrow}</Box>
    <Box sx={{ position: 'absolute', right: 12, top: 9, px: 0.7, py: 0.25, border: `1px solid ${accent}88`, borderRadius: 999, color: accent, fontSize: 8, fontWeight: 900, letterSpacing: 1.1 }}>{badge}</Box>
    <svg width="92" height="92" viewBox="0 0 100 100" style={{ display: 'block', margin: '14px auto -4px', filter: `drop-shadow(0 0 10px ${accent}aa)` }} aria-hidden="true">
      {definition.id === 'case-elements' && <>
        <circle cx="50" cy="50" r="39" fill={`${tertiary}18`} stroke={`${accent}88`} strokeWidth="1" strokeDasharray="1 5" />
        <path d="M8 65C22 42 35 42 50 63S77 84 92 59M12 30L24 18L36 30M64 74L76 62L88 74" fill="none" stroke={secondary} strokeWidth="2" strokeLinecap="round" />
        <circle cx="21" cy="68" r="3" fill={accent} /><circle cx="80" cy="26" r="2" fill={tertiary} />
      </>}
      {definition.id === 'case-eclipse' && <>
        <circle cx="50" cy="50" r="39" fill="#09081288" stroke={`${accent}88`} strokeWidth="1" strokeDasharray="7 4" />
        <circle cx="50" cy="50" r="31" fill="none" stroke={secondary} strokeWidth="1.5" opacity=".8" />
        <circle cx="22" cy="26" r="1.5" fill={accent} /><circle cx="79" cy="24" r="1" fill={accent} /><circle cx="82" cy="74" r="1.5" fill={tertiary} />
        <path d="M14 78L23 69M77 31L87 21" fill="none" stroke={accent} strokeWidth="1.5" strokeLinecap="round" />
      </>}
      {definition.id === 'case-games' && <>
        <path d="M8 77H92M12 84H88M18 91H82" fill="none" stroke={secondary} strokeWidth="1" opacity=".55" />
        <path d="M10 24H21V35H32V24H43M57 76H68V87H79V76H90" fill="none" stroke={tertiary} strokeWidth="2" opacity=".8" />
        <rect x="14" y="14" width="4" height="4" fill={accent} /><rect x="82" y="44" width="3" height="3" fill={secondary} /><rect x="21" y="51" width="2" height="2" fill={tertiary} />
      </>}
      {!premium && <circle cx="50" cy="50" r="40" fill={`${secondary}22`} stroke={`${accent}55`} strokeWidth="1" strokeDasharray="2 5" />}
      <path d={definition.mark} fill="none" stroke={accent} strokeWidth={premium ? 4 : 3} strokeLinecap="round" strokeLinejoin="round" />
      <path d={definition.mark} fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <Typography sx={{ position: 'relative', color: theme.text, fontWeight: 900, textAlign: 'center', letterSpacing: premium ? 1.1 : 0.7, fontSize: 11, lineHeight: 1.2 }}>{title}</Typography>
    <Box sx={{ position: 'absolute', left: 12, bottom: 9, color: accent, fontSize: 9, fontWeight: 800 }}>CASE // {definition.packs.length} DROPS</Box>
    <Box sx={{ position: 'absolute', right: 12, bottom: 7, color: theme.text, fontSize: 14, fontWeight: 900 }}>{price}</Box>
  </Box>;
}
function Preview({ item }: { item: ShopItem }) {
  const { theme } = useThemeStore();
  const modes = useShopStore(s => s.colorModes);
  if (item.stock) return <Box sx={{ height: 110, display: 'grid', placeItems: 'center' }}>
    {item.category === 'profile' ? <Box sx={{ width: 48, height: 48, borderRadius: '50%', bgcolor: theme.bgActive, color: theme.text, display: 'grid', placeItems: 'center' }}>V</Box>
      : item.category === 'selfcard' ? <Typography sx={{ color: theme.textSec, fontSize: 12 }}>Вы</Typography>
      : <Box sx={{ bgcolor: theme.bgActive, color: theme.text, px: 2, py: 1, borderRadius: '16px 16px 4px 16px' }}>Привет!</Box>}
  </Box>;
  const stock = item.rarity ? RARITY_META[item.rarity].color : typeof item.previewColor === 'string' ? item.previewColor.match(/#[\da-f]{6}/i)?.[0] || '#ff4870' : '#ff4870';
  const color = modes[item.id] === 'theme' ? theme.accent : stock;
  return <Box sx={{ height: 110, display: 'grid', placeItems: 'center' }}>
    {item.category === 'profile' ? <Box sx={{ width: 48, height: 48, borderRadius: '50%', display: 'grid', placeItems: 'center', ...skinColors(buildShopRingSx(item.value, color), item, color, modes[item.id] === 'theme') }}>V</Box> : item.category === 'selfcard' ? <Box sx={item.value.pack ? selfcardSkin(item, SHOP_CATALOG, theme.accent, modes[item.id] === 'theme') : item.rarity ? buildPlaqueSx(item.rarity, color) : { bgcolor: color, px: 2, py: 1, borderRadius: 2 }}>Вы</Box> : <Box sx={{ px: 2, py: 1.5, maxWidth: '90%', fontSize: 13, ...bubbleSkin(item, theme.accent, modes[item.id] === 'theme') }}>Привет!</Box>}
  </Box>;
}

export default function Store({ onClose }: { onClose: () => void }) {
  const { theme } = useThemeStore();
  const shop = useShopStore();
  const isAdmin = useAuthStore(s => !!s.user?.isAdmin);
  const loot = useLootStore();
  const [error, setError] = useState('');
  const reportError = (error: any) => setError(error.response?.data?.message || 'Не удалось выполнить операцию. Обновите инвентарь.');
  useEffect(() => { void useLootStore.getState().load().catch(reportError); }, []);
  // Both dialogs are portaled: apply the same theme-aware controls to each paper.
  const panelSx = {
    bgcolor: theme.bgSidebar || theme.bg,
    color: theme.text,
    width: { xs: 'calc(100vw - 12px)', sm: 'auto' },
    maxHeight: { xs: 'calc(100dvh - 12px)', sm: 'calc(100dvh - 64px)' },
    m: { xs: '6px', sm: '32px' },
    borderRadius: { xs: 2, sm: 3 },
    overflow: 'hidden',
    '& .MuiDialogContent-root': { px: { xs: 1.5, sm: 3 }, overflowX: 'hidden' },
    '& .MuiDialogTitle-root': { px: { xs: 1.5, sm: 3 }, overflowWrap: 'anywhere' },
    '& .MuiTypography-root': { overflowWrap: 'anywhere' },
    '& .MuiButton-root': {
      minHeight: 40,
      px: 2,
      py: 0.9,
      my: 0.5,
      borderRadius: 2,
      border: `1px solid ${theme.border}`,
      bgcolor: theme.bgInput,
      color: theme.text,
      fontWeight: 700,
      textTransform: 'none',
      lineHeight: 1.4,
      boxShadow: 'none',
      transition: 'background-color 160ms ease, border-color 160ms ease, transform 160ms ease',
      '& + .MuiButton-root': { ml: { xs: 0.5, sm: 1 } },
      '&:hover': { bgcolor: theme.bgHover, borderColor: theme.accent, boxShadow: 'none' },
      '&:active': { bgcolor: theme.bgActive, transform: 'translateY(1px)' },
      '&.Mui-focusVisible': { outline: `2px solid ${theme.accent}`, outlineOffset: 2 },
      '&.MuiButton-contained': {
        bgcolor: theme.bgActive,
        color: theme.text,
        borderColor: theme.accent,
        boxShadow: `inset 0 -2px 0 ${theme.accent}`,
        '&:hover': { bgcolor: theme.bgHover, boxShadow: `inset 0 -2px 0 ${theme.accent}` },
      },
      '&.Mui-disabled': {
        bgcolor: theme.bgHeader,
        color: theme.textSec,
        borderColor: theme.border,
        boxShadow: 'none',
        opacity: 0.6,
      },
    },
    '& .MuiCheckbox-root': {
      color: theme.textSec,
      '&.Mui-checked': { color: theme.accent },
      '&.Mui-focusVisible': { outline: `2px solid ${theme.accent}`, outlineOffset: -2 },
    },
  };
  const [tab, setTab] = useState('inventory');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState('name');
  const [tier, setTier] = useState('all');
  const [collection, setCollection] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [salePrice, setSalePrice] = useState('6');
  const [marketPending, setMarketPending] = useState(false);
  const validSalePrice = Number.isSafeInteger(Number(salePrice)) && Number(salePrice) >= 6 && Number(salePrice) <= 100000000;
  useEffect(() => {
    const refresh = () => { void Promise.all([useShopStore.getState().loadMarket(), useShopStore.getState().loadWallet()]).catch(reportError); };
    refresh();
    const timer = window.setInterval(refresh, 10000);
    return () => window.clearInterval(timer);
  }, []);
  const marketAction = async (action: () => Promise<void>) => {
    if (marketPending) return;
    setMarketPending(true); setError('');
    try { await action(); } catch (error) { reportError(error); }
    finally { setMarketPending(false); }
  };
  const selectedCase = findCase(selected || '');
  const selectedPrice = selectedCase ? loot.prices[selectedCase.id] : null;
  const selectedPriceIsSet = Number.isSafeInteger(selectedPrice) && Number(selectedPrice) > 0;
  const [drop, setDrop] = useState<SkinPack | null>(null);
  const [reel, setReel] = useState<SkinPack[]>([]);
  const [phase, setPhase] = useState<'idle' | 'ready' | 'rolling' | 'result'>('idle');
  useEffect(() => {
    if (phase === 'ready') { const t = window.setTimeout(() => setPhase('rolling'), 50); return () => clearTimeout(t); }
    if (phase === 'rolling') { const t = window.setTimeout(() => setPhase('result'), 5200); return () => clearTimeout(t); }
  }, [phase]);
  const busy = marketPending || loot.pending || phase === 'ready' || phase === 'rolling';
  const open = async () => {
    if (busy || !selectedCase) return;
    setError('');
    let result: SkinPack | null;
    try { result = await loot.openCase(selectedCase.id); } catch (error) { reportError(error); return; }
    if (!result) return;
    const sequence = Array.from({ length: 48 }, () => drawPack(Math.random(), selectedCase.id));
    sequence[40] = result;
    setDrop(result); setReel(sequence); setPhase('ready');
  };
  const rows = tab === 'inventory'
    ? [...CASE_CATALOG.filter(c => caseCount(loot, c.id) > 0).map(c => ({ key: c.id, id: c.id, count: caseCount(loot, c.id) })), ...SHOP_CATALOG.filter(i => isAdmin || i.stock || shop.owned[i.id]).map(i => ({ key: i.id, id: i.id, count: 1 }))]
    : [...CASE_CATALOG.map(c => ({ key: c.id, id: c.id, count: caseCount(loot, c.id) })), ...shop.marketListings.map(l => ({ key: l.id, id: l.itemId, count: 1 }))];
  const info = (id: string) => { const item = SHOP_CATALOG.find(i => i.id === id); const definition = findCase(id); return { name: definition ? `Кейс «${definition.name}»` : item?.name || id, category: definition ? 'case' : item?.category, rarity: item?.rarity || 'common', item, definition }; };
  const collectionOf = (id: string) => {
    if (findCase(id)) return id;
    const pack = packKeyFromItemId(id) || SHOP_CATALOG.find(i => i.id === id)?.value?.pack;
    return pack ? CASE_CATALOG.find(c => c.packs.includes(pack))?.id : undefined;
  };
  const visible = rows.filter(r => { const i = info(r.id); return (collection === 'all' || collectionOf(r.id) === collection) && (category === 'all' || i.category === category) && (tier === 'all' || i.rarity === tier) && i.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()); }).sort((a, b) => sort === 'rarity' ? RARITY_META[info(b.id).rarity].order - RARITY_META[info(a.id).rarity].order : sort === 'quantity' ? b.count - a.count : info(a.id).name.localeCompare(info(b.id).name, 'ru'));
  const item = SHOP_CATALOG.find(i => i.id === selected);
  const slots = [
    { label: 'Обводка', id: shop.activeRing, clear: () => shop.setActiveRing('') },
    { label: 'Плашка', id: shop.activeSelfCard, clear: () => shop.setActiveSelfCard('') },
    { label: 'Пузырь', id: shop.activeBubble, clear: () => shop.setActiveBubble('') },
  ];
  const favorites = SHOP_CATALOG.filter(i => shop.favoriteIds.includes(i.id) && shop.isOwned(i.id) && !i.stock);
  const showItem = (id: string) => { setSelected(id); setSalePrice('6'); setError(''); setPhase('idle'); };
  const sell = () => {
    if (!selected) return;
    if (selectedCase) return;
    if (!validSalePrice) return;
    void marketAction(async () => { await shop.listForSale(selected, Number(salePrice)); setSelected(null); setTab('market'); });
  };
  const buyCase = (caseId: string) => {
    setError('');
    void loot.buyCase(caseId).catch(reportError);
  };
  return <Dialog open fullWidth maxWidth="xl" onClose={() => !busy && onClose()} PaperProps={{ sx: { ...panelSx, width: { xs: 'calc(100vw - 12px)', sm: 'calc(100% - 64px)' }, minHeight: { xs: 'calc(100dvh - 12px)', sm: '70vh' } } }}>
    <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, px: { xs: 1.5, sm: 3 }, py: { xs: 1.25, sm: 2 }, fontSize: { xs: 18, sm: 20 } }}>Инвентарь VERA<Button disabled={busy} onClick={onClose}>Закрыть</Button></DialogTitle>
    <DialogContent sx={{ px: { xs: 1, sm: 3 }, py: { xs: 1, sm: 2 }, overflowX: 'hidden' }}>
      <WalletTopup />
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 0.75, mb: 1.5 }}><Button variant={tab === 'inventory' ? 'contained' : 'text'} onClick={() => setTab('inventory')}>Инвентарь</Button><Button variant={tab === 'market' ? 'contained' : 'text'} onClick={() => setTab('market')}>Площадка</Button></Box>
      {error && <Typography role="alert" color="error">{error}</Typography>}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: tab === 'inventory' ? '260px minmax(0,1fr)' : 'minmax(0,1fr)' }, gap: { xs: 1, md: 2 }, alignItems: 'start' }}>
      {tab === 'inventory' && <Box component="aside" aria-label="Надетые и избранные скины" sx={{ p: { xs: 1, sm: 2 }, bgcolor: theme.bgHeader, border: `1px solid ${theme.border}`, borderRadius: 2, display: { xs: 'grid', md: 'block' }, gridTemplateColumns: { xs: 'repeat(3, minmax(0, 1fr))', md: 'none' }, gap: { xs: 0.75, md: 0 }, '& > h6': { gridColumn: '1 / -1' } }}>
        <Typography variant="h6" sx={{ fontSize: { xs: 14, sm: 18 } }}>Надето</Typography>
        {slots.map(slot => {
          const equipped = SHOP_CATALOG.find(i => i.id === slot.id && !i.stock);
          return <Box key={slot.label} sx={{ py: { xs: 0.5, sm: 1.5 }, minWidth: 0, borderBottom: { xs: 'none', md: `1px solid ${theme.border}` } }}>
            <Typography variant="caption" sx={{ color: theme.textSec, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{slot.label}</Typography>
            {equipped ? <>
              <Button fullWidth onClick={() => showItem(equipped.id)} sx={{ display: 'block', minWidth: 0, px: { xs: 0.25, sm: 1 }, textTransform: 'none', fontSize: { xs: 11, sm: 14 } }}><Preview item={equipped} />{equipped.name}</Button>
              <Button size="small" onClick={slot.clear} aria-label={`Снять: ${equipped.name}`} sx={{ minHeight: 30, fontSize: 11 }}>Снять</Button>
            </> : <Typography sx={{ color: theme.textSec, fontSize: 13 }}>Стандартный вид</Typography>}
          </Box>;
        })}
        <Typography variant="h6" sx={{ mt: { xs: 1, md: 2 }, gridColumn: '1 / -1', fontSize: { xs: 14, sm: 18 } }}>Избранные · {favorites.length}</Typography>
        {!favorites.length && <Typography sx={{ mt: 1, gridColumn: '1 / -1', color: theme.textSec, fontSize: 13 }}>Добавляйте скины в избранное кнопкой на карточке предмета.</Typography>}
        <Box sx={{ maxHeight: { xs: 170, md: 360 }, overflowY: 'auto', gridColumn: '1 / -1', display: { xs: 'grid', md: 'block' }, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'none' }, gap: { xs: 0.75, md: 0 } }}>{favorites.map(favorite => <Box key={favorite.id} sx={{ mt: { xs: 0, md: 1.5 }, minWidth: 0 }}>
          <Button fullWidth onClick={() => showItem(favorite.id)} sx={{ display: 'block', minWidth: 0, px: { xs: 0.25, sm: 1 }, textTransform: 'none', fontSize: { xs: 11, sm: 14 } }}><Preview item={favorite} />{favorite.name}</Button>
          <Button size="small" onClick={() => selectShopItem(favorite.id)}>{slots.some(slot => slot.id === favorite.id) ? 'Снять' : 'Надеть'}</Button>
          <Button size="small" onClick={() => shop.toggleFavorite(favorite.id)} aria-label={`Убрать из избранного: ${favorite.name}`}>Убрать ★</Button>
        </Box>)}</Box>
      </Box>}
      <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr) minmax(0, 1fr)', sm: 'repeat(auto-fit, minmax(140px, max-content))' }, gap: 0.75, mb: 1.5, '& .MuiInputBase-root': { color: theme.text }, '& .MuiFormControl-root, & .MuiTextField-root': { minWidth: 0, width: '100%' } }}>
        <TextField size="small" placeholder="Поиск" value={query} onChange={e => setQuery(e.target.value)} sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }} />
        <TextField select size="small" value={category} onChange={e => setCategory(e.target.value)}>{categories.map(([id, label]) => <MenuItem key={id} value={id}>{label}</MenuItem>)}</TextField>
        <TextField select size="small" label="Коллекция" value={collection} onChange={e => setCollection(e.target.value)}>
          <MenuItem value="all">Все коллекции</MenuItem>
          {CASE_CATALOG.map(definition => <MenuItem key={definition.id} value={definition.id}>{definition.name}</MenuItem>)}
        </TextField>
        <TextField select size="small" value={tier} onChange={e => setTier(e.target.value)}><MenuItem value="all">Все редкости</MenuItem>{Object.values(RARITY_META).map(r => <MenuItem key={r.id} value={r.id}>{r.label}</MenuItem>)}</TextField>
        <TextField select size="small" value={sort} onChange={e => setSort(e.target.value)}><MenuItem value="name">По имени</MenuItem><MenuItem value="rarity">По редкости ↓</MenuItem><MenuItem value="quantity">По количеству ↓</MenuItem></TextField>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(auto-fill,minmax(180px,1fr))' }, gap: { xs: 0.75, sm: 2 } }}>{visible.map(row => { const i = info(row.id); return <Box key={row.key} sx={{ p: { xs: 0.75, sm: 2 }, minWidth: 0, border: `1px solid ${theme.border}`, borderBottom: `3px solid ${RARITY_META[i.rarity].color}`, bgcolor: theme.bgHover, borderRadius: 2 }}>
        <Button onClick={() => { if (tab === 'inventory' || i.definition) showItem(row.id); }} sx={{ display: 'block', width: '100%', color: theme.text, textTransform: 'none' }}>{i.item ? <Preview item={i.item} /> : i.definition ? <CaseArt definition={i.definition} /> : null}<Typography>{i.name}</Typography></Button><Typography variant="caption">{row.count} шт. · {i.definition ? `${i.definition.packs.length} паков` : RARITY_META[i.rarity].label}</Typography>
        {tab === 'market' && i.definition && (() => {
          const price = loot.prices[row.id];
          const priced = Number.isSafeInteger(price) && Number(price) > 0;
          return <Box sx={{ mt: 1 }}>
            <Typography sx={{ fontWeight: 800 }}>{priced ? `${price} ВП` : 'Скоро'}</Typography>
            <Button fullWidth disabled={busy || !priced || shop.balanceVp < Number(price)} onClick={() => buyCase(row.id)}>{priced ? (shop.balanceVp < Number(price) ? 'Не хватает ВП' : 'Купить') : 'Цена не назначена'}</Button>
          </Box>;
        })()}
        {tab === 'market' && !i.definition && (() => {
          const listing = shop.marketListings.find(l => l.id === row.key)!;
          return <Box><Typography>{listing.price} ВП · {listing.seller}</Typography>
            {listing.isMine ? <Button disabled={busy} onClick={() => void marketAction(() => shop.cancelListing(listing.id))}>Снять с продажи</Button>
              : <Button disabled={busy || !!shop.owned[listing.itemId] || shop.balanceVp < listing.price} onClick={() => void marketAction(() => shop.buyListing(listing.id))}>Купить за {listing.price} ВП</Button>}
          </Box>;
        })()}
        {tab === 'inventory' && i.item && !i.item.stock && shop.owned[row.id] && <Button fullWidth disabled={busy} onClick={() => showItem(row.id)}>Выставить на продажу</Button>}
        {tab === 'inventory' && i.item && !i.item.stock && <Button size="small" aria-pressed={shop.favoriteIds.includes(row.id)} onClick={() => shop.toggleFavorite(row.id)}>{shop.favoriteIds.includes(row.id) ? '★ В избранном' : '☆ В избранное'}</Button>}
      </Box>; })}</Box>
      {!visible.length && <Typography sx={{ textAlign: 'center', py: 6 }}>Предметов не найдено</Typography>}
      </Box>
      </Box>
    </DialogContent>
    <Dialog open={!!selected} fullWidth maxWidth="md" onClose={() => !busy && setSelected(null)} PaperProps={{ sx: panelSx }}>
      <DialogTitle>{selectedCase ? `Кейс «${selectedCase.name}»` : item?.name}</DialogTitle><DialogContent>
        {selectedCase ? <>
            {phase === 'idle' && <>
            <CaseArt definition={selectedCase} /><Typography sx={{ color: theme.textSec }}>Покупка: <strong>{selectedPriceIsSet ? `${selectedPrice} ВП` : 'цена не назначена'}</strong>. Внутри один уникальный пак: обводка, плашка и пузырь. Паки этой коллекции не встречаются в других кейсах.</Typography>
            <Button disabled={busy || !selectedPriceIsSet || shop.balanceVp < Number(selectedPrice)} onClick={() => { setError(''); void loot.buyCase(selectedCase.id).catch(reportError); }}>{selectedPriceIsSet ? `Купить за ${selectedPrice} ВП` : 'Цена не назначена'}</Button>
            {error && <Typography role="alert" color="error">{error}</Typography>}
            <Button disabled={busy || caseCount(loot, selectedCase.id) < 1} onClick={open}>Открыть кейс</Button>
            <Typography sx={{ my: 2 }}>Содержимое и вероятности:</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 1.5 }}>
              {casePacks(selectedCase.id).map(p => <Box key={p.id}><PackArtwork pack={p} /><Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 0.5, color: theme.textSec }}>{RARITY_META[rarity(p)].label} · {packChance(p, selectedCase.id).toFixed(2)}%</Typography></Box>)}
            </Box>
          </>}
          {phase !== 'idle' && <Box sx={{ position: 'relative', overflow: 'hidden', height: 155, bgcolor: theme.bgHeader, my: 2, '&:after': { content: '""', position: 'absolute', top: 0, bottom: 0, left: '50%', width: 3, bgcolor: theme.accent } }}>
            <Box sx={{ display: 'flex', gap: '8px', position: 'absolute', left: '50%', transform: `translateX(-${phase === 'ready' ? 80 : 40 * 168 + 80}px)`, transition: phase === 'ready' ? 'none' : 'transform 5s cubic-bezier(.08,.65,.12,1)' }}>
              {reel.map((p, n) => <Box key={n} sx={{ width: 160, flexShrink: 0, height: 150, boxSizing: 'border-box', p: 0.5, borderBottom: `4px solid ${RARITY_META[rarity(p)].color}` }}><PackArtwork pack={p} compact /></Box>)}
            </Box>
          </Box>}
          {phase === 'result' && drop && <Box aria-live="polite">
            <Typography variant="h5" sx={{ mb: 2 }}>Выпал пак «{drop.name}»</Typography><PackArtwork pack={drop} />
            <Typography sx={{ color: RARITY_META[rarity(drop)].color, mt: 1 }}>{RARITY_META[rarity(drop)].label}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(3,minmax(0,1fr))' }, gap: 1 }}>{[drop.ring, drop.selfcard, drop.bubble].map(id => { const part = SHOP_CATALOG.find(i => i.id === id)!; return <Box key={id}><Preview item={part} /><Typography>{part.name}</Typography></Box>; })}</Box>
            <Button onClick={() => loot.equipPack(drop.id)}>Надеть пак</Button>
          </Box>}
        </> : item && <><Preview item={item} /><Typography>{item.description}</Typography>{!item.stock && <FormControlLabel control={<Checkbox checked={shop.colorModes[item.id] === 'theme'} onChange={e => shop.setColorMode(item.id, e.target.checked ? 'theme' : 'stock')} />} label="Под цвет темы (без галочки — стоковый цвет)" />}<Box><Button disabled={busy} onClick={() => selectShopItem(item.id)}>{item.stock ? 'Использовать стандартный вид' : 'Надеть / снять'}</Button>{!item.stock && shop.owned[item.id] && <Box sx={{ mt: 2 }}>
          <TextField type="number" label="Цена, ВП" value={salePrice} disabled={busy} onChange={e => setSalePrice(e.target.value)} inputProps={{ min: 6, max: 100000000, step: 1 }} error={!validSalePrice} helperText="Целое число от 6 до 100000000 ВП" />
          <Typography>Комиссия 15%. Вы получите: {validSalePrice ? Math.floor(Number(salePrice) * 85 / 100) : 0} ВП</Typography>
          <Button disabled={busy || !validSalePrice} onClick={sell}>Выставить за {validSalePrice ? salePrice : '—'} ВП</Button>
        </Box>}</Box>{error && <Typography role="alert" color="error">{error}</Typography>}</>}
        <Button disabled={busy} onClick={() => setSelected(null)}>Закрыть</Button>
      </DialogContent>
    </Dialog>
  </Dialog>;
}
export function StoreOpen() {
  const open = useShopStore(s => s.open);
  const setOpen = useShopStore(s => s.setOpen);
  return open ? <Store onClose={() => setOpen(false)} /> : null;
}