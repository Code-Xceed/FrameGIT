// FrameGit - Phase 1 Desktop Foundation Unit Tests
// Tests NLE Detection, Global Project Catalog, and Process Lifecycle Monitor.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { NleDetector } = require('../core/nle_detector');
const { ProjectCatalog } = require('../core/project_catalog');
const { ProcessMonitor } = require('../core/process_monitor');
const { VersionEngine } = require('../core/version_engine');

const TEST_SANDBOX = path.join(__dirname, 'sandbox_desktop_foundation');

test.beforeEach(() => {
  if (fs.existsSync(TEST_SANDBOX)) {
    fs.rmSync(TEST_SANDBOX, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_SANDBOX, { recursive: true });
});

test.afterEach(() => {
  if (fs.existsSync(TEST_SANDBOX)) {
    try { fs.rmSync(TEST_SANDBOX, { recursive: true, force: true }); } catch (_) {}
  }
});

test('NleDetector: Identifies simulated Premiere Pro and DaVinci Resolve installations', () => {
  const mockProgramFiles = path.join(TEST_SANDBOX, 'ProgramFiles');
  const mockAppData = path.join(TEST_SANDBOX, 'AppData');

  // Create fake Premiere Pro 2025
  const premiereDir = path.join(mockProgramFiles, 'Adobe', 'Adobe Premiere Pro 2025');
  fs.mkdirSync(premiereDir, { recursive: true });
  fs.writeFileSync(path.join(premiereDir, 'Adobe Premiere Pro.exe'), 'mock_binary');

  // Create fake DaVinci Resolve
  const resolveDir = path.join(mockProgramFiles, 'Blackmagic Design', 'DaVinci Resolve');
  fs.mkdirSync(resolveDir, { recursive: true });
  fs.writeFileSync(path.join(resolveDir, 'Resolve.exe'), 'mock_binary');

  const detector = new NleDetector({
    programFilesDir: mockProgramFiles,
    appDataDir: mockAppData
  });

  const allDetected = detector.detectAll();
  assert.strictEqual(allDetected.length, 2);

  const premiere = allDetected.find(e => e.family === 'premiere');
  assert.ok(premiere);
  assert.strictEqual(premiere.version, '2025.0');
  assert.strictEqual(premiere.isInstalled, true);
  assert.strictEqual(premiere.pluginInstalled, false);

  const resolve = allDetected.find(e => e.family === 'resolve');
  assert.ok(resolve);
  assert.strictEqual(resolve.isInstalled, true);
  assert.strictEqual(resolve.pluginInstalled, false);
});

test('NleDetector: Successfully deploys Premiere UXP panel and Resolve script', () => {
  const mockAppData = path.join(TEST_SANDBOX, 'AppData');
  const detector = new NleDetector({ appDataDir: mockAppData });

  // 1. Deploy Premiere plugin
  const premiereRes = detector.installPremierePlugin();
  assert.strictEqual(premiereRes.success, true);
  assert.ok(fs.existsSync(path.join(premiereRes.targetDir, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(premiereRes.targetDir, 'index.html')));
  assert.strictEqual(detector.isPremierePluginInstalled(), true);

  // 2. Deploy Resolve script
  const resolveRes = detector.installResolveScript();
  assert.strictEqual(resolveRes.success, true);
  assert.ok(fs.existsSync(resolveRes.modulePath));
  assert.ok(fs.existsSync(resolveRes.utilityScriptPath));
  assert.strictEqual(detector.isResolveScriptInstalled(), true);
});

test('ProjectCatalog: Registers repositories, reads SQLite DAG state, and manages favorites', async () => {
  const catalogDir = path.join(TEST_SANDBOX, 'catalog');
  const catalog = new ProjectCatalog({ catalogDir });

  // 1. Create real test FrameGit repository
  const repoDir = path.join(TEST_SANDBOX, 'CommercialRepo');
  fs.mkdirSync(repoDir, { recursive: true });
  const prprojFile = path.join(repoDir, 'Commercial.prproj');
  fs.writeFileSync(prprojFile, '<xml>mock</xml>');

  const engine = new VersionEngine(repoDir, 'Commercial.prproj');
  engine.init();
  await engine.commit('Initial assembly cut');
  engine.createBranch('color-grade');
  engine.switchBranch('color-grade');
  engine.close();

  // 2. Register into catalog
  const entry = catalog.register(repoDir, { name: 'SuperBowl Commercial' });
  assert.strictEqual(entry.name, 'SuperBowl Commercial');
  assert.strictEqual(entry.currentBranch, 'color-grade');
  assert.ok(entry.headCommit);
  assert.strictEqual(entry.lastCommitMessage, 'Initial assembly cut');
  assert.strictEqual(entry.adapter, 'premiere');

  // 3. Query catalog
  const list = catalog.list();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].existsOnDisk, true);
  assert.strictEqual(list[0].isFavorite, false);

  // 4. Toggle favorite
  const favState = catalog.toggleFavorite(repoDir);
  assert.strictEqual(favState, true);
  assert.strictEqual(catalog.get(repoDir).isFavorite, true);

  // 5. Unregister
  const removed = catalog.unregister(repoDir);
  assert.strictEqual(removed, true);
  assert.strictEqual(catalog.list().length, 0);
  assert.ok(fs.existsSync(repoDir), 'Unregistering from catalog must not delete project on disk');
});

test('ProcessMonitor: Detects starting and stopping of editing applications via lifecycle events', () => {
  let mockProcesses = [];
  const monitor = new ProcessMonitor({
    intervalMs: 100,
    processListFn: () => mockProcesses
  });

  const events = [];
  monitor.on('editor-started', info => events.push({ type: 'start', id: info.id }));
  monitor.on('editor-stopped', info => events.push({ type: 'stop', id: info.id }));

  // Cycle 1: No editors
  monitor.poll();
  assert.strictEqual(monitor.hasActiveEditors(), false);
  assert.strictEqual(events.length, 0);

  // Cycle 2: Premiere Pro launches
  mockProcesses = [{ name: 'Adobe Premiere Pro.exe', pid: 1420 }];
  monitor.poll();
  assert.strictEqual(monitor.hasActiveEditors(), true);
  assert.strictEqual(monitor.isEditorRunning('premiere'), true);
  assert.strictEqual(monitor.isEditorRunning('resolve'), false);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'start');
  assert.strictEqual(events[0].id, 'premiere');

  // Cycle 3: DaVinci Resolve also launches
  mockProcesses.push({ name: 'Resolve.exe', pid: 9812 });
  monitor.poll();
  assert.strictEqual(monitor.isEditorRunning('premiere'), true);
  assert.strictEqual(monitor.isEditorRunning('resolve'), true);
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[1].type, 'start');
  assert.strictEqual(events[1].id, 'resolve');

  // Cycle 4: Premiere exits, Resolve still running
  mockProcesses = [{ name: 'Resolve.exe', pid: 9812 }];
  monitor.poll();
  assert.strictEqual(monitor.isEditorRunning('premiere'), false);
  assert.strictEqual(monitor.isEditorRunning('resolve'), true);
  assert.strictEqual(events.length, 3);
  assert.strictEqual(events[2].type, 'stop');
  assert.strictEqual(events[2].id, 'premiere');

  // Cycle 5: Resolve exits
  mockProcesses = [];
  monitor.poll();
  assert.strictEqual(monitor.hasActiveEditors(), false);
  assert.strictEqual(events.length, 4);
  assert.strictEqual(events[3].type, 'stop');
  assert.strictEqual(events[3].id, 'resolve');

  monitor.stop();
});
