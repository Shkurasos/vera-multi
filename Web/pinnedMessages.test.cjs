const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, 'src/store/chatStore.ts'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
// Хелперы заглушек temp-* + действия закрепления/открепления и применение payload.
const helpers = section('/* ---------- Локальные заглушки сообщений', 'interface ChatState');
const handlers = [
  section('  pinMessage: async', '  addReaction: async'),
  section('  applyPinnedMessage: (chatId, messageId', '  setTyping: (chatId, userId'),
].join('\n');

function setup({ peerMode = false } = {}) {
  const msg1 = { id: 'm1', chatId: 'chat', senderId: 'alice', content: 'one' };
  const msg2 = { id: 'm2', chatId: 'chat', senderId: 'alice', content: 'two' };
  let state = {
    messages: { chat: [msg1, msg2] },
    chats: [{ id: 'chat', type: 'group' }],
    activeChat: { id: 'chat', type: 'group' },
  };
  let prefsPinned;
  const apiCalls = [];
  const peerCalls = [];
  let serverPinned = [];
  const serverMessages = { m1: msg1, m2: msg2 };
  const payload = (actionId) => {
    const list = serverPinned.map(id => serverMessages[id]);
    return {
      chatId: 'chat',
      messageId: actionId,
      pinnedMessageId: list[0]?.id || null,
      pinnedMessageIds: [...serverPinned],
      pinnedMessage: list[0] || null,
      pinnedMessages: list,
    };
  };
  const context = vm.createContext({
    console, VERA_AI_ID: 'vera-ai',
    isPeerAvailable: () => peerMode,
    peer: { updateChat: async (chatId, patch) => { peerCalls.push([chatId, patch]); } },
    useAuthStore: { getState: () => ({ user: { id: 'alice' } }) },
    useChatPrefsStore: { getState: () => ({ setPinnedMessage: (chatId, message) => { prefsPinned = message; } }) },
    saveArchivedChats: async () => {}, saveArchivedMessages: async () => {},
    messagesApi: {
      pin: async (id, chatId) => {
        apiCalls.push(['pin', id, chatId]);
        serverPinned = id === null ? [] : [id, ...serverPinned.filter(x => x !== id)];
        return { data: payload(id) };
      },
      unpin: async (id, chatId) => {
        apiCalls.push(['unpin', id, chatId]);
        serverPinned = serverPinned.filter(x => x !== id);
        return { data: payload(id) };
      },
    },
    set: update => { state = { ...state, ...update(state) }; },
    get: () => ({ ...state, ...context.actions }),
  });
  vm.runInContext(ts.transpileModule(`${helpers}
globalThis.actions = { ${handlers} updateMessage() {}, removeMessage() {} };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return {
    actions: context.actions,
    state: () => state,
    apiCalls, peerCalls,
    prefs: () => prefsPinned,
    msgs: () => state.messages.chat,
    chat: () => state.chats[0],
  };
}

test('закрепление нескольких сообщений: список, флаги и панель', async () => {
  const s = setup();
  await s.actions.pinMessage('chat', 'm2');
  await s.actions.pinMessage('chat', 'm1');
  assert.deepEqual([...s.chat().pinnedMessageIds], ['m1', 'm2']);
  assert.equal(s.chat().pinnedMessageId, 'm1');
  assert.deepEqual(s.msgs().map(m => !!m.isPinned), [true, true]);
  assert.equal(s.prefs()?.id, 'm1');
  assert.deepEqual(s.apiCalls.map(c => c[0]), ['pin', 'pin']);
});

test('открепление одного сообщения не трогает остальные', async () => {
  const s = setup();
  await s.actions.pinMessage('chat', 'm2');
  await s.actions.pinMessage('chat', 'm1');
  await s.actions.unpinMessage('chat', 'm2');
  assert.deepEqual([...s.chat().pinnedMessageIds], ['m1']);
  assert.deepEqual(s.msgs().map(m => !!m.isPinned), [true, false]);
  assert.equal(s.prefs()?.id, 'm1');
  assert.deepEqual(s.apiCalls.map(c => c[0]), ['pin', 'pin', 'unpin']);
});

test('пустой список от сервера снимает все закрепления', async () => {
  const s = setup();
  await s.actions.pinMessage('chat', 'm1');
  s.actions.applyPinnedMessage('chat', null, null, []);
  assert.deepEqual([...s.chat().pinnedMessageIds], []);
  assert.deepEqual(s.msgs().map(m => !!m.isPinned), [false, false]);
  assert.equal(s.prefs(), null);
  // Открепление последнего: список пуст, хотя messageId указан — пин не возвращается.
  await s.actions.pinMessage('chat', 'm2');
  s.actions.applyPinnedMessage('chat', 'm2', null, []);
  assert.deepEqual([...s.chat().pinnedMessageIds], []);
  assert.equal(s.msgs().some(m => m.isPinned), false);
});

test('payload старого формата без списка работает как раньше', () => {
  const s = setup();
  s.actions.applyPinnedMessage('chat', 'legacy', { id: 'legacy', content: 'x' });
  assert.deepEqual([...s.chat().pinnedMessageIds], ['legacy']);
  assert.equal(s.prefs()?.id, 'legacy');
});

test('P2P: список ведётся локально, REST не вызывается', async () => {
  const s = setup({ peerMode: true });
  await s.actions.pinMessage('chat', 'm1');
  await s.actions.pinMessage('chat', 'm2');
  assert.deepEqual([...s.chat().pinnedMessageIds], ['m2', 'm1']);
  assert.deepEqual([...s.peerCalls.at(-1)[1].pinnedMessageIds], ['m2', 'm1']);
  await s.actions.unpinMessage('chat', 'm1');
  assert.deepEqual([...s.chat().pinnedMessageIds], ['m2']);
  assert.equal(s.apiCalls.length, 0);
});

test('закрепление временного сообщения ждёт подтверждение сервера', async () => {
  const s = setup();
  await assert.rejects(s.actions.pinMessage('chat', 'temp-1'), /ещё отправляется/);
  await assert.rejects(s.actions.unpinMessage('chat', 'temp-1'), /ещё отправляется/);
  assert.equal(s.apiCalls.length, 0);
  // Подтверждение пришло (clientTempId совпал) — действие по реальному id.
  s.state().messages.chat.push({ id: 'server-1', chatId: 'chat', senderId: 'alice', content: 'hi', clientTempId: 'temp-1' });
  await s.actions.pinMessage('chat', 'temp-1');
  assert.deepEqual([...s.apiCalls.at(-1)], ['pin', 'server-1', 'chat']);
  assert.deepEqual([...s.chat().pinnedMessageIds], ['server-1']);
});

