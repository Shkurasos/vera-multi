const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, 'src/store/chatStore.ts'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const helpers = section('/* ---------- Локальные заглушки сообщений', 'interface ChatState');

function setup({ p2p = false, fail = false } = {}) {
  let state = { messages: {}, chats: [{ id: 'chat', type: 'direct' }], activeChat: { id: 'chat' } };
  const sent = [];   // вызовы messagesApi.send
  const stored = []; // вызовы peer.storeMessage (P2P)
  const context = vm.createContext({
    console: { error: () => {}, log: () => {}, warn: () => {} },
    navigator: { onLine: true }, VERA_AI_ID: 'vera-ai',
    isPeerAvailable: () => p2p,
    peer: {
      storeMessage: async (msg) => {
        stored.push(msg);
        return { id: `p2p-${stored.length}`, ts: Date.now() };
      },
    },
    useAuthStore: { getState: () => ({ user: { id: 'alice' } }) },
    saveArchivedMessages: async () => {}, attachReplyPreview: m => m,
    set: update => { state = { ...state, ...update(state) }; },
    get: () => ({ ...state, ...context.actions }),
    messagesApi: {
      send: async (chatId, body) => {
        if (fail) throw new Error('boom');
        sent.push(body);
        const data = { ...body, id: `server-${sent.length}`, chatId, content: body.text, senderId: 'alice' };
        return { data };
      },
    },
  });
  const handler = section('  sendMessageWithFile: async', '  editMessage: async');
  // removeMessage нужен обработчику ошибки в sendMessageWithFile (удаление заглушки).
  context.__removeMessage = (id, chatId) => {
    state.messages[chatId] = (state.messages[chatId] || []).filter(x => x.id !== id);
  };
  vm.runInContext(ts.transpileModule(`${helpers}
globalThis.actions = { ${handler} removeMessage(id, chatId) { __removeMessage(id, chatId); } };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return { actions: context.actions, state: () => state, sent, stored };
}

const att = (i) => ({ id: `a${i}`, fileUrl: `/api/files/f${i}.png`, mimeType: 'image/png', fileName: `f${i}.png` });

test('multiple photos are sent as ONE album message with a caption', async () => {
  const s = setup();
  await s.actions.sendMessageWithFile('chat', [att(1), att(2), att(3)], undefined, 'photo', 'подпись');
  assert.equal(s.sent.length, 1, 'одним вызовом send, а не тремя');
  const body = s.sent[0];
  assert.equal(body.attachments.length, 3);
  assert.equal(body.text, 'подпись');
  assert.equal(body.type, 'photo');
  assert.equal(body.clientTempId.startsWith('temp-'), true, 'контракт clientTempId сохранён');
});

test('single attachment stays compatible (voice/round use object form)', async () => {
  const s = setup();
  await s.actions.sendMessageWithFile('chat', att(1), undefined, 'voice');
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].attachments.length, 1);
  assert.equal(s.sent[0].type, 'voice');
});

test('P2P mesh stores album as one message per attachment, text on the first', async () => {
  const s = setup({ p2p: true });
  await s.actions.sendMessageWithFile('chat', [att(1), att(2), att(3)], undefined, 'photo', 'подпись');
  assert.equal(s.stored.length, 3, 'mesh не умеет несколько вложений — по одному');
  assert.equal(s.stored[0].text, 'подпись');
  assert.equal(s.stored[1].text, '');
  assert.equal(s.stored[2].text, '');
  assert.equal(s.sent.length, 0, 'в P2P messagesApi.send не вызывается');
  // Локально остаются ровно 3 подтверждённых сообщения (заглушка удалена).
  const msgs = s.state().messages.chat;
  assert.equal(msgs.length, 3);
  assert.ok(msgs.every(m => !m.id.startsWith('temp-')));
});

test('failed album send removes the temp message and rethrows', async () => {
  const s = setup({ fail: true });
  await assert.rejects(
    s.actions.sendMessageWithFile('chat', [att(1), att(2)], undefined, 'photo'),
    /boom/
  );
  assert.equal(s.state().messages.chat.length, 0, 'заглушка удалена после ошибки');
});
