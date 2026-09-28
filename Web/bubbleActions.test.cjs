const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src/utils/bubbleActions.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, context);
const { ACTIONS_CORNER, ACTIONS_PANEL_HEIGHT, inActionsCorner, isShellStyle, splitBubbleSkin } = context.exports;

// Пузырь чужих сообщений: 100..320 по x, 200..260 по y.
const otherBubble = { left: 100, right: 320, top: 200, bottom: 260 };
// Свои сообщения зеркальны: хвост и панель справа.
const ownBubble = { left: 400, right: 620, top: 200, bottom: 260 };

test('панель открывается из нижнего левого уголка чужого пузыря', () => {
  // Левый нижний угол — в зоне.
  assert.equal(inActionsCorner(otherBubble, 110, 250, false), true);
  assert.equal(inActionsCorner(otherBubble, 100 + ACTIONS_CORNER.width, 260, false), true);
  // Правый нижний угол чужого пузыря и его середина — не зона.
  assert.equal(inActionsCorner(otherBubble, 310, 250, false), false);
  assert.equal(inActionsCorner(otherBubble, 210, 230, false), false);
  // Верхняя часть пузыря — тоже не зона, иначе панель выскакивает при чтении.
  assert.equal(inActionsCorner(otherBubble, 110, 205, false), false);
});

test('у своих сообщений уголок зеркальный — правый нижний', () => {
  assert.equal(inActionsCorner(ownBubble, 610, 250, true), true);
  assert.equal(inActionsCorner(ownBubble, ownBubble.right - ACTIONS_CORNER.width, 260, true), true);
  assert.equal(inActionsCorner(ownBubble, 410, 250, true), false);
  assert.equal(inActionsCorner(ownBubble, 610, 205, true), false);
});

test('в уголок можно чуть-чуть промахнуться', () => {
  // На 4 px выше/левее пузыря уголок всё ещё ловится (slack по умолчанию 6).
  assert.equal(inActionsCorner(otherBubble, 98, 264, false), true);
  assert.equal(inActionsCorner(ownBubble, 624, 264, true), true);
  // А на 20 px — уже нет.
  assert.equal(inActionsCorner(otherBubble, 80, 250, false), false);
  assert.equal(inActionsCorner(ownBubble, 640, 250, true), false);
});

test('высота панели фиксирована — её компенсирует корпус сообщения', () => {
  // Корпус вычитает ровно столько же, сколько занимает панель: см. MessageBubble.
  assert.equal(typeof ACTIONS_PANEL_HEIGHT, 'number');
  assert.ok(ACTIONS_PANEL_HEIGHT > 0);
  assert.equal(Math.round(ACTIONS_PANEL_HEIGHT), ACTIONS_PANEL_HEIGHT);
});

test('скин пузыря делится на корпус и содержимое', () => {
  const [shell, inner] = splitBubbleSkin({
    background: 'linear-gradient(135deg, #6C5CE7, #4A3F9F)',
    backgroundClip: 'padding-box',
    border: '1px solid #fff3',
    borderRadius: 18,
    boxShadow: '0 6px 20px rgba(0,0,0,0.3)',
    backdropFilter: 'blur(24px)',
    color: '#fff',
    padding: 12,
    fontWeight: 600,
  });
  // Корпус: всё, что рисует фон, рамку, тень и анимацию.
  assert.equal(shell.background, 'linear-gradient(135deg, #6C5CE7, #4A3F9F)');
  assert.equal(shell.border, '1px solid #fff3');
  assert.equal(shell.borderRadius, 18);
  assert.equal(shell.boxShadow, '0 6px 20px rgba(0,0,0,0.3)');
  assert.equal(shell.backdropFilter, 'blur(24px)');
  // Содержимое: цвет текста и отступы остаются на пузыре.
  assert.equal(inner.color, '#fff');
  assert.equal(inner.padding, 12);
  assert.equal(inner.fontWeight, 600);
  assert.equal(Object.keys(inner).length, 3);
});

test('деление скина не теряет и не путает свойства', () => {
  const [emptyShell, emptyInner] = splitBubbleSkin(undefined);
  assert.equal(Object.keys(emptyShell).length, 0);
  assert.equal(Object.keys(emptyInner).length, 0);
  assert.equal(isShellStyle('borderTopLeftRadius'), true);
  assert.equal(isShellStyle('borderRadius'), true);
  assert.equal(isShellStyle('color'), false);
  assert.equal(isShellStyle('padding'), false);
  assert.equal(isShellStyle('fontWeight'), false);
  // Ключи со значением undefined не превращаются в «явный ноль» в sx.
  const withUndefined = { background: undefined, color: '#abc' };
  const [undefShell, undefInner] = splitBubbleSkin(withUndefined);
  assert.equal(Object.keys(undefShell).length, 0);
  assert.equal(undefInner.color, '#abc');
});
