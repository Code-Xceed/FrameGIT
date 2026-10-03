/**
 * FrameGit Desktop — Electron Preload Script
 * 
 * Securely bridges renderer process to main process via contextIsolation.
 * Exposes the `window.framegit` API for 1-Click Browser OAuth,
 * credentials vault, and creative editor integrations.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('framegit', {
  // First-Run & Setup Status
  getSetupStatus: () => ipcRenderer.invoke('setup:getStatus'),
  completeSetup: (options) => ipcRenderer.invoke('setup:complete', options),
  resetSetup: () => ipcRenderer.invoke('setup:reset'),

  // 1-Click Browser OAuth (Official GitHub Authorization)
  startBrowserOAuth: () => ipcRenderer.invoke('github:startBrowserOAuth'),
  waitForBrowserOAuth: (state) => ipcRenderer.invoke('github:waitForBrowserOAuth', state),
  cancelBrowserOAuth: (state) => ipcRenderer.invoke('github:cancelBrowserOAuth', state),
  getOAuthConfig: () => ipcRenderer.invoke('github:getOAuthConfig'),
  setOAuthConfig: (config) => ipcRenderer.invoke('github:setOAuthConfig', config),

  // Device Code OAuth & Manual Verification Fallbacks
  startGitHubOAuth: (options) => ipcRenderer.invoke('github:startOAuth', options),
  waitForGitHubOAuth: () => ipcRenderer.invoke('github:waitForOAuth'),
  cancelGitHubOAuth: () => ipcRenderer.invoke('github:cancelOAuth'),
  verifyGitHubToken: (token) => ipcRenderer.invoke('github:verifyToken', token),
  saveGitHubConfig: (config) => ipcRenderer.invoke('github:saveConfig', config),
  skipGitHubConfig: () => ipcRenderer.invoke('github:skipConfig'),

  // Account Session Lifecycle
  signOut: () => ipcRenderer.invoke('auth:signOut'),
  refreshProfile: () => ipcRenderer.invoke('auth:refreshProfile'),
  syncGitConfig: () => ipcRenderer.invoke('auth:syncGitConfig'),

  // Project Management & Tracking
  pickProject: () => ipcRenderer.invoke('project:pickDirectory'),
  getTrackedProjects: () => ipcRenderer.invoke('project:getTracked'),
  removeTrackedProject: (path) => ipcRenderer.invoke('project:removeTracked', path),
  inspectProject: (path) => ipcRenderer.invoke('project:inspect', path),
  commitCheckpoint: (params) => ipcRenderer.invoke('project:commit', params),
  restoreCheckpoint: (params) => ipcRenderer.invoke('project:restore', params),
  switchBranch: (params) => ipcRenderer.invoke('project:switchBranch', params),
  createBranch: (params) => ipcRenderer.invoke('project:createBranch', params),
  getProjectDiff: (projectPath) => ipcRenderer.invoke('project:getDiff', projectPath),

  // Creative Editor Integrations
  detectEditors: () => ipcRenderer.invoke('nle:detect'),
  installPlugin: (family) => ipcRenderer.invoke('nle:installPlugin', family),

  // Background Watcher & Auto-Start Service
  configureStartup: (enable) => ipcRenderer.invoke('service:configureStartup', enable),

  // System Utilities, Shell & Clipboard
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  showItemInFolder: (path) => ipcRenderer.invoke('shell:showItemInFolder', path),
  openPath: (path) => ipcRenderer.invoke('shell:openPath', path),
  copyToClipboard: (text) => ipcRenderer.invoke('clipboard:writeText', text),
  platform: process.platform
});
