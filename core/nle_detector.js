// FrameGit Core - Creative NLE Auto-Detector & Plugin Deployer
// Scans host operating system (Windows & macOS) for Adobe Premiere Pro and DaVinci Resolve
// and automates deployment of UXP CCX panels and Python scripting bridges.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

class NleDetector {
  /**
   * @param {Object} [options]
   * @param {string} [options.appDataDir] Custom AppData directory override for testing
   * @param {string} [options.programFilesDir] Custom Program Files directory override for testing
   */
  constructor(options = {}) {
    this.isWindows = process.platform === 'win32';
    this.isMac = process.platform === 'darwin';
    this.appDataDir = options.appDataDir || (
      this.isWindows
        ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
        : path.join(os.homedir(), 'Library', 'Application Support')
    );
    this.programFilesDir = options.programFilesDir || (
      this.isWindows
        ? (process.env['ProgramFiles'] || 'C:\\Program Files')
        : '/Applications'
    );
    this.programFilesX86 = this.isWindows
      ? (process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)')
      : null;
  }

  /**
   * Scan host system for all installed Adobe Premiere Pro and DaVinci Resolve versions.
   * @returns {Array<{id: string, name: string, version: string, installPath: string, executablePath: string, isInstalled: boolean, pluginInstalled: boolean}>}
   */
  detectAll() {
    const detected = [];

    // 1. Detect Adobe Premiere Pro
    const premiereInstalls = this.detectPremierePro();
    detected.push(...premiereInstalls);

    // 2. Detect DaVinci Resolve
    const resolveInstalls = this.detectDaVinciResolve();
    detected.push(...resolveInstalls);

    return detected;
  }

  /**
   * Detect Adobe Premiere Pro installations across Registry and Program Files.
   * @returns {Array<Object>}
   */
  detectPremierePro() {
    const results = [];
    const knownYears = [2026, 2025, 2024, 2023, 2022];

    if (this.isWindows) {
      for (const year of knownYears) {
        const folderName = `Adobe Premiere Pro ${year}`;
        const installDir = path.join(this.programFilesDir, 'Adobe', folderName);
        const exePath = path.join(installDir, 'Adobe Premiere Pro.exe');

        if (fs.existsSync(exePath)) {
          const uxpInstalled = this.isPremierePluginInstalled(year);
          results.push({
            id: `premiere-${year}`,
            name: `Adobe Premiere Pro ${year}`,
            family: 'premiere',
            version: `${year}.0`,
            installPath: installDir,
            executablePath: exePath,
            isInstalled: true,
            pluginInstalled: uxpInstalled
          });
        }
      }

      // Check generic Adobe Premiere Pro path if specific year wasn't found
      const genericDir = path.join(this.programFilesDir, 'Adobe', 'Adobe Premiere Pro');
      const genericExe = path.join(genericDir, 'Adobe Premiere Pro.exe');
      if (fs.existsSync(genericExe) && !results.some(r => r.installPath === genericDir)) {
        results.push({
          id: 'premiere-generic',
          name: 'Adobe Premiere Pro',
          family: 'premiere',
          version: 'Current',
          installPath: genericDir,
          executablePath: genericExe,
          isInstalled: true,
          pluginInstalled: this.isPremierePluginInstalled('generic')
        });
      }
    } else if (this.isMac) {
      for (const year of knownYears) {
        const appDir = path.join('/Applications', `Adobe Premiere Pro ${year}`, `Adobe Premiere Pro ${year}.app`);
        if (fs.existsSync(appDir)) {
          results.push({
            id: `premiere-${year}`,
            name: `Adobe Premiere Pro ${year}`,
            family: 'premiere',
            version: `${year}.0`,
            installPath: appDir,
            executablePath: path.join(appDir, 'Contents', 'MacOS', 'Adobe Premiere Pro'),
            isInstalled: true,
            pluginInstalled: this.isPremierePluginInstalled(year)
          });
        }
      }
    }

    return results;
  }

  /**
   * Detect DaVinci Resolve installations across Program Files and Registry.
   * @returns {Array<Object>}
   */
  detectDaVinciResolve() {
    const results = [];

    if (this.isWindows) {
      const installDir = path.join(this.programFilesDir, 'Blackmagic Design', 'DaVinci Resolve');
      const exePath = path.join(installDir, 'Resolve.exe');

      if (fs.existsSync(exePath)) {
        const scriptInstalled = this.isResolveScriptInstalled();
        results.push({
          id: 'davinci-resolve',
          name: 'DaVinci Resolve',
          family: 'resolve',
          version: '19.0+',
          installPath: installDir,
          executablePath: exePath,
          isInstalled: true,
          pluginInstalled: scriptInstalled
        });
      }
    } else if (this.isMac) {
      const appDir = '/Applications/DaVinci Resolve/DaVinci Resolve.app';
      if (fs.existsSync(appDir)) {
        results.push({
          id: 'davinci-resolve',
          name: 'DaVinci Resolve',
          family: 'resolve',
          version: '19.0+',
          installPath: appDir,
          executablePath: path.join(appDir, 'Contents', 'MacOS', 'Resolve'),
          isInstalled: true,
          pluginInstalled: this.isResolveScriptInstalled()
        });
      }
    }

    return results;
  }

