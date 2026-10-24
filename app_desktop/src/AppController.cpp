#include "AppController.h"

#include <QJsonArray>
#include <QLoggingCategory>
#include <QRegularExpression>
#include <QSettings>
#include <QUrlQuery>
#include <QUuid>

#include <algorithm>

Q_LOGGING_CATEGORY(lcApp, "vera.app")

namespace {

constexpr int kPageSize = 50;
const QString kDeviceName = QStringLiteral("Vera Desktop (Windows)");
const QString kDefaultServer = QStringLiteral("http://localhost:3000");

QString settingsServerUrl()
{
    return QSettings().value(QStringLiteral("serverUrl"), kDefaultServer).toString();
}

} // namespace

AppController::AppController(QObject *parent)
    : QObject(parent)
{
    m_api.setBaseUrl(QUrl(settingsServerUrl()));

    m_reconnectTimer.setSingleShot(true);
    connect(&m_reconnectTimer, &QTimer::timeout, this, &AppController::connectSocket);

    connect(&m_api, &ApiClient::sessionExpired, this, [this]() {
        if (m_state != LoggedIn)
            return;
        resetSession();
        setError(tr("Сессия истекла. Войдите снова."));
    });

    connect(&m_socket, &SocketClient::connected, this, [this]() {
        qCInfo(lcApp) << "realtime connected";
        m_reconnectAttempt = 0;
        m_socketRefreshTried = false;
        emit realtimeConnectedChanged();
        // Catch up on events missed while offline.
        reloadChats();
        if (!m_currentChatId.isEmpty())
            loadMessages(m_currentChatId);
    });
    connect(&m_socket, &SocketClient::disconnected, this, [this]() {
        emit realtimeConnectedChanged();
        scheduleReconnect();
    });
    connect(&m_socket, &SocketClient::connectError, this, [this](const QString &message) {
        // The access token lives 15 minutes; the socket checks it only at handshake.
        if (!message.startsWith(QLatin1String("Invalid token")) || m_socketRefreshTried)
            return;
        m_socketRefreshTried = true;
        m_api.refresh([](bool) {});
    });
    connect(&m_socket, &SocketClient::eventReceived, this, &AppController::handleSocketEvent);
}

void AppController::setServerUrl(const QString &url)
{
    const QString trimmed = url.trimmed();
    if (m_state == LoggedIn || trimmed == serverUrl())
        return;
    const QUrl parsed = QUrl::fromUserInput(trimmed);
    if (!parsed.isValid() || (parsed.scheme() != QLatin1String("http") && parsed.scheme() != QLatin1String("https")))
        return;
    m_api.setBaseUrl(parsed);
    QSettings().setValue(QStringLiteral("serverUrl"), parsed.toString());
    emit serverUrlChanged();
}

void AppController::start()
{
    if (!m_api.hasRefreshCookie()) {
        setState(LoggedOut);
        return;
    }
    // Saved session: get a fresh access token from the refresh cookie.
    m_api.refresh([this](bool ok) {
        if (ok)
            loadCurrentUser();
        else
            setState(LoggedOut);
    });
}

void AppController::login(const QString &identifier, const QString &password)
{
    if (m_busy)
        return;
    clearError();
    if (identifier.trimmed().isEmpty() || password.isEmpty()) {
        setError(tr("Введите ник и пароль"));
        return;
    }
    setBusy(true);
    const QJsonObject body{
        {QStringLiteral("identifier"), identifier.trimmed()},
        {QStringLiteral("password"), password},
        {QStringLiteral("deviceName"), kDeviceName},
    };
    m_api.post(QStringLiteral("/api/auth/login"), body,
               [this](int status, const QJsonDocument &doc, const QString &error) {
        handleAuthResponse(status, doc, error);
    }, false);
}

void AppController::registerAccount(const QString &username, const QString &password, const QString &email)
{
    if (m_busy)
        return;
    clearError();
    // Same rules as POST /api/auth/register.
    static const QRegularExpression nickRe(QStringLiteral("^[a-zA-Z0-9_.]{3,32}$"));
    QString nick = username.trimmed();
    while (nick.startsWith(QLatin1Char('@')))
        nick.remove(0, 1);
    if (!nickRe.match(nick).hasMatch()) {
        setError(tr("Ник: 3–32 символа, латиница, цифры, _ и ."));
        return;
    }
    if (password.size() < 12) {
        setError(tr("Пароль должен содержать не менее 12 символов"));
        return;
    }
    setBusy(true);
    QJsonObject body{
        {QStringLiteral("username"), nick},
        {QStringLiteral("password"), password},
        {QStringLiteral("deviceName"), kDeviceName},
    };
    if (!email.trimmed().isEmpty())
        body.insert(QStringLiteral("email"), email.trimmed());
    m_api.post(QStringLiteral("/api/auth/register"), body,
               [this](int status, const QJsonDocument &doc, const QString &error) {
        handleAuthResponse(status, doc, error);
    }, false);
}

