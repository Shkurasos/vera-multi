import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Box, Typography, Button, IconButton, Card, CardContent, CardActions,
  Chip, Stack, Alert, CircularProgress,
} from '@mui/material';
import { Close, Add, Edit, Publish, Unpublished, Delete, Payment } from '@mui/icons-material';
import { creatorApi, CustomItem } from '../services/api';
import CustomItemPreview from './CustomItemPreview';
import CreatorEditor from './CreatorEditor';

interface Props { open: boolean; onClose: () => void; }

/**
 * Мастерская: экран создания/публикации кастомных предметов.
 * Гейт: `feePaid` (200₽ единоразово). Админу гейт не показывается.
 */
export default function Workshop({ open, onClose }: Props) {
  const [me, setMe] = useState<{ feePaid: boolean; isAdmin: boolean; feeRub: number; revenueVp: number } | null>(null);
  const [items, setItems] = useState<CustomItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CustomItem | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feeBusy, setFeeBusy] = useState(false);
  const [feeOrder, setFeeOrder] = useState<{ orderId: string; mock?: boolean; invoiceUrl: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [meRes, itemsRes] = await Promise.all([creatorApi.me(), creatorApi.myItems()]);
      setMe(meRes.data);
      setItems(itemsRes.data.items);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Не удалось загрузить данные');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  const openCreate = () => { setEditing(null); setEditorOpen(true); };
  const openEdit = (item: CustomItem) => { setEditing(item); setEditorOpen(true); };

  const handleSave = async (dto: any) => {
    setSaving(true);
    try {
      if (editing) await creatorApi.update(editing.id, dto);
      else await creatorApi.create(dto);
      setEditorOpen(false);
      await load();
    } finally { setSaving(false); }
  };

  const doPublish = async (item: CustomItem) => {
    try { await creatorApi.publish(item.id); await load(); }
    catch (e: any) { setError(e?.response?.data?.message || 'Не удалось опубликовать'); }
  };
  const doUnpublish = async (item: CustomItem) => {
    try { await creatorApi.unpublish(item.id); await load(); }
    catch (e: any) { setError(e?.response?.data?.message || 'Не удалось снять'); }
  };
  const doDelete = async (item: CustomItem) => {
    if (!confirm(`Удалить «${item.name}»?`)) return;
    try { await creatorApi.remove(item.id); await load(); }
    catch (e: any) { setError(e?.response?.data?.message || 'Не удалось удалить'); }
  };

  const startFee = async () => {
    setFeeBusy(true);
    try {
      const { data } = await creatorApi.joinFee();
      setFeeOrder(data as any);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Не удалось создать инвойс');
    } finally { setFeeBusy(false); }
  };
  const payMock = async () => {
    if (!feeOrder) return;
    setFeeBusy(true);
    try {
      await creatorApi.mockPayFee(feeOrder.orderId);
      setFeeOrder(null);
      await load();
    } finally { setFeeBusy(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>Мастерская</Typography>
        <IconButton onClick={onClose}><Close /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {loading && <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>}
        {!loading && !me?.feePaid && (
          <FeeGate me={me} feeOrder={feeOrder} feeBusy={feeBusy} startFee={startFee} payMock={payMock} onRecheck={load} />
        )}
        {!loading && me?.feePaid && (
          <ItemsList
            me={me} items={items} error={error} setError={setError}
            openCreate={openCreate} openEdit={openEdit}
            doPublish={doPublish} doUnpublish={doUnpublish} doDelete={doDelete}
          />
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Закрыть</Button></DialogActions>

      <CreatorEditor
        open={editorOpen}
        initial={editing}
        onClose={() => setEditorOpen(false)}
        onSave={handleSave}
        saving={saving}
        isAdmin={me?.isAdmin}
      />

    </Dialog>
  );
}

function FeeGate({ me, feeOrder, feeBusy, startFee, payMock, onRecheck }: any) {
  return (
    <Box sx={{ py: 3, textAlign: 'center' }}>
      <Typography variant="h6" gutterBottom>Стать автором</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 480, mx: 'auto' }}>
        Единоразовый взнос — {me?.feeRub ?? 200} ₽. После оплаты вы сможете создавать и продавать
        собственные кастомные предметы. Комиссия платформы — 15%, автору идёт 85% с каждой продажи.
      </Typography>
      {!feeOrder ? (
        <Button variant="contained" startIcon={<Payment />} onClick={startFee} disabled={feeBusy}>
          Оплатить {me?.feeRub ?? 200} ₽
        </Button>
      ) : feeOrder.mock ? (
        <Stack spacing={1} alignItems="center">
          <Alert severity="info">Тестовый режим — оплата эмулируется.</Alert>
          <Button variant="contained" onClick={payMock} disabled={feeBusy}>Эмулировать оплату</Button>
        </Stack>
      ) : (
        <Stack spacing={1} alignItems="center">
          <Alert severity="info">Инвойс создан. Оплатите — статус обновится автоматически.</Alert>
          <Button variant="contained" href={feeOrder.invoiceUrl} target="_blank" rel="noopener">
            Открыть страницу оплаты
          </Button>
          <Button size="small" onClick={onRecheck}>Я оплатил, проверить</Button>
        </Stack>
      )}
    </Box>
  );
}

function ItemsList({ me, items, error, setError, openCreate, openEdit, doPublish, doUnpublish, doDelete }: any) {
  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {me.isAdmin ? 'Режим админа — публикация без комиссии.' : `Комиссия 15%. Заработано: ${me.revenueVp} ВП`}
        </Typography>
        <Button variant="contained" startIcon={<Add />} onClick={openCreate}>Создать</Button>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {items.length === 0 ? (
        <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
          Пока нет предметов. Нажмите «Создать», чтобы сделать первый.
        </Box>
      ) : (
        <Stack spacing={2}>
          {items.map((item: CustomItem) => (
            <Card key={item.id}>
              <CardContent sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <CustomItemPreview spec={item.spec} label={item.name} size={72} />
                <Box sx={{ flex: 1 }}>
                  <Typography variant="subtitle1">{item.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {item.category} · {item.price} ВП · продаж: {item.salesCount || 0}
                  </Typography>
                  <Box sx={{ mt: 0.5 }}>
                    <Chip
                      size="small"
                      label={item.status === 'published' ? 'Опубликовано' : item.status === 'hidden' ? 'Скрыто' : 'Черновик'}
                      color={item.status === 'published' ? 'success' : item.status === 'hidden' ? 'error' : 'default'}
                    />
                  </Box>
                </Box>
              </CardContent>
              <CardActions>
                {item.status !== 'published' && (
                  <Button size="small" startIcon={<Edit />} onClick={() => openEdit(item)}>Изменить</Button>
                )}
                {item.status === 'draft' ? (
                  <Button size="small" startIcon={<Publish />} onClick={() => doPublish(item)}>Опубликовать</Button>
                ) : item.status === 'published' ? (
                  <Button size="small" startIcon={<Unpublished />} onClick={() => doUnpublish(item)}>Снять</Button>
                ) : null}
                {item.status !== 'published' && (
                  <Button size="small" color="error" startIcon={<Delete />} onClick={() => doDelete(item)}>Удалить</Button>
                )}
              </CardActions>
            </Card>
          ))}
        </Stack>
      )}
    </>
  );
}

