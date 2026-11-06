import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import { tradesApi } from '../services/api';
import { Trade, TradeSide, useTradeStore } from '../store/tradeStore';
import { refreshAfterTrade, tradeItemInfo } from './TradeDialog';
import { UI_SURFACE_RADIUS } from '../store/uiPrefsStore';

const STATUS_LABELS: Record<Trade['status'], string> = {
  pending: 'Ждёт ответа', accepted: 'Обмен состоялся', declined: 'Отклонён', cancelled: 'Отменён', expired: 'Истёк срок',
};

function SideList({ title, side, theme }: { title: string; side: TradeSide; theme: any }) {
  return <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: theme.textSec, mb: 0.5 }}>{title}</Typography>
    {!side.items.length && !side.vp && <Typography sx={{ fontSize: 13, color: theme.textSec }}>ничего</Typography>}
    {side.items.map(id => {
      const info = tradeItemInfo(id);
      return <Typography key={id} sx={{ fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: info.color, flexShrink: 0 }} />{info.name}
      </Typography>;
    })}
    {side.vp > 0 && <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>{side.vp.toLocaleString('ru-RU')} ВП</Typography>}
  </Box>;
}

/** Вкладка «Обмены» в магазине: входящие и исходящие предложения. */
export default function TradesPanel({ theme }: { theme: any }) {
  const { trades, eligible, load } = useTradeStore();
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    load().catch(() => setError('Не удалось загрузить обмены')).finally(() => setLoaded(true));
  }, [load]);

  const act = async (trade: Trade, action: 'accept' | 'decline' | 'cancel') => {
    setBusyId(trade.id); setError('');
    try {
      await tradesApi[action](trade.id);
      if (action === 'accept') await refreshAfterTrade(); else await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Не удалось выполнить действие');
      await load().catch(() => undefined);
    } finally { setBusyId(null); }
  };

  if (loaded && !eligible) {
    return <Alert severity="info" sx={{ my: 2 }}>
      Обмен доступен только аккаунтам, к которым привязаны и телефон, и почта. Добавьте их в профиле.
    </Alert>;
  }

  return <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
    <Typography sx={{ fontSize: 13, color: theme.textSec }}>
      Предложить обмен можно из профиля пользователя: кнопка «Предложить обмен». Обмен возможен, только если у вас обоих привязаны телефон и почта.
    </Typography>
    {error && <Alert severity="error">{error}</Alert>}
    {loaded && !trades.length && <Typography sx={{ textAlign: 'center', py: 6, color: theme.textSec }}>Предложений обмена пока нет.</Typography>}
    {trades.map(trade => {
      const partner = trade.outgoing ? trade.to : trade.from;
      const pending = trade.status === 'pending';
      const busy = busyId === trade.id;
      return <Box key={trade.id} sx={{ p: 1.5, borderRadius: UI_SURFACE_RADIUS, border: `1px solid ${pending && !trade.outgoing ? theme.accent : theme.border}`, bgcolor: theme.bgHeader }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mb: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ fontWeight: 800 }}>{trade.outgoing ? `Вы → @${partner.username}` : `@${partner.username} → вам`}</Typography>
          <Typography sx={{ fontSize: 12, color: theme.textSec }}>{STATUS_LABELS[trade.status]} · {new Date(trade.createdAt).toLocaleString('ru-RU')}</Typography>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 2 }}>
          <SideList title={trade.outgoing ? 'Вы отдаёте' : 'Вы получаете'} side={trade.offer} theme={theme} />
          <SideList title={trade.outgoing ? 'Вы получаете' : 'Вы отдаёте'} side={trade.request} theme={theme} />
        </Box>
        {pending && <Box sx={{ display: 'flex', gap: 1, mt: 1.25, justifyContent: 'flex-end' }}>
          {trade.outgoing
            ? <Button disabled={busy} onClick={() => act(trade, 'cancel')}>Отменить</Button>
            : <>
              <Button disabled={busy} onClick={() => act(trade, 'decline')}>Отклонить</Button>
              <Button variant="contained" disabled={busy} onClick={() => act(trade, 'accept')}>Принять</Button>
            </>}
        </Box>}
      </Box>;
    })}
  </Box>;
}
