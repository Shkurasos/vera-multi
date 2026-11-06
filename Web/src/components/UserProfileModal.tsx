import React from 'react';
import { Box, Avatar, Typography, IconButton, Dialog, DialogTitle, DialogContent, Divider, Button, Stack, Chip, Snackbar, Alert } from '@mui/material';
import { Close, Info, Message, SwapHoriz, Inventory2 } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { User } from '../types';
import { useNavigate } from 'react-router-dom';
import { chatsApi, usersApi } from '../services/api';
import { useChatStore } from '../store/chatStore';
import { useAuthStore } from '../store/authStore';
import { useProfileCustomizationStore } from '../store/profileCustomizationStore';
import ProfileCommentsWall from './ProfileCommentsWall';
import ActivityLine from './ActivityLine';
import ProfilePinnedPlaylistBar from './ProfilePinnedPlaylistBar';
import ReportUserDialog from './ReportUserDialog';
import { SHOP_CATALOG, ShopItem, useShopStore } from '../store/shopStore';
import { useUserSettingsStore } from '../store/userSettingsStore';
import { findPet } from '../store/petCatalog';
import { CaseDefinition, findCase } from '../store/caseCatalog';
import { useLootStore } from '../store/lootStore';
import { buildPlaqueSx, buildShopRingSx, RARITY_META } from '../utils/rarityStyles';
import { skinColors } from '../utils/skinColors';
import { bubbleSkin, selfcardSkin } from '../utils/bubbleSkin';
import { usePetStore } from '../store/petStore';
import PetArtwork from './PetArtwork';
import { useAvatarFill } from '../hooks/useAvatarColor';
import SecurityBars from './SecurityBars';
import TradeDialog from './TradeDialog';

function initials(n: string) { return (n || '?').split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2); }

interface InventoryView { id: string; name: string; count: number; kind: string; equipped?: boolean; skin?: ShopItem; petId?: string; caseDef?: CaseDefinition; }

const SKIN_KIND: Record<string, string> = { profile: 'Обводка', selfcard: 'Плашка', bubble: 'Пузырь', wallpaper: 'Обои', theme: 'Тема' };

/** Публичный инвентарь в читаемом виде: только известные каталогу предметы. */
function describeInventory(raw: { skins?: string[]; pets?: string[]; petCounts?: Record<string, number>; equippedPetId?: string; cases?: Record<string, number> } | null): InventoryView[] {
  if (!raw) return [];
  const items: InventoryView[] = [];
  for (const [id, count] of Object.entries(raw.cases || {})) {
    if (!count) continue;
    const definition = findCase(id);
    if (definition) items.push({ id, name: `Кейс «${definition.name}»`, count, kind: 'Кейс', caseDef: definition });
  }
  for (const id of raw.pets || []) {
    const pet = findPet(id);
    if (pet) items.push({ id, name: pet.name, count: raw.petCounts?.[id] || 1, kind: 'Питомец', equipped: raw.equippedPetId === id, petId: id });
  }
  for (const id of raw.skins || []) {
    const item = SHOP_CATALOG.find(i => i.id === id);
    if (item && !item.stock) items.push({ id, name: item.name, count: 1, kind: SKIN_KIND[item.category] || 'Предмет', skin: item });
  }
  return items;
}

