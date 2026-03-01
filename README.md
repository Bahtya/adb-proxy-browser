# ADB Proxy Browser

A customized Electron browser that routes traffic through an ADB tunnel to your Android phone's proxy (Clash, Shadowsocks, V2Ray, etc.).

## Features

- Automatic Android device detection via ADB (no external `adb` binary required)
- One-click connection to phone's proxy
- Built-in browser with tab support
- SOCKS5 and HTTP proxy protocols
- System tray integration
- Cross-platform: Windows, macOS, Linux

## Architecture

```
Browser → Local Proxy (7890) → ADB Tunnel → Phone Proxy (7890) → Internet
```

The app sets up an ADB port forward and exposes a local proxy endpoint. Any application on your PC can use this endpoint to route traffic through your phone.

---

## Prerequisites

**Android phone:**
- USB debugging enabled (Developer Options → USB Debugging)
- A proxy app running: [Clash for Android](https://github.com/Kr328/ClashForAndroid), Shadowsocks, V2Ray, etc.
- "Allow connections from LAN" enabled in the proxy app

**Windows PC:**
- USB drivers for your device. If the device isn't recognized, install a WinUSB driver using [Zadig](https://zadig.akeo.ie/)

---

## Installation

### Pre-built installer

Download from [GitHub Releases](https://github.com/Bahtya/adb-proxy-browser/releases).

### Build from source

```bash
git clone https://github.com/Bahtya/adb-proxy-browser.git
cd adb-proxy-browser
npm install
npm start          # development
npm run build:win  # build Windows installer
```

---

## Quick Start (built-in browser)

1. Connect your phone via USB
2. Start your proxy app on the phone and enable "Allow LAN connections"
3. Launch ADB Proxy Browser
4. Click **Connect Phone** on the welcome screen
5. Type a URL in the address bar and press Enter

---

## Using the forwarded port with other applications

When you click **Connect Phone**, the app creates a local proxy on `127.0.0.1:7890` (default port). Any other program on your PC can use this proxy — you don't have to use the built-in browser.

### Default proxy address

| Type | Address |
|------|---------|
| HTTP proxy | `http://127.0.0.1:7890` |
| SOCKS5 proxy | `socks5://127.0.0.1:7890` |

Switch between HTTP and SOCKS5 in the Settings panel inside the app. The port can also be changed there.

---

### System-wide proxy (Windows)

**Settings → Network & Internet → Proxy → Manual proxy setup**

- Toggle "Use a proxy server" ON
- Address: `127.0.0.1`
- Port: `7890`
- Click Save

All Windows apps that respect system proxy settings (Edge, Chrome, etc.) will now route through your phone.

---

### Browser — manual proxy extension

For per-browser control without changing system settings, use [Proxy SwitchyOmega](https://github.com/FelisCatus/SwitchyOmega) (Chrome/Edge/Firefox):

1. Install the extension
2. Create a new profile → Proxy
3. Protocol: `SOCKS5` (or `HTTP`)
4. Server: `127.0.0.1`, Port: `7890`
5. Apply the profile

---

### curl

```bash
# HTTP proxy
curl -x http://127.0.0.1:7890 https://example.com

# SOCKS5 proxy
curl --socks5 127.0.0.1:7890 https://example.com
```

---

### Python `requests`

```python
import requests

proxies = {
    "http":  "socks5://127.0.0.1:7890",
    "https": "socks5://127.0.0.1:7890",
}
r = requests.get("https://example.com", proxies=proxies)
print(r.text)
```

Install `requests` with SOCKS support: `pip install requests[socks]`

---

### Node.js

```js
const { HttpsProxyAgent } = require("https-proxy-agent");
const https = require("https");

const agent = new HttpsProxyAgent("http://127.0.0.1:7890");
https.get("https://example.com", { agent }, (res) => {
  res.pipe(process.stdout);
});
```

---

### git

```bash
git config --global http.proxy  http://127.0.0.1:7890
git config --global https.proxy http://127.0.0.1:7890

# Remove when done
git config --global --unset http.proxy
git config --global --unset https.proxy
```

---

### npm / pnpm / yarn

```bash
npm config set proxy http://127.0.0.1:7890
npm config set https-proxy http://127.0.0.1:7890

# Remove
npm config delete proxy
npm config delete https-proxy
```

---

### pip

```bash
pip install somepackage --proxy http://127.0.0.1:7890
```

Or set an environment variable:

```bash
# Windows (cmd)
set HTTPS_PROXY=http://127.0.0.1:7890

# Windows (PowerShell)
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
```

---

## Configuration

Open **Settings** (gear icon, top-right) to change:

| Setting | Default | Description |
|---------|---------|-------------|
| Proxy Port | 7890 | Local port your PC connects to |
| Phone Proxy Port | 7890 | Port Clash/proxy listens on the phone |
| Proxy Type | HTTP | HTTP or SOCKS5 |

---

## Troubleshooting

**Device not detected**
- Check USB cable and try a different port
- On Windows, run Zadig to install the WinUSB driver for your device
- Enable USB debugging and accept the RSA fingerprint prompt on the phone

**Connected but no internet**
- Confirm "Allow LAN connections" is enabled in your phone's proxy app
- Verify the Phone Proxy Port matches what the proxy app is actually using

**Port already in use**
- Change the Proxy Port in Settings to any free port (e.g. 7891) and update external apps accordingly

---

## Tech Stack

- Electron 28
- adbkit (ADB protocol, no external binary needed)
- usb (libusb bindings)
- Native SOCKS5/HTTP proxy implementation

## License

MIT

## Contributing

Pull requests are welcome! For major changes, please open an issue first.