void AppController::handleAuthResponse(int status, const QJsonDocument &body, const QString &error)
{
    setBusy(false);
    const QString token = body.object().value(QStringLiteral("accessToken")).toString();
    if (status < 200 || status >= 300 || token.isEmpty()) {
        setError(error.isEmpty() ? tr("Не удалось войти") : error);
        return;
    }
    m_api.setAccessToken(token);
    applyUser(body.object().value(QStringLiteral("user")).toObject());
    enterSession();
}

void AppController::loadCurrentUser()
{
    m_api.get(QStringLiteral("/api/auth/me"), {},
              [this](int status, const QJsonDocument &doc, const QString &error) {
        if (status == 200) {
            applyUser(doc.object());
            enterSession();
            return;
        }
        setState(LoggedOut);
        if (status != 401)
            setError(error);
    });
}

void AppController::applyUser(const QJsonObject &user)
{
    m_userId = user.value(QStringLiteral("id")).toString();
    m_userName = user.value(QStringLiteral("username")).toString();
    m_chats.setCurrentUserId(m_userId);
    m_messages.setCurrentUserId(m_userId);
    emit userChanged();
}

void AppController::enterSession()
{
    setState(LoggedIn);
    reloadChats();
    connectSocket();
}

void AppController::logout()
{
    if (m_state != LoggedIn)
        return;
    // Fire and forget: the server revokes the refresh token and clears cookies.
    m_api.post(QStringLiteral("/api/auth/logout"), {}, [](int, const QJsonDocument &, const QString &) {}, false);
    resetSession();
}

void AppController::resetSession()
{
    ++m_generation;
    ++m_chatGeneration;
    m_reconnectTimer.stop();
    m_socket.close();
    m_api.setAccessToken({});
    m_chats.clear();
    m_messages.clear();
    m_currentChatId.clear();
    m_userId.clear();
    m_userName.clear();
    setLoadingMessages(false);
    setCanLoadOlder(false);
    emit currentChatChanged();
    emit userChanged();
    emit realtimeConnectedChanged();
    setState(LoggedOut);
}

void AppController::reloadChats()
{
    if (m_state != LoggedIn)
        return;
    const quint64 generation = m_generation;
    m_api.get(QStringLiteral("/api/chats"), {},
              [this, generation](int status, const QJsonDocument &doc, const QString &error) {
        if (generation != m_generation)
            return;
        if (status != 200) {
            setError(error);
            return;
        }
        m_chats.setChats(doc.array());
        if (!m_currentChatId.isEmpty())
            m_chats.markRead(m_currentChatId);
        emit currentChatChanged(); // The title may have changed.
    });
}

void AppController::openChat(const QString &chatId)
{
    if (m_state != LoggedIn || chatId.isEmpty() || chatId == m_currentChatId)
        return;
    ++m_chatGeneration;
    m_currentChatId = chatId;
    m_messages.clear();
    setCanLoadOlder(false);
    emit currentChatChanged();
    loadMessages(chatId);
}

void AppController::closeChat()
{
    if (m_currentChatId.isEmpty())
        return;
    ++m_chatGeneration;
    m_currentChatId.clear();
    m_messages.clear();
    setLoadingMessages(false);
    setCanLoadOlder(false);
    emit currentChatChanged();
}

void AppController::loadMessages(const QString &chatId)
{
    const quint64 chatGeneration = m_chatGeneration;
    setLoadingMessages(true);
    QUrlQuery query;
    query.addQueryItem(QStringLiteral("limit"), QString::number(kPageSize));
    m_api.get(QStringLiteral("/api/messages/") + ApiClient::encodeSegment(chatId), query,
              [this, chatGeneration](int status, const QJsonDocument &doc, const QString &error) {
        if (chatGeneration != m_chatGeneration)
            return;
        setLoadingMessages(false);
        if (status != 200) {
            setError(error);
            return;
        }
        const QJsonArray page = doc.array();
        m_messages.setGroupChat(m_chats.chatTypeOf(m_currentChatId) != QLatin1String("direct"));
        m_messages.setMessages(page);
        setCanLoadOlder(page.size() >= kPageSize);
        markChatRead();
    });
}

void AppController::loadOlderMessages()
{
    if (m_currentChatId.isEmpty() || m_loadingMessages || !m_canLoadOlder)
        return;
    const QString before = m_messages.oldestCreatedAt();
    if (before.isEmpty())
        return;
    const quint64 chatGeneration = m_chatGeneration;
    setLoadingMessages(true);
    QUrlQuery query;
    query.addQueryItem(QStringLiteral("limit"), QString::number(kPageSize));
    query.addQueryItem(QStringLiteral("before"), before);
    m_api.get(QStringLiteral("/api/messages/") + ApiClient::encodeSegment(m_currentChatId), query,
              [this, chatGeneration](int status, const QJsonDocument &doc, const QString &error) {
        if (chatGeneration != m_chatGeneration)
            return;
        setLoadingMessages(false);
        if (status != 200) {
            setError(error);
            return;
        }
        const QJsonArray page = doc.array();
        m_messages.prependMessages(page);
        setCanLoadOlder(page.size() >= kPageSize);
    });
}

