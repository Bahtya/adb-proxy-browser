const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');

// Platform Tools download URLs
const PLATFORM_TOOLS_URLS = {
  win32: 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip',
  darwin: 'https://dl.google.com/android/repository/platform-tools-latest-darwin.zip',
  linux: 'https://dl.google.com/android/repository/platform-tools-latest-linux.zip'
};

// Get platform tools directory
function getPlatformToolsDir() {
  return path.join(os.homedir(), '.adb-proxy-browser', 'platform-tools');
}

// Get adb path
function getBundledAdbPath() {
  const dir = getPlatformToolsDir();
  const adbName = process.platform === 'win32' ? 'adb.exe' : 'adb';
  return path.join(dir, adbName);
}

// Check if bundled adb exists
function hasBundledAdb() {
  const adbPath = getBundledAdbPath();
  return fs.existsSync(adbPath);
}

// Download file
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`[ADB] Downloading from ${url}`);
    const file = fs.createWriteStream(dest);

    const request = (url) => {
      https.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Follow redirect
          request(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed: ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloaded = 0;

        response.on('data', (chunk) => {
          downloaded += chunk.length;
          const percent = Math.round((downloaded / totalSize) * 100);
          process.stdout.write(`\r[ADB] Downloading: ${percent}%`);
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          console.log('\n[ADB] Download complete');
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    };

    request(url);
  });
}

// Extract zip file (using built-in unzip on Windows, or unzip command)
async function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    console.log(`[ADB] Extracting ${zipPath} to ${destDir}`);

    // Create dest directory
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    let cmd;
    if (process.platform === 'win32') {
      // Use PowerShell to extract
      cmd = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${path.dirname(destDir)}' -Force"`;
    } else {
      cmd = `unzip -o "${zipPath}" -d "${path.dirname(destDir)}"`;
    }

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error(`[ADB] Extract error: ${error.message}`);
        reject(error);
        return;
      }
      console.log('[ADB] Extraction complete');
      resolve();
    });
  });
}

// Download and setup platform tools
async function downloadPlatformTools(onProgress) {
  const url = PLATFORM_TOOLS_URLS[process.platform];
  if (!url) {
    throw new Error(`Unsupported platform: ${process.platform}`);
  }

  const platformToolsDir = getPlatformToolsDir();
  const zipPath = path.join(os.tmpdir(), 'platform-tools.zip');

  try {
    if (onProgress) onProgress('downloading', 0);

    // Download
    await downloadFile(url, zipPath);
    if (onProgress) onProgress('extracting', 50);

    // Extract
    await extractZip(zipPath, platformToolsDir);
    if (onProgress) onProgress('complete', 100);

    // Make executable on Unix
    if (process.platform !== 'win32') {
      const adbPath = getBundledAdbPath();
      fs.chmodSync(adbPath, '755');
    }

    // Cleanup
    fs.unlinkSync(zipPath);

    return getBundledAdbPath();
  } catch (err) {
    // Cleanup on error
    try {
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    } catch (e) {}
    throw err;
  }
}

module.exports = {
  getPlatformToolsDir,
  getBundledAdbPath,
  hasBundledAdb,
  downloadPlatformTools
};
