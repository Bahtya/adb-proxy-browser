const { getDeviceManager, findAdbPath } = require('./device');
const PortForwarder = require('./forward');
const Adb = require('adbkit');

class AdbManager {
  constructor() {
    this.client = null;
    this.deviceManager = null;
    this.portForwarder = null;
    this.initialized = false;
    this.adbPath = null;
  }

  /**
   * Initialize ADB manager
   */
  async init() {
    if (this.initialized) return;

    try {
      // Get ADB path
      this.adbPath = findAdbPath();

      // Create ADB client with correct settings
      this.client = Adb.createClient({
        bin: this.adbPath,
        host: '127.0.0.1',
        port: 5037
      });

      // Initialize device manager
      this.deviceManager = getDeviceManager();
      await this.deviceManager.init();

      // Initialize port forwarder with the same client
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
