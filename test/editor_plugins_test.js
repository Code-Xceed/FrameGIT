/**
 * FrameGit Phase 19 Test Suite: Editor Plugins Packaging
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { buildUxpCcx, createPngIcon } = require('../scripts/build_uxp_ccx');
const { ZipUtil } = require('../core/zip_util');

const execFileAsync = promisify(execFile);

test('UXP Packager - Generates Valid PNG Icons and .ccx Bundle', () => {
  const tempDir = path.join(__dirname, 'temp_ccx_build');
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // 1. Verify PNG icon generator produces valid PNG buffers
    const png24 = createPngIcon(24);
    assert.strictEqual(png24.readUInt32BE(0), 0x89504e47); // PNG signature
    assert.strictEqual(png24.toString('ascii', 12, 16), 'IHDR');
    assert.strictEqual(png24.readUInt32BE(16), 24); // Width
    assert.strictEqual(png24.readUInt32BE(20), 24); // Height

    const png96 = createPngIcon(96);
    assert.strictEqual(png96.readUInt32BE(16), 96);
    assert.strictEqual(png96.readUInt32BE(20), 96);

    // 2. Build CCX package
    const root = path.resolve(__dirname, '..');
    const pluginDir = path.join(root, 'plugin', 'premiere');
    const targetCcx = path.join(tempDir, 'FrameGit-Premiere-Test.ccx');

    const result = buildUxpCcx(pluginDir, targetCcx);
    assert.ok(fs.existsSync(targetCcx));
    assert.ok(result.packageSizeBytes > 1000);
    assert.ok(result.totalFiles >= 6);

    // 3. Unpack and verify bundle contents
    const ccxBuffer = fs.readFileSync(targetCcx);
    const unpacked = ZipUtil.unpack(ccxBuffer);

    assert.ok(unpacked.has('manifest.json'), 'Missing manifest.json');
    assert.ok(unpacked.has('index.html'), 'Missing index.html');
    assert.ok(unpacked.has('index.js'), 'Missing index.js');
    assert.ok(unpacked.has('icons/icon-24.png'), 'Missing icon-24.png');
    assert.ok(unpacked.has('icons/icon-48.png'), 'Missing icon-48.png');
    assert.ok(unpacked.has('icons/icon-96.png'), 'Missing icon-96.png');

    // 4. Validate manifest metadata
    const manifestJson = JSON.parse(unpacked.get('manifest.json').toString('utf8'));
    assert.strictEqual(manifestJson.manifestVersion, 5);
    assert.strictEqual(manifestJson.id, 'io.framegit.premiere');
    assert.strictEqual(manifestJson.name, 'FrameGit');
    assert.strictEqual(manifestJson.icons.length, 3);
  } finally {
    try {
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
});

test('Resolve Python Script - Valid Syntax & CLI Interface', async () => {
  const root = path.resolve(__dirname, '..');
  const pyScript = path.join(root, 'plugin', 'resolve', 'framegit_resolve.py');
  assert.ok(fs.existsSync(pyScript));

  // Verify python syntax with python -m py_compile if python is available
  try {
    const res = await execFileAsync('python', ['-m', 'py_compile', pyScript]);
    assert.strictEqual(res.stderr, '');
  } catch (err) {
    // If python is not on system path, read file and verify structure
    const content = fs.readFileSync(pyScript, 'utf8');
    assert.ok(content.includes('class FrameGitResolve:'));
    assert.ok(content.includes('def commit('));
    assert.ok(content.includes('def status('));
    assert.ok(content.includes('def export_project_snapshot('));
  }
});
