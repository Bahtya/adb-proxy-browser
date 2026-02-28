// DOM Elements
const elements = {
  // Navigation
  btnBack: document.getElementById('btn-back'),
  btnForward: document.getElementById('btn-forward'),
  btnRefresh: document.getElementById('btn-refresh'),
  urlInput: document.getElementById('url-input'),
  urlSuggestions: document.getElementById('url-suggestions'),

  // Connection
  connectionStatus: document.getElementById('connection-status'),
  deviceInfo: document.getElementById('device-info'),
  btnConnect: document.getElementById('btn-connect'),

  // Settings
  proxyPort: document.getElementById('proxy-port'),
  remotePort: document.getElementById('remote-port'),
  proxyType: document.getElementById('proxy-type'),
  btnSettings: document.getElementById('btn-settings'),

  // Modal
  settingsModal: document.getElementById('settings-modal'),
  btnCloseSettings: document.getElementById('btn-close-settings'),
  btnSaveSettings: document.getElementById('btn-save-settings'),
  settingsProxyPort: document.getElementById('settings-proxy-port'),
  settingsRemotePort: document.getElementById('settings-remote-port'),
  settingsProxyType: document.getElementById('settings-proxy-type'),

  // Views
  welcomeScreen: document.getElementById('welcome-screen'),
  browserContainer: document.getElementById('browser-container'),
  browserWrapper: document.getElementById('browser-wrapper'),

  // Tabs
  tabBar: document.getElementById('tab-bar'),
  tabList: document.getElementById('tab-list'),
  btnNewTab: document.getElementById('btn-new-tab'),

  // Find Bar
  findBar: document.getElementById('find-bar'),
  findInput: document.getElementById('find-input'),
  findCount: document.getElementById('find-count'),
  findPrev: document.getElementById('find-prev'),
  findNext: document.getElementById('find-next'),
  findClose: document.getElementById('find-close'),

  // Progress Bar
  progressBar: document.getElementById('progress-bar')
};

// URL History Manager
class URLHistory {
  constructor() {
    this.maxItems = 100;
    this.storageKey = 'adb-browser-url-history';
    this.history = this.load();
  }

  load() {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.history));
    } catch (e) {
      console.warn('Failed to save URL history:', e);
    }
  }

  add(url, title = '') {
    if (!url || url === 'about:blank') return;

    // Remove existing entry
    this.history = this.history.filter(item => item.url !== url);

    // Add to front
    this.history.unshift({
      url,
      title: title || this.extractTitle(url),
      timestamp: Date.now()
    });

    // Limit size
    if (this.history.length > this.maxItems) {
      this.history = this.history.slice(0, this.maxItems);
    }

    this.save();
  }

  extractTitle(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return url;
    }
  }

  search(query) {
    if (!query) return this.history.slice(0, 10);

    const lowerQuery = query.toLowerCase();
    return this.history.filter(item => {
      const urlMatch = item.url.toLowerCase().includes(lowerQuery);
      const titleMatch = item.title.toLowerCase().includes(lowerQuery);
      return urlMatch || titleMatch;
    }).slice(0, 10);
  }

  clear() {
    this.history = [];
    this.save();
  }
}

// Tab Manager
class TabManager {
  constructor() {
    this.tabs = new Map();
    this.activeTabId = null;
    this.tabCounter = 0;
  }

  // Preload script for Ctrl+click handling
  getPreloadScript() {
    return 'data:text/javascript,' + encodeURIComponent(`
      document.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey) {
          const link = e.target.closest('a');
          if (link && link.href) {
            e.preventDefault();
            e.stopPropagation();
            window.postMessage({ type: 'open-in-new-tab', url: link.href }, '*');
          }
        }
      }, true);
    `);
  }

