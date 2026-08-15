const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage, session } = require('electron');
const { PROVIDER_KEYS, getProviderConfig, hasProviderAuthCookieInSession, restoreProviderAuthSessions, clearProviderAuthCookies } = require('../lib/auth');
const { electronCookiesToPlaywright } = require('../lib/browser-cookies');

let createServer;
let ensureStorage;
let mainWindow;
let localServer;
let autoUpdater;
let activeNaverUploadWindow;
const activeAuthFlows = new Map();
const preparedUploadWindows = new Map();
const AUTH_PARTITION = 'persist:upload-desk-auth';

app.setName('Upload Desk');
if (process.platform === 'win32') app.setAppUserModelId('com.uploaddesk.desktop.v3');
app.setPath('userData', path.join(app.getPath('appData'), 'upload-desk-v3'));
const hasAppLock = app.requestSingleInstanceLock();
if (!hasAppLock) app.quit();

function settingsFile() { return path.join(app.getPath('userData'), 'storage', 'data', 'settings.json'); }
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return { launchAtStartup: false, startMinimized: false, autoUpdate: true }; } }
function credentialsFile() { return path.join(app.getPath('userData'), 'secure', 'login-credentials.json'); }
function emptyCredentialVault() { return { version: 2, providers: {} }; }
function readCredentialVault() {
  try {
    const vault = JSON.parse(fs.readFileSync(credentialsFile(), 'utf8'));
    return { ...emptyCredentialVault(), ...vault, providers: vault?.providers && typeof vault.providers === 'object' ? vault.providers : {} };
  } catch { return emptyCredentialVault(); }
}
function writeCredentialVault(vault) {
  fs.mkdirSync(path.dirname(credentialsFile()), { recursive: true });
  fs.writeFileSync(credentialsFile(), JSON.stringify({ ...vault, version: 2, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
}
function authSession() { return session.fromPartition(AUTH_PARTITION); }
async function flushAuthSession(authSessionToFlush = authSession()) {
  const tasks = [];
  if (authSessionToFlush?.cookies?.flushStore) tasks.push(Promise.resolve(authSessionToFlush.cookies.flushStore()));
  if (authSessionToFlush?.flushStorageData) tasks.push(Promise.resolve(authSessionToFlush.flushStorageData()));
  await Promise.allSettled(tasks);
  return { persisted: true };
}

async function hasProviderAuthCookie(authWindow, provider) {
  if (authWindow.isDestroyed()) return false;
  return hasProviderAuthCookieInSession(authWindow.webContents.session, provider);
}

const TIKTOK_CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function applyProviderUserAgent(browserWindow, provider) {
  if (provider === 'tiktok' && !browserWindow.isDestroyed()) {
    browserWindow.webContents.setUserAgent(TIKTOK_CHROME_USER_AGENT);
  }
}

async function followTikTokFacebookLogin(authWindow) {
  if (authWindow.isDestroyed()) return false;
  const url = authWindow.webContents.getURL();
  if (!/tiktok\.com\/login|tiktok\.com\/passport/i.test(url)) return false;
  return authWindow.webContents.executeJavaScript(`(() => {
    const pattern = /facebook|\\uD398\\uC774\\uC2A4\\uBD81|\\uACC4\\uC18D\\uD558\\uAE30|continue with facebook/i;
    const nodes = [...document.querySelectorAll('button, a, [role="button"]')];
    const target = nodes.find((node) => pattern.test(String(node.innerText || node.getAttribute('aria-label') || node.getAttribute('title') || '')) && !node.disabled);
    if (!target) return false;
    target.click();
    return true;
  })()`, true).catch(() => false);
}

async function isProviderLoginConfirmed(authWindow, provider) {
  if (await hasProviderAuthCookie(authWindow, provider)) return true;
  // TikTok may finish its Facebook-based login through a redirect before the
  // TikTok session cookie is written. Use the authenticated creator UI as a
  // fallback so the login flow does not close prematurely.
  if (provider !== 'tiktok' || authWindow.isDestroyed()) return false;
  const url = authWindow.webContents.getURL();
  if (!/^https:\/\/(?:www\.)?tiktok\.com\//i.test(url) || /\/login|\/passport/i.test(url)) return false;
  const body = await authWindow.webContents.executeJavaScript('document.body?.innerText || ""', true).catch(() => '');
  return /upload|creator|로그아웃|log out|프로필 수정/i.test(String(body));
}

async function clearProviderAuth(provider) {
  const currentAuthSession = authSession();
  const result = await clearProviderAuthCookies(currentAuthSession, provider);
  await flushAuthSession(currentAuthSession);
  return result;
}

async function providerUploadCookies(provider) {
  const config = getProviderConfig(provider);
  if (!config) return [];
  const currentAuthSession = authSession();
  const cookieGroups = [];
  for (const url of config.cookieUrls || []) {
    const cookies = await currentAuthSession.cookies.get({ url }).catch(() => []);
    cookies.forEach((cookie) => cookieGroups.push({ cookie, url }));
  }
  return electronCookiesToPlaywright(cookieGroups);
}

function verifyProviderLogin(provider) {
  const config = getProviderConfig(provider);
  if (!config || !mainWindow) return Promise.resolve({ verified: false, reason: 'unsupported' });
  const active = activeAuthFlows.get(provider);
  if (active) {
    if (!active.window.isDestroyed()) { active.window.show(); active.window.focus(); }
    return active.promise;
  }
  let resolveFlow;
  const promise = new Promise((resolve) => { resolveFlow = resolve; });
  const authWindow = new BrowserWindow({ parent: mainWindow, show: true, width: 520, height: 820, minWidth: 420, minHeight: 640, title: `${provider} 공식 로그인`, autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, partition: AUTH_PARTITION } });
  applyProviderUserAgent(authWindow, provider);
  activeAuthFlows.set(provider, { window: authWindow, promise });
  {
    let finished = false;
    let pollTimer = null;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      if (pollTimer) clearInterval(pollTimer);
      activeAuthFlows.delete(provider);
      if (!authWindow.isDestroyed()) authWindow.close();
      resolveFlow(result);
    };
    const check = async () => {
      if (finished || authWindow.isDestroyed()) return;
      if (await isProviderLoginConfirmed(authWindow, provider)) {
        await flushAuthSession(authWindow.webContents.session);
        finish({ verified: true, provider, persisted: true });
      }
    };
    authWindow.webContents.on('did-finish-load', async () => { if (!authWindow.isDestroyed()) { authWindow.show(); authWindow.focus(); } if (provider === 'tiktok') await followTikTokFacebookLogin(authWindow); check(); });
    authWindow.webContents.on('did-navigate', check);
    authWindow.webContents.on('did-navigate-in-page', check);
    pollTimer = setInterval(() => { check().catch(() => {}); }, provider === 'tiktok' ? 750 : 1_000);
    authWindow.on('closed', () => finish({ verified: false, cancelled: true, provider }));
    authWindow.loadURL(config.loginUrl).catch(() => finish({ verified: false, provider, reason: 'load_failed' }));
  }
  return promise;
}

function uploadReadinessScript(provider) {
  const probes = {
    instagram: `/만들기|Create|새 게시물|New post/i.test(document.body?.innerText || '') || Boolean(document.querySelector('input[type="file"]'))`,
    tiktok: `/영상 선택|Select video|업로드|Upload/i.test(document.body?.innerText || '') || Boolean(document.querySelector('input[type="file"]'))`,
    naver: `/업로드|동영상 업로드/i.test(document.body?.innerText || '') || Boolean(document.querySelector('input[type="file"]'))`,
    facebook: `/사진\\/동영상|Photo\\/video|Photo\\/Video|무슨 생각을 하고 계신가요|What's on your mind/i.test(document.body?.innerText || '')`
  };
  return `(() => { if (document.readyState === 'loading') return false; return Boolean(${probes[provider] || 'false'}); })()`;
}

async function waitForUploadPageReady(uploadWindow, provider, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !uploadWindow.isDestroyed()) {
    const ready = await uploadWindow.webContents.executeJavaScript(uploadReadinessScript(provider), true).catch(() => false);
    if (ready) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

function closePreparedUploadWindow(provider) {
  const uploadWindow = preparedUploadWindows.get(provider);
  preparedUploadWindows.delete(provider);
  if (uploadWindow && !uploadWindow.isDestroyed()) uploadWindow.close();
}

async function prepareProviderUpload(provider, show = false) {
  const config = getProviderConfig(provider);
  if (!config?.uploadUrl || !mainWindow) return { opened: false, ready: false, reason: 'unsupported' };
  const currentAuthSession = authSession();
  if (!await hasProviderAuthCookieInSession(currentAuthSession, provider)) {
    closePreparedUploadWindow(provider);
    return { opened: false, ready: false, reason: 'login_required' };
  }

  const existing = preparedUploadWindows.get(provider);
  if (existing && !existing.isDestroyed()) {
    if (show) { existing.show(); existing.focus(); }
    return { opened: show, ready: true, provider, url: existing.webContents.getURL(), reused: true };
  }

  const uploadWindow = new BrowserWindow({ parent: mainWindow, show: false, width: 1440, height: 920, minWidth: 1080, minHeight: 720, title: `${provider} 동영상 업로드`, autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, partition: AUTH_PARTITION } });
  applyProviderUserAgent(uploadWindow, provider);
  preparedUploadWindows.set(provider, uploadWindow);
  uploadWindow.on('closed', () => { if (preparedUploadWindows.get(provider) === uploadWindow) preparedUploadWindows.delete(provider); });
  try {
    await uploadWindow.loadURL(config.uploadUrl);
    const ready = await waitForUploadPageReady(uploadWindow, provider);
    const stillLoggedIn = await hasProviderAuthCookieInSession(currentAuthSession, provider);
    if (!ready || !stillLoggedIn) {
      closePreparedUploadWindow(provider);
      return { opened: false, ready: false, provider, reason: stillLoggedIn ? 'upload_page_not_ready' : 'login_required' };
    }
    if (show) { uploadWindow.show(); uploadWindow.focus(); }
    return { opened: show, ready: true, provider, url: uploadWindow.webContents.getURL() };
  } catch (error) {
    closePreparedUploadWindow(provider);
    return { opened: false, ready: false, provider, reason: 'load_failed', message: error.message };
  }
}

async function openProviderUpload(provider) {
  return prepareProviderUpload(provider, true);
}

function storedVideoPath(storedName) {
  const safeName = path.basename(String(storedName || ''));
  if (!safeName || safeName === '.') return '';
  const storageRoot = process.env.UPLOAD_DESK_DATA_DIR || path.join(app.getPath('userData'), 'storage');
  return path.join(storageRoot, 'uploads', safeName);
}

function reportNaverProgress(progress) {
  if (!mainWindow?.isDestroyed()) mainWindow.webContents.send('naver-upload:progress', progress);
}

async function setNaverFileInput(uploadWindow, filePath) {
  const debuggerSession = uploadWindow.webContents.debugger;
  let attachedHere = false;
  try {
    try { debuggerSession.attach('1.3'); attachedHere = true; } catch (error) {
      if (!String(error?.message || error).toLowerCase().includes('already attached')) throw error;
    }
    await debuggerSession.sendCommand('DOM.enable');
    const { root } = await debuggerSession.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
    const { nodeIds } = await debuggerSession.sendCommand('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type="file"]' });
    if (!nodeIds?.length) throw new Error('네이버 클립 업로드 화면에서 파일 선택 입력을 찾지 못했습니다.');
    for (const nodeId of nodeIds) await debuggerSession.sendCommand('DOM.setFileInputFiles', { nodeId, files: [filePath] });
  } finally {
    if (attachedHere) {
      try { debuggerSession.detach(); } catch {}
    }
  }
}

function naverPageScript(step, payload = {}) {
  const serialized = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `(async () => {
    const payload = ${serialized};
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (element) => { if (!element) return false; const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
    const textOf = (element) => String(element?.innerText || element?.textContent || '').replace(/\\s+/g, ' ').trim();
    const all = (selector) => [...document.querySelectorAll(selector)].filter(visible);
    const exact = (value) => all('button, a, [role="button"], label, span').find((element) => textOf(element) === value);
    const contains = (value) => all('button, a, [role="button"], label, span').find((element) => textOf(element).includes(value));
    const click = (element) => { if (!element) return false; (element.closest('button, a, [role="button"], label') || element).click(); return true; };
    const clickText = (values) => { for (const value of values) { if (click(exact(value)) || click(contains(value))) return value; } return ''; };
    const waitFor = async (predicate, timeout = 45000) => { const end = Date.now() + timeout; while (Date.now() < end) { const result = predicate(); if (result) return result; await wait(350); } return null; };
    const setValue = (element, value) => { if (!element) return false; const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set; setter?.call(element, value); if (!setter) element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); return true; };
    const chooseSelect = (desired, index = 0) => { const selects = all('select'); const select = selects[index]; if (!select) return false; const options = [...select.options]; const option = options.find((item) => desired && (item.textContent || '').includes(desired)) || options.find((item) => item.value && !item.disabled && !/선택|카테고리/.test(item.textContent || '')); if (!option) return false; select.value = option.value; select.dispatchEvent(new Event('input', { bubbles: true })); select.dispatchEvent(new Event('change', { bubbles: true })); return true; };
    const descriptionValue = String(payload.description || '').trim() + (payload.hashtags?.length ? '\\n\\n' + payload.hashtags.join(' ') : '');
    if (${JSON.stringify(step)} === 'open') {
      if (document.querySelector('input[type="file"]')) return { ready: true, action: 'already-open' };
      clickText(['+ 업로드', '업로드']);
      const ready = await waitFor(() => document.querySelector('input[type="file"]'));
      return { ready: Boolean(ready), action: 'open-upload' };
    }
    if (${JSON.stringify(step)} === 'prepare') {
      const editor = await waitFor(() => all('textarea, [contenteditable="true"]')[0], 60000);
      if (editor && descriptionValue) { if (editor.isContentEditable) { editor.textContent = descriptionValue; editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: descriptionValue })); } else setValue(editor, descriptionValue); }
      const coverButtons = all('button, [role="button"]').filter((element) => element.querySelector('img') && element.getBoundingClientRect().width >= 35 && element.getBoundingClientRect().width <= 190).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      if (coverButtons.length) click(coverButtons[Math.min(Number(payload.coverIndex || 2), coverButtons.length - 1)]);
      chooseSelect(payload.primaryCategory || '', 0); chooseSelect(payload.secondaryCategory || '', 1);
      return { ready: Boolean(editor), coverCount: coverButtons.length, descriptionFilled: Boolean(editor && descriptionValue) };
    }
    if (${JSON.stringify(step)} === 'shopping') {
      const clicked = clickText(['쇼핑']);
      if (!clicked) return { ready: false, reason: 'shopping-tag-button-not-found' };
      await wait(700);
      const selected = clickText(['선택']);
      if (selected) await wait(500);
      clickText(['닫기', '×']);
      return { ready: true, selected: Boolean(selected) };
    }
    if (${JSON.stringify(step)} === 'publish-settings') {
      const publicText = exact('전체 공개') || contains('전체 공개');
      if (publicText) { const control = publicText.closest('label')?.querySelector('input, [role="switch"]') || publicText.closest('button, label, [role="button"]'); if (control?.matches('input[type="checkbox"]') && !control.checked) control.click(); else if (control && control.getAttribute('aria-checked') === 'false') control.click(); }
      const comments = exact('허용') || contains('허용'); if (comments) click(comments);
      return { ready: true, publicFound: Boolean(publicText) };
    }
    if (${JSON.stringify(step)} === 'register') {
      const button = exact('등록') || all('button, [role="button"]').find((element) => /^등록$/.test(textOf(element)));
      if (!button) return { ready: false, reason: 'register-button-not-found' };
      click(button);
      await wait(2500);
      const done = await waitFor(() => Boolean(exact('+ 업로드')) || /등록 완료|게시 완료/.test(document.body.innerText || ''), 60000);
      return { ready: Boolean(done), registered: true };
    }
    if (${JSON.stringify(step)} === 'next') {
      clickText(['+ 업로드', '업로드']);
      const ready = await waitFor(() => document.querySelector('input[type="file"]'));
      return { ready: Boolean(ready), action: 'next-upload' };
    }
    return { ready: false, reason: 'unknown-step' };
  })()`;
}

async function runNaverClipAutomation(payload = {}) {
  const config = getProviderConfig('naver');
  const currentAuthSession = authSession();
  if (!await hasProviderAuthCookieInSession(currentAuthSession, 'naver')) return { opened: false, reason: 'login_required' };
  const slots = Array.isArray(payload.slots) ? payload.slots.filter((item) => item?.storedName).slice(0, 10) : [];
  if (!slots.length) return { opened: false, reason: 'no_videos' };
  if (activeNaverUploadWindow && !activeNaverUploadWindow.isDestroyed()) activeNaverUploadWindow.close();
  const uploadWindow = new BrowserWindow({ parent: mainWindow, width: 1440, height: 920, minWidth: 1080, minHeight: 720, title: '네이버 클립 자동 등록', autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, partition: AUTH_PARTITION } });
  activeNaverUploadWindow = uploadWindow;
  const publishedSlots = [];
  try {
    await uploadWindow.loadURL(config.uploadUrl);
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      const filePath = storedVideoPath(slot.storedName);
      if (!filePath || !fs.existsSync(filePath)) throw new Error(`${slot.slotNumber}번 영상 파일을 찾지 못했습니다.`);
      reportNaverProgress({ status: 'preparing', slotNumber: slot.slotNumber, index: index + 1, total: slots.length, message: `${slot.slotNumber}번 영상 업로드 화면 준비 중` });
      const openStep = index === 0 ? 'open' : 'next';
      const opened = await uploadWindow.webContents.executeJavaScript(naverPageScript(openStep), true);
      if (!opened?.ready) throw new Error(`${slot.slotNumber}번 업로드 화면을 준비하지 못했습니다. 네이버 클립 페이지에서 로그인 상태를 확인해 주세요.`);
      await setNaverFileInput(uploadWindow, filePath);
      const prepared = await uploadWindow.webContents.executeJavaScript(naverPageScript('prepare', { ...slot.metadata, coverIndex: 2 }), true);
      if (!prepared?.ready) throw new Error(`${slot.slotNumber}번 영상 설명 입력란을 찾지 못했습니다.`);
      const shopping = await uploadWindow.webContents.executeJavaScript(naverPageScript('shopping', { infoTag: '쇼핑' }), true);
      if (!shopping?.ready) throw new Error('네이버 클립 정보태그 쇼핑 버튼을 찾지 못했습니다. 열린 창에서 수동으로 확인해 주세요.');
      await uploadWindow.webContents.executeJavaScript(naverPageScript('publish-settings'), true);
      reportNaverProgress({ status: 'registering', slotNumber: slot.slotNumber, index: index + 1, total: slots.length, message: `${slot.slotNumber}번 영상 등록 중` });
      const registered = await uploadWindow.webContents.executeJavaScript(naverPageScript('register'), true);
      if (!registered?.registered) throw new Error(`${slot.slotNumber}번 영상 등록 버튼을 찾지 못했습니다.`);
      publishedSlots.push(slot.slotNumber);
      reportNaverProgress({ status: 'published', slotNumber: slot.slotNumber, index: index + 1, total: slots.length, message: `네이버 클립 ${slot.slotNumber}번 등록 완료` });
    }
    return { opened: true, provider: 'naver', publishedSlots };
  } catch (error) {
    reportNaverProgress({ status: 'failed', message: error.message, publishedSlots });
    return { opened: true, provider: 'naver', publishedSlots, failed: true, reason: 'automation_failed', message: error.message };
  }
}

