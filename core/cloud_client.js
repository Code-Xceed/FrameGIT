// FrameGit Core - Production Cloud Storage Client (S3 / Cloudflare R2 Compatible)
// Implements AWS Signature V4 REST client, multipart uploads, deduplication discovery,
// exponential backoff with jitter, and branch ref CAS updates.

'use strict';

const { XMLParser } = require('fast-xml-parser');
const { Hasher } = require('./hasher');
const { signRequest } = require('./s3_signer');
const { NetworkError, CloudAuthError } = require('./errors');

class ConflictError extends Error {
  constructor(message, remoteCommit, localCommit) {
    super(message);
    this.name = 'ConflictError';
    this.remoteCommit = remoteCommit;
    this.localCommit = localCommit;
  }
}

/**
 * Cloud Storage Client supporting S3 / Cloudflare R2 REST protocol
 * Supports both real HTTPS network transport and in-memory mock for testing.
 */
class CloudClient {
  /**
   * @param {Object} [config]
   * @param {string} [config.endpoint]
   * @param {string} [config.bucket]
   * @param {string} [config.region='auto']
   * @param {string} [config.accessKeyId]
   * @param {string} [config.secretAccessKey]
   * @param {boolean} [config.isMock=false]
   * @param {number} [config.maxRetries=5]
   * @param {number} [config.multipartThresholdBytes=5242880] 5MB
   * @param {number} [config.requestTimeoutMs=30000]
   */
  constructor(config = {}) {
    this.config = config;

    // Explicit mock flag or test environment detection
    if (config.isMock !== undefined) {
      this.isMock = Boolean(config.isMock);
    } else {
      const isTestEnv = process.env.NODE_ENV === 'test' || 
                        process.env.FRAMEGIT_TEST === '1' ||
                        process.execArgv.includes('--test') ||
                        process.argv.some(a => typeof a === 'string' && a.includes('test'));
      if (isTestEnv && !config.endpoint && !config.accessKeyId) {
        this.isMock = true;
      } else if (!config.endpoint && !process.env.S3_ENDPOINT) {
        throw new CloudAuthError('Missing cloud storage endpoint. Set "endpoint" in cloud configuration or S3_ENDPOINT environment variable.');
      } else if (!config.bucket && !process.env.S3_BUCKET) {
        throw new CloudAuthError('Missing cloud storage bucket. Set "bucket" in cloud configuration or S3_BUCKET environment variable.');
      } else {
        this.isMock = false;
      }
    }

    this.endpoint = (config.endpoint || process.env.S3_ENDPOINT || '').replace(/\/+$/, '');
    this.bucket = config.bucket || process.env.S3_BUCKET || '';
    this.region = config.region || process.env.S3_REGION || 'auto';
    this.accessKeyId = config.accessKeyId || process.env.S3_ACCESS_KEY || '';
    this.secretAccessKey = config.secretAccessKey || process.env.S3_SECRET_KEY || '';
    this.maxRetries = config.maxRetries || 5;
    this.multipartThresholdBytes = config.multipartThresholdBytes || (5 * 1024 * 1024);
    this.requestTimeoutMs = config.requestTimeoutMs || 30000;

    // In-memory mock store for offline testing
    this.mockBucket = new Map(); // key -> { buffer, size, hash, etag }
    this.mockRefs = new Map();   // branchName -> commitHash
    this.simulateNetworkFailure = false;
  }

  /**
   * Resolve full object URL.
   * @param {string} key 
   * @returns {string}
   */
  getObjectUrl(key) {
    const cleanKey = key.replace(/^\/+/, '');
    if (this.endpoint.includes(this.bucket)) {
      return `${this.endpoint}/${cleanKey}`;
    }
    return `${this.endpoint}/${this.bucket}/${cleanKey}`;
  }

