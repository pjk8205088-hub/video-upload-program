const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { SocialUploadEngine, socialProviderCatalog } = require('../lib/social-engine');

test('one social engine catalog exposes exactly the four UI providers', () => {
  const catalog = socialProviderCatalog();
  assert.deepEqual(catalog.map((provider) => provider.key).sort(), ['facebook', 'instagram', 'naver', 'tiktok']);
  assert.ok(catalog.every((provider) => provider.loginUrl && provider.uploadUrl && provider.supportsDirectUpload));
  assert.equal(catalog.find((provider) => provider.key === 'tiktok').requiresProvider, 'facebook');
});

test('one social engine dispatches all four providers through the same job path', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'social-engine-'));
  const filePath = path.join(directory, 'slot-1.mp4');
  await fs.writeFile(filePath, Buffer.from('test-video'));
  const dispatched = [];
  const engine = new SocialUploadEngine({
    adapterFactory(provider, options) {
      dispatched.push({ provider, mode: options.mode });
      return {
        async publish() { return { externalId: `${provider}-published`, externalUrl: `https://example.test/${provider}`, publishedAt: '2026-08-15T00:00:00.000Z', mode: 'live' }; },
        async getAnalytics() { return { views: 0, likes: 0, comments: 0 }; },
        async listComments() { return []; }
      };
    },
    now: () => new Date('2026-08-15T00:00:00.000Z')
  });

  try {
    for (const provider of ['instagram', 'tiktok', 'naver', 'facebook']) {
      const job = { id: `job-${provider}`, accountId: `account-${provider}`, videoId: 'video-1', provider, slotNumber: 1, status: 'queued', attempt: 0, maxAttempts: 3, logs: [] };
      const campaign = { routes: [{ accountId: job.accountId, videoId: job.videoId, provider }] };
      const result = await engine.executeJob({ job, video: { id: 'video-1', filePath }, campaign, mode: 'live' });
      assert.equal(result.job.status, 'published');
      assert.equal(result.job.externalUrl, `https://example.test/${provider}`);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }

  assert.deepEqual(dispatched, [
    { provider: 'instagram', mode: 'live' },
    { provider: 'tiktok', mode: 'live' },
    { provider: 'naver', mode: 'live' },
    { provider: 'facebook', mode: 'live' }
  ]);
});

test('social engine stops retrying when a provider requires login', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'social-engine-login-'));
  const filePath = path.join(directory, 'slot-2.mp4');
  await fs.writeFile(filePath, Buffer.from('test-video'));
  const engine = new SocialUploadEngine({
    adapterFactory() {
      return { async publish() { throw Object.assign(new Error('로그인이 필요합니다.'), { code: 'INSTAGRAM_LOGIN_REQUIRED' }); } };
    },
    now: () => new Date('2026-08-15T00:00:00.000Z')
  });
  const job = { id: 'job-login', accountId: 'account-instagram', videoId: 'video-2', provider: 'instagram', slotNumber: 2, status: 'queued', attempt: 0, maxAttempts: 3, logs: [] };

  try {
    const result = await engine.executeJob({ job, video: { id: 'video-2', filePath }, campaign: { routes: [{ accountId: job.accountId, videoId: job.videoId, provider: 'instagram' }] }, mode: 'live' });
    assert.equal(result.job.status, 'failed');
    assert.equal(result.job.nextRetryAt, null);
    assert.equal(result.job.attempt, 1);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
