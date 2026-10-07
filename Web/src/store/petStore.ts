import { create } from 'zustand';
import { registerAccountStore } from '../services/storeSyncSimple';
import { petsApi } from '../services/api';
import { findPet } from './petCatalog';

export interface PetSettings { x: number; y: number; size: number; name: string; font: string; }
export interface EquippedPet { id: string; settings: PetSettings; }
interface PetState {
  ownedPets: string[];
  equippedPet: EquippedPet | null;
  loading: boolean;
  load: () => Promise<void>;
  equip: (id: string | null) => Promise<void>;
  updateSettings: (settings: Partial<PetSettings>) => Promise<void>;
}
export const DEFAULT_PET_SETTINGS: PetSettings = { x: 78, y: 76, size: 72, name: '', font: 'inherit' };

export const usePetStore = create<PetState>((set, get) => ({
  ownedPets: [], equippedPet: null, loading: false,
  load: async () => { set({ loading: true }); try { const { data } = await petsApi.get(); set({ ownedPets: data.ownedPets || [], equippedPet: data.equippedPet || null }); } finally { set({ loading: false }); } },
  equip: async id => { if (id !== null && !findPet(id)) return; const { data } = await petsApi.setEquipment(id); set({ ownedPets: data.ownedPets || get().ownedPets, equippedPet: data.equippedPet || null }); },
  updateSettings: async settings => { const current = get().equippedPet; if (!current) return; const { data } = await petsApi.setEquipment(current.id, { ...current.settings, ...settings }); set({ ownedPets: data.ownedPets || get().ownedPets, equippedPet: data.equippedPet || null }); },
}));
registerAccountStore('pets', usePetStore);
