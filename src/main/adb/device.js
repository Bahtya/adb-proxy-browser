// Device manager using binary adb for server management + adbkit for device communication
const EventEmitter = require('events');
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getBundledAdbPath } = require('./download');

const ADB_SERVER_PORT = 5037;
const HEALTH_CHECK_INTERVAL = 5000;
const INITIAL_DEVICE_RETRY_COUNT = 6;
const INITIAL_DEVICE_RETRY_DELAY_MS = 500;
const BACKGROUND_DEVICE_REFRESH_COUNT = 15;
const BACKGROUND_DEVICE_REFRESH_DELAY_MS = 2000;

// Platform-specific adb binary paths
const ADB_PATHS = {
  win32: [
    getBundledAdbPath(),
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
    path.join(process.env.HOME || '', 'Android/Sdk', 'platform-tools', 'adb'),
  ]
};

/**
 * Find adb binary in system paths
 */
function findAdbPath() {
  const platform = process.platform;
  const paths = ADB_PATHS[platform] || [];

  for (const adbPath of paths) {
    if (adbPath && fs.existsSync(adbPath)) {
      console.log(`[ADB] Found adb at: ${adbPath}`);
      return adbPath;
    }
  }

  // Fallback to 'adb' in PATH
  console.warn('[ADB] ADB not found in known locations, using system PATH');
  return 'adb';
}

/**
 * Device Manager class
 * Manages ADB server lifecycle and device tracking
 */
