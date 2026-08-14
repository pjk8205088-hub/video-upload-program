const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLoginUploadWorkflow } = require('../lib/login-upload');

function fakeSession(cookieMap = {}) {
  return { cookies: { async get({ url }) { return cookieMap[url] || []; } } };
}

function connectedNaverSession() {
  return fakeSession({ 'https://nid.naver.com': [{ name: 'NID_SES', value: 'verified-session' }] });
}

async function withFiles(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'login-upload-'));
  const allowedFile = path.join(root, 'approved-video.mp4');
  const otherFile = path.join(root, 'other-video.mp4');
  await fs.writeFile(allowedFile, Buffer.from('approved test video'));
  await fs.writeFile(otherFile, Buffer.from('other test video'));
  try { return await callback({ allowedFile, otherFile }); } finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('login is checked before any upload adapter runs', async () => withFiles(async ({ allowedFile }) => {
  let publishCalls = 0;
  const workflow = createLoginUploadWorkflow({ authSession: fakeSession(), allowedFilePath: allowedFile, adapterFactory: () => ({ async publish() { publishCalls += 1; } }) });
  await assert.rejects(() => workflow.upload({ provider: 'naver', filePath: allowedFile }), (error) => error.code === 'LOGIN_REQUIRED');
  assert.equal(publishCalls, 0);
}));

test('a file other than the designated file is always blocked', async () => withFiles(async ({ allowedFile, otherFile }) => {
  let publishCalls = 0;
  const workflow = createLoginUploadWorkflow({ authSession: connectedNaverSession(), allowedFilePath: allowedFile, adapterFactory: () => ({ async publish() { publishCalls += 1; } }) });
  await workflow.prepareAllowedFile();
  await assert.rejects(() => workflow.upload({ provider: 'naver', filePath: otherFile }), (error) => error.code === 'FILE_NOT_ALLOWED');
  assert.equal(publishCalls, 0);
}));

test('the designated file uploads after login verification', async () => withFiles(async ({ allowedFile }) => {
  const calls = [];
  const workflow = createLoginUploadWorkflow({
    authSession: connectedNaverSession(),
    allowedFilePath: allowedFile,
    now: () => new Date('2026-08-14T00:00:00.000Z'),
    adapterFactory: () => ({
      async publish({ video }) { calls.push(video.localPath); return { externalId: 'naver-test-1', publishedAt: '2026-08-14T00:00:00.000Z' }; },
      async getAnalytics() { return { views: 0, likes: 0, comments: 0 }; },
      async listComments() { return []; }
    })
  });
  const approved = await workflow.prepareAllowedFile();
  const result = await workflow.upload({ provider: 'naver', filePath: allowedFile });
  assert.deepEqual(calls, [path.resolve(allowedFile)]);
  assert.equal(result.login.verified, true);
  assert.equal(result.job.status, 'published');
  assert.equal(result.allowedFile.sha256, approved.sha256);
}));

test('the designated file is blocked if its contents change after approval', async () => withFiles(async ({ allowedFile }) => {
  let publishCalls = 0;
  const workflow = createLoginUploadWorkflow({ authSession: connectedNaverSession(), allowedFilePath: allowedFile, adapterFactory: () => ({ async publish() { publishCalls += 1; } }) });
  await workflow.prepareAllowedFile();
  await fs.appendFile(allowedFile, Buffer.from('changed'));
  await assert.rejects(() => workflow.upload({ provider: 'naver', filePath: allowedFile }), (error) => error.code === 'FILE_CHANGED');
  assert.equal(publishCalls, 0);
}));