  /**
   * Get the target UXP extensions storage path for Adobe Premiere Pro.
   * @returns {string}
   */
  getPremiereUxpPluginDir() {
    if (this.isWindows) {
      return path.join(this.appDataDir, 'Adobe', 'UXP', 'PluginsStorage', 'PPRO');
    }
    return path.join(this.appDataDir, 'Adobe', 'UXP', 'PluginsStorage', 'PPRO');
  }

  /**
   * Get the DaVinci Resolve Python scripting modules path.
   * @returns {string}
   */
  getResolveModulesDir() {
    if (this.isWindows) {
      return path.join(this.appDataDir, 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Developer', 'Scripting', 'Modules');
    }
    return path.join(this.appDataDir, 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Developer', 'Scripting', 'Modules');
  }

  /**
   * Get the DaVinci Resolve Utility Scripts menu directory.
   * @returns {string}
   */
  getResolveUtilityScriptsDir() {
    if (this.isWindows) {
      return path.join(this.appDataDir, 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Developer', 'Scripting', 'Scripts', 'Utility');
    }
    return path.join(this.appDataDir, 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Developer', 'Scripting', 'Scripts', 'Utility');
  }

  /**
   * Check if FrameGit UXP plugin is deployed for Premiere.
   * @param {string|number} [versionYear]
   * @returns {boolean}
   */
  isPremierePluginInstalled(versionYear = '') {
    const targetDir = this.getPremiereUxpPluginDir();
    const manifestPath = path.join(targetDir, 'FrameGit', 'manifest.json');
    return fs.existsSync(manifestPath);
  }

  /**
   * Check if FrameGit Python integration script is deployed for Resolve.
   * @returns {boolean}
   */
  isResolveScriptInstalled() {
    const modulePath = path.join(this.getResolveModulesDir(), 'framegit_resolve.py');
    return fs.existsSync(modulePath);
  }

  /**
   * Install/Deploy Premiere Pro UXP extension files to user's AppData UXP plugin store.
   * @param {string} [sourcePluginDir] Path to plugin/premiere source directory
   * @returns {{success: boolean, targetDir: string}}
   */
  installPremierePlugin(sourcePluginDir = null) {
    const src = sourcePluginDir || path.resolve(__dirname, '..', 'plugin', 'premiere');
    if (!fs.existsSync(src)) {
      throw new Error(`Source Premiere plugin directory not found: ${src}`);
    }

    const targetBase = this.getPremiereUxpPluginDir();
    const targetDir = path.join(targetBase, 'FrameGit');

    fs.mkdirSync(targetDir, { recursive: true });

    // Copy manifest, index.html, index.js, icons
    this._copyRecursive(src, targetDir);

    return {
      success: true,
      targetDir
    };
  }

  /**
   * Install/Deploy DaVinci Resolve Python scripting bridge into Resolve's Modules and Utility directories.
   * @param {string} [sourceScriptPath] Path to plugin/resolve/framegit_resolve.py
   * @returns {{success: boolean, modulePath: string, utilityScriptPath: string}}
   */
  installResolveScript(sourceScriptPath = null) {
    const src = sourceScriptPath || path.resolve(__dirname, '..', 'plugin', 'resolve', 'framegit_resolve.py');
    if (!fs.existsSync(src)) {
      throw new Error(`Source DaVinci Resolve script not found: ${src}`);
    }

    const modulesDir = this.getResolveModulesDir();
    const utilityDir = this.getResolveUtilityScriptsDir();

    fs.mkdirSync(modulesDir, { recursive: true });
    fs.mkdirSync(utilityDir, { recursive: true });

    const targetModule = path.join(modulesDir, 'framegit_resolve.py');
    const targetUtility = path.join(utilityDir, 'FrameGit.py');

    fs.copyFileSync(src, targetModule);

    // Create convenient menu launcher in Utility Scripts
    const launcherCode = [
      '#!/usr/bin/env python3',
      '"""FrameGit DaVinci Resolve Menu Launcher"""',
      'import sys',
      'import os',
      `sys.path.insert(0, r"${modulesDir}")`,
      'import framegit_resolve',
      'if __name__ == "__main__":',
      '    framegit_resolve.main()',
      ''
    ].join('\n');

    fs.writeFileSync(targetUtility, launcherCode, 'utf8');

    return {
      success: true,
      modulePath: targetModule,
      utilityScriptPath: targetUtility
    };
  }

  /**
   * Internal recursive copy helper.
   * @private
   */
  _copyRecursive(src, dest) {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    fs.mkdirSync(dest, { recursive: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this._copyRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

module.exports = { NleDetector };
