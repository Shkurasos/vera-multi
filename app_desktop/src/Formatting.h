#pragma once

#include <QDateTime>
#include <QJsonObject>
#include <QString>

namespace vera {

// "Имя Фамилия", falling back to the username.
QString userDisplayName(const QJsonObject &user);

// Server timestamps are ISO 8601 in UTC; returns local time.
QDateTime parseServerTime(const QString &iso);

// "HH:mm".
QString shortTime(const QDateTime &time);

// "HH:mm" for today, "dd.MM.yy" otherwise.
QString chatListTime(const QDateTime &time);

// Message text or a placeholder for attachments and polls.
QString messagePreview(const QJsonObject &message);

} // namespace vera
