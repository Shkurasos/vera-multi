#include "Formatting.h"

#include <QCoreApplication>
#include <QJsonArray>

namespace vera {

QString userDisplayName(const QJsonObject &user)
{
    const QString fullName = (user.value(QStringLiteral("firstName")).toString() + QLatin1Char(' ')
                              + user.value(QStringLiteral("lastName")).toString()).trimmed();
    if (!fullName.isEmpty())
        return fullName;
    return user.value(QStringLiteral("username")).toString();
}

QDateTime parseServerTime(const QString &iso)
{
    QDateTime time = QDateTime::fromString(iso, Qt::ISODateWithMs);
    if (!time.isValid())
        time = QDateTime::fromString(iso, Qt::ISODate);
    return time.isValid() ? time.toLocalTime() : QDateTime();
}

QString shortTime(const QDateTime &time)
{
    return time.isValid() ? time.toString(QStringLiteral("HH:mm")) : QString();
}

QString chatListTime(const QDateTime &time)
{
    if (!time.isValid())
        return {};
    if (time.date() == QDate::currentDate())
        return shortTime(time);
    return time.toString(QStringLiteral("dd.MM.yy"));
}

QString messagePreview(const QJsonObject &message)
{
    QString text = message.value(QStringLiteral("content")).toString();
    if (text.isEmpty())
        text = message.value(QStringLiteral("text")).toString();
    if (!text.isEmpty())
        return text;
    if (message.value(QStringLiteral("type")).toString() == QLatin1String("poll"))
        return QCoreApplication::translate("Formatting", "Опрос");
    if (!message.value(QStringLiteral("attachments")).toArray().isEmpty())
        return QCoreApplication::translate("Formatting", "Вложение");
    return QCoreApplication::translate("Formatting", "Сообщение");
}

} // namespace vera
