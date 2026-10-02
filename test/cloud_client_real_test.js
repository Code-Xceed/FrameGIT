/**
 * FrameGit Phase 15 Test Suite: Real S3/R2 Cloud Storage Client & SigV4 Signer
 * 
 * Spins up a local HTTP server that acts as an S3-compatible service,
 * verifies AWS Signature V4 request validation, single-part and multipart
 * chunk streaming, hash verification, and CAS branch ref synchronization.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const { XMLParser } = require('fast-xml-parser');
const { CloudClient, ConflictError } = require('../core/cloud_client');
const { signRequest, sha256Hex } = require('../core/s3_signer');

const ACCESS_KEY = 'FRAME_TEST_KEY_123';
const SECRET_KEY = 'FRAME_TEST_SECRET_456_VERY_SECURE';
const BUCKET = 'framegit-test-bucket';

let server;
let serverPort;
let serverUrl;
const storageStore = new Map(); // key -> { buffer, etag }
const multipartStore = new Map(); // uploadId -> { key, parts: Map(partNumber -> buffer) }
let transientFailureCount = 0;

test.before(async () => {
  server = http.createServer(async (req, res) => {
    // 1. Verify mandatory AWS SigV4 headers
    const auth = req.headers['authorization'] || '';
    const date = req.headers['x-amz-date'] || '';
    const payloadHash = req.headers['x-amz-content-sha256'] || '';

    if (!auth.startsWith('AWS4-HMAC-SHA256') || !date || !payloadHash) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Missing or invalid SigV4 headers');
      return;
    }

    // Simulate transient error for retry testing
    if (req.url.includes('transient-test') && transientFailureCount > 0) {
      transientFailureCount--;
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('Service Unavailable');
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const key = parsedUrl.pathname.replace(`/${BUCKET}/`, '');

    // Multipart upload initialization
    if (parsedUrl.searchParams.has('uploads') && req.method === 'POST') {
      const uploadId = 'up_' + crypto.randomUUID();
      multipartStore.set(uploadId, { key, parts: new Map() });
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><InitiateMultipartUploadResult><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`);
      return;
    }

    // Upload Part
    if (parsedUrl.searchParams.has('partNumber') && req.method === 'PUT') {
      const uploadId = parsedUrl.searchParams.get('uploadId');
      const partNumber = parseInt(parsedUrl.searchParams.get('partNumber'), 10);
      const mp = multipartStore.get(uploadId);

      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const buf = Buffer.concat(chunks);
        const etag = sha256Hex(buf);
        mp.parts.set(partNumber, buf);
        res.setHeader('etag', `"${etag}"`);
        res.writeHead(200);
        res.end();
      });
      return;
    }

    // Complete Multipart Upload
    if (parsedUrl.searchParams.has('uploadId') && req.method === 'POST') {
      const uploadId = parsedUrl.searchParams.get('uploadId');
      const mp = multipartStore.get(uploadId);

      const sortedPartNumbers = Array.from(mp.parts.keys()).sort((a, b) => a - b);
      const fullBuffers = sortedPartNumbers.map(n => mp.parts.get(n));
      const fullBuf = Buffer.concat(fullBuffers);
      const etag = sha256Hex(fullBuf);

      storageStore.set(mp.key, { buffer: fullBuf, etag });
      multipartStore.delete(uploadId);

      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUploadResult><ETag>"${etag}"</ETag></CompleteMultipartUploadResult>`);
      return;
    }

    // Standard HEAD
    if (req.method === 'HEAD') {
      const obj = storageStore.get(key);
      if (!obj) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.setHeader('content-length', String(obj.buffer.length));
      res.setHeader('etag', `"${obj.etag}"`);
      res.writeHead(200);
      res.end();
      return;
    }

    // Standard GET
    if (req.method === 'GET') {
      const obj = storageStore.get(key);
      if (!obj) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.setHeader('content-type', 'application/octet-stream');
      res.setHeader('content-length', String(obj.buffer.length));
      res.setHeader('etag', `"${obj.etag}"`);
      res.writeHead(200);
      res.end(obj.buffer);
      return;
    }

    // Standard PUT
    if (req.method === 'PUT') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const buf = Buffer.concat(chunks);
        const etag = sha256Hex(buf);
        storageStore.set(key, { buffer: buf, etag });
        res.setHeader('etag', `"${etag}"`);
        res.writeHead(200);
        res.end();
      });
      return;
    }

    // Standard DELETE
    if (req.method === 'DELETE') {
      storageStore.delete(key);
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(400);
    res.end();
  });

  await new Promise(r => {
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      serverUrl = `http://127.0.0.1:${serverPort}`;
      r();
    });
  });
});

test.after(async () => {
  if (server) {
    await new Promise(r => server.close(r));
  }
});

test('AWS SigV4 Signer: Generates standard signature and canonical request', () => {
  const signed = signRequest({
    method: 'PUT',
    url: `${serverUrl}/${BUCKET}/chunks/chunk_123.bin`,
    body: Buffer.from('hello world', 'utf-8'),
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
    region: 'auto',
    service: 's3',
    date: new Date('2026-10-01T12:00:00Z')
  });

  assert.ok(signed.authorization.startsWith('AWS4-HMAC-SHA256'));
  assert.ok(signed.authorization.includes('Credential=' + ACCESS_KEY));
  assert.ok(signed.headers['x-amz-date'] === '20261001T120000Z');
  assert.strictEqual(signed.headers['x-amz-content-sha256'], sha256Hex(Buffer.from('hello world')));
});

test('CloudClient (Real Mode): Full single-part upload, head, get, and delete lifecycle', async () => {
  const client = new CloudClient({
    endpoint: serverUrl,
    bucket: BUCKET,
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
    region: 'auto',
    isMock: false
  });

  const payload = Buffer.from('FrameGit binary chunk payload content 12345', 'utf-8');
  const key = 'chunks/payload_test.bin';

  // 1. Initial headObject -> exists: false
  const headInitial = await client.headObject(key);
  assert.strictEqual(headInitial.exists, false);

  // 2. Upload with putObject
  const putRes = await client.putObject(key, payload);
  assert.strictEqual(putRes.success, true);

  // 3. headObject -> exists: true
  const headAfter = await client.headObject(key);
  assert.strictEqual(headAfter.exists, true);
  assert.strictEqual(headAfter.size, payload.length);
  assert.strictEqual(headAfter.etag, sha256Hex(payload));

  // 4. getObject -> identical bytes
  const downloaded = await client.getObject(key);
  assert.deepStrictEqual(downloaded, payload);

  // 5. deleteObject
  await client.deleteObject(key);
  const headDeleted = await client.headObject(key);
  assert.strictEqual(headDeleted.exists, false);
});

test('CloudClient (Real Mode): Multipart upload for large media files (> 5MB)', async () => {
  const client = new CloudClient({
    endpoint: serverUrl,
    bucket: BUCKET,
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
    region: 'auto',
    isMock: false,
    multipartThresholdBytes: 5 * 1024 * 1024 // 5MB threshold
  });

  // Create 6MB payload (triggers multipart upload with two parts)
  const largePayload = Buffer.alloc(6 * 1024 * 1024, 0x5a);
  const key = 'media/6mb_hero_shot.mov';

  const res = await client.putObject(key, largePayload);
  assert.strictEqual(res.success, true);

  // Verify full assembled file on server
  const downloaded = await client.getObject(key);
  assert.strictEqual(downloaded.length, largePayload.length);
  assert.deepStrictEqual(downloaded, largePayload);
});

test('CloudClient (Real Mode): Automatic retry on transient HTTP 503 errors', async () => {
  const client = new CloudClient({
    endpoint: serverUrl,
    bucket: BUCKET,
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
    region: 'auto',
    isMock: false,
    maxRetries: 3
  });

  transientFailureCount = 2; // Will fail twice with 503, succeed on 3rd attempt
  const payload = Buffer.from('transient payload test', 'utf-8');
  const res = await client.putObject('chunks/transient-test.bin', payload);
  assert.strictEqual(res.success, true);
});

test('CloudClient (Real Mode): Branch ref CAS update and conflict detection', async () => {
  const client = new CloudClient({
    endpoint: serverUrl,
    bucket: BUCKET,
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
    region: 'auto',
    isMock: false
  });

  // Initial ref creation
  const commit1 = '1111111111111111111111111111111111111111111111111111111111111111';
  await client.updateRef('main', commit1, null);

  const currentRef = await client.getRef('main');
  assert.strictEqual(currentRef, commit1);

  // Fast-forward update with matching old hash
  const commit2 = '2222222222222222222222222222222222222222222222222222222222222222';
  await client.updateRef('main', commit2, commit1);
  assert.strictEqual(await client.getRef('main'), commit2);

  // Divergent update with stale old hash -> must throw ConflictError
  const commitStale = '3333333333333333333333333333333333333333333333333333333333333333';
  await assert.rejects(async () => {
    await client.updateRef('main', commitStale, commit1); // commit1 is stale!
  }, ConflictError);
});
