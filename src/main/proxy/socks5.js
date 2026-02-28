const net = require('net');
const EventEmitter = require('events');

/**
 * SOCKS5 Proxy Server
 * RFC 1928 implementation
 *
 * This proxy accepts connections from the browser and forwards them
 * through the ADB tunnel to the phone's proxy (Clash).
 */
class Socks5Proxy extends EventEmitter {
  constructor() {
    super();
    this.server = null;
    this.port = 0;
    this.tunnelPort = 0; // ADB forwarded port
    this.running = false;
    this.connections = new Set();
  }

  /**
   * Start SOCKS5 proxy server
   * @param {number} port - Port to listen on (for browser)
   * @param {number} tunnelPort - ADB tunnel port to connect to
   */
  start(port, tunnelPort) {
    if (this.running) {
      this.stop();
    }

    this.port = port;
    this.tunnelPort = tunnelPort;
    this.server = net.createServer((socket) => this.handleConnection(socket));

    this.server.on('error', (err) => {
      console.error('[SOCKS5] Server error:', err.message);
      this.emit('error', err);
    });

    return new Promise((resolve, reject) => {
      this.server.listen(port, '127.0.0.1', () => {
        this.running = true;
        console.log(`[SOCKS5] Server listening on 127.0.0.1:${port}`);
        this.emit('started', { port });
        resolve(port);
      });

      this.server.on('error', reject);
    });
  }

  /**
   * Stop SOCKS5 proxy server
   */
  stop() {
    if (!this.running || !this.server) return Promise.resolve();

    // Close all active connections
    for (const conn of this.connections) {
      conn.destroy();
    }
    this.connections.clear();

    return new Promise((resolve) => {
      this.server.close(() => {
        this.running = false;
        console.log('[SOCKS5] Server stopped');
        this.emit('stopped');
        resolve();
      });
    });
  }

  /**
   * Handle incoming connection from browser
   */
  handleConnection(socket) {
    this.connections.add(socket);
    socket.on('close', () => this.connections.delete(socket));

    let state = 'greeting';

    socket.on('data', (data) => {
      try {
        if (state === 'greeting') {
          // Handle SOCKS5 greeting
          const version = data[0];

          if (version !== 5) {
            socket.destroy();
            return;
          }

          // No authentication required
          socket.write(Buffer.from([5, 0]));
          state = 'request';
        } else if (state === 'request') {
          // Handle CONNECT request
          this.handleConnectRequest(socket, data);
        }
      } catch (err) {
        console.error('[SOCKS5] Error handling data:', err.message);
        socket.destroy();
      }
    });

    socket.on('error', (err) => {
      console.error('[SOCKS5] Socket error:', err.message);
    });
  }

  /**
   * Handle SOCKS5 CONNECT request
   */
  handleConnectRequest(clientSocket, data) {
    const version = data[0];
    const cmd = data[1];

    if (version !== 5 || cmd !== 1) {
      // Only support CONNECT command
      clientSocket.write(Buffer.from([5, 7])); // Command not supported
      clientSocket.destroy();
      return;
    }

    const atyp = data[3];
    let targetHost;
    let offset = 4;

    if (atyp === 1) {
      // IPv4
      targetHost = `${data[offset]}.${data[offset + 1]}.${data[offset + 2]}.${data[offset + 3]}`;
      offset += 4;
    } else if (atyp === 3) {
      // Domain name
      const len = data[offset];
      offset++;
      targetHost = data.toString('utf8', offset, offset + len);
      offset += len;
    } else if (atyp === 4) {
      // IPv6
      const parts = [];
      for (let i = 0; i < 16; i += 2) {
        parts.push(data.slice(offset + i, offset + i + 2).toString('hex'));
      }
      targetHost = parts.join(':');
      offset += 16;
    } else {
      clientSocket.write(Buffer.from([5, 8])); // Address type not supported
      clientSocket.destroy();
      return;
    }

    const targetPort = data.readUInt16BE(offset);

    // Connect to target through ADB tunnel
    this.connectThroughTunnel(clientSocket, targetHost, targetPort);
  }

