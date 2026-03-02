const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Device management
  getDevices: () => ipcRenderer.invoke('adb:getDevices'),
  onDeviceChanged: (callback) => ipcRenderer.on('device:changed', (event, data) => callback(data)),
  onAdbError: (callback) => ipcRenderer.on('adb:error', (event, error) => callback(error)),

  // ADB management
  hasBundledAdb: () => ipcRenderer.invoke('adb:hasBundled'),
  downloadAdb: () => ipcRenderer.invoke('adb:download'),
  retryAdb: () => ipcRenderer.invoke('adb:retry'),
  onAdbDownloadProgress: (callback) => ipcRenderer.on('adb:downloadProgress', (event, data) => callback(data)),

  // Connection management
  connect: (config) => ipcRenderer.invoke('connection:connect', config),
  disconnect: () => ipcRenderer.invoke('connection:disconnect'),
  getStatus: () => ipcRenderer.invoke('connection:getStatus'),
  probe: () => ipcRenderer.invoke('connection:probe'),
  onStatusChanged: (callback) => ipcRenderer.on('connection:statusChanged', (event, status) => callback(status)),

  // Proxy settings
  setProxyPort: (port) => ipcRenderer.invoke('proxy:setPort', port),
  getProxyPort: () => ipcRenderer.invoke('proxy:getPort'),
  setProxyType: (type) => ipcRenderer.invoke('proxy:setType', type),
  getProxyType: () => ipcRenderer.invoke('proxy:getType'),

  // Browser navigation
  navigate: (url) => ipcRenderer.invoke('browser:navigate', url),
  goBack: () => ipcRenderer.invoke('browser:goBack'),
  goForward: () => ipcRenderer.invoke('browser:goForward'),
  refresh: () => ipcRenderer.invoke('browser:refresh'),
  getCurrentUrl: () => ipcRenderer.invoke('browser:getCurrentUrl'),

  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config) => ipcRenderer.invoke('config:set', config),

  // History
  getHistory: () => ipcRenderer.invoke('history:getAll'),
  addHistory: (url, title) => ipcRenderer.invoke('history:add', url, title),
  searchHistory: (query) => ipcRenderer.invoke('history:search', query),
  clearHistory: () => ipcRenderer.invoke('history:clear'),

  // Bookmarks
  getBookmarks: () => ipcRenderer.invoke('bookmarks:getAll'),
  saveBookmarks: (bookmarks) => ipcRenderer.invoke('bookmarks:save', bookmarks),

  // Terminal
  terminalConnect: (options) => ipcRenderer.invoke('terminal:connect', options),
  terminalWrite: (data) => ipcRenderer.invoke('terminal:write', data),
  terminalResize: (cols, rows) => ipcRenderer.invoke('terminal:resize', cols, rows),
  terminalDisconnect: () => ipcRenderer.invoke('terminal:disconnect'),
  onTerminalData: (callback) => ipcRenderer.on('terminal:data', (event, data) => callback(data)),
  onTerminalClose: (callback) => ipcRenderer.on('terminal:close', (event, data) => callback(data))
});
