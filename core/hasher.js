// FrameGit Core - Cryptographic Content-Addressing Hasher
// Uses native BLAKE2s-256 (64 hex characters) / SHA-256 via OpenSSL
const crypto = require('node:crypto');
const fs = require('node:fs');

class Hasher {
  /**
   * Hash a buffer or string.
   * @param {Buffer|string} data 
   * @param {'blake2s256'|'sha256'} [algorithm='blake2s256'] 
   * @returns {string} 64-character hex hash
   */
  static hash(data, algorithm = 'blake2s256') {
    return crypto.createHash(algorithm).update(data).digest('hex');
  }

  /**
   * Stream hash a file on disk without loading entire file into memory.
   * @param {string} filePath 
   * @param {'blake2s256'|'sha256'} [algorithm='blake2s256']
   * @returns {Promise<string>}
   */
  static hashFile(filePath, algorithm = 'blake2s256') {
    return new Promise((resolve, reject) => {
      const hashStream = crypto.createHash(algorithm);
      const readStream = fs.createReadStream(filePath);

      readStream.on('data', chunk => hashStream.update(chunk));
      readStream.on('end', () => resolve(hashStream.digest('hex')));
      readStream.on('error', reject);
    });
  }
}

module.exports = { Hasher };
