const crypto = require('crypto');

function signature(body, secret) {
  const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const text = Object.keys(body).filter(k => k !== 'sign').sort().map(k => `${k}=${encode(body[k])}`).join('&');
  return crypto.createHmac('sha256', secret).update(text).digest('hex');
}

function registerYoomoney(app, { getDb, saveDb, authMiddleware, ensureWallet, pushWalletEmit }) {
  const receiver = process.env.YOOMONEY_RECEIVER || '';
  const secret = process.env.YOOMONEY_NOTIFICATION_SECRET || '';
  app.post('/api/wallet/yoomoney/topup', authMiddleware, (req, res) => {
    const db = getDb();
    if (!/^410\d+$/.test(receiver) || !secret) return res.status(503).json({ message: 'Пополнение пока не настроено владельцем сервера' });
    const rub = Number(req.body?.rub);
    if (!Number.isSafeInteger(rub) || rub < 25 || rub > 25000) return res.status(400).json({ message: 'Введите целую сумму от 25 до 25000 ₽' });
    if (!db.users.some(u => u.id === req.userId)) return res.sendStatus(404);
    const order = { id: crypto.randomUUID(), provider: 'yoomoney', userId: req.userId, amountVs: rub * 2, priceRub: rub, status: 'waiting', createdAt: Date.now() };
    db.walletOrders ||= [];
    db.walletOrders.push(order);
    try { saveDb(); } catch {
      db.walletOrders.splice(db.walletOrders.indexOf(order), 1);
      return res.status(500).json({ message: 'Не удалось сохранить заказ' });
    }
    res.json({ orderId: order.id, fields: { receiver, 'quickpay-form': 'button', paymentType: 'AC', sum: rub.toFixed(2), label: order.id } });
  });

  app.post('/api/wallet/yoomoney/webhook', (req, res) => {
    const db = getDb();
    const body = req.body || {};
    if (!secret || Object.values(body).some(v => typeof v !== 'string') || !/^[a-f0-9]{64}$/.test(body.sign || '')) return res.sendStatus(401);
    if (!crypto.timingSafeEqual(Buffer.from(body.sign, 'hex'), Buffer.from(signature(body, secret), 'hex'))) return res.sendStatus(401);
    const order = (db.walletOrders || []).find(o => o.id === body.label && o.provider === 'yoomoney');
    if (!order || order.status === 'paid') return res.sendStatus(200);
    if (!['card-incoming', 'p2p-incoming'].includes(body.notification_type) || body.currency !== '643' || body.codepro !== 'false' || body.unaccepted !== 'false' || body.test_notification === 'true' || !body.operation_id) return res.sendStatus(400);
    if (!/^\d+(\.\d{1,2})?$/.test(body.withdraw_amount || '') || Math.round(Number(body.withdraw_amount) * 100) !== order.priceRub * 100 || !(Number(body.amount) > 0)) return res.sendStatus(400);
    if (db.walletOrders.some(o => o.provider === 'yoomoney' && o.operationId === body.operation_id)) return res.sendStatus(409);
    const user = ensureWallet(db.users.find(u => u.id === order.userId));
    if (!user) return res.sendStatus(404);
    const balance = user.walletBalance || 0;
    if (!Number.isSafeInteger(balance + order.amountVs)) return res.sendStatus(409);
    user.walletBalance = balance + order.amountVs;
    Object.assign(order, { status: 'paid', operationId: body.operation_id, paidAt: Date.now() });
    try { saveDb(); } catch {
      user.walletBalance = balance;
      order.status = 'waiting'; delete order.operationId; delete order.paidAt;
      return res.sendStatus(500);
    }
    pushWalletEmit(user);
    res.sendStatus(200);
  });
}
module.exports = { signature, registerYoomoney };