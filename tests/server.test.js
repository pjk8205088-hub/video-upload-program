const test = require('node:test');
const assert = require('node:assert/strict');
const { formatBytes, MAX_FILE_SIZE } = require('../server');

test('formatBytes formats upload sizes for the UI', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1024 ** 2), '1.0 MB');
});

test('MVP upload limit is 2 GB', () => {
  assert.equal(MAX_FILE_SIZE, 2 * 1024 * 1024 * 1024);
});
