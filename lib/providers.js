const crypto = require('node:crypto');
const path = require('node:path');

const PROVIDERS = [
  { key: 'naver', label: '네이버 클립', code: 'NV' },
  { key: 'tiktok', label: 'TikTok', code: 'TT' },
  { key: 'facebook', label: 'Facebook', code: 'FB' },
  { key: 'instagram', label: 'Instagram', code: 'IG' }
];

class ProviderAdapter {
  async publish() { throw new Error('ProviderAdapter.publish must be implemented by a provider'); }
  async getAnalytics() { throw new Error('ProviderAdapter.getAnalytics must be implemented by a provider'); }
  async listComments() { throw new Error('ProviderAdapter.listComments must be implemented by a provider'); }
  async replyComment() { throw new Error('ProviderAdapter.replyComment must be implemented by a provider'); }
  async hideComment() { throw new Error('ProviderAdapter.hideComment must be implemented by a provider'); }
}

function numericSeed(value) {
  return crypto.createHash('sha1').update(String(value)).digest().readUInt32BE(0);
}

class MockProviderAdapter extends ProviderAdapter {
  constructor(providerKey, options = {}) {
    super();
    this.providerKey = providerKey;
    this.delayMs = options.delayMs ?? 35;
  }

  async publish({ job }) {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const failingProviders = String(process.env.UPLOAD_DESK_MOCK_FAILURES || '').split(',').map((value) => value.trim()).filter(Boolean);
    if (failingProviders.includes(this.providerKey) || String(job.handle || '').toLowerCase().includes('fail')) {
      throw new Error(`sandbox ${this.providerKey} 전송 실패를 시뮬레이션했습니다.`);
    }
    return { externalId: `sandbox_${this.providerKey}_${job.id}`, publishedAt: new Date().toISOString(), mode: 'sandbox' };
  }

  async getAnalytics({ job }) {
    const seed = numericSeed(job.externalId || job.id);
    const views = 120 + (seed % 4800);
    return { views, likes: Math.round(views * (0.03 + ((seed % 17) / 1000))), comments: 1 + (seed % 17), fetchedAt: new Date().toISOString(), mode: 'sandbox' };
  }

  async listComments({ job, video }) {
    const id = `sandbox_comment_${job.id}`;
    return [{ externalId: id, authorName: 'sandbox_viewer', text: `${video?.originalName || '영상'} 잘 봤어요!`, status: 'visible', replies: [], createdAt: new Date().toISOString() }];
  }

  async replyComment({ comment, text }) {
    return { externalId: `sandbox_reply_${comment.id || comment.externalId}_${Date.now()}`, text, createdAt: new Date().toISOString() };
  }

  async hideComment({ comment }) {
    return { externalId: comment.externalId, status: 'hidden' };
  }
}

let tiktokPublishQueue = Promise.resolve();
let naverClipPublishQueue = Promise.resolve();
let instagramPublishQueue = Promise.resolve();
let facebookPublishQueue = Promise.resolve();

function enqueueTikTokPublish(task) {
  const result = tiktokPublishQueue.then(task, task);
  tiktokPublishQueue = result.catch(() => undefined);
  return result;
}

function enqueueNaverClipPublish(task) {
  const result = naverClipPublishQueue.then(task, task);
  naverClipPublishQueue = result.catch(() => undefined);
  return result;
}

function enqueueInstagramPublish(task) {
  const result = instagramPublishQueue.then(task, task);
  instagramPublishQueue = result.catch(() => undefined);
  return result;
}

function enqueueFacebookPublish(task) {
  const result = facebookPublishQueue.then(task, task);
  facebookPublishQueue = result.catch(() => undefined);
  return result;
}

function tiktokCaption(campaign = {}) {
  const description = String(campaign.description || campaign.title || '').trim();
  const hashtags = Array.isArray(campaign.hashtags)
    ? campaign.hashtags.map((tag) => String(tag || '').trim()).filter(Boolean)
    : [];
  return [description, hashtags.join(' ')].filter(Boolean).join('\n\n').slice(0, 4000);
}

