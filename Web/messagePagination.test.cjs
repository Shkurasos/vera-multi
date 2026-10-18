const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

/** utils/messagePagination.ts как CommonJS-модуль. */
function loadPagination() {
  const ctx = vm.createContext({ exports: {}, module: { exports: {} } });
  ctx.exports = ctx.module.exports;
  vm.runInContext(ts.transpileModule(read('src/utils/messagePagination.ts'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, ctx);
  return ctx.module.exports;
}
const pg = loadPagination();

const msg = (n, extra = {}) => ({
  id: `m${n}`, chatId: 'chat', senderId: 'bob', content: `#${n}`,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(), ...extra,
});

// ── Чистые функции ──
test('порог догрузки ≈ 20–30 сообщений по средней высоте', () => {
  assert.ok(pg.PREFETCH_AHEAD_MESSAGES >= 20 && pg.PREFETCH_AHEAD_MESSAGES <= 30);
  // 80 сообщений по 100px → 25 × 100 = 2500px
  assert.equal(pg.prefetchThresholdPx(8000, 80), 2500);
  // Без замеров — запасная высота, но не меньше минимума
  assert.ok(pg.prefetchThresholdPx(0, 0) >= 600);
  assert.equal(pg.shouldPrefetchOlder(2400, 2500), true);
  assert.equal(pg.shouldPrefetchOlder(2600, 2500), false);
});

test('курсор before — самое раннее подтверждённое сообщение, temp-* пропускаются', () => {
  assert.equal(pg.oldestCursor([{ id: 'temp-1', createdAt: 'x' }, msg(3), msg(4)]), msg(3).createdAt);
  assert.equal(pg.oldestCursor([]), undefined);
});

test('окно рендера растёт шагом и не превышает историю', () => {
  assert.equal(pg.nextRenderLimit(80, 1000), 80 + pg.RENDER_STEP);
  assert.equal(pg.nextRenderLimit(80, 100), 100);
});

test('компенсация prepend оставляет якорь на месте экрана', () => {
  // Якорь был в 10px от верха вьюпорта, после prepend оказался в 1510px
  assert.equal(pg.compensatedScrollTop(200, 10, 1510), 1700);
  // Браузер уже сам подвинул (scroll anchoring) — сдвига нет
  assert.equal(pg.compensatedScrollTop(1700, 10, 10), 1700);
});

// ── chatStore.loadOlderMessages ──
const store = read('src/store/chatStore.ts');
const section = (start, end) => store.slice(store.indexOf(start), store.indexOf(end));
const helpers = [
  section('/* ---------- Локальные заглушки сообщений', 'interface ChatState'),
  section('const deletedMessageIds', 'function veraAiChat'),
  section('/* ---------- Догрузка истории вверх', 'export const useChatStore'),
].join('\n');
const handler = section('  loadOlderMessages: async', '  sendMessage: async');

function setup(serverMessages, { fail = false } = {}) {
  let state = { messages: { chat: serverMessages.slice(-pg.OLDER_PAGE_SIZE) }, olderHistory: {}, chats: [], activeChat: null };
  const calls = [];
  const context = vm.createContext({
    console: { ...console, error() {} }, VERA_AI_ID: 'vera-ai',
    OLDER_PAGE_SIZE: pg.OLDER_PAGE_SIZE, oldestCursor: pg.oldestCursor,
    isPeerAvailable: () => false,
    saveArchivedMessages: async () => {},
    mergeById: (a, b) => {
      const map = new Map();
      for (const m of a) map.set(m.id, m);
      for (const m of b) map.set(m.id, m);
      return [...map.values()].sort((x, y) => Date.parse(x.createdAt) - Date.parse(y.createdAt));
    },
    set: (u) => { state = { ...state, ...(typeof u === 'function' ? u(state) : u) }; },
    get: () => ({ ...state, ...context.actions }),
    messagesApi: {
      getMessages: async (chatId, before, limit) => {
        calls.push({ before, limit });
        await new Promise((r) => setTimeout(r, 5));
        if (fail) throw new Error('offline');
        const b = Date.parse(before);
        return { data: serverMessages.filter((m) => Date.parse(m.createdAt) < b).slice(-limit) };
      },
    },
  });
  vm.runInContext(ts.transpileModule(`${helpers}\nglobalThis.actions = { ${handler} };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return { actions: context.actions, state: () => state, calls };
}

const history = Array.from({ length: 120 }, (_, i) => msg(i));

test('догрузка шлёт before = самое раннее сообщение и мержит без дублей', async () => {
  const { actions, state, calls } = setup(history);
  const commits = [];
  const added = await actions.loadOlderMessages('chat', (n) => commits.push(n));
  assert.equal(calls[0].before, history[70].createdAt);
  assert.equal(calls[0].limit, pg.OLDER_PAGE_SIZE);
  assert.equal(added, 50);
  assert.deepEqual(commits, [50], 'beforeCommit вызывается до записи со счётом новых');
  const ids = state().messages.chat.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, 'нет дубликатов');
  assert.equal(ids[0], 'm20');
  assert.equal(state().olderHistory.chat.hasMore, true);
});

test('параллельные вызовы склеиваются в один запрос', async () => {
  const { actions, calls } = setup(history);
  const [a, b] = await Promise.all([actions.loadOlderMessages('chat'), actions.loadOlderMessages('chat')]);
  assert.equal(calls.length, 1);
  assert.equal(a, b);
});

test('неполная страница → hasMore=false, дальше запросов нет', async () => {
  const { actions, state, calls } = setup(history);
  await actions.loadOlderMessages('chat'); // m20..m69
  await actions.loadOlderMessages('chat'); // m0..m19 — неполная
  assert.equal(state().messages.chat.length, 120);
  assert.equal(state().olderHistory.chat.hasMore, false);
  await actions.loadOlderMessages('chat');
  assert.equal(calls.length, 2, 'после hasMore=false сервер не трогаем');
});

test('ошибка сети не валит ленту и не спамит повторами', async () => {
  const { actions, state, calls } = setup(history, { fail: true });
  assert.equal(await actions.loadOlderMessages('chat'), 0);
  assert.equal(state().olderHistory.chat.loading, false);
  await actions.loadOlderMessages('chat');
  assert.equal(calls.length, 1, 'повтор только после паузы');
});

// ── Связка в ChatWindow ──
test('ChatWindow: ранняя догрузка, якорь прокрутки и без прыжка вниз', () => {
  const win = read('src/components/ChatWindow.tsx');
  assert.ok(win.includes('const maybePrefetchOlder = useCallback'));
  assert.ok(win.includes('prefetchThresholdPx(scrollHeight, rendered)'), 'порог по средней высоте');
  assert.ok(win.includes('loadOlderMessages(id, (added) =>'), 'когда окно исчерпано — сервер');
  assert.ok(win.includes('compensatedScrollTop(container.scrollTop, anchor.top, newTop)'), 'компенсация prepend');
  assert.ok(win.includes('if (prevLastKey && prevLastKey === lastKey) return;'), 'догрузка сверху не скроллит вниз');
  assert.ok(!win.includes('scrollTop < 80'), 'старый триггер у самой кромки убран');
});
