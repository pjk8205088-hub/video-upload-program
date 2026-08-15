function normalizedSameSite(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'strict') return 'Strict';
  if (normalized === 'lax') return 'Lax';
  if (normalized === 'no_restriction' || normalized === 'none') return 'None';
  return undefined;
}

function electronCookieToPlaywright(cookie, fallbackUrl = '') {
  const name = String(cookie?.name || '').trim();
  const value = String(cookie?.value || '');
  if (!name || !value) return null;

  const converted = {
    name,
    value,
    path: String(cookie.path || '/') || '/',
    httpOnly: Boolean(cookie.httpOnly),
    secure: Boolean(cookie.secure)
  };
  const domain = String(cookie.domain || '').trim();
  if (domain) converted.domain = domain;
  else if (fallbackUrl) converted.url = fallbackUrl;
  else return null;

  const expires = Number(cookie.expirationDate);
  if (Number.isFinite(expires) && expires > 0) converted.expires = expires;
  const sameSite = normalizedSameSite(cookie.sameSite);
  if (sameSite) converted.sameSite = sameSite;
  return converted;
}

function electronCookiesToPlaywright(cookieGroups = []) {
  const entries = Array.isArray(cookieGroups) ? cookieGroups : [];
  const deduplicated = new Map();
  for (const entry of entries) {
    const cookie = entry?.cookie || entry;
    const converted = electronCookieToPlaywright(cookie, entry?.url || '');
    if (!converted) continue;
    const key = `${converted.name}:${converted.domain || converted.url}:${converted.path || '/'}`;
    deduplicated.set(key, converted);
  }
  return [...deduplicated.values()];
}

module.exports = { normalizedSameSite, electronCookieToPlaywright, electronCookiesToPlaywright };
