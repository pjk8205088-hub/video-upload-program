const test = require('node:test');
const assert = require('node:assert/strict');
const { clearProviderAuthCookies, hasProviderAuthCookieInSession, restoreProviderAuthSessions, normalizeAccounts, upsertVerifiedAccount } = require('../lib/auth');

function fakeSession(cookieMap) {
  const removed = [];
  return {
    removed,
    cookies: {
      async get({ url }) { return cookieMap[url] || []; },
      async remove(url, name) { removed.push({ url, name }); }
    }
  };
}

test('headless auth verifies a provider cookie without Electron or UI', async () => {
  const session = fakeSession({ 'https://nid.naver.com': [{ name: 'NID_SES', value: 'verified-session', domain: '.nid.naver.com', path: '/', secure: true }] });
  assert.equal(await hasProviderAuthCookieInSession(session, 'naver'), true);
  assert.equal(await hasProviderAuthCookieInSession(fakeSession({}), 'naver'), false);
});

test('headless auth restores all four provider sessions together', async () => {
  const session = fakeSession({
    'https://www.instagram.com': [{ name: 'sessionid', value: 'instagram-session' }],
    'https://www.tiktok.com': [{ name: 'sid_tt', value: 'tiktok-session' }],
    'https://nid.naver.com': [{ name: 'NID_AUT', value: 'naver-session' }],
    'https://www.facebook.com': [{ name: 'c_user', value: 'facebook-session' }]
  });
  const restored = await restoreProviderAuthSessions(session);
  assert.deepEqual(Object.keys(restored).sort(), ['facebook', 'instagram', 'naver', 'tiktok']);
  assert.equal(restored.instagram.verified, true);
  assert.equal(restored.tiktok.verified, true);
  assert.equal(restored.naver.verified, true);
  assert.equal(restored.facebook.verified, true);
});

test('headless auth clears only the selected provider cookies', async () => {
  const session = fakeSession({ 'https://www.instagram.com': [{ name: 'sessionid', value: 'abc', domain: '.instagram.com', path: '/', secure: true }, { name: 'other', value: 'keep', domain: '.instagram.com', path: '/', secure: true }] });
  const result = await clearProviderAuthCookies(session, 'instagram');
  assert.equal(result.cleared, true);
  assert.deepEqual(session.removed, [{ url: 'https://instagram.com/', name: 'sessionid' }]);
});

test('headless auth keeps one account per provider and preserves routed slots', () => {
  const accounts = [{ id: 'acct-1', provider: 'naver', displayName: 'Naver', handle: 'old', status: 'connected', authVerified: true, slotNumbers: [1, 3] }];
  const result = upsertVerifiedAccount(accounts, { provider: 'naver', displayName: 'Naver', handle: 'new', authVerified: true }, { createId: () => 'acct-2', now: () => '2026-08-14T00:00:00.000Z' });
  assert.equal(result.existing, true);
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].handle, 'new');
  assert.deepEqual(accounts[0].slotNumbers, [1, 3]);
});

test('headless auth normalizes duplicate provider records to one account', () => {
  const result = normalizeAccounts([
    { id: 'naver-1', provider: 'naver', status: 'login_required', authVerified: false, slotNumbers: [1] },
    { id: 'naver-2', provider: 'naver', status: 'connected', authVerified: true, slotNumbers: [2] }
  ]);
  assert.equal(result.changed, true);
  assert.equal(result.accounts.length, 1);
  assert.deepEqual(result.accounts[0].slotNumbers, [1, 2]);
  assert.equal(result.accounts[0].id, 'naver-1');
});
