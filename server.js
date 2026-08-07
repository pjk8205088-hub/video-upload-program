const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const STORAGE_ROOT = process.env.UPLOAD_DESK_DATA_DIR || ROOT;
const DATA_DIR = path.join(STORAGE_ROOT, 'data');
const UPLOAD_DIR = path.join(STORAGE_ROOT, 'uploads');
const VIDEO_DB = path.join(DATA_DIR, 'videos.json');
const ACCOUNT_DB = path.join(DATA_DIR, 'accounts.json');
const CAMPAIGN_DB = path.join(DATA_DIR, 'campaigns.json');
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']);
const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv']);
const ALLOWED_PROVIDERS = new Set(['youtube', 'naver', 'tiktok', 'facebook', 'instagram']);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

async function ensureStorage() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  for (const file of [VIDEO_DB, ACCOUNT_DB, CAMPAIGN_DB]) {
    try { await fsp.access(file); } catch { await fsp.writeFile(file, '[]', 'utf8'); }
  }
}

async function readVideos() {
  await ensureStorage();
  try {
    const data = JSON.parse(await fsp.readFile(VIDEO_DB, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writeVideos(videos) {
  await fsp.writeFile(VIDEO_DB, JSON.stringify(videos, null, 2), 'utf8');
}

async function readJsonCollection(file) {
  await ensureStorage();
  try {
    const data = JSON.parse(await fsp.readFile(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

async function writeJsonCollection(file, collection) {
  await fsp.writeFile(file, JSON.stringify(collection, null, 2), 'utf8');
}

async function readRequestBody(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error('Request too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!total) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 }); }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendError(res, status, message, code) {
  sendJson(res, status, { error: { code, message } });
}

function safeFileName(value) {
  let decoded = String(value || 'video.mp4');
  try { decoded = decodeURIComponent(decoded); } catch {}
  const normalized = decoded.normalize('NFKC').replace(/[^a-zA-Z0-9._-]/g, '_');
  return normalized.slice(-120) || 'video.mp4';
}

function extensionFor(fileName) {
  return path.extname(fileName).toLowerCase();
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function createId() {
  return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function cleanText(value, fallback = '') {
  return String(value ?? fallback).trim().slice(0, 500);
}

async function createAccount(req, res) {
  const body = await readRequestBody(req);
  const provider = cleanText(body.provider).toLowerCase();
  const displayName = cleanText(body.displayName);
  const handle = cleanText(body.handle);
  if (!ALLOWED_PROVIDERS.has(provider)) return sendError(res, 400, '지원하지 않는 SNS입니다.', 'UNSUPPORTED_PROVIDER');
  if (!displayName || !handle) return sendError(res, 400, '계정 이름과 아이디를 입력해 주세요.', 'ACCOUNT_FIELDS_REQUIRED');
  const account = { id: createId(), provider, displayName, handle, status: 'connected', connectedAt: new Date().toISOString() };
  const accounts = await readJsonCollection(ACCOUNT_DB);
  accounts.unshift(account);
  await writeJsonCollection(ACCOUNT_DB, accounts);
  return sendJson(res, 201, { account });
}

async function deleteAccount(res, id) {
  const accounts = await readJsonCollection(ACCOUNT_DB);
  if (!accounts.some((account) => account.id === id)) return sendError(res, 404, '연결된 계정을 찾을 수 없습니다.', 'ACCOUNT_NOT_FOUND');
  await writeJsonCollection(ACCOUNT_DB, accounts.filter((account) => account.id !== id));
  return sendJson(res, 200, { deleted: id });
}

async function createCampaign(req, res) {
  const body = await readRequestBody(req);
  const title = cleanText(body.title);
  const description = cleanText(body.description);
  const scheduledAt = cleanText(body.scheduledAt);
  const accountIds = Array.isArray(body.accountIds) ? body.accountIds.map((id) => cleanText(id)).filter(Boolean) : [];
  if (!title || !scheduledAt || !accountIds.length) return sendError(res, 400, '제목, 예약일, 업로드 계정을 모두 입력해 주세요.', 'CAMPAIGN_FIELDS_REQUIRED');
  const accounts = await readJsonCollection(ACCOUNT_DB);
  const targets = accounts.filter((account) => accountIds.includes(account.id));
  if (!targets.length) return sendError(res, 400, '업로드 대상 계정을 찾을 수 없습니다.', 'TARGET_ACCOUNTS_REQUIRED');
  const campaign = {
    id: createId(),
    title,
    description,
    scheduledAt,
    videoId: cleanText(body.videoId),
    youtubeChecklist: body.youtubeChecklist && typeof body.youtubeChecklist === 'object' ? body.youtubeChecklist : {},
    status: 'scheduled',
    createdAt: new Date().toISOString(),
    jobs: targets.map((account) => ({ accountId: account.id, provider: account.provider, handle: account.handle, status: 'queued' }))
  };
  const campaigns = await readJsonCollection(CAMPAIGN_DB);
  campaigns.unshift(campaign);
  await writeJsonCollection(CAMPAIGN_DB, campaigns);
  return sendJson(res, 201, { campaign });
}

async function deleteCampaign(res, id) {
  const campaigns = await readJsonCollection(CAMPAIGN_DB);
  if (!campaigns.some((campaign) => campaign.id === id)) return sendError(res, 404, '예약 작업을 찾을 수 없습니다.', 'CAMPAIGN_NOT_FOUND');
  await writeJsonCollection(CAMPAIGN_DB, campaigns.filter((campaign) => campaign.id !== id));
  return sendJson(res, 200, { deleted: id });
}

async function handleUpload(req, res) {
  const fileName = safeFileName(req.headers['x-file-name']);
  const fileType = String(req.headers['x-file-type'] || req.headers['content-type'] || '').split(';')[0];
  const declaredSize = Number(req.headers['x-file-size'] || req.headers['content-length'] || 0);
  const extension = extensionFor(fileName);

  if (!ALLOWED_EXTENSIONS.has(extension) || (fileType && !ALLOWED_TYPES.has(fileType))) {
    return sendError(res, 415, 'MP4, MOV, WebM, MKV 동영상만 업로드할 수 있습니다.', 'UNSUPPORTED_VIDEO');
  }
  if (!Number.isFinite(declaredSize) || declaredSize <= 0 || declaredSize > MAX_FILE_SIZE) {
    return sendError(res, 413, `파일 크기는 2 GB 이하여야 합니다. 현재 파일: ${formatBytes(declaredSize || 0)}`, 'FILE_TOO_LARGE');
  }

  await ensureStorage();
  const id = createId();
  const storedName = `${id}${extension}`;
  const targetPath = path.join(UPLOAD_DIR, storedName);
  const writeStream = fs.createWriteStream(targetPath, { flags: 'wx' });
  let received = 0;
  let rejected = false;

  req.on('data', (chunk) => {
    received += chunk.length;
    if (received > MAX_FILE_SIZE && !rejected) {
      rejected = true;
      req.destroy();
    }
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

    const video = {
      id,
      originalName: fileName,
      storedName,
      mimeType: fileType || 'application/octet-stream',
      size: received,
      sizeLabel: formatBytes(received),
      status: 'ready',
      createdAt: new Date().toISOString(),
      url: `/uploads/${storedName}`
    };
    const videos = await readVideos();
    videos.unshift(video);
    await writeVideos(videos);
    return sendJson(res, 201, { video });
  } catch (error) {
    await fsp.rm(targetPath, { force: true });
    if (!res.headersSent) sendError(res, 500, '업로드 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.', 'UPLOAD_FAILED');
  }
}

async function handleDelete(res, id) {
  const videos = await readVideos();
  const video = videos.find((item) => item.id === id);
  if (!video) return sendError(res, 404, '동영상을 찾을 수 없습니다.', 'VIDEO_NOT_FOUND');
  await fsp.rm(path.join(UPLOAD_DIR, video.storedName), { force: true });
  await writeVideos(videos.filter((item) => item.id !== id));
  return sendJson(res, 200, { deleted: id });
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const requested = path.resolve(PUBLIC_DIR, relative);
  if (!requested.startsWith(`${PUBLIC_DIR}${path.sep}`)) return sendError(res, 403, '접근할 수 없습니다.', 'FORBIDDEN');
  try {
    const stat = await fsp.stat(requested);
    if (!stat.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(requested).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(requested).pipe(res);
  } catch {
    sendError(res, 404, '페이지를 찾을 수 없습니다.', 'NOT_FOUND');
  }
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, 'http://localhost');
      const { pathname } = requestUrl;
      if (req.method === 'GET' && pathname === '/api/videos') {
        return sendJson(res, 200, { videos: await readVideos() });
      }
      if (req.method === 'POST' && pathname === '/api/videos') {
        return handleUpload(req, res);
      }
      if (req.method === 'GET' && pathname === '/api/accounts') {
        return sendJson(res, 200, { accounts: await readJsonCollection(ACCOUNT_DB) });
      }
      if (req.method === 'POST' && pathname === '/api/accounts') {
        return await createAccount(req, res);
      }
      const deleteAccountMatch = pathname.match(/^\/api\/accounts\/([^/]+)$/);
      if (req.method === 'DELETE' && deleteAccountMatch) {
        return deleteAccount(res, deleteAccountMatch[1]);
      }
      if (req.method === 'GET' && pathname === '/api/campaigns') {
        return sendJson(res, 200, { campaigns: await readJsonCollection(CAMPAIGN_DB) });
      }
      if (req.method === 'POST' && pathname === '/api/campaigns') {
        return await createCampaign(req, res);
      }
      const deleteCampaignMatch = pathname.match(/^\/api\/campaigns\/([^/]+)$/);
      if (req.method === 'DELETE' && deleteCampaignMatch) {
        return deleteCampaign(res, deleteCampaignMatch[1]);
      }
      const deleteMatch = pathname.match(/^\/api\/videos\/([^/]+)$/);
      if (req.method === 'DELETE' && deleteMatch) {
        return handleDelete(res, deleteMatch[1]);
      }
      if (req.method === 'GET' && pathname.startsWith('/uploads/')) {
        const fileName = path.basename(pathname);
        const target = path.resolve(UPLOAD_DIR, fileName);
        if (!target.startsWith(`${UPLOAD_DIR}${path.sep}`)) return sendError(res, 403, '접근할 수 없습니다.', 'FORBIDDEN');
        try {
          const stat = await fsp.stat(target);
          res.writeHead(200, {
            'Content-Type': 'video/*',
            'Content-Length': stat.size,
            'Accept-Ranges': 'bytes'
          });
          return fs.createReadStream(target).pipe(res);
        } catch {
          return sendError(res, 404, '파일을 찾을 수 없습니다.', 'FILE_NOT_FOUND');
        }
      }
      if (req.method === 'GET') return serveStatic(req, res, pathname);
      return sendError(res, 405, '지원하지 않는 요청입니다.', 'METHOD_NOT_ALLOWED');
    } catch (error) {
      console.error(error);
      if (!res.headersSent) sendError(res, error.statusCode || 500, error.statusCode === 413 ? '요청 데이터가 너무 큽니다.' : '서버 오류가 발생했습니다.', error.statusCode === 413 ? 'REQUEST_TOO_LARGE' : 'INTERNAL_ERROR');
    }
  });
}

if (require.main === module) {
  const port = Number(process.argv[2] || process.env.PORT || 3000);
  ensureStorage().then(() => createServer().listen(port, () => {
    console.log(`동영상 업로드 프로그램: http://localhost:${port}`);
  }));
}

module.exports = { createServer, ensureStorage, formatBytes, MAX_FILE_SIZE };
