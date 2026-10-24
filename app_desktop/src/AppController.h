#pragma once

#include "ApiClient.h"
#include "ChatListModel.h"
#include "MessageModel.h"
#include "SocketClient.h"

#include <QObject>
#include <QTimer>
#include <QtQml/qqmlregistration.h>

// Session, navigation state and realtime glue between the server and QML.
class AppController : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_UNCREATABLE("Created in main.cpp")

    Q_PROPERTY(State state READ state NOTIFY stateChanged)
    Q_PROPERTY(bool busy READ busy NOTIFY busyChanged)
    Q_PROPERTY(QString errorText READ errorText NOTIFY errorTextChanged)
    Q_PROPERTY(QString serverUrl READ serverUrl WRITE setServerUrl NOTIFY serverUrlChanged)
    Q_PROPERTY(QString userName READ userName NOTIFY userChanged)
    Q_PROPERTY(bool realtimeSupported READ realtimeSupported CONSTANT)
    Q_PROPERTY(bool realtimeConnected READ realtimeConnected NOTIFY realtimeConnectedChanged)
    Q_PROPERTY(QString currentChatId READ currentChatId NOTIFY currentChatChanged)
    Q_PROPERTY(QString currentChatTitle READ currentChatTitle NOTIFY currentChatChanged)
    Q_PROPERTY(bool loadingMessages READ loadingMessages NOTIFY loadingMessagesChanged)
    Q_PROPERTY(bool canLoadOlder READ canLoadOlder NOTIFY canLoadOlderChanged)
    Q_PROPERTY(ChatListModel *chats READ chats CONSTANT)
    Q_PROPERTY(MessageModel *messages READ messages CONSTANT)

public:
    enum State { Starting, LoggedOut, LoggedIn };
    Q_ENUM(State)

    explicit AppController(QObject *parent = nullptr);

    State state() const { return m_state; }
    bool busy() const { return m_busy; }
    QString errorText() const { return m_errorText; }
    QString serverUrl() const { return m_api.baseUrl().toString(); }
    void setServerUrl(const QString &url);
    QString userName() const { return m_userName; }
    bool realtimeSupported() const { return SocketClient::isSupported(); }
    bool realtimeConnected() const { return m_socket.isConnected(); }
    QString currentChatId() const { return m_currentChatId; }
    QString currentChatTitle() const { return m_chats.titleOf(m_currentChatId); }
    bool loadingMessages() const { return m_loadingMessages; }
    bool canLoadOlder() const { return m_canLoadOlder; }
    ChatListModel *chats() { return &m_chats; }
    MessageModel *messages() { return &m_messages; }

    // Restores the saved session (refresh cookie) or shows the login page.
    void start();

    Q_INVOKABLE void login(const QString &identifier, const QString &password);
    Q_INVOKABLE void registerAccount(const QString &username, const QString &password, const QString &email);
    Q_INVOKABLE void logout();
    Q_INVOKABLE void reloadChats();
    Q_INVOKABLE void openChat(const QString &chatId);
    Q_INVOKABLE void closeChat();
    Q_INVOKABLE void loadOlderMessages();
    Q_INVOKABLE void sendMessage(const QString &text);
    Q_INVOKABLE void clearError();

signals:
    void stateChanged();
    void busyChanged();
    void errorTextChanged();
    void serverUrlChanged();
    void userChanged();
    void realtimeConnectedChanged();
    void currentChatChanged();
    void loadingMessagesChanged();
    void canLoadOlderChanged();

private:
    void setState(State state);
    void setBusy(bool busy);
    void setError(const QString &text);
    void setLoadingMessages(bool loading);
    void setCanLoadOlder(bool canLoad);

    void handleAuthResponse(int status, const QJsonDocument &body, const QString &error);
    void loadCurrentUser();
    void applyUser(const QJsonObject &user);
    void enterSession();
    void resetSession();
    void loadMessages(const QString &chatId);
    void markChatRead();

    void connectSocket();
    void scheduleReconnect();
    void handleSocketEvent(const QString &name, const QJsonValue &payload);
    void handleNewMessage(const QJsonObject &message);

    ApiClient m_api;
    SocketClient m_socket;
    ChatListModel m_chats;
    MessageModel m_messages;
    QTimer m_reconnectTimer;

    State m_state = Starting;
    bool m_busy = false;
    QString m_errorText;
    QString m_userId;
    QString m_userName;
    QString m_currentChatId;
    bool m_loadingMessages = false;
    bool m_canLoadOlder = false;
    int m_reconnectAttempt = 0;
    bool m_socketRefreshTried = false;
    // Incremented on logout so that late replies for a previous session are dropped.
    quint64 m_generation = 0;
    // Incremented on every chat switch so that late message pages are dropped.
    quint64 m_chatGeneration = 0;
};
