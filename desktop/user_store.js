/**
 * FrameGit Desktop — Local-First User Data & Settings Store
 * 
 * Manages persistent user preferences, settings, and hardware-encrypted credentials
 * stored in OS-standard application data directories:
 * - Windows: %APPDATA%\FrameGit\settings.json & credentials.enc
 * - macOS:   ~/Library/Application Support/FrameGit/settings.json & credentials.enc
 * - Linux:   ~/.config/framegit/settings.json & credentials.enc
 * 
 * Local-First Guarantees:
 * - Zero external server dependency for user profiles or settings.
 * - Sensitive tokens (GitHub PAT, cloud keys) are AES-256-GCM encrypted via CredentialVault.
 * - Settings are safely and atomically written to disk.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ensureUserDataDir } = require('./storage_paths');
const { CredentialVault } = require('../core/vault');
const { safeJsonParse, wrapFsOperation } = require('../core/errors');

const DEFAULT_SETTINGS = {
  version: 1,
  setupCompleted: false,
  setupCompletedAt: null,
  theme: 'dark',
  autoStartBackgroundService: true,
  user: {
    username: null,
    name: null,
    email: null,
    avatarUrl: null
  },
  plugins: {
    premiere: false,
    resolve: false
  },
  github: {
    clientId: 'Ov23liEdxYDHJ3uGPzQv'
  },
  trackedProjects: [],
  recentProjects: []
};

class UserStore {
  /**
   * @param {Object} [options]
   * @param {string} [options.dataDir] Custom data directory for testing
   */
  constructor(options = {}) {
    this.dataDir = options.dataDir || ensureUserDataDir();
    this.settingsPath = path.join(this.dataDir, 'settings.json');

    // Hardware-encrypted vault for sensitive credentials
    this.vault = new CredentialVault({
      vaultPath: path.join(this.dataDir, 'credentials.enc'),
      saltPath: path.join(this.dataDir, '.vault_salt'),
      machineIdPath: path.join(this.dataDir, '.machine_id')
    });

    this._ensureFiles();
  }

  _ensureFiles() {
    if (!fs.existsSync(this.dataDir)) {
      wrapFsOperation(() => fs.mkdirSync(this.dataDir, { recursive: true }), this.dataDir, 'mkdir');
    }
    if (!fs.existsSync(this.settingsPath)) {
      this._writeSettingsSync(DEFAULT_SETTINGS);
    }
  }

  _writeSettingsSync(data) {
    const tempFile = `${this.settingsPath}.${Date.now()}.${crypto.randomUUID().slice(0, 8)}.tmp`;
    const jsonStr = JSON.stringify(data, null, 2);
    wrapFsOperation(() => fs.writeFileSync(tempFile, jsonStr, 'utf8'), tempFile, 'write');
    try {
      if (fs.existsSync(this.settingsPath)) {
        try { fs.unlinkSync(this.settingsPath); } catch (_) {}
      }
      wrapFsOperation(() => fs.renameSync(tempFile, this.settingsPath), this.settingsPath, 'rename');
    } catch (err) {
      try { fs.unlinkSync(tempFile); } catch (_) {}
      throw err;
    }
  }

  /**
   * Read all user settings.
   * @returns {typeof DEFAULT_SETTINGS}
   */
  getSettings() {
    try {
      if (!fs.existsSync(this.settingsPath)) {
        return { ...DEFAULT_SETTINGS };
      }
      const raw = fs.readFileSync(this.settingsPath, 'utf8');
      const parsed = safeJsonParse(raw, 'settings.json');
      const res = Object.assign({}, DEFAULT_SETTINGS, parsed, {
        user: Object.assign({}, DEFAULT_SETTINGS.user, parsed.user || {}),
        plugins: Object.assign({}, DEFAULT_SETTINGS.plugins, parsed.plugins || {}),
        github: Object.assign({}, DEFAULT_SETTINGS.github, parsed.github || {})
      });
      if (!res.github.clientId || res.github.clientId === 'Iv23liFrameGitDefaultApp') {
        res.github.clientId = 'Ov23liEdxYDHJ3uGPzQv';
      }
      return res;
    } catch (_) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  /**
   * Partially update and persist user settings.
   * @param {Partial<typeof DEFAULT_SETTINGS>} updates 
   * @returns {typeof DEFAULT_SETTINGS}
   */
  updateSettings(updates = {}) {
    const current = this.getSettings();
    const merged = {
      ...current,
      ...updates,
      user: updates.user ? { ...current.user, ...updates.user } : current.user,
      plugins: updates.plugins ? { ...current.plugins, ...updates.plugins } : current.plugins
    };
    this._writeSettingsSync(merged);
    return merged;
  }

  /**
   * Check if the user has completed initial onboarding.
   * @returns {boolean}
   */
  isSetupCompleted() {
    const settings = this.getSettings();
    return Boolean(settings.setupCompleted);
  }

  /**
   * Save GitHub credentials and profile locally.
   * Token is stored in encrypted vault; profile info in settings.json.
   * @param {Object} params
   * @param {string} [params.token]
   * @param {string} [params.username]
   * @param {string} [params.name]
   * @param {string} [params.email]
   * @param {string} [params.avatarUrl]
   */
  saveGitHubAuth({ token, username, name, email, avatarUrl }) {
    if (token) {
      this.vault.setSecret('github.token', token.trim());
    }

    return this.updateSettings({
      user: {
        username: username || null,
        name: name || null,
        email: email || null,
        avatarUrl: avatarUrl || null
      }
    });
  }

  /**
   * Retrieve GitHub credentials and profile.
   * @returns {{ hasToken: boolean, token: string|null, user: typeof DEFAULT_SETTINGS.user }}
   */
  getGitHubAuth() {
    const token = this.vault.getSecret('github.token');
    const settings = this.getSettings();
    return {
      hasToken: Boolean(token),
      token: token || null,
      user: settings.user
    };
  }

  /**
   * Remove stored GitHub credentials and clear profile.
   */
  clearGitHubAuth() {
    this.vault.deleteSecret('github.token');
    return this.updateSettings({
      user: {
        username: null,
        name: null,
        email: null,
        avatarUrl: null
      }
    });
  }

  /**
   * Get GitHub OAuth application configuration.
   * @returns {{ clientId: string, hasSecret: boolean, clientSecret: string|null }}
   */
  getGitHubConfig() {
    const settings = this.getSettings();
    const clientSecret = this.vault.getSecret('github.clientSecret');
    let clientId = settings.github && settings.github.clientId;
    if (!clientId || clientId === 'Iv23liFrameGitDefaultApp') {
      clientId = 'Ov23liEdxYDHJ3uGPzQv';
    }
    return {
      clientId,
      hasSecret: Boolean(clientSecret),
      clientSecret: clientSecret || null
    };
  }

  /**
   * Set GitHub OAuth application configuration.
   * @param {Object} config
   * @param {string} [config.clientId]
   * @param {string} [config.clientSecret]
   */
  setGitHubConfig({ clientId, clientSecret }) {
    if (clientSecret !== undefined) {
      if (clientSecret) {
        this.vault.setSecret('github.clientSecret', clientSecret.trim());
      } else {
        this.vault.deleteSecret('github.clientSecret');
      }
    }
    if (clientId) {
      this.updateSettings({
        github: {
          clientId: clientId.trim()
        }
      });
    }
    return this.getGitHubConfig();
  }

  /**
   * Mark first-run setup as completed.
   * @param {Object} [options]
   * @param {boolean} [options.autoStartService]
   * @param {Object} [options.plugins]
   */
  completeSetup(options = {}) {
    const updates = {
      setupCompleted: true,
      setupCompletedAt: new Date().toISOString()
    };
    if (typeof options.autoStartService === 'boolean') {
      updates.autoStartBackgroundService = options.autoStartService;
    }
    if (options.plugins) {
      updates.plugins = options.plugins;
    }
    return this.updateSettings(updates);
  }

  /**
   * Reset setup status (useful for re-running setup or testing).
   */
  resetSetup() {
    return this.updateSettings({
      setupCompleted: false,
      setupCompletedAt: null
    });
  }
}

// Singleton helper
let defaultStore = null;

function getDefaultUserStore() {
  if (!defaultStore) {
    defaultStore = new UserStore();
  }
  return defaultStore;
}

module.exports = {
  UserStore,
  getDefaultUserStore,
  DEFAULT_SETTINGS
};
