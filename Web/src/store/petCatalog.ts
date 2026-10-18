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
  // Эксклюзивные звери кейса «Бестиарий» (2000 ВП): паук, медведь, змея,
  // тыква-джек и медуза — выпадают только там.
  { id: 'pet-spider', name: 'Пушистый паук', rarity: 'common', color: '#d9843a', caseIds: ['case-pets-bestiary'] },
  { id: 'pet-bear', name: 'Мягкий медвежонок', rarity: 'uncommon', color: '#d9a078', caseIds: ['case-pets-bestiary'] },
  { id: 'pet-snake', name: 'Зелёная змея', rarity: 'rare', color: '#7cae3a', caseIds: ['case-pets-bestiary'] },
  { id: 'pet-pumpkin', name: 'Светящийся Джек', rarity: 'epic', color: '#ff8c2a', caseIds: ['case-pets-bestiary'] },
  { id: 'pet-jellyfish', name: 'Сияющая медуза', rarity: 'legendary', color: '#ff8fc0', caseIds: ['case-pets-bestiary'] },
  // Эксклюзивные питомцы кейса «Мифические питомцы» (2000 ВП).
  { id: 'pet-panda', name: 'Мягкая панда', rarity: 'common', color: '#dce5ee', caseIds: ['case-pets-mythical'] },
  { id: 'pet-hedgehog', name: 'Румяный ёжик', rarity: 'uncommon', color: '#b9855b', caseIds: ['case-pets-mythical'] },
  { id: 'pet-squirrel', name: 'Ореховая белка', rarity: 'rare', color: '#e58a42', caseIds: ['case-pets-mythical'] },
  { id: 'pet-pixel-dragon', name: 'Пиксельный дракон', rarity: 'epic', color: '#7ee022', caseIds: ['case-pets-mythical'] },
  { id: 'pet-bat', name: 'Летучая мышь', rarity: 'legendary', color: '#a995cf', caseIds: ['case-pets-mythical'] },
];

export const findPet = (id: string) => PET_CATALOG.find(pet => pet.id === id);

// Старые id (сова/дракон) мигрируем на новые, чтобы инвентарь и надетый
// питомец пережили редизайн каталога.
export const LEGACY_PET_IDS: Record<string, string> = { 'pet-owl': 'pet-bunny', 'pet-dragon': 'pet-pixel' };
export const normalizePetId = (id: string) => LEGACY_PET_IDS[id] || id;
