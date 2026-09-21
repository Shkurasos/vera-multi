const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTranscriptionHandler } = require('./transcription');

function response() {
  return { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
}

test('transcribes an accessible local audio attachment', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-transcription-'));
  const file = path.join(root, 'files', 'voice.ogg');
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, Buffer.alloc(8));
  const handler = createTranscriptionHandler({
    getDb: () => ({
      chatMembers: [{ chatId: 'chat', userId: 'user' }],
      messages: [{ chatId: 'chat', attachments: [{ id: 'audio', fileUrl: '/uploads/files/voice.ogg', mimeType: 'audio/ogg' }] }],
    }),
    uploadsDir: root,
    transcribe: async input => { assert.equal(input, fs.realpathSync.native(file)); return { text: 'Привет' }; },
  });
  const res = response();
  await handler({ userId: 'user', params: { attachmentId: 'audio' } }, res);
  assert.equal(res.code, 200, JSON.stringify(res.data));
  assert.deepEqual(res.data, { text: 'Привет', status: 'done' });
  fs.rmSync(root, { recursive: true, force: true });
});

test('does not expose an attachment to a non-member', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-transcription-'));
  const handler = createTranscriptionHandler({
    getDb: () => ({ chatMembers: [], messages: [{ chatId: 'chat', attachments: [{ id: 'audio', fileUrl: '/uploads/files/voice.ogg', mimeType: 'audio/ogg' }] }] }),
    uploadsDir: root,
    transcribe: async () => { throw new Error('must not run'); },
  });
  const res = response();
  await handler({ userId: 'outsider', params: { attachmentId: 'audio' } }, res);
  assert.equal(res.code, 404);
  fs.rmSync(root, { recursive: true, force: true });
});