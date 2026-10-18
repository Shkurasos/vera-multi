// Регрессия: «Удалить» в панели чатов не убирал чат из списка.
// Причина: loadChats мерджит ответ сервера с локальным архивом (IndexedDB),
// а удалённый чат в архиве оставался и возвращался в список.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

test('forgetChat убирает чат из состояния и дожидается очистки архива', () => {
  const store = read('src/store/chatStore.ts');
  const start = store.indexOf('forgetChat: async (chatId) =>');
  assert.ok(start > 0, 'в chatStore должен быть forgetChat');
  const body = store.slice(start, start + 800);
  assert.match(body, /chats: state\.chats\.filter\(\(c\) => c\.id !== chatId\)/);
  assert.match(body, /await deleteArchivedChat\(chatId\)/, 'архив нужно чистить с await');
});

test('Sidebar чистит архив до loadChats после удаления', () => {
  const sidebar = read('src/components/Sidebar.tsx');
  const start = sidebar.indexOf('async function handleDeleteChat');
  const body = sidebar.slice(start, start + 900);
  const forget = body.indexOf('forgetChat(chat.id)');
  const reload = body.indexOf('await loadChats()');
  assert.ok(forget > 0, 'handleDeleteChat должен вызывать forgetChat');
  assert.ok(forget < reload, 'forgetChat должен идти раньше loadChats');
});

test('сокет-событие chat:deleted тоже чистит архив', () => {
  const app = read('src/App.tsx');
  const start = app.indexOf("socket.on('chat:deleted'");
  assert.ok(start > 0);
  assert.match(app.slice(start, start + 300), /forgetChat\(chatId\)/);
});
