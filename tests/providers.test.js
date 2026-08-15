const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MockProviderAdapter,
  NaverClipProviderAdapter,
  InstagramProviderAdapter,
  FacebookProviderAdapter,
  TikTokProviderAdapter,
  getProviderAdapter,
  facebookMetadata,
  instagramMetadata,
  naverClipMetadata,
  tiktokCaption,
  tiktokVisibility
} = require('../lib/providers');

test('TikTok remains sandboxed unless live mode is explicit', () => {
  assert.ok(getProviderAdapter('tiktok') instanceof MockProviderAdapter);
  assert.ok(getProviderAdapter('tiktok', { mode: 'sandbox' }) instanceof MockProviderAdapter);
  assert.ok(getProviderAdapter('tiktok', { mode: 'live', clientFactory: () => ({}) }) instanceof TikTokProviderAdapter);
});

test('Naver Clip remains sandboxed unless live mode is explicit', () => {
  assert.ok(getProviderAdapter('naver') instanceof MockProviderAdapter);
  assert.ok(getProviderAdapter('naver', { mode: 'sandbox' }) instanceof MockProviderAdapter);
  assert.ok(getProviderAdapter('naver', { mode: 'live', clientFactory: () => ({}) }) instanceof NaverClipProviderAdapter);
});

test('Instagram remains sandboxed unless live mode is explicit', () => {
  assert.ok(getProviderAdapter('instagram') instanceof MockProviderAdapter);
  assert.ok(getProviderAdapter('instagram', { mode: 'sandbox' }) instanceof MockProviderAdapter);
  assert.ok(getProviderAdapter('instagram', { mode: 'live', clientFactory: () => ({}) }) instanceof InstagramProviderAdapter);
});

test('Facebook remains sandboxed unless live mode is explicit', () => {
  assert.ok(getProviderAdapter('facebook') instanceof MockProviderAdapter);
  assert.ok(getProviderAdapter('facebook', { mode: 'sandbox' }) instanceof MockProviderAdapter);
  assert.ok(getProviderAdapter('facebook', { mode: 'live', clientFactory: () => ({}) }) instanceof FacebookProviderAdapter);
});

test('Facebook metadata maps caption and hashtags for video posts', () => {
  assert.deepEqual(
    facebookMetadata({
      video: { filePath: 'C:\\videos\\facebook.mp4' },
      campaign: { title: '기본 제목', hashtags: ['#캠페인'] },
      job: { facebookMetadata: { caption: '페이스북 설명', hashtags: ['#페이스북'] } }
    }),
    { caption: '페이스북 설명\n\n#페이스북', pageHandle: '' }
  );
});

test('live Facebook adapter publishes through the integration client', async () => {
  const calls = [];
  const fakeClient = {
    async start() { calls.push('start'); },
    async uploadVideos(options) {
      calls.push(options);
      return [{ externalId: 'facebook-video-123', url: 'https://www.facebook.com/watch/?v=123', publishedAt: '2026-08-14T00:00:00Z' }];
    },
    async close() { calls.push('close'); }
  };
  const adapter = getProviderAdapter('facebook', { mode: 'live', clientFactory: () => fakeClient });
  const result = await adapter.publish({
    job: { id: 'job-facebook', handle: 'owner@example.com', facebookMetadata: { caption: '페이스북 설명', hashtags: ['#페이스북'], pageHandle: 'brand.page' } },
    video: { filePath: 'C:\\videos\\facebook.mp4' },
    campaign: {}
  });
  assert.equal(calls[0], 'start');
  assert.equal(calls[1].finalize, true);
  assert.deepEqual(calls[1].videos, [{ filePath: 'C:\\videos\\facebook.mp4', pageHandle: 'brand.page', caption: '페이스북 설명\n\n#페이스북' }]);
  assert.equal(calls[2], 'close');
  assert.equal(result.mode, 'live');
  assert.equal(result.externalUrl, 'https://www.facebook.com/watch/?v=123');
});

test('Instagram metadata maps caption and hashtags for Reels', () => {
  assert.deepEqual(
    instagramMetadata({
      video: { filePath: 'C:\\videos\\reel.mp4' },
      campaign: { title: '기본 제목', hashtags: ['#캠페인'] },
      job: { instagramMetadata: { caption: '릴스 설명', hashtags: ['#릴스'] } }
    }),
    { caption: '릴스 설명\n\n#릴스' }
  );
});

test('live Instagram adapter publishes through the integration client', async () => {
  const calls = [];
  const fakeClient = {
    async start() { calls.push('start'); },
    async uploadVideos(options) {
      calls.push(options);
      return [{ externalId: 'reel-123', url: 'https://www.instagram.com/reel/reel-123/', publishedAt: '2026-08-14T00:00:00Z' }];
    },
    async close() { calls.push('close'); }
  };
  const adapter = getProviderAdapter('instagram', { mode: 'live', clientFactory: () => fakeClient });
  const result = await adapter.publish({
    job: { id: 'job-instagram', handle: '@creator', instagramMetadata: { caption: '릴스 설명', hashtags: ['#릴스'] } },
    video: { filePath: 'C:\\videos\\reel.mp4' },
    campaign: {}
  });
  assert.equal(calls[0], 'start');
  assert.equal(calls[1].finalize, true);
  assert.deepEqual(calls[1].videos, [{ filePath: 'C:\\videos\\reel.mp4', handle: '@creator', caption: '릴스 설명\n\n#릴스' }]);
  assert.equal(calls[2], 'close');
  assert.equal(result.mode, 'live');
  assert.equal(result.externalUrl, 'https://www.instagram.com/reel/reel-123/');
});

