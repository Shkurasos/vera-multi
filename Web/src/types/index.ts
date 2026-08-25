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
export type MessageType = 'text' | 'photo' | 'video' | 'audio' | 'voice' | 'document' | 'sticker' | 'system';

export interface Chat {
  id: string;
  type: ChatType;
  name?: string;
  description?: string;
  avatarUrl?: string;
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
  pinnedMessage?: Message;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMember {
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
  replyTo?: Message;
  forwardFromId?: string;
  forwardFrom?: Message;
  type: MessageType;
  content?: string;
  attachments?: MessageAttachment[];
  reactions?: MessageReaction[];
  isEdited: boolean;
  isPinned: boolean;
  isDeleted: boolean;
  readBy?: string[];
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
