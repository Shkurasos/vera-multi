const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  const source = fs.readFileSync(require.resolve('./server.js'), 'utf8');
  const routes = {};
  const user = {
    id: 'one',
    ownedPets: ['pet-cat', 'pet-fox'],
    petCounts: { 'pet-cat': 3 },
    ownedItems: [],
    equippedPet: { id: 'pet-cat', settings: { x: 78, y: 76, size: 72, name: '', font: 'inherit' } },
  };
  const context = {
    db: { users: [user] },
    authMiddleware() {},
    app: {
      get: (p, a, fn) => { routes['GET ' + p] = fn; },
      put: (p, a, fn) => { routes['PUT ' + p] = fn; },
    },
    saveDb() {},
    userSockets: new Map(),
  };
  vm.runInNewContext(
    source.slice(source.indexOf('const PET_CATALOG = {'), source.indexOf('// PATCH /api/users/me')),
    context,
  );
  const put = body => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    routes['PUT /api/pets/equipment']({ userId: 'one', body }, res);
    return res;
  };
  return { user, put };
}

test('pet size, name and font are persisted per pet across swaps', () => {
  const { user, put } = setup();
  const tuned = put({ petId: 'pet-cat', settings: { name: 'Мурка', size: 120, font: 'Georgia, serif' } });
  assert.equal(tuned.code, 200);
  assert.equal(tuned.data.equippedPet.settings.name, 'Мурка');
  assert.equal(tuned.data.equippedPet.settings.size, 120);
  assert.equal(user.petSettings['pet-cat'].name, 'Мурка');
  assert.equal(user.petSettings['pet-cat'].size, 120);

  // Замена питомца наследует настройки — ничего не «спадает».
  const swapped = put({ petId: 'pet-fox' });
  assert.equal(swapped.code, 200);
  assert.equal(swapped.data.equippedPet.id, 'pet-fox');
  assert.equal(swapped.data.equippedPet.settings.name, 'Мурка');
  assert.equal(swapped.data.equippedPet.settings.size, 120);
  assert.equal(swapped.data.equippedPet.settings.font, 'Georgia, serif');
  assert.equal(user.petSettings['pet-cat'].name, 'Мурка', 'настройки кота не затёрты');

  // Свои настройки лисы не трогают сохранённые настройки кота.
  const fox = put({ petId: 'pet-fox', settings: { name: 'Лиса' } });
  assert.equal(fox.data.equippedPet.settings.name, 'Лиса');
  assert.equal(fox.data.equippedPet.settings.size, 120);
  assert.equal(user.petSettings['pet-fox'].name, 'Лиса');
  assert.equal(user.petSettings['pet-cat'].name, 'Мурка');

  const back = put({ petId: 'pet-cat' });
  assert.equal(back.data.equippedPet.settings.name, 'Мурка');
  assert.equal(back.data.equippedPet.settings.size, 120);
  assert.equal(back.data.equippedPet.settings.font, 'Georgia, serif');
});

test('unequipping keeps settings, and petState reports duplicate counts', () => {
  const { user, put } = setup();
  put({ petId: 'pet-cat', settings: { name: 'Мурка', size: 96 } });
  const off = put({ petId: null });
  assert.equal(off.code, 200);
  assert.equal(off.data.equippedPet, null);
  assert.equal(user.petSettings['pet-cat'].name, 'Мурка');
  assert.equal(user.petSettings['pet-cat'].size, 96);

  const on = put({ petId: 'pet-cat' });
  assert.equal(on.code, 200);
  assert.equal(on.data.equippedPet.settings.name, 'Мурка');
  assert.equal(on.data.equippedPet.settings.size, 96);
  // Копии из кейса: pet-cat ×3, pet-fox без счётчика → 1.
  assert.equal(on.data.petCounts['pet-cat'], 3);
  assert.equal(on.data.petCounts['pet-fox'], 1);
});

test('unknown, non-owned and invalid pets are rejected', () => {
  const { put } = setup();
  assert.equal(put({ petId: 'pet-nope' }).code, 400);
  assert.equal(put({ petId: 'pet-bunny' }).code, 403);
  assert.equal(put({ petId: 'pet-cat', settings: { size: NaN } }).code, 400);
});
