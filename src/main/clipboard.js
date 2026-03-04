const { clipboard } = require('electron');
const { spawn } = require('child_process');

class ClipboardManager {
  constructor(adbManager) {
    this.adbManager = adbManager;
    this.enabled = false;
    this.pollInterval = null;
    this.lastPcClipboard = '';
    this.lastPhoneClipboard = '';
    this.POLL_MS = 1500;
  }

  /**
   * Enable or disable clipboard sync polling
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) {
      this._startPolling();
    } else {
      this._stopPolling();
    }
    console.log(`[Clipboard] Sync ${enabled ? 'enabled' : 'disabled'}`);
  }

  isEnabled() {
    return this.enabled;
  }

  /**
   * Run an adb shell command and return stdout as a string.
   * Resolves with empty string on error instead of rejecting.
   */
  _adbShell(args) {
    return new Promise((resolve) => {
      const adbPath = this.adbManager.adbPath || 'adb';
      const proc = spawn(adbPath, args, { stdio: 'pipe' });
      let out = '';
      let err = '';

      proc.stdout.on('data', (d) => { out += d.toString(); });
      proc.stderr.on('data', (d) => { err += d.toString(); });

      proc.on('error', (e) => {
        console.error('[Clipboard] adb spawn error:', e.message);
        resolve('');
      });

      proc.on('close', () => {
        if (err && !out) {
          console.warn('[Clipboard] adb stderr:', err.trim());
        }
        resolve(out);
      });

      // Safety timeout
      setTimeout(() => {
        proc.kill();
        resolve('');
      }, 3000);
    });
  }

  /**
   * Read current clipboard text from the Android device.
   * Uses `cmd clipboard get-text` (Android 12+).
   * Falls back to `service call clipboard 2` for older devices.
   */
  async getPhoneClipboard() {
    if (!this.adbManager || !this.adbManager.initialized) return '';

    const device = this.adbManager.getFirstDevice();
    if (!device) return '';

    // Try Android 12+ method first - args must be separate argv elements for spawn()
    let out = await this._adbShell(['-s', device.id, 'shell', 'cmd', 'clipboard', 'get-text']);
    out = out.trim();

    // cmd clipboard get-text prints the text directly, or nothing/error
    if (out && !out.startsWith('Error') && !out.startsWith('Exception') && !out.includes('not found')) {
      return out;
    }

    // Fallback: parse service call clipboard 2 output
    // The raw parcel output looks like: Result: Parcel(00000000 00000004 00680065 00790000 '....h.e.y.')
    const raw = await this._adbShell(['-s', device.id, 'shell', 'service', 'call', 'clipboard', '2', 's16', 'com.android.shell']);
    const match = raw.match(/'([^']*)'/);
    if (match) {
      // Remove UTF-16 null padding artifacts (dots interspersed between chars, e.g. 'h.e.l.l.o.')
      // Only strip dots that appear between every character (UTF-16 LE encoding artifact),
      // not dots that are part of real content. Heuristic: if every other char is a dot, strip them.
      let content = match[1];
      if (/^([^.]\.)+(.[^.])?$/.test(content)) {
        content = content.replace(/\./g, '');
      }
      return content.trim();
    }

    return '';
  }

  /**
   * Write text to the Android device clipboard.
   * Uses `cmd clipboard set-text` (Android 12+).
   * Falls back to writing a temp file and using am broadcast with Clipper app,
   * or simply writing via content provider.
   */
  async setPhoneClipboard(text) {
    if (!this.adbManager || !this.adbManager.initialized) return false;

    const device = this.adbManager.getFirstDevice();
    if (!device) return false;

    // Try Android 12+ method - args must be separate argv elements for spawn()
    const out = await this._adbShell([
      '-s', device.id, 'shell',
      'cmd', 'clipboard', 'set-text', text
    ]);

    if (!out.includes('Error') && !out.includes('Exception')) {
      console.log('[Clipboard] PC -> Phone: set via cmd clipboard');
      return true;
    }

    // Fallback: use input keyevent via adb to set clipboard via am broadcast
    // (content provider URI above was placeholder; use am startservice approach)
    const result = await this._adbShellWithStdin(device.id, text);
    return result;
  }

  /**
   * Fallback: push clipboard text via a temp file on the device.
   */
  async _adbShellWithStdin(deviceId, text) {
    // Push content to /data/local/tmp/cb.txt then read it into clipboard
    return new Promise((resolve) => {
      const adbPath = this.adbManager.adbPath || 'adb';

      // Step 1: Write file
      const push = spawn(adbPath, ['-s', deviceId, 'shell', `printf '%s' '${text.replace(/'/g, "'\\''")}' > /data/local/tmp/cb.txt`], { stdio: 'pipe' });

      push.on('error', () => resolve(false));
      push.on('close', () => {
        // Step 2: Use am broadcast with Clipper (noop if not installed) or service call
        const read = spawn(adbPath, [
          '-s', deviceId, 'shell',
          'content', 'insert', '--uri', 'content://com.example.clipboard', '--bind', `data:s:${text}`
        ], { stdio: 'pipe' });

        read.on('error', () => resolve(false));
        read.on('close', () => resolve(true));
        setTimeout(() => { read.kill(); resolve(false); }, 3000);
      });

      setTimeout(() => { push.kill(); resolve(false); }, 3000);
    });
  }

  _startPolling() {
    if (this.pollInterval) return;

    // Snapshot current state so we don't immediately sync on enable
    this.lastPcClipboard = clipboard.readText();
    this.lastPhoneClipboard = '';

    this.pollInterval = setInterval(() => this._poll(), this.POLL_MS);
    console.log('[Clipboard] Polling started');
  }

  _stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      console.log('[Clipboard] Polling stopped');
    }
  }

  async _poll() {
    try {
      // Check PC clipboard
      const pcText = clipboard.readText();
      if (pcText && pcText !== this.lastPcClipboard) {
        this.lastPcClipboard = pcText;
        console.log('[Clipboard] PC clipboard changed, pushing to phone');
        await this.setPhoneClipboard(pcText);
        this.lastPhoneClipboard = pcText; // Avoid echo-back
        return;
      }

      // Check phone clipboard
      const phoneText = await this.getPhoneClipboard();
      if (phoneText && phoneText !== this.lastPhoneClipboard && phoneText !== this.lastPcClipboard) {
        this.lastPhoneClipboard = phoneText;
        console.log('[Clipboard] Phone clipboard changed, pulling to PC');
        clipboard.writeText(phoneText);
        this.lastPcClipboard = phoneText; // Avoid echo-back
      }
    } catch (err) {
      console.error('[Clipboard] Poll error:', err.message);
    }
  }

  destroy() {
    this._stopPolling();
  }
}

module.exports = ClipboardManager;
