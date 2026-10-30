const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createKeyring } = require('./store/crypto');
const { openStore, classify } = require('./store/sqlite-store');

function withStore(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-store-'));
  const file = path.join(dir, 'vera-store.db');
  const keyring = createKeyring(crypto.randomBytes(32));
  const opened = [];
  const open = (opts = {}) => { const s = openStore({ file, keyring, ...opts }); opened.push(s); return s; };
  try { return run({ open, file, dir, keyring }); }
  finally {
    for (const s of opened) s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const sample = () => ({
  users: [{ id: 'u1', username: 'alice', email: 'alice@example.com' }, { id: 'u2', username: 'bob' }],
  messages: [{ id: 'm1', chatId: 'c1', text: 'совершенно секретный текст' }],
  userStores: { u1: { loot: { data: { cases: 2 } } } },
  admins: ['alice'],
  platformRevenueVp: 42,
  moderationIps: {},
});

test('классификация коллекций', () => {
  assert.equal(classify([{ id: 'a' }, { id: 'b' }]), 'list');
  assert.equal(classify([]), 'list');
  assert.equal(classify([{ id: 'a' }, { id: 'a' }]), 'value', 'дубликаты id');
  assert.equal(classify([{ name: 'x' }]), 'value', 'без id');
  assert.equal(classify(['alice']), 'value');
  assert.equal(classify({ a: 1 }), 'map');
  assert.equal(classify(7), 'value');
});

test('save → load возвращает те же данные, на диске нет открытого текста', () => {
  withStore(({ open, file }) => {
    const store = open();
    assert.equal(store.isEmpty(), true);
    store.save(sample());
    store.close();
    assert.deepEqual(open().load(), sample());

    const raw = fs.readFileSync(file);
    for (const secret of ['совершенно секретный', 'alice@example.com', 'alice']) {
      assert.ok(!raw.includes(Buffer.from(secret)), `«${secret}» не лежит в файле открыто`);
    }
  });
});

test('повторное сохранение без изменений ничего не пишет; меняется только тронутая запись', () => {
  withStore(({ open, file }) => {
    const store = open();
    const db = sample();
    store.save(db);
    assert.equal(store.save(db), 0, 'нет изменений — нет записей');

    db.users[1].username = 'robert';
    assert.equal(store.save(db), 1, 'перешифрована одна строка');

    db.messages.push({ id: 'm2', chatId: 'c1', text: 'ещё' });
    db.users.shift();
    delete db.moderationIps;
    store.save(db);
    store.close();

    const loaded = open().load();
    assert.deepEqual(loaded.users, [{ id: 'u2', username: 'robert' }]);
    assert.equal(loaded.messages.length, 2);
    assert.ok(!('moderationIps' in loaded), 'удалённая коллекция исчезла');
    const sql = new DatabaseSync(file, { readOnly: true });
    try {
      assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM records WHERE collection = 'users'").get().n, 1);
    } finally { sql.close(); }
  });
});

test('порядок массивов и смена вида коллекции сохраняются', () => {
  withStore(({ open }) => {
    const store = open();
    const db = { list: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
    store.save(db);
    db.list.reverse();
    store.save(db);
    db.list = ['теперь', 'строки'];
    store.save(db);
    db.extra = { '__proto__x': 1, normal: 2 };
    store.save(db);
    store.close();
    const loaded = open().load();
    assert.deepEqual(loaded.list, ['теперь', 'строки']);
    assert.deepEqual(loaded.extra, { '__proto__x': 1, normal: 2 });
  });
});

test('чужой ключ не открывает базу', () => {
  withStore(({ open, file }) => {
    open().save(sample());
    assert.throws(() => openStore({ file, keyring: createKeyring(crypto.randomBytes(32)) }), /Неверный VERA_KEK/);
  });
});

test('подмена строки в базе обнаруживается при загрузке', () => {
  withStore(({ open, file }) => {
    const store = open();
    store.save(sample());
    store.close();
    // Злоумышленник с доступом к файлу переставляет шифротексты двух пользователей.
    const sql = new DatabaseSync(file);
    try {
      const u2 = sql.prepare("SELECT data FROM records WHERE collection='users' AND id='u2'").get().data;
      sql.prepare("UPDATE records SET data = ? WHERE collection='users' AND id='u1'").run(u2);
    } finally { sql.close(); }
    assert.throws(() => open().load());
  });
});

test('сбой посреди транзакции не оставляет половину изменений', () => {
  withStore(({ open }) => {
    const store = open();
    store.save(sample());
    const bad = sample();
    bad.users[0].username = 'changed';
    bad.broken = [{ id: 'x', n: 1n }]; // BigInt не сериализуется в JSON
    assert.throws(() => store.save(bad), /BigInt/);
    store.close();
    assert.equal(open().load().users[0].username, 'alice', 'старое состояние на месте');
  });
});

test('ошибка SQL откатывает транзакцию целиком, следующий save дописывает всё', () => {
  withStore(({ open, file, keyring }) => {
    const store = open();
    store.save(sample());
    // Триггер роняет вставку нового сообщения — после обновления пользователя.
    const sql = new DatabaseSync(file);
    sql.exec(`CREATE TRIGGER fail_m2 BEFORE INSERT ON records WHEN NEW.id = 'm2'
      BEGIN SELECT RAISE(ABORT, 'disk full'); END`);
    const db = sample();
    db.users[0].username = 'changed';
    db.messages.push({ id: 'm2', text: 'x' });
    assert.throws(() => store.save(db), /disk full/);
    // Обновление пользователя шло раньше упавшей вставки — и тоже откатилось.
    const check = openStore({ file, keyring, readOnly: true });
    try { assert.equal(check.load().users[0].username, 'alice', 'частичной записи нет'); } finally { check.close(); }
    sql.exec('DROP TRIGGER fail_m2');
    sql.close();
    store.save(db);
    store.close();
    const loaded = open().load();
    assert.equal(loaded.users[0].username, 'changed');
    assert.equal(loaded.messages.length, 2);
  });
});

test('явные таблицы: отсутствующие и нестандартные поля не роняют сохранение', () => {
  withStore(({ open }) => {
    const store = open();
    // Параметр 7 upsertUser — display_name: undefined раньше давал
    // «Provided value cannot be bound to SQLite parameter 7» и откатывал весь save.
    const db = {
      users: [{ id: 'u1', username: 'alice', passwordHash: 'h', displayName: undefined, avatarUrl: undefined, status: { text: 'тут' } }],
      chats: [{ id: 'c1', isPublic: true }],
      chatMembers: [{ id: 'cm1', chatId: 'c1', userId: 'u1' }],
      messages: [{ id: 'm1', chatId: 'c1', senderId: 'u1', editedAt: undefined, readBy: ['u1'] }],
      devices: [{ id: 'd1', userId: 'u1', deviceId: 'dev-1', lastSeenAt: undefined }],
      refreshTokens: [{ id: 't1', userId: 'u1', deviceId: 'dev-1', tokenHash: 'x', expiresAt: new Date(0) }],
    };
    assert.doesNotThrow(() => store.saveExplicitTables(db));
    const loaded = {};
    store.loadExplicitTables(loaded);
    assert.equal(loaded.users[0].username, 'alice');
    assert.equal(loaded.users[0].displayName, null);
    assert.equal(loaded.messages[0].senderId, 'u1');
  });
});

test('явные таблицы не дублируют записи, уже загруженные из коллекций', () => {
  withStore(({ open }) => {
    const store = open();
    const full = {
      users: [{ id: 'u1', username: 'alice', passwordHash: 'h', firstName: 'Алиса' }],
      chats: [{ id: 'c1', type: 'group', name: 'Группа' }],
      chatMembers: [{ id: 'cm1', chatId: 'c1', userId: 'u1' }],
      messages: [{ id: 'm1', chatId: 'c1', senderId: 'u1', text: 'привет', content: 'привет' }],
    };
    store.save(full);
    store.saveExplicitTables(full);
    const loaded = store.load();
    store.loadExplicitTables(loaded);
    // Раньше тут было по две записи: полная из коллекции и урезанная из таблицы.
    assert.equal(loaded.users.length, 1);
    assert.equal(loaded.users[0].firstName, 'Алиса', 'осталась полная запись');
    assert.equal(loaded.chats.length, 1);
    assert.equal(loaded.chatMembers.length, 1);
    assert.equal(loaded.messages.length, 1);
    assert.equal(loaded.messages[0].content, 'привет');
  });
});

test('бэкап — полноценная зашифрованная копия', () => {
  withStore(({ open, dir, keyring }) => {
    const store = open();
    store.save(sample());
    const target = path.join(dir, 'copy', 'backup.db');
    store.backupTo(target);
    assert.throws(() => store.backupTo(target), /уже существует/);
    const copy = openStore({ file: target, keyring, readOnly: true });
    try { assert.deepEqual(copy.load(), sample()); } finally { copy.close(); }
  });
});
