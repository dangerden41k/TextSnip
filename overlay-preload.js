'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ov', {
  onShot: (cb) => ipcRenderer.on('shot', (_e, data) => cb(data)),
  onWipe: (cb) => ipcRenderer.on('wipe', () => cb()),
  ready: () => ipcRenderer.send('overlay:ready'),
  selected: (dataURL) => ipcRenderer.send('overlay:selected', dataURL),
  close: () => ipcRenderer.send('overlay:close'),
  cancel: () => ipcRenderer.send('overlay:cancel'),
});
