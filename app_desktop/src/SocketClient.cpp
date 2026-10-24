#include "SocketClient.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLoggingCategory>

#include <utility>

#ifdef VERA_HAS_WEBSOCKETS
#  include <QWebSocket>
#endif

Q_LOGGING_CATEGORY(lcSocket, "vera.socket")

namespace {
constexpr int kHandshakeTimeoutMs = 20000;
}

SocketClient::SocketClient(QObject *parent)
    : QObject(parent)
{
    m_heartbeat.setSingleShot(true);
    connect(&m_heartbeat, &QTimer::timeout, this, [this]() {
        // No packet within pingInterval + pingTimeout: the connection is dead.
        qCWarning(lcSocket) << "heartbeat timeout";
#ifdef VERA_HAS_WEBSOCKETS
        if (m_socket)
            m_socket->abort();
#endif
    });
}

SocketClient::~SocketClient()
{
    close();
}

bool SocketClient::isSupported()
{
#ifdef VERA_HAS_WEBSOCKETS
    return true;
#else
    return false;
#endif
}

void SocketClient::open(const QUrl &serverUrl, const QString &token)
{
    close();
#ifdef VERA_HAS_WEBSOCKETS
    m_token = token;
    QUrl url = serverUrl;
    url.setScheme(serverUrl.scheme() == QLatin1String("https") ? QStringLiteral("wss") : QStringLiteral("ws"));
    url.setPath(QStringLiteral("/socket.io/"));
    url.setQuery(QStringLiteral("EIO=4&transport=websocket"));

    m_socket = new QWebSocket(QString(), QWebSocketProtocol::VersionLatest, this);
    connect(m_socket, &QWebSocket::textMessageReceived, this, &SocketClient::handleFrame);
    connect(m_socket, &QWebSocket::errorOccurred, this, [this](QAbstractSocket::SocketError) {
        if (m_socket)
            qCWarning(lcSocket) << "error:" << m_socket->errorString();
    });
    connect(m_socket, &QWebSocket::stateChanged, this, [this](QAbstractSocket::SocketState state) {
        if (state == QAbstractSocket::UnconnectedState)
            finish();
    });
    m_heartbeat.start(kHandshakeTimeoutMs);
    m_socket->open(url);
#else
    Q_UNUSED(serverUrl)
    Q_UNUSED(token)
#endif
}

void SocketClient::close()
{
    m_heartbeat.stop();
    m_connected = false;
#ifdef VERA_HAS_WEBSOCKETS
    if (!m_socket)
        return;
    QWebSocket *socket = std::exchange(m_socket, nullptr);
    socket->disconnect(this);
    socket->close();
    socket->deleteLater();
#endif
}

void SocketClient::finish()
{
#ifdef VERA_HAS_WEBSOCKETS
    if (!m_socket)
        return;
    m_heartbeat.stop();
    m_connected = false;
    m_socket->disconnect(this);
    m_socket->deleteLater();
    m_socket = nullptr;
    emit disconnected();
#endif
}

void SocketClient::restartHeartbeat()
{
    m_heartbeat.start(m_heartbeatTimeoutMs);
}

void SocketClient::sendFrame(const QString &frame)
{
#ifdef VERA_HAS_WEBSOCKETS
    if (m_socket)
        m_socket->sendTextMessage(frame);
#else
    Q_UNUSED(frame)
#endif
}

// Engine.IO v4 packet: one type digit followed by data.
void SocketClient::handleFrame(const QString &frame)
{
    if (frame.isEmpty())
        return;
    restartHeartbeat();
    switch (frame.at(0).unicode()) {
    case '0': { // OPEN {"sid","pingInterval","pingTimeout",...}
        const QJsonObject handshake = QJsonDocument::fromJson(frame.mid(1).toUtf8()).object();
        m_heartbeatTimeoutMs = handshake.value(QStringLiteral("pingInterval")).toInt(25000)
                             + handshake.value(QStringLiteral("pingTimeout")).toInt(20000);
        restartHeartbeat();
        // Socket.IO CONNECT to the default namespace; server reads handshake.auth.token.
        const QJsonObject auth{{QStringLiteral("token"), m_token}};
        sendFrame(QStringLiteral("40") + QString::fromUtf8(QJsonDocument(auth).toJson(QJsonDocument::Compact)));
        break;
    }
    case '1': // CLOSE
#ifdef VERA_HAS_WEBSOCKETS
        if (m_socket)
            m_socket->close();
#endif
        break;
    case '2': // PING -> PONG
        sendFrame(QStringLiteral("3"));
        break;
    case '4': // MESSAGE carries a Socket.IO packet
        handlePacket(QStringView(frame).mid(1));
        break;
    default: // PONG, UPGRADE, NOOP
        break;
    }
}

// Socket.IO v5 packet: <type>[<namespace>,][<ack id>][JSON].
void SocketClient::handlePacket(QStringView packet)
{
    if (packet.isEmpty())
        return;
    const char16_t type = packet.at(0).unicode();
    QStringView rest = packet.mid(1);
    if (rest.startsWith(u'/')) {
        const qsizetype comma = rest.indexOf(u',');
        if (comma < 0 || rest.left(comma) != u"/")
            return; // Only the default namespace is used.
        rest = rest.mid(comma + 1);
    }
    qsizetype digits = 0;
    while (digits < rest.size() && rest.at(digits).isDigit())
        ++digits;
    rest = rest.mid(digits);
    const QJsonDocument doc = QJsonDocument::fromJson(rest.toUtf8());

    switch (type) {
    case u'0': // CONNECT accepted
        m_connected = true;
        emit connected();
        break;
    case u'1': // DISCONNECT by server (e.g. logout on another device)
#ifdef VERA_HAS_WEBSOCKETS
        if (m_socket)
            m_socket->close();
#endif
        break;
    case u'2': { // EVENT ["name", payload]
        const QJsonArray args = doc.array();
        if (args.isEmpty() || !args.at(0).isString())
            return;
        emit eventReceived(args.at(0).toString(), args.size() > 1 ? args.at(1) : QJsonValue());
        break;
    }
    case u'4': { // CONNECT_ERROR {"message"}
        const QString message = doc.object().value(QStringLiteral("message")).toString();
        qCWarning(lcSocket) << "connect error:" << message;
#ifdef VERA_HAS_WEBSOCKETS
        if (m_socket)
            m_socket->close();
#endif
        emit connectError(message);
        break;
    }
    default: // ACK and binary packets are not used by this client.
        break;
    }
}
