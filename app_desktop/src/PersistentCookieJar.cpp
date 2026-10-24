#include "PersistentCookieJar.h"

#include <QDateTime>
#include <QFile>
#include <QNetworkCookie>
#include <QSaveFile>
#include <QUrl>

#ifdef Q_OS_WIN
#  ifndef NOMINMAX
#    define NOMINMAX
#  endif
#  include <windows.h>
#  include <wincrypt.h>
#endif

namespace {

#ifdef Q_OS_WIN
QByteArray runDpapi(const QByteArray &input, bool protect)
{
    DATA_BLOB in{static_cast<DWORD>(input.size()),
                 reinterpret_cast<BYTE *>(const_cast<char *>(input.constData()))};
    DATA_BLOB out{};
    const BOOL ok = protect
        ? CryptProtectData(&in, L"Vera session", nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &out)
        : CryptUnprotectData(&in, nullptr, nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &out);
    if (!ok)
        return {};
    QByteArray result(reinterpret_cast<const char *>(out.pbData), static_cast<qsizetype>(out.cbData));
    LocalFree(out.pbData);
    return result;
}
#endif

QByteArray protectData(const QByteArray &plain)
{
#ifdef Q_OS_WIN
    return runDpapi(plain, true);
#else
    return plain;
#endif
}

QByteArray unprotectData(const QByteArray &stored)
{
#ifdef Q_OS_WIN
    return runDpapi(stored, false);
#else
    return stored;
#endif
}

bool isPersistent(const QNetworkCookie &cookie, const QDateTime &now)
{
    return !cookie.isSessionCookie() && cookie.expirationDate() > now;
}

} // namespace

PersistentCookieJar::PersistentCookieJar(const QString &filePath, QObject *parent)
    : QNetworkCookieJar(parent)
    , m_filePath(filePath)
{
    load();
}

bool PersistentCookieJar::setCookiesFromUrl(const QList<QNetworkCookie> &cookieList, const QUrl &url)
{
    const bool changed = QNetworkCookieJar::setCookiesFromUrl(cookieList, url);
    save();
    return changed;
}

QString PersistentCookieJar::cookieValue(const QUrl &url, const QByteArray &name) const
{
    const QList<QNetworkCookie> cookies = cookiesForUrl(url);
    for (const QNetworkCookie &cookie : cookies) {
        if (cookie.name() == name)
            return QUrl::fromPercentEncoding(cookie.value());
    }
    return {};
}

void PersistentCookieJar::load()
{
    QFile file(m_filePath);
    if (!file.open(QIODevice::ReadOnly))
        return;
    const QByteArray plain = unprotectData(file.readAll());
    const QDateTime now = QDateTime::currentDateTimeUtc();
    QList<QNetworkCookie> cookies;
    // Line format: "<domain>\t<Set-Cookie raw form>". The domain is stored
    // separately because parsing adds a leading dot, which would turn a
    // host-only cookie into a domain cookie and duplicate it on the next update.
    for (const QByteArray &line : plain.split('\n')) {
        const qsizetype tab = line.indexOf('\t');
        if (tab <= 0)
            continue;
        const QString domain = QString::fromUtf8(line.left(tab));
        const QList<QNetworkCookie> parsed = QNetworkCookie::parseCookies(line.mid(tab + 1));
        for (QNetworkCookie cookie : parsed) {
            cookie.setDomain(domain);
            if (isPersistent(cookie, now))
                cookies.append(cookie);
        }
    }
    setAllCookies(cookies);
}

void PersistentCookieJar::save() const
{
    const QDateTime now = QDateTime::currentDateTimeUtc();
    QByteArray plain;
    const QList<QNetworkCookie> cookies = allCookies();
    for (const QNetworkCookie &cookie : cookies) {
        if (!isPersistent(cookie, now))
            continue;
        plain += cookie.domain().toUtf8() + '\t' + cookie.toRawForm(QNetworkCookie::Full) + '\n';
    }
    if (plain.isEmpty()) {
        QFile::remove(m_filePath);
        return;
    }
    const QByteArray data = protectData(plain);
    if (data.isEmpty())
        return; // Encryption failed: never write the tokens in clear text.
    QSaveFile file(m_filePath);
    if (!file.open(QIODevice::WriteOnly))
        return;
    file.write(data);
    file.commit();
}
