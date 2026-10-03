// FrameGit Core - Content-Addressed Storage (CAS) Engine
// Implements atomic writes, typed binary object headers, and cryptographic integrity verification.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Hasher } = require('./hasher');
const { wrapFsOperation, FileNotFoundError, CorruptDataError, IntegrityError } = require('./errors');

const OBJECT_TYPES = {
  CHUNK: 0x01,
  TREE: 0x02,
  COMMIT: 0x03
};

const MAGIC_BYTES = Buffer.from('FGOB', 'utf-8'); // FrameGit Object Binary Header

class CASStorage {
  /**
   * @param {string} repoRoot 
   */
  constructor(repoRoot) {
    this.repoRoot = repoRoot;
    this.objectsDir = path.join(repoRoot, '.framegit', 'objects');
  }

  /**
   * Initialize objects directory structure.
   */
  init() {
    if (!fs.existsSync(this.objectsDir)) {
      wrapFsOperation(() => fs.mkdirSync(this.objectsDir, { recursive: true }), this.objectsDir, 'mkdir');
    }
  }

  /**
   * Get the relative disk path for an object hash: e.g. objects/ab/cdef123...
   * @param {string} hash 
   * @returns {string}
   */
  getObjectPath(hash) {
    const prefix = hash.slice(0, 2);
    const rest = hash.slice(2);
    return path.join(this.objectsDir, prefix, rest);
  }

  /**
   * Check if an object exists in CAS (instant deduplication check).
   * @param {string} hash 
   * @returns {boolean}
   */
  hasObject(hash) {
    return fs.existsSync(this.getObjectPath(hash));
  }

  /**
   * Write an object to CAS with atomic temp-file rename and verification.
   * @param {number} type Object type (0x01 Chunk, 0x02 Tree, 0x03 Commit)
   * @param {Buffer} payload 
   * @param {boolean} [compress=false] Whether to compress payload with zlib Deflate
   * @returns {string} 64-character BLAKE2/BLAKE3 hash of raw payload
   */
  writeObject(type, payload, compress = false) {
    const hash = Hasher.hash(payload);
    const destPath = this.getObjectPath(hash);

    // If object already exists, return hash immediately (deduplicated!)
    if (fs.existsSync(destPath)) {
      return hash;
    }

    const parentDir = path.dirname(destPath);
    if (!fs.existsSync(parentDir)) {
      wrapFsOperation(() => fs.mkdirSync(parentDir, { recursive: true }), parentDir, 'mkdir');
    }

    let storedPayload = payload;
    let isCompressed = 0x00;
    if (compress) {
      storedPayload = zlib.deflateSync(payload);
      isCompressed = 0x01;
    }

    // Build binary header: MAGIC(4B) + TYPE(1B) + COMPRESSED(1B) + PAYLOAD_LEN(8B)
    const header = Buffer.alloc(14);
    MAGIC_BYTES.copy(header, 0);
    header.writeUInt8(type, 4);
    header.writeUInt8(isCompressed, 5);
    header.writeBigUInt64LE(BigInt(storedPayload.length), 6);

    const fullBlob = Buffer.concat([header, storedPayload]);

    // Atomic write via temp file using secure random UUID
    const tempPath = destPath + `.${Date.now()}.${crypto.randomUUID()}.tmp`;
    try {
      wrapFsOperation(() => fs.writeFileSync(tempPath, fullBlob), tempPath, 'write');
      if (fs.existsSync(destPath)) {
        try { fs.unlinkSync(destPath); } catch {}
      }
      wrapFsOperation(() => fs.renameSync(tempPath, destPath), destPath, 'rename');
    } catch (err) {
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch {}
      }
      throw err;
    }

    return hash;
  }

  /**
   * Read an object from CAS and verify integrity.
   * @param {string} hash 
   * @returns {{type: number, payload: Buffer}}
   */
  readObject(hash) {
    const objectPath = this.getObjectPath(hash);
    if (!fs.existsSync(objectPath)) {
      throw new FileNotFoundError(objectPath, new Error(`Object not found in CAS: ${hash}`));
    }

    const data = wrapFsOperation(() => fs.readFileSync(objectPath), objectPath, 'read');
    if (data.length < 14) {
      throw new CorruptDataError(`CAS object ${hash}`, 'header too short (< 14 bytes)', new Error(`Corrupted object file (header too short): ${hash}`));
    }

    const magic = data.subarray(0, 4);
    if (!magic.equals(MAGIC_BYTES)) {
      throw new CorruptDataError(`CAS object ${hash}`, 'invalid magic header bytes', new Error(`Invalid object magic bytes in ${hash}`));
    }

    const type = data.readUInt8(4);
    const isCompressed = data.readUInt8(5);
    const payloadLen = Number(data.readBigUInt64LE(6));

    if (data.length < 14 + payloadLen) {
      throw new CorruptDataError(`CAS object ${hash}`, `file truncated (expected ${14 + payloadLen} bytes, got ${data.length})`, new Error(`Corrupted object file (payload truncated): ${hash}`));
    }

    let payload = data.subarray(14, 14 + payloadLen);
    if (isCompressed === 0x01) {
      payload = zlib.inflateSync(payload);
    }

    // Verify integrity
    const computedHash = Hasher.hash(payload);
    if (computedHash !== hash) {
      let matchesLegacy = false;
      try {
        const blakeHash = crypto.createHash('blake2s256').update(payload).digest('hex');
        if (blakeHash === hash) matchesLegacy = true;
      } catch (_) {}
      if (!matchesLegacy) {
        throw new IntegrityError(hash, `Hash mismatch on CAS read: expected ${hash}, computed ${computedHash}`);
      }
    }

    return { type, payload };
  }
}

module.exports = { CASStorage, OBJECT_TYPES };
