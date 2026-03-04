const { clipboard } = require('electron');

class ClipboardManager {
  constructor(adbManager) {
    this.adbManager = adbManager;
    this.enabled = false;
    this.pollInterval = null;
    this.lastPcClipboard = '';
    this.lastPhoneClipboard = '';
    this.POLL_MS = 1500;
    this._polling = false; // guard against overlapping polls
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
   * Run a shell command on the device via adbkit client.shell().
   * Returns stdout as a string. Resolves with empty string on error.
   */
  async _shellCmd(deviceId, command) {
    try {
      const client = this.adbManager.client;
      if (!client) {
        console.warn('[Clipboard] No adbkit client available');
        return '';
      }

      console.log(`[Clipboard] shell: ${command}`);
      const stream = await client.shell(deviceId, command);

      // Read stream to string with timeout
      return await new Promise((resolve) => {
        let out = '';
        const timeout = setTimeout(() => {
          stream.destroy();
          console.warn('[Clipboard] shell command timed out');
          resolve(out);
        }, 3000);

        stream.on('data', (chunk) => { out += chunk.toString(); });
        stream.on('end', () => {
          clearTimeout(timeout);
          resolve(out);
        });
        stream.on('error', (err) => {
          clearTimeout(timeout);
          console.warn('[Clipboard] shell stream error:', err.message);
          resolve(out);
        });
      });
    } catch (err) {
      console.error('[Clipboard] shell error:', err.message);
      return '';
    }
  }

  /**
   * Read current clipboard text from the Android device.
   * Uses `cmd clipboard get-text` (Android 12+).
   * Falls back to `service call clipboard 2` for older devices.
   */
  async getPhoneClipboard() {
    if (!this.adbManager || !this.adbManager.client) {
      console.log('[Clipboard] getPhone: adbManager not ready');
      return '';
    }

    const device = this.adbManager.getFirstDevice();
    if (!device) {
      console.log('[Clipboard] getPhone: no device');
      return '';
    }

    // Try Android 12+ method first
    let out = await this._shellCmd(device.id, 'cmd clipboard get-text');
    out = out.trim();

    // cmd clipboard get-text prints the text directly, or nothing/error
    if (out && !out.startsWith('Error') && !out.startsWith('Exception') && !out.includes('not found')) {
      console.log(`[Clipboard] getPhone OK: "${out.substring(0, 50)}${out.length > 50 ? '...' : ''}"`);
      return out;
    }

    // Fallback: parse service call clipboard 2 output
    const raw = await this._shellCmd(device.id, 'service call clipboard 2 s16 com.android.shell');
    const match = raw.match(/'([^']*)'/);
    if (match) {
      let content = match[1];
      // Only strip dots if they appear in the UTF-16 alternating pattern
      if (/^([^.]\.)+(.[^.])?$/.test(content)) {
        content = content.replace(/\./g, '');
      }
      console.log(`[Clipboard] getPhone fallback OK: "${content.substring(0, 50)}"`);
      return content.trim();
    }

    console.log('[Clipboard] getPhone: no text found');
    return '';
  }

  /**
   * Write text to the Android device clipboard.
   * Uses `cmd clipboard set-text` (Android 12+).
   * Falls back to `am broadcast` with escaped text.
   */
  async setPhoneClipboard(text) {
    if (!this.adbManager || !this.adbManager.client) return false;

    const device = this.adbManager.getFirstDevice();
    if (!device) return false;

    // Escape single quotes for shell
    const escaped = text.replace(/'/g, "'\\''");

    // Try Android 12+ method
    const out = await this._shellCmd(device.id, `cmd clipboard set-text '${escaped}'`);

    if (!out.includes('Error') && !out.includes('Exception')) {
      console.log('[Clipboard] PC -> Phone: set via cmd clipboard');
      return true;
    }

    // Fallback: use am broadcast with intent extra
    const fallbackOut = await this._shellCmd(device.id,
      `am broadcast -a clipper.set -e text '${escaped}' 2>/dev/null; ` +
      `input keyevent 0 2>/dev/null`
    );
    console.log('[Clipboard] PC -> Phone fallback:', fallbackOut.trim() || '(no output)');
    return true;
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
    // Prevent overlapping polls (adb commands can take >1.5s)
    if (this._polling) return;
    this._polling = true;

    try {
      // Check PC clipboard
      const pcText = clipboard.readText();
      if (pcText && pcText !== this.lastPcClipboard) {
        this.lastPcClipboard = pcText;
        console.log('[Clipboard] PC clipboard changed, pushing to phone');
        await this.setPhoneClipboard(pcText);
        this.lastPhoneClipboard = pcText; // Avoid echo-back
        this._polling = false;
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

    this._polling = false;
  }

  destroy() {
    this._stopPolling();
  }
}

module.exports = ClipboardManager;
