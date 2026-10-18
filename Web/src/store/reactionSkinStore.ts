import { create } from 'zustand';
import catalog from './reactionSkins.json';
import { reactionsApi } from '../services/api';
import { registerAccountStore } from '../services/storeSyncSimple';
import type { RarityTier as Rarity } from '../utils/rarityStyles';

/**
 * Скины реакций. Каталог общий с сервером (Server/reaction-skins.js):
 * в сообщении хранится id скина (`rx-<пак>-<реакция>`), поэтому все
 * участники чата видят оформленный скин, а стоковые реакции — обычные эмодзи.
 */
export interface ReactionSkin { id: string; glyph: string; name: string; rarity: Rarity; pack: string; color: string; }
export interface ReactionSkinPack { id: string; name: string; color: string; reactions: ReactionSkin[]; }

export const REACTION_SLOT_COUNT = 10;
export const STOCK_REACTIONS: string[] = [...catalog.stock];
export const REACTION_SKIN_PACKS: ReactionSkinPack[] = catalog.packs.map(pack => ({
  id: pack.id, name: pack.name, color: pack.color,
  reactions: pack.reactions.map(r => ({ ...r, rarity: r.rarity as Rarity, pack: pack.id, color: pack.color })),
}));
export const REACTION_SKINS: ReactionSkin[] = REACTION_SKIN_PACKS.flatMap(p => p.reactions);
const BY_ID = new Map(REACTION_SKINS.map(s => [s.id, s]));
export const findReactionSkin = (id: string | null | undefined) => (id ? BY_ID.get(id) : undefined);
export const isReactionSkinId = (id: string | null | undefined) => !!findReactionSkin(id);
/** Подпись реакции для aria-label/tooltip: имя скина или сам эмодзи. */
export const reactionLabel = (value: string) => findReactionSkin(value)?.name || value;

interface ReactionSkinState {
  owned: Record<string, number>;
  slots: string[];
  hydrate: (data: { reactionSkins?: Record<string, number>; reactionSlots?: string[] }) => void;
  load: () => Promise<void>;
  setSlots: (slots: string[]) => Promise<void>;
}

const validSlots = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length === REACTION_SLOT_COUNT && value.every(v => typeof v === 'string');

export const useReactionSkinStore = create<ReactionSkinState>((set, get) => ({
  owned: {},
  slots: STOCK_REACTIONS,
  hydrate: data => set({
    ...(data.reactionSkins && typeof data.reactionSkins === 'object' ? { owned: data.reactionSkins } : {}),
    ...(validSlots(data.reactionSlots) ? { slots: data.reactionSlots } : {}),
  }),
  load: async () => {
    const token = localStorage.getItem('vera_token');
    const { data } = await reactionsApi.get();
    if (token === localStorage.getItem('vera_token')) get().hydrate(data);
  },
  // Сервер проверяет владение и уникальность; клиент принимает его ответ как истину.
  setSlots: async slots => {
    const { data } = await reactionsApi.setSlots(slots);
    get().hydrate(data);
  },
}));

registerAccountStore('reactionSkins', useReactionSkinStore);
