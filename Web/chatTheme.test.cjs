const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, 'src/utils/chatTheme.ts'), 'utf8');
// Убираем модульный синтаксис: код выполняется в vm как обычный скрипт.
const script = source
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/\bexport function\b/g, 'function');
const context = vm.createContext({});
vm.runInContext(
  ts.transpileModule(`${script}\nglobalThis.resolveChatTheme = resolveChatTheme;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText,
  context,
);
const resolveChatTheme = context.resolveChatTheme;

/** Общая тема с градиентом своих пузырей — как у встроенных тем VERA. */
const baseTheme = (over) => ({
  id: 1, name: 'Общая', bg: '#101010', text: '#fff', accent: '#7c6af7',
  bgSidebar: '#181818', bgChat: '#101010', bgHeader: '#181818', bgInput: '#202020',
  bgBubbleOwn: '#6C5CE7', bgBubbleOther: '#2A2A3A',
  bgHover: '#202020', bgActive: '#282828', textSec: '#9a9aa5',
  border: 'rgba(255,255,255,0.1)', online: '#4CAF50',
  bubbleOwnGradient: 'linear-gradient(135deg, #6C5CE7 0%, #4A3F9F 100%)',
  bubbleOwnShadow: '0 6px 20px rgba(124,106,247,0.26)',
  bubbleOtherShadow: '0 2px 8px rgba(0,0,0,0.24)',
  ...over,
});

// Быстрые пресеты персональных тем не задают градиент — раньше он подтягивался
// из общей темы, и смена общей темы перекрашивала свои пузыри в этом чате.
const preset = { enabled: true, accent: '#ff8fb1', bubbleOwn: '#8b2f56', bubbleOther: '#3a2f40', bg: '#241b22' };

test('персональная тема без градиента не тянет градиент и тень общей темы', () => {
  const theme = resolveChatTheme(baseTheme(), preset);
  assert.equal(theme.bgBubbleOwn, '#8b2f56');
  assert.equal(theme.bgBubbleOther, '#3a2f40');
  assert.equal(theme.bubbleOwnGradient, undefined);
  assert.equal(theme.bubbleOwnShadow, undefined);
  assert.equal(theme.bubbleOtherShadow, undefined);
  assert.equal(theme.accent, '#ff8fb1');
  assert.equal(theme.bgChat, '#241b22');
});

test('смена общей темы не меняет свои пузыри в персонализированном чате', () => {
  const afterGlobalChange = baseTheme({
    accent: '#00ff00', bgBubbleOwn: '#00ff00', bgBubbleOther: '#00ff0033',
    bubbleOwnGradient: 'linear-gradient(135deg, #00ff00, #006600)',
  });
  const theme = resolveChatTheme(afterGlobalChange, preset);
  assert.equal(theme.bgBubbleOwn, '#8b2f56');
  assert.equal(theme.bubbleOwnGradient, undefined);
  assert.equal(theme.accent, '#ff8fb1');
});

test('полный формат редактора (bgBubbleOwn) тоже отменяет градиент общей темы', () => {
  const theme = resolveChatTheme(baseTheme(), { enabled: true, bgBubbleOwn: '#14532d', bgBubbleOther: '#1f3a28' });
  assert.equal(theme.bgBubbleOwn, '#14532d');
  assert.equal(theme.bubbleOwnGradient, undefined);
});

test('свой градиент персональной темы сохраняется', () => {
  const gradient = 'linear-gradient(135deg, #f472b6, #7a2050)';
  const theme = resolveChatTheme(baseTheme(), { enabled: true, bubbleOwn: '#7a2050', bubbleOwnGradient: gradient });
  assert.equal(theme.bubbleOwnGradient, gradient);
});

test('без персональных цветов пузыри остаются от общей темы', () => {
  const theme = resolveChatTheme(baseTheme(), { enabled: true, accent: '#ffb347' });
  assert.equal(theme.bgBubbleOwn, '#6C5CE7');
  assert.equal(theme.bubbleOwnGradient, 'linear-gradient(135deg, #6C5CE7 0%, #4A3F9F 100%)');
  assert.equal(theme.accent, '#ffb347');

// ── Сброс до стандартной темы (кнопка «Сбросить на стандартную») ───────────────
// Кнопка вызывает removeChatTheme(chatId): запись чата удаляется, и чат снова
// следует за общей темой. Проверяем на настоящем сторе, а не на заглушке.
function loadChatThemeStore() {
  const storeSource = fs.readFileSync(path.join(__dirname, 'src/store/chatThemeStore.ts'), 'utf8');
  const c = vm.createContext({
    console,
    exports: {},
    module: { exports: {} },
    require: (name) => {
      if (name === 'zustand') {
        // Минимальный zustand: create() возвращает стор с getState/setState.
        return {
          create: () => (factory) => {
            const api = {};
            const set = (update) => {
              const next = typeof update === 'function' ? update(api.state) : update;
              Object.assign(api.state, next);
            };
            api.state = factory(set, () => api.state);
            api.getState = () => api.state;
            api.setState = set;
            return api;
          },
        };
      }
      if (name === 'zustand/middleware') return { persist: (factory) => factory };
      if (name.includes('storeSyncSimple')) return { enableStoreSync: () => {} };
      throw new Error('unexpected require: ' + name);
    },
  });
  vm.runInContext(
    ts.transpileModule(storeSource, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText,
    c,
  );
  return c.exports.useChatThemeStore;
}

test('removeChatTheme возвращает чат к общей теме, не трогая темы других чатов', () => {
  const useChatThemeStore = loadChatThemeStore();
  const base = baseTheme();

  // Персональные темы на двух чатах.
  useChatThemeStore.getState().setChatTheme('chat-1', preset);
  useChatThemeStore.getState().setChatTheme('chat-2', { enabled: true, accent: '#67e68f' });
  assert.equal(resolveChatTheme(base, useChatThemeStore.getState().getTheme('chat-1')).accent, '#ff8fb1');

  // Сброс чата 1 — то, что делает кнопка.
  useChatThemeStore.getState().removeChatTheme('chat-1');

  const after = useChatThemeStore.getState();
  assert.equal(after.getTheme('chat-1'), undefined, 'персональная тема чата удалена');
  // Чат снова следует за общей темой — это и есть «сброс до стандартной».
  assert.equal(resolveChatTheme(base, after.getTheme('chat-1')), base);

  // Тема второго чата не задето.
  assert.equal(after.getTheme('chat-2').accent, '#67e68f');
  assert.equal(resolveChatTheme(base, after.getTheme('chat-2')).accent, '#67e68f');

  // Повторный сброс не падает и не трогает остальное.
  useChatThemeStore.getState().removeChatTheme('chat-1');
  assert.equal(useChatThemeStore.getState().getTheme('chat-2').accent, '#67e68f');
});

});

test('выключенная и отсутствующая персональная тема возвращает общую', () => {
  const base = baseTheme();
  assert.equal(resolveChatTheme(base, { enabled: false }), base);
  assert.equal(resolveChatTheme(base, undefined), base);
  assert.equal(resolveChatTheme(base, null), base);
});
