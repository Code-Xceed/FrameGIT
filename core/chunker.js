// FrameGit Core - Fast Content-Defined Chunking (FastCDC) Engine
// Uses Gear rolling hash matrix to eliminate boundary-shift invalidation on video/audio deltas.
const { Hasher } = require('./hasher');

// 256 pre-computed 32-bit pseudo-random values with verified uniform distribution (Gear Matrix)
const GEAR_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  const hash = Hasher.createHash().update(`FastCDC_Gear_Table_Seed_2026_${i}`).digest();
  GEAR_TABLE[i] = hash.readUInt32LE(0);
}

class Chunker {
  /**
   * Split a buffer into content-defined chunks using FastCDC.
   * @param {Buffer} buffer 
   * @param {Object} [options]
   * @param {number} [options.minSize=262144] 256 KB minimum (configurable for test/prod)
   * @param {number} [options.targetSize=1048576] 1 MB target
   * @param {number} [options.maxSize=4194304] 4 MB maximum
   * @returns {Array<{offset: number, size: number, hash: string, data: Buffer}>}
   */
  static chunkBufferFastCDC(buffer, options = {}) {
    const minSize = options.minSize || 262144;
    const targetSize = options.targetSize || 1048576;
    const maxSize = options.maxSize || 4194304;

    const len = buffer.length;
    if (len === 0) return [];
    if (len <= minSize) {
      const hash = Hasher.hash(buffer);
      return [{ offset: 0, size: len, hash, data: buffer }];
    }

    // Mask for target size: e.g. 1MB mask has ~20 bits set
    const mask = (targetSize - 1) | 0;
    const chunks = [];
    let chunkStart = 0;

    while (chunkStart < len) {
      if (len - chunkStart <= minSize) {
        const slice = buffer.subarray(chunkStart);
        chunks.push({
          offset: chunkStart,
          size: slice.length,
          hash: Hasher.hash(slice),
          data: slice
        });
        break;
      }

      let fp = 0;
      let pos = chunkStart + minSize;
      const endLimit = Math.min(chunkStart + maxSize, len);

      while (pos < endLimit) {
        fp = ((fp << 1) + GEAR_TABLE[buffer[pos]]) >>> 0;
        if ((fp & mask) === 0) {
          pos++;
          break;
        }
        pos++;
      }

      const slice = buffer.subarray(chunkStart, pos);
      chunks.push({
        offset: chunkStart,
        size: slice.length,
        hash: Hasher.hash(slice),
        data: slice
      });
      chunkStart = pos;
    }

    return chunks;
  }

  /**
   * Fixed-size chunking fallback.
   * @param {Buffer} buffer 
   * @param {number} [chunkSize=1048576] 1 MB
   * @returns {Array<{offset: number, size: number, hash: string, data: Buffer}>}
   */
  static chunkBufferFixed(buffer, chunkSize = 1048576) {
    const chunks = [];
    const len = buffer.length;
    let offset = 0;

    while (offset < len) {
      const end = Math.min(offset + chunkSize, len);
      const slice = buffer.subarray(offset, end);
      chunks.push({
        offset,
        size: slice.length,
        hash: Hasher.hash(slice),
        data: slice
      });
      offset = end;
    }

    return chunks;
  }
}

module.exports = { Chunker };
