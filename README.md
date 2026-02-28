# ADB Proxy Browser

A customized Electron browser that routes traffic through ADB tunnel to your phone's proxy (Clash, Shadowsocks, V2Ray, etc.).

## Features

- Automatic Android device detection via ADB
- One-click connection to phone's proxy
- Support for SOCKS5 and HTTP proxy protocols
- Customizable ports
- System tray integration
- Cross-platform support (Windows, macOS, Linux)

## Prerequisites

1. **Android Device**
   - USB debugging enabled
   - Proxy app running (Clash, Shadowsocks, V2Ray, etc.)
   - "Allow LAN connections" enabled in proxy app

2. **Computer**
   - USB drivers for your Android device
   - On Windows, you may need to install USB drivers using [Zadig](https://zadig.akeo.ie/) for libusb support

## Installation

### Download Pre-built Binaries

Download from [GitHub Releases](https://github.com/Bahtya/adb-proxy-browser/releases)

### Build from Source

```bash
# Clone the repository
git clone https://github.com/Bahtya/adb-proxy-browser.git
cd adb-proxy-browser

# Install dependencies
npm install

# Run in development mode
npm start

# Build for production
npm run build
```

## Usage

1. Connect your Android phone via USB
2. Enable USB debugging on your phone
3. Start your proxy app (Clash) on the phone
4. Make sure "Allow LAN connections" is enabled
5. Launch ADB Proxy Browser
6. Click "Connect Phone"
7. Start browsing!

## Configuration

- **Proxy Port**: Local port for the browser (default: 7890)
- **Phone Proxy Port**: Port your phone's proxy is listening on (default: 7890)
- **Proxy Type**: SOCKS5 or HTTP (default: SOCKS5)

## Architecture

```
Browser -> Local Proxy (7890) -> ADB Tunnel (7891) -> Phone Proxy (7890) -> Internet
```

## Tech Stack

- Electron
- adbkit (ADB protocol implementation)
- usb (libusb bindings)
- Native SOCKS5/HTTP proxy implementation

## License

MIT

## Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.
