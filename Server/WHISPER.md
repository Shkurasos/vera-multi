# Локальное распознавание аудио

Требуются Python 3.10/3.11 и FFmpeg в PATH процесса Node.js.
Аудио обрабатывается на сервере и не отправляется облачному провайдеру.

Из каталога Server (PowerShell):

```powershell
py -3.11 -m venv .venv-whisper
.\.venv-whisper\Scripts\python.exe -m pip install openai-whisper==20250625
# Загрузить модель заранее (нужен интернет только для установки и модели):
.\.venv-whisper\Scripts\python.exe -c "import whisper; whisper.load_model('base')"
$env:WHISPER_PYTHON = (Resolve-Path '.\.venv-whisper\Scripts\python.exe').Path
$env:WHISPER_MODEL = 'base'
node server.js
```

Установите FFmpeg отдельно и проверьте `ffmpeg -version` в той же среде.
Для постоянной настройки задайте WHISPER_PYTHON (абсолютный путь к Python)
и WHISPER_MODEL в Server/.env. На Linux аналогично используйте python3 -m venv
и путь .venv-whisper/bin/python; установите ffmpeg через менеджер пакетов ОС.
Перезапустите сервер после настройки. Docker-образ нужно отдельно дополнить
Python, FFmpeg, пакетом Whisper и предварительно загруженной моделью.

По умолчанию используется многоязычная модель base на CPU с определением языка.
Можно выбрать small для более высокого качества (больше памяти и времени).
Одновременно обрабатывается один запрос, предел — 25 МБ и 5 минут обработки.
Модель загружается в отдельном процессе на каждый запрос. Длинные записи могут
не уложиться в лимит. Таймаут reverse proxy также должен позволять 5 минут.
Вложения должны храниться локально в /uploads/; старые data URL нужно отправить заново.
Расшифровка видна только запросившему клиенту, автоматически в чат не отправляется.