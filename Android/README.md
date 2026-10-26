# VERA Multi — Android

WebView wrapper around the web client. Default server: `http://localhost:3000`
(the server on your PC, while there is no hosting).

## Connecting to the local server

On the phone, `localhost` is the phone itself, so forward the port over USB
(with USB debugging enabled):

```powershell
cd Server; npm start
E:\AndroidSDK\platform-tools\adb.exe reverse tcp:3000 tcp:3000
```

Run `adb reverse` again after reconnecting the cable. Plain http is allowed only
for `localhost`, `127.0.0.1` and `10.0.2.2` (`res/xml/network_security_config.xml`).
For a rented server: `-PveraServerUrl=https://your-domain`.
Offline uses the same mechanisms as the browser: the service worker (app shell, media),
IndexedDB (the last 10 messages of each chat, music, avatars) and localStorage
(theme, settings). If the client isn't cached yet and there is no network, the app
shows `assets/offline.html` with a "Повторить" (Retry) button.

## Build an APK

Gradle (AGP) refuses to build from a path with Cyrillic characters
(`Проеты`, `Ярослав`), so build from an ASCII copy:

```powershell
robocopy Android E:\VeraBuild\Android /MIR /XD build .gradle
cd E:\VeraBuild\Android
$env:JAVA_HOME = 'E:\androidstudio\jbr'
.\gradlew.bat assembleRelease
# → app\build\outputs\apk\release\app-release.apk
```

Another server: `.\gradlew.bat assembleRelease -PveraServerUrl=https://example.com`.

The release APK is signed with the **debug key**, which is fine for manual installs.
Google Play needs your own keystore (`signingConfigs` in `app/build.gradle.kts`),
and an APK signed with a different key won't install over this one.

Copy the finished APK to `Server/public/downloads/Vera-Android.apk`.
The `/download` page will show it in the "Android" section.
