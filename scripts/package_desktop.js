/**
 * FrameGit Native Desktop Application Packager
 * 
 * Bundles the native Electron runtime into a standalone Windows Desktop Application:
 *   dist/FrameGit-win32-x64/FrameGit.exe
 * 
 * Launches directly as a native desktop window (like GitHub Desktop or ChatGPT Desktop)
 * with zero browser tabs and zero local website URLs.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const ELECTRON_DIST = path.join(ROOT_DIR, 'node_modules', 'electron', 'dist');
const OUTPUT_APP_DIR = path.join(DIST_DIR, 'FrameGit-win32-x64');

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

function packageDesktop() {
  console.log('===========================================================');
  console.log('       FRAMEGIT NATIVE DESKTOP APP PACKAGER                ');
  console.log('===========================================================');

  if (!fs.existsSync(ELECTRON_DIST)) {
    throw new Error(`Electron runtime not found at: ${ELECTRON_DIST}`);
  }

  // 1. Prepare output directory
  if (fs.existsSync(OUTPUT_APP_DIR)) {
    console.log('[+] Cleaning previous desktop build...');
    fs.rmSync(OUTPUT_APP_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(OUTPUT_APP_DIR, { recursive: true });

  // 2. Copy Electron runtime binaries
  console.log('\n[1/3] Copying native Electron application runtime...');
  const entries = fs.readdirSync(ELECTRON_DIST, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'resources') continue; // We will populate resources/app
    const srcPath = path.join(ELECTRON_DIST, entry.name);
    const destPath = path.join(OUTPUT_APP_DIR, entry.name === 'electron.exe' ? 'FrameGit.exe' : entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }

  // Copy default electron resources except default_app.asar
  const electronResources = path.join(ELECTRON_DIST, 'resources');
  const targetResources = path.join(OUTPUT_APP_DIR, 'resources');
  fs.mkdirSync(targetResources, { recursive: true });
  if (fs.existsSync(electronResources)) {
    const resEntries = fs.readdirSync(electronResources);
    for (const resName of resEntries) {
      if (resName !== 'default_app.asar') {
        const s = path.join(electronResources, resName);
        const d = path.join(targetResources, resName);
        if (fs.statSync(s).isDirectory()) {
          copyRecursive(s, d);
        } else {
          fs.copyFileSync(s, d);
        }
      }
    }
  }

  // 3. Assemble application payload into resources/app
  console.log('\n[2/3] Assembling FrameGit application resources into resources/app...');
  const appDir = path.join(targetResources, 'app');
  fs.mkdirSync(appDir, { recursive: true });

  // App manifest
  const appPackageJson = {
    name: 'framegit',
    productName: 'FrameGit',
    version: '1.0.0',
    description: 'Git for Video Editors',
    main: 'desktop/main.js'
  };
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(appPackageJson, null, 2), 'utf8');

  // Copy desktop, core, plugin, and configuration
  copyRecursive(path.join(ROOT_DIR, 'desktop'), path.join(appDir, 'desktop'));
  copyRecursive(path.join(ROOT_DIR, 'core'), path.join(appDir, 'core'));
  copyRecursive(path.join(ROOT_DIR, 'plugin'), path.join(appDir, 'plugin'));

  const filesToCopy = [
    'framegit.config.json',
    'framegit.schema.json',
    'index.js'
  ];
  for (const f of filesToCopy) {
    const src = path.join(ROOT_DIR, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(appDir, f));
    }
  }

  // Copy all production dependencies from node_modules (excluding electron)
  const targetNodeModules = path.join(appDir, 'node_modules');
  fs.mkdirSync(targetNodeModules, { recursive: true });
  const rootModules = fs.readdirSync(path.join(ROOT_DIR, 'node_modules'), { withFileTypes: true });
  for (const mod of rootModules) {
    if (mod.name.startsWith('.bin') || mod.name.includes('electron')) continue;
    const modSrc = path.join(ROOT_DIR, 'node_modules', mod.name);
    const modDest = path.join(targetNodeModules, mod.name);
    if (mod.isDirectory()) {
      copyRecursive(modSrc, modDest);
    } else {
      fs.copyFileSync(modSrc, modDest);
    }
  }

  // Include the CLI binary in a bin/ subfolder to prevent case collision on Windows
  const cliSrc = path.join(DIST_DIR, 'framegit.exe');
  if (fs.existsSync(cliSrc)) {
    const binDir = path.join(OUTPUT_APP_DIR, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.copyFileSync(cliSrc, path.join(binDir, 'framegit.exe'));
  }
  const ccxSrc = path.join(DIST_DIR, 'FrameGit-Premiere.ccx');
  if (fs.existsSync(ccxSrc)) {
    fs.copyFileSync(ccxSrc, path.join(OUTPUT_APP_DIR, 'FrameGit-Premiere.ccx'));
  }
  const resolveScript = path.join(ROOT_DIR, 'plugin', 'resolve', 'framegit_resolve.py');
  if (fs.existsSync(resolveScript)) {
    fs.copyFileSync(resolveScript, path.join(OUTPUT_APP_DIR, 'framegit_resolve.py'));
  }

  console.log('\n[3/3] Verifying packaged desktop application...');
  const mainExe = path.join(OUTPUT_APP_DIR, 'FrameGit.exe');
  if (!fs.existsSync(mainExe)) {
    throw new Error(`Failed to generate: ${mainExe}`);
  }

  const stat = fs.statSync(mainExe);
  console.log(`  ✓ Native desktop executable: ${mainExe} (${(stat.size / (1024 * 1024)).toFixed(1)} MB)`);
  console.log('===========================================================');
  console.log('   DESKTOP APP PACKAGED SUCCESSFULLY                       ');
  console.log(`   Location: ${OUTPUT_APP_DIR}`);
  console.log('===========================================================');
  return OUTPUT_APP_DIR;
}

if (require.main === module) {
  packageDesktop();
}

module.exports = { packageDesktop };
