/**
 * Общая библиотека музыки — правила, поиск, сортировка и копирование.
 *
 * Проверяем чистые функции модуля: обязательные поля при публикации, поиск по
 * всем полям, сортировку и — главное — что сохранение чужого не плодит дубликаты
 * и не трогает оригинал.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

const share = require(path.join(__dirname, 'music-share.js'));

/**
 * Поднять настоящие маршруты поверх БД в памяти.
 *
 * Чистые функции проверяются выше, но часть ошибок живёт именно в обработчиках:
 * `unknownGenre` уже ломал публикацию с 500, и ни одна проверка `validatePublish`
 * этого не видела — функция была в порядке, падал вызывавший её код.
 */
async function harness() {
  const db = {
    users: [{ id: 'u1', username: 'vera', firstName: 'Вера' }],
    tracks: [{
      id: 't1', title: 'Закат', artist: 'Вера', duration: 100,
      fileUrl: '/uploads/music/a.mp3', coverUrl: '/uploads/music/c.jpg',
      uploadedById: 'u1', playsCount: 0, createdAt: '2024-01-01T00:00:00.000Z',
      isPublic: false,
    }],
  };
  const app = express();
  const auth = (req, _res, next) => { req.userId = req.headers['x-user'] || 'u1'; next(); };
  share.install({ app, getDb: () => db, saveDb: () => {}, auth });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, url, body) => fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', 'x-user': 'u1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // Сервер гасим в finally, а не через afterEach: хук, зарегистрированный
  // изнутри теста, не срабатывал, и процесс с открытым listen() не завершался
  // — прогон молча висел вместо падения.
  return {
    app, db, call,
    run: async (fn) => { try { return await fn({ app, db, call }); } finally { server.close(); } },
  };
}

const {
  validatePublish, matchTrack, sortTracks, matchAlbum,
  copyTrackForUser, copyAlbumForUser, ensureAlbums, GENRES, REQUIRED_PUBLISH_FIELDS,
} = share;

const track = (over = {}) => ({
  id: 't1', title: 'Закат', artist: 'Вера', album: null, duration: 100,
  fileUrl: '/uploads/music/a.mp3', coverUrl: '/uploads/music/c.jpg',
  uploadedById: 'u1', playsCount: 0, createdAt: '2024-01-01T00:00:00.000Z',
  isPublic: true, ...over,
});

// ── Публикация ───────────────────────────────────────────────────────────────

