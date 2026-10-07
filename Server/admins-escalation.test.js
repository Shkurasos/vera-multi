const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./server.js'), 'utf8');

// Граница среза: /api/admin/* объявлены РАНЬше PATCH /api/users/me, поэтому
// режем по первому маршруту, который идёт после него.
const PATCH_ME = source.slice(
  source.indexOf("app.patch('/api/users/me'"),
  source.indexOf("app.get('/api/users/:id/customization'"),
);

/**
 * Может ли обычный пользователь получить права админа, назвавшись его именем?
 *
 * Права админа определяются ПО ИМЕНИ (isAdminUsername), а имя меняется
 * пользователем через PATCH /api/users/me. Значит, если проверки «новое имя не
 * админское» нет, любой зарегистрировавшийся просто переименовывается в
 * Vera_koto_a — и становится админом вместе со всеми /api/admin/*.
 *
 * Это не теория: имена админов по умолчанию зашиты в ADMIN_ENV и видны любому,
 * кто прочитает репозиторий.
 */
test('смена юзернейма не позволяет набрать себе прав админа', () => {
  // Проверяем не «нет ли вызова isAdminUsername», а то, что вызов СОПРОВОЖДАЕТСЯ
  // отказом. Раньше проверки не было вовсе; вызов сам по себе — это как раз
  // правильное поведение.
  assert.ok(
    /isAdminUsername\(raw\)/.test(PATCH_ME),
    'новое имя сверяется с админскими',
  );
  assert.ok(
    /isAdminUsername\(raw\)[\s\S]{0,120}status\(403\)/.test(PATCH_ME),
    'совпадение с админским именем обязано отклоняться, а не проходить дальше',
  );
  assert.ok(
    /normAdminName\(raw\) !== normAdminName\(user\.username\)/.test(PATCH_ME),
    'своё же имя админа переименовать себе можно — не сломаем ему профиль',
  );
});

test('отказ в админском имени стоит ДО записи в профиль', () => {
  const guardAt = PATCH_ME.indexOf('isAdminUsername(raw)');
  const writeAt = PATCH_ME.indexOf('for (const k of allowed)');
  assert.ok(guardAt >= 0 && writeAt >= 0, 'и проверка, и запись на месте');
  assert.ok(guardAt < writeAt, 'иначе профиль успеет записаться до отказа');
});

test('дефолтные имена админов продолжают работать как есть', () => {
  const ctx = { process: { env: {} }, db: { admins: [] }, isDevIp: () => false };
  vm.runInNewContext(
    source.slice(source.indexOf('const ADMIN_ENV ='), source.indexOf('function normalizeAllUsers()')),
    ctx,
  );
  assert.equal(ctx.isAdminUsername('Vera_koto_a'), true);
  assert.equal(ctx.isAdminUsername('Vera_koto_b'), true);
  assert.equal(ctx.isAdminUsername('someone_else'), false);
});