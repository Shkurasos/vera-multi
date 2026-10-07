/**
 * Прото доска: совместный холст с карточками, нитями и фотографиями.
 *
 * Главное отличие от прежней версии: она больше НЕ лежит в IndexedDB одного
 * браузера. Доска — общее состояние группы, поэтому её правда живёт на
 * сервере. Пока она была локальной, пригласить кого-либо было физически
 * нечем: приглашённый открывал свою пустую доску, а разделить «просмотр» и
 * «редактирование» было не поверх чего — нечего разделять.
 *
 * Права хранятся на самой доске (`access`), а не на роли в чате:
 *   owner  — создатель доски. Меняет состав и права.
 *   editor — кладёт, двигает и удаляет карточки и нити.
 *   viewer — только смотрит.
 * Участник чата без выданных прав доску не видит вовсе: молча показывать
 * ему пустую было бы хуже, чем не показать ничего.
 *
 * Фотографии грузятся отдельной точкой и лежат на диске как обычные вложения;
 * в карточке хранится только ссылка.
 */
const express = require('express');

const uuidv4 = () => (require('crypto').randomUUID ? require('crypto').randomUUID() : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

/** Потолок на карточки: иначе один человек зальёт доску и положит её. */
const MAX_ITEMS = 500;
const MAX_THREADS = 1000;
const MAX_TEXT = 4000;
const MAX_CAPTION = 200;
const MAX_AUTHOR = 120;
const MAX_ROTATION = 30;
// Drawing is untrusted input. Keep both dimensions bounded so a valid-looking
// request cannot consume the whole event loop or inflate the JSON database.
const MAX_DRAWING_STROKES = 2000;
const MAX_DRAWING_POINTS = 2000;
const MAX_DRAWING_TOTAL_POINTS = 100000;

/** Виды карточек. Папка — контейнер для остальных, поэтому её видно как карточку. */
const KINDS = new Set(['photo', 'note', 'message', 'folder']);

/** Границы размера доски: совпадают с клиентскими BOARD_MIN/MAX. */
const MIN_W = 1200;
const MIN_H = 900;
const MAX_W = 8000;
const MAX_H = 6000;

function clampText(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function clampNum(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** Коллекция досок в БД (старые базы её не содержат). */
function ensureProtoBoards(db) {
  if (!Array.isArray(db.protoBoards)) db.protoBoards = [];
  return db.protoBoards;
}
/**
 * Привести присланную доску к виду, который безопасно хранить.
 *
 * Сервер не доверяет клиенту ни длине текста, ни координатам, ни ссылкам на
 * фото: без этой чистки в БД попадали бы строки в мегабайты, координаты в
 * отрицательные тысячи и ссылки на файлы, которых на сервере нет.
 */
function sanitizeBoard(input) {
  const items = Array.isArray(input?.items) ? input.items.slice(0, MAX_ITEMS) : [];
  const seen = new Set();
  const clean = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const id = clampText(raw.id, 64);
    // Дубликаты id ломали бы отрисовку: нить повисла бы сразу на двух
    // карточках, и React пожаловался бы на одинаковые ключи.
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const kind = KINDS.has(raw.kind) ? raw.kind : 'note';
    const item = {
      id,
      kind,
      x: clampNum(raw.x, 0, -100000, 100000),
      y: clampNum(raw.y, 0, -100000, 100000),
      w: clampNum(raw.w, 240, 40, 4000),
      h: clampNum(raw.h, 170, 40, 4000),
      rotation: clampNum(raw.rotation, 0, -MAX_ROTATION, MAX_ROTATION),
      z: clampNum(raw.z, 1, 0, 1000000),
      createdAt: clampNum(raw.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    };
    // Папку храним отдельно от карточек: ссылка folderId допустима только
    // для элемента, который сам не папка.
    const folderId = clampText(raw.folderId, 64);
    if (folderId) item.folderId = folderId;
    if (kind === 'photo') {
      // Ссылка на фото — только из своей папки загрузок. Иначе в карточку
      // можно было бы подставить любой URL и заставить приложение грузить
      // что угодно от чужого домена.
      const url = clampText(raw.photoUrl, 512);
      if (!/^\/uploads\/proto\/[A-Za-z0-9._-]+$/.test(url)) continue;
      item.photoUrl = url;
      item.caption = clampText(raw.caption, MAX_CAPTION);
    } else if (kind === 'message') {
      item.text = clampText(raw.text, MAX_TEXT);
      item.author = clampText(raw.author, MAX_AUTHOR);
    } else {
      // У папки text — это её название, у заметки — содержимое.
      item.text = clampText(raw.text, MAX_TEXT);
    }
    clean.push(item);
  }

  // Ссылка на папку принимается только если папка есть на этой же доске.
  //
  // Порядок важен: папка может лежать в items позже карточки, поэтому сначала
  // собираем все, и только потом проставляем folderId. Иначе карточка, которая
  // стоит в списке раньше своей папки, молча потеряла бы ссылку — и папка
  // оказалась бы пустой при полном наборе карточек внутри.
  const folderIds = new Set(clean.filter((i) => i.kind === 'folder').map((i) => i.id));
  for (const item of clean) {
    if (item.folderId === undefined) continue;
    const fid = clampText(item.folderId, 64);
    // Папка не может лежать в себе — это цикл, из которого не выйти.
    if (fid && fid !== item.id && folderIds.has(fid)) item.folderId = fid;
    else delete item.folderId;
  }

  const threads = Array.isArray(input?.threads) ? input.threads.slice(0, MAX_THREADS) : [];
  const cleanThreads = [];
  const tseen = new Set();
  for (const t of threads) {
    if (!t || typeof t !== 'object') continue;
    const id = clampText(t.id, 64);
    const from = clampText(t.from, 64);
    const to = clampText(t.to, 64);
    if (!id || !from || !to || from === to || tseen.has(id)) continue;
    // Нить на несуществующую карточку рисуется в пустоту.
    if (!seen.has(from) || !seen.has(to)) continue;
    tseen.add(id);
    const color = clampText(t.color, 32);
    cleanThreads.push({ id, from, to, color: /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : '#c0392b' });
  }

  return {
    items: clean,
    threads: cleanThreads,
    // Размер доски едет вместе с ней. Без него сервер отдавал бы доску без
    // размеров, и клиент молча возвращался к размеру по умолчанию — кнопки «+»
    // и «−» на вид действовали бы, но после перезагрузки всё откатывалось.
    width: clampNum(input?.width, 2600, MIN_W, MAX_W),
    height: clampNum(input?.height, 1800, MIN_H, MAX_H),
    drawing: Array.isArray(input?.drawing)
      ? (() => {
        let totalPoints = 0;
        return input.drawing.slice(0, MAX_DRAWING_STROKES).map((s) => {
        if (!s || typeof s !== 'object' || !Array.isArray(s.points) || s.points.length === 0 || s.points.length > MAX_DRAWING_POINTS) return null;
        if (totalPoints + s.points.length > MAX_DRAWING_TOTAL_POINTS) return null;
        totalPoints += s.points.length;
        const tools = new Set(['brush', 'marker', 'pencil', 'line', 'rectangle', 'circle']);
        const points = s.points.map((p) => ({
          x: clampNum(p?.x, 0, 0, MAX_W),
          y: clampNum(p?.y, 0, 0, MAX_H),
        }));
        const color = clampText(s.color, 32);
        if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) return null;
        return {
          points,
          color,
          width: clampNum(s.width, 5, 1, 100),
          erase: s.erase === true,
          tool: tools.has(s.tool) ? s.tool : 'brush',
        };
        }).filter(Boolean);
      })()
      : [],
  };
}
/** Уровень пользователя на доске или null, если доска ему не открыта. */
function levelOf(board, userId) {
  if (!board || !userId) return null;
  // Владельца проверяем ПЕРВЫМ, до списка access. Обратный порядок был ловушкой:
  // стоило владельцу оказаться в access (старая база, правка руками, восстановление
  // из бэкапа) — и levelOf возвращал ему 'viewer'. А состав меняет только владелец,
  // поэтому вернуть право было уже нечем: доска залипала без управления навсегда.
  if (board.ownerId && board.ownerId === userId) return 'owner';
  const entry = (board.access || []).find((a) => a.userId === userId);
  if (entry) return entry.level === 'editor' ? 'editor' : 'viewer';
  return null;
}

/** Право менять доску. */
function canEdit(board, userId) {
  const level = levelOf(board, userId);
  return level === 'editor' || level === 'owner';
}

/** Право управлять составом: только владелец. */
function canManage(board, userId) {
  return levelOf(board, userId) === 'owner';
}

/** Публичный вид пользователя — чтобы клиенту не тянуть /api/users. */
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

function install({ app, getDb, saveDb, auth, uploadPhoto, guardContent, notify, prunePhotos }) {
  const persist = () => { try { saveDb(); } catch {} };
  const boards = () => ensureProtoBoards(getDb());
  const boardFor = (chatId) => boards().find((b) => b.chatId === chatId);

  /**
   * Доска по чату: создаём лениво.
   *
   * При первом обращении, а не при создании чата: чатов с названием на «Proto»
   * может быть много, а открывать из них будут единицы, и пустые записи в БД
   * только мешали бы.
   */
  const openBoard = (chatId, userId) => {
    const existing = boardFor(chatId);
    if (existing) return existing;
    const chat = (getDb().chats || []).find((c) => c.id === chatId);
    if (!chat) return null;
    const members = (getDb().chatMembers || []).filter((m) => m.chatId === chatId);
    const board = {
      id: uuidv4(),
      chatId,
      name: chat.name || 'Доска',
      // Владелец доски — тот, кто её открыл, а не хозяин чата.
      //
      // Раньше здесь стояло `chat.ownerId || userId`, и это была ловушка: у чата
      // есть хозяин (тот, кто его создал), но доску открывает тот, кто первым
      // в неё зашёл. Если открыл не хозяин, `chat.ownerId` побеждал, и человек,
      // который только что создал доску, получал myLevel = null — то есть
      // «зритель» без единого права, и составом доски управлять было уже некому.
      //
      // Права выдаёт владелец доски, поэтому он и должен быть тем, кто её
      // открыл. Хозяин чата, если он не открывал доску, получит права через
      // список участников — как любой другой.
      ownerId: userId,
      items: [],
      threads: [],
      // Размер сразу задан явно: старые доски его не содержат, и без
      // подстановки холст первого открытия был бы 0×0 — не рисуется вовсе.
      width: 2600,
      height: 1800,
      // Участники чата, открывшие доску, должны её видеть сразу: иначе
      // приглашённый в группу увидел бы «Вам не открыта эта доска».
      access: members
        .filter((m) => m.role === 'owner' || m.role === 'admin')
        .filter((m) => m.userId !== userId)
        .map((m) => ({ userId: m.userId, level: 'editor', joinedAt: new Date().toISOString() })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    boards().push(board);
    persist();
    return board;
  };

  /** Состав доски без владельца: он и так всегда админ, в списке он лишний. */
  const memberList = (board) => (board.access || [])
    .filter((a) => a.userId !== board.ownerId)
    .map((a) => ({ ...a, user: publicUser(getDb(), a.userId) }));

  /** Общий вид доски для клиента: содержимое плюс мои права на него. */
  const view = (board, userId) => ({
    ...board,
    // Подстановка на выходе, а не только в openBoard: доски, созданные до
    // появления размеров, лежат в БД без них.
    width: clampNum(board.width, 2600, MIN_W, MAX_W),
    height: clampNum(board.height, 1800, MIN_H, MAX_H),
    myLevel: levelOf(board, userId),
    canEdit: canEdit(board, userId),
    canManage: canManage(board, userId),
    members: memberList(board),
  });
// GET /api/proto-boards/:chatId — доска чата и мои права на ней.
  app.get('/api/proto-boards/:chatId', auth, (req, res) => {
    const board = boardFor(req.params.chatId);
    if (!board) {
      // Не ошибка: доски у чата может просто ещё не быть. Отдаём пустую с
      // правами по чату, чтобы клиент не показывал ошибку на пустом чате.
      const opened = openBoard(req.params.chatId, req.userId);
      if (!opened) return res.status(404).json({ message: 'Чат не найден' });
      return res.json({ ...view(opened, req.userId), drawing: opened.drawing || [] });
    }
    // Читать доску может только тот, кому права выдали, либо владелец.
    // Проверка ДО отдачи содержимого: иначе любой, кто угадает chatId,
    // получил бы все карточки и фото чужой доски.
    if (!levelOf(board, req.userId)) {
      return res.status(403).json({ message: 'Вам не открыта эта доска' });
    }
    res.json({ ...view(board, req.userId), drawing: board.drawing || [] });
  });

  // PUT /api/proto-boards/:chatId — сохранить карточки и нити.
  app.put('/api/proto-boards/:chatId', auth, express.json({ limit: '4mb' }), (req, res) => {
    const board = boardFor(req.params.chatId) || openBoard(req.params.chatId, req.userId);
    if (!board) return res.status(404).json({ message: 'Чат не найден' });
    if (!canEdit(board, req.userId)) {
      return res.status(403).json({ message: 'Вам выдан только просмотр' });
    }
    // Фото карточки, которое исчезло с доски, больше не нужно: иначе папка
    // uploads росла бы вечно. Чистим только свою папку — иначе через
    // подставленную ссылку можно было бы удалить чужой файл.
    const before = new Set((board.items || []).map((i) => i.photoUrl).filter(Boolean));
    const clean = sanitizeBoard(req.body);
    board.items = clean.items;
    board.threads = clean.threads;
    // Размер сохраняем тут же, иначе он жил бы только в памяти вкладки:
    // после перезагрузки доска вернулась бы к размеру по умолчанию.
    board.width = clean.width;
    board.height = clean.height;
    board.drawing = clean.drawing;
    board.updatedAt = new Date().toISOString();
    const after = new Set(clean.items.map((i) => i.photoUrl).filter(Boolean));
    persist();
    if (prunePhotos) {
      try { prunePhotos([...before].filter((u) => !after.has(u))); } catch { /* чистка не критична */ }
    }
    // Остальным участникам доска должна обновиться сразу, без перезагрузки.
    try { notify('proto-board:updated', { chatId: board.chatId }); } catch { /* сокет не поднят */ }
    res.json({ ...view(board, req.userId), drawing: board.drawing || [] });
  });
// GET /api/proto-boards/:chatId/access — кто и с какими правами.
  app.get('/api/proto-boards/:chatId/access', auth, (req, res) => {
    const board = boardFor(req.params.chatId);
    if (!board) return res.status(404).json({ message: 'Доска не найдена' });
    if (!canManage(board, req.userId)) {
      return res.status(403).json({ message: 'Состав доски меняет только владелец' });
    }
    res.json({
      owner: { userId: board.ownerId, level: 'owner', user: publicUser(getDb(), board.ownerId) },
      members: memberList(board),
    });
  });

  // POST /api/proto-boards/:chatId/access — выдать права (или пригласить).
  app.post('/api/proto-boards/:chatId/access', auth, express.json(), (req, res) => {
    const board = boardFor(req.params.chatId) || openBoard(req.params.chatId, req.userId);
    if (!board) return res.status(404).json({ message: 'Чат не найден' });
    if (!canManage(board, req.userId)) {
      return res.status(403).json({ message: 'Состав доски меняет только владелец' });
    }
    const { userId, level } = req.body || {};
    if (!userId) return res.status(400).json({ message: 'Укажите пользователя' });
    if (userId === board.ownerId) {
      return res.status(400).json({ message: 'У владельца уже полные права' });
    }
    // Строго два уровня: 'owner' выдавать нельзя, иначе можно было бы
    // размножить владельцев и заблокировать себе смену состава.
    if (level !== 'viewer' && level !== 'editor') {
      return res.status(400).json({ message: 'Право должно быть viewer или editor' });
    }
    const user = (getDb().users || []).find((u) => u.id === userId);
    if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
    if (!Array.isArray(board.access)) board.access = [];
    const existing = board.access.find((a) => a.userId === userId);
    if (existing) {
      // Повторный вызов меняет уровень, а не плодит дубликаты: иначе в
      // списке доступа появился бы один человек дважды.
      existing.level = level;
    } else {
      board.access.push({ userId, level, joinedAt: new Date().toISOString() });
    }
    board.updatedAt = new Date().toISOString();
    persist();
    try { notify('proto-board:access', { chatId: board.chatId }); } catch { /* сокет не поднят */ }
    res.status(201).json({ userId, level, user: publicUser(getDb(), userId) });
  });

  // PATCH /api/proto-boards/:chatId/access/:userId — сменить уровень.
  app.patch('/api/proto-boards/:chatId/access/:userId', auth, express.json(), (req, res) => {
    const board = boardFor(req.params.chatId);
    if (!board) return res.status(404).json({ message: 'Доска не найдена' });
    if (!canManage(board, req.userId)) {
      return res.status(403).json({ message: 'Состав доски меняет только владелец' });
    }
    const { level } = req.body || {};
    if (level !== 'viewer' && level !== 'editor') {
      return res.status(400).json({ message: 'Право должно быть viewer или editor' });
    }
    const entry = (board.access || []).find((a) => a.userId === req.params.userId);
    if (!entry) return res.status(404).json({ message: 'У этого человека нет доступа к доске' });
    entry.level = level;
    board.updatedAt = new Date().toISOString();
    persist();
    res.json({ userId: entry.userId, level: entry.level });
  });

  // DELETE /api/proto-boards/:chatId/access/:userId — отобрать доступ.
  app.delete('/api/proto-boards/:chatId/access/:userId', auth, (req, res) => {
    const board = boardFor(req.params.chatId);
    if (!board) return res.status(404).json({ message: 'Доска не найдена' });
    if (!canManage(board, req.userId)) {
      return res.status(403).json({ message: 'Состав доски меняет только владелец' });
    }
    const before = board.access.length;
    board.access = (board.access || []).filter((a) => a.userId !== req.params.userId);
    if (board.access.length === before) {
      return res.status(404).json({ message: 'У этого человека нет доступа к доске' });
    }
    board.updatedAt = new Date().toISOString();
    persist();
    try { notify('proto-board:access', { chatId: board.chatId }); } catch { /* сокет не поднят */ }
    res.json({ ok: true });
  });

  // POST /api/proto-boards/photo — загрузить фото для карточки.
  //
  // Право проверяется по chatId из тела: иначе любой участник группы грузил бы
  // файлы, не имея права класть карточки.
  if (uploadPhoto) {
    app.post('/api/proto-boards/photo', auth, uploadPhoto.single('photo'), (req, res) => {
      if (!req.file) return res.status(400).json({ message: 'Фото не загружено' });
      const chatId = clampText(req.body?.chatId, 64);
      const board = chatId ? boardFor(chatId) || openBoard(chatId, req.userId) : null;
      if (!board) return res.status(404).json({ message: 'Чат не найден' });
      if (!canEdit(board, req.userId)) {
        return res.status(403).json({ message: 'Вам выдан только просмотр' });
      }
      if (guardContent && guardContent(req, res)) return;
      res.status(201).json({ photoUrl: `/uploads/proto/${req.file.filename}` });
    });
  }
}

module.exports = {
  install,
  ensureProtoBoards,
  sanitizeBoard,
  levelOf,
  canEdit,
  canManage,
  MAX_ITEMS,
  MAX_THREADS,
  MAX_TEXT,
};