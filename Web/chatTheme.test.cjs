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


// ── Корпус сообщения: пузырь и панель действий — одна фигура ─────────────────

const bubbleSource = fs.readFileSync(path.join(__dirname, 'src/components/MessageBubble.tsx'), 'utf8');

test('фон, рамку, тень и размытие сообщения рисует один корпус', () => {
  const shell = bubbleSource.slice(
    bubbleSource.indexOf('const bubbleShellSx'),
    bubbleSource.indexOf('const actionIconSx'),
  );
  assert.ok(shell.length > 0, 'корпус объявлен');
  // Фон, скругление, тень и размытие — общие для пузыря и панели.
  assert.ok(shell.includes('background: shellBackground'), 'фон корпуса = фон пузыря (вместе со скином)');
  assert.ok(shell.includes('borderRadius: shellRadius'), 'одно скругление на пузырь и панель');
  assert.ok(shell.includes('boxShadow: !bubbleEnabled'), 'тень у корпуса');
  assert.ok(shell.includes('backdropFilter: !bubbleEnabled'), 'размытие у корпуса');
  // Панель занимает ровно ACTIONS_PANEL_HEIGHT и ровно столько же вычитается из
  // раскладки: сообщение «растёт» только визуально, лента не прыгает.
  assert.ok(
    shell.includes("marginBottom: actionsOpen && actionsPlacement === 'below' ? -ACTIONS_PANEL_HEIGHT : 0"),
    'высота панели вычтена из раскладки',
  );
  assert.ok(
    shell.includes("flexDirection: actionsPlacement === 'above' ? 'column-reverse' : 'column'"),
    'панель сверху — тот же корпус, развёрнутый вверх',
  );
});

test('пузырь внутри корпуса не рисует фон и рамку повторно', () => {
  const bubble = bubbleSource.slice(
    bubbleSource.indexOf('data-vera-bubble'),
    bubbleSource.indexOf("'& > *'"),
  );
  assert.ok(bubble.length > 0, 'содержимое пузыря на месте');
  // Двойная заливка и лишняя рамка на стыке — то, из-за чего панель выглядела
  // «приклеенной» отдельной плашкой.
  assert.ok(!/^\s*background:/m.test(bubble), 'фон рисует только корпус');
  assert.ok(!bubble.includes('boxShadow'), 'тень рисует только корпус');
  assert.ok(!/^\s*border:/m.test(bubble), 'рамку рисует только корпус');
  assert.ok(bubble.includes("backdropFilter: 'none'"), 'размытие не дублируется');
  // content-visibility должен остаться на пузыре: paint containment обрезал бы
  // панель, которая выходит за его пределы.
  assert.ok(
    bubble.includes("contentVisibility: bubbleEnabled ? 'auto' : 'visible'"),
    'content-visibility остаётся на содержимом, а не на корпусе',
  );
  assert.ok(bubble.includes('...innerSkinSx'), 'цвет текста и отступы остаются на пузыре');
});

test('скругление панели совпадает со скруглением пузыря', () => {
  const radius = bubbleSource.slice(
    bubbleSource.indexOf('const bubbleRadiusCss'),
    bubbleSource.indexOf('const bubbleShadow'),
  );
  assert.ok(radius.includes('var(--vera-bubble-radius, 16px)'), 'радиус берётся из настройки пузыря');
  assert.ok(/isOwnSide[\s\S]*?\$\{bubbleRadiusCss\} \$\{bubbleRadiusCss\} 4px \$\{bubbleRadiusCss\}/.test(radius), 'свои: угол-хвостик справа');
  assert.ok(radius.includes('`${bubbleRadiusCss} ${bubbleRadiusCss} ${bubbleRadiusCss} 4px`'), 'чужие: угол-хвостик слева');
  // Скругление скина (магазин/авторы) тоже достаётся корпусу.
  assert.ok(
    bubbleSource.includes('const [shellSkinSx, innerSkinSx] = splitBubbleSkin(bubbleSkinSx)'),
    'скин делится на корпус и содержимое',
  );
  assert.ok(bubbleSource.includes('borderRadius: shellRadius'), 'корпус использует выбранное скругление');
});

test('панель действий продолжает корпус и открывается из уголка пузыря', () => {
  // Панель вместе со своим sx: от условия монтирования до закрывающего </Box>.
  const start = bubbleSource.indexOf('{actionsOpen && (');
  const panel = bubbleSource.slice(start, bubbleSource.indexOf('</Box>', start));
  assert.ok(panel.length > 0, 'кнопки на месте');
  assert.ok(bubbleSource.includes('const actionIconSx'), 'общий стиль иконок объявлен');
  assert.ok(panel.includes('actionIconSx'), 'иконки берут общий стиль');
  assert.ok(!panel.includes('color: theme.textSec'), 'иконки панели не используют theme.textSec');
  // Высота панели — та же константа, которой корпус компенсирует её в раскладке.
  assert.ok(panel.includes('height: ACTIONS_PANEL_HEIGHT'), 'высота панели = константе');
  assert.ok(panel.includes("alignSelf: 'stretch'"), 'панель во всю ширину корпуса');
  assert.ok(panel.includes('veraActionsIn'), 'иконки выезжают из-под пузыря');
  // Своего фона и тени у панели нет — их рисует корпус.
  assert.ok(!panel.includes('boxShadow'), 'у панели нет своей тени');
  assert.ok(!panel.includes("position: 'absolute'"), 'панель не висит поверх, а продолжает корпус');
  // Открывается из нижнего уголка пузыря, а не на любое наведение.
  assert.ok(bubbleSource.includes('inActionsCorner('), 'уголок вызова');
  assert.ok(!/onPointerEnter=\{[^}]*hoverSelf/.test(bubbleSource), 'наведение на пузырь панель не открывает');
});


// ── Редактор тем: плашка и режим чата ────────────────────────────────────────

const editorSource = fs.readFileSync(path.join(__dirname, 'src/components/ThemeEditor.tsx'), 'utf8');

test('редактор тем открывается плашкой во всю высоту, а не карточкой 820px', () => {
  assert.ok(editorSource.includes("maxWidth: 'min(1680px, 100%)'"), 'плашка широкая — почти во весь экран');
  assert.ok(editorSource.includes("height: '100%'"), 'плашка во всю высоту');
  assert.ok(editorSource.includes("borderRadius: 22, width: '100%',"), 'плашка скруглена, но не в край экрана');
  assert.ok(editorSource.includes("backdropFilter: 'blur(22px)"), 'размытие как у нижней навигации');
  assert.ok(editorSource.includes('env(safe-area-inset-top)'), 'отступы учитывают вырез телефона');
  assert.ok(editorSource.includes('plateBody') && editorSource.includes('plateFooter'), 'есть прокручиваемое тело и липкий низ');
  assert.ok(/plateBody[\s\S]{0,200}overflowY:\s*'auto'/.test(editorSource), 'тело прокручивается');
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
