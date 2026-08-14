const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { getProviderConfig, hasProviderAuthCookieInSession, providerKey } = require('./auth');
const { executeUploadJob } = require('./upload');

class LoginUploadError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LoginUploadError';
    this.code = code;
    this.details = details;
  }
}

function comparablePath(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function inspectUploadFile(filePath) {
  const resolvedPath = path.resolve(String(filePath || ''));
  let stat;
  try { stat = await fsp.stat(resolvedPath); } catch {
    throw new LoginUploadError('FILE_NOT_FOUND', 'The designated upload file does not exist', { filePath: resolvedPath });
  }
  if (!stat.isFile()) throw new LoginUploadError('FILE_NOT_FOUND', 'The designated upload path is not a file', { filePath: resolvedPath });
  return { path: resolvedPath, size: stat.size, sha256: await sha256File(resolvedPath) };
}

function createAllowedFileGuard(allowedFilePath, expectedSha256 = '') {
  if (!String(allowedFilePath || '').trim()) throw new LoginUploadError('ALLOWED_FILE_REQUIRED', 'One allowed upload file must be designated');
  const allowedComparablePath = comparablePath(allowedFilePath);
  const expectedHash = String(expectedSha256 || '').trim().toLowerCase();
  let baselinePromise;

  async function prepare() {
    if (!baselinePromise) {
      baselinePromise = inspectUploadFile(allowedFilePath).then((descriptor) => {
        if (expectedHash && descriptor.sha256 !== expectedHash) throw new LoginUploadError('FILE_HASH_MISMATCH', 'The designated upload file does not match the configured SHA-256', { expectedSha256: expectedHash, actualSha256: descriptor.sha256 });
        return Object.freeze(descriptor);
      });
    }
    return baselinePromise;
  }

  async function verify(candidatePath) {
    if (comparablePath(candidatePath) !== allowedComparablePath) throw new LoginUploadError('FILE_NOT_ALLOWED', 'Only the designated upload file can be used', { allowedFilePath: path.resolve(allowedFilePath), candidatePath: path.resolve(String(candidatePath || '')) });
    const baseline = await prepare();
    const current = await inspectUploadFile(candidatePath);
    if (current.sha256 !== baseline.sha256 || current.size !== baseline.size) throw new LoginUploadError('FILE_CHANGED', 'The designated upload file changed after approval', { expectedSha256: baseline.sha256, actualSha256: current.sha256 });
    return current;
  }

  return { prepare, verify };
}

function createLoginUploadWorkflow(options = {}) {
  const { authSession, allowedFilePath, allowedFileSha256, adapterFactory, maxAttempts = 3, retryBaseMs = 1000, now } = options;
  const fileGuard = createAllowedFileGuard(allowedFilePath, allowedFileSha256);

  async function verifyLogin(provider) {
    const key = providerKey(provider);
    if (!getProviderConfig(key)) return { verified: false, provider: key, reason: 'unsupported' };
    const verified = await hasProviderAuthCookieInSession(authSession, key);
    return { verified, provider: key, reason: verified ? null : 'login_required' };
  }

  async function upload(input = {}) {
    const login = await verifyLogin(input.provider);
    if (!login.verified) throw new LoginUploadError('LOGIN_REQUIRED', 'A verified provider login is required before upload', { provider: login.provider, reason: login.reason });
    const allowedFile = await fileGuard.verify(input.filePath);
    if (input.job?.provider && providerKey(input.job.provider) !== login.provider) throw new LoginUploadError('PROVIDER_MISMATCH', 'The login provider and upload job provider must match');
    const job = input.job || { id: `job_${Date.now().toString(36)}`, provider: login.provider, status: 'queued', progress: 0, attempt: 0, maxAttempts, logs: [] };
    job.provider = login.provider;
    const video = { ...(input.video || {}), localPath: allowedFile.path, size: allowedFile.size, sha256: allowedFile.sha256 };
    const result = await executeUploadJob({ job, video, campaign: input.campaign || {}, adapterFactory, maxAttempts, retryBaseMs, now });
    return { login, allowedFile, job: result.job, comments: result.comments, error: result.error };
  }

  return { verifyLogin, prepareAllowedFile: fileGuard.prepare, verifyAllowedFile: fileGuard.verify, upload };
}

module.exports = { LoginUploadError, comparablePath, sha256File, inspectUploadFile, createAllowedFileGuard, createLoginUploadWorkflow };
