/**
 * Доска доказательств.
 *
 * Проверяем три узла, которые ломаются незаметно: правило распознавания группы
 * «Desk», чистку нитей при удалении карточки (висячие концы) и геометрию
 * привязки нити к краю, а не к центру.
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
  isDeskName, emptyBoard, addItem, removeItem, addThread, removeThread, updateItem,
  bringToFront, clampItem, edgePoint, itemCenter, threadPath, findFreeSpot, defaultSize, scaleItem, rotateItem,
  BOARD_W, BOARD_H, THREAD_COLORS,
} = load('src/utils/deskBoard.ts');

/** Карточка-заметка в указанном месте. */
const note = (id, x, y, w = 200, h = 100) => ({
  id, kind: 'note', x, y, w, h, rotation: 0, z: 1, createdAt: 1,
});

// ── Распознавание группы ──────────────────────────────────────────────────────

test('группа с именем, начинающимся на «|», становится доской', () => {
  assert.ok(isDeskName('|'), 'одна черта');
  assert.ok(isDeskName('| Дело'), 'с пробелом');
  assert.ok(isDeskName('|Дело'), 'без пробела');
  assert.ok(isDeskName('  | Ограбление  '), 'пробелы по краям срезаются');
  assert.ok(isDeskName('| Доска улик: 12'), 'с двоеточием и цифрами');
});

test('черта в середине названия — не доска', () => {
  // Иначе любая «Работа | в отделе» неожиданно превращалась бы в доску.
  assert.ok(!isDeskName('Работа | в отделе'), 'в середине');
  assert.ok(!isDeskName('Бюро'), 'без черты');
  assert.ok(!isDeskName(''), 'пусто');
  assert.ok(!isDeskName(undefined), 'без имени');
  assert.ok(!isDeskName(' \\ | в середине'), 'черта не в начале');
});

test('«proto» и «desk» больше не включают доску', () => {
  // Жалоба: «схуяли Proto, доски должны начинаться на |». Старые маркеры
  // больше не работают — иначе «Прототипы» и «Рабочий desk» были бы досками.
  assert.ok(!isDeskName('Proto'), 'Proto');
  assert.ok(!isDeskName('proto дела'), 'proto в начале');
  assert.ok(!isDeskName('Desk Доска'), 'Desk');
  assert.ok(!isDeskName('DESK: ограбление'), 'DESK');
  assert.ok(!isDeskName('Прото доска'), 'по-русски');
});

// ── Карточки ──────────────────────────────────────────────────────────────────

test('карточку нельзя утащить за край доски', () => {
  const i = note('a', 99999, -50);
  const c = clampItem(i);
  assert.equal(c.x, BOARD_W - i.w, 'справа упирается в границу');
  assert.equal(c.y, 0, 'сверху упирается в границу');
});

test('новая карточка ложится в свободное место', () => {
  let b = emptyBoard();
  const spots = [];
  for (let i = 0; i < 5; i++) {
    const spot = findFreeSpot(b, 240, 170);
    spots.push(`${spot.x},${spot.y}`);
    b = addItem(b, note(`n${i}`, spot.x, spot.y));
  }
  assert.equal(new Set(spots).size, spots.length, 'все пять на разных координатах');
});

test('порядок наложения поднимает карточку наверх', () => {
  let b = emptyBoard();
  b = addItem(b, note('a', 0, 0));
  b = addItem(b, note('b', 400, 0));
  const zA = b.items.find((i) => i.id === 'a').z;
  const zB = b.items.find((i) => i.id === 'b').z;
  assert.ok(zB > zA, 'вторая сверху');
  b = bringToFront(b, 'a');
  assert.ok(b.items.find((i) => i.id === 'a').z > zB, 'после фокуса «а» сверху');
});

test('размер карточки под пропорции фото', () => {
  // В полароиде под подпись выделена полоска — высокое фото должно быть выше.
  const wide = defaultSize('photo', 2);
  const tall = defaultSize('photo', 0.5);
  assert.ok(wide.h < tall.h, 'высокое фото выше широкого');
  assert.ok(tall.h > 100, 'поля хватает на картинку');
  assert.equal(defaultSize('note').w, 240, 'заметка стандартная');
});

