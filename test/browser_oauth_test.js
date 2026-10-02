'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { GitHubAuth } = require('../core/github_auth');
const { UserStore } = require('../desktop/user_store');
const { DesktopServer } = require('../desktop/main');

test('GitHub 1-Click Browser OAuth Architecture & Storage', async (t) => {
  const tmpDir = path.join(os.tmpdir(), `framegit-oauth-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  await t.test('1. Generates official GitHub authorization URL with full repo scope and PKCE', () => {
    const auth = new GitHubAuth({ clientId: 'test-client-123' });
    const pkce = GitHubAuth.generatePkce();
    assert.ok(pkce.verifier && pkce.verifier.length > 20);
    assert.ok(pkce.challenge && pkce.challenge.length > 20);
    assert.strictEqual(pkce.method, 'S256');

    const url = auth.getAuthorizationUrl({
      redirectUri: 'http://127.0.0.1:41793/oauth/callback',
      state: 'secret-state-xyz',
      scope: 'repo,read:user,user:email',
      codeChallenge: pkce.challenge,
      codeChallengeMethod: pkce.method
    });

    assert.ok(url.startsWith('https://github.com/login/oauth/authorize?'));
    const parsed = new URL(url);
    assert.strictEqual(parsed.searchParams.get('client_id'), 'test-client-123');
    assert.strictEqual(parsed.searchParams.get('redirect_uri'), 'http://127.0.0.1:41793/oauth/callback');
    assert.strictEqual(parsed.searchParams.get('state'), 'secret-state-xyz');
    assert.strictEqual(parsed.searchParams.get('scope'), 'repo,read:user,user:email');
    assert.strictEqual(parsed.searchParams.get('code_challenge'), pkce.challenge);
    assert.strictEqual(parsed.searchParams.get('code_challenge_method'), 'S256');
  });

  await t.test('2. UserStore safely persists Client ID and encrypts Client Secret in vault', () => {
    const store = new UserStore({ dataDir: tmpDir });
    store.setGitHubConfig({
      clientId: 'my-custom-client-id',
      clientSecret: 'super-secret-client-token'
    });

    const cfg = store.getGitHubConfig();
    assert.strictEqual(cfg.clientId, 'my-custom-client-id');
    assert.strictEqual(cfg.hasSecret, true);
    assert.strictEqual(cfg.clientSecret, 'super-secret-client-token');

    // Confirm secret is NOT in plaintext in settings.json
    const rawSettings = fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf8');
    assert.strictEqual(rawSettings.includes('super-secret-client-token'), false);
  });

  await t.test('3. DesktopServer handles /oauth/callback error states gracefully', async () => {
    const testPort = 41799;
    const server = new DesktopServer(testPort);
    await server.start();

    try {
      // Helper for HTTP requests
      const get = (urlPath) => new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${testPort}${urlPath}`, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        }).on('error', reject);
      });

      // Missing params -> 400
      const missingRes = await get('/oauth/callback');
      assert.strictEqual(missingRes.status, 400);

      // Cancelled by user on GitHub -> 200 HTML with cancellation notice
      const cancelRes = await get('/oauth/callback?error=access_denied&error_description=User+cancelled');
      assert.strictEqual(cancelRes.status, 200);
      assert.ok(cancelRes.body.includes('Authorization Cancelled'));

    } finally {
      server.stop();
    }
  });
});
