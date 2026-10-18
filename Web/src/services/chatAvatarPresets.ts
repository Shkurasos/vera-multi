/**
 * Встроенные фото чата: градиент + эмодзи.
 * Рисуются на canvas в PNG-файл и дальше идут тем же путём, что и загруженное
 * фото (peer → data URL, REST → /files/upload). Поэтому серверу не нужно знать
 * про пресеты, а чужие клиенты видят обычную картинку.
 */
export interface ChatAvatarPreset {
  id: string;
  label: string;
  emoji: string;
  from: string;
  to: string;
}

export const CHAT_AVATAR_PRESETS: readonly ChatAvatarPreset[] = [
  { id: 'chat', label: 'Общение', emoji: '💬', from: '#4facfe', to: '#00f2fe' },
  { id: 'fire', label: 'Огонь', emoji: '🔥', from: '#f83600', to: '#f9d423' },
  { id: 'rocket', label: 'Ракета', emoji: '🚀', from: '#667eea', to: '#764ba2' },
  { id: 'music', label: 'Музыка', emoji: '🎵', from: '#ee0979', to: '#ff6a00' },
  { id: 'game', label: 'Игры', emoji: '🎮', from: '#11998e', to: '#38ef7d' },
  { id: 'book', label: 'Учёба', emoji: '📚', from: '#fc5c7d', to: '#6a82fb' },
  { id: 'work', label: 'Работа', emoji: '💼', from: '#373b44', to: '#4286f4' },
  { id: 'family', label: 'Семья', emoji: '🏠', from: '#f7971e', to: '#ffd200' },
  { id: 'friends', label: 'Друзья', emoji: '🤝', from: '#00b09b', to: '#96c93d' },
  { id: 'news', label: 'Новости', emoji: '📰', from: '#485563', to: '#29323c' },
  { id: 'art', label: 'Творчество', emoji: '🎨', from: '#da22ff', to: '#9733ee' },
  { id: 'sport', label: 'Спорт', emoji: '⚽', from: '#56ab2f', to: '#a8e063' },
  { id: 'travel', label: 'Путешествия', emoji: '✈️', from: '#2193b0', to: '#6dd5ed' },
  { id: 'food', label: 'Еда', emoji: '🍕', from: '#ff512f', to: '#dd2476' },
  { id: 'cat', label: 'Котики', emoji: '🐱', from: '#ffafbd', to: '#ffc3a0' },
  { id: 'star', label: 'Звезда', emoji: '⭐', from: '#141e30', to: '#243b55' },
];

/** CSS-градиент для превью в сетке (без canvas, чтобы сетка открывалась мгновенно). */
export function presetBackground(p: ChatAvatarPreset): string {
  return `linear-gradient(135deg, ${p.from} 0%, ${p.to} 100%)`;
}

/** Рисует пресет в квадратный PNG. */
export function renderChatAvatarPreset(p: ChatAvatarPreset, size = 512): Promise<File> {
  return new Promise((resolve, reject) => {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) { reject(new Error('canvas unavailable')); return; }
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, p.from);
    g.addColorStop(1, p.to);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(size * 0.5)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.fillText(p.emoji, size / 2, size / 2 + size * 0.03);
    c.toBlob((blob) => {
      if (!blob) { reject(new Error('toBlob failed')); return; }
      resolve(new File([blob], `chat-avatar-${p.id}.png`, { type: 'image/png' }));
    }, 'image/png');
  });
}
