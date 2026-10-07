/**
 * Обои меню со списком чатов: геометрия кадрирования + проводка настроек.
 *
 * Геометрия проверяется как чистые функции (transpile в vm), остальное — как
 * связность исходников: значение должно дойти от стора до панели и до слоя в
 * сайдбаре, иначе настройка «сохраняется» и ничего не делает.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

function load(file) {
  const ctx = vm.createContext({ console, exports: {}, module: { exports: {} }, require: () => ({}) });
  ctx.exports = ctx.module.exports;
  vm.runInContext(
    ts.transpileModule(read(file), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText,
    ctx,
  );
  return ctx.module.exports;
}

const {
  fitScale, coverZoom, clampZoom, clampPan, drawnSize, cropSourceRect, outputSize, frameSize,
} = load('src/utils/cropMath.ts');

const near = (got, want, eps = 0.5, msg = '') =>
  assert.ok(Math.abs(got - want) <= eps, `${msg || 'ожидалось ~' + want}, получено ${got}`);

// ── Геометрия кадрирования ────────────────────────────────────────────────────

test('картинка вписывается в рамку', () => {
  // Здесь упирается ширина: 1000 → 200 это ×0.2, а по высоте 500 → 200 это ×0.4.
  near(fitScale({ width: 1000, height: 500 }, { width: 200, height: 200 }), 0.2, 1e-9);
});

test('минимальный зум не даёт пустот по краям', () => {
  // Портретная рамка из альбомного фото: при вписывании по ширине картинка
  // занимает 100 px из 400 — пустые полосы сверху и снизу. Покрытие вчетверо.
  assert.equal(coverZoom({ width: 1000, height: 500 }, { width: 200, height: 400 }), 4);
  near(coverZoom({ width: 100, height: 200 }, { width: 100, height: 200 }), 1, 1e-9, 'совпадающие пропорции');
});

test('зум не опускается ниже покрытия и не уходит за потолок', () => {
  assert.equal(clampZoom(1, 4), 4, 'нельзя отдалить так, что по краям дыры');
  assert.equal(clampZoom(2.5, 1), 2.5);
  assert.equal(clampZoom(99, 1), 4, 'и нельзя приблизить до пиксельной каши');
});

test('картинку нельзя утащить из рамки', () => {
  const drawn = { width: 800, height: 400 };
  const frame = { width: 200, height: 400 };
  const p = clampPan({ x: 99999, y: -99999 }, drawn, frame);
  assert.equal(p.x, 300, 'по горизонтали ровно 300 px запаса');
  assert.equal(p.y, 0, 'по вертикали запаса нет — двигать некуда');
  assert.equal(clampPan({ x: 120, y: 0 }, drawn, frame).x, 120, 'внутри диапазона не трогаем');
});

test('кадр по центру альбомного фото в портретной рамке', () => {
  const src = { width: 1000, height: 500 };
  const frame = { width: 200, height: 400 };
  const rect = cropSourceRect(src, frame, coverZoom(src, frame), { x: 0, y: 0 });
  near(rect.x, 375, 1);
  near(rect.width, 250, 1);
  assert.equal(Math.round(rect.y), 0);
  near(rect.height, 500, 1, 'по вертикали фото влезло целиком');
});

test('сдвиг меняет кадр, но кадр всегда внутри фото', () => {
  const src = { width: 1000, height: 500 };
  const frame = { width: 200, height: 400 };
  const zoom = coverZoom(src, frame);
  const drawn = drawnSize(src, frame, zoom);
  // Сдвиг влево открывает ПРАВУЮ часть фото — так и должен работать кадр.
  const left = cropSourceRect(src, frame, zoom, clampPan({ x: -300, y: 0 }, drawn, frame));
  near(left.x + left.width, 1000, 1, 'прижали влево — кадр у правого края фото');
  const right = cropSourceRect(src, frame, zoom, clampPan({ x: 300, y: 0 }, drawn, frame));
  assert.equal(right.x, 0, 'прижали вправо — кадр у левого края фото');
  assert.ok(left.x > right.x, 'кадры действительно разные');
});

test('кадр никогда не вылезает за границы исходника', () => {
  // Дробная погрешность на нецелых пропорциях тут же съела бы пиксель за краем.
  const src = { width: 1234, height: 567 };
  const frame = { width: 259, height: 460 };
  const zoom = coverZoom(src, frame);
  for (const offset of [{ x: 0, y: 0 }, { x: 999, y: -999 }, { x: -999, y: 999 }]) {
    const p = clampPan(offset, drawnSize(src, frame, zoom), frame);
    const r = cropSourceRect(src, frame, zoom, p);
    assert.ok(r.x >= 0 && r.y >= 0, 'кадр не начинается за краем');
    assert.ok(r.x + r.width <= src.width + 1e-6, 'кадр не кончается за правым краем');
    assert.ok(r.y + r.height <= src.height + 1e-6, 'кадр не кончается за нижним краем');
  }
});

test('сохраняем не больше 1440 px по длинной стороне', () => {
  // Сравниваем через JSON: объекты из vm-контекста имеют другой прототип,
  // и deepStrictEqual на них ругается на пустой объект.
  const same = (got, want, msg) =>
    assert.equal(JSON.stringify(got), JSON.stringify(want), msg);
  same(outputSize({ x: 0, y: 0, width: 250, height: 500 }), { width: 250, height: 500 }, 'мелкое фото не растягиваем');
  same(outputSize({ x: 0, y: 0, width: 4000, height: 3000 }), { width: 1440, height: 1080 }, 'большое ужимаем');
});

test('рамка под пропорции вписывается в доступную область', () => {
  const box = { width: 520, height: 460 };
  const f = frameSize(box, 9 / 16, null);
  near(f.width / f.height, 9 / 16, 0.01);
  assert.ok(f.height <= box.height && f.width <= box.width, 'рамка не вылезла за диалог');
  // «Свободно» берёт пропорции картинки (800×400 → 520×260) — обрезать нечего.
  const free = frameSize(box, null, { width: 800, height: 400 });
  near(free.width / free.height, 2, 0.01);
  assert.ok(free.width <= box.width && free.height <= box.height, 'и тоже вписалась');
});
// ── Проводка: стор → панель → слой в сайдбаре ─────────────────────────────────

const store = read('src/store/chatBgPrefsStore.ts');
const themeStore = read('src/store/themeStore.ts');
const panels = read('src/components/ThemeSettingsPanels.tsx');
const chatListPanel = read('src/components/ChatListWallpaperPanel.tsx');
const sidebar = read('src/components/Sidebar.tsx');
const cropDialog = read('src/components/PhotoCropDialog.tsx');

test('свой скоуп, а не переиспользование per-chat', () => {
  assert.ok(/export const CHAT_LIST_SCOPE = 'chatlist'/.test(store), 'скоуп объявлен');
  assert.ok(/chatListBg: WallpaperOverride \| null;/.test(store), 'выбор обоев — отдельное поле');
  assert.ok(!/setChatWallpaper\(\s*CHAT_LIST_SCOPE/.test(store), 'в per-chat записи не совались');
});

test('затемнение и размытие зажаты в разумные пределы', () => {
  assert.ok(/setChatListDim: \(value\) => set\(\{ chatListDim: Math\.max\(0, Math\.min\(1, value\)\)/.test(store), 'затемнение 0..1');
  assert.ok(/setChatListBlur: \(value\) => set\(\{ chatListBlur: Math\.max\(0, Math\.min\(40, value\)\)/.test(store), 'размытие 0..40 px');
});

test('выбор переживает смену темы', () => {
  assert.ok(
    /chatList: \{ value: bg\.chatListBg, dim: bg\.chatListDim, blur: bg\.chatListBlur \}/.test(themeStore),
    'снимок берёт обои списка чатов',
  );
  const apply = themeStore.slice(themeStore.indexOf('export function applyThemeSettings'));
  assert.ok(apply.includes('if (s.wallpaper.chatList) {'), 'применяем только когда поле есть');
  assert.ok(apply.includes('bg.setChatListBg('), 'обои применяются');
  // Без этой проверки переключение темы обнуляло бы обои у старых снимков.
  const block = apply.slice(apply.indexOf('if (s.wallpaper.chatList) {'));
  assert.ok(block.includes('typeof s.wallpaper.chatList.dim'), 'затемнение — тоже опционально');
});

test('раздел есть в редакторе тем и вкладке «Обои»', () => {
  assert.ok(panels.includes('<ChatListWallpaperPanel />'), 'панель встроена в стенд обоев');
  assert.ok(themeStore.includes('chatList?:'), 'поле есть в типе снимка');
});

test('фото кладётся в IndexedDB, а не в стор', () => {
  assert.ok(chatListPanel.includes('savePhotoBg(blob, key)'), 'блоб уходит в IndexedDB');
  assert.ok(chatListPanel.includes('`${CHAT_LIST_SCOPE}:${id}`'), 'ключ с префиксом скоупа');
  // dataURL в синхронизируемом сторе бы пережил лимит синхронизации.
  assert.ok(!/setChatListBg\(\{\s*type: 'photo', value: (?!key)/.test(chatListPanel), 'в стор уходит только ключ');
});

test('удаление не стирает фото, которое ещё где-то выбрано', () => {
  assert.ok(chatListPanel.includes('stillUsed'), 'проверяем другие места выбора');
  assert.ok(chatListPanel.includes('if (!stillUsed) await clearPhotoBg(key)'), 'стираем только неиспользуемое');
  assert.ok(chatListPanel.includes('if (chatListBg?.value === key) setChatListBg(null)'), 'выбор снимаем');
});

test('кроппер умеет двигать и приближать', () => {
  assert.ok(cropDialog.includes('onPointerMove'), 'картинка тянется мышью');
  assert.ok(cropDialog.includes('passive: false'), 'колесо гасим, иначе страница уедет');
  assert.ok(cropDialog.includes("touchAction: 'none'"), 'на телефоне жест не прокрутит страницу');
  assert.ok(cropDialog.includes('canvas.toBlob'), 'на выходе готовый блоб');
});

test('картинка в кроппере всегда смонтирована', () => {
  // Баг: <img> рисовался только когда `drawn` уже готов, а `drawn` появлялся
  // лишь после onLoad ЭТОГО ЖЕ img. Элемент не монтировался никогда, и
  // кроппер висел на вечном спиннере с серой кнопкой «Обрезать».
  const imgAt = cropDialog.indexOf('<img');
  const spinnerAt = cropDialog.indexOf('{!drawn && (');
  assert.ok(imgAt > 0, 'img есть в разметке');
  assert.ok(imgAt < spinnerAt, 'img объявлен ДО условия со спиннером, а не внутри него');
  // img не должен быть веткой тернарника: условие {!drawn ? ... : <img>}
  const ternary = cropDialog.match(/!drawn \?[\s\S]{0,200}?<img/);
  assert.equal(ternary, null, 'img не внутри {!drawn ? ... : ...}');
  assert.ok(cropDialog.includes('onError='), 'битое фото покажет ошибку, а не вечный спиннер');
});

test('размеры фото берём и из ref, и из события', () => {
  // load иногда приходит раньше, чем React навесил ref (особенно на object URL
  // из кэша) — тогда по одному ref размеры остались бы нулевыми.
  assert.ok(
    /imgRef\.current \|\| e\.currentTarget/.test(cropDialog),
    'берём размеры из события, если ref ещё пуст',
  );
});

test('слой фона лежит под строками списка', () => {
  const layer = sidebar.indexOf('{listWallpaperUrl && (');
  // Привязываемся к data-vera-list: поиск по «<List» цеплял и <ListItem выше
  // по файлу, и упоминание <List> в комментарии над списком.
  const list = sidebar.indexOf('data-vera-list');
  assert.ok(layer > 0 && list > layer, 'фон отрисован раньше списка');
  assert.ok(/zIndex: 0/.test(sidebar.slice(layer, layer + 700)), 'фон под контентом');
  assert.ok(
    sidebar.slice(list, sidebar.indexOf('</List>', list)).includes('zIndex: 1'),
    'строки над фоном',
  );
});

test('заливка панели убирается только когда фото реально загрузилось', () => {
  // Иначе на первом кадре, пока IndexedDB отдаёт блоб, сайдбар мигнёт пустым.
  assert.ok(sidebar.includes('const hasListWallpaper = !!listWallpaperUrl'), 'ждём адрес, а не выбор');
  assert.ok(
    /background: hasListWallpaper \? 'transparent' : \(theme\.sidebarGradient \|\| theme\.bgSidebar\)/.test(sidebar),
    'при фото панель становится прозрачной',
  );
});

// ── Скорость появления фото ───────────────────────────────────────────────────

const storage = read('src/services/chatBgPhotoStorage.ts');
const hooks = read('src/hooks/usePhotoBgUrl.ts');

test('соединение с IndexedDB одно, а не на каждую операцию', () => {
  // Каждый openDb() без закрытия оставлял соединение до конца вкладки. Их
  // накопление замедляло IndexedDB — фото в обоях проявлялось всё медленнее.
  assert.ok(storage.includes('let dbPromise: Promise<IDBDatabase> | null = null'), 'соединение кэшируется');
  assert.ok(/if \(dbPromise\) return dbPromise;/.test(storage), 'повторный openDb не открывает новое');
  assert.ok(storage.includes('db.onversionchange = () => { db.close(); dbPromise = null; }'), 'на upgrade закрываемся');
  assert.ok(storage.includes('req.onerror = () => { dbPromise = null;'), 'ошибка не кэшируется навсегда');
});

test('фото декодируется заранее, а не в момент отрисовки', () => {
  // object URL не грузит картинку: браузер разбирает JPEG при первой
  // отрисовке, и на большом снимке это заметная пауза.
  assert.ok(storage.includes('export function warmUpPhotoBgUrl'), 'есть прогрев');
  assert.ok(storage.includes('img.decode().catch(() => {})'), 'декодирование с проглатыванием ошибки');
  const load = storage.slice(storage.indexOf('export function loadPhotoBgUrl'));
  assert.ok(load.includes('warmUpPhotoBgUrl(url);'), 'прогрев вызывается при загрузке адреса');
});

test('селектор панели не ломает сравнение ссылок', () => {
  // filter() прямо в селекторе zustand даёт новый массив на каждый вызов и
  // перерисовывает панель на любое чужое изменение стора.
  assert.ok(!/useChatBgPrefsStore\(\(s\) =>[^)]*\.filter\(/.test(chatListPanel), 'filter не в селекторе');
  assert.ok(chatListPanel.includes('const all = useChatBgPrefsStore((s) => s.userWallpapers[CHAT_LIST_SCOPE])'), 'берём сырое значение');
  assert.ok(chatListPanel.includes('useMemo(() => (all || []).filter'), 'фильтруем в useMemo');
  assert.ok(/import React, \{ useMemo/.test(chatListPanel), 'useMemo импортирован');
});

test('хук не грузит фото лишний раз при перерисовке', () => {
  assert.ok(hooks.includes('const signature = keys.join('), 'зависимость по содержимому, а не по ссылке');
  assert.ok(hooks.includes('return urls;'), 'возвращаем state, а не новый литерал');
  assert.ok(!/usePhotoBgUrls[\s\S]{0,400}return useMemo/.test(hooks), 'без лишнего useMemo вокруг state');
});

// ── Переполнение localStorage при сохранении темы ─────────────────────────────

const editor = read('src/components/ThemeEditor.tsx');

test('окно редактора закрывается даже если сохранение упало', () => {
  // Симптом был такой: жмёшь «Применить и сохранить» — ничего не происходит.
  // onClose стоял ПОСЛЕ сохранения, а переполнение localStorage бросало
  // исключение из persist и прерывало функцию до строки с onClose().
  const save = editor.slice(editor.indexOf('const handleSave = () => {'), editor.indexOf('const handleDelete'));
  // Режем по следующей функции, а не по '};': внутри save есть литерал
  // `{ ...draft, settings: ... }`, и первый же '};' обрезал бы тело в полпути.
  assert.ok(save.includes('try {'), 'сохранение обёрнуто в try');
  assert.ok(save.includes('finally {'), 'закрытие в finally');
  const closeAt = save.indexOf('onClose();');
  const finallyAt = save.indexOf('finally {');
  assert.ok(closeAt > finallyAt, 'onClose находится внутри finally');
});

test('фото-обои не копятся в каждой теме', () => {
  // Снимок брал userPhotoWallpaper — целый dataURL — и он писался в снимок
  // КАЖДОЙ темы. Тем становилось больше, квота заканчивалась, и запись падала.
  const snap = themeStore.slice(themeStore.indexOf('export function snapshotThemeSettings'));
  assert.ok(snap.includes('photo: bg.userPhotoWallpaper'), 'снимок по-прежнему берёт фото');
  const part = themeStore.slice(themeStore.indexOf('partialize: (s) => {'));
  assert.ok(part.includes('const cleanSettings ='), 'снимки чистятся');
  assert.ok(part.includes('next.photo = undefined'), 'фото вырезается из снимка темы');
  assert.ok(part.includes('next.userWallpapers = undefined'), 'галерея обоев вырезается');
  // Иначе первый же крупный dataURL съел бы всю квоту origin.
  assert.ok(part.includes('return [key, cleanSettings(value)]'), 'чистим и settingsByTheme');
});

test('переполнение localStorage не роняет приложение', () => {
  assert.ok(themeStore.includes('function quotaSafeStorage()'), 'есть безопасная обёртка');
  const st = themeStore.slice(themeStore.indexOf('function quotaSafeStorage'));
  assert.ok(st.includes('try { ls().setItem(k, attempts[i]); return; }'), 'пробуем записать');
  assert.ok(st.includes('catch { /* пробуем полегче */ }'), 'и не падаем с первого раза');
  assert.ok(st.includes('localStorage переполнен'), 'хотя бы предупреждаем в консоль');
  // localStorage читаем лениво: в Node при импорте стора его нет, и eager-чтение
  // роняло загрузку модуля целиком (а не только persist).
  assert.ok(st.includes("typeof localStorage !== 'undefined'"), 'доступ к localStorage под guard');
  // Подключить надо именно к persist, иначе ошибка вернётся.
  assert.ok(/name: 'vera-theme-v2',[\s\S]{0,400}storage: createJSONStorage/.test(themeStore), 'storage подключён');
});