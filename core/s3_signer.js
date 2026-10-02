/**
 * AWS Signature Version 4 Request Signer for S3-Compatible Storage
 * 
 * Supports AWS S3, Cloudflare R2, MinIO, and Backblaze B2.
 * Pure Node.js implementation using node:crypto with zero external dependencies.
 */

'use strict';

const crypto = require('node:crypto');

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data || '').digest('hex');
}

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function getSigningKey(secretAccessKey, dateStamp, region, service) {
  const kDate = hmacSha256('AWS4' + secretAccessKey, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

function formatIsoDate(d = new Date()) {
  const iso = d.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    dateTime: iso,                          // e.g. 20261001T123000Z
    dateStamp: iso.substring(0, 8)          // e.g. 20261001
  };
}

/**
 * URL encode according to RFC 3986
 */
function rfc3986Encode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * Sign an HTTP request with AWS Signature Version 4.
 * 
 * @param {Object} options
 * @param {string} options.method - HTTP method (GET, PUT, HEAD, DELETE, POST)
 * @param {string|URL} options.url - Full target URL
 * @param {Object} [options.headers={}] - Request headers
 * @param {Buffer|string|null} [options.body=null] - Request payload
 * @param {string} options.accessKeyId - AWS / R2 Access Key ID
 * @param {string} options.secretAccessKey - AWS / R2 Secret Access Key
 * @param {string} [options.region='auto'] - Storage region (e.g. 'auto', 'us-east-1')
 * @param {string} [options.service='s3'] - AWS service name ('s3')
 * @param {Date} [options.date] - Optional override for signing timestamp
 * @returns {{ headers: Object, authorization: string }} Signed headers ready for fetch()
 */
function signRequest(options) {
  const {
    method,
    url,
    headers = {},
    body = null,
    accessKeyId,
    secretAccessKey,
    region = 'auto',
    service = 's3',
    date = new Date()
  } = options;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('S3 Signer: accessKeyId and secretAccessKey are required.');
  }

  const parsedUrl = typeof url === 'string' ? new URL(url) : url;
  const { dateTime, dateStamp } = formatIsoDate(date);

  const payloadHash = body ? sha256Hex(body) : sha256Hex('');

  // Normalize headers
  const signHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined && v !== null) {
      signHeaders[k.toLowerCase()] = String(v).trim();
    }
  }

  // Host header is mandatory
  signHeaders['host'] = parsedUrl.host;
  signHeaders['x-amz-date'] = dateTime;
  signHeaders['x-amz-content-sha256'] = payloadHash;

  // 1. Build Canonical Headers & Signed Headers list
  const sortedHeaderKeys = Object.keys(signHeaders).sort();
  const canonicalHeaders = sortedHeaderKeys
    .map(k => `${k}:${signHeaders[k]}\n`)
    .join('');
  const signedHeaders = sortedHeaderKeys.join(';');

  // 2. Build Canonical URI & Canonical Query String
  const pathname = parsedUrl.pathname || '/';
  const canonicalUri = pathname.split('/').map(rfc3986Encode).join('/');

  const searchParams = new URLSearchParams(parsedUrl.search);
  const sortedParams = Array.from(searchParams.keys()).sort();
  const canonicalQuery = sortedParams
    .map(k => `${rfc3986Encode(k)}=${rfc3986Encode(searchParams.get(k) || '')}`)
    .join('&');

  // 3. Assemble Canonical Request
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');

  const hashedCanonicalRequest = sha256Hex(canonicalRequest);

  // 4. Build String to Sign
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    dateTime,
    credentialScope,
    hashedCanonicalRequest
  ].join('\n');

  // 5. Calculate Signature
  const signingKey = getSigningKey(secretAccessKey, dateStamp, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  // 6. Build Authorization Header
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  signHeaders['authorization'] = authorization;

  return {
    headers: signHeaders,
    authorization,
    canonicalRequest,
    stringToSign
  };
}

module.exports = {
  signRequest,
  sha256Hex,
  hmacSha256,
  formatIsoDate
};