  createTab(url = 'about:blank') {
    const tabId = `tab-${++this.tabCounter}`;

    // Create tab item in tab bar
    const tabElement = document.createElement('button');
    tabElement.className = 'tab-item';
    tabElement.dataset.tabId = tabId;
    tabElement.innerHTML = `
      <span class="tab-title">Loading...</span>
      <button class="tab-close" title="Close tab">&times;</button>
    `;

    // Tab click to switch
    tabElement.addEventListener('click', (e) => {
      if (!e.target.classList.contains('tab-close')) {
        this.switchTab(tabId);
      }
    });

    // Middle-click to close
    tabElement.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.closeTab(tabId);
      }
    });

    // Close button click
    tabElement.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeTab(tabId);
    });

    elements.tabList.appendChild(tabElement);

    // Create webview
    const webview = document.createElement('webview');
    webview.id = tabId;
    webview.className = 'browser-view';
    webview.setAttribute('allowpopups', '');
    webview.setAttribute('preload', this.getPreloadScript());
    webview.style.cssText = 'position: absolute; top: 0; left: 0; right: 0; bottom: 0; width: 100%; height: 100%; display: none;';

    // Webview events
    webview.addEventListener('did-start-loading', () => {
      this.updateTabTitle(tabId, 'Loading...');
      elements.btnRefresh.classList.add('loading');
      this.showProgressBar(true);
    });

    webview.addEventListener('did-stop-loading', () => {
      elements.btnRefresh.classList.remove('loading');
      this.showProgressBar(false);
    });

    webview.addEventListener('did-finish-load', () => {
      const title = webview.getTitle() || 'Untitled';
      const url = webview.getURL();
      this.updateTabTitle(tabId, title);
      if (this.activeTabId === tabId) {
        elements.urlInput.value = url;
        this.updateNavigationButtons(webview);
      }
      // Save to history
      if (url && url !== 'about:blank') {
        urlHistory.add(url, title);
      }
    });

    webview.addEventListener('did-navigate', (e) => {
      if (this.activeTabId === tabId) {
        elements.urlInput.value = e.url;
        this.updateNavigationButtons(webview);
      }
    });

    webview.addEventListener('did-navigate-in-page', (e) => {
      if (this.activeTabId === tabId && e.isMainFrame) {
        elements.urlInput.value = e.url;
        this.updateNavigationButtons(webview);
      }
    });

    webview.addEventListener('page-title-updated', (e) => {
      this.updateTabTitle(tabId, e.title);
    });

    // Favicon support
    webview.addEventListener('page-favicon-updated', (e) => {
      if (e.favicons && e.favicons.length > 0) {
        this.updateTabFavicon(tabId, e.favicons[0]);
      }
    });

    // Handle new window requests (links with target="_blank")
    webview.addEventListener('new-window', (e) => {
      this.createTab(e.url);
    });

    // Context menu (right-click)
    webview.addEventListener('context-menu', (e) => {
      e.preventDefault();
      const { x, y, linkURL, srcURL, selectionText } = e.params;

      if (linkURL || srcURL) {
        const url = linkURL || srcURL;
        showContextMenu({ x, y, url, webview, type: 'link' });
      } else if (selectionText) {
        showContextMenu({ x, y, selectionText, webview, type: 'selection' });
      } else {
        showContextMenu({ x, y, webview, type: 'page' });
      }
    });

    // Handle messages from preload script (Ctrl+click)
    webview.addEventListener('ipc-message', (e) => {
      if (e.channel === 'open-in-new-tab') {
        const url = e.args[0];
        this.createTab(url);
      }
    });

    // Listen for postMessage from preload script
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'open-in-new-tab' && e.source === webview.contentWindow) {
        this.createTab(e.data.url);
      }
    });

    // Load progress
    webview.addEventListener('did-start-loading', () => {
      this.updateProgress(0);
    });

    webview.addEventListener('load-progress', (e) => {
      this.updateProgress(e.progress);
    });

    // Error handling
    webview.addEventListener('did-fail-load', (e) => {
      if (e.errorCode !== -3) { // Ignore aborted loads
        console.error('Load failed:', e);
        this.showErrorPage(webview, e);
      }
    });

    // Find in page results
    webview.addEventListener('found-in-page', (e) => {
      handleFindResult(e.result);
    });

    // Insert webview before progress bar (which is first child)
    const progressBarContainer = document.getElementById('progress-bar-container');
    elements.browserContainer.insertBefore(webview, progressBarContainer);

    // Store tab info
    this.tabs.set(tabId, {
      element: tabElement,
      webview: webview,
      url: url
    });

    // Load URL if provided
    if (url && url !== 'about:blank') {
      webview.src = url;
    }

    // Switch to new tab
    this.switchTab(tabId);

    return tabId;
  }

  closeTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    // If only one tab, just navigate to blank
    if (this.tabs.size === 1) {
      tab.webview.src = 'about:blank';
      this.updateTabTitle(tabId, 'New Tab');
      elements.urlInput.value = '';
      return;
    }

    // Remove tab
    tab.element.remove();
    tab.webview.remove();
    this.tabs.delete(tabId);

    // Switch to another tab if active tab was closed
    if (this.activeTabId === tabId) {
      const remainingTabs = Array.from(this.tabs.keys());
      this.switchTab(remainingTabs[remainingTabs.length - 1]);
    }
  }

  switchTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    // Hide all webviews
    this.tabs.forEach((t) => {
      t.webview.style.display = 'none';
      t.element.classList.remove('active');
    });

    // Show selected webview
    tab.webview.style.display = 'block';
    tab.element.classList.add('active');
    this.activeTabId = tabId;

    // Update URL bar
    const url = tab.webview.getURL();
    elements.urlInput.value = url || '';

    // Update navigation buttons
    this.updateNavigationButtons(tab.webview);
  }

  updateTabTitle(tabId, title) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    const titleElement = tab.element.querySelector('.tab-title');
    if (titleElement) {
      titleElement.textContent = title || 'Untitled';
      titleElement.title = title || 'Untitled';
    }
  }

  updateTabFavicon(tabId, faviconUrl) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    let faviconEl = tab.element.querySelector('.tab-favicon');
    if (!faviconEl) {
      faviconEl = document.createElement('img');
      faviconEl.className = 'tab-favicon';
      const titleEl = tab.element.querySelector('.tab-title');
      tab.element.insertBefore(faviconEl, titleEl);
    }
    faviconEl.src = faviconUrl;
  }

  updateNavigationButtons(webview) {
    elements.btnBack.disabled = !webview.canGoBack();
    elements.btnForward.disabled = !webview.canGoForward();
  }

  showProgressBar(show) {
    if (show) {
      elements.progressBar.classList.add('indeterminate');
      elements.progressBar.style.width = '30%';
    } else {
      elements.progressBar.classList.remove('indeterminate');
      elements.progressBar.style.width = '100%';
      setTimeout(() => {
        elements.progressBar.style.width = '0%';
      }, 200);
    }
  }

  updateProgress(progress) {
    if (progress >= 0 && progress < 100) {
      elements.progressBar.classList.remove('indeterminate');
      elements.progressBar.style.width = `${progress}%`;
    }
  }

  showErrorPage(webview, error) {
    const errorHtml = `
      <html>
        <head>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: #ffffff;
              color: #202124;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
            }
            h2 { color: #ea4335; margin-bottom: 12px; font-size: 18px; font-weight: 500; }
            p { color: #5f6368; margin-bottom: 20px; text-align: center; font-size: 14px; max-width: 400px; }
            button {
              padding: 10px 24px;
              background: #1a73e8;
              color: white;
              border: none;
              border-radius: 8px;
              cursor: pointer;
              font-size: 14px;
              font-weight: 500;
            }
            button:hover { background: #1557b0; }
          </style>
        </head>
        <body>
          <h2>Page Load Error</h2>
          <p>${error.errorDescription || 'Failed to load the page'}</p>
          <button onclick="location.reload()">Retry</button>
        </body>
      </html>
    `;
    webview.executeJavaScript(`document.open(); document.write(\`${errorHtml}\`); document.close();`);
  }

  getActiveWebview() {
    if (!this.activeTabId) return null;
    const tab = this.tabs.get(this.activeTabId);
    return tab ? tab.webview : null;
  }

  navigate(url) {
    const webview = this.getActiveWebview();
    if (webview) {
      webview.src = url;
    }
  }

  goBack() {
    const webview = this.getActiveWebview();
    if (webview && webview.canGoBack()) {
      webview.goBack();
    }
  }

  goForward() {
    const webview = this.getActiveWebview();
    if (webview && webview.canGoForward()) {
      webview.goForward();
    }
  }

  refresh() {
    const webview = this.getActiveWebview();
    if (webview) {
      webview.reload();
    }
  }

  switchToNextTab() {
    const tabIds = Array.from(this.tabs.keys());
    const currentIndex = tabIds.indexOf(this.activeTabId);
    const nextIndex = (currentIndex + 1) % tabIds.length;
    this.switchTab(tabIds[nextIndex]);
  }

  switchToPrevTab() {
    const tabIds = Array.from(this.tabs.keys());
    const currentIndex = tabIds.indexOf(this.activeTabId);
    const prevIndex = (currentIndex - 1 + tabIds.length) % tabIds.length;
    this.switchTab(tabIds[prevIndex]);
  }
}

