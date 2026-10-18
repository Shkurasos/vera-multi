// Bare-импорт '@mui/icons-material' в Vite подменяется на src/mui-icons-shim.tsx
// (vite.config.ts). tsc смотрит в настоящий пакет и несуществующую в шиме иконку
// пропускает — а в браузере модуль падает с «does not provide an export named …».
// Тест проверяет все файлы src: каждое имя из такого импорта экспортируется шимом.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = path.join(__dirname, 'src');
const shimFile = path.join(src, 'mui-icons-shim.tsx');
const shim = fs.readFileSync(shimFile, 'utf8');
const exported = new Set([...shim.matchAll(/^export const (\w+)/gm)].map((m) => m[1]));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name) && p !== shimFile) out.push(p);
  }
  return out;
}

test('все иконки из bare-импорта @mui/icons-material есть в шиме', () => {
  assert.ok(exported.size > 50, 'экспорты шима прочитаны');
  const missing = [];
  for (const file of walk(src)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]@mui\/icons-material['"]/g)) {
      // Внутри фигурных скобок бывают комментарии — вырезаем их до разбора имён.
      const body = m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      for (const part of body.split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name && !exported.has(name)) missing.push(`${path.relative(__dirname, file)}: ${name}`);
      }
    }
  }
  assert.deepStrictEqual(missing, [], 'импортируйте подпутём (@mui/icons-material/X) или добавьте в шим');
});

test('WarshipGameCard берёт Gamepad подпутём', () => {
  const card = fs.readFileSync(path.join(src, 'components', 'WarshipGameCard.tsx'), 'utf8');
  assert.match(card, /import Gamepad from '@mui\/icons-material\/Gamepad';/);
});
