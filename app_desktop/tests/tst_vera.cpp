#include "ApiClient.h"
#include "ChatListModel.h"
#include "MessageModel.h"
#include "SocketClient.h"

#include <QJsonArray>
#include <QStandardPaths>
#include <QTest>
#include <QUuid>

namespace {

QJsonObject chatJson(const QString &id, const QString &type, const QString &name,
                     const QString &lastAt, int unread = 0)
{
    QJsonObject chat{
        {QStringLiteral("id"), id},
        {QStringLiteral("type"), type},
        {QStringLiteral("name"), name},
        {QStringLiteral("createdAt"), QStringLiteral("2026-01-01T00:00:00.000Z")},
        {QStringLiteral("unreadCount"), unread},
    };
    if (!lastAt.isEmpty()) {
        chat.insert(QStringLiteral("lastMessage"), QJsonObject{
            {QStringLiteral("content"), QStringLiteral("last in ") + name},
            {QStringLiteral("createdAt"), lastAt},
        });
    }
    return chat;
}

QString chatIdAt(const ChatListModel &model, int row)
{
    return model.data(model.index(row), ChatListModel::IdRole).toString();
}

QJsonObject msgJson(const QString &id, const QString &at)
{
    return QJsonObject{{QStringLiteral("id"), id}, {QStringLiteral("content"), id},
                       {QStringLiteral("createdAt"), at}};
}

// Result of an asynchronous ApiClient call.
struct Reply {
    bool done = false;
    int status = 0;
    QJsonDocument body;
    QString error;

    ApiClient::Callback callback()
    {
        return [this](int s, const QJsonDocument &b, const QString &e) {
            done = true; status = s; body = b; error = e;
        };
    }
};

} // namespace

class TestVera : public QObject
{
    Q_OBJECT

private slots:
    void initTestCase();

    void chatList_ordersLikeServer();
    void chatList_newMessageMovesChatUp();
    void chatList_directChatTitledAfterPeer();
    void messages_pendingReplacedByServerCopy();
    void messages_failedSendIsMarked();
    void messages_prependSkipsDuplicates();

    void server_registerRefreshAndRestoreSession();
    void server_socketReceivesMessageNew();

private:
    QUrl m_server;
};

void TestVera::initTestCase()
{
    // Keep the cookie file away from the real profile.
    QStandardPaths::setTestModeEnabled(true);
    QCoreApplication::setOrganizationName(QStringLiteral("VeraTest"));
    QCoreApplication::setApplicationName(QStringLiteral("tst_vera"));
    m_server = QUrl(qEnvironmentVariable("VERA_TEST_SERVER"));
}

void TestVera::chatList_ordersLikeServer()
{
    ChatListModel model;
    model.setCurrentUserId(QStringLiteral("me"));
    model.setChats(QJsonArray{
        chatJson(QStringLiteral("old"), QStringLiteral("group"), QStringLiteral("Old"), QStringLiteral("2026-01-02T10:00:00.000Z")),
        chatJson(QStringLiteral("new"), QStringLiteral("group"), QStringLiteral("New"), QStringLiteral("2026-01-03T10:00:00.000Z")),
        chatJson(QStringLiteral("unread"), QStringLiteral("group"), QStringLiteral("Unread"), QStringLiteral("2026-01-01T10:00:00.000Z"), 2),
    });
    QCOMPARE(model.rowCount(), 3);
    QCOMPARE(chatIdAt(model, 0), QStringLiteral("unread"));
    QCOMPARE(chatIdAt(model, 1), QStringLiteral("new"));
    QCOMPARE(chatIdAt(model, 2), QStringLiteral("old"));
}

