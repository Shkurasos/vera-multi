const fs = require('fs');
const file = 'Web/src/store/themeStore.ts';
let src = fs.readFileSync(file, 'utf8');
// Normalize CRLF for reliable matching
src = src.replace(/\r\n/g, '\n');
const needle = `// ── 29 ── Apple Minimalism — чистота, пространство, светлые тона ──────────
  {
    id: 29, name: 'Apple Minimalism',
    bg: '#FFFFFF', text: '#000000', accent: '#007AFF',
    bgSidebar: '#F5F5F7', bgChat: '#FFFFFF', bgHeader: '#FAFAFA',
    bgInput: '#F2F2F7', bgBubbleOwn: '#007AFF', bgBubbleOther: '#E9E9EB',
    bgHover: '#F2F2F7', bgActive: '#E5E5EA', textSec: '#8E8E93',
    border: 'rgba(0,0,0,0.08)', online: '#34C759',
    chatPattern: undefined,
    disableBackgroundBlobs: true,
    bubbleOwnGradient: undefined,
    bubbleOwnShadow: '0 1px 2px rgba(0,0,0,0.08)',
    bubbleOtherShadow: '0 1px 2px rgba(0,0,0,0.04)',
    sidebarGradient: undefined,
    sidebarBlur: undefined,
    headerGradient: undefined,
    bubbleOwnText: '#FFFFFF',
  },
];`;
const repl = `// ── 29 ── Монохром — чёрно-белый минимализм ─────────────────────────────────
  {
    id: 29, name: 'Монохром',
    bg: '#FFFFFF', text: '#000000', accent: '#000000',
    bgSidebar: '#F5F5F7', bgChat: '#FFFFFF', bgHeader: '#FAFAFA',
    bgInput: '#F2F2F7', bgBubbleOwn: '#000000', bgBubbleOther: '#E9E9EB',
    bgHover: '#F2F2F7', bgActive: '#E5E5EA', textSec: '#8E8E93',
    border: 'rgba(0,0,0,0.08)', online: '#34C759',
    chatPattern: undefined,
    disableBackgroundBlobs: true,
    disableBackgroundGlow: true,
    bubbleOwnGradient: undefined,
    bubbleOwnShadow: '0 1px 2px rgba(0,0,0,0.08)',
    bubbleOtherShadow: '0 1px 2px rgba(0,0,0,0.04)',
    sidebarGradient: undefined,
    sidebarBlur: undefined,
    headerGradient: undefined,
    bubbleOwnText: '#FFFFFF',
  },

  // ── 30 ── Монохром Тёмный — бело-чёрный минимализм (матовый графит) ──────────
  {
    id: 30, name: 'Монохром Тёмный',
    bg: '#1C1C1E', text: '#FFFFFF', accent: '#FFFFFF',
    bgSidebar: '#282828', bgChat: '#1C1C1E', bgHeader: '#262626',
    bgInput: '#3A3A3C', bgBubbleOwn: '#F2F2F7', bgBubbleOther: '#3A3A3C',
    bgHover: '#2E2E30', bgActive: '#38383A', textSec: '#98989E',
    border: 'rgba(255,255,255,0.10)', online: '#34C759',
    chatPattern: undefined,
    disableBackgroundBlobs: true,
    disableBackgroundGlow: true,
    bubbleOwnGradient: undefined,
    bubbleOwnShadow: '0 1px 2px rgba(0,0,0,0.5)',
    bubbleOtherShadow: '0 1px 2px rgba(0,0,0,0.3)',
    sidebarGradient: undefined,
    sidebarBlur: undefined,
    headerGradient: undefined,
    bubbleOwnText: '#000000',
  },
];`;
if (!src.includes(needle)) { console.error('NEEDLE NOT FOUND'); process.exit(1); }
src = src.replace(needle, repl);
fs.writeFileSync(file, src);
console.log('themeStore.ts patched (monochrome themes)');