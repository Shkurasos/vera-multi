const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

/** Загружает uiPrefsStore с минимальным стендом zustand/localStorage. */
function loadUiPrefs() {
  const context = vm.createContext({
    console,
    exports: {},
    module: { exports: {} },
    document: { documentElement: { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } } },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    require: (name) => {
      if (name === 'zustand') {
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
      // Чистый модуль без зависимостей: транспилируем и отдаём как есть.
      if (name === '../utils/colorAlpha' || name === '../utils/avatarColors') {
        const loadPure = (file, req) => {
          const sub = { exports: {} };
          vm.runInContext(
            ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
              compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
            }).outputText,
            vm.createContext({ exports: sub.exports, module: sub, require: req }),
          );
          return sub.exports;
        };
        if (name === '../utils/colorAlpha') return loadPure('src/utils/colorAlpha.ts');
        // avatarColors берёт readableTextOn из соседнего contrast.ts.
        return loadPure('src/utils/avatarColors.ts', (dep) => {
          if (dep === './contrast') return loadPure('src/utils/contrast.ts');
          throw new Error('unexpected require: ' + dep);
        });
      }
      throw new Error('unexpected require: ' + name);
    },
  });
  vm.runInContext(
    ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src/store/uiPrefsStore.ts'), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText,
    context,
  );
  // CHAT_SHAPES и прочие — экспорты модуля, а не состояние стора.
  return {
    store: context.exports.useUiPrefsStore,
    shapes: context.exports.CHAT_SHAPES,
    packs: context.exports.ICON_PACKS,
    styles: context.exports.UI_STYLES,
    radii: context.exports.UI_STYLE_RADII,
    flatTargets: context.exports.UI_STYLE_FLAT_TARGETS,
    modes: context.exports.UI_MODES,
    switchStyleFor: context.exports.switchStyleFor,
    html: context.document.documentElement,
    exports: context.exports,
  };
}

test('три пресета формы карточек: от круглых к прямым, названия без брендов', () => {
  const { store, shapes: CHAT_SHAPES, html } = loadUiPrefs();

  assert.equal(CHAT_SHAPES.length, 3, 'ровно три варианта');
  assert.equal(JSON.stringify(CHAT_SHAPES.map((d) => d.id)), JSON.stringify(['vera', 'telegram', 'vk']));
  // Vera — текущий вид, самый круглый; дальше углы уходят к прямым.
  assert.equal(CHAT_SHAPES[0].radius, 63);
  assert.ok(CHAT_SHAPES[0].radius > CHAT_SHAPES[1].radius);
  assert.ok(CHAT_SHAPES[1].radius > CHAT_SHAPES[2].radius);
  for (const d of CHAT_SHAPES) {
    assert.ok(d.label && d.desc, 'у пресета есть подпись и описание');
    assert.ok(d.desc.includes(String(d.radius)), `описание «${d.desc}» упоминает радиус ${d.radius}`);
    // Названия описывают форму, а не чужие приложения.
    assert.ok(
      !/telegram|вк|vk|vera/i.test(d.label),
      `подпись «${d.label}» не должна ссылаться на приложение`,
    );
  }
  assert.equal(JSON.stringify(CHAT_SHAPES.map((d) => d.label)), JSON.stringify(['Круглые', 'Умеренные', 'Прямые']));

  // По умолчанию выбран Vera, и атрибут сразу попадает на <html>.
  assert.equal(store.getState().chatShape, 'vera');
  assert.equal(html.attrs['data-chat-shape'], 'vera');
});

test('обводку карточек можно снять, и она не зависит от формы', () => {
  const { store, html } = loadUiPrefs();

  // По умолчанию обводка включена.
  assert.equal(store.getState().chatBorder, true);
  assert.equal(html.attrs['data-chat-border'], 'on');

  store.getState().setChatBorder(false);
  assert.equal(html.attrs['data-chat-border'], 'off');
  // Снятие обводки не должно трогать форму.
  assert.equal(html.attrs['data-chat-shape'], 'vera');

  // И наоборот: смена формы не возвращает рамку обратно.
  store.getState().setChatShape('vk');
  assert.equal(html.attrs['data-chat-border'], 'off');
  assert.equal(html.attrs['data-chat-shape'], 'vk');

  store.getState().setChatBorder(true);
  assert.equal(html.attrs['data-chat-border'], 'on');

  // Соседние настройки не задеты.
  assert.equal(html.attrs['data-ui-style'], 'custom');
  assert.equal(html.attrs['data-icon-pack'], 'filled');
});

