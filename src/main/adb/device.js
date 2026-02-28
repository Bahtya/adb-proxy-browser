const Adb = require('adbkit');
const EventEmitter = require('events');

class DeviceManager extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.devices = [];
    this.tracking = false;
  }

  /**
   * Initialize ADB client
   */
  async init() {
    if (this.client) return;

    this.client = Adb.createClient();

    // Start tracking devices
    await this.startTracking();
  }

  /**
   * Start tracking device connections/disconnections
   */
  async startTracking() {
    if (this.tracking) return;

    try {
      const tracker = await this.client.trackDevices();
      this.tracking = true;

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

      // Initial device list
      await this.updateDeviceList();
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
  getDeviceManager
};
