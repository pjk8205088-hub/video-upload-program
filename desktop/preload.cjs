const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopWindow', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  setStartup: (launchAtStartup, startMinimized) => ipcRenderer.invoke('settings:set-startup', launchAtStartup, startMinimized),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  verifyLogin: (provider) => ipcRenderer.invoke('auth:verify-login', provider),
  openUploadPage: (provider) => ipcRenderer.invoke('auth:open-upload', provider),
  forceLogout: (provider) => ipcRenderer.invoke('auth:force-logout', provider),
  speak: (text) => ipcRenderer.invoke('speech:speak', text),
  getSavedCredentials: (provider) => ipcRenderer.invoke('credentials:get', provider),
  saveCredentials: (payload) => ipcRenderer.invoke('credentials:save', payload),
  clearSavedCredentials: (provider) => ipcRenderer.invoke('credentials:clear', provider)
});