test('радиус карточки задаётся правилом, а не только sx', () => {
  // Регрессия: если радиус продублировать в CSS, подписи и реальные значения
  // разойдутся. Правило должно строиться из единственного источника истины.
  const mainSource = fs.readFileSync(path.join(__dirname, 'src/main.tsx'), 'utf8');
  assert.ok(mainSource.includes('CHAT_SHAPES.map'), 'CSS строится из CHAT_SHAPES');
  assert.ok(
    !/data-chat-shape="vera"\][^}]*borderRadius:\s*\d/.test(mainSource),
    'радиус Vera не должен быть вписан в CSS вручную',
  );
  // Настройка про карточки чатов, а не про модальные окна.
  assert.ok(mainSource.includes('[data-vera-chat-row]'), 'правило целится в карточку чата');
  assert.ok(
    !mainSource.includes('data-dialog-shape'),
    'прежняя настройка вида окон должна быть убрана',
  );
  // Пузыри сообщений настройка не трогает.
  assert.ok(!mainSource.includes('data-chat-shape="vera"] [data-vera-bubble]'), 'пузыри не затронуты');
});

test('заливку карточек можно снять независимо от формы и обводки', () => {
  const { store, html } = loadUiPrefs();

  // По умолчанию заливка включена.
  assert.equal(store.getState().chatFill, true);
  assert.equal(html.attrs['data-chat-fill'], 'on');

  store.getState().setChatFill(false);
  assert.equal(html.attrs['data-chat-fill'], 'off');
  // Снятие заливки не должно трогать форму и обводку.
  assert.equal(html.attrs['data-chat-shape'], 'vera');
  assert.equal(html.attrs['data-chat-border'], 'on');

  // Смена формы и обводки не возвращает заливку обратно.
  store.getState().setChatShape('vk');
  store.getState().setChatBorder(false);
  assert.equal(html.attrs['data-chat-fill'], 'off');

  store.getState().setChatFill(true);
  assert.equal(html.attrs['data-chat-fill'], 'on');
  // Обратно включённая заливка не должна терять выбранные форму/обводку.
  assert.equal(html.attrs['data-chat-shape'], 'vk');
  assert.equal(html.attrs['data-chat-border'], 'off');
});

test('без заливки строка становится полосой во всю ширину, а единственный чат растягивается', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src/main.tsx'), 'utf8');

  // Полоса: фон прозрачный, селектор длиннее правила формы.
  assert.ok(
    mainSource.includes('html[data-chat-fill="off"] [data-vera-list] [data-vera-chat-row]'),
    'правило без заливки должно бить по карточке внутри списка',
  );
  assert.ok(
    /data-chat-fill="off"\][^}]*background:\s*'transparent'/.test(mainSource),
    'без заливки фон карточки прозрачный',
  );
  // Во всю ширину: у вертикального списка убираются боковые отступы.
  assert.ok(
    mainSource.includes('data-vera-list-layout="vertical"'),
    'правило полосы ограничено вертикальным списком',
  );
  assert.ok(
    /paddingLeft:\s*0,\s*paddingRight:\s*0/.test(mainSource),
    'боковые отступы списка обнуляются',
  );
  // Единственный чат занимает всю высоту.
  assert.ok(mainSource.includes(':only-child'), 'единственный чат должен растягиваться по высоте');

  // Ориентация размечена, иначе правило сломало бы горизонтальную ленту.
  const sidebar = fs.readFileSync(path.join(__dirname, 'src/components/Sidebar.tsx'), 'utf8');
  assert.ok(sidebar.includes('data-vera-list-layout'), 'список должен сообщать свою ориентацию');
});

