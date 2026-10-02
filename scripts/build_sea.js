/**
 * FrameGit Standalone Single Executable Application (SEA) Builder
 * 
 * Bundles FrameGit core engine and CLI into a standalone Windows binary (dist/framegit.exe)
 * with ZERO Node.js or npm prerequisite required for end users.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const BUNDLE_PATH = path.join(DIST_DIR, 'bundle.js');
const BLOB_PATH = path.join(DIST_DIR, 'sea-prep.blob');
const EXE_OUTPUT = path.join(DIST_DIR, 'framegit.exe');
const CONFIG_PATH = path.join(ROOT_DIR, 'sea-config.json');

function buildSea() {
  console.log('===========================================================');
  console.log('     FRAMEGIT STANDALONE SEA EXECUTABLE BUILDER           ');
  console.log('===========================================================');

  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  // Step 1: Bundle all source files with esbuild
  console.log('\n[1/4] Bundling core modules into CommonJS artifact...');
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(npxCmd, [
    'esbuild',
    path.join(ROOT_DIR, 'bin', 'framegit.js'),
    '--bundle',
    '--platform=node',
    '--target=node24',
    '--external:electron',
    `--outfile=${BUNDLE_PATH}`
  ], { stdio: 'inherit', cwd: ROOT_DIR, shell: true });
  console.log(`  ✓ Created bundle: ${BUNDLE_PATH} (${(fs.statSync(BUNDLE_PATH).size / (1024 * 1024)).toFixed(2)} MB)`);

  // Step 2: Generate SEA preparation blob
  console.log('\n[2/4] Generating Single Executable preparation blob...');
  execFileSync(process.execPath, [
    '--experimental-sea-config',
    CONFIG_PATH
  ], { stdio: 'inherit', cwd: ROOT_DIR });
  console.log(`  ✓ Generated SEA blob: ${BLOB_PATH} (${(fs.statSync(BLOB_PATH).size / (1024 * 1024)).toFixed(2)} MB)`);

  // Step 3: Copy Node binary and inject blob
  console.log('\n[3/4] Copying host runtime binary and injecting SEA resource...');
  fs.copyFileSync(process.execPath, EXE_OUTPUT);

  // Inject SEA blob into executable via postject
  execFileSync(npxCmd, [
    'postject',
    EXE_OUTPUT,
    'NODE_SEA_BLOB',
    BLOB_PATH,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    '--overwrite'
  ], { stdio: 'inherit', cwd: ROOT_DIR, shell: true });
  console.log(`  ✓ Injected blob into standalone executable: ${EXE_OUTPUT} (${(fs.statSync(EXE_OUTPUT).size / (1024 * 1024)).toFixed(2)} MB)`);

  // Step 4: Validate standalone executable
  console.log('\n[4/4] Verifying standalone executable execution...');
  const verOut = execFileSync(EXE_OUTPUT, ['--version'], { encoding: 'utf8' }).trim();
  console.log(`  ✓ Standalone binary verified: "${verOut}"`);

  console.log('\n===========================================================');
  console.log('   BUILD SUCCESSFUL: dist/framegit.exe is ready for deploy ');
  console.log('===========================================================');

  return {
    executablePath: EXE_OUTPUT,
    sizeBytes: fs.statSync(EXE_OUTPUT).size,
    version: verOut
  };
}

if (require.main === module) {
  buildSea();
}

module.exports = { buildSea };
