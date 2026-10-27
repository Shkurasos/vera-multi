import { create } from 'zustand';

export type ProfileOpenState = {
  viewProfile: boolean;
  setProfileOpen: (open: boolean) => void;
};

export const useProfileOpenStore = create<ProfileOpenState>((set) =>({
  viewProfile: false,
  setProfileOpen: (open: boolean) => set((state) => ({ viewProfile: open })),
}));