test('пять базовых паков и стилевые поверх них, и шим умеет их все отдавать', () => {
  const { packs } = loadUiPrefs();
  const ids = packs.map((p) => p.id);
  const base = ['filled', 'outlined', 'rounded', 'sharp', 'twoTone'];
  const styled = ['relief', 'puffy', 'sticker', 'neon', 'tile'];

  assert.equal(JSON.stringify(ids), JSON.stringify([...base, ...styled]));
  for (const p of packs) assert.ok(p.label && p.desc, 'у пака есть подпись и описание');
  // Названия паков не повторяются — иначе в выборе две одинаковые кнопки.
  assert.equal(new Set(packs.map((p) => p.label)).size, packs.length);

  // Стилевой пак берёт форму базового варианта, иначе шим отдал бы filled.
  const uiSource = fs.readFileSync(path.join(__dirname, 'src/store/uiPrefsStore.ts'), 'utf8');
  for (const id of styled) {
    assert.match(uiSource, new RegExp(`${id}: '(${base.join('|')})'`), `у пака ${id} есть базовая форма`);
  }
  // И у каждого стилевого пака есть свой CSS-слой.
  const mainSource = fs.readFileSync(path.join(__dirname, 'src/main.tsx'), 'utf8');
  for (const id of styled) assert.match(mainSource, new RegExp(`^\\s+${id}: \\{`, 'm'), `CSS пака ${id}`);
  const defs = fs.readFileSync(path.join(__dirname, 'src/components/IconPackDefs.tsx'), 'utf8');
  for (const id of ['relief', 'puffy', 'sticker']) assert.ok(defs.includes(`id="vera-ico-${id}"`), `фильтр ${id}`);

  // Порядок важен: он же порядок VARIANTS в генераторе шима.
  const generator = fs.readFileSync(path.join(__dirname, 'scripts/make-icon-shim.mjs'), 'utf8');
  for (const id of base) {
    const suffix = id === 'filled' ? '' : id[0].toUpperCase() + id.slice(1);
    assert.ok(generator.includes(`['${id}', '${suffix}']`), `генератор знает вариант ${id}`);
  }

  // Шим обязан отдавать каждый пак для каждой иконки: make() падает на filled,
  // и «Двухслойные» молча превратились бы в обычные.
  const shim = fs.readFileSync(path.join(__dirname, 'src/mui-icons-shim.tsx'), 'utf8');
  const entries = [...shim.matchAll(/^ {2}(\w+): \{([^}]*)\}/gm)];
  assert.ok(entries.length > 50, 'шим содержит иконки');
  for (const [, name, body] of entries) {
    for (const key of ['filled', 'outlined', 'rounded', 'sharp', 'twoTone']) {
      assert.ok(body.includes(`${key}:`), `у иконки ${name} нет варианта ${key}`);
    }
  }
});

test('стиль интерфейса: ползунки + три независимых режима-переключателя', () => {
  const { store, html, modes } = loadUiPrefs();
  assert.equal(JSON.stringify(modes.map((m) => m.id)), JSON.stringify(['glass', 'flat', 'compact']));
  for (const m of modes) assert.ok(m.label && m.desc, 'у режима есть подпись и описание');

  // По умолчанию — свои значения, все режимы выключены, радиусы по умолчанию.
  const s0 = store.getState();
  assert.equal(s0.uiStyle, 'squircle');
  assert.deepEqual({ ...s0.uiModes }, { glass: false, flat: false, compact: false });
  assert.deepEqual({ ...s0.squircle }, { surface: 12, avatar: 50, bubble: 14, profile: 12, nav: 54 });
  for (const m of modes) assert.equal(html.attrs[`data-ui-${m.id}`], 'off');

  // Режимы включаются независимо и не трогают радиусы.
  s0.setUiMode('glass', true);
  s0.setUiMode('compact', true);
  assert.equal(html.attrs['data-ui-glass'], 'on');
  assert.equal(html.attrs['data-ui-flat'], 'off');
  assert.equal(html.attrs['data-ui-compact'], 'on');
  assert.deepEqual({ ...store.getState().squircle }, { surface: 12, avatar: 50, bubble: 14, profile: 12, nav: 54 });
});

test('старые стили-кнопки раскладываются на ползунки и режимы', () => {
  const { store, html } = loadUiPrefs();
  const props = {};
  html.style = { setProperty: (k, v) => { props[k] = v; } };
  const s = store.getState();

  s.setUiStyle('rounded');
  assert.equal(store.getState().uiStyle, 'squircle', 'хранится как «свои значения»');
  assert.deepEqual({ ...store.getState().squircle }, { surface: 24, avatar: 50, bubble: 26, profile: 24, nav: 56 });

  s.setUiStyle('square');
  assert.deepEqual({ ...store.getState().squircle }, { surface: 4, avatar: 12, bubble: 4, profile: 4, nav: 4 });

  s.setUiStyle('glass');
  assert.equal(store.getState().uiModes.glass, true);
  assert.equal(html.attrs['data-ui-glass'], 'on');
  assert.deepEqual({ ...store.getState().squircle }, { surface: 12, avatar: 50, bubble: 14, profile: 12, nav: 54 });

  // «Полускруглённый» оставляет текущие ползунки.
  s.setSquircleRadius('surface', 9);
  s.setUiStyle('squircle');
  assert.equal(store.getState().squircle.surface, 9);
  assert.equal(store.getState().uiModes.glass, false, 'режимы сбрасываются');

  // Пузыри берут радиус из ползунка стиля, а не из макета.
  s.setSquircleRadius('bubble', 21);
  assert.equal(props['--vera-bubble-radius'], '21px');
});

