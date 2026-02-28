const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('path');
const { getAdbManager } = require('./adb');
const { getProxyManager } = require('./proxy');
const TrayManager = require('./tray');
const { downloadPlatformTools, hasBundledAdb, getBundledAdbPath } = require('./adb/download');

// Connection Manager
class ConnectionManager {
  constructor() {
    this.adbManager = getAdbManager();
    this.proxyManager = getProxyManager();
    this.connected = false;
    this.currentDevice = null;

    // Configuration
    // proxyPort: Local port for browser to connect
    // tunnelPort: Local port that's forwarded to phone
    // remotePort: Port on phone where Clash is listening
    this.config = {
      proxyPort: 7890,
      tunnelPort: 7891,
      remotePort: 7890,
      proxyType: 'socks5'
    };
  }

  /**
   * Initialize connection manager
   */
  async init() {
    await this.adbManager.init();
  }

  /**
   * Connect to device and start proxy
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

    // Create ADB port forward
    // Forward local tunnelPort to phone's remotePort
    await this.adbManager.forward(
      this.config.tunnelPort,
      this.config.remotePort,
      device.id
    );

    // Start local proxy server
    // Browser connects to proxyPort, which forwards to tunnelPort
    await this.proxyManager.start({
      proxyPort: this.config.proxyPort,
      tunnelPort: this.config.tunnelPort,
      remotePort: this.config.remotePort,
      type: this.config.proxyType
    });

    this.connected = true;
    console.log(`[Connection] Connected to ${device.id}`);
    console.log(`[Connection] Proxy: ${this.config.proxyPort} -> Tunnel: ${this.config.tunnelPort} -> Phone: ${this.config.remotePort}`);

    return {
      success: true,
      device: device.id,
      ...this.config
    };
  }

  /**
   * Disconnect and stop proxy
   */
  async disconnect() {
    if (!this.connected) return;

    // Stop proxy
    await this.proxyManager.stop();

    // Remove port forward
    await this.adbManager.removeForward(this.config.tunnelPort);

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
      proxyUrl: this.proxyManager.getProxyUrl()
    };
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

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    },
    title: 'ADB Proxy Browser',
    show: false
  });

  // Load the renderer
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
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
    connectionManager.setConfig({ proxyPort: port });
    return true;
  });

  // Proxy: Get port
  ipcMain.handle('proxy:getPort', () => {
    return connectionManager.config.proxyPort;
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
    return hasBundledAdb();
  });

  // ADB: Download platform tools
  ipcMain.handle('adb:download', async (event) => {
    try {
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

  // Listen for device changes
  connectionManager.adbManager.onDevicesUpdated(() => {
    if (mainWindow) {
      mainWindow.webContents.send('device:changed', connectionManager.adbManager.getDevices());
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
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
