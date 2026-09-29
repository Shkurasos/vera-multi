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


// ── Панель быстрых действий: уголок, шов и стабильный ховер ────────────────────

const bubbleSource = fs.readFileSync(path.join(__dirname, 'src/components/MessageBubble.tsx'), 'utf8');

test('уголок открывает панель без повторных замеров геометрии', () => {
  // Регрессия: getBoundingClientRect в pointermove читал рамку, уже сдвинутую
  // подъёмом пузыря, — тест уголка «переворачивался» туда-сюда, панель мигала
  // сама по себе, сообщение дрожало и лента проседала из-за layout-пересчётов.
  assert.ok(bubbleSource.includes('onPointerMove={(e) => {'), 'обработчик движения есть');
  const moveAt = bubbleSource.indexOf('onPointerMove={(e) => {');
  const handler = bubbleSource.slice(moveAt, bubbleSource.indexOf('}}', moveAt) + 2);
  assert.ok(!handler.includes('getBoundingClientRect'), 'в pointermove нет обращений к DOM');
  assert.ok(
    /bubbleRectRef\.current = e\.currentTarget\.getBoundingClientRect\(\)/.test(bubbleSource),
    'прямоугольник снимается один раз на вход',
  );
  assert.ok(bubbleSource.includes('inActionsCorner('), 'проверка идёт по сохранённому прямоугольнику');
  assert.ok(bubbleSource.includes('{actionsOpen && ('), 'панель монтируется по своему состоянию, а не по любому ховеру');
});

test('панель — прозрачная стеклянная плашка со скруглением, сообщение не двигается', () => {
  const start = bubbleSource.indexOf('{actionsOpen && (');
  const panel = bubbleSource.slice(start, bubbleSource.indexOf('</Box>', start));
  assert.ok(panel.length > 0, 'кнопки на месте');
  // Раскладка ленты не меняется: панель висит поверх строки.
  assert.ok(panel.includes("position: 'absolute'"), 'абсолютное позиционирование');
  assert.ok(panel.includes("width: 'max-content'"), 'ширина по содержимому, без растяжки в полную ширину');
  // Прозрачная «стеклянная» плашка: подложка отдельным слоем под кнопками.
  assert.ok(panel.includes("background: 'transparent'"), 'сама панель прозрачная');
  assert.ok(panel.includes('&::before'), 'видимая подложка — отдельный слой');
  assert.ok(panel.includes("isolation: 'isolate'"), 'слой не уезжает под фон чата');
  assert.ok(/backdropFilter: 'blur\(/.test(panel), 'подложка с размытием');
  assert.ok(panel.includes('borderRadius: 14'), 'скругление со всех сторон');
  assert.ok(!panel.includes('panelBackground'), 'цвет пузыря в панель не переносится');
  // Мостик наведения: панель чуть заходит на пузырь и имеет невидимый верхний
  // отступ — курсор не теряет ховер на переходе с пузыря на кнопки.
  assert.ok(panel.includes("calc(100% - 2px)"), 'панель примыкает к пузырю');
  assert.ok(panel.includes("pt: actionsPlacement === 'below' ? '12px' : 0"), 'прозрачный мостик наведения');
});

test('скин пузыря остаётся на пузыре', () => {
  // Скины ломались, когда фон/рамку/тень переносили на внешнюю оболочку:
  // декоративные слои скина («&::before», background-position, clip/mask)
  // привязаны к самому пузырю.
  assert.ok(
    /isOwnSide \? equippedBubbleSx : mirrorBubble\(equippedBubbleSx\)/.test(bubbleSource),
    'скин по-прежнему раскидывается по пузырю',
  );
  assert.ok(!bubbleSource.includes('splitBubbleSkin'), 'скин не делится на «корпус» и содержимое');
  assert.ok(!bubbleSource.includes('bubbleShellSx'), 'внешняя оболочка вокруг пузыря не вернулась');
});


// ── Редактор тем: центр экрана и режим чата ──────────────────────────────────

const editorSource = fs.readFileSync(path.join(__dirname, 'src/components/ThemeEditor.tsx'), 'utf8');

test('редактор — полноэкранная плашка в портале, а не карточка 86vh', () => {
  // Плашка во всю высоту: маленькие поля, приложение видно по краям.
  assert.ok(editorSource.includes("alignItems: 'stretch'"), 'плашка растянута на всю высоту');
  assert.ok(editorSource.includes("height: '100%'"), 'плашка во весь экран');
  assert.ok(editorSource.includes("maxWidth: 'min(1680px, 100%)'"), 'по ширине — почти весь экран');
  assert.ok(editorSource.includes("borderRadius: 22, width: '100%',"), 'скруглена, но не в край экрана');
  assert.ok(editorSource.includes("backdropFilter: 'blur(22px)"), 'размытие как у нижней навигации');
  assert.ok(editorSource.includes('env(safe-area-inset-top)'), 'отступы учитывают вырез телефона');
  assert.ok(editorSource.includes('plateBody') && editorSource.includes('plateFooter'), 'есть прокручиваемое тело и липкий низ');
  assert.ok(/plateBody[\s\S]{0,200}overflowY:\s*'auto'/.test(editorSource), 'тело прокручивается');
  // Редактор монтируется внутри сайдбара, а его корневой Box с backdrop-filter
  // становится containing block для position:fixed — без портала в body плашка
  // рисуется в панели чатов (узкая и низкая).
  assert.ok(editorSource.includes('createPortal'), 'оверлей выносится порталом');
  assert.ok(/createPortal\(content, document\.body\)/.test(editorSource), 'портал именно в body');
});

test('редактор чата не предлагает то, чего в чате нет', () => {
  // Поля сайдбара и списка в окне чата не рисуются — сверено с обращениями
  // к theme.* в ChatWindow/MessageBubble.
  for (const label of ['Сайдбар', 'Активный элемент', 'Время в списке чатов']) {
    const line = editorSource.split('\n').find((l) => l.includes(`label="${label}"`));
    assert.ok(line, `поле «${label}» есть в редакторе`);
    assert.ok(line.includes('!isChat'), `«${label}» должно быть скрыто в режиме чата`);
  }
  assert.ok(/\{!isChat && \(\s*<>/.test(editorSource), 'блоки сайдбара скрыты в режиме чата');
  assert.ok(editorSource.includes('!isChat && (\n        <div style={{'), 'ИИ-генерация скрыта в режиме чата');
});

test('переключатель применения темы попадает в шапку плашки, а не в лишнее окно', () => {
  const dialog = fs.readFileSync(path.join(__dirname, 'src/components/ChatThemeDialog.tsx'), 'utf8');
  assert.ok(dialog.includes('mode="chat"'), 'редактор чата запускается в режиме chat');
  assert.ok(dialog.includes('headerExtra'), 'переключатель передаётся в шапку');
  // Раньше плашка накрывалась ещё и полноэкранным Dialog — двойная накладка.
  assert.ok(!dialog.includes('fullScreen'), 'лишний полноэкранный Dialog убран');
  assert.ok(editorSource.includes('headerExtra'), 'редактор умеет принимать элемент в шапку');
});
