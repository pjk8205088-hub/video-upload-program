const assert = require('node:assert/strict');
const test = require('node:test');
const { electronCookiesToPlaywright } = require('../lib/browser-cookies');

test('Electron login cookies are converted and deduplicated for the upload browser', () => {
  const cookies = electronCookiesToPlaywright([
    { url: 'https://www.instagram.com', cookie: { name: 'sessionid', value: 'session-value', domain: '.instagram.com', path: '/', secure: true, httpOnly: true, sameSite: 'no_restriction', expirationDate: 2_000_000_000 } },
    { url: 'https://www.instagram.com', cookie: { name: 'sessionid', value: 'session-value', domain: '.instagram.com', path: '/', secure: true, httpOnly: true, sameSite: 'no_restriction', expirationDate: 2_000_000_000 } }
  ]);

  assert.deepEqual(cookies, [{
    name: 'sessionid',
    value: 'session-value',
    domain: '.instagram.com',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'None',
    expires: 2_000_000_000
  }]);
});

test('host-only Electron cookies use the source URL', () => {
  assert.deepEqual(electronCookiesToPlaywright([
    { url: 'https://nid.naver.com', cookie: { name: 'NID_SES', value: 'naver-session', path: '/' } }
  ]), [{ name: 'NID_SES', value: 'naver-session', url: 'https://nid.naver.com', path: '/', secure: false, httpOnly: false }]);
});
