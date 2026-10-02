/**
 * FrameGit Desktop — Storage Paths Resolver
 * 
 * Resolves standard local-first OS application storage directories:
 * - Windows: %APPDATA%\FrameGit (e.g. C:\Users\<Username>\AppData\Roaming\FrameGit)
 * - macOS:   ~/Library/Application Support/FrameGit
 * - Linux:   ~/.config/framegit
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function getUserDataDir() {
  if (process.versions && process.versions.electron) {
    try {
      const electron = require('electron');
      const app = electron.app;
      if (app && typeof app.getPath === 'function') {
        const p = app.getPath('userData');
        if (p) return p;
      }
    } catch (_) {}
  }

  const home = os.homedir();
  let baseDir;
  if (process.platform === 'win32') {
    baseDir = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(baseDir, 'FrameGit');
  } else if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'FrameGit');
  } else {
    baseDir = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    return path.join(baseDir, 'framegit');
  }
}

function ensureUserDataDir() {
  const dir = getUserDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

module.exports = {
  getUserDataDir,
  ensureUserDataDir
};
