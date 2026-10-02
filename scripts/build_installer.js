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

  // 1. Package native Electron desktop application
  console.log('\n[1/4] Packaging native desktop application...');
  const { packageDesktop } = require('./package_desktop');
  const desktopAppDir = packageDesktop();

  // Stage distribution files
  if (fs.existsSync(STAGING_DIR)) {
    fs.rmSync(STAGING_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(STAGING_DIR, { recursive: true });

  console.log('[+] Copying desktop application into installer staging...');
  copyRecursive(desktopAppDir, STAGING_DIR);

  // Optimize payload size: remove dxcompiler.dll and unused locales
  const dxCompiler = path.join(STAGING_DIR, 'dxcompiler.dll');
  if (fs.existsSync(dxCompiler)) fs.unlinkSync(dxCompiler);
  const chromiumLicenses = path.join(STAGING_DIR, 'LICENSES.chromium.html');
  if (fs.existsSync(chromiumLicenses)) fs.unlinkSync(chromiumLicenses);
  const localesDir = path.join(STAGING_DIR, 'locales');
  if (fs.existsSync(localesDir)) {
    const localeEntries = fs.readdirSync(localesDir);
    for (const loc of localeEntries) {
      if (!loc.startsWith('en-')) {
        try { fs.unlinkSync(path.join(localesDir, loc)); } catch (_) {}
      }
    }
  }

  // Ensure timestamps are >= 1980 for ZIP format compatibility
  const touchCmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -Path '${STAGING_DIR}' -Recurse | ForEach-Object { $_.LastWriteTime = Get-Date }"`;
  execSync(touchCmd, { stdio: 'ignore' });

  console.log('  ✓ Staged complete native desktop application (FrameGit.exe, CLI, extensions, runtime)');

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
    '/platform:x64',
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