class DeviceManager extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.devices = [];
    this.tracker = null;
    this._adbPath = null;
    this._serverRunning = false;
    this._healthCheckInterval = null;
    this._reconnecting = false;
    this._backgroundRefreshTimeout = null;
    this._backgroundRefreshRemaining = 0;
  }

  /**
   * Initialize device manager
   */
  async init() {
    this._adbPath = findAdbPath();

    // Check if ADB server is already running
    const isRunning = await this._checkServerRunning();

    if (!isRunning) {
      console.log('[ADB] ADB server not running, starting...');
      const startResult = await this._startAdbServer();
      if (!startResult.ok) {
        this.emit('server:error', {
          message: startResult.message || 'Failed to start ADB server',
          help: startResult.help || 'Please install Android Platform Tools or start ADB manually.'
        });
        return;
      }
    } else {
      console.log('[ADB] ADB server already running');
    }

    // Initialize adbkit client
    try {
      // Prefer adbkit from package.json; keep compatibility with devicefarmer fork if present.
      let adbkit;
      try {
        adbkit = require('adbkit');
      } catch (errPrimary) {
        const missingPrimary = errPrimary && errPrimary.code === 'MODULE_NOT_FOUND';
        if (!missingPrimary) throw errPrimary;
        try {
          const fallback = require('@devicefarmer/adbkit');
          adbkit = fallback.default || fallback;
        } catch (errFallback) {
          throw new Error(
            `Unable to load ADB library. Tried "adbkit" and "@devicefarmer/adbkit". ${errPrimary.message}`
          );
        }
      }
      this.client = adbkit.createClient();

      // Start device tracking
      await this._startTracking();

      // Start health check
      this._startHealthCheck();

      this._serverRunning = true;
      console.log('[ADB] Device manager initialized');
    } catch (err) {
      console.error('[ADB] Failed to initialize adbkit:', err.message);
      this.emit('server:error', { message: `ADB kit error: ${err.message}` });
    }
  }

  /**
   * Check if ADB server is running by connecting to port 5037
   */
  async _checkServerRunning() {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 1000);

      socket.connect(ADB_SERVER_PORT, '127.0.0.1', () => {
        clearTimeout(timeout);
        socket.end();
        resolve(true);
      });

      socket.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  }

  /**
   * Start ADB server using binary adb
   */
  async _startAdbServer() {
    return new Promise((resolve) => {
      console.log(`[ADB] Starting server with: ${this._adbPath} start-server`);

      const proc = spawn(this._adbPath, ['start-server'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      };

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', async (code) => {
        if (code === 0) {
          console.log('[ADB] Server started successfully');
          finish({ ok: true });
        } else {
          // Some adb variants return non-zero while server is actually up.
          const running = await this._checkServerRunning();
          if (running) {
            console.warn(`[ADB] start-server exited with code ${code}, but server is reachable`);
            finish({ ok: true });
            return;
          }

          const details = (stderr || stdout || '').trim();
          const message = details
            ? `Failed to start ADB server (${details})`
            : `Failed to start ADB server (exit code ${code})`;
          console.error(`[ADB] ${message}`);
          finish({
            ok: false,
            message,
            help: 'Run "adb start-server" to verify ADB works, or install Android Platform Tools.'
          });
        }
      });

      proc.on('error', (err) => {
        console.error(`[ADB] Failed to spawn adb: ${err.message}`);
        const isMissingAdb = err.code === 'ENOENT';
        finish({
          ok: false,
          message: isMissingAdb
            ? 'ADB binary not found. Please install Android Platform Tools.'
            : `Failed to launch ADB: ${err.message}`,
          help: isMissingAdb
            ? 'Use "Auto Download" in the app or install Android Platform Tools manually.'
            : 'Please verify adb executable is accessible and retry.'
        });
      });

      // Timeout after 10 seconds
      const timeout = setTimeout(() => {
        if (!proc.killed) {
          proc.kill();
          console.log('[ADB] Server start timed out');
        }
        finish({
          ok: false,
          message: 'Failed to start ADB server (timeout)',
          help: 'Please check whether adb can start from terminal via "adb start-server".'
        });
      }, 10000);
    });
  }

  /**
   * Start periodic health check
   */
  _startHealthCheck() {
    if (this._healthCheckInterval) {
      clearInterval(this._healthCheckInterval);
    }

    this._healthCheckInterval = setInterval(async () => {
      const isRunning = await this._checkServerRunning();

      if (!isRunning && this._serverRunning) {
        console.log('[ADB] Server died, attempting restart...');
        this._serverRunning = false;
        this.emit('server:dead');

        await this._handleServerRestart();
      } else if (isRunning && !this._serverRunning) {
        console.log('[ADB] Server recovered');
        this._serverRunning = true;
        this.emit('server:started');
      }
    }, HEALTH_CHECK_INTERVAL);

    console.log('[ADB] Health check started');
  }

  /**
   * Stop health check
   */
  _stopHealthCheck() {
    if (this._healthCheckInterval) {
      clearInterval(this._healthCheckInterval);
      this._healthCheckInterval = null;
    }
  }

  /**
   * Handle ADB server restart
   */
  async _handleServerRestart() {
    if (this._reconnecting) return;
    this._reconnecting = true;

    try {
      // Stop current tracking
      if (this.tracker) {
        try {
          await this.tracker.end();
        } catch (e) {
          // Ignore
        }
        this.tracker = null;
      }

      // Restart server
      const started = await this._startAdbServer();
      if (started) {
        this._serverRunning = true;

        // Reinitialize adbkit and tracking
        if (this.client) {
          await this._startTracking();
          this.emit('server:restarted');
        }
      }
    } catch (err) {
      console.error('[ADB] Restart failed:', err.message);
    }

    this._reconnecting = false;
  }

  /**
   * Start device tracking via adbkit
   */
  async _startTracking() {
    if (!this.client) return;

    try {
      this.tracker = await this.client.trackDevices();

      this.tracker.on('add', (device) => {
        console.log(`[ADB] Device connected: ${device.id} (${device.type})`);
        this._updateDevices();
        this.emit('device:connected', device);
      });

      this.tracker.on('remove', (device) => {
        console.log(`[ADB] Device disconnected: ${device.id}`);
        this._updateDevices();
        this.emit('device:disconnected', device);
      });

      this.tracker.on('change', (device) => {
        console.log(`[ADB] Device changed: ${device.id} (${device.type})`);
        this._updateDevices();
        this.emit('device:changed', device);
      });

      this.tracker.on('end', () => {
        console.log('[ADB] Device tracking ended');
        this.tracker = null;
      });

      this.tracker.on('error', (err) => {
        console.error('[ADB] Tracker error:', err.message);
      });

      // When adb has just started, listDevices() may briefly return empty even
      // though a USB device is already authorized. Retry a few times so the UI
      // does not get stuck on "No Devices" after startup.
      await this._updateDevicesWithRetry(INITIAL_DEVICE_RETRY_COUNT, INITIAL_DEVICE_RETRY_DELAY_MS);
      this._scheduleBackgroundRefreshes();

      console.log('[ADB] Device tracking started');
    } catch (err) {
      console.error('[ADB] Failed to start device tracking:', err.message);
    }
  }

  async _updateDevicesWithRetry(maxAttempts, delayMs) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this._updateDevices();

      if (this.devices.length > 0 || attempt === maxAttempts) {
        return this.devices;
      }

      console.log(`[ADB] No devices yet, retrying device list (${attempt}/${maxAttempts})...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    return this.devices;
  }

  /**
   * Update device list
   */
  async _updateDevices() {
    if (!this.client) return this.devices;

    try {
      let devices = await this.client.listDevices();

      // adbkit can occasionally return an empty list during server/device warmup
      // while `adb devices` already reports the device. Fall back to the binary
      // query so the UI does not stay stuck on "No Devices".
      if (devices.length === 0) {
        const cliDevices = await this._listDevicesViaAdbBinary();
        if (cliDevices.length > 0) {
          console.warn(`[ADB] adbkit returned 0 devices, using adb binary result (${cliDevices.length})`);
          devices = cliDevices;
        }
      }

      this.devices = devices;
      this.emit('devices:updated', this.devices);
      return this.devices;
    } catch (err) {
      console.error('[ADB] Failed to list devices:', err.message);
      const cliDevices = await this._listDevicesViaAdbBinary();
      if (cliDevices.length > 0) {
        console.warn(`[ADB] Recovered device list via adb binary after adbkit error (${cliDevices.length})`);
        this.devices = cliDevices;
        this.emit('devices:updated', this.devices);
      }
      return this.devices;
    }
  }

  async _listDevicesViaAdbBinary() {
    if (!this._adbPath) return [];

    return new Promise((resolve) => {
      const proc = spawn(this._adbPath, ['devices'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (devices) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(devices);
      };

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('error', (err) => {
        console.error('[ADB] Failed to run "adb devices":', err.message);
        finish([]);
      });

      proc.on('close', (code) => {
        if (code !== 0 && stderr.trim()) {
          console.error(`[ADB] "adb devices" exited with code ${code}: ${stderr.trim()}`);
          finish([]);
          return;
        }

        finish(this._parseAdbDevicesOutput(stdout));
      });

      const timeout = setTimeout(() => {
        if (!proc.killed) {
          proc.kill();
        }
        console.warn('[ADB] "adb devices" timed out');
        finish([]);
      }, 5000);
    });
  }

  _parseAdbDevicesOutput(output) {
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('List of devices attached'))
      .map((line) => {
        const parts = line.split(/\s+/);
        if (parts.length < 2) return null;
        return {
          id: parts[0],
          type: parts[1]
        };
      })
      .filter(Boolean);
  }

  _scheduleBackgroundRefreshes() {
    if (this.devices.length > 0 || this._backgroundRefreshTimeout) {
      return;
    }

    this._backgroundRefreshRemaining = BACKGROUND_DEVICE_REFRESH_COUNT;
    const tick = async () => {
      this._backgroundRefreshTimeout = null;

      if (!this.client || this.devices.length > 0 || this._backgroundRefreshRemaining <= 0) {
        return;
      }

      this._backgroundRefreshRemaining -= 1;
      await this._updateDevices();

      if (this.devices.length === 0 && this._backgroundRefreshRemaining > 0) {
        this._backgroundRefreshTimeout = setTimeout(tick, BACKGROUND_DEVICE_REFRESH_DELAY_MS);
      }
    };

    this._backgroundRefreshTimeout = setTimeout(tick, BACKGROUND_DEVICE_REFRESH_DELAY_MS);
  }

  /**
   * Check if ADB server is running
   */
  isServerRunning() {
    return this._serverRunning;
  }

  /**
   * Get all connected devices
   */
  getDevices() {
    return this.devices;
  }

  /**
   * Get first connected device
   */
  getFirstDevice() {
    return this.devices.find(d => d.type === 'device') || this.devices[0] || null;
  }

  /**
   * Get device by ID
   */
  getDeviceById(id) {
    return this.devices.find(d => d.id === id) || null;
  }

  /**
   * Close device manager
   */
  async close() {
    this._stopHealthCheck();

    if (this._backgroundRefreshTimeout) {
      clearTimeout(this._backgroundRefreshTimeout);
      this._backgroundRefreshTimeout = null;
      this._backgroundRefreshRemaining = 0;
    }

    if (this.tracker) {
      try {
        await this.tracker.end();
      } catch (e) {
        // Ignore
      }
      this.tracker = null;
    }

    this.client = null;
    this.devices = [];
    this._serverRunning = false;

    console.log('[ADB] Device manager closed');
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
