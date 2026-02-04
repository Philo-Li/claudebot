const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('configAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (data) => ipcRenderer.invoke('save-config', data),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  getLocale: () => ipcRenderer.invoke('get-locale'),
});
