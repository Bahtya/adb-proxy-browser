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
    this.deviceManager = null;
    this.portForwarder = null;
    this.initialized = false;
  }

  /**
   * Initialize ADB manager
   */
  async init() {
    if (this.initialized) return;

    try {
      // Lazy-load adbkit here (not at module top-level) to avoid loading the
      // usb/libusb native addon before the window is visible. This is the
      // single most impactful optimization for Windows startup time.
      const Adb = require('adbkit');

      // Create ADB client — adbkit manages the ADB server internally,
      // no external adb binary needed.
      this.client = Adb.createClient({
        host: '127.0.0.1',
        port: 5037
      });

      // Initialize device manager
      this.deviceManager = getDeviceManager();
      await this.deviceManager.init();

      // Initialize port forwarder with client
      this.portForwarder = new PortForwarder(this.client);

      this.initialized = true;
      console.log('[ADB] Manager initialized successfully');
    } catch (err) {
      console.error('[ADB] Failed to initialize:', err.message);
      throw err;
    }
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
    if (!this.initialized) {
      throw new Error('ADB manager not initialized');
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
    if (!this.initialized) {
      throw new Error('ADB manager not initialized');
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
    if (!this.initialized) return;

    const device = deviceId
      ? this.deviceManager.getDeviceById(deviceId)
      : this.deviceManager.getFirstDevice();

    if (device) {
      await this.portForwarder.removeAllForwards(device.id);
    }
  }

  /**
   * Create SSH port forward (local:8022 -> phone:8022 by default for Termux)
   */
  async forwardSSH(localPort = 8022, deviceId = null, remotePort = 8022) {
    if (!this.initialized) {
      throw new Error('ADB manager not initialized');
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
   * Remove SSH port forward
   */
  async removeSSHForward(localPort = 8022, deviceId = null) {
    if (!this.initialized) return;

    const device = deviceId
      ? this.deviceManager.getDeviceById(deviceId)
      : this.deviceManager.getFirstDevice();

    if (device) {
      await this.portForwarder.removeForward(device.id, localPort);
    }
  }

  /**
   * Subscribe to device events
   */
  onDeviceConnected(callback) {
    this.deviceManager.on('device:connected', callback);
  }

  onDeviceDisconnected(callback) {
    this.deviceManager.on('device:disconnected', callback);
  }

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
    if (this.deviceManager) {
      await this.deviceManager.close();
    }
    this.client = null;
    this.initialized = false;
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
  AdbManager,
  getAdbManager
};
