#pragma once

#include <QNetworkCookieJar>

// Cookie jar that keeps persistent cookies (refresh token, CSRF token,
// installation secret) between launches. On Windows the file is encrypted
// with DPAPI for the current user. Without the installation cookie the
// server would register a new device on every login.
class PersistentCookieJar : public QNetworkCookieJar
{
public:
    explicit PersistentCookieJar(const QString &filePath, QObject *parent = nullptr);

    bool setCookiesFromUrl(const QList<QNetworkCookie> &cookieList, const QUrl &url) override;

    // Value of the named cookie that would be sent to the given URL.
    QString cookieValue(const QUrl &url, const QByteArray &name) const;

private:
    void load();
    void save() const;

    QString m_filePath;
};