// Context Menu
function showContextMenu({ x, y, url, selectionText, webview, type }) {
  // Remove existing menu
  const existingMenu = document.getElementById('context-menu');
  if (existingMenu) existingMenu.remove();

  const menu = document.createElement('div');
  menu.id = 'context-menu';
  menu.className = 'context-menu';

  // Position menu within viewport
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let menuHtml = '';

  if (type === 'link') {
    menuHtml = `
      <div class="menu-item" data-action="open-new-tab">Open link in new tab</div>
      <div class="menu-item" data-action="copy-link">Copy link address</div>
      <div class="menu-divider"></div>
    `;
  } else if (type === 'selection') {
    menuHtml = `
      <div class="menu-item" data-action="copy">Copy</div>
      <div class="menu-divider"></div>
    `;
  }

  menuHtml += `
    <div class="menu-item" data-action="back">Back</div>
    <div class="menu-item" data-action="forward">Forward</div>
    <div class="menu-item" data-action="reload">Reload</div>
    <div class="menu-divider"></div>
    <div class="menu-item" data-action="inspect">Inspect element</div>
  `;

  menu.innerHTML = menuHtml;

  // Adjust position to stay within viewport
  menu.style.left = `${Math.min(x, viewportWidth - 200)}px`;
  menu.style.top = `${Math.min(y, viewportHeight - 200)}px`;

  document.body.appendChild(menu);

  // Menu item click handling
  menu.addEventListener('click', (e) => {
    const action = e.target.dataset.action;
    if (!action) return;

    switch (action) {
      case 'open-new-tab':
        tabManager.createTab(url);
        break;
      case 'copy-link':
      case 'copy':
        navigator.clipboard.writeText(url || selectionText);
        break;
      case 'back':
        webview.goBack();
        break;
      case 'forward':
        webview.goForward();
        break;
      case 'reload':
        webview.reload();
        break;
      case 'inspect':
        webview.inspectElement(x, y);
        break;
    }
    menu.remove();
  });

  // Close menu on click outside
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);

  // Close menu on Escape
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      menu.remove();
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);
}

