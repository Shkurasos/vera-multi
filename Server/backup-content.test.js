const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Выгрузка тестов идёт в отдельную временную папку: иначе тесты писали бы в
// настоящий Server/content и подменяли бы реальный бэкап тем тестовыми данными.
let CONTENT_DIR = '';

/**
 * Готовим изолированную БД и выгружает её через настоящий скрипт.
 * Права админа (темы/обои) живут в runtime-данных, которые в .gitignore —
 * поэтому скрипт обязан выносить их в папку рядом с кодом.
 */
function withFakeDb(run) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-backup-'));
  // Выгрузка — в папку внутри tmp. Иначе тесты писали бы в настоящий
  // Server/content и подменяли бы реальный бэкап тестовыми данными, а заодно
  // ломали бы параллельные прогоны других наборов тестов.
  CONTENT_DIR = path.join(tmp, 'content');
  process.env.CONTENT_DIR = CONTENT_DIR;
  const dbFile = path.join(tmp, 'vera.json');
  const uploads = path.join(tmp, 'uploads');
  fs.mkdirSync(path.join(uploads, 'wallpapers'), { recursive: true });
  fs.writeFileSync(path.join(uploads, 'wallpapers', 'photo1.jpg'), 'JPEGBYTES');

  fs.writeFileSync(dbFile, JSON.stringify({
    users: [{ id: 'u1' }],
    builtinThemes: {
      overrides: { 1: { id: 1, name: 'Правленая' } },
      removed: [7],
      added: [{ id: 900, name: 'Новая' }],
      updatedAt: '2026-01-01',
    },
    builtinWallpapers: {
      items: [{ id: 'w1', type: 'photo', url: '/uploads/wallpapers/photo1.jpg' }],
      hidden: [],
      overrides: {},
      updatedAt: '2026-01-02',
    },
  }, null, 2));

  process.env.DATA_DIR = tmp;
  process.env.DB_FILE = dbFile;
  process.env.UPLOADS_DIR = uploads;
  // Модуль читает пути при загрузке — перезагружаем под тестовые.
  delete require.cache[require.resolve('./backup-content')];
  const mod = require('./backup-content');
  try { run(mod, { dbFile, uploads }); }
  finally {
    delete require.cache[require.resolve('./backup-content')];
    for (const k of ['DATA_DIR', 'DB_FILE', 'UPLOADS_DIR', 'CONTENT_DIR']) delete process.env[k];
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('выгрузка забирает правки тем в файл, а не только в БД', () => {
  withFakeDb((mod) => {
    mod.backup();
    const out = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'themes.json'), 'utf8'));
    assert.deepEqual(out.overrides, { 1: { id: 1, name: 'Правленая' } });
    assert.deepEqual(out.removed, [7]);
    assert.equal(out.added.length, 1);
  });
});

test('выгрузка забирает обои и КОПИРУЕТ файлы фото', () => {
  withFakeDb((mod) => {
    mod.backup();
    const list = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'wallpapers.json'), 'utf8'));
    assert.equal(list.items.length, 1);
    // Без самого файла ссылка в каталоге бесполезна: картинка не покажется.
    const photo = path.join(CONTENT_DIR, 'wallpapers', 'photo1.jpg');
    assert.ok(fs.existsSync(photo), 'файл обоев скопирован рядом с кодом');
    assert.equal(fs.readFileSync(photo, 'utf8'), 'JPEGBYTES');
  });
});

test('восстановление возвращает каталог тем и обои в БД', () => {
  withFakeDb((mod) => {
    mod.backup();
    // Чистая установка: каталога нет — как на новой машине после git push.
    fs.writeFileSync(process.env.DB_FILE, JSON.stringify({ users: [{ id: 'u1' }] }));
    fs.rmSync(path.join(process.env.UPLOADS_DIR, 'wallpapers'), { recursive: true, force: true });

    mod.restore();
    const db = JSON.parse(fs.readFileSync(process.env.DB_FILE, 'utf8'));
    assert.equal(db.builtinThemes.overrides[1].name, 'Правленая');
    assert.equal(db.builtinThemes.removed[0], 7);
    assert.equal(db.builtinWallpapers.items.length, 1);
    // Файл обоев обязан вернуться в uploads, иначе ссылка в каталоге мёртвая.
    const restored = path.join(process.env.UPLOADS_DIR, 'wallpapers', 'photo1.jpg');
    assert.ok(fs.existsSync(restored), 'файл обоев возвращён в uploads');
    assert.equal(fs.readFileSync(restored, 'utf8'), 'JPEGBYTES');
  });
});

