const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, 'src/store/chatStore.ts'), 'utf8');
// Хелперы работы с локальными заглушками (`temp-*`) нужны replaceOrAddMessage.
const helpers = source.slice(
  source.indexOf('/* ---------- Локальные заглушки сообщений'),
  source.indexOf('interface ChatState'),
);
const handler = source.slice(source.indexOf('  replaceOrAddMessage: (message) => {'), source.indexOf('  addMessage: (message) => {'));

test('channel confirmation replaces the temporary post despite channel sender identity', () => {
  let state = {
    messages: { channel: [{ id: 'temp-post', chatId: 'channel', senderId: 'admin', content: 'Post' }] },
    chats: [{ id: 'channel', type: 'channel' }], activeChat: { id: 'channel' },
  };
  const context = vm.createContext({
    set: update => { state = { ...state, ...update(state) }; },
    saveArchivedMessages: async () => {},
    attachReplyPreview: message => message,
    useAuthStore: { getState: () => ({ user: { id: 'admin' } }) },
  });
  vm.runInContext(ts.transpileModule(`${helpers}\nconst actions = { ${handler} }; globalThis.confirm = actions.replaceOrAddMessage;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  const saved = { id: 'saved-post', clientTempId: 'temp-post', chatId: 'channel', senderId: 'channel', authorId: 'admin', content: 'Post' };
  context.confirm(saved);
  assert.equal(state.messages.channel.length, 1);
  assert.equal(state.messages.channel[0].id, 'saved-post');
  context.confirm(saved);
  assert.equal(state.messages.channel.length, 1);
});