// Find Bar Functions
function showFindBar() {
  elements.findBar.classList.add('active');
  elements.findInput.focus();
  elements.findInput.select();
}

function hideFindBar() {
  elements.findBar.classList.remove('active');
  elements.findInput.value = '';
  elements.findCount.textContent = '';

  // Stop finding in page
  const webview = tabManager.getActiveWebview();
  if (webview) {
    webview.stopFindInPage('clearSelection');
  }
}

function findInPage(direction = 'forward') {
  const searchText = elements.findInput.value;
  if (!searchText) {
    elements.findCount.textContent = '';
    return;
  }

  const webview = tabManager.getActiveWebview();
  if (!webview) return;

  if (direction === 'forward') {
    webview.findInPage(searchText);
  } else {
    webview.findInPage(searchText, { forward: false, findNext: true });
  }
}

// Handle find-in-page results
function handleFindResult(e) {
  const { activeMatchOrdinal, matches } = e;
  if (matches > 0) {
    elements.findCount.textContent = `${activeMatchOrdinal} of ${matches}`;
  } else {
    elements.findCount.textContent = 'No matches';
  }
}

// State
let state = {
  connected: false,
  devices: [],
  currentUrl: '',
  adbError: null,
  config: {
    localPort: 7890,
    remotePort: 7890,
    proxyType: 'http'
  }
};

