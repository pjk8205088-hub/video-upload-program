const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUploadRoutes, executeUploadJob, selectReadyJobs } = require('../lib/upload');

test('headless upload builds deduplicated routes without UI', () => {
  const accounts = [{ id: 'acct-1', provider: 'instagram', handle: '@demo', status: 'connected', authVerified: true }];
  const videos = [{ id: 'video-1', slotNumber: 3 }];
  const result = buildUploadRoutes({ body: { routes: [{ accountId: 'acct-1', slotNumber: 3 }, { accountId: 'acct-1', slotNumber: 3 }] }, accounts, videos, maxSlots: 10 });
  assert.deepEqual(result.routes, [{ accountId: 'acct-1', slotNumber: 3, videoId: 'video-1', provider: 'instagram', handle: '@demo' }]);
  assert.deepEqual(result.invalid, []);
});

test('headless upload executes a provider adapter and returns comments', async () => {
  const calls = [];
  const adapterFactory = () => ({
    async publish({ job }) { calls.push(`publish:${job.id}`); return { externalId: 'external-1', publishedAt: '2026-08-14T00:00:00.000Z' }; },
    async getAnalytics() { return { views: 10, likes: 2, comments: 1 }; },
    async listComments() { return [{ externalId: 'comment-1', text: 'hello' }]; }
  });
  const job = { id: 'job-1', provider: 'instagram', status: 'queued', progress: 0, attempt: 0, maxAttempts: 3, logs: [] };
  const result = await executeUploadJob({ job, video: { id: 'video-1' }, campaign: { id: 'campaign-1' }, adapterFactory, now: () => new Date('2026-08-14T00:00:00.000Z') });
  assert.deepEqual(calls, ['publish:job-1']);
  assert.equal(result.job.status, 'published');
  assert.equal(result.job.progress, 100);
  assert.deepEqual(result.comments, [{ externalId: 'comment-1', text: 'hello' }]);
});

test('headless upload schedules a retry after an adapter failure', async () => {
  const job = { id: 'job-2', provider: 'tiktok', status: 'queued', progress: 0, attempt: 0, maxAttempts: 3, logs: [] };
  const result = await executeUploadJob({ job, video: {}, campaign: {}, adapterFactory: () => ({ async publish() { throw new Error('offline'); } }), retryBaseMs: 1000, now: () => new Date('2026-08-14T00:00:00.000Z') });
  assert.equal(result.job.status, 'retrying');
  assert.equal(result.job.attempt, 1);
  assert.equal(result.job.nextRetryAt, '2026-08-14T00:00:01.000Z');
});

test('headless upload selects due jobs only', () => {
  const campaign = { scheduledAt: '2026-08-14T00:00:00.000Z', jobs: [{ id: 'due', status: 'queued', nextRetryAt: null }, { id: 'future', status: 'queued', nextRetryAt: '2026-08-15T00:00:00.000Z' }, { id: 'published', status: 'published' }] };
  assert.deepEqual(selectReadyJobs(campaign, { now: Date.parse('2026-08-14T00:01:00.000Z') }).map((job) => job.id), ['due']);
});