/** Скин так, как он выглядит в чате: обводка, плашка или пузырь. */
function SkinLook({ item }: { item: ShopItem }) {
  const theme = useThemeStore(s => s.theme);
  const stock = item.rarity ? RARITY_META[item.rarity].color : typeof item.previewColor === 'string' ? item.previewColor.match(/#[\da-f]{6}/i)?.[0] || '#ff4870' : '#ff4870';
  if (item.category === 'profile') return (
    <Box sx={{ width: 56, height: 56, borderRadius: '50%', display: 'grid', placeItems: 'center', color: theme.text, fontWeight: 700, ...skinColors(buildShopRingSx(item.value, stock), item, stock, false) }}>V</Box>
  );
  if (item.category === 'selfcard') return (
    <Box sx={item.value.pack ? selfcardSkin(item, SHOP_CATALOG, theme.accent, false) : item.rarity ? buildPlaqueSx(item.rarity, stock) : { bgcolor: stock, px: 2, py: 1, borderRadius: 2 }}>Вы</Box>
  );
  return <Box sx={{ px: 2, py: 1.25, maxWidth: '92%', fontSize: 13, color: theme.text, ...bubbleSkin(item, theme.accent, false) }}>Привет!</Box>;
}

/** Сундук кейса — тот же силуэт, что в магазине. */
function CaseLook({ definition }: { definition: CaseDefinition }) {
  const theme = useThemeStore(s => s.theme);
  const accent = definition.color || theme.accent;
  return (
    <Box sx={{ position: 'relative', display: 'grid', placeItems: 'center', width: '100%', height: 84 }}>
      <Box aria-hidden sx={{ position: 'absolute', width: 78, height: 78, borderRadius: '50%', bgcolor: accent, opacity: 0.16, filter: 'blur(20px)' }} />
      <svg viewBox="0 0 100 100" width={72} height={72} style={{ position: 'relative' }} aria-hidden="true">
        <ellipse cx="50" cy="88" rx="30" ry="3.5" fill="#000" opacity=".28" />
        <path d="M16 50V44C16 33.5 31.5 26 50 26C68.5 26 84 33.5 84 44V50H16Z" fill={`${accent}3a`} stroke={accent} strokeWidth="2.6" strokeLinejoin="round" />
        <path d="M14 50H86V76C86 79.3 83.3 82 80 82H20C16.7 82 14 79.3 14 76V50Z" fill={`${accent}22`} stroke={accent} strokeWidth="2.6" strokeLinejoin="round" />
        {definition.mark && <g transform="translate(37 56) scale(0.26)" fill="none" stroke={accent} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"><path d={definition.mark} /></g>}
        <rect x="45" y="44" width="10" height="14" rx="2.5" fill={accent} />
        <circle cx="50" cy="50.5" r="1.8" fill={theme.bgInput} />
      </svg>
    </Box>
  );
}

interface Props { user: User | null; open: boolean; onClose: () => void; }

/** Отдельная плашка: предметы показаны так, как выглядят, а не списком названий. */
function InventoryBoard({ title, items, onClose }: { title: string; items: InventoryView[]; onClose: () => void }) {
  const theme = useThemeStore(s => s.theme);
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: { bgcolor: theme.bgSidebar || theme.bg, color: theme.text, borderRadius: 3, backgroundImage: 'none' } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
        <Inventory2 sx={{ color: theme.accent }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 800, overflowWrap: 'anywhere' }}>{title}</Typography>
          <Typography sx={{ fontSize: 12, color: theme.textSec }}>{items.length ? `${items.length} предм.` : 'Пока пусто'}</Typography>
        </Box>
        <IconButton aria-label="Закрыть" onClick={onClose} sx={{ color: theme.textSec }}><Close /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ pt: 0 }}>
        {items.length === 0 ? (
          <Typography sx={{ py: 4, textAlign: 'center', color: theme.textSec, fontSize: 14 }}>В инвентаре ничего нет</Typography>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: 1 }}>
            {items.map(item => (
              <Box key={item.id} sx={{ minWidth: 0, p: 1, borderRadius: 2, bgcolor: theme.bgHeader, border: `1px solid ${theme.border}`, display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ height: 92, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
                  {item.skin ? <SkinLook item={item.skin} />
                    : item.petId ? <PetArtwork petId={item.petId} size={76} animate={false} />
                    : item.caseDef ? <CaseLook definition={item.caseDef} />
                    : null}
                </Box>
                <Typography noWrap sx={{ mt: 0.5, fontSize: 13, fontWeight: 700, color: theme.text }}>{item.name}</Typography>
                <Typography noWrap sx={{ fontSize: 11.5, color: theme.textSec }}>
                  {item.kind}{item.count > 1 ? ` · ${item.count} шт.` : ''}{item.equipped ? ' · надето' : ''}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ icon, label, value, theme, pre }: any) {
  return (
    <Box display="flex" alignItems="flex-start" gap={1.5} sx={{ mb: { xs: 1.25, sm: 2 } }}>
      {icon}
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.3 }}>{label}</Typography>
        <Typography sx={{ fontSize: { xs: 14, sm: 15 }, color: theme.text, whiteSpace: pre ? 'pre-wrap' : 'normal', overflowWrap: 'anywhere' }}>{value}</Typography>
      </Box>
    </Box>
  );
}

export default function UserProfileModal({ user, open, onClose }: Props) {
  const theme = useThemeStore((s) => s.theme);
  const navigate = useNavigate();
  // Только нужные поля: профиль открывается поверх чата и раньше перерисовывался
  // на каждое сообщение в любом чате (подписка на весь chatStore).
  const setActiveChat = useChatStore((s) => s.setActiveChat);
  const loadChats = useChatStore((s) => s.loadChats);
  const onlineUsers = useChatStore((s) => s.onlineUsers);
  const me = useAuthStore((s) => s.user);
  const myCustom = useProfileCustomizationStore();
  const [remoteCustom, setRemoteCustom] = React.useState<any>(null);
  const [reportOpen, setReportOpen] = React.useState(false);
  React.useEffect(() => { setReportOpen(false); }, [user?.id, open]);
  // Аватарка без фото — тот же цвет, что у человека в списке чатов.
  const avatarFillSx = useAvatarFill(user?.id);
  const [toast, setToast] = React.useState<{ message: string; severity: 'success' | 'error' | 'info' } | null>(null);

  const isMe = user?.id === me?.id;
  // Обмен доступен всем живым аккаунтам.
  const myCanTrade = !!me;
  const ownRing = useShopStore(s => s.activeRing);
  const colorModes = useShopStore(s => s.colorModes);
  const showOwnSkins = useUserSettingsStore(s => s.showOwnSkins !== false);
  const showOthersSkins = useUserSettingsStore(s => s.showOthersSkins !== false);
  const othersSkinColor = useUserSettingsStore(s => s.othersSkinColor);
  const [remoteRing, setRemoteRing] = React.useState<{ userId: string; id: string } | null>(null);
  // Закреплённая музыка чужого профиля: свежие id берём с сервера, чтобы
  // мини-плеер был виден другим (снапшот из сообщения может быть устаревшим).
  const [remotePinned, setRemotePinned] = React.useState<{ userId: string; playlistId: string | null; trackId: string | null } | null>(null);
  // Экипированный питомец чужого профиля — публичное поле из GET /api/users/:id.
  const [remotePet, setRemotePet] = React.useState<{ id: string; settings?: { size?: number } } | null>(null);
  // Обмен: недоступен только с ботами.
  const [remoteCanTrade, setRemoteCanTrade] = React.useState<{ userId: string; ok: boolean } | null>(null);
  const [remoteInventory, setRemoteInventory] = React.useState<{ userId: string; visible: boolean; items: InventoryView[] } | null>(null);
  const [tradeOpen, setTradeOpen] = React.useState(false);
  const [inventoryOpen, setInventoryOpen] = React.useState(false);
  const myPet = usePetStore((s) => s.equippedPet);
  const myOwnedPets = usePetStore((s) => s.ownedPets);
  const myPetCounts = usePetStore((s) => s.petCounts);
  const myOwnedSkins = useShopStore((s) => s.owned);
  const myCases = useLootStore((s) => s.caseCounts);
  const myShowInventory = useUserSettingsStore((s) => s.showInventoryToOthers !== false);
  // Свой инвентарь собираем из локальных сторов, чужой — только из ответа сервера.
  // Хук стоит до раннего выхода: иначе число хуков меняется между рендерами.
  const myInventory = React.useMemo(() => describeInventory({
    skins: Object.keys(myOwnedSkins).filter(id => myOwnedSkins[id]),
    pets: myOwnedPets,
    petCounts: myPetCounts,
    equippedPetId: myPet?.id || '',
    cases: myCases,
  }), [myOwnedSkins, myOwnedPets, myPetCounts, myPet?.id, myCases]);
  React.useEffect(() => {
    setRemoteRing(null);
    setRemotePinned(null);
    setRemotePet(null);
    setRemoteCanTrade(null);
    setRemoteInventory(null);
    setTradeOpen(false);
    setInventoryOpen(false);
    if (!open || !user || isMe) return;
    let cancelled = false;
    const userId = user.id;
    usersApi.getById(userId).then(({ data }) => {
      if (cancelled) return;
      setRemoteRing({ userId, id: data.activeRing || '' });
      setRemotePet(data.equippedPet || null);
      setRemoteCanTrade({ userId, ok: !data.isBot });
      setRemoteInventory({
        userId,
        visible: data.inventoryVisible !== false,
        items: describeInventory(data.inventory || null),
      });
      setRemotePinned({
        userId,
        playlistId: data.pinnedPlaylistId ?? null,
        trackId: data.pinnedTrackId ?? null,
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, user?.id, isMe]);
  // Для чужого профиля тянем кастомизацию с сервера, для своего — из локального store.
  React.useEffect(() => {
    if (!open || !user || isMe) { setRemoteCustom(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem('vera_token');
        const r = await fetch(`/api/users/${user.id}/customization`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: 'include',
        });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setRemoteCustom(j?.data || null);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [open, user?.id, isMe]);

  if (!user) return null;
  const custom: any = isMe ? myCustom : (remoteCustom || {});
  const displayName = user.username;
  const isOnline = onlineUsers?.has?.(user.id);
  const accent = (custom?.cardAccent) ? custom.cardAccent : theme.accent;
  const ringId = isMe ? ownRing : remoteRing?.userId === user.id ? remoteRing.id : user.activeRing;
  const ringItem = SHOP_CATALOG.find(i => i.applyKey === 'avatarRing' && i.id === ringId);
  // «Настройки отображения»: скрытые скины не показываем и в карточке профиля.
  const ringShown = isMe ? showOwnSkins : showOthersSkins;
  const ringSx = ringShown && ringItem && !ringItem.stock
    ? skinColors(buildShopRingSx(ringItem.value, accent, false, 4), ringItem, accent, isMe ? colorModes[ringItem.id] === 'theme' : othersSkinColor !== 'stock')
    : {};
  const inventory = isMe
    ? { visible: myShowInventory, items: myInventory }
    : remoteInventory?.userId === user.id ? remoteInventory : null;
  const bannerRaw: string = custom?.bannerUrl || '';
  // Сервер отдаёт короткий /uploads/... URL — превращаем в абсолютный, чтобы
  // чужая шапка грузилась на любом устройстве (в т.ч. через туннель/прод-домен).
  const bannerSrc = /^https?:\/\//i.test(bannerRaw) || /^data:(?:image|video)\//i.test(bannerRaw)
    ? bannerRaw
    : bannerRaw.startsWith('/') ? window.location.origin + bannerRaw : '';
  const isBannerVideo = !!bannerSrc && (/^data:video\//i.test(bannerRaw) || /\.(mp4|webm|mov)$/i.test(bannerRaw));
  const banner = bannerSrc && !isBannerVideo
    ? `url(${bannerSrc}) center/cover`
    : `linear-gradient(135deg, ${custom?.bannerColor || accent}, ${accent})`;
  const ic = (I: any) => <I sx={{ fontSize: 20, color: theme.textSec, mt: 0.2 }} />;

  async function handleMessage() {
    // Как в Telegram: открываем личку, а на сервере она появится с первым сообщением.
    const chat = useChatStore.getState().openDirectDraft(user!);
    setActiveChat(chat);
    navigate(`/chat/${chat.id}`);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" PaperProps={{
      sx: {
        bgcolor: theme.bgChat, color: theme.text, borderRadius: 3, overflow: 'hidden', position: 'relative',
        // Прокручивается содержимое, а не рамка: кнопка закрытия всегда на виду.
        display: 'flex', flexDirection: 'column',
        // На телефоне профиль занимает почти весь экран и не вылезает за края.
        m: { xs: 1.5, sm: 4 },
        width: { xs: 'calc(100% - 24px)', sm: 'calc(100% - 64px)' },
        maxHeight: {
          xs: 'calc(100% - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
          sm: 'calc(100% - 64px)',
        },
      },
    }}>
      <IconButton onClick={onClose} aria-label="Закрыть профиль" sx={{
        position: 'absolute', top: 8, right: 8, zIndex: 2, color: '#fff',
        bgcolor: 'rgba(0,0,0,0.35)', '&:hover': { bgcolor: 'rgba(0,0,0,0.55)' },
      }}><Close /></IconButton>
      {/* Тело профиля: всё ниже кнопки закрытия скроллится внутри карточки. */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
      <Box sx={{ position: 'relative', height: { xs: 96, sm: 140 }, background: banner, overflow: 'hidden' }}>
        {isBannerVideo && (
          <video src={bannerSrc} autoPlay loop muted playsInline
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
      </Box>
      {/* Питомец выглядывает из-за правого края с наклоном к профилю на 45°. */}
      {(() => {
        const peek = isMe ? myPet : (remotePet?.id ? remotePet : null);
        if (!peek) return null;
        const peekSize = peek.settings?.size || 72;
        return (
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              right: -Math.round(peekSize * 0.35),
              top: '46%',
              transform: 'translateY(-50%)',
              zIndex: 1,
              pointerEvents: 'none',
              animation: 'veraPetPeekIn .7s ease both, veraPetPeekSway 4s ease-in-out .7s infinite',
              '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
            }}
          >
            <Box sx={{ transform: 'rotate(-45deg)', transformOrigin: 'center' }}>
              <PetArtwork petId={peek.id} size={peekSize} />
            </Box>
          </Box>
        );
      })()}
      <Box sx={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', mt: { xs: -5, sm: -7 }, px: { xs: 2, sm: 3 } }}>
        <Avatar src={user.avatarUrl || undefined} sx={{
          width: { xs: 80, sm: 112 }, height: { xs: 80, sm: 112 }, fontSize: { xs: 30, sm: 40 }, ...avatarFillSx,
          border: `4px solid ${theme.bgChat}`, boxShadow: `0 0 24px ${accent}70`,
          ...ringSx,
        }}>{initials(displayName)}</Avatar>
        <Typography sx={{ mt: { xs: 1, sm: 1.5 }, fontSize: { xs: 19, sm: 22 }, fontWeight: 700, color: theme.text, textAlign: 'center' }}>{displayName}</Typography>
        <Typography sx={{ fontSize: 14, color: accent }}>@{user.username}</Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <Chip size="small" label={isOnline ? 'В сети' : 'Не в сети'} sx={{
            bgcolor: (isOnline ? theme.online : theme.textSec) + '22', color: theme.text,
          }} />
        </Stack>
        <ActivityLine userId={user.id} />
        <ProfilePinnedPlaylistBar
          ownerId={user.id}
          pinnedPlaylistId={isMe
            ? user.pinnedPlaylistId
            : remotePinned?.userId === user.id ? remotePinned.playlistId : user.pinnedPlaylistId}
          pinnedTrackId={isMe
            ? user.pinnedTrackId
            : remotePinned?.userId === user.id ? remotePinned.trackId : user.pinnedTrackId}
        />
        <SecurityBars userId={user.id} theme={theme} />
      </Box>
      <Box sx={{ px: { xs: 2, sm: 3 }, py: { xs: 1.5, sm: 2 } }}>
        {custom?.showcase && (
          <Box sx={{
            p: 1.5, mb: 2, borderRadius: 2, whiteSpace: 'pre-wrap',
            bgcolor: theme.bgHeader, border: `1px solid ${accent}44`,
          }}>
            <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.5 }}>Витрина</Typography>
            <Typography sx={{ fontSize: 14, color: theme.text }}>{custom.showcase}</Typography>
          </Box>
        )}
        {user.bio && <InfoRow icon={ic(Info)} label="О себе" value={user.bio} theme={theme} pre />}
        {!isMe && (
          <Button fullWidth variant="contained" startIcon={<Message />} onClick={handleMessage}
            sx={{ bgcolor: accent, '&:hover': { bgcolor: accent + 'CC' }, borderRadius: 2.5, fontSize: { xs: 14, sm: 15 }, py: { xs: 0.9, sm: 1.2 }, textTransform: 'none', mt: 1, whiteSpace: 'nowrap' }}>
            Написать сообщение
          </Button>
        )}
        {!isMe && myCanTrade && remoteCanTrade?.userId === user.id && remoteCanTrade.ok && (
          <Button fullWidth variant="outlined" startIcon={<SwapHoriz />} onClick={() => setTradeOpen(true)}
            sx={{ borderColor: accent, color: theme.text, borderRadius: 2.5, fontSize: { xs: 14, sm: 15 }, py: { xs: 0.8, sm: 1 }, textTransform: 'none', mt: 1, whiteSpace: 'nowrap' }}>
            Предложить обмен
          </Button>
        )}
        <Box sx={{ mt: 2 }}>
          <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 1 }}>Инвентарь</Typography>
          {inventory === null ? (
            <Typography sx={{ fontSize: 13, color: theme.textSec }}>Загрузка…</Typography>
          ) : !inventory.visible ? (
            <Typography sx={{ fontSize: 13, color: theme.textSec }}>
              {isMe ? 'Скрыт от других. Включить можно в настройках конфиденциальности.' : 'Инвентарь скрыт владельцем'}
            </Typography>
          ) : (
            <Button fullWidth variant="outlined" startIcon={<Inventory2 />} onClick={() => setInventoryOpen(true)}
              sx={{ borderColor: theme.border, color: theme.text, borderRadius: 2.5, fontSize: { xs: 14, sm: 15 }, py: { xs: 0.8, sm: 1 }, textTransform: 'none', whiteSpace: 'nowrap', '&:hover': { borderColor: accent } }}>
              {inventory.items.length ? `Смотреть предметы · ${inventory.items.length}` : 'Смотреть предметы'}
            </Button>
          )}
        </Box>
      </Box>
      <Divider sx={{ borderColor: theme.border }} />
      {!isMe && <Button fullWidth color="error" onClick={() => setReportOpen(true)} sx={{ py: { xs: 0.75, sm: 1 } }}>Пожаловаться</Button>}
      {reportOpen && <ReportUserDialog key={user.id} targetId={user.id} onClose={() => setReportOpen(false)} onSent={() => {
        setReportOpen(false); setToast({ message: 'Жалоба отправлена администрации', severity: 'success' });
      }} />}
      {tradeOpen && <TradeDialog key={user.id} partner={{ id: user.id, username: user.username }} onClose={() => setTradeOpen(false)} onSent={() => {
        setTradeOpen(false); setToast({ message: 'Предложение обмена отправлено', severity: 'success' });
      }} />}
      {inventoryOpen && inventory && <InventoryBoard title={`Инвентарь · ${displayName}`} items={inventory.items} onClose={() => setInventoryOpen(false)} />}
      <Box sx={{ px: { xs: 2, sm: 3 }, pb: { xs: 2, sm: 3 } }}>
        <ProfileCommentsWall targetUserId={user.id} targetUserName={displayName} />
      </Box>
      </Box>
      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={toast?.severity || 'info'} sx={{ bgcolor: theme.bgHeader, color: theme.text, border: `1px solid ${theme.border}` }}>
          {toast?.message}
        </Alert>
      </Snackbar>
    </Dialog>
  );
}
