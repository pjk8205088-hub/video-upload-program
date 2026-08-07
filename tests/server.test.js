const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { formatBytes, MAX_FILE_SIZE, createServer, createStore, ensureStorage } = require('../server');

test('formatBytes formats upload sizes for the UI', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1024 ** 2), '1.0 MB');
});

test('MVP upload limit is 2 GB and the board has ten slots', () => {
  assert.equal(MAX_FILE_SIZE, 2 * 1024 * 1024 * 1024);
});

async function withServer(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-desk-'));
  const store = createStore(root);
  await ensureStorage(store);
  const server = createServer({ store, scheduler: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await callback(base); } finally { await new Promise((resolve) => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); }
}

async function json(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, options);
  const payload = await response.json();
  return { response, payload };
}

async function upload(base, slot, name) {
  return json(base, '/api/videos', { method: 'POST', headers: { 'X-File-Name': encodeURIComponent(name), 'X-File-Type': 'video/mp4', 'X-File-Size': '13', 'X-Slot-Number': String(slot) }, body: Buffer.from('sandbox video') });
}

test('slot routing, duplicate protection, sandbox publish, analytics and comments work together', async () => withServer(async (base) => {
  const first = await upload(base, 1, '첫번째-영상.mp4');
  assert.equal(first.response.status, 201);
  assert.equal(first.payload.video.slotNumber, 1);
  assert.match(first.payload.video.thumbnailUrl, /\.svg$/);
  const ai = await json(base, '/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId: first.payload.video.id }) });
  assert.equal(ai.response.status, 200);
  assert.equal(ai.payload.metadata.source, 'local-fallback');

  const account = await json(base, '/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'youtube', displayName: 'Sandbox 채널', handle: '@sandbox' }) });
  assert.equal(account.response.status, 201);
  const routing = await json(base, `/api/accounts/${account.payload.account.id}/routing`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slotNumbers: [1, 3, 11] }) });
  assert.deepEqual(routing.payload.account.slotNumbers, [1, 3]);

  const campaignBody = { title: '테스트 게시', description: 'sandbox 설명', hashtags: ['#테스트'], scheduledAt: new Date(Date.now() - 1000).toISOString(), routes: [{ accountId: account.payload.account.id, slotNumber: 1 }] };
  const campaign = await json(base, '/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(campaignBody) });
  assert.equal(campaign.response.status, 201);
  assert.equal(campaign.payload.campaign.jobs.length, 1);
  const duplicate = await json(base, '/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(campaignBody) });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.payload.error.code, 'DUPLICATE_ROUTES');

  const run = await json(base, `/api/campaigns/${campaign.payload.campaign.id}/run`, { method: 'POST' });
  assert.equal(run.payload.campaign.jobs[0].status, 'published');
  assert.equal(run.payload.campaign.jobs[0].progress, 100);
  const analytics = await json(base, '/api/analytics');
  assert.ok(analytics.payload.totals.views > 0);
  const comments = await json(base, '/api/comments');
  assert.equal(comments.payload.comments.length, 1);
  const commentId = comments.payload.comments[0].id;
  const reply = await json(base, `/api/comments/${commentId}/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '확인했습니다.' }) });
  assert.equal(reply.payload.comment.replies.length, 1);
  const hidden = await json(base, `/api/comments/${commentId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'hide' }) });
  assert.equal(hidden.payload.comment.status, 'hidden');
}));

test('failed sandbox jobs schedule exponential retry and manual retry can recover', async () => withServer(async (base) => {
  const original = process.env.UPLOAD_DESK_MOCK_FAILURES;
  process.env.UPLOAD_DESK_MOCK_FAILURES = 'tiktok';
  try {
    const video = await upload(base, 2, 'retry-video.mp4');
    const account = await json(base, '/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'tiktok', displayName: 'Retry 채널', handle: '@retry' }) });
    const campaign = await json(base, '/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '재시도 테스트', scheduledAt: new Date(Date.now() - 1000).toISOString(), routes: [{ accountId: account.payload.account.id, slotNumber: video.payload.video.slotNumber }] }) });
    const run = await json(base, `/api/campaigns/${campaign.payload.campaign.id}/run`, { method: 'POST' });
    const retryingJob = run.payload.campaign.jobs[0];
    assert.equal(retryingJob.status, 'retrying');
    assert.equal(retryingJob.attempt, 1);
    assert.ok(new Date(retryingJob.nextRetryAt).getTime() > Date.now());
    delete process.env.UPLOAD_DESK_MOCK_FAILURES;
    const recovered = await json(base, `/api/jobs/${retryingJob.id}/retry`, { method: 'POST' });
    assert.equal(recovered.payload.job.status, 'published');
    assert.equal(recovered.payload.job.attempt, 2);
  } finally {
    if (original === undefined) delete process.env.UPLOAD_DESK_MOCK_FAILURES; else process.env.UPLOAD_DESK_MOCK_FAILURES = original;
  }
}));