test('переключатели квадратные только при скруглённо-квадратных углах', () => {
  const { store, html, switchStyleFor } = loadUiPrefs();
  assert.equal(html.attrs['data-switch-style'], 'squircle', 'по умолчанию 12px — квадратики');
  assert.equal(switchStyleFor(0), 'squircle', 'прямые углы — тоже квадратики');
  assert.equal(switchStyleFor(3), 'squircle');
  assert.equal(switchStyleFor(20), 'squircle');
  assert.equal(switchStyleFor(21), 'base');

  store.getState().setSquircleRadius('surface', 30);
  assert.equal(html.attrs['data-switch-style'], 'base');
  store.getState().setSquircleRadius('surface', 0);
  assert.equal(html.attrs['data-switch-style'], 'squircle');

  const mainSource = fs.readFileSync(path.join(__dirname, 'src/main.tsx'), 'utf8');
  assert.ok(mainSource.includes('html[data-switch-style="squircle"] .MuiSwitch-track'), 'CSS дорожки');
  assert.ok(mainSource.includes('html[data-switch-style="squircle"] .MuiSwitch-thumb'), 'CSS бегунка');
});

test('обычные переключатели тоже берут цвета темы', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src/main.tsx'), 'utf8');
  const start = mainSource.indexOf(`'html[data-switch-style="base"] .MuiSwitch-switchBase': {`);
  assert.ok(start >= 0, 'есть правило для выключенного бегунка');
  const block = mainSource.slice(start, mainSource.indexOf('// ─── Системный reduced-motion', start));
  assert.ok(block.includes('var(--vera-text-sec'), 'выкл — вторичный цвет текста темы');
  assert.ok(block.includes(`'html[data-switch-style="base"] .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track'`), 'правило дорожки во «вкл»');
  assert.ok(block.includes('var(--vera-accent'), 'вкл — акцент темы');
});

test('CSS режимов привязан к data-ui-<режим>, а не к старому data-ui-style', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src/main.tsx'), 'utf8');
  for (const id of ['glass', 'flat', 'compact']) {
    assert.ok(mainSource.includes(`data-ui-${id}="on"`), `режим ${id}`);
    assert.ok(!mainSource.includes(`data-ui-style="${id}"`), `старый селектор ${id} убран`);
  }
  for (const old of ['rounded', 'square', 'squircle']) {
    assert.ok(!mainSource.includes(`data-ui-style="${old}"`), `старый селектор ${old} убран`);
  }
});

test('полускруглённый: три независимых радиуса с ограничениями попадают в CSS-переменные', () => {
  const props = {};
  const { store, html } = loadUiPrefs();
  html.style = { setProperty: (k, v) => { props[k] = v; } };
  const s = store.getState();

  s.setSquircleRadius('surface', 20);
  s.setSquircleRadius('avatar', 999);
  s.setSquircleRadius('bubble', -5);
  assert.deepEqual({ ...store.getState().squircle }, { surface: 20, avatar: 50, bubble: 0, profile: 12, nav: 54 });
  assert.equal(props['--vera-sq-radius'], '20px');
  // Профиль — свой ползунок, основной экран его не трогает.
  assert.equal(props['--vera-profile-radius'], '12px');
  s.setSquircleRadius('profile', 40);
  assert.equal(props['--vera-profile-radius'], '32px');
  assert.equal(props['--vera-sq-radius'], '20px');
  s.setSquircleRadius('profile', 12);
  assert.equal(props['--vera-sq-avatar'], '50%');
  assert.equal(props['--vera-sq-bubble'], '0px');

  // Ползунки независимы: изменение одного не трогает остальные.
  s.setSquircleRadius('bubble', 14);
  assert.deepEqual({ ...store.getState().squircle }, { surface: 20, avatar: 50, bubble: 14, profile: 12, nav: 54 });

  const mainSource = fs.readFileSync(path.join(__dirname, 'src/main.tsx'), 'utf8');
  assert.ok(mainSource.includes('UI_STYLE_SQUIRCLE_TARGETS'));
  for (const v of ['--vera-sq-radius', '--vera-sq-avatar']) assert.ok(mainSource.includes(v), v);
  // Пузыри берут радиус с «хвостиком» прямо в sx из --vera-bubble-radius.
  assert.equal(props['--vera-bubble-radius'], '14px');
  const bubbleSource = fs.readFileSync(path.join(__dirname, 'src/components/MessageBubble.tsx'), 'utf8');
  assert.ok(bubbleSource.includes('var(--vera-bubble-radius'), 'пузырь читает --vera-bubble-radius');
  // Скин магазина / кастом авторов не должен перебивать ползунок: радиус
  // объявлен в sx ПОСЛЕ спреда equippedBubbleSx.
  const skinAt = bubbleSource.indexOf('mirrorBubble(equippedBubbleSx)');
  const radiusAt = bubbleSource.indexOf('borderRadius: isOwnSide');
  assert.ok(skinAt > 0 && radiusAt > skinAt, 'borderRadius пузыря идёт после скина');
});