test('восстановление не затирает пользователей и прочий БД', () => {
  withFakeDb((mod) => {
    mod.backup();
    fs.writeFileSync(process.env.DB_FILE, JSON.stringify({ users: [{ id: 'u1' }], chats: [{ id: 'c1' }] }));
    mod.restore();
    const db = JSON.parse(fs.readFileSync(process.env.DB_FILE, 'utf8'));
    assert.equal(db.users.length, 1, 'пользователи на месте');
    assert.equal(db.chats.length, 1, 'чаты на месте');
    assert.ok(db.builtinThemes, 'каталог тем добавлен');
  });
});

test('выгрузка не тащит в репозиторий рантайм-БД целиком', () => {
  const { pickThemes } = require('./backup-content');
  const only = pickThemes({
    builtinThemes: { overrides: { 1: {} }, removed: [], added: [], updatedAt: 'x', junk: 'нет' },
    users: [{ id: 'u1', passwordHash: 'секрет' }],
  });
  assert.ok(!('junk' in only), 'лишние поля каталога не выгружаются');
  assert.ok(!('users' in only), 'пользователи в выгрузку тем не попадают');
});

test('восстановление без файла выгрузки падает понятно, а не молча', () => {
  withFakeDb((mod) => {
    const file = path.join(CONTENT_DIR, 'themes.json');
    const saved = fs.existsSync(file) ? fs.readFileSync(file) : null;
    if (fs.existsSync(file)) fs.rmSync(file);
    assert.throws(() => mod.restore(), /нечего восстанавливать/);
    if (saved) fs.writeFileSync(file, saved);
  });
});

test('после рестарта на эфемерном диске каталог поднимается сам', () => {
  // Главный сценарий арендованного сервера: диск обнулился, vera.json потерян,
  // но Server/content/ лежит в репозитории. seedOnBoot обязан вернуть правки,
  // иначе все пользователи молча вернулись к заводским темам.
  withFakeDb((mod) => {
    mod.backup();
    // Чистая установка после редеплоя: каталога в БД нет.
    fs.writeFileSync(process.env.DB_FILE, JSON.stringify({ users: [{ id: 'u1' }] }));
    fs.rmSync(path.join(process.env.UPLOADS_DIR, 'wallpapers'), { recursive: true, force: true });

    const seeded = mod.seedOnBoot();
    assert.equal(seeded, true, 'каталог восстановлен при старте');
    const db = JSON.parse(fs.readFileSync(process.env.DB_FILE, 'utf8'));
    assert.equal(db.builtinThemes.overrides[1].name, 'Правленая');
    assert.equal(db.builtinWallpapers.items.length, 1);
    // Файлы обоев тоже: без них ссылка в каталоге бесполезна.
    assert.ok(fs.existsSync(path.join(process.env.UPLOADS_DIR, 'wallpapers', 'photo1.jpg')));
  });
});

