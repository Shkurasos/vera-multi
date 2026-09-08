const fs = require('fs');
const l = fs.readFileSync('Web/src/App.tsx', 'utf8').split('\n');
for (let i = 0; i < l.length; i++) {
  if (/socket\.on\(/.test(l[i])) console.log((i + 1) + ': ' + l[i].replace(/\r$/, '').trim().substring(0, 140));
}