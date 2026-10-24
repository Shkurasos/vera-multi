#include "ChatListModel.h"

#include "Formatting.h"

#include <algorithm>

ChatListModel::ChatListModel(QObject *parent)
    : QAbstractListModel(parent)
{
}

int ChatListModel::rowCount(const QModelIndex &parent) const
{
    return parent.isValid() ? 0 : static_cast<int>(m_chats.size());
}

QVariant ChatListModel::data(const QModelIndex &index, int role) const
{
    if (!index.isValid() || index.row() >= m_chats.size())
        return {};
    const Chat &chat = m_chats.at(index.row());
    switch (role) {
    case IdRole: return chat.id;
    case Qt::DisplayRole:
    case TitleRole: return chat.title;
    case SubtitleRole: return chat.preview;
    case TimeRole: return vera::chatListTime(chat.activity);
    case UnreadRole: return chat.unread;
    case TypeRole: return chat.type;
    case AvatarLetterRole: return chat.title.isEmpty() ? QStringLiteral("?") : chat.title.left(1).toUpper();
    default: return {};
    }
}

QHash<int, QByteArray> ChatListModel::roleNames() const
{
    return {
        {IdRole, "chatId"},
        {TitleRole, "title"},
        {SubtitleRole, "subtitle"},
        {TimeRole, "time"},
        {UnreadRole, "unread"},
        {TypeRole, "chatType"},
        {AvatarLetterRole, "avatarLetter"},
    };
}

void ChatListModel::setChats(const QJsonArray &chats)
{
    beginResetModel();
    m_chats.clear();
    m_chats.reserve(chats.size());
    for (const QJsonValue &value : chats)
        m_chats.append(makeChat(value.toObject()));
    std::stable_sort(m_chats.begin(), m_chats.end(), &ChatListModel::before);
    endResetModel();
}

void ChatListModel::clear()
{
    beginResetModel();
    m_chats.clear();
    endResetModel();
}

void ChatListModel::upsertChat(const QJsonObject &object)
{
    Chat chat = makeChat(object);
    if (chat.id.isEmpty())
        return;
    const int row = indexOf(chat.id);
    if (row < 0) {
        beginInsertRows({}, 0, 0);
        m_chats.prepend(chat);
        endInsertRows();
    } else {
        Chat &existing = m_chats[row];
        // chat:updated has no lastMessage/unreadCount: keep what we have.
        if (!object.contains(QStringLiteral("lastMessage"))) {
            chat.preview = existing.preview;
            chat.activity = std::max(chat.activity, existing.activity);
        }
        if (!object.contains(QStringLiteral("unreadCount")))
            chat.unread = existing.unread;
        existing = chat;
        emit dataChanged(index(row), index(row));
    }
    sortChats();
}

void ChatListModel::removeChat(const QString &chatId)
{
    const int row = indexOf(chatId);
    if (row < 0)
        return;
    beginRemoveRows({}, row, row);
    m_chats.removeAt(row);
    endRemoveRows();
}

bool ChatListModel::applyNewMessage(const QJsonObject &message, bool isOpenChat)
{
    const int row = indexOf(message.value(QStringLiteral("chatId")).toString());
    if (row < 0)
        return false;
    Chat &chat = m_chats[row];
    // Channel comments do not change the channel preview (same as the server).
    if (!(chat.type == QLatin1String("channel") && !message.value(QStringLiteral("replyToId")).toString().isEmpty())) {
        chat.preview = vera::messagePreview(message);
        chat.activity = vera::parseServerTime(message.value(QStringLiteral("createdAt")).toString());
    }
    const QString senderId = message.value(QStringLiteral("authorId")).toString(
        message.value(QStringLiteral("senderId")).toString());
    if (!isOpenChat && senderId != m_userId)
        ++chat.unread;
    emit dataChanged(index(row), index(row));
    sortChats();
    return true;
}

void ChatListModel::markRead(const QString &chatId)
{
    const int row = indexOf(chatId);
    if (row < 0 || m_chats.at(row).unread == 0)
        return;
    m_chats[row].unread = 0;
    emit dataChanged(index(row), index(row), {UnreadRole});
    sortChats();
}

QString ChatListModel::titleOf(const QString &chatId) const
{
    const int row = indexOf(chatId);
    return row < 0 ? QString() : m_chats.at(row).title;
}

QString ChatListModel::chatTypeOf(const QString &chatId) const
{
    const int row = indexOf(chatId);
    return row < 0 ? QString() : m_chats.at(row).type;
}

ChatListModel::Chat ChatListModel::makeChat(const QJsonObject &object) const
{
    Chat chat;
    chat.id = object.value(QStringLiteral("id")).toString();
    chat.type = object.value(QStringLiteral("type")).toString(QStringLiteral("direct"));
    chat.unread = object.value(QStringLiteral("unreadCount")).toInt();
    chat.pinned = object.value(QStringLiteral("pinned")).toBool();
    chat.title = object.value(QStringLiteral("name")).toString();

    if (chat.type == QLatin1String("direct")) {
        // A direct chat is titled after the other member.
        const QJsonArray members = object.value(QStringLiteral("members")).toArray();
        for (const QJsonValue &member : members) {
            const QJsonObject m = member.toObject();
            if (m.value(QStringLiteral("userId")).toString() != m_userId) {
                chat.title = vera::userDisplayName(m.value(QStringLiteral("user")).toObject());
                break;
            }
        }
    }
    if (chat.title.isEmpty())
        chat.title = chat.type == QLatin1String("saved") ? tr("Избранное") : tr("Без названия");

    const QJsonObject last = object.value(QStringLiteral("lastMessage")).toObject();
    if (!last.isEmpty())
        chat.preview = vera::messagePreview(last);
    const QDateTime lastAt = vera::parseServerTime(last.value(QStringLiteral("createdAt")).toString());
    const QDateTime updatedAt = vera::parseServerTime(object.value(QStringLiteral("updatedAt")).toString());
    const QDateTime createdAt = vera::parseServerTime(object.value(QStringLiteral("createdAt")).toString());
    chat.activity = std::max({lastAt, updatedAt, createdAt});
    return chat;
}

int ChatListModel::indexOf(const QString &chatId) const
{
    for (int i = 0; i < m_chats.size(); ++i) {
        if (m_chats.at(i).id == chatId)
            return i;
    }
    return -1;
}

bool ChatListModel::before(const Chat &a, const Chat &b)
{
    if (a.pinned != b.pinned)
        return a.pinned;
    if ((a.unread > 0) != (b.unread > 0))
        return a.unread > 0;
    return a.activity > b.activity;
}

void ChatListModel::sortChats()
{
    // Move rows one by one so that the view keeps its delegates.
    QVector<Chat> sorted = m_chats;
    std::stable_sort(sorted.begin(), sorted.end(), &ChatListModel::before);
    for (int target = 0; target < sorted.size(); ++target) {
        const int from = indexOf(sorted.at(target).id);
        if (from == target)
            continue;
        beginMoveRows({}, from, from, {}, target);
        m_chats.move(from, target);
        endMoveRows();
    }
}

