// DOM Elements
const elements = {
  // Navigation
  btnBack: document.getElementById('btn-back'),
  btnForward: document.getElementById('btn-forward'),
  btnRefresh: document.getElementById('btn-refresh'),
  btnHome: document.getElementById('btn-home'),
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
  progressBar: document.getElementById('progress-bar'),

  // Terminal
  btnTerminal: document.getElementById('btn-terminal'),
  terminalPanel: document.getElementById('terminal-panel'),
  terminalContainer: document.getElementById('terminal-container'),
  terminalStatus: document.getElementById('terminal-status'),
  btnCloseTerminal: document.getElementById('btn-close-terminal')
};

// URL History Manager (uses main process for persistence)
class URLHistory {
  constructor() {
    this.history = [];
    this.load();
  }

  async load() {
    try {
      this.history = await window.electronAPI.getHistory();
    } catch (e) {
      console.warn('Failed to load URL history:', e);
      this.history = [];
    }
  }

  async add(url, title = '') {
    if (!url || url === 'about:blank') return;

    try {
      this.history = await window.electronAPI.addHistory(url, title);
    } catch (e) {
      console.warn('Failed to add URL history:', e);
    }
  }

  async search(query) {
    try {
      return await window.electronAPI.searchHistory(query);
    } catch (e) {
      console.warn('Failed to search URL history:', e);
      return [];
    }
  }

  async clear() {
    try {
      await window.electronAPI.clearHistory();
      this.history = [];
    } catch (e) {
      console.warn('Failed to clear URL history:', e);
    }
  }
}

// Terminal Manager - xterm.js SSH to Termux
class TerminalManager {
  constructor() {
    this.terminal = null;
    this.fitAddon = null;
    this.connected = false;
    this.credentials = null;
  }

  /**
   * Initialize xterm.js terminal
   */
  async init() {
    if (this.terminal) return;

    // Use global xterm from script tags
    const Terminal = window.Terminal;
    const FitAddon = window.FitAddon;

    if (!Terminal || !FitAddon) {
      console.error('xterm.js not loaded');
      return;
    }

    // Create terminal instance
    this.terminal = new Terminal({
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#ffffff',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5'
      },
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      allowProposedApi: true
    });

    // Create fit addon
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    // Open terminal in container
    this.terminal.open(elements.terminalContainer);

    // Fit to container
    setTimeout(() => this.fit(), 100);

    // Handle input
    this.terminal.onData((data) => {
      if (this.connected) {
        window.electronAPI.terminalWrite(data);
      }
    });

    // Handle resize
    this.terminal.onResize(({ cols, rows }) => {
      if (this.connected) {
        window.electronAPI.terminalResize(cols, rows);
      }
    });

    // Listen for data from main process
    window.electronAPI.onTerminalData((data) => {
      if (this.terminal) {
        this.terminal.write(data);
      }
    });

    // Listen for close event
    window.electronAPI.onTerminalClose((data) => {
      this.connected = false;
      this.updateStatus('disconnected');
      this.terminal.write('\r\n\x1b[33m[Connection closed]\x1b[0m\r\n');
    });

