/**
 * Test new-window event handling in webview
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

function log(message) {
  console.log(`[${new Date().toISOString().substr(11, 12)}] ${message}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('\n========================================');
  console.log('  NEW-WINDOW EVENT TEST');
  console.log('========================================\n');

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

  mainWindow.webContents.on('console-message', (event, level, message) => {
    log(`[Renderer] ${message}`);
  });

  await mainWindow.loadFile(path.join(__dirname, '../src/renderer/index.html'));
  log('App loaded');
  await sleep(2000);

  // Setup webview with detailed new-window logging
  log('Creating webview with new-window listener...');
  await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const welcomeScreen = document.getElementById('welcome-screen');
      const browserWrapper = document.getElementById('browser-wrapper');
      const tabBar = document.getElementById('tab-bar');

      if (welcomeScreen) welcomeScreen.style.display = 'none';
      if (browserWrapper) browserWrapper.style.display = 'block';
      if (tabBar) tabBar.style.display = 'flex';

      const container = document.getElementById('browser-container');
      const webview = document.createElement('webview');
      webview.id = 'test-webview';
      webview.style.cssText = 'position: absolute; top: 0; left: 0; right: 0; bottom: 0; width: 100%; height: 100%;';
      webview.setAttribute('allowpopups', '');

      // Log all webview events
      const events = ['new-window', 'did-start-loading', 'did-stop-loading', 'did-navigate', 'dom-ready'];
      events.forEach(event => {
        webview.addEventListener(event, (e) => {
          console.log('[WebView Event]', event, e.url || (e.details && e.details.url) || '');
          if (event === 'new-window') {
            console.log('[new-window] url:', e.url);
            console.log('[new-window] details:', JSON.stringify(e.details));
            console.log('[new-window] options:', JSON.stringify(e.options));
          }
        });
      });

      // Specific new-window handler
      webview.addEventListener('new-window', (e) => {
        console.log('=== NEW-WINDOW EVENT FIRED ===');
        console.log('URL:', e.url);
        e.preventDefault();
        window.newWindowTriggered = true;
        window.newWindowUrl = e.url;
      });

      container.insertBefore(webview, container.firstChild);

      // Set size
      webview.style.width = container.clientWidth + 'px';
      webview.style.height = container.clientHeight + 'px';

      // Load Baidu
      webview.src = 'https://www.baidu.com';
      console.log('Webview created, loading Baidu...');
    })()
  `);

  log('Waiting for Baidu to load...');
  await sleep(6000);

  // Check current state
  const currentUrl = await mainWindow.webContents.executeJavaScript(`
    document.querySelector('webview')?.getURL()
  `);
  log(`Current URL: ${currentUrl}`);

  // Find and click target="_blank" link
  log('\n--- Clicking target="_blank" link ---');
  const clickResult = await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const webview = document.querySelector('webview');
      if (!webview) return { error: 'no webview' };

      return await webview.executeJavaScript(\`
        (function() {
          const blankLinks = document.querySelectorAll('a[target="_blank"]');
          console.log('Found target=_blank links:', blankLinks.length);

          // Log first few links
          for (let i = 0; i < Math.min(3, blankLinks.length); i++) {
            console.log('Link', i, ':', blankLinks[i].href, 'target:', blankLinks[i].target);
          }

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
  log(`Click result: ${JSON.stringify(clickResult)}`);

  await sleep(3000);

  // Check if new-window event was triggered
  const newWindowTriggered = await mainWindow.webContents.executeJavaScript(`
    window.newWindowTriggered || false
  `);
  const newWindowUrl = await mainWindow.webContents.executeJavaScript(`
    window.newWindowUrl || null
  `);

  log(`\n=== RESULTS ===`);
  log(`New-window event triggered: ${newWindowTriggered}`);
  log(`New-window URL: ${newWindowUrl}`);

  // Check if URL changed (meaning navigation happened in same page)
  const afterUrl = await mainWindow.webContents.executeJavaScript(`
    document.querySelector('webview')?.getURL()
  `);
  log(`URL after click: ${afterUrl}`);

  // Test with synthetic click that should definitely trigger new-window
  log('\n--- Testing synthetic new-window via executeJavaScript ---');
  await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const webview = document.querySelector('webview');
      if (!webview) return;

      // Try to programmatically open a new window from inside the webview
      await webview.executeJavaScript(\`
        (function() {
          // Try window.open
          console.log('Trying window.open...');
          try {
            const newWin = window.open('https://www.bing.com', '_blank');
            console.log('window.open returned:', newWin);
          } catch(e) {
            console.log('window.open error:', e.message);
          }
        })()
      \`);
    })()
  `);

  await sleep(2000);

  const syntheticTriggered = await mainWindow.webContents.executeJavaScript(`
    window.newWindowTriggered || false
  `);
  log(`Synthetic new-window triggered: ${syntheticTriggered}`);

  console.log('\n========================================');
  console.log('  TEST COMPLETE');
  console.log('========================================\n');

  app.quit();
}

runTest().catch(err => {
  console.error('Test failed:', err);
  app.quit();
});
