const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopWindow', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  setStartup: (launchAtStartup, startMinimized) => ipcRenderer.invoke('settings:set-startup', launchAtStartup, startMinimized),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  speak: (text) => ipcRenderer.invoke('speech:speak', text)
});
