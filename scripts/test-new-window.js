const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

async function runTest() {
  console.log('\n========== NEW-WINDOW EVENT TEST ==========\n');

  await app.whenReady();

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

  // Log all console messages from renderer
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log('[Renderer]', message);
  });

  await mainWindow.loadFile(path.join(__dirname, '../src/renderer/index.html'));
  console.log('App loaded');
  await sleep(2000);

  // Create webview and add logging
  console.log('Creating webview...');
  await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const welcomeScreen = document.getElementById('welcome-screen');
      const browserWrapper = document.getElementById('browser-wrapper');
      if (welcomeScreen) welcomeScreen.style.display = 'none';
      if (browserWrapper) browserWrapper.style.display = 'block';

      let webview = document.querySelector('webview');
      if (!webview) {
        const container = document.getElementById('browser-container');
        webview = document.createElement('webview');
        webview.id = 'main-webview';
        webview.style.cssText = 'position: absolute; top: 0; left: 0; right: 0; bottom: 0; width: 100%; height: 100%;';
        container.insertBefore(webview, container.firstChild);

        // Add detailed new-window listener
        webview.addEventListener('new-window', (e) => {
          console.log('=== NEW-WINDOW EVENT ===');
          console.log('Event type:', e.type);
          console.log('Event url:', e.url);
          console.log('Event details:', JSON.stringify(e.details));
          console.log('Event options:', JSON.stringify(e.options));
          console.log('All event keys:', Object.keys(e));

          e.preventDefault();
          const targetUrl = e.url || (e.details && e.details.url) || (e.options && e.options.url);
          if (targetUrl) {
            console.log('Setting webview.src to:', targetUrl);
            webview.src = targetUrl;
          } else {
            console.log('ERROR: No URL found in event!');
          }
        });

        webview.addEventListener('did-start-loading', () => console.log('Webview loading...'));
        webview.addEventListener('did-stop-loading', () => console.log('Webview stopped loading'));
        webview.addEventListener('did-navigate', (e) => console.log('Navigated to:', e.url));
      }

      const container = document.getElementById('browser-container');
      if (container) {
        webview.style.width = container.clientWidth + 'px';
        webview.style.height = container.clientHeight + 'px';
      }

      console.log('Loading Baidu...');
      webview.src = 'https://www.baidu.com';
    })()
  `);

  console.log('Waiting for Baidu to load...');
  await sleep(6000);

  // Get current URL
  let currentUrl = await mainWindow.webContents.executeJavaScript(`document.querySelector('webview')?.getURL()`);
  console.log('\nCurrent URL:', currentUrl);

  // Click a target="_blank" link
  console.log('\n--- Clicking target=_blank link ---');
  const clickResult = await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const webview = document.querySelector('webview');
      if (!webview) return 'no webview';

      return await webview.executeJavaScript(\`
        (function() {
          const blankLinks = document.querySelectorAll('a[target="_blank"]');
          console.log('Found', blankLinks.length, 'blank links');

          if (blankLinks.length > 0) {
            const link = blankLinks[0];
            console.log('Clicking:', link.href);
            link.click();
            return { clicked: true, href: link.href };
          }
          return { clicked: false };
        })()
      \`);
    })()
  `);
  console.log('Click result:', JSON.stringify(clickResult));

  // Wait and check if navigation happened
  await sleep(3000);

  currentUrl = await mainWindow.webContents.executeJavaScript(`document.querySelector('webview')?.getURL()`);
  console.log('\nURL after click:', currentUrl);

  console.log('\n========== TEST COMPLETE ==========\n');
  app.quit();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

runTest().catch(err => {
  console.error('Test failed:', err);
  app.quit();
});
