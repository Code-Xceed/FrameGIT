/**
 * FrameGit Phase 18 Test Suite: Secure Credential Vault & HMAC IPC Auth
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { CredentialVault } = require('../core/vault');
const { IPCServer } = require('../core/ipc_server');

test('CredentialVault - AES-256-GCM Secure Storage & Tamper Resistance', () => {
  const tempDir = path.join(__dirname, 'temp_vault');
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    const vaultPath = path.join(tempDir, 'credentials.enc');
    const saltPath = path.join(tempDir, '.vault_salt');
    const vault = new CredentialVault({ vaultPath, saltPath, masterKey: 'unit-test-master-passphrase-2026' });

    // 1. Initial state
    assert.strictEqual(vault.hasSecret('github.token'), false);
    assert.strictEqual(vault.getSecret('github.token'), null);
    assert.deepStrictEqual(vault.listKeys(), []);

    // 2. Store sensitive credentials
    vault.setSecret('github.token', 'gho_SuperSecretToken1234567890');
    vault.setSecret('cloud.accessKeyId', 'R2_ACCESS_KEY_ALPHA');
    vault.setSecret('cloud.secretAccessKey', 'R2_SECRET_KEY_BRAVO_9999');

    // 3. Retrieve credentials
    assert.strictEqual(vault.hasSecret('github.token'), true);
    assert.strictEqual(vault.getSecret('github.token'), 'gho_SuperSecretToken1234567890');
    assert.strictEqual(vault.getSecret('cloud.accessKeyId'), 'R2_ACCESS_KEY_ALPHA');
    assert.strictEqual(vault.getSecret('cloud.secretAccessKey'), 'R2_SECRET_KEY_BRAVO_9999');

    const keys = vault.listKeys();
    assert.strictEqual(keys.length, 3);
    assert.ok(keys.includes('github.token'));
    assert.ok(keys.includes('cloud.accessKeyId'));
    assert.ok(keys.includes('cloud.secretAccessKey'));

    // 4. Verify on-disk ciphertext has NO plain-text leakage
    const rawDiskContent = fs.readFileSync(vaultPath, 'utf8');
    assert.ok(!rawDiskContent.includes('gho_SuperSecretToken1234567890'), 'Plaintext GitHub token leaked to disk!');
    assert.ok(!rawDiskContent.includes('R2_ACCESS_KEY_ALPHA'), 'Plaintext access key leaked to disk!');
    assert.ok(!rawDiskContent.includes('R2_SECRET_KEY_BRAVO_9999'), 'Plaintext secret key leaked to disk!');

    const parsedDisk = JSON.parse(rawDiskContent);
    assert.strictEqual(parsedDisk.version, 1);
    assert.strictEqual(parsedDisk.algorithm, 'aes-256-gcm');
    assert.ok(parsedDisk.iv && parsedDisk.iv.length === 24); // 12 bytes = 24 hex chars
    assert.ok(parsedDisk.tag && parsedDisk.tag.length === 32); // 16 bytes = 32 hex chars
    assert.ok(parsedDisk.data && parsedDisk.data.length > 0);

    // 5. Delete secret
    const deleted = vault.deleteSecret('cloud.accessKeyId');
    assert.strictEqual(deleted, true);
    assert.strictEqual(vault.hasSecret('cloud.accessKeyId'), false);
    assert.strictEqual(vault.getSecret('cloud.accessKeyId'), null);
    assert.strictEqual(vault.listKeys().length, 2);

    // 6. Tamper resistance (tampering ciphertext causes safe empty load)
    parsedDisk.data = '00' + parsedDisk.data.slice(2);
    fs.writeFileSync(vaultPath, JSON.stringify(parsedDisk));
    const tamperedVault = new CredentialVault({ vaultPath, saltPath, masterKey: 'unit-test-master-passphrase-2026' });
    assert.strictEqual(tamperedVault.getSecret('github.token'), null);

  } finally {
    try {
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
});

test('IPC Server - Session-Bound HMAC Authentication & Rotation', async () => {
  const tempDir = path.join(__dirname, 'temp_ipc_workspace');
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempDir, { recursive: true });

  const mockEngine = {
    rootPath: tempDir,
    projectFilePath: path.join(tempDir, 'Test.prproj'),
    status: () => ({ hasChanges: false, changes: [] }),
    getCurrentBranch: () => 'main',
    getHeadCommitHash: () => 'abcdef1234567890'
  };

  const ipcServer = new IPCServer(mockEngine, null, 0); // Port 0 for random ephemeral port

  function postRpc(port, token, payload) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(payload);
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/api/rpc',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(body) }));
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  function getHealth(port) {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/health`, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(body) }));
      }).on('error', reject);
    });
  }

  try {
    const boundPort = await ipcServer.start();
    const actualPort = ipcServer.server.address().port;

    // 1. Verify agent.auth written
    const authFile = path.join(tempDir, '.framegit', 'agent.auth');
    assert.ok(fs.existsSync(authFile));
    const authInfo = JSON.parse(fs.readFileSync(authFile, 'utf8'));

    // 2. Token format validation: <timestamp>.<nonce>.<sig>
    const tokenParts = authInfo.token.split('.');
    assert.strictEqual(tokenParts.length, 3);
    assert.ok(Number(tokenParts[0]) > 0);
    assert.strictEqual(tokenParts[1].length, 32); // 16 bytes = 32 hex
    assert.strictEqual(tokenParts[2].length, 64); // SHA-256 = 64 hex

    // 3. Public endpoint /health allows unauthenticated access
    const health = await getHealth(actualPort);
    assert.strictEqual(health.statusCode, 200);
    assert.strictEqual(health.body.status, 'ok');

    // 4. Authorized RPC call with minted HMAC token
    const res1 = await postRpc(actualPort, authInfo.token, {
      action: 'project.status',
      id: 1,
      params: {}
    });
    assert.strictEqual(res1.statusCode, 200);
    assert.strictEqual(res1.body.result.currentBranch, 'main');
    assert.strictEqual(res1.body.result.headCommit, 'abcdef12');

    // 5. Unauthorized call (missing token)
    const res2 = await postRpc(actualPort, null, { action: 'project.status', id: 2 });
    assert.strictEqual(res2.statusCode, 401);

    // 6. Forged token signature rejection
    const forgedToken = `${tokenParts[0]}.${tokenParts[1]}.${'0'.repeat(64)}`;
    const res3 = await postRpc(actualPort, forgedToken, { action: 'project.status', id: 3 });
    assert.strictEqual(res3.statusCode, 401);

    // 7. Expired token rejection (> 24h old timestamp with valid signature structure)
    const expiredTimestamp = Date.now() - (25 * 60 * 60 * 1000);
    const expiredNonce = crypto.randomBytes(16).toString('hex');
    const expiredSig = crypto.createHmac('sha256', ipcServer.sessionSecret)
      .update(`${expiredTimestamp}:${expiredNonce}`)
      .digest('hex');
    const expiredToken = `${expiredTimestamp}.${expiredNonce}.${expiredSig}`;

    const res4 = await postRpc(actualPort, expiredToken, { action: 'project.status', id: 4 });
    assert.strictEqual(res4.statusCode, 401);

    // 8. Token rotation
    const oldToken = authInfo.token;
    ipcServer.rotateToken();
    const rotatedAuth = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    assert.notStrictEqual(rotatedAuth.token, oldToken);

    // Both freshly rotated token and active token are accepted
    const res5 = await postRpc(actualPort, rotatedAuth.token, { action: 'project.status', id: 5 });
    assert.strictEqual(res5.statusCode, 200);

  } finally {
    await ipcServer.stop();
    try {
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
});
