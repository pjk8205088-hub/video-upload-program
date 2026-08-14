const crypto = require('node:crypto');
const path = require('node:path');

const PROVIDERS = [
  { key: 'naver', label: '네이버', code: 'NV' },
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

function enqueueTikTokPublish(task) {
  const result = tiktokPublishQueue.then(task, task);
  tiktokPublishQueue = result.catch(() => undefined);
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

class TikTokProviderAdapter extends ProviderAdapter {
  constructor(options = {}) {
    super();
    this.userDataDir = path.resolve(
      options.userDataDir ||
      process.env.UPLOAD_DESK_TIKTOK_PROFILE ||
      path.join(process.cwd(), '.tiktok-browser')
    );
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
    if (this.clientFactory) {
      return this.clientFactory({
        userDataDir: this.userDataDir,
        headless: this.headless,
        timeoutMs: this.timeoutMs,
        logger: this.logger
      });
    }
    const { TikTokClient } = await import('tiktok-integration');
    return new TikTokClient({
      userDataDir: this.userDataDir,
      headless: this.headless,
      timeoutMs: this.timeoutMs,
      logger: this.logger
    });
  }
}

function facebookCaption(campaign = {}) {
  const description = String(campaign.description || campaign.title || '').trim();
  const hashtags = Array.isArray(campaign.hashtags)
    ? campaign.hashtags.map((tag) => String(tag || '').trim()).filter(Boolean)
    : [];
  return [description, hashtags.join(' ')].filter(Boolean).join('\n\n');
}

class FacebookProviderAdapter extends ProviderAdapter {
  constructor(options = {}) {
    super();
    this.userDataDir = path.resolve(
      options.userDataDir ||
      process.env.UPLOAD_DESK_FACEBOOK_PROFILE ||
      path.join(process.cwd(), '.facebook-browser')
    );
    this.headless = options.headless ?? false;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.logger = options.logger || console;
    this.clientFactory = options.clientFactory || null;
  }

  async publish({ video, campaign, job }) {
    if (!video?.filePath) {
      throw new Error('Facebook 실제 게시에는 video.filePath가 필요합니다.');
    }

    const client = await this.#createClient();
    try {
      await client.start();
      const results = await client.uploadVideos({
        finalize: true,
        videos: [{ filePath: video.filePath, caption: facebookCaption(campaign) }]
      });
      const published = results?.[0];
      if (published?.status !== 'published') {
        const error = new Error(`Facebook 게시 결과를 확인하지 못했습니다: ${job?.id || video.filePath}`);
        error.code = 'PUBLISH_STATE_UNCERTAIN';
        throw error;
      }
      return {
        externalId: published.externalId,
        externalUrl: published.externalUrl || null,
        publishedAt: published.publishedAt || new Date().toISOString(),
        mode: 'live'
      };
    } finally {
      await client.close().catch(() => undefined);
    }
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
    throw new Error('Facebook 실제 댓글 답글 기능은 아직 지원하지 않습니다.');
  }

  async hideComment() {
    throw new Error('Facebook 실제 댓글 숨김 기능은 아직 지원하지 않습니다.');
  }

  async #createClient() {
    if (this.clientFactory) {
      return this.clientFactory({
        userDataDir: this.userDataDir,
        headless: this.headless,
        timeoutMs: this.timeoutMs,
        logger: this.logger
      });
    }
    const { FacebookClient } = await import('facebook-integration');
    return new FacebookClient({
      userDataDir: this.userDataDir,
      headless: this.headless,
      timeoutMs: this.timeoutMs,
      logger: this.logger
    });
  }
}

function getProviderAdapter(providerKey, options = {}) {
  const mode = String(
    options.mode || process.env.UPLOAD_DESK_PROVIDER_MODE || 'sandbox'
  ).toLowerCase();
  if (providerKey === 'tiktok' && mode === 'live') {
    return new TikTokProviderAdapter(options);
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
  FacebookProviderAdapter,
  TikTokProviderAdapter,
  facebookCaption,
  getProviderAdapter,
  tiktokCaption,
  tiktokVisibility
};
