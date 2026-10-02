/**
 * FrameGit Test Helpers
 * 
 * Shared test fixture generators, synthetic video streams, and mock data builders.
 * Isolated from core production code.
 */

'use strict';

const { Readable } = require('node:stream');

/**
 * High-speed synthetic video stream generator for scale benchmarking.
 * Emits pseudo-random structured video bytes without allocating disk storage.
 * @param {number} totalBytes 
 * @param {number} [blockSize=1048576] 1MB
 * @returns {Readable}
 */
function createSyntheticVideoStream(totalBytes, blockSize = 1048576) {
  let bytesEmitted = 0;
  const baseBlock = Buffer.alloc(blockSize);
  for (let i = 0; i < blockSize; i += 4) {
    baseBlock.writeUInt32LE((i * 1103515245 + 12345) >>> 0, i);
  }

  return new Readable({
    read() {
      if (bytesEmitted >= totalBytes) {
        this.push(null);
        return;
      }

      const remaining = totalBytes - bytesEmitted;
      const currentBlockSize = Math.min(remaining, blockSize);
      const chunk = currentBlockSize === blockSize ? baseBlock : baseBlock.subarray(0, currentBlockSize);

      bytesEmitted += currentBlockSize;
      this.push(chunk);
    }
  });
}

module.exports = {
  createSyntheticVideoStream
};
