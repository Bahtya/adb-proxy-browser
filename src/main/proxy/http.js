const net = require('net');
const EventEmitter = require('events');

/**
 * HTTP Proxy Server
 * Supports CONNECT method for HTTPS tunneling
 *
 * This proxy accepts connections from the browser and forwards them
 * through the ADB tunnel to the phone's proxy (Clash).
 */
class HttpProxy extends EventEmitter {
  constructor() {
    super();
    this.server = null;
    this.port = 0;
    this.tunnelPort = 0;
    this.running = false;
    this.connections = new Set();
  }

  /**
   * Start HTTP proxy server
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
      console.error('[HTTP-Proxy] Server error:', err.message);
      this.emit('error', err);
    });

    return new Promise((resolve, reject) => {
      this.server.listen(port, '127.0.0.1', () => {
        this.running = true;
        console.log(`[HTTP-Proxy] Server listening on 127.0.0.1:${port}`);
        this.emit('started', { port });
        resolve(port);
      });

      this.server.on('error', reject);
    });
  }

  /**
   * Stop HTTP proxy server
   */
  stop() {
    if (!this.running || !this.server) return Promise.resolve();

    for (const conn of this.connections) {
      conn.destroy();
    }
    this.connections.clear();

    return new Promise((resolve) => {
      this.server.close(() => {
        this.running = false;
        console.log('[HTTP-Proxy] Server stopped');
        this.emit('stopped');
        resolve();
      });
    });
  }

  /**
   * Handle incoming connection
   */
  handleConnection(socket) {
    this.connections.add(socket);
    socket.on('close', () => this.connections.delete(socket));

    let buffer = Buffer.alloc(0);

    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);

      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const header = buffer.slice(0, headerEnd).toString('utf8');
      buffer = buffer.slice(headerEnd + 4);

      this.handleRequest(socket, header, buffer);
    });

    socket.on('error', (err) => {
      console.error('[HTTP-Proxy] Socket error:', err.message);
    });
  }

  /**
   * Handle HTTP request
   */
  handleRequest(socket, header, body) {
    const lines = header.split('\r\n');
    const [method, url, protocol] = lines[0].split(' ');

    if (method === 'CONNECT') {
      this.handleConnect(socket, url);
    } else if (['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH'].includes(method)) {
      this.handleHttp(socket, method, url, protocol, lines, body);
    } else {
      socket.end('HTTP/1.1 405 Method Not Allowed\r\n\r\n');
    }
  }

  /**
   * Handle CONNECT method (HTTPS tunneling)
   */
  handleConnect(socket, url) {
    const [host, portStr] = url.split(':');
    const targetPort = parseInt(portStr) || 443;

    // Connect through ADB tunnel to phone's Clash
    const tunnelSocket = net.connect({
      host: '127.0.0.1',
      port: this.tunnelPort,
      family: 4
    });

    tunnelSocket.on('connect', () => {
      // For HTTP proxy CONNECT, we need to establish a tunnel
      // Send the CONNECT request through the SOCKS5 proxy on the phone
      const socksRequest = this.buildSocks5ConnectRequest(host, targetPort);
      tunnelSocket.write(socksRequest);

      let responseBuffer = Buffer.alloc(0);

      const handleResponse = (data) => {
        responseBuffer = Buffer.concat([responseBuffer, data]);

        if (responseBuffer.length >= 10) {
          tunnelSocket.removeListener('data', handleResponse);

          if (responseBuffer[1] === 0) {
            // SOCKS5 connection successful
            socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            socket.pipe(tunnelSocket);
            tunnelSocket.pipe(socket);
            this.emit('connection', { host, port: targetPort });
          } else {
            socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
            socket.destroy();
          }
        }
      };

      tunnelSocket.on('data', handleResponse);
    });

    tunnelSocket.on('error', (err) => {
      console.error(`[HTTP-Proxy] Tunnel connection error:`, err.message);
      socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    });

    tunnelSocket.on('close', () => {
      socket.destroy();
    });

    socket.on('close', () => {
      tunnelSocket.destroy();
    });
  }

  /**
   * Handle regular HTTP request
   */
  handleHttp(socket, method, url, protocol, headers, body) {
    let targetHost, targetPort, path;

    if (url.startsWith('http://') || url.startsWith('https://')) {
      const urlObj = new URL(url);
      targetHost = urlObj.hostname;
      targetPort = parseInt(urlObj.port) || (urlObj.protocol === 'https:' ? 443 : 80);
      path = urlObj.pathname + urlObj.search;
    } else {
      const hostHeader = headers.find(h => h.toLowerCase().startsWith('host:'));
      if (!hostHeader) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }
      const hostParts = hostHeader.split(':')[1].trim().split(':');
      targetHost = hostParts[0];
      targetPort = parseInt(hostParts[1]) || 80;
      path = url;
    }

    // Connect through ADB tunnel
    const tunnelSocket = net.connect({
      host: '127.0.0.1',
      port: this.tunnelPort,
      family: 4
    });

    tunnelSocket.on('connect', () => {
      // Establish SOCKS5 connection first
      const socksConnect = this.buildSocks5ConnectRequest(targetHost, targetPort);
      tunnelSocket.write(socksConnect);

      let responseBuffer = Buffer.alloc(0);

      const handleResponse = (data) => {
        responseBuffer = Buffer.concat([responseBuffer, data]);

        if (responseBuffer.length >= 10) {
          tunnelSocket.removeListener('data', handleResponse);

          if (responseBuffer[1] === 0) {
            // SOCKS5 connection successful, send HTTP request
            const requestLines = [`${method} ${path} ${protocol}`];
            for (let i = 1; i < headers.length; i++) {
              requestLines.push(headers[i]);
            }
            const request = requestLines.join('\r\n') + '\r\n\r\n';
            tunnelSocket.write(request);

            if (body.length > 0) {
              tunnelSocket.write(body);
            }

            tunnelSocket.pipe(socket);
            this.emit('connection', { host: targetHost, port: targetPort });
          } else {
            socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
            socket.destroy();
          }
        }
      };

      tunnelSocket.on('data', handleResponse);
    });

    tunnelSocket.on('error', (err) => {
      console.error(`[HTTP-Proxy] Tunnel connection error:`, err.message);
      socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    });

    tunnelSocket.on('close', () => {
      socket.destroy();
    });

    socket.on('close', () => {
      tunnelSocket.destroy();
    });
  }

  /**
   * Build SOCKS5 connect request for tunneling
   */
  buildSocks5ConnectRequest(host, port) {
    const isIPv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host);

    if (isIPv4) {
      const parts = host.split('.').map(Number);
      const buffer = Buffer.alloc(10);
      buffer[0] = 5;
      buffer[1] = 1;
      buffer[2] = 0;
      buffer[3] = 1;
      buffer[4] = parts[0];
      buffer[5] = parts[1];
      buffer[6] = parts[2];
      buffer[7] = parts[3];
      buffer.writeUInt16BE(port, 8);
      return buffer;
    } else {
      const hostBuffer = Buffer.from(host, 'utf8');
      const buffer = Buffer.alloc(7 + hostBuffer.length);
      buffer[0] = 5;
      buffer[1] = 1;
      buffer[2] = 0;
      buffer[3] = 3;
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

module.exports = HttpProxy;
