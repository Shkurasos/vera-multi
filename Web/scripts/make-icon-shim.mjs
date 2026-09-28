// Генератор шима иконок Web/src/mui-icons-shim.tsx.
//
// Список иконок берётся из текущего шима (чтобы не менять набор используемых
// иконок), а варианты — из установленного @mui/icons-material: для каждой иконки
// проверяется наличие X / XOutlined / XRounded / XSharp / XTwoTone. Отсутствующие
// варианты просто не попадают в MAP, а make() откатывается на filled.
//
// Запуск: node scripts/make-icon-shim.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
const shimPath = join(web, 'src', 'mui-icons-shim.tsx');
const iconsDir = join(web, 'node_modules', '@mui', 'icons-material');

// Порядок важен: он же порядок вкладок в настройках иконок.
const VARIANTS = [
  ['filled', ''],
  ['outlined', 'Outlined'],
  ['rounded', 'Rounded'],
  ['sharp', 'Sharp'],
  ['twoTone', 'TwoTone'],
];

const has = (name) => existsSync(join(iconsDir, `${name}.js`));

const source = readFileSync(shimPath, 'utf8');
const names = [...source.matchAll(/^ {2}([A-Za-z0-9_]+): \{ filled:/gm)].map((m) => m[1]);
if (!names.length) {
  console.error('Не удалось прочитать список иконок из шима — он изменён вручную?');
  process.exit(1);
}

// Хвост (функция make и все export'ы) переиспользуем как есть.
const tailStart = source.indexOf('function make(');
if (tailStart === -1) {
  console.error('В шиме не найдена функция make()');
  process.exit(1);
}
const tail = source.slice(tailStart);

const imports = [];
const map = [];
const missing = [];
for (const name of names) {
  const parts = [];
  for (const [key, suffix] of VARIANTS) {
    if (!has(name + suffix)) {
      if (key === 'twoTone') missing.push(name);
      continue;
    }
    const id = `_v${name}${suffix}`;
    imports.push(`import ${id} from '@mui/icons-material/${name}${suffix}';`);
    parts.push(`${key}: ${id}`);
  }
  map.push(`  ${name}: { ${parts.join(', ')} },`);
}

const out = [
  '// AUTO-GENERATED (scripts/make-icon-shim.mjs). Shim over @mui/icons-material to support icon packs.',
  "import React from 'react';",
  "import type { SvgIconProps } from '@mui/material/SvgIcon';",
  "import { useUiPrefsStore } from './store/uiPrefsStore';",
  '',
  ...imports,
  '',
  'const MAP: Record<string, Record<string, React.ComponentType<SvgIconProps>>> = {',
  ...map,
  '};',
  '',
  tail,
].join('\n');

// Сохраняем BOM, если он был в исходнике — иначе diff всего файла.
writeFileSync(shimPath, source.charCodeAt(0) === 0xfeff ? '\ufeff' + out : out, 'utf8');
console.log(`Шим обновлён: ${names.length} иконок, ${VARIANTS.length} вариантов`);
if (missing.length) {
  console.log(`Без TwoTone (${missing.length}): ${missing.join(', ')}`);
}
