const fs = require('fs');
const file = 'Web/src/pages/MainLayout.tsx';
let src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const re = /(    background: )`([\s\S]*?\n    )`천,/;
if (!re.test(src)) { console.error('MAINLAYOUT BLOCK NOT FOUND'); process.exit(1); }
src = src.replace(re, (m, p1, p2) => p1 + 'theme.disableBackgroundGlow ? theme.bg : `' + p2 + '`,' );
fs.writeFileSync(file, src);
console.log('MainLayout.tsx patched');