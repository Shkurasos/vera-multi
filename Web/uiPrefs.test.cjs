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
    html: context.document.documentElement,
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
  assert.equal(html.attrs['data-ui-style'], 'default');
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

test('пять паков иконок, и шим умеет их все отдавать', () => {
  const { packs } = loadUiPrefs();
  const ids = packs.map((p) => p.id);

  assert.equal(packs.length, 5, 'пять паков');
  assert.equal(JSON.stringify(ids), JSON.stringify(['filled', 'outlined', 'rounded', 'sharp', 'twoTone']));
  for (const p of packs) assert.ok(p.label && p.desc, 'у пака есть подпись и описание');

  // Порядок важен: он же порядок вкладок и VARIANTS в генераторе шима.
  const generator = fs.readFileSync(path.join(__dirname, 'scripts/make-icon-shim.mjs'), 'utf8');
  for (const id of ids) {
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

test('стили интерфейса: шесть вариантов, включая «Плоский»', () => {
  const { styles } = loadUiPrefs();
  const ids = styles.map((s) => s.id);
  assert.equal(styles.length, 6, 'шесть стилей');
  assert.ok(ids.includes('flat'), 'есть стиль «Плоский»');
  for (const s of styles) assert.ok(s.label && s.desc, 'у стиля есть подпись и описание');
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
  assert.ok(mainSource.includes('UI_STYLE_RADII'), 'радиусы разворачиваются из UI_STYLE_RADII');
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