  /**
   * Internal fetch with exponential backoff and jitter.
   * @private
   */
  async _fetchWithRetry(method, url, options = {}) {
    let attempt = 0;
    const maxRetries = options.maxRetries ?? this.maxRetries;

    while (attempt < maxRetries) {
      if (this.simulateNetworkFailure) {
        throw new NetworkError('fetch', 'Network connection refused (simulated offline)', new Error('ECONNREFUSED'));
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

      try {
        const signed = signRequest({
          method,
          url,
          headers: options.headers || {},
          body: options.body || null,
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
          region: this.region,
          service: 's3'
        });

        const response = await fetch(url, {
          method,
          headers: signed.headers,
          body: options.body || undefined,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        // Success or standard HTTP response
        if (response.ok || response.status === 404) {
          return response;
        }

        // Retryable status codes (Rate limits or server errors)
        if ([429, 500, 502, 503, 504].includes(response.status)) {
          attempt++;
          if (attempt >= maxRetries) {
            const errText = await response.text().catch(() => '');
            throw new NetworkError(method, `S3 HTTP ${response.status}: ${errText}`, new Error(`HTTP ${response.status}`));
          }
          const baseDelay = 300 * Math.pow(2, attempt);
          const jitter = Math.random() * 100;
          await new Promise(r => setTimeout(r, baseDelay + jitter));
          continue;
        }

        if (response.status === 401 || response.status === 403) {
          const errText = await response.text().catch(() => '');
          throw new CloudAuthError('S3/R2', `HTTP ${response.status}: ${errText}`);
        }

        // Other non-retryable errors
        const errText = await response.text().catch(() => '');
        throw new NetworkError(method, `S3 request failed (${response.status}): ${errText}`, new Error(`HTTP ${response.status}`));

      } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof CloudAuthError) throw err;

        attempt++;
        if (attempt >= maxRetries) {
          throw new NetworkError(method, err.message, err);
        }

        const baseDelay = 300 * Math.pow(2, attempt);
        const jitter = Math.random() * 100;
        await new Promise(r => setTimeout(r, baseDelay + jitter));
      }
    }
  }

  /**
   * Check if an object exists in remote storage (HeadObject).
   * @param {string} key 
   * @returns {Promise<{exists: boolean, size: number, hash: string, etag: string}>}
   */
  async headObject(key) {
    if (this.simulateNetworkFailure) {
      throw new NetworkError('headObject', 'Network connection refused (simulated offline)', new Error('ECONNREFUSED'));
    }

    if (this.isMock) {
      const obj = this.mockBucket.get(key);
      if (!obj) {
        return { exists: false, size: 0, hash: '', etag: '' };
      }
      return { exists: true, size: obj.size, hash: obj.hash, etag: obj.etag || obj.hash };
    }

    const url = this.getObjectUrl(key);
    const res = await this._fetchWithRetry('HEAD', url);

    if (res.status === 404) {
      return { exists: false, size: 0, hash: '', etag: '' };
    }

    const size = parseInt(res.headers.get('content-length') || '0', 10);
    const etag = (res.headers.get('etag') || '').replace(/^"+|"+$/g, '');
    return {
      exists: true,
      size,
      hash: etag,
      etag
    };
  }

  /**
   * Upload an object with automatic multipart routing for large payloads.
   * @param {string} key 
   * @param {Buffer} buffer 
   * @returns {Promise<{success: boolean, hash: string}>}
   */
  async putObject(key, buffer) {
    if (this.simulateNetworkFailure) {
      throw new NetworkError('putObject', 'Network dropped during transfer', new Error('ECONNRESET'));
    }

    const hash = Hasher.hash(buffer);

    if (this.isMock) {
      this.mockBucket.set(key, {
        buffer: Buffer.from(buffer),
        size: buffer.length,
        hash,
        etag: hash
      });
      return { success: true, hash };
    }

    // Route large assets through S3 multipart upload
    if (buffer.length > this.multipartThresholdBytes) {
      return this.uploadMultipart(key, buffer);
    }

    const url = this.getObjectUrl(key);
    await this._fetchWithRetry('PUT', url, {
      body: buffer,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(buffer.length)
      }
    });

    return { success: true, hash };
  }

