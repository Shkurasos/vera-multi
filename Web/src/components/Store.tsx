import React, { useState, useEffect, useCallback } from 'react';
import { Box, Typography, IconButton, Button, Chip, CircularProgress } from '@mui/material';
import { Close, Storefront, Lock, Check, Palette, Wallpaper, Face, AccountCircle, AccountBalanceWallet } from '@mui/icons-material';
import QRCode from 'qrcode';
import { useThemeStore } from '../store/themeStore';
import { SHOP_CATALOG, ShopCategory, useShopStore, selectShopItem, SHOP_CURRENCY } from '../store/shopStore';
import { walletApi } from '../services/api';

interface Props {
  onClose: () => void;
}

const CATEGORY_META: { id: ShopCategory; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: 'profile', label: 'Обводка профиля', icon: <Face />, hint: 'Кастомные обводки аватарки' },
  { id: 'selfcard', label: 'Плашка своих сообщений', icon: <AccountCircle />, hint: 'Как подписаны ваши сообщения у других' },
  { id: 'theme', label: 'Режимы тем', icon: <Palette />, hint: 'Доп. режимы для тем и обоев' },
  { id: 'wallpaper', label: 'Обои', icon: <Wallpaper />, hint: 'Умные и динамические обои' },
];

// Курс и пресеты пополнения (1 USD = 100 ВП — совпадает с сервером).
const VP_RATE = 100;
const TOPUP_PRESETS = [50, 100, 300, 700, 1500];

/**
 * МАГАЗИН (закрытые возможности).
 * Плашка, открывается как плеер-оверлей. Каталог принадлежит издателю (только нам).
 * Сейчас все товары бесплатные — цены и серверная покупка появятся позже.
 */
