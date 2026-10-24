import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Vera

// Sign-in and registration form.
Item {
    id: page

    required property AppController app
    property bool registerMode: false

    function submit() {
        if (page.registerMode)
            page.app.registerAccount(nameField.text, passwordField.text, emailField.text)
        else
            page.app.login(nameField.text, passwordField.text)
    }

    Pane {
        anchors.centerIn: parent
        width: Math.min(380, parent.width - 40)
        padding: 28
        background: Rectangle { color: "white"; radius: 12; border.color: "#dcdfe4" }

        ColumnLayout {
            anchors.fill: parent
            spacing: 12

            Label {
                text: page.registerMode ? qsTr("Регистрация в Vera") : qsTr("Вход в Vera")
                font.pixelSize: 22
                font.bold: true
                Layout.alignment: Qt.AlignHCenter
                Accessible.role: Accessible.Heading
            }

            Label { text: qsTr("Сервер"); color: "#5f6368" }
            TextField {
                id: serverField
                Layout.fillWidth: true
                text: page.app.serverUrl
                placeholderText: "http://localhost:3000"
                inputMethodHints: Qt.ImhUrlCharactersOnly
                Accessible.name: qsTr("Адрес сервера")
                onEditingFinished: page.app.serverUrl = text
            }

            Label { text: page.registerMode ? qsTr("Ник") : qsTr("Ник или почта"); color: "#5f6368" }
            TextField {
                id: nameField
                Layout.fillWidth: true
                focus: true
                inputMethodHints: Qt.ImhNoAutoUppercase | Qt.ImhNoPredictiveText
                Accessible.name: page.registerMode ? qsTr("Ник") : qsTr("Ник или почта")
                onAccepted: passwordField.forceActiveFocus()
            }

            Label { visible: page.registerMode; text: qsTr("Почта (необязательно)"); color: "#5f6368" }
            TextField {
                id: emailField
                visible: page.registerMode
                Layout.fillWidth: true
                inputMethodHints: Qt.ImhEmailCharactersOnly
                Accessible.name: qsTr("Почта")
            }

            Label { text: qsTr("Пароль"); color: "#5f6368" }
            TextField {
                id: passwordField
                Layout.fillWidth: true
                echoMode: TextInput.Password
                placeholderText: page.registerMode ? qsTr("Не менее 12 символов") : ""
                Accessible.name: qsTr("Пароль")
                onAccepted: page.submit()
            }

            Label {
                visible: page.app.errorText !== ""
                text: page.app.errorText
                color: "#b3261e"
                wrapMode: Text.Wrap
                Layout.fillWidth: true
                Accessible.role: Accessible.AlertMessage
            }

            Button {
                Layout.fillWidth: true
                Layout.topMargin: 4
                text: page.registerMode ? qsTr("Создать аккаунт") : qsTr("Войти")
                enabled: !page.app.busy
                highlighted: true
                onClicked: {
                    page.app.serverUrl = serverField.text
                    page.submit()
                }
            }

            BusyIndicator {
                visible: page.app.busy
                running: visible
                Layout.alignment: Qt.AlignHCenter
                Layout.preferredHeight: 32
            }

            Button {
                Layout.alignment: Qt.AlignHCenter
                flat: true
                text: page.registerMode ? qsTr("Уже есть аккаунт? Войти") : qsTr("Нет аккаунта? Зарегистрироваться")
                onClicked: {
                    page.registerMode = !page.registerMode
                    page.app.clearError()
                }
            }
        }
    }
}
