const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

async function runTest() {
  console.log('\n========== LINK CLICK TEST ==========\n');

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

  await mainWindow.loadFile(path.join(__dirname, '../src/renderer/index.html'));
  console.log('App loaded, waiting for initialization...');
  await sleep(2000);

  // Navigate to Baidu and create webview
  console.log('Setting up webview and navigating to Baidu...');
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

        // Add new-window listener
        webview.addEventListener('new-window', (e) => {
          console.log('[WebView] new-window event:', e.url);
          e.preventDefault();
          if (e.url) {
            webview.src = e.url;
          }
        });
      }

      const container = document.getElementById('browser-container');
      if (container) {
        webview.style.width = container.clientWidth + 'px';
        webview.style.height = container.clientHeight + 'px';
      }

      webview.src = 'https://www.baidu.com';
    })()
  `);

  console.log('Waiting for Baidu to load...');
  await sleep(8000);

  // Check initial URL
  const initialUrl = await mainWindow.webContents.executeJavaScript(`
    document.querySelector('webview')?.getURL()
  `);
  console.log('Initial URL:', initialUrl);

  // Test clicking hot search items
  console.log('\n--- Test 1: Clicking hot search item ---');

  const clickResult1 = await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const webview = document.querySelector('webview');
      if (!webview) return 'no webview';

      return await webview.executeJavaScript(\`
        (function() {
          // Find hot search links with target="_blank"
          const blankLinks = document.querySelectorAll('a[target="_blank"]');
          console.log('Found target=_blank links:', blankLinks.length);

          if (blankLinks.length > 0) {
            const link = blankLinks[0];
            console.log('Clicking link:', link.href);
            link.click();
            return { clicked: true, href: link.href };
          }

          return { clicked: false, message: 'no blank links' };
        })()
      \`);
    })()
  `);
  console.log('Click result:', JSON.stringify(clickResult1));

  await sleep(3000);

  const afterHotClick = await mainWindow.webContents.executeJavaScript(`
    document.querySelector('webview')?.getURL()
  `);
  console.log('URL after click:', afterHotClick);

  console.log('\n========== TEST SUMMARY ==========');
  console.log('Initial:', initialUrl);
  console.log('After click:', afterHotClick);
  if (afterHotClick !== initialUrl) {
    console.log('Result: URL CHANGED - navigation worked');
  } else {
    console.log('Result: URL UNCHANGED - click may not have worked');
  }
  console.log('==================================\n');

  app.quit();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

runTest().catch(err => {
  console.error('Test failed:', err);
  app.quit();
});
