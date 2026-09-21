const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { registerYoomoney, signature } = require('./yoomoney');

test('YooMoney HTTP flow: validation, signature, amount, replay and persistence failure', async () => {
  const previous = [process.env.YOOMONEY_RECEIVER, process.env.YOOMONEY_NOTIFICATION_SECRET];
  process.env.YOOMONEY_RECEIVER = '410012345678';
  process.env.YOOMONEY_NOTIFICATION_SECRET = 'secret123';
  const db = { users: [{ id: 'u', walletBalance: 0 }], walletOrders: [] };
  let fail = false;
  const app = express();
  app.use(express.json()); app.use(express.urlencoded({ extended: false }));
  registerYoomoney(app, { getDb: () => db, saveDb: () => { if (fail) throw Error('disk'); }, authMiddleware: (req, res, next) => { req.userId = 'u'; next(); }, ensureWallet: u => u, pushWalletEmit: () => {} });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/wallet/yoomoney`;
  const create = rub => fetch(`${base}/topup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rub }) });
  const notify = (body, bad = false) => fetch(`${base}/webhook`, { method: 'POST', body: new URLSearchParams({ ...body, sign: bad ? '0'.repeat(64) : signature(body, 'secret123') }) });
  try {
    assert.equal((await create(24)).status, 400);
    const order = await (await create(100)).json();
    assert.equal(order.fields.sum, '100.00');
    const body = { notification_type: 'card-incoming', operation_id: 'op1', amount: '97.00', withdraw_amount: '100.00', currency: '643', datetime: '2026-09-19T12:00:00Z', sender: '', codepro: 'false', unaccepted: 'false', label: order.orderId };
    assert.equal((await notify(body, true)).status, 401);
    assert.equal((await notify({ ...body, withdraw_amount: '99.00' })).status, 400);
    assert.equal((await notify({ ...body, unaccepted: 'true' })).status, 400);
    fail = true;
    assert.equal((await notify(body)).status, 500);
    assert.equal(db.users[0].walletBalance, 0);
    fail = false;
    assert.equal((await notify(body)).status, 200);
    assert.equal((await notify(body)).status, 200);
    assert.equal(db.users[0].walletBalance, 200);
    const second = await (await create(100)).json();
    assert.equal((await notify({ ...body, label: second.orderId })).status, 409);
    assert.equal(db.users[0].walletBalance, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    ['YOOMONEY_RECEIVER', 'YOOMONEY_NOTIFICATION_SECRET'].forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i];
    });
  }
});

test('signature matches official 2026 documentation vector', () => {
  const body = { notification_type: 'p2p-incoming', operation_id: '441361714955017004', amount: '98.00', withdraw_amount: '100.00', currency: '643', datetime: '2013-12-26T08:28:34Z', sender: '41000000000', codepro: 'false', label: 'ML23045', unaccepted: 'false', sha1_hash: 'ac13833bd6ba9eff1fa9e4bed76f3d6ebb57f6c0' };
  assert.equal(signature(body, 'secret123'), 'a452af731650e2c5b39abcdc7c28dd27db7b3b654c2230ad2c386e64afb98605');
});