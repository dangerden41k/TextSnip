'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  state: () => ipcRenderer.invoke('state:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  pauseHotkeys: (on) => ipcRenderer.send('hotkeys:pause', on),
  capture: () => ipcRenderer.send('capture:start'),
  ocrImage: (bytes) => ipcRenderer.invoke('ocr:image', bytes),
  ocrClipboard: () => ipcRenderer.invoke('ocr:clipboard'),
  translate: (text) => ipcRenderer.invoke('translate:run', text),
  checkUpdate: () => ipcRenderer.send('update:check'),
  installUpdate: () => ipcRenderer.send('update:install'),
  installHere: () => ipcRenderer.invoke('app:install-here'),
  version: () => ipcRenderer.invoke('state:get').then((st) => st.version),
  copy: (text) => ipcRenderer.send('clipboard:write', text),
  deleteHistory: (id) => ipcRenderer.invoke('history:delete', id),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  minimize: () => ipcRenderer.send('win:min'),
  close: () => ipcRenderer.send('win:close'),
  on: (channel, cb) => ipcRenderer.on(channel, (_e, data) => cb(data)),
});