void TestVera::chatList_newMessageMovesChatUp()
{
    ChatListModel model;
    model.setCurrentUserId(QStringLiteral("me"));
    model.setChats(QJsonArray{
        chatJson(QStringLiteral("a"), QStringLiteral("group"), QStringLiteral("A"), QStringLiteral("2026-01-03T10:00:00.000Z")),
        chatJson(QStringLiteral("b"), QStringLiteral("group"), QStringLiteral("B"), QStringLiteral("2026-01-02T10:00:00.000Z")),
    });
    const QJsonObject message{
        {QStringLiteral("chatId"), QStringLiteral("b")},
        {QStringLiteral("senderId"), QStringLiteral("peer")},
        {QStringLiteral("content"), QStringLiteral("hello")},
        {QStringLiteral("createdAt"), QStringLiteral("2026-01-04T10:00:00.000Z")},
    };
    QVERIFY(model.applyNewMessage(message, false));
    QCOMPARE(chatIdAt(model, 0), QStringLiteral("b"));
    QCOMPARE(model.data(model.index(0), ChatListModel::SubtitleRole).toString(), QStringLiteral("hello"));
    QCOMPARE(model.data(model.index(0), ChatListModel::UnreadRole).toInt(), 1);

    model.markRead(QStringLiteral("b"));
    QCOMPARE(model.data(model.index(0), ChatListModel::UnreadRole).toInt(), 0);

    QVERIFY(!model.applyNewMessage(QJsonObject{{QStringLiteral("chatId"), QStringLiteral("unknown")}}, false));
}

void TestVera::chatList_directChatTitledAfterPeer()
{
    ChatListModel model;
    model.setCurrentUserId(QStringLiteral("me"));
    QJsonObject chat = chatJson(QStringLiteral("d"), QStringLiteral("direct"), QString(), QString());
    chat.insert(QStringLiteral("members"), QJsonArray{
        QJsonObject{{QStringLiteral("userId"), QStringLiteral("me")},
                    {QStringLiteral("user"), QJsonObject{{QStringLiteral("username"), QStringLiteral("me_nick")}}}},
        QJsonObject{{QStringLiteral("userId"), QStringLiteral("peer")},
                    {QStringLiteral("user"), QJsonObject{{QStringLiteral("username"), QStringLiteral("peer_nick")},
                                                         {QStringLiteral("firstName"), QStringLiteral("Анна")}}}},
    });
    model.setChats(QJsonArray{chat});
    QCOMPARE(model.titleOf(QStringLiteral("d")), QStringLiteral("Анна"));
}

void TestVera::messages_pendingReplacedByServerCopy()
{
    MessageModel model;
    model.setCurrentUserId(QStringLiteral("me"));
    model.addPending(QStringLiteral("tmp-1"), QStringLiteral("hi"));
    QCOMPARE(model.rowCount(), 1);
    QVERIFY(model.data(model.index(0), MessageModel::IsPendingRole).toBool());
    QVERIFY(model.data(model.index(0), MessageModel::IsMineRole).toBool());

    const QJsonObject server{
        {QStringLiteral("id"), QStringLiteral("m1")},
        {QStringLiteral("clientTempId"), QStringLiteral("tmp-1")},
        {QStringLiteral("senderId"), QStringLiteral("me")},
        {QStringLiteral("content"), QStringLiteral("hi")},
        {QStringLiteral("createdAt"), QStringLiteral("2026-01-04T10:00:00.000Z")},
    };
    model.upsertMessage(server);
    QCOMPARE(model.rowCount(), 1);
    QVERIFY(!model.data(model.index(0), MessageModel::IsPendingRole).toBool());
    QCOMPARE(model.lastServerMessageId(), QStringLiteral("m1"));

    // The same message arriving again via message:new is not duplicated.
    model.upsertMessage(server);
    QCOMPARE(model.rowCount(), 1);

    // message:edited for a message that is not loaded is ignored.
    model.upsertMessage(QJsonObject{{QStringLiteral("id"), QStringLiteral("other")}}, false);
    QCOMPARE(model.rowCount(), 1);
}

void TestVera::messages_failedSendIsMarked()
{
    MessageModel model;
    model.addPending(QStringLiteral("tmp-2"), QStringLiteral("x"));
    model.markFailed(QStringLiteral("tmp-2"));
    QVERIFY(model.data(model.index(0), MessageModel::IsFailedRole).toBool());
    QVERIFY(!model.data(model.index(0), MessageModel::IsPendingRole).toBool());
}

