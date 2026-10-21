/**
 * Редактор тем: группы вкладок, поиск по настройкам и строки
 * «название слева — контрол справа».
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const editor = read('src/components/ThemeEditor.tsx');
const panels = read('src/components/ThemeSettingsPanels.tsx');
const row = read('src/components/SettingRow.tsx');
const bubble = read('src/components/BubbleSettingsControls.tsx');

function loadSearch() {
  const mod = { exports: {} };
  vm.runInContext(
    ts.transpileModule(read('src/utils/themeEditorSearch.ts'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText,
    vm.createContext({ exports: mod.exports, module: mod }),
  );
  return mod.exports;
}
const S = loadSearch();

test('вкладки разбиты на группы, иконки и стиль — отдельно', () => {
  const titles = S.TAB_GROUPS.map((g) => g.title);
  assert.deepEqual([...titles], ['Темы', 'Оформление', 'Интерфейс', 'Звук']);
  const ids = [...S.SETTINGS_TABS];
  for (const id of ['theme', 'community', 'wallpaper', 'icons', 'ui', 'anim', 'look', 'clock', 'messages', 'layout', 'sound']) {
    assert.ok(ids.includes(id), `вкладка ${id} есть`);
  }
  assert.equal(new Set(ids).size, ids.length, 'вкладки не повторяются');
  assert.equal(S.TAB_LABELS.icons, 'Иконки');
  assert.equal(S.TAB_LABELS.ui, 'Стиль');
  assert.ok(!Object.values(S.TAB_LABELS).includes('Иконки и стиль'), 'общей вкладки больше нет');
});

test('Community Themes переименованы в «Темы комьюнити»', () => {
  assert.equal(S.TAB_LABELS.community, 'Темы комьюнити');
  assert.ok(!editor.includes('Community Themes'), 'старого названия в редакторе нет');
  assert.ok(editor.includes('>Темы комьюнити<'), 'заголовок панели переименован');
});

test('каждая вкладка индекса существует, у каждой вкладки настроек есть строки', () => {
  const ids = new Set(S.SETTINGS_TABS);
  for (const e of S.SETTINGS_INDEX) assert.ok(ids.has(e.tab), `${e.label}: вкладка ${e.tab} существует`);
  for (const id of ids) assert.ok(S.SETTINGS_INDEX.some((e) => e.tab === id), `у ${id} есть строки в индексе`);
});

test('поиск: без регистра, ё = е, все слова, сортировка по началу подписи', () => {
  // Массивы из vm-контекста — другой прототип Array, поэтому сравниваем длину.
  assert.equal(S.searchSettings('   ').length, 0, 'пустой запрос — пусто');
  const r = S.searchSettings('ЯРКОСТЬ');
  assert.equal(r[0].label, 'Яркость, %');
  assert.equal(r[0].tab, 'look');
  // «ё» в подписи находится по «е» и наоборот.
  assert.ok(S.searchSettings('календарем').some((e) => e.label === 'Обои с календарём и часами'));
  // Несколько слов — должны совпасть все.
  const two = S.searchSettings('размер секунд');
  assert.equal(two[0].label, 'Размер секунд, %');
  assert.ok(two.every((e) => e.tab === 'clock'));
  // Синонимы: «радиус» находит скругления.
  assert.ok(S.searchSettings('радиус').some((e) => e.label.startsWith('Скругление')));
  // По названию вкладки тоже ищется.
  assert.ok(S.searchSettings('часы').length > 3);
  assert.equal(S.searchSettings('qwertyzzz').length, 0, 'мусор — пусто');
  // Начало подписи выше, чем совпадение в середине.
  const shapes = S.searchSettings('скругление');
  assert.ok(shapes[0].label.startsWith('Скругление'));
  assert.equal(S.searchSettings('а', [], 3).length, 3, 'лимит соблюдается');
});

test('поиск принимает динамические строки (режимы, анимации)', () => {
  const extra = [{ tab: 'anim', label: '🎈 Подъём карточек', keywords: 'анимация наведение' }];
  const r = S.searchSettings('подъём', extra);
  assert.equal(r[0].label, '🎈 Подъём карточек');
  assert.ok(editor.includes('DYNAMIC_SEARCH_ENTRIES'), 'редактор передаёт динамические строки');
});

test('findSettingElement находит строку по data-setting-label', () => {
  const mk = (attr) => ({ textContent: attr, children: [], parentElement: null, getAttribute: () => attr });
  const a = mk('Яркость, %');
  const b = mk('Размер даты, %');
  const root = { querySelectorAll: (sel) => (sel === '[data-setting-label]' ? [a, b] : []) };
  assert.equal(S.findSettingElement(root, 'размер даты, %'), b);
  assert.equal(S.findSettingElement(root, 'нет такой'), null);
  assert.equal(S.findSettingElement(null, 'x'), null);
});

test('подписи строк в панелях совпадают с индексом поиска', () => {
  // Подписи скруглений собираются шаблоном `${label}, ${unit}` из SQUIRCLE_ROWS.
  const squircle = [...panels.matchAll(/\['(\w+)', '([^']+)', '(px|%)'\]/g)].map((m) => `${m[2]}, ${m[3]}`);
  const sources = panels + bubble;
  for (const e of S.SETTINGS_INDEX) {
    if (e.tab === 'theme' || e.tab === 'community') continue;
    const found = sources.includes(`"${e.label}"`) || sources.includes(`'${e.label}'`) || squircle.includes(e.label);
    assert.ok(found, `строка «${e.label}» есть в панели`);
  }
});

test('строка настройки: название слева, контрол справа, тонкая линия', () => {
  assert.ok(row.includes("justifyContent: 'space-between'"), 'название и контрол по краям');
  assert.ok(row.includes('borderBottom: `1px solid ${theme.border}`'), 'тонкая линия между строками');
  assert.ok(row.includes("borderRadius: '6px 6px 0 0'"), 'линия-разделитель не загибается на концах');
  assert.ok(row.includes('data-setting-label={label}'), 'строка помечена для поиска');
  assert.ok(row.includes('aria-labelledby={id}'), 'контрол связан с подписью');
  assert.ok(/<SliderWithInput \{\.\.\.slider\}/.test(row), 'ползунок с полем ввода');
  // В панелях ползунки — через строку, а не голым SliderWithInput.
  assert.ok(!panels.includes('<SliderWithInput'), 'голых ползунков в панелях нет');
  assert.ok((panels.match(/<SettingSlider/g) || []).length >= 10, 'ползунки оформлены строками');
  assert.ok(bubble.includes("variant === 'rows'"), 'пузыри умеют строками');
  assert.ok(panels.includes('<BubbleSettingsControls variant="rows"'), 'в редакторе — строками');
});

test('группы вариантов — отдельные плашки в строку, а не столбик', () => {
  // fullWidth + flexWrap без своего вида давали каждой кнопке 100% ширины:
  // варианты шли столбиком с обрезанными рамками. Общий вид — choiceGroupSx.
  assert.ok(row.includes('export function choiceGroupSx'), 'общий вид групп в SettingRow');
  assert.ok(row.includes("flex: '1 1 auto', width: 'auto'"), 'кнопка не растягивается на всю строку');
  assert.ok(row.includes("margin: '0 !important'"), 'нет склейки рамок через marginLeft: -1');
  assert.ok(panels.includes('return choiceGroupSx(theme);'), 'панели берут общий вид');
  assert.ok(bubble.includes('sx={choiceGroupSx(theme)}'), 'и «Время и галочки в пузыре»');
  // «Вид чатов»: превью формы через переменную, а не !important поверх общего вида.
  assert.ok(panels.includes("'--vera-choice-radius': `${d.radius}px`"), 'форма карточки на кнопке');
  // Голых групп с fullWidth без общего вида в панелях не осталось.
  const groups = panels.split('<ToggleButtonGroup').slice(1).map((g) => g.slice(0, g.indexOf('</ToggleButtonGroup>')).split(/\n\s*\{|\n\s*<ToggleButton /)[0]);
  for (const g of groups) {
    if (!g.includes('fullWidth')) continue;
    assert.ok(/sx=\{(toggleSx|sx|\{ \.\.\.toggleSx|choiceGroupSx\(theme\))/.test(g), `группа с fullWidth использует общий вид: ${g.slice(0, 80)}`);
  }
});

test('рисунки паттерна выбираются кликом по названию', () => {
  // onClick на <label> срабатывал дважды (подпись + синтетический клик по
  // галочке) — выбор тут же отменялся. Переключает только onChange галочки.
  const block = editor.slice(editor.indexOf("PATTERN_LIST.filter(p => p.id !== 'none').map"), editor.indexOf('Перемешать рисунки'));
  assert.ok(block.includes('onChange={() => togglePattern(p.id)}'));
  assert.ok(!/<label[^>]*onClick/.test(block), 'у подписи нет своего onClick');
  assert.ok(!block.includes('readOnly'), 'галочка не только для чтения');
});

test('новые вкладки подключены в редакторе', () => {
  for (const [tab, panel] of [['icons', 'IconsPanel'], ['clock', 'ClockPanel'], ['messages', 'MessagesPanel']]) {
    assert.ok(new RegExp(`tab === '${tab}' && <${panel} />`).test(editor), `${tab} рендерит ${panel}`);
    assert.ok(panels.includes(`export function ${panel}`), `${panel} экспортирована`);
  }
  assert.ok(editor.includes('role="combobox"'), 'поле поиска');
  assert.ok(editor.includes('role="listbox"'), 'список результатов');
  assert.ok(editor.includes("e.key === 'ArrowDown'"), 'клавиатура в поиске');
  assert.ok(editor.includes('scrollIntoView'), 'переход прокручивает к строке');
  assert.ok(editor.includes('ref={bodyRef}'), 'поиск ищет строку в теле редактора');
});
