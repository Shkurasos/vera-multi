#pragma once

#include <QAbstractListModel>
#include <QDateTime>
#include <QJsonArray>
#include <QJsonObject>
#include <QVector>
#include <QtQml/qqmlregistration.h>

// Messages of the open chat, oldest first (as GET /api/messages/:chatId returns them).
class MessageModel : public QAbstractListModel
{
    Q_OBJECT
    QML_ANONYMOUS
public:
    enum Role {
        IdRole = Qt::UserRole + 1,
        TextRole,
        SenderNameRole,
        IsMineRole,
        TimeRole,
        IsEditedRole,
        IsPendingRole,
        IsFailedRole,
        ShowSenderRole,
    };
    Q_ENUM(Role)

    explicit MessageModel(QObject *parent = nullptr);

    int rowCount(const QModelIndex &parent = QModelIndex()) const override;
    QVariant data(const QModelIndex &index, int role) const override;
    QHash<int, QByteArray> roleNames() const override;

    void setCurrentUserId(const QString &userId) { m_userId = userId; }
    void setGroupChat(bool group) { m_groupChat = group; }

    void setMessages(const QJsonArray &messages);
    // Older page from ?before=; inserted at the top.
    void prependMessages(const QJsonArray &messages);
    void clear();

    // Server message (REST answer or message:new). Replaces the pending
    // copy with the same clientTempId; duplicates by id are ignored.
    // With insertIfMissing == false only already loaded messages are updated
    // (message:edited may refer to a message outside the loaded page).
    void upsertMessage(const QJsonObject &message, bool insertIfMissing = true);
    void addPending(const QString &clientTempId, const QString &text);
    void markFailed(const QString &clientTempId);
    void removeMessage(const QString &messageId);

    QString oldestCreatedAt() const;
    QString lastServerMessageId() const;

private:
    struct Message {
        QString id;
        QString clientTempId;
        QString text;
        QString senderId;
        QString senderName;
        QString createdAtRaw;
        QDateTime createdAt;
        bool edited = false;
        bool pending = false;
        bool failed = false;
    };

    Message makeMessage(const QJsonObject &message) const;
    int indexOfId(const QString &id) const;
    int indexOfTempId(const QString &tempId) const;

    QVector<Message> m_messages;
    QString m_userId;
    bool m_groupChat = false;
};