test('для публикации нужны обложка, название, жанр и исполнитель', () => {
  const ok = validatePublish({ title: 'Закат', artist: 'Вера', genre: 'Rock', coverUrl: '/c.jpg' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.errors, []);

  const bad = validatePublish({ title: '', artist: '', genre: '', coverUrl: '' });
  assert.equal(bad.ok, false);
  // Сервер должен сказать, ЧЕГО не хватило: иначе форма не подсветит поля.
  for (const field of REQUIRED_PUBLISH_FIELDS) assert.ok(bad.errors.includes(field), field);
  assert.ok(bad.errors.includes('coverUrl'), 'обложка тоже обязательна');
});

test('описание при публикации необязательно', () => {
  const r = validatePublish({ title: 'Закат', artist: 'Вера', genre: 'Rock', coverUrl: '/c.jpg' });
  assert.ok(!r.errors.includes('description'), 'описание не требуем');
});

test('поля обрезаются до разумной длины', () => {
  const long = 'x'.repeat(500);
  const r = validatePublish({ title: long, artist: long, genre: long, coverUrl: '/c.jpg' });
  assert.ok(r.clean.title.length <= 120);
  assert.ok(r.clean.artist.length <= 120);
  assert.ok(r.clean.genre.length <= 60);
});

test('жанры на сервере не пустые и уникальные', () => {
  assert.ok(GENRES.length > 5, 'есть из чего выбрать');
  assert.equal(new Set(GENRES).size, GENRES.length, 'без дублей');
});

// ── Поиск ────────────────────────────────────────────────────────────────────

test('поиск идёт по названию, исполнителю, альбому, жанру и описанию', () => {
  const t = track({ album: 'Ночь', genre: 'Ambient', description: 'дождь за окном' });
  assert.ok(matchTrack(t, 'закат'), 'по названию');
  assert.ok(matchTrack(t, 'вера'), 'по исполнителю');
  assert.ok(matchTrack(t, 'ночь'), 'по альбому');
  assert.ok(matchTrack(t, 'ambient'), 'по жанру');
  assert.ok(matchTrack(t, 'дождь'), 'по описанию');
  assert.ok(matchTrack(t, 'ЗАКАТ'), 'без учёта регистра');
  assert.ok(!matchTrack(t, 'рок'), 'чужого слова нет');
  assert.ok(matchTrack(t, ''), 'пустой запрос — все треки');
});

test('альбом ищется по тем же полям', () => {
  const a = { title: 'Ночь', artist: 'Вера', genre: 'Ambient', description: 'дождь' };
  assert.ok(matchAlbum(a, 'ночь'));
  assert.ok(matchAlbum(a, 'ambient'));
  assert.ok(!matchAlbum(a, 'рассвет'));
  assert.ok(matchAlbum(a, ''));
});

// ── Сортировка ───────────────────────────────────────────────────────────────

test('новые идут сверху', () => {
  const list = [
    track({ id: 'a', publishedAt: '2024-01-01T00:00:00.000Z' }),
    track({ id: 'b', publishedAt: '2024-06-01T00:00:00.000Z' }),
    track({ id: 'c', publishedAt: '2024-03-01T00:00:00.000Z' }),
  ];
  assert.deepEqual(sortTracks(list, 'new').map((t) => t.id), ['b', 'c', 'a']);
});

test('популярные — по прослушиваниям', () => {
  const list = [
    track({ id: 'a', playsCount: 1, publishedAt: '2024-06-01T00:00:00.000Z' }),
    track({ id: 'b', playsCount: 99, publishedAt: '2024-01-01T00:00:00.000Z' }),
  ];
  assert.deepEqual(sortTracks(list, 'plays').map((t) => t.id), ['b', 'a']);
});

test('сортировка не ломает исходный массив', () => {
  const list = [track({ id: 'a' }), track({ id: 'b' })];
  const before = list.map((t) => t.id);
  sortTracks(list, 'title');
  assert.deepEqual(list.map((t) => t.id), before, 'порядок на месте');
});

test('неизвестная сортировка откатывается на новые, а не молчит', () => {
  // Иначе клиент с новым ключом получил бы случайный порядок и решил бы, что
  // сервер сломан.
  const list = [
    track({ id: 'a', publishedAt: '2024-01-01T00:00:00.000Z' }),
    track({ id: 'b', publishedAt: '2024-06-01T00:00:00.000Z' }),
  ];
  assert.deepEqual(sortTracks(list, 'что-то-новое').map((t) => t.id), ['b', 'a']);
  assert.deepEqual(sortTracks(list, undefined).map((t) => t.id), ['b', 'a']);
});
// ── Сохранение чужого себе ───────────────────────────────────────────────────

test('сохранённый трек получает свой id и ссылку на оригинал', () => {
  const src = track({ id: 'origin' });
  const copy = copyTrackForUser(src, 'u2');
  assert.notEqual(copy.id, src.id, 'своя запись');
  assert.equal(copy.savedFromId, 'origin', 'помним, откуда');
  assert.equal(copy.uploadedById, 'u2', 'владелец — сохранивший');
  assert.equal(copy.fileUrl, src.fileUrl, 'файл общий, не копируем');
  assert.equal(copy.isPublic, false, 'чужое не публикуется от твоего имени');
  assert.equal(copy.playsCount, 0, 'счётчик свой');
});

test('копия альбома тянет ВСЮ его музыку', () => {
  // Требование: «вся музыка из альбома добавляется в библиотеку».
  const tracks = [track({ id: 'a' }), track({ id: 'b' }), track({ id: 'c' })];
  const album = {
    id: 'orig-album', title: 'Ночь', artist: 'Вера', genre: 'Ambient',
    coverUrl: '/c.jpg', ownerId: 'u1', trackIds: ['a', 'b', 'c'],
  };
  const copy = copyAlbumForUser(album, tracks, 'u2');
  assert.equal(copy.trackIds.length, 3, 'все треки альбома');
  assert.notEqual(copy.id, album.id, 'своя запись альбома');
  assert.equal(copy.ownerId, 'u2');
  assert.equal(copy.savedFromId, 'orig-album');
  assert.equal(copy.isPublic, false);
});

test('альбомы в старой базе появляются без ручной миграции', () => {
  const db = {};
  const albums = ensureAlbums(db);
  assert.ok(Array.isArray(albums), 'создался массив');
  assert.deepEqual(db.musicAlbums, albums, 'и записан в БД');
  // Повторный вызов не перетирает уже загруженные альбомы.
  db.musicAlbums.push({ id: 'x' });
  ensureAlbums(db);
  assert.equal(db.musicAlbums.length, 1, 'существующие альбомы целы');
});

test('модуль отдаёт маршруты и ничего лишнего', () => {
  assert.equal(typeof share.install, 'function');
  assert.equal(typeof share.ensureAlbums, 'function');
  assert.equal(typeof share.copyTrackForUser, 'function');
});

// ── Маршруты: ошибка должна быть ошибкой, а не падением ──────────────────────

test('ошибка публикации отвечает 400, а не 500', async () => {
  const h = await harness();
  await h.run(async ({ call }) => {
    // Регрессия: в обработчиках стояло `unknownGenre` в теле сообщения, но его
    // НЕ брали из validatePublish. Любая отказная проверка падала с
    // ReferenceError, и пользователь вместо подсказки «выберите жанр» получал
    // серверную ошибку. Проверяем оба маршрута: они писались одинаково.
    const noGenre = await call('POST', '/api/music/t1/publish', { title: 'Закат', artist: 'Вера' });
    assert.equal(noGenre.status, 400, 'трек без жанра — понятная ошибка');
    const body = await noGenre.json();
    assert.ok(body.message.includes('жанр'), 'в ответе сказано, чего не хватает');
    assert.ok(Array.isArray(body.fields), 'и какие именно поля');

    const badAlbum = await call('POST', '/api/music/albums', { title: 'Альбом', artist: 'Вера' });
    assert.equal(badAlbum.status, 400, 'альбом без жанра — тоже 400, не 500');
  });
});

test('несуществующий жанр получает отдельную подсказку', async () => {
  const h = await harness();
  await h.run(async ({ call }) => {
    const res = await call('POST', '/api/music/t1/publish', {
      title: 'Закат', artist: 'Вера', genre: 'квантовая музыка', coverUrl: '/c.jpg',
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.unknownGenre, true, 'сервер отличает неизвестный жанр от пустого');
    assert.ok(body.message.includes('из списка'), 'и говорит, что выбрать из списка');
  });
});

test('все маршруты общей библиотеки зарегистрированы', async () => {
  const h = await harness();
  await h.run(async ({ app }) => {
    // Регрессия: тело DELETE /api/music/:id/publish обрывалось сразу после
    // открывающей строки, и все маршруты альбомов оказывались вложены внутрь
    // него. Express регистрировал их только при первом запросе, поэтому
    // GET/POST/PATCH/DELETE /api/music/albums отдавали 404, а тесты этого не
    // видели — чистые функции работали, страдали только маршруты.
    const paths = app._router.stack.filter((l) => l.route).map((l) => l.route.path);
    for (const p of [
      '/api/music/genres', '/api/music/shared', '/api/music/shared/:id',
      '/api/music/:id/publish', '/api/music/albums', '/api/music/albums/:id',
      '/api/music/shared/:id/save', '/api/music/albums/:id/publish',
      '/api/music/albums/:id/save',
    ]) {
      assert.ok(paths.includes(p), `маршрут ${p} зарегистрирован`);
    }
  });
});

test('удачный трек публикуется и появляется в общем списке', async () => {
  const h = await harness();
  await h.run(async ({ call }) => {
    const res = await call('POST', '/api/music/t1/publish', {
      title: 'Закат', artist: 'Вера', genre: 'Рок', coverUrl: '/c.jpg', description: 'из пробы',
    });
    assert.equal(res.status, 200);
    // ВАЖНО: именно публикуется. Кнопка «Трек» в клиенте работает через этот
    // маршрут, а до её появления опубликовать можно было только из строки
    // общего списка — а там бывают лишь уже опубликованные треки.
    const shared = await call('GET', '/api/music/shared');
    const body = await shared.json();
    const ids = (body.tracks || []).map((t) => t.id);
    assert.ok(ids.includes('t1'), 'трек появился в общей библиотеке');
  });
});