// Tab manager instance
const tabManager = new TabManager();

// URL history instance
const urlHistory = new URLHistory();

// Autocomplete state
let selectedSuggestionIndex = -1;
let currentSuggestions = [];

// Initialize
async function init() {
  // Listen for ADB errors
  window.electronAPI.onAdbError((error) => {
    state.adbError = error;
    showAdbError(error);
  });

  // Load config
  try {
    const config = await window.electronAPI.getConfig();
    state.config = config;
    updateSettingsUI();
  } catch (err) {
    console.error('Failed to load config:', err);
  }

  // Get initial device list
  try {
    const devices = await window.electronAPI.getDevices();
    state.devices = devices;
    updateDeviceUI();
  } catch (err) {
    console.error('Failed to get devices:', err);
  }

  // Get connection status
  try {
    const status = await window.electronAPI.getStatus();
    state.connected = status.connected;
    updateConnectionUI();
  } catch (err) {
    console.error('Failed to get status:', err);
  }

  // Setup event listeners
  setupEventListeners();
}

// Setup event listeners
function setupEventListeners() {
  // Navigation
  elements.btnBack.addEventListener('click', () => tabManager.goBack());
  elements.btnForward.addEventListener('click', () => tabManager.goForward());
  elements.btnRefresh.addEventListener('click', () => tabManager.refresh());
  elements.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedSuggestionIndex >= 0 && currentSuggestions[selectedSuggestionIndex]) {
        navigate(currentSuggestions[selectedSuggestionIndex].url);
      } else {
        navigate();
      }
    } else if (['ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) {
      handleSuggestionKeydown(e);
    }
  });

  elements.urlInput.addEventListener('input', () => {
    const query = elements.urlInput.value.trim();
    if (query) {
      const suggestions = urlHistory.search(query);
      showSuggestions(suggestions);
    } else {
      hideSuggestions();
    }
  });

  // URL input select on focus
  elements.urlInput.addEventListener('focus', () => {
    elements.urlInput.select();
    const query = elements.urlInput.value.trim();
    if (query) {
      const suggestions = urlHistory.search(query);
      showSuggestions(suggestions);
    }
  });

  // Hide suggestions on blur (with delay for click handling)
  elements.urlInput.addEventListener('blur', () => {
    setTimeout(hideSuggestions, 200);
  });

  // New tab button
  elements.btnNewTab.addEventListener('click', () => {
    tabManager.createTab();
  });

  // Connection
  elements.btnConnect.addEventListener('click', toggleConnection);

  // Settings
  elements.btnSettings.addEventListener('click', openSettings);
  elements.btnCloseSettings.addEventListener('click', closeSettings);
  elements.btnSaveSettings.addEventListener('click', saveSettings);

  // Settings change listeners
  elements.proxyPort.addEventListener('change', updateConfig);
  elements.remotePort.addEventListener('change', updateConfig);
  elements.proxyType.addEventListener('change', updateConfig);

  // Listen for device changes
  window.electronAPI.onDeviceChanged((devices) => {
    state.devices = devices;
    updateDeviceUI();
  });

  // Listen for connection status changes
  window.electronAPI.onStatusChanged((status) => {
    state.connected = status.connected;
    updateConnectionUI();
  });

  // Close modal on outside click
  elements.settingsModal.addEventListener('click', (e) => {
    if (e.target === elements.settingsModal) {
      closeSettings();
    }
  });

  // Find bar events
  elements.findInput.addEventListener('input', () => findInPage());
  elements.findInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      findInPage(e.shiftKey ? 'backward' : 'forward');
    }
  });
  elements.findPrev.addEventListener('click', () => findInPage('backward'));
  elements.findNext.addEventListener('click', () => findInPage('forward'));
  elements.findClose.addEventListener('click', hideFindBar);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl+T: New tab
    if ((e.ctrlKey || e.metaKey) && e.key === 't') {
      e.preventDefault();
      tabManager.createTab();
    }
    // Ctrl+W: Close current tab
    else if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
      e.preventDefault();
      if (tabManager.activeTabId) {
        tabManager.closeTab(tabManager.activeTabId);
      }
    }
    // Ctrl+Tab: Next tab
    else if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      tabManager.switchToNextTab();
    }
    // Ctrl+Shift+Tab: Previous tab
    else if (e.ctrlKey && e.shiftKey && e.key === 'Tab') {
      e.preventDefault();
      tabManager.switchToPrevTab();
    }
    // F5: Refresh
    else if (e.key === 'F5') {
      e.preventDefault();
      tabManager.refresh();
    }
    // Ctrl+R: Refresh
    else if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
      e.preventDefault();
      tabManager.refresh();
    }
    // Alt+Left: Back
    else if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      tabManager.goBack();
    }
    // Alt+Right: Forward
    else if (e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      tabManager.goForward();
    }
    // Ctrl+F: Find
    else if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      showFindBar();
    }
    // Escape: Close find bar or context menu
    else if (e.key === 'Escape') {
      if (elements.findBar.classList.contains('active')) {
        hideFindBar();
      }
      // Context menu closes are handled in showContextMenu
    }
    // Ctrl+L: Focus address bar
    else if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
      e.preventDefault();
      elements.urlInput.focus();
    }
  });
}

