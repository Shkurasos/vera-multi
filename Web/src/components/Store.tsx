import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Checkbox, Dialog, DialogContent, DialogTitle, FormControlLabel, MenuItem, TextField, Typography } from '@mui/material';
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

// Минималистичная карточка кейса: узнаваемый силуэт сундука, явная цена
// и метка «КЕЙС». Название кейса внутри арта не дублируем — его показывают
// заголовок диалога и подпись карточки в сетке.
const CaseArt = memo(function CaseArt({ definition, price }: { definition: CaseDefinition; price?: number | null }) {
  const theme = useThemeStore(s => s.theme);
  const accent = definition.color;
  const value = price === undefined ? definition.price : price;
  const priceLabel = Number.isSafeInteger(value) && Number(value) > 0 ? `${value} ВП` : '—';
  return <Box sx={{ width: 'min(100%, 240px)', aspectRatio: '1.42', mx: 'auto', my: 2, p: 1.25, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 0.5, border: `1px solid ${theme.border}`, borderTop: `3px solid ${accent}`, borderRadius: UI_SURFACE_RADIUS, bgcolor: theme.bgInput }}>
    <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, minWidth: 0 }}>
      <Typography component="span" sx={{ color: accent, fontSize: 9, fontWeight: 900, letterSpacing: 1.4 }}>КЕЙС</Typography>
      <Typography component="span" sx={{ color: theme.text, fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap' }}>{priceLabel}</Typography>
    </Box>
    <Box sx={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
      <svg viewBox="0 0 100 100" style={{ width: '62%', height: 'auto', maxWidth: 88, maxHeight: '100%' }} aria-hidden="true">
        <ellipse cx="50" cy="88" rx="26" ry="3" fill={accent} opacity=".18" />
        <path d="M16 50V44C16 33.5 31.5 26 50 26C68.5 26 84 33.5 84 44V50H16Z" fill={`${accent}26`} stroke={accent} strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M14 50H86V76C86 79.3 83.3 82 80 82H20C16.7 82 14 79.3 14 76V50Z" fill={`${accent}14`} stroke={accent} strokeWidth="2.4" strokeLinejoin="round" />
        <g transform="translate(37 56) scale(0.26)" fill="none" stroke={accent} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" opacity=".9">
          <path d={definition.mark} />
        </g>
        <rect x="45" y="44" width="10" height="14" rx="2.5" fill={accent} />
        <circle cx="50" cy="50.5" r="1.8" fill={theme.bgInput} />
      </svg>
    </Box>
  </Box>;
});
const Preview = memo(function Preview({ item }: { item: ShopItem }) {
  const theme = useThemeStore(s => s.theme);
  // Подписка только на режим цвета своего предмета, а не на весь словарь.
  const mode = useShopStore(s => s.colorModes[item.id]);
  if (item.stock) return <Box sx={{ height: 110, display: 'grid', placeItems: 'center' }}>
    {item.category === 'profile' ? <Box sx={{ width: 48, height: 48, borderRadius: '50%', bgcolor: theme.bgActive, color: theme.text, display: 'grid', placeItems: 'center' }}>V</Box>
      : item.category === 'selfcard' ? <Typography sx={{ color: theme.textSec, fontSize: 12 }}>Вы</Typography>
      : <Box sx={{ bgcolor: theme.bgActive, color: theme.text, px: 2, py: 1, borderRadius: '16px 16px 4px 16px' }}>Привет!</Box>}
  </Box>;
  const stock = item.rarity ? RARITY_META[item.rarity].color : typeof item.previewColor === 'string' ? item.previewColor.match(/#[\da-f]{6}/i)?.[0] || '#ff4870' : '#ff4870';
  const color = mode === 'theme' ? theme.accent : stock;
  return <Box sx={{ height: 110, display: 'grid', placeItems: 'center' }}>
    {item.category === 'profile' ? <Box sx={{ width: 48, height: 48, borderRadius: '50%', display: 'grid', placeItems: 'center', ...skinColors(buildShopRingSx(item.value, color), item, color, mode === 'theme') }}>V</Box> : item.category === 'selfcard' ? <Box sx={item.value.pack ? selfcardSkin(item, SHOP_CATALOG, theme.accent, mode === 'theme') : item.rarity ? buildPlaqueSx(item.rarity, color) : { bgcolor: color, px: 2, py: 1, borderRadius: 2 }}>Вы</Box> : <Box sx={{ px: 2, py: 1.5, maxWidth: '90%', fontSize: 13, ...bubbleSkin(item, theme.accent, mode === 'theme') }}>Привет!</Box>}
  </Box>;
});
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
  canSell: boolean;
  favorite: boolean;
  onShow: (id: string) => void;
  onBuyCase: (id: string) => void;
  onListing: (listing: MarketListing, buy: boolean, isPet: boolean) => void;
  onToggleFavorite: (id: string) => void;
};
// Карточка сетки. memo + примитивные/стабильные пропсы: при опросе маркета,
// вводе в поиск и т.п. перерисовываются только реально изменившиеся карточки.
const StoreCard = memo(function StoreCard({ row, tab, theme, busy, balanceVp, price, listing, alreadyOwned, canSell, favorite, onShow, onBuyCase, onListing, onToggleFavorite }: CardProps) {
  const i = itemInfo(row.id);
  const priced = Number.isSafeInteger(price) && Number(price) > 0;
  // content-visibility: браузер не верстает и не рисует карточки вне экрана.
  return <Box sx={{ p: { xs: 0.75, sm: 2 }, minWidth: 0, border: `1px solid ${theme.border}`, borderBottom: `3px solid ${RARITY_META[i.rarity].color}`, bgcolor: theme.bgHover, borderRadius: UI_SURFACE_RADIUS, contentVisibility: 'auto', containIntrinsicSize: 'auto 260px' }}>
    <Button onClick={() => { if (tab === 'inventory' || i.definition) onShow(row.id); }} sx={{ display: 'block', width: '100%', color: theme.text, textTransform: 'none' }}>{i.item ? <Preview item={i.item} /> : i.definition ? <CaseArt definition={i.definition} price={price} /> : i.pet ? <Box sx={{ height: 110, display: 'grid', placeItems: 'center' }}><PetArtwork petId={i.pet.id} size={84} animate={false} /></Box> : i.reaction ? <Box sx={{ height: 110, display: 'grid', placeItems: 'center' }}><ReactionGlyph value={i.reaction.id} size={56} /></Box> : null}<Typography>{i.name}</Typography></Button><Typography variant="caption">{row.count} шт. · {i.definition ? (i.definition.packs.length ? `${i.definition.packs.length} паков` : i.definition.rewards.some(r => r.key.startsWith('rx-')) ? `${i.definition.rewards.length} скинов` : `${i.definition.rewards.length} питомцев`) : RARITY_META[i.rarity].label}</Typography>
    {tab === 'market' && i.definition && <Box sx={{ mt: 1 }}>
      <Typography sx={{ fontWeight: 800 }}>{priced ? `${price} ВП` : 'Скоро'}</Typography>
      <Button fullWidth variant="contained" disabled={busy || !priced || balanceVp < Number(price)} onClick={() => onBuyCase(row.id)}
        sx={{ '&&&': { fontWeight: 800, border: 'none', background: priced && balanceVp >= Number(price) ? `linear-gradient(135deg, ${theme.accent}, ${theme.accent}aa)` : undefined, '&:hover': { background: priced && balanceVp >= Number(price) ? `linear-gradient(135deg, ${theme.accent}, ${theme.accent}cc)` : undefined } } }}>
        {priced ? (balanceVp < Number(price) ? `Не хватает ${Number(price) - balanceVp} ВП` : `Купить за ${price} ВП`) : 'Цена не назначена'}
      </Button>
    </Box>}
    {tab === 'market' && !i.definition && listing && <Box><Typography>{listing.price} ВП · {listing.seller}</Typography>
      {listing.isMine ? <Button disabled={busy} onClick={() => onListing(listing, false, !!i.pet)}>Снять с продажи</Button>
        : <Button disabled={busy || alreadyOwned || balanceVp < listing.price} onClick={() => onListing(listing, true, !!i.pet)}>Купить за {listing.price} ВП</Button>}
    </Box>}
    {tab === 'inventory' && canSell && <Button fullWidth disabled={busy} onClick={() => onShow(row.id)}>Выставить на продажу</Button>}
    {tab === 'inventory' && i.item && !i.item.stock && <Button size="small" aria-pressed={favorite} onClick={() => onToggleFavorite(row.id)}>{favorite ? '★ В избранном' : '☆ В избранное'}</Button>}
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
  return <Dialog open fullWidth maxWidth="xl" onClose={() => !busy && onClose()} PaperProps={{ sx: { ...panelSx, width: { xs: 'calc(100vw - 12px)', sm: 'calc(100% - 64px)' }, minHeight: { xs: 'calc(100dvh - 12px)', sm: '70vh' } } }}>
    <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, px: { xs: 1.5, sm: 3 }, py: { xs: 1.25, sm: 2 }, fontSize: { xs: 18, sm: 20 } }}>Инвентарь VERA<Button disabled={busy} onClick={onClose}>Закрыть</Button></DialogTitle>
    <DialogContent sx={{ px: { xs: 1, sm: 3 }, py: { xs: 1, sm: 2 }, overflowX: 'hidden' }}>
      <WalletTopup />
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 0.75, mb: 1.5 }}><Button variant={tab === 'inventory' ? 'contained' : 'text'} onClick={() => setTab('inventory')}>Инвентарь</Button><Button variant={tab === 'market' ? 'contained' : 'text'} onClick={() => setTab('market')}>Площадка</Button></Box>
      {error && <Typography role="alert" color="error">{error}</Typography>}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: tab === 'inventory' ? '260px minmax(0,1fr)' : 'minmax(0,1fr)' }, gap: { xs: 1, md: 2 }, alignItems: 'start' }}>
      {tab === 'inventory' && <Box component="aside" aria-label="Надетые и избранные скины" sx={{ p: { xs: 1, sm: 2 }, bgcolor: theme.bgHeader, border: `1px solid ${theme.border}`, borderRadius: UI_SURFACE_RADIUS, display: { xs: 'grid', md: 'block' }, gridTemplateColumns: { xs: 'repeat(3, minmax(0, 1fr))', md: 'none' }, gap: { xs: 0.75, md: 0 }, '& > h6': { gridColumn: '1 / -1' } }}>
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
        <TextField select size="small" SelectProps={filterSelectProps} value={category} onChange={e => setCategory(e.target.value)}>{categories.map(([id, label]) => <MenuItem key={id} value={id}>{label}</MenuItem>)}</TextField>
        <TextField select size="small" SelectProps={filterSelectProps} label="Коллекция" value={collection} onChange={e => setCollection(e.target.value)}>
          <MenuItem value="all">Все коллекции</MenuItem>
          {CASE_CATALOG.filter(definition => !isHiddenCase(definition) || caseCount(loot, definition.id) > 0).map(definition => <MenuItem key={definition.id} value={definition.id}>{definition.name}</MenuItem>)}
        </TextField>
        <TextField select size="small" SelectProps={filterSelectProps} value={tier} onChange={e => setTier(e.target.value)}><MenuItem value="all">Все редкости</MenuItem>{Object.values(RARITY_META).map(r => <MenuItem key={r.id} value={r.id}>{r.label}</MenuItem>)}</TextField>
        <TextField select size="small" SelectProps={filterSelectProps} value={sort} onChange={e => setSort(e.target.value)}><MenuItem value="name">По имени</MenuItem><MenuItem value="rarity">По редкости ↓</MenuItem><MenuItem value="quantity">По количеству ↓</MenuItem></TextField>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(auto-fill,minmax(180px,1fr))' }, gap: { xs: 0.75, sm: 2 } }}>{shown.map(row => { const i = itemInfo(row.id); const listing = tab === 'market' && !i.definition ? listingById.get(row.key) : undefined; return <StoreCard key={row.key} row={row} tab={tab} theme={theme} busy={busy} balanceVp={shop.balanceVp} price={i.definition ? priceOf(row.id) : null} listing={listing}         alreadyOwned={listing ? (i.pet ? ownedPetSet.has(i.pet.id) : !!shop.owned[listing.itemId]) : false}         canSell={!!((i.item && !i.item.stock && shop.owned[row.id]) || (i.pet && ownedPetSet.has(row.id)))}         favorite={favoriteSet.has(row.id)} onShow={showItem} onBuyCase={buyCase} onListing={listingAction} onToggleFavorite={toggleFavorite} />; })}</Box>       {hasMore && <Box ref={sentinelRef} sx={{ textAlign: 'center', py: 2 }}><Button onClick={() => setLimit(n => n + PAGE_SIZE)}>Показать ещё · {visible.length - limit}</Button></Box>}
      {!visible.length && <Typography sx={{ textAlign: 'center', py: 6 }}>Предметов не найдено</Typography>}
      </Box>
      </Box>
    </DialogContent>
    <Dialog open={!!selected} fullWidth maxWidth="md" onClose={() => !busy && setSelected(null)} PaperProps={{ sx: panelSx }}>
      <DialogTitle>{selectedCase ? `Кейс «${selectedCase.name}»` : selectedPet ? selectedPet.name : item?.name}</DialogTitle><DialogContent>
        {selectedCase ? <>
            {phase === 'idle' && <>
            <CaseArt definition={selectedCase} price={selectedPrice} /><Typography sx={{ color: theme.textSec }}>{isHiddenCase(selectedCase) ? 'Кейс временно снят с продажи: питомцы на доработке.' : null} {caseDescription(selectedCase) || (selectedCase.packs.length ? 'Внутри один уникальный пак: обводка, плашка и пузырь. Паки этой коллекции не встречаются в других кейсах.' : 'Внутри один случайный питомец из этой коллекции.')}</Typography>
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
            <Typography sx={{ my: 2 }}>Содержимое и вероятности:</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 1.5 }}>
              {casePacks(selectedCase.id).map(p => <Box key={p.id}><PackArtwork pack={p} /><Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 0.5, color: theme.textSec }}>{RARITY_META[rarity(p)].label} · {packChance(p, selectedCase.id).toFixed(2)}%</Typography></Box>)}
              {selectedCase.rewards.filter(reward => reward.key.startsWith('pet-') && findPet(reward.key)).map(reward => {
                const totalWeight = selectedCase.rewards.reduce((sum, r) => sum + r.weight, 0);
                const pet = findPet(reward.key)!;
                return <Box key={reward.key}><Box sx={{ height: 110, display: 'grid', placeItems: 'center' }}><PetArtwork petId={pet.id} size={84} /></Box><Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 0.5, color: theme.textSec }}>{RARITY_META[pet.rarity].label} · {(reward.weight / totalWeight * 100).toFixed(2)}%</Typography></Box>;
              })}
              {selectedCase.rewards.filter(reward => findReactionSkin(reward.key)).map(reward => {
                const totalWeight = selectedCase.rewards.reduce((sum, r) => sum + r.weight, 0);
                const skin = findReactionSkin(reward.key)!;
                return <Box key={reward.key} sx={{ textAlign: 'center', p: 1, border: `1px solid ${theme.border}`, borderBottom: `3px solid ${RARITY_META[skin.rarity].color}`, borderRadius: UI_SURFACE_RADIUS }}>
                  <Box sx={{ height: 56, display: 'grid', placeItems: 'center' }}><ReactionGlyph value={skin.id} size={36} /></Box>
                  <Typography sx={{ fontSize: 12 }}>{skin.name}{reactionOwned[skin.id] ? ` · ×${reactionOwned[skin.id]}` : ''}</Typography>
                  <Typography variant="caption" sx={{ display: 'block', color: theme.textSec }}>{RARITY_META[skin.rarity].label} · {(reward.weight / totalWeight * 100).toFixed(2)}%</Typography>
                </Box>;
              })}
            </Box>
          </>}
          {phase !== 'idle' && (reel.length > 0 || petReel.length > 0 || reactionReel.length > 0) && <Box sx={{ position: 'relative', overflow: 'hidden', height: 155, bgcolor: theme.bgHeader, my: 2, '&:after': { content: '""', position: 'absolute', top: 0, bottom: 0, left: '50%', width: 3, bgcolor: theme.accent } }}>
            <Box sx={{ display: 'flex', gap: '8px', position: 'absolute', left: '50%', transform: `translateX(-${phase === 'ready' ? 80 : 40 * 168 + 80}px)`, transition: phase === 'ready' ? 'none' : 'transform 5s cubic-bezier(.08,.65,.12,1)' }}>
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
        </> : selectedPet ? <><Box sx={{ display: 'grid', placeItems: 'center', py: 2 }}><PetArtwork petId={selectedPet.id} size={140} /></Box>
          <Typography sx={{ color: RARITY_META[selectedPet.rarity].color }}>{RARITY_META[selectedPet.rarity].label}</Typography>
          <Typography sx={{ color: theme.textSec, mt: 1 }}>{selectedPet.name} — спутник, который живёт на экране рядом с чатом. Его можно перетаскивать, изменить размер и имя в профиле.</Typography>
          {pets.ownedPets.includes(selectedPet.id)
            ? <><Button disabled={busy} onClick={() => { void pets.equip(pets.equippedPet?.id === selectedPet.id ? null : selectedPet.id).catch(reportError); }}>{pets.equippedPet?.id === selectedPet.id ? 'Снять питомца' : 'Надеть питомца'}</Button>
            <Box sx={{ mt: 2 }}>
              <TextField type="number" label="Цена, ВП" value={salePrice} disabled={busy} onChange={e => setSalePrice(e.target.value)} inputProps={{ min: 6, max: 100000000, step: 1 }} error={!validSalePrice} helperText="Целое число от 6 до 100000000 ВП" />
              <Typography>Комиссия 15%. Вы получите: {validSalePrice ? Math.floor(Number(salePrice) * 85 / 100) : 0} ВП</Typography>
              <Button disabled={busy || !validSalePrice} onClick={sell}>Выставить за {validSalePrice ? salePrice : '—'} ВП</Button>
            </Box></>
            : <Typography sx={{ color: theme.textSec, mt: 1 }}>Питомец ещё не получен — его можно выпасть из кейса.</Typography>}
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
