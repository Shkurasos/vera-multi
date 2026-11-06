import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, ButtonBase, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import { tradesApi } from '../services/api';
import { SHOP_CATALOG, useShopStore } from '../store/shopStore';
import { findPet } from '../store/petCatalog';
import { RARITY_META } from '../utils/rarityStyles';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { usePetStore } from '../store/petStore';
import { useTradeStore } from '../store/tradeStore';
import { UI_INNER_RADIUS } from '../store/uiPrefsStore';

export const TRADE_MAX_ITEMS = 10;
const SHOP_BY_ID = new Map(SHOP_CATALOG.map(i => [i.id, i]));

/** Название, тип и цвет редкости предмета для списков обмена. */
export function tradeItemInfo(id: string) {
  const pet = findPet(id);
  const item = SHOP_BY_ID.get(id);
  const rarity = (pet?.rarity || item?.rarity || 'common') as keyof typeof RARITY_META;
  return { name: pet?.name || item?.name || id, color: RARITY_META[rarity]?.color || '#9AA3AD', kind: pet ? 'Питомец' : 'Скин' };
}

/** Кошелёк, питомцы и список обменов после принятия обмена. */
export async function refreshAfterTrade() {
  await Promise.all([
    useShopStore.getState().loadWallet().catch(() => undefined),
    usePetStore.getState().load().catch(() => undefined),
    useTradeStore.getState().load().catch(() => undefined),
  ]);
}

type InvItem = { id: string; count: number };

function ItemPicker({ title, items, selected, onToggle, theme }: {
  title: string; items: InvItem[] | null; selected: string[]; onToggle: (id: string) => void; theme: any;
}) {
  return <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: theme.textSec, mb: 1 }}>{title} · {selected.length}/{TRADE_MAX_ITEMS}</Typography>
    <Box sx={{ maxHeight: 260, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column', gap: 0.5, pr: 0.5 }}>
      {items === null && <CircularProgress size={22} sx={{ m: 2 }} />}
      {items?.length === 0 && <Typography sx={{ fontSize: 13, color: theme.textSec }}>Нет предметов для обмена</Typography>}
      {items?.map(it => {
        const info = tradeItemInfo(it.id);
        const on = selected.includes(it.id);
        return <ButtonBase key={it.id} aria-pressed={on} onClick={() => onToggle(it.id)}
          disabled={!on && selected.length >= TRADE_MAX_ITEMS}
          sx={{ justifyContent: 'flex-start', gap: 1, px: 1, py: 0.75, borderRadius: UI_INNER_RADIUS, textAlign: 'left', color: theme.text,
            border: `1px solid ${on ? theme.accent : theme.border}`, bgcolor: on ? theme.accent + '22' : theme.bgInput, '&.Mui-disabled': { opacity: 0.5 } }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: info.color, flexShrink: 0 }} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{info.name}</Typography>
            <Typography sx={{ fontSize: 11, color: theme.textSec }}>{info.kind}{it.count > 1 ? ` · ${it.count} шт.` : ''}</Typography>
          </Box>
        </ButtonBase>;
      })}
    </Box>
  </Box>;
}

const parseVp = (raw: string) => (raw.trim() === '' ? 0 : Number(raw));
const validVp = (n: number) => Number.isSafeInteger(n) && n >= 0;
const apiError = (e: any, fallback: string) => e?.response?.data?.message || fallback;


