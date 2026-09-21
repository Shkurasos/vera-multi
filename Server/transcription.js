const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');

function fail(status, message) { return Object.assign(new Error(message), { status }); }

function runWhisper(file) {
  return new Promise((resolve, reject) => {
    execFile(process.env.WHISPER_PYTHON || 'python', [path.join(__dirname, 'transcribe.py'), file], {
      timeout: 300000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    }, (error, stdout) => {
      if (error) return reject(fail(503, 'Локальный Whisper недоступен или превышено время обработки. Проверьте Python, openai-whisper, FFmpeg и модель (Server/WHISPER.md).'));
      try { resolve(JSON.parse(stdout)); }
      catch { reject(fail(502, 'Некорректный ответ локального Whisper')); }
    });
  });
}

function createTranscriptionHandler({ getDb, uploadsDir, transcribe = runWhisper }) {
  let busy = false;
  return async (req, res) => {
    let acquired = false;
    try {
      const db = getDb();
      const message = db.messages.find(m => !m.isDeleted &&
        m.attachments?.some(a => a.id === req.params.attachmentId) &&
        db.chatMembers.some(member => member.chatId === m.chatId && member.userId === req.userId));
      if (!message) throw fail(404, 'Аудиовложение не найдено или нет доступа');
      const attachment = message.attachments.find(a => a.id === req.params.attachmentId);
      if (!attachment.mimeType?.startsWith('audio/') && message.type !== 'voice') throw fail(400, 'Можно распознавать только аудио');
      const url = attachment.fileUrl || '';
      if (!url.startsWith('/uploads/')) throw fail(400, 'Для распознавания нужен файл, загруженный на этот сервер. Отправьте аудио заново.');
      const root = await fs.realpath(uploadsDir);
      const file = await fs.realpath(path.resolve(root, decodeURIComponent(url.slice('/uploads/'.length))));
      const relative = path.relative(root, file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw fail(400, 'Недопустимый путь аудиофайла');
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 25 * 1024 * 1024) throw fail(413, 'Максимальный размер аудио для распознавания — 25 МБ');
      if (busy) throw fail(429, 'Сервер уже распознаёт аудио. Попробуйте позже.');
      busy = true; acquired = true;
      const result = await transcribe(file);
      res.json({ text: String(result.text || '').trim(), status: 'done' });
    } catch (error) {
      res.status(error.status || (error.code === 'ENOENT' ? 404 : 500)).json({
        message: error.status ? error.message : error.code === 'ENOENT' ? 'Аудиофайл не найден на сервере' : 'Ошибка распознавания аудио',
      });
    } finally { if (acquired) busy = false; }
  };
}

module.exports = { createTranscriptionHandler };