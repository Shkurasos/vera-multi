export interface User {
  id: string;
  phone?: string | null;
  email?: string | null;
  username: string;
  firstName?: string | null;
  lastName?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  isOnline: boolean;
  lastSeen?: string;
  createdAt: string;
  birthDate?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  successfulDialogsCount?: number;
  complaintsCount?: number;
  positiveRatingsCount?: number;
  negativeRatingsCount?: number;
  neutralRatingsCount?: number;
  communityTrustScore?: number;
  reputationScore?: number;
  /** DEV-режим по IP (сервер выставляет). Открывает весь магазин и inspector. */
  isDev?: boolean;
  /** Админ-режим (сервер выставляет). Всё в магазине бесплатно. */
  isAdmin?: boolean;
  /** ID закреплённого плейлиста, отображается на профиле как мини-плеер. */
  pinnedPlaylistId?: string | null;
  /** ID закреплённого одиночного трека (взаимоисключимо с pinnedPlaylistId). */
  pinnedTrackId?: string | null;
  /** Активная обводка аватара (id из магазина) — видна другим пользователям. */
  activeRing?: string;
  /** Активная «плашка» своих сообщений (id из магазина). */
  activeSelfCard?: string;
  /** Активный пузырь сообщений — виден собеседникам. */
  activeBubble?: string;
}

export type ReputationVoteValue = 'positive' | 'neutral' | 'negative';

export interface UserReputationSummary {
  userId: string;
  reputationScore: number;
  successfulDialogsCount: number;
  complaintsCount: number;
  positiveRatingsCount: number;
  neutralRatingsCount: number;
  negativeRatingsCount: number;
  communityTrustScore: number;
  myVote: ReputationVoteValue | null;
}

export type ChatType = 'private' | 'group' | 'channel' | 'direct' | 'saved';
export type MessageType = 'text' | 'photo' | 'video' | 'audio' | 'voice' | 'document' | 'poll' | 'sticker' | 'system';

export interface Chat {
  activeRing?: string;
  activeSelfCard?: string;
  activeBubble?: string;
  id: string;
  type: ChatType;
  name?: string;
  description?: string;
  avatarUrl?: string;
  /** Общая обложка чата, сохранённая на сервере. */
  wallpaper?: { type: 'photo' | 'live' | 'stock'; value: string } | null;
  inviteLink?: string;
  isPublic: boolean;
  createdById?: string;
  ownerId?: string;
  members: ChatMember[];
  lastMessage?: Message;
  unreadCount: number;
  isMuted?: boolean;
  membership?: ChatMember;
  pinnedMessageId?: string;
  /** Несколько закреплённых сообщений (новые первыми), как в Telegram. */
  pinnedMessageIds?: string[];
  pinnedMessage?: Message;
  pinnedMessages?: Message[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatMember {
  permissions?: Partial<Record<'changeInfo' | 'inviteMembers' | 'deleteMessages' | 'editMessages' | 'manageAdmins', boolean>>;
  adminTitle?: string;
  promotedBy?: string;
  id: string;
  chatId: string;
  userId: string;
  user?: User;
  role: 'member' | 'admin' | 'owner';
  isMuted: boolean;
  lastReadMessageId?: string;
  joinedAt: string;
}

export interface MessageAttachment {
  id: string;
  fileUrl: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  width?: number;
  height?: number;
  duration?: number;
  thumbnailUrl?: string;
  /** Произвольный payload для встроенных карточек (например, vera-playlist — JSON-строка). */
  data?: string | object | null;
}

export interface MessageReaction {
  emoji: string;
  count: number;
  userIds: string[];
}

export interface Message {
  id: string;
  chatId: string;
  senderId?: string;
  sender?: User;
  replyToId?: string;
  commentReplyToId?: string;
  replyTo?: Message;
  forwardFromId?: string;
  forwardFrom?: Message;
  /** Имя/автор исходного сообщения для отображения пересылки без загрузки исходного чата. */
  forwardFromName?: string;
  type: MessageType;
  content?: string;
  attachments?: MessageAttachment[];
  reactions?: MessageReaction[];
  poll?: { question: string; multiple?: boolean; options: Array<{ id: string; text: string; votes: number; voterIds?: string[] }> };
  isEdited: boolean;
  isPinned: boolean;
  isDeleted: boolean;
  readBy?: string[];
  /** Локальный статус доставки для UI (только для temp-сообщений в outbox). */
  status?: 'pending' | 'sending' | 'failed' | 'sent';
  createdAt: string;
  updatedAt: string;
}

export interface Track {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  description?: string;
  duration: number;
  fileUrl: string;
  coverUrl?: string;
  uploadedById?: string;
  playsCount: number;
  createdAt: string;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string | null;
  coverUrl?: string | null;
  userId?: string;
  user?: User;
  isPublic?: boolean;
  tracks?: PlaylistTrackEntry[];
  createdAt: string;
  updatedAt?: string;
}

// Связь playlist <-> track с расширенными метаданными
export interface PlaylistTrackEntry {
  id: string;
  playlistId: string;
  trackId: string;
  track: Track;
  position: number;
  addedAt: string;
}
