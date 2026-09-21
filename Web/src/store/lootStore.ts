import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SHOP_CATALOG, useShopStore } from './shopStore';
import { RARITY_META, RARITY_ORDER } from '../utils/rarityStyles';
import { findCase } from './caseCatalog';
import { THEMED_PACKS } from './themedPacks';
import { packKeyFromPackId, packPartIds } from './packCatalog';
import { registerAccountStore } from '../services/storeSyncSimple';
import { walletApi } from '../services/api';

export interface SkinPack {
  id: string;
  name: string;
  ring: string;
  selfcard: string;
  bubble: string;
  weight: number;
  color: string;
}

// Legacy mappings remain documented; new drops use dedicated matching pieces.
const combinations: [string, string, string][] = [
  ['neon', 'glow', 'badge'], ['glass', 'default', 'hologram'],
  ['shadow', 'default', 'default'], ['gradient-sunset', 'fire', 'gradient'],
  ['gradient-ocean', 'ocean', 'gradient'], ['gradient-forest', 'pulse', 'badge'],
  ['minimal', 'default', 'default'], ['rounded', 'pulse', 'badge'],
  ['sharp', 'glow', 'badge'], ['retro', 'fire', 'gold'],
  ['candy', 'rainbow', 'gradient'], ['mono', 'default', 'default'],
  ['aurora', 'aurora', 'gradient'], ['cyber', 'glow', 'hologram'],
  ['gradient-lava', 'lava', 'gold'], ['gradient-ice', 'ice', 'hologram'],
  ['gradient-gold', 'fire', 'gold'], ['neon-pink', 'rainbow', 'gradient'],
  ['holographic', 'holographic', 'hologram'],
];

