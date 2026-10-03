/**
 * Test: FrameGit Desktop Studio & Session Management
 * Validates persistent sessions, account lifecycle, project tracking,
 * and checkpoint operations in DesktopServer.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { UserStore } = require('../desktop/user_store');
const { DesktopServer } = require('../desktop/main');
const { VersionEngine } = require('../core/version_engine');

const zlib = require('node:zlib');

function makeRequest(port, method, pathname, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let resBody = '';
      res.on('data', chunk => resBody += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(resBody) });
        } catch (_) {
          resolve({ status: res.statusCode, raw: resBody });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function createSamplePrprojXml() {
  return `<?xml version="1.0" encoding="UTF-8" ?>
<PremiereData Version="3">
  <Project ObjectID="1" Name="Commercial">
    <Media ObjectID="med1" FilePath="Footage/Shot1.mov" Name="Shot1.mov" />
    <Sequence ObjectID="seq1" Name="Main_Sequence" Duration="120960000000">
      <TrackItem ObjectID="c1" TrackIndex="1" TrackType="video" Name="Shot1.mov" MediaID="med1" Start="0" End="120960000000" In="0" Out="120960000000">
        <Component DisplayName="Lumetri Color">
          <Parameter Name="Exposure" CurrentValue="0.0" />
        </Component>
      </TrackItem>
    </Sequence>
  </Project>
</PremiereData>`;
}

test('Desktop Studio & Session Management Endpoints', async (t) => {
  const tmpDir = path.join(os.tmpdir(), `framegit-studio-test-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  // Setup test project directory with gzipped .prproj
  const projectDir = path.join(tmpDir, 'Commercial_Cut');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'Commercial.prproj'), zlib.gzipSync(Buffer.from(createSamplePrprojXml(), 'utf8')));

  const testStore = new UserStore({ dataDir: tmpDir });
  const server = new DesktopServer(0, { userStore: testStore });
  const testPort = await server.start();

  t.after(() => {
    server.stop();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  await t.test('1. Inspects uninitialized project directory and auto-initializes repository', async () => {
    const res = await makeRequest(testPort, 'POST', '/api/desktop/project/inspect', { path: projectDir });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.name, 'Commercial.prproj');
    assert.strictEqual(res.data.type, 'premiere');
    assert.strictEqual(res.data.currentBranch, 'main');
    assert.ok(Array.isArray(res.data.branches));
    assert.ok(Array.isArray(res.data.history));
  });

  await t.test('2. Creates a timeline checkpoint with author sync', async () => {
    const res = await makeRequest(testPort, 'POST', '/api/desktop/project/commit', {
      projectPath: projectDir,
      message: 'Initial assembly cut'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.commit.commitHash);

    // Re-inspect to verify checkpoint is in history
    const inspectRes = await makeRequest(testPort, 'POST', '/api/desktop/project/inspect', { path: projectDir });
    assert.strictEqual(inspectRes.status, 200);
    assert.strictEqual(inspectRes.data.history.length, 1);
    assert.strictEqual(inspectRes.data.history[0].message, 'Initial assembly cut');
  });

  await t.test('3. Computes visual diff on project', async () => {
    const res = await makeRequest(testPort, 'POST', '/api/desktop/project/diff', { path: projectDir });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(typeof res.data.ascii, 'string');
  });

  await t.test('4. Tracks and lists registered projects', async () => {
    const registerRes = await makeRequest(testPort, 'POST', '/api/desktop/projects/register', {
      path: projectDir,
      meta: { title: 'Commercial Cut' }
    });
    assert.strictEqual(registerRes.status, 200);
    assert.strictEqual(registerRes.data.success, true);

    const listRes = await makeRequest(testPort, 'GET', '/api/desktop/projects');
    assert.strictEqual(listRes.status, 200);
    assert.ok(Array.isArray(listRes.data));
    assert.ok(listRes.data.some(p => p.path === projectDir));
  });

  await t.test('5. Manages tracked projects list and removal', async () => {
    testStore.addTrackedProject(projectDir);
    const trackedRes = await makeRequest(testPort, 'GET', '/api/desktop/projects/tracked');
    assert.strictEqual(trackedRes.status, 200);
    assert.ok(Array.isArray(trackedRes.data));
    assert.ok(trackedRes.data.some(p => p.path === projectDir));

    const removeRes = await makeRequest(testPort, 'POST', '/api/desktop/project/remove', { path: projectDir });
    assert.strictEqual(removeRes.status, 200);
    assert.strictEqual(removeRes.data.success, true);

    const afterRemoveRes = await makeRequest(testPort, 'GET', '/api/desktop/projects/tracked');
    assert.strictEqual(afterRemoveRes.status, 200);
    assert.ok(!afterRemoveRes.data.some(p => p.path === projectDir));
  });

  await t.test('6. Restores project file to a previous checkpoint', async () => {
    // Commit 1 already created
    const inspectRes = await makeRequest(testPort, 'POST', '/api/desktop/project/inspect', { path: projectDir });
    const firstCommitHash = inspectRes.data.history[0].commitHash || inspectRes.data.history[0].hash;

    // Create Commit 2
    fs.writeFileSync(path.join(projectDir, 'Commercial.prproj'), zlib.gzipSync(Buffer.from(createSamplePrprojXml(), 'utf8')));
    const commit2Res = await makeRequest(testPort, 'POST', '/api/desktop/project/commit', {
      projectPath: projectDir,
      message: 'Second commit before restore test'
    });
    assert.strictEqual(commit2Res.data.success, true);

    // Restore to Commit 1
    const restoreRes = await makeRequest(testPort, 'POST', '/api/desktop/project/restore', {
      projectPath: projectDir,
      commitHash: firstCommitHash,
      force: true
    });
    assert.strictEqual(restoreRes.status, 200);
    assert.strictEqual(restoreRes.data.success, true);
    assert.strictEqual(restoreRes.data.commitHash, firstCommitHash);
  });

  await t.test('7. Handles shell reveal and open endpoints', async () => {
    const revealRes = await makeRequest(testPort, 'POST', '/api/desktop/shell/reveal', { path: projectDir });
    assert.strictEqual(revealRes.status, 200);
    assert.strictEqual(revealRes.data.success, true);

    const badReveal = await makeRequest(testPort, 'POST', '/api/desktop/shell/reveal', { path: '/invalid/path/1234' });
    assert.strictEqual(badReveal.status, 400);
    assert.strictEqual(badReveal.data.success, false);
  });

  await t.test('8. Queries remote info for project', async () => {
    const remoteRes = await makeRequest(testPort, 'POST', '/api/desktop/project/remote-info', { projectPath: projectDir });
    assert.strictEqual(remoteRes.status, 200);
    assert.strictEqual(remoteRes.data.success, true);
    assert.strictEqual(remoteRes.data.isLinked, false);
    assert.strictEqual(remoteRes.data.currentBranch, 'main');
  });

  await t.test('9. Discards uncommitted modifications on disk', async () => {
    // Write an uncommitted change to the project file
    fs.writeFileSync(path.join(projectDir, 'Commercial.prproj'), zlib.gzipSync(Buffer.from(createSamplePrprojXml(), 'utf8')));
    const discardRes = await makeRequest(testPort, 'POST', '/api/desktop/project/discard', { projectPath: projectDir });
    assert.strictEqual(discardRes.status, 200);
    assert.strictEqual(discardRes.data.success, true);
    assert.ok(discardRes.data.headHash);
  });

  await t.test('10. Ensures creative integrations are deployed', async () => {
    const pluginRes = await makeRequest(testPort, 'POST', '/api/desktop/plugins/ensure-installed');
    assert.strictEqual(pluginRes.status, 200);
    assert.strictEqual(pluginRes.data.success, true);
    assert.ok('premiere' in pluginRes.data);
    assert.ok('resolve' in pluginRes.data);
  });
});
