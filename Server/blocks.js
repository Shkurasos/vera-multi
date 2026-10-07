const crypto = require('node:crypto');

// Personal user block + ban appeals.
//
// This is NOT an admin ban: a user closes a chat to one specific person.
// The blocked person can no longer send messages to that chat, and the blocker
// gets an "Unblock" button in place of the message input.
// Admin bans live in moderationBans and are account-wide.

function ensureCollections(db) {
  if (!Array.isArray(db.userBlocks)) db.userBlocks = [];
  if (!Array.isArray(db.appeals)) db.appeals = [];
  return db;
}

function isBlockedBy(db, blockerId, blockedId) {
  if (!blockerId || !blockedId) return false;
  return (db.userBlocks || []).some(
    (block) => block && block.blockerId === blockerId && block.blockedId === blockedId,
  );
}

/**
 * Is the sender blocked inside this chat?
 *
 * We check EVERY other member: if one of them blocked the sender, the message
 * is rejected. A one-sided block (A blocks B) does not stop B from writing in
 * shared chats with other people where A is absent.
 */
function blockedInChat(db, chatId, senderId) {
  const members = (db.chatMembers || [])
    .filter((member) => member.chatId === chatId && member.userId !== senderId)
    .map((member) => member.userId);
  return members.some((memberId) => isBlockedBy(db, memberId, senderId));
}

