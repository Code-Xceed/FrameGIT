/**
 * FrameGit Phase 20 Benchmark & Stress Test:
 * High-Throughput Media Streaming & Bounded Memory Validation
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Readable } = require('node:stream');
const crypto = require('node:crypto');
const { StreamingChunker } = require('../core/streaming_chunker');

/**
 * Creates an in-memory high-throughput synthetic video stream generator.
 * Emits pseudo-random bytes in high-speed blocks without retaining old blocks.
 * @param {number} totalBytes Total bytes to generate (e.g. 500MB - 2GB)
 * @param {number} [blockSize=4194304] 4 MB block size
 */
function createSyntheticMediaStream(totalBytes, blockSize = 4194304) {
  let emittedBytes = 0;
  // Pre-generate a 4MB pseudo-random seed pattern to avoid crypto overhead dominating benchmark
  const seedBlock = crypto.randomBytes(blockSize);

  return new Readable({
    read() {
      if (emittedBytes >= totalBytes) {
        this.push(null); // End of stream
        return;
      }
      const remaining = totalBytes - emittedBytes;
      const toSend = Math.min(remaining, blockSize);
      emittedBytes += toSend;
      // Copy slice so receiver can safely retain if needed
      this.push(Buffer.from(seedBlock.subarray(0, toSend)));
    }
  });
}

test('High-Throughput Streaming FastCDC Stress Benchmark (Bounded RAM < 250MB RSS)', async () => {
  const TOTAL_BENCHMARK_BYTES = 500 * 1024 * 1024; // 500 MB high-throughput stream
  const mediaStream = createSyntheticMediaStream(TOTAL_BENCHMARK_BYTES);

  let chunkCount = 0;
  let totalChunkedBytes = 0;
  let maxRssBytes = 0;

  const startTime = Date.now();

  const result = await StreamingChunker.chunkStream(
    mediaStream,
    async ({ offset, size, hash, data }) => {
      chunkCount++;
      totalChunkedBytes += size;

      // Monitor process resident set size (RSS)
      const currentRss = process.memoryUsage().rss;
      if (currentRss > maxRssBytes) {
        maxRssBytes = currentRss;
      }

      // FastCDC constraint: each chunk must have a valid hash
      assert.strictEqual(hash.length, 64);
      assert.strictEqual(data.length, size);
    },
    {
      minSize: 524288,    // 512 KB
      targetSize: 2097152, // 2 MB
      maxSize: 8388608    // 8 MB
    }
  );

  const durationSec = (Date.now() - startTime) / 1000;
  const throughputMBs = ((TOTAL_BENCHMARK_BYTES / (1024 * 1024)) / durationSec).toFixed(1);
  const maxRssMB = (maxRssBytes / (1024 * 1024)).toFixed(1);

  console.log('---------------------------------------------------------');
  console.log('   FRAMEGIT STREAMING CHUNKING STRESS BENCHMARK RESULTS   ');
  console.log('---------------------------------------------------------');
  console.log(`Streamed Data:     ${(TOTAL_BENCHMARK_BYTES / (1024 * 1024)).toFixed(0)} MB`);
  console.log(`Chunks Produced:   ${chunkCount}`);
  console.log(`Time Elapsed:      ${durationSec.toFixed(2)}s`);
  console.log(`Throughput:        ${throughputMBs} MB/s`);
  console.log(`Peak RSS Memory:   ${maxRssMB} MB (Limit: 250 MB)`);
  console.log('---------------------------------------------------------');

  // Verify byte conservation
  assert.strictEqual(totalChunkedBytes, TOTAL_BENCHMARK_BYTES);
  assert.strictEqual(result.totalBytes, TOTAL_BENCHMARK_BYTES);
  assert.strictEqual(result.totalChunks, chunkCount);

  // STRICT REQUIREMENT: Memory usage must remain bounded < 250MB RSS
  assert.ok(
    maxRssBytes < 250 * 1024 * 1024,
    `Memory limit exceeded: Peak RSS was ${maxRssMB} MB (Must be < 250 MB)`
  );
});
