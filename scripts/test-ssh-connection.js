/**
 * Standalone SSH connection test
 * Usage: node scripts/test-ssh-connection.js [host] [port] [username] [password]
 */

const net = require('net');
const { Client: SSH2Client } = require('ssh2');

const config = {
  host: process.argv[2] || '127.0.0.1',
  port: parseInt(process.argv[3] || '22', 10),
  username: process.argv[4] || '15323',
  password: process.argv[5] || 'test'
};

console.log('='.repeat(50));
console.log('SSH Connection Test');
console.log('='.repeat(50));
console.log('Config:', { ...config, password: '***' });
console.log('');

async function testTcpConnection(host, port) {
  return new Promise((resolve) => {
    console.log(`[Step 1] Testing TCP connection to ${host}:${port}...`);
    const socket = new net.Socket();
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ success: false, error: 'timeout' });
    }, 5000);

    socket.on('connect', () => {
      clearTimeout(timeout);
      socket.destroy();
      console.log('[Step 1] ✓ TCP connection successful\n');
      resolve({ success: true });
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      console.log(`[Step 1] ✗ TCP connection failed: ${err.message}\n`);
      resolve({ success: false, error: err.code || err.message });
    });

    socket.connect(port, host);
  });
}

async function testSshConnection() {
  // Step 1: Test TCP
  const tcpResult = await testTcpConnection(config.host, config.port);
  if (!tcpResult.success) {
    console.log('ERROR: Cannot reach SSH port. Make sure SSH server is running.');
    process.exit(1);
  }

  // Step 2: Test SSH
  console.log('[Step 2] Testing SSH connection...');
  return new Promise((resolve, reject) => {
    const conn = new SSH2Client();
    let resolved = false;
    const startTime = Date.now();

    conn.on('ready', () => {
      const elapsed = Date.now() - startTime;
      console.log(`[Step 2] ✓ SSH connection ready (${elapsed}ms)\n`);

      // Request shell
      console.log('[Step 3] Requesting shell...');
      conn.shell({
        term: 'xterm-256color',
        cols: 80,
        rows: 24
      }, (err, stream) => {
        if (err) {
          console.log(`[Step 3] ✗ Failed to create shell: ${err.message}`);
          conn.end();
          if (!resolved) {
            resolved = true;
            reject(err);
          }
          return;
        }

        console.log('[Step 3] ✓ Shell created successfully\n');
        console.log('-'.repeat(50));
        console.log('SSH Test PASSED - Connection working!');
        console.log('-'.repeat(50));

        // Handle stream data
        stream.on('data', (data) => {
          console.log('[SSH DATA]', data.toString('utf8'));
        });

        stream.on('close', () => {
          console.log('[Stream] Closed');
          conn.end();
          if (!resolved) {
            resolved = true;
            resolve(true);
          }
        });

        stream.stderr.on('data', (data) => {
          console.log('[SSH STDERR]', data.toString());
        });

        // Send a test command
        console.log('\nSending test command: echo "HELLO_FROM_TEST"\n');
        stream.write('echo "HELLO_FROM_TEST"\n');

        // Close after 3 seconds
        setTimeout(() => {
          console.log('\nClosing connection after test...');
          stream.close();
          conn.end();
          if (!resolved) {
            resolved = true;
            resolve(true);
          }
        }, 3000);
      });
    });

    conn.on('error', (err) => {
      const elapsed = Date.now() - startTime;
      console.log(`[Step 2] ✗ SSH connection error (${elapsed}ms): ${err.message}`);
      console.log('  Error level:', err.level);
      console.log('  Error code:', err.code);

      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    conn.on('close', () => {
      console.log('[Connection] Closed');
    });

    // Connect
    console.log(`[Step 2] Connecting to ${config.host}:${config.port}...`);
    console.log(`[Step 2] Username: ${config.username}`);
    console.log(`[Step 2] Password: ${config.password}`);

    conn.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      tryKeyboard: true,
      readyTimeout: 15000
    });

    // Handle keyboard-interactive
    conn.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
      console.log('[Auth] Keyboard-interactive:', name, instructions);
      console.log('[Auth] Prompts:', prompts.length);
      // Answer all prompts with the password
      finish(prompts.map(() => config.password));
    });

    // Timeout
    setTimeout(() => {
      if (!resolved) {
        console.log('[Timeout] Connection timeout after 20 seconds');
        resolved = true;
        conn.end();
        reject(new Error('Connection timeout'));
      }
    }, 20000);
  });
}

// Run test
testSshConnection()
  .then(() => {
    console.log('\nTest completed successfully!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nTest failed:', err.message);
    process.exit(1);
  });
