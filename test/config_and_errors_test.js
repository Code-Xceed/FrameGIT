/**
 * FrameGit Phase 13 Test Suite: Configuration & Error Hardening
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  loadConfig,
  setConfigValue,
  getAuthor,
  DEFAULTS
} = require('../core/config');
const {
  FrameGitError,
  DiskFullError,
  FileNotFoundError,
  CorruptDataError,
  AuthorNotConfiguredError,
  safeJsonParse,
  wrapFsOperation
} = require('../core/errors');

test('Configuration System - Defaults and Overrides', () => {
  const config = loadConfig();
  assert.strictEqual(config.version, '1.0.0');
  assert.strictEqual(config.storage.hashAlgorithm, 'blake2s256');
  assert.strictEqual(config.storage.chunkTargetSize, 1048576);
  assert.strictEqual(config.daemon.port, 41793);
  assert.strictEqual(config.project.defaultBranch, 'main');

  // Overrides
  const customConfig = loadConfig({
    overrides: {
      daemon: { port: 50000 },
      user: { name: 'Lead Alice', email: 'alice@post.studio' }
    }
  });
  assert.strictEqual(customConfig.daemon.port, 50000);
  const author = getAuthor(customConfig);
  assert.strictEqual(author.name, 'Lead Alice');
  assert.strictEqual(author.email, 'alice@post.studio');

  // Immutability check
  assert.throws(() => {
    config.storage.hashAlgorithm = 'sha256';
  });
});

test('Configuration System - Author requirement check', () => {
  assert.throws(() => {
    loadConfig({
      overrides: { user: { name: '', email: '' } },
      requireAuthor: true
    });
  }, AuthorNotConfiguredError);
});

test('Error System - Typed Errors and Wrapping', () => {
  // Safe JSON Parse on valid string
  const valid = safeJsonParse('{"status":"active","val":42}', 'test payload');
  assert.strictEqual(valid.status, 'active');
  assert.strictEqual(valid.val, 42);

  // Safe JSON Parse on corrupted string throws CorruptDataError with snippet
  assert.throws(() => {
    safeJsonParse('{"status": broken_json_here...', 'corrupted metadata');
  }, (err) => {
    assert.strictEqual(err.name, 'CorruptDataError');
    assert.strictEqual(err.code, 'CORRUPT_DATA');
    assert.strictEqual(err.details.context, 'corrupted metadata');
    assert.ok(err.details.snippet.includes('broken_json_here'));
    return true;
  });

  // wrapFsOperation translates ENOENT into FileNotFoundError
  assert.throws(() => {
    wrapFsOperation(() => fs.readFileSync('non_existent_file_xyz_123.bin'), 'non_existent_file_xyz_123.bin', 'read');
  }, (err) => {
    assert.strictEqual(err.name, 'FileNotFoundError');
    assert.strictEqual(err.code, 'FILE_NOT_FOUND');
    return true;
  });
});