// Smart URL processing
function processUrl(input) {
  input = input.trim();
  if (!input) return null;

  // Check if it's already a URL with protocol
  if (input.startsWith('http://') || input.startsWith('https://')) {
    return input;
  }

  // Check if it looks like a URL (contains dot, localhost, or IP)
  const isUrl = /^(localhost|\d+\.\d+\.\d+\.\d+|[\w-]+\.[\w.-]+)/i.test(input);

  if (isUrl) {
    // Try HTTPS first for domains, HTTP for localhost/IP
    if (input.startsWith('localhost') || /^\d+\.\d+\.\d+\.\d+/.test(input)) {
      return 'http://' + input;
    }
    return 'https://' + input;
  }

  // Treat as search query
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}

// Navigate to URL
async function navigate(url) {
  if (!url) {
    url = processUrl(elements.urlInput.value);
  }

  if (!url) return;

  elements.urlInput.value = url;
  hideSuggestions();

  // Show browser view
  showBrowserView();

  // Create tab if none exists, or navigate in active tab
  if (tabManager.tabs.size === 0) {
    tabManager.createTab(url);
  } else {
    tabManager.navigate(url);
  }
}

// Show URL suggestions
function showSuggestions(suggestions) {
  currentSuggestions = suggestions;
  selectedSuggestionIndex = -1;

  if (suggestions.length === 0) {
    hideSuggestions();
    return;
  }

  const html = suggestions.map((item, index) => `
    <div class="url-suggestion-item" data-index="${index}" data-url="${item.url}">
      <svg class="url-suggestion-icon" viewBox="0 0 24 24" width="16" height="16">
        <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
      </svg>
      <span class="url-suggestion-text">${highlightMatch(item.title, elements.urlInput.value)}</span>
      <span class="url-suggestion-url">${item.url}</span>
    </div>
  `).join('');

  elements.urlSuggestions.innerHTML = html;
  elements.urlSuggestions.style.display = 'block';

  // Add click handlers
  elements.urlSuggestions.querySelectorAll('.url-suggestion-item').forEach(item => {
    item.addEventListener('click', () => {
      const url = item.dataset.url;
      elements.urlInput.value = url;
      navigate(url);
    });
  });
}

// Hide URL suggestions
function hideSuggestions() {
  elements.urlSuggestions.style.display = 'none';
  elements.urlSuggestions.innerHTML = '';
  currentSuggestions = [];
  selectedSuggestionIndex = -1;
}

