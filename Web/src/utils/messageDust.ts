/**
 * «Пепел» удаляемого сообщения: пузырь рассыпается на частицы, которые
 * улетают вверх и затухают.
 *
 * Взрыв рисуется ПОРТАЛОМ в document.body (position: fixed), поэтому:
 *  1) не зависит от скролла и overflow-контейнера ленты;
 *  2) переживает размонтирование строки сообщения — магазин сообщений
 *     удаляет сообщение из состояния раньше, чем долетают частицы.
 *
 * Всё чистый DOM без зависимостей; ключфреймы внедряются один раз.
 * При системном prefers-reduced-motion (и в тестовой среде без DOM)
 * ничего не создаётся — строка просто исчезает мгновенно.
 */

const STYLE_ID = 'vera-message-dust-style';

const KEYFRAMES = `
@keyframes vera-message-dust {
  0% {
    transform: translate3d(0, 0, 0) scale(1) rotate(0deg);
    opacity: var(--dust-o, 0.9);
  }
  60% {
    opacity: calc(var(--dust-o, 0.9) * 0.75);
  }
  100% {
    transform: translate3d(var(--dx, 0), var(--dy, -80px), 0) scale(0.1) rotate(var(--rot, 180deg));
    opacity: 0;
  }
}
`;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let uid = 0;

/**
 * Взрыв «пыли» из прямоугольника пузыря сообщения.
 *
 * @param rect    геометрия пузыря на момент удаления (getBoundingClientRect)
 * @param palette цвета частиц: акцент темы, цвет текста, приглушённый текст
 */
export function spawnMessageDust(rect: DOMRect, palette: string[]): void {
  if (typeof document === 'undefined' || prefersReducedMotion()) return;
  if (!rect || rect.width <= 0 || rect.height <= 0) return;

  ensureStyles();

  const colors = (palette || []).filter(Boolean);
  if (colors.length === 0) colors.push('#ffffff');

  // Чем крупнее пузырь, тем больше искр, но с потолком — 48 штук хватает
  // визуально и не бьёт по производительности при пачечных удалениях.
  const count = Math.max(16, Math.min(48, Math.round((rect.width * rect.height) / 900)));

  const container = document.createElement('div');
  const dustId = `vera-dust-${uid++}`;
  container.setAttribute('data-vera-dust', dustId);
  Object.assign(container.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    pointerEvents: 'none',
    zIndex: '12000',
    overflow: 'visible',
  } as CSSStyleDeclaration);

  let maxEnd = 0;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    const size = 2 + Math.random() * 4;
    // Частицы живут в границах бывшего пузыря + слегка за его краями,
    // чтобы взрыв выглядел «из середины» сообщения.
    const x = -rect.width * 0.08 + Math.random() * rect.width * 1.16;
    const y = -rect.height * 0.08 + Math.random() * rect.height * 1.16;
    // Основной разлёт — вверх (как угольки/пыль), плюс боковое дребезжание.
    const dx = (Math.random() - 0.5) * (60 + rect.width * 0.35);
    const dy = -(30 + Math.random() * 130);
    const rot = (Math.random() - 0.5) * 540;
    const duration = 480 + Math.random() * 300;
    const delay = Math.random() * 90;
    maxEnd = Math.max(maxEnd, duration + delay);

    Object.assign(p.style, {
      position: 'absolute',
      left: `${x}px`,
      top: `${y}px`,
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: Math.random() > 0.5 ? '50%' : '1px',
      background: colors[i % colors.length],
      opacity: '0.9',
      pointerEvents: 'none',
      willChange: 'transform, opacity',
      animation: `vera-message-dust ${duration}ms cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms forwards`,
    } as CSSStyleDeclaration);
    p.style.setProperty('--dx', `${dx}px`);
    p.style.setProperty('--dy', `${dy}px`);
    p.style.setProperty('--rot', `${rot}deg`);
    p.style.setProperty('--dust-o', `${0.55 + Math.random() * 0.4}`);
    container.appendChild(p);
  }

  document.body.appendChild(container);
  // Контейнер подчищаем сами: реакт к нему отношения не имеет.
  setTimeout(() => container.remove(), Math.ceil(maxEnd) + 250);
}
