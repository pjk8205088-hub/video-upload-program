const { PROVIDERS } = require('./providers');

const AUTH_CONFIG = Object.freeze({
  instagram: { loginUrl: 'https://www.instagram.com/accounts/login/', uploadUrl: 'https://www.instagram.com/', cookieUrls: ['https://www.instagram.com'], cookieNames: ['sessionid', 'ds_user_id'] },
  tiktok: { loginUrl: 'https://www.tiktok.com/login/phone-or-email/email', uploadUrl: 'https://www.tiktok.com/upload?lang=ko-KR', cookieUrls: ['https://www.tiktok.com'], cookieNames: ['sessionid', 'sid_tt', 'sessionid_ss', 'sid_guard'], requiresProvider: 'facebook' },
  naver: { loginUrl: 'https://nid.naver.com/nidlogin.login', uploadUrl: 'https://clipcreators.naver.com/', cookieUrls: ['https://www.naver.com', 'https://nid.naver.com'], cookieNames: ['NID_AUT', 'NID_SES'] },
  facebook: { loginUrl: 'https://www.facebook.com/?locale=ko_KR', uploadUrl: 'https://www.facebook.com/', cookieUrls: ['https://www.facebook.com'], cookieNames: ['c_user', 'xs'] }
});

const PROVIDER_KEYS = new Set(PROVIDERS.map((provider) => provider.key));

function providerKey(value) {
  return String(value || '').trim().toLowerCase();
}

function getProviderConfig(provider) {
  return AUTH_CONFIG[providerKey(provider)] || null;
}

function isVerifiedAccount(account) {
  return account?.status === 'connected' && account.authVerified === true;
}

function normalizedAccount(account) {
  return { ...account, slotNumbers: [...new Set((account.slotNumbers || []).map(Number).filter((slot) => Number.isInteger(slot) && slot >= 1 && slot <= 10))].sort((a, b) => a - b) };
}

function normalizeAccounts(accounts) {
  const seen = new Map();
  const normalized = [];
  let changed = false;
  for (const rawAccount of Array.isArray(accounts) ? accounts : []) {
    const account = normalizedAccount(rawAccount);
    const key = `${providerKey(account.provider)}:single-account`;
    if (seen.has(key)) {
      const existing = seen.get(key);
      existing.slotNumbers = [...new Set([...(existing.slotNumbers || []), ...(account.slotNumbers || [])])].sort((a, b) => a - b);
      if (isVerifiedAccount(account)) Object.assign(existing, { ...account, id: existing.id, slotNumbers: existing.slotNumbers });
      changed = true;
      continue;
    }
    if (account.status === 'connected' && account.authVerified !== true) {
      account.status = 'login_required';
      account.authVerified = false;
      account.mode = 'oauth_pending';
      changed = true;
    }
    seen.set(key, account);
    normalized.push(account);
  }
  return { accounts: normalized, changed };
}

async function hasProviderAuthCookieInSession(authSession, provider) {
  const config = getProviderConfig(provider);
  if (!config || !authSession?.cookies?.get) return false;
  for (const url of config.cookieUrls) {
    try {
      const cookies = await authSession.cookies.get({ url });
      if (cookies.some((cookie) => config.cookieNames.includes(cookie.name) && String(cookie.value || '').length > 0)) return true;
    } catch {}
  }
  return false;
}

async function restoreProviderAuthSessions(authSession, providers = PROVIDER_KEYS) {
  const providerList = [...providers].map(providerKey).filter((provider) => PROVIDER_KEYS.has(provider));
  const entries = await Promise.all(providerList.map(async (provider) => [
    provider,
    { provider, verified: await hasProviderAuthCookieInSession(authSession, provider) }
  ]));
  return Object.fromEntries(entries);
}

async function clearProviderAuthCookies(authSession, provider) {
  const config = getProviderConfig(provider);
  if (!config || !authSession?.cookies?.get || !authSession?.cookies?.remove) return { cleared: false, reason: 'unsupported' };
  let removed = 0;
  for (const url of config.cookieUrls) {
    try {
      const cookies = await authSession.cookies.get({ url });
      for (const cookie of cookies.filter((item) => config.cookieNames.includes(item.name))) {
        const domain = String(cookie.domain || new URL(url).hostname).replace(/^\./, '');
        const cookieUrl = `${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path || '/'}`;
        try { await authSession.cookies.remove(cookieUrl, cookie.name); removed += 1; } catch {}
      }
    } catch {}
  }
  return { cleared: true, removed };
}

function validateAccountConnection(input, accounts = []) {
  const provider = providerKey(input.provider);
  const displayName = String(input.displayName || '').trim().slice(0, 120);
  const handle = String(input.handle || '').trim().slice(0, 160);
  if (!PROVIDER_KEYS.has(provider)) return { ok: false, status: 400, code: 'UNSUPPORTED_PROVIDER' };
  if (!displayName || !handle) return { ok: false, status: 400, code: 'ACCOUNT_FIELDS_REQUIRED' };
  const config = getProviderConfig(provider);
  if (config.requiresProvider && !accounts.some((account) => account.provider === config.requiresProvider && isVerifiedAccount(account))) {
    return { ok: false, status: 400, code: 'FACEBOOK_LOGIN_REQUIRED' };
  }
  if (input.authVerified !== true) return { ok: false, status: 401, code: 'ACCOUNT_AUTH_REQUIRED' };
  return { ok: true, provider, displayName, handle };
}

function defaultAccountId() {
  return `acct_${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 12)}`;
}

function upsertVerifiedAccount(accounts, input, options = {}) {
  const validation = validateAccountConnection(input, accounts);
  if (!validation.ok) return validation;
  const now = options.now || (() => new Date().toISOString());
  const createId = options.createId || defaultAccountId;
  const existing = accounts.find((account) => account.provider === validation.provider);
  const timestamp = now();
  if (existing) {
    Object.assign(existing, { displayName: validation.displayName, handle: validation.handle, status: 'connected', authVerified: true, mode: 'oauth', connectedAt: timestamp, updatedAt: timestamp });
    return { ok: true, account: existing, existing: true };
  }
  const account = { id: createId('acct_'), provider: validation.provider, displayName: validation.displayName, handle: validation.handle, status: 'connected', authVerified: true, mode: 'oauth', slotNumbers: [], connectedAt: timestamp };
  accounts.unshift(account);
  return { ok: true, account, existing: false };
}

module.exports = {
  AUTH_CONFIG,
  PROVIDER_KEYS,
  getProviderConfig,
  providerKey,
  isVerifiedAccount,
  normalizeAccounts,
  hasProviderAuthCookieInSession,
  restoreProviderAuthSessions,
  clearProviderAuthCookies,
  validateAccountConnection,
  upsertVerifiedAccount
};
