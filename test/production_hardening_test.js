// FrameGit - Phase 12 Production Hardening & Disaster Recovery Test Suite
// Validates:
// 1. Crash Recovery & Rolling Snapshots (0-byte / corrupted project resurrection)
// 2. Cryptographic fsck integrity verification (Bit rot & corruption detection)
// 3. Automated cloud repair for damaged chunks
// 4. Offline sync queue resilience (drain on reconnect)
// 5. System diagnostic health telemetry reporting

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const { VersionEngine } = require('../core/version_engine');
const { PremiereParser } = require('../core/premiere_parser');
const { Hasher } = require('../core/hasher');
const { ProductionHardening } = require('../core/hardening');
const { CloudClient } = require('../core/cloud_client');

const WORKSPACE_DIR = path.join(__dirname, 'hardening_workspace');
const PROJECT_FILE = path.join(WORKSPACE_DIR, 'MasterFilm.prproj');
const FOOTAGE_DIR = path.join(WORKSPACE_DIR, 'Footage');

function createSamplePrprojXml(exposureVal = '1.0') {
  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<PremiereData Version="3">
  <Project ObjectID="1" Name="MasterFilm">
    <Media ObjectID="med1" FilePath="Footage/CamA.mov" Name="CamA.mov" />
    <Sequence ObjectID="seq1" Name="Main_Sequence" Duration="725760000000">
      <TrackItem ObjectID="c1" TrackIndex="1" TrackType="video" Name="CamA.mov" MediaID="med1" Start="0" End="120960000000" In="0" Out="120960000000">
        <Component DisplayName="Lumetri Color">
          <Parameter Name="Exposure" CurrentValue="${exposureVal}" />
        </Component>
      </TrackItem>
    </Sequence>
  </Project>
</PremiereData>`;
  return PremiereParser.compressXmlToGzip(xml);
}

async function runHardeningTest() {
  console.log('===========================================================');
  console.log('   FRAMEGIT — PHASE 12 PRODUCTION HARDENING TEST SUITE     ');
  console.log('===========================================================\n');

  if (fs.existsSync(WORKSPACE_DIR)) {
    fs.rmSync(WORKSPACE_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(FOOTAGE_DIR, { recursive: true });

  fs.writeFileSync(path.join(FOOTAGE_DIR, 'CamA.mov'), Buffer.alloc(1024 * 512, 0x33));
  fs.writeFileSync(PROJECT_FILE, createSamplePrprojXml('0.75'));

  const engine = new VersionEngine(WORKSPACE_DIR, PROJECT_FILE);
  engine.init();

  const mockCloud = new CloudClient({ isMock: true });
  const hardening = new ProductionHardening(engine, mockCloud);
  hardening.init();

  // [1] Initial Commit & Cloud Mirroring
  console.log('[1] Initializing Version Engine & creating baseline commit...');
  const commit1 = await engine.commit('Master Cut v1.0', { name: 'Senior Editor', email: 'lead@studio.com' });
  console.log(`    ✓ Commit 1: ${commit1.commitHash.slice(0, 8)} on main`);

  // Mirror chunks to mock cloud for repair testing
  const catalog = engine.db.prepare('SELECT chunk_hash FROM chunk_catalog').all();
  for (const c of catalog) {
    const obj = engine.storage.readObject(c.chunk_hash);
    if (obj) {
      await mockCloud.uploadChunk(c.chunk_hash, obj.payload);
    }
  }
  console.log(`    ✓ Mirrored ${catalog.length} chunks to Cloudflare R2 mock store.`);

  // [2] Test Initial Cryptographic fsck
  console.log('\n[2] Running Cryptographic Integrity Audit (fsck)...');
  const initialFsck = hardening.fsck();
  assert.strictEqual(initialFsck.valid, true);
  assert.strictEqual(initialFsck.corrupted.length, 0);
  assert.strictEqual(initialFsck.missing.length, 0);
  console.log(`    ✓ All ${initialFsck.totalChecked} objects cryptographically valid (Bit-for-bit verified).`);

  // [3] Test Crash Recovery & Automated Snapshots
  console.log('\n[3] Testing Automated Safety Snapshots & Crash Recovery...');
  const snapshot = hardening.captureSnapshot();
  assert.ok(snapshot);
  console.log(`    ✓ Captured safety snapshot: ${snapshot.snapshotId}`);

  // Simulate Catastrophic Editor Crash (e.g. OS power outage mid-save causing 0-byte file)
  console.log('    Simulating power failure / Premiere crash mid-save: truncating project to 0 bytes...');
  fs.writeFileSync(PROJECT_FILE, Buffer.alloc(0));
  assert.strictEqual(fs.statSync(PROJECT_FILE).size, 0);

  // Attempt recovery
  const recoveryResult = hardening.recoverProjectFile();
  assert.strictEqual(recoveryResult.restored, true);
  const restoredStats = fs.statSync(PROJECT_FILE);
  assert.ok(restoredStats.size > 0);
  console.log(`    ✓ Crash recovery succeeded! Restored from ${recoveryResult.source} (${restoredStats.size} bytes)`);

  // Verify XML state is valid and readable by Premiere adapter
  const restoredState = engine.adapter.getProjectState(PROJECT_FILE);
  assert.strictEqual(restoredState.sequences[0].name, 'Main_Sequence');
  assert.strictEqual(restoredState.sequences[0].tracks[0].clips[0].effects[0].parameters.Exposure, '0.75');
  console.log('    ✓ Recovered project parsed cleanly with 100% parameter accuracy.');

  // [4] Test Bit Rot Detection & Cloud Auto-Repair
  console.log('\n[4] Simulating Bit Rot / Physical Disk Corruption...');
  const targetChunkHash = catalog[0].chunk_hash;
  const chunkObjPath = path.join(WORKSPACE_DIR, '.framegit', 'objects', targetChunkHash.slice(0, 2), targetChunkHash.slice(2));

  // Overwrite chunk on disk with corrupted garbage bytes
  fs.writeFileSync(chunkObjPath, Buffer.from('FGOB\x01CORRUPTED_GARBAGE_BYTES_FROM_BAD_SECTOR'));
  console.log(`    Corrupted chunk ${targetChunkHash.slice(0, 8)} on local disk.`);

  // Run fsck -> Must detect corruption!
  const corruptedFsck = hardening.fsck();
  assert.strictEqual(corruptedFsck.valid, false);
  assert.strictEqual(corruptedFsck.corrupted.length, 1);
  assert.strictEqual(corruptedFsck.corrupted[0].hash, targetChunkHash);
  console.log(`    ✓ fsck caught corrupted chunk: ${corruptedFsck.corrupted[0].hash.slice(0, 8)} (Expected vs Actual hash mismatch)`);

  // Run Cloud Auto-Repair
  console.log('    Executing automated cloud repair...');
  const repairResult = await hardening.repairFromCloud(corruptedFsck.corrupted);
  assert.strictEqual(repairResult.repairedCount, 1);
  console.log(`    ✓ Successfully re-downloaded and restored chunk ${targetChunkHash.slice(0, 8)} from cloud!`);

  // Re-run fsck -> Must be 100% clean now
  const cleanFsck = hardening.fsck();
  assert.strictEqual(cleanFsck.valid, true);
  console.log('    ✓ Post-repair fsck: Repository integrity is 100% HEALTHY.');

  // [5] Test Resilient Offline Sync Queue
  console.log('\n[5] Testing Resilient Offline Sync Queue...');
  hardening.enqueueSync('branch', 'main', { commitHash: commit1.commitHash });
  hardening.enqueueSync('branch', 'main', { commitHash: commit1.commitHash });

  const pendingCount = engine.db.prepare('SELECT COUNT(*) as c FROM offline_sync_queue').get().c;
  assert.strictEqual(pendingCount, 2);
  console.log(`    ✓ Enqueued 2 synchronization items while working offline.`);

  // Drain queue
  const mockSyncEngine = {
    push: async (branch) => ({ pushed: true, branch })
  };
  const queueResult = await hardening.processSyncQueue(mockSyncEngine);
  assert.strictEqual(queueResult.processed, 2);
  const remainingCount = engine.db.prepare('SELECT COUNT(*) as c FROM offline_sync_queue').get().c;
  assert.strictEqual(remainingCount, 0);
  console.log(`    ✓ Reconnection triggered queue drain: ${queueResult.processed} items pushed to remote.`);

  // [6] Test Diagnostic Health Reporting
  console.log('\n[6] Generating System Health & Diagnostic Telemetry Report...');
  const report = hardening.generateDiagnosticReport();
  assert.strictEqual(report.health, 'HEALTHY');
  assert.strictEqual(report.metrics.totalCommits, 1);
  assert.ok(report.metrics.totalCatalogBytes > 0);
  console.log('    Diagnostic Report Summary:');
  console.log(`      • Health Verdict:   ${report.health}`);
      console.log(`      • Project:          ${report.projectFile} (${report.projectSizeBytes} bytes)`);
  console.log(`      • Total Commits:    ${report.metrics.totalCommits}`);
  console.log(`      • Tracked Chunks:   ${report.metrics.totalTrackedChunks} (${(report.metrics.totalCatalogBytes / 1024).toFixed(1)} KB)`);
  console.log(`      • Node / Platform:  ${report.system.nodeVersion} (${report.system.platform})`);
  console.log(`      • RSS Memory:       ${(report.system.rssMemoryBytes / (1024 * 1024)).toFixed(1)} MB`);

  console.log('\n===========================================================');
  console.log('   PROMPT SUCCESS CRITERION: HARDENING SUITE PASS          ');
  console.log('===========================================================');
}

runHardeningTest().catch(err => {
  console.error('\n❌ Hardening test failed:', err);
  process.exit(1);
});