function tiktokVisibility(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['public', 'private', 'friends'].includes(normalized) ? normalized : 'current';
}

function naverClipMetadata({ video, campaign, job }) {
  const clip = job?.clipMetadata || campaign?.naverClip || video?.aiMetadata?.naverClip || {};
  const description = String(clip.description || campaign?.description || campaign?.title || path.parse(video?.filePath || '').name || '').trim();
  const hashtags = Array.isArray(clip.hashtags)
    ? clip.hashtags.map((tag) => String(tag || '').trim()).filter(Boolean)
    : (Array.isArray(campaign?.hashtags) ? campaign.hashtags.map((tag) => String(tag || '').trim()).filter(Boolean) : []);
  const category = [clip.primaryCategory, clip.secondaryCategory].map((item) => String(item || '').trim()).filter(Boolean);
  const result = {
    caption: [description, hashtags.join(' ')].filter(Boolean).join('\n\n').slice(0, 300),
    category: category.length ? category : ['라이프 이벤트', '라이프 이벤트'],
    infoTag: String(clip.infoTag || '쇼핑'),
    visibility: clip.publicEnabled === false ? 'private' : 'public'
  };
  if (clip.productInfo?.name || clip.productInfo?.url) result.productInfo = clip.productInfo;
  return result;
}

function instagramMetadata({ video, campaign, job }) {
  const metadata = job?.instagramMetadata || campaign?.instagram || video?.aiMetadata?.instagram || {};
  const caption = String(metadata.caption || campaign?.description || campaign?.title || path.parse(video?.filePath || '').name || '').trim();
  const hashtags = Array.isArray(metadata.hashtags)
    ? metadata.hashtags.map((tag) => String(tag || '').trim()).filter(Boolean)
    : (Array.isArray(campaign?.hashtags) ? campaign.hashtags.map((tag) => String(tag || '').trim()).filter(Boolean) : []);
  return { caption: [caption, hashtags.join(' ')].filter(Boolean).join('\n\n').slice(0, 2200) };
}

function facebookMetadata({ video, campaign, job }) {
  const metadata = job?.facebookMetadata || campaign?.facebook || video?.aiMetadata?.facebook || {};
  const caption = String(metadata.caption || campaign?.description || campaign?.title || path.parse(video?.filePath || '').name || '').trim();
  const hashtags = Array.isArray(metadata.hashtags)
    ? metadata.hashtags.map((tag) => String(tag || '').trim()).filter(Boolean)
    : (Array.isArray(campaign?.hashtags) ? campaign.hashtags.map((tag) => String(tag || '').trim()).filter(Boolean) : []);
  return {
    caption: [caption, hashtags.join(' ')].filter(Boolean).join('\n\n').slice(0, 63_206),
    pageHandle: String(metadata.pageHandle || job?.handle || '').replace(/^@+/, '').trim()
  };
}

async function initialCookiesFor(adapter, provider) {
  if (typeof adapter.initialCookiesProvider === 'function') {
    const cookies = await adapter.initialCookiesProvider(provider);
    return Array.isArray(cookies) ? cookies : [];
  }
  return Array.isArray(adapter.initialCookies) ? adapter.initialCookies : [];
}

class TikTokProviderAdapter extends ProviderAdapter {
  constructor(options = {}) {
    super();
    this.userDataDir = path.resolve(
      options.userDataDir ||
      process.env.UPLOAD_DESK_TIKTOK_PROFILE ||
      path.join(process.cwd(), '.tiktok-browser')
    );
    this.browserChannel = options.browserChannel || process.env.UPLOAD_DESK_TIKTOK_BROWSER_CHANNEL || 'chrome';
    this.headless = options.headless ?? false;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.logger = options.logger || console;
    this.clientFactory = options.clientFactory || null;
  }

