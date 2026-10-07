export type PetRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface PetDefinition {
  id: string;
  name: string;
  rarity: PetRarity;
  color: string;
  caseIds: string[];
}

// Пять питомцев, нарисованных по референсам (см. PetArtwork.tsx):
// чёрный кот со свечением, спящая лиса, неоновый заяц, пиксельный кот и феникс.
export const PET_CATALOG: PetDefinition[] = [
  { id: 'pet-cat', name: 'Ночной кот', rarity: 'legendary', color: '#8ea0ff', caseIds: ['case-pets', 'case-base'] },
  { id: 'pet-fox', name: 'Ленивая лиса', rarity: 'common', color: '#ff8a5c', caseIds: ['case-pets', 'case-elements'] },
  { id: 'pet-bunny', name: 'Неоновый заяц', rarity: 'uncommon', color: '#4dd0ff', caseIds: ['case-pets', 'case-signal'] },
  { id: 'pet-pixel', name: 'Пиксельный кот', rarity: 'epic', color: '#7ee022', caseIds: ['case-pets', 'case-games'] },
  { id: 'pet-phoenix', name: 'Феникс', rarity: 'rare', color: '#ffd166', caseIds: ['case-pets', 'case-eclipse'] },
];

export const findPet = (id: string) => PET_CATALOG.find(pet => pet.id === id);

// Старые id (сова/дракон) мигрируем на новые, чтобы инвентарь и надетый
// питомец пережили редизайн каталога.
export const LEGACY_PET_IDS: Record<string, string> = { 'pet-owl': 'pet-bunny', 'pet-dragon': 'pet-pixel' };
export const normalizePetId = (id: string) => LEGACY_PET_IDS[id] || id;