    // Handle window resize
    window.addEventListener('resize', () => {
      this.fit();
    });
  }

  /**
   * Fit terminal to container
   */
  fit() {
    if (this.terminal && this.fitAddon) {
      try {
        this.fitAddon.fit();
      } catch (e) {
        console.warn('Failed to fit terminal:', e);
      }
    }
  }

  /**
   * Update status indicator
   */
  updateStatus(status, message = '') {
    const statusEl = elements.terminalStatus;
    statusEl.className = 'terminal-status';

    switch (status) {
      case 'connecting':
        statusEl.classList.add('connecting');
        statusEl.textContent = 'Connecting...';
        break;
      case 'connected':
        statusEl.classList.add('connected');
        statusEl.textContent = 'Connected';
        break;
      case 'error':
        statusEl.classList.add('error');
        statusEl.textContent = message || 'Error';
        break;
      default:
        statusEl.textContent = '';
    }
  }

  /**
   * Prompt for credentials using a simple dialog
   */
  async promptCredentials() {
    return new Promise((resolve) => {
      // Create a simple credential dialog
      const dialog = document.createElement('div');
      dialog.className = 'terminal-credential-dialog';
      dialog.innerHTML = `
        <div class="terminal-credential-content">
          <h3>SSH Credentials</h3>
          <p>Enter your Termux SSH credentials</p>
          <div class="credential-field">
            <label>Username:</label>
            <input type="text" id="ssh-username" value="" placeholder="Enter username">
          </div>
          <div class="credential-field">
            <label>Password:</label>
            <input type="password" id="ssh-password" value="" placeholder="Enter password">
          </div>
          <div class="credential-buttons">
            <button id="ssh-cancel" class="btn-cancel">Cancel</button>
            <button id="ssh-connect" class="btn-connect">Connect</button>
          </div>
          <p class="credential-hint">Make sure sshd is running on your phone (run "sshd" in Termux)</p>
        </div>
      `;

      // Add styles
      const style = document.createElement('style');
      style.textContent = `
        .terminal-credential-dialog {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 3000;
        }
        .terminal-credential-content {
          background: #fff;
          padding: 24px;
          border-radius: 8px;
          min-width: 320px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.2);
        }
        .terminal-credential-content h3 {
          margin: 0 0 8px;
          font-size: 16px;
        }
        .terminal-credential-content p {
          margin: 0 0 16px;
          color: #666;
          font-size: 13px;
        }
        .credential-field {
          margin-bottom: 12px;
        }
        .credential-field label {
          display: block;
          font-size: 12px;
          color: #666;
          margin-bottom: 4px;
        }
        .credential-field input {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
        }
        .credential-field input:focus {
          outline: none;
          border-color: #1a73e8;
        }
        .credential-buttons {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 16px;
        }
        .credential-buttons button {
          padding: 8px 16px;
          border-radius: 4px;
          font-size: 14px;
          cursor: pointer;
        }
        .btn-cancel {
          background: #fff;
          border: 1px solid #ddd;
          color: #666;
        }
        .btn-cancel:hover {
          background: #f5f5f5;
        }
        .btn-connect {
          background: #1a73e8;
          border: none;
          color: #fff;
        }
        .btn-connect:hover {
          background: #1557b0;
        }
        .credential-hint {
          margin-top: 12px;
          font-size: 11px;
          color: #888;
        }
      `;
      document.head.appendChild(style);
      document.body.appendChild(dialog);

      const usernameInput = document.getElementById('ssh-username');
      const passwordInput = document.getElementById('ssh-password');
      const cancelBtn = document.getElementById('ssh-cancel');
      const connectBtn = document.getElementById('ssh-connect');

      const cleanup = () => {
        document.body.removeChild(dialog);
        document.head.removeChild(style);
      };

      cancelBtn.onclick = () => {
        cleanup();
        resolve(null);
      };

      connectBtn.onclick = () => {
        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        cleanup();
        resolve({ username, password });
      };

      // Handle Enter key
      passwordInput.onkeypress = (e) => {
        if (e.key === 'Enter') {
          connectBtn.click();
        }
      };

      // Focus username input
      usernameInput.focus();
    });
  }

  /**
   * Connect to SSH
   */
  async connect() {
    await this.init();

    // Clear terminal
    this.terminal.clear();
    this.terminal.write('\x1b[36mConnecting to Termux via SSH...\x1b[0m\r\n');

    // Prompt for credentials
    this.updateStatus('connecting');
    const credentials = await this.promptCredentials();

    if (!credentials || !credentials.username || !credentials.password) {
      this.terminal.write('\r\n\x1b[33mConnection cancelled\x1b[0m\r\n');
      this.updateStatus('error', 'Cancelled');
      return false;
    }

    this.credentials = credentials;

    try {
      this.terminal.write('\r\n\x1b[36mEstablishing SSH connection...\x1b[0m\r\n');
      await window.electronAPI.terminalConnect({
        username: credentials.username,
        password: credentials.password,
        localPort: 8022
      });

      this.connected = true;
      this.updateStatus('connected');
      this.terminal.write('\r\n\x1b[32mConnected!\x1b[0m\r\n');

      // Fit terminal after connection
      this.fit();

      return true;
    } catch (err) {
      this.terminal.write(`\r\n\x1b[31mConnection failed: ${err.message}\x1b[0m\r\n`);
      this.updateStatus('error', 'Failed');
      return false;
    }
  }

  /**
   * Disconnect from SSH
   */
  async disconnect() {
    if (!this.connected) return;

    try {
      await window.electronAPI.terminalDisconnect();
    } catch (err) {
      console.warn('Disconnect error:', err);
    }

    this.connected = false;
    this.updateStatus('disconnected');
    this.terminal.write('\r\n\x1b[33mDisconnected\x1b[0m\r\n');
  }

  /**
   * Show terminal panel
   */
  async show() {
    elements.terminalPanel.classList.remove('hidden');
    elements.btnTerminal.classList.add('active');

    // Fit terminal after showing
    setTimeout(() => this.fit(), 100);

    // Auto-connect if not connected
    if (!this.connected) {
      await this.connect();
    }
  }

  /**
   * Hide terminal panel
   */
  hide() {
    elements.terminalPanel.classList.add('hidden');
    elements.btnTerminal.classList.remove('active');
  }

  /**
   * Toggle terminal panel
   */
  async toggle() {
    if (elements.terminalPanel.classList.contains('hidden')) {
      await this.show();
    } else {
      this.hide();
    }
  }
}

