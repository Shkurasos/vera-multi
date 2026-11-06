import { io, Socket } from 'socket.io-client';
import type { Chat, User } from '../types';
import { useEquipmentStore } from '../store/equipmentStore';

let socket: Socket | null = null;

// Сокет держит токен, с которым подключился. Access-токен живёт 15 минут, и
// без обновления реконнекты socket.io уходят со старым токеном и падают — живые
// сообщения перестают приходить, пока страницу не обновят.
let socketToken = '';
let refreshingAuth = false;

/** Свежий токен из localStorage: axios-перехватчик обновляет его по 401. */
function latestToken(): string {
  try { return localStorage.getItem('vera_token') || ''; } catch { return ''; }
}

async function refreshSocketAuth(): Promise<void> {
  if (refreshingAuth || !socket) return;
  refreshingAuth = true;
  // Пока токен обновляется, глушим автореконнект: иначе сокет долбит сервер
  // старым токеном и упирается в лимит подключений.
  const live = socket;
  live.io.reconnection(false);
  try {
    const { tryRefresh } = await import('./api');
    const fresh = await tryRefresh();
    if (!fresh || !socket) return;
    socketToken = fresh;
    socket.auth = { token: fresh };
    if (!socket.connected) socket.connect();
  } catch { /* сеть ляжет — попробуем на следующем connect_error */ }
  finally {
    refreshingAuth = false;
    live.io.reconnection(true);
  }
}

export const connectSocket = (token: string): Socket => {
  const fresh = latestToken() || token;
  // Уже есть сокет, но токен сменился: переподключаемся с новым, иначе сервер
  // отклонит реконнект и входящие так и не дойдут.
  if (socket && fresh && fresh !== socketToken) {
    socketToken = fresh;
    socket.auth = { token: fresh };
    if (socket.connected) socket.disconnect();
    socket.connect();
    return socket;
  }
  if (socket?.connected) return socket;
  // Сокет есть, но отвалился: обновляем токен и поднимаем его заново.
  if (socket) {
    if (fresh) { socketToken = fresh; socket.auth = { token: fresh }; }
    socket.connect();
    return socket;
  }

  socketToken = fresh;
  socket = io('/', {
    auth: { token: fresh },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
  });

  socket.on('connect', () => console.log('🔌 WebSocket подключён'));
  socket.on('disconnect', () => console.log('🔌 WebSocket отключён'));
  socket.on('connect_error', (err) => {
    console.error('WebSocket ошибка:', err.message);
    const msg = String(err?.message || '');
    // Протухший токен сервер отвергает на рукопожатии. Обновляем его и
    // переподключаемся, не дожидаясь перезагрузки страницы.
    if (/invalid token|unauthorized|token/i.test(msg)) void refreshSocketAuth();
  });
  socket.on('user:equipment', async (equipment: Pick<User, 'id' | 'activeRing' | 'activeSelfCard' | 'activeBubble'> & { chatId?: string; skins?: { ring?: string; selfcard?: string; bubble?: string } }) => {
    if (!equipment?.id) return;
    const { useChatStore } = await import('../store/chatStore');
    // «Мои скины» для конкретного чата (payload с chatId): правим только
    // skins участника в этом чате, глобальный образ не трогаем.
    if (equipment.chatId) {
      const applySkins = (chat: Chat): Chat => chat.id !== equipment.chatId ? chat : {
        ...chat,
        members: chat.members.map(member => member.userId === equipment.id
          ? { ...member, skins: equipment.skins || undefined } : member),
      };
      useChatStore.setState(state => ({
        chats: state.chats.map(applySkins),
        activeChat: state.activeChat ? applySkins(state.activeChat) : null,
      }));
      return;
    }
    useEquipmentStore.getState().update(equipment);
    // Свой образ сменили на другом устройстве — применяем к магазину без
    // обратной отправки на сервер.
    const { useAuthStore } = await import('../store/authStore');
    if (useAuthStore.getState().user?.id === equipment.id) {
      const { useShopStore } = await import('../store/shopStore');
      useShopStore.getState().hydrateEquipment(equipment);
    }
    const updateChat = (chat: Chat): Chat => ({
      ...chat,
      members: chat.members.map(member => member.userId === equipment.id && member.user
        ? { ...member, user: { ...member.user, ...equipment } } : member),
    });
    useChatStore.setState(state => ({
      chats: state.chats.map(updateChat),
      activeChat: state.activeChat ? updateChat(state.activeChat) : null,
      // Только чаты, в которых есть сообщения от этого пользователя, получают
      // новую ссылку — остальные массивы сообщений не трогаем.
      messages: Object.fromEntries(
        Object.entries(state.messages).map(([chatId, messages]) => {
          const idx = messages.findIndex(m => m.senderId === equipment.id && m.sender);
          if (idx < 0) return [chatId, messages];
          const next = messages.slice();
          next[idx] = { ...messages[idx], sender: { ...messages[idx].sender, ...equipment } };
          return [chatId, next];
        })
      ),
    }));
  });
  socket.on('connect', async () => {
    // Refresh outfits missed while disconnected, including the open conversation.
    const { useChatStore } = await import('../store/chatStore');
    // Не перезагружаем весь список чатов при каждом переподключении — только
    // если список ещё пуст (первый вход / после сброса состояния).
    if (useChatStore.getState().chats.length === 0) {
      await useChatStore.getState().loadChats();
    }
    await Promise.all(Object.keys(useEquipmentStore.getState().users).map(id => useEquipmentStore.getState().refresh(id)));
    useChatStore.setState(state => ({
      activeChat: state.chats.find(chat => chat.id === state.activeChat?.id) || state.activeChat,
    }));
  });

  // Обработка реакций на сообщения в реальном времени.
  // Сервер шлёт { messageId, chatId, reactions } после POST /api/messages/:chatId/reaction.
  socket.on('message:reaction', async (payload: { messageId: string; chatId: string; reactions: any[] }) => {
    if (!payload?.messageId || !payload?.chatId) return;
    const { useChatStore } = await import('../store/chatStore');
    useChatStore.setState(state => {
      const messages = state.messages[payload.chatId];
      if (!messages) return state;
      const idx = messages.findIndex(m => m.id === payload.messageId);
      if (idx < 0) return state;
      const next = messages.slice();
      next[idx] = { ...next[idx], reactions: payload.reactions };
      return {
        ...state,
        messages: {
          ...state.messages,
          [payload.chatId]: next,
        },
      };
    });
  });

  return socket;
};

export const disconnectSocket = () => {
  socket?.disconnect();
  socket = null;
  socketToken = '';
};

export const getSocket = (): Socket | null => socket;

export const joinChat = (chatId: string) => socket?.emit('chat:join', chatId);
export const leaveChat = (chatId: string) => socket?.emit('chat:leave', chatId);
export const sendTypingStart = (chatId: string) => socket?.emit('typing:start', chatId);
export const sendTypingStop = (chatId: string) => socket?.emit('typing:stop', chatId);
export const sendReadReceipt = (chatId: string, messageId: string) =>
  socket?.emit('message:read', { chatId, messageId });
