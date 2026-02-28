const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

async function runDebug() {
  console.log('\n========== AUTO DEBUG START ==========\n');

  // Wait for app to be ready
  await app.whenReady();

  // Create browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../src/preload/index.js'),
      webviewTag: true
    }
  });

  // Load the app
  await mainWindow.loadFile(path.join(__dirname, '../src/renderer/index.html'));

  console.log('App loaded, waiting for initialization...');
  await sleep(2000);

  // Navigate to Baidu
  console.log('Navigating to Baidu...');
  await mainWindow.webContents.executeJavaScript(`
    (async () => {
      // First show the browser view
      const welcomeScreen = document.getElementById('welcome-screen');
      const browserWrapper = document.getElementById('browser-wrapper');
      if (welcomeScreen) welcomeScreen.style.display = 'none';
      if (browserWrapper) browserWrapper.style.display = 'block';

      // Get or create webview
      let wv = document.querySelector('webview');
      if (!wv) {
        // Create webview directly
        const container = document.getElementById('browser-container');
        wv = document.createElement('webview');
        wv.id = 'test-webview';
        wv.style.cssText = 'position: absolute; top: 0; left: 0; right: 0; bottom: 0; width: 100%; height: 100%;';
        wv.setAttribute('allowpopups', '');
        container.insertBefore(wv, container.firstChild);
      }

      // Set correct size before loading
      const container = document.getElementById('browser-container');
      if (container) {
        wv.style.width = container.clientWidth + 'px';
        wv.style.height = container.clientHeight + 'px';
      }

      // Load URL
      wv.src = 'https://www.baidu.com';
      console.log('Loading URL:', wv.src);
    })()
  `);

  // Wait for page to load
  console.log('Waiting for page to load...');
  await sleep(8000);

  // Get layout info
  console.log('\n========== LAYOUT INFO ==========\n');
  const layoutInfo = await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const wv = document.querySelector('webview');
      return {
        window: { width: window.innerWidth, height: window.innerHeight },
        toolbar: document.querySelector('.toolbar')?.offsetHeight,
        mainContent: document.querySelector('.main-content')?.offsetHeight,
        wrapper: {
          display: getComputedStyle(document.getElementById('browser-wrapper'))?.display,
          height: document.getElementById('browser-wrapper')?.offsetHeight
        },
        container: {
          position: getComputedStyle(document.getElementById('browser-container'))?.position,
          height: document.getElementById('browser-container')?.offsetHeight
        },
        webview: wv ? {
          display: getComputedStyle(wv).display,
          height: wv.offsetHeight,
          width: wv.offsetWidth,
          src: wv.src
        } : null
      };
    })()
  `);

  console.log('Window:', layoutInfo.window.width + 'x' + layoutInfo.window.height);
  console.log('Toolbar:', layoutInfo.toolbar + 'px');
  console.log('MainContent:', layoutInfo.mainContent + 'px');
  console.log('Wrapper:', layoutInfo.wrapper?.height + 'px (' + layoutInfo.wrapper?.display + ')');
  console.log('Container:', layoutInfo.container?.height + 'px (' + layoutInfo.container?.position + ')');
  console.log('Webview:', layoutInfo.webview?.height + 'x' + layoutInfo.webview?.width + 'px');
  console.log('Webview src:', layoutInfo.webview?.src);

  // Check for issues
  const webviewHeight = layoutInfo.webview?.height || 0;
  const containerHeight = layoutInfo.container?.height || 0;
  const expectedHeight = layoutInfo.mainContent - layoutInfo.toolbar;

  console.log('\n========== ANALYSIS ==========\n');
  console.log('Expected webview height (approx):', expectedHeight + 'px');
  console.log('Actual webview height:', webviewHeight + 'px');
  console.log('Container height:', containerHeight + 'px');

  if (webviewHeight < expectedHeight * 0.8) {
    console.log('⚠️ ISSUE: Webview height is less than 80% of expected!');
    console.log('   Webview may not be filling the container properly.');
  } else {
    console.log('✓ Webview height looks correct');
  }

  // Take screenshot
  const screenshotDir = path.join(__dirname, 'debug-output');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const screenshotPath = path.join(screenshotDir, 'auto-debug-screenshot.png');
  const image = await mainWindow.capturePage();
  fs.writeFileSync(screenshotPath, image.toPNG());
  console.log('\nScreenshot saved to:', screenshotPath);

  console.log('\n========== AUTO DEBUG COMPLETE ==========\n');

  // Exit
  app.quit();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

runDebug().catch(err => {
  console.error('Debug failed:', err);
  app.quit();
});