test('живые правки админа автовосстановление НЕ затирает', () => {
  // Обратная сторона: если каталог в БД уже есть, выгрузка из репозитория не
  // должна его переписывать — иначе правка, сделанная после рестарта, стёрлась бы.
  withFakeDb((mod) => {
    fs.mkdirSync(CONTENT_DIR, { recursive: true });
    fs.writeFileSync(path.join(CONTENT_DIR, 'themes.json'), JSON.stringify({
      overrides: { 1: { id: 1, name: 'Старая из репозитория' } }, removed: [], added: [],
    }));
    fs.writeFileSync(path.join(CONTENT_DIR, 'wallpapers.json'), JSON.stringify({
      items: [{ id: 'w-old', type: 'photo', url: '/uploads/wallpapers/old.jpg' }],
    }));

    // В БД обе секции уже есть — чистый случай «выгрузка из репозитория устарела».
    fs.writeFileSync(process.env.DB_FILE, JSON.stringify({
      users: [{ id: 'u1' }],
      builtinThemes: { overrides: { 2: { id: 2, name: 'Свежая правка админа' } }, removed: [], added: [] },
      builtinWallpapers: { items: [{ id: 'w-new', type: 'css' }], hidden: [], overrides: {} },
    }));

    const seeded = mod.seedOnBoot();
    assert.equal(seeded, false, 'ничего не восстанавливаем');
    const db = JSON.parse(fs.readFileSync(process.env.DB_FILE, 'utf8'));
    assert.equal(db.builtinThemes.overrides[2].name, 'Свежая правка админа');
    assert.ok(!db.builtinThemes.overrides[1], 'старая выгрузка не подмешалась');
    assert.equal(db.builtinWallpapers.items[0].id, 'w-new', 'обои админа не заменены выгрузкой');
  });
});

test('каждая секция восстанавливается независимо', () => {
  // Темы уже есть, а обоев нет (или наоборот). Восстанавливаем ровно
  // недостающее: иначе правило «каталог не пуст — не трогаем» оставило бы
  // пользователей без обоев после обнуления диска.
  withFakeDb((mod) => {
    mod.backup();
    fs.writeFileSync(process.env.DB_FILE, JSON.stringify({
      users: [],
      builtinThemes: { overrides: { 5: { id: 5, name: 'Живая тема' } }, removed: [], added: [] },
    }));
    assert.equal(mod.seedOnBoot(), true, 'восстановлены только обои');
    const db = JSON.parse(fs.readFileSync(process.env.DB_FILE, 'utf8'));
    assert.equal(db.builtinThemes.overrides[5].name, 'Живая тема', 'темы админа целы');
    assert.equal(db.builtinWallpapers.items.length, 1, 'обои вернулись');
  });
});

test('пустой каталог в БД считается отсутствующим', () => {
  // Каталог может существовать, но быть пустым — после обнуления диска он
  // именно такой. Такой случай обязан лечиться, иначе правки не вернутся.
  withFakeDb((mod) => {
    mod.backup();
    fs.writeFileSync(process.env.DB_FILE, JSON.stringify({
      users: [],
      builtinThemes: { overrides: {}, removed: [], added: [] },
    }));
    assert.equal(mod.seedOnBoot(), true, 'пустой каталог восстановлен');
  });
});

test('без выгрузки в репозитории старт ничего не ломает', () => {
  withFakeDb((mod) => {
    assert.equal(mod.seedOnBoot(), false, 'нечего восстанавливать');
  });
});

test('синхронизация после правки не роняет саму правку', () => {
  // sync() оборачивает выгрузку в try/catch: сбой записи не должен приводить
  // к 500 на публикации тем — иначе админ не смог бы применить правку.
  withFakeDb((mod) => {
    fs.writeFileSync(process.env.DB_FILE, JSON.stringify({ users: [], builtinThemes: {} }));
    assert.doesNotThrow(() => mod.sync());
  });
});

test('сервер зовёт автовосстановление при старте', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.ok(/require\('\.\/backup-content'\)\.seedOnBoot\(\)/.test(src), 'вызов есть');
  // Именно после чтения БД, иначе нечего восстанавливать.
  const dbAt = src.indexOf('JSON.parse(fs.readFileSync(DB_FILE');
  const seedAt = src.indexOf('seedOnBoot()');
  assert.ok(seedAt > dbAt, 'автовосстановление идёт после загрузки БД');
});

