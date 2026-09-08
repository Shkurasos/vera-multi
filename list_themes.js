const fs = require('fs');
const src = fs.readFileSync('Web/src/store/themeStore.ts', 'utf8');
const re = /id:\s*(\d+)[\s\S]*?name:\s*'([^']*)'/g;
let m;
while ((m = re.exec(src)) !== null) {
  console.log(m[1].padStart(4) + ' : ' + m[2]);
}