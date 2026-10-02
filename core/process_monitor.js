// FrameGit Core - Creative NLE Process Lifecycle Monitor
// Silently monitors running processes for Adobe Premiere Pro and DaVinci Resolve.
// Automatically awakens background IPC services on editor launch and sleeps on editor exit.

'use strict';

const { execSync } = require('node:child_process');
const { EventEmitter } = require('node:events');

const KNOWN_PROCESSES = {
  'Adobe Premiere Pro.exe': { id: 'premiere', name: 'Adobe Premiere Pro' },
  'Adobe Premiere Pro': { id: 'premiere', name: 'Adobe Premiere Pro' },
  'Resolve.exe': { id: 'resolve', name: 'DaVinci Resolve' },
  'Resolve': { id: 'resolve', name: 'DaVinci Resolve' }
};

class ProcessMonitor extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {number} [options.intervalMs=5000] Polling interval in milliseconds
   * @param {Function} [options.processListFn] Custom process listing function for testing
   */
  constructor(options = {}) {
    super();
    this.intervalMs = options.intervalMs || 5000;
    this.processListFn = options.processListFn || null;
    this.timer = null;
    this.activeProcesses = new Map(); // processName -> { id, name, pid }
    this.isWindows = process.platform === 'win32';
    this.isRunning = false;
  }

  /**
   * Start process monitoring loop.
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.poll();
    this.timer = setInterval(() => this.poll(), this.intervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  /**
   * Stop monitoring loop.
   */
  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Execute single poll cycle to query running processes.
   * @returns {Array<Object>} Currently active NLE processes
   */
  poll() {
    let runningList = [];

    try {
      if (this.processListFn) {
        runningList = this.processListFn();
      } else if (this.isWindows) {
        // Fast, reliable Windows tasklist query
        const stdout = execSync('tasklist /NH /FO CSV', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const lines = stdout.split('\n');
        for (const line of lines) {
          const parts = line.split('","');
          if (parts.length >= 2) {
            const name = parts[0].replace(/^"/, '').trim();
            const pid = parseInt(parts[1].replace(/"$/, '').trim(), 10);
            if (name && !isNaN(pid)) {
              runningList.push({ name, pid });
            }
          }
        }
      } else {
        // macOS / Linux ps query
        const stdout = execSync('ps -A -o pid,comm', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const lines = stdout.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const match = trimmed.match(/^(\d+)\s+(.+)$/);
          if (match) {
            const pid = parseInt(match[1], 10);
            const fullPath = match[2];
            const name = fullPath.split('/').pop();
            runningList.push({ name, pid });
          }
        }
      }
    } catch (_) {
      // In case tasklist / ps fails momentarily, maintain last known state safely
      return Array.from(this.activeProcesses.values());
    }

    const currentMatches = new Map();
    for (const proc of runningList) {
      const match = KNOWN_PROCESSES[proc.name];
      if (match) {
        currentMatches.set(proc.name, {
          id: match.id,
          name: match.name,
          processName: proc.name,
          pid: proc.pid
        });
      }
    }

    // Detect newly started editors
    for (const [procName, info] of currentMatches.entries()) {
      if (!this.activeProcesses.has(procName)) {
        this.activeProcesses.set(procName, info);
        this.emit('editor-started', info);
      }
    }

    // Detect closed editors
    for (const [procName, info] of this.activeProcesses.entries()) {
      if (!currentMatches.has(procName)) {
        this.activeProcesses.delete(procName);
        this.emit('editor-stopped', info);
      }
    }

    if (currentMatches.size > 0 && this.activeProcesses.size === currentMatches.size) {
      this.emit('heartbeat', Array.from(this.activeProcesses.values()));
    } else if (this.activeProcesses.size === 0) {
      this.emit('idle');
    }

    return Array.from(this.activeProcesses.values());
  }

  /**
   * Check if any video editing application is currently running.
   * @returns {boolean}
   */
  hasActiveEditors() {
    return this.activeProcesses.size > 0;
  }

  /**
   * Check if specific editor family ('premiere' or 'resolve') is running.
   * @param {'premiere'|'resolve'} family 
   * @returns {boolean}
   */
  isEditorRunning(family) {
    for (const info of this.activeProcesses.values()) {
      if (info.id === family) return true;
    }
    return false;
  }

  /**
   * Configure Windows Startup registry entry (HKCU\Software\Microsoft\Windows\CurrentVersion\Run).
   * @param {boolean} [enable=true]
   * @param {string} [appPath] Path to executable or shortcut
   * @returns {boolean}
   */
  static configureWindowsStartup(enable = true, appPath = null) {
    if (process.platform !== 'win32') return false;

    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
    const valueName = 'FrameGitDesktop';

    try {
      if (enable) {
        const exe = appPath || process.execPath;
        const cmd = `reg add "${key}" /v "${valueName}" /t REG_SZ /d "\\"${exe}\\" --minimized" /f`;
        execSync(cmd, { stdio: 'ignore' });
        return true;
      } else {
        const cmd = `reg delete "${key}" /v "${valueName}" /f`;
        execSync(cmd, { stdio: 'ignore' });
        return true;
      }
    } catch (_) {
      return false;
    }
  }

  /**
   * Check if Windows Startup registry entry exists.
   * @returns {boolean}
   */
  static isWindowsStartupEnabled() {
    if (process.platform !== 'win32') return false;
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
    const valueName = 'FrameGitDesktop';

    try {
      const out = execSync(`reg query "${key}" /v "${valueName}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return out.includes(valueName);
    } catch (_) {
      return false;
    }
  }
}

module.exports = { ProcessMonitor, KNOWN_PROCESSES };
