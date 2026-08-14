const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MockProviderAdapter,
  FacebookProviderAdapter,
  TikTokProviderAdapter,
  facebookCaption,
  getProviderAdapter,
  tiktokCaption,
  tiktokVisibility
} = require('../lib/providers');

test('TikTok remains sandboxed unless live mode is explicit', () => {
  assert.ok(getProviderAdapter('tiktok') instanceof MockProviderAdapter);
  assert.ok(getProviderAdapter('tiktok', { mode: 'sandbox' }) instanceof MockProviderAdapter);
  assert.ok(getProviderAdapter('tiktok', { mode: 'live', clientFactory: () => ({}) }) instanceof TikTokProviderAdapter);
});

test('Facebook remains sandboxed unless live mode is explicit', () => {
  assert.ok(getProviderAdapter('facebook') instanceof MockProviderAdapter);
  assert.ok(getProviderAdapter('facebook', { mode: 'sandbox' }) instanceof MockProviderAdapter);
  assert.ok(getProviderAdapter('facebook', { mode: 'live', clientFactory: () => ({}) }) instanceof FacebookProviderAdapter);
});

test('Facebook caption maps campaign metadata', () => {
  assert.equal(
    facebookCaption({ title: '제목', description: '설명', hashtags: ['#첫째', '#둘째'] }),
    '설명\n\n#첫째 #둘째'
  );
  assert.equal(facebookCaption({ title: '제목' }), '제목');
});

test('live Facebook adapter publishes through the integration client', async () => {
  const calls = [];
  const fakeClient = {
    async start() { calls.push('start'); },
    async uploadVideos(options) {
      calls.push(options);
      return [{
        externalId: 'facebook_test_1',
        publishedAt: '2026-08-14T00:00:00Z',
        status: 'published'
      }];
    },
    async close() { calls.push('close'); }
  };
  const adapter = getProviderAdapter('facebook', {
    mode: 'live',
    clientFactory: () => fakeClient
  });

  const result = await adapter.publish({
    job: { id: 'job-facebook-test' },
    video: { filePath: 'C:\\videos\\clip.mp4' },
    campaign: { title: '테스트', description: '설명', hashtags: ['#테스트'] }
  });

  assert.deepEqual(calls[0], 'start');
  assert.deepEqual(calls[1].videos, [{
    filePath: 'C:\\videos\\clip.mp4',
    caption: '설명\n\n#테스트'
  }]);
  assert.equal(calls[1].finalize, true);
  assert.equal(calls[2], 'close');
  assert.equal(result.mode, 'live');
  assert.equal(result.externalId, 'facebook_test_1');
});

test('TikTok caption and visibility map campaign metadata', () => {
  assert.equal(
    tiktokCaption({ description: '설명', hashtags: ['#첫째', '#둘째'] }),
    '설명\n\n#첫째 #둘째'
  );
  assert.equal(tiktokVisibility('public'), 'public');
  assert.equal(tiktokVisibility('unknown'), 'current');
});

test('live TikTok adapter publishes through the integration client', async () => {
  const calls = [];
  let factoryOptions;
  const fakeClient = {
    async start() { calls.push('start'); },
    async uploadVideos(options) {
      calls.push(options);
      return [{
        externalId: '7673000000000000000',
        url: 'https://www.tiktok.com/@tester/video/7673000000000000000',
        publishedAt: '2026-08-14T00:00:00Z'
      }];
    },
    async close() { calls.push('close'); }
  };
  const adapter = getProviderAdapter('tiktok', {
    mode: 'live',
    browserChannel: 'chrome',
    clientFactory: (options) => {
      factoryOptions = options;
      return fakeClient;
    }
  });

  const result = await adapter.publish({
    job: { id: 'job-test' },
    video: { filePath: 'C:\\videos\\clip.mp4' },
    campaign: {
      description: '실제 게시 테스트',
      hashtags: ['#테스트'],
      privacy: 'public'
    }
  });

  assert.deepEqual(calls[0], 'start');
  assert.equal(factoryOptions.browserChannel, 'chrome');
  assert.equal(calls[1].finalize, true);
  assert.deepEqual(calls[1].videos, [{
    filePath: 'C:\\videos\\clip.mp4',
    caption: '실제 게시 테스트\n\n#테스트',
    visibility: 'public'
  }]);
  assert.equal(calls[2], 'close');
  assert.equal(result.mode, 'live');
  assert.equal(result.externalId, '7673000000000000000');
  assert.equal(result.externalUrl, 'https://www.tiktok.com/@tester/video/7673000000000000000');
});

test('live TikTok adapter marks unverifiable publication as uncertain', async () => {
  const adapter = new TikTokProviderAdapter({
    clientFactory: () => ({
      async start() {},
      async uploadVideos() { return []; },
      async close() {}
    })
  });

  await assert.rejects(
    adapter.publish({
      job: { id: 'job-uncertain' },
      video: { filePath: 'C:\\videos\\clip.mp4' },
      campaign: {}
    }),
    (error) => error.code === 'PUBLISH_STATE_UNCERTAIN'
  );
});
