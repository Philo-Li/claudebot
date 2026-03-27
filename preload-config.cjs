const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('configAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (data, opts) => ipcRenderer.invoke('save-config', data, opts),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  getLocale: () => ipcRenderer.invoke('get-locale'),
  createPairing: () => ipcRenderer.invoke('create-pairing'),
  pollPairing: (sessionId) => ipcRenderer.invoke('poll-pairing', sessionId),
  generateQR: (data) => ipcRenderer.invoke('generate-qr', data),
});