export default function Store({ onClose }: Props) {
  const { theme } = useThemeStore();
  const { enabled, activeRing, activeSelfCard, isOwned, purchase, balanceVp, loadWallet } = useShopStore();
  const [activeCat, setActiveCat] = useState<ShopCategory | 'all'>('all');
  const [tab, setTab] = useState<'inventory' | 'shop'>('inventory');
  const [buyError, setBuyError] = useState('');

  // ── Топ-ап ВП ──
  const [topupOpen, setTopupOpen] = useState(false);
  const [topupAmount, setTopupAmount] = useState<number>(100);
  const [topupBusy, setTopupBusy] = useState(false);
  const [topupError, setTopupError] = useState('');
  const [invoice, setInvoice] = useState<any | null>(null);
  const [invoiceStatus, setInvoiceStatus] = useState<'waiting' | 'paid'>('waiting');
  const [qrDataUrl, setQrDataUrl] = useState('');

  // Загружаем баланс при каждом открытии магазина.
  useEffect(() => { loadWallet(); }, [loadWallet]);

  // Генерация QR после создания инвойса.
  useEffect(() => {
    if (invoice?.invoiceUrl) {
      QRCode.toDataURL(invoice.invoiceUrl, { width: 240, margin: 1 })
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(''));
    }
  }, [invoice?.invoiceUrl]);

  // Поллинг статуса заказа (реальная оплата приходит по webhook).
  useEffect(() => {
    if (!invoice || invoice.mock || invoiceStatus === 'paid') return;
    const t = setInterval(async () => {
      try {
        const { data } = await walletApi.orderStatus(invoice.orderId);
        if (data.status === 'paid') {
          setInvoiceStatus('paid');
          await loadWallet();
          clearInterval(t);
        }
      } catch { /* сеть может отвалиться — поллинг переживёт */ }
    }, 4000);
    return () => clearInterval(t);
  }, [invoice, invoiceStatus, loadWallet]);

  const createInvoice = useCallback(async () => {
    setTopupError('');
    setTopupBusy(true);
    try {
      const { data } = await walletApi.topup(topupAmount);
      setInvoice(data);
      setInvoiceStatus('waiting');
      setQrDataUrl('');
    } catch (e: any) {
      setTopupError(e?.response?.data?.message || 'Не удалось создать инвойс. Попробуйте позже.');
    } finally {
      setTopupBusy(false);
    }
  }, [topupAmount]);

  const mockPay = useCallback(async () => {
    if (!invoice) return;
    setTopupBusy(true);
    try {
      await walletApi.mockPay(invoice.orderId);
      setInvoiceStatus('paid');
      await loadWallet();
    } catch (e: any) {
      setTopupError(e?.response?.data?.message || 'Mock-оплата не удалась');
    } finally {
      setTopupBusy(false);
    }
  }, [invoice, loadWallet]);

  const handleBuy = useCallback(async (itemId: string) => {
    setBuyError('');
    try {
      await purchase(itemId);
      selectShopItem(itemId);
    } catch (e: any) {
      setBuyError(e?.response?.data?.message || e?.message || 'Не удалось купить');
    }
  }, [purchase]);

  const items = SHOP_CATALOG
    .filter(i => activeCat === 'all' || i.category === activeCat)
    .filter(i => (tab === 'inventory' ? isOwned(i.id) : true));
  const activeWallpaper = useShopStore((s) => s.activeWallpaper);
  const setActiveWallpaper = useShopStore((s) => s.setActiveWallpaper);
  const isActive = (id: string) => id === activeRing || id === activeSelfCard || id === activeWallpaper;

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
            <Chip size="small" icon={<AccountBalanceWallet sx={{ fontSize: 14 }} />}
              label={`${balanceVp} ${SHOP_CURRENCY}`}
              sx={{ bgcolor: theme.bgHover, color: theme.accent, fontSize: 12, height: 28, fontWeight: 700, border: `1px solid ${theme.accent}44` }} />
            <Button size="small" variant="contained" onClick={() => { setTopupOpen(v => !v); setInvoice(null); setInvoiceStatus('waiting'); }}
              sx={{ bgcolor: theme.accent, color: '#001018', textTransform: 'none', borderRadius: 999, px: 1.6, fontSize: 12, minHeight: 28, fontWeight: 700, '&:hover': { bgcolor: theme.accent + 'BB' } }}>
              Пополнить
            </Button>
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
        {items.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6, opacity: 0.7 }}>
            <Storefront sx={{ fontSize: 44, color: theme.textSec, mb: 1 }} />
            <Typography sx={{ fontSize: 14, color: theme.textSec }}>
              {tab === 'inventory' ? 'В инвентаре пока пусто. Загляните в «Магазин».' : 'В этой категории ничего нет.'}
            </Typography>
          </Box>
        ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 2 }}>
          {items.map(item => {
            const isActiveItem = isActive(item.id);
            const owned = isOwned(item.id);
            const paid = item.price && item.price > 0;
            return (
              <Box key={item.id} onClick={() => {
                if (!owned) return;
                // Для обоев: клик по активному → выключить (снять); иначе — выбрать.
                if (item.category === 'wallpaper' && isActiveItem) setActiveWallpaper('');
                else selectShopItem(item.id);
              }}
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
                      onClick={(e) => { e.stopPropagation(); handleBuy(item.id); }}
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
        )}

        {/* Подпись */}
        <Box sx={{ mt: 3, display: 'flex', alignItems: 'center', gap: 1.5, px: 1 }}>
          <Storefront sx={{ fontSize: 20, color: theme.accent }} />
          <Typography sx={{ fontSize: 12, color: theme.textSec }}>
            Раздел издателя: часть возможностей платная. Купленное привязывается к аккаунту на сервере — доступно на всех устройствах.
          </Typography>
        </Box>

        {/* ── Пополнение ВП через крипту (NOWPayments) ── */}
        {topupOpen && (
          <Box sx={{
            mt: 2.5, p: 2.5, borderRadius: 3,
            bgcolor: theme.bg + '66', border: `1px solid ${theme.border}`,
          }}>
            <Typography sx={{ fontSize: 15, fontWeight: 800, mb: 0.5 }}>Пополнение ВП</Typography>
            <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 2 }}>
              Оплата криптовалютой (USDT/TRON и др.) через NOWPayments. 1 USD ≈ {VP_RATE} ВП.
            </Typography>

            {!invoice ? (
              <>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
                  {TOPUP_PRESETS.map((v) => (
                    <Button key={v} size="small"
                      onClick={() => setTopupAmount(v)}
                      sx={{
                        bgcolor: topupAmount === v ? theme.accent : theme.bgHover,
                        color: topupAmount === v ? '#001018' : theme.textSec,
                        border: `1px solid ${theme.border}`, textTransform: 'none', borderRadius: 999, px: 2, fontSize: 12,
                        minHeight: 32,
                      }}>
                      {v} ВП · ${v / VP_RATE}
                    </Button>
                  ))}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Button size="small" variant="contained" disabled={topupBusy}
                    onClick={createInvoice}
                    sx={{ bgcolor: theme.accent, color: '#001018', textTransform: 'none', borderRadius: 999, px: 2.5, fontSize: 12, minHeight: 34, '&:hover': { bgcolor: theme.accent + 'BB' } }}>
                    {topupBusy ? <CircularProgress size={16} color="inherit" /> : `Пополнить на ${topupAmount} ВП`}
                  </Button>
                  {topupError && <Typography sx={{ fontSize: 12, color: '#f44336' }}>{topupError}</Typography>}
                </Box>
              </>
            ) : (
              <Box>
                {invoice.mock ? (
                  <Box sx={{ textAlign: 'center', py: 1 }}>
                    <Typography sx={{ fontSize: 13, color: theme.text, mb: 1 }}>
                      Режим теста (ключ NOWPayments не задан) — инвойс создан.
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 2 }}>
                      Сумма: {invoice.amountVs} ВП ≈ ${invoice.priceUsd} USD
                    </Typography>
                    {invoiceStatus === 'paid' ? (
                      <Typography sx={{ fontSize: 14, color: '#7dffa8', fontWeight: 700 }}>✅ Оплачено, ВП зачислены!</Typography>
                    ) : (
                      <Button size="small" variant="contained" disabled={topupBusy}
                        onClick={mockPay}
                        sx={{ bgcolor: theme.accent, color: '#001018', textTransform: 'none', borderRadius: 999, px: 2.5, fontSize: 12, minHeight: 34, '&:hover': { bgcolor: theme.accent + 'BB' } }}>
                        {topupBusy ? <CircularProgress size={16} color="inherit" /> : 'Имитировать оплату (тест)'}
                      </Button>
                    )}
                    {topupError && <Typography sx={{ fontSize: 12, color: '#f44336', mt: 1 }}>{topupError}</Typography>}
                  </Box>
                ) : (
                  <Box sx={{ display: 'flex', gap: 2.5, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <Box sx={{ textAlign: 'center' }}>
                      {qrDataUrl
                        ? <img src={qrDataUrl} alt="QR" width={220} height={220} style={{ borderRadius: 12, background: '#fff', padding: 8 }} />
                        : <Box sx={{ width: 220, height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.textSec, fontSize: 12 }}>Генерация QR…</Box>}
                      <Typography sx={{ fontSize: 12, color: theme.textSec, mt: 0.5 }}>
                        {invoiceStatus === 'paid' ? '✅ Оплачено' : `На ${invoice.amountVs} ВП ≈ $${invoice.priceUsd}`}
                      </Typography>
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 220 }}>
                      <Typography sx={{ fontSize: 13, color: theme.text, fontWeight: 600, mb: 1 }}>
                        Как оплатить:
                      </Typography>
                      <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.5 }}>
                        1. Откройте платёжную страницу по ссылке ниже
                      </Typography>
                      <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 0.5 }}>
                        2. Выберите криптовалюту (USDT TRC20 быстрее всего)
                      </Typography>
                      <Typography sx={{ fontSize: 12, color: theme.textSec, mb: 1.5 }}>
                        3. После оплаты ВП зачислятся автоматически (обычно 1–3 мин)
                      </Typography>
                      <a href={invoice.invoiceUrl} target="_blank" rel="noreferrer"
                        style={{ color: theme.accent, fontSize: 13, fontWeight: 700 }}>
                        Открыть платёжную страницу ↗
                      </a>
                      {invoiceStatus === 'waiting' && (
                        <Typography sx={{ fontSize: 11, color: theme.textSec, mt: 1 }}>
                          Ожидаем оплату… статус обновляется автоматически
                        </Typography>
                      )}
                      {topupError && <Typography sx={{ fontSize: 12, color: '#f44336', mt: 1 }}>{topupError}</Typography>}
                    </Box>
                  </Box>
                )}
                <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
                  <Button size="small" onClick={() => { setInvoice(null); setInvoiceStatus('waiting'); }}>
                    Создать другой инвойс
                  </Button>
                  <Button size="small" onClick={() => { setTopupOpen(false); setInvoice(null); }} sx={{ color: theme.textSec }}>
                    Закрыть
                  </Button>
                </Box>
              </Box>
            )}
          </Box>
        )}

        {buyError && (
          <Typography sx={{ mt: 2, fontSize: 12, color: '#f44336', px: 1, textAlign: 'center' }}>
            {buyError}
          </Typography>
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