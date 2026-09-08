const fs = require('fs');
const file = 'Web/src/pages/MainLayout.tsx';
let src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const needle =
  '    background: `\n' +
  '      radial-gradient(circle at 8% 0%, ${theme.accent}24 0=ˇ, transparent 32%),\n' +
  '      radial-gradient(circle at 88% 16%, rgba(255,79,216,0.16) 0=ˇ, transparent 34%),\n' +
  '      radial-gradient(circle at 50% 120%, rgba(124,92,255,0.18) 0=ˇ, transparent 36%),\n' +
  '      ${theme.bg}\n' +
  '    `,';

const repl =
  '    background: theme.disableBackgroundGlow\n' +
  '      ? theme.bg\n' +
  '      : `\n' +
  '      radial-gradient(circle at 8% 0%, ${theme.accent}24 0=ˇˇ, transparent 32%),\n' +
  '      radial-gradient(circle at 88% 16%, rgba(255,79,216,0.16) 0=ˇˇ, transparent 34%),\n' +
  '      radial-gradient(circle at 50% 120%, rgba(124,92,255,0.18) 0=ˇˇˇ, transparent 36%),\n' +
  '      ${theme.bg}\n' +
  '    `,';

if (!src.includes(needle)) { console.error('MAINLAYOUT NEEDLE NOT FOUND'); process.exit(1); }
src = src.replace(needle, repl);
fs.writeFileSync(file, src);
console.log('MainLayout.tsx patched');