test('масштабирование держит центр, а поворот ограничен', () => {
  let b = emptyBoard();
  b = addItem(b, { ...note('transform', 100, 80, 200, 100), rotation: 0 });
  b = scaleItem(b, 'transform', 2);
  const scaled = b.items[0];
  assert.equal(scaled.w, 400);
  assert.equal(scaled.h, 200);
  assert.equal(scaled.x, 0, 'центр сохраняется с ограничением у края');
  assert.equal(scaled.y, 30);
  b = rotateItem(b, 'transform', 100);
  assert.equal(b.items[0].rotation, 30, 'вращение ограничено сверху');
  b = rotateItem(b, 'transform', -100);
  assert.equal(b.items[0].rotation, -30, 'вращение ограничено снизу');
});

// ── Нити связей ───────────────────────────────────────────────────────────────

test('нить привязывается к краю карточки, а не к центру', () => {
  // Линия из центра перечёркивает текст и выглядит как паутина.
  const a = note('a', 0, 0);
  const e = edgePoint(a, { x: 700, y: 50 });
  assert.ok(Math.abs(e.x - a.w) < 1e-6, 'попали на правую грань');
  assert.notEqual(e.x, itemCenter(a).x, 'это не центр');
  assert.ok(e.y > 0 && e.y < a.h, 'точка лежит внутри высоты');
});

test('нить упирается в край с любой стороны', () => {
  const a = note('a', 0, 0, 200, 100);
  assert.equal(edgePoint(a, { x: -100, y: 50 }).x, 0, 'влево');
  assert.equal(edgePoint(a, { x: 100, y: -999 }).y, 0, 'вверх');
  assert.equal(edgePoint(a, { x: 100, y: 999 }).y, 100, 'вниз');
  assert.equal(edgePoint(a, { x: 100, y: 50 }).y, 50, 'цель по горизонтали верна');
});

test('нить провисает вниз', () => {
  const d = threadPath(note('a', 0, 0), note('b', 400, 0));
  assert.match(d, /^M [\d.-]+ [\d.-]+ Q /, 'реальный SVG-путь');
  const m = /M ([\d.-]+) ([\d.-]+) Q ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)/.exec(d);
  const y1 = Number(m[2]);
  const ctrlY = Number(m[4]);
  const y2 = Number(m[6]);
  assert.ok(ctrlY > (y1 + y2) / 2, 'контрольная точка ниже — значит провисание');
  assert.equal(threadPath(note('a', 0, 0), note('a', 0, 0)), '', 'самой себе нить не тянем');
});

test('удаление карточки убирает её нити', () => {
  // Иначе оба конца висят в пустоте и рисуются к (0,0).
  let b = emptyBoard();
  b = addItem(b, note('a', 0, 0));
  b = addItem(b, note('b', 400, 0));
  b = addItem(b, note('c', 0, 400));
  b = addThread(b, 'a', 'b', THREAD_COLORS[0]);
  b = addThread(b, 'b', 'c', THREAD_COLORS[1]);
  assert.equal(b.threads.length, 2);
  b = removeItem(b, 'b');
  assert.equal(b.threads.length, 0, 'обе нити через «b» исчезли');
  assert.equal(b.items.length, 2, 'две карточки остались');
});

test('повторные и обратные связи не дублируются', () => {
  let b = emptyBoard();
  b = addItem(b, note('a', 0, 0));
  b = addItem(b, note('b', 400, 0));
  b = addThread(b, 'a', 'b', THREAD_COLORS[0]);
  b = addThread(b, 'a', 'b', THREAD_COLORS[1]);
  assert.equal(b.threads.length, 1, 'та же пара повторно');
  b = addThread(b, 'b', 'a', THREAD_COLORS[1]);
  assert.equal(b.threads.length, 1, 'обратная пара — та же связь');
  b = addThread(b, 'a', 'a', THREAD_COLORS[0]);
  assert.equal(b.threads.length, 1, 'петля не создаётся');
});

test('нить снимается отдельно, не трогая карточки', () => {
  let b = emptyBoard();
  b = addItem(b, note('a', 0, 0));
  b = addItem(b, note('b', 400, 0));
  b = addThread(b, 'a', 'b', THREAD_COLORS[0]);
  b = removeThread(b, b.threads[0].id);
  assert.equal(b.threads.length, 0, 'нить снята');
  assert.equal(b.items.length, 2, 'карточки на месте');
});