test('радиусы стилей покрывают один и тот же набор поверхностей', () => {
  const { radii } = loadUiPrefs();
  const rounded = Object.keys(radii.rounded);
  const square = Object.keys(radii.square);

  // Регрессия: раньше стиль трогал 3 класса, и вкладки/чипы/бейджи оставались
  // со своими радиусами — стиль выглядел применённым наполовину.
  assert.deepEqual(rounded.slice().sort(), square.slice().sort(), 'наборы поверхностей совпадают');
  assert.ok(rounded.length >= 12, `поверхностей много (${rounded.length}), а не три`);

  for (const sel of rounded) {
    assert.ok(radii.rounded[sel] > radii.square[sel], `${sel}: скруглённый должен быть круглее`);
    // 999 — «таблетка», иначе разумный радиус в пикселях.
    assert.ok(radii.rounded[sel] === 999 || (radii.rounded[sel] >= 4 && radii.rounded[sel] <= 32), `подозрительный радиус у ${sel}`);
    assert.ok(radii.square[sel] >= 0 && radii.square[sel] <= 8, `подозрительный радиус у ${sel}`);
  }
});

test('CSS стилей генерируется из карт, а не прописан по классам', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'src/main.tsx'), 'utf8');
  assert.ok(mainSource.includes('UI_STYLE_SQUIRCLE_TARGETS'), 'радиусы разворачиваются из UI_STYLE_SQUIRCLE_TARGETS');
  assert.ok(mainSource.includes('UI_STYLE_FLAT_TARGETS'), 'цели «Плоский» разворачиваются из списка');
  assert.ok(
    mainSource.includes("from './store/uiPrefsStore'"),
    'стили берутся из стора настроек',
  );
});

test('карточка чата размечена для настройки и в сайдбаре, и в горизонтальном виде', () => {
  const sidebar = fs.readFileSync(path.join(__dirname, 'src/components/Sidebar.tsx'), 'utf8');
  assert.ok(
    sidebar.includes('data-vera-chat-row'),
    'ListItem чата должен нести метку data-vera-chat-row',
  );
});

test('высота нижней панели: ползунок в границах, сброс стиля, тема и CSS-переменная', () => {
  const { store, exports: ex } = loadUiPrefs();
  const L = ex.NAV_HEIGHT_LIMITS;
  // По умолчанию — прежние 70px, вид не меняется.
  assert.equal(L.def, 70);
  assert.equal(store.getState().navHeight, 70);
  store.getState().setNavHeight(84.4);
  assert.equal(store.getState().navHeight, 84);
  store.getState().setNavHeight(1);
  assert.equal(store.getState().navHeight, L.min);
  store.getState().setNavHeight(999);
  assert.equal(store.getState().navHeight, L.max);
  store.getState().setNavHeight('мусор');
  assert.equal(store.getState().navHeight, L.def);
  store.getState().setNavHeight(90);
  store.getState().setUiStyle('default');
  assert.equal(store.getState().navHeight, L.def, '«Сбросить стиль» возвращает высоту');

  const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
  const ui = read('src/store/uiPrefsStore.ts');
  assert.ok(ui.includes("'--vera-nav-height'"), 'высота уходит в CSS-переменную');
  const mobile = read('src/components/MobileBottomNav.tsx');
  assert.ok(mobile.includes('minHeight: navHeight'), 'мобильная панель берёт высоту из стора');
  assert.ok(mobile.includes('height: navHeight - 12'), 'кнопки растут вместе с панелью');
  const desk = read('src/components/SidebarNavButtons.tsx');
  assert.ok(desk.includes('height: navHeight - 16'), 'панель «как на телефоне» на ПК тоже');
  const call = read('src/components/CallMiniBar.tsx');
  assert.ok(call.includes('var(--vera-nav-height'), 'плашка звонка встаёт над панелью любой высоты');
  const theme = read('src/store/themeStore.ts');
  assert.ok(theme.includes('navHeight: ui.navHeight'), 'высота сохраняется в теме');
  assert.ok(theme.includes('ui.setNavHeight(s.ui.navHeight)'), 'и применяется из темы');
  const panels = read('src/components/ThemeSettingsPanels.tsx');
  assert.ok(panels.includes('label="Высота нижней панели, px"'), 'ползунок в редакторе');
});
