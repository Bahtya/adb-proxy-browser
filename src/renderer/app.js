// DOM Elements
const elements = {
  // Navigation
  btnBack: document.getElementById('btn-back'),
  btnForward: document.getElementById('btn-forward'),
  btnRefresh: document.getElementById('btn-refresh'),
  urlInput: document.getElementById('url-input'),
  btnGo: document.getElementById('btn-go'),

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
  browserView: document.getElementById('browser-view')
};

// State
let state = {
  connected: false,
  devices: [],
  currentUrl: '',
  config: {
    proxyPort: 7890,
    tunnelPort: 7891,
    remotePort: 7890,
    proxyType: 'socks5'
  }
};

// Initialize
async function init() {
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
  elements.btnBack.addEventListener('click', () => window.electronAPI.goBack());
  elements.btnForward.addEventListener('click', () => window.electronAPI.goForward());
  elements.btnRefresh.addEventListener('click', () => window.electronAPI.refresh());
  elements.btnGo.addEventListener('click', navigate);
  elements.urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') navigate();
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
}

// Navigate to URL
async function navigate() {
  let url = elements.urlInput.value.trim();
  if (!url) return;

  // Add protocol if missing
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  elements.urlInput.value = url;

  try {
    await window.electronAPI.navigate(url);
  } catch (err) {
    console.error('Navigation failed:', err);
  }
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
        proxyPort: state.config.proxyPort,
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
      <svg viewBox="0 0 24 24" width="24" height="24">
        <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
      </svg>
      <span>Disconnect</span>
    `;
    btn.classList.add('connected');
    statusIndicator.classList.remove('disconnected', 'connecting');
    statusIndicator.classList.add('connected');
    statusText.textContent = 'Connected';
  } else {
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="24" height="24">
        <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
      </svg>
      <span>Connect Phone</span>
    `;
    btn.classList.remove('connected');
    statusIndicator.classList.remove('connected', 'connecting');
    statusIndicator.classList.add('disconnected');
    statusText.textContent = 'Disconnected';
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
  state.config.proxyPort = parseInt(elements.proxyPort.value) || 7890;
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
  elements.proxyPort.value = state.config.proxyPort;
  elements.remotePort.value = state.config.remotePort;
  elements.proxyType.value = state.config.proxyType;

  elements.settingsProxyPort.value = state.config.proxyPort;
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
  state.config.proxyPort = parseInt(elements.settingsProxyPort.value) || 7890;
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