// ── Проводка: где доска появляется и как хранится ─────────────────────────────

const hook = read('src/hooks/useDeskBoard.ts');
const chatWindow = read('src/components/ChatWindow.tsx');
const sidebar = read('src/components/Sidebar.tsx');

test('доска включается для группы, названной с «|»', () => {
  // Правило живёт в одном месте, а не продублировано в JSX.
  assert.ok(chatWindow.includes('const isDesk = isDeskName(activeChat?.name)'), 'имя читается в чате');
  assert.ok(chatWindow.includes('isDeskName'), 'функция импортирована');
  assert.ok(/\{isDesk \? \(/.test(chatWindow), 'доска подменяет ленту сообщений');
  assert.ok(sidebar.includes('isDeskName(newGroupName)'), 'подсказка в диалоге создания');
  assert.ok(sidebar.includes('с | — получится доска'), 'пользователь про правило узнаёт');
});

test('доска хранится на сервере, а не в браузере', () => {
  // Главное изменение: пока карточки лежали в IndexedDB, пригласить на доску
  // было нечем — приглашённый открывал свою пустую. Проверяем, что хук идёт
  // в API, а локальной базы больше нет.
  assert.ok(hook.includes('protoBoardApi.get(chatId)'), 'чтение с сервера');
  assert.ok(hook.includes('protoBoardApi.save(chatId'), 'запись на сервер');
  assert.ok(hook.includes('protoBoardApi.uploadPhoto'), 'фото на сервер');
  assert.ok(!hook.includes('deskBoardStorage'), 'локальная база не используется');
  assert.ok(!hook.includes('indexedDB'), 'IndexedDB не остался');
  assert.equal(fs.existsSync(path.join(__dirname, 'src/services/deskBoardStorage.ts')), false, 'файл базы удалён');
});

test('права приходят с сервера и проверяются на записи', () => {
  // Права нельзя держать только в интерфейсе: иначе зритель писал бы в доску
  // мимо кнопок, и сервер отклонил бы запись с ошибкой вместо того, чтобы
  // интерфейс просто не предлагал такое действие.
  assert.ok(hook.includes('myLevel'), 'уровень читается с сервера');
  assert.ok(hook.includes('canEditRef.current = !!data.canEdit'), 'право сохраняется');
  assert.ok(/const mutate = useCallback[\s\S]{0,220}if \(!canEditRef\.current\) return;/.test(hook), 'запись проверяется в mutate');
  assert.ok(hook.includes('if (!chatId || !canEditRef.current) return;'), 'фото — тоже');
  assert.ok(hook.includes('proto-board:updated'), 'доска обновляется по сокету');
});

test('ошибка загрузки превращается в понятный текст', () => {
  // «Не открыта» и «не загрузилась» — разные ситуации: в первом случае надо
  // просить владельца о доступе, во втором перезагружать страницу.
  assert.ok(hook.includes("status === 403 ? 'Вам не открыта эта доска'"), '403 различен');
  assert.ok(hook.includes('Не удалось загрузить доску'), 'остальное');
});

test('правки пишутся с задержкой, а не на каждый кадр', () => {
  // При перетаскивании каждый кадр — отдельная правка, и слать их на сервер
  // на каждое движение мыши нельзя: это превратило бы перетаскивание
  // в слайд-шоу.
  assert.ok(hook.includes('SAVE_DEBOUNCE_MS'), 'задержка объявлена');
  assert.ok(hook.includes('clearTimeout(timerRef.current)'), 'предыдущий таймер отменяется');
  assert.ok(/useEffect\(\(\) => \(\) => \{/.test(hook), 'и есть размонтирование');
  // Ищем по началу литерала и по полю отдельно: вызов многострочный (в теле
  // теперь едет ещё и размер доски), и точное совпадение вида перестало бы
  // быть устойчивым к любой правке.
  assert.ok(hook.includes('protoBoardApi.save(chatId, {'), 'хвост дописывается на сервер');
  assert.ok(hook.includes('items: payload.items,'), 'карточки в теле сохранения');
  assert.ok(hook.includes('width: payload.width'), 'и размер доски тоже — иначе кнопки «±» терялись бы при перезагрузке');
  assert.ok(hook.includes('latestRef.current = next'), 'актуальная замыкание');
});

test('доска настраивается по размеру, а размер переживает перезагрузку', () => {
  const util = load('src/utils/deskBoard.ts');
  const { resizeBoard, boardSize, BOARD_MIN_W, BOARD_MIN_H, BOARD_MAX_W, emptyBoard } = util;
  const b = emptyBoard();
  assert.equal(b.width > 0 && b.height > 0, true, 'у пустой доски есть размер');

  const bigger = resizeBoard(b, 300, 300);
  assert.ok(bigger.width > b.width && bigger.height > b.height, '«+» увеличивает');
  const smaller = resizeBoard(b, -300, -300);
  assert.ok(smaller.width < b.width, '«−» уменьшает');

  // Пол и потолок: без них доску можно было бы сжать в точку (и потерять всё)
  // или растянуть на десятки тысяч пикселей.
  let tiny = b;
  for (let i = 0; i < 50; i++) tiny = resizeBoard(tiny, -300, -300);
  assert.equal(tiny.width, BOARD_MIN_W, 'снизу пол');
  assert.equal(tiny.height, BOARD_MIN_H, 'и по высоте');
  let huge = b;
  for (let i = 0; i < 50; i++) huge = resizeBoard(huge, 300, 300);
  assert.equal(huge.width, BOARD_MAX_W, 'сверху потолок');
  // Мусор с сервера не должен ломать отрисовку. Сравниваем по полям, а не
  // deepEqual: объект рождается внутри vm-контекста с ЧУЖИМ Object.prototype,
  // и strict-сравнение упало бы на прототипе, а не на значениях.
  const fallback = boardSize(undefined, 'мусор');
  assert.equal(fallback.width, b.width, 'битое значение → ширина по умолчанию');
  assert.equal(fallback.height, b.height, 'и высота по умолчанию');
  assert.equal(boardSize(-5, 10).width, BOARD_MIN_W, 'отрицательное → пол');
});

test('папки: карточка ложится внутрь и едет вместе с папкой', () => {
  const { emptyBoard, addItem, assignToFolder, folderAt, moveFolder, countInFolder, removeItem } = load('src/utils/deskBoard.ts');
  const folder = { id: 'f1', kind: 'folder', x: 100, y: 100, w: 500, h: 400, rotation: 0, z: 1, createdAt: 1, text: 'Дело' };
  const card = { id: 'c1', kind: 'note', x: 150, y: 150, w: 240, h: 170, rotation: 0, z: 2, createdAt: 2, text: 'улика' };
  let b = addItem(emptyBoard(), folder);
  b = addItem(b, card);

  assert.equal(folderAt(b, { x: 200, y: 200 }, 'c1')?.id, 'f1', 'точка внутри папки её находит');
  assert.equal(folderAt(b, { x: 900, y: 900 }), null, 'точка снаружи — нет');

  b = assignToFolder(b, 'c1', 'f1');
  assert.equal(countInFolder(b, 'f1'), 1, 'карточка посчитана в папке');
  // Папка в себе — цикл, из которого не выйти.
  b = assignToFolder(b, 'f1', 'f1');
  assert.equal(b.items.find((i) => i.id === 'f1').folderId, undefined, 'папка не ложится в себя');

  // Двигаем папку на 50 вправо — содержимое обязано поехать с ней.
  const before = b.items.find((i) => i.id === 'c1').x;
  const moved = moveFolder(b, 'f1', 150, 100);
  assert.equal(moved.items.find((i) => i.id === 'f1').x, 150, 'папка сдвинулась');
  assert.equal(moved.items.find((i) => i.id === 'c1').x, before + 50, 'карточка поехала вместе с ней');

  // Удаление папки не должно стирать содержимое.
  const cleared = removeItem(b, 'f1');
  assert.equal(cleared.items.length, 1, 'карточка осталась');
  assert.equal(cleared.items[0].folderId, undefined, 'и ссылка на папку убрана');
});

test('папка и HUD живут в интерфейсе доски', () => {
  const desk = read('src/components/DeskBoard.tsx');
  assert.ok(desk.includes('function DeskFolder'), 'папка отрисовывается');
  assert.ok(desk.includes('foldersOf(bus.board).map'), 'папки вынесены на холст');
  // Карточки рисуются ПОВЕРХ папок, иначе они закрывали бы то, что внутри.
  const folderAt2 = desk.indexOf('foldersOf(bus.board).map');
  const cardsAt = desk.indexOf("bus.board.items.filter((i) => i.kind !== 'folder')");
  assert.ok(folderAt2 > -1 && cardsAt > folderAt2, 'сначала папки, потом карточки');
  assert.ok(desk.includes('function BoardHud'), 'есть HUD');
  assert.ok(desk.includes('onClick={p.onAddFolder}'), 'кнопка «Папка» реально создаёт папку');
  assert.ok(/onResize\(-BOARD_STEP, -BOARD_STEP\)/.test(desk), 'кнопка «−» уменьшает');
  assert.ok(/onResize\(BOARD_STEP, BOARD_STEP\)/.test(desk), 'кнопка «+» увеличивает');
  // Смайлики — в поле ввода карточек.
  assert.ok(desk.includes('DESK_EMOJIS'), 'набор смайликов объявлен');
  assert.ok(desk.includes('insertEmoji'), 'вставка по нажатию');
});

test('строка ввода чата на доске не показывается', () => {
  // Жалоба: «убери нижнюю строку с вводом, та что базовая во всех чатах».
  // На доске своё поле для карточек, а две строки ввода занимали бы полэкрана.
  const chatWindow = read('src/components/ChatWindow.tsx');
  assert.ok(
    /display: \(isDesk \|\| iBlockedPeer \|\| peerBlockedMe\) \? 'none' : 'flex'/.test(chatWindow),
    'композер чата скрыт, когда isDesk',
  );
});

test('иконки берутся из шима, а не из пакета напрямую', () => {
  // Шим собирается по фактически используемым иконкам. Импорт несуществующей
  // ломает ИМЕННО сборку: tsc её пропускает, а тесты на текст — тем более.
  const shim = read('src/mui-icons-shim.tsx');
  const files = ['src/components/DeskBoard.tsx', 'src/components/DeskCard.tsx'];
  for (const file of files) {
    const importLine = read(file).match(/from '@mui\/icons-material';/);
    const block = read(file).slice(0, read(file).indexOf("from '@mui/icons-material';"));
    const names = (block.match(/import \{([^}]+)\} from '@mui\/icons-material'/) || [, ''])[1]
      .split(',')
      .map((n) => n.trim().split(/\s+as\s+/).pop())
      .filter(Boolean);
    assert.ok(importLine, `${file} импортирует иконки`);
    for (const name of names) {
      assert.ok(
        new RegExp(`^\\s*${name}: \\{ filled:`).test(shim),
        `${file}: иконки «${name}» нет в mui-icons-shim`,
      );
    }
  }
});

test('доска умеет всё, что обещает интерфейс', () => {
  const desk = read('src/components/DeskBoard.tsx');
  const card = read('src/components/DeskCard.tsx');
  assert.ok(desk.includes('onAddPhoto'), 'кнопка фото');
  assert.ok(desk.includes('onAddNote'), 'кнопка заметки');
  assert.ok(desk.includes('MessageComposer'), 'ввод сообщения прямо на доске');
  assert.ok(!desk.includes('onAddMessage'), 'старой кнопки «Сообщение» нет');
  assert.ok(desk.includes('THREAD_COLORS.map'), 'палитра нитей');
  assert.ok(desk.includes('threadPath('), 'нити рисуются');
  // Панель поверх холста, а не под ним.
  assert.ok(/zIndex: 100/.test(desk), 'панель кликабельна');
  // Касание гасим на КАРТОЧКЕ: без touchAction телефон прокрутит холст
  // вместо перетаскивания улики.
  assert.ok(card.includes("touchAction: 'none'"), 'перетаскивание работает пальцем');
  assert.ok(card.includes('setPointerCapture'), 'захват указателя, иначе тянется не карточка');
  assert.ok(card.includes('[data-desk-nodrag]'), 'кнопки не запускают перетаскивание');
});

test('отпускание мыши не удаляет карточку', () => {
  // Регрессия на жалобу «нажимаю — карточка пропадает, и когда отпускаю тоже».
  // Причина: окончание перетаскивания звало onDrop, а в доске этот обработчик
  // был подключён к bus.drop() — то есть к УДАЛЕНИЮ карточки.
  const desk = read('src/components/DeskBoard.tsx');
  const card = read('src/components/DeskCard.tsx');
  assert.ok(card.includes('onDragEnd: (x: number, y: number) => void;'), 'у карточки свой onDragEnd с координатами');
  assert.ok(!card.includes('onDrop: () => void;'), 'onDrop в пропсах больше нет');
  // Жест зовёт onDragEnd с последней позицией карточки: по ней доска решает,
  // не попала ли карточка в папку. Проверяем наличие вызова, а не соседство
  // строк: комментарий внутри жеста может вырасти, и привязка к расстоянию
  // ломала бы тест на ровном месте.
  assert.ok(card.includes('onDragEnd(last.x, last.y);'), 'жест зовёт onDragEnd с координатами');
  assert.ok(card.includes('const latestRef = useRef({ x: item.x, y: item.y })'), 'позиция запоминается');
  assert.ok(!/const endDrag = \(\) => \{[\s\S]{0,600}onDelete\(\)/.test(card), 'удаление из жеста убрано');
  // Удаление осталось ровно в одном месте — на крестике.
  assert.ok(desk.includes('onDelete={() => bus.drop(item.id)}'), 'крестик удаляет');
  assert.ok(!desk.includes('onDrop={() => bus.drop'), 'а отпускание мыши — нет');
});

test('клик без движения не считается перетаскиванием', () => {
  // Даже без бага с удалением порог нужен: щелчок засчитывался бы как
  // перетаскивание на ноль пикселей и дёргал карточку под курсор.
  const card = read('src/components/DeskCard.tsx');
  assert.ok(card.includes('movedRef'), 'сдвиг отслеживается отдельно от флага dragging');
  assert.ok(/Math\.abs\(e\.clientX/.test(card), 'порог в несколько пикселей');
});

test('сообщение пишется прямо на доске, без диалога', () => {
  // Жалоба: «пишу сообщение, а надо нажать кнопку и доставать оттуда».
  const desk = read('src/components/DeskBoard.tsx');
  assert.ok(desk.includes('MessageComposer'), 'поле ввода есть');
  assert.ok(desk.includes('onSubmit(clean'), 'отправка сразу создаёт карточку');
  assert.ok(!desk.includes('pickOpen'), 'диалог выбора убран');
  // Shift+Enter переносит строку, иначе многострочное сообщение не написать.
  assert.ok(desk.includes("e.key === 'Enter' && !e.shiftKey"), 'Enter отправляет, Shift+Enter переносит');
});

test('зрителю не показывают кнопки, которых у него нет', () => {
  // Иначе интерфейс обещал бы возможность, которой нет: человек нажал бы
  // «Фото» и получил отказ от сервера.
  const desk = read('src/components/DeskBoard.tsx');
  const card = read('src/components/DeskCard.tsx');
  assert.ok(desk.includes('{p.canEdit && ('), 'кнопки создания только редактору');
  assert.ok(card.includes('{!readOnly && ('), 'крестик и нить только редактору');
  assert.ok(desk.includes('readOnly={!bus.rights.canEdit}'), 'режим зрителя передан в карточку');
  assert.ok(card.includes('if (readOnly) return;'), 'зритель не начинает перетаскивание');
});

test('владельцу открывается управление доступом', () => {
  const desk = read('src/components/DeskBoard.tsx');
  assert.ok(desk.includes('AccessDialog'), 'диалог есть');
  assert.ok(desk.includes('{p.canManage && ('), 'кнопка «Доступ» только владельцу');
  assert.ok(desk.includes('Только просмотр'), 'два уровня на выбор');
  assert.ok(desk.includes('bus.grant(userId, level)'), 'выдача права');
  assert.ok(desk.includes('bus.revoke('), 'отзыв доступа');
});


test('перетаскивание не уводит карточку за холст', () => {
  let b = emptyBoard();
  b = addItem(b, note('a', 10, 10));
  b = updateItem(b, 'a', { x: 99999, y: 99999 });
  const a = b.items[0];
  assert.equal(a.x, BOARD_W - a.w, 'справа');
  assert.equal(a.y, BOARD_H - a.h, 'снизу');
});
