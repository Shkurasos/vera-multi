type ParticleKind = 'star' | 'bubble' | 'spark' | 'pixel' | 'ember' | 'heart';

const THEMES: Record<string, { kind: ParticleKind; colors: string[] }> = {
  'pet-cat': { kind: 'star', colors: ['#8ea0ff', '#c7b9ff', '#ffffff'] },
  'pet-fox': { kind: 'bubble', colors: ['#ff8a5c', '#ffd6a6', '#fff1de'] },
  'pet-bunny': { kind: 'spark', colors: ['#4dd0ff', '#b578ff', '#e8fbff'] },
  'pet-pixel': { kind: 'pixel', colors: ['#7ee022', '#c2ff78', '#ffffff'] },
  'pet-phoenix': { kind: 'ember', colors: ['#ff7043', '#ffd166', '#fff0a6'] },
  // Звери «Бестиария»: паутинные искры, сердечки медвежонка, пузыри змеи,
  // угольки тыквы и розовые искры медузы.
  'pet-spider': { kind: 'star', colors: ['#ffffff', '#f3e9dc', '#d8cfc4'] },
  'pet-bear': { kind: 'heart', colors: ['#ff9db0', '#ffc7d3', '#ffe3ea'] },
  'pet-snake': { kind: 'bubble', colors: ['#8fc93f', '#b8e07a', '#e2f5c8'] },
  'pet-pumpkin': { kind: 'ember', colors: ['#ff8c2a', '#ffc24d', '#ffe8a3'] },
  'pet-jellyfish': { kind: 'spark', colors: ['#ff8fc0', '#ffb3d6', '#e8fbff'] },
  'pet-panda': { kind: 'heart', colors: ['#ffffff', '#dce5ee', '#9aa9b8'] },
  'pet-hedgehog': { kind: 'spark', colors: ['#d99a67', '#f2bd83', '#fff0c8'] },
  'pet-squirrel': { kind: 'heart', colors: ['#e58a42', '#ffbd70', '#fff0c8'] },
  'pet-pixel-dragon': { kind: 'pixel', colors: ['#7ee022', '#b8ff69', '#ffd166'] },
  'pet-bat': { kind: 'star', colors: ['#a995cf', '#e0d4ff', '#ffffff'] },
};

export function getPetParticles(petId: string) {
  const theme = THEMES[petId];
  if (!theme) return [];
  return Array.from({ length: 12 }, (_, index) => {
    const angle = index / 12 * Math.PI * 2;
    const distance = 48 + index % 3 * 12;
    return {
      kind: theme.kind,
      color: theme.colors[index % theme.colors.length],
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance - (theme.kind === 'ember' ? 25 : 12),
      size: 3 + index % 3,
      delay: index % 4 * 25,
    };
  });
}