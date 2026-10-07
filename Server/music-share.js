/**
 * Общая библиотека музыки: публикация треков и альбомов, которые видят все.
 *
 * Отличие от `/api/music` (личная библиотека): там треки «мои», здесь — общие.
 * Автор выкладывает трек или альбом на вид всем и обязательно заполняет обложку,
 * название, жанр и исполнителя (описание необязательно) — иначе в общем списке
 * была бы безликая каша из «Без названия».
 *
 * Чужое можно «сохранить себе»: сервер создаёт у Saving пользователя СВОЮ запись
 * трека, ссылающуюся на тот же файл. Файл не копируется и не удаляется вместе с
 * копией — иначе сохранённый трек погиб бы, когда автор удалит свой.
 *
 * Альбом — это группа треков: при сохранении альбома вся его музыка (все треки)
 * попадает в библиотеку сохранившего.
 *
 * Правила и сортировка вынесены в чистые функции и покрыты тестами: иначе
 * «новые» и «популярные» незаметно путаются местами.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');

const uuidv4 = () => (require('crypto').randomUUID ? require('crypto').randomUUID() : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

const MAX_TITLE = 120;
const MAX_ARTIST = 120;
const MAX_GENRE = 60;
const MAX_DESCRIPTION = 2000;
/** Больше 200 треков в альбоме — это уже сборник, а не альбом. */
const MAX_ALBUM_TRACKS = 200;
/** Сколько общих треков отдаём за раз. */
const SHARED_PAGE_SIZE = 200;

/** Список жанров берём из music-genres: правило одно на сервер и клиент. */
const { GENRES, GROUPS, normalizeGenre, normalizeKey, canonicalOrKeep } = require('./music-genres');

/** Поле обязательное при публикации. */
const REQUIRED_PUBLISH_FIELDS = ['title', 'artist', 'genre'];