// New Tab Page builder
// bookmarks: array of {title, url} injected at generation time (persisted in main process)
// history: array of {title, url} injected at generation time
// Navigation and saves are communicated back via console.log messages intercepted by the webview handler
function buildNewTabPage(bookmarks, history) {
  bookmarks = bookmarks || [];
  history = (history || []).slice(0, 8);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>New Tab</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #f8f9fa;
    color: #202124;
    height: 100vh;
    overflow: auto;
  }
  .page { max-width: 800px; margin: 0 auto; padding: 48px 24px 32px; }
  h2 { font-size: 13px; font-weight: 500; color: #5f6368; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; }
  .btn-edit { font-size: 12px; color: #1a73e8; background: none; border: none; cursor: pointer; padding: 2px 6px; border-radius: 4px; text-transform: none; letter-spacing: 0; font-weight: 400; }
  .btn-edit:hover { background: #e8f0fe; }
  .bookmarks { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; margin-bottom: 40px; }
  .bookmark {
    display: flex; flex-direction: column; align-items: center; gap: 6px;
    padding: 14px 8px; background: #fff; border-radius: 10px; text-decoration: none;
    color: #202124; font-size: 12px; text-align: center; cursor: pointer;
    border: 1px solid #e8eaed; transition: box-shadow 0.15s, background 0.15s; position: relative;
  }
  .bookmark:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.12); background: #fff; }
  .bookmark img { width: 28px; height: 28px; border-radius: 6px; object-fit: contain; }
  .bookmark .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%; }
  .bookmark .del {
    display: none; position: absolute; top: 4px; right: 4px;
    background: #ea4335; color: #fff; border: none; border-radius: 50%;
    width: 18px; height: 18px; font-size: 12px; line-height: 18px; text-align: center;
    cursor: pointer;
  }
  .edit-mode .bookmark .del { display: block; }
  .edit-mode .bookmark { border-style: dashed; }
  .bookmark-add {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
    padding: 14px 8px; background: transparent; border-radius: 10px;
    border: 2px dashed #dadce0; color: #5f6368; font-size: 12px; cursor: pointer; transition: all 0.15s;
  }
  .bookmark-add:hover { border-color: #1a73e8; color: #1a73e8; background: #e8f0fe; }
  .bookmark-add .plus { font-size: 24px; line-height: 28px; }
  .history-section h2 { margin-bottom: 12px; }
  .history-list { display: flex; flex-direction: column; gap: 2px; }
  .history-item {
    display: flex; align-items: center; gap: 10px; padding: 8px 12px;
    border-radius: 8px; cursor: pointer; text-decoration: none; color: #202124;
  }
  .history-item:hover { background: #f1f3f4; }
  .history-item img { width: 16px; height: 16px; border-radius: 3px; flex-shrink: 0; }
  .history-item .h-title { font-size: 13px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .history-item .h-url { font-size: 11px; color: #5f6368; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 300px; }
  .modal-overlay {
    display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.4);
    align-items: center; justify-content: center; z-index: 100;
  }
  .modal-overlay.active { display: flex; }
  .modal { background: #fff; border-radius: 12px; padding: 24px; width: 320px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
  .modal h3 { font-size: 16px; font-weight: 500; margin-bottom: 16px; }
  .modal input {
    width: 100%; padding: 8px 12px; border: 1px solid #dadce0; border-radius: 6px;
    font-size: 14px; margin-bottom: 10px; outline: none;
  }
  .modal input:focus { border-color: #1a73e8; }
  .modal-btns { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
  .btn-cancel { padding: 8px 16px; border: none; background: none; color: #5f6368; border-radius: 6px; cursor: pointer; font-size: 14px; }
  .btn-cancel:hover { background: #f1f3f4; }
  .btn-save { padding: 8px 16px; border: none; background: #1a73e8; color: #fff; border-radius: 6px; cursor: pointer; font-size: 14px; }
  .btn-save:hover { background: #1557b0; }
  .favicon-err { background: #e8eaed; border-radius: 6px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-size: 14px; color: #5f6368; }
</style>
</head>
<body>
<div class="page">
  <section>
    <h2>
      <span>Bookmarks</span>
      <button class="btn-edit" id="btn-edit-mode">Edit</button>
    </h2>
    <div class="bookmarks" id="bookmark-grid"></div>
  </section>
  <section class="history-section">
    <h2><span>Recent</span></h2>
    <div class="history-list" id="history-list"></div>
  </section>
</div>

<!-- Add Bookmark Modal -->
<div class="modal-overlay" id="add-modal">
  <div class="modal">
    <h3>Add Bookmark</h3>
    <input type="text" id="bm-title" placeholder="Title">
    <input type="url" id="bm-url" placeholder="https://...">
    <div class="modal-btns">
      <button class="btn-cancel" id="bm-cancel">Cancel</button>
      <button class="btn-save" id="bm-save">Add</button>
    </div>
  </div>
</div>

<script>
  // Bookmarks injected at page-generation time — no localStorage needed
  let bookmarks = ${JSON.stringify(bookmarks)};
  let editMode = false;

  // Persist bookmarks: send to host app via console.log protocol
  function persistBookmarks() {
    console.log('__SAVE_BOOKMARKS__:' + JSON.stringify(bookmarks));
  }

  // Navigate: send URL to host app via console.log protocol
  function navigate(url) {
    console.log('__NAVIGATE__:' + url);
  }

  function iconEl(url) {
    const domain = (() => { try { return new URL(url).origin; } catch { return ''; } })();
    const img = document.createElement('img');
    img.src = domain + '/favicon.ico';
    img.onerror = () => {
      const d = document.createElement('div');
      d.className = 'favicon-err';
      try { d.textContent = (new URL(url).hostname[0] || '?').toUpperCase(); } catch { d.textContent = '?'; }
      img.replaceWith(d);
    };
    return img;
  }

  function renderBookmarks() {
    const grid = document.getElementById('bookmark-grid');
    grid.className = 'bookmarks' + (editMode ? ' edit-mode' : '');
    grid.innerHTML = '';
    bookmarks.forEach((bm, i) => {
      const a = document.createElement('div');
      a.className = 'bookmark';
      a.appendChild(iconEl(bm.url));
      const name = document.createElement('span');
      name.className = 'name';
      name.title = bm.title;
      name.textContent = bm.title;
      a.appendChild(name);
      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '×';
      del.onclick = (e) => {
        e.stopPropagation();
        bookmarks.splice(i, 1);
        persistBookmarks();
        renderBookmarks();
      };
      a.appendChild(del);
      if (!editMode) {
        a.onclick = () => navigate(bm.url);
      }
      grid.appendChild(a);
    });
    // Add button
    const add = document.createElement('div');
    add.className = 'bookmark-add';
    add.innerHTML = '<span class="plus">+</span><span>Add</span>';
    add.onclick = () => openAddModal();
    grid.appendChild(add);
  }

  function openAddModal(prefillUrl) {
    document.getElementById('bm-title').value = '';
    document.getElementById('bm-url').value = prefillUrl || '';
    document.getElementById('add-modal').classList.add('active');
    document.getElementById('bm-title').focus();
  }

  document.getElementById('bm-cancel').onclick = () => document.getElementById('add-modal').classList.remove('active');
  document.getElementById('bm-save').onclick = () => {
    const title = document.getElementById('bm-title').value.trim();
    const url = document.getElementById('bm-url').value.trim();
    if (!url) return;
    bookmarks.push({ title: title || url, url });
    persistBookmarks();
    document.getElementById('add-modal').classList.remove('active');
    renderBookmarks();
  };
  document.getElementById('add-modal').onclick = (e) => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('active'); };

  document.getElementById('btn-edit-mode').onclick = () => {
    editMode = !editMode;
    document.getElementById('btn-edit-mode').textContent = editMode ? 'Done' : 'Edit';
    renderBookmarks();
  };

  // History injected at page-generation time
  function renderHistory() {
    const list = document.getElementById('history-list');
    list.innerHTML = '';
    const items = ${JSON.stringify(history)};
    if (!items.length) return;
    items.forEach(item => {
      const a = document.createElement('div');
      a.className = 'history-item';
      const domain = (() => { try { return new URL(item.url).origin; } catch { return ''; } })();
      const img = document.createElement('img');
      img.src = domain + '/favicon.ico';
      img.onerror = () => img.remove();
      a.appendChild(img);
      const info = document.createElement('div');
      info.style.flex = '1';
      info.style.overflow = 'hidden';
      const t = document.createElement('div');
      t.className = 'h-title';
      t.textContent = item.title || item.url;
      const u = document.createElement('div');
      u.className = 'h-url';
      u.textContent = item.url;
      info.appendChild(t);
      info.appendChild(u);
      a.appendChild(info);
      a.onclick = () => navigate(item.url);
      list.appendChild(a);
    });
  }

  renderBookmarks();
  renderHistory();
<\/script>
</body>
</html>`;
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
      // Ctrl+click handling
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
    const isNewTab = !url || url === 'about:blank';

    // Create tab item in tab bar
    const tabElement = document.createElement('button');
    tabElement.className = 'tab-item';
    tabElement.dataset.tabId = tabId;
    tabElement.innerHTML = `
      <span class="tab-title">${isNewTab ? 'New Tab' : 'Loading...'}</span>
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
    // Use only top/left/width/height to avoid conflict with right/bottom
    webview.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%;';
    webview.setAttribute('allowpopups', '');

    // Webview events
    webview.addEventListener('did-start-loading', () => {
      this.updateTabTitle(tabId, 'Loading...');
      elements.btnRefresh.classList.add('loading');
      this.showProgressBar(true);
    });

    webview.addEventListener('did-stop-loading', () => {
      elements.btnRefresh.classList.remove('loading');
      this.showProgressBar(false);
      // Final title update after all loading stops (catches SPA and redirects)
      const title = webview.getTitle();
      if (title && title !== 'Loading...' && title !== 'about:blank') {
        this.updateTabTitle(tabId, title);
      }
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

      // Log the guest page's actual viewport size to diagnose layout issues
      try {
        webview.executeJavaScript(`
          (window.innerWidth + 'x' + window.innerHeight + ' docW=' + document.documentElement.clientWidth + ' docH=' + document.documentElement.clientHeight)
        `).then(result => {
          console.log('[Guest viewport]', result, '| webview element:', webview.offsetWidth + 'x' + webview.offsetHeight);
        }).catch(() => {});
      } catch (e) {}

      // Force webview content to fill the container
      // This fixes the issue where webview guest page doesn't fill the element
      try {
        webview.executeJavaScript(`
          (function() {
            var style = document.createElement('style');
            style.textContent = 'html, body { min-height: 100% !important; height: auto !important; margin: 0 !important; padding: 0 !important; } body > * { min-height: auto !important; }';
            if (document.head) document.head.appendChild(style);
            else if (document.documentElement) document.documentElement.appendChild(style);
          })();
        `).catch(() => {}); // Ignore errors for cross-origin pages
      } catch (e) {
        // executeJavaScript may fail for some pages
      }

      // Inject script to handle target="_blank" links
      // Since new-window event doesn't fire reliably in Electron 28, we use console message
      try {
        webview.executeJavaScript(`
          (function() {
            // Remove any existing handler
            if (window.__blankLinkHandler) {
              document.removeEventListener('click', window.__blankLinkHandler, true);
            }
            // Add new handler
            window.__blankLinkHandler = function(e) {
              var link = e.target.closest('a[target="_blank"]');
              if (link && link.href) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                console.log('__NEW_TAB__:' + link.href);
                return false;
              }
            };
            document.addEventListener('click', window.__blankLinkHandler, true);
          })();
        `).catch(() => {});
      } catch (e) {
        // Ignore errors
      }

      // Force webview to recalculate its internal size
      const container = elements.browserContainer;
      if (container) {
        const width = container.clientWidth;
        const height = container.clientHeight;
        // Trigger resize by temporarily changing size
        webview.style.width = (width - 1) + 'px';
        webview.style.height = (height - 1) + 'px';
        // Restore correct size
        requestAnimationFrame(() => {
          webview.style.width = width + 'px';
          webview.style.height = height + 'px';
        });
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

    // Handle console messages for new-tab requests from injected script
    webview.addEventListener('console-message', (e) => {
      const message = e.message;
      // New tab request from preload script
      if (message.startsWith('__NEW_TAB__:')) {
        const url = message.substring('__NEW_TAB__:'.length);
        this.createTab(url);
        return;
      }
      // Navigate in current tab (from new-tab page bookmark/history clicks)
      if (message.startsWith('__NAVIGATE__:')) {
        const url = message.substring('__NAVIGATE__:'.length);
        if (url) webview.src = url;
        return;
      }
      // Save bookmarks from new-tab page
      if (message.startsWith('__SAVE_BOOKMARKS__:')) {
        const json = message.substring('__SAVE_BOOKMARKS__:'.length);
        try {
          const bookmarks = JSON.parse(json);
          window.electronAPI.saveBookmarks(bookmarks);
        } catch (err) {
          console.error('[Bookmarks] Failed to parse:', err);
        }
      }
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

    // CRITICAL: Show browser view FIRST before any webview operations
    // This ensures container has proper dimensions when we measure them
    elements.welcomeScreen.style.display = 'none';
    elements.browserWrapper.style.display = 'block';
    elements.tabBar.style.display = 'flex';

    // Hide other webviews and activate tab element
    this.tabs.forEach((t) => {
      t.webview.style.display = 'none';
      t.element.classList.remove('active');
    });
    tabElement.classList.add('active');

    // Measure container BEFORE inserting webview
    const container = elements.browserContainer;
    const containerWidth = container.clientWidth || window.innerWidth;
    const containerHeight = container.clientHeight || (window.innerHeight - 80);
    console.log(`[createTab] container measured: ${containerWidth}x${containerHeight}, window: ${window.innerWidth}x${window.innerHeight}`);

    // Set explicit pixel dimensions BEFORE inserting into DOM.
    // Also override the shadow DOM iframe style: the internal <iframe> uses
    // flex:1 1 auto with no explicit height, so it falls back to 150px
    // (Chromium's default replaced-element height) when the shadow host
    // doesn't propagate its pixel height to the flex child properly.
    webview.style.cssText = `position: absolute; top: 0; left: 0; width: ${containerWidth}px; height: ${containerHeight}px; display: block;`;

    // Insert webview before progress bar
    const progressBarContainer = document.getElementById('progress-bar-container');
    elements.browserContainer.insertBefore(webview, progressBarContainer);

    // Store tab info
    this.tabs.set(tabId, {
      element: tabElement,
      webview: webview,
      url: url
    });

    this.activeTabId = tabId;

    // Fix the shadow DOM internal iframe height.
    // Electron's webview shadow root contains: :host { display: flex }
    // and an internal <iframe style="flex: 1 1 auto; width: 100%">.
    // The iframe has NO explicit height, so Chromium uses 150px (the default
    // replaced-element intrinsic height) when computing the guest viewport.
    // We inject a style into the shadow root to force the iframe to 100% height.
    if (webview.shadowRoot) {
      const shadowStyle = document.createElement('style');
      shadowStyle.textContent = ':host { display: block !important; } iframe { width: 100% !important; height: 100% !important; }';
      webview.shadowRoot.appendChild(shadowStyle);
    }

    // Load URL directly, or show new-tab page for blank tabs.
    if (url && url !== 'about:blank') {
      webview.src = url;
    } else {
      // Show the new-tab navigation page: load bookmarks + history first, then build page
      (async () => {
        const [bookmarks, history] = await Promise.all([
          window.electronAPI.getBookmarks().catch(() => []),
          window.electronAPI.getHistory().catch(() => [])
        ]);
        webview.src = `data:text/html;charset=utf-8,${encodeURIComponent(buildNewTabPage(bookmarks, history))}`;
      })();
    }

    return tabId;
  }

  closeTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    // If only one tab, close it and show welcome screen
    if (this.tabs.size === 1) {
      tab.element.remove();
      tab.webview.remove();
      this.tabs.delete(tabId);
      this.activeTabId = null;
      showWelcomeScreen();
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

    // Show selected webview with correct dimensions
    const container = elements.browserContainer;
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || (window.innerHeight - 80);
    tab.webview.style.width = w + 'px';
    tab.webview.style.height = h + 'px';
    tab.webview.style.display = 'block';
    tab.element.classList.add('active');
    this.activeTabId = tabId;

    // Update URL bar - only if webview has a URL loaded
    const url = tab.webview.getURL();
    if (url && url !== 'about:blank') {
      elements.urlInput.value = url;
    } else if (tab.url && tab.url !== 'about:blank') {
      // Use stored URL if webview hasn't loaded yet
      elements.urlInput.value = tab.url;
    }

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
      webview.loadURL(url);
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
  autoConnecting: false,
  config: {
    localPort: 7890,
    remotePort: 7890,
    proxyType: 'http'
  }
};

// Tab manager instance
const tabManager = new TabManager();
window.tabManager = tabManager; // Expose for testing

// URL history instance
const urlHistory = new URLHistory();

// Terminal manager instance
const terminalManager = new TerminalManager();

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
    console.log('[Init] Got devices:', JSON.stringify(devices));
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

  // Start 2-second probe loop to keep connection status accurate
  startConnectionProbe();
}

// Poll the main process every 2s: TCP-connect to the tunnel port to verify
// the ADB forward is still alive. Updates status bar and triggers auto-reconnect
// when the tunnel drops.
function startConnectionProbe() {
  const PROBE_INTERVAL = 2000;

  async function probe() {
    try {
      const result = await window.electronAPI.probe();

      // Update device list if it changed
      const prevCount = state.devices.length;
      state.devices = result.devices || [];
      if (state.devices.length !== prevCount) updateDeviceUI();

      const wasConnected = state.connected;

      if (result.connected) {
        // Tunnel is alive
        state.connected = true;
        if (!wasConnected) updateConnectionUI();
      } else {
        // Tunnel is down or was never up
        state.connected = false;
        if (wasConnected) updateConnectionUI();

        // Trigger auto-connect if device is present and we're not already trying
        if (state.devices.length > 0 && !state.autoConnecting) {
          autoConnect();
        }
      }

      updateStatusBarProbe(result);
    } catch (e) {
      // IPC failed — ignore silently
    }

    setTimeout(probe, PROBE_INTERVAL);
  }

  // Start after a short delay to let init() finish
  setTimeout(probe, 1500);
}

// Update the status bar chip with live probe result
function updateStatusBarProbe(result) {
  const indicator = elements.connectionStatus.querySelector('.status-indicator');
  const text = elements.connectionStatus.querySelector('.status-text');

  if (result.connected) {
    indicator.className = 'status-indicator connected';
    text.textContent = 'Online';
  } else if (state.autoConnecting) {
    indicator.className = 'status-indicator connecting';
    text.textContent = 'Connecting';
  } else if (result.devices && result.devices.length > 0) {
    indicator.className = 'status-indicator connecting';
    text.textContent = 'Device found';
  } else {
    indicator.className = 'status-indicator disconnected';
    text.textContent = 'No device';
  }
}

// Setup event listeners
function setupEventListeners() {
  // Navigation
  elements.btnBack.addEventListener('click', () => tabManager.goBack());
  elements.btnForward.addEventListener('click', () => tabManager.goForward());
  elements.btnRefresh.addEventListener('click', () => tabManager.refresh());
  elements.btnHome.addEventListener('click', () => {
    const webview = tabManager.getActiveWebview();
    if (webview) {
      elements.urlInput.value = '';
      (async () => {
        const [bookmarks, history] = await Promise.all([
          window.electronAPI.getBookmarks().catch(() => []),
          window.electronAPI.getHistory().catch(() => [])
        ]);
        webview.src = `data:text/html;charset=utf-8,${encodeURIComponent(buildNewTabPage(bookmarks, history))}`;
      })();
    }
  });
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

  elements.urlInput.addEventListener('input', async () => {
    const query = elements.urlInput.value.trim();
    if (query) {
      const suggestions = await urlHistory.search(query);
      showSuggestions(suggestions);
    } else {
      hideSuggestions();
    }
  });

  // URL input select on focus
  elements.urlInput.addEventListener('focus', async () => {
    elements.urlInput.select();
    const query = elements.urlInput.value.trim();
    if (query) {
      const suggestions = await urlHistory.search(query);
      showSuggestions(suggestions);
    }
  });

  // Hide suggestions on blur (with delay for click handling)
  elements.urlInput.addEventListener('blur', () => {
    setTimeout(hideSuggestions, 200);
  });

  // New tab button
  elements.btnNewTab.addEventListener('click', () => {
    if (tabManager.tabs.size === 0) {
      // No tabs, show welcome screen
      showWelcomeScreen();
    } else {
      // Create new tab (will show welcome content via about:blank handling)
      tabManager.createTab();
    }
  });

  // Connection
  elements.btnConnect.addEventListener('click', toggleConnection);

  // Settings
  elements.btnSettings.addEventListener('click', openSettings);
  elements.btnCloseSettings.addEventListener('click', closeSettings);
  elements.btnSaveSettings.addEventListener('click', saveSettings);

  // Terminal
  elements.btnTerminal.addEventListener('click', () => terminalManager.toggle());
  elements.btnCloseTerminal.addEventListener('click', () => terminalManager.hide());

  // Settings change listeners
  elements.proxyPort.addEventListener('change', updateConfig);
  elements.remotePort.addEventListener('change', updateConfig);
  elements.proxyType.addEventListener('change', updateConfig);

  // Listen for device changes
  window.electronAPI.onDeviceChanged((devices) => {
    console.log('[Renderer] device:changed received, count:', devices ? devices.length : 'null');
    state.devices = devices || [];
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

  // Use TabManager for navigation
  if (tabManager.tabs.size === 0) {
    // No tabs exist, create first tab with URL
    tabManager.createTab(url);
  } else {
    // Navigate in current tab
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

// Auto-connect with retry every 2 seconds until success or no device
async function autoConnect() {
  if (state.autoConnecting || state.connected || state.devices.length === 0) return;
  state.autoConnecting = true;
  updateConnectionUI();

  while (state.devices.length > 0 && !state.connected) {
    try {
      await window.electronAPI.connect({
        localPort: state.config.localPort,
        remotePort: state.config.remotePort,
        proxyType: state.config.proxyType
      });
      state.connected = true;
    } catch (err) {
      // Retry after 2s
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  state.autoConnecting = false;
  updateConnectionUI();
}

// Toggle connection (manual disconnect only — connect is automatic)
async function toggleConnection() {
  if (!state.connected) {
    // Manual connect attempt if auto-connect isn't running
    autoConnect();
    return;
  }

  // Disconnect
  try {
    await window.electronAPI.disconnect();
    state.connected = false;
  } catch (err) {
    console.error('Disconnect failed:', err);
  }
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
    btn.disabled = false;
    statusIndicator.className = 'status-indicator connected';
    statusText.textContent = 'Online';
  } else if (state.autoConnecting) {
    btn.innerHTML = '<span>Connecting...</span>';
    btn.classList.remove('connected');
    btn.disabled = true;
    statusIndicator.className = 'status-indicator connecting';
    statusText.textContent = 'Connecting';
  } else {
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20">
        <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
      </svg>
      <span>Connect</span>
    `;
    btn.classList.remove('connected');
    btn.disabled = false;
    statusIndicator.className = 'status-indicator disconnected';
    statusText.textContent = 'Offline';
  }
}

// Update device UI and trigger auto-connect when a device appears
function updateDeviceUI() {
  const deviceInfo = elements.deviceInfo;

  if (state.devices.length === 0) {
    deviceInfo.innerHTML = '<span class="device-status">No device detected</span>';
    // Device unplugged — reset connected state so auto-connect fires on next plug-in
    if (state.connected) {
      state.connected = false;
      updateConnectionUI();
    }
  } else {
    const device = state.devices[0];
    deviceInfo.innerHTML = `
      <span class="device-status connected">Device: ${device.id}</span>
      <span class="device-type">${device.type || 'USB'}</span>
    `;
    // Auto-connect when device is detected and not yet connected
    if (!state.connected && !state.autoConnecting) {
      autoConnect();
    }
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

// Handle window resize - update all webview sizes
window.addEventListener('resize', () => {
  const container = document.getElementById('browser-container');
  if (!container) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w <= 0 || h <= 0) return;

  document.querySelectorAll('webview').forEach(webview => {
    webview.style.width = w + 'px';
    webview.style.height = h + 'px';
    const guestId = webview.getWebContentsId();
    if (guestId) {
      window.electronAPI.webviewSetSize(guestId, w, h);
    }
  });
});

// ========== DEBUG MODE ==========
// Press Ctrl+Shift+D to toggle debug visualization
// Press Ctrl+Shift+L to log layout info to console
(function initDebugMode() {
  let debugStyles = null;

  function injectDebugCSS() {
    if (debugStyles) return;
    debugStyles = document.createElement('style');
    debugStyles.id = 'debug-styles';
    debugStyles.textContent = `
      /* Debug visualization */
      .main-content { border: 3px solid orange !important; background: rgba(255,165,0,0.1) !important; }
      .browser-wrapper { border: 3px solid red !important; background: rgba(255,0,0,0.1) !important; }
      .browser-container { border: 3px solid blue !important; background: rgba(0,0,255,0.1) !important; }
      webview, .browser-view { border: 3px solid green !important; background: rgba(0,255,0,0.2) !important; min-height: 100px !important; }
      .welcome-screen { border: 3px solid purple !important; }
      .toolbar { border: 2px solid cyan !important; }
      .tab-bar { border: 2px solid magenta !important; }
    `;
    document.head.appendChild(debugStyles);
    console.log('[Debug] CSS injected - borders: toolbar(cyan), main-content(orange), wrapper(red), container(blue), webview(green)');
  }

  function removeDebugCSS() {
    if (debugStyles) {
      debugStyles.remove();
      debugStyles = null;
      console.log('[Debug] CSS removed');
    }
  }

  function logLayoutInfo() {
    const info = {
      window: { width: window.innerWidth, height: window.innerHeight },
      toolbar: document.querySelector('.toolbar')?.offsetHeight,
      tabBar: document.getElementById('tab-bar')?.offsetHeight,
      tabBarDisplay: getComputedStyle(document.getElementById('tab-bar')).display,
      mainContent: document.querySelector('.main-content')?.offsetHeight,
      wrapper: {
        display: getComputedStyle(document.getElementById('browser-wrapper')).display,
        height: document.getElementById('browser-wrapper')?.offsetHeight
      },
      container: {
        position: getComputedStyle(document.getElementById('browser-container')).position,
        height: document.getElementById('browser-container')?.offsetHeight
      },
      webview: (() => {
        const wv = document.querySelector('webview');
        return wv ? {
          display: getComputedStyle(wv).display,
          height: wv.offsetHeight,
          src: wv.src?.substring(0, 50)
        } : null;
      })()
    };
    console.log('\n========== LAYOUT DEBUG ==========');
    console.table({
      'Window': `${info.window.width} x ${info.window.height}`,
      'Toolbar': info.toolbar + 'px',
      'TabBar': `${info.tabBar}px (${info.tabBarDisplay})`,
      'MainContent': info.mainContent + 'px',
      'Wrapper': `${info.wrapper.height}px (${info.wrapper.display})`,
      'Container': `${info.container.height}px (${info.container.position})`,
      'Webview': info.webview ? `${info.webview.height}px` : 'N/A'
    });
    console.log('Full info:', info);
    console.log('==================================\n');
    return info;
  }

  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+D: Toggle debug CSS
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      if (debugStyles) {
        removeDebugCSS();
      } else {
        injectDebugCSS();
      }
    }
    // Ctrl+Shift+L: Log layout info
    if (e.ctrlKey && e.shiftKey && e.key === 'L') {
      e.preventDefault();
      logLayoutInfo();
    }
  });

  // Expose to window
  window.debugLayout = {
    injectCSS: injectDebugCSS,
    removeCSS: removeDebugCSS,
    log: logLayoutInfo
  };

  console.log('[Debug] Press Ctrl+Shift+D to toggle debug borders, Ctrl+Shift+L to log layout info');
})();

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

// ========== DEBUG MODE ==========
// Press Ctrl+Shift+D to toggle debug visualization
// Press Ctrl+Shift+L to log layout info to console
(function() {
  let debugStyles = null;

  function injectDebugCSS() {
    if (debugStyles) return;
    debugStyles = document.createElement('style');
    debugStyles.id = 'debug-styles';
    debugStyles.textContent = `
      /* Debug visualization */
      .main-content { border: 3px solid orange !important; background: rgba(255,165,0,0.1) !important; }
      .browser-wrapper { border: 3px solid red !important; background: rgba(255,0,0,0.1) !important; }
      .browser-container { border: 3px solid blue !important; background: rgba(0,0,255,0.1) !important; }
      webview, .browser-view { border: 3px solid green !important; background: rgba(0,255,0,0.2) !important; min-height: 100px !important; }
      .welcome-screen { border: 3px solid purple !important; }
      .toolbar { border: 2px solid cyan !important; }
      .tab-bar { border: 2px solid magenta !important; }
    `;
    document.head.appendChild(debugStyles);
    console.log('[Debug] CSS injected - colors: orange=main-content, red=browser-wrapper, blue=browser-container, green=webview, purple=welcome');
  }

  function removeDebugCSS() {
    if (debugStyles) {
      debugStyles.remove();
      debugStyles = null;
      console.log('[Debug] CSS removed');
    }
  }

  function getLayoutInfo() {
    const wrapper = document.getElementById('browser-wrapper');
    const container = document.getElementById('browser-container');
    const mainContent = document.querySelector('.main-content');
    const welcome = document.getElementById('welcome-screen');
    const webview = document.querySelector('webview');
    const toolbar = document.querySelector('.toolbar');
    const tabBar = document.getElementById('tab-bar');

    const info = {
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

    console.log('\n========== LAYOUT INFO ==========');
    console.log('Window:', info.window.width + 'x' + info.window.height);
    if (info.mainContent) console.log('Main Content:', 'height=' + info.mainContent.height + 'px, flex=' + info.mainContent.flex);
    if (info.wrapper) console.log('Browser Wrapper:', 'display=' + info.wrapper.display + ', height=' + info.wrapper.height + 'px');
    if (info.container) console.log('Browser Container:', 'position=' + info.container.position + ', height=' + info.container.height + 'px');
    if (info.webview) console.log('Webview:', 'height=' + info.webview.height + 'px, width=' + info.webview.width + 'px');
    if (info.welcome) console.log('Welcome Screen:', 'display=' + info.welcome.display);
    console.log('================================\n');

    // Check for issues
    if (info.webview && info.webview.height < 300) {
      console.warn('⚠️ ISSUE: Webview height is only ' + info.webview.height + 'px (should be > 300)');
    }
    if (info.wrapper && info.wrapper.height < 400 && info.wrapper.display !== 'none') {
      console.warn('⚠️ ISSUE: Wrapper height is only ' + info.wrapper.height + 'px (should be > 400)');
    }

    return info;
  }

  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+D: Toggle debug CSS
    if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.code === 'KeyD')) {
      e.preventDefault();
      if (debugStyles) {
        removeDebugCSS();
        alert('Debug CSS removed');
      } else {
        injectDebugCSS();
        alert('Debug CSS injected - check colored borders');
      }
    }

    // Ctrl+Shift+L: Log layout info
    if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.code === 'KeyL')) {
      e.preventDefault();
      const info = getLayoutInfo();
      alert('Layout Info:\n' +
        'Window: ' + info.window.width + 'x' + info.window.height + '\n' +
        'Webview height: ' + (info.webview ? info.webview.height : 'N/A') + 'px\n' +
        'Wrapper height: ' + (info.wrapper ? info.wrapper.height : 'N/A') + 'px\n' +
        'Container height: ' + (info.container ? info.container.height : 'N/A') + 'px\n' +
        'Check console (F12) for full details');
    }
  });

  // Expose to window for console access
  window.debugLayout = {
    injectCSS: injectDebugCSS,
    removeCSS: removeDebugCSS,
    getInfo: getLayoutInfo
  };
})();
