const { getProviderAdapter } = require('./providers');

function validSlot(value, maxSlots = 10) {
  const slot = Number(value);
  return Number.isInteger(slot) && slot >= 1 && slot <= maxSlots ? slot : null;
}

function buildUploadRoutes({ body = {}, accounts = [], videos = [], maxSlots = 10 }) {
  const input = Array.isArray(body.routes) ? body.routes.map((route) => ({ ...route })) : [];
  if (!input.length && body.videoId && Array.isArray(body.accountIds)) {
    const video = videos.find((item) => item.id === body.videoId);
    for (const accountId of body.accountIds) {
      const account = accounts.find((item) => item.id === accountId);
      if (account && video) input.push({ accountId, slotNumber: video.slotNumber });
    }
  }
  const routes = [];
  const invalid = [];
  for (const item of input) {
    const account = accounts.find((candidate) => candidate.id === item.accountId);
    const slotNumber = validSlot(item.slotNumber, maxSlots);
    const video = slotNumber ? videos.find((candidate) => candidate.slotNumber === slotNumber) : null;
    if (!account || account.status !== 'connected' || account.authVerified !== true || !slotNumber || !video) {
      invalid.push({ accountId: item.accountId, slotNumber: item.slotNumber, reason: account?.status !== 'connected' ? 'ACCOUNT_NOT_AUTHENTICATED' : undefined });
      continue;
    }
    if (!routes.some((route) => route.accountId === account.id && route.slotNumber === slotNumber)) routes.push({ accountId: account.id, slotNumber, videoId: video.id, provider: account.provider, handle: account.handle });
  }
  return { routes, invalid };
}

function addJobLog(job, message, level = 'info', now = () => new Date().toISOString()) {
  job.logs = Array.isArray(job.logs) ? job.logs : [];
  job.logs.unshift({ message, level, createdAt: now() });
  job.logs = job.logs.slice(0, 30);
}

function selectReadyJobs(campaign, options = {}) {
  const now = options.now ?? Date.now();
  const force = Boolean(options.force);
  return (campaign.jobs || []).filter((job) => {
    if (['published', 'cancelled'].includes(job.status)) return false;
    if (force) return true;
    if (campaign.scheduledAt && new Date(campaign.scheduledAt).getTime() > now) return false;
    return !job.nextRetryAt || new Date(job.nextRetryAt).getTime() <= now;
  });
}

function updateUploadStatus(campaign) {
  const jobs = campaign.jobs || [];
  if (!jobs.length) campaign.status = 'cancelled';
  else if (jobs.every((job) => job.status === 'published')) campaign.status = 'completed';
  else if (jobs.every((job) => ['cancelled', 'failed'].includes(job.status))) campaign.status = jobs.some((job) => job.status === 'failed') ? 'failed' : 'cancelled';
  else if (jobs.some((job) => ['uploading', 'retrying'].includes(job.status))) campaign.status = 'running';
  else campaign.status = 'scheduled';
  campaign.updatedAt = new Date().toISOString();
  return campaign.status;
}

async function executeUploadJob({ job, video, campaign, adapterFactory = getProviderAdapter, maxAttempts = 3, retryBaseMs = 1000, now = () => new Date() }) {
  if (['published', 'cancelled'].includes(job.status)) return { job, comments: [] };
  const nowDate = () => now() instanceof Date ? now() : new Date(now());
  job.status = 'uploading';
  job.progress = 15;
  job.attempt = (job.attempt || 0) + 1;
  job.nextRetryAt = null;
  addJobLog(job, `${job.attempt} upload attempt started`, 'info', () => nowDate().toISOString());
  const adapter = adapterFactory(job.provider);
  try {
    const result = await adapter.publish({ job, video, campaign });
    job.status = 'published';
    job.progress = 100;
    job.externalId = result.externalId;
    job.publishedAt = result.publishedAt;
    job.lastError = null;
    job.analytics = await adapter.getAnalytics({ job, video, campaign });
    addJobLog(job, 'upload completed and analytics collected', 'info', () => nowDate().toISOString());
    const comments = await adapter.listComments({ job, video, campaign });
    return { job, comments: Array.isArray(comments) ? comments : [] };
  } catch (error) {
    job.progress = 0;
    job.lastError = error.message;
    if (job.attempt < (job.maxAttempts || maxAttempts)) {
      const delay = Math.min(retryBaseMs * (2 ** Math.max(job.attempt - 1, 0)), 5 * 60 * 1000);
      job.status = 'retrying';
      job.nextRetryAt = new Date(nowDate().getTime() + delay).toISOString();
      addJobLog(job, `upload failed; retry in ${Math.round(delay / 1000)} seconds: ${error.message}`, 'error', () => nowDate().toISOString());
    } else {
      job.status = 'failed';
      addJobLog(job, `maximum upload attempts reached: ${error.message}`, 'error', () => nowDate().toISOString());
    }
    return { job, comments: [], error };
  }
}

module.exports = { validSlot, buildUploadRoutes, selectReadyJobs, updateUploadStatus, executeUploadJob };
