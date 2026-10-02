/**
 * FrameGit Core - Background Filesystem Watcher Daemon
 * 
 * Monitors video editing workspaces for .prproj and .drp file modifications,
 * debounces disk write bursts, and automatically captures safety snapshots
 * without interrupting the video editor's workflow.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { VersionEngine } = require('./version_engine');
const { ProductionHardening } = require('./hardening');
const { wrapFsOperation } = require('./errors');

class WatcherDaemon {
  /**
   * @param {string} workspaceDir Absolute path to workspace root
   * @param {string} [projectFileName] Optional specific project file to watch
   * @param {Object} [options]
   * @param {number} [options.debounceMs=2000]
   */
  constructor(workspaceDir, projectFileName = null, options = {}) {
    this.workspaceDir = path.resolve(workspaceDir);
    this.projectFileName = projectFileName;
    this.debounceMs = options.debounceMs || 2000;
    this.framegitDir = path.join(this.workspaceDir, '.framegit');
    this.pidPath = path.join(this.framegitDir, 'daemon.pid');
    this.logPath = path.join(this.framegitDir, 'logs', 'watcher.log');

    this.fsWatcher = null;
    this.debounceTimer = null;
    this.isWatching = false;
    this.engine = null;
    this.hardening = null;
  }

  /**
   * Resolve target project file inside workspace.
   */
  resolveProjectFile() {
    if (this.projectFileName) {
      return path.join(this.workspaceDir, this.projectFileName);
    }

    // Auto-discover primary .prproj or .drp in workspace root
    const files = fs.readdirSync(this.workspaceDir);
    const candidate = files.find(f => f.endsWith('.prproj') || f.endsWith('.drp'));
    if (!candidate) {
      throw new Error(`No Premiere (.prproj) or Resolve (.drp) project file found in ${this.workspaceDir}`);
    }
    this.projectFileName = candidate;
    return path.join(this.workspaceDir, candidate);
  }

  /**
   * Get daemon execution status.
   * @returns {{running: boolean, pid: number|null}}
   */
  getStatus() {
    if (!fs.existsSync(this.pidPath)) {
      return { running: false, pid: null };
    }

    try {
      const pid = parseInt(fs.readFileSync(this.pidPath, 'utf-8').trim(), 10);
      // Check if PID is actively running
      process.kill(pid, 0);
      return { running: true, pid };
    } catch {
      // Process is dead or stale PID file
      try { fs.unlinkSync(this.pidPath); } catch (_) {}
      return { running: false, pid: null };
    }
  }

  /**
   * Log an event to .framegit/logs/watcher.log
   * @param {string} message 
   */
  log(message) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;
    const logsDir = path.dirname(this.logPath);
    if (!fs.existsSync(logsDir)) {
      wrapFsOperation(() => fs.mkdirSync(logsDir, { recursive: true }), logsDir, 'mkdir');
    }
    fs.appendFileSync(this.logPath, line, 'utf-8');
  }

  /**
   * Start watching the workspace for project modifications.
   */
  start() {
    const status = this.getStatus();
    if (status.running && status.pid !== process.pid) {
      throw new Error(`Watcher daemon is already running (PID: ${status.pid}).`);
    }

    const projPath = this.resolveProjectFile();
    this.engine = new VersionEngine(this.workspaceDir, path.basename(projPath));
    this.engine.init();

    this.hardening = new ProductionHardening(this.engine);
    this.hardening.init();

    // Record PID
    wrapFsOperation(() => fs.writeFileSync(this.pidPath, String(process.pid)), this.pidPath, 'write');
    this.isWatching = true;
    this.log(`Watcher started on project: ${path.basename(projPath)} (PID: ${process.pid})`);

    // Capture initial baseline safety snapshot
    const initialSnap = this.hardening.captureSnapshot();
    if (initialSnap) {
      this.log(`Captured initial safety snapshot: ${initialSnap.snapshotId}`);
    }

    // Set up filesystem watcher with debouncing
    this.fsWatcher = fs.watch(this.workspaceDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;

      const norm = filename.replace(/\\/g, '/');
      // Ignore internal directories, cache, and temp files
      if (
        norm.startsWith('.framegit/') ||
        norm.includes('/.framegit/') ||
        norm.includes('node_modules') ||
        norm.includes('Media Cache Files') ||
        norm.includes('Peak Files') ||
        norm.endsWith('.tmp') ||
        norm.endsWith('.bak') ||
        norm.endsWith('.test') ||
        norm.endsWith('.autosave')
      ) {
        return;
      }

      // Check if modified file is the monitored project file
      if (path.basename(norm) === path.basename(projPath)) {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);

        this.debounceTimer = setTimeout(() => {
          try {
            const snap = this.hardening.captureSnapshot();
            if (snap) {
              this.log(`Auto-snapshot captured on save: ${snap.snapshotId} (Hash: ${snap.hash.slice(0, 8)})`);
            }
          } catch (err) {
            this.log(`Auto-snapshot error: ${err.message}`);
          }
        }, this.debounceMs);
      }
    });

    return {
      started: true,
      pid: process.pid,
      projectFile: path.basename(projPath),
      workspace: this.workspaceDir
    };
  }

  /**
   * Stop the watcher daemon.
   */
  stop() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.fsWatcher) {
      this.fsWatcher.close();
      this.fsWatcher = null;
    }
    this.isWatching = false;

    const status = this.getStatus();
    if (status.running && status.pid !== process.pid) {
      try {
        process.kill(status.pid, 'SIGTERM');
      } catch (_) {}
    }

    if (fs.existsSync(this.pidPath)) {
      try { fs.unlinkSync(this.pidPath); } catch (_) {}
    }

    this.log('Watcher daemon stopped.');
    return { stopped: true };
  }
}

module.exports = { WatcherDaemon };
