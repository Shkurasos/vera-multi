// PART1
const fs = require('fs');
const file = 'Server/server.js';
let lines = fs.readFileSync(file, 'utf8').split('\n');
const anchor = "// POST /api/messages/:chatId/reaction";
const idx = lines.findIndex((l) => l.includes(anchor));
if (idx < 0) { console.error('ANCHOR NOT FOUND'); process.exit(1); }

const block = `
// ─── Приглашения в группы (через личный чат) ──────────────────────────────────
function ensureDirectChat(a, b) {
  const myChats = db.chatMembers.filter((m) => m.userId === a).map((m) => m.chatId);
  const targetChats = db.chatMembers.filter((m) => m.userId === b).map((m) => m.chatId);
  const common = myChats.filter((id) => targetChats.includes(id));
  const existing = common.find((id) => {
    const chat = db.chats.find((c) => c.id === id);
    return chat && chat.type === 'direct';
  });
  if (existing) return db.chats.find((c) => c.id === existing);
  const chat = {
    id: uuidv4(), type: 'direct', name: null, avatarUrl: null,
    createdAt: new Date().toISOString(), pinnedMessageId: null,
  };
  db.chats.push(chat);
  db.chatMembers.push({ id: uuidv4(), chatId: chat.id, userId: a, role: 'member', joinedAt: new Date().toISOString() });
  db.chatMembers.push({ id: uuidv4(), chatId: chat.id, userId: b, role: 'member', joinedAt: new Date().toISOString() });
  return chat;
}

function inviteUserName(u) {
  if (!u) return 'Пользователь';
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || u.id;
}

function findInviteMessageByToken(token) {
  for (const m of db.messages) {
    const att = (m.attachments || []).find((a) => a.mimeType === 'application/x-vera-group-invite');
    if (!att) continue;
    try {
      const data = typeof att.data === 'string' ? JSON.parse(att.data) : att.data;
      if (data && data.token === token) return { message: m, attachment: att, data };
    } catch {}
  }
  return null;
}

// POST /api/chats/:id/invite — отправить приглашение в группу в личный чат
app.post('/api/chats/:id/invite', authMiddleware, (req, res) => {
  const groupId = req.params.id;
  const { userId: inviteeId } = req.body;
  if (!inviteeId) return res.status(400).json({ message: 'Укажите userId' });
  if (inviteeId === req.userId) return res.status(400).json({ message: 'Нельзя пригласить себя' });
  const group = db.chats.find((c) => c.id === groupId);
  if (!group || (group.type !== 'group' && group.type !== 'channel')) {
    return res.status(404).json({ message: 'Группа не найдена' });
  }
  const inviterMember = db.chatMembers.find((m) => m.chatId === groupId && m.userId === req.userId);
  if (!inviterMember) return res.status(403).json({ message: 'Вы не участник группы' });
  const inviter = db.users.find((u) => u.id === req.userId);
  const invitee = db.users.find((u) => u.id === inviteeId);
  if (!invitee) return res.status(404).json({ message: 'Пользователь не найден' });
  if (db.chatMembers.some((m) => m.chatId === groupId && m.userId === inviteeId)) {
    return res.status(400).json({ message: 'Пользователь уже в группе' });
  }

  const direct = ensureDirectChat(req.userId, inviteeId);
  const payload = {
    type: 'vera-group-invite',
    token: uuidv4(),
    groupId,
    groupName: group.name || 'Группа',
    inviterId: req.userId,
    inviterName: inviteUserName(inviter),
    inviteeId,
    state: 'pending',
  };
`;
const block2 = `
  const existingInvite = db.messages.find((m) => {
    if (m.chatId !== direct.id) return false;
    const att = (m.attachments || []).find((a) => a.mimeType === 'application/x-vera-group-invite');
    if (!att) return false;
    try {
      const d = typeof att.data === 'string' ? JSON.parse(att.data) : att.data;
      return d && d.groupId === groupId && d.state === 'pending';
    } catch { return false; }
  });
  if (existingInvite) return res.json({ alreadyPending: true });
  const message = {
    id: uuidv4(), chatId: direct.id, senderId: req.userId,
    text: 'Приглашение в группу «' + (group.name || 'Группа') + '»',
    content: 'Приглашение в группу «' + (group.name || 'Группа') + '»',
    replyToId: null,
    attachments: [{
      id: uuidv4(), fileUrl: '', fileName: '', fileSize: 0,
      mimeType: 'application/x-vera-group-invite',
      data: JSON.stringify(payload),
    }],
    type: 'system',
    readBy: [req.userId],
    editedAt: null, isEdited: false, isPinned: false, isDeleted: false,
    createdAt: new Date().toISOString(),
  };
  db.messages.push(message);
  saveDb();
  const sender = db.users.find((u) => u.id === req.userId) || null;
  const result = { ...message, sender };
  io.to('chat:' + direct.id).emit('message:new', result);
  const targetSockets = userSockets.get(inviteeId);
  if (targetSockets) targetSockets.forEach((sid) => io.to(sid).socketsJoin('chat:' + direct.id));
  return res.status(201).json(result);
});

// POST /api/group-invites/:token/accept
app.post('/api/group-invites/:token/accept', authMiddleware, (req, res) => {
  const found = findInviteMessageByToken(req.params.token);
  if (!found) return res.status(404).json({ message: 'Приглашение не найдено' });
  const { message: msg, attachment, data } = found;
  if (data.inviteeId !== req.userId) return res.status(403).json({ message: 'Приглашение адресовано другому' });
  const group = db.chats.find((c) => c.id === data.groupId);
  if (!group) return res.status(404).json({ message: 'Группа не найдена' });
  data.state = 'accepted';
  attachment.data = JSON.stringify(data);
  if (!db.chatMembers.some((m) => m.chatId === data.groupId && m.userId === req.userId)) {
    db.chatMembers.push({ id: uuidv4(), chatId: data.groupId, userId: req.userId, role: 'member', joinedAt: new Date().toISOString() });
    const joiner = db.users.find((u) => u.id === req.userId) || null;
    const joinMsg = {
      id: uuidv4(), chatId: data.groupId, senderId: req.userId,
      text: inviteUserName(joiner) + ' присоединился(ась) к группе',
      content: inviteUserName(joiner) + ' присоединился(ась) к группе',
      replyToId: null, attachments: [], type: 'system', readBy: [req.userId],
      editedAt: null, isEdited: false, isPinned: false, isDeleted: false,
      createdAt: new Date().toISOString(),
    };
    db.messages.push(joinMsg);
    const ts = userSockets.get(req.userId);
    if (ts) ts.forEach((sid) => io.to(sid).socketsJoin('chat:' + data.groupId));
    const members = db.chatMembers.filter((m) => m.chatId === data.groupId).map((m) => ({
      id: m.id, chatId: m.chatId, userId: m.userId, role: m.role, joinedAt: m.joinedAt,
      isMuted: m.muted || false, user: db.users.find((u) => u.id === m.userId) || null,
    }));
    io.to('chat:' + data.groupId).emit('chat:updated', { ...group, members });
    io.to('chat:' + data.groupId).emit('message:new', { ...joinMsg, sender: joiner });
  }
  saveDb();
  const sender = db.users.find((u) => u.id === msg.senderId) || null;
  io.to('chat:' + msg.chatId).emit('message:edited', { ...msg, sender });
  res.json({ success: true, chatId: data.groupId });
});

// POST /api/group-invites/:token/decline
app.post('/api/group-invites/:token/decline', authMiddleware, (req, res) => {
  const found = findInviteMessageByToken(req.params.token);
  if (!found) return res.status(404).json({ message: 'Приглашение не найдено' });
  const { message: msg, attachment, data } = found;
  if (data.inviteeId !== req.userId) return res.status(403).json({ message: 'Приглашение адресовано другому' });
  data.state = 'declined';
  attachment.data = JSON.stringify(data);
  saveDb();
  const sender = db.users.find((u) => u.id === msg.senderId) || null;
  io.to('chat:' + msg.chatId).emit('message:edited', { ...msg, sender });
  res.json({ success: true });
});

`;

lines.splice(idx, 0, block + block2);
fs.writeFileSync(file, lines.join('\n'));
console.log('server.js patched at line', idx + 1);