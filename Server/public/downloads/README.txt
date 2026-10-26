Папка установщиков Vera Desktop
================================

Как добавить установщик:

Вариант A — файл < 100 MB (можно в git):
  1. Положить сюда, например: Vera-Setup-Windows.exe
  2. git add Server/public/downloads/Vera-Setup-Windows.exe
  3. git commit -m "downloads: windows installer"
  4. git push
  Render передеплоит, файл будет доступен на /download.

Вариант B — файл > 100 MB (через GitHub Releases):
  1. Собрать установщик локально.
  2. На github.com/Shkurasos/vera-multi -> Releases -> Draft a new release,
     прикрепить бинарник, Publish. Скопировать прямые URL на assets.
  3. Отредактировать downloads.json в этой папке (шаблон рядом),
     прописать { platform, filename, size, url }.
  4. git add downloads.json; git commit -m "downloads: v1.0"; git push

Если downloads.json существует - сервер отдаёт список из него.
Если нет - сканирует эту папку по расширениям:
  .exe, .msi                     -> Windows
  .dmg, .pkg                     -> macOS
  .AppImage, .deb, .rpm, .snap   -> Linux
  .apk, .aab                     -> Android

Сборка:
  ПК (Windows):  cd App; npm install; npm run build
                 -> App\dist-electron-build\Vera-Setup-Windows.exe
  Android:       см. Android\README.md -> Vera-Android.apk

One server for the site and the apps (Cloudflare Tunnel and others)
-------------------------------------------------------------------
On download, the server writes into Vera-Android.apk and Vera-Setup-Windows.exe
the address the site was opened from. Open the site at
https://xxx.trycloudflare.com, download the app, and it connects to that same
https://xxx.trycloudflare.com. No rebuild is needed.
  1) cd Server; npm start
  2) cloudflared tunnel --url http://localhost:3000
  3) Send a friend the https://....trycloudflare.com link, have them open
     /download and install the app.
The free tunnel's address changes on every start, so apps that are already
installed must be downloaded again from the new address.
A permanent address can be pinned with APP_SERVER_URL=https://... (env).
