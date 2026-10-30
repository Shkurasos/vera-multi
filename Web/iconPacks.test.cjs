const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

/** Загружает чистый TS-модуль без зависимостей. */
function load(rel) {
  const context = vm.createContext({ exports: {}, module: { exports: {} }, console });
  vm.runInContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, rel), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return context.exports;
}
const fmt = load('src/utils/iconPackFormat.ts');
const slots = load('src/utils/iconSlots.ts');
const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const shim = read('src/mui-icons-shim.tsx');
const SHIM_SLOTS = [...shim.matchAll(/^ {2}(\w+): \{ filled:/gm)].map((m) => m[1]);
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('слот принимает другую иконку, текст и растровую картинку — и только их', () => {
  const known = new Set(['Search', 'Call']);
  assert.deepEqual({ ...fmt.sanitizeIcon({ kind: 'mui', name: 'Call' }, known) }, { kind: 'mui', name: 'Call' });
  assert.equal(fmt.sanitizeIcon({ kind: 'mui', name: 'Nope' }, known), null, 'несуществующая иконка');
  assert.equal(fmt.sanitizeIcon({ kind: 'text', text: '  🐱 ' }).text, '🐱');
  assert.equal(fmt.sanitizeIcon({ kind: 'text', text: '' }), null);
  assert.equal(fmt.sanitizeIcon({ kind: 'image', src: PNG }).src, PNG);
  assert.equal(fmt.sanitizeIcon({ kind: 'image', src: PNG, tint: 1 }).tint, true);
  // SVG и внешние адреса — нет: в SVG может быть скрипт, URL — слежка.
  assert.equal(fmt.sanitizeIcon({ kind: 'image', src: 'data:image/svg+xml;base64,PHN2Zz4=' }), null);
  assert.equal(fmt.sanitizeIcon({ kind: 'image', src: 'https://evil.example/x.png' }), null);
  assert.equal(fmt.sanitizeIcon({ kind: 'image', src: 'data:image/png;base64,' + 'A'.repeat(fmt.MAX_ICON_IMAGE_CHARS) }), null);
  assert.equal(fmt.sanitizeIcon({ kind: 'html', html: '<b>' }), null);
});

test('пак: битые слоты отбрасываются по одному, основа и имя чистятся', () => {
  const known = new Set(['Search', 'Call', 'MoreVert']);
  const parsed = fmt.sanitizePack({
    name: ' Мой\u0000 пак ', base: 'hacker',
    icons: { Search: { kind: 'text', text: '🔍' }, Call: { kind: 'mui', name: 'Ghost' }, Unknown: { kind: 'text', text: 'x' }, MoreVert: { kind: 'image', src: PNG } },
  }, known);
  assert.equal(parsed.name, 'Мой пак');
  assert.equal(parsed.base, 'filled', 'неизвестная основа → filled');
  assert.deepEqual(Object.keys(parsed.icons).sort(), ['MoreVert', 'Search']);
  assert.equal(parsed.dropped, 2);
  assert.equal(fmt.sanitizePack([]), null);
  assert.equal(fmt.sanitizePack({ icons: 'x' }), null);
});

test('файл пака переживает круг «скачать → загрузить»', () => {
  const pack = { name: 'Коты', base: 'neon', icons: { Search: { kind: 'text', text: '🐱' } } };
  const file = JSON.parse(JSON.stringify(fmt.packToFile(pack)));
  assert.equal(file.format, 'vera-icon-pack');
  const back = fmt.sanitizePack(file, new Set(SHIM_SLOTS));
  assert.equal(back.base, 'neon');
  assert.deepEqual({ ...back.icons.Search }, { kind: 'text', text: '🐱' });
  assert.match(fmt.packFileName('a/b:c'), /^a_b_c\.vera-icons\.json$/);
});

test('все основы паков — существующие встроенные паки', () => {
  const ui = read('src/store/uiPrefsStore.ts');
  for (const id of fmt.BASE_PACK_IDS) assert.match(ui, new RegExp(`id: '${id}'`), id);
});

test('у каждого слота шима есть русская подпись, а поиск находит нужное', () => {
  for (const s of SHIM_SLOTS) assert.ok(slots.ICON_SLOT_LABELS[s], `нет подписи у ${s}`);
  const find = (q) => SHIM_SLOTS.filter((s) => slots.slotMatches(s, q));
  for (const [q, slot] of [['поиск', 'Search'], ['звонок', 'Call'], ['три точки', 'MoreVert'], ['видеозвонок', 'Videocam'],
    ['прикрепить', 'AttachFile'], ['эмодзи', 'EmojiEmotions'], ['отправить', 'Send'], ['редактор тем', 'Palette'],
    ['архив', 'Archive'], ['создать группу', 'Group'], ['добавить чат', 'PersonAdd'], ['моя музыка', 'LibraryMusic'],
    ['закрепить', 'PushPin'], ['настройки', 'Settings'], ['профиль', 'AccountCircle'], ['инфопанель', 'Info']]) {
    assert.ok(find(q).includes(slot), `«${q}» → ${slot}`);
  }
});

test('шим подменяет слот своим паком и отдаёт список слотов редактору', () => {
  assert.ok(shim.includes("from './iconPackRuntime'"), 'шим подключает рантайм паков');
  assert.match(shim, /const custom = useActiveCustomIcons\(\)/);
  assert.match(shim, /export const ICON_SLOTS/);
  assert.match(shim, /export const IconBySlot/);
  // Генератор переписывает шим — импорт обязан быть и в нём.
  assert.ok(read('scripts/make-icon-shim.mjs').includes("from './iconPackRuntime'"));
});

test('включённый свой пак — настройка устройства: в тему не пишется и из темы не применяется', () => {
  const store = read('src/store/themeStore.ts');
  const snap = store.slice(store.indexOf('export function snapshotThemeSettings'), store.indexOf('function storeThemeSettings'));
  assert.doesNotMatch(snap, /customPack: ui\.customPack/, 'снимок темы без customPack');
  const apply = store.slice(store.indexOf('export function applyThemeSettings'));
  assert.doesNotMatch(apply, /setCustomPack/, 'старые снимки с customPack не выключают пак');
});

test('редактор картинки: шахматка под прозрачностью, обрезка и рисование', () => {
  const editor = read('src/components/IconImageEditor.tsx');
  assert.ok(editor.includes('CHECKER_BG'), 'серая шахматка');
  // Штрихи (и ластик) рисует utils/iconDrawing.ts — см. iconDrawing.test.cjs.
  assert.ok(editor.includes('renderIconStroke'), 'штрихи рисует общий модуль');
  assert.ok(read('src/utils/iconDrawing.ts').includes("'destination-out'"), 'ластик стирает до прозрачности');
  assert.ok(editor.includes("touchAction: 'none'"), 'рисование пальцем не крутит страницу');
  assert.ok(editor.includes('passive: false'), 'колесо масштабирует фото, а не диалог');
  assert.ok(editor.includes("toDataURL('image/png')"), 'PNG сохраняет прозрачность');
  // Скругление углов: одна маска и в превью, и в сохранённой картинке.
  assert.ok(editor.includes("'destination-in'"), 'углы срезаются до прозрачности');
  assert.equal((editor.match(/applyCornerMask\(ctx, SIDE, corners\)/g) || []).length, 2, 'маска в превью и при сохранении');
  assert.ok(editor.includes('Скругление углов'));
  // Панель встроена во вкладку «Иконки и стиль».
  assert.ok(read('src/components/ThemeSettingsPanels.tsx').includes('<CustomIconPacksPanel />'));
});