  /**
   * Download an object from remote storage.
   * @param {string} key 
   * @returns {Promise<Buffer>}
   */
  async getObject(key) {
    if (this.simulateNetworkFailure) {
      throw new NetworkError('getObject', 'Network connection refused (simulated offline)', new Error('ECONNREFUSED'));
    }

    if (this.isMock) {
      const obj = this.mockBucket.get(key);
      if (!obj) {
        throw new Error(`Object not found in cloud storage: ${key}`);
      }
      return Buffer.from(obj.buffer);
    }

    const url = this.getObjectUrl(key);
    const res = await this._fetchWithRetry('GET', url);

    if (res.status === 404) {
      throw new Error(`Object not found in cloud storage: ${key}`);
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  /**
   * Delete an object from remote storage.
   * @param {string} key 
   */
  async deleteObject(key) {
    if (this.isMock) {
      this.mockBucket.delete(key);
      return { deleted: true };
    }

    const url = this.getObjectUrl(key);
    await this._fetchWithRetry('DELETE', url);
    return { deleted: true };
  }

  /**
   * S3 Multipart Upload implementation for large media files.
   * @param {string} key 
   * @param {Buffer} buffer 
   * @param {number} [partSize=5242880] 5MB
   */
  async uploadMultipart(key, buffer, partSize = 5242880) {
    const uploadUrl = `${this.getObjectUrl(key)}?uploads`;
    const initRes = await this._fetchWithRetry('POST', uploadUrl);
    const initXml = await initRes.text();

    const parser = new XMLParser({ ignoreAttributes: false });
    const initObj = parser.parse(initXml);
    const uploadId = initObj.InitiateMultipartUploadResult?.UploadId;

    if (!uploadId) {
      throw new NetworkError('uploadMultipart', 'Failed to retrieve UploadId from S3 multipart initialization response.');
    }

    const parts = [];
    let offset = 0;
    let partNumber = 1;

    try {
      while (offset < buffer.length) {
        const end = Math.min(offset + partSize, buffer.length);
        const partBuffer = buffer.subarray(offset, end);
        const partUrl = `${this.getObjectUrl(key)}?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`;

        const partRes = await this._fetchWithRetry('PUT', partUrl, {
          body: partBuffer,
          headers: {
            'content-length': String(partBuffer.length)
          }
        });

        const etag = (partRes.headers.get('etag') || '').replace(/^"+|"+$/g, '');
        parts.push({ PartNumber: partNumber, ETag: `"${etag}"` });

        offset = end;
        partNumber++;
      }

      // Complete Multipart Upload
      const completeUrl = `${this.getObjectUrl(key)}?uploadId=${encodeURIComponent(uploadId)}`;
      let completeXml = '<CompleteMultipartUpload>';
      for (const p of parts) {
        completeXml += `<Part><PartNumber>${p.PartNumber}</PartNumber><ETag>${p.ETag}</ETag></Part>`;
      }
      completeXml += '</CompleteMultipartUpload>';

      await this._fetchWithRetry('POST', completeUrl, {
        body: Buffer.from(completeXml, 'utf-8'),
        headers: {
          'content-type': 'application/xml'
        }
      });

      return { success: true, hash: Hasher.hash(buffer) };

    } catch (err) {
      // Abort failed multipart upload to avoid orphaned storage charges
      try {
        const abortUrl = `${this.getObjectUrl(key)}?uploadId=${encodeURIComponent(uploadId)}`;
        await this._fetchWithRetry('DELETE', abortUrl);
      } catch (_) {}
      throw err;
    }
  }

  /**
   * Upload chunk convenience method.
   */
  async uploadChunk(chunkHash, chunkBuffer) {
    return this.putObject(`chunks/${chunkHash}`, chunkBuffer);
  }

  /**
   * Download chunk convenience method.
   */
  async downloadChunk(chunkHash) {
    return this.getObject(`chunks/${chunkHash}`);
  }

  /**
   * Get remote branch ref commit hash.
   * @param {string} branchName 
   * @returns {Promise<string|null>}
   */
  async getRef(branchName) {
    if (this.simulateNetworkFailure) {
      throw new NetworkError('getRef', 'Network connection refused', new Error('ECONNREFUSED'));
    }

    if (this.isMock) {
      return this.mockRefs.get(branchName) || null;
    }

    const refKey = `refs/heads/${branchName}`;
    try {
      const buf = await this.getObject(refKey);
      const data = JSON.parse(buf.toString('utf-8'));
      return data.commitHash || null;
    } catch (err) {
      if (err.message.includes('not found')) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Update remote branch ref with compare-and-swap conflict detection.
   * @param {string} branchName 
   * @param {string} newCommitHash 
   * @param {string|null} [expectedOldHash=null] 
   */
  async updateRef(branchName, newCommitHash, expectedOldHash = null) {
    if (this.simulateNetworkFailure) {
      throw new NetworkError('updateRef', 'Network connection refused', new Error('ECONNREFUSED'));
    }

    if (this.isMock) {
      const currentRemote = this.mockRefs.get(branchName) || null;
      if (expectedOldHash !== null && currentRemote !== expectedOldHash) {
        throw new ConflictError(
          `Remote branch '${branchName}' has diverged (remote: ${currentRemote ? currentRemote.slice(0, 8) : 'null'}, expected: ${expectedOldHash ? expectedOldHash.slice(0, 8) : 'null'}). Pull remote changes first.`,
          currentRemote,
          newCommitHash
        );
      }
      this.mockRefs.set(branchName, newCommitHash);
      return { success: true, branch: branchName, commitHash: newCommitHash };
    }

    // Real Remote CAS Ref Update
    const currentRemote = await this.getRef(branchName);
    if (expectedOldHash !== null && currentRemote !== expectedOldHash) {
      throw new ConflictError(
        `Remote branch '${branchName}' has diverged (remote: ${currentRemote ? currentRemote.slice(0, 8) : 'null'}, expected: ${expectedOldHash ? expectedOldHash.slice(0, 8) : 'null'}). Pull remote changes first.`,
        currentRemote,
        newCommitHash
      );
    }

    const refKey = `refs/heads/${branchName}`;
    const payload = Buffer.from(JSON.stringify({
      branch: branchName,
      commitHash: newCommitHash,
      updatedAt: Date.now()
    }), 'utf-8');

    await this.putObject(refKey, payload);
    return { success: true, branch: branchName, commitHash: newCommitHash };
  }
}

module.exports = { CloudClient, ConflictError, NetworkError };
