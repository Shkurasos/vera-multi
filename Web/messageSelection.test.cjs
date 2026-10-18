const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

function loadSelectionStore() {
  let state;
  const context = { exports: {}, require: (name) => {
    if (name === 'zustand') return { create: (init) => {
      state = init((patch) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; }, () => state);
      return { getState: () => state };
    } };
    throw new Error(`Unexpected import: ${name}`);
  } };
  vm.runInNewContext(ts.transpileModule(read('src/store/messageSelectionStore.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return context.exports.useMessageSelectionStore;
}

test('выделение: старт, переключение и выход после снятия последней галочки', () => {
  const store = loadSelectionStore();
  store.getState().start('chat', 'm1');
  assert.equal(store.getState().chatId, 'chat');
  assert.equal(store.getState().count, 1);
  store.getState().toggle('m2');
  assert.equal(store.getState().count, 2);
  store.getState().toggle('m1');
  assert.equal(store.getState().count, 1);
  assert.ok(!store.getState().ids.m1);
  store.getState().toggle('m2');
  assert.equal(store.getState().chatId, null, 'пустое выделение выключает режим');
});

test('выделение: toggle без режима ничего не делает, clear сбрасывает', () => {
  const store = loadSelectionStore();
  store.getState().toggle('m1');
  assert.equal(store.getState().count, 0);
  store.getState().start('chat', 'm1');
  store.getState().clear();
  assert.equal(store.getState().chatId, null);
  assert.equal(store.getState().count, 0);
});

test('пункт «Выделить» есть в ПКМ-меню, а панель выделения пересылает и удаляет', () => {
  const bubble = read('src/components/MessageBubble.tsx');
  const chat = read('src/components/ChatWindow.tsx');
  assert.ok(bubble.includes("key: 'select', label: 'Выделить'"));
  assert.ok(bubble.includes('<RadioButtonUnchecked />'), 'пустой кружок у невыделенных');
  assert.ok(bubble.includes('<CheckCircle />'), 'кружок с галочкой у выделенных');
  assert.ok(chat.includes('handleForwardSelected'));
  assert.ok(chat.includes('handleDeleteSelected'));
});

test('chat:updated без lastMessage не роняет чат вниз списка', () => {
  const store = read('src/store/chatStore.ts');
  assert.ok(store.includes('lastMessage: normalized.lastMessage ?? c.lastMessage'));
});

test('активность доски поднимает чат: сортировка берёт updatedAt, touchChat работает', () => {
  const store = read('src/store/chatStore.ts');
  // Сортировка сообщений/списка идёт по максимуму из lastMessage и updatedAt —
  // иначе правка доски (updatedAt, без сообщения) не подняла бы чат.
  assert.ok(store.includes('export function chatActivityAt'), 'помощник активности экспортирован');
  assert.ok(store.includes('Math.max('), 'активность — максимум меток, а не первая непустая');
  assert.ok(store.includes('new Date(chatActivityAt(b)).getTime() - new Date(chatActivityAt(a)).getTime()'), 'список сортируется по активности');
  assert.ok(store.includes('touchChat: (chatId)'), 'стор умеет поднимать чат');
  // Серверный chat:updated приходит БЕЗ updatedAt — локальный пинг не должен
  // откатываться при каждом обновлении чата (имя, обои, участники).
  assert.ok(store.includes('updatedAt: normalized.updatedAt || c.updatedAt'), 'updatedAt не затирается пустым');
  // Сайдбар и App слышат правку доски.
  const sidebar = read('src/components/Sidebar.tsx');
  assert.ok(sidebar.includes('chatActivityAt(b)'), 'сайдбар сортирует по активности');
  assert.ok(sidebar.includes('updatedAt={chatActivityAt(chat)}'), 'время в строке — по активности, включая доску/холст');
  const app = read('src/App.tsx');
  assert.ok(app.includes("socket.on('proto-board:updated'"), 'App слушает правки доски');
  assert.ok(app.includes('touchChat(payload.chatId)'), 'и поднимает чат по событию');
  // Сервер двигает updatedAt родительского чата при сохранении доски/холста.
  const board = read('../Server/proto-board.js').replace(/\\/g, '/');
  assert.ok(board.includes('chat.updatedAt = board.updatedAt'), 'доска поднимает updatedAt чата на сервере');
});
