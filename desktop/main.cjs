const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');

let createServer;
let ensureStorage;
let mainWindow;
let localServer;
let autoUpdater;

app.setName('Upload Desk');
if (process.platform === 'win32') app.setAppUserModelId('com.uploaddesk.desktop.v3');
app.setPath('userData', path.join(app.getPath('appData'), 'upload-desk-v3'));
const hasAppLock = app.requestSingleInstanceLock();
if (!hasAppLock) app.quit();

function settingsFile() { return path.join(app.getPath('userData'), 'storage', 'data', 'settings.json'); }
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return { launchAtStartup: false, startMinimized: false, autoUpdate: true }; } }

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
  ipcMain.handle('speech:speak', (_event, text) => {
    if (process.platform !== 'win32' || !String(text || '').trim()) return { supported: false };
    const script = "$ErrorActionPreference='SilentlyContinue'; Add-Type -AssemblyName System.Speech; $synth=New-Object System.Speech.Synthesis.SpeechSynthesizer; $female=$synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Gender.ToString() -eq 'Female' } | Select-Object -First 1; if ($female) { $synth.SelectVoice($female.VoiceInfo.Name) }; $synth.Rate=0; $synth.Volume=100; $synth.Speak([Console]::In.ReadToEnd()); $synth.Dispose();";
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    child.stdin.end(String(text).slice(0, 300));
    return new Promise((resolve) => {
      child.once('error', () => resolve({ supported: false }));
      child.once('close', () => resolve({ supported: true }));
    });
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
