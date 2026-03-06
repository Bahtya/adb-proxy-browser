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

function getAdbExecutableName() {
  return process.platform === 'win32' ? 'adb.exe' : 'adb';
}

function getDownloadedPlatformToolsDir() {
  return path.join(os.homedir(), '.adb-proxy-browser', 'platform-tools');
}

function getDevBundledPlatformToolsDir() {
  return path.resolve(__dirname, '../../../bundled-tools/platform-tools');
}

function getPackagedPlatformToolsDir() {
  if (!process.resourcesPath) {
    return null;
  }
  return path.join(process.resourcesPath, 'platform-tools');
}

function getPlatformToolsDirCandidates() {
  const candidates = [];
  const packagedDir = getPackagedPlatformToolsDir();
  const devBundledDir = getDevBundledPlatformToolsDir();
  const downloadedDir = getDownloadedPlatformToolsDir();

  if (packagedDir) candidates.push(packagedDir);
  candidates.push(devBundledDir);
  candidates.push(downloadedDir);

  return candidates;
}

function getExistingPlatformToolsDir() {
  return getPlatformToolsDirCandidates().find((dir) => fs.existsSync(path.join(dir, getAdbExecutableName()))) || null;
}

// Backward-compatible name used by the rest of the app.
function getPlatformToolsDir() {
  return getExistingPlatformToolsDir() || getDownloadedPlatformToolsDir();
}

// Get adb path
function getBundledAdbPath() {
  return path.join(getPlatformToolsDir(), getAdbExecutableName());
}

// Check if bundled adb exists
function hasBundledAdb() {
  return !!getExistingPlatformToolsDir();
}

// Download file
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`[ADB] Downloading from ${url}`);
    const file = fs.createWriteStream(dest);

    const request = (nextUrl) => {
      https.get(nextUrl, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
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
          const percent = totalSize ? Math.round((downloaded / totalSize) * 100) : 0;
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

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    let cmd;
    if (process.platform === 'win32') {
      cmd = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${path.dirname(destDir)}' -Force"`;
    } else {
      cmd = `unzip -o "${zipPath}" -d "${path.dirname(destDir)}"`;
    }

    exec(cmd, (error) => {
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

function ensureAdbExecutable(targetDir) {
  if (process.platform === 'win32') {
    return;
  }

  const adbPath = path.join(targetDir, getAdbExecutableName());
  if (fs.existsSync(adbPath)) {
    fs.chmodSync(adbPath, '755');
  }
}

function ensureAdbExists(targetDir) {
  const adbPath = path.join(targetDir, getAdbExecutableName());
  if (!fs.existsSync(adbPath)) {
    throw new Error(`ADB binary not found after extraction: ${adbPath}`);
  }
  return adbPath;
}

// Download and setup platform tools
async function downloadPlatformTools(onProgress, options = {}) {
  const url = PLATFORM_TOOLS_URLS[process.platform];
  if (!url) {
    throw new Error(`Unsupported platform: ${process.platform}`);
  }

  const platformToolsDir = options.targetDir || getDownloadedPlatformToolsDir();
  const zipPath = options.zipPath || path.join(os.tmpdir(), `platform-tools-${process.platform}.zip`);

  try {
    if (onProgress) onProgress('downloading', 0);

    await downloadFile(url, zipPath);
    if (onProgress) onProgress('extracting', 50);

    await extractZip(zipPath, platformToolsDir);
    ensureAdbExecutable(platformToolsDir);
    const adbPath = ensureAdbExists(platformToolsDir);
    if (onProgress) onProgress('complete', 100);

    fs.unlinkSync(zipPath);

    return adbPath;
  } catch (err) {
    try {
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    } catch (e) {}
    throw err;
  }
}

module.exports = {
  getPlatformToolsDir,
  getDownloadedPlatformToolsDir,
  getDevBundledPlatformToolsDir,
  getPackagedPlatformToolsDir,
  getBundledAdbPath,
  hasBundledAdb,
  downloadPlatformTools
};
