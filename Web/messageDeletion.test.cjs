const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, 'src/store/chatStore.ts'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
// Как section, но конец ищется ПОСЛЕ начала: маркер типа `applyPinnedMessage:`
// сначала встречается в интерфейсе ChatState, а не в реализации стора.
const sectionFrom = (start, end) => {
  const s = source.indexOf(start);
  return source.slice(s, source.indexOf(end, s));
};
const helpers = section('/* ---------- Локальные заглушки сообщений', 'interface ChatState');

// ── deleteMessage: успех уходит в анимированное удаление, ошибка — не трогает ──
function setupDelete({ fail = false } = {}) {
  let state = {
    messages: { chat: [{ id: 'm1', chatId: 'chat', senderId: 'alice', content: 'hi' }] },
    chats: [{ id: 'chat', type: 'direct' }],
    activeChat: { id: 'chat' },
  };
  const calls = [];
  const context = vm.createContext({
    console: { error: () => {}, log: () => {}, warn: () => {} },
    navigator: { onLine: true }, VERA_AI_ID: 'vera-ai',
    isPeerAvailable: () => false,
    useAuthStore: { getState: () => ({ user: { id: 'alice' } }) },
    saveArchivedMessages: async () => {}, attachReplyPreview: m => m,
    set: update => { state = { ...state, ...update(state) }; },
    get: () => ({ ...state, ...context.actions }),
    calls,
    messagesApi: {
      delete: async (id) => {
        calls.push(['delete', id]);
        if (fail) throw new Error('boom');
        return { data: { success: true } };
      },
    },
  });
  const handler = section('  deleteMessage: async', '  pinMessage: async');
  vm.runInContext(ts.transpileModule(`${helpers}
globalThis.actions = { ${handler}
  removeMessageAnimated(id, chatId) { calls.push(['animated', id, chatId]); },
};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return { actions: context.actions, state: () => state, calls };
}

test('успешное удаление сообщения идёт через анимацию распада', async () => {
  const s = setupDelete();
  await s.actions.deleteMessage('m1', 'chat');
  // JSON-обход: массивы из vm-контекста имеют чужой прототип.
  assert.deepEqual(JSON.parse(JSON.stringify(s.calls)), [
    ['delete', 'm1'],
    ['animated', 'm1', 'chat'],
  ]);
});

test('ошибка сервера НЕ удаляет сообщение и не запускает анимацию', async () => {
  const s = setupDelete({ fail: true });
  await assert.rejects(s.actions.deleteMessage('m1', 'chat'), /boom/);
  assert.deepEqual(s.calls, [['delete', 'm1']]);
  assert.equal(s.state().messages.chat.length, 1, 'сообщение остаётся в ленте');
});

// ── removeMessageAnimated: флаг → пауза → реальное удаление → сброс флага ──
function setupAnimated({ reducedMotion = false } = {}) {
  let state = {
    messages: { chat: [{ id: 'm1', chatId: 'chat', senderId: 'alice', content: 'hi' }] },
    deletingMessageIds: new Set(),
  };
  const events = [];
  const context = vm.createContext({
    console: { error: () => {}, log: () => {}, warn: () => {} },
    setTimeout, clearTimeout,
    // Короткая пауза — тест не ждёт реальные 360 мс.
    MESSAGE_DELETE_EXIT_MS: 20,
    prefersReducedMotion: () => reducedMotion,
    deletedMessageIds: new Set(),
    set: update => { state = { ...state, ...update(state) }; },
    get: () => ({ ...state, ...context.actions }),
  });
  const handler = sectionFrom('  removeMessageAnimated: async', '\n  applyPinnedMessage: (chatId,');
  vm.runInContext(ts.transpileModule(`${helpers}
globalThis.actions = { ${handler}
  removeMessage(id, chatId) {
    __deleted.add(id);
    globalThis.__messages = (globalThis.__messages || []).filter(m => m.id !== id);
    globalThis.__events.push(['removed', id, chatId]);
  },
};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  context.__deleted = context.deletedMessageIds;
  context.__events = events;
  context.__messages = state.messages.chat;
  return { actions: context.actions, state: () => state, events };
}

test('removeMessageAnimated: выставляет флаг, ждёт анимацию и удаляет сообщение', async () => {
  const s = setupAnimated();
  await s.actions.removeMessageAnimated('m1', 'chat');
  assert.deepEqual(JSON.parse(JSON.stringify(s.events)), [['removed', 'm1', 'chat']]);
  assert.equal(s.state().deletingMessageIds.size, 0, 'флаг анимации очищен');
});

test('removeMessageAnimated при reduced-motion удаляет сразу без паузы', async () => {
  const s = setupAnimated({ reducedMotion: true });
  await s.actions.removeMessageAnimated('m1', 'chat');
  assert.deepEqual(JSON.parse(JSON.stringify(s.events)), [['removed', 'm1', 'chat']]);
  assert.equal(s.state().deletingMessageIds.size, 0, 'флаг не выставлялся');
});

// ── MessageBubble: строка сообщения участвует в анимации распада ──
test('MessageBubble подписан на флаг удаления и запускает распад частиц', () => {
  const bubble = fs.readFileSync(path.join(__dirname, 'src/components/MessageBubble.tsx'), 'utf8');
  assert.ok(bubble.includes('s.deletingMessageIds.has(message.id)'), 'подписка на флаг');
  assert.ok(bubble.includes('spawnMessageDust('), 'спавн частиц');
  assert.ok(bubble.includes('MESSAGE_DELETE_EXIT_MS'), 'схлопывание строки = паузе стора');
});

// ── messageDust: портал в body, keyframes, reduced-motion ──
test('messageDust создаёт портал с keyframes и уважает prefers-reduced-motion', () => {
  const dust = fs.readFileSync(path.join(__dirname, 'src/utils/messageDust.ts'), 'utf8');
  assert.ok(dust.includes('vera-message-dust'), 'keyframes именованы');
  assert.ok(dust.includes('prefers-reduced-motion'), 'проверка reduced-motion');
  assert.ok(dust.includes('document.body.appendChild'), 'частицы живут в портале');
});

// ── ChatWindow: автоскролл не дёргает ленту вниз при удалении сообщения ──
test('ChatWindow пинит низ только при открытии чата, а не на каждое изменение длины', () => {
  const win = fs.readFileSync(path.join(__dirname, 'src/components/ChatWindow.tsx'), 'utf8');
  assert.ok(win.includes('const openedNow = !restoredRef.current'), 'жёсткий пин привязан к открытию чата');
  assert.ok(win.includes('(openedNow && ticks <= 4)'), 'безусловная фиксация низа в первые тики — только при открытии');
  // Старый баг: на каждый перезезапуск эффекта (в т.ч. после удаления)
  // шёл безусловный pinToBottom() до восстановления restoredRef.
  assert.ok(
    !/pinToBottom\(\);\s*\n\s*atBottomRef\.current = true;\s*\n\s*restoredRef\.current = true;/.test(win),
    'нет безусловного pinToBottom на каждом перезапуске эффекта',
  );
});