  async publish({ video, campaign, job }) {
    if (!video?.filePath) {
      throw new Error('TikTok 실제 게시에는 video.filePath가 필요합니다.');
    }

    return enqueueTikTokPublish(async () => {
      const client = await this.#createClient();
      try {
        await client.start();
        const results = await client.uploadVideos({
          finalize: true,
          videos: [{
            filePath: video.filePath,
            caption: tiktokCaption(campaign),
            visibility: tiktokVisibility(campaign?.privacy)
          }]
        });
        const published = results?.[0];
        if (!published?.externalId || !published?.url) {
          const error = new Error(`TikTok 게시 결과를 확인하지 못했습니다: ${job?.id || video.filePath}`);
          error.code = 'PUBLISH_STATE_UNCERTAIN';
          throw error;
        }
        return {
          externalId: published.externalId,
          externalUrl: published.url,
          publishedAt: published.publishedAt || new Date().toISOString(),
          mode: 'live'
        };
      } finally {
        await client.close().catch(() => undefined);
      }
    });
  }

  async getAnalytics({ job }) {
    return {
      views: job?.analytics?.views || 0,
      likes: job?.analytics?.likes || 0,
      comments: job?.analytics?.comments || 0,
      fetchedAt: new Date().toISOString(),
      mode: 'live',
      status: 'not_supported'
    };
  }

  async listComments() {
    return [];
  }

  async replyComment() {
    throw new Error('TikTok 실제 댓글 답글 기능은 아직 지원하지 않습니다.');
  }

  async hideComment() {
    throw new Error('TikTok 실제 댓글 숨김 기능은 아직 지원하지 않습니다.');
  }

  async #createClient() {
    const initialCookies = await initialCookiesFor(this, 'tiktok');
    if (this.clientFactory) {
      return this.clientFactory({
        userDataDir: this.userDataDir,
        browserChannel: this.browserChannel,
        headless: this.headless,
        timeoutMs: this.timeoutMs,
        logger: this.logger,
        initialCookies
      });
    }
    const { TikTokClient } = await import('tiktok-integration');
    return new TikTokClient({
      userDataDir: this.userDataDir,
      browserChannel: this.browserChannel,
      headless: this.headless,
      timeoutMs: this.timeoutMs,
      logger: this.logger,
      initialCookies
    });
  }
}

class NaverClipProviderAdapter extends ProviderAdapter {
  constructor(options = {}) {
    super();
    this.userDataDir = path.resolve(
      options.naverUserDataDir ||
      options.userDataDir ||
      process.env.UPLOAD_DESK_NAVER_PROFILE ||
      path.join(process.cwd(), '.naver-clip-browser')
    );
    this.browserChannel = options.browserChannel || 'chrome';
    this.headless = options.headless ?? false;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.logger = options.logger || console;
    this.clientFactory = options.clientFactory || null;
    this.initialCookiesProvider = options.initialCookiesProvider || null;
    this.initialCookies = options.initialCookies || [];
    this.initialCookiesProvider = options.initialCookiesProvider || null;
    this.initialCookies = options.initialCookies || [];
  }

  async publish({ video, campaign, job }) {
    if (!video?.filePath) throw new Error('네이버 클립 실제 등록에는 video.filePath가 필요합니다.');

    return enqueueNaverClipPublish(async () => {
      const client = await this.#createClient();
      try {
        await client.start();
        const metadata = naverClipMetadata({ video, campaign, job });
        const results = await client.uploadVideos({ finalize: true, videos: [{ filePath: video.filePath, ...metadata }] });
        const published = results?.[0];
        if (!published || !['published', 'private'].includes(published.status)) {
          const error = new Error(`네이버 클립 등록 결과를 확인하지 못했습니다: ${job?.id || video.filePath}`);
          error.code = 'PUBLISH_STATE_UNCERTAIN';
          throw error;
        }
        return {
          externalId: published.url || video.filePath,
          externalUrl: published.url || null,
          publishedAt: new Date().toISOString(),
          mode: 'live'
        };
      } finally {
        await client.close().catch(() => undefined);
      }
    });
  }

