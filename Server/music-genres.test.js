/**
 * Жанры общей библиотеки: один канон на все синонимы.
 *
 * Проверяем ровно то, из-за чего модуль написан: «рок» и «Рок» обязаны стать
 * одним жанром, иначе фильтр по жанру разваливается на первой же публикации.
 * Отдельно — что список закрытый и что чужой жанр не подставляется молча.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { GENRES, GROUPS, ALIASES, normalizeKey, normalizeGenre, canonicalOrKeep } = require('./music-genres');
const { validatePublish, matchTrack, matchAlbum } = require('./music-share');

test('регистр не делает новый жанр', () => {
  for (const raw of ['рок', 'Рок', 'РОК', 'РоК', ' rock ', 'Rock']) {
    assert.equal(normalizeGenre(raw), 'Рок', `"${raw}" → Рок`);
  }
});

test('синонимы ведут в один жанр', () => {
  // Из задачи: поп и попса — один жанр.
  for (const raw of ['поп', 'Поп', 'попса', 'Попса', 'pop', 'поп-музыка']) {
    assert.equal(normalizeGenre(raw), 'Поп', `"${raw}" → Поп`);
  }
  // Оформление не должно плодить жанры.
  for (const raw of ['R&B', 'rnb', 'рнб', 'R&B']) {
    assert.equal(normalizeGenre(raw), 'R&B', `"${raw}" → R&B`);
  }
  assert.equal(normalizeGenre('рок-н-ролл'), 'Рок', 'тире и пробелы не важны');
  assert.equal(normalizeGenre("Rock'n'roll"), 'Рок');
  // «ё» и «е» — один жанр.
  assert.equal(normalizeGenre('Лоу-фай'), 'Лоу-фай');
});

test('каждый жанр списка резолвится сам в себя', () => {
  // Регрессия: если новый жанр добавили в список, но забыли про синонимы,
  // публикация с ним молча отклонилась бы.
  for (const g of GENRES) {
    assert.equal(normalizeGenre(g), g, g);
  }
});

test('каждый синоним ведёт в жанр из списка', () => {
  // Синоним в никуда не ведущий — мёртвый код, который врёт при чтении.
  for (const [key, value] of Object.entries(ALIASES)) {
    assert.ok(GENRES.includes(value), `«${key}» → «${value}» есть в списке`);
    assert.ok(key, 'ключ не пустой');
    assert.equal(normalizeKey(key), key, `ключ «${key}» уже нормализован`);
  }
});

test('неизвестный жанр не подставляется', () => {
  assert.equal(normalizeGenre('квантовая музыка'), null);
  assert.equal(normalizeGenre(''), null);
  assert.equal(normalizeGenre(null), null);
  assert.equal(normalizeGenre(undefined), null);
});

test('жанры разложены по группам, а не в один длинный список', () => {
  // 69 жанров одним списком не найти: пришлось бы прокручивать мимо половины.
  // Группы повторяют деление из исходного перечня.
  assert.ok(GROUPS.length >= 8, 'групп достаточно для навигации');
  assert.equal(GENRES.length, GROUPS.flatMap((g) => g.genres).length, 'плоский список собран из групп');
  // Каждый жанр ровно в одной группе: иначе в списке были бы дубли.
  const flat = GROUPS.flatMap((g) => g.genres);
  assert.equal(new Set(flat).size, flat.length, 'дублей жанров нет');
  for (const group of GROUPS) {
    assert.ok(group.name, 'у группы есть название');
    assert.ok(group.genres.length > 0, `группа «${group.name}» не пустая`);
  }
});

test('жанры из вашего списка на месте', () => {
  // Если кто-то из ваших жанров потерялся при переносе — список молча стал бы
  // короче, и выбранного жанра не нашлось бы в выпадающем списке.
  for (const g of [
    'Народная музыка', 'Фолк', 'Этническая', 'Духовная музыка', 'Хоралы', 'Месса',
    'Литургия', 'Псалмы', 'Академическая музыка', 'Симфония', 'Опера', 'Балет',
    'Концерт', 'Соната', 'Кантата', 'Оратория', 'Популярная музыка', 'Поп',
    'Европоп', 'Тин-поп', 'Данс-поп', 'Синти-поп', 'K-pop', 'Рок', 'Хард-рок',
    'Метал', 'Панк-рок', 'Поп-рок', 'Инди-рок', 'Альтернативный рок',
    'Психоделический рок', 'Глэм-рок', 'Фолк-рок', 'Джаз', 'Свинг', 'Бибоп',
    'Кул-джаз', 'Хард-боп', 'Модальный джаз', 'Фри-джаз', 'Фьюжн',
    'Латинский джаз', 'Эйсид-джаз', 'Ню-джаз', 'Блюз', 'Хип-хоп', 'Олдскул',
    'Трэп', 'Дрилл', 'Джаз-рэп', 'Электронная музыка', 'Хаус', 'Техно',
    'Драм-н-бейс', 'Транс', 'Эмбиент', 'Даунтемпо', 'Синтвейв', 'Нинтендокор',
    'Постиндастриал', 'Кантри', 'Регги', 'Соул Рэп',
  ]) {
    assert.ok(GENRES.includes(g), `«${g}» есть в списке`);
  }
});

test('новые жанры узнают синонимы', () => {
  // Раньше списка не было — значит, и приведения к канону тоже не было:
  // «драм-н-бейс», «dnb» и «Drum'n'Bass» стали бы тремя жанрами.
  const cases = [
    ['драм-н-бейс', 'Драм-н-бейс'],
    ["Drum'n'Bass", 'Драм-н-бейс'],
    ['dnb', 'Драм-н-бейс'],
    ['панк', 'Панк-рок'],
    ['панк-рок', 'Панк-рок'],
    ['K-pop', 'K-pop'],
    ['kpop', 'K-pop'],
    ['металл', 'Метал'],
    ['хеви-метал', 'Метал'],
    ['классика', 'Академическая музыка'],
    ['classical', 'Академическая музыка'],
    ['world music', 'Этническая'],
    ['соул рэп', 'Соул Рэп'],
    ['хаус', 'Хаус'],
    ['техно', 'Техно'],
    ['транс', 'Транс'],
    ['nintendocore', 'Нинтендокор'],
    ['модал', 'Модальный джаз'],
    ['свинг', 'Свинг'],
    ['фьюжн', 'Фьюжн'],
    ['олдскул', 'Олдскул'],
    ['трэп', 'Трэп'],
  ];
  for (const [raw, want] of cases) {
    assert.equal(normalizeGenre(raw), want, `"${raw}" → ${want}`);
  }
});

test('гипержанр не съедает поджанры и наоборот', () => {
  // Ключевая тонкость расширенного списка: «Панк-рок» и «Рок» — разные жанры,
  // как и «Хип-хоп» с «Джаз-рэп». Если бы «панк» и «рок» схлопывались в одно,
  // фильтр перестал бы различать поджанры.
  assert.notEqual(normalizeGenre('Панк-рок'), normalizeGenre('Рок'));
  assert.notEqual(normalizeGenre('Поп-рок'), normalizeGenre('Рок'));
  assert.notEqual(normalizeGenre('Хип-хоп'), normalizeGenre('Джаз-рэп'));
  assert.notEqual(normalizeGenre('Фолк'), normalizeGenre('Фолк-рок'));
  assert.notEqual(normalizeGenre('Фьюжн'), normalizeGenre('Джаз'));
  assert.notEqual(normalizeGenre('Синти-поп'), normalizeGenre('Синтвейв'));
});

test('пустая строка не проходит как ключ', () => {
  // Регрессия: без проверки на '' запрос пустого жанра совпал бы с первой
  // буквой любого жанра, и поиск без запроса возвращал бы всё подряд.
  assert.equal(normalizeKey('  '), '');
});

test('canonicalOrKeep приводит известное и бережёт незнакомое', () => {
  assert.equal(canonicalOrKeep('Rock'), 'Рок', 'известное → канон');
  assert.equal(canonicalOrKeep('рока'), 'Рок');
  assert.equal(canonicalOrKeep('квантовая'), 'квантовая', 'чужое описание не выбрасываем');
  assert.equal(canonicalOrKeep(''), null);
  assert.equal(canonicalOrKeep(null), null);
});

// ─── Публикация приводит жанр к канону ───────────────────────────────────────

const full = (over = {}) => ({ title: 'Трек', artist: 'Кто-то', genre: 'Рок', coverUrl: '/uploads/music/c.jpg', ...over });

test('публикация хранит канон, а не то, что написали', () => {
  // Главное: в БД попадает 'Рок', а не 'рок' или 'rock'. Иначе в общем списке
  // появились бы три разных жанра для одного и того же.
  for (const raw of ['рок', 'Рок', 'rock', 'рока', 'рок-н-ролл']) {
    const r = validatePublish(full({ genre: raw }));
    assert.ok(r.ok, raw);
    assert.equal(r.clean.genre, 'Рок', `"${raw}" → в БД "Рок"`);
  }
});

test('неизвестный жанр отклоняется, а не проходит как есть', () => {
  const r = validatePublish(full({ genre: 'квантовая музыка' }));
  assert.equal(r.ok, false);
  assert.equal(r.unknownGenre, true, 'клиент поймёт, что дело в жанре');
  assert.ok(r.errors.includes('genre'), 'поле помечено для подсветки');
});

test('пустой жанр — это отсутствие поля, а не неизвестный', () => {
  // Разница важна в сообщении: «выберите из списка» при пустом поле сбивает
  // с толку — человек подумает, что написал что-то не то.
  const r = validatePublish(full({ genre: '' }));
  assert.equal(r.ok, false);
  assert.equal(r.unknownGenre, false);
  assert.ok(r.errors.includes('genre'));
});

test('остальные обязательные поля не сломан жанром', () => {
  // Регрессия на сообщение: если бы unknownGenre проверялся по факту непустоты,
  // пустое название давало бы «Такого жанра нет».
  const r = validatePublish(full({ title: '', genre: '' }));
  assert.equal(r.unknownGenre, false);
  const r2 = validatePublish(full({ genre: 'ерунда', coverUrl: '' }));
  assert.equal(r2.unknownGenre, true, 'всё равно про жанр — он и правда неизвестен');
  assert.ok(r2.errors.includes('coverUrl'));
});

test('поиск по жанру находит по синониму и по началу', () => {
  const t = { title: 'X', artist: 'Y', genre: 'Рок' };
  assert.ok(matchTrack(t, 'рок'), 'строчными');
  assert.ok(matchTrack(t, 'Рок'), 'каноном');
  assert.ok(matchTrack(t, 'rock'), 'английским синонимом');
  assert.ok(matchTrack(t, 'рока'), 'падежом');
  // Обрезанный запрос ищет по началу СВОЕГО жанра, а не чужого: «хип» должен
  // находить «Хип-хоп» и не должен находить «Рок».
  assert.ok(matchTrack({ genre: 'Хип-хоп' }, 'хип'), 'по началу жанра');
  assert.equal(matchTrack(t, 'хип'), false, 'но чужой жанр — нет');
  assert.ok(matchTrack({ genre: 'Хип-хоп' }, 'Хип-хоп'), 'полным именем');
});

test('короткий запрос не цепляет чужой жанр', () => {
  // 'пок' не должен находить 'Поп' по подстроке — иначе в поиске всплывали бы
  // треки, которые человек не искал.
  assert.equal(matchTrack({ genre: 'Поп' }, 'пок'), false);
  assert.equal(matchTrack({ genre: 'Хип-хоп' }, 'хи'), true, 'но «хи» находит «Хип-хоп»');
});

test('поиск по названию и жанру не мешают друг другу', () => {
  const t = { title: 'Рок-вечер', artist: 'A', genre: 'Поп' };
  assert.ok(matchTrack(t, 'вечер'), 'по названию');
  assert.ok(matchTrack(t, 'поп'), 'по жанру');
  assert.equal(matchTrack(t, 'джаз'), false, 'чужого жанра нет');
});

test('альбом ищется по жанру так же', () => {
  const a = { title: 'A', artist: 'B', genre: 'Рок' };
  assert.ok(matchAlbum(a, 'рок'));
  assert.ok(matchAlbum(a, 'rock'));
  assert.equal(matchAlbum(a, 'джаз'), false);
});

test('трек без жанра не ломает поиск', () => {
  assert.ok(matchTrack({ title: 'Без жанра' }, 'без'), 'по названию');
  assert.equal(matchTrack({ title: 'X' }, 'рок'), false, 'по жанру — нет');
});