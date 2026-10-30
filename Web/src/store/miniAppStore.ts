import { create } from 'zustand';
import { botsApi } from '../services/botsApi';

/**
 * Открытые мини-приложения. Кнопка под сообщением бота (web_app) открывает
 * окно поверх чата; окно одно на всё приложение.
 *
 *  - kind 'stickers' — встроенное мини-приложение стикеров (кнопка /hub);
 *  - kind 'web'      — сайт внешнего бота во фрейме-песочнице, с подписанным
 *                      initData в адресе после #vgWebAppData=.
 */
export type MiniApp =
  | { kind: 'stickers'; packName?: string }
  | { kind: 'web'; url: string; title: string };

interface MiniAppState {
  current: MiniApp | null;
  open: (app: MiniApp) => void;
  close: () => void;
}

export const useMiniAppStore = create<MiniAppState>((set) => ({
  current: null,
  open: (app) => set({ current: app }),
  close: () => set({ current: null }),
}));

/** Ссылка на мини-приложение бота, созданное в /hub через /newapp. */
export const APP_LINK_RE = /^vera:\/\/app\/([A-Za-z0-9_]{1,32})\/([A-Za-z0-9_]{3,30})$/;

/**
 * Открыть мини-приложение бота: сервер подписывает initData только для адреса,
 * который сохранил владелец бота. Без app — кнопка у поля ввода.
 */
export async function openBotApp(username: string, app?: string): Promise<void> {
  const { data } = await botsApi.appInit(username, app);
  const url = `${data.url.split('#')[0]}#vgWebAppData=${encodeURIComponent(data.initData)}`;
  useMiniAppStore.getState().open({ kind: 'web', url, title: data.title || data.bot.name });
}
