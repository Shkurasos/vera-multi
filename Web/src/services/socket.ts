import { io, Socket } from 'socket.io-client';

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
