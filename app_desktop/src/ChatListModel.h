#pragma once

#include <QAbstractListModel>
#include <QDateTime>
#include <QJsonArray>
#include <QJsonObject>
#include <QVector>
#include <QtQml/qqmlregistration.h>

// Chats from GET /api/chats, ordered like the server: pinned first,
// then chats with unread messages, then by latest activity.
class ChatListModel : public QAbstractListModel
{
    Q_OBJECT
    QML_ANONYMOUS
public:
    enum Role {
        IdRole = Qt::UserRole + 1,
        TitleRole,
        SubtitleRole,
        TimeRole,
        UnreadRole,
        TypeRole,
        AvatarLetterRole,
    };
    Q_ENUM(Role)

    explicit ChatListModel(QObject *parent = nullptr);

    int rowCount(const QModelIndex &parent = QModelIndex()) const override;
    QVariant data(const QModelIndex &index, int role) const override;
    QHash<int, QByteArray> roleNames() const override;

    void setCurrentUserId(const QString &userId) { m_userId = userId; }
    void setChats(const QJsonArray &chats);
    void clear();

    // chat:updated / chat:new payload: full chat object with members.
    void upsertChat(const QJsonObject &chat);
    void removeChat(const QString &chatId);
    // message:new payload. Returns false when the chat is not in the list.
    bool applyNewMessage(const QJsonObject &message, bool isOpenChat);
    void markRead(const QString &chatId);

    bool contains(const QString &chatId) const { return indexOf(chatId) >= 0; }
    QString titleOf(const QString &chatId) const;
    QString chatTypeOf(const QString &chatId) const;

private:
    struct Chat {
        QString id;
        QString type;
        QString title;
        QString preview;
        QDateTime activity;
        int unread = 0;
        bool pinned = false;
    };

    Chat makeChat(const QJsonObject &chat) const;
    int indexOf(const QString &chatId) const;
    void sortChats();
    static bool before(const Chat &a, const Chat &b);

    QVector<Chat> m_chats;
    QString m_userId;
};