export const SKIN_PACKS: SkinPack[] = [
  ...THEMED_PACKS.map(pack => {
    const parts = packPartIds(pack.id);
    return {
    id: `pack-${pack.id}`, name: pack.name,
    ring: parts.ring, selfcard: parts.selfcard, bubble: parts.bubble,
    weight: findCase(pack.caseId)!.rewards.find(reward => reward.key === pack.id)!.weight,
    color: RARITY_META[pack.rarity].color,
    };
  }),
  ...combinations.map(([bubble]) => {
    const parts = packPartIds(bubble);
    const item = SHOP_CATALOG.find(i => i.id === parts.bubble)!;
    return {
    id: `pack-${bubble}`,
    name: item.name,
    ring: parts.ring, selfcard: parts.selfcard, bubble: parts.bubble,
    weight: 100,
    color: bubble === 'cyber' ? '#fcee09' : String(item.previewColor).match(/#[\da-f]{6}/i)?.[0] || '#54dce4',
    };
  }),
  ...RARITY_ORDER.map((rarity, index) => {
    const parts = packPartIds(`r-${rarity}`);
    return {
    id: `pack-r-${rarity}`, name: RARITY_META[rarity].codename,
    ring: parts.ring, selfcard: parts.selfcard, bubble: parts.bubble,
    weight: Math.max(1, Math.round(100 * Math.pow(0.8, index))),
    color: RARITY_META[rarity].color,
    };
  }),
];

export const casePacks = (caseId: string) => {
  const definition = findCase(caseId);
  return SKIN_PACKS.filter(p => {
    const packKey = packKeyFromPackId(p.id);
    return !!packKey && !!definition?.packs.includes(packKey);
  }).map(pack => ({ ...pack, weight: definition!.rewards.find(reward => `pack-${reward.key}` === pack.id)!.weight }));
};
export const packChance = (pack: SkinPack, caseId = 'case-base') => {
  const pool = casePacks(caseId);
  return pool.some(p => p.id === pack.id) ? pack.weight / pool.reduce((sum, p) => sum + p.weight, 0) * 100 : 0;
};

export function drawPack(random: number, caseId = 'case-base'): SkinPack {
  if (!Number.isFinite(random) || random < 0 || random >= 1) throw new Error('Invalid random value');
  const pool = casePacks(caseId);
  if (!pool.length) throw new Error('Unknown or empty case');
  const totalWeight = pool.reduce((sum, p) => sum + p.weight, 0);
  let remaining = random * totalWeight;
  for (const pack of pool) {
    remaining -= pack.weight;
    if (remaining < 0) return pack;
  }
  return pool[pool.length - 1];
}

interface LootState {
  prices: Record<string, number | null>;
  pending: boolean;
  hydrate: (data: any) => void;
  load: () => Promise<void>;
  buyCase: (caseId: string) => Promise<void>;
  cases: number;
  caseCounts: Record<string, number>;
  packs: Record<string, number>;
  lastDrop: string | null;
  openCase: (caseId?: string) => Promise<SkinPack | null>;
  equipPack: (id: string) => void;
  equipPart: (id: string, part: 'ring' | 'selfcard' | 'bubble') => void;
}

// Server owns case counters, rewards and wallet changes.
export const useLootStore = create<LootState>()(persist((set, get) => ({
  prices: {}, pending: false,
  hydrate: data => {
    set({ cases: data.caseCounts?.['case-base'] || 0, caseCounts: data.caseCounts || {}, packs: data.packs || {}, lastDrop: data.lastDrop || null, prices: data.prices || {} });
    useShopStore.getState().setBalance(data.balance);
    useShopStore.getState().mergeOwned(data.ownedItems || []);
  },
  load: async () => {
    const token = localStorage.getItem('vera_token');
    const { data } = await walletApi.cases();
    if (token === localStorage.getItem('vera_token')) get().hydrate(data);
  },
  buyCase: async caseId => {
    if (get().pending) return;
    const token = localStorage.getItem('vera_token');
    set({ pending: true });
    try {
      const { data } = await walletApi.buyCase(caseId);
      if (token === localStorage.getItem('vera_token')) get().hydrate(data);
    } finally { if (token === localStorage.getItem('vera_token')) set({ pending: false }); }
  },
  // Preserve the original base-case counter and existing persisted inventories.
  cases: 0, caseCounts: {}, packs: {}, lastDrop: null,
  openCase: async (caseId = 'case-base') => {
    if (get().pending || !findCase(caseId)) return null;
    const token = localStorage.getItem('vera_token');
    set({ pending: true });
    try {
      const { data } = await walletApi.openCase(caseId);
      if (token !== localStorage.getItem('vera_token')) return null;
      get().hydrate(data);
      return SKIN_PACKS.find(p => p.id === data.drop) || null;
    } finally { if (token === localStorage.getItem('vera_token')) set({ pending: false }); }
  },
  equipPack: (id) => {
    const pack = SKIN_PACKS.find(p => p.id === id);
    if (!pack || !get().packs[id]) return;
    const shop = useShopStore.getState();
    shop.setActiveRing(pack.ring);
    shop.setActiveSelfCard(pack.selfcard);
    shop.setActiveBubble(pack.bubble);
  },
  equipPart: (id, part) => {
    const pack = SKIN_PACKS.find(p => p.id === id);
    if (!pack || !get().packs[id]) return;
    const shop = useShopStore.getState();
    if (part === 'ring') shop.setActiveRing(pack.ring);
    if (part === 'selfcard') shop.setActiveSelfCard(pack.selfcard);
    if (part === 'bubble') shop.setActiveBubble(pack.bubble);
  },
}), {
  name: 'vera-loot-v1',
  partialize: s => ({ cases: s.cases, caseCounts: s.caseCounts, packs: s.packs, lastDrop: s.lastDrop }),
}));

registerAccountStore('loot', useLootStore);

export const caseCount = (state: Pick<LootState, 'cases' | 'caseCounts'>, id: string) => id === 'case-base' ? state.cases : state.caseCounts[id] || 0;