void TestVera::messages_prependSkipsDuplicates()
{
    MessageModel model;
    model.setMessages(QJsonArray{msgJson(QStringLiteral("3"), QStringLiteral("2026-01-03T00:00:00.000Z"))});
    model.prependMessages(QJsonArray{msgJson(QStringLiteral("1"), QStringLiteral("2026-01-01T00:00:00.000Z")),
                                     msgJson(QStringLiteral("3"), QStringLiteral("2026-01-03T00:00:00.000Z"))});
    QCOMPARE(model.rowCount(), 2);
    QCOMPARE(model.data(model.index(0), MessageModel::IdRole).toString(), QStringLiteral("1"));
    QCOMPARE(model.oldestCreatedAt(), QStringLiteral("2026-01-01T00:00:00.000Z"));
}


// Full auth flow against a real server: register, forced refresh on 401
// (CSRF double submit), sending a message, restoring the session from the
// persisted cookie file and logout.
void TestVera::server_registerRefreshAndRestoreSession()
{
    if (!m_server.isValid() || m_server.isEmpty())
        QSKIP("Set VERA_TEST_SERVER=http://localhost:PORT to run against a server");

    const QString nick = QStringLiteral("qt_") + QUuid::createUuid().toString(QUuid::Id128).left(12);
    QString savedChatId;
    {
        ApiClient api;
        api.setBaseUrl(m_server);
        Reply reg;
        api.post(QStringLiteral("/api/auth/register"),
                 QJsonObject{{QStringLiteral("username"), nick},
                             {QStringLiteral("password"), QStringLiteral("correct-horse-battery")},
                             {QStringLiteral("deviceName"), QStringLiteral("tst_vera")}},
                 reg.callback(), false);
        QTRY_VERIFY_WITH_TIMEOUT(reg.done, 30000);
        QVERIFY2(reg.status == 200, qPrintable(reg.error));
        QVERIFY(!reg.body.object().value(QStringLiteral("accessToken")).toString().isEmpty());
        QVERIFY(api.hasRefreshCookie());

        // A broken token forces 401 -> /api/auth/refresh -> retry.
        api.setAccessToken(QStringLiteral("broken"));
        Reply chats;
        api.get(QStringLiteral("/api/chats"), {}, chats.callback());
        QTRY_VERIFY_WITH_TIMEOUT(chats.done, 15000);
        QVERIFY2(chats.status == 200, qPrintable(chats.error));
        QVERIFY(api.accessToken() != QLatin1String("broken"));
        // A new account has the "Избранное" chat.
        const QJsonArray list = chats.body.array();
        QCOMPARE(list.size(), 1);
        savedChatId = list.at(0).toObject().value(QStringLiteral("id")).toString();

        Reply sent;
        api.post(QStringLiteral("/api/messages/") + ApiClient::encodeSegment(savedChatId),
                 QJsonObject{{QStringLiteral("content"), QStringLiteral("Привет из Qt")},
                             {QStringLiteral("clientTempId"), QStringLiteral("tmp-qt")}},
                 sent.callback());
        QTRY_VERIFY_WITH_TIMEOUT(sent.done, 15000);
        QVERIFY2(sent.status == 201, qPrintable(sent.error));
        QCOMPARE(sent.body.object().value(QStringLiteral("clientTempId")).toString(), QStringLiteral("tmp-qt"));
    }

    // New client instance = app restart: the session comes from the cookie file.
    ApiClient restored;
    restored.setBaseUrl(m_server);
    QVERIFY(restored.hasRefreshCookie());
    bool refreshed = false;
    bool refreshDone = false;
    restored.refresh([&](bool ok) { refreshed = ok; refreshDone = true; });
    QTRY_VERIFY_WITH_TIMEOUT(refreshDone, 15000);
    QVERIFY(refreshed);

    Reply history;
    restored.get(QStringLiteral("/api/messages/") + ApiClient::encodeSegment(savedChatId), {}, history.callback());
    QTRY_VERIFY_WITH_TIMEOUT(history.done, 15000);
    QCOMPARE(history.status, 200);
    QCOMPARE(history.body.array().size(), 1);
    QCOMPARE(history.body.array().at(0).toObject().value(QStringLiteral("content")).toString(),
             QStringLiteral("Привет из Qt"));

    Reply logout;
    restored.post(QStringLiteral("/api/auth/logout"), {}, logout.callback());
    QTRY_VERIFY_WITH_TIMEOUT(logout.done, 15000);
    QCOMPARE(logout.status, 200);
    QVERIFY(!restored.hasRefreshCookie());
}