// Highlight matching text
function highlightMatch(text, query) {
  if (!query) return text;
  const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
  return text.replace(regex, '<span class="match">$1</span>');
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Handle suggestion keyboard navigation
function handleSuggestionKeydown(e) {
  if (currentSuggestions.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, currentSuggestions.length - 1);
    updateSuggestionSelection();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, -1);
    updateSuggestionSelection();
  } else if (e.key === 'Enter' && selectedSuggestionIndex >= 0) {
    e.preventDefault();
    const url = currentSuggestions[selectedSuggestionIndex].url;
    elements.urlInput.value = url;
    navigate(url);
  } else if (e.key === 'Escape') {
    hideSuggestions();
  }
}

function updateSuggestionSelection() {
  const items = elements.urlSuggestions.querySelectorAll('.url-suggestion-item');
  items.forEach((item, index) => {
    if (index === selectedSuggestionIndex) {
      item.classList.add('selected');
      elements.urlInput.value = currentSuggestions[index].url;
    } else {
      item.classList.remove('selected');
    }
  });
}

// Show browser view
function showBrowserView() {
  elements.welcomeScreen.style.display = 'none';
  elements.browserWrapper.style.display = 'block';
  elements.tabBar.style.display = 'flex';
}

// Show welcome screen
function showWelcomeScreen() {
  elements.welcomeScreen.style.display = 'flex';
  elements.browserWrapper.style.display = 'none';
  elements.tabBar.style.display = 'none';
}

// Toggle connection
async function toggleConnection() {
  const btn = elements.btnConnect;

  if (state.connected) {
    // Disconnect
    btn.disabled = true;
    btn.innerHTML = '<span>Disconnecting...</span>';

    try {
      await window.electronAPI.disconnect();
      state.connected = false;
    } catch (err) {
      console.error('Disconnect failed:', err);
      alert('Failed to disconnect: ' + err.message);
    }
  } else {
    // Connect
    btn.disabled = true;
    btn.innerHTML = '<span>Connecting...</span>';

    try {
      const result = await window.electronAPI.connect({
        localPort: state.config.localPort,
        remotePort: state.config.remotePort,
        proxyType: state.config.proxyType
      });

      state.connected = true;
      console.log('Connected:', result);
    } catch (err) {
      console.error('Connect failed:', err);
      alert('Failed to connect: ' + err.message);
    }
  }

  btn.disabled = false;
  updateConnectionUI();
}

// Update connection UI
function updateConnectionUI() {
  const btn = elements.btnConnect;
  const statusIndicator = elements.connectionStatus.querySelector('.status-indicator');
  const statusText = elements.connectionStatus.querySelector('.status-text');

  if (state.connected) {
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20">
        <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
      </svg>
      <span>Disconnect</span>
    `;
    btn.classList.add('connected');
    statusIndicator.classList.remove('disconnected', 'connecting');
    statusIndicator.classList.add('connected');
    statusText.textContent = 'Online';
  } else {
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20">
        <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
      </svg>
      <span>Connect</span>
    `;
    btn.classList.remove('connected');
    statusIndicator.classList.remove('connected', 'connecting');
    statusIndicator.classList.add('disconnected');
    statusText.textContent = 'Offline';
  }
}

// Update device UI
function updateDeviceUI() {
  const deviceInfo = elements.deviceInfo;

  if (state.devices.length === 0) {
    deviceInfo.innerHTML = '<span class="device-status">No device detected</span>';
  } else {
    const device = state.devices[0];
    deviceInfo.innerHTML = `
      <span class="device-status connected">Device: ${device.id}</span>
      <span class="device-type">${device.type || 'USB'}</span>
    `;
  }
}

// Update config from UI
async function updateConfig() {
  state.config.localPort = parseInt(elements.proxyPort.value) || 7890;
  state.config.remotePort = parseInt(elements.remotePort.value) || 7890;
  state.config.proxyType = elements.proxyType.value;

  try {
    await window.electronAPI.setConfig(state.config);
  } catch (err) {
    console.error('Failed to save config:', err);
  }
}

// Update settings UI
function updateSettingsUI() {
  elements.proxyPort.value = state.config.localPort;
  elements.remotePort.value = state.config.remotePort;
  elements.proxyType.value = state.config.proxyType;

  elements.settingsProxyPort.value = state.config.localPort;
  elements.settingsRemotePort.value = state.config.remotePort;
  elements.settingsProxyType.value = state.config.proxyType;
}