function reportStartupError(error) {
  const message = error?.stack || String(error);
  try { const logPath = path.join(app.getPath('userData'), 'startup-error.log'); fs.mkdirSync(path.dirname(logPath), { recursive: true }); fs.writeFileSync(logPath, message, 'utf8'); } catch {}
  if (app.isReady()) dialog.showErrorBox('Upload Desk를 시작할 수 없습니다.', `${message}\n\n로그: ${path.join(app.getPath('userData'), 'startup-error.log')}`);
}

function registerIpc() {
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => { if (mainWindow?.isMaximized()) mainWindow.unmaximize(); else mainWindow?.maximize(); });
  ipcMain.on('window:close', () => mainWindow?.close());
  ipcMain.handle('settings:set-startup', (_event, launchAtStartup, startMinimized) => {
    if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: Boolean(launchAtStartup), openAsHidden: Boolean(startMinimized), args: startMinimized ? ['--background'] : [] });
    return { supported: process.platform === 'win32', launchAtStartup: Boolean(launchAtStartup), startMinimized: Boolean(startMinimized) };
  });
  ipcMain.handle('updates:check', async () => {
    if (!app.isPackaged || !autoUpdater) return { status: 'browser-sandbox' };
    try { await autoUpdater.checkForUpdatesAndNotify(); return { status: 'checked' }; } catch (error) { return { status: 'error', message: error.message }; }
  });
  ipcMain.handle('auth:verify-login', (_event, provider) => verifyProviderLogin(String(provider || '').trim().toLowerCase()));
  ipcMain.handle('auth:restore-all', async () => {
    const restored = await restoreProviderAuthSessions(authSession());
    const vault = readCredentialVault();
    return {
      providers: [...PROVIDER_KEYS].map((provider) => ({
        provider,
        verified: Boolean(restored[provider]?.verified),
        remembered: Boolean(vault.providers[provider]?.ciphertext),
        savedAt: vault.providers[provider]?.savedAt || null
      }))
    };
  });
  ipcMain.handle('auth:prepare-upload', (_event, provider) => prepareProviderUpload(String(provider || '').trim().toLowerCase(), false));
  ipcMain.handle('auth:open-upload', (_event, provider) => openProviderUpload(String(provider || '').trim().toLowerCase()));
  ipcMain.handle('naver:upload-clips', (_event, payload) => runNaverClipAutomation(payload));
  ipcMain.handle('auth:force-logout', async (_event, provider) => {
    const providerKey = String(provider || '').trim().toLowerCase();
    closePreparedUploadWindow(providerKey);
    return clearProviderAuth(providerKey);
  });
  ipcMain.handle('speech:speak', (_event, text) => {
    if (process.platform !== 'win32' || !String(text || '').trim()) return { supported: false };
    const script = "$ErrorActionPreference='SilentlyContinue'; Add-Type -AssemblyName System.Speech; $synth=New-Object System.Speech.Synthesis.SpeechSynthesizer; $voices=$synth.GetInstalledVoices(); $female=$voices | Where-Object { $_.VoiceInfo.Gender.ToString() -eq 'Female' -and $_.VoiceInfo.Culture.Name -match '^ko' } | Select-Object -First 1; if (!$female) { $female=$voices | Where-Object { $_.VoiceInfo.Gender.ToString() -eq 'Female' } | Select-Object -First 1 }; if ($female) { $synth.SelectVoice($female.VoiceInfo.Name) }; $synth.Rate=0; $synth.Volume=100; $synth.Speak([Console]::In.ReadToEnd()); $synth.Dispose();";
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    child.stdin.end(String(text).slice(0, 300));
    return new Promise((resolve) => {
      child.once('error', () => resolve({ supported: false }));
      child.once('close', () => resolve({ supported: true }));
    });
  });
  ipcMain.handle('credentials:get', (_event, provider) => {
    const providerKey = String(provider || '').trim().toLowerCase();
    if (!getProviderConfig(providerKey) || !safeStorage.isEncryptionAvailable()) return { supported: false };
    const entry = readCredentialVault().providers[providerKey];
    if (!entry?.ciphertext) return { supported: true, saved: false };
    try {
      const value = JSON.parse(safeStorage.decryptString(Buffer.from(entry.ciphertext, 'base64')));
      return { supported: true, saved: true, displayName: value.displayName || '', handle: value.handle || '', password: value.password || '' };
    } catch { return { supported: true, saved: false }; }
  });
  ipcMain.handle('credentials:save', (_event, payload = {}) => {
    const provider = String(payload.provider || '').trim().toLowerCase();
    const vault = readCredentialVault();
    if (!getProviderConfig(provider)) return { supported: false, saved: false };
    if (!payload.remember) { delete vault.providers[provider]; writeCredentialVault(vault); return { supported: true, saved: false, cleared: true }; }
    if (!safeStorage.isEncryptionAvailable() || !String(payload.password || '').trim()) return { supported: safeStorage.isEncryptionAvailable(), saved: false };
    const value = JSON.stringify({ displayName: String(payload.displayName || '').trim(), handle: String(payload.handle || '').trim(), password: String(payload.password) });
    vault.providers[provider] = { ciphertext: safeStorage.encryptString(value).toString('base64'), savedAt: new Date().toISOString(), rememberUntilLogout: true };
    writeCredentialVault(vault);
    return { supported: true, saved: true };
  });
  ipcMain.handle('credentials:clear', (_event, provider) => {
    const providerKey = String(provider || '').trim().toLowerCase();
    const vault = readCredentialVault();
    if (getProviderConfig(providerKey)) delete vault.providers[providerKey];
    writeCredentialVault(vault);
    return { cleared: true };
  });
}

