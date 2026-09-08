const fs = require('fs');
const file = 'Web/src/components/ThemeEditor.tsx';
let src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const anchor = [
  '                Убирает размытые светящиеся пузыри на заднем плане чата',
  '              </div>',
  '            </div>',
].join('\n');
const add = [
  '                Убирает размытые светящиеся пузыри на заднем плане чата',
  '              </div>',
  '            </div>',
  '',
  '            <div style={{ marginBottom: 12 }}>',
  '              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>',
  '                <input',
  '                  type="checkbox"',
  '                  checked={draft.disableBackgroundGlow || false}',
  '                  onChange={e => setDraft(d => ({ ...d, disableBackgroundGlow: e.target.checked }))}',
  "                  style={{ width: 16, height: 16, cursor: 'pointer' }}",
  '                />',
  '                <span style={{ color: theme.text }}>Отключить фоновое свечение</span>',
  '              </label>',
  '              <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4, marginLeft: 24 }}>',
  '                Убирает фиолетово-розовые градиенты за всеми слоями и панелями',
  '              </div>',
  '            </div>',
].join('\n');
if (!src.includes(anchor)) { console.error('THEME_EDITOR ANCHOR NOT FOUND'); process.exit(1); }
src = src.replace(anchor, add);
fs.writeFileSync(file, src);
console.log('ThemeEditor.tsx patched');