// Open settings modal
function openSettings() {
  updateSettingsUI();
  elements.settingsModal.classList.add('active');
}

// Close settings modal
function closeSettings() {
  elements.settingsModal.classList.remove('active');
}

// Save settings
async function saveSettings() {
  state.config.localPort = parseInt(elements.settingsProxyPort.value) || 7890;
  state.config.remotePort = parseInt(elements.settingsRemotePort.value) || 7890;
  state.config.proxyType = elements.settingsProxyType.value;

  try {
    await window.electronAPI.setConfig(state.config);
    updateSettingsUI();
    closeSettings();
  } catch (err) {
    console.error('Failed to save settings:', err);
    alert('Failed to save settings: ' + err.message);
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);

// Show ADB error
function showAdbError(error) {
  const deviceInfo = elements.deviceInfo;
  deviceInfo.innerHTML = `
    <div class="adb-error">
      <span class="error-icon">⚠️</span>
      <span class="error-text">ADB not found</span>
      <button class="btn-download" onclick="downloadAdb()">Auto Download</button>
      <button class="error-help" onclick="showAdbHelp()">Manual</button>
    </div>
  `;

  // Disable connect button
  elements.btnConnect.disabled = true;
  elements.btnConnect.title = 'ADB is required to connect';
}

// Download ADB automatically
async function downloadAdb() {
  const deviceInfo = elements.deviceInfo;
  deviceInfo.innerHTML = `
    <div class="adb-downloading">
      <span class="download-icon">⬇️</span>
      <span class="download-text">Downloading ADB...</span>
      <span class="download-progress" id="adb-progress">0%</span>
    </div>
  `;

  // Listen for progress
  window.electronAPI.onAdbDownloadProgress((data) => {
    const progressEl = document.getElementById('adb-progress');
    if (progressEl) {
      progressEl.textContent = `${data.progress}%`;
    }
  });

  try {
    const result = await window.electronAPI.downloadAdb();
    if (result.success) {
      deviceInfo.innerHTML = `
        <div class="adb-success">
          <span class="success-icon">✅</span>
          <span class="success-text">ADB installed!</span>
        </div>
      `;

      // Retry ADB initialization
      const retryResult = await window.electronAPI.retryAdb();
      if (retryResult.success) {
        // Re-enable connect button
        elements.btnConnect.disabled = false;
        elements.btnConnect.title = '';
        updateDeviceUI();
      } else {
        showAdbError(retryResult.error);
      }
    } else {
      showAdbError(result.error);
    }
  } catch (err) {
    showAdbError(err.message);
  }
}

// Make downloadAdb available globally
window.downloadAdb = downloadAdb;

// Show ADB installation help
window.showAdbHelp = function() {
  const modal = document.createElement('div');
  modal.className = 'modal active';
  modal.innerHTML = `
    <div class="modal-content adb-help-modal">
      <h3>Install ADB (Android Debug Bridge)</h3>
      <div class="help-section">
        <h4>Option 1: Auto Download (Recommended)</h4>
        <p>Click the "Auto Download" button to automatically download and install ADB.</p>
      </div>
      <div class="help-section">
        <h4>Option 2: Download Platform Tools</h4>
        <ol>
          <li>Download from <a href="https://developer.android.com/studio/releases/platform-tools" target="_blank">Android Developer</a></li>
          <li>Extract to a folder (e.g., C:\\platform-tools)</li>
          <li>Add the folder to your PATH environment variable</li>
          <li>Restart ADB Proxy Browser</li>
        </ol>
      </div>
      <div class="help-section">
        <h4>Option 3: Install via Package Manager</h4>
        <pre>choco install adb</pre>
        <p>or</p>
        <pre>scoop install adb</pre>
      </div>
      <button class="btn btn-primary" onclick="this.closest('.modal').remove()">Close</button>
    </div>
  `;
  document.body.appendChild(modal);
};

// Open external link - exposed via preload
window.openExternal = function(url) {
  // This will be handled by clicking the link directly
  // Electron will open external links in default browser
  return true;
};