// Realtime: a bad token is rejected at the handshake; with a valid token the
// socket joins the user's chat rooms and receives message:new for a message
// sent over REST.
void TestVera::server_socketReceivesMessageNew()
{
    if (!m_server.isValid() || m_server.isEmpty())
        QSKIP("Set VERA_TEST_SERVER=http://localhost:PORT to run against a server");
    if (!SocketClient::isSupported())
        QSKIP("Built without Qt WebSockets");

    {
        SocketClient bad;
        QString rejected;
        connect(&bad, &SocketClient::connectError, this, [&](const QString &m) { rejected = m; });
        bad.open(m_server, QStringLiteral("not-a-jwt"));
        QTRY_VERIFY_WITH_TIMEOUT(!rejected.isEmpty(), 15000);
        QVERIFY(!bad.isConnected());
    }

    ApiClient api;
    api.setBaseUrl(m_server);
    Reply reg;
    api.post(QStringLiteral("/api/auth/register"),
             QJsonObject{{QStringLiteral("username"),
                          QStringLiteral("qs_") + QUuid::createUuid().toString(QUuid::Id128).left(12)},
                         {QStringLiteral("password"), QStringLiteral("correct-horse-battery")},
                         {QStringLiteral("deviceName"), QStringLiteral("tst_vera")}},
             reg.callback(), false);
    QTRY_VERIFY_WITH_TIMEOUT(reg.done, 30000);
    QVERIFY2(reg.status == 200, qPrintable(reg.error));
    api.setAccessToken(reg.body.object().value(QStringLiteral("accessToken")).toString());

    Reply chats;
    api.get(QStringLiteral("/api/chats"), {}, chats.callback());
    QTRY_VERIFY_WITH_TIMEOUT(chats.done, 15000);
    QCOMPARE(chats.status, 200);
    const QString chatId = chats.body.array().at(0).toObject().value(QStringLiteral("id")).toString();
    QVERIFY(!chatId.isEmpty());

    SocketClient socket;
    QJsonObject received;
    connect(&socket, &SocketClient::eventReceived, this, [&](const QString &name, const QJsonValue &payload) {
        if (name == QLatin1String("message:new"))
            received = payload.toObject();
    });
    socket.open(m_server, api.accessToken());
    QTRY_VERIFY_WITH_TIMEOUT(socket.isConnected(), 15000);

    Reply sent;
    api.post(QStringLiteral("/api/messages/") + ApiClient::encodeSegment(chatId),
             QJsonObject{{QStringLiteral("content"), QStringLiteral("realtime")},
                         {QStringLiteral("clientTempId"), QStringLiteral("tmp-rt")}},
             sent.callback());
    QTRY_VERIFY_WITH_TIMEOUT(sent.done, 15000);
    QCOMPARE(sent.status, 201);

    QTRY_VERIFY_WITH_TIMEOUT(!received.isEmpty(), 15000);
    QCOMPARE(received.value(QStringLiteral("chatId")).toString(), chatId);
    QCOMPARE(received.value(QStringLiteral("content")).toString(), QStringLiteral("realtime"));
    socket.close();
}

QTEST_GUILESS_MAIN(TestVera)
#include "tst_vera.moc"

