import React, { useEffect, useState } from 'react';
import { Box, Button, ButtonBase, Collapse, TextField, Typography } from '@mui/material';
import api, { referralApi, type ReferralInfo } from '../services/api';
import { useShopStore } from '../store/shopStore';

function ReferralCard() {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [copied, setCopied] = useState(false);
  // Грузим данные лениво — только при первом раскрытии панели.
  useEffect(() => {
    if (!open || info) return;
    let active = true;
    referralApi.get().then(({ data }) => { if (active) setInfo(data); }).catch(() => { /* не критично для пополнения */ });
    return () => { active = false; };
  }, [open, info]);
  const copy = async () => {
    if (!info) return;
    try { await navigator.clipboard.writeText(info.link); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* буфер недоступен */ }
  };
  // На широком экране — правая колонка с вертикальным разделителем,
  // на узком — блок под пополнением с горизонтальным разделителем.
  return <Box sx={{ minWidth: 0,
    borderColor: 'divider',
    borderTop: { xs: '1px solid', md: 'none' }, pt: { xs: 2, md: 0 },
    borderLeft: { xs: 'none', md: '1px solid' }, pl: { xs: 0, md: 2 } }}>
    {/* Доп. кнопка: панель приглашения скрыта и «выдвигается» сверху вниз. */}
    <ButtonBase
      onClick={() => setOpen(v => !v)}
      aria-expanded={open}
      sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', justifyContent: 'space-between',
        px: 1.5, py: 1, borderRadius: 1.5, textAlign: 'left',
        border: '1px solid', borderColor: 'divider',
        transition: 'background-color .15s ease',
        '&:hover': { bgcolor: 'action.hover' } }}
    >
      <Typography sx={{ fontWeight: 700 }}>Пригласить друга</Typography>
      <Box component="span" aria-hidden sx={{ transition: 'transform .2s ease', transform: open ? 'rotate(180deg)' : 'none', lineHeight: 1, fontSize: 18, opacity: 0.7 }}>⌄</Box>
    </ButtonBase>
    <Collapse in={open} timeout="auto" unmountOnExit>
      <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {!info && <Typography variant="body2" color="text.secondary">Загрузка…</Typography>}
        {info && <>
          <Typography variant="body2" color="text.secondary">
            Друг переходит по ссылке и регистрирует новый аккаунт. Когда он пользуется мессенджером {info.cashbackMinDays} дня,
            вы получаете {info.cashbackPercent}% от его пополнений, а за {info.tenureDays} дней активности друга — {info.tenureBonusVp} ВП разово.
            Для уже зарегистрированных аккаунтов и повторных регистраций с одного устройства награда не начисляется.
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
            <TextField size="small" value={info.link} fullWidth InputProps={{ readOnly: true }} sx={{ flex: 1, minWidth: 200 }} onFocus={e => e.target.select()} />
            <Button sx={{ minHeight: 40, textTransform: 'none' }} onClick={() => void copy()}>{copied ? 'Скопировано' : 'Копировать'}</Button>
          </Box>
          <Typography variant="caption" color="text.secondary">
            Приглашено: {info.invitedCount} · активных друзей: {info.activeCount} · заработано: {info.earnedVp.toLocaleString('ru-RU')} ВП
          </Typography>
        </>}
      </Box>
    </Collapse>
  </Box>;
}

export default function WalletTopup() {
  const balance = useShopStore(s => s.balanceVp);
  const [rub, setRub] = useState('100');
  const [pending, setPending] = useState(false);
  const [order, setOrder] = useState<{ orderId: string; fields: Record<string, string> } | null>(null);
  const [message, setMessage] = useState('');
  const valid = Number.isSafeInteger(Number(rub)) && Number(rub) >= 25 && Number(rub) <= 25000;
  useEffect(() => {
    if (!order) return;
    let active = true;
    const timer = window.setInterval(async () => {
      try {
        const { data } = await api.get(`/wallet/orders/${order.orderId}`);
        if (active && data.status === 'paid') {
          setMessage('Оплата получена. ВП зачислены.'); setOrder(null);
          await useShopStore.getState().loadWallet();
        }
      } catch { /* Повторим проверку после восстановления соединения. */ }
    }, 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, [order]);
  const create = async () => {
    setPending(true); setMessage('');
    try {
      const { data } = await api.post('/wallet/yoomoney/topup', { rub: Number(rub) });
      setOrder(data);
    } catch (e: any) { setMessage(e?.response?.data?.message || 'Не удалось создать платёж'); }
    finally { setPending(false); }
  };
  return <Box sx={{ mb: 2, display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 1fr)' }, alignItems: 'start', gap: 2, minWidth: 0 }}>
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
    <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 1, rowGap: 0.5 }}>
      <Typography>Баланс:</Typography>
      <Typography sx={{ fontSize: 20, fontWeight: 700, overflowWrap: 'anywhere' }}>{balance.toLocaleString('ru-RU')} ВП</Typography>
      <Typography variant="body2" color="text.secondary">1 ₽ = 2 ВП</Typography>
    </Box>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 200px) minmax(0, 1fr)' }, alignItems: 'start', gap: 1.5 }}>
    <TextField size="small" type="number" label="Сумма, ₽" value={rub} disabled={pending || !!order} onChange={e => setRub(e.target.value)} inputProps={{ min: 25, max: 25000, step: 1 }} />
    {!order && <Button sx={{ minHeight: 40, textTransform: 'none', width: { xs: '100%', sm: 'auto' }, justifySelf: { sm: 'start' } }} disabled={!valid || pending} onClick={() => void create()}>Пополнить на {valid ? `${Number(rub) * 2} ВП` : '—'}</Button>}
    </Box>
    {order && <Box component="form" action="https://yoomoney.ru/quickpay/confirm" method="POST" target="_blank" rel="noopener noreferrer" sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, '& .MuiButton-root': { minHeight: 40, textTransform: 'none', width: { xs: '100%', sm: 'auto' } } }}>
      {Object.entries(order.fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <Button type="submit">Оплатить картой через ЮMoney</Button>
      <Button onClick={() => setOrder(null)}>Другой платёж</Button>
      <Typography variant="caption" sx={{ width: '100%' }}>Ожидаем подтверждение оплаты. ВП зачисляются автоматически, даже если закрыть магазин.</Typography>
    </Box>}
    {message && <Typography role="status">{message}</Typography>}
    </Box>
    <ReferralCard />
  </Box>;
}