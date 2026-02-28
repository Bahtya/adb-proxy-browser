const Socks5Proxy = require('./socks5');
const HttpProxy = require('./http');
const EventEmitter = require('events');

/**
 * Proxy Manager
 *
 * Architecture:
 * - Browser connects to local proxy server (e.g., port 7890)
 * - Local proxy forwards requests through ADB tunnel (e.g., port 7891)
 * - ADB tunnel forwards to phone's Clash (e.g., port 7890)
 *
 * Port mapping:
 * - proxyPort: Port that browser uses (7890)
 * - tunnelPort: ADB forwarded port that connects to phone's proxy (7891 -> phone:7890)
 * - remotePort: Port on phone where Clash is listening (7890)
 */
class ProxyManager extends EventEmitter {
  constructor() {
    super();
    this.socks5Proxy = new Socks5Proxy();
    this.httpProxy = new HttpProxy();

    // Configuration
    this.proxyPort = 7890;     // Local proxy port (browser connects here)
    this.tunnelPort = 7891;    // ADB tunnel port (forwarded to phone)
    this.remotePort = 7890;    // Phone's proxy port (Clash)
    this.proxyType = 'socks5';

    this.running = false;

    this.socks5Proxy.on('error', (err) => this.emit('error', err));
    this.httpProxy.on('error', (err) => this.emit('error', err));
  }

  /**
   * Start proxy server
   * @param {Object} options - Proxy options
   */
  async start(options = {}) {
    const {
      proxyPort = this.proxyPort,
      tunnelPort = this.tunnelPort,
      remotePort = this.remotePort,
      type = this.proxyType
    } = options;

    this.proxyPort = proxyPort;
    this.tunnelPort = tunnelPort;
    this.remotePort = remotePort;
    this.proxyType = type;

    if (this.running) {
      await this.stop();
    }

    try {
      if (type === 'socks5') {
        await this.socks5Proxy.start(proxyPort, tunnelPort);
      } else {
        await this.httpProxy.start(proxyPort, tunnelPort);
      }

      this.running = true;
      console.log(`[Proxy] Started ${type} proxy on port ${proxyPort} (tunnel: ${tunnelPort} -> phone:${remotePort})`);
      this.emit('started', { port: proxyPort, type });

      return { port: proxyPort, type, tunnelPort, remotePort };
    } catch (err) {
      console.error('[Proxy] Failed to start:', err.message);
      throw err;
    }
  }

  /**
   * Stop proxy server
   */
  async stop() {
    if (!this.running) return;

    try {
      await this.socks5Proxy.stop();
      await this.httpProxy.stop();
      this.running = false;
      console.log('[Proxy] Stopped');
      this.emit('stopped');
    } catch (err) {
      console.error('[Proxy] Failed to stop:', err.message);
      throw err;
    }
  }

  /**
   * Set ports
   */
  setPorts(proxyPort, tunnelPort, remotePort) {
    this.proxyPort = proxyPort;
    this.tunnelPort = tunnelPort;
    this.remotePort = remotePort;
  }

  /**
   * Get proxy port (for browser)
   */
  getProxyPort() {
    return this.proxyPort;
  }

  /**
   * Get tunnel port (for ADB forward)
   */
  getTunnelPort() {
    return this.tunnelPort;
  }

  /**
   * Get remote port (on phone)
   */
  getRemotePort() {
    return this.remotePort;
  }

  /**
   * Set proxy type
   */
  setProxyType(type) {
    if (type !== 'socks5' && type !== 'http') {
      throw new Error('Invalid proxy type. Must be "socks5" or "http"');
    }
    this.proxyType = type;
  }

  /**
   * Get proxy type
   */
  getProxyType() {
    return this.proxyType;
  }

  /**
   * Get proxy URL for Electron
   */
  getProxyUrl() {
    if (this.proxyType === 'socks5') {
      return `socks5://127.0.0.1:${this.proxyPort}`;
    } else {
      return `http://127.0.0.1:${this.proxyPort}`;
    }
  }

  /**
   * Check if proxy is running
   */
  isRunning() {
    return this.running;
  }

  /**
   * Get status
   */
  getStatus() {
    return {
      running: this.running,
      proxyPort: this.proxyPort,
      tunnelPort: this.tunnelPort,
      remotePort: this.remotePort,
      proxyType: this.proxyType,
      proxyUrl: this.getProxyUrl()
    };
  }
}

// Singleton instance
let instance = null;

function getProxyManager() {
  if (!instance) {
    instance = new ProxyManager();
  }
  return instance;
}

module.exports = {
  ProxyManager,
  getProxyManager
};
