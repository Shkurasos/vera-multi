const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const dock = read('src/components/SidebarNavDock.tsx');
const sidebar = read('src/components/Sidebar.tsx');
const layout = read('src/pages/MainLayout.tsx');

test('панель сайдбара лежит выше питомца', () => {
  const layer = Number(dock.match(/SIDEBAR_NAV_LAYER\s*=\s*(\d+)/)[1]);
  const petBlock = layout.slice(layout.indexOf('const petOverlay'));
  const petZ = Number(petBlock.match(/zIndex:\s*(\d+)/)[1]);
  assert.ok(layer > petZ, `слой панели ${layer} должен быть выше питомца ${petZ}`);
  assert.ok(layer < 1300, 'диалоги MUI (1300) должны оставаться выше панели');
});

test('панель вынесена порталом в body (иначе контекст наложения сайдбара её не выпустит)', () => {
  assert.match(dock, /createPortal\(/);
  assert.match(dock, /document\.body/);
  assert.match(dock, /position:\s*'fixed'/);
});

test('Sidebar рисует кнопки через SidebarNavDock', () => {
  assert.match(sidebar, /import SidebarNavDock from '\.\/SidebarNavDock'/);
  const start = sidebar.indexOf('<SidebarNavDock');
  const end = sidebar.indexOf('</SidebarNavDock>');
  assert.ok(start > 0 && end > start, 'обёртка SidebarNavDock не найдена');
  assert.match(sidebar.slice(start, end), /<SidebarNavButtons/);
});
