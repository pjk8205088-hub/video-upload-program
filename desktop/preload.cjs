const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopWindow', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  setStartup: (launchAtStartup, startMinimized) => ipcRenderer.invoke('settings:set-startup', launchAtStartup, startMinimized),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  verifyLogin: (provider) => ipcRenderer.invoke('auth:verify-login', provider),
  restoreAuthSessions: () => ipcRenderer.invoke('auth:restore-all'),
  prepareUploadPage: (provider) => ipcRenderer.invoke('auth:prepare-upload', provider),
  openUploadPage: (provider) => ipcRenderer.invoke('auth:open-upload', provider),
  uploadNaverClips: (payload) => ipcRenderer.invoke('naver:upload-clips', payload),
  onNaverClipProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('naver-upload:progress', handler);
    return () => ipcRenderer.removeListener('naver-upload:progress', handler);
  },
  forceLogout: (provider) => ipcRenderer.invoke('auth:force-logout', provider),
  speak: (text) => ipcRenderer.invoke('speech:speak', text),
  getSavedCredentials: (provider) => ipcRenderer.invoke('credentials:get', provider),
  saveCredentials: (payload) => ipcRenderer.invoke('credentials:save', payload),
  clearSavedCredentials: (provider) => ipcRenderer.invoke('credentials:clear', provider)
});
