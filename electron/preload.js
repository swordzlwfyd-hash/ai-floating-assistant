const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 窗口
  expand: () => ipcRenderer.send('window:expand'),
  collapse: () => ipcRenderer.send('window:collapse'),
  hide: () => ipcRenderer.send('window:hide'),
  dragWindow: (dx, dy) => ipcRenderer.send('drag-window', { dx, dy }),
  onExpanded: (cb) => ipcRenderer.on('window:expanded', (_e, v) => cb(v)),

  // 配置 & 历史
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),
  getHistory: () => ipcRenderer.invoke('history:get'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),

  // 对话
  send: (text) => ipcRenderer.invoke('chat:send', { text }),
  stop: () => ipcRenderer.send('chat:stop'),
  onEvent: (cb) => ipcRenderer.on('chat:event', (_e, payload) => cb(payload)),

  // 工具批准
  respondPermission: (id, approved, trustSession) =>
    ipcRenderer.send('tool:permission-response', { id, approved, trustSession }),
});
