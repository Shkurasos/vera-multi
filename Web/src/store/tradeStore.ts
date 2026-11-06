import { create } from 'zustand';
import { tradesApi } from '../services/api';

export interface TradeSide { items: string[]; vp: number; }
export interface Trade {
  id: string;
  from: { id: string; username: string };
  to: { id: string; username: string };
  offer: TradeSide;
  request: TradeSide;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  createdAt: number;
  updatedAt: number;
  outgoing: boolean;
}

interface TradeState {
  trades: Trade[];
  /** Сервер разрешает обмен: к аккаунту привязаны телефон и почта. */
  eligible: boolean;
  load: () => Promise<void>;
}

export const useTradeStore = create<TradeState>((set) => ({
  trades: [],
  eligible: false,
  load: async () => {
    const { data } = await tradesApi.list();
    set({ trades: data.trades || [], eligible: !!data.eligible });
  },
}));

/** Входящие предложения, ждущие ответа. */
export const pendingIncoming = (trades: Trade[]) => trades.filter(t => !t.outgoing && t.status === 'pending').length;
