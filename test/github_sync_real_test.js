/**
 * FrameGit Phase 16 Test Suite: Real GitHub API & OAuth Device Flow
 * 
 * Spins up a local HTTP server emulating api.github.com and github.com/login,
 * validates OAuth 2.0 Device Flow polling and the Git Data API (Blobs, Trees, Commits, Refs, Tags).
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');

const { GitHubAuth } = require('../core/github_auth');
const { GitHubApiClient, GitHubSync } = require('../core/github_sync');
const { VersionEngine } = require('../core/version_engine');
const { Hasher } = require('../core/hasher');

const WORKSPACE = path.join(__dirname, 'github_real_workspace');
let server;
let serverPort;
let serverUrl;

let devicePollCount = 0;
const blobs = new Map();
const trees = new Map();
const commits = new Map();
const refs = new Map();
const tags = new Map();

test.before(async () => {
  if (fs.existsSync(WORKSPACE)) {
    fs.rmSync(WORKSPACE, { recursive: true, force: true });
  }
  fs.mkdirSync(WORKSPACE, { recursive: true });

  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const parsedBody = body ? JSON.parse(body) : {};

      // 1. Device Flow: Request code
      if (req.url === '/login/device/code' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          device_code: 'dev_code_12345',
          user_code: 'ABCD-5678',
          verification_uri: `${serverUrl}/login/device`,
          expires_in: 900,
          interval: 1
        }));
        return;
      }

      // 2. Device Flow: Poll token
      if (req.url === '/login/oauth/access_token' && req.method === 'POST') {
        devicePollCount++;
        if (devicePollCount < 2) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'authorization_pending' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          access_token: 'gho_real_authenticated_token_999',
          token_type: 'bearer',
          scope: 'repo,read:user'
        }));
        return;
      }

      // 3. User info
      if (req.url === '/user' && req.method === 'GET') {
        const auth = req.headers['authorization'] || '';
        if (!auth.includes('gho_')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Bad credentials' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ login: 'lead-editor-jane' }));
        return;
      }

      // 4. Git Blobs
      if (req.url.includes('/git/blobs') && req.method === 'POST') {
        const sha = Hasher.hash(Buffer.from(parsedBody.content || ''));
        blobs.set(sha, parsedBody.content);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sha }));
        return;
      }

      // 5. Git Trees
      if (req.url.includes('/git/trees') && req.method === 'POST') {
        const sha = 'tree_' + crypto.randomUUID().slice(0, 8);
        trees.set(sha, parsedBody.tree);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sha }));
        return;
      }

      // 6. Git Commits
      if (req.url.includes('/git/commits') && req.method === 'POST') {
        const sha = 'commit_' + crypto.randomUUID().slice(0, 8);
        commits.set(sha, parsedBody);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sha }));
        return;
      }

      // 7. Git Refs (GET)
      if (req.url.includes('/git/ref/heads/') && req.method === 'GET') {
        const branchName = req.url.split('/git/ref/heads/')[1];
        const sha = refs.get(`refs/heads/${branchName}`);
        if (!sha) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Not Found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ref: `refs/heads/${branchName}`, object: { sha } }));
        return;
      }

      // 8. Git Refs (POST create or PATCH update)
      if (req.url.includes('/git/refs') && req.method === 'POST') {
        refs.set(parsedBody.ref, parsedBody.sha);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ref: parsedBody.ref, object: { sha: parsedBody.sha } }));
        return;
      }

      if (req.url.includes('/git/refs/heads/') && req.method === 'PATCH') {
        const branchName = req.url.split('/git/refs/heads/')[1];
        refs.set(`refs/heads/${branchName}`, parsedBody.sha);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ref: `refs/heads/${branchName}`, object: { sha: parsedBody.sha } }));
        return;
      }

      // 9. Git Tags
      if (req.url.includes('/git/tags') && req.method === 'POST') {
        const sha = 'tag_' + crypto.randomUUID().slice(0, 8);
        tags.set(parsedBody.tag, { sha, ...parsedBody });
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sha }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Endpoint not handled by mock' }));
    });
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
  if (server) await new Promise(r => server.close(r));
  if (fs.existsSync(WORKSPACE)) {
    try {
      fs.rmSync(WORKSPACE, { recursive: true, force: true });
    } catch (_) {}
  }
});

test('GitHubAuth: OAuth Device Flow polling and token acquisition', async () => {
  const auth = new GitHubAuth({ baseUrl: serverUrl });
  const device = await auth.requestDeviceCode('repo,read:user');

  assert.strictEqual(device.userCode, 'ABCD-5678');
  assert.strictEqual(device.deviceCode, 'dev_code_12345');
  assert.ok(device.verificationUri.includes('/login/device'));

  const tokenResult = await auth.pollForToken(device.deviceCode, 1, 10);
  assert.strictEqual(tokenResult.accessToken, 'gho_real_authenticated_token_999');
  assert.strictEqual(tokenResult.tokenType, 'bearer');
});

test('GitHubApiClient: Authentication, Blob, Tree, and Commit Creation', async () => {
  const client = new GitHubApiClient({ baseUrl: serverUrl, token: 'gho_real_authenticated_token_999' });
  const auth = await client.authenticate('gho_real_authenticated_token_999');
  assert.strictEqual(auth.user, 'lead-editor-jane');

  // Push commit with files
  const files = [
    { path: '.framegit/manifest.json', content: '{"framegitCommit":"abc123"}' },
    { path: 'README.md', content: '# Project Title' }
  ];

  const result = await client.pushCommit('studio/commercial-ad', {
    branchName: 'main',
    commitHash: 'abc123commit',
    author: { name: 'Jane', email: 'jane@post.studio' },
    message: 'Initial commercial cut',
    files,
    committedAt: Date.now()
  });

  assert.ok(result.sha.startsWith('commit_'));
  assert.strictEqual(result.filesCount, 2);
  assert.strictEqual(refs.get('refs/heads/main'), result.sha);
});

test('GitHubSync: End-to-end branch synchronization to GitHub API', async () => {
  const projectFile = path.join(WORKSPACE, 'Commercial.prproj');
  const footageDir = path.join(WORKSPACE, 'Footage');
  fs.mkdirSync(footageDir, { recursive: true });

  const dummyFootage = path.join(footageDir, 'Take_01.mov');
  fs.writeFileSync(dummyFootage, Buffer.alloc(1024 * 512, 0x33));

  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?><PremiereData Version="3"><Project Name="Commercial"><Media FilePath="Footage/Take_01.mov" Name="Take_01.mov"/><Sequence Name="Sequence_1" Duration="100"/></Project></PremiereData>`;
  fs.writeFileSync(projectFile, zlib.gzipSync(Buffer.from(sampleXml, 'utf-8')));

  const engine = new VersionEngine(WORKSPACE, 'Commercial.prproj');
  engine.init();
  await engine.commit('Initial assembly cut');

  const githubSync = new GitHubSync(engine, {
    baseUrl: serverUrl,
    token: 'gho_real_authenticated_token_999'
  });

  const link = await githubSync.linkRepository('gho_real_authenticated_token_999', 'studio/commercial-edit');
  assert.strictEqual(link.linked, true);
  assert.strictEqual(link.user, 'lead-editor-jane');

  const syncResult = await githubSync.syncBranchToGitHub('main');
  assert.ok(syncResult.gitSha.startsWith('commit_'));
  assert.ok(syncResult.filesPushed >= 3, 'Must push manifest, pointers, and README');
  assert.ok(syncResult.totalManifestBytes > 0);

  // Test release tag
  const tagResult = await githubSync.createReleaseTag('v1.0.0', 'Picture Lock v1');
  assert.strictEqual(tagResult.name, 'v1.0.0');

  engine.db.close();
});