/** Окно предложения обмена пользователю partner. */
export default function TradeDialog({ partner, onClose, onSent }: {
  partner: { id: string; username: string }; onClose: () => void; onSent: () => void;
}) {
  const theme = useThemeStore(s => s.theme);
  const me = useAuthStore(s => s.user);
  const [mine, setMine] = useState<InvItem[] | null>(null);
  const [theirs, setTheirs] = useState<InvItem[] | null>(null);
  const [balance, setBalance] = useState(0);
  const [offerItems, setOfferItems] = useState<string[]>([]);
  const [requestItems, setRequestItems] = useState<string[]>([]);
  const [offerVp, setOfferVp] = useState('');
  const [requestVp, setRequestVp] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fail = (e: any) => { if (!cancelled) setError(apiError(e, 'Не удалось загрузить инвентарь')); };
    tradesApi.inventory(partner.id).then(({ data }) => { if (!cancelled) setTheirs(data.items || []); }).catch(fail);
    return () => { cancelled = true; };
  }, [partner.id]);

  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    tradesApi.inventory(me.id).then(({ data }) => {
      if (cancelled) return;
      setMine(data.items || []);
      setBalance(Number(data.balance) || 0);
    }).catch((e: any) => { if (!cancelled) setError(apiError(e, 'Не удалось загрузить инвентарь')); });
    return () => { cancelled = true; };
  }, [me?.id]);

  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (id: string) =>
    setter(list => list.includes(id) ? list.filter(x => x !== id) : list.length >= TRADE_MAX_ITEMS ? list : [...list, id]);

  const oVp = parseVp(offerVp);
  const rVp = parseVp(requestVp);
  const vpOk = validVp(oVp) && validVp(rVp) && oVp <= balance;
  const canSend = !busy && vpOk && (offerItems.length > 0 || requestItems.length > 0);
  const summary = useMemo(() => {
    const part = (ids: string[], vp: number) => [...ids.map(id => tradeItemInfo(id).name), ...(vp > 0 ? [`${vp} ВП`] : [])].join(', ') || 'ничего';
    return `Вы отдаёте: ${part(offerItems, oVp)}. Получаете: ${part(requestItems, rVp)}.`;
  }, [offerItems, requestItems, oVp, rVp]);

  const send = async () => {
    setBusy(true); setError('');
    try {
      await tradesApi.create(partner.id, { items: offerItems, vp: oVp }, { items: requestItems, vp: rVp });
      void useTradeStore.getState().load().catch(() => undefined);
      onSent();
    } catch (e: any) {
      setError(apiError(e, 'Не удалось отправить предложение'));
    } finally { setBusy(false); }
  };

  const fieldSx = { '& .MuiInputBase-root': { color: theme.text, bgcolor: theme.bgInput }, '& .MuiInputLabel-root': { color: theme.textSec }, '& .MuiOutlinedInput-notchedOutline': { borderColor: theme.border }, '& .MuiFormHelperText-root': { color: theme.textSec } };

  return <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="md" PaperProps={{ sx: { bgcolor: theme.bgSidebar || theme.bg, color: theme.text } }}>
    <DialogTitle>Обмен с @{partner.username}</DialogTitle>
    <DialogContent>
      <Typography sx={{ fontSize: 13, color: theme.textSec, mb: 2 }}>
        Выберите, что отдаёте и что хотите получить. Предметы остаются у владельцев, пока @{partner.username} не примет обмен. Если к тому моменту у кого-то чего-то не будет, обмен не пройдёт.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'minmax(0,1fr) minmax(0,1fr)' }, gap: 2 }}>
        <Box>
          <ItemPicker title="Вы отдаёте" items={mine} selected={offerItems} onToggle={toggle(setOfferItems)} theme={theme} />
          <TextField size="small" fullWidth type="number" label="ВП от вас" value={offerVp} onChange={e => setOfferVp(e.target.value)}
            inputProps={{ min: 0, step: 1 }} error={!validVp(oVp) || oVp > balance}
            helperText={oVp > balance ? `На балансе только ${balance} ВП` : `Баланс: ${balance} ВП`} sx={{ mt: 1.5, ...fieldSx }} />
        </Box>
        <Box>
          <ItemPicker title={`Вы получаете от @${partner.username}`} items={theirs} selected={requestItems} onToggle={toggle(setRequestItems)} theme={theme} />
          <TextField size="small" fullWidth type="number" label={`ВП от @${partner.username}`} value={requestVp} onChange={e => setRequestVp(e.target.value)}
            inputProps={{ min: 0, step: 1 }} error={!validVp(rVp)} helperText="Баланс проверяется при принятии" sx={{ mt: 1.5, ...fieldSx }} />
        </Box>
      </Box>
      <Typography sx={{ mt: 2, fontSize: 13.5 }}>{summary}</Typography>
    </DialogContent>
    <DialogActions>
      <Button disabled={busy} onClick={onClose}>Отмена</Button>
      <Button variant="contained" disabled={!canSend} onClick={send}>Предложить обмен</Button>
    </DialogActions>
  </Dialog>;
}
