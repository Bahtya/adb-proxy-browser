const Adb = require('adbkit');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');
const { getBundledAdbPath, hasBundledAdb } = require('./download');

// Common ADB paths on different platforms
const ADB_PATHS = {
  win32: [
    getBundledAdbPath(), // Check bundled adb first
    path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    'C:\\Program Files\\Android\\Android Studio\\platform-tools\\adb.exe',
    'C:\\Android\\platform-tools\\adb.exe',
  ],
  darwin: [
    getBundledAdbPath(),
    '/usr/local/bin/adb',
    '/opt/homebrew/bin/adb',
    path.join(process.env.HOME || '', 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
  ],
  linux: [
    getBundledAdbPath(),
    '/usr/bin/adb',
    '/usr/local/bin/adb',
    path.join(process.env.HOME || '', 'Android', 'Sdk', 'platform-tools', 'adb'),
  ]
};

/**
 * Find ADB binary path
 */
function findAdbPath() {
  const platform = process.platform;
  const paths = ADB_PATHS[platform] || [];

  for (const adbPath of paths) {
    try {
      if (fs.existsSync(adbPath)) {
        console.log(`[ADB] Found adb at: ${adbPath}`);
        return adbPath;
      }
    } catch (e) {
      // Ignore
    }
  }

  // Try to find in PATH
  return 'adb';
}

class DeviceManager extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.devices = [];
    this.tracking = false;
    this.adbPath = null;
  }

  /**
   * Initialize ADB client
   */
  async init() {
    if (this.client) return;

    // Find ADB
    this.adbPath = findAdbPath();

    try {
      this.client = Adb.createClient({
        bin: this.adbPath,
        host: '127.0.0.1', // Force IPv4
        port: 5037
      });

      // Try to start ADB server
      await this.startAdbServer();

      // Start tracking devices
      await this.startTracking();
    } catch (err) {
      console.error('[ADB] Failed to initialize:', err.message);
      throw new Error(`ADB not found. Please install Android Platform Tools:

Windows: Download from https://developer.android.com/studio/releases/platform-tools
Or install via Android Studio -> SDK Manager -> Platform Tools

After installation, ensure adb is in your PATH or restart the application.`);
    }
  }

  /**
   * Start ADB server
   */
  async startAdbServer() {
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      console.log('[ADB] Starting ADB server...');

      const adbProcess = spawn(this.adbPath, ['start-server'], {
        stdio: 'pipe'
      });

      let output = '';

      adbProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      adbProcess.stderr.on('data', (data) => {
        output += data.toString();
      });

      adbProcess.on('close', (code) => {
        if (code === 0) {
          console.log('[ADB] Server started successfully');
          resolve();
        } else {
          console.error('[ADB] Server start failed:', output);
          reject(new Error('Failed to start ADB server'));
        }
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        resolve(); // Resolve anyway, server might already be running
      }, 10000);
    });
  }

  /**
   * Start tracking device connections/disconnections
   */
  async startTracking() {
    if (this.tracking) return;

    try {
      const tracker = await this.client.trackDevices();
      this.tracking = true;
      console.log('[ADB] Device tracking started');

      tracker.on('add', (device) => {
        console.log(`[ADB] Device connected: ${device.id}`);
        this.emit('device:connected', device);
        this.updateDeviceList();
      });

      tracker.on('remove', (device) => {
        console.log(`[ADB] Device disconnected: ${device.id}`);
        this.emit('device:disconnected', device);
        this.updateDeviceList();
      });

      tracker.on('end', () => {
        console.log('[ADB] Device tracking ended');
        this.tracking = false;
      });

      // Initial device list - retry a few times as adb server may need a moment
      await this.updateDeviceList();
      if (this.devices.length === 0) {
        setTimeout(() => this.updateDeviceList(), 1000);
        setTimeout(() => this.updateDeviceList(), 3000);
      }
    } catch (err) {
      console.error('[ADB] Failed to start device tracking:', err.message);
      throw err;
    }
  }

  /**
   * Update the list of connected devices
   */
  async updateDeviceList() {
    try {
      this.devices = await this.client.listDevices();
      console.log(`[ADB] Device list updated: ${this.devices.length} device(s)`);
      this.emit('devices:updated', this.devices);
    } catch (err) {
      console.error('[ADB] Failed to list devices:', err.message);
    }
  }

  /**
   * Get list of connected devices
   */
  getDevices() {
    return this.devices;
  }

  /**
   * Check if any device is connected
   */
  hasDevice() {
    return this.devices.length > 0;
  }

  /**
   * Get the first connected device
   */
  getFirstDevice() {
    return this.devices[0] || null;
  }

  /**
   * Get device by ID
   */
  getDeviceById(id) {
    return this.devices.find(d => d.id === id) || null;
  }

  /**
   * Wait for a device to be connected
   */
  async waitForDevice(timeout = 30000) {
    if (this.hasDevice()) {
      return this.getFirstDevice();
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off('device:connected', onConnect);
        reject(new Error('Timeout waiting for device'));
      }, timeout);

      const onConnect = (device) => {
        clearTimeout(timer);
        resolve(device);
      };

      this.once('device:connected', onConnect);
    });
  }

  /**
   * Close ADB client
   */
  async close() {
    if (this.client) {
      this.client = null;
      this.devices = [];
      this.tracking = false;
    }
  }
}

// Singleton instance
let instance = null;

function getDeviceManager() {
  if (!instance) {
    instance = new DeviceManager();
  }
  return instance;
}

module.exports = {
  DeviceManager,
  getDeviceManager,
  findAdbPath
};
