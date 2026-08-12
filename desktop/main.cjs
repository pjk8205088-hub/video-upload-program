const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage } = require('electron');

let createServer;
let ensureStorage;
let mainWindow;
let localServer;
let autoUpdater;

const AUTH_CONFIG = {
  instagram: { url: 'https://www.instagram.com/accounts/login/', cookieUrls: ['https://www.instagram.com'], cookieNames: ['sessionid', 'ds_user_id'] },
  tiktok: { url: 'https://www.tiktok.com/login/phone-or-email/email', cookieUrls: ['https://www.tiktok.com'], cookieNames: ['sessionid', 'sid_tt', 'sessionid_ss', 'sid_guard'] },
  naver: { url: 'https://nid.naver.com/nidlogin.login', cookieUrls: ['https://www.naver.com', 'https://nid.naver.com'], cookieNames: ['NID_AUT', 'NID_SES'] },
  facebook: { url: 'https://www.facebook.com/?locale=ko_KR', cookieUrls: ['https://www.facebook.com'], cookieNames: ['c_user', 'xs'] }
};

app.setName('Upload Desk');
if (process.platform === 'win32') app.setAppUserModelId('com.uploaddesk.desktop.v3');
app.setPath('userData', path.join(app.getPath('appData'), 'upload-desk-v3'));
const hasAppLock = app.requestSingleInstanceLock();
if (!hasAppLock) app.quit();

function settingsFile() { return path.join(app.getPath('userData'), 'storage', 'data', 'settings.json'); }
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return { launchAtStartup: false, startMinimized: false, autoUpdate: true }; } }
function credentialsFile() { return path.join(app.getPath('userData'), 'secure', 'login-credentials.json'); }
function readCredentialVault() { try { return JSON.parse(fs.readFileSync(credentialsFile(), 'utf8')); } catch { return { version: 1, providers: {} }; } }
function writeCredentialVault(vault) { fs.mkdirSync(path.dirname(credentialsFile()), { recursive: true }); fs.writeFileSync(credentialsFile(), JSON.stringify(vault, null, 2), 'utf8'); }

async function hasProviderAuthCookie(authWindow, provider) {
  const config = AUTH_CONFIG[provider];
  if (!config || authWindow.isDestroyed()) return false;
  for (const url of config.cookieUrls) {
    try {
      const cookies = await authWindow.webContents.session.cookies.get({ url });
      if (cookies.some((cookie) => config.cookieNames.includes(cookie.name) && String(cookie.value || '').length > 0)) return true;
    } catch {}
  }
  return false;
}

function verifyProviderLogin(provider) {
  const config = AUTH_CONFIG[provider];
  if (!config || !mainWindow) return Promise.resolve({ verified: false, reason: 'unsupported' });
  return new Promise((resolve) => {
    const authWindow = new BrowserWindow({ parent: mainWindow, width: 520, height: 820, minWidth: 420, minHeight: 640, title: `${provider} 공식 로그인`, autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, partition: 'persist:upload-desk-auth' } });
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      if (!authWindow.isDestroyed()) authWindow.close();
      resolve(result);
    };
    const check = async () => {
      if (finished || authWindow.isDestroyed()) return;
      if (await hasProviderAuthCookie(authWindow, provider)) finish({ verified: true, provider });
    };
    authWindow.webContents.on('did-finish-load', check);
    authWindow.webContents.on('did-navigate', check);
    authWindow.webContents.on('did-navigate-in-page', check);
    authWindow.on('closed', () => finish({ verified: false, cancelled: true, provider }));
    authWindow.loadURL(config.url).catch(() => finish({ verified: false, provider, reason: 'load_failed' }));
  });
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
    if (!provider || !safeStorage.isEncryptionAvailable()) return { supported: false };
    const entry = readCredentialVault().providers[String(provider)];
    if (!entry?.ciphertext) return { supported: true, saved: false };
    try {
      const value = JSON.parse(safeStorage.decryptString(Buffer.from(entry.ciphertext, 'base64')));
      return { supported: true, saved: true, displayName: value.displayName || '', handle: value.handle || '', password: value.password || '' };
    } catch { return { supported: true, saved: false }; }
  });
  ipcMain.handle('credentials:save', (_event, payload = {}) => {
    const provider = String(payload.provider || '').trim().toLowerCase();
    const vault = readCredentialVault();
    if (!provider) return { supported: false, saved: false };
    if (!payload.remember) { delete vault.providers[provider]; writeCredentialVault(vault); return { supported: true, saved: false, cleared: true }; }
    if (!safeStorage.isEncryptionAvailable() || !String(payload.password || '').trim()) return { supported: safeStorage.isEncryptionAvailable(), saved: false };
    const value = JSON.stringify({ displayName: String(payload.displayName || '').trim(), handle: String(payload.handle || '').trim(), password: String(payload.password) });
    vault.providers[provider] = { ciphertext: safeStorage.encryptString(value).toString('base64'), savedAt: new Date().toISOString() };
    writeCredentialVault(vault);
    return { supported: true, saved: true };
  });
  ipcMain.handle('credentials:clear', (_event, provider) => {
    const vault = readCredentialVault();
    if (provider) delete vault.providers[String(provider).trim().toLowerCase()];
    writeCredentialVault(vault);
    return { cleared: true };
  });
}

async function startLocalServer() {
  process.env.UPLOAD_DESK_DATA_DIR = path.join(app.getPath('userData'), 'storage');
  ({ createServer, ensureStorage } = require('../server'));
  await ensureStorage();
  localServer = createServer({ scheduler: true });
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
