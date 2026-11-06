const crypto = require('node:crypto');
const multer = require('multer');

function isActiveBan(ban) {
  return !!ban && (!ban.expiresAt || Number(ban.expiresAt) > Date.now());
}

function blocked(db, userId, deviceId, installationHash) {
  return (Array.isArray(db.moderationBans) ? db.moderationBans : []).some((ban) => {
    if (!isActiveBan(ban)) return false;
    if (ban.kind === 'account') return !!userId && ban.userId === userId;
    if (ban.kind !== 'device') return false;
    return (deviceId && ban.deviceId === deviceId) ||
      (installationHash && ban.hash === installationHash);
  });
}

// Ограничения, которые не закрывают вход: режим «только чтение» и запрет
// создавать ботов и мини-приложения. Хранятся в moderationBans рядом с банами.
function hasRestriction(db, userId, kind) {
  if (!userId) return false;
  return (Array.isArray(db.moderationBans) ? db.moderationBans : [])
    .some((ban) => isActiveBan(ban) && ban.kind === kind && ban.userId === userId);
}
const readOnly = (db, userId) => hasRestriction(db, userId, 'readonly');
const creationBanned = (db, userId) => hasRestriction(db, userId, 'bots') || readOnly(db, userId);

// В режиме «только чтение» можно читать, отмечать прочитанное, выйти и
// подать апелляцию. Всё остальное, что меняет данные, закрыто.
const READ_ONLY_WRITE_ALLOWED = [
  /^\/api\/appeals$/,
  /^\/api\/auth\/logout$/,
  /^\/api\/messages\/[^/]+\/read$/,
];
function readOnlyAllows(method, path) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(String(method || '').toUpperCase())) return true;
  return READ_ONLY_WRITE_ALLOWED.some((pattern) => pattern.test(String(path || '')));
}
const READ_ONLY_SOCKET_EVENTS = new Set(['message:send', 'typing:start', 'chat:settings_offer', 'call:offer', 'callroom:join']);

