const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { generateMetadata } = require('./lib/ai');
const { thumbnailSvg } = require('./lib/thumbnail');
const { PROVIDERS, getProviderAdapter } = require('./lib/providers');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
const MAX_SLOTS = 10;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000;
const ALLOWED_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']);
const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv']);
const PROVIDER_KEYS = new Set(PROVIDERS.map((provider) => provider.key));
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon'
};

const DEFAULT_SETTINGS = {
  launchAtStartup: false,
  startMinimized: false,
  autoUpdate: true,
  providerMode: 'sandbox',
  maxAttempts: MAX_ATTEMPTS,
  updatedAt: null
};

function createStore(storageRoot = process.env.UPLOAD_DESK_DATA_DIR || ROOT) {
  const root = path.resolve(storageRoot);
  const dataDir = path.join(root, 'data');
  return {
    root,
    dataDir,
    uploadDir: path.join(root, 'uploads'),
    thumbnailDir: path.join(dataDir, 'thumbnails'),
    files: {
      videos: path.join(dataDir, 'videos.json'),
      accounts: path.join(dataDir, 'accounts.json'),
      campaigns: path.join(dataDir, 'campaigns.json'),
      comments: path.join(dataDir, 'comments.json'),
      logs: path.join(dataDir, 'logs.json'),
      settings: path.join(dataDir, 'settings.json')
    }
  };
}

const defaultStore = createStore();

async function ensureStorage(store = defaultStore) {
  await fsp.mkdir(store.dataDir, { recursive: true });
  await fsp.mkdir(store.uploadDir, { recursive: true });
  await fsp.mkdir(store.thumbnailDir, { recursive: true });
  const defaults = {
    [store.files.videos]: [],
    [store.files.accounts]: [],
    [store.files.campaigns]: [],
    [store.files.comments]: [],
    [store.files.logs]: [],
    [store.files.settings]: DEFAULT_SETTINGS
  };
  for (const [file, value] of Object.entries(defaults)) {
    try { await fsp.access(file); } catch { await fsp.writeFile(file, JSON.stringify(value, null, 2), 'utf8'); }
  }
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}

