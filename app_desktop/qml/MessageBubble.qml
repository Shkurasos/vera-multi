import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// One message row. Own messages are aligned to the right.
Item {
    id: bubbleRow

    required property string text
    required property string senderName
    required property string time
    required property bool isMine
    required property bool isEdited
    required property bool isPending
    required property bool isFailed
    required property bool showSender

    readonly property real maxBubbleWidth: width * 0.7

    height: bubble.height

    Rectangle {
        id: bubble
        anchors.right: bubbleRow.isMine ? parent.right : undefined
        anchors.left: bubbleRow.isMine ? undefined : parent.left
        anchors.leftMargin: 16
        anchors.rightMargin: 16
        width: Math.min(content.implicitWidth, bubbleRow.maxBubbleWidth - 24) + 24
        height: content.implicitHeight + 16
        radius: 10
        color: bubbleRow.isFailed ? "#fce8e6" : (bubbleRow.isMine ? "#d3e3fd" : "white")
        opacity: bubbleRow.isPending ? 0.7 : 1
        Accessible.role: Accessible.StaticText
        Accessible.name: (bubbleRow.isMine ? qsTr("Вы") : bubbleRow.senderName) + ": " + bubbleRow.text

        ColumnLayout {
            id: content
            anchors { left: parent.left; top: parent.top; margins: 8; leftMargin: 12 }
            width: bubble.width - 24
            spacing: 2

            Label {
                visible: bubbleRow.showSender
                text: bubbleRow.senderName
                color: "#3b6fd8"
                font.bold: true
                font.pixelSize: 12
            }
            TextEdit {
                id: body
                // Read-only TextEdit allows selecting and copying text.
                text: bubbleRow.text
                readOnly: true
                selectByMouse: true
                textFormat: TextEdit.PlainText
                wrapMode: TextEdit.Wrap
                color: "#202124"
                font.pixelSize: 14
                Layout.fillWidth: true
                Layout.preferredWidth: Math.min(implicitWidth, bubbleRow.maxBubbleWidth - 24)
            }
            Label {
                Layout.alignment: Qt.AlignRight
                text: bubbleRow.isFailed ? qsTr("Не отправлено")
                    : bubbleRow.isPending ? qsTr("Отправка…")
                    : (bubbleRow.isEdited ? qsTr("изменено ") : "") + bubbleRow.time
                color: bubbleRow.isFailed ? "#b3261e" : "#5f6368"
                font.pixelSize: 11
            }
        }
    }
}
