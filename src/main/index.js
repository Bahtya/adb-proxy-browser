const { app, BrowserWindow, ipcMain, session, dialog } = require('electron');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { getAdbManager } = require('./adb');
const TrayManager = require('./tray');
const { Client: SSH2Client } = require('ssh2');

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

// Terminal Manager - SSH connection to Termux
class TerminalManager {
  constructor(adbManager) {
    this.adbManager = adbManager;
    this.sshConnection = null;
    this.sshStream = null;
    this.sshLocalPort = 8022;
    this.connected = false;
    this.credentials = null;
  }

  /**
   * Connect to Termux via SSH
   */
  async connect(options = {}) {
    console.log('[Terminal] connect() called with options:', { ...options, password: '***' });

    if (this.connected) {
      console.log('[Terminal] Already connected, disconnecting first');
      await this.disconnect();
    }

    const { username, password, localPort = 8022 } = options;

    // Store credentials for reconnect
    this.credentials = { username, password };
    this.sshLocalPort = localPort;

    // Check for device
    console.log('[Terminal] Checking for connected device...');
    const device = this.adbManager.getFirstDevice();
    if (!device) {
      console.error('[Terminal] No device connected');
      throw new Error('No device connected. Please connect your phone and try again.');
    }
    console.log('[Terminal] Device found:', device.id);

    // Create ADB forward for SSH
    // Termux sshd defaults to port 8022
    const sshRemotePort = options.remotePort || 8022;
    console.log(`[Terminal] Creating ADB forward: tcp:${localPort} -> tcp:${sshRemotePort}`);
    try {
      await this.adbManager.forwardSSH(localPort, device.id, sshRemotePort);
      console.log('[Terminal] ADB forward created successfully');
    } catch (err) {
      console.error('[Terminal] Failed to create ADB forward:', err.message);
      throw new Error(`Failed to create ADB port forward: ${err.message}`);
    }

    // Test TCP connection before SSH handshake
    console.log('[Terminal] Testing TCP connection to 127.0.0.1:' + localPort);
    const tcpTestResult = await new Promise((resolve) => {
      const testSocket = new net.Socket();
      const timeout = setTimeout(() => {
        testSocket.destroy();
        resolve({ success: false, error: 'timeout' });
      }, 3000);

      testSocket.on('connect', () => {
        clearTimeout(timeout);
        testSocket.destroy();
        resolve({ success: true });
      });

      testSocket.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ success: false, error: err.code || err.message });
      });

      testSocket.connect(localPort, '127.0.0.1');
    });

    if (!tcpTestResult.success) {
      console.error('[Terminal] TCP test failed:', tcpTestResult.error);
      // Clean up the forward since it's not working
      try {
        await this.adbManager.removeSSHForward(localPort);
      } catch (e) {
        // Ignore cleanup errors
      }
      throw new Error(`Cannot reach SSH port ${localPort}. Make sure sshd is running in Termux (run: sshd). Error: ${tcpTestResult.error}`);
    }
    console.log('[Terminal] TCP connection test passed - port is reachable');

    // Connect via SSH
    console.log('[Terminal] Starting SSH connection to 127.0.0.1:' + localPort);
    return new Promise((resolve, reject) => {
      const conn = new SSH2Client();
      let resolved = false;

      conn.on('ready', () => {
        console.log('[Terminal] SSH connection ready - authentication successful');

        // Request PTY and shell
        console.log('[Terminal] Requesting PTY shell...');
        conn.shell({
          term: 'xterm-256color',
          cols: 80,
          rows: 24
        }, (err, stream) => {
          if (err) {
            console.error('[Terminal] Failed to create shell:', err.message);
            conn.end();
            if (!resolved) {
              resolved = true;
              reject(new Error(`Failed to create shell: ${err.message}`));
            }
            return;
          }

          this.sshStream = stream;
          this.connected = true;
          console.log('[Terminal] Shell created successfully - terminal ready');

          // Buffer for data throttling
          let dataBuffer = '';
          let dataFlushTimeout = null;

          const flushData = () => {
            if (dataBuffer && mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('terminal:data', dataBuffer);
              dataBuffer = '';
            }
            dataFlushTimeout = null;
          };

          // Handle stream events with buffering
          stream.on('data', (data) => {
            dataBuffer += data.toString('utf8');
            // Throttle data sends to max 60fps
            if (!dataFlushTimeout) {
              dataFlushTimeout = setTimeout(flushData, 16);
            }
          });

          stream.on('close', () => {
            console.log('[Terminal] Stream closed');
            // Flush any remaining data
            if (dataFlushTimeout) {
              clearTimeout(dataFlushTimeout);
              flushData();
            }
            this.connected = false;
            this.sshStream = null;
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('terminal:close', { reason: 'Stream closed' });
            }
          });

          stream.stderr.on('data', (data) => {
            console.log('[Terminal] STDERR:', data.toString());
          });

          if (!resolved) {
            resolved = true;
            resolve({ success: true });
          }
        });
      });

      conn.on('error', (err) => {
        console.error('[Terminal] SSH connection error:', err.message);
        console.error('[Terminal] Error level:', err.level);
        console.error('[Terminal] Error code:', err.code);
        this.connected = false;

        // Provide more helpful error messages
        let errorMsg = err.message;
        if (err.message.includes('ECONNREFUSED')) {
          errorMsg = 'Connection refused. Make sure sshd is running in Termux (run: sshd)';
        } else if (err.message.includes('ETIMEDOUT') || err.message.includes('Timed out')) {
          errorMsg = 'Connection timed out. Check if sshd is running on port 22';
        } else if (err.message.includes('Authentication')) {
          errorMsg = 'Authentication failed. Check username and password';
        } else if (err.message.includes('Host key')) {
          errorMsg = 'Host key verification failed';
        }

        if (!resolved) {
          resolved = true;
          reject(new Error(errorMsg));
        }
      });

      conn.on('close', () => {
        console.log('[Terminal] SSH connection closed');
        this.connected = false;
        this.sshStream = null;
        this.sshConnection = null;
      });

      // Store connection
      this.sshConnection = conn;

      // Connect with password and keyboard-interactive support
      console.log('[Terminal] Initiating SSH connection...');
      console.log('[Terminal] Username:', username);
      console.log('[Terminal] Auth method: password/keyboard-interactive');

      // Handle keyboard-interactive auth
      conn.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
        console.log('[Terminal] Keyboard-interactive auth:', name || '(no name)');
        // Answer all prompts with the password
        finish(prompts.map(() => password));
      });

      conn.connect({
        host: '127.0.0.1',
        port: localPort,
        username: username,
        password: password,
        tryKeyboard: true,
        readyTimeout: 15000
      });

      // Add timeout for connection
      setTimeout(() => {
        if (!resolved) {
          console.error('[Terminal] Connection timeout after 15 seconds');
          resolved = true;
          conn.end();
          reject(new Error('Connection timeout - check if sshd is running on your phone'));
        }
      }, 16000);
    });
  }

  /**
   * Write data to SSH stream
   */
  async write(data) {
    if (!this.connected || !this.sshStream) {
      throw new Error('Not connected');
    }

    this.sshStream.write(data);
    return true;
  }

  /**
   * Resize terminal
   */
  async resize(cols, rows) {
    if (!this.connected || !this.sshStream) {
      return false;
    }

    if (this.sshStream.setWindow) {
      this.sshStream.setWindow(rows, cols, 480, 640);
    }
    return true;
  }

  /**
   * Disconnect SSH and remove ADB forward
   */
  async disconnect() {
    if (this.sshStream) {
      this.sshStream.close();
      this.sshStream = null;
    }

    if (this.sshConnection) {
      this.sshConnection.end();
      this.sshConnection = null;
    }

    // Remove ADB forward
    try {
      await this.adbManager.removeSSHForward(this.sshLocalPort);
    } catch (err) {
      console.error('[Terminal] Failed to remove SSH forward:', err.message);
    }

    this.connected = false;
    console.log('[Terminal] Disconnected');
    return true;
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      connected: this.connected,
      localPort: this.sshLocalPort
    };
  }
}