async function writeJson(file, value) {
  await fsp.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

async function readCollection(store, kind) {
  await ensureStorage(store);
  const value = await readJson(store.files[kind], []);
  return Array.isArray(value) ? value : [];
}

function normalizedHandle(value) {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

async function readAccounts(store) {
  const accounts = await readCollection(store, 'accounts');
  const seen = new Map();
  const normalized = [];
  let changed = false;
  for (const account of accounts) {
    const key = `${account.provider}:${normalizedHandle(account.handle)}`;
    if (seen.has(key)) {
      const existing = seen.get(key);
      existing.slotNumbers = [...new Set([...(existing.slotNumbers || []), ...(account.slotNumbers || [])])].sort((a, b) => a - b);
      if (account.status === 'connected' && account.authVerified === true) Object.assign(existing, { ...account, id: existing.id, slotNumbers: existing.slotNumbers });
      changed = true;
      continue;
    }
    const next = { ...account };
    if (next.status === 'connected' && next.authVerified !== true) {
      next.status = 'login_required';
      next.authVerified = false;
      next.mode = 'oauth_pending';
      changed = true;
    }
    seen.set(key, next);
    normalized.push(next);
  }
  if (changed) await writeCollection(store, 'accounts', normalized);
  return normalized;
}

async function writeCollection(store, kind, value) {
  await ensureStorage(store);
  await writeJson(store.files[kind], value);
}

async function readSettings(store) {
  await ensureStorage(store);
  return { ...DEFAULT_SETTINGS, ...(await readJson(store.files.settings, {})) };
}

function createId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}`;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function cleanText(value, fallback = '', max = 1000) {
  return String(value ?? fallback).trim().slice(0, max);
}

function cleanNaverClipMetadata(value) {
  if (!value || typeof value !== 'object') return null;
  return { title: cleanText(value.title, '', 80), description: cleanText(value.description, '', 300), hashtags: Array.isArray(value.hashtags) ? value.hashtags.map((tag) => cleanText(tag, '', 40)).filter(Boolean).slice(0, 8) : [], primaryCategory: cleanText(value.primaryCategory, '라이프 이벤트', 40), secondaryCategory: cleanText(value.secondaryCategory, '라이프 이벤트', 40), publicEnabled: value.publicEnabled !== false, scheduleRegistration: Boolean(value.scheduleRegistration), schedulePrivate: Boolean(value.schedulePrivate), country: value.country === 'kr' ? 'kr' : 'all', commentsAllowed: value.commentsAllowed === 'deny' ? 'deny' : 'allow' };
}

function cleanInstagramMetadata(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    caption: cleanText(value.caption, '', 2200),
    hashtags: Array.isArray(value.hashtags) ? value.hashtags.map((tag) => cleanText(tag, '', 40)).filter(Boolean).slice(0, 30) : [],
    shareToFeed: value.shareToFeed !== false,
    allowComments: value.allowComments !== false
  };
}

function validSlot(value) {
  const slot = Number(value);
  return Number.isInteger(slot) && slot >= 1 && slot <= MAX_SLOTS ? slot : null;
}

function safeFileName(value) {
  let decoded = String(value || 'video.mp4');
  try { decoded = decodeURIComponent(decoded); } catch {}
  return decoded.normalize('NFKC').replace(/[^a-zA-Z0-9._-\u3131-\uD79D]/g, '_').slice(-120) || 'video.mp4';
}

function extensionFor(fileName) { return path.extname(fileName).toLowerCase(); }

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

function sendError(res, status, message, code, extra = {}) {
  sendJson(res, status, { error: { code, message, ...extra } });
}

async function readRequestBody(req, maxBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error('Request too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!total) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 }); }
}

async function appendLog(store, event, message, meta = {}) {
  const logs = await readCollection(store, 'logs');
  logs.unshift({ id: createId('log_'), event, message, meta, createdAt: new Date().toISOString() });
  await writeCollection(store, 'logs', logs.slice(0, 500));
}

function addJobLog(job, message, level = 'info') {
  job.logs = Array.isArray(job.logs) ? job.logs : [];
  job.logs.unshift({ message, level, createdAt: new Date().toISOString() });
  job.logs = job.logs.slice(0, 30);
}

function updateCampaignStatus(campaign) {
  const jobs = campaign.jobs || [];
  if (!jobs.length) { campaign.status = 'cancelled'; return campaign.status; }
  if (jobs.every((job) => job.status === 'published')) campaign.status = 'completed';
  else if (jobs.every((job) => ['cancelled', 'failed'].includes(job.status))) campaign.status = jobs.some((job) => job.status === 'failed') ? 'failed' : 'cancelled';
  else if (jobs.some((job) => ['uploading', 'retrying'].includes(job.status))) campaign.status = 'running';
  else campaign.status = 'scheduled';
  campaign.updatedAt = new Date().toISOString();
  return campaign.status;
}

async function cancelJobsForVideo(store, videoId, campaigns) {
  let changed = false;
  for (const campaign of campaigns) {
    for (const job of campaign.jobs || []) {
      if (job.videoId === videoId && !['published', 'cancelled'].includes(job.status)) {
        job.status = 'cancelled';
        job.lastError = '원본 영상이 삭제 또는 교체되어 취소되었습니다.';
        addJobLog(job, job.lastError, 'warning');
        changed = true;
      }
    }
    updateCampaignStatus(campaign);
  }
  if (changed) await writeCollection(store, 'campaigns', campaigns);
}

async function handleUpload(store, req, res) {
  const fileName = safeFileName(req.headers['x-file-name']);
  const fileType = String(req.headers['x-file-type'] || req.headers['content-type'] || '').split(';')[0];
  const declaredSize = Number(req.headers['x-file-size'] || req.headers['content-length'] || 0);
  const extension = extensionFor(fileName);
  const requestedSlot = req.headers['x-slot-number'] ? validSlot(req.headers['x-slot-number']) : null;
  const replace = String(req.headers['x-replace'] || '').toLowerCase() === 'true';
  if (!ALLOWED_EXTENSIONS.has(extension) || (fileType && !ALLOWED_TYPES.has(fileType))) return sendError(res, 415, 'MP4, MOV, WebM, MKV 동영상만 업로드할 수 있습니다.', 'UNSUPPORTED_VIDEO');
  if (!Number.isFinite(declaredSize) || declaredSize <= 0 || declaredSize > MAX_FILE_SIZE) return sendError(res, 413, `파일 크기는 2 GB 이하여야 합니다. 현재 파일: ${formatBytes(declaredSize || 0)}`, 'FILE_TOO_LARGE');
  if (req.headers['x-slot-number'] && !requestedSlot) return sendError(res, 400, '슬롯 번호는 1부터 10까지 입력해야 합니다.', 'INVALID_SLOT');

  const videos = await readCollection(store, 'videos');
  const slotNumber = requestedSlot || Array.from({ length: MAX_SLOTS }, (_, index) => index + 1).find((slot) => !videos.some((video) => video.slotNumber === slot));
  if (!slotNumber) return sendError(res, 409, '10개 슬롯이 모두 사용 중입니다. 기존 영상을 교체하거나 삭제해 주세요.', 'SLOT_LIMIT_REACHED');
  const existing = videos.find((video) => video.slotNumber === slotNumber);
  if (existing && !replace) return sendError(res, 409, `${slotNumber}번 슬롯에 이미 영상이 있습니다. 교체 옵션을 사용해 주세요.`, 'SLOT_OCCUPIED', { slotNumber, videoId: existing.id });

  await ensureStorage(store);
  const id = createId('vid_');
  const storedName = `${id}${extension}`;
  const targetPath = path.join(store.uploadDir, storedName);
  const writeStream = fs.createWriteStream(targetPath, { flags: 'wx' });
  let received = 0;
  let rejected = false;
  req.on('data', (chunk) => {
    received += chunk.length;
    if (received > MAX_FILE_SIZE && !rejected) { rejected = true; req.destroy(); }
  });
  try {
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      req.on('error', reject);
      req.pipe(writeStream);
    });
    if (rejected || received !== declaredSize) {
      await fsp.rm(targetPath, { force: true });
      return sendError(res, 400, '업로드된 파일 크기를 확인할 수 없습니다. 다시 시도해 주세요.', 'INCOMPLETE_UPLOAD');
    }
    const aiMetadata = await generateMetadata({ fileName, slotNumber });
    const thumbnailName = `${id}.svg`;
    await fsp.writeFile(path.join(store.thumbnailDir, thumbnailName), thumbnailSvg({ title: aiMetadata.title, slotNumber, hashtags: aiMetadata.hashtags }), 'utf8');
    const video = {
      id, slotNumber, originalName: fileName, storedName, mimeType: fileType || 'application/octet-stream', size: received, sizeLabel: formatBytes(received), status: 'ready', createdAt: new Date().toISOString(), url: `/uploads/${storedName}`, thumbnailUrl: `/thumbnails/${thumbnailName}`, aiMetadata
    };
    const nextVideos = videos.filter((item) => item.slotNumber !== slotNumber);
    nextVideos.unshift(video);
    if (existing) {
      await fsp.rm(path.join(store.uploadDir, existing.storedName), { force: true });
      await fsp.rm(path.join(store.thumbnailDir, path.basename(existing.thumbnailUrl || '')), { force: true });
      await cancelJobsForVideo(store, existing.id, await readCollection(store, 'campaigns'));
    }
    await writeCollection(store, 'videos', nextVideos);
    await appendLog(store, existing ? 'video.replaced' : 'video.uploaded', `${slotNumber}번 슬롯 영상 저장`, { slotNumber, videoId: id, originalName: fileName });
    return sendJson(res, 201, { video, replacedVideoId: existing?.id || null });
  } catch (error) {
    await fsp.rm(targetPath, { force: true });
    if (!res.headersSent) sendError(res, 500, '업로드 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.', 'UPLOAD_FAILED', { detail: error.message });
  }
}

async function handleDeleteVideo(store, res, id) {
  const videos = await readCollection(store, 'videos');
  const video = videos.find((item) => item.id === id);
  if (!video) return sendError(res, 404, '동영상을 찾을 수 없습니다.', 'VIDEO_NOT_FOUND');
  await fsp.rm(path.join(store.uploadDir, video.storedName), { force: true });
  await fsp.rm(path.join(store.thumbnailDir, path.basename(video.thumbnailUrl || '')), { force: true });
  await writeCollection(store, 'videos', videos.filter((item) => item.id !== id));
  await cancelJobsForVideo(store, id, await readCollection(store, 'campaigns'));
  await appendLog(store, 'video.deleted', `${video.slotNumber}번 슬롯 영상 삭제`, { slotNumber: video.slotNumber, videoId: id });
  return sendJson(res, 200, { deleted: id, slotNumber: video.slotNumber });
}

async function createAccount(store, req, res) {
  const body = await readRequestBody(req);
  const provider = cleanText(body.provider).toLowerCase();
  const displayName = cleanText(body.displayName, '', 120);
  const handle = cleanText(body.handle, '', 160);
  if (!PROVIDER_KEYS.has(provider)) return sendError(res, 400, '지원하지 않는 SNS입니다.', 'UNSUPPORTED_PROVIDER');
  if (!displayName || !handle) return sendError(res, 400, '계정 이름과 아이디를 입력해 주세요.', 'ACCOUNT_FIELDS_REQUIRED');
  const accounts = await readAccounts(store);
  if (provider === 'tiktok' && !accounts.some((account) => account.provider === 'facebook' && account.status === 'connected' && account.authVerified === true)) return sendError(res, 400, 'TikTok은 Facebook 로그인 후 연결할 수 있습니다.', 'FACEBOOK_LOGIN_REQUIRED');
  if (body.authVerified !== true) return sendError(res, 401, '공식 로그인에 성공한 뒤 계정을 연결해 주세요.', 'ACCOUNT_AUTH_REQUIRED');
  const existing = accounts.find((account) => account.provider === provider && normalizedHandle(account.handle) === normalizedHandle(handle));
  if (existing) {
    existing.displayName = displayName;
    existing.handle = handle;
    existing.status = 'connected';
    existing.authVerified = true;
    existing.mode = 'oauth';
    existing.connectedAt = new Date().toISOString();
    existing.updatedAt = existing.connectedAt;
    await writeCollection(store, 'accounts', accounts);
    await appendLog(store, 'account.reconnected', `${displayName} 계정 로그인 확인`, { provider, accountId: existing.id });
    return sendJson(res, 200, { account: existing, existing: true });
  }
  const account = { id: createId('acct_'), provider, displayName, handle, status: 'connected', authVerified: true, mode: 'oauth', slotNumbers: [], connectedAt: new Date().toISOString() };
  accounts.unshift(account);
  await writeCollection(store, 'accounts', accounts);
  await appendLog(store, 'account.connected', `${displayName} 계정 연결`, { provider, accountId: account.id });
  return sendJson(res, 201, { account });
}

async function updateAccountRouting(store, req, res, id) {
  const body = await readRequestBody(req);
  const slotNumbers = [...new Set((Array.isArray(body.slotNumbers) ? body.slotNumbers : []).map(validSlot).filter(Boolean))].sort((a, b) => a - b);
  const accounts = await readAccounts(store);
  const account = accounts.find((item) => item.id === id);
  if (!account) return sendError(res, 404, '연결된 계정을 찾을 수 없습니다.', 'ACCOUNT_NOT_FOUND');
  account.slotNumbers = slotNumbers;
  account.updatedAt = new Date().toISOString();
  await writeCollection(store, 'accounts', accounts);
  await appendLog(store, 'route.updated', `${account.handle} 라우팅 번호 변경`, { accountId: id, slotNumbers });
  return sendJson(res, 200, { account });
}

async function deleteAccount(store, res, id) {
  const accounts = await readAccounts(store);
  const account = accounts.find((item) => item.id === id);
  if (!account) return sendError(res, 404, '연결된 계정을 찾을 수 없습니다.', 'ACCOUNT_NOT_FOUND');
  await writeCollection(store, 'accounts', accounts.filter((item) => item.id !== id));
  await appendLog(store, 'account.deleted', `${account.handle} 연결 해제`, { accountId: id });
  return sendJson(res, 200, { deleted: id });
}

function buildRoutes(body, accounts, videos) {
  const input = Array.isArray(body.routes) ? body.routes : [];
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
    const slotNumber = validSlot(item.slotNumber);
    const video = slotNumber ? videos.find((candidate) => candidate.slotNumber === slotNumber) : null;
    if (!account || account.status !== 'connected' || account.authVerified !== true || !slotNumber || !video) { invalid.push({ accountId: item.accountId, slotNumber: item.slotNumber, reason: account?.status !== 'connected' ? 'ACCOUNT_NOT_AUTHENTICATED' : undefined }); continue; }
    if (!routes.some((route) => route.accountId === account.id && route.slotNumber === slotNumber)) routes.push({ accountId: account.id, slotNumber, videoId: video.id, provider: account.provider, handle: account.handle });
  }
  return { routes, invalid };
}

function existingRouteKeys(campaigns) {
  return new Set(campaigns.flatMap((campaign) => (campaign.jobs || []).filter((job) => job.status !== 'cancelled').map((job) => `${job.videoId}:${job.accountId}`)));
}

async function createCampaign(store, req, res) {
  const body = await readRequestBody(req);
  const accounts = await readAccounts(store);
  const videos = await readCollection(store, 'videos');
  const campaigns = await readCollection(store, 'campaigns');
  const { routes, invalid } = buildRoutes(body, accounts, videos);
  if (!routes.length) return sendError(res, 400, '영상 슬롯 번호와 업로드 대상 계정을 선택해 주세요.', 'ROUTES_REQUIRED', { invalid });
  const parsedSchedule = new Date(body.scheduledAt);
  if (Number.isNaN(parsedSchedule.getTime())) return sendError(res, 400, '예약 시각을 확인해 주세요.', 'SCHEDULE_REQUIRED');
  const keys = existingRouteKeys(campaigns);
  const skippedRoutes = routes.filter((route) => keys.has(`${route.videoId}:${route.accountId}`));
  const acceptedRoutes = routes.filter((route) => !keys.has(`${route.videoId}:${route.accountId}`));
  if (!acceptedRoutes.length) return sendError(res, 409, '선택한 영상과 계정 조합은 이미 업로드 또는 예약되어 있습니다.', 'DUPLICATE_ROUTES', { skippedRoutes });
  const firstVideo = videos.find((video) => video.id === acceptedRoutes[0].videoId);
  const metadata = firstVideo?.aiMetadata || {};
  const naverClip = cleanNaverClipMetadata(body.naverClip || metadata.naverClip);
  const instagram = cleanInstagramMetadata(body.instagram || metadata.instagram);
  const title = cleanText(body.title || metadata.title, '새 콘텐츠', 120);
  const description = cleanText(body.description || metadata.description, '', 1000);
  const hashtags = Array.isArray(body.hashtags) ? body.hashtags.map((tag) => cleanText(tag, '', 40)).filter(Boolean).slice(0, 12) : (metadata.hashtags || []);
  const campaign = {
    id: createId('cmp_'), title, description, hashtags, privacy: cleanText(body.privacy, 'public', 20), scheduledAt: parsedSchedule.toISOString(), status: 'scheduled', mode: 'sandbox', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), routes: acceptedRoutes, skippedRoutes,
    jobs: acceptedRoutes.map((route) => ({ id: createId('job_'), accountId: route.accountId, provider: route.provider, handle: route.handle, slotNumber: route.slotNumber, videoId: route.videoId, clipMetadata: route.provider === 'naver' ? naverClip : null, instagramMetadata: route.provider === 'instagram' ? instagram : null, status: 'queued', progress: 0, attempt: 0, maxAttempts: MAX_ATTEMPTS, nextRetryAt: parsedSchedule.toISOString(), lastError: null, analytics: null, logs: [{ message: '예약 작업 생성', level: 'info', createdAt: new Date().toISOString() }] }))
  };
  campaigns.unshift(campaign);
  await writeCollection(store, 'campaigns', campaigns);
  await appendLog(store, 'campaign.created', `${campaign.jobs.length}개 라우트 예약`, { campaignId: campaign.id, routes: campaign.routes });
  return sendJson(res, 201, { campaign, skippedRoutes, invalid });
}

async function runJob(store, campaign, job, video) {
  if (['published', 'cancelled'].includes(job.status)) return job;
  job.status = 'uploading';
  job.progress = 15;
  job.attempt = (job.attempt || 0) + 1;
  job.nextRetryAt = null;
  addJobLog(job, `${job.attempt}회차 sandbox 전송 시작`);
  const adapter = getProviderAdapter(job.provider);
  try {
    const result = await adapter.publish({ job, video, campaign });
    job.status = 'published';
    job.progress = 100;
    job.externalId = result.externalId;
    job.publishedAt = result.publishedAt;
    job.lastError = null;
    job.analytics = await adapter.getAnalytics({ job, video, campaign });
    addJobLog(job, '게시 완료 · 통계 수집 완료');
    const comments = await readCollection(store, 'comments');
    const mockComments = await adapter.listComments({ job, video, campaign });
    for (const item of mockComments) {
      if (!comments.some((comment) => comment.externalId === item.externalId)) comments.unshift({ id: createId('comment_'), jobId: job.id, accountId: job.accountId, provider: job.provider, handle: job.handle, externalId: item.externalId, authorName: item.authorName, text: item.text, status: item.status, replies: item.replies || [], createdAt: item.createdAt, updatedAt: item.createdAt });
    }
    await writeCollection(store, 'comments', comments);
  } catch (error) {
    job.progress = 0;
    job.lastError = error.message;
    if (job.attempt < (job.maxAttempts || MAX_ATTEMPTS)) {
      const delay = Math.min(RETRY_BASE_MS * (2 ** Math.max(job.attempt - 1, 0)), 5 * 60 * 1000);
      job.status = 'retrying';
      job.nextRetryAt = new Date(Date.now() + delay).toISOString();
      addJobLog(job, `전송 실패 · ${Math.round(delay / 1000)}초 후 재시도: ${error.message}`, 'error');
    } else {
      job.status = 'failed';
      addJobLog(job, `최대 재시도 횟수 초과: ${error.message}`, 'error');
    }
  }
  return job;
}

async function runCampaign(store, id, force = false) {
  const campaigns = await readCollection(store, 'campaigns');
  const campaign = campaigns.find((item) => item.id === id);
  if (!campaign) return null;
  const videos = await readCollection(store, 'videos');
  const now = Date.now();
  const readyJobs = (campaign.jobs || []).filter((job) => {
    if (['published', 'cancelled'].includes(job.status)) return false;
    if (force) return true;
    if (campaign.scheduledAt && new Date(campaign.scheduledAt).getTime() > now) return false;
    return !job.nextRetryAt || new Date(job.nextRetryAt).getTime() <= now;
  });
  if (!readyJobs.length) return campaign;
  campaign.status = 'running';
  await writeCollection(store, 'campaigns', campaigns);
  await Promise.all(readyJobs.map((job) => runJob(store, campaign, job, videos.find((video) => video.id === job.videoId))));
  updateCampaignStatus(campaign);
  await writeCollection(store, 'campaigns', campaigns);
  await appendLog(store, 'campaign.processed', `${campaign.title} 작업 처리`, { campaignId: id, jobs: readyJobs.map((job) => ({ id: job.id, status: job.status, attempt: job.attempt })) });
  return campaign;
}

async function retryJob(store, res, id) {
  const campaigns = await readCollection(store, 'campaigns');
  const campaign = campaigns.find((item) => (item.jobs || []).some((job) => job.id === id));
  if (!campaign) return sendError(res, 404, '재시도할 작업을 찾을 수 없습니다.', 'JOB_NOT_FOUND');
  const job = campaign.jobs.find((item) => item.id === id);
  if (job.status === 'published') return sendError(res, 409, '이미 게시된 작업은 중복 방지를 위해 재시도할 수 없습니다.', 'JOB_ALREADY_PUBLISHED');
  job.status = 'queued'; job.nextRetryAt = new Date().toISOString(); job.lastError = null;
  addJobLog(job, '사용자가 수동 재시도를 요청했습니다.');
  await writeCollection(store, 'campaigns', campaigns);
  const processed = await runCampaign(store, campaign.id, true);
  return sendJson(res, 200, { campaign: processed, job: processed.jobs.find((item) => item.id === id) });
}

async function refreshAnalytics(store) {
  const campaigns = await readCollection(store, 'campaigns');
  for (const campaign of campaigns) {
    for (const job of campaign.jobs || []) {
      if (job.status !== 'published') continue;
      job.analytics = await getProviderAdapter(job.provider).getAnalytics({ job });
    }
  }
  await writeCollection(store, 'campaigns', campaigns);
  await appendLog(store, 'analytics.refreshed', '게시 통계를 갱신했습니다.');
  return campaigns;
}

async function handleCommentAction(store, req, res, id, action) {
  const comments = await readCollection(store, 'comments');
  const comment = comments.find((item) => item.id === id);
  if (!comment) return sendError(res, 404, '댓글을 찾을 수 없습니다.', 'COMMENT_NOT_FOUND');
  const campaigns = await readCollection(store, 'campaigns');
  const job = campaigns.flatMap((campaign) => campaign.jobs || []).find((item) => item.id === comment.jobId);
  const adapter = getProviderAdapter(comment.provider);
  if (action === 'reply') {
    const body = await readRequestBody(req);
    const text = cleanText(body.text, '', 500);
    if (!text) return sendError(res, 400, '답글 내용을 입력해 주세요.', 'REPLY_REQUIRED');
    const reply = await adapter.replyComment({ comment, text, job });
    comment.replies = Array.isArray(comment.replies) ? comment.replies : [];
    comment.replies.unshift({ ...reply, id: createId('reply_'), authorName: '업로드 관리자' });
  } else {
    comment.status = action === 'hide' ? (await adapter.hideComment({ comment, job })).status : 'visible';
  }
  comment.updatedAt = new Date().toISOString();
  await writeCollection(store, 'comments', comments);
  await appendLog(store, `comment.${action}`, `댓글 ${action === 'reply' ? '답글' : action} 처리`, { commentId: id });
  return sendJson(res, 200, { comment });
}

async function serveStatic(req, res, pathname, store) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const requested = path.resolve(PUBLIC_DIR, relative);
  if (!requested.startsWith(`${PUBLIC_DIR}${path.sep}`)) return sendError(res, 403, '접근할 수 없습니다.', 'FORBIDDEN');
  try {
    const stat = await fsp.stat(requested);
    if (!stat.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(requested).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(requested).pipe(res);
  } catch { sendError(res, 404, '페이지를 찾을 수 없습니다.', 'NOT_FOUND'); }
}

async function serveStoredFile(res, pathname, directory, contentType) {
  const fileName = path.basename(pathname);
  const target = path.resolve(directory, fileName);
  if (!target.startsWith(`${path.resolve(directory)}${path.sep}`)) return sendError(res, 403, '접근할 수 없습니다.', 'FORBIDDEN');
  try {
    const stat = await fsp.stat(target);
    res.writeHead(200, { 'Content-Type': contentType || MIME_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-cache' });
    fs.createReadStream(target).pipe(res);
  } catch { sendError(res, 404, '파일을 찾을 수 없습니다.', 'FILE_NOT_FOUND'); }
}

function startScheduler(store, intervalMs = 15000) {
  const timer = setInterval(() => {
    readCollection(store, 'campaigns').then(async (campaigns) => {
      for (const campaign of campaigns) {
        const due = campaign.jobs?.some((job) => ['queued', 'retrying'].includes(job.status) && (!job.nextRetryAt || new Date(job.nextRetryAt).getTime() <= Date.now()));
        if (due && new Date(campaign.scheduledAt).getTime() <= Date.now()) await runCampaign(store, campaign.id);
      }
    }).catch(() => {});
  }, intervalMs);
  timer.unref?.();
  return timer;
}

function createServer(options = {}) {
  const store = options.store || createStore(options.dataDir || process.env.UPLOAD_DESK_DATA_DIR || ROOT);
  const server = http.createServer(async (req, res) => {
    try {
      await ensureStorage(store);
      const requestUrl = new URL(req.url, 'http://localhost');
      const { pathname, searchParams } = requestUrl;
      if (req.method === 'GET' && pathname === '/health') return sendJson(res, 200, { ok: true, mode: 'sandbox' });
      if (req.method === 'GET' && pathname === '/api/videos') return sendJson(res, 200, { videos: await readCollection(store, 'videos'), maxSlots: MAX_SLOTS });
      if (req.method === 'POST' && pathname === '/api/videos') return handleUpload(store, req, res);
      const videoMatch = pathname.match(/^\/api\/videos\/([^/]+)$/);
      if (req.method === 'DELETE' && videoMatch) return handleDeleteVideo(store, res, videoMatch[1]);
      if (req.method === 'GET' && pathname === '/api/accounts') return sendJson(res, 200, { accounts: await readAccounts(store), providers: PROVIDERS });
      if (req.method === 'POST' && pathname === '/api/accounts') return createAccount(store, req, res);
      const accountRoutingMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/routing$/);
      if (req.method === 'PUT' && accountRoutingMatch) return updateAccountRouting(store, req, res, accountRoutingMatch[1]);
      const accountMatch = pathname.match(/^\/api\/accounts\/([^/]+)$/);
      if (req.method === 'DELETE' && accountMatch) return deleteAccount(store, res, accountMatch[1]);
      if (req.method === 'GET' && pathname === '/api/campaigns') return sendJson(res, 200, { campaigns: await readCollection(store, 'campaigns') });
      if (req.method === 'POST' && pathname === '/api/campaigns') return createCampaign(store, req, res);
      const campaignRunMatch = pathname.match(/^\/api\/campaigns\/([^/]+)\/run$/);
      if (req.method === 'POST' && campaignRunMatch) {
        const campaign = await runCampaign(store, campaignRunMatch[1], true);
        return campaign ? sendJson(res, 200, { campaign }) : sendError(res, 404, '예약 작업을 찾을 수 없습니다.', 'CAMPAIGN_NOT_FOUND');
      }
      const campaignMatch = pathname.match(/^\/api\/campaigns\/([^/]+)$/);
      if (req.method === 'DELETE' && campaignMatch) {
        const campaigns = await readCollection(store, 'campaigns');
        if (!campaigns.some((campaign) => campaign.id === campaignMatch[1])) return sendError(res, 404, '예약 작업을 찾을 수 없습니다.', 'CAMPAIGN_NOT_FOUND');
        const campaign = campaigns.find((item) => item.id === campaignMatch[1]);
        for (const job of campaign.jobs || []) { if (job.status !== 'published') { job.status = 'cancelled'; addJobLog(job, '예약 작업이 취소되었습니다.', 'warning'); } }
        updateCampaignStatus(campaign); await writeCollection(store, 'campaigns', campaigns); await appendLog(store, 'campaign.cancelled', '예약 작업 취소', { campaignId: campaign.id });
        return sendJson(res, 200, { cancelled: campaign.id, campaign });
      }
      const jobRetryMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/retry$/);
      if (req.method === 'POST' && jobRetryMatch) return retryJob(store, res, jobRetryMatch[1]);
      if (req.method === 'GET' && pathname === '/api/analytics') {
        const campaigns = await readCollection(store, 'campaigns');
        const jobs = campaigns.flatMap((campaign) => (campaign.jobs || []).map((job) => ({ ...job, campaignId: campaign.id, campaignTitle: campaign.title })));
        return sendJson(res, 200, { jobs, totals: { views: jobs.reduce((sum, job) => sum + (job.analytics?.views || 0), 0), likes: jobs.reduce((sum, job) => sum + (job.analytics?.likes || 0), 0), comments: jobs.reduce((sum, job) => sum + (job.analytics?.comments || 0), 0) } });
      }
      if (req.method === 'POST' && pathname === '/api/analytics/refresh') return sendJson(res, 200, { campaigns: await refreshAnalytics(store) });
      if (req.method === 'POST' && pathname === '/api/ai/generate') {
        const body = await readRequestBody(req);
        const videos = await readCollection(store, 'videos');
        const video = videos.find((item) => item.id === body.videoId) || videos.find((item) => item.slotNumber === validSlot(body.slotNumber));
        if (!video) return sendError(res, 404, 'AI 초안을 만들 영상을 찾을 수 없습니다.', 'VIDEO_NOT_FOUND');
        const metadata = await generateMetadata({ fileName: video.originalName, slotNumber: video.slotNumber, titleHint: body.titleHint, provider: body.provider });
        video.aiMetadata = metadata;
        await fsp.writeFile(path.join(store.thumbnailDir, path.basename(video.thumbnailUrl || `${video.id}.svg`)), thumbnailSvg({ title: metadata.title, slotNumber: video.slotNumber, hashtags: metadata.hashtags }), 'utf8');
        await writeCollection(store, 'videos', videos);
        await appendLog(store, 'ai.metadata.generated', `${video.slotNumber}번 영상 제목·설명 초안 생성`, { videoId: video.id, source: metadata.source });
        return sendJson(res, 200, { metadata, video });
      }
      if (req.method === 'GET' && pathname === '/api/comments') return sendJson(res, 200, { comments: await readCollection(store, 'comments') });
      const commentReplyMatch = pathname.match(/^\/api\/comments\/([^/]+)\/reply$/);
      if (req.method === 'POST' && commentReplyMatch) return handleCommentAction(store, req, res, commentReplyMatch[1], 'reply');
      const commentActionMatch = pathname.match(/^\/api\/comments\/([^/]+)$/);
      if (req.method === 'PATCH' && commentActionMatch) {
        const body = await readRequestBody(req);
        return handleCommentAction(store, { ...req, body }, res, commentActionMatch[1], body.action === 'unhide' ? 'unhide' : 'hide');
      }
      if (req.method === 'GET' && pathname === '/api/logs') {
        const limit = Math.min(Number(searchParams.get('limit') || 80), 200);
        return sendJson(res, 200, { logs: (await readCollection(store, 'logs')).slice(0, limit) });
      }
      if (req.method === 'GET' && pathname === '/api/settings') return sendJson(res, 200, { settings: await readSettings(store) });
      if (req.method === 'PUT' && pathname === '/api/settings') {
        const body = await readRequestBody(req);
        const settings = await readSettings(store);
        for (const key of ['launchAtStartup', 'startMinimized', 'autoUpdate']) if (typeof body[key] === 'boolean') settings[key] = body[key];
        settings.updatedAt = new Date().toISOString(); await writeJson(store.files.settings, settings); await appendLog(store, 'settings.updated', '앱 설정 변경', settings);
        return sendJson(res, 200, { settings });
      }
      if (req.method === 'GET' && pathname.startsWith('/uploads/')) return serveStoredFile(res, pathname, store.uploadDir, 'video/*');
      if (req.method === 'GET' && pathname.startsWith('/thumbnails/')) return serveStoredFile(res, pathname, store.thumbnailDir, 'image/svg+xml; charset=utf-8');
      if (req.method === 'GET') return serveStatic(req, res, pathname, store);
      return sendError(res, 405, '지원하지 않는 요청입니다.', 'METHOD_NOT_ALLOWED');
    } catch (error) {
      console.error(error);
      if (!res.headersSent) sendError(res, error.statusCode || 500, error.statusCode === 413 ? '요청 데이터가 너무 큽니다.' : '서버 오류가 발생했습니다.', error.statusCode === 413 ? 'REQUEST_TOO_LARGE' : 'INTERNAL_ERROR');
    }
  });
  if (options.scheduler !== false) server.scheduler = startScheduler(store, options.schedulerIntervalMs || 15000);
  server.store = store;
  const close = server.close.bind(server);
  server.close = (callback) => { if (server.scheduler) clearInterval(server.scheduler); return close(callback); };
  return server;
}

if (require.main === module) {
  const port = Number(process.argv[2] || process.env.PORT || 3000);
  const store = defaultStore;
  ensureStorage(store).then(() => createServer({ store }).listen(port, '127.0.0.1', () => console.log(`동영상 업로드 프로그램: http://localhost:${port}`)));
}

module.exports = { createServer, createStore, ensureStorage, formatBytes, MAX_FILE_SIZE, MAX_SLOTS, MAX_ATTEMPTS, RETRY_BASE_MS };