// Ссылка на чат из адресной строки (/#/chat/<id>, полный URL) или голый id.
function parseChatLink(raw) {
  const value = String(raw || '').trim();
  if (!value || value.length > 2048) return null;
  const match = value.match(/\/chat\/([^/?#\s]+)/);
  let id = match ? match[1] : value;
  try { id = decodeURIComponent(id); } catch { return null; }
  return /^[\w.:-]{1,128}$/.test(id) ? id : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const BAN_ACTIONS = ['temporary', 'permanent', 'ip', 'device'];
// Решения, после которых аккаунт можно удалить автоматически.
const AUTO_DELETE_ACTIONS = [...BAN_ACTIONS, 'readonly'];

function decisionKind(action) {
  if (BAN_ACTIONS.includes(action)) return 'ban';
  if (action === 'warn') return 'warning';
  if (action === 'delete') return 'bot';
  return 'restriction';
}

function decisionLabel(action, appShortName) {
  if (action === 'delete') return appShortName ? `Удаление мини-приложения ${appShortName}` : 'Удаление бота';
  return {
    warn: 'Предупреждение',
    temporary: 'Временная блокировка',
    permanent: 'Блокировка аккаунта',
    ip: 'Блокировка по IP',
    device: 'Блокировка устройств',
    readonly: 'Режим только чтения',
    nobots: 'Запрет на создание ботов и приложений',
  }[action] || action;
}

function autoDeleteAt(decision) {
  const setting = decision?.autoDelete;
  if (!setting?.enabled) return null;
  const at = Date.parse(decision.at);
  return Number.isFinite(at) ? at + setting.days * DAY_MS : null;
}

// Удаление аккаунта: запись остаётся (на неё ссылаются сообщения), но личные
// данные стираются, пароль и сессии гаснут, устройства отвязываются, боты
// удаляются. Записи банов не трогаем: устройство и IP остаются заблокированными.
function deleteAccount(db, userId) {
  const user = (db.users || []).find((candidate) => candidate.id === userId);
  if (!user || user.accountDeleted) return false;
  Object.assign(user, {
    username: `deleted_${String(user.id).replace(/-/g, '').slice(0, 12)}`,
    firstName: 'Удалённый аккаунт', lastName: null, bio: null, avatarUrl: null,
    email: null, phone: null, birthDate: null, country: null, region: null, city: null,
    passwordHash: null, isOnline: false, accountDeleted: true, deletedAt: new Date().toISOString(),
    tokenVersion: Number(user.tokenVersion || 0) + 1,
  });
  for (const device of db.devices || []) if (device.userId === userId) device.revoked = true;
  if (Array.isArray(db.refreshTokens)) db.refreshTokens = db.refreshTokens.filter((token) => token.userId !== userId);
  const bots = (db.bots || []).filter((bot) => bot && bot.ownerId === userId);
  if (bots.length) {
    db.bots = db.bots.filter((bot) => !bots.includes(bot));
    for (const bot of bots) {
      const botUser = (db.users || []).find((candidate) => candidate.id === bot.userId);
      if (!botUser) continue;
      botUser.username = `deleted_${String(botUser.id).replace(/-/g, '').slice(0, 12)}`;
      botUser.firstName = 'Удалённый бот';
      botUser.bio = null;
      botUser.botDeleted = true;
    }
  }
  return true;
}

const lower = (value) => String(value || '').toLowerCase();
const deletedName = (id) => `deleted_${String(id).replace(/-/g, '').slice(0, 12)}`;
// Решения со сроком: 0 минут — бессрочно.
const TIMED_ACTIONS = ['temporary', 'ip', 'device', 'readonly', 'nobots'];
const DEFAULT_AUTO_DELETE_DAYS = 7;
const AUTO_DELETE_CHECK_MS = 10 * 60 * 1000;

// Настройка автоудаления у решения. По умолчанию включена только для бана
// по IP (7 дней), у остальных блокировок её включает администратор.
function parseAutoDelete(raw, action) {
  if (!AUTO_DELETE_ACTIONS.includes(action)) {
    if (raw && raw.enabled) return { error: 'Автоудаление доступно только для блокировок' };
    return { value: undefined };
  }
  if (raw === undefined || raw === null) {
    return { value: { enabled: action === 'ip', days: DEFAULT_AUTO_DELETE_DAYS } };
  }
  if (typeof raw !== 'object' || typeof raw.enabled !== 'boolean') {
    return { error: 'Укажите, включено ли автоудаление' };
  }
  const days = raw.days === undefined ? DEFAULT_AUTO_DELETE_DAYS : Number(raw.days);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return { error: 'Срок автоудаления: от 1 до 365 дней' };
  }
  return { value: { enabled: raw.enabled, days } };
}

// Удаляет аккаунты, у которых истёк срок автоудаления. Не трогает тех, чей бан
// уже снят или истёк, и тех, у кого апелляция ещё на рассмотрении.
function runAutoDeletions(db, now = Date.now()) {
  const deleted = [];
  for (const report of db.reports || []) {
    const decision = report?.decision;
    if (!decision || decision.overturned || decision.autoDeletedAt) continue;
    const deleteAt = autoDeleteAt(decision);
    const userId = decision.subjectId;
    if (!deleteAt || deleteAt > now || !userId) continue;
    const stillActive = (db.moderationBans || []).some((ban) => ban && ban.reportId === report.id &&
      ban.userId === userId && ['account', 'readonly'].includes(ban.kind) && isActiveBan(ban));
    if (!stillActive) continue;
    const pending = (db.appeals || []).some((appeal) => appeal && appeal.status === 'open' &&
      appeal.userId === userId && (!appeal.reportId || appeal.reportId === report.id));
    if (pending) continue;
    if (deleteAccount(db, userId)) deleted.push(userId);
    decision.autoDeletedAt = new Date(now).toISOString();
    (report.audit ||= []).push({ action: 'auto-deleted', at: decision.autoDeletedAt });
  }
  return deleted;
}

// Решение, которое пользователь может обжаловать. Старые решения без
// subjectId относятся к targetId жалобы.
function decisionForAppeal(db, userId, reportId) {
  const report = (db.reports || []).find((candidate) => candidate && candidate.id === reportId);
  const decision = report?.decision;
  const subjectId = decision ? (decision.subjectId || report.targetId) : null;
  if (!decision || decision.action === 'dismiss' || subjectId !== userId) {
    return { code: 404, error: 'Решение не найдено' };
  }
  if (decision.overturned) return { code: 409, error: 'Решение уже отменено' };
  if (decision.autoDeletedAt) return { code: 409, error: 'Аккаунт уже удалён' };
  return { report, label: decisionLabel(decision.action, decision.appShortName) };
}

function restoreBot(db, restore) {
  const user = (db.users || []).find((candidate) => candidate.id === restore.bot.userId);
  const owner = (db.users || []).find((candidate) => candidate.id === restore.bot.ownerId);
  if (!user || !owner || owner.accountDeleted) return false;
  const name = lower(restore.user.username);
  if ((db.users || []).some((candidate) => candidate.id !== user.id && lower(candidate.username) === name)) return false;
  db.bots ||= [];
  if (!db.bots.some((bot) => bot && bot.id === restore.bot.id)) db.bots.push(clone(restore.bot));
  Object.assign(user, {
    username: restore.user.username, firstName: restore.user.firstName, bio: restore.user.bio, botDeleted: false,
  });
  return true;
}

function restoreApp(db, restore) {
  const bot = (db.bots || []).find((candidate) => candidate && candidate.id === restore.botId && candidate.userId);
  if (!bot) return false;
  const apps = Array.isArray(bot.apps) ? bot.apps : [];
  if (apps.some((item) => lower(item?.shortName) === lower(restore.app.shortName))) return false;
  bot.apps = [...apps, clone(restore.app)];
  if (restore.menuButton && !bot.menuButton) bot.menuButton = clone(restore.menuButton);
  return true;
}

// Апелляция удовлетворена: снимаем всё, что выдано этим решением, и
// возвращаем удалённого бота или приложение. restored=false — ник или
// короткое имя уже заняты, вернуть не удалось.
function overturnDecision(db, report, by) {
  const decision = report?.decision;
  if (!decision || decision.overturned) return { ok: false, restored: null };
  const fromReport = (item) => !!item && item.reportId === report.id;
  db.moderationBans = (db.moderationBans || []).filter((ban) => !fromReport(ban));
  db.ipBans = (db.ipBans || []).filter((ban) => !fromReport(ban));
  db.moderationWarnings = (db.moderationWarnings || []).filter((warning) => !fromReport(warning));
  let restored = null;
  if (report.restore?.type === 'bot') restored = restoreBot(db, report.restore);
  else if (report.restore?.type === 'app') restored = restoreApp(db, report.restore);
  if (restored) delete report.restore;
  decision.overturned = { by, at: new Date().toISOString(), restored };
  if (decision.autoDelete) decision.autoDelete = { ...decision.autoDelete, enabled: false };
  (report.audit ||= []).push({ action: 'overturned', by, at: decision.overturned.at, restored });
  return { ok: true, restored };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// Deleted messages are intentionally kept separate from the live message list.
// This lets normal users remain unable to read them while administrators can
// inspect the evidence attached to a report.
function archive(db, messages, deletedBy, _options = {}) {
  if (!Array.isArray(db.deletedMessages)) db.deletedMessages = [];
  const known = new Set(db.deletedMessages.map((message) => message?.id).filter(Boolean));
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message?.id || known.has(message.id)) continue;
    db.deletedMessages.push({
      ...clone(message),
      isDeleted: true,
      deletedAt: new Date().toISOString(),
      deletedBy: deletedBy || null,
    });
    known.add(message.id);
  }
}

function install({ app, getDb, saveDb, auth, isAdmin, isAdminUsername, requestIp, notify, disconnect }) {
  const db = () => getDb();
  const sendNotification = typeof notify === 'function' ? notify : () => {};
  const disconnectUser = typeof disconnect === 'function' ? disconnect : () => {};
  const admin = (req, res, next) => isAdmin(req)
    ? next()
    : res.status(403).json({ message: 'Нет доступа' });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 3 },
  }).single('photo');

  const userBrief = (id) => {
    const user = db().users.find((candidate) => candidate.id === id);
    return { id, username: user?.username || id };
  };
  const reportView = (report) => {
    // restore — снимок удалённого бота с хэшем токена, клиенту не нужен.
    const { photo, restore, ...publicReport } = report;
    const targetType = report.targetType || 'user';
    let targetInfo = { id: report.targetId, type: targetType };
    
    if (targetType === 'user' || targetType === 'bot') {
      const user = db().users.find(u => u.id === report.targetId);
      targetInfo = { ...targetInfo, username: user?.username || report.targetId };
    } else if (targetType === 'group' || targetType === 'channel') {
      const chat = db().chats.find(c => c.id === report.targetId);
      targetInfo = { ...targetInfo, name: chat?.name || report.targetId };
    } else if (targetType === 'sticker') {
      targetInfo = { ...targetInfo, name: report.targetName || report.targetId };
    } else if (targetType === 'icon') {
      targetInfo = { ...targetInfo, name: report.targetName || report.targetId };
    }
    
    return {
      ...publicReport,
      hasPhoto: !!photo,
      reporter: userBrief(report.reporterId),
      target: targetInfo,
      targetType,
    };
  };
  const findReport = (req, res) => {
    const report = (db().reports || []).find((candidate) => candidate.id === req.params.id);
    if (!report) res.status(404).json({ message: 'Жалоба не найдена' });
    return report;
  };
  const historyMessages = (chatId) => {
    const byId = new Map();
    for (const message of [...(db().messages || []), ...(db().deletedMessages || [])]) {
      if (message?.chatId === chatId && message.id) byId.set(message.id, message);
    }
    return [...byId.values()].sort((a, b) => {
      const dateOrder = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      return dateOrder || String(a.id).localeCompare(String(b.id));
    });
  };

  app.get('/api/reports/chats/:targetId', auth, (req, res) => {
    const mine = new Set((db().chatMembers || [])
      .filter((member) => member.userId === req.userId).map((member) => member.chatId));
    const theirs = new Set((db().chatMembers || [])
      .filter((member) => member.userId === req.params.targetId).map((member) => member.chatId));
    const targetMessageChatIds = new Set([
      ...(db().messages || []),
      ...(db().deletedMessages || []),
    ].filter((message) => (message.authorId || message.senderId) === req.params.targetId)
      .map((message) => message.chatId));
    res.json((db().chats || [])
      .filter((chat) => mine.has(chat.id) && (theirs.has(chat.id) || targetMessageChatIds.has(chat.id)))
      .map((chat) => ({ id: chat.id, name: chat.name || 'Личный чат', type: chat.type })));
  });

  app.post('/api/reports', auth, (req, res, next) => {
    const recent = (db().reports || []).filter((report) => report.reporterId === req.userId &&
      Number.isFinite(Date.parse(report.createdAt)) &&
      Date.parse(report.createdAt) > Date.now() - 60 * 60 * 1000);
    if (recent.length >= 10) {
      return res.status(429).json({ message: 'Можно отправить не более 10 жалоб в час' });
    }
    upload(req, res, (error) => {
      if (error) return res.status(400).json({ message: 'Допустимо одно фото до 5 МБ' });
      next();
    });
  }, (req, res) => {
    const targetId = String(req.body?.targetId || '').trim();
    const targetType = String(req.body?.targetType || 'user').trim();
    const targetName = String(req.body?.targetName || '').trim();
    const chatId = String(req.body?.chatId || '').trim() || null;
    const comment = req.body?.comment == null ? '' : String(req.body.comment).trim();
    
    const validTypes = ['user', 'bot', 'group', 'channel', 'sticker', 'icon'];
    if (!validTypes.includes(targetType)) {
      return res.status(400).json({ message: 'Неверный тип объекта жалобы' });
    }
    
    if (!targetId || comment.length > 4000) {
      return res.status(400).json({ message: 'Укажите объект жалобы и комментарий не длиннее 4000 символов' });
    }
    
    // Проверка существования объекта жалобы
    if (targetType === 'user' || targetType === 'bot') {
      const target = db().users.find((user) => user.id === targetId);
      if (!target || targetId === req.userId) {
        return res.status(400).json({ message: 'Пользователь не найден' });
      }
    } else if (targetType === 'group' || targetType === 'channel') {
      const chat = db().chats.find((chat) => chat.id === targetId);
      if (!chat) {
        return res.status(400).json({ message: 'Чат не найден' });
      }
    }
    if (chatId && (
      !(db().chats || []).some((chat) => chat.id === chatId) ||
      !(db().chatMembers || []).some((member) => member.chatId === chatId && member.userId === req.userId) ||
      !(
        (db().chatMembers || []).some((member) => member.chatId === chatId && member.userId === targetId) ||
        [...(db().messages || []), ...(db().deletedMessages || [])]
          .some((message) => message.chatId === chatId && (message.authorId || message.senderId) === targetId)
      )
    )) {
      return res.status(403).json({ message: 'Выберите общий чат с пользователем' });
    }

    const recipients = (db().users || []).filter((user) => isAdminUsername(user.username));
    if (!recipients.length) return res.status(503).json({ message: 'Аккаунт администратора ещё не настроен' });

    let photo = null;
    if (req.file) {
      const bytes = req.file.buffer;
      const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'image/png'
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          ? 'image/jpeg'
          : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
            ? 'image/webp'
            : null;
      if (!mime) return res.status(400).json({ message: 'Выберите фото PNG, JPEG или WebP' });
      photo = { mime, data: bytes.toString('base64') };
    }

    const createdAt = new Date().toISOString();
    const report = {
      id: crypto.randomUUID(), reporterId: req.userId, targetId, targetType, targetName, chatId,
      comment, photo, createdAt, status: 'open',
      audit: [{ action: 'created', by: req.userId, at: createdAt }],
    };
    (db().reports ||= []).push(report);
    saveDb();

    let targetLabel = targetType;
    if (targetType === 'user' || targetType === 'bot') {
      const target = db().users.find(u => u.id === targetId);
      targetLabel = `@${target?.username || targetId}`;
    } else if (targetType === 'group' || targetType === 'channel') {
      const chat = db().chats.find(c => c.id === targetId);
      targetLabel = `${targetType === 'channel' ? 'канал' : 'группу'} "${chat?.name || targetId}"`;
    } else if (targetType === 'sticker') {
      targetLabel = `стикер "${targetName || targetId}"`;
    } else if (targetType === 'icon') {
      targetLabel = `иконку "${targetName || targetId}"`;
    }

    const notificationLines = [
      `Жалоба на ${targetLabel}`, comment,
      chatId ? `Чат: /#/chat/${chatId}` : '',
      `Рассмотрение: /#/admin?report=${report.id}`,
    ].filter(Boolean).join('\n');
    for (const recipient of recipients) {
      try { sendNotification(req.userId, recipient.id, notificationLines, report.id); } catch {}
    }
    saveDb();
    res.status(201).json({ id: report.id });
  });

  app.get('/api/admin/reports', auth, admin, (req, res) => {
    const typeFilter = req.query.type ? String(req.query.type) : null;
    const statusFilter = req.query.status ? String(req.query.status) : null;
    
    let reports = (db().reports || []).slice();
    
    if (typeFilter && typeFilter !== 'all') {
      reports = reports.filter(r => (r.targetType || 'user') === typeFilter);
    }
    
    if (statusFilter && statusFilter !== 'all') {
      reports = reports.filter(r => r.status === statusFilter);
    }
    
    res.json(reports.reverse().map(reportView));
  });

  app.get('/api/admin/reports/stats', auth, admin, (req, res) => {
    const reports = db().reports || [];
    const stats = {
      total: reports.length,
      open: reports.filter(r => r.status === 'open').length,
      byType: reports.reduce((acc, r) => {
        const type = r.targetType || 'user';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {}),
    };
    res.json(stats);
  });

  app.get('/api/admin/reports/:id', auth, admin, (req, res) => {
    const report = findReport(req, res);
    if (!report) return;
    report.audit ||= [];
    report.audit.push({ action: 'view', by: req.userId, at: new Date().toISOString() });
    saveDb();
    res.json(reportView(report));
  });

  app.get('/api/admin/reports/:id/photo', auth, admin, (req, res) => {
    const report = findReport(req, res);
    if (!report) return;
    if (!report.photo) return res.sendStatus(404);
    res.set('Cache-Control', 'no-store').type(report.photo.mime)
      .send(Buffer.from(report.photo.data, 'base64'));
  });

  app.get('/api/admin/reports/:id/messages', auth, admin, (req, res) => {
    const report = findReport(req, res);
    if (!report) return;
    const offset = Number(req.query.offset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) return res.sendStatus(400);
    const messages = report.chatId ? historyMessages(report.chatId) : [];
    report.audit ||= [];
    report.audit.push({ action: 'messages', by: req.userId, at: new Date().toISOString(), offset });
    saveDb();
    res.json({
      messages: messages.slice(offset, offset + 100).map((message) => ({
        ...message, sender: userBrief(message.authorId || message.senderId),
      })),
      total: messages.length,
    });
  });

  app.post('/api/admin/reports/:id/decision', auth, admin, (req, res) => {
    const report = findReport(req, res);
    if (!report) return;
    if (report.status !== 'open') return res.status(409).json({ message: 'Жалоба уже рассмотрена' });

    const action = String(req.body?.action || '');
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const minutes = req.body?.minutes === undefined ? 0 : Number(req.body.minutes);
    const actions = ['dismiss', 'warn', 'temporary', 'permanent', 'ip', 'device', 'readonly', 'nobots', 'delete'];
    if (!actions.includes(action) || !reason || reason.length > 1000) {
      return res.status(400).json({ message: 'Выберите решение и укажите причину до 1000 символов' });
    }
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 525600 ||
      (action === 'temporary' && minutes < 1) ||
      (['dismiss', 'warn', 'permanent', 'delete'].includes(action) && minutes !== 0)) {
      return res.status(400).json({ message: 'Укажите корректный срок решения' });
    }
    const parsedAutoDelete = parseAutoDelete(req.body?.autoDelete, action);
    if (parsedAutoDelete.error) return res.status(400).json({ message: parsedAutoDelete.error });
    const autoDelete = parsedAutoDelete.value;

    const targetType = report.targetType || 'user';
    
    // Для пользователей и ботов — стандартная логика банов
    if (targetType === 'user' || targetType === 'bot') {
      const target = (db().users || []).find((user) => user.id === report.targetId);
      if (!target) return res.status(404).json({ message: 'Пользователь не найден' });
      if (!['dismiss', 'warn'].includes(action) &&
        (target.id === req.userId || isAdminUsername(target.username))) {
        return res.status(403).json({ message: 'Нельзя блокировать администратора' });
      }
    }
    
    // Для групп, каналов, стикеров, иконок — только удаление или отклонение
    if (['group', 'channel', 'sticker', 'icon'].includes(targetType)) {
      if (!['dismiss', 'delete'].includes(action)) {
        return res.status(400).json({ message: 'Для этого типа доступно только удаление или отклонение жалобы' });
      }
      
      if (action === 'dismiss') {
        // Просто отклоняем жалобу без действий
        const decision = {
          action: 'dismiss', reason, by: req.userId, at: new Date().toISOString(),
        };
        report.status = 'resolved';
        report.decision = decision;
        report.audit ||= [];
        report.audit.push(decision);
        saveDb();
        return res.json(reportView(report));
      }
      
      if (action === 'delete') {
        if (targetType === 'group' || targetType === 'channel') {
          const chat = db().chats.find(c => c.id === report.targetId);
          if (chat) {
            // Удаляем чат
            db().chats = db().chats.filter(c => c.id !== report.targetId);
            db().chatMembers = (db().chatMembers || []).filter(m => m.chatId !== report.targetId);
            db().messages = (db().messages || []).filter(m => m.chatId !== report.targetId);
          }
        } else if (targetType === 'sticker') {
          // Удаление стикера — пометка в базе
          db().deletedStickers ||= [];
          if (!db().deletedStickers.includes(report.targetId)) {
            db().deletedStickers.push(report.targetId);
          }
        } else if (targetType === 'icon') {
          // Удаление иконки
          db().deletedIcons ||= [];
          if (!db().deletedIcons.includes(report.targetId)) {
            db().deletedIcons.push(report.targetId);
          }
        }
        
        const decision = {
          action: 'delete', reason, by: req.userId, at: new Date().toISOString(),
        };
        report.status = 'resolved';
        report.decision = decision;
        report.audit ||= [];
        report.audit.push(decision);
        saveDb();
        return res.json(reportView(report));
      }
    }

    // Ниже — только для user/bot. Жалоба на бота наказывает его владельца,
    // а сам бот (или его мини-приложение) только удаляется.
    const target = (db().users || []).find((user) => user.id === report.targetId);
    const botRecord = targetType === 'bot'
      ? (db().bots || []).find((bot) => bot && bot.userId === target.id) || null
      : null;
    const subjectId = targetType === 'bot' ? (botRecord?.ownerId || target.botOwnerId || null) : target.id;
    const subject = subjectId ? (db().users || []).find((user) => user.id === subjectId) : null;
    if (action === 'delete' && targetType !== 'bot') {
      return res.status(400).json({ message: 'Удалить можно только бота или его мини-приложение' });
    }
    if (!['dismiss', 'delete'].includes(action)) {
      if (!subject) return res.status(404).json({ message: 'Владелец бота не найден' });
      if (action !== 'warn' && (subject.id === req.userId || isAdminUsername(subject.username))) {
        return res.status(403).json({ message: 'Нельзя блокировать администратора' });
      }
    }
    const appShortName = action === 'delete' ? String(req.body?.appShortName || '').trim().slice(0, 64) : '';
    let botApp = null;
    if (action === 'delete') {
      if (!botRecord) return res.status(404).json({ message: 'Бот не найден или уже удалён' });
      if (appShortName) {
        botApp = (Array.isArray(botRecord.apps) ? botRecord.apps : [])
          .find((item) => lower(item?.shortName) === lower(appShortName)) || null;
        if (!botApp) return res.status(404).json({ message: 'Мини-приложение не найдено' });
      }
    }

    const expiresAt = (TIMED_ACTIONS.includes(action) && minutes)
      ? Date.now() + minutes * 60 * 1000 : null;
    const base = { userId: subjectId, reportId: report.id, reason, createdBy: req.userId, expiresAt };
    const knownIps = [...new Set(((db().moderationIps || {})[subjectId] || [])
      .filter((ip) => typeof ip === 'string' && ip))];
    const currentIp = requestIp(req);
    const targetIps = knownIps.filter((ip) => ip !== currentIp);
    // Все устройства, когда-либо привязанные к аккаунту, включая отвязанные.
    const devices = (db().devices || []).filter((device) => device.userId === subjectId);
    if (action === 'ip' && !targetIps.length) {
      return res.status(400).json({ message: 'Нет известного IP, который можно заблокировать без блокировки текущего IP' });
    }
    if (action === 'device' && !devices.length) {
      return res.status(400).json({ message: 'Нет известных устройств' });
    }

    db().moderationBans ||= [];
    db().moderationWarnings ||= [];
    if (action === 'temporary' || action === 'permanent') {
      db().moderationBans.push({ ...base, kind: 'account' });
    } else if (action === 'device') {
      // Бан устройств закрывает и сам аккаунт: иначе он вошёл бы с нового устройства.
      db().moderationBans.push({ ...base, kind: 'account', via: 'device' });
      for (const device of devices) {
        db().moderationBans.push({ ...base, kind: 'device', deviceId: device.deviceId, hash: device.installationHash || null });
      }
    } else if (action === 'ip') {
      // То же для IP: с другого адреса аккаунт тоже не войдёт.
      db().moderationBans.push({ ...base, kind: 'account', via: 'ip' });
      db().ipBans ||= [];
      for (const ip of targetIps) {
        db().ipBans = db().ipBans.filter((ban) => ban.ip !== ip);
        db().ipBans.push({ ...base, kind: 'ip', ip });
      }
    } else if (action === 'readonly') {
      db().moderationBans.push({ ...base, kind: 'readonly' });
    } else if (action === 'nobots') {
      db().moderationBans.push({ ...base, kind: 'bots' });
    } else if (action === 'warn') {
      db().moderationWarnings.push({ ...base, kind: 'warning', createdAt: new Date().toISOString() });
    }

    // Удалённого бота или приложение можно вернуть, если владелец выиграет
    // апелляцию. Снимок хранится в жалобе и не уходит клиенту (см. reportView).
    let restore = null;
    if (action === 'delete') {
      if (botApp) {
        const menuButton = botRecord.menuButton && botRecord.menuButton.url === botApp.url
          ? clone(botRecord.menuButton) : null;
        restore = { type: 'app', botId: botRecord.id, app: clone(botApp), menuButton };
        botRecord.apps = botRecord.apps.filter((item) => item !== botApp);
        if (menuButton) botRecord.menuButton = null;
      } else {
        restore = {
          type: 'bot', bot: clone(botRecord),
          user: { username: target.username, firstName: target.firstName ?? null, bio: target.bio ?? null },
        };
        db().bots = db().bots.filter((bot) => bot !== botRecord);
        Object.assign(target, { username: deletedName(target.id), firstName: 'Удалённый бот', bio: null, botDeleted: true });
      }
    }

    const decision = {
      action, reason, expiresAt, by: req.userId, at: new Date().toISOString(),
      kind: decisionKind(action),
      subjectId: action === 'dismiss' ? null : subjectId,
      appliedIps: action === 'ip' ? targetIps : undefined,
      appShortName: botApp ? botApp.shortName : undefined,
      autoDelete,
    };
    if (restore) report.restore = restore;
    report.status = 'resolved';
    report.decision = decision;
    report.audit ||= [];
    report.audit.push(decision);
    if (action !== 'dismiss' && subjectId) {
      // appealReportId превращается на клиенте в кнопку «Обжаловать».
      const deleteAt = autoDeleteAt(decision);
      sendNotification(req.userId, subjectId, [
        `Решение администрации: ${decisionLabel(action, decision.appShortName)}`,
        reason,
        expiresAt ? `До ${new Date(expiresAt).toISOString()}` : '',
        deleteAt ? `Аккаунт будет удалён ${new Date(deleteAt).toISOString()}, если решение не будет отменено` : '',
        'Решение можно обжаловать кнопкой под этим сообщением.',
      ].filter(Boolean).join('\n'), null, { appealReportId: report.id });
    }
    saveDb();
    if (BAN_ACTIONS.includes(action)) {
      disconnectUser(subjectId, action === 'ip' ? targetIps : []);
    }
    res.json(reportView(report));
  });

  // Автоудаление можно включить, выключить или поменять срок и после решения.
  app.patch('/api/admin/reports/:id/auto-delete', auth, admin, (req, res) => {
    const report = findReport(req, res);
    if (!report) return;
    const decision = report.decision;
    if (!decision || !AUTO_DELETE_ACTIONS.includes(decision.action)) {
      return res.status(400).json({ message: 'У этого решения нет автоудаления' });
    }
    if (decision.overturned) return res.status(409).json({ message: 'Решение отменено по апелляции' });
    if (decision.autoDeletedAt) return res.status(409).json({ message: 'Аккаунт уже удалён' });
    const parsed = parseAutoDelete(req.body || {}, decision.action);
    if (parsed.error) return res.status(400).json({ message: parsed.error });
    decision.autoDelete = parsed.value;
    report.audit ||= [];
    report.audit.push({ action: 'auto-delete', ...parsed.value, by: req.userId, at: new Date().toISOString() });
    saveDb();
    res.json(reportView(report));
  });

  // Просмотр чата по ссылке: вся история, включая удалённые сообщения и
  // вложения. Каждый просмотр пишется в журнал администратора.
  app.get('/api/admin/chats/lookup', auth, admin, (req, res) => {
    const chatId = parseChatLink(req.query.link);
    if (!chatId) return res.status(400).json({ message: 'Вставьте ссылку на чат вида /#/chat/<id>' });
    const offset = Number(req.query.offset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) return res.status(400).json({ message: 'Некорректное смещение' });
    const chat = (db().chats || []).find((candidate) => candidate.id === chatId);
    const messages = historyMessages(chatId);
    if (!chat && !messages.length) return res.status(404).json({ message: 'Чат не найден' });
    db().adminAudit ||= [];
    db().adminAudit.push({ action: 'chat-lookup', chatId, offset, by: req.userId, at: new Date().toISOString() });
    if (db().adminAudit.length > 5000) db().adminAudit.splice(0, db().adminAudit.length - 5000);
    saveDb();
    res.json({
      chat: chat
        ? { id: chat.id, name: chat.name || null, type: chat.type || 'direct', createdAt: chat.createdAt || null, deleted: false }
        : { id: chatId, name: null, type: null, createdAt: null, deleted: true },
      members: (db().chatMembers || []).filter((member) => member.chatId === chatId)
        .map((member) => ({ ...userBrief(member.userId), role: member.role || 'member' })),
      messages: messages.slice(offset, offset + 100).map((message) => ({
        ...message, sender: userBrief(message.authorId || message.senderId),
      })),
      total: messages.length,
    });
  });

  const timer = setInterval(() => {
    try {
      const deleted = runAutoDeletions(db());
      if (!deleted.length) return;
      saveDb();
      for (const userId of deleted) disconnectUser(userId, []);
    } catch (error) {
      console.error('[moderation] auto-delete:', (error && error.message) || error);
    }
  }, AUTO_DELETE_CHECK_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

module.exports = {
  install, blocked, archive, isActiveBan,
  readOnly, creationBanned, readOnlyAllows, READ_ONLY_SOCKET_EVENTS,
  parseChatLink, parseAutoDelete, runAutoDeletions, deleteAccount,
  decisionForAppeal, overturnDecision, decisionLabel,
};