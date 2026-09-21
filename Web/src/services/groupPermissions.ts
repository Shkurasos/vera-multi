import { ChatMember } from '../types';

export const GROUP_RIGHTS = {
  changeInfo: 'Изменение названия, описания и оформления',
  inviteMembers: 'Приглашение и добавление участников',
  deleteMessages: 'Удаление чужих сообщений',
  editMessages: 'Редактирование сообщений',
  manageAdmins: 'Назначение администраторов и выдача званий',
} as const;
export type GroupRight = keyof typeof GROUP_RIGHTS;
export function hasGroupRight(member: ChatMember | undefined, right: GroupRight): boolean {
  return !!member && (member.role === 'owner' || (member.role === 'admin' &&
    (member.permissions ? member.permissions[right] === true : true)));
}