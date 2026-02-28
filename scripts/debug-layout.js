/**
 * AI Self-Debug Script - Runs with real main process
 * Usage: npm start & node scripts/debug-layout.js
 */
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

const screenshotDir = path.join(__dirname, 'debug-output');

// Ensure output directory exists
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

// Inject debug CSS
function injectDebugCSS() {
  const style = document.createElement('style');
  style.id = 'debug-styles';
  style.textContent = `
    /* Debug visualization */
    .main-content { border: 3px solid orange !important; background: rgba(255,165,0,0.1) !important; }
    .browser-wrapper { border: 3px solid red !important; background: rgba(255,0,0,0.1) !important; }
    .browser-container { border: 3px solid blue !important; background: rgba(0,0,255,0.1) !important; }
    webview, .browser-view { border: 3px solid green !important; background: rgba(0,255,0,0.2) !important; }
    .welcome-screen { border: 3px solid purple !important; }
  `;
  document.head.appendChild(style);
  console.log('[Debug] CSS injected');
}

// Get layout information
function getLayoutInfo() {
  const wrapper = document.getElementById('browser-wrapper');
  const container = document.getElementById('browser-container');
  const mainContent = document.querySelector('.main-content');
  const welcome = document.getElementById('welcome-screen');
  const webview = document.querySelector('webview');
  const toolbar = document.querySelector('.toolbar');
  const tabBar = document.getElementById('tab-bar');

  return {
    window: { width: window.innerWidth, height: window.innerHeight },
    toolbar: toolbar ? {
      height: toolbar.offsetHeight,
      display: getComputedStyle(toolbar).display
    } : null,
    tabBar: tabBar ? {
      height: tabBar.offsetHeight,
      display: getComputedStyle(tabBar).display
    } : null,
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
      clientHeight: container.clientHeight
    } : null,
    webview: webview ? {
      display: getComputedStyle(webview).display,
      position: getComputedStyle(webview).position,
      width: webview.offsetWidth,
      height: webview.offsetHeight,
      clientWidth: webview.clientWidth,
      clientHeight: webview.clientHeight,
      src: webview.src ? webview.src.substring(0, 100) : null
    } : null,
    welcome: welcome ? {
      display: getComputedStyle(welcome).display,
      height: welcome.offsetHeight
    } : null
  };
}

// Print layout info
function printLayoutInfo(label) {
  const info = getLayoutInfo();
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(info, null, 2));
  return info;
}

// Save layout info to file (via copy to clipboard for manual save)
function saveLayoutInfo(info, filename) {
  const outputPath = path.join(screenshotDir, filename);
  fs.writeFileSync(outputPath, JSON.stringify(info, null, 2));
  console.log(`[Debug] Layout info saved to: ${outputPath}`);
}

// Initialize debug mode
function initDebug() {
  console.log('[Debug] Initializing debug mode...');

  // Inject debug CSS
  injectDebugCSS();

  // Add keyboard shortcut for debug
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+D: Toggle debug CSS
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      const style = document.getElementById('debug-styles');
      if (style) {
        style.remove();
        console.log('[Debug] CSS removed');
      } else {
        injectDebugCSS();
      }
    }

    // Ctrl+Shift+I: Print layout info
    if (e.ctrlKey && e.shiftKey && e.key === 'I') {
      printLayoutInfo('Manual Layout Check');
    }
  });

  // Monitor DOM changes
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
        const target = mutation.target;
        if (target.id === 'browser-wrapper' || target.id === 'welcome-screen') {
          console.log(`[Debug] ${target.id} style changed:`, target.style.display);
          setTimeout(() => printLayoutInfo('After style change'), 100);
        }
      }
    }
  });

  observer.observe(document.body, {
    attributes: true,
    subtree: true,
    attributeFilter: ['style']
  });

  // Log initial state
  setTimeout(() => printLayoutInfo('Initial State'), 1000);
}

// Auto-run if loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDebug);
} else {
  initDebug();
}

// Expose to window for console access
window.debugLayout = {
  injectCSS: injectDebugCSS,
  getInfo: getLayoutInfo,
  print: printLayoutInfo,
  save: saveLayoutInfo
};

console.log('[Debug] Debug module loaded. Use window.debugLayout or Ctrl+Shift+D/I');