  async getAnalytics({ job }) {
    return { views: job?.analytics?.views || 0, likes: job?.analytics?.likes || 0, comments: job?.analytics?.comments || 0, fetchedAt: new Date().toISOString(), mode: 'live', status: 'not_supported' };
  }

  async listComments() { return []; }
  async replyComment() { throw new Error('네이버 클립 실제 댓글 답글 기능은 아직 지원하지 않습니다.'); }
  async hideComment() { throw new Error('네이버 클립 실제 댓글 숨김 기능은 아직 지원하지 않습니다.'); }

  async #createClient() {
    const initialCookies = await initialCookiesFor(this, 'naver');
    if (this.clientFactory) return this.clientFactory({ userDataDir: this.userDataDir, browserChannel: this.browserChannel, headless: this.headless, timeoutMs: this.timeoutMs, logger: this.logger, initialCookies });
    const { NaverClipClient } = await import('naver-clip-integration');
    return new NaverClipClient({ userDataDir: this.userDataDir, browserChannel: this.browserChannel, headless: this.headless, timeoutMs: this.timeoutMs, logger: this.logger, initialCookies });
  }
}

class InstagramProviderAdapter extends ProviderAdapter {
  constructor(options = {}) {
    super();
    this.userDataDir = path.resolve(
      options.instagramUserDataDir ||
      options.userDataDir ||
      process.env.UPLOAD_DESK_INSTAGRAM_PROFILE ||
      path.join(process.cwd(), '.instagram-browser')
    );
    this.browserChannel = options.browserChannel || 'chrome';
    this.headless = options.headless ?? false;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.logger = options.logger || console;
    this.clientFactory = options.clientFactory || null;
    this.initialCookiesProvider = options.initialCookiesProvider || null;
    this.initialCookies = options.initialCookies || [];
  }

  async publish({ video, campaign, job }) {
    if (!video?.filePath) throw new Error('Instagram 실제 게시에는 video.filePath가 필요합니다.');

    return enqueueInstagramPublish(async () => {
      const client = await this.#createClient();
      try {
        await client.start();
        const results = await client.uploadVideos({
          finalize: true,
          videos: [{ filePath: video.filePath, handle: job?.handle, ...instagramMetadata({ video, campaign, job }) }]
        });
        const published = results?.[0];
        if (!published?.externalId || !published?.url) {
          const error = new Error(`Instagram 게시 결과를 확인하지 못했습니다: ${job?.id || video.filePath}`);
          error.code = 'PUBLISH_STATE_UNCERTAIN';
          throw error;
        }
        return { externalId: published.externalId, externalUrl: published.url, publishedAt: published.publishedAt || new Date().toISOString(), mode: 'live' };
      } finally {
        await client.close().catch(() => undefined);
      }
    });
  }

  async getAnalytics({ job }) {
    return { views: job?.analytics?.views || 0, likes: job?.analytics?.likes || 0, comments: job?.analytics?.comments || 0, fetchedAt: new Date().toISOString(), mode: 'live', status: 'not_supported' };
  }

  async listComments() { return []; }
  async replyComment() { throw new Error('Instagram 실제 댓글 답글 기능은 아직 지원하지 않습니다.'); }
  async hideComment() { throw new Error('Instagram 실제 댓글 숨김 기능은 아직 지원하지 않습니다.'); }

  async #createClient() {
    const initialCookies = await initialCookiesFor(this, 'instagram');
    if (this.clientFactory) return this.clientFactory({ userDataDir: this.userDataDir, browserChannel: this.browserChannel, headless: this.headless, timeoutMs: this.timeoutMs, logger: this.logger, initialCookies });
    const { InstagramClient } = await import('instagram-integration');
    return new InstagramClient({ userDataDir: this.userDataDir, browserChannel: this.browserChannel, headless: this.headless, timeoutMs: this.timeoutMs, logger: this.logger, initialCookies });
  }
}

