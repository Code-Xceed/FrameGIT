#!/usr/bin/env node

/**
 * FrameGit — cross-platform unit test runner.
 *
 * Resolves `test/*_test.js` itself (so it works whether the shell expands globs
 * or not) and invokes the Node.js built-in test runner. Keeps the top-level
 * test directory hermetic: helper files, mocks, fixtures, and workspace data
 * are not executed as tests.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TEST_DIR = path.join(ROOT, 'test');

function collectTestFiles() {
  const entries = fs.readdirSync(TEST_DIR, { withFileTypes: true });
  return entries
    .filter(ent => ent.isFile() && ent.name.endsWith('_test.js'))
    .map(ent => path.join('test', ent.name))
    .sort();
}

function main() {
  const files = collectTestFiles();

  if (files.length === 0) {
    console.error('No unit test files matching test/*_test.js were found.');
    return 1;
  }

  console.log(`Running ${files.length} unit test file(s) via node --test...\n`);

  const result = spawnSync(process.execPath, ['--test', ...files], {
    cwd: ROOT,
    stdio: 'inherit'
  });

  if (result.error) {
    console.error(`Failed to launch test runner: ${result.error.message}`);
    return 1;
  }

  return result.status === null ? 1 : result.status;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { collectTestFiles };
