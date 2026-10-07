const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Тест лежит в корне репозитория и читает файлы и из Server/, и из Web/:
// блокировка — это сквозная история (сервер запрещает, клиент показывает).
const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const blocksModule = read('Server/blocks.js');
const server = read('Server/server.js');
const chatWindow = read('Web/src/components/ChatWindow.tsx');
const chatInfo = read('Web/src/components/ChatInfoPanel.tsx');
const modPanel = read('Web/src/components/ModerationPanel.tsx');
const entryPage = read('Web/src/pages/DeviceEntryPage.tsx');
const authStore = read('Web/src/store/authStore.ts');
const dialog = read('Web/src/components/ChatThemeDialog.tsx');

// ── Редактор темы чата: переключение галочки не закрывает окно ────────────────

test('отсутствие темы чата не должно менять тип элемента-обёртки', () => {
  // Регрессия: галочка «Применять для этого чата» закрывала окно редактора.
  // ChatThemeScope возвращал то ThemeProvider, то Fragment, и смена enabled
  // (галочка) меняла тип элемента на этой позиции. React на смену типа
  // пересоздаёт поддерево целиком, поэтому все useState внутри ChatWindowInner
  // сбрасывались — вместе с chatThemeOpen, и редактор закрывался сам.
  const scope = chatWindow.slice(
    chatWindow.indexOf('function ChatThemeScope'),
    chatWindow.indexOf('export default function ChatWindow'),
  );
  assert.ok(
    !/if \(!chatTheme\) return <>/.test(scope),
    'ThemeProvider рендерится всегда, тип обёртки не скачет',
  );
  assert.ok(
    /return <ThemeProvider theme=\{scopedTheme\}>\{children\}<\/ThemeProvider>;/.test(scope),
    'единственный выход — ThemeProvider',
  );
  // Без темы чата берётся ровно внешняя тема: палитра не меняется зря.
  assert.ok(
    /\? createTheme\(outerTheme, \{ palette: muiPaletteFromTheme\(chatTheme\) \}\) : outerTheme\)/.test(scope),
    'без темы чата используется outerTheme',
  );
});

test('редактор темы чата переживает переключение галочки «Применять»', () => {
  // enabled обязан уехать в стор, а не закрывать редактор.
  assert.ok(
    /setChatTheme\(chatId, \{ \.\.\.\(current \|\| initialTheme\), enabled: event\.target\.checked \}\)/.test(dialog),
    'галочка пишет enabled в тему чата',
  );
  assert.ok(
    /chatThemeOverride\.enabled !== false/.test(chatWindow),
    'выключенная тема чата даёт null — и это обязано быть без пересоздания дерева',
  );
});

// ── Блокировка: сервер запрещает писать, клиент показывает кнопку ──────────────

test('блокировка запрещает отправку на обоих путях: REST и WebSocket', () => {
  // Только REST недостаточно: клиент шлёт сообщения через сокет, и блокировку
  // можно было бы обойти, оставив проверку лишь в handleSendMessage.
  assert.ok(
    /function userBlockedInChat\(chatId, userId\)/.test(server),
    'единая проверка блокировки в чате',
  );
  // Считаем именно ВЫЗОВЫ: само объявление функции тоже содержит ту же строку.
  const calls = server.match(/if \(userBlockedInChat\(chatId, userId\)\)/g) || [];
  assert.equal(calls.length, 2, 'проверка вызывается и в REST, и в WS');
  // Проверка самодостаточна: участки server.js выполняются тестами в изоляции,
  // где внешний модуль blocks не объявлен.
  const body = server.slice(
    server.indexOf('function userBlockedInChat'),
    server.indexOf('function handleSendMessage'),
  );
  assert.ok(!body.includes('blocks.'), 'проверка не зависит от внешнего модуля');
  assert.ok(body.includes('db.userBlocks'), 'читает записи блокировок');
});

test('блокировка односторонняя и привязана к присутствию блокирующего в чате', () => {
  // А заблокировал Б. Б не пишет в чат с А, но спокойно пишет в другие чаты.
  assert.ok(
    /blockerId === member\.userId && block\.blockedId === userId/.test(server),
    'ищем блокировку именно этого участника на этого отправителя',
  );
  assert.ok(
    /member\.chatId === chatId && member\.userId !== userId/.test(server),
    'сам отправитель исключён из проверки',
  );
});

