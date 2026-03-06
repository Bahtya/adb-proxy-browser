const EventEmitter = require('events');
const { spawn } = require('child_process');

class PortForwarder extends EventEmitter {
  constructor(client, adbPath) {
    super();
    this.client = client;
    this.adbPath = adbPath;
    this.activeForwards = new Map(); // deviceId -> [{localPort, remotePort, owned}]
  }

  _upsertTrackedForward(deviceId, localPort, remotePort, owned = true) {
    if (!this.activeForwards.has(deviceId)) {
      this.activeForwards.set(deviceId, []);
    }

    const forwards = this.activeForwards.get(deviceId);
    const existingForward = forwards.find(f => f.localPort === localPort);

    if (existingForward) {
      existingForward.remotePort = remotePort;
      existingForward.owned = owned;
      return;
    }

    forwards.push({ localPort, remotePort, owned });
  }

  _removeTrackedForward(deviceId, localPort) {
    const forwards = this.activeForwards.get(deviceId);
    if (!forwards) return;

    const nextForwards = forwards.filter(f => f.localPort !== localPort);
    if (nextForwards.length === 0) {
      this.activeForwards.delete(deviceId);
      return;
    }

    this.activeForwards.set(deviceId, nextForwards);
  }

  _getTrackedForward(deviceId, localPort) {
    const forwards = this.activeForwards.get(deviceId);
    if (!forwards) return null;
    return forwards.find(f => f.localPort === localPort) || null;
  }

  _runAdb(args, { allowFailure = false } = {}) {
    if (!this.adbPath) {
      return Promise.reject(new Error('ADB binary path is not set'));
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(this.adbPath, args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (err, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (err) {
          reject(err);
          return;
        }
        resolve(value);
      };

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });
      proc.on('error', (err) => finish(err));
      proc.on('close', (code) => {
        if (code === 0 || allowFailure) {
          finish(null, { code, stdout, stderr });
          return;
        }

        const details = (stderr || stdout || '').trim() || `adb exited with code ${code}`;
        finish(new Error(details));
      });

      const timeout = setTimeout(() => {
        if (!proc.killed) {
          proc.kill();
        }
        finish(new Error(`ADB command timed out: ${args.join(' ')}`));
      }, 10000);
    });
  }

  async _findExistingForward(deviceId, localPort) {
    const localEndpoint = `tcp:${localPort}`;
    const forwards = await this.listForwards(deviceId);
    return forwards.find(forward => forward.local === localEndpoint) || null;
  }

  /**
   * Create a port forward
   * @param {string} deviceId - Device serial number
   * @param {number} localPort - Local port to forward from
   * @param {number} remotePort - Remote port on device to forward to
   */
  async forward(deviceId, localPort, remotePort) {
    if (!this.adbPath) {
      throw new Error('ADB binary path not initialized');
    }

    const localEndpoint = `tcp:${localPort}`;
    const remoteEndpoint = `tcp:${remotePort}`;

    try {
      const existingForward = await this._findExistingForward(deviceId, localPort);
      if (existingForward) {
        if (existingForward.remote === remoteEndpoint) {
          this._upsertTrackedForward(deviceId, localPort, remotePort, false);
          console.log(`[ADB] Port forward already exists, skipping: ${deviceId} ${localEndpoint} -> ${remoteEndpoint}`);
          return true;
        }

        const trackedForward = this._getTrackedForward(deviceId, localPort);
        if (trackedForward && trackedForward.owned) {
          console.warn(`[ADB] Port forward conflict detected on owned forward, recreating: ${deviceId} ${localEndpoint} -> ${existingForward.remote} (expected ${remoteEndpoint})`);
          await this.removeForward(deviceId, localPort);
        } else {
          throw new Error(`Local port ${localPort} is already forwarded to ${existingForward.remote}. Reconfigure the port or remove the existing adb forward.`);
        }
      }

      await this._runAdb(['-s', deviceId, 'forward', localEndpoint, remoteEndpoint]);
      this._upsertTrackedForward(deviceId, localPort, remotePort, true);

      console.log(`[ADB] Port forward created: ${deviceId} tcp:${localPort} -> tcp:${remotePort}`);
      this.emit('forward:created', { deviceId, localPort, remotePort });

      return true;
    } catch (err) {
      console.error(`[ADB] Failed to create port forward: ${err.message}`);
      throw err;
    }
  }

  /**
   * Remove a port forward using adbkit client
   * @param {string} deviceId - Device serial number
   * @param {number} localPort - Local port that was forwarded
   */
  async removeForward(deviceId, localPort) {
    if (!this.adbPath) {
      throw new Error('ADB binary path not initialized');
    }

    const trackedForward = this._getTrackedForward(deviceId, localPort);
    if (trackedForward && !trackedForward.owned) {
      this._removeTrackedForward(deviceId, localPort);
      console.log(`[ADB] Leaving external port forward intact: ${deviceId} tcp:${localPort}`);
      this.emit('forward:removed', { deviceId, localPort });
      return true;
    }

    try {
      console.log(`[ADB] Removing forward: tcp:${localPort}`);
      await this._runAdb(['-s', deviceId, 'forward', '--remove', `tcp:${localPort}`], {
        allowFailure: true
      });
    } catch (err) {
      // If transport fails, the forward is likely already gone
      console.log(`[ADB] Forward tcp:${localPort} not found or already removed`);
    }

    // Remove from tracking regardless
    this._removeTrackedForward(deviceId, localPort);

    console.log(`[ADB] Port forward removed: ${deviceId} tcp:${localPort}`);
    this.emit('forward:removed', { deviceId, localPort });
    return true;
  }

  /**
   * Remove all forwards for a device
   * @param {string} deviceId - Device serial number
   */
  async removeAllForwards(deviceId) {
    const forwards = this.activeForwards.get(deviceId);
    if (!forwards || forwards.length === 0) return;

    for (const forward of [...forwards]) {
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
    if (!this.adbPath) {
      throw new Error('ADB binary path not initialized');
    }

    try {
      const { stdout } = await this._runAdb(['forward', '--list']);
      return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(/\s+/);
          if (parts.length < 3) return null;
          return {
            serial: parts[0],
            local: parts[1],
            remote: parts[2]
          };
        })
        .filter((forward) => forward && (!deviceId || forward.serial === deviceId));
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
