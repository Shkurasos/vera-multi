import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, ButtonBase, Checkbox, Collapse, Dialog, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, TextField, Typography } from '@mui/material';
import { AccountBalanceWallet, Close, Inventory2, Search, Storefront } from '@mui/icons-material';
import { SHOP_CATALOG, MarketListing, ShopItem, selectShopItem, useShopStore } from '../store/shopStore';
import { caseCount, casePacks, drawPack, packChance, SkinPack, useLootStore } from '../store/lootStore';
import { CASE_CATALOG, CaseDefinition, caseDescription, findCase, isHiddenCase } from '../store/caseCatalog';
import { buildPlaqueSx, buildShopRingSx, RARITY_META } from '../utils/rarityStyles';
import { useThemeStore } from '../store/themeStore';
import { skinColors } from '../utils/skinColors';
import { bubbleSkin, selfcardSkin } from '../utils/bubbleSkin';
import PackArtwork from './PackArtwork';
import WalletTopup from './WalletTopup';
import { useAuthStore } from '../store/authStore';
import { packKeyFromItemId } from '../store/packCatalog';
import { PET_CATALOG, findPet } from '../store/petCatalog';
import { usePetStore } from '../store/petStore';
import PetArtwork from './PetArtwork';
import ReactionGlyph from './ReactionGlyph';
import { findReactionSkin, useReactionSkinStore } from '../store/reactionSkinStore';
import { frostedPaperSx } from '../styles/frosted';
import { UI_SURFACE_RADIUS, UI_INNER_RADIUS } from '../store/uiPrefsStore';
import { readableTextOn } from '../utils/contrast';

/** Доли ниже 0.01% показываем с тысячными, иначе 0.001% схлопывается в «0.00%». */
const formatChance = (percent: number) => `${percent.toFixed(percent < 0.01 ? 3 : 2)}%`;

const rarity = (p: SkinPack) => SHOP_CATALOG.find(i => i.id === p.ring)?.rarity || 'common';
const categories = [['all', 'Все'], ['case', 'Кейсы'], ['pet', 'Питомцы'], ['profile', 'Обводки'], ['selfcard', 'Плашки'], ['bubble', 'Пузыри']];

// ── Производительность сетки ────────────────────────────────────────────────
// Раньше info()/collectionOf() делали линейный поиск по каталогам для каждой
// карточки и для каждого сравнения в sort (O(n² log n) на рендер). Каталоги
// статичны, поэтому результат по id считаем один раз и кладём в кэш.
const SHOP_BY_ID = new Map(SHOP_CATALOG.map(i => [i.id, i]));
const collator = new Intl.Collator('ru');
// Сколько карточек дорисовывать за раз (остальные — по мере прокрутки).
const PAGE_SIZE = 48;
const computeInfo = (id: string) => {
  const item = SHOP_BY_ID.get(id);
  const definition = findCase(id);
  const pet = findPet(id);
  const reaction = findReactionSkin(id);
  const name = definition ? `Кейс «${definition.name}»` : pet ? pet.name : reaction ? reaction.name : item?.name || id;
  return { name, lowerName: name.toLocaleLowerCase(), category: definition ? 'case' : pet ? 'pet' : reaction ? 'reaction' : item?.category, rarity: pet?.rarity || reaction?.rarity || item?.rarity || 'common', item, definition, pet, reaction };
};
type ItemInfo = ReturnType<typeof computeInfo>;
const infoCache = new Map<string, ItemInfo>();
function itemInfo(id: string): ItemInfo {
  let cached = infoCache.get(id);
  if (!cached) { cached = computeInfo(id); infoCache.set(id, cached); }
  return cached;
}
const collectionCache = new Map<string, string | undefined>();
function collectionOf(id: string): string | undefined {
  if (collectionCache.has(id)) return collectionCache.get(id);
  let result: string | undefined;
  if (findCase(id)) result = id;
  else if (findReactionSkin(id)) result = CASE_CATALOG.find(c => c.rewards.some(r => r.key === id))?.id;
  else {
    const pet = findPet(id);
    if (pet) result = pet.caseIds[0];
    else {
      const pack = packKeyFromItemId(id) || SHOP_BY_ID.get(id)?.value?.pack;
      result = pack ? CASE_CATALOG.find(c => c.packs.includes(pack))?.id : undefined;
    }
  }
  collectionCache.set(id, result);
  return result;
}
// Стабильная ссылка на обработчик, который всегда видит свежее замыкание:
// иначе memo-карточки перерисовывались бы на каждый рендер родителя.
function useEvent<A extends unknown[], R>(fn: (...args: A) => R) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

