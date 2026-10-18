'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
module.exports = function loadPrivacy(context) {
  Object.assign(context, { Buffer, path, fs, crypto: require('node:crypto'),
    ...require('./image-privacy'), UPLOADS_DIR: path.join(__dirname, 'unused-test-uploads') });
  const source = fs.readFileSync(require.resolve('./server.js'), 'utf8');
  vm.runInNewContext(source.slice(source.indexOf('function sanitizeStoredImage('), source.indexOf('// ─── paths')), context);
  return context;
};