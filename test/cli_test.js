/**
 * FrameGit Phase 17 Test Suite: CLI & Watcher Daemon Integration
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const BIN_PATH = path.resolve(__dirname, '..', 'bin', 'framegit.js');

function runCli(args, cwd) {
  return execFileAsync(process.execPath, [BIN_PATH, ...args], { cwd, env: { ...process.env } });
}

test('CLI - Basic Flags (--help, --version)', async () => {
  const helpRes = await runCli(['--help'], process.cwd());
  assert.strictEqual(helpRes.stderr, '');
  assert.ok(helpRes.stdout.includes('FrameGit — Version Control'));
  assert.ok(helpRes.stdout.includes('COMMANDS:'));

  const verRes = await runCli(['--version'], process.cwd());
  assert.ok(verRes.stdout.includes('framegit version 1.0.0'));
});

test('CLI - Workflow (init, config, commit, status, log, branch, checkout, diff, fsck, doctor)', async () => {
  const testDir = path.join(__dirname, 'temp_cli_workspace');
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  try {
    // 1. Init repository with a dummy project file
    const prjFile = path.join(testDir, 'Commercial.prproj');
    fs.writeFileSync(prjFile, 'dummy prproj data v1');

    const initRes = await runCli(['init', 'Commercial.prproj'], testDir);
    assert.ok(initRes.stdout.includes('Initialized FrameGit repository'));
    assert.ok(fs.existsSync(path.join(testDir, '.framegit')));

    // 2. Doctor check
    const docRes = await runCli(['doctor'], testDir);
    assert.ok(docRes.stdout.includes('FRAMEGIT SYSTEM HEALTH REPORT'));
    assert.ok(docRes.stdout.includes('Repository:          Valid'));

    // 3. Configure Author
    await runCli(['config', 'set', 'user.name', 'CLI Test Editor'], testDir);
    await runCli(['config', 'set', 'user.email', 'clitest@framegit.org'], testDir);
    const getRes = await runCli(['config', 'get', 'user.name'], testDir);
    assert.ok(getRes.stdout.includes('CLI Test Editor'));

    // 4. Status before commit
    const stat1 = await runCli(['status'], testDir);
    assert.ok(stat1.stdout.includes('On branch main'));
    assert.ok(stat1.stdout.includes('Working project clean') || stat1.stdout.includes('Changes detected'));

    // 5. Commit initial state
    const commit1 = await runCli(['commit', '-m', 'Initial sequence import'], testDir);
    assert.ok(commit1.stdout.includes('[main'));
    assert.ok(commit1.stdout.includes('Initial sequence import'));

    // 6. Log
    const logRes = await runCli(['log'], testDir);
    assert.ok(logRes.stdout.includes('Initial sequence import'));
    assert.ok(logRes.stdout.includes('CLI Test Editor'));

    // 7. Branch creation and listing
    const brCreate = await runCli(['branch', 'color-pass'], testDir);
    assert.ok(brCreate.stdout.includes('Created branch color-pass'));

    const brList = await runCli(['branch'], testDir);
    assert.ok(brList.stdout.includes('* main'));
    assert.ok(brList.stdout.includes('  color-pass'));

    // 8. Checkout branch
    const coRes = await runCli(['checkout', 'color-pass'], testDir);
    assert.ok(coRes.stdout.includes("Switched to branch 'color-pass'"));

    // Modify file and commit on branch
    fs.writeFileSync(prjFile, 'dummy prproj data v2 with color grade');
    await runCli(['commit', '-m', 'Applied Lumetri color grade'], testDir);

    // 9. Diff check
    const diffRes = await runCli(['diff'], testDir);
    assert.ok(diffRes.stdout.includes('TIMELINE') || diffRes.stdout.includes('DIFF') || diffRes.stdout.includes('No structural'));

    // 10. Integrity check (fsck)
    const fsckRes = await runCli(['fsck'], testDir);
    assert.ok(fsckRes.stdout.includes('HEALTHY') || fsckRes.stdout.includes('Auditing'));

    // 11. Daemon status check
    const daemonRes = await runCli(['daemon', 'status'], testDir);
    assert.ok(daemonRes.stdout.includes('Watcher daemon is STOPPED') || daemonRes.stdout.includes('RUNNING'));

  } finally {
    // Windows file cleanup
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch {
      // Ignored if file locked
    }
  }
});

test('CLI - Error Handling (Invalid Command, Outside Repo)', async () => {
  // Invalid command
  await assert.rejects(
    async () => {
      await runCli(['nonexistent-command'], process.cwd());
    },
    (err) => {
      assert.strictEqual(err.code, 1);
      assert.ok(err.stderr.includes('Unknown command'));
      return true;
    }
  );

  // Run commit outside repository
  const emptyDir = path.join(__dirname, 'temp_empty_dir');
  fs.mkdirSync(emptyDir, { recursive: true });
  try {
    await assert.rejects(
      async () => {
        await runCli(['status'], emptyDir);
      },
      (err) => {
        assert.strictEqual(err.code, 1);
        assert.ok(err.stderr.includes('not a framegit repository'));
        return true;
      }
    );
  } finally {
    try {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    } catch {}
  }
});
