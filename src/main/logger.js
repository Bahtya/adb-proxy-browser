const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');

class Logger {
  constructor() {
    this.logDir = path.join(app.getPath('userData'), 'logs');
    this.logFile = path.join(this.logDir, 'app.log');
    this.maxLogSize = 5 * 1024 * 1024; // 5MB max log size
    this.initialized = false;
  }

  /**
   * Initialize logger - create log directory if needed
   */
  init() {
    if (this.initialized) return;

    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      this.initialized = true;
      this.info('[Logger] Log file initialized:', this.logFile);
    } catch (err) {
      console.error('[Logger] Failed to initialize log directory:', err.message);
    }
  }

  /**
   * Format timestamp for log entries
   */
  getTimestamp() {
    return new Date().toISOString();
  }

  /**
   * Write log entry to file
   */
  writeToFile(level, tag, message, ...args) {
    if (!this.initialized) {
      this.init();
    }

    try {
      const timestamp = this.getTimestamp();
      const argsStr = args.length > 0 ? ' ' + args.map(a => {
        if (typeof a === 'object') {
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        }
        return String(a);
      }).join(' ') : '';
      const logLine = `[${timestamp}] [${level}] [${tag}] ${message}${argsStr}\n`;

      // Check log file size and rotate if needed
      if (fs.existsSync(this.logFile)) {
        const stats = fs.statSync(this.logFile);
        if (stats.size > this.maxLogSize) {
          this.rotateLog();
        }
      }

      fs.appendFileSync(this.logFile, logLine, 'utf8');
    } catch (err) {
      console.error('[Logger] Failed to write to log file:', err.message);
    }
  }

  /**
   * Rotate log file when it gets too large
   */
  rotateLog() {
    try {
      const rotatedFile = path.join(this.logDir, `app-${Date.now()}.log`);
      if (fs.existsSync(this.logFile)) {
        fs.renameSync(this.logFile, rotatedFile);
      }
      // Clean up old log files (keep only last 3)
      const logFiles = fs.readdirSync(this.logDir)
        .filter(f => f.startsWith('app-') && f.endsWith('.log'))
        .sort()
        .slice(0, -3);
      logFiles.forEach(f => {
        fs.unlinkSync(path.join(this.logDir, f));
      });
    } catch (err) {
      console.error('[Logger] Failed to rotate log:', err.message);
    }
  }

  /**
   * Log info level
   */
  info(tag, message, ...args) {
    console.log(`[${tag}] ${message}`, ...args);
    this.writeToFile('INFO', tag, message, ...args);
  }

  /**
   * Log warning level
   */
  warn(tag, message, ...args) {
    console.warn(`[${tag}] ${message}`, ...args);
    this.writeToFile('WARN', tag, message, ...args);
  }

  /**
   * Log error level
   */
  error(tag, message, ...args) {
    console.error(`[${tag}] ${message}`, ...args);
    this.writeToFile('ERROR', tag, message, ...args);
  }

  /**
   * Log debug level
   */
  debug(tag, message, ...args) {
    console.log(`[${tag}] [DEBUG] ${message}`, ...args);
    this.writeToFile('DEBUG', tag, message, ...args);
  }

  /**
   * Get log file path
   */
  getLogPath() {
    return this.logFile;
  }

  /**
   * Get log directory path
   */
  getLogDir() {
    return this.logDir;
  }

  /**
   * Open log folder in file explorer
   */
  openLogFolder() {
    shell.openPath(this.logDir);
  }

  /**
   * Clear all log files
   */
  clearLogs() {
    try {
      if (fs.existsSync(this.logDir)) {
        const files = fs.readdirSync(this.logDir).filter(f => f.endsWith('.log'));
        files.forEach(f => {
          fs.unlinkSync(path.join(this.logDir, f));
        });
      }
      this.info('[Logger] Logs cleared');
      return true;
    } catch (err) {
      this.error('[Logger] Failed to clear logs:', err.message);
      return false;
    }
  }

  /**
   * Read recent log entries
   */
  readLogs(lines = 100) {
    try {
      if (!fs.existsSync(this.logFile)) {
        return 'No log file exists yet.';
      }
      const content = fs.readFileSync(this.logFile, 'utf8');
      const allLines = content.split('\n').filter(l => l.trim());
      return allLines.slice(-lines).join('\n');
    } catch (err) {
      return `Error reading logs: ${err.message}`;
    }
  }
}

// Singleton instance
let loggerInstance = null;

function getLogger() {
  if (!loggerInstance) {
    loggerInstance = new Logger();
  }
  return loggerInstance;
}

module.exports = {
  Logger,
  getLogger
};