test('блокировка доступна только залогиненному и не распространяется на админа', () => {

test('вместо строки ввода показывается кнопка «Разблокировать»', () => {
  assert.ok(chatWindow.includes('Разблокировать'), 'кнопка разблокировки есть');
  assert.ok(chatWindow.includes('Вы заблокировали этого пользователя'), 'и понятно, что произошло');
  // Поле ввода именно скрывается, а не просто блокируется — и при своей, и при
  // чужой блокировке: в обоих случаях писать всё равно нельзя.
  assert.ok(
    /display: \(iBlockedPeer \|\| peerBlockedMe\) \? 'none' : 'flex'/.test(chatWindow),
    'строка ввода заменяется панелью',
  );
  assert.ok(chatWindow.includes('blocks.unblock(chatPeerId)'), 'кнопка снимает блокировку');
});

test('заблокировавшему меня поле заблокировано, и у него есть апелляция', () => {
  assert.ok(chatWindow.includes('peerBlockedMe'), 'состояние «меня заблокировали»');
  assert.ok(
    chatWindow.includes('Вас заблокировал этот пользователь'),
    'внятное объяснение вместо молчаливого запрета',
  );
  assert.ok(chatWindow.includes('Подать апелляцию'), 'кнопка апелляции доступна');
  // Чужую блокировку снять нельзя — кнопка разблокировки тут не показывается.
  assert.ok(
    /const iBlockedPeer = !!chatPeerId && blocks\.isBlocked\(chatPeerId\)/.test(chatWindow),
    'кнопка разблокировки только для своей блокировки',
  );
  // А панель с апелляцией — наоборот, только когда заблокировали МЕНЯ.
  assert.ok(
    /\{peerBlockedMe && \(/.test(chatWindow),
    'апелляция показывается только при чужой блокировке',
  );
});

test('кнопка блокировки есть в панели чата и только для лички', () => {
  assert.ok(chatInfo.includes('Заблокировать'), 'кнопка есть в панели информации');
  assert.ok(chatInfo.includes('Разблокировать'), 'и переключается в разблокировку');
  assert.ok(
    /\{!isGroup && peerId && \(/.test(chatInfo),
    'в группах кнопки нет: там запрет писать означал бы запрет для всех',
  );
});

// ── Апелляции ─────────────────────────────────────────────────────────────────

test('апелляцию может подать только заблокированный или забаненный', () => {
  // Иначе через форму админов можно было бы завалить спамом.
  assert.ok(
    /if \(!banned && !blockedBy\.length\)/.test(blocksModule),
    'проверка статуса перед созданием апелляции',
  );
  assert.ok(
    /appeal\.userId === userId && appeal\.status === 'open'/.test(blocksModule),
    'вторая апелляция, пока первая открыта, не принимается',
  );
});

test('забаненный подаёт апелляцию по cookie установки, а не по токену', () => {
  // У забаненного нет действующего JWT: verifyAccessToken бросает
  // ACCOUNT_BANNED. Без отдельного пути апелляцию подать было бы нечем.
  assert.ok(blocksModule.includes("app.post('/api/auth/appeal'"), 'путь для забаненных есть');
  const cookieRoute = blocksModule.slice(blocksModule.indexOf("app.post('/api/auth/appeal'"));
  assert.ok(cookieRoute.includes('resolveInstallationUser'), 'опознаём установку по cookie');
  assert.ok(cookieRoute.includes('if (!isBannedUser(userId))'), 'пускаем только забаненных');
  assert.ok(server.includes('resolveInstallationUser: (req) =>'), 'резолвер подключён на сервере');
});

test('экран бана предлагает апелляцию и не даёт подать вторую', () => {
  assert.ok(authStore.includes('isBanned'), 'бан распознаётся при входе');
  assert.ok(authStore.includes('ACCOUNT_BANNED'), 'по коду ответа сервера');
  assert.ok(entryPage.includes('Аккаунт заблокирован'), 'показан бан, а не просто вход');
  assert.ok(entryPage.includes('Подать апелляцию'), 'есть кнопка апелляции');
  assert.ok(entryPage.includes('appealsApi.sendBanned'), 'апелляция уходит по cookie');
});

test('апелляции появляются у админа и по ней можно снять бан', () => {
  assert.ok(modPanel.includes('Апелляции'), 'раздел в админ-панели');
  assert.ok(modPanel.includes('appealsApi.adminList'), 'список подгружается');
  assert.ok(modPanel.includes('appealsApi.decide'), 'решение применяется');
  assert.ok(blocksModule.includes('/#/admin?appeal='), 'в уведомлении ссылка на апелляцию');
  // Решение overturn обязано реально снимать бан, а не только закрывать апелляцию.
  assert.ok(
    /moderationBans[\s\S]{0,120}ban\.userId !== appeal\.userId/.test(blocksModule),
    'overturn снимает бан аккаунта',
  );
});

  assert.ok(blocksModule.includes("app.post('/api/users/:id/block', auth"), 'нужна авторизация');
  assert.ok(blocksModule.includes('Нельзя заблокировать себя'), 'себя нельзя');
  assert.ok(blocksModule.includes('Нельзя заблокировать администратора'), 'админа нельзя');
  assert.ok(
    blocksModule.includes('blockerId: req.userId') && blocksModule.includes('blockedId: targetId'),
    'пара сохраняется',
  );
});
