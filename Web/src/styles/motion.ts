export const motion = {
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  easeIn: 'cubic-bezier(0.7, 0, 0.84, 0)',
  emphasized: 'cubic-bezier(0.2, 0, 0, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  membraneShadow: 'inset 0 7px 18px rgba(0,0,0,.34), inset 0 -4px 12px rgba(255,255,255,.08)',
};

export const membranePressSx = {
  transform: 'translateZ(0)',
  willChange: 'transform, box-shadow, filter',
  transition: `transform 180ms ${motion.spring}, box-shadow 220ms ${motion.easeOut}, filter 220ms ${motion.easeOut}`,
  '&:active': {
    transform: 'scale(0.96) translateY(1px)',
    boxShadow: motion.membraneShadow,
    filter: 'saturate(1.08) brightness(.96)',
  },
};
