/**
 * Complete automated layout debug script
 * Runs the actual app and captures screenshots at different states
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Import actual main process components
const { getAdbManager } = require('../src/main/adb');
const TrayManager = require('../src/main/tray');

const screenshotDir = path.join(__dirname, 'debug-output');
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

let mainWindow = null;
let connectionManager = null;

// Connection Manager (simplified from main/index.js)
class ConnectionManager {
  constructor() {
    this.adbManager = getAdbManager();
    this.connected = false;
    this.currentDevice = null;
    this.config = {
      localPort: 7890,
      remotePort: 7890,
      proxyType: 'http'
    };
  }

  async init() {
    await this.adbManager.init();
  }

  getDevices() {
    return this.adbManager.getDevices();
  }

  getFirstDevice() {
    return this.adbManager.getFirstDevice();
  }

  async connect(config = {}) {
    if (this.connected) await this.disconnect();
    this.config = { ...this.config, ...config };

    const device = this.adbManager.getFirstDevice();
    if (!device) throw new Error('No device connected');

    this.currentDevice = device;
    await this.adbManager.forward(
      this.config.localPort,
      this.config.remotePort,
      device.id
    );

    this.connected = true;
    return { success: true, device: device.id, ...this.config };
  }

  async disconnect() {
    if (!this.connected) return;
    await this.adbManager.removeForward(this.config.localPort);
    this.connected = false;
    this.currentDevice = null;
    return { success: true };
  }

  getStatus() {
    return {
      connected: this.connected,
      device: this.currentDevice,
      ...this.config
    };
  }

  setConfig(config) {
    this.config = { ...this.config, ...config };
  }

  getConfig() {
    return { ...this.config };
  }

  onDevicesUpdated(callback) {
    this.adbManager.onDevicesUpdated(callback);
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../src/preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    },
    show: false
  });

  await mainWindow.loadFile(path.join(__dirname, '../src/renderer/index.html'));
  return mainWindow;
}

async function captureScreenshot(name) {
  const imagePath = path.join(screenshotDir, `${name}.png`);
  const image = await mainWindow.capturePage();
  fs.writeFileSync(imagePath, image.toPNG());
  console.log(`[Screenshot] ${name}.png`);
}

async function injectDebugCSS() {
  await mainWindow.webContents.executeJavaScript(`
    (function() {
      if (document.getElementById('debug-styles')) return;
      const style = document.createElement('style');
      style.id = 'debug-styles';
      style.textContent = \`
        .main-content { border: 3px solid orange !important; }
        .browser-wrapper { border: 3px solid red !important; }
        .browser-container { border: 3px solid blue !important; }
        webview, .browser-view { border: 3px solid green !important; min-height: 200px !important; }
        .welcome-screen { border: 3px solid purple !important; }
      \`;
      document.head.appendChild(style);
    })()
  `);
}

async function getLayoutInfo() {
  return await mainWindow.webContents.executeJavaScript(`
    (function() {
      const wv = document.querySelector('webview');
      return {
        window: { w: window.innerWidth, h: window.innerHeight },
        mainContent: document.querySelector('.main-content')?.offsetHeight,
        wrapper: {
          display: getComputedStyle(document.getElementById('browser-wrapper')).display,
          h: document.getElementById('browser-wrapper')?.offsetHeight
        },
        container: {
          pos: getComputedStyle(document.getElementById('browser-container')).position,
          h: document.getElementById('browser-container')?.offsetHeight
        },
        webview: wv ? { h: wv.offsetHeight, src: wv.src?.substring(0,30) } : null
      };
    })()
  `);
}

function setupIPC() {
  ipcMain.handle('adb:getDevices', async () => connectionManager.getDevices());
  ipcMain.handle('connection:connect', async (e, config) => {
    const result = await connectionManager.connect(config);
    mainWindow.webContents.send('connection:statusChanged', connectionManager.getStatus());
    return result;
  });
  ipcMain.handle('connection:disconnect', async () => {
    const result = await connectionManager.disconnect();
    mainWindow.webContents.send('connection:statusChanged', connectionManager.getStatus());
    return result;
  });
  ipcMain.handle('connection:getStatus', () => connectionManager.getStatus());
  ipcMain.handle('config:get', () => connectionManager.getConfig());
  ipcMain.handle('config:set', (e, c) => { connectionManager.setConfig(c); return true; });
  ipcMain.handle('proxy:setPort', (e, p) => { connectionManager.config.localPort = p; return true; });
  ipcMain.handle('proxy:getPort', () => connectionManager.config.localPort);
  ipcMain.handle('proxy:setType', (e, t) => { connectionManager.config.proxyType = t; return true; });
  ipcMain.handle('proxy:getType', () => connectionManager.config.proxyType);
  ipcMain.handle('browser:navigate', async (e, url) => {
    if (!url.startsWith('http')) url = 'https://' + url;
    mainWindow.loadURL(url);
    return true;
  });
  ipcMain.handle('browser:goBack', () => { if (mainWindow.webContents.canGoBack()) mainWindow.webContents.goBack(); return true; });
  ipcMain.handle('browser:goForward', () => { if (mainWindow.webContents.canGoForward()) mainWindow.webContents.goForward(); return true; });
  ipcMain.handle('browser:refresh', () => { mainWindow.webContents.reload(); return true; });
  ipcMain.handle('browser:getCurrentUrl', () => mainWindow.webContents.getURL());

  // History handlers
  const historyFile = path.join(app.getPath('userData'), 'url-history.json');
  const loadHistory = () => { try { return JSON.parse(fs.readFileSync(historyFile, 'utf-8')); } catch { return []; } };
  const saveHistory = (h) => fs.writeFileSync(historyFile, JSON.stringify(h, null, 2));
  ipcMain.handle('history:getAll', () => loadHistory());
  ipcMain.handle('history:add', (e, url, title) => {
    let h = loadHistory().filter(i => i.url !== url);
    h.unshift({ url, title: title || url, timestamp: Date.now() });
    saveHistory(h.slice(0, 100));
    return h;
  });
  ipcMain.handle('history:search', (e, q) => {
    if (!q) return loadHistory().slice(0, 10);
    const lq = q.toLowerCase();
    return loadHistory().filter(i => i.url.toLowerCase().includes(lq) || i.title.toLowerCase().includes(lq)).slice(0, 10);
  });
  ipcMain.handle('history:clear', () => { saveHistory([]); return true; });

  // ADB handlers
  ipcMain.handle('adb:hasBundled', () => false);
  ipcMain.handle('adb:download', () => ({ success: false, error: 'Not available' }));
  ipcMain.handle('adb:retry', async () => {
    try { await connectionManager.init(); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  });
}

async function runDebug() {
  console.log('\n========== LAYOUT DEBUG START ==========\n');

  try {
    connectionManager = new ConnectionManager();
    await connectionManager.init();
  } catch (err) {
    console.warn('[Init] ADB init failed (expected if no device):', err.message);
  }

  setupIPC();
  await createWindow();

  // Wait for renderer
  await new Promise(r => setTimeout(r, 1500));
  mainWindow.show();

  // Test 1: Welcome screen
  console.log('\n[Test 1] Welcome Screen');
  await injectDebugCSS();
  await captureScreenshot('1-welcome-debug');
  let info = await getLayoutInfo();
  console.log('Layout:', JSON.stringify(info, null, 2));

  // Test 2: Show browser view (simulate navigation)
  console.log('\n[Test 2] Show Browser View');
  await mainWindow.webContents.executeJavaScript(`
    (function() {
      document.getElementById('welcome-screen').style.display = 'none';
      document.getElementById('browser-wrapper').style.display = 'block';
      document.getElementById('tab-bar').style.display = 'flex';

      // Create test webview
      const container = document.getElementById('browser-container');
      let webview = container.querySelector('webview');
      if (!webview) {
        webview = document.createElement('webview');
        webview.className = 'browser-view';
        webview.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;width:100%;height:100%;';
        container.insertBefore(webview, container.firstChild);
      }
      webview.src = 'https://www.baidu.com';
    })()
  `);

  await new Promise(r => setTimeout(r, 3000)); // Wait for page load
  await captureScreenshot('2-browser-debug');

  info = await getLayoutInfo();
  console.log('Layout:', JSON.stringify(info, null, 2));

  // Analysis
  console.log('\n========== ANALYSIS ==========');
  if (info.webview && info.webview.h > 300) {
    console.log('✅ PASS: Webview height is', info.webview.h, 'px (good)');
  } else {
    console.log('❌ FAIL: Webview height is', info.webview?.h || 0, 'px (should be > 300)');
  }

  if (info.wrapper.h > 400) {
    console.log('✅ PASS: Wrapper height is', info.wrapper.h, 'px (good)');
  } else {
    console.log('❌ FAIL: Wrapper height is', info.wrapper.h, 'px (should be > 400)');
  }

  console.log('\nScreenshots saved to:', screenshotDir);
  console.log('\n========== DEBUG COMPLETE ==========\n');

  app.quit();
}

app.whenReady().then(runDebug);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
