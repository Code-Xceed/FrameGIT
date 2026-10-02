/**
 * FrameGit Core - Secure Credential Vault
 * 
 * Provides local hardware/OS-bound AES-256-GCM encryption for sensitive tokens
 * (GitHub OAuth tokens, S3/Cloudflare R2 access keys) without plain-text storage.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { wrapFsOperation, safeJsonParse } = require('./errors');

const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH_BYTES = 32; // 256 bits

class CredentialVault {
  /**
   * @param {Object} [options={}]
   * @param {string} [options.vaultPath] Custom path to encrypted vault file
   * @param {string} [options.saltPath] Custom path to salt file
   * @param {string} [options.masterKey] Optional explicit key for testing or overrides
   */
  constructor(options = {}) {
    const defaultDir = path.join(os.homedir(), '.framegit');
    this.vaultPath = options.vaultPath || path.join(defaultDir, 'credentials.enc');
    this.saltPath = options.saltPath || path.join(defaultDir, '.vault_salt');
    this.machineIdPath = options.machineIdPath || path.join(defaultDir, '.machine_id');
    this.explicitKey = options.masterKey || null;
    this._cachedKey = null;
    this._loadError = null;
  }

  /**
   * Retrieve or initialize persistent machine identifier.
   * Ensures key stability across DHCP, Wi-Fi, and network shifts.
   * @returns {string}
   */
  _getOrCreateMachineId() {
    if (fs.existsSync(this.machineIdPath)) {
      try {
        const id = fs.readFileSync(this.machineIdPath, 'utf8').trim();
        if (id && id.length >= 16) return id;
      } catch (_) {}
    }

    const parentDir = path.dirname(this.machineIdPath);
    if (!fs.existsSync(parentDir)) {
      wrapFsOperation(() => fs.mkdirSync(parentDir, { recursive: true, mode: 0o700 }), parentDir, 'mkdir');
    }

    const newId = crypto.randomUUID();
    wrapFsOperation(() => fs.writeFileSync(this.machineIdPath, newId, { mode: 0o600 }), this.machineIdPath, 'write');
    return newId;
  }

  /**
   * Derive a reproducible machine/OS fingerprint for key derivation.
   * Combines persistent machine ID, username, OS platform, architecture, and CPU model.
   * @returns {string}
   */
  _getMachineFingerprint() {
    const machineId = this._getOrCreateMachineId();
    let username = 'unknown_user';
    try {
      username = os.userInfo().username;
    } catch (_) {}

    let cpuModel = '';
    try {
      const cpus = os.cpus();
      if (cpus && cpus.length > 0) {
        cpuModel = cpus[0].model || '';
      }
    } catch (_) {}

    return [
      machineId,
      username,
      process.platform,
      process.arch,
      cpuModel
    ].join('::');
  }

  /**
   * Retrieve or initialize persistent 32-byte cryptographic salt.
   * @returns {Buffer}
   */
  _getOrCreateSalt() {
    if (fs.existsSync(this.saltPath)) {
      try {
        const salt = fs.readFileSync(this.saltPath);
        if (salt.length === 32) return salt;
      } catch (_) {}
    }

    const saltDir = path.dirname(this.saltPath);
    if (!fs.existsSync(saltDir)) {
      wrapFsOperation(() => fs.mkdirSync(saltDir, { recursive: true, mode: 0o700 }), saltDir, 'mkdir');
    }

    const newSalt = crypto.randomBytes(32);
    wrapFsOperation(() => fs.writeFileSync(this.saltPath, newSalt, { mode: 0o600 }), this.saltPath, 'write');
    return newSalt;
  }

  /**
   * Derive the 256-bit AES key using PBKDF2.
   * @returns {Buffer}
   */
  _deriveKey() {
    if (this._cachedKey) return this._cachedKey;

    const secret = this.explicitKey || this._getMachineFingerprint();
    const salt = this._getOrCreateSalt();
    this._cachedKey = crypto.pbkdf2Sync(secret, salt, PBKDF2_ITERATIONS, KEY_LENGTH_BYTES, 'sha256');
    return this._cachedKey;
  }

  /**
   * Decrypt and load all secrets into an in-memory map.
   * @returns {Record<string, string>}
   */
  _loadSecrets() {
    this._loadError = null;
    if (!fs.existsSync(this.vaultPath)) {
      return {};
    }

    try {
      const raw = fs.readFileSync(this.vaultPath, 'utf8');
      const envelope = safeJsonParse(raw, 'Credential vault file');
      if (!envelope || envelope.version !== 1 || !envelope.iv || !envelope.tag || !envelope.data) {
        return {};
      }

      const key = this._deriveKey();
      const iv = Buffer.from(envelope.iv, 'hex');
      const tag = Buffer.from(envelope.tag, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(Buffer.from(envelope.data, 'hex'), null, 'utf8');
      decrypted += decipher.final('utf8');

      return safeJsonParse(decrypted, 'Decrypted credentials');
    } catch (err) {
      // Record error to prevent setSecret from silently destroying encrypted data
      this._loadError = err;
      return {};
    }
  }

  /**
   * Encrypt and persist secrets map with AES-256-GCM.
   * @param {Record<string, string>} secretsMap 
   */
  _saveSecrets(secretsMap) {
    const parentDir = path.dirname(this.vaultPath);
    if (!fs.existsSync(parentDir)) {
      wrapFsOperation(() => fs.mkdirSync(parentDir, { recursive: true, mode: 0o700 }), parentDir, 'mkdir');
    }

    const key = this._deriveKey();
    const iv = crypto.randomBytes(12); // 96-bit standard GCM IV
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const jsonPayload = JSON.stringify(secretsMap);
    let encrypted = cipher.update(jsonPayload, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');

    const envelope = {
      version: 1,
      algorithm: 'aes-256-gcm',
      kdf: 'pbkdf2-sha256',
      iterations: PBKDF2_ITERATIONS,
      updatedAt: new Date().toISOString(),
      iv: iv.toString('hex'),
      tag,
      data: encrypted
    };

    const tempFile = `${this.vaultPath}.${Date.now()}.${crypto.randomUUID().slice(0, 8)}.tmp`;
    wrapFsOperation(() => fs.writeFileSync(tempFile, JSON.stringify(envelope, null, 2), { mode: 0o600 }), tempFile, 'write');
    try {
      if (fs.existsSync(this.vaultPath)) {
        try { fs.unlinkSync(this.vaultPath); } catch (_) {}
      }
      wrapFsOperation(() => fs.renameSync(tempFile, this.vaultPath), this.vaultPath, 'rename');
    } catch (err) {
      try { fs.unlinkSync(tempFile); } catch (_) {}
      throw err;
    }
  }

  /**
   * Store a secret key-value pair.
   * @param {string} key e.g. 'github.token', 'cloud.secretAccessKey'
   * @param {string} value 
   */
  setSecret(key, value) {
    if (!key || typeof key !== 'string') {
      throw new Error('Secret key must be a non-empty string');
    }
    const secrets = this._loadSecrets();
    if (this._loadError) {
      try {
        const bakPath = this.vaultPath + `.bak.${Date.now()}`;
        fs.copyFileSync(this.vaultPath, bakPath);
      } catch (_) {}
      throw new Error(`Cannot save secret: Existing vault file exists but failed to decrypt (${this._loadError.message}). Refusing to overwrite and destroy credentials.`);
    }
    secrets[key] = String(value);
    this._saveSecrets(secrets);
  }

  /**
   * Retrieve a secret by key.
   * @param {string} key 
   * @returns {string|null}
   */
  getSecret(key) {
    if (!key) return null;
    const secrets = this._loadSecrets();
    return secrets[key] !== undefined ? secrets[key] : null;
  }

  /**
   * Check if a secret exists.
   * @param {string} key 
   * @returns {boolean}
   */
  hasSecret(key) {
    if (!key) return false;
    const secrets = this._loadSecrets();
    return Object.prototype.hasOwnProperty.call(secrets, key);
  }

  /**
   * Delete a secret by key.
   * @param {string} key 
   * @returns {boolean} True if deleted, false if not found
   */
  deleteSecret(key) {
    if (!key) return false;
    const secrets = this._loadSecrets();
    if (Object.prototype.hasOwnProperty.call(secrets, key)) {
      delete secrets[key];
      this._saveSecrets(secrets);
      return true;
    }
    return false;
  }

  /**
   * List all stored secret key names (does NOT reveal values).
   * @returns {string[]}
   */
  listKeys() {
    const secrets = this._loadSecrets();
    return Object.keys(secrets);
  }

  /**
   * Clear all stored secrets in the vault.
   */
  clear() {
    if (fs.existsSync(this.vaultPath)) {
      wrapFsOperation(() => fs.unlinkSync(this.vaultPath), this.vaultPath, 'unlink');
    }
  }
}

// Global default singleton
let defaultVault = null;

function getDefaultVault() {
  if (!defaultVault) {
    defaultVault = new CredentialVault();
  }
  return defaultVault;
}

module.exports = {
  CredentialVault,
  getDefaultVault
};
