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

  const testPort = 42888;
  const testStore = new UserStore({ dataDir: tmpDir });
  const server = new DesktopServer(testPort, { userStore: testStore });
  await server.start();

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
});
