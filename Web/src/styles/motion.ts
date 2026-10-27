export const motion = {
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  easeIn: 'cubic-bezier(0.7, 0, 0.84, 0)',
  emphasized: 'cubic-bezier(0.2, 0, 0, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  membraneShadow: 'inset 0 7px 18px rgba(0,0,0,.34), inset 0 -4px 12px rgba(255,255,255,.08)',
};

// Анимация панели инфо: выезжает справа при открытии, заезжает обратно при закрытии.
export const panelSlideIn = {
  '0%': { transform: 'translateX(100%)', opacity: 0 },
  '100%': { transform: 'translateX(0)', opacity: 1 },
};
export const panelSlideOut = {
  '0%': { transform: 'translateX(0)', opacity: 1 },
  '100%': { transform: 'translateX(100%)', opacity: 0 },
};

// Анимация выхода из чата: панель уходит вниз и исчезает.
export const chatExit = {
  '0%': { transform: 'translateY(0) scale(1)', opacity: 1 },
  '100%': { transform: 'translateY(12px) scale(0.96)', opacity: 0 },
};

// Анимация входа в чат: лёгкое появление снизу с размытием.
export const chatEnter = {
  '0%': { transform: 'translateY(18px) scale(0.972) rotateX(3deg)', filter: 'blur(12px)', opacity: 0 },
  '100%': { transform: 'translateY(0) scale(1) rotateX(0)', filter: 'blur(0)', opacity: 1 },
};

// will-change: transform здесь намеренно убран: объект раздаётся сотням
// кнопок, и постоянный will-change держал для каждой композитный слой.
// Промпт поднимает слой на время самого нажатия.
export const membranePressSx = {
  transition: `transform 180ms ${motion.spring}, box-shadow 220ms ${motion.easeOut}, filter 220ms ${motion.easeOut}`,
  '&:active': {
    transform: 'scale(0.96) translateY(1px)',
    boxShadow: motion.membraneShadow,
    filter: 'saturate(1.08) brightness(.96)',
  },
};