test('live adapter receives the verified Electron login cookies in memory', async () => {
  const cookie = { name: 'sessionid', value: 'verified', domain: '.instagram.com', path: '/' };
  let receivedOptions;
  const adapter = getProviderAdapter('instagram', {
    mode: 'live',
    initialCookiesProvider: async (provider) => provider === 'instagram' ? [cookie] : [],
    clientFactory: (options) => {
      receivedOptions = options;
      return {
        async start() {},
        async uploadVideos() { return [{ externalId: 'reel-cookie', url: 'https://www.instagram.com/reel/reel-cookie/' }]; },
        async close() {}
      };
    }
  });
  await adapter.publish({ job: { id: 'job-cookie' }, video: { filePath: 'C:\\videos\\reel.mp4' }, campaign: {} });
  assert.deepEqual(receivedOptions.initialCookies, [cookie]);
});

test('Naver Clip metadata uses shopping info tag and campaign categories', () => {
  assert.deepEqual(
    naverClipMetadata({
      video: { filePath: 'C:\\videos\\clip.mp4' },
      campaign: { title: '기본 제목', description: '상품 설명', hashtags: ['#쇼핑'] },
      job: { clipMetadata: { primaryCategory: '라이프 이벤트', secondaryCategory: '쇼핑', publicEnabled: true } }
    }),
    { caption: '상품 설명\n\n#쇼핑', category: ['라이프 이벤트', '쇼핑'], infoTag: '쇼핑', visibility: 'public' }
  );
});

test('live Naver Clip adapter registers through the integration client', async () => {
  const calls = [];
  const fakeClient = {
    async start() { calls.push('start'); },
    async uploadVideos(options) {
      calls.push(options);
      return [{ status: 'published', url: 'https://clip.naver.com/contents/test' }];
    },
    async close() { calls.push('close'); }
  };
  const adapter = getProviderAdapter('naver', { mode: 'live', clientFactory: () => fakeClient });
  const result = await adapter.publish({
    job: { id: 'job-naver', clipMetadata: { description: '네이버 상품 설명', primaryCategory: '라이프 이벤트', secondaryCategory: '쇼핑', publicEnabled: true } },
    video: { filePath: 'C:\\videos\\clip.mp4' },
    campaign: { hashtags: ['#정보'] }
  });
  assert.equal(calls[0], 'start');
  assert.equal(calls[1].finalize, true);
  assert.deepEqual(calls[1].videos[0], {
    filePath: 'C:\\videos\\clip.mp4',
    caption: '네이버 상품 설명\n\n#정보',
    category: ['라이프 이벤트', '쇼핑'],
    infoTag: '쇼핑',
    visibility: 'public'
  });
  assert.equal(calls[2], 'close');
  assert.equal(result.mode, 'live');
  assert.equal(result.externalUrl, 'https://clip.naver.com/contents/test');
});

test('TikTok caption and visibility map campaign metadata', () => {
  assert.equal(
    tiktokCaption({ description: '설명', hashtags: ['#첫째', '#둘째'] }),
    '설명\n\n#첫째 #둘째'
  );
  assert.equal(tiktokVisibility('public'), 'public');
  assert.equal(tiktokVisibility('unknown'), 'current');
});

test('TikTok live adapter receives the configured browser channel', () => {
  const adapter = getProviderAdapter('tiktok', {
    mode: 'live',
    browserChannel: 'msedge',
    clientFactory: () => ({})
  });
  assert.equal(adapter.browserChannel, 'msedge');
});

test('live TikTok adapter receives the verified login cookies', async () => {
  const cookie = { name: 'sessionid', value: 'verified', domain: '.tiktok.com', path: '/' };
  let receivedOptions;
  const adapter = getProviderAdapter('tiktok', {
    mode: 'live',
    initialCookiesProvider: async (provider) => provider === 'tiktok' ? [cookie] : [],
    clientFactory: (options) => {
      receivedOptions = options;
      return {
        async start() {},
        async uploadVideos() {
          return [{ externalId: 'tiktok-cookie', url: 'https://www.tiktok.com/@tester/video/tiktok-cookie' }];
        },
        async close() {}
      };
    }
  });
  await adapter.publish({ job: { id: 'job-tiktok-cookie' }, video: { filePath: 'C:\\videos\\tiktok.mp4' }, campaign: {} });
  assert.deepEqual(receivedOptions.initialCookies, [cookie]);
});

test('live TikTok adapter publishes through the integration client', async () => {
  const calls = [];
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
    clientFactory: () => fakeClient
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
