import { io, Socket } from 'socket.io-client';
import type { Chat, User } from '../types';
import { useEquipmentStore } from '../store/equipmentStore';

let socket: Socket | null = null;

export const connectSocket = (token: string): Socket => {
  if (socket?.connected) return socket;

  socket = io('/', {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
  });

  socket.on('connect', () => console.log('🔌 WebSocket подключён'));
  socket.on('disconnect', () => console.log('🔌 WebSocket отключён'));
  socket.on('connect_error', (err) => console.error('WebSocket ошибка:', err.message));
  socket.on('user:equipment', async (equipment: Pick<User, 'id' | 'activeRing' | 'activeSelfCard' | 'activeBubble'>) => {
    if (!equipment?.id) return;
    useEquipmentStore.getState().update(equipment);
    const { useChatStore } = await import('../store/chatStore');
    const updateChat = (chat: Chat): Chat => ({
      ...chat,
      members: chat.members.map(member => member.userId === equipment.id && member.user
        ? { ...member, user: { ...member.user, ...equipment } } : member),
    });
    useChatStore.setState(state => ({
      chats: state.chats.map(updateChat),
      activeChat: state.activeChat ? updateChat(state.activeChat) : null,
      messages: Object.fromEntries(Object.entries(state.messages).map(([id, messages]) => [id,
        messages.map(message => message.senderId === equipment.id && message.sender
          ? { ...message, sender: { ...message.sender, ...equipment } } : message),
      ])),
    }));
  });
  socket.on('connect', async () => {
    // Refresh outfits missed while disconnected, including the open conversation.
    const { useChatStore } = await import('../store/chatStore');
    await useChatStore.getState().loadChats();
    await Promise.all(Object.keys(useEquipmentStore.getState().users).map(id => useEquipmentStore.getState().refresh(id)));
    useChatStore.setState(state => ({
      activeChat: state.chats.find(chat => chat.id === state.activeChat?.id) || state.activeChat,
    }));
  });

  return socket;
};

export const disconnectSocket = () => {
  socket?.disconnect();
  socket = null;
};

export const getSocket = (): Socket | null => socket;

export const joinChat = (chatId: string) => socket?.emit('chat:join', chatId);
export const leaveChat = (chatId: string) => socket?.emit('chat:leave', chatId);
export const sendTypingStart = (chatId: string) => socket?.emit('typing:start', chatId);
export const sendTypingStop = (chatId: string) => socket?.emit('typing:stop', chatId);
export const sendReadReceipt = (chatId: string, messageId: string) =>
  socket?.emit('message:read', { chatId, messageId });
