/**
 * FrameGit Windows Installer Builder
 * 
 * Packages standalone framegit.exe, Premiere CCX plugin, DaVinci Resolve script,
 * and Desktop GUI into a single standalone Windows Setup Wizard:
 *   dist/FrameGit-Setup-1.0.0.exe
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const STAGING_DIR = path.join(DIST_DIR, 'staging');
const PAYLOAD_ZIP = path.join(DIST_DIR, 'payload.zip');
const SETUP_EXE = path.join(DIST_DIR, 'FrameGit-Setup-1.0.0.exe');
const CS_SOURCE = path.join(ROOT_DIR, 'installer', 'windows', 'SetupWizard.cs');

const CSC_COMPILER = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

function copyRecursive(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function buildInstaller() {
  console.log('===========================================================');
  console.log('       FRAMEGIT WINDOWS INSTALLER BUILDER                  ');
  console.log('===========================================================');

  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  // Verify prerequisites
  const framegitExe = path.join(DIST_DIR, 'framegit.exe');
  if (!fs.existsSync(framegitExe)) {
    console.log('[+] Standalone binary missing. Compiling dist/framegit.exe via build_sea.js...');
    const { buildSea } = require('./build_sea');
    buildSea();
  }

  const premiereCcx = path.join(DIST_DIR, 'FrameGit-Premiere.ccx');
  if (!fs.existsSync(premiereCcx)) {
    console.log('[+] CCX package missing. Compiling dist/FrameGit-Premiere.ccx via build_uxp_ccx.js...');
    const { buildCcx } = require('./build_uxp_ccx');
    buildCcx();
  }

  const resolveScript = path.join(ROOT_DIR, 'plugin', 'resolve', 'framegit_resolve.py');
  if (!fs.existsSync(resolveScript)) {
    throw new Error(`Resolve script not found at: ${resolveScript}`);
  }

  // 1. Stage distribution files
  console.log('\n[1/4] Staging installer payload...');
  if (fs.existsSync(STAGING_DIR)) {
    fs.rmSync(STAGING_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(STAGING_DIR, { recursive: true });

  fs.copyFileSync(framegitExe, path.join(STAGING_DIR, 'framegit.exe'));
  fs.copyFileSync(premiereCcx, path.join(STAGING_DIR, 'FrameGit-Premiere.ccx'));
  fs.copyFileSync(resolveScript, path.join(STAGING_DIR, 'framegit_resolve.py'));

  // Stage Desktop GUI files
  const desktopSrc = path.join(ROOT_DIR, 'desktop');
  if (fs.existsSync(desktopSrc)) {
    copyRecursive(desktopSrc, path.join(STAGING_DIR, 'desktop'));
  }

  console.log('  ✓ Staged framegit.exe, FrameGit-Premiere.ccx, framegit_resolve.py, and desktop GUI');

  // 2. Compress staging into payload.zip
  console.log('\n[2/4] Compressing staging payload into archive...');
  if (fs.existsSync(PAYLOAD_ZIP)) {
    fs.unlinkSync(PAYLOAD_ZIP);
  }

  const zipCmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '${STAGING_DIR}\\*' -DestinationPath '${PAYLOAD_ZIP}' -CompressionLevel Optimal"`;
  execSync(zipCmd, { stdio: 'inherit' });
  const zipSizeMB = (fs.statSync(PAYLOAD_ZIP).size / (1024 * 1024)).toFixed(2);
  console.log(`  ✓ Compressed payload: ${PAYLOAD_ZIP} (${zipSizeMB} MB)`);

  // 3. Compile C# Setup Wizard with embedded payload.zip
  console.log('\n[3/4] Compiling native Windows Setup Wizard executable via csc.exe...');
  if (!fs.existsSync(CSC_COMPILER)) {
    throw new Error(`Microsoft C# compiler not found at: ${CSC_COMPILER}`);
  }

  const refs = [
    'System.dll',
    'System.Windows.Forms.dll',
    'System.Drawing.dll',
    'System.IO.Compression.dll',
    'System.IO.Compression.FileSystem.dll'
  ].map(r => `/r:${r}`).join(' ');

  const cscArgs = [
    '/target:winexe',
    `/out:"${SETUP_EXE}"`,
    '/platform:anycpu',
    '/optimize+',
    refs,
    `/resource:"${PAYLOAD_ZIP}",payload.zip`,
    `"${CS_SOURCE}"`
  ].join(' ');

  execSync(`"${CSC_COMPILER}" ${cscArgs}`, { stdio: 'inherit' });

  // 4. Verify output executable
  console.log('\n[4/4] Verifying generated installer...');
  if (!fs.existsSync(SETUP_EXE)) {
    throw new Error(`Installer executable was not created: ${SETUP_EXE}`);
  }

  const setupSizeMB = (fs.statSync(SETUP_EXE).size / (1024 * 1024)).toFixed(2);

  // Clean staging
  try {
    fs.rmSync(STAGING_DIR, { recursive: true, force: true });
    fs.unlinkSync(PAYLOAD_ZIP);
  } catch (_) {}

  console.log('\n===========================================================');
  console.log('   INSTALLER GENERATED SUCCESSFULLY:                       ');
  console.log(`   Location: ${SETUP_EXE}                                  `);
  console.log(`   Size:     ${setupSizeMB} MB                             `);
  console.log('===========================================================');

  return {
    installerPath: SETUP_EXE,
    sizeMB: setupSizeMB
  };
}

if (require.main === module) {
  buildInstaller();
}

module.exports = { buildInstaller };