void AppController::sendMessage(const QString &text)
{
    const QString content = text.trimmed();
    if (m_currentChatId.isEmpty() || content.isEmpty())
        return;
    if (content.size() > 10000) { // MESSAGE_MAX_LEN on the server
        setError(tr("Сообщение слишком длинное"));
        return;
    }
    // clientTempId lets the server drop duplicates and lets us match the reply.
    const QString tempId = QUuid::createUuid().toString(QUuid::WithoutBraces);
    const QString chatId = m_currentChatId;
    const quint64 chatGeneration = m_chatGeneration;
    m_messages.addPending(tempId, content);
    const QJsonObject body{
        {QStringLiteral("content"), content},
        {QStringLiteral("type"), QStringLiteral("text")},
        {QStringLiteral("clientTempId"), tempId},
    };
    m_api.post(QStringLiteral("/api/messages/") + ApiClient::encodeSegment(chatId), body,
               [this, tempId, chatGeneration](int status, const QJsonDocument &doc, const QString &error) {
        const bool success = status >= 200 && status < 300;
        if (success)
            m_chats.applyNewMessage(doc.object(), true);
        if (chatGeneration != m_chatGeneration)
            return;
        if (success) {
            m_messages.upsertMessage(doc.object());
        } else {
            m_messages.markFailed(tempId);
            setError(error);
        }
    });
}

void AppController::markChatRead()
{
    const QString lastId = m_messages.lastServerMessageId();
    if (m_currentChatId.isEmpty() || lastId.isEmpty())
        return;
    m_chats.markRead(m_currentChatId);
    // Marks this message and everything before it as read.
    m_api.post(QStringLiteral("/api/messages/") + ApiClient::encodeSegment(lastId) + QStringLiteral("/read"), {},
               [](int, const QJsonDocument &, const QString &) {});
}


void AppController::connectSocket()
{
    if (m_state != LoggedIn || !SocketClient::isSupported() || m_api.accessToken().isEmpty())
        return;
    m_socket.open(m_api.baseUrl(), m_api.accessToken());
}

void AppController::scheduleReconnect()
{
    if (m_state != LoggedIn || m_reconnectTimer.isActive())
        return;
    // 1, 2, 4, 8, 16, 30, 30... seconds.
    const int delay = std::min(1000 << std::min(m_reconnectAttempt, 5), 30000);
    ++m_reconnectAttempt;
    m_reconnectTimer.start(delay);
}

void AppController::handleSocketEvent(const QString &name, const QJsonValue &payload)
{
    const QJsonObject data = payload.toObject();
    if (name == QLatin1String("message:new")) {
        handleNewMessage(data);
    } else if (name == QLatin1String("message:edited")) {
        if (data.value(QStringLiteral("chatId")).toString() == m_currentChatId)
            m_messages.upsertMessage(data, false);
    } else if (name == QLatin1String("message:deleted")) {
        if (data.value(QStringLiteral("chatId")).toString() == m_currentChatId)
            m_messages.removeMessage(data.value(QStringLiteral("id")).toString());
    } else if (name == QLatin1String("chat:new") || name == QLatin1String("chat:updated")) {
        m_chats.upsertChat(data);
        if (data.value(QStringLiteral("id")).toString() == m_currentChatId)
            emit currentChatChanged();
    } else if (name == QLatin1String("chat:deleted")) {
        const QString chatId = data.value(QStringLiteral("chatId")).toString();
        if (chatId == m_currentChatId)
            closeChat();
        m_chats.removeChat(chatId);
    }
}

void AppController::handleNewMessage(const QJsonObject &message)
{
    const QString chatId = message.value(QStringLiteral("chatId")).toString();
    const bool isOpen = !chatId.isEmpty() && chatId == m_currentChatId;
    if (!m_chats.applyNewMessage(message, isOpen)) {
        // A chat we do not know yet (someone has just written to us).
        reloadChats();
        return;
    }
    if (!isOpen)
        return;
    m_messages.upsertMessage(message);
    const QString senderId = message.value(QStringLiteral("authorId")).toString(
        message.value(QStringLiteral("senderId")).toString());
    if (senderId != m_userId)
        markChatRead();
}

void AppController::clearError()
{
    setError({});
}

void AppController::setState(State state)
{
    if (m_state == state)
        return;
    m_state = state;
    emit stateChanged();
}

void AppController::setBusy(bool busy)
{
    if (m_busy == busy)
        return;
    m_busy = busy;
    emit busyChanged();
}

void AppController::setError(const QString &text)
{
    if (m_errorText == text)
        return;
    m_errorText = text;
    emit errorTextChanged();
}

void AppController::setLoadingMessages(bool loading)
{
    if (m_loadingMessages == loading)
        return;
    m_loadingMessages = loading;
    emit loadingMessagesChanged();
}

void AppController::setCanLoadOlder(bool canLoad)
{
    if (m_canLoadOlder == canLoad)
        return;
    m_canLoadOlder = canLoad;
    emit canLoadOlderChanged();
}

