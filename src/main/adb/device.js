// adbkit is NOT required at module load time — see lazy-load comment in adb/index.js.
const EventEmitter = require('events');
const net = require('net');

class DeviceManager extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.devices = [];
    this.tracking = false;
    this.serverRunning = false;
  }

  /**
   * Check if ADB server is running on port 5037
   */
  _checkServerRunning() {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = 2000;

      socket.setTimeout(timeout);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('error', () => {
        resolve(false);
      });

      socket.connect(5037, '127.0.0.1');
    });
  }

  /**
   * Initialize ADB client
   */
  async init() {
    const initStart = Date.now();
    console.log(`[PERF] +0ms - ADB init() called`);

    if (this.client) {
      console.log('[ADB] Already initialized, skipping');
      return;
    }

    // First check if ADB server is running
    console.log('[ADB] Checking if ADB server is running on port 5037...');
    this.serverRunning = await this._checkServerRunning();

    if (!this.serverRunning) {
      console.warn('[ADB] ADB server not running on port 5037');
      console.warn('[ADB] Please start ADB server manually:');
      console.warn('[ADB]   - Run "adb start-server" in terminal');
      console.warn('[ADB]   - Or open Android Studio which starts ADB automatically');
      console.warn('[ADB]   - Or install Android Platform Tools and run adb');
      // Don't throw - allow app to run without ADB, user can start server later
      this._emitServerError();
      return;
    }

    console.log('[ADB] ADB server is running');

    try {
      const clientStart = Date.now();
      // Lazy-load adbkit (and its usb/libusb native addon) only here at init time,
      // not at module parse time. This avoids loading the 'usb' native addon before
      // the window is visible (15-20s on Windows for USB enumeration + AV scan).
      const Adb = require('adbkit');
      this.client = Adb.createClient({
        host: '127.0.0.1', // Force IPv4
        port: 5037
      });
      console.log(`[PERF] +${Date.now() - initStart}ms - Adb.createClient() (${Date.now() - clientStart}ms)`);

      // Start tracking devices
      console.log('[ADB] Starting device tracking...');
      const trackStart = Date.now();
      await this.startTracking();
      console.log(`[PERF] +${Date.now() - initStart}ms - startTracking() (${Date.now() - trackStart}ms)`);

      // Log initial device count
      console.log('[ADB] Initial device count:', this.devices.length);
      console.log(`[PERF] +${Date.now() - initStart}ms - ADB init() COMPLETE`);
    } catch (err) {
      console.error('[ADB] Failed to initialize:', err.message);
      console.error('[ADB] Stack trace:', err.stack);
      // Don't throw - allow app to continue
      this._emitServerError(err.message);
    }
  }

  /**
   * Emit server not running event for UI feedback
   */
  _emitServerError(message = 'ADB server not running') {
    this.emit('server:error', {
      message,
      help: 'Please start ADB server:\n• Run "adb start-server" in terminal\n• Or open Android Studio\n• Or install Android Platform Tools'
    });
  }

  /**
   * Retry initialization (called when user starts ADB server)
   */
  async retryInit() {
    console.log('[ADB] Retrying initialization...');
    this.client = null;
    this.tracking = false;
    await this.init();
  }

  /**
   * Start tracking device connections/disconnections
   */
  async startTracking() {
    if (this.tracking) return;
    if (!this.client) {
      console.warn('[ADB] Cannot start tracking - no client');
      return;
    }

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

      // Initial device list - single retry with shorter delay
      await this.updateDeviceList();
      if (this.devices.length === 0) {
        setTimeout(() => this.updateDeviceList(), 500);
      }
    } catch (err) {
      console.error('[ADB] Failed to start device tracking:', err.message);
      this.tracking = false;
    }
  }

  /**
   * Update the list of connected devices
   */
  async updateDeviceList() {
    if (!this.client) return;

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
   * Check if ADB server is running
   */
  isServerRunning() {
    return this.serverRunning;
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
      this.serverRunning = false;
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
  getDeviceManager
};
