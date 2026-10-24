#pragma once

#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QObject>
#include <QUrl>
#include <QUrlQuery>

#include <functional>
#include <vector>

class PersistentCookieJar;
class QNetworkRequest;

// REST client for Server/server.js.
// Auth scheme: short-lived access token (Bearer, 15 min) plus refresh token
// in an HttpOnly cookie. POST /api/auth/refresh needs the vera_csrf cookie
// value in the X-CSRF-Token header (double submit). On 401 the client
// refreshes once and repeats the request.
class ApiClient : public QObject
{
    Q_OBJECT
public:
    // status == 0 means no HTTP response (network error, timeout).
    using Callback = std::function<void(int status, const QJsonDocument &body, const QString &error)>;
    using RefreshCallback = std::function<void(bool ok)>;

    explicit ApiClient(QObject *parent = nullptr);

    QUrl baseUrl() const { return m_baseUrl; }
    void setBaseUrl(const QUrl &url) { m_baseUrl = url; }

    QString accessToken() const { return m_accessToken; }
    void setAccessToken(const QString &token) { m_accessToken = token; }

    bool hasRefreshCookie() const;

    void get(const QString &path, const QUrlQuery &query, Callback callback, bool allowRefresh = true);
    void post(const QString &path, const QJsonObject &body, Callback callback, bool allowRefresh = true);

    // Concurrent calls share one request.
    void refresh(RefreshCallback callback);

    static QString encodeSegment(const QString &segment);

signals:
    // The refresh token was rejected: the user has to sign in again.
    void sessionExpired();

private:
    void send(const QByteArray &verb, const QString &path, const QUrlQuery &query,
              const QByteArray &body, Callback callback, bool allowRefresh);
    QNetworkRequest makeRequest(const QString &path, const QUrlQuery &query, bool withBody) const;
    QString csrfToken() const;

    QNetworkAccessManager m_network;
    PersistentCookieJar *m_cookieJar = nullptr;
    QUrl m_baseUrl;
    QString m_accessToken;
    std::vector<RefreshCallback> m_refreshWaiters;
};
