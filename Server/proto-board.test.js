/**
 * Прото доска: права и чистка присланных данных.
 *
 * Проверяем то, что легко сломать незаметно: обход прав (viewer не должен
 * ни прочитать доску без приглашения, ни записать в неё) и санитайзер, потому
 * что без него клиент мог бы залить в БД строки в мегабайты, координаты в
 * отрицательные тысячи и ссылки на файлы, которых на сервере нет.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const protoBoard = require('./proto-board');
const { sanitizeBoard, levelOf, canEdit, canManage } = protoBoard;

// ─── Права ────────────────────────────────────────────────────────────────────

test('уровень: владелец, выданные права и никто', () => {
  const board = { ownerId: 'owner', access: [{ userId: 'e', level: 'editor' }, { userId: 'v', level: 'viewer' }] };
  assert.equal(levelOf(board, 'owner'), 'owner', 'владелец');
  assert.equal(levelOf(board, 'e'), 'editor');
  assert.equal(levelOf(board, 'v'), 'viewer');
  // Участник чата без выданных прав — не значит «зритель». Иначе любой, кто
  // состоит в группе, получил бы все карточки и фото.
  assert.equal(levelOf(board, 'stranger'), null);
});

test('писать может редактор и владелец, зритель — нет', () => {
  const board = { ownerId: 'owner', access: [{ userId: 'e', level: 'editor' }, { userId: 'v', level: 'viewer' }] };
  assert.ok(canEdit(board, 'owner'));
  assert.ok(canEdit(board, 'e'));
  assert.equal(canEdit(board, 'v'), false, 'зритель не пишет');
  assert.equal(canEdit(board, 'stranger'), false, 'чужой не пишет');
});

test('состав меняет только владелец', () => {
  const board = { ownerId: 'owner', access: [{ userId: 'e', level: 'editor' }] };
  assert.ok(canManage(board, 'owner'));
  // Редактору доверяем карточки, но не состав: иначе он выдал бы себе права
  // полнее собственных и выкинул бы владельца.
  assert.equal(canManage(board, 'e'), false, 'редактор состав не меняет');
});

test('битый уровень не превращается в редактора', () => {
  // Уровень приходит из БД, а значит может быть подправлен снаружи.
  const board = { ownerId: 'owner', access: [{ userId: 'x', level: 'owner' }] };
  assert.equal(levelOf(board, 'x'), 'viewer', 'повысить себя нельзя');
  assert.equal(canEdit(board, 'x'), false, 'и редактором не станет');
});

test('запись в access не отбирает права у владельца', () => {
  // Порядок проверок в levelOf mattered: сначала список access, потом ownerId.
  // Стоит владельцу случайно оказаться в access (старые базы, правка руками) —
  // и он молча становится зрителем. А состав меняет только владелец, то есть
  // вернуть право уже нечем: доска залипает навсегда.
  const board = { ownerId: 'owner', access: [{ userId: 'owner', level: 'viewer' }] };
  assert.equal(levelOf(board, 'owner'), 'owner', 'владелец остаётся владельцем');
  assert.ok(canManage(board, 'owner'), 'и состав менять может');
  assert.ok(canEdit(board, 'owner'), 'и писать может');
  // Тот же случай с 'editor' — не ровно 'owner', поэтому проверка на
  // неравенство раньше пропускала бы и его.
  const board2 = { ownerId: 'owner', access: [{ userId: 'owner', level: 'editor' }] };
  assert.equal(levelOf(board2, 'owner'), 'owner');
});

test('у доски без владельца права есть только у выданных', () => {
  // Старая доска, сохранённая до появления ownerId. Молча назначать владельцем
  // первого зрителя нельзя — это отдало бы доску тому, кто случайно зашёл.
  const board = { access: [{ userId: 'e', level: 'editor' }] };
  assert.equal(levelOf(board, 'e'), 'editor');
  assert.equal(levelOf(board, 'owner'), null, 'никто не владелец');
  assert.equal(canManage(board, 'e'), false, 'иManage не выдаётся');
});

// ─── Санитайзер ───────────────────────────────────────────────────────────────

test('слишком длинный текст обрезается', () => {
  const b = sanitizeBoard({ items: [{ id: 'a', kind: 'note', text: 'я'.repeat(protoBoard.MAX_TEXT + 500) }] });
  assert.equal(b.items[0].text.length, protoBoard.MAX_TEXT);
});

test('лишние карточки отбрасываются', () => {
  const items = Array.from({ length: protoBoard.MAX_ITEMS + 50 }, (_, i) => ({ id: `i${i}`, kind: 'note' }));
  assert.equal(sanitizeBoard({ items }).items.length, protoBoard.MAX_ITEMS);
});

test('дубликаты id не проходят', () => {
  // Иначе нить повисла бы сразу на двух карточках, а React — на одинаковых ключах.
  const b = sanitizeBoard({ items: [{ id: 'a', kind: 'note' }, { id: 'a', kind: 'note' }] });
  assert.equal(b.items.length, 1);
});

test('фото принимается только из своей папки', () => {
  const b = sanitizeBoard({
    items: [
      { id: 'good', kind: 'photo', photoUrl: '/uploads/proto/abc-1.jpg' },
      // Чужие и подозрительные ссылки отбрасываются вместе с карточкой:
      // иначе приложение грузило бы что угодно от чужого домена.
      { id: 'evil', kind: 'photo', photoUrl: 'https://evil.example/x.png' },
      { id: 'trav', kind: 'photo', photoUrl: '/uploads/proto/../../secret.txt' },
      { id: 'none', kind: 'photo' },
    ],
  });
  assert.deepEqual(b.items.map((i) => i.id), ['good']);
});

test('нить на удалённую карточку не хранится', () => {
  const b = sanitizeBoard({
    items: [{ id: 'a', kind: 'note' }],
    threads: [
      { id: 't1', from: 'a', to: 'a' }, // петля
      { id: 't2', from: 'a', to: 'ghost' }, // нет такой карточки
      { id: 't3', from: 'a', to: 'b' }, // нет такой карточки
    ],
  });
  assert.equal(b.threads.length, 0);
});

test('координаты не уезжают за пределы разумного', () => {
  const b = sanitizeBoard({ items: [{ id: 'a', kind: 'note', x: -999999, y: 999999, w: 1e9 }] });
  assert.equal(b.items[0].w, 4000, 'размер ограничен');
  assert.ok(b.items[0].x >= -100000 && b.items[0].y <= 100000);
});

test('рисунок ограничивается безопасными штрихами', () => {
  const b = sanitizeBoard({ drawing: [
    { color: '#fff', width: 4, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
    { color: 'x'.repeat(5000), points: 'bad' },
  ] });
  assert.equal(b.drawing.length, 1);
  assert.equal(b.drawing[0].points.length, 2);
});

test('рисунок имеет общий бюджет размера', () => {
  const b = sanitizeBoard({ drawing: Array.from({ length: 2100 }, (_, i) => ({
    color: '#000', width: 2, points: [{ x: i, y: i }],
  })) });
  assert.equal(b.drawing.length, 2000, 'число штрихов ограничено');
  const oversized = sanitizeBoard({ drawing: [{ color: '#000', points: Array.from({ length: 2001 }, () => ({ x: 1, y: 1 })) }] });
  assert.equal(oversized.drawing.length, 0, 'слишком длинный штрих отклонён');
});
// ─── Эндпоинты: права настоящие, а не только в функции ───────────────────────

/** Поднять приложение с модулем поверх временной БД в памяти. */
function setup() {
  const db = {
    users: [
      { id: 'owner', username: 'own', firstName: 'Владелец' },
      { id: 'editor', username: 'ed', firstName: 'Редактор' },
      { id: 'viewer', username: 'vw', firstName: 'Зритель' },
      { id: 'stranger', username: 'no', firstName: 'Посторонний' },
    ],
    chats: [{ id: 'c1', name: '| Дело', type: 'group', ownerId: 'owner' }],
    // Участники нужны доске: при создании она смотрит, кто в чате админ, и
    // выдаёт им редактирование. Пустой список — тоже законное состояние.
    chatMembers: [{ id: 'mm1', chatId: 'c1', userId: 'owner', role: 'owner' }],
    protoBoards: [],
  };
  const events = [];
  const app = express();
  const auth = (req, _res, next) => { req.userId = req.headers['x-user'] || null; next(); };
  protoBoard.install({ app, getDb: () => db, saveDb: () => {}, auth, notify: (e, p) => events.push({ e, p }) });
  return { app, db, events };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function withServer(fn) {
  const s = setup();
  const server = await listen(s.app);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, url, user, body) => fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(user ? { 'x-user': user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try { await fn({ ...s, call }); } finally { server.close(); }
}

test('доску без прав не отдаём', async () => {
  await withServer(async ({ db, call }) => {
    db.protoBoards.push({ id: 'b', chatId: 'c1', ownerId: 'owner', items: [{ id: 'x', kind: 'note', text: 'секрет' }], threads: [], access: [] });
    const res = await call('GET', '/api/proto-boards/c1', 'stranger');
    assert.equal(res.status, 403);
    // И содержимого в ответе быть не должно: утечка текста в теле 403 была бы
    // тем же, что его выдача, только с кодом ошибки.
    assert.equal((await res.text()).includes('секрет'), false, 'текст карточки не утёк в 403');
  });
});

test('приглашённый редактор читает и пишет', async () => {
  await withServer(async ({ db, call }) => {
    db.protoBoards.push({ id: 'b', chatId: 'c1', ownerId: 'owner', items: [], threads: [], access: [] });
    assert.equal((await call('POST', '/api/proto-boards/c1/access', 'owner', { userId: 'editor', level: 'editor' })).status, 201);
    const put = await call('PUT', '/api/proto-boards/c1', 'editor', { items: [{ id: 'n1', kind: 'note', text: 'нашёл' }], threads: [] });
    assert.equal(put.status, 200);
    assert.equal(db.protoBoards[0].items[0].text, 'нашёл');
  });
});
test('зритель читает, но не пишет', async () => {
  await withServer(async ({ db, call }) => {
    db.protoBoards.push({ id: 'b', chatId: 'c1', ownerId: 'owner', items: [{ id: 'n', kind: 'note', text: 'видимое' }], threads: [], access: [] });
    await call('POST', '/api/proto-boards/c1/access', 'owner', { userId: 'viewer', level: 'viewer' });
    const get = await call('GET', '/api/proto-boards/c1', 'viewer');
    assert.equal(get.status, 200, 'зритель смотрит');
    assert.equal((await get.json()).canEdit, false, 'но не пишет');
    assert.equal((await call('PUT', '/api/proto-boards/c1', 'viewer', { items: [], threads: [] })).status, 403, 'запись отклонена');
    // Главное: карточка не пропала. Иначе зритель сломал бы доску, просто
    // сохранив пустую.
    assert.equal(db.protoBoards[0].items.length, 1, 'доска не затёрта');
  });
});

test('через HTTP владелец остаётся админом, даже если попал в access', async () => {
  await withServer(async ({ db, call }) => {
    // Список access с владельцем внутри — состояние, которое можно получить
    // старой базой или правкой руками. Через API так не сделать: выдача
    // владельцу запрещена. Поэтому проверяем, что система это переживает.
    db.protoBoards.push({ id: 'b', chatId: 'c1', ownerId: 'owner', items: [], threads: [], access: [{ userId: 'owner', level: 'viewer' }] });
    const get = await call('GET', '/api/proto-boards/c1', 'owner');
    assert.equal(get.status, 200, 'владелец видит доску');
    const body = await get.json();
    assert.equal(body.myLevel, 'owner', 'а не зритель');
    assert.equal(body.canManage, true, 'состав менять может');
    assert.equal(body.canEdit, true, 'и писать может');
    // И состав он всё ещё может менять — то есть доска не залипла.
    assert.equal((await call('POST', '/api/proto-boards/c1/access', 'owner', { userId: 'editor', level: 'editor' })).status, 201);
    // В списке состава владельца нет: он и так админ, дублировать его не надо.
    assert.equal(body.members.some((m) => m.userId === 'owner'), false, 'владельца не дублируем в списке');
  });
});

test('создавший доску становится её владельцем, а не зрителем', async () => {
  await withServer(async ({ db, call }) => {
    // Регрессия: владельцем доски назначался хозяин ЧАТА (chat.ownerId).
    // Кто открыл доску первым и тот хозяин — не обязательно один человек:
    // тогда создатель получал myLevel = null, то есть «зрителя», и составом
    // доски управлять было уже некому.
    db.chats.push({ id: 'c2', name: '| Дело', type: 'group', ownerId: 'stranger' });
    db.chatMembers.push({ id: 'm1', chatId: 'c2', userId: 'stranger', role: 'owner' });
    db.chatMembers.push({ id: 'm2', chatId: 'c2', userId: 'editor', role: 'member' });

    const get = await call('GET', '/api/proto-boards/c2', 'editor');
    assert.equal(get.status, 200);
    const body = await get.json();
    assert.equal(body.myLevel, 'owner', 'кто открыл — тот и владелец');
    assert.equal(body.canManage, true, 'состав менять может');
    assert.equal(body.canEdit, true, 'и писать может');
    assert.equal(db.protoBoards.find((b) => b.chatId === 'c2').ownerId, 'editor', 'владелец записан в БД');
    // Хозяин чата при этом не выкинут: он получает право редактирования,
    // иначе он бы совсем потерял доступ к доске своей группы.
    const boss = await call('GET', '/api/proto-boards/c2', 'stranger');
    assert.equal(boss.status, 200, 'хозяин группы доску видит');
    assert.equal((await boss.json()).canEdit, true, 'и может редактировать');
  });
});

test('повторное открытие доски не переводит создателя в зрители', async () => {
  await withServer(async ({ db, call }) => {
    db.chats.push({ id: 'c3', name: '| Дело', type: 'group', ownerId: 'owner' });
    await call('GET', '/api/proto-boards/c3', 'editor');
    // Второй запрос того же человека: доска уже создана, права те же.
    const again = await call('GET', '/api/proto-boards/c3', 'editor');
    assert.equal((await again.json()).myLevel, 'owner', 'права не теряются');
    assert.equal(db.protoBoards.filter((b) => b.chatId === 'c3').length, 1, 'доска одна');
  });
});

test('доска без владельца не достаётся никому', async () => {
  await withServer(async ({ db, call }) => {
    // Доска, сохранённая до появления ownerId. Молча отдавать её первому
    // желавшему нельзя — иначе права обошёл бы тот, кто просто зашёл.
    db.protoBoards.push({ id: 'b', chatId: 'c1', items: [], threads: [], access: [{ userId: 'editor', level: 'editor' }] });
    const me = await call('GET', '/api/proto-boards/c1', 'editor');
    assert.equal(me.status, 200, 'выданные права работают');
    assert.equal((await me.json()).canManage, false, 'но состав менять нельзя');
    assert.equal((await call('GET', '/api/proto-boards/c1', 'stranger')).status, 403, 'посторонний не видит');
  });
});

test('размер доски сохраняется и не выходит за границы', async () => {
  await withServer(async ({ db, call }) => {
    await call('GET', '/api/proto-boards/c1', 'owner');
    const put = await call('PUT', '/api/proto-boards/c1', 'owner', {
      items: [], threads: [], width: 4200, height: 2400,
    });
    assert.equal(put.status, 200);
    const body = await put.json();
    assert.equal(body.width, 4200, 'ширина сохранена');
    assert.equal(body.height, 2400, 'высота сохранена');
    // Размер переживает ПОВТОРНОЕ чтение: иначе кнопки «±» работали бы
    // только до перезагрузки страницы.
    const again = await (await call('GET', '/api/proto-boards/c1', 'owner')).json();
    assert.equal(again.width, 4200, 'и после перечитывания тоже');

    // Мусорные размеры не проходят: иначе доска с нулевой шириной не рисуется.
    const junk = await (await call('PUT', '/api/proto-boards/c1', 'owner', {
      items: [], threads: [], width: -100, height: 999999,
    })).json();
    assert.ok(junk.width >= 1200, 'ширина не ушла в минус');
    assert.ok(junk.height <= 6000, 'высота не улетела в потолок');
  });
});

test('доска без размера отдаёт размер по умолчанию', async () => {
  await withServer(async ({ db, call }) => {
    // Доска, сохранённая до появления размеров: width/height в БД нет.
    db.protoBoards.push({ id: 'b', chatId: 'c1', ownerId: 'owner', items: [], threads: [], access: [] });
    const body = await (await call('GET', '/api/proto-boards/c1', 'owner')).json();
    assert.ok(body.width > 0 && body.height > 0, 'размер подставлен, холст не нулевой');
  });
});

test('папки: вид сохраняется, битая ссылка отбрасывается', async () => {
  await withServer(async ({ db, call }) => {
    await call('GET', '/api/proto-boards/c1', 'owner');
    const res = await call('PUT', '/api/proto-boards/c1', 'owner', {
      items: [
        { id: 'f1', kind: 'folder', x: 10, y: 10, w: 500, h: 400, text: 'Дело' },
        // Карточка стоит в списке РАНЬШЕ своей папки — так тоже должно работать.
        { id: 'c1', kind: 'note', x: 40, y: 40, w: 200, h: 150, text: 'улика', folderId: 'f1' },
        { id: 'c2', kind: 'note', x: 60, y: 60, w: 200, h: 150, text: 'сирота', folderId: 'ghost' },
        { id: 'f2', kind: 'folder', x: 90, y: 90, w: 400, h: 300, text: 'В себе', folderId: 'f2' },
      ],
      threads: [],
    });
    assert.equal(res.status, 200);
    const items = (await res.json()).items;
    const by = (id) => items.find((i) => i.id === id);
    assert.equal(by('f1').kind, 'folder', 'вид «папка» не срезается до «заметки»');
    assert.equal(by('c1').folderId, 'f1', 'ссылка на существующую папку сохранена');
    assert.equal(by('c2').folderId, undefined, 'ссылка в пустоту отброшена');
    assert.equal(by('f2').folderId, undefined, 'папка не может лежать в себе');
  });
});

test('редактор не может выдать права полнее', async () => {
  await withServer(async ({ db, call }) => {
    db.protoBoards.push({ id: 'b', chatId: 'c1', ownerId: 'owner', items: [], threads: [], access: [{ userId: 'editor', level: 'editor' }] });
    assert.equal((await call('POST', '/api/proto-boards/c1/access', 'editor', { userId: 'editor', level: 'owner' })).status, 403);
    // 'owner' не выдаётся никому: иначе владельцев можно было бы размножить
    // и заблокировать себе смену состава.
    assert.equal((await call('POST', '/api/proto-boards/c1/access', 'owner', { userId: 'viewer', level: 'owner' })).status, 400);
  });
});

test('повторное приглашение меняет уровень, а не дублирует', async () => {
  await withServer(async ({ db, call }) => {
    db.protoBoards.push({ id: 'b', chatId: 'c1', ownerId: 'owner', items: [], threads: [], access: [] });
    await call('POST', '/api/proto-boards/c1/access', 'owner', { userId: 'viewer', level: 'viewer' });
    await call('POST', '/api/proto-boards/c1/access', 'owner', { userId: 'viewer', level: 'editor' });
    assert.equal(db.protoBoards[0].access.length, 1, 'человек один в списке');
    assert.equal(db.protoBoards[0].access[0].level, 'editor');
  });
});

test('отобранный доступ действительно отбирается', async () => {
  await withServer(async ({ db, call }) => {
    db.protoBoards.push({ id: 'b', chatId: 'c1', ownerId: 'owner', items: [], threads: [], access: [{ userId: 'editor', level: 'editor' }] });
    assert.equal((await call('DELETE', '/api/proto-boards/c1/access/editor', 'owner')).status, 200);
    // Проверяем через поведение, а не через список: иначе тест прошёл бы даже
    // при неработающей проверке прав на запись.
    assert.equal((await call('PUT', '/api/proto-boards/c1', 'editor', { items: [] })).status, 403);
  });
});

test('сохранили доску — остальным ушло событие', async () => {
  await withServer(async ({ db, call, events }) => {
    db.protoBoards.push({ id: 'b', chatId: 'c1', ownerId: 'owner', items: [], threads: [], access: [{ userId: 'editor', level: 'editor' }] });
    await call('PUT', '/api/proto-boards/c1', 'editor', { items: [{ id: 'n', kind: 'note' }], threads: [] });
    // Без события у второго участника доска обновится только после F5.
    assert.ok(events.some((x) => x.e === 'proto-board:updated' && x.p.chatId === 'c1'), 'событие рассылки');
  });
});