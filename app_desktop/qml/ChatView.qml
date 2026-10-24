pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Vera

// Right column: messages of the open chat and the input field.
Rectangle {
    id: page

    required property AppController app

    color: "#eef1f5"

    Label {
        anchors.centerIn: parent
        visible: page.app.currentChatId === ""
        text: qsTr("Выберите чат")
        color: "#5f6368"
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 0
        visible: page.app.currentChatId !== ""

        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 52
            color: "white"
            Label {
                anchors { left: parent.left; right: parent.right; verticalCenter: parent.verticalCenter; margins: 16 }
                text: page.app.currentChatTitle
                font.bold: true
                font.pixelSize: 16
                elide: Text.ElideRight
                Accessible.role: Accessible.Heading
            }
        }

        ListView {
            id: messageList
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            spacing: 4
            topMargin: 8
            bottomMargin: 8
            model: page.app.messages
            ScrollBar.vertical: ScrollBar {}
            Accessible.name: qsTr("Сообщения")

            // Follow new messages only while the user is at the bottom.
            property bool stickToBottom: true

            onCountChanged: if (stickToBottom) Qt.callLater(positionViewAtEnd)
            onMovementEnded: stickToBottom = atYEnd

            header: Item {
                width: ListView.view.width
                height: page.app.loadingMessages || page.app.canLoadOlder ? 40 : 0
                BusyIndicator {
                    anchors.centerIn: parent
                    height: 28
                    visible: page.app.loadingMessages
                    running: visible
                }
                Button {
                    anchors.centerIn: parent
                    visible: !page.app.loadingMessages && page.app.canLoadOlder
                    flat: true
                    text: qsTr("Загрузить ранние сообщения")
                    onClicked: {
                        messageList.stickToBottom = false
                        page.app.loadOlderMessages()
                    }
                }
            }

            delegate: MessageBubble {
                width: ListView.view.width
            }
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: Math.min(input.implicitHeight, 140) + 20
            color: "white"

            RowLayout {
                anchors { fill: parent; margins: 10 }
                spacing: 8

                ScrollView {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    TextArea {
                        id: input
                        placeholderText: qsTr("Сообщение (Enter — отправить, Shift+Enter — новая строка)")
                        wrapMode: TextEdit.Wrap
                        Accessible.name: qsTr("Текст сообщения")
                        Keys.onReturnPressed: (event) => {
                            if (event.modifiers & Qt.ShiftModifier) {
                                event.accepted = false
                                return
                            }
                            page.send()
                        }
                        Keys.onEnterPressed: page.send()
                    }
                }
                Button {
                    text: qsTr("Отправить")
                    highlighted: true
                    enabled: input.text.trim() !== ""
                    onClicked: page.send()
                }
            }
        }
    }

    function send() {
        if (input.text.trim() === "")
            return
        messageList.stickToBottom = true
        page.app.sendMessage(input.text)
        input.clear()
    }

    Connections {
        target: page.app
        function onCurrentChatChanged() {
            if (page.app.currentChatId === "")
                return
            messageList.stickToBottom = true
            input.forceActiveFocus()
        }
    }
}
