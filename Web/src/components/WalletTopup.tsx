import React, { useEffect, useState } from 'react';
import { Box, Button, TextField, Typography } from '@mui/material';
import api from '../services/api';
import { useShopStore } from '../store/shopStore';

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
  return <Box sx={{ mb: 2, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
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
  </Box>;
}