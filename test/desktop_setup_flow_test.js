'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { UserStore } = require('../desktop/user_store');
const { DesktopServer } = require('../desktop/main');
const { NleDetector } = require('../core/nle_detector');

test('Desktop App — First-Run Setup & Local-First Flow', async (t) => {
  const tmpDir = path.join(os.tmpdir(), `framegit-desktop-setup-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  await t.test('1. First-Run State Detection', () => {
    const store = new UserStore({ dataDir: tmpDir });
    assert.strictEqual(store.isSetupCompleted(), false, 'App should report first-run when not completed');
    const settings = store.getSettings();
    assert.strictEqual(settings.setupCompleted, false);
    assert.strictEqual(settings.autoStartBackgroundService, true);
  });

  await t.test('2. GitHub Local-First Vault Encryption', () => {
    const store = new UserStore({ dataDir: tmpDir });
    const dummyToken = 'ghp_secretOnboardingToken9876543210';
    store.saveGitHubAuth({
      token: dummyToken,
      username: 'videocreator',
      name: 'Creative Video Editor',
      email: 'creator@studio.com',
      avatarUrl: 'https://avatars.githubusercontent.com/u/12345'
    });

    const auth = store.getGitHubAuth();
    assert.strictEqual(auth.hasToken, true);
    assert.strictEqual(auth.token, dummyToken);
    assert.strictEqual(auth.user.username, 'videocreator');

    // Verify plaintext leak prevention
    const settingsJson = fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf8');
    assert.strictEqual(settingsJson.includes(dummyToken), false, 'Vault token must never be leaked to settings.json');

    // Verify encrypted file exists
    assert.strictEqual(fs.existsSync(path.join(tmpDir, 'credentials.enc')), true);
  });

  await t.test('3. Creative Editors Detection', () => {
    const detector = new NleDetector();
    const results = detector.detectAll();
    assert.ok(Array.isArray(results), 'Detector should return an array of detected installations');
  });

  await t.test('4. Complete Setup Wizard & Persistence', () => {
    const store = new UserStore({ dataDir: tmpDir });
    store.completeSetup({
      autoStartService: true,
      plugins: { premiere: true, resolve: true }
    });

    assert.strictEqual(store.isSetupCompleted(), true);
    const updated = store.getSettings();
    assert.strictEqual(updated.setupCompleted, true);
    assert.ok(updated.setupCompletedAt);
    assert.strictEqual(updated.plugins.premiere, true);
    assert.strictEqual(updated.plugins.resolve, true);
  });

  await t.test('5. Re-run / Reset Setup', () => {
    const store = new UserStore({ dataDir: tmpDir });
    store.resetSetup();
    assert.strictEqual(store.isSetupCompleted(), false);
    assert.strictEqual(store.getSettings().setupCompleted, false);
  });

  await t.test('6. Desktop Server HTTP API for Setup Flow', async () => {
    const testPort = 41798;
    const testStore = new UserStore({ dataDir: tmpDir });
    const server = new DesktopServer(testPort, { userStore: testStore });
    await server.start();

    try {
      // Helper function for HTTP requests
      const request = (pathName, method = 'GET', body = null) => {
        return new Promise((resolve, reject) => {
          const req = http.request({
            hostname: '127.0.0.1',
            port: testPort,
            path: pathName,
            method,
            headers: body ? { 'Content-Type': 'application/json' } : {}
          }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              try {
                resolve({ status: res.statusCode, body: JSON.parse(data) });
              } catch (_) {
                resolve({ status: res.statusCode, body: data });
              }
            });
          });
          req.on('error', reject);
          if (body) req.write(JSON.stringify(body));
          req.end();
        });
      };

      // Test GET /api/setup/status
      const stRes = await request('/api/setup/status');
      assert.strictEqual(stRes.status, 200);
      assert.ok('isSetupCompleted' in stRes.body);

      // Test POST /api/setup/save-github
      const saveRes = await request('/api/setup/save-github', 'POST', {
        username: 'test-user',
        name: 'Test User'
      });
      assert.strictEqual(saveRes.status, 200);
      assert.strictEqual(saveRes.body.success, true);

      // Test POST /api/setup/complete
      const compRes = await request('/api/setup/complete', 'POST', {
        autoStartService: true
      });
      assert.strictEqual(compRes.status, 200);
      assert.strictEqual(compRes.body.success, true);

      // Test POST /api/setup/reset
      const resetRes = await request('/api/setup/reset', 'POST');
      assert.strictEqual(resetRes.status, 200);
      assert.strictEqual(resetRes.body.success, true);

    } finally {
      server.stop();
    }
  });
});
