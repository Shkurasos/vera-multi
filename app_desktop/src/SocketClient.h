#pragma once

#include <QJsonValue>
#include <QObject>
#include <QStringView>
#include <QTimer>
#include <QUrl>

class QWebSocket;

// Minimal Socket.IO v5 (Engine.IO v4) client over the WebSocket transport.
// Supports connecting to the default namespace with an auth token,
// heartbeat (server PING -> client PONG) and receiving events.
// Messages are sent over REST, so emitting events is not needed yet.
class SocketClient : public QObject
{
    Q_OBJECT
public:
    explicit SocketClient(QObject *parent = nullptr);
    ~SocketClient() override;

    // False when the app was built without Qt WebSockets.
    static bool isSupported();

    bool isConnected() const { return m_connected; }

    void open(const QUrl &serverUrl, const QString &token);
    // Intentional close: does not emit disconnected().
    void close();

signals:
    void connected();
    // Emitted when an open connection or a connection attempt ends.
    void disconnected();
    // Server rejected the handshake (e.g. "Invalid token: jwt expired").
    void connectError(const QString &message);
    void eventReceived(const QString &name, const QJsonValue &payload);

private:
    void handleFrame(const QString &frame);
    void handlePacket(QStringView packet);
    void sendFrame(const QString &frame);
    void finish();
    void restartHeartbeat();

    QWebSocket *m_socket = nullptr;
    QTimer m_heartbeat;
    QString m_token;
    int m_heartbeatTimeoutMs = 45000;
    bool m_connected = false;
};
