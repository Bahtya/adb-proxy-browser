const EventEmitter = require('events');
const { spawn } = require('child_process');

class PortForwarder extends EventEmitter {
  constructor(client, adbPath) {
    super();
    this.client = client;
    this.adbPath = adbPath;
    this.activeForwards = new Map(); // deviceId -> [{localPort, remotePort}]
  }

  /**
   * Create a port forward
   * @param {string} deviceId - Device serial number
   * @param {number} localPort - Local port to forward from
   * @param {number} remotePort - Remote port on device to forward to
   */
  async forward(deviceId, localPort, remotePort) {
    if (!this.client) {
      throw new Error('ADB client not initialized');
    }

    try {
      await this.client.forward(deviceId, `tcp:${localPort}`, `tcp:${remotePort}`);

      // Track this forward
      if (!this.activeForwards.has(deviceId)) {
        this.activeForwards.set(deviceId, []);
      }
      this.activeForwards.get(deviceId).push({ localPort, remotePort });

      console.log(`[ADB] Port forward created: ${deviceId} tcp:${localPort} -> tcp:${remotePort}`);
      this.emit('forward:created', { deviceId, localPort, remotePort });

      return true;
    } catch (err) {
      console.error(`[ADB] Failed to create port forward: ${err.message}`);
      throw err;
    }
  }

  /**
   * Remove a port forward using adb command
   * @param {string} deviceId - Device serial number
   * @param {number} localPort - Local port that was forwarded
   */
  async removeForward(deviceId, localPort) {
    return new Promise((resolve, reject) => {
      if (!this.adbPath) {
        reject(new Error('ADB path not set'));
        return;
      }

      console.log(`[ADB] Removing forward: tcp:${localPort}`);

      const proc = spawn(this.adbPath, ['forward', '--remove', `tcp:${localPort}`], {
        stdio: 'pipe'
      });

      let stderr = '';

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        // Remove from tracking regardless of result
        const forwards = this.activeForwards.get(deviceId);
        if (forwards) {
          const index = forwards.findIndex(f => f.localPort === localPort);
          if (index !== -1) {
            forwards.splice(index, 1);
          }
        }

        if (code === 0) {
          console.log(`[ADB] Port forward removed: ${deviceId} tcp:${localPort}`);
          this.emit('forward:removed', { deviceId, localPort });
          resolve(true);
        } else {
          // If forward doesn't exist, that's fine
          if (stderr.includes('not found') || stderr.includes('error')) {
            console.log(`[ADB] Forward tcp:${localPort} not found or already removed`);
            resolve(true);
          } else {
            const error = new Error(`Failed to remove forward: ${stderr || 'Unknown error'}`);
            console.error(`[ADB] ${error.message}`);
            reject(error);
          }
        }
      });

      proc.on('error', (err) => {
        console.error(`[ADB] Failed to remove port forward: ${err.message}`);
        reject(err);
      });
    });
  }

  /**
   * Remove all forwards for a device
   * @param {string} deviceId - Device serial number
   */
  async removeAllForwards(deviceId) {
    const forwards = this.activeForwards.get(deviceId);
    if (!forwards || forwards.length === 0) return;

    for (const forward of forwards) {
      try {
        await this.removeForward(deviceId, forward.localPort);
      } catch (err) {
        console.error(`[ADB] Failed to remove forward ${forward.localPort}:`, err.message);
      }
    }

    this.activeForwards.delete(deviceId);
  }

  /**
   * List all active forwards for a device
   * @param {string} deviceId - Device serial number
   */
  async listForwards(deviceId) {
    if (!this.client) {
      throw new Error('ADB client not initialized');
    }

    try {
      const forwards = await this.client.listForwards(deviceId);
      return forwards;
    } catch (err) {
      console.error(`[ADB] Failed to list forwards: ${err.message}`);
      throw err;
    }
  }

  /**
   * Get tracked forwards for a device
   * @param {string} deviceId - Device serial number
   */
  getTrackedForwards(deviceId) {
    return this.activeForwards.get(deviceId) || [];
  }

  /**
   * Check if a forward exists
   * @param {string} deviceId - Device serial number
   * @param {number} localPort - Local port
   */
  hasForward(deviceId, localPort) {
    const forwards = this.activeForwards.get(deviceId);
    if (!forwards) return false;
    return forwards.some(f => f.localPort === localPort);
  }

  /**
   * Clear all forwards
   */
  async clearAll() {
    for (const [deviceId] of this.activeForwards) {
      await this.removeAllForwards(deviceId);
    }
  }
}

module.exports = PortForwarder;