  /**
   * Connect to target through ADB tunnel (which goes to phone's Clash)
   */
  connectThroughTunnel(clientSocket, targetHost, targetPort) {
    // Connect to the ADB tunnel port, which forwards to phone's Clash
    const tunnelSocket = net.connect({
      host: '127.0.0.1',
      port: this.tunnelPort,
      family: 4
    });

    tunnelSocket.on('connect', () => {
      // Send SOCKS5 request through tunnel to Clash
      // Build SOCKS5 connect request
      const request = this.buildSocks5Request(targetHost, targetPort);
      tunnelSocket.write(request);

      // Wait for SOCKS5 response from Clash
      let responseBuffer = Buffer.alloc(0);

      const handleResponse = (data) => {
        responseBuffer = Buffer.concat([responseBuffer, data]);

        if (responseBuffer.length >= 10) {
          // Got response, check if successful
          if (responseBuffer[1] === 0) {
            // Success - send response to client and start piping
            const response = Buffer.alloc(10);
            response[0] = 5; // SOCKS version
            response[1] = 0; // Success
            response[2] = 0; // Reserved
            response[3] = 1; // IPv4
            response.writeUInt32BE(0, 4); // Address
            response.writeUInt16BE(0, 8); // Port
            clientSocket.write(response);

            // Start bidirectional piping
            tunnelSocket.removeListener('data', handleResponse);
            clientSocket.pipe(tunnelSocket);
            tunnelSocket.pipe(clientSocket);

            this.emit('connection', { host: targetHost, port: targetPort });
          } else {
            // Failed
            clientSocket.write(responseBuffer.slice(0, 10));
            clientSocket.destroy();
          }
        }
      };

      tunnelSocket.on('data', handleResponse);
    });

    tunnelSocket.on('error', (err) => {
      console.error(`[SOCKS5] Tunnel connection error:`, err.message);
      const response = Buffer.alloc(10);
      response[0] = 5;
      response[1] = 1; // General failure
      response[2] = 0;
      response[3] = 1;
      response.writeUInt32BE(0, 4);
      response.writeUInt16BE(0, 8);
      clientSocket.write(response);
      clientSocket.destroy();
    });

    tunnelSocket.on('close', () => {
      clientSocket.destroy();
    });

    clientSocket.on('close', () => {
      tunnelSocket.destroy();
    });
  }

  /**
   * Build SOCKS5 connect request
   */
  buildSocks5Request(host, port) {
    const isIPv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host);
    const isIPv6 = host.includes(':');

    if (isIPv4) {
      const parts = host.split('.').map(Number);
      const buffer = Buffer.alloc(10);
      buffer[0] = 5; // SOCKS version
      buffer[1] = 1; // CONNECT
      buffer[2] = 0; // Reserved
      buffer[3] = 1; // IPv4
      buffer[4] = parts[0];
      buffer[5] = parts[1];
      buffer[6] = parts[2];
      buffer[7] = parts[3];
      buffer.writeUInt16BE(port, 8);
      return buffer;
    } else if (isIPv6) {
      const buffer = Buffer.alloc(22);
      buffer[0] = 5;
      buffer[1] = 1;
      buffer[2] = 0;
      buffer[3] = 4; // IPv6
      // Write IPv6 address (simplified)
      buffer.writeUInt16BE(port, 20);
      return buffer;
    } else {
      // Domain name
      const hostBuffer = Buffer.from(host, 'utf8');
      const buffer = Buffer.alloc(7 + hostBuffer.length);
      buffer[0] = 5;
      buffer[1] = 1;
      buffer[2] = 0;
      buffer[3] = 3; // Domain
      buffer[4] = hostBuffer.length;
      hostBuffer.copy(buffer, 5);
      buffer.writeUInt16BE(port, 5 + hostBuffer.length);
      return buffer;
    }
  }

  /**
   * Check if server is running
   */
  isRunning() {
    return this.running;
  }
}

module.exports = Socks5Proxy;
