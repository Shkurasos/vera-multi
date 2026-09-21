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
    const { photo, ...publicReport } = report;
    return {
      ...publicReport,
      hasPhoto: !!photo,
      reporter: userBrief(report.reporterId),
      target: userBrief(report.targetId),
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
    if (recent.length >= 5) {
      return res.status(429).json({ message: 'Можно отправить не более 5 жалоб в час' });
    }
    upload(req, res, (error) => {
      if (error) return res.status(400).json({ message: 'Допустимо одно фото до 5 МБ' });
      next();
    });
  }, (req, res) => {
    const targetId = String(req.body?.targetId || '').trim();
    const chatId = String(req.body?.chatId || '').trim() || null;
    const comment = req.body?.comment == null ? '' : String(req.body.comment).trim();
    const target = db().users.find((user) => user.id === targetId);
    if (!target || targetId === req.userId || comment.length > 4000) {
      return res.status(400).json({ message: 'Выберите пользователя и укажите комментарий не длиннее 4000 символов' });
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
      id: crypto.randomUUID(), reporterId: req.userId, targetId, chatId,
      comment, photo, createdAt, status: 'open',
      audit: [{ action: 'created', by: req.userId, at: createdAt }],
    };
    (db().reports ||= []).push(report);
    saveDb();

    const notificationLines = [
      `Жалоба на @${target.username}`, comment,
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
    res.json((db().reports || []).slice().reverse().map(reportView));
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
    const actions = ['dismiss', 'warn', 'temporary', 'permanent', 'ip', 'device'];
    if (!actions.includes(action) || !reason || reason.length > 1000) {
      return res.status(400).json({ message: 'Выберите решение и укажите причину до 1000 символов' });
    }
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 525600 ||
      (action === 'temporary' && minutes < 1) ||
      (['dismiss', 'warn', 'permanent'].includes(action) && minutes !== 0)) {
      return res.status(400).json({ message: 'Укажите корректный срок решения' });
    }

    const target = (db().users || []).find((user) => user.id === report.targetId);
    if (!target) return res.status(404).json({ message: 'Пользователь не найден' });
    if (!['dismiss', 'warn'].includes(action) &&
      (target.id === req.userId || isAdminUsername(target.username))) {
      return res.status(403).json({ message: 'Нельзя блокировать администратора' });
    }

    const expiresAt = (['temporary', 'ip', 'device'].includes(action) && minutes)
      ? Date.now() + minutes * 60 * 1000 : null;
    const base = { userId: target.id, reportId: report.id, reason, createdBy: req.userId, expiresAt };
    const knownIps = [...new Set(((db().moderationIps || {})[target.id] || [])
      .filter((ip) => typeof ip === 'string' && ip))];
    const currentIp = requestIp(req);
    const targetIps = knownIps.filter((ip) => ip !== currentIp);
    const devices = (db().devices || []).filter((device) => device.userId === target.id);
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
      for (const device of devices) {
        db().moderationBans.push({ ...base, kind: 'device', deviceId: device.deviceId, hash: device.installationHash || null });
      }
    } else if (action === 'ip') {
      db().ipBans ||= [];
      for (const ip of targetIps) {
        db().ipBans = db().ipBans.filter((ban) => ban.ip !== ip);
        db().ipBans.push({ ...base, kind: 'ip', ip });
      }
    } else if (action === 'warn') {
      db().moderationWarnings.push({ ...base, kind: 'warning', createdAt: new Date().toISOString() });
    }

    const decision = {
      action, reason, expiresAt, by: req.userId, at: new Date().toISOString(),
      appliedIps: action === 'ip' ? targetIps : undefined,
    };
    report.status = 'resolved';
    report.decision = decision;
    report.audit ||= [];
    report.audit.push(decision);
    if (action !== 'dismiss') {
      sendNotification(req.userId, target.id,
        `Решение администрации: ${action === 'warn' ? 'предупреждение' : 'блокировка'}\n${reason}${expiresAt ? `\nДо ${new Date(expiresAt).toISOString()}` : ''}`);
    }
    saveDb();
    if (!['dismiss', 'warn'].includes(action)) {
      disconnectUser(target.id, action === 'ip' ? targetIps : []);
    }
    res.json(reportView(report));
  });
}

module.exports = { install, blocked, archive, isActiveBan };