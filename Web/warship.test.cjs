const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

/** Загружает чистый TS-модуль без зависимостей. */
function load(rel) {
  const context = vm.createContext({ exports: {}, module: { exports: {} }, console, Math, Date });
  vm.runInContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, rel), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return context.exports;
}
const ws = load('src/utils/warship.ts');
const server = require('../Server/warships.js');
const ship = (cells) => ({ cells, sunk: false });
const plain = (v) => JSON.parse(JSON.stringify(v));

test('shipCellsAt: горизонтально вправо, вертикально вниз', () => {
  assert.deepEqual(plain(ws.shipCellsAt(2, 3, 3, true)), [[2, 3], [2, 4], [2, 5]]);
  assert.deepEqual(plain(ws.shipCellsAt(2, 3, 3, false)), [[2, 3], [3, 3], [4, 3]]);
});

test('canPlaceShip: поле, пересечение и касание (даже углом)', () => {
  const ships = [ship([[4, 4], [4, 5]])];
  assert.equal(ws.canPlaceShip([], ws.shipCellsAt(0, 7, 4, true)), false, 'вылезает вправо');
  assert.equal(ws.canPlaceShip([], ws.shipCellsAt(7, 0, 4, false)), false, 'вылезает вниз');
  assert.equal(ws.canPlaceShip([], ws.shipCellsAt(0, 6, 4, true)), true);
  assert.equal(ws.canPlaceShip(ships, [[4, 5]]), false, 'пересечение');
  assert.equal(ws.canPlaceShip(ships, [[4, 6]]), false, 'борт');
  assert.equal(ws.canPlaceShip(ships, [[3, 6]]), false, 'угол');
  assert.equal(ws.canPlaceShip(ships, [[2, 6]]), true);
});

test('remainingSizes: что осталось поставить', () => {
  assert.deepEqual(plain(ws.remainingSizes([])), [4, 3, 3, 2, 2, 2, 1, 1, 1, 1]);
  assert.deepEqual(plain(ws.remainingSizes([ship([[0, 0], [0, 1], [0, 2]]), ship([[9, 9]])])), [4, 3, 2, 2, 2, 1, 1, 1]);
  assert.deepEqual(plain(ws.remainingSizes(ws.randomFleet())), []);
});

test('isValidFleet и серверный normalizeFleet согласны', () => {
  const ok = [
    [[0, 0], [1, 0], [2, 0], [3, 0]],
    [[0, 2], [1, 2], [2, 2]], [[0, 4], [0, 5], [0, 6]],
    [[2, 4], [2, 5]], [[0, 8], [0, 9]], [[4, 4], [4, 5]],
    [[9, 9]], [[9, 0]], [[6, 0]], [[9, 5]],
  ];
  const variants = [
    ok,
    ok.slice(1),
    ok.map((s, i) => (i === 6 ? [[4, 1]] : s)), // касание углом
    ok.map((s, i) => (i === 2 ? [[0, 4], [0, 5], [0, 7]] : s)), // разрыв
    ok.map((s, i) => (i === 1 ? [[0, 2], [1, 2], [1, 3]] : s)), // изгиб
  ];
  for (let i = 0; i < 30; i++) variants.push(plain(ws.randomFleet()).map((s) => s.cells));
  for (const v of variants) {
    const client = ws.isValidFleet(v.map(ship));
    const srv = server.normalizeFleet(plain(v)) !== null;
    assert.equal(client, srv, JSON.stringify(v));
  }
  assert.equal(ws.isValidFleet(ok.map(ship)), true);
});

test('newGame берёт расставленный игроком флот', () => {
  const fleet = [
    [[0, 0], [1, 0], [2, 0], [3, 0]],
    [[0, 2], [1, 2], [2, 2]], [[0, 4], [0, 5], [0, 6]],
    [[2, 4], [2, 5]], [[0, 8], [0, 9]], [[4, 4], [4, 5]],
    [[9, 9]], [[9, 0]], [[6, 0]], [[9, 5]],
  ].map(ship);
  const g = ws.newGame(1000, fleet);
  assert.deepEqual(plain(g.playerShips.map((s) => s.cells)), plain(fleet.map((s) => s.cells)));
  assert.equal(g.enemyShips.length, 10);
  assert.equal(g.startedAt, 1000);
  fleet[0].sunk = true;
  assert.equal(g.playerShips[0].sunk, false, 'флот скопирован, а не разделён');
});

test('UI: расстановка подключена в обе игры, бой в дуэли ждёт обоих', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
  assert.match(read('src/components/WarshipGame.tsx'), /<WarshipPlacement[^>]*onReady=\{startBattle\}/);
  const duel = read('src/components/WarshipDuel.tsx');
  assert.match(duel, /<WarshipPlacement[^>]*onReady=\{submitFleet\}/);
  assert.match(duel, /warshipsApi\.place\(/);
  assert.match(read('src/services/api.ts'), /\/place`/);
});
