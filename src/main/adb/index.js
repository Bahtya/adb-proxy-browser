const { getDeviceManager } = require('./device');
const PortForwarder = require('./forward');
// adbkit is NOT required at module load time. It is lazy-loaded inside init()
// because adbkit transitively pulls in the 'usb' native addon (libusb), which
// on Windows takes 15-20 seconds to initialize (USB device enumeration + AV scan
// of the .node binary). Deferring this require to first use means the Electron
// window can appear in ~600ms while ADB loads in the background.

class AdbManager {
  constructor() {
    this.client = null;
    this.deviceManager = getDeviceManager();
    this.portForwarder = null;
    this.initialized = false;
    this.serverError = null;

    this.deviceManager.on('server:error', (err) => {
      this.serverError = err;
      console.warn('[ADB] Server error:', err.message);
    });
  }

  /**
   * Initialize ADB manager
   */
  async init() {
    if (this.initialized) return;

    try {
      // This will check if ADB server is running before loading adbkit
      await this.deviceManager.init();

      // If server is not running, deviceManager.client will be null
      if (!this.deviceManager.client) {
        console.warn('[ADB] ADB server not available, running in offline mode');
        return;
      }

      this.client = this.deviceManager.client;

      // Initialize port forwarder with client
      this.portForwarder = new PortForwarder(this.client, this.deviceManager.getAdbPath());

      this.initialized = true;
      this.serverError = null;
      console.log('[ADB] Manager initialized successfully');
    } catch (err) {
      console.error('[ADB] Failed to initialize:', err.message);
      // Don't throw - allow app to continue in offline mode
    }
  }

  /**
   * Retry initialization after user starts ADB server
   */
  async retry() {
    console.log('[ADB] Retrying initialization...');
    this.initialized = false;
    this.serverError = null;
    await this.init();
    return this.initialized;
  }

  /**
   * Check if ADB is ready
   */
  isReady() {
    return this.initialized && this.deviceManager.isServerRunning();
  }

  /**
   * Get server error if any
   */
  getServerError() {
    return this.serverError;
  }

  /**
   * Get connected devices
   */
  getDevices() {
    return this.deviceManager.getDevices();
  }

  /**
   * Get first connected device
   */
  getFirstDevice() {
    return this.deviceManager.getFirstDevice();
  }

  /**
   * Create port forward
   */
  async forward(localPort, remotePort, deviceId = null) {
    if (!this.initialized || !this.portForwarder) {
      throw new Error('ADB not ready. Please start ADB server first.');
    }

    const device = deviceId
      ? this.deviceManager.getDeviceById(deviceId)
      : this.deviceManager.getFirstDevice();

    if (!device) {
      throw new Error('No device connected');
    }

    return this.portForwarder.forward(device.id, localPort, remotePort);
  }

  /**
   * Remove port forward
   */
  async removeForward(localPort, deviceId = null) {
    if (!this.initialized || !this.portForwarder) {
      throw new Error('ADB not ready');
    }

    const device = deviceId
      ? this.deviceManager.getDeviceById(deviceId)
      : this.deviceManager.getFirstDevice();

    if (!device) {
      throw new Error('No device connected');
    }

    return this.portForwarder.removeForward(device.id, localPort);
  }

  /**
   * Remove all forwards for current device
   */
  async removeAllForwards(deviceId = null) {
    if (!this.initialized || !this.portForwarder) return;

    const device = deviceId
      ? this.deviceManager.getDeviceById(deviceId)
      : this.deviceManager.getFirstDevice();

    if (device) {
      await this.portForwarder.removeAllForwards(device.id);
    }
  }

  /**
   * Subscribe to device events
   */
  onDevicesUpdated(callback) {
    this.deviceManager.on('devices:updated', callback);
  }

  /**
   * Close ADB manager
   */
  async close() {
    if (this.portForwarder) {
      await this.portForwarder.clearAll();
    }
    await this.deviceManager.close();
    this.client = null;
    this.initialized = false;
    this.serverError = null;
  }
}

// Singleton instance
let instance = null;

function getAdbManager() {
  if (!instance) {
    instance = new AdbManager();
  }
  return instance;
}

module.exports = {
  getAdbManager
};