class FacebookProviderAdapter extends ProviderAdapter {
  constructor(options = {}) {
    super();
    this.userDataDir = path.resolve(
      options.facebookUserDataDir ||
      options.userDataDir ||
      process.env.UPLOAD_DESK_FACEBOOK_PROFILE ||
      path.join(process.cwd(), '.facebook-browser')
    );
    this.browserChannel = options.browserChannel || 'chrome';
    this.headless = options.headless ?? false;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.logger = options.logger || console;
    this.clientFactory = options.clientFactory || null;
    this.initialCookiesProvider = options.initialCookiesProvider || null;
    this.initialCookies = options.initialCookies || [];
  }

  async publish({ video, campaign, job }) {
    if (!video?.filePath) throw new Error('Facebook 실제 게시에는 video.filePath가 필요합니다.');

    return enqueueFacebookPublish(async () => {
      const client = await this.#createClient();
      try {
        await client.start();
        const metadata = facebookMetadata({ video, campaign, job });
        const results = await client.uploadVideos({
          finalize: true,
          videos: [{ filePath: video.filePath, ...metadata }]
        });
        const published = results?.[0];
        if (!published?.externalId || !published?.url) {
          const error = new Error(`Facebook 게시 결과를 확인하지 못했습니다: ${job?.id || video.filePath}`);
          error.code = 'PUBLISH_STATE_UNCERTAIN';
          throw error;
        }
        return { externalId: published.externalId, externalUrl: published.url, publishedAt: published.publishedAt || new Date().toISOString(), mode: 'live' };
      } finally {
        await client.close().catch(() => undefined);
      }
    });
  }

  async getAnalytics({ job }) {
    return { views: job?.analytics?.views || 0, likes: job?.analytics?.likes || 0, comments: job?.analytics?.comments || 0, fetchedAt: new Date().toISOString(), mode: 'live', status: 'not_supported' };
  }

  async listComments() { return []; }
  async replyComment() { throw new Error('Facebook 실제 댓글 답글 기능은 아직 지원하지 않습니다.'); }
  async hideComment() { throw new Error('Facebook 실제 댓글 숨김 기능은 아직 지원하지 않습니다.'); }

  async #createClient() {
    const initialCookies = await initialCookiesFor(this, 'facebook');
    if (this.clientFactory) return this.clientFactory({ userDataDir: this.userDataDir, browserChannel: this.browserChannel, headless: this.headless, timeoutMs: this.timeoutMs, logger: this.logger, initialCookies });
    const { FacebookClient } = await import('facebook-integration');
    return new FacebookClient({ userDataDir: this.userDataDir, browserChannel: this.browserChannel, headless: this.headless, timeoutMs: this.timeoutMs, logger: this.logger, initialCookies });
  }
}

function getProviderAdapter(providerKey, options = {}) {
  const mode = String(
    options.mode || process.env.UPLOAD_DESK_PROVIDER_MODE || 'sandbox'
  ).toLowerCase();
  if (providerKey === 'tiktok' && mode === 'live') {
    return new TikTokProviderAdapter(options);
  }
  if (providerKey === 'naver' && mode === 'live') {
    return new NaverClipProviderAdapter(options);
  }
  if (providerKey === 'instagram' && mode === 'live') {
    return new InstagramProviderAdapter(options);
  }
  if (providerKey === 'facebook' && mode === 'live') {
    return new FacebookProviderAdapter(options);
  }
  return new MockProviderAdapter(providerKey, options);
}

module.exports = {
  PROVIDERS,
  ProviderAdapter,
  MockProviderAdapter,
  TikTokProviderAdapter,
  NaverClipProviderAdapter,
  InstagramProviderAdapter,
  FacebookProviderAdapter,
  getProviderAdapter,
  tiktokCaption,
  tiktokVisibility,
  naverClipMetadata,
  instagramMetadata,
  facebookMetadata
};
