# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm install          # Install dependencies
npm start            # Run in development mode
npm run build        # Build for current platform
npm run build:win    # Build Windows installer
npm run build:mac    # Build macOS installer
npm run build:linux  # Build Linux installer
```

## Release Process

```bash
git tag v1.0.0
git push origin v1.0.0   # Triggers GitHub Actions build & release
```

## Architecture

```
Browser -> Local Proxy (7890) -> ADB Tunnel (7891) -> Phone Proxy (7890) -> Internet
```

**Port Configuration:**
- `proxyPort` (7890): Browser connects here
- `tunnelPort` (7891): ADB forwarded port to phone
- `remotePort` (7890): Phone's Clash/proxy port

**Data Flow:**
1. Browser traffic goes to local proxy server (SOCKS5/HTTP)
2. Proxy server forwards through ADB tunnel
3. ADB tunnel connects to phone's proxy (Clash)
4. Phone's proxy handles actual network requests

## Key Modules

**Main Process** (`src/main/`)
- `index.js` - Entry point, ConnectionManager orchestrates ADB + Proxy
- `adb/` - Device detection and port forwarding via adbkit
- `proxy/` - SOCKS5 and HTTP proxy servers (native Node.js net module)
- `tray.js` - System tray integration

**Renderer** (`src/renderer/`)
- Control panel UI for device status and connection

**Preload** (`src/preload/`)
- IPC bridge between renderer and main process

## IPC Channels

`adb:getDevices`, `connection:connect`, `connection:disconnect`, `connection:getStatus`, `config:get`, `config:set`, `browser:navigate`, `browser:goBack`, `browser:goForward`, `browser:refresh`

## Tech Stack

- Electron 28
- adbkit (ADB protocol, no external adb binary needed)
- usb (libusb bindings for direct USB communication)
- Native SOCKS5/HTTP proxy implementation
