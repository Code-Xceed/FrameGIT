'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { UserStore } = require('../desktop/user_store');

test('UserStore - Local-first user settings and vault encryption', async (t) => {
  const tmpDir = path.join(os.tmpdir(), `framegit-userstore-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  await t.test('Initializes with default settings and first-run status', () => {
    const store = new UserStore({ dataDir: tmpDir });
    assert.strictEqual(store.isSetupCompleted(), false);
    const settings = store.getSettings();
    assert.strictEqual(settings.version, 1);
    assert.strictEqual(settings.theme, 'dark');
    assert.strictEqual(settings.autoStartBackgroundService, true);
    assert.strictEqual(settings.user.username, null);
  });

  await t.test('Securely stores GitHub token in vault and profile in settings', () => {
    const store = new UserStore({ dataDir: tmpDir });
    const fakeToken = 'ghp_testToken1234567890abcdefghijklmnopqrst';
    store.saveGitHubAuth({
      token: fakeToken,
      username: 'editor-pro',
      name: 'Editor Pro',
      email: 'editor@example.com',
      avatarUrl: 'https://example.com/avatar.png'
    });

    // Check credentials in vault
    const auth = store.getGitHubAuth();
    assert.strictEqual(auth.hasToken, true);
    assert.strictEqual(auth.token, fakeToken);
    assert.strictEqual(auth.user.username, 'editor-pro');
    assert.strictEqual(auth.user.name, 'Editor Pro');

    // Confirm token is NOT written in plain text in settings.json
    const rawSettings = fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf8');
    assert.strictEqual(rawSettings.includes(fakeToken), false, 'Token must not be stored in plain text');

    // Confirm encrypted vault file exists
    assert.strictEqual(fs.existsSync(path.join(tmpDir, 'credentials.enc')), true);
  });

  await t.test('Completes setup flow and marks setupCompleted', () => {
    const store = new UserStore({ dataDir: tmpDir });
    assert.strictEqual(store.isSetupCompleted(), false);

    store.completeSetup({
      autoStartService: true,
      plugins: { premiere: true, resolve: false }
    });

    assert.strictEqual(store.isSetupCompleted(), true);
    const settings = store.getSettings();
    assert.strictEqual(settings.setupCompleted, true);
    assert.ok(settings.setupCompletedAt);
    assert.strictEqual(settings.plugins.premiere, true);
    assert.strictEqual(settings.plugins.resolve, false);
  });

  await t.test('Can clear GitHub auth securely', () => {
    const store = new UserStore({ dataDir: tmpDir });
    store.clearGitHubAuth();
    const auth = store.getGitHubAuth();
    assert.strictEqual(auth.hasToken, false);
    assert.strictEqual(auth.token, null);
    assert.strictEqual(auth.user.username, null);
  });
});