// Сундук кейса: силуэт с эмблемой коллекции на мягком свечении цвета кейса.
// Рамку и подписи даёт контейнер (плитка сетки или шапка диалога), поэтому
// здесь только иллюстрация и, если передана, плашка с ценой.
const CaseArt = memo(function CaseArt({ definition, price, size = 96 }: { definition: CaseDefinition; price?: number | null; size?: number }) {
  const theme = useThemeStore(s => s.theme);
  const accent = definition.color || theme.accent;
  const priceLabel = Number.isSafeInteger(price) && Number(price) > 0 ? `${price} ВП` : null;
  return <Box sx={{ position: 'relative', display: 'grid', placeItems: 'center', width: '100%', height: size + 24 }}>
    <Box aria-hidden sx={{ position: 'absolute', width: size * 1.1, height: size * 1.1, borderRadius: '50%', bgcolor: accent, opacity: 0.16, filter: 'blur(26px)' }} />
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ position: 'relative' }} aria-hidden="true">
      <ellipse cx="50" cy="88" rx="30" ry="3.5" fill="#000" opacity=".28" />
      <path d="M16 50V44C16 33.5 31.5 26 50 26C68.5 26 84 33.5 84 44V50H16Z" fill={`${accent}3a`} stroke={accent} strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M14 50H86V76C86 79.3 83.3 82 80 82H20C16.7 82 14 79.3 14 76V50Z" fill={`${accent}22`} stroke={accent} strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M22 34C30 30 40 28.5 50 28.5" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="2" strokeLinecap="round" />
      <g transform="translate(37 56) scale(0.26)" fill="none" stroke={accent} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
        <path d={definition.mark} />
      </g>
      <rect x="45" y="44" width="10" height="14" rx="2.5" fill={accent} />
      <circle cx="50" cy="50.5" r="1.8" fill={theme.bgInput} />
    </svg>
    {priceLabel && <Box sx={{ position: 'absolute', bottom: 0, px: 1.25, py: 0.25, borderRadius: 999, bgcolor: theme.bgHeader, border: `1px solid ${accent}66`, color: theme.text, fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap' }}>{priceLabel}</Box>}
  </Box>;
});
const Preview = memo(function Preview({ item, height = 110 }: { item: ShopItem; height?: number }) {
  const theme = useThemeStore(s => s.theme);
  // Подписка только на режим цвета своего предмета, а не на весь словарь.
  const mode = useShopStore(s => s.colorModes[item.id]);
  if (item.stock) return <Box sx={{ height, display: 'grid', placeItems: 'center' }}>
    {item.category === 'profile' ? <Box sx={{ width: 48, height: 48, borderRadius: '50%', bgcolor: theme.bgActive, color: theme.text, display: 'grid', placeItems: 'center' }}>V</Box>
      : item.category === 'selfcard' ? <Typography sx={{ color: theme.textSec, fontSize: 12 }}>Вы</Typography>
      : <Box sx={{ bgcolor: theme.bgActive, color: theme.text, px: 2, py: 1, borderRadius: '16px 16px 4px 16px' }}>Привет!</Box>}
  </Box>;
  const stock = item.rarity ? RARITY_META[item.rarity].color : typeof item.previewColor === 'string' ? item.previewColor.match(/#[\da-f]{6}/i)?.[0] || '#ff4870' : '#ff4870';
  const color = mode === 'theme' ? theme.accent : stock;
  return <Box sx={{ height, display: 'grid', placeItems: 'center' }}>
    {item.category === 'profile' ? <Box sx={{ width: 48, height: 48, borderRadius: '50%', display: 'grid', placeItems: 'center', ...skinColors(buildShopRingSx(item.value, color), item, color, mode === 'theme') }}>V</Box> : item.category === 'selfcard' ? <Box sx={item.value.pack ? selfcardSkin(item, SHOP_CATALOG, theme.accent, mode === 'theme') : item.rarity ? buildPlaqueSx(item.rarity, color) : { bgcolor: color, px: 2, py: 1, borderRadius: 2 }}>Вы</Box> : <Box sx={{ px: 2, py: 1.5, maxWidth: '90%', fontSize: 13, ...bubbleSkin(item, theme.accent, mode === 'theme') }}>Привет!</Box>}
  </Box>;
});
// Иллюстрация любого предмета: скин, кейс, питомец или реакция.
const ItemArt = memo(function ItemArt({ id, price, height = 110, animate = false }: { id: string; price?: number | null; height?: number; animate?: boolean }) {
  const i = itemInfo(id);
  if (i.item) return <Preview item={i.item} height={height} />;
  if (i.definition) return <CaseArt definition={i.definition} price={price} size={Math.round(height * 0.78)} />;
  if (i.pet) return <Box sx={{ height, display: 'grid', placeItems: 'center' }}><PetArtwork petId={i.pet.id} size={Math.round(height * 0.76)} animate={animate} /></Box>;
  if (i.reaction) return <Box sx={{ height, display: 'grid', placeItems: 'center' }}><ReactionGlyph value={i.reaction.id} size={Math.round(height * 0.5)} /></Box>;
  return <Box sx={{ height }} />;
});
const CATEGORY_LABELS: Record<string, string> = { case: 'Кейс', pet: 'Питомец', reaction: 'Реакция', profile: 'Обводка', selfcard: 'Плашка', bubble: 'Пузырь', wallpaper: 'Обои', theme: 'Тема' };
// Звезда избранного своим SVG: в шиме иконок (mui-icons-shim) нет Star/StarBorder.
const StarGlyph = ({ filled, size = 18 }: { filled: boolean; size?: number }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
  <path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
</svg>;
const caseContents = (definition: CaseDefinition) => definition.packs.length ? `${definition.packs.length} паков`
  : definition.rewards.some(r => r.key.startsWith('rx-')) ? `${definition.rewards.length} скинов` : `${definition.rewards.length} питомцев`;
const itemSubtitle = (id: string) => {
  const i = itemInfo(id);
  return i.definition ? `Кейс · ${caseContents(i.definition)}` : `${RARITY_META[i.rarity].label} · ${CATEGORY_LABELS[i.category || ''] || 'Предмет'}`;
};
type StoreRow = { key: string; id: string; count: number };
type CardProps = {
  row: StoreRow;
  tab: string;
  theme: ReturnType<typeof useThemeStore.getState>['theme'];
  busy: boolean;
  balanceVp: number;
  price: number | null;
  listing?: MarketListing;
  alreadyOwned: boolean;
  equipped: boolean;
  favorite: boolean;
  onShow: (id: string) => void;
  onBuyCase: (id: string) => void;
  onListing: (listing: MarketListing, buy: boolean, isPet: boolean) => void;
  onToggleFavorite: (id: string) => void;
};
// Плитка сетки в духе инвентаря Steam: фон подсвечен цветом редкости снизу,
// полоса редкости по нижнему краю, счётчик копий и отметка «надето» сверху.
// memo + примитивные/стабильные пропсы: при опросе маркета, вводе в поиск
// и т.п. перерисовываются только реально изменившиеся карточки.
const StoreCard = memo(function StoreCard({ row, tab, theme, busy, balanceVp, price, listing, alreadyOwned, equipped, favorite, onShow, onBuyCase, onListing, onToggleFavorite }: CardProps) {
  const i = itemInfo(row.id);
  const tone = i.definition?.color || RARITY_META[i.rarity].color;
  const priced = Number.isSafeInteger(price) && Number(price) > 0;
  const canFavorite = tab === 'inventory' && !!i.item && !i.item.stock;
  // content-visibility: браузер не верстает и не рисует карточки вне экрана.
  return <Box sx={{
    position: 'relative', minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    borderRadius: UI_SURFACE_RADIUS, border: `1px solid ${equipped ? theme.accent : theme.border}`,
    background: `linear-gradient(180deg, ${theme.bgInput} 35%, ${tone}24 100%)`,
    transition: 'border-color 140ms ease, transform 140ms ease, box-shadow 140ms ease',
    '&:hover': { borderColor: tone, transform: 'translateY(-2px)', boxShadow: `0 8px 22px ${tone}26` },
    '&::after': { content: '""', position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, bgcolor: tone, pointerEvents: 'none' },
    '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
    contentVisibility: 'auto', containIntrinsicSize: 'auto 230px',
  }}>
    <ButtonBase onClick={() => onShow(row.id)} aria-label={`${i.name}, ${itemSubtitle(row.id)}`}
      sx={{ display: 'block', width: '100%', textAlign: 'left', color: theme.text, px: 1.25, pt: 1.25, pb: 1.25, '&.Mui-focusVisible': { outline: `2px solid ${theme.accent}`, outlineOffset: -2 } }}>
      <ItemArt id={row.id} height={112} animate={false} />
      <Typography sx={{ mt: 1, fontSize: 13.5, fontWeight: 700, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.name}</Typography>
      <Typography sx={{ fontSize: 11.5, color: i.definition ? theme.textSec : tone, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{itemSubtitle(row.id)}</Typography>
    </ButtonBase>
    {tab === 'inventory' && (row.count > 1 || i.definition) && <Box aria-hidden sx={{ position: 'absolute', top: 8, left: 8, px: 0.75, borderRadius: 999, bgcolor: theme.bgHeader, border: `1px solid ${theme.border}`, fontSize: 11, fontWeight: 800, color: theme.text, pointerEvents: 'none' }}>{row.count} шт.</Box>}
    {equipped && <Box sx={{ position: 'absolute', top: 8, right: canFavorite ? 40 : 8, px: 0.75, borderRadius: 999, bgcolor: theme.accent, color: readableTextOn(theme.accent), fontSize: 10.5, fontWeight: 800, pointerEvents: 'none' }}>Надето</Box>}
    {canFavorite && <IconButton size="small" aria-pressed={favorite} aria-label={favorite ? `Убрать из избранного: ${i.name}` : `В избранное: ${i.name}`} onClick={() => onToggleFavorite(row.id)}
      sx={{ position: 'absolute', top: 4, right: 4, color: favorite ? '#f5c518' : theme.textSec, '&:hover': { color: '#f5c518' } }}>
      <StarGlyph filled={favorite} size={18} />
    </IconButton>}
    {tab === 'market' && i.definition && <Box sx={{ px: 1.25, pb: 1.5, mt: 'auto' }}>
      <Button fullWidth variant="contained" disabled={busy || !priced || balanceVp < Number(price)} onClick={() => onBuyCase(row.id)}
        sx={{ '&&&': { my: 0, fontWeight: 800, border: 'none', background: priced && balanceVp >= Number(price) ? `linear-gradient(135deg, ${theme.accent}, ${theme.accent}aa)` : undefined, '&:hover': { background: priced && balanceVp >= Number(price) ? `linear-gradient(135deg, ${theme.accent}, ${theme.accent}cc)` : undefined } } }}>
        {priced ? (balanceVp < Number(price) ? `Не хватает ${Number(price) - balanceVp} ВП` : `Купить за ${price} ВП`) : 'Цена не назначена'}
      </Button>
    </Box>}
    {tab === 'market' && !i.definition && listing && <Box sx={{ px: 1.25, pb: 1.5, mt: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mb: 0.5, minWidth: 0 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap' }}>{listing.price.toLocaleString('ru-RU')} ВП</Typography>
        <Typography title={listing.seller} sx={{ fontSize: 11, color: theme.textSec, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{listing.isMine ? 'ваш лот' : `@${listing.seller}`}</Typography>
      </Box>
      {listing.isMine ? <Button fullWidth disabled={busy} onClick={() => onListing(listing, false, !!i.pet)} sx={{ '&&': { my: 0 } }}>Снять с продажи</Button>
        : <Button fullWidth variant="contained" disabled={busy || alreadyOwned || balanceVp < listing.price} onClick={() => onListing(listing, true, !!i.pet)} sx={{ '&&': { my: 0 } }}>{alreadyOwned ? 'Уже есть' : balanceVp < listing.price ? `Не хватает ${listing.price - balanceVp} ВП` : 'Купить'}</Button>}
    </Box>}
  </Box>;
});



export default function Store({ onClose }: { onClose: () => void }) {
  const { theme } = useThemeStore();
  const shop = useShopStore();
  const isAdmin = useAuthStore(s => !!s.user?.isAdmin);
  const loot = useLootStore();
  const pets = usePetStore();
  const [error, setError] = useState('');
  const reportError = (error: any) => setError(error.response?.data?.message || 'Не удалось выполнить операцию. Обновите инвентарь.');
  useEffect(() => { void useLootStore.getState().load().catch(reportError); void usePetStore.getState().load().catch(() => undefined); }, []);
  // Both dialogs are portaled: apply the same theme-aware controls to each paper.
  const panelSx = {
    bgcolor: theme.bgSidebar || theme.bg,
    color: theme.text,
    width: { xs: 'calc(100vw - 12px)', sm: 'auto' },
    maxHeight: { xs: 'calc(100dvh - 12px)', sm: 'calc(100dvh - 64px)' },
    m: { xs: '6px', sm: '32px' },
    borderRadius: UI_SURFACE_RADIUS,
    overflow: 'hidden',
    '& .MuiDialogContent-root': { px: { xs: 1.5, sm: 3 }, overflowX: 'hidden' },
    '& .MuiDialogTitle-root': { px: { xs: 1.5, sm: 3 }, overflowWrap: 'anywhere' },
    '& .MuiTypography-root': { overflowWrap: 'anywhere' },
    '& .MuiButton-root': {
      minHeight: 40,
      px: 2,
      py: 0.9,
      my: 0.5,
      borderRadius: UI_INNER_RADIUS,
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
  // Выпадающие списки фильтров (категория/коллекция/редкость/сортировка):
  // плашка полупрозрачная и размывает инвентарь под собой, как остальные меню.
  const filterSelectProps = useMemo(() => ({
    MenuProps: {
      PaperProps: {
        sx: {
          ...frostedPaperSx(theme.bgHeader, theme.border),
          color: theme.text, borderRadius: UI_SURFACE_RADIUS, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          '& .MuiMenuItem-root:hover': { bgcolor: theme.accent + '22' },
          '& .MuiMenuItem-root.Mui-selected': { bgcolor: theme.accent + '33' },
        },
      },
    },
  }), [theme.bgHeader, theme.border, theme.text, theme.accent]);
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
  const selectedPet = selectedCase ? null : findPet(selected || '');
  // Цена преимущественно приходит с сервера (CASE_PRICES); если её ещё нет в выдаче
  // (старый процесс сервера/гонка загрузки) — берём её из локального каталога,
  // чтобы кейс не выглядел «бесценным». Покупка всё равно валидируется сервером.
  const priceOf = (id: string): number | null => {
    const fromServer = loot.prices[id];
    if (Number.isSafeInteger(fromServer) && Number(fromServer) > 0) return Number(fromServer);
    const fromCatalog = findCase(id)?.price;
    return Number.isSafeInteger(fromCatalog) && Number(fromCatalog) > 0 ? Number(fromCatalog) : null;
  };
  const selectedPrice = selectedCase ? priceOf(selectedCase.id) : null;
  const selectedPriceIsSet = Number.isSafeInteger(selectedPrice) && Number(selectedPrice) > 0;
  const [drop, setDrop] = useState<SkinPack | null>(null);
  const [petDrop, setPetDrop] = useState<string | null>(null);
  const [reactionDrop, setReactionDrop] = useState<string | null>(null);
  const reactionOwned = useReactionSkinStore(s => s.owned);
  const [reel, setReel] = useState<SkinPack[]>([]);
  const [petReel, setPetReel] = useState<string[]>([]);
  const [reactionReel, setReactionReel] = useState<string[]>([]);
  const [phase, setPhase] = useState<'idle' | 'ready' | 'rolling' | 'result'>('idle');
  const [bulkCount, setBulkCount] = useState(1);
  const [bulkQueue, setBulkQueue] = useState<Array<{ type: 'pack' | 'pet' | 'reaction'; id: string; result: SkinPack | null }>>([]);
  const [bulkIndex, setBulkIndex] = useState(0);
  useEffect(() => {
    if (phase === 'ready') { const t = window.setTimeout(() => setPhase('rolling'), 50); return () => clearTimeout(t); }
    if (phase === 'rolling') { const t = window.setTimeout(() => setPhase('result'), 5200); return () => clearTimeout(t); }
  }, [phase]);
  useEffect(() => {
    if (phase === 'result' && bulkQueue.length > 0 && bulkIndex < bulkQueue.length) {
      const next = bulkQueue[bulkIndex];
      setBulkIndex(bulkIndex + 1);
      if (next.type === 'reaction') {
        const rewards = selectedCase!.rewards.filter(reward => !!findReactionSkin(reward.key));
        const totalWeight = rewards.reduce((sum, reward) => sum + reward.weight, 0);
        const sequence = Array.from({ length: 48 }, () => {
          let roll = Math.random() * totalWeight;
          return rewards.find(reward => (roll -= reward.weight) < 0)?.key || next.id;
        });
        sequence[40] = next.id;
        setDrop(null); setReel([]); setPetReel([]); setPetDrop(null); setReactionReel(sequence); setReactionDrop(next.id); setPhase('ready');
      } else if (next.type === 'pet') {
        const rewards = selectedCase!.rewards.filter(reward => !!findPet(reward.key));
        const totalWeight = rewards.reduce((sum, reward) => sum + reward.weight, 0);
        const sequence = Array.from({ length: 48 }, () => {
          let roll = Math.random() * totalWeight;
          return rewards.find(reward => (roll -= reward.weight) < 0)!.key;
        });
        sequence[40] = next.id;
        setDrop(null); setReel([]); setReactionReel([]); setReactionDrop(null); setPetReel(sequence); setPetDrop(next.id); setPhase('ready');
      } else if (next.result) {
        const sequence = Array.from({ length: 48 }, () => drawPack(Math.random(), selectedCase!.id));
        sequence[40] = next.result;
        setPetReel([]); setPetDrop(null); setReactionReel([]); setReactionDrop(null); setDrop(next.result); setReel(sequence); setPhase('ready');
      }
    } else if (phase === 'result' && bulkQueue.length > 0 && bulkIndex >= bulkQueue.length) {
      setBulkQueue([]); setBulkIndex(0);
    }
  }, [phase, bulkQueue, bulkIndex, selectedCase]);
  const busy = marketPending || loot.pending || phase === 'ready' || phase === 'rolling';
  const open = async (count = 1) => {
    if (busy || !selectedCase || count < 1) return;
    setError('');
    // Множественное открытие: все кейсы открываются параллельно, затем анимации идут по очереди.
    if (count > 1) {
      try {
        const openResults: Array<{ type: 'pack' | 'pet' | 'reaction'; id: string; result: SkinPack | null }> = [];
        for (let i = 0; i < count; i++) {
          const pack = await loot.openCase(selectedCase.id);
          const lastDrop = useLootStore.getState().lastDrop;
          if (lastDrop && findReactionSkin(lastDrop)) {
            openResults.push({ type: 'reaction', id: lastDrop, result: null });
          } else if (lastDrop?.startsWith('pet-') && findPet(lastDrop)) {
            openResults.push({ type: 'pet', id: lastDrop, result: null });
          } else if (pack) {
            openResults.push({ type: 'pack', id: pack.id, result: pack });
          }
        }
        setBulkQueue(openResults);
        setBulkIndex(0);
        const first = openResults[0];
        if (first.type === 'reaction') {
          const rewards = selectedCase.rewards.filter(reward => !!findReactionSkin(reward.key));
          const totalWeight = rewards.reduce((sum, reward) => sum + reward.weight, 0);
          const sequence = Array.from({ length: 48 }, () => {
            let roll = Math.random() * totalWeight;
            return rewards.find(reward => (roll -= reward.weight) < 0)?.key || first.id;
          });
          sequence[40] = first.id;
          setDrop(null); setReel([]); setPetReel([]); setPetDrop(null); setReactionReel(sequence); setReactionDrop(first.id); setPhase('ready');
          setBulkIndex(1);
        } else if (first.type === 'pet') {
          const rewards = selectedCase.rewards.filter(reward => !!findPet(reward.key));
          const totalWeight = rewards.reduce((sum, reward) => sum + reward.weight, 0);
          const sequence = Array.from({ length: 48 }, () => {
            let roll = Math.random() * totalWeight;
            return rewards.find(reward => (roll -= reward.weight) < 0)!.key;
          });
          sequence[40] = first.id;
          setDrop(null); setReel([]); setReactionReel([]); setReactionDrop(null); setPetReel(sequence); setPetDrop(first.id); setPhase('ready');
          setBulkIndex(1);
        } else if (first.result) {
          const sequence = Array.from({ length: 48 }, () => drawPack(Math.random(), selectedCase.id));
          sequence[40] = first.result;
          setPetReel([]); setPetDrop(null); setReactionReel([]); setReactionDrop(null); setDrop(first.result); setReel(sequence); setPhase('ready');
          setBulkIndex(1);
        }
      } catch (error) { reportError(error); return; }
      return;
    }
    // Одиночное открытие — с рулеткой.
    let result: SkinPack | null;
    try { result = await loot.openCase(selectedCase.id); } catch (error) { reportError(error); return; }
    if (!result) {
      const lastDrop = useLootStore.getState().lastDrop;
      // Скин реакции: та же рулетка, что у паков и питомцев (результат — на 40-й позиции).
      if (lastDrop && findReactionSkin(lastDrop)) {
        const rewards = selectedCase.rewards.filter(reward => !!findReactionSkin(reward.key));
        const totalWeight = rewards.reduce((sum, reward) => sum + reward.weight, 0);
        const sequence = Array.from({ length: 48 }, () => {
          let roll = Math.random() * totalWeight;
          return rewards.find(reward => (roll -= reward.weight) < 0)?.key || lastDrop;
        });
        sequence[40] = lastDrop;
        setDrop(null); setReel([]); setPetReel([]); setPetDrop(null); setReactionReel(sequence); setReactionDrop(lastDrop); setPhase('ready');
        return;
      }
      const petId = lastDrop?.startsWith('pet-') && findPet(lastDrop) ? lastDrop : null;
      if (petId) {
        const rewards = selectedCase.rewards.filter(reward => !!findPet(reward.key));
        const totalWeight = rewards.reduce((sum, reward) => sum + reward.weight, 0);
        const sequence = Array.from({ length: 48 }, () => {
          let roll = Math.random() * totalWeight;
          return rewards.find(reward => (roll -= reward.weight) < 0)!.key;
        });
        sequence[40] = petId;
        setDrop(null); setReel([]); setReactionReel([]); setReactionDrop(null); setPetReel(sequence); setPetDrop(petId); setPhase('ready');
        return;
      }
      return;
    }
    const sequence = Array.from({ length: 48 }, () => drawPack(Math.random(), selectedCase.id));
    sequence[40] = result;
    setPetReel([]); setPetDrop(null); setReactionReel([]); setReactionDrop(null); setDrop(result); setReel(sequence); setPhase('ready');
  };
  // Строки и отфильтрованный список пересчитываются только при изменении
  // их реальных входных данных, а не на каждый тик таймера/фазы рулетки.
  const ownedPetSet = useMemo(() => new Set(pets.ownedPets), [pets.ownedPets]);
  const favoriteSet = useMemo(() => new Set(shop.favoriteIds), [shop.favoriteIds]);
  const listingById = useMemo(() => new Map(shop.marketListings.map(l => [l.id, l])), [shop.marketListings]);
  const lootCounts = { cases: loot.cases, caseCounts: loot.caseCounts };
  const rows = useMemo<StoreRow[]>(() => {
    // Копии предметов пака: сколько раз пак выпадал из кейсов («шт.» в инвентаре).
    const packCountOf = (itemId: string) => {
      const key = packKeyFromItemId(itemId) || SHOP_BY_ID.get(itemId)?.value?.pack;
      return (key && loot.packs[`pack-${key}`]) || 1;
    };
    return tab === 'inventory'
      ? [...CASE_CATALOG.filter(c => isAdmin || caseCount(lootCounts, c.id) > 0).map(c => ({ key: c.id, id: c.id, count: caseCount(lootCounts, c.id) })), ...PET_CATALOG.filter(p => isAdmin || ownedPetSet.has(p.id)).map(p => ({ key: p.id, id: p.id, count: pets.petCounts?.[p.id] || 1 })), ...SHOP_CATALOG.filter(i => isAdmin || i.stock || shop.owned[i.id]).map(i => ({ key: i.id, id: i.id, count: packCountOf(i.id) }))]
      // Скрытые кейсы (на доработке) не участвуют в продаже, но остаются в инвентаре у купивших.
      : [...CASE_CATALOG.filter(c => !isHiddenCase(c)).map(c => ({ key: c.id, id: c.id, count: caseCount(lootCounts, c.id) })), ...shop.marketListings.map(l => ({ key: l.id, id: l.itemId, count: 1 }))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, isAdmin, loot.cases, loot.caseCounts, loot.packs, ownedPetSet, pets.petCounts, shop.owned, shop.marketListings]);
  // Поиск не блокирует ввод: фильтрация большой сетки идёт с низким приоритетом.
  const deferredQuery = useDeferredValue(query);
  const visible = useMemo(() => {
    const needle = deferredQuery.trim().toLocaleLowerCase();
    const filtered = rows.filter(r => { const i = itemInfo(r.id); return (collection === 'all' || collectionOf(r.id) === collection) && (category === 'all' || i.category === category) && (tier === 'all' || i.rarity === tier) && i.lowerName.includes(needle); });
    return filtered.sort((a, b) => sort === 'rarity' ? RARITY_META[itemInfo(b.id).rarity].order - RARITY_META[itemInfo(a.id).rarity].order : sort === 'quantity' ? b.count - a.count : collator.compare(itemInfo(a.id).name, itemInfo(b.id).name));
  }, [rows, deferredQuery, collection, category, tier, sort]);
  // Постепенный рендер: сначала PAGE_SIZE карточек, остальные — при прокрутке.
  const [limit, setLimit] = useState(PAGE_SIZE);
  useEffect(() => { setLimit(PAGE_SIZE); }, [tab, deferredQuery, collection, category, tier, sort]);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const hasMore = visible.length > limit;
  useEffect(() => {
    const node = sentinelRef.current;
    if (!hasMore || !node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) setLimit(n => n + PAGE_SIZE);
    }, { rootMargin: '600px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, limit]);
  const shown = hasMore ? visible.slice(0, limit) : visible;
  const item = selected ? SHOP_BY_ID.get(selected) : undefined;
  const slots = [
    { label: 'Обводка', id: shop.activeRing, clear: () => shop.setActiveRing('') },
    { label: 'Плашка', id: shop.activeSelfCard, clear: () => shop.setActiveSelfCard('') },
    { label: 'Пузырь', id: shop.activeBubble, clear: () => shop.setActiveBubble('') },
  ];
  const favorites = SHOP_CATALOG.filter(i => favoriteSet.has(i.id) && shop.isOwned(i.id) && !i.stock);
  const showItem = useEvent((id: string) => { setSelected(id); setSalePrice('6'); setError(''); setPetDrop(null); setReactionDrop(null); setPetReel([]); setReactionReel([]); setReel([]); setPhase('idle'); });
  const toggleFavorite = useEvent((id: string) => shop.toggleFavorite(id));
  const listingAction = useEvent((listing: MarketListing, buy: boolean, isPet: boolean) => void marketAction(async () => {
    if (buy) await shop.buyListing(listing.id); else await shop.cancelListing(listing.id);
    if (isPet) await pets.load().catch(() => undefined);
  }));
  const sell = () => {
    if (!selected) return;
    if (selectedCase) return;
    if (!validSalePrice) return;
    void marketAction(async () => {
      await shop.listForSale(selected, Number(salePrice));
      if (findPet(selected)) void pets.load().catch(() => undefined);
      setSelected(null); setTab('market');
    });
  };
  const buyCase = useEvent((caseId: string) => {
    setError('');
    void loot.buyCase(caseId).catch(reportError);
  });
  const [topupOpen, setTopupOpen] = useState(false);
  const equippedIds = useMemo(() => new Set([shop.activeRing, shop.activeSelfCard, shop.activeBubble].filter(Boolean)), [shop.activeRing, shop.activeSelfCard, shop.activeBubble]);
  const tabs = [
    { id: 'inventory', label: 'Инвентарь', icon: <Inventory2 sx={{ fontSize: 18 }} /> },
    { id: 'market', label: 'Площадка', icon: <Storefront sx={{ fontSize: 18 }} /> },
  ];
  return <Dialog open fullWidth maxWidth="xl" onClose={() => !busy && onClose()} PaperProps={{ sx: { ...panelSx, width: { xs: 'calc(100vw - 12px)', sm: 'calc(100% - 64px)' }, minHeight: { xs: 'calc(100dvh - 12px)', sm: '70vh' } } }}>
    {/* Шапка: название, переключатель разделов, баланс и закрытие в одну строку. */}
    <DialogTitle component="div" sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: { xs: 1, sm: 2 }, px: { xs: 1.5, sm: 3 }, py: { xs: 1.25, sm: 1.75 }, borderBottom: `1px solid ${theme.border}`, bgcolor: theme.bgHeader }}>
      <Typography component="h2" sx={{ fontSize: { xs: 17, sm: 19 }, fontWeight: 800, letterSpacing: 0.2, mr: { sm: 1 } }}>VERA <Box component="span" sx={{ color: theme.textSec, fontWeight: 600 }}>· {tab === 'inventory' ? 'инвентарь' : 'площадка'}</Box></Typography>
      <Box role="tablist" aria-label="Раздел" sx={{ order: { xs: 3, md: 0 }, width: { xs: '100%', md: 'auto' }, display: 'flex', p: 0.5, gap: 0.5, borderRadius: UI_SURFACE_RADIUS, bgcolor: theme.bgInput, border: `1px solid ${theme.border}` }}>
        {tabs.map(t => <ButtonBase key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
          sx={{ flex: 1, gap: 0.75, px: 2, py: 0.85, borderRadius: UI_INNER_RADIUS, fontSize: 14, fontWeight: 700, color: tab === t.id ? readableTextOn(theme.accent) : theme.textSec, bgcolor: tab === t.id ? theme.accent : 'transparent', transition: 'background-color 140ms ease, color 140ms ease', '&:hover': { color: tab === t.id ? undefined : theme.text }, '&.Mui-focusVisible': { outline: `2px solid ${theme.accent}`, outlineOffset: 2 } }}>
          {t.icon}{t.label}
        </ButtonBase>)}
      </Box>
      <Box sx={{ flex: 1 }} />
      <ButtonBase onClick={() => setTopupOpen(v => !v)} aria-expanded={topupOpen} aria-label={`Баланс ${shop.balanceVp} ВП, пополнить`}
        sx={{ gap: 1, px: 1.5, py: 0.75, borderRadius: UI_SURFACE_RADIUS, border: `1px solid ${topupOpen ? theme.accent : theme.border}`, bgcolor: theme.bgInput, color: theme.text, '&:hover': { borderColor: theme.accent }, '&.Mui-focusVisible': { outline: `2px solid ${theme.accent}`, outlineOffset: 2 } }}>
        <AccountBalanceWallet sx={{ fontSize: 18, color: theme.accent }} />
        <Box component="span" sx={{ fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap' }}>{shop.balanceVp.toLocaleString('ru-RU')} ВП</Box>
        <Box component="span" sx={{ fontSize: 12, fontWeight: 700, color: theme.accent, display: { xs: 'none', sm: 'inline' } }}>{topupOpen ? 'Скрыть' : '+ Пополнить'}</Box>
      </ButtonBase>
      <IconButton aria-label="Закрыть" disabled={busy} onClick={onClose} sx={{ color: theme.textSec, '&:hover': { color: theme.text, bgcolor: theme.bgHover } }}><Close /></IconButton>
    </DialogTitle>
    <DialogContent sx={{ px: { xs: 1, sm: 3 }, py: { xs: 1.5, sm: 2.5 }, overflowX: 'hidden' }}>
      <Collapse in={topupOpen} unmountOnExit>
        <Box sx={{ mt: 1.5, mb: 2, p: 2, borderRadius: UI_SURFACE_RADIUS, border: `1px solid ${theme.border}`, bgcolor: theme.bgInput, '& > .MuiBox-root': { mb: 0 } }}><WalletTopup /></Box>
      </Collapse>
      {error && <Typography role="alert" sx={{ mt: 1.5, mb: 1, px: 1.5, py: 1, borderRadius: UI_INNER_RADIUS, bgcolor: '#f4433618', border: '1px solid #f4433655', color: '#ff8a80', fontSize: 13.5 }}>{error}</Typography>}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: tab === 'inventory' ? '260px minmax(0,1fr)' : 'minmax(0,1fr)' }, gap: { xs: 1.5, md: 2.5 }, alignItems: 'start', mt: 1.5 }}>
      {tab === 'inventory' && <Box component="aside" aria-label="Надетые и избранные скины" sx={{ position: { md: 'sticky' }, top: { md: 0 }, p: { xs: 1.25, sm: 1.75 }, bgcolor: theme.bgHeader, border: `1px solid ${theme.border}`, borderRadius: UI_SURFACE_RADIUS, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box>
          <Typography component="h3" sx={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: theme.textSec, mb: 1 }}>Надето</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(3, minmax(0, 1fr))', md: 'minmax(0, 1fr)' }, gap: 0.75 }}>
            {slots.map(slot => {
              const equipped = SHOP_CATALOG.find(i => i.id === slot.id && !i.stock);
              const tone = equipped?.rarity ? RARITY_META[equipped.rarity].color : theme.border;
              return <Box key={slot.label} sx={{ position: 'relative', minWidth: 0, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: 'center', gap: 1, p: 0.75, borderRadius: UI_INNER_RADIUS, bgcolor: theme.bgInput, border: `1px solid ${equipped ? tone + '88' : theme.border}`, borderStyle: equipped ? 'solid' : 'dashed' }}>
                <ButtonBase disabled={!equipped} onClick={() => equipped && showItem(equipped.id)} aria-label={equipped ? `${slot.label}: ${equipped.name}` : `${slot.label}: стандартный вид`}
                  sx={{ flex: 1, minWidth: 0, width: '100%', display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: 'center', gap: 1, textAlign: { xs: 'center', md: 'left' }, borderRadius: UI_INNER_RADIUS, color: theme.text }}>
                  <Box sx={{ width: { xs: '100%', md: 72 }, flexShrink: 0, overflow: 'hidden', transform: { md: 'scale(0.82)' }, transformOrigin: 'center' }}>
                    {equipped ? <Preview item={equipped} height={64} /> : <Box sx={{ height: 64, display: 'grid', placeItems: 'center', color: theme.textSec, fontSize: 22 }}>—</Box>}
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1, width: '100%' }}>
                    <Typography sx={{ fontSize: 11, color: theme.textSec, lineHeight: 1.2 }}>{slot.label}</Typography>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{equipped ? equipped.name : 'Стандартный вид'}</Typography>
                  </Box>
                </ButtonBase>
                {equipped && <IconButton size="small" onClick={slot.clear} aria-label={`Снять: ${equipped.name}`} sx={{ position: { xs: 'absolute', md: 'static' }, top: 2, right: 2, color: theme.textSec, '&:hover': { color: theme.text } }}><Close sx={{ fontSize: 16 }} /></IconButton>}
              </Box>;
            })}
          </Box>
        </Box>
        <Box>
          <Typography component="h3" sx={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: theme.textSec, mb: 1 }}>Избранные · {favorites.length}</Typography>
          {!favorites.length && <Typography sx={{ color: theme.textSec, fontSize: 12.5, lineHeight: 1.5 }}>Отмечайте скины звёздочкой на карточке, чтобы быстро переключаться между ними.</Typography>}
          <Box sx={{ maxHeight: { xs: 200, md: 380 }, overflowY: 'auto', display: 'grid', gridTemplateColumns: { xs: 'repeat(3, minmax(0, 1fr))', md: 'repeat(2, minmax(0, 1fr))' }, gap: 0.75 }}>{favorites.map(favorite => {
            const on = equippedIds.has(favorite.id);
            return <Box key={favorite.id} sx={{ minWidth: 0, borderRadius: UI_INNER_RADIUS, bgcolor: theme.bgInput, border: `1px solid ${on ? theme.accent : theme.border}`, overflow: 'hidden' }}>
              <ButtonBase onClick={() => showItem(favorite.id)} aria-label={favorite.name} sx={{ display: 'block', width: '100%', color: theme.text, px: 0.5, pt: 0.5 }}>
                <Box sx={{ overflow: 'hidden' }}><Preview item={favorite} height={60} /></Box>
                <Typography sx={{ fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center' }}>{favorite.name}</Typography>
              </ButtonBase>
              <Box sx={{ display: 'flex' }}>
                <ButtonBase onClick={() => selectShopItem(favorite.id)} sx={{ flex: 1, py: 0.6, fontSize: 11.5, fontWeight: 700, color: on ? theme.accent : theme.text, '&:hover': { bgcolor: theme.bgHover } }}>{on ? 'Снять' : 'Надеть'}</ButtonBase>
                <IconButton size="small" onClick={() => shop.toggleFavorite(favorite.id)} aria-label={`Убрать из избранного: ${favorite.name}`} sx={{ borderRadius: 0, color: '#f5c518' }}><StarGlyph filled size={16} /></IconButton>
              </Box>
            </Box>;
          })}</Box>
        </Box>
      </Box>}
      <Box sx={{ minWidth: 0 }}>
      {/* Панель фильтров: поиск во всю ширину, быстрые категории чипами,
          затем коллекция/редкость/сортировка. */}
      <Box sx={{ p: { xs: 1, sm: 1.25 }, mb: 1.5, borderRadius: UI_SURFACE_RADIUS, bgcolor: theme.bgHeader, border: `1px solid ${theme.border}`, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box role="group" aria-label="Категория" sx={{ display: 'flex', gap: 0.5, overflowX: 'auto', pb: 0.25, scrollbarWidth: 'thin' }}>
        {categories.map(([id, label]) => <ButtonBase key={id} aria-pressed={category === id} onClick={() => setCategory(id)}
          sx={{ flexShrink: 0, px: 1.5, py: 0.6, borderRadius: 999, fontSize: 13, fontWeight: 700, border: `1px solid ${category === id ? theme.accent : theme.border}`, bgcolor: category === id ? theme.accent + '22' : 'transparent', color: category === id ? theme.text : theme.textSec, '&:hover': { color: theme.text, borderColor: theme.accent + '88' }, '&.Mui-focusVisible': { outline: `2px solid ${theme.accent}`, outlineOffset: 1 } }}>
          {label}
        </ButtonBase>)}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr) minmax(0, 1fr)', sm: 'minmax(180px, 2fr) repeat(3, minmax(0, 1fr))' }, gap: 0.75, '& .MuiInputBase-root': { color: theme.text, bgcolor: theme.bgInput, borderRadius: UI_INNER_RADIUS }, '& .MuiOutlinedInput-notchedOutline': { borderColor: theme.border }, '& .MuiInputLabel-root': { color: theme.textSec }, '& .MuiSvgIcon-root': { color: theme.textSec }, '& .MuiFormControl-root, & .MuiTextField-root': { minWidth: 0, width: '100%' } }}>
        <TextField size="small" placeholder={tab === 'market' ? 'Поиск по площадке' : 'Поиск в инвентаре'} inputProps={{ 'aria-label': 'Поиск' }} value={query} onChange={e => setQuery(e.target.value)} sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }} />
        <TextField select size="small" SelectProps={filterSelectProps} label="Коллекция" value={collection} onChange={e => setCollection(e.target.value)} sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}>
          <MenuItem value="all">Все коллекции</MenuItem>
          {CASE_CATALOG.filter(definition => !isHiddenCase(definition) || caseCount(loot, definition.id) > 0).map(definition => <MenuItem key={definition.id} value={definition.id}>{definition.name}</MenuItem>)}
        </TextField>
        <TextField select size="small" SelectProps={filterSelectProps} label="Редкость" value={tier} onChange={e => setTier(e.target.value)}><MenuItem value="all">Все редкости</MenuItem>{Object.values(RARITY_META).map(r => <MenuItem key={r.id} value={r.id}><Box component="span" sx={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', bgcolor: r.color, mr: 1 }} />{r.label}</MenuItem>)}</TextField>
        <TextField select size="small" SelectProps={filterSelectProps} label="Сортировка" value={sort} onChange={e => setSort(e.target.value)}><MenuItem value="name">По имени</MenuItem><MenuItem value="rarity">По редкости ↓</MenuItem><MenuItem value="quantity">По количеству ↓</MenuItem></TextField>
      </Box>
      </Box>
      <Typography aria-live="polite" sx={{ fontSize: 12, color: theme.textSec, mb: 1, px: 0.25 }}>{tab === 'market' ? 'Лотов и кейсов' : 'Предметов'}: {visible.length}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(auto-fill, minmax(168px, 1fr))' }, gap: { xs: 0.75, sm: 1.25 } }}>{shown.map(row => { const i = itemInfo(row.id); const listing = tab === 'market' && !i.definition ? listingById.get(row.key) : undefined; return <StoreCard key={row.key} row={row} tab={tab} theme={theme} busy={busy} balanceVp={shop.balanceVp} price={i.definition ? priceOf(row.id) : null} listing={listing} alreadyOwned={listing ? (i.pet ? ownedPetSet.has(i.pet.id) : !!shop.owned[listing.itemId]) : false} equipped={tab === 'inventory' && (equippedIds.has(row.id) || (!!i.pet && pets.equippedPet?.id === row.id))} favorite={favoriteSet.has(row.id)} onShow={showItem} onBuyCase={buyCase} onListing={listingAction} onToggleFavorite={toggleFavorite} />; })}</Box>
      {hasMore && <Box ref={sentinelRef} sx={{ textAlign: 'center', py: 2 }}><Button onClick={() => setLimit(n => n + PAGE_SIZE)}>Показать ещё · {visible.length - limit}</Button></Box>}
      {!visible.length && <Box sx={{ textAlign: 'center', py: 8, color: theme.textSec }}>
        <Search sx={{ fontSize: 44, opacity: 0.6 }} />
        <Typography sx={{ mt: 1, fontWeight: 700, color: theme.text }}>Предметов не найдено</Typography>
        <Typography sx={{ fontSize: 13, mt: 0.5 }}>{tab === 'market' ? 'На площадке пока нет таких лотов.' : 'Попробуйте сбросить фильтры.'}</Typography>
        {(query || category !== 'all' || tier !== 'all' || collection !== 'all') && <Button sx={{ mt: 1.5 }} onClick={() => { setQuery(''); setCategory('all'); setTier('all'); setCollection('all'); }}>Сбросить фильтры</Button>}
      </Box>}
      </Box>
      </Box>
    </DialogContent>
    <Dialog open={!!selected} fullWidth maxWidth="md" onClose={() => !busy && setSelected(null)} PaperProps={{ sx: panelSx }}>
      <DialogTitle component="div" sx={{ display: 'flex', alignItems: 'center', gap: 1, borderBottom: `1px solid ${theme.border}`, py: 1.5 }}>
        <Typography component="h2" sx={{ flex: 1, minWidth: 0, fontSize: 18, fontWeight: 800 }}>{selectedCase ? `Кейс «${selectedCase.name}»` : selectedPet ? selectedPet.name : item?.name}</Typography>
        <IconButton aria-label="Закрыть" disabled={busy} onClick={() => setSelected(null)} sx={{ color: theme.textSec, '&:hover': { color: theme.text, bgcolor: theme.bgHover } }}><Close /></IconButton>
      </DialogTitle><DialogContent sx={{ pt: '16px !important', pb: 3 }}>
        {selectedCase ? <>
            {phase === 'idle' && <>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: '220px minmax(0, 1fr)' }, gap: 2, alignItems: 'center', p: 2, borderRadius: UI_SURFACE_RADIUS, border: `1px solid ${(selectedCase.color || theme.accent)}44`, background: `radial-gradient(circle at 18% 50%, ${(selectedCase.color || theme.accent)}26, transparent 60%), ${theme.bgInput}` }}>
              <CaseArt definition={selectedCase} price={selectedPrice} size={140} />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 11, fontWeight: 900, letterSpacing: 1.2, textTransform: 'uppercase', color: selectedCase.color || theme.accent }}>Кейс · {caseContents(selectedCase)}</Typography>
                <Typography sx={{ color: theme.textSec, mt: 0.75, fontSize: 14, lineHeight: 1.55 }}>{isHiddenCase(selectedCase) ? 'Кейс временно снят с продажи: питомцы на доработке.' : null} {caseDescription(selectedCase) || (selectedCase.packs.length ? 'Внутри один уникальный пак: обводка, плашка и пузырь. Паки этой коллекции не встречаются в других кейсах.' : 'Внутри один случайный питомец из этой коллекции.')}</Typography>
              </Box>
            </Box>
            {/* Два явных шага вместо двух безликих кнопок: сначала покупаем
                кейс (шаг 1), затем открываем то, что уже в инвентаре (шаг 2).
                Кнопки-CTA заливкой выделяются из общего стиля диалога (&&& —
                чтобы перебить descendant-селекторы panelSx). */}
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5, mt: 2, alignItems: 'stretch' }}>
              {!isHiddenCase(selectedCase) && (() => {
                const enough = selectedPriceIsSet && shop.balanceVp >= Number(selectedPrice);
                return <Box sx={{ flex: 1, minWidth: 0, p: 1.5, borderRadius: UI_SURFACE_RADIUS, border: `1px solid ${theme.border}`, bgcolor: theme.bgInput, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 900, letterSpacing: 1, textTransform: 'uppercase', color: theme.accent }}>Шаг 1 · Покупка</Typography>
                  <Typography sx={{ fontSize: 13, color: theme.textSec }}>Кейс стоит <strong style={{ color: theme.text }}>{selectedPriceIsSet ? `${selectedPrice} ВП` : '—'}</strong>, ваш баланс: <strong style={{ color: enough ? theme.text : '#f44336' }}>{shop.balanceVp} ВП</strong></Typography>
                  <Button variant="contained" fullWidth size="large" disabled={busy || !selectedPriceIsSet || !enough}
                    onClick={() => { setError(''); void loot.buyCase(selectedCase.id).catch(reportError); }}
                    sx={{ '&&&': { py: 1.15, fontSize: 15, fontWeight: 800, borderRadius: UI_INNER_RADIUS, border: 'none', background: enough ? `linear-gradient(135deg, ${theme.accent}, ${theme.accent}aa)` : undefined, boxShadow: enough ? `0 6px 18px ${theme.accent}44` : undefined, '&:hover': { background: enough ? `linear-gradient(135deg, ${theme.accent}, ${theme.accent}cc)` : undefined } } }}>
                    {selectedPriceIsSet ? `Купить за ${selectedPrice} ВП` : 'Цена не назначена'}
                  </Button>
                  <Typography sx={{ fontSize: 12, color: theme.textSec, minHeight: '1.2em' }}>
                    {selectedPriceIsSet && !enough ? `Не хватает ${Number(selectedPrice) - shop.balanceVp} ВП — пополните кошелёк` : 'После покупки кейс появится в инвентаре (шаг 2)'}
                  </Typography>
                </Box>;
              })()}
              {(() => {
                const owned = caseCount(loot, selectedCase.id);
                const color = selectedCase.color;
                return <Box sx={{ flex: 1, minWidth: 0, p: 1.5, borderRadius: UI_SURFACE_RADIUS, border: `1px solid ${color}55`, bgcolor: theme.bgInput, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 900, letterSpacing: 1, textTransform: 'uppercase', color }}>Шаг 2 · Открытие</Typography>
                  <Typography sx={{ fontSize: 13, color: theme.textSec }}>В инвентаре: <strong style={{ color: owned > 0 ? color : theme.text }}>{owned} шт.</strong> · открытие бесплатное</Typography>
                  <Box sx={{ display: 'flex', gap: 0.75, mb: 0.5 }}>
                    {[1, 3, 5, 10].map(n => (
                      <Button key={n} variant={bulkCount === n ? 'contained' : 'outlined'} size="small"
                        disabled={owned < n} onClick={() => setBulkCount(n)}
                        sx={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, py: 0.5, borderColor: `${color}66`, color: bulkCount === n ? undefined : color, '&:hover': { borderColor: color } }}>
                        {n}
                      </Button>
                    ))}
                  </Box>
                  <Button variant="contained" fullWidth size="large" disabled={busy || owned < bulkCount} onClick={() => open(bulkCount)}
                    sx={{ '&&&': { py: 1.15, fontSize: 15, fontWeight: 800, borderRadius: UI_INNER_RADIUS, border: 'none', background: owned >= bulkCount ? `linear-gradient(135deg, ${color}, ${color}aa)` : undefined, boxShadow: owned >= bulkCount ? `0 6px 18px ${color}44` : undefined, '&:hover': { background: owned >= bulkCount ? `linear-gradient(135deg, ${color}, ${color}cc)` : undefined } } }}>
                    {owned >= bulkCount ? `Открыть ${bulkCount === 1 ? 'кейс' : `${bulkCount} шт.`}` : 'Нет кейсов — купите выше'}
                  </Button>
                  <Typography sx={{ fontSize: 12, color: theme.textSec, minHeight: '1.2em' }}>
                    {selectedCase.packs.length ? 'Внутри — один случайный пак этой коллекции' : selectedCase.rewards.some(r => r.key.startsWith('rx-')) ? 'Внутри — один случайный скин реакции' : 'Внутри — один случайный питомец этой коллекции'}
                  </Typography>
                </Box>;
              })()}
            </Box>
            {error && <Typography role="alert" color="error" sx={{ mt: 1 }}>{error}</Typography>}
            <Typography component="h3" sx={{ mt: 3, mb: 1.25, fontSize: 11, fontWeight: 900, letterSpacing: 1.2, textTransform: 'uppercase', color: theme.textSec }}>Содержимое и вероятности:</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 1 }}>
              {casePacks(selectedCase.id).map(p => <Box key={p.id} sx={{ position: 'relative', pb: 0.75 }}><PackArtwork pack={p} compact /><Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 0.5, color: RARITY_META[rarity(p)].color, fontWeight: 700 }}>{RARITY_META[rarity(p)].label} · <Box component="span" sx={{ color: theme.textSec }}>{formatChance(packChance(p, selectedCase.id))}</Box></Typography></Box>)}
              {selectedCase.rewards.filter(reward => reward.key.startsWith('pet-') && findPet(reward.key)).map(reward => {
                const totalWeight = selectedCase.rewards.reduce((sum, r) => sum + r.weight, 0);
                const pet = findPet(reward.key)!;
                return <Box key={reward.key} sx={{ textAlign: 'center', p: 1, borderRadius: UI_SURFACE_RADIUS, border: `1px solid ${theme.border}`, borderBottom: `3px solid ${RARITY_META[pet.rarity].color}`, background: `linear-gradient(180deg, ${theme.bgInput} 40%, ${RARITY_META[pet.rarity].color}1f)` }}><Box sx={{ height: 96, display: 'grid', placeItems: 'center' }}><PetArtwork petId={pet.id} size={80} animate={false} /></Box><Typography sx={{ fontSize: 12, fontWeight: 700 }}>{pet.name}</Typography><Typography variant="caption" sx={{ display: 'block', color: theme.textSec }}>{RARITY_META[pet.rarity].label} · {formatChance(reward.weight / totalWeight * 100)}</Typography></Box>;
              })}
              {selectedCase.rewards.filter(reward => findReactionSkin(reward.key)).map(reward => {
                const totalWeight = selectedCase.rewards.reduce((sum, r) => sum + r.weight, 0);
                const skin = findReactionSkin(reward.key)!;
                return <Box key={reward.key} sx={{ textAlign: 'center', p: 1, border: `1px solid ${theme.border}`, borderBottom: `3px solid ${RARITY_META[skin.rarity].color}`, borderRadius: UI_SURFACE_RADIUS }}>
                  <Box sx={{ height: 56, display: 'grid', placeItems: 'center' }}><ReactionGlyph value={skin.id} size={36} /></Box>
                  <Typography sx={{ fontSize: 12 }}>{skin.name}{reactionOwned[skin.id] ? ` · ×${reactionOwned[skin.id]}` : ''}</Typography>
                  <Typography variant="caption" sx={{ display: 'block', color: theme.textSec }}>{RARITY_META[skin.rarity].label} · {formatChance(reward.weight / totalWeight * 100)}</Typography>
                </Box>;
              })}
            </Box>
          </>}
          {phase !== 'idle' && (reel.length > 0 || petReel.length > 0 || reactionReel.length > 0) && <Box sx={{ position: 'relative', overflow: 'hidden', height: 168, my: 2, borderRadius: UI_SURFACE_RADIUS, border: `1px solid ${theme.border}`, bgcolor: theme.bgHeader,
            // Затемнение краёв ленты и маркер-указатель по центру.
            '&::before': { content: '""', position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none', background: `linear-gradient(90deg, ${theme.bgHeader} 0%, transparent 22%, transparent 78%, ${theme.bgHeader} 100%)` },
            '&::after': { content: '""', position: 'absolute', top: 0, bottom: 0, left: 'calc(50% - 1px)', width: 2, zIndex: 2, bgcolor: theme.accent, boxShadow: `0 0 12px ${theme.accent}` } }}>
            <Box sx={{ display: 'flex', gap: '8px', position: 'absolute', top: 8, left: '50%', transform: `translateX(-${phase === 'ready' ? 80 : 40 * 168 + 80}px)`, transition: phase === 'ready' ? 'none' : 'transform 5s cubic-bezier(.08,.65,.12,1)' }}>
              {reel.map((p, n) => <Box key={n} sx={{ width: 160, flexShrink: 0, height: 150, boxSizing: 'border-box', p: 0.5, borderBottom: `4px solid ${RARITY_META[rarity(p)].color}` }}><PackArtwork pack={p} compact /></Box>)}
              {petReel.map((id, n) => {
                const pet = findPet(id)!;
                return <Box key={n} sx={{ width: 160, flexShrink: 0, height: 150, boxSizing: 'border-box', p: 0.5, borderBottom: `4px solid ${RARITY_META[pet.rarity].color}`, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <PetArtwork petId={id} size={110} />
                  <Typography sx={{ fontSize: 12, textAlign: 'center' }}>{pet.name}</Typography>
                </Box>;
              })}
              {reactionReel.map((id, n) => {
                const skin = findReactionSkin(id)!;
                return <Box key={n} data-vera-reaction-reel sx={{ width: 160, flexShrink: 0, height: 150, boxSizing: 'border-box', p: 0.5, borderBottom: `4px solid ${RARITY_META[skin.rarity].color}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                  <ReactionGlyph value={id} size={80} />
                  <Typography sx={{ fontSize: 12, textAlign: 'center' }}>{skin.name}</Typography>
                </Box>;
              })}
            </Box>
          </Box>}
          {phase === 'result' && drop && <Box aria-live="polite">
            <Typography variant="h5" sx={{ mb: 2 }}>Выпал пак «{drop.name}»{(loot.packs[drop.id] || 1) > 1 ? ` · ×${loot.packs[drop.id]}` : ''}</Typography><PackArtwork pack={drop} />
            <Typography sx={{ color: RARITY_META[rarity(drop)].color, mt: 1 }}>{RARITY_META[rarity(drop)].label}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(3,minmax(0,1fr))' }, gap: 1 }}>{[drop.ring, drop.selfcard, drop.bubble].map(id => { const part = SHOP_CATALOG.find(i => i.id === id)!; return <Box key={id}><Preview item={part} /><Typography>{part.name}</Typography></Box>; })}</Box>
            <Button onClick={() => loot.equipPack(drop.id)}>Надеть пак</Button>
            {bulkQueue.length > 0 && bulkIndex < bulkQueue.length && <Typography sx={{ mt: 1, color: theme.textSec }}>Открыто {bulkIndex} из {bulkQueue.length}</Typography>}
          </Box>}
          {phase === 'result' && reactionDrop && findReactionSkin(reactionDrop) && (() => {
            const skin = findReactionSkin(reactionDrop)!;
            return <Box aria-live="polite" sx={{ textAlign: 'center', py: 2 }}>
              <Typography variant="h5" sx={{ mb: 2 }}>Выпал скин «{skin.name}»{(reactionOwned[skin.id] || 1) > 1 ? ` · ×${reactionOwned[skin.id]}` : ''}</Typography>
              <ReactionGlyph value={skin.id} size={72} />
              <Typography sx={{ color: RARITY_META[skin.rarity].color, mt: 1 }}>{RARITY_META[skin.rarity].label}</Typography>
              <Typography sx={{ color: theme.textSec, mt: 1 }}>Поставьте скин в один из 10 слотов реакций: профиль → панель «Реакции».</Typography>
              {bulkQueue.length > 0 && bulkIndex < bulkQueue.length && <Typography sx={{ mt: 1, color: theme.textSec }}>Открыто {bulkIndex} из {bulkQueue.length}</Typography>}
              <Button onClick={() => { setReactionDrop(null); setReactionReel([]); bulkQueue.length === 0 ? setPhase('idle') : setPhase('result'); }}>Далее</Button>
            </Box>;
          })()}
          {phase === 'result' && petDrop && findPet(petDrop) && <Box aria-live="polite">
            <Typography variant="h5" sx={{ mb: 2 }}>Выпал питомец «{findPet(petDrop)!.name}»{(pets.petCounts?.[petDrop] || 1) > 1 ? ` · ×${pets.petCounts[petDrop]}` : ''}</Typography>
            <PetArtwork petId={petDrop} size={140} />
            <Typography sx={{ color: RARITY_META[findPet(petDrop)!.rarity].color, mt: 1 }}>{RARITY_META[findPet(petDrop)!.rarity].label}</Typography>
            {bulkQueue.length > 0 && bulkIndex < bulkQueue.length && <Typography sx={{ mt: 1, color: theme.textSec }}>Открыто {bulkIndex} из {bulkQueue.length}</Typography>}
            <Button disabled={!pets.ownedPets.includes(petDrop)} onClick={() => { void pets.equip(petDrop).catch(reportError); setSelected(null); }}>{pets.equippedPet?.id === petDrop ? 'Питомец уже надет' : 'Надеть питомца'}</Button>
          </Box>}
        </> : (selectedPet || item) && (() => {
          const id = (selectedPet?.id || item!.id);
          const tier = RARITY_META[selectedPet ? selectedPet.rarity : item!.rarity || 'common'];
          const ownedHere = selectedPet ? pets.ownedPets.includes(selectedPet.id) : !!item && !item.stock && !!shop.owned[item.id];
          const on = selectedPet ? pets.equippedPet?.id === selectedPet.id : equippedIds.has(id);
          const description = selectedPet ? `${selectedPet.name} — спутник, который живёт на экране рядом с чатом. Его можно перетаскивать, менять размер и имя в профиле.` : item!.description;
          const collectionId = collectionOf(id);
          const collectionName = collectionId ? findCase(collectionId)?.name : undefined;
          const count = selectedPet ? (pets.petCounts?.[selectedPet.id] || 1) : rows.find(r => r.id === id)?.count || 1;
          return <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 5fr) minmax(0, 6fr)' }, gap: { xs: 2, sm: 3 }, pt: 1 }}>
            {/* Витрина предмета: крупный арт на фоне цвета редкости. */}
            <Box sx={{ position: 'relative', borderRadius: UI_SURFACE_RADIUS, border: `1px solid ${tier.color}55`, background: `radial-gradient(circle at 50% 40%, ${tier.color}30, transparent 70%), ${theme.bgInput}`, display: 'grid', placeItems: 'center', minHeight: 220, overflow: 'hidden', '&::after': { content: '""', position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, bgcolor: tier.color } }}>
              <Box sx={{ width: '100%', transform: selectedPet ? 'none' : 'scale(1.35)' }}><ItemArt id={id} height={selectedPet ? 180 : 150} animate /></Box>
            </Box>
            <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                <Box sx={{ px: 1, py: 0.25, borderRadius: 999, fontSize: 12, fontWeight: 800, color: tier.color, border: `1px solid ${tier.color}66`, bgcolor: tier.color + '14' }}>{tier.label}</Box>
                <Box sx={{ px: 1, py: 0.25, borderRadius: 999, fontSize: 12, fontWeight: 700, color: theme.textSec, border: `1px solid ${theme.border}` }}>{CATEGORY_LABELS[itemInfo(id).category || ''] || 'Предмет'}</Box>
                {ownedHere && count > 1 && <Box sx={{ px: 1, py: 0.25, borderRadius: 999, fontSize: 12, fontWeight: 700, color: theme.text, border: `1px solid ${theme.border}` }}>{count} шт.</Box>}
                {on && <Box sx={{ px: 1, py: 0.25, borderRadius: 999, fontSize: 12, fontWeight: 800, bgcolor: theme.accent, color: readableTextOn(theme.accent) }}>Надето</Box>}
              </Box>
              <Typography sx={{ color: theme.textSec, fontSize: 14, lineHeight: 1.55 }}>{description}</Typography>
              {collectionName && <Typography sx={{ fontSize: 12.5, color: theme.textSec }}>Коллекция: <Box component="span" sx={{ color: theme.text, fontWeight: 700 }}>{collectionName}</Box></Typography>}
              {item && !item.stock && <FormControlLabel sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: 13.5 } }} control={<Checkbox size="small" checked={shop.colorModes[item.id] === 'theme'} onChange={e => shop.setColorMode(item.id, e.target.checked ? 'theme' : 'stock')} />} label="Под цвет темы (без галочки — стоковый цвет)" />}
              {!ownedHere && !item?.stock
                ? <Typography sx={{ color: theme.textSec, fontSize: 13.5 }}>{selectedPet ? 'Питомец ещё не получен — он выпадает из кейса или продаётся на площадке.' : 'Предмета нет в инвентаре — его можно получить из кейса или купить на площадке.'}</Typography>
                : <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Button variant="contained" disabled={busy} onClick={() => { if (selectedPet) void pets.equip(on ? null : selectedPet.id).catch(reportError); else selectShopItem(item!.id); }}
                    sx={{ '&&': { m: 0, flex: 1, minWidth: 140 } }}>
                    {item?.stock ? 'Использовать стандартный вид' : on ? 'Снять' : 'Надеть'}
                  </Button>
                  {item && !item.stock && <Button disabled={busy} aria-pressed={favoriteSet.has(item.id)} startIcon={<Box component="span" sx={{ color: favoriteSet.has(item.id) ? '#f5c518' : 'inherit', display: 'inline-flex' }}><StarGlyph filled={favoriteSet.has(item.id)} size={18} /></Box>} onClick={() => shop.toggleFavorite(item.id)} sx={{ '&&': { m: 0 } }}>{favoriteSet.has(item.id) ? 'В избранном' : 'В избранное'}</Button>}
                </Box>}
              {ownedHere && <Box sx={{ mt: 0.5, p: 1.5, borderRadius: UI_SURFACE_RADIUS, border: `1px solid ${theme.border}`, bgcolor: theme.bgInput }}>
                <Typography sx={{ fontSize: 11, fontWeight: 900, letterSpacing: 1, textTransform: 'uppercase', color: theme.accent, mb: 1 }}>Продать на площадке</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) auto' }, gap: 1, alignItems: 'start' }}>
                  <TextField size="small" type="number" label="Цена покупателя, ВП" value={salePrice} disabled={busy} onChange={e => setSalePrice(e.target.value)} inputProps={{ min: 6, max: 100000000, step: 1 }} error={!validSalePrice} helperText={validSalePrice ? `Вы получите ${Math.floor(Number(salePrice) * 85 / 100).toLocaleString('ru-RU')} ВП · комиссия 15%` : 'Целое число от 6 до 100000000 ВП'} />
                  <Button variant="contained" disabled={busy || !validSalePrice} onClick={sell} sx={{ '&&': { m: 0, minHeight: 40 } }}>Выставить</Button>
                </Box>
              </Box>}
            </Box>
          </Box>;
        })()}
        {error && <Typography role="alert" sx={{ mt: 1.5, color: '#ff8a80', fontSize: 13.5 }}>{error}</Typography>}
      </DialogContent>
    </Dialog>
  </Dialog>;
}
export function StoreOpen() {
  const open = useShopStore(s => s.open);
  const setOpen = useShopStore(s => s.setOpen);
  return open ? <Store onClose={() => setOpen(false)} /> : null;
}
