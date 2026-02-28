const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

class TrayManager {
  constructor(mainWindow, connectionManager) {
    this.mainWindow = mainWindow;
    this.connectionManager = connectionManager;
    this.tray = null;
  }

  /**
   * Create system tray icon
   */
  create() {
    // Create a simple icon (we'll use a default or create one)
    const iconPath = path.join(__dirname, '../../assets/icon.png');
    let icon;

    try {
      icon = nativeImage.createFromPath(iconPath);
      if (icon.isEmpty()) {
        // Create a simple 16x16 icon if file doesn't exist
        icon = nativeImage.createEmpty();
      }
    } catch (err) {
      icon = nativeImage.createEmpty();
    }

    this.tray = new Tray(icon);
    this.tray.setToolTip('ADB Proxy Browser');

    this.updateMenu();
  }

  /**
   * Update tray menu
   */
  updateMenu() {
    const status = this.connectionManager.getStatus();
    const connected = status.connected;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: connected ? 'Connected' : 'Disconnected',
        enabled: false,
        icon: this.getStatusIcon(connected)
      },
      { type: 'separator' },
      {
        label: connected ? 'Disconnect' : 'Connect',
        click: async () => {
          if (connected) {
            await this.connectionManager.disconnect();
          } else {
            await this.connectionManager.connect();
          }
          this.updateMenu();
        }
      },
      {
        label: 'Show Window',
        click: () => {
          if (this.mainWindow) {
            this.mainWindow.show();
            this.mainWindow.focus();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          this.connectionManager.disconnect().finally(() => {
            app.quit();
          });
        }
      }
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  /**
   * Get status icon (text-based for now)
   */
  getStatusIcon(connected) {
    // Electron doesn't support text icons directly
    // In production, you would use actual icon files
    return nativeImage.createEmpty();
  }

  /**
   * Update tooltip
   */
  updateTooltip(text) {
    if (this.tray) {
      this.tray.setToolTip(text);
    }
  }

  /**
   * Destroy tray
   */
  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

module.exports = TrayManager;
