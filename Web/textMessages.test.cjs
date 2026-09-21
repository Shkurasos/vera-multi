const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, 'src/store/chatStore.ts'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
// Хелперы работы с локальными заглушками (`temp-*`) — их используют edit/pin/replace.
const helpers = section('/* ---------- Локальные заглушки сообщений', 'interface ChatState');
function setup(type, echo) {
  let state = { messages: {}, chats: [{ id: 'chat', type }], activeChat: { id: 'chat' } };
  const calls = [];
  const context = vm.createContext({
    console, navigator: { onLine: true }, VERA_AI_ID: 'vera-ai',
    isPeerAvailable: () => false,
    useAuthStore: { getState: () => ({ user: { id: 'alice' } }) },
    saveArchivedMessages: async () => {}, attachReplyPreview: m => m,
    set: update => { state = { ...state, ...update(state) }; },
    get: () => ({ ...state, ...context.actions }),
    messagesApi: {
      send: async (chatId, body) => {
        const data = { ...body, id: 'server-id', chatId, content: body.text,
          senderId: type === 'channel' ? chatId : 'alice',
          authorId: type === 'channel' ? 'alice' : undefined };
        if (echo) state.messages[chatId].push(data);
        return { data };
      },
      edit: async (id, text) => { calls.push(['edit', id]); return { data: { id, chatId: 'chat', content: text } }; },
      pin: async id => { calls.push(['pin', id]); return { data: {} }; },
    },
  });
  const handlers = [
    section('  sendMessage: async', '  forwardMessage: async'),
    section('  replaceOrAddMessage: (message)', '  addMessage: (message)'),
    section('  editMessage: async', '  deleteMessage: async'),
    section('  pinMessage: async', '  addReaction: async'),
  ].join('\n');
  vm.runInContext(ts.transpileModule(`${helpers}
globalThis.actions = { ${handlers} updateMessage() {}, applyPinnedMessage() {} };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return { actions: context.actions, state: () => state, calls };
}

for (const type of ['direct', 'group', 'channel']) {
  for (const echo of [false, true]) {
    test(`${type}: text confirmation supports edit and pin (socket echo: ${echo})`, async () => {
      const s = setup(type, echo);
      await s.actions.sendMessage('chat', 'Hello');
      assert.equal(s.state().messages.chat.length, 1);
      const message = s.state().messages.chat[0];
      assert.equal(message.id, 'server-id');
      assert.match(message.clientTempId, /^temp-/);
      await s.actions.editMessage(message.id, 'Edited');
      await s.actions.pinMessage('chat', message.id);
      assert.deepEqual(s.calls, [['edit', 'server-id'], ['pin', 'server-id']]);
    });
  }
}

test('pending text is rejected locally before edit or pin requests', async () => {
  const s = setup('direct', false);
  await assert.rejects(s.actions.editMessage('temp-pending', 'Edited'), /ещё отправляется/);
  await assert.rejects(s.actions.pinMessage('chat', 'temp-pending'), /ещё отправляется/);
  assert.equal(s.calls.length, 0);
});

// Если в списке осталась локальная заглушка, но сервер уже подтвердил сообщение
// (например, сокетное эхо не убрало копию), действия выполняются по реальному id.
test('action on a left-over temporary copy uses the confirmed message id', async () => {
  const s = setup('direct', false);
  await s.actions.sendMessage('chat', 'Hello');
  const confirmed = s.state().messages.chat[0];
  assert.equal(confirmed.id, 'server-id');
  // Возвращаем заглушку в список — так бывает при устаревшем клиенте/сокетном эхе.
  s.state().messages.chat.unshift({
    id: confirmed.clientTempId, chatId: 'chat', senderId: 'alice', content: 'Hello',
  });
  await s.actions.editMessage(confirmed.clientTempId, 'Edited');
  await s.actions.pinMessage('chat', confirmed.clientTempId);
  assert.deepEqual(s.calls, [['edit', 'server-id'], ['pin', 'server-id']]);
});