const { app, BrowserWindow, ipcMain, session } = require('electron');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { getAdbManager } = require('./adb');
const TrayManager = require('./tray');

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running, quit this one
  console.log('[App] Another instance is already running, quitting...');
  app.quit();
} else {
  // This is the first instance
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, focus our window instead
    console.log('[App] Second instance detected, focusing main window...');
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Connection Manager - Simplified (direct ADB tunnel, no internal proxy)
class ConnectionManager {
  constructor() {
    this.adbManager = getAdbManager();
    this.connected = false;
    this.currentDevice = null;

    // Configuration
    // localPort: Local port for browser to connect (same as phone's proxy port)
    // remotePort: Port on phone where Clash is listening
    this.config = {
      localPort: 7890,
      remotePort: 7890,
      proxyType: 'http'
    };
  }

  /**
   * Initialize connection manager
   */
  async init() {
    await this.adbManager.init();
  }

  /**
   * Connect to device - Simple ADB forward only
   */
  async connect(config = {}) {
    if (this.connected) {
      await this.disconnect();
    }

    // Merge config
    this.config = { ...this.config, ...config };

    // Check for device
    const device = this.adbManager.getFirstDevice();
    if (!device) {
      throw new Error('No device connected. Please connect your Android device and enable USB debugging.');
    }

    this.currentDevice = device;

    // Create ADB port forward (direct tunnel to phone's proxy)
    await this.adbManager.forward(
      this.config.localPort,
      this.config.remotePort,
      device.id
    );

    this.connected = true;
    console.log(`[Connection] Connected to ${device.id}`);
    console.log(`[Connection] Tunnel: localhost:${this.config.localPort} -> phone:${this.config.remotePort}`);

    return {
      success: true,
      device: device.id,
      ...this.config
    };
  }

  /**
   * Disconnect and remove forward
   */
  async disconnect() {
    if (!this.connected) return;

    // Remove port forward
    await this.adbManager.removeForward(this.config.localPort);

    this.connected = false;
    this.currentDevice = null;
    console.log('[Connection] Disconnected');

    return { success: true };
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      connected: this.connected,
      device: this.currentDevice,
      ...this.config,
      proxyUrl: this.getProxyUrl()
    };
  }

  /**
   * Get proxy URL for Electron
   */
  getProxyUrl() {
    if (this.config.proxyType === 'socks5') {
      return `socks5://127.0.0.1:${this.config.localPort}`;
    }
    return `http://127.0.0.1:${this.config.localPort}`;
  }

  /**
   * Update config
   */
  setConfig(config) {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get config
   */
  getConfig() {
    return { ...this.config };
  }
}

// Main application
let mainWindow = null;
let connectionManager = null;
let trayManager = null;

// History management
const historyFile = path.join(app.getPath('userData'), 'url-history.json');
const MAX_HISTORY_ITEMS = 100;

// Bookmarks management
const bookmarksFile = path.join(app.getPath('userData'), 'bookmarks.json');
const DEFAULT_BOOKMARKS = [
  { title: 'Google', url: 'https://www.google.com' },
  { title: 'GitHub', url: 'https://github.com' },
  { title: 'YouTube', url: 'https://www.youtube.com' },
  { title: 'Wikipedia', url: 'https://www.wikipedia.org' }
];

function loadBookmarks() {
  try {
    if (fs.existsSync(bookmarksFile)) {
      const data = fs.readFileSync(bookmarksFile, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('[Bookmarks] Failed to load:', err.message);
  }
  return DEFAULT_BOOKMARKS;
}

function saveBookmarks(bookmarks) {
  try {
    fs.writeFileSync(bookmarksFile, JSON.stringify(bookmarks, null, 2));
  } catch (err) {
    console.error('[Bookmarks] Failed to save:', err.message);
  }
}

function loadHistory() {
  try {
    if (fs.existsSync(historyFile)) {
      const data = fs.readFileSync(historyFile, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('[History] Failed to load:', err.message);
  }
  return [];
}

function saveHistory(history) {
  try {
    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
  } catch (err) {
    console.error('[History] Failed to save:', err.message);
  }
}

function addToHistory(url, title) {
  if (!url || url === 'about:blank') return;

  const history = loadHistory();

  // Remove existing entry with same URL
  const filtered = history.filter(item => item.url !== url);

  // Add to front
  filtered.unshift({
    url,
    title: title || extractTitle(url),
    timestamp: Date.now()
  });

  // Limit size
  const limited = filtered.slice(0, MAX_HISTORY_ITEMS);
  saveHistory(limited);

  return limited;
}

function extractTitle(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
}

function searchHistory(query) {
  const history = loadHistory();
  if (!query) return history.slice(0, 10);

  const lowerQuery = query.toLowerCase();
  return history.filter(item => {
    const urlMatch = item.url.toLowerCase().includes(lowerQuery);
    const titleMatch = item.title.toLowerCase().includes(lowerQuery);
    return urlMatch || titleMatch;
  }).slice(0, 10);
}

function clearHistory() {
  saveHistory([]);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      webviewTag: true
    },
    title: 'ADB Proxy Browser',
    show: false
  });

  // Load the renderer
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Push device state to renderer after it loads (handles already-connected devices)
  // Use a generous delay to ensure renderer's async init() has completed
  mainWindow.webContents.on('did-finish-load', () => {
    // Push at 1s and 3s to handle any timing variations
    [1000, 3000].forEach(delay => {
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const devices = connectionManager ? connectionManager.adbManager.getDevices() : [];
        console.log(`[IPC] did-finish-load push (${delay}ms): devices=`, JSON.stringify(devices));
        mainWindow.webContents.send('device:changed', devices);
        if (connectionManager) {
          const status = connectionManager.getStatus();
          mainWindow.webContents.send('connection:statusChanged', status);
        }
      }, delay);
    });
  });

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Create tray
  trayManager = new TrayManager(mainWindow, connectionManager);
  trayManager.create();

  // Handle window close
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function setupIpc() {
  // ADB: Get devices
  ipcMain.handle('adb:getDevices', async () => {
    const devices = connectionManager.adbManager.getDevices();
    console.log('[IPC] getDevices called, returning:', devices.length, 'device(s)');
    return devices;
  });

  // Connection: Connect
  ipcMain.handle('connection:connect', async (event, config) => {
    try {
      const result = await connectionManager.connect(config);
      trayManager.updateMenu();

      // Set proxy for browser
      await setBrowserProxy();

      mainWindow.webContents.send('connection:statusChanged', connectionManager.getStatus());
      return result;
    } catch (err) {
      console.error('[IPC] Connect error:', err.message);
      throw err;
    }
  });

  // Connection: Disconnect
  ipcMain.handle('connection:disconnect', async () => {
    try {
      const result = await connectionManager.disconnect();
      trayManager.updateMenu();

      // Clear proxy
      if (mainWindow) {
        await mainWindow.webContents.session.setProxy({ mode: 'direct' });
      }

      mainWindow.webContents.send('connection:statusChanged', connectionManager.getStatus());
      return result;
    } catch (err) {
      console.error('[IPC] Disconnect error:', err.message);
      throw err;
    }
  });

  // Connection: Get status
  ipcMain.handle('connection:getStatus', () => {
    return connectionManager.getStatus();
  });

  // Proxy: Set port
  ipcMain.handle('proxy:setPort', (event, port) => {
    connectionManager.setConfig({ localPort: port });
    return true;
  });

  // Proxy: Get port
  ipcMain.handle('proxy:getPort', () => {
    return connectionManager.config.localPort;
  });

  // Proxy: Set type
  ipcMain.handle('proxy:setType', (event, type) => {
    connectionManager.setConfig({ proxyType: type });
    return true;
  });

  // Proxy: Get type
  ipcMain.handle('proxy:getType', () => {
    return connectionManager.config.proxyType;
  });

  // Browser: Navigate
  ipcMain.handle('browser:navigate', async (event, url) => {
    if (mainWindow) {
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      mainWindow.loadURL(url);
    }
    return true;
  });

  // Browser: Go back
  ipcMain.handle('browser:goBack', () => {
    if (mainWindow && mainWindow.webContents.canGoBack()) {
      mainWindow.webContents.goBack();
    }
    return true;
  });

  // Browser: Go forward
  ipcMain.handle('browser:goForward', () => {
    if (mainWindow && mainWindow.webContents.canGoForward()) {
      mainWindow.webContents.goForward();
    }
    return true;
  });

  // Browser: Refresh
  ipcMain.handle('browser:refresh', () => {
    if (mainWindow) {
      mainWindow.webContents.reload();
    }
    return true;
  });

  // Browser: Get current URL
  ipcMain.handle('browser:getCurrentUrl', () => {
    if (mainWindow) {
      return mainWindow.webContents.getURL();
    }
    return '';
  });

  // Config: Get
  ipcMain.handle('config:get', () => {
    return connectionManager.getConfig();
  });

  // Config: Set
  ipcMain.handle('config:set', (event, config) => {
    connectionManager.setConfig(config);
    return true;
  });

  // ADB: Check if bundled ADB exists
  ipcMain.handle('adb:hasBundled', () => {
    const { hasBundledAdb } = require('./adb/download');
    return hasBundledAdb();
  });

  // ADB: Download platform tools
  ipcMain.handle('adb:download', async (event) => {
    try {
      const { downloadPlatformTools } = require('./adb/download');
      const adbPath = await downloadPlatformTools((status, progress) => {
        mainWindow.webContents.send('adb:downloadProgress', { status, progress });
      });
      return { success: true, path: adbPath };
    } catch (err) {
      console.error('[IPC] ADB download error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ADB: Retry initialization
  ipcMain.handle('adb:retry', async () => {
    try {
      await connectionManager.init();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // History: Get all
  ipcMain.handle('history:getAll', () => {
    return loadHistory();
  });

  // History: Add
  ipcMain.handle('history:add', (event, url, title) => {
    return addToHistory(url, title);
  });

  // History: Search
  ipcMain.handle('history:search', (event, query) => {
    return searchHistory(query);
  });

  // History: Clear
  ipcMain.handle('history:clear', () => {
    clearHistory();
    return true;
  });

  // Bookmarks: Get all
  ipcMain.handle('bookmarks:getAll', () => {
    return loadBookmarks();
  });

  // Bookmarks: Save
  ipcMain.handle('bookmarks:save', (event, bookmarks) => {
    saveBookmarks(bookmarks);
    return true;
  });

  // Probe: check if the ADB tunnel port is actually reachable (TCP connect test)
  ipcMain.handle('connection:probe', () => {
    return new Promise((resolve) => {
      const status = connectionManager.getStatus();
      // Always return current device list and connected flag
      const devices = connectionManager.adbManager.getDevices();

      if (!status.connected) {
        return resolve({ connected: false, tunnelAlive: false, devices });
      }

      // Try a real TCP connection to the forwarded local port
      const socket = new net.Socket();
      const port = status.localPort || 7890;
      let done = false;

      const finish = (alive) => {
        if (done) return;
        done = true;
        socket.destroy();
        // If tunnel died, update connectionManager state
        if (!alive && connectionManager.connected) {
          connectionManager.connected = false;
        }
        resolve({ connected: alive, tunnelAlive: alive, devices });
      };

      socket.setTimeout(1500);
      socket.on('connect', () => finish(true));
      socket.on('error', () => finish(false));
      socket.on('timeout', () => finish(false));
      socket.connect(port, '127.0.0.1');
    });
  });
}

// Set proxy for browser window
async function setBrowserProxy() {
  if (!mainWindow) return;

  const status = connectionManager.getStatus();
  if (status.connected) {
    const proxyUrl = status.proxyUrl;
    await mainWindow.webContents.session.setProxy({
      proxyRules: proxyUrl
    });
    console.log(`[Browser] Proxy set to: ${proxyUrl}`);
  } else {
    await mainWindow.webContents.session.setProxy({ mode: 'direct' });
    console.log('[Browser] Proxy disabled');
  }
}

// App lifecycle
app.whenReady().then(async () => {
  // Initialize connection manager
  connectionManager = new ConnectionManager();

  let adbError = null;
  try {
    await connectionManager.init();
  } catch (err) {
    console.error('[App] Failed to initialize connection manager:', err.message);
    adbError = err.message;
  }

  setupIpc();
  await createWindow();

  // Send ADB error to renderer if any
  if (adbError && mainWindow) {
    mainWindow.webContents.send('adb:error', adbError);
  }
});

app.on('activate', () => {
  // macOS: Re-create window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('before-quit', async () => {
  app.isQuitting = true;
  if (connectionManager) {
    await connectionManager.disconnect();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
