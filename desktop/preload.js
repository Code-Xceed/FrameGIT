/**
 * FrameGit Desktop — Electron Preload Script
 * 
 * Securely bridges renderer process to main process via contextIsolation.
 * Exposes the `window.framegit` API for local-first configuration,
 * GitHub OAuth, credentials vault, project tracking, and NLE version control.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('framegit', {
  // First-Run & Setup Status
  getSetupStatus: () => ipcRenderer.invoke('setup:getStatus'),
  completeSetup: (options) => ipcRenderer.invoke('setup:complete', options),
  resetSetup: () => ipcRenderer.invoke('setup:reset'),

  // GitHub OAuth & Vault
  startGitHubOAuth: (options) => ipcRenderer.invoke('github:startOAuth', options),
  waitForGitHubOAuth: () => ipcRenderer.invoke('github:waitForOAuth'),
  cancelGitHubOAuth: () => ipcRenderer.invoke('github:cancelOAuth'),
  verifyGitHubToken: (token) => ipcRenderer.invoke('github:verifyToken', token),
  saveGitHubConfig: (config) => ipcRenderer.invoke('github:saveConfig', config),
  skipGitHubConfig: () => ipcRenderer.invoke('github:skipConfig'),

  // Creative Editor Integrations
  detectEditors: () => ipcRenderer.invoke('nle:detect'),
  installPlugin: (family) => ipcRenderer.invoke('nle:installPlugin', family),
  getRunningEditors: () => ipcRenderer.invoke('system:getRunningEditors'),

  // Project Catalog & Workspace Actions
  listProjects: () => ipcRenderer.invoke('projects:list'),
  pickProjectFolder: () => ipcRenderer.invoke('projects:pickFolder'),
  trackProject: (path, meta) => ipcRenderer.invoke('projects:track', path, meta),
  getProjectDetails: (path) => ipcRenderer.invoke('projects:getDetails', path),
  commitProject: (path, message) => ipcRenderer.invoke('projects:commit', path, message),
  revertProject: (path, hash, force) => ipcRenderer.invoke('projects:revert', path, hash, force),
  createBranch: (path, name) => ipcRenderer.invoke('projects:createBranch', path, name),
  switchBranch: (path, name, force) => ipcRenderer.invoke('projects:switchBranch', path, name, force),
  pushProject: (path) => ipcRenderer.invoke('projects:push', path),
  pullProject: (path) => ipcRenderer.invoke('projects:pull', path),

  // Background Watcher & Auto-Start Service
  configureStartup: (enable) => ipcRenderer.invoke('service:configureStartup', enable),

  // System Utilities & Clipboard
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  copyToClipboard: (text) => ipcRenderer.invoke('clipboard:writeText', text),
  platform: process.platform
});