// Main application
let mainWindow = null;
let connectionManager = null;
let trayManager = null;
let terminalManager = null;

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

  // Push device state to renderer after it loads
  mainWindow.webContents.on('did-finish-load', () => {
    // Single immediate push - ADB init now happens in background
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const devices = connectionManager ? connectionManager.adbManager.getDevices() : [];
    console.log('[IPC] did-finish-load push: devices=', JSON.stringify(devices));
    mainWindow.webContents.send('device:changed', devices);
    if (connectionManager && connectionManager.connected) {
      const status = connectionManager.getStatus();
      mainWindow.webContents.send('connection:statusChanged', status);
    }
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
    if (!connectionManager || !connectionManager.adbManager) {
      console.log('[IPC] getDevices called, but ADB not initialized yet');
      return [];
    }
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
    if (!connectionManager) {
      return { connected: false };
    }
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
    if (!connectionManager) {
      return { localPort: 7890, remotePort: 7890, proxyType: 'http' };
    }
    return connectionManager.getConfig();
  });

  // Config: Set
  ipcMain.handle('config:set', (event, config) => {
    if (!connectionManager) {
      return false;
    }
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
    if (!connectionManager) {
      return { success: false, error: 'Connection manager not initialized' };
    }
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

  // Terminal: Connect
  ipcMain.handle('terminal:connect', async (event, options) => {
    if (!terminalManager) {
      throw new Error('ADB not initialized yet. Please wait and try again.');
    }
    try {
      // Prompt for credentials if not provided
      if (!options.username || !options.password) {
        const result = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          buttons: ['Cancel'],
          title: 'SSH Credentials Required',
          message: 'Please provide SSH credentials for Termux',
          detail: 'Make sure sshd is running on your phone (run "sshd" in Termux).\n\nUse the username you set in Termux and the password you configured.'
        });

        // For now, return error - credentials should be provided from renderer
        throw new Error('SSH credentials required');
      }

      return await terminalManager.connect(options);
    } catch (err) {
      console.error('[IPC] Terminal connect error:', err.message);
      throw err;
    }
  });

  // Terminal: Write
  ipcMain.handle('terminal:write', async (event, data) => {
    if (!terminalManager) {
      throw new Error('ADB not initialized yet');
    }
    try {
      return await terminalManager.write(data);
    } catch (err) {
      console.error('[IPC] Terminal write error:', err.message);
      throw err;
    }
  });

  // Terminal: Resize
  ipcMain.handle('terminal:resize', async (event, cols, rows) => {
    if (!terminalManager) {
      return false;
    }
    try {
      return await terminalManager.resize(cols, rows);
    } catch (err) {
      console.error('[IPC] Terminal resize error:', err.message);
      throw err;
    }
  });

  // Terminal: Disconnect
  ipcMain.handle('terminal:disconnect', async () => {
    if (!terminalManager) {
      return true;
    }
    try {
      return await terminalManager.disconnect();
    } catch (err) {
      console.error('[IPC] Terminal disconnect error:', err.message);
      throw err;
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

// App lifecycle - Initialize synchronously (fast, don't block window)
app.whenReady().then(async () => {
  // Setup IPC first (fast)
  setupIpc();

  // Initialize connection manager FIRST (needed for terminal)
  connectionManager = new ConnectionManager();

  // Initialize terminal manager
  terminalManager = new TerminalManager(connectionManager.adbManager);


  // Now create window (ADB init happens in background)
  await createWindow();

  // Then initialize ADB in background
  try {
    await connectionManager.init();
    console.log('[App] ADB initialized successfully');

    // Push initial device list
    const devices = connectionManager.adbManager.getDevices();
    console.log('[App] Initial devices:', devices.length);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('device:changed', devices);
    }
  } catch (err) {
    console.error('[App] Failed to initialize connection manager:', err.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('adb:error', err.message);
    }
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
