// Тест: проверка доступа к чатам (только участники + админы)
// Запуск: node Server/test-chat-access.js

const assert = require('assert');

// Мок базы данных
const db = {
  users: [
    { id: 'admin-1', username: 'admin', isAdmin: true },
    { id: 'user-1', username: 'alice', isAdmin: false },
    { id: 'user-2', username: 'bob', isAdmin: false },
  ],
  chats: [
    { id: 'chat-1', type: 'direct' },
    { id: 'chat-2', type: 'group' },
  ],
  chatMembers: [
    { chatId: 'chat-1', userId: 'user-1' },
    { chatId: 'chat-1', userId: 'user-2' },
    { chatId: 'chat-2', userId: 'user-1' },
  ],
};

// Логика проверки доступа (из server.js GET /api/chats/:id)
function checkChatAccess(chatId, userId) {
  const isMember = db.chatMembers.find(m => m.chatId === chatId && m.userId === userId);
  const currentUser = db.users.find(u => u.id === userId);
  const isAdmin = currentUser?.isAdmin === true;
  
  // Доступ только участникам чата или глобальным админам
  if (!isMember && !isAdmin) {
    return { allowed: false, message: 'Нет доступа' };
  }
  return { allowed: true };
}

// Тесты
console.log('Тест 1: Участник chat-1 (user-1) должен видеть chat-1');
assert.strictEqual(checkChatAccess('chat-1', 'user-1').allowed, true);

console.log('Тест 2: Участник chat-2 (user-1) должен видеть chat-2');
assert.strictEqual(checkChatAccess('chat-2', 'user-1').allowed, true);

console.log('Тест 3: НЕ участник (user-2) НЕ должен видеть chat-2');
assert.strictEqual(checkChatAccess('chat-2', 'user-2').allowed, false);

console.log('Тест 4: Админ (admin-1) должен видеть любой чат (chat-1)');
assert.strictEqual(checkChatAccess('chat-1', 'admin-1').allowed, true);

console.log('Тест 5: Админ (admin-1) должен видеть любой чат (chat-2), даже если не участник');
assert.strictEqual(checkChatAccess('chat-2', 'admin-1').allowed, true);

console.log('✅ Все тесты пройдены!');
