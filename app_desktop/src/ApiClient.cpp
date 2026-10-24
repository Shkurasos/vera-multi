#include "ApiClient.h"

#include "PersistentCookieJar.h"

#include <QDir>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QStandardPaths>

#include <utility>

namespace {

constexpr int kTransferTimeoutMs = 30000;
const QByteArray kRefreshCookie = QByteArrayLiteral("vera_refresh");
const QByteArray kCsrfCookie = QByteArrayLiteral("vera_csrf");

int httpStatus(QNetworkReply *reply)
{
    return reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
}

QString errorText(QNetworkReply *reply, int status, const QJsonDocument &body)
{
    if (status == 0)
        return ApiClient::tr("Нет связи с сервером: %1").arg(reply->errorString());
    const QString message = body.object().value(QStringLiteral("message")).toString();
    if (!message.isEmpty())
        return message;
    return ApiClient::tr("Ошибка сервера (HTTP %1)").arg(status);
}

} // namespace

ApiClient::ApiClient(QObject *parent)
    : QObject(parent)
{
    const QString dir = QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation);
    QDir().mkpath(dir);
    m_cookieJar = new PersistentCookieJar(dir + QStringLiteral("/session.dat"), &m_network);
    m_network.setCookieJar(m_cookieJar);
}

bool ApiClient::hasRefreshCookie() const
{
    return !m_cookieJar->cookieValue(m_baseUrl, kRefreshCookie).isEmpty();
}

void ApiClient::get(const QString &path, const QUrlQuery &query, Callback callback, bool allowRefresh)
{
    send(QByteArrayLiteral("GET"), path, query, {}, std::move(callback), allowRefresh);
}

void ApiClient::post(const QString &path, const QJsonObject &body, Callback callback, bool allowRefresh)
{
    send(QByteArrayLiteral("POST"), path, {}, QJsonDocument(body).toJson(QJsonDocument::Compact),
         std::move(callback), allowRefresh);
}

QString ApiClient::encodeSegment(const QString &segment)
{
    return QString::fromLatin1(QUrl::toPercentEncoding(segment));
}

void ApiClient::send(const QByteArray &verb, const QString &path, const QUrlQuery &query,
                     const QByteArray &body, Callback callback, bool allowRefresh)
{
    const bool withBody = verb != "GET";
    const QNetworkRequest request = makeRequest(path, query, withBody);
    QNetworkReply *reply = withBody ? m_network.sendCustomRequest(request, verb, body)
                                    : m_network.get(request);
    connect(reply, &QNetworkReply::finished, this,
            [this, reply, verb, path, query, body, callback = std::move(callback), allowRefresh]() {
        reply->deleteLater();
        const int status = httpStatus(reply);
        const QJsonDocument doc = QJsonDocument::fromJson(reply->readAll());
        if (status == 401 && allowRefresh && !m_accessToken.isEmpty()) {
            const QString error = errorText(reply, status, doc);
            refresh([this, verb, path, query, body, callback, doc, error](bool ok) {
                if (ok)
                    send(verb, path, query, body, callback, false);
                else
                    callback(401, doc, error);
            });
            return;
        }
        const bool success = status >= 200 && status < 300;
        callback(status, doc, success ? QString() : errorText(reply, status, doc));
    });
}

void ApiClient::refresh(RefreshCallback callback)
{
    m_refreshWaiters.push_back(std::move(callback));
    if (m_refreshWaiters.size() > 1)
        return; // A refresh is already in flight.

    const QNetworkRequest request = makeRequest(QStringLiteral("/api/auth/refresh"), {}, true);
    QNetworkReply *reply = m_network.post(request, QByteArrayLiteral("{}"));
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        reply->deleteLater();
        const int status = httpStatus(reply);
        const QString token = QJsonDocument::fromJson(reply->readAll())
                                  .object().value(QStringLiteral("accessToken")).toString();
        const bool ok = status == 200 && !token.isEmpty();
        if (ok)
            m_accessToken = token;
        const auto waiters = std::exchange(m_refreshWaiters, {});
        if (!ok && (status == 401 || status == 403)) {
            m_accessToken.clear();
            emit sessionExpired();
        }
        for (const RefreshCallback &waiter : waiters)
            waiter(ok);
    });
}

QNetworkRequest ApiClient::makeRequest(const QString &path, const QUrlQuery &query, bool withBody) const
{
    QUrl url = m_baseUrl.resolved(QUrl(path));
    if (!query.isEmpty())
        url.setQuery(query);
    QNetworkRequest request(url);
    request.setTransferTimeout(kTransferTimeoutMs);
    request.setRawHeader("Accept", "application/json");
    if (!m_accessToken.isEmpty())
        request.setRawHeader("Authorization", "Bearer " + m_accessToken.toUtf8());
    if (withBody) {
        request.setHeader(QNetworkRequest::ContentTypeHeader, QByteArrayLiteral("application/json"));
        const QString csrf = csrfToken();
        if (!csrf.isEmpty())
            request.setRawHeader("X-CSRF-Token", csrf.toUtf8());
    }
    return request;
}

QString ApiClient::csrfToken() const
{
    return m_cookieJar->cookieValue(m_baseUrl, kCsrfCookie);
}
