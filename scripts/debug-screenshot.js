/**
 * AI Self-Debug Script
 * Captures screenshots for layout debugging
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
const screenshotDir = path.join(__dirname, 'debug-output');

// Ensure output directory exists
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
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

  // Open DevTools for debugging
  mainWindow.webContents.openDevTools();

  await mainWindow.loadFile(path.join(__dirname, '../src/renderer/index.html'));

  // Wait for initial render
  await new Promise(r => setTimeout(r, 1500));

  // Capture initial state
  await captureScreenshot('01-welcome-screen');

  // Inject debug CSS
  await mainWindow.webContents.executeJavaScript(`
    const style = document.createElement('style');
    style.textContent = \`
      /* Debug visualization */
      .main-content { border: 3px solid orange !important; background: rgba(255,165,0,0.1) !important; }
      .browser-wrapper { border: 3px solid red !important; background: rgba(255,0,0,0.1) !important; }
      .browser-container { border: 3px solid blue !important; background: rgba(0,0,255,0.1) !important; }
      webview, .browser-view { border: 3px solid green !important; background: rgba(0,255,0,0.2) !important; }
      .welcome-screen { border: 3px solid purple !important; }
    \`;
    document.head.appendChild(style);
    console.log('Debug CSS injected');
  `);

  await new Promise(r => setTimeout(r, 500));
  await captureScreenshot('02-with-debug-css');

  // Get layout info
  const layoutInfo = await mainWindow.webContents.executeJavaScript(`
    (function() {
      const wrapper = document.getElementById('browser-wrapper');
      const container = document.getElementById('browser-container');
      const mainContent = document.querySelector('.main-content');
      const welcome = document.getElementById('welcome-screen');

      return {
        window: { width: window.innerWidth, height: window.innerHeight },
        mainContent: mainContent ? {
          display: getComputedStyle(mainContent).display,
          flex: getComputedStyle(mainContent).flex,
          height: mainContent.offsetHeight,
          offsetHeight: mainContent.offsetHeight
        } : null,
        wrapper: wrapper ? {
          display: getComputedStyle(wrapper).display,
          flex: getComputedStyle(wrapper).flex,
          height: wrapper.offsetHeight,
          styleHeight: wrapper.style.height
        } : null,
        container: container ? {
          display: getComputedStyle(container).display,
          position: getComputedStyle(container).position,
          height: container.offsetHeight
        } : null,
        welcome: welcome ? {
          display: getComputedStyle(welcome).display,
          height: welcome.offsetHeight
        } : null
      };
    })()
  `);

  console.log('\n=== Layout Debug Info ===');
  console.log(JSON.stringify(layoutInfo, null, 2));

  // Save layout info
  fs.writeFileSync(
    path.join(screenshotDir, 'layout-info.json'),
    JSON.stringify(layoutInfo, null, 2)
  );

  // Simulate showing browser view
  await mainWindow.webContents.executeJavaScript(`
    (function() {
      document.getElementById('welcome-screen').style.display = 'none';
      document.getElementById('browser-wrapper').style.display = 'block';
      document.getElementById('tab-bar').style.display = 'flex';

      // Create a test webview
      const container = document.getElementById('browser-container');
      const existingWebview = container.querySelector('webview');
      if (!existingWebview) {
        const webview = document.createElement('webview');
        webview.id = 'test-webview';
        webview.className = 'browser-view';
        webview.style.cssText = 'position: absolute; top: 0; left: 0; right: 0; bottom: 0; width: 100%; height: 100%;';
        webview.src = 'data:text/html,<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f0f0f0;"><h1>Test WebView Content</h1></body></html>';
        container.insertBefore(webview, container.firstChild);
      }
    })()
  `);

  await new Promise(r => setTimeout(r, 1000));
  await captureScreenshot('03-browser-view');

  // Get layout info after showing browser
  const layoutInfo2 = await mainWindow.webContents.executeJavaScript(`
    (function() {
      const wrapper = document.getElementById('browser-wrapper');
      const container = document.getElementById('browser-container');
      const mainContent = document.querySelector('.main-content');
      const webview = document.querySelector('webview');

      return {
        window: { width: window.innerWidth, height: window.innerHeight },
        mainContent: mainContent ? {
          display: getComputedStyle(mainContent).display,
          flex: getComputedStyle(mainContent).flex,
          height: mainContent.offsetHeight,
          clientHeight: mainContent.clientHeight
        } : null,
        wrapper: wrapper ? {
          display: getComputedStyle(wrapper).display,
          flex: getComputedStyle(wrapper).flex,
          position: getComputedStyle(wrapper).position,
          height: wrapper.offsetHeight,
          clientHeight: wrapper.clientHeight
        } : null,
        container: container ? {
          display: getComputedStyle(container).display,
          position: getComputedStyle(container).position,
          height: container.offsetHeight,
          clientHeight: container.clientHeight,
          styleHeight: container.style.height
        } : null,
        webview: webview ? {
          display: getComputedStyle(webview).display,
          position: getComputedStyle(webview).position,
          height: webview.offsetHeight,
          clientHeight: webview.clientHeight
        } : null
      };
    })()
  `);

  console.log('\n=== Browser View Layout Info ===');
  console.log(JSON.stringify(layoutInfo2, null, 2));

  // Save layout info
  fs.writeFileSync(
    path.join(screenshotDir, 'layout-info-browser.json'),
    JSON.stringify(layoutInfo2, null, 2)
  );

  console.log('\n=== Debug Complete ===');
  console.log('Screenshots saved to:', screenshotDir);

  app.quit();
}

async function captureScreenshot(name) {
  const imagePath = path.join(screenshotDir, `${name}.png`);
  const image = await mainWindow.capturePage();
  fs.writeFileSync(imagePath, image.toPNG());
  console.log(`Screenshot saved: ${name}.png`);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
