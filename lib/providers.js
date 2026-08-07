const crypto = require('node:crypto');

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

function getProviderAdapter(providerKey, options = {}) {
  // Replace this registry entry with a production OAuth adapter per provider.
  return new MockProviderAdapter(providerKey, options);
}

module.exports = { PROVIDERS, ProviderAdapter, MockProviderAdapter, getProviderAdapter };
