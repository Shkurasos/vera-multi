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
