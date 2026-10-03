// FrameGit Core - Cryptographic Content-Addressing Hasher
// Uses native BLAKE2s-256 (64 hex characters) / SHA-256 via OpenSSL
const crypto = require('node:crypto');
const fs = require('node:fs');

class Hasher {
  /**
   * Determine supported hash algorithm supported by current Node/Electron OpenSSL/BoringSSL runtime.
   * Standardizes on sha256 across all runtimes for universal determinism.
   */
  static getSupportedAlgorithm(algo = 'sha256') {
    return 'sha256';
  }

  /**
   * Return a crypto Hash instance.
   */
  static createHash(algorithm = 'sha256') {
    return crypto.createHash('sha256');
  }

  /**
   * Hash a buffer or string.
   * @param {Buffer|string} data 
   * @param {string} [algorithm='sha256'] 
   * @returns {string} 64-character hex hash
   */
  static hash(data, algorithm = 'sha256') {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Stream hash a file on disk without loading entire file into memory.
   * @param {string} filePath 
   * @param {string} [algorithm='sha256']
   * @returns {Promise<string>}
   */
  static hashFile(filePath, algorithm = 'sha256') {
    return new Promise((resolve, reject) => {
      const hashStream = crypto.createHash('sha256');
      const readStream = fs.createReadStream(filePath);

      readStream.on('data', chunk => hashStream.update(chunk));
      readStream.on('end', () => resolve(hashStream.digest('hex')));
      readStream.on('error', reject);
    });
  }
}

module.exports = { Hasher };
