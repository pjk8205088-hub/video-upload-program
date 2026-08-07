const path = require('node:path');
const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const { createServer, ensureStorage } = require('../server');

let mainWindow;
let localServer;

function registerWindowControls() {
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());
}

async function startLocalServer() {
  process.env.UPLOAD_DESK_DATA_DIR = path.join(app.getPath('userData'), 'storage');
  await ensureStorage();
  localServer = createServer();
  await new Promise((resolve) => localServer.listen(0, '127.0.0.1', resolve));
  return localServer.address().port;
}

async function createWindow() {
  const port = await startLocalServer();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#10131b',
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  registerWindowControls();
  await createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (localServer) localServer.close();
  if (process.platform !== 'darwin') app.quit();
});