test('публикация тем сразу зеркалится в репозиторий', () => {
  const src = fs.readFileSync(path.join(__dirname, 'themes.js'), 'utf8');
  assert.ok(/backup-content'\)\.sync\(\)/.test(src), 'темы синхронизируются');
  const wSrc = fs.readFileSync(path.join(__dirname, 'admin-wallpapers.js'), 'utf8');
  assert.ok(/backup-content'\)\.sync\(\)/.test(wSrc), 'обои синхронизируются');
});

test('удалённые обои не копятся в выгрузке', () => {
  // Регресс: файл удалялся из uploads, но оставался в content/wallpapers/ —
  // репозиторий пух от фото, которые уже нигде не используются и восстановить
  // их нельзя (в каталоге их нет).
  withFakeDb((mod) => {
    fs.writeFileSync(path.join(process.env.UPLOADS_DIR, 'wallpapers', 'extra.jpg'), 'EXTRA');
    const db = JSON.parse(fs.readFileSync(process.env.DB_FILE, 'utf8'));
    db.builtinWallpapers.items.push({ id: 'w2', type: 'photo', url: '/uploads/wallpapers/extra.jpg' });
    fs.writeFileSync(process.env.DB_FILE, JSON.stringify(db));
    mod.backup();
    const dir = path.join(CONTENT_DIR, 'wallpapers');
    assert.equal(fs.readdirSync(dir).sort().join(','), 'extra.jpg,photo1.jpg');

    // Админ удалил обои: файл ушёл из uploads и из каталога.
    fs.rmSync(path.join(process.env.UPLOADS_DIR, 'wallpapers', 'extra.jpg'), { force: true });
    db.builtinWallpapers.items = db.builtinWallpapers.items.filter((i) => i.id !== 'w2');
    fs.writeFileSync(process.env.DB_FILE, JSON.stringify(db));
    mod.backup();

    assert.equal(fs.readdirSync(dir).join(','), 'photo1.jpg', 'устаревший файл убран');
  });
});

test('когда обоев нет вовсе, папка выгрузки очищается', () => {
  withFakeDb((mod) => {
    mod.backup();
    const dir = path.join(CONTENT_DIR, 'wallpapers');
    assert.ok(fs.existsSync(dir));
    fs.writeFileSync(process.env.DB_FILE, JSON.stringify({
      users: [], builtinThemes: {}, builtinWallpapers: { items: [], hidden: [], overrides: {} },
    }));
    mod.backup();
    assert.ok(!fs.existsSync(dir), 'папка с фото удалена целиком');
  });
});

/**
 * Сценарий «правил на локалхосте → пуш → сервер обновился».
 * Проверяем оба режима на одном и том же раскладе:
 *   в репозитории тема «ИЗ GITHUB», на сервере уже лежит «С СЕРВЕРА».
 */
function pushScenario(mode) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-mode-'));
  CONTENT_DIR = path.join(tmp, 'content');
  process.env.CONTENT_DIR = CONTENT_DIR;
  process.env.DATA_DIR = tmp;
  process.env.DB_FILE = path.join(tmp, 'vera.json');
  process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
  if (mode) process.env.CONTENT_SOURCE = mode; else delete process.env.CONTENT_SOURCE;
  fs.mkdirSync(path.join(process.env.UPLOADS_DIR, 'wallpapers'), { recursive: true });
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  fs.writeFileSync(path.join(CONTENT_DIR, 'themes.json'),
    JSON.stringify({ overrides: { 1: { id: 1, name: 'ИЗ GITHUB' } }, removed: [], added: [] }));
  fs.writeFileSync(path.join(CONTENT_DIR, 'wallpapers.json'), JSON.stringify({ items: [] }));
  fs.writeFileSync(process.env.DB_FILE, JSON.stringify({
    users: [{ id: 'u1' }],
    builtinThemes: { overrides: { 2: { id: 2, name: 'С СЕРВЕРА' } }, removed: [], added: [] },
    builtinWallpapers: { items: [], hidden: [], overrides: {} },
  }));
  delete require.cache[require.resolve('./backup-content')];
  const mod = require('./backup-content');
  try {
    const seeded = mod.seedOnBoot();
    const db = JSON.parse(fs.readFileSync(process.env.DB_FILE, 'utf8'));
    return { seeded, names: Object.values(db.builtinThemes.overrides).map((t) => t.name).sort() };
  } finally {
    delete require.cache[require.resolve('./backup-content')];
    for (const k of ['DATA_DIR', 'DB_FILE', 'UPLOADS_DIR', 'CONTENT_DIR', 'CONTENT_SOURCE']) delete process.env[k];
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('ПО УМОЛЧАНИЮ пуш НЕ меняет темы на сервере, если там свои', () => {
  // Это не баг, а защита: иначе деплой затирал бы правки, сделанные прямо
  // в админке на сервере. Но знать об этом важно — пуш сам по себе не «синк».
  const { names } = pushScenario(null);
  assert.deepEqual(names, ['С СЕРВЕРА']);
});

test('CONTENT_SOURCE=repo: пуш приводит сервер к состоянию репозитория', () => {
  // Режим для сценария «правлю на локалхосте, деплою через GitHub».
  const { seeded, names } = pushScenario('repo');
  assert.equal(seeded, true);
  assert.deepEqual(names, ['ИЗ GITHUB'], 'тема из репозитория применилась');
});

test('режим читается из переменной окружения и регистронезависим', () => {
  assert.equal(pushScenario('REPO').names[0], 'ИЗ GITHUB');
  assert.equal(pushScenario(' repo ').names[0], 'ИЗ GITHUB');
  assert.equal(pushScenario('db').names[0], 'С СЕРВЕРА');
  assert.equal(pushScenario('auto').names[0], 'С СЕРВЕРА');
});

test('в режиме repo пустой каталог в репозитории тоже применяется', () => {
  // «Удалил все правки локально и закоммитил» — сервер обязан это принять,
  // иначе откатить изменения было бы невозможно.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-empty-'));
  CONTENT_DIR = path.join(tmp, 'content');
  process.env.CONTENT_DIR = CONTENT_DIR;
  process.env.DATA_DIR = tmp;
  process.env.DB_FILE = path.join(tmp, 'vera.json');
  process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
  process.env.CONTENT_SOURCE = 'repo';
  fs.mkdirSync(path.join(process.env.UPLOADS_DIR, 'wallpapers'), { recursive: true });
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  fs.writeFileSync(path.join(CONTENT_DIR, 'themes.json'),
    JSON.stringify({ overrides: {}, removed: [], added: [] }));
  fs.writeFileSync(path.join(CONTENT_DIR, 'wallpapers.json'), JSON.stringify({ items: [] }));
  fs.writeFileSync(process.env.DB_FILE, JSON.stringify({
    users: [], builtinThemes: { overrides: { 2: { id: 2 } }, removed: [], added: [] },
  }));
  delete require.cache[require.resolve('./backup-content')];
  const mod = require('./backup-content');
  try {
    mod.seedOnBoot();
    const db = JSON.parse(fs.readFileSync(process.env.DB_FILE, 'utf8'));
    assert.deepEqual(Object.keys(db.builtinThemes.overrides), [], 'правки сняты');
  } finally {
    delete require.cache[require.resolve('./backup-content')];
    for (const k of ['DATA_DIR', 'DB_FILE', 'UPLOADS_DIR', 'CONTENT_DIR', 'CONTENT_SOURCE']) delete process.env[k];
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('без режима repo автовосстановление по-прежнему работает', () => {
  // Режим 'repo' — надстройка, а не замена: страховка от потери диска
  // должна работать и по умолчанию.
  withFakeDb((mod) => {
    mod.backup();
    fs.writeFileSync(process.env.DB_FILE, JSON.stringify({ users: [{ id: 'u1' }] }));
    assert.equal(mod.seedOnBoot(), true);
    const db = JSON.parse(fs.readFileSync(process.env.DB_FILE, 'utf8'));
    assert.equal(db.builtinThemes.overrides[1].name, 'Правленая');
  });
});

test('папка выгрузки не попадает под ignore', () => {
  const gitignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  assert.ok(/!Server\/content\//.test(gitignore), 'content/ явно разрешён в git');
  // Runtime-данные при этом остаются исключёнными.
  assert.ok(/^Server\/data\/$/m.test(gitignore), 'БД по-прежнему не в репозитории');
  assert.ok(/^Server\/uploads\/$/m.test(gitignore), 'загруженные файлы по-прежнему не в репозитории');
});