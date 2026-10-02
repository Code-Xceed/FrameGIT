// FrameGit Core - Production Asset Engine
// Manages large media asset indexing, FastCDC streaming chunking, deduplication, and file reconstruction.
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { Hasher } = require('./hasher');
const { StreamingChunker } = require('./streaming_chunker');
const { CASStorage, OBJECT_TYPES } = require('./storage');

class AssetEngine {
  /**
   * @param {CASStorage} storage 
   * @param {import('node:sqlite').DatabaseSync} [db]
   */
  constructor(storage, db = null) {
    this.storage = storage;
    this.db = db;
  }

  /**
   * Stream index an asset file on disk, writing new chunks to CAS.
   * Employs constant RAM sliding window (<100MB RSS).
   * @param {string} filePath Absolute path
   * @param {Object} [options] FastCDC options (minSize, targetSize, maxSize)
   * @returns {Promise<{manifest: Object, stats: {totalBytes: number, totalChunks: number, reusedChunks: number, newChunks: number, elapsedMs: number, throughputMBs: number}}>}
   */
  async indexFile(filePath, options = {}) {
    const startTime = Date.now();
    const stats = fs.statSync(filePath);
    const readStream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 * 2 }); // 2MB read chunks

    const manifest = {
      path: filePath,
      size: stats.size,
      fullHash: '',
      chunks: []
    };

    let reusedChunks = 0;
    let newChunks = 0;

    const updateStmt = this.db ? this.db.prepare('UPDATE chunk_catalog SET ref_count = ref_count + 1 WHERE chunk_hash = ?') : null;
    const insertStmt = this.db ? this.db.prepare(`
      INSERT INTO chunk_catalog (chunk_hash, size_bytes, ref_count, created_at)
      VALUES (?, ?, 1, ?)
    `) : null;

    const result = await StreamingChunker.chunkStream(
      readStream,
      async (chunk) => {
        manifest.chunks.push({
          offset: chunk.offset,
          size: chunk.size,
          hash: chunk.hash
        });

        // Check deduplication
        if (this.storage.hasObject(chunk.hash)) {
          reusedChunks++;
          if (updateStmt) {
            updateStmt.run(chunk.hash);
          }
        } else {
          this.storage.writeObject(OBJECT_TYPES.CHUNK, chunk.data);
          newChunks++;
          if (insertStmt) {
            insertStmt.run(chunk.hash, chunk.size, Date.now());
          }
        }
      },
      options
    );

    manifest.fullHash = result.fullHash;
    const elapsedMs = Math.max(Date.now() - startTime, 1);
    const throughputMBs = ((result.totalBytes / (1024 * 1024)) / (elapsedMs / 1000));

    return {
      manifest,
      stats: {
        totalBytes: result.totalBytes,
        totalChunks: result.totalChunks,
        reusedChunks,
        newChunks,
        elapsedMs,
        throughputMBs: Number(throughputMBs.toFixed(2))
      }
    };
  }

  /**
   * Reconstruct a media file from CAS chunks to target path.
   * @param {Object} manifest 
   * @param {string} destPath 
   * @returns {Promise<{verified: boolean, bytesWritten: number}>}
   */
  async reconstructFile(manifest, destPath) {
    const parentDir = path.dirname(destPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const tempPath = destPath + `.${Date.now()}.${require('node:crypto').randomUUID()}.restore.tmp`;
    const writeStream = fs.createWriteStream(tempPath);
    const fullHasher = require('node:crypto').createHash('blake2s256');

    try {
      for (const chunkEntry of manifest.chunks) {
        const chunkObj = this.storage.readObject(chunkEntry.hash);
        fullHasher.update(chunkObj.payload);
        if (!writeStream.write(chunkObj.payload)) {
          await new Promise(resolve => writeStream.once('drain', resolve));
        }
      }

      await new Promise((resolve, reject) => {
        writeStream.end();
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      const computedHash = fullHasher.digest('hex');
      if (computedHash !== manifest.fullHash) {
        throw new Error(`Reconstructed file hash mismatch: expected ${manifest.fullHash}, got ${computedHash}`);
      }

      // On Windows NTFS, pre-unlink destination if it exists before renameSync
      if (fs.existsSync(destPath)) {
        try { fs.unlinkSync(destPath); } catch {}
      }
      fs.renameSync(tempPath, destPath);
      return { verified: true, bytesWritten: manifest.size };
    } catch (err) {
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch {}
      }
      throw err;
    }
  }

  /**
   * High-speed synthetic video stream generator for scale benchmarking.
   * Emits pseudo-random structured video bytes without allocating disk storage.
   * @param {number} totalBytes 
   * @param {number} [blockSize=1048576] 1MB
   * @returns {Readable}
   */
  static createSyntheticVideoStream(totalBytes, blockSize = 1048576) {
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

  /**
   * Benchmark streaming FastCDC chunking and BLAKE2/3 hashing on synthetic media.
   * @param {number} totalBytes 
   * @param {Object} [chunkerOptions]
   * @returns {Promise<{totalBytes: number, totalChunks: number, avgChunkSize: number, elapsedMs: number, throughputMBs: number, peakRssMB: number}>}
   */
  static async benchmarkStream(totalBytes, chunkerOptions = {}) {
    const startTime = Date.now();
    const stream = AssetEngine.createSyntheticVideoStream(totalBytes, 2 * 1024 * 1024);

    let totalChunks = 0;
    let maxMemoryRss = process.memoryUsage().rss;

    const result = await StreamingChunker.chunkStream(
      stream,
      async () => {
        totalChunks++;
        const currentRss = process.memoryUsage().rss;
        if (currentRss > maxMemoryRss) {
          maxMemoryRss = currentRss;
        }
      },
      chunkerOptions
    );

    const elapsedMs = Math.max(Date.now() - startTime, 1);
    const throughputMBs = ((result.totalBytes / (1024 * 1024)) / (elapsedMs / 1000));
    const avgChunkSize = totalChunks > 0 ? Math.round(result.totalBytes / totalChunks) : 0;

    return {
      totalBytes: result.totalBytes,
      totalChunks,
      avgChunkSize,
      elapsedMs,
      throughputMBs: Number(throughputMBs.toFixed(2)),
      peakRssMB: Number((maxMemoryRss / (1024 * 1024)).toFixed(1))
    };
  }
}

module.exports = { AssetEngine };