async function startLocalServer() {
  process.env.UPLOAD_DESK_DATA_DIR = path.join(app.getPath('userData'), 'storage');
  ({ createServer, ensureStorage } = require('../server'));
  await ensureStorage();
  localServer = createServer({ scheduler: true, providerCookieLoader: providerUploadCookies });
  await new Promise((resolve) => localServer.listen(0, '127.0.0.1', resolve));
  return localServer.address().port;
}

async function createWindow(startHidden = false) {
  const port = await startLocalServer();
  mainWindow = new BrowserWindow({ width: 1440, height: 920, minWidth: 1080, minHeight: 720, backgroundColor: '#101622', show: false, frame: false, titleBarStyle: 'hidden', autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.cjs') } });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => reportStartupError(new Error(`페이지를 불러오지 못했습니다: ${code} ${description} ${url}`)));
  mainWindow.once('ready-to-show', () => { if (!startHidden) mainWindow.show(); });
  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

if (hasAppLock) app.whenReady().then(async () => {
  Menu.setApplicationMenu(null); registerIpc();
  try { ({ autoUpdater } = require('electron-updater')); } catch { autoUpdater = null; }
  const settings = readSettings();
  if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: Boolean(settings.launchAtStartup), openAsHidden: Boolean(settings.startMinimized), args: settings.startMinimized ? ['--background'] : [] });
  await createWindow(Boolean(settings.startMinimized && process.argv.includes('--background')));
  if (settings.autoUpdate && app.isPackaged && autoUpdater) autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(false); else mainWindow?.show(); });
}).catch(reportStartupError);

if (hasAppLock) app.on('second-instance', () => { if (!mainWindow) return; if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); });
app.on('window-all-closed', () => { if (localServer) localServer.close(); if (process.platform !== 'darwin') app.quit(); });
