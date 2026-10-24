pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Vera

ApplicationWindow {
    id: window

    required property AppController app

    width: 1000
    height: 680
    minimumWidth: 720
    minimumHeight: 480
    visible: true
    title: qsTr("Vera")
    color: "#f4f5f7"

    Loader {
        anchors.fill: parent
        sourceComponent: {
            switch (window.app.state) {
            case AppController.LoggedIn: return mainComponent
            case AppController.LoggedOut: return loginComponent
            default: return startingComponent
            }
        }
    }

    Component {
        id: startingComponent
        BusyIndicator {
            running: true
            Accessible.name: qsTr("Загрузка")
        }
    }

    Component {
        id: loginComponent
        LoginPage { app: window.app }
    }

    Component {
        id: mainComponent
        RowLayout {
            spacing: 0
            ChatListPage {
                app: window.app
                Layout.preferredWidth: 320
                Layout.fillHeight: true
            }
            Rectangle {
                Layout.preferredWidth: 1
                Layout.fillHeight: true
                color: "#dcdfe4"
            }
            ChatView {
                app: window.app
                Layout.fillWidth: true
                Layout.fillHeight: true
            }
        }
    }

    // Errors after login (network, send failures).
    Rectangle {
        visible: window.app.state === AppController.LoggedIn && window.app.errorText !== ""
        anchors { horizontalCenter: parent.horizontalCenter; bottom: parent.bottom; bottomMargin: 80 }
        width: Math.min(errorLabel.implicitWidth + 48, parent.width - 40)
        height: errorLabel.implicitHeight + 20
        radius: 8
        color: "#b3261e"

        Label {
            id: errorLabel
            anchors { left: parent.left; right: closeError.left; verticalCenter: parent.verticalCenter; leftMargin: 12 }
            text: window.app.errorText
            color: "white"
            wrapMode: Text.Wrap
        }
        ToolButton {
            id: closeError
            anchors { right: parent.right; verticalCenter: parent.verticalCenter }
            text: "✕"
            palette.buttonText: "white"
            Accessible.name: qsTr("Закрыть сообщение об ошибке")
            onClicked: window.app.clearError()
        }
    }
}
