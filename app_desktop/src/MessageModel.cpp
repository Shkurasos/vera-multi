#include "MessageModel.h"

#include "Formatting.h"

MessageModel::MessageModel(QObject *parent)
    : QAbstractListModel(parent)
{
}

int MessageModel::rowCount(const QModelIndex &parent) const
{
    return parent.isValid() ? 0 : static_cast<int>(m_messages.size());
}

QVariant MessageModel::data(const QModelIndex &index, int role) const
{
    if (!index.isValid() || index.row() >= m_messages.size())
        return {};
    const Message &message = m_messages.at(index.row());
    switch (role) {
    case IdRole: return message.id;
    case Qt::DisplayRole:
    case TextRole: return message.text;
    case SenderNameRole: return message.senderName;
    case IsMineRole: return message.senderId == m_userId;
    case TimeRole: return vera::shortTime(message.createdAt);
    case IsEditedRole: return message.edited;
    case IsPendingRole: return message.pending;
    case IsFailedRole: return message.failed;
    case ShowSenderRole: {
        // Show the sender name in group chats above the first message of a series.
        if (!m_groupChat || message.senderId == m_userId)
            return false;
        return index.row() == 0 || m_messages.at(index.row() - 1).senderId != message.senderId;
    }
    default: return {};
    }
}

QHash<int, QByteArray> MessageModel::roleNames() const
{
    return {
        {IdRole, "messageId"},
        {TextRole, "text"},
        {SenderNameRole, "senderName"},
        {IsMineRole, "isMine"},
        {TimeRole, "time"},
        {IsEditedRole, "isEdited"},
        {IsPendingRole, "isPending"},
        {IsFailedRole, "isFailed"},
        {ShowSenderRole, "showSender"},
    };
}

void MessageModel::setMessages(const QJsonArray &messages)
{
    beginResetModel();
    m_messages.clear();
    m_messages.reserve(messages.size());
    for (const QJsonValue &value : messages)
        m_messages.append(makeMessage(value.toObject()));
    endResetModel();
}

void MessageModel::prependMessages(const QJsonArray &messages)
{
    QVector<Message> older;
    for (const QJsonValue &value : messages) {
        Message message = makeMessage(value.toObject());
        if (indexOfId(message.id) < 0)
            older.append(message);
    }
    if (older.isEmpty())
        return;
    beginInsertRows({}, 0, static_cast<int>(older.size()) - 1);
    m_messages = older + m_messages;
    endInsertRows();
}

void MessageModel::clear()
{
    beginResetModel();
    m_messages.clear();
    endResetModel();
}

void MessageModel::upsertMessage(const QJsonObject &object, bool insertIfMissing)
{
    const Message message = makeMessage(object);
    int row = indexOfId(message.id);
    if (row < 0 && !message.clientTempId.isEmpty())
        row = indexOfTempId(message.clientTempId);
    if (row >= 0) {
        m_messages[row] = message;
        emit dataChanged(index(row), index(row));
        return;
    }
    if (!insertIfMissing)
        return;
    const int end = static_cast<int>(m_messages.size());
    beginInsertRows({}, end, end);
    m_messages.append(message);
    endInsertRows();
}

void MessageModel::addPending(const QString &clientTempId, const QString &text)
{
    Message message;
    message.clientTempId = clientTempId;
    message.text = text;
    message.senderId = m_userId;
    message.createdAt = QDateTime::currentDateTime();
    message.pending = true;
    const int end = static_cast<int>(m_messages.size());
    beginInsertRows({}, end, end);
    m_messages.append(message);
    endInsertRows();
}

void MessageModel::markFailed(const QString &clientTempId)
{
    const int row = indexOfTempId(clientTempId);
    if (row < 0 || !m_messages.at(row).pending)
        return;
    m_messages[row].pending = false;
    m_messages[row].failed = true;
    emit dataChanged(index(row), index(row), {IsPendingRole, IsFailedRole});
}

void MessageModel::removeMessage(const QString &messageId)
{
    const int row = indexOfId(messageId);
    if (row < 0)
        return;
    beginRemoveRows({}, row, row);
    m_messages.removeAt(row);
    endRemoveRows();
    // The next message may need to show its sender now.
    if (row < m_messages.size())
        emit dataChanged(index(row), index(row), {ShowSenderRole});
}

QString MessageModel::oldestCreatedAt() const
{
    for (const Message &message : m_messages) {
        if (!message.createdAtRaw.isEmpty())
            return message.createdAtRaw;
    }
    return {};
}

QString MessageModel::lastServerMessageId() const
{
    for (auto it = m_messages.crbegin(); it != m_messages.crend(); ++it) {
        if (!it->id.isEmpty())
            return it->id;
    }
    return {};
}

MessageModel::Message MessageModel::makeMessage(const QJsonObject &object) const
{
    Message message;
    message.id = object.value(QStringLiteral("id")).toString();
    message.clientTempId = object.value(QStringLiteral("clientTempId")).toString();
    message.text = vera::messagePreview(object);
    // Channel posts: senderId is the channel, authorId is the real author.
    message.senderId = object.value(QStringLiteral("authorId")).toString(
        object.value(QStringLiteral("senderId")).toString());
    message.senderName = vera::userDisplayName(object.value(QStringLiteral("sender")).toObject());
    message.createdAtRaw = object.value(QStringLiteral("createdAt")).toString();
    message.createdAt = vera::parseServerTime(message.createdAtRaw);
    message.edited = object.value(QStringLiteral("isEdited")).toBool()
                  || !object.value(QStringLiteral("editedAt")).toString().isEmpty();
    return message;
}

int MessageModel::indexOfId(const QString &id) const
{
    if (id.isEmpty())
        return -1;
    for (int i = 0; i < m_messages.size(); ++i) {
        if (m_messages.at(i).id == id)
            return i;
    }
    return -1;
}

int MessageModel::indexOfTempId(const QString &tempId) const
{
    if (tempId.isEmpty())
        return -1;
    for (int i = 0; i < m_messages.size(); ++i) {
        if (m_messages.at(i).clientTempId == tempId)
            return i;
    }
    return -1;
}