function install({ app, getDb, saveDb, auth, isAdmin, isAdminUsername, notify, blocked, resolveInstallationUser }) {
  const db = () => ensureCollections(getDb());
  const sendNotification = typeof notify === 'function' ? notify : () => {};
  const isBannedUser = typeof blocked === 'function' ? blocked : () => false;
  const admin = (req, res, next) => isAdmin(req)
    ? next()
    : res.status(403).json({ message: 'Нет доступа' });

  const userBrief = (id) => {
    const user = db().users.find((candidate) => candidate.id === id);
    return { id, username: user?.username || id };
  };
  const blockView = (block) => ({
    id: block.id,
    blocked: userBrief(block.blockedId),
    createdAt: block.createdAt,
  });

  // -- Personal block ------------------------------------------------------

  app.get('/api/users/blocks', auth, (req, res) => {
    res.json((db().userBlocks || []).filter((block) => block.blockerId === req.userId).map(blockView));
  });

  // Who blocked me: the chat needs this to explain the refusal.
  app.get('/api/users/blocks/by', auth, (req, res) => {
    res.json((db().userBlocks || [])
      .filter((block) => block.blockedId === req.userId)
      .map((block) => ({ ...blockView(block), blocker: userBrief(block.blockerId) })));
  });

  app.post('/api/users/:id/block', auth, (req, res) => {
    const targetId = String(req.params.id || '');
    if (!targetId) return res.status(400).json({ message: 'Некорректный пользователь' });
    // Blocking yourself is pointless, and blocking an admin is not allowed:
    // otherwise an admin could be silenced and unable to review reports.
    if (targetId === req.userId) return res.status(400).json({ message: 'Нельзя заблокировать себя' });
    const target = (db().users || []).find((user) => user.id === targetId);
    if (!target) return res.status(404).json({ message: 'Пользователь не найден' });
    if (isAdminUsername(target.username)) {
      return res.status(403).json({ message: 'Нельзя заблокировать администратора' });
    }

    ensureCollections(db());
    const already = isBlockedBy(db(), req.userId, targetId);
    if (!already) {
      db().userBlocks.push({
        id: crypto.randomUUID(),
        blockerId: req.userId,
        blockedId: targetId,
        createdAt: new Date().toISOString(),
      });
      saveDb();
    }
    res.status(already ? 200 : 201).json({ ok: true, blocked: true, already });
  });

  app.delete('/api/users/:id/block', auth, (req, res) => {
    ensureCollections(db());
    const before = db().userBlocks.length;
    db().userBlocks = db().userBlocks.filter(
      (block) => !(block.blockerId === req.userId && block.blockedId === req.params.id),
    );
    if (db().userBlocks.length !== before) saveDb();
    res.json({ ok: true, blocked: false });
  });

  // -- Appeals -------------------------------------------------------------

  /**
   * An appeal is available to blocked and banned users only.
   * The ban check matters: otherwise anyone could spam admins through this form.
   * A personal block is enough on its own - the appeal still goes to admins only.
   */
  const createAppeal = (userId, text) => {
    const banned = isBannedUser(userId);
    const blockedBy = (db().userBlocks || []).filter((block) => block.blockedId === userId);
    if (!banned && !blockedBy.length) {
      return { code: 403, message: 'Апелляция доступна только заблокированным и забаненным' };
    }
    const openAppeal = (db().appeals || []).find(
      (appeal) => appeal.userId === userId && appeal.status === 'open',
    );
    if (openAppeal) return { code: 409, message: 'Ваша апелляция уже на рассмотрении' };

    ensureCollections(db());
    const appeal = {
      id: crypto.randomUUID(),
      userId,
      text,
      // ban vs block: a ban has a term and a reason, a personal block only has
      // an author. The admin needs this to know what is being contested.
      reason: banned ? 'Бан аккаунта' : 'Блокировка пользователем',
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    db().appeals.push(appeal);
    saveDb();

    const recipients = (db().users || []).filter((user) => isAdminUsername(user.username));
    const lines = [
      `Апелляция от @${userBrief(userId).username}`,
      appeal.reason,
      text,
      `Рассмотрение: /#/admin?appeal=${appeal.id}`,
    ].join('\n');
    for (const recipient of recipients) {
      try { sendNotification(userId, recipient.id, lines, appeal.id); } catch {}
    }
    saveDb();
    return { code: 201, id: appeal.id };
  };

  const readAppealText = (req) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return { code: 400, message: 'Напишите, что считаете несправедливым' };
    if (text.length > 4000) return { code: 400, message: 'Текст до 4000 символов' };
    return { text };
  };

  // Обычный путь: пользователь залогинен (его заблокировал другой человек).
  app.post('/api/appeals', auth, (req, res) => {
    const parsed = readAppealText(req);
    if (parsed.code) return res.status(parsed.code).json({ message: parsed.message });
    const result = createAppeal(req.userId, parsed.text);
    if (result.code !== 201) return res.status(result.code).json({ message: result.message });
    res.status(201).json({ id: result.id });
  });

  /**
   * Путь для ЗАБАНЕННЫХ.
   *
   * Забаненный не может войти: verifyAccessToken бросает ACCOUNT_BANNED, и
   * обычный /api/appeals с auth ему недоступен — подать апелляцию было бы
   * нечем. Поэтому здесь опознаём установку по её cookie (тот же секрет, что
   * и у /auth/device) и ПРОВЕРЯЕМ, что аккаунт действительно забанен.
   * Без этой проверки cookie позволила бы писать в апелляции от чужого имени,
   * поэтому через неё проходят только явно забаненные.
   */
  app.post('/api/auth/appeal', (req, res) => {
    const userId = typeof resolveInstallationUser === 'function' ? resolveInstallationUser(req) : null;
    if (!userId) return res.status(401).json({ message: 'Установка не найдена' });
    if (!isBannedUser(userId)) {
      return res.status(403).json({ message: 'Этот путь только для забаненных' });
    }
    const parsed = readAppealText(req);
    if (parsed.code) return res.status(parsed.code).json({ message: parsed.message });
    const result = createAppeal(userId, parsed.text);
    if (result.code !== 201) return res.status(result.code).json({ message: result.message });
    res.status(201).json({ id: result.id });
  });

  // Статус моей апелляции по установке: экран бана должен понимать, что она уже
  // подана, и не предлагать вторую (войти всё равно нельзя).
  app.get('/api/auth/appeal', (req, res) => {
    const userId = typeof resolveInstallationUser === 'function' ? resolveInstallationUser(req) : null;
    if (!userId) return res.status(401).json({ message: 'Установка не найдена' });
    const appeal = (db().appeals || [])
      .filter((item) => item.userId === userId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    res.json({
      banned: isBannedUser(userId),
      appeal: appeal ? { id: appeal.id, status: appeal.status, createdAt: appeal.createdAt } : null,
    });
  });

  // My latest appeal, so the button stops offering to send a second one.
  app.get('/api/appeals/mine', auth, (req, res) => {
    const appeal = (db().appeals || [])
      .filter((item) => item.userId === req.userId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    res.json(appeal ? { id: appeal.id, status: appeal.status, createdAt: appeal.createdAt } : null);
  });

  // -- Admin ---------------------------------------------------------------

  app.get('/api/admin/appeals', auth, admin, (req, res) => {
    res.json((db().appeals || []).slice().reverse().map((appeal) => ({
      id: appeal.id,
      user: userBrief(appeal.userId),
      text: appeal.text,
      reason: appeal.reason,
      status: appeal.status,
      createdAt: appeal.createdAt,
      decision: appeal.decision || null,
    })));
  });

  app.post('/api/admin/appeals/:id/decision', auth, admin, (req, res) => {
    const appeal = (db().appeals || []).find((candidate) => candidate.id === req.params.id);
    if (!appeal) return res.status(404).json({ message: 'Апелляция не найдена' });
    if (appeal.status !== 'open') {
      return res.status(409).json({ message: 'Апелляция уже рассмотрена' });
    }
    const action = String(req.body?.action || '');
    const note = String(req.body?.note || '').trim();
    if (!['uphold', 'overturn'].includes(action) || note.length > 1000) {
      return res.status(400).json({ message: 'Выберите решение' });
    }

    if (action === 'overturn') {
      // An appeal against a ban must actually lift the ban.
      const before = (db().moderationBans || []).length;
      db().moderationBans = (db().moderationBans || []).filter((ban) => ban.userId !== appeal.userId);
      if (before !== db().moderationBans.length) saveDb();
    }
    appeal.status = 'resolved';
    appeal.decision = { action, note, by: req.userId, at: new Date().toISOString() };
    saveDb();

    sendNotification(
      req.userId,
      appeal.userId,
      `Апелляция рассмотрена: ${action === 'overturn' ? 'блокировка снята' : 'отклонена'}\n${note}`,
    );
    saveDb();
    res.json({ id: appeal.id, status: appeal.status, decision: appeal.decision });
  });
}

module.exports = { install, isBlockedBy, blockedInChat, ensureCollections };