function clampText(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

/** Коллекция альбомов в БД (старые базы её не содержат). */
function ensureAlbums(db) {
  if (!Array.isArray(db.musicAlbums)) db.musicAlbums = [];
  return db.musicAlbums;
}

/**
 * Публикация: обложка, название, жанр и исполнитель обязательны.
 *
 * Обложку проверяем отдельно от остальных полей — она приходит файлом, и без
 * неё запись в общем списке выглядела бы серым прямоугольником.
 *
 * Жанр приводим к канону и ОТКАЗЫВАЕМ, если такого жанра нет. Молча согласиться
 * было бы хуже отказа: человек написал «квантовая музыка», увидел «Опубликовано»
 * и обнаружил бы, что его трек лежит в общем списке под чужим жанром, который
 * никто не сможет найти фильтром.
 */
function validatePublish({ title, artist, genre, coverUrl }) {
  const errors = [];
  const canonicalGenre = normalizeGenre(genre);
  const clean = {
    title: clampText(title, MAX_TITLE),
    artist: clampText(artist, MAX_ARTIST),
    // В БД хранится уже канон: «рок» и «Rock» обязаны стать одним значением,
    // иначе фильтр по жанру разъедется на первых же пяти публикациях.
    genre: canonicalGenre || '',
  };
  for (const field of REQUIRED_PUBLISH_FIELDS) {
    if (!clean[field]) errors.push(field);
  }
  if (!coverUrl) errors.push('coverUrl');
  return { clean, errors, ok: errors.length === 0, unknownGenre: !!clampText(genre, MAX_GENRE) && !canonicalGenre };
}

/** Пользователь, которому принадлежит запись (для карточек в общем списке). */
function publicUser(db, userId) {
  const u = (db.users || []).find((x) => x.id === userId);
  if (!u) return null;
  return {
    id: u.id,
    username: u.username || null,
    firstName: u.firstName || null,
    lastName: u.lastName || null,
    avatarUrl: u.avatarUrl || null,
  };
}

/**
 * Поиск по общим трекам: название, исполнитель, альбом, жанр, описание.
 *
 * Ищем без учёта регистра и по нескольким полям сразу: иначе «рок» не находил бы
 * ни трек с жанром Rock, ни альбом с названием «Рок-вечер».
 *
 * Жанр сравниваем через normalizeKey, а не через `includes`: привести запрос к
 * канону нельзя (пользователь ищет «рока», а канон — «Рок»), а вот сравнить
 * два значения по правилам того же модуля — можно. Тогда «рок» найдёт «Рок» и
 * «rock» одной строкой, а «рок-н-ролл» — тот же «Рок».
 */
function matchTrack(track, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  if ([track.title, track.artist, track.album, track.description]
    .filter(Boolean)
    .some((field) => String(field).toLowerCase().includes(needle))) return true;
  return matchGenre(track.genre, q);
}

/**
 * Совпадение по жанру с учётом синонимов, падежей и оформления.
 *
 * Порядок проверок важен:
 *   1. Подстрока в самом жанре — для «рок-н-ролл» и «хип-хоп».
 *   2. Запрос приводим к канону и сравниваем на равно — так «рока», «rock» и
 *      «попса» находят «Рок» и «Поп». Только префиксом это не работает:
 *      «рока» длиннее канона, и «рок».startsWith('рока') ложно.
 *   3. Префикс — для обрезанного запроса: «хип» находит «Хип-хоп».
 */
function matchGenre(genre, q) {
  if (!genre) return false;
  const stored = normalizeKey(normalizeGenre(genre) || genre);
  if (!stored) return false;
  if (String(genre).toLowerCase().includes(q.toLowerCase())) return true;
  const wanted = normalizeKey(q);
  if (!wanted) return false;
  if (normalizeKey(normalizeGenre(q) || '') === stored) return true;
  return stored.startsWith(wanted);
}

const SORTERS = {
  /** Новые сверху. */
  new: (a, b) => String(b.publishedAt || b.createdAt || '').localeCompare(String(a.publishedAt || a.createdAt || '')),
  /** Популярные: больше прослушиваний. */
  plays: (a, b) => (b.playsCount || 0) - (a.playsCount || 0),
  title: (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ru'),
  artist: (a, b) => String(a.artist || '').localeCompare(String(b.artist || ''), 'ru'),
  genre: (a, b) => String(a.genre || '').localeCompare(String(b.genre || ''), 'ru'),
};

/**
 * Отбор + сортировка общих треков.
 *
 * Неизвестный ключ сортировки откатываем на «новые», а не оставляем как есть:
 * иначе клиент с новым ключом получил бы список в случайном порядке и решил бы,
 * что сервер сломан.
 */
function sortTracks(tracks, sort) {
  const by = SORTERS[sort] || SORTERS.new;
  return [...tracks].sort(by);
}

/**
 * Копия чужого трека в библиотеку сохранившего.
 *
 * Новый id и `savedFromId`: файл общий, но запись моя — её можно удалить, не
 * тронув оригинал. `isPublic` намеренно false: сохранил чужое — оно не должно
 * само уйти в общий список от твоего имени.
 */
function copyTrackForUser(src, userId) {
  return {
    id: uuidv4(),
    title: src.title,
    artist: src.artist || null,
    album: src.album || null,
    description: src.description || null,
    genre: src.genre || null,
    duration: src.duration || 0,
    fileUrl: src.fileUrl,
    coverUrl: src.coverUrl || null,
    uploadedById: userId,
    playsCount: 0,
    createdAt: new Date().toISOString(),
    isPublic: false,
    albumId: null,
    savedFromId: src.id,
    sourceOwnerId: src.uploadedById || null,
  };
}
/**
 * Поиск по альбому: название, исполнитель, жанр, описание.
 *
 * На уровне модуля, а не внутри install: правило нужно тестам и не зависит от
 * ни приложения, ни БД.
 */
function matchAlbum(album, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  if ([album.title, album.artist, album.description]
    .filter(Boolean)
    .some((field) => String(field).toLowerCase().includes(needle))) return true;
  return matchGenre(album.genre, q);
}

/** Копия чужого альбома целиком в библиотеку сохранившего. */
function copyAlbumForUser(album, tracks, userId) {
  return {
    id: uuidv4(),
    title: album.title,
    artist: album.artist || null,
    genre: album.genre || null,
    description: album.description || null,
    coverUrl: album.coverUrl || null,
    ownerId: userId,
    isPublic: false,
    // Сохраняем копии треков: albumId каждой указывает на НОВЫЙ альбом, иначе
    // удаление своей копии вычеркнуло бы треки из альбома автора.
    trackIds: tracks.map((t) => copyTrackForUser(t, userId).id),
    savedFromId: album.id,
    sourceOwnerId: album.ownerId || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Подключает маршруты общей библиотеки.
 *
 * @param app      express-приложение
 * @param getDb    () => db
 * @param saveDb   () => void
 * @param auth     authMiddleware (кладёт req.userId)
 * @param guardContent  dropIfActiveContent(req,res) → true, если запрос отброшен
 * @param notify   (event, payload) => void — рассылка онлайн-клиентам
 */
/**
 * Каталог жанров для клиента: плоский список и группы.
 *
 * Группы нужны из-за количества: 69 жанров одним списком не найти. Плоский
 * список тоже отдаём — им пользуются проверки в клиенте и старые версии.
 */
function genresPayload() {
  return { genres: GENRES, genreGroups: GROUPS };
}

function install({ app, getDb, saveDb, auth, guardContent, notify }) {
  const db = () => getDb();
  const persist = typeof saveDb === 'function' ? saveDb : () => {};
  const broadcast = typeof notify === 'function' ? notify : () => {};
  const unsafe = typeof guardContent === 'function' ? guardContent : () => false;
  const allTracks = () => (Array.isArray(db().tracks) ? db().tracks : []);
  const trackById = (id) => allTracks().find((t) => t.id === id);

  /**
 * Трек с данными автора — так клиенту не нужно подтягивать пользователей.
   *
   * Жанр приводим к канону на ОТДАЧЕ, а не только при записи: старые треки
   * публиковались со свободным текстом («Rock», «рок»), и без этого они
   * остались бы отдельными жанрами рядом с каноническим «Рок».
   */
  const withOwner = (t) => ({ ...t, genre: t.genre ? canonicalOrKeep(t.genre) : null, uploadedBy: publicUser(db(), t.uploadedById) });

  // GET /api/music/genres — подсказки жанров для формы публикации.
  app.get('/api/music/genres', auth, (_req, res) => res.json(genresPayload()));

  // GET /api/music/shared?sort=&q=&limit= — общий список треков.
  app.get('/api/music/shared', auth, (req, res) => {
    const q = clampText(req.query.q, MAX_TITLE);
    const limit = Math.min(Number(req.query.limit) || SHARED_PAGE_SIZE, SHARED_PAGE_SIZE);
    const shared = allTracks().filter((t) => t.isPublic && matchTrack(t, q));
    const sorted = sortTracks(shared, String(req.query.sort || 'new'));
    res.json({ tracks: sorted.slice(0, limit).map(withOwner), total: sorted.length, ...genresPayload() });
  });

  // GET /api/music/shared/:id — один общий трек.
  app.get('/api/music/shared/:id', auth, (req, res) => {
    const t = trackById(req.params.id);
    if (!t || !t.isPublic) return res.status(404).json({ message: 'Трек не найден в общей библиотеке' });
    res.json(withOwner(t));
  });

  /**
   * POST /api/music/:id/publish — выложить свой трек всем.
   *
   * Обложку берём из тела (coverUrl): она загружается отдельно, через
   * POST /api/music/cover. Это осознанно — иначе пришлось бы перезаливать
   * аудио при каждой правке описания.
   */
  app.post('/api/music/:id/publish', auth, express.json(), (req, res) => {
    const track = trackById(req.params.id);
    if (!track) return res.status(404).json({ message: 'Трек не найден' });
    if (track.uploadedById !== req.userId) return res.status(403).json({ message: 'Это не ваш трек' });

    const coverUrl = track.coverUrl || clampText(req.body?.coverUrl, 512) || null;
    const { clean, errors, ok, unknownGenre } = validatePublish({
      title: req.body?.title ?? track.title,
      artist: req.body?.artist ?? track.artist,
      genre: req.body?.genre,
      coverUrl,
    });
    if (!ok) {
      const message = unknownGenre
        ? 'Такого жанра нет — выберите из списка'
        : 'Для публикации нужны обложка, название, жанр и исполнитель';
      return res.status(400).json({ message, fields: errors, unknownGenre });
    }

    Object.assign(track, clean, {
      description: clampText(req.body?.description, MAX_DESCRIPTION) || track.description || null,
      coverUrl,
      isPublic: true,
      publishedAt: track.publishedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    persist();
    // Рассылаем: общая библиотека должна появиться у всех без перезагрузки.
    try { broadcast('music:shared-updated', { trackId: track.id }); } catch { /* сокет не поднят */ }
    res.json(withOwner(track));
  });

  // DELETE /api/music/:id/publish — снять с публикации.
  //
  // Тело обработчика раньше заканчивалось сразу после открывающей строки, и все
  // маршруты альбомов оказались вложены в него: express регистрировал только
  // DELETE /api/music/:id/publish, а GET/POST/PATCH/DELETE /api/music/albums
  // не существовали вовсе — список и создание альбома отдавали 404.
  app.delete('/api/music/:id/publish', auth, (req, res) => {
    const track = trackById(req.params.id);
    if (!track) return res.status(404).json({ message: 'Трек не найден' });
    if (track.uploadedById !== req.userId) return res.status(403).json({ message: 'Это не ваш трек' });
    track.isPublic = false;
    track.publishedAt = null;
    persist();
    try { broadcast('music:shared-updated', { trackId: track.id }); } catch { /* сокет не поднят */ }
    res.json({ ok: true });
  });
// ── Альбомы ────────────────────────────────────────────────────────────────
  //
  // Альбом — группа треков с общей обложкой и метаданными. Треки ссылаются на
  // обычные треки пользователя по albumId; при сохранении чужого альбома делаются
  // копии, чтобы не тянуть чужие записи в свою библиотеку.

  const albums = () => ensureAlbums(db());
  const albumById = (id) => albums().find((a) => a.id === id);

  /** Альбом с треками и данными владельца. Жанр — тоже в каноне (см. withOwner). */
  const albumWithTracks = (a) => ({
    ...a,
    genre: a.genre ? canonicalOrKeep(a.genre) : null,
    owner: publicUser(db(), a.ownerId),
    tracks: (a.trackIds || []).map((id) => trackById(id)).filter(Boolean).map(withOwner),
    trackCount: (a.trackIds || []).length,
  });


  // GET /api/music/albums?scope=mine|shared&sort=&q=
  app.get('/api/music/albums', auth, (req, res) => {
    const mine = String(req.query.scope || 'shared') === 'mine';
    const q = clampText(req.query.q, MAX_TITLE);
    const list = albums()
      .filter((a) => (mine ? a.ownerId === req.userId : a.isPublic))
      .filter((a) => matchAlbum(a, q));
    const sort = String(req.query.sort || 'new');
    const sorted = [...list].sort((x, y) => {
      if (sort === 'title') return String(x.title || '').localeCompare(String(y.title || ''), 'ru');
      if (sort === 'artist') return String(x.artist || '').localeCompare(String(y.artist || ''), 'ru');
      return String(y.createdAt || '').localeCompare(String(x.createdAt || ''));
    });
    res.json({ albums: sorted.map(albumWithTracks), total: sorted.length, ...genresPayload() });
  });

  // POST /api/music/albums — создать альбом из своих треков.
  app.post('/api/music/albums', auth, express.json(), (req, res) => {
    const { clean, errors, ok, unknownGenre } = validatePublish({
      title: req.body?.title,
      artist: req.body?.artist,
      genre: req.body?.genre,
      coverUrl: req.body?.coverUrl,
    });
    if (!ok) {
      return res.status(400).json({
        message: unknownGenre ? 'Такого жанра нет — выберите из списка' : 'Для альбома нужны обложка, название, жанр и исполнитель',
        fields: errors,
        unknownGenre,
      });
    }
    // Треки — только свои: чужой трек в свой альбом не положишь.
    const own = (req.body?.trackIds || []).map(trackById).filter((t) => t && t.uploadedById === req.userId);
    if (own.length > MAX_ALBUM_TRACKS) {
      return res.status(413).json({ message: `В альбом помещается не больше ${MAX_ALBUM_TRACKS} треков` });
    }
    const album = {
      id: uuidv4(),
      ...clean,
      description: clampText(req.body?.description, MAX_DESCRIPTION) || null,
      coverUrl: clampText(req.body?.coverUrl, 512) || null,
      ownerId: req.userId,
      isPublic: false,
      trackIds: own.map((t) => t.id),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    albums().push(album);
    // Связь на самих треках: «все треки альбома» собираются без сквозного
    // поиска по albumId.
    own.forEach((t) => { t.albumId = album.id; });
    persist();
    res.status(201).json(albumWithTracks(album));
  });

  // PATCH /api/music/albums/:id — правка своего альбома.
  app.patch('/api/music/albums/:id', auth, express.json(), (req, res) => {
    const album = albumById(req.params.id);
    if (!album) return res.status(404).json({ message: 'Альбом не найден' });
    if (album.ownerId !== req.userId) return res.status(403).json({ message: 'Это не ваш альбом' });
    // Жанр вынесен из общего цикла: его нельзя просто обрезать, а можно только
    // привести к канону. Иначе альбом назвали бы «rock», и в общем списке он
    // оказался бы рядом с «Рок» отдельным жанром.
    if (req.body?.genre !== undefined) {
      const g = normalizeGenre(req.body.genre);
      if (clampText(req.body.genre, MAX_GENRE) && !g) {
        return res.status(400).json({ message: 'Такого жанра нет — выберите из списка', fields: ['genre'], unknownGenre: true });
      }
      album.genre = g || '';
    }
    for (const [field, max] of [['title', MAX_TITLE], ['artist', MAX_ARTIST]]) {
      if (req.body?.[field] !== undefined) album[field] = clampText(req.body[field], max);
    }
    if (req.body?.description !== undefined) album.description = clampText(req.body.description, MAX_DESCRIPTION) || null;
    if (req.body?.coverUrl !== undefined) album.coverUrl = clampText(req.body.coverUrl, 512) || null;
    album.updatedAt = new Date().toISOString();
    persist();
    res.json(albumWithTracks(album));
  });

  // DELETE /api/music/albums/:id — треки остаются в библиотеке, без альбома.
  app.delete('/api/music/albums/:id', auth, (req, res) => {
    const list = albums();
    const idx = list.findIndex((a) => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ message: 'Альбом не найден' });
    if (list[idx].ownerId !== req.userId) return res.status(403).json({ message: 'Это не ваш альбом' });
    const [removed] = list.splice(idx, 1);
    allTracks().forEach((t) => { if (t.albumId === removed.id) t.albumId = null; });
    persist();
    res.json({ ok: true });
  });

  // POST /api/music/shared/:id/save — сохранить чужой трек себе.
  app.post('/api/music/shared/:id/save', auth, (req, res) => {
    const src = trackById(req.params.id);
    if (!src || !src.isPublic) return res.status(404).json({ message: 'Трек не найден в общей библиотеке' });
    // Свой трек сохранять себе незачем: он уже в библиотеке.
    if (src.uploadedById === req.userId) {
      return res.status(400).json({ message: 'Это уже ваш трек' });
    }
    const all = allTracks();
    // Повторное сохранение не плодит дубликаты: ищем по savedFromId.
    const already = all.find((t) => t.savedFromId === src.id && t.uploadedById === req.userId);
    if (already) return res.json(withOwner(already));
    const copy = copyTrackForUser(src, req.userId);
    all.push(copy);
    persist();
    try { broadcast('music:shared-saved', { trackId: copy.id, byId: req.userId }); } catch { /* сокет не поднят */ }
    res.status(201).json(withOwner(copy));
  });

  // POST /api/music/albums/:id/publish — открыть альбом всем.
  app.post('/api/music/albums/:id/publish', auth, express.json(), (req, res) => {
    const album = albumById(req.params.id);
    if (!album) return res.status(404).json({ message: 'Альбом не найден' });
    if (album.ownerId !== req.userId) return res.status(403).json({ message: 'Это не ваш альбом' });
    const { clean, errors, ok, unknownGenre } = validatePublish({ ...album, genre: req.body?.genre ?? album.genre });
    if (!ok) {
      const message = unknownGenre
        ? 'Такого жанра нет — выберите из списка'
        : 'Для публикации альбома нужны обложка, название, жанр и исполнитель';
      return res.status(400).json({ message, fields: errors, unknownGenre });
    }
    Object.assign(album, clean, { isPublic: true, updatedAt: new Date().toISOString() });
    // Треки альбома тоже становятся общими: иначе альбом был бы виден, а
    // послушать его без сохранения — нет.
    (album.trackIds || []).forEach((id) => {
      const t = trackById(id);
      if (!t) return;
      t.isPublic = true;
      t.album = t.album || album.title;
      t.publishedAt = t.publishedAt || new Date().toISOString();
    });
    persist();
    try { broadcast('music:shared-updated', { albumId: album.id }); } catch { /* сокет не поднят */ }
    res.json(albumWithTracks(album));
  });

  // DELETE /api/music/albums/:id/publish — закрыть альбом.
  app.delete('/api/music/albums/:id/publish', auth, (req, res) => {
    const album = albumById(req.params.id);
    if (!album) return res.status(404).json({ message: 'Альбом не найден' });
    if (album.ownerId !== req.userId) return res.status(403).json({ message: 'Это не ваш альбом' });
    album.isPublic = false;
    (album.trackIds || []).forEach((id) => {
      const t = trackById(id);
      // Снимаем только те, что не публиковались отдельно: иначе закрытие
      // альбома убрало бы трек, который автор выложил сам по себе.
      if (t && !t.publishedSeparately) { t.isPublic = false; t.publishedAt = null; }
    });
    persist();
    try { broadcast('music:shared-updated', { albumId: album.id }); } catch { /* сокет не поднят */ }
    res.json({ ok: true });
  });

  /**
   * POST /api/music/albums/:id/save — сохранить чужой альбом себе.
   *
   * Вся музыка альбома копируется в библиотеку сохранившего: треки получают
   * свои id и albumId новой копии, поэтому удаление копии не тронет оригинал.
   */
  app.post('/api/music/albums/:id/save', auth, (req, res) => {
    const src = albumById(req.params.id);
    if (!src || !src.isPublic) return res.status(404).json({ message: 'Альбом не найден в общей библиотеке' });
    if (src.ownerId === req.userId) return res.status(400).json({ message: 'Это уже ваш альбом' });
    const mine = albums().find((a) => a.savedFromId === src.id && a.ownerId === req.userId);
    if (mine) return res.json(albumWithTracks(mine));

    const tracks = (src.trackIds || []).map(trackById).filter(Boolean);
    const copy = copyAlbumForUser(src, tracks, req.userId);
    copy.trackIds = [];
    // Копии треков кладём в БД и только потом подставляем их id в альбом —
    // иначе albumId остался бы битым.
    tracks.forEach((original) => {
      const c = copyTrackForUser(original, req.userId);
      c.albumId = copy.id;
      allTracks().push(c);
      copy.trackIds.push(c.id);
    });
    albums().push(copy);
    persist();
    res.status(201).json(albumWithTracks(copy));
  });
}

module.exports = {
  install,
  ensureAlbums,
  validatePublish,
  matchTrack,
  matchAlbum,
  sortTracks,
  copyTrackForUser,
  copyAlbumForUser,
  publicUser,
  GENRES,
  MAX_ALBUM_TRACKS,
  REQUIRED_PUBLISH_FIELDS,
  SORTERS,
};
