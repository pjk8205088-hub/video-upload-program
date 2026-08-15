const fs = require('node:fs');
const path = require('node:path');
const { AUTH_CONFIG, providerKey } = require('./auth');
const { PROVIDERS, getProviderAdapter } = require('./providers');
const { addJobLog, executeUploadJob } = require('./upload');

const MANUAL_REVIEW_CODES = new Set([
  'PUBLISH_STATE_UNCERTAIN',
  'TIKTOK_LOGIN_REQUIRED',
  'TIKTOK_SECURITY_CHALLENGE',
  'INSTAGRAM_LOGIN_REQUIRED',
  'INSTAGRAM_SECURITY_CHALLENGE',
  'FACEBOOK_LOGIN_REQUIRED',
  'FACEBOOK_SECURITY_CHALLENGE',
  'NAVER_LOGIN_REQUIRED',
  'NAVER_CLIP_PROFILE_REQUIRED'
]);

class SocialEngineError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SocialEngineError';
    this.code = code;
    this.details = details;
  }
}

function socialProviderCatalog() {
  return PROVIDERS.map((provider) => {
    const auth = AUTH_CONFIG[provider.key] || {};
    return {
      ...provider,
      loginUrl: auth.loginUrl || '',
      uploadUrl: auth.uploadUrl || '',
      requiresProvider: auth.requiresProvider || null,
      supportsDirectUpload: true,
      maxSlots: 10
    };
  });
}

function providerDefinition(value) {
  const key = providerKey(value);
  return socialProviderCatalog().find((provider) => provider.key === key) || null;
}

function isManualReviewError(error) {
  return MANUAL_REVIEW_CODES.has(error?.code) || /LoginRequiredError|SecurityChallengeError|ClipProfileRequiredError/.test(String(error?.name || ''));
}

class SocialUploadEngine {
  constructor(options = {}) {
    this.adapterFactory = options.adapterFactory || getProviderAdapter;
    this.adapterOptions = options.adapterOptions || (() => ({}));
    this.filePathResolver = options.filePathResolver || ((video) => video?.filePath || video?.localPath || '');
    this.maxAttempts = options.maxAttempts || 3;
    this.retryBaseMs = options.retryBaseMs || 1000;
    this.now = options.now;
  }

  catalog() {
    return socialProviderCatalog();
  }

  createAdapter(provider, mode = 'sandbox') {
    const definition = providerDefinition(provider);
    if (!definition) throw new SocialEngineError('UNSUPPORTED_PROVIDER', `지원하지 않는 SNS입니다: ${provider}`);
    return this.adapterFactory(definition.key, { ...this.adapterOptions(definition.key, mode), mode });
  }

  async executeJob({ job, video, campaign = {}, mode = 'sandbox' }) {
    const definition = providerDefinition(job?.provider);
    if (!definition) return this.#failPreflight(job, 'UNSUPPORTED_PROVIDER', `지원하지 않는 SNS입니다: ${job?.provider || ''}`);
    if (campaign?.routes?.length) {
      const matchingRoute = campaign.routes.some((route) => route.provider === definition.key && route.accountId === job.accountId && route.videoId === job.videoId);
      if (!matchingRoute) return this.#failPreflight(job, 'PROVIDER_ROUTE_MISMATCH', `${definition.label} 작업과 UI에서 선택한 영상 경로가 일치하지 않습니다.`);
    }

    const filePath = path.resolve(String(this.filePathResolver(video, job, campaign) || ''));
    if (mode === 'live' && (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile())) {
      return this.#failPreflight(job, 'VIDEO_FILE_NOT_FOUND', `${job?.slotNumber || ''}번 동영상 원본 파일을 찾지 못했습니다.`);
    }

    job.provider = definition.key;
    job.mode = mode;
    const publishVideo = { ...(video || {}), filePath };
    return executeUploadJob({
      job,
      video: publishVideo,
      campaign,
      adapterFactory: (provider) => this.createAdapter(provider, mode),
      maxAttempts: this.maxAttempts,
      retryBaseMs: this.retryBaseMs,
      now: this.now,
      terminalErrorPredicate: isManualReviewError
    });
  }

  async getAnalytics(provider, input = {}, mode = 'sandbox') {
    return this.createAdapter(provider, mode).getAnalytics(input);
  }

  async listComments(provider, input = {}, mode = 'sandbox') {
    return this.createAdapter(provider, mode).listComments(input);
  }

  async replyComment(provider, input = {}, mode = 'sandbox') {
    return this.createAdapter(provider, mode).replyComment(input);
  }

  async hideComment(provider, input = {}, mode = 'sandbox') {
    return this.createAdapter(provider, mode).hideComment(input);
  }

  #failPreflight(job = {}, code, message) {
    job.status = 'failed';
    job.progress = 0;
    job.nextRetryAt = null;
    job.lastError = message;
    addJobLog(job, message, 'error');
    return { job, comments: [], error: new SocialEngineError(code, message) };
  }
}

module.exports = {
  MANUAL_REVIEW_CODES,
  SocialEngineError,
  SocialUploadEngine,
  isManualReviewError,
  providerDefinition,
  socialProviderCatalog
};
