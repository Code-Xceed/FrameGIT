/**
 * FrameGit Desktop — Electron Preload Script
 * 
 * Securely bridges renderer process to main process via contextIsolation.
 * Exposes the `window.framegit` API for local-first configuration,
 * GitHub credentials vault, and NLE editor detection.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('framegit', {
  // First-Run & Setup Status
  getSetupStatus: () => ipcRenderer.invoke('setup:getStatus'),
  completeSetup: (options) => ipcRenderer.invoke('setup:complete', options),
  resetSetup: () => ipcRenderer.invoke('setup:reset'),

  // GitHub Local-First Vault & Verification
  verifyGitHubToken: (token) => ipcRenderer.invoke('github:verifyToken', token),
  saveGitHubConfig: (config) => ipcRenderer.invoke('github:saveConfig', config),
  skipGitHubConfig: () => ipcRenderer.invoke('github:skipConfig'),

  // Creative Editor Integrations
  detectEditors: () => ipcRenderer.invoke('nle:detect'),
  installPlugin: (family) => ipcRenderer.invoke('nle:installPlugin', family),

  // Background Watcher & Auto-Start Service
  configureStartup: (enable) => ipcRenderer.invoke('service:configureStartup', enable),

  // System Utilities
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  platform: process.platform
});
