pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Vera

// Left column: account header and the chat list.
Rectangle {
    id: page

    required property AppController app

    color: "white"

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        RowLayout {
            Layout.fillWidth: true
            Layout.margins: 12
            spacing: 8

            ColumnLayout {
                Layout.fillWidth: true
                spacing: 2
                Label {
                    text: "@" + page.app.userName
                    font.bold: true
                    elide: Text.ElideRight
                    Layout.fillWidth: true
                }
                Label {
                    text: !page.app.realtimeSupported ? qsTr("Без realtime (нет Qt WebSockets)")
                        : page.app.realtimeConnected ? qsTr("В сети") : qsTr("Подключение…")
                    color: page.app.realtimeConnected ? "#1e8e3e" : "#5f6368"
                    font.pixelSize: 12
                }
            }
            ToolButton {
                text: "⟳"
                Accessible.name: qsTr("Обновить список чатов")
                ToolTip.visible: hovered
                ToolTip.text: Accessible.name
                onClicked: page.app.reloadChats()
            }
            ToolButton {
                text: qsTr("Выйти")
                onClicked: page.app.logout()
            }
        }

        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: "#dcdfe4" }

        ListView {
            id: list
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            model: page.app.chats
            keyNavigationEnabled: true
            activeFocusOnTab: true
            ScrollBar.vertical: ScrollBar {}
            Accessible.name: qsTr("Чаты")

            delegate: ItemDelegate {
                id: row

                required property string chatId
                required property string title
                required property string subtitle
                required property string time
                required property int unread
                required property string avatarLetter

                width: ListView.view.width
                height: 64
                highlighted: row.chatId === page.app.currentChatId
                Accessible.name: row.title + (row.unread > 0 ? qsTr(", непрочитанных: %1").arg(row.unread) : "")
                onClicked: page.app.openChat(row.chatId)

                contentItem: RowLayout {
                    spacing: 10
                    Rectangle {
                        Layout.preferredWidth: 42
                        Layout.preferredHeight: 42
                        radius: 21
                        color: "#3b6fd8"
                        Label {
                            anchors.centerIn: parent
                            text: row.avatarLetter
                            color: "white"
                            font.bold: true
                        }
                    }
                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 2
                        RowLayout {
                            Layout.fillWidth: true
                            Label {
                                text: row.title
                                font.bold: true
                                elide: Text.ElideRight
                                Layout.fillWidth: true
                            }
                            Label { text: row.time; color: "#5f6368"; font.pixelSize: 12 }
                        }
                        RowLayout {
                            Layout.fillWidth: true
                            Label {
                                text: row.subtitle
                                color: "#5f6368"
                                elide: Text.ElideRight
                                maximumLineCount: 1
                                Layout.fillWidth: true
                            }
                            Rectangle {
                                visible: row.unread > 0
                                Layout.preferredHeight: 20
                                Layout.preferredWidth: Math.max(20, badge.implicitWidth + 10)
                                radius: 10
                                color: "#3b6fd8"
                                Label {
                                    id: badge
                                    anchors.centerIn: parent
                                    text: row.unread > 99 ? "99+" : row.unread
                                    color: "white"
                                    font.pixelSize: 11
                                }
                            }
                        }
                    }
                }
            }

            Label {
                anchors.centerIn: parent
                visible: list.count === 0
                text: qsTr("Чатов пока нет")
                color: "#5f6368"
            }
        }
    }
}
