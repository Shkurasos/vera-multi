/**
 * Отодвигание сообщений из-под часов — чистая функция расчёта.
 *
 * Загружается тем же приёмом, что и остальные ts-модули в тестах: transpile
 * во временный контекст vm с заглушкой zustand.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

/** Мини-zustand: create() без состояния, хук не вызывается — нужна функция. */
const ZUSTAND_STUB = {
  create: () => (f) => {
    let s;
    const set = (v) => { s = { ...s, ...(typeof v === 'function' ? v(s) : v) }; };
    const hook = (sel) => (sel ? sel(s) : s);
    hook.getState = () => s;
    hook.setState = set;
    s = f(set, () => s, hook);
    return hook;
  },
};

function load(file, stubs = {}) {
  const ctx = vm.createContext({
    console, exports: {}, module: { exports: {} },
    require: (name) => stubs[name] || {},
  });
  ctx.exports = ctx.module.exports;
  vm.runInContext(
    ts.transpileModule(read(file), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText,
    ctx,
  );
  return ctx.module.exports;
}

const { clockAvoidShift } = load('src/store/wallClockLayout.ts', { zustand: ZUSTAND_STUB });

/** Часы по центру: 300..700 по вертикали, 100..300 по горизонтали. */
const clock = (pos = 'center') => ({ top: 300, bottom: 700, left: 100, right: 300, pos });
/** Лента сообщений во всю ширину окна. */
const AREA = { left: 0, right: 400 };

test('без часов сдвига нет', () => {
  assert.equal(clockAvoidShift(null, { top: 350, bottom: 390, left: 20, right: 200 }, AREA), 0);
});

test('сообщение выше часов не трогается', () => {
  assert.equal(clockAvoidShift(clock(), { top: 100, bottom: 260, left: 20, right: 200 }, AREA), 0);
});

test('сообщение ниже часов не трогается', () => {
  assert.equal(clockAvoidShift(clock(), { top: 720, bottom: 760, left: 20, right: 200 }, AREA), 0);
});

test('перекрывающее сообщение уходит вбок, а не по вертикали', () => {
  // Узкий пузырь 30..110 накрывает часы (100..300) всего на 10 px.
  // Влево: 110-(100-12) = 22, вправо: 312-30 = 282. Дешевле влево.
  const d = clockAvoidShift(clock(), { top: 350, bottom: 390, left: 30, right: 110 }, AREA);
  assert.equal(d, -22);
  // Ключевое: сдвиг строго горизонтальный, высота пузыря не меняется ни на пиксель.
  assert.ok(Math.abs(d) < 400, 'сдвиг по горизонтали');
});

test('широкий пузырь остаётся на месте — вбок ему не поместиться', () => {
  // Пузырь 20..200: уйти влево нельзя (уедет за край на 92 px), вправо тоже.
  // Это честный отказ: растягивать ленту ради него больше нельзя.
  assert.equal(clockAvoidShift(clock(), { top: 350, bottom: 390, left: 20, right: 200 }, AREA), 0);
});

test('узкий пузырь уходит вправо', () => {
  // 260..290: влево 290-88 = 202, вправо 312-260 = 52 → дешевле вправо.
  assert.equal(clockAvoidShift(clock(), { top: 350, bottom: 390, left: 260, right: 290 }, AREA), 52);
});

test('за край ленты не выезжаем ни одной стороной', () => {
  // Часы почти во всю ширину: ни вправо, ни влево не помещается — не двигаем.
  const wide = { top: 300, bottom: 700, left: 10, right: 390, pos: 'center' };
  assert.equal(clockAvoidShift(wide, { top: 350, bottom: 390, left: 100, right: 300 }, AREA), 0);
});

test('боковое несовпадение сдвига не даёт', () => {
  // Часы по центру, пузырь у самого левого края — их не перекрывает.
  assert.equal(clockAvoidShift(clock(), { top: 350, bottom: 390, left: 0, right: 40 }, AREA), 0);
});

test('касание краем перекрытием не считается', () => {
  assert.equal(clockAvoidShift(clock(), { top: 260, bottom: 300, left: 20, right: 200 }, AREA), 0);
});

test('функция ждёт исходные координаты, а не уже сдвинутые', () => {
  // Контракт: на вход подаётся прямоугольник БЕЗ нашего сдвига. Именно поэтому
  // хук вычитает применённый сдвиг из замера. Если сюда подставить уже
  // сдвинутые координаты, перекрытия не будет и функция вернёт 0 — то есть
  // «сдвинули → вернули назад» зациклилось бы.
  const box = { top: 350, bottom: 390, left: 30, right: 110 };
  const first = clockAvoidShift(clock(), box, AREA);
  assert.notEqual(first, 0, 'сдвиг реально происходит — иначе тест ничего не проверяет');
  const moved = { ...box, left: box.left + first, right: box.right + first };
  assert.equal(clockAvoidShift(clock(), moved, AREA), 0, 'на сдвинутых данных перекрытия нет');

  // И главное: исходные координаты всегда дают один и тот же результат,
  // независимо от того, сколько раз функцию звали.
  assert.equal(clockAvoidShift(clock(), box, AREA), first, 'результат по исходным данным стабилен');
});

test('сдвиг всегда остаётся в пределах ленты', () => {
  // Инвариант для любых положений: пузырь не выезжает за края строки.
  for (const pos of ['center', 'top', 'bottom']) {
    for (let l = 0; l + 60 <= 400; l += 20) {
      for (let t = 250; t < 750; t += 50) {
        const box = { top: t, bottom: t + 40, left: l, right: l + 60 };
        const d = clockAvoidShift(clock(pos), box, AREA);
        assert.ok(box.left + d >= AREA.left - 1.5, `${pos}: не выехал влево`);
        assert.ok(box.right + d <= AREA.right + 1.5, `${pos}: не выехал вправо`);
      }
    }
  }
});
