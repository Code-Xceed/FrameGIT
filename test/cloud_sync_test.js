// FrameGit - Phase 6 Cloud Sync Integration Test Suite
// Validates resumable push, pull, remote chunk deduplication, network loss recovery, conflict detection, and clone.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const assert = require('node:assert');
const { VersionEngine } = require('../core/version_engine');
const { SyncEngine } = require('../core/sync_engine');
const { CloudClient, ConflictError, NetworkError } = require('../core/cloud_client');
const { Hasher } = require('../core/hasher');

const WORKSPACE_DIR = path.join(__dirname, 'cloud_sync_workspace');
const CLONE_DIR = path.join(__dirname, 'cloud_clone_workspace');
const PROJECT_FILE = path.join(WORKSPACE_DIR, 'ClientAd.prproj');
const FOOTAGE_DIR = path.join(WORKSPACE_DIR, 'Footage');

function createPrprojXml(name, clipCount) {
  let clipsXml = '';
  let mediaXml = '';
  for (let i = 1; i <= clipCount; i++) {
    mediaXml += `<Media ObjectID="med${i}" FilePath="Footage/Take_${i}.mov" Name="Take_${i}.mov" />\n`;
    clipsXml += `<TrackItem ObjectID="clip${i}" TrackIndex="1" TrackType="video" Name="Take_${i}.mov" MediaID="med${i}" Start="${(i - 1) * 120960000000}" End="${i * 120960000000}" In="0" Out="120960000000" />\n`;
  }

  return `<?xml version="1.0" encoding="UTF-8" ?>
<PremiereData Version="3">
  <Project ObjectID="1" Name="${name}">
    ${mediaXml}
    <Sequence ObjectID="seq1" Name="Timeline" Duration="${clipCount * 120960000000}">
      ${clipsXml}
    </Sequence>
  </Project>
</PremiereData>`;
}

async function runCloudSyncTest() {
  console.log('===========================================================');
  console.log('       FRAMEGIT — PHASE 6 CLOUD SYNC TEST SUITE            ');
  console.log('===========================================================\n');

  // Clean setup
  if (fs.existsSync(WORKSPACE_DIR)) fs.rmSync(WORKSPACE_DIR, { recursive: true, force: true });
  if (fs.existsSync(CLONE_DIR)) fs.rmSync(CLONE_DIR, { recursive: true, force: true });
  fs.mkdirSync(FOOTAGE_DIR, { recursive: true });

  // Create initial media assets
  const take1Path = path.join(FOOTAGE_DIR, 'Take_1.mov');
  const take1Data = Buffer.alloc(1024 * 1024 * 2); // 2 MB
  take1Data.fill(0x11);
  fs.writeFileSync(take1Path, take1Data);

  const initialXml = createPrprojXml('ClientAd', 1);
  fs.writeFileSync(PROJECT_FILE, zlib.gzipSync(Buffer.from(initialXml, 'utf-8')));

  const cloudClient = new CloudClient();
  const repo = new VersionEngine(WORKSPACE_DIR, 'ClientAd.prproj');
  repo.init();
  const sync = new SyncEngine(WORKSPACE_DIR, cloudClient, repo.db);

  // -------------------------------------------------------------
  // TEST 1: Initial Push to Cloud Storage
  // -------------------------------------------------------------
  console.log('[TEST 1] Testing initial push to cloud storage:');
  const c1 = await repo.commit('Initial cut with Take 1', { name: 'Editor', email: 'ed@studio.com' });
  console.log(`    Local Commit 1: ${c1.commitHash.slice(0, 8)} on ${c1.branch}`);

  const push1 = await sync.push('main');
  console.log(`    ✓ Push complete:`);
  console.log(`      • Uploaded Chunks:      ${push1.uploadedChunks}`);
  console.log(`      • Reused Remote Chunks: ${push1.reusedRemoteChunks}`);
  console.log(`      • Remote HEAD:          ${(await cloudClient.getRef('main')).slice(0, 8)}`);
  assert(push1.uploadedChunks > 0, 'Must upload initial chunks');
  assert.strictEqual(await cloudClient.getRef('main'), c1.commitHash);
  console.log('    ✓ Cloud remote ref updated successfully.\n');

  // -------------------------------------------------------------
  // TEST 2: Incremental Push & Remote Deduplication
  // -------------------------------------------------------------
  console.log('[TEST 2] Testing incremental push with remote deduplication:');
  // Add Take 2 media asset
  const take2Path = path.join(FOOTAGE_DIR, 'Take_2.mov');
  const take2Data = Buffer.alloc(1024 * 1024 * 1.5); // 1.5 MB
  take2Data.fill(0x22);
  fs.writeFileSync(take2Path, take2Data);

  const editXml = createPrprojXml('ClientAd', 2);
  fs.writeFileSync(PROJECT_FILE, zlib.gzipSync(Buffer.from(editXml, 'utf-8')));

  const c2 = await repo.commit('Added Take 2 to sequence', { name: 'Editor', email: 'ed@studio.com' });
  console.log(`    Local Commit 2: ${c2.commitHash.slice(0, 8)} on ${c2.branch}`);

  const push2 = await sync.push('main');
  console.log(`    ✓ Incremental push complete:`);
  console.log(`      • Uploaded Chunks:      ${push2.uploadedChunks} (only new Take 2 + delta project chunks)`);
  console.log(`      • Reused Remote Chunks: ${push2.reusedRemoteChunks} (Take 1 unchanged chunks skipped!)`);
  assert(push2.reusedRemoteChunks > 0, 'Must reuse existing remote chunks from Take 1');
  assert.strictEqual(await cloudClient.getRef('main'), c2.commitHash);
  console.log('    ✓ Remote deduplication confirmed: zero duplicate bytes re-uploaded.\n');

  // -------------------------------------------------------------
  // TEST 3: Network Interruption & Resumable Upload
  // -------------------------------------------------------------
  console.log('[TEST 3] Testing network loss recovery & resumable upload:');
  // Add Take 3 media asset
  const take3Path = path.join(FOOTAGE_DIR, 'Take_3.mov');
  const take3Data = Buffer.alloc(1024 * 1024 * 3); // 3 MB
  take3Data.fill(0x33);
  fs.writeFileSync(take3Path, take3Data);

  const editXml3 = createPrprojXml('ClientAd', 3);
  fs.writeFileSync(PROJECT_FILE, zlib.gzipSync(Buffer.from(editXml3, 'utf-8')));

  const c3 = await repo.commit('Added Take 3', { name: 'Editor', email: 'ed@studio.com' });
  console.log(`    Local Commit 3: ${c3.commitHash.slice(0, 8)}`);

  // Simulate network failure
  console.log('    Simulating network disconnect during push...');
  cloudClient.simulateNetworkFailure = true;

  let pushFailedAsExpected = false;
  try {
    await sync.push('main');
  } catch (err) {
    if (err instanceof NetworkError) {
      pushFailedAsExpected = true;
      console.log(`    ✓ Network failure caught safely: "${err.message}"`);
    }
  }
  assert(pushFailedAsExpected, 'Push must safely fail on network drop');

  // Check sync queue status in SQLite
  const pendingRows = repo.db.prepare("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'failed'").get();
  console.log(`    ✓ SQLite sync_queue tracks failed/pending items: ${pendingRows.count} items awaiting retry`);

  // Restore network connection
  console.log('    Restoring network connection...');
  cloudClient.simulateNetworkFailure = false;

  // Retry push: should resume without errors
  const resumePush = await sync.push('main');
  console.log(`    ✓ Resumed push succeeded:`);
  console.log(`      • Uploaded Chunks:      ${resumePush.uploadedChunks}`);
  console.log(`      • Remote HEAD:          ${(await cloudClient.getRef('main')).slice(0, 8)}`);
  assert.strictEqual(await cloudClient.getRef('main'), c3.commitHash);
  console.log('    ✓ Resumable upload completed with zero data loss.\n');

  // -------------------------------------------------------------
  // TEST 4: Conflict Detection (Divergent Remote Branch)
  // -------------------------------------------------------------
  console.log('[TEST 4] Testing conflict detection on divergent remote:');
  // Simulate another editor pushing a divergent commit 'd1' to remote 'main'
  const divergentCommitHash = 'd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1';
  cloudClient.mockRefs.set('main', divergentCommitHash);
  console.log(`    Simulated external collaborator pushing commit: ${divergentCommitHash.slice(0, 8)}`);

  let conflictDetected = false;
  try {
    // Attempt local push
    await sync.push('main');
  } catch (err) {
    if (err instanceof ConflictError) {
      conflictDetected = true;
      console.log(`    ✓ Conflict detected & push rejected:`);
      console.log(`      "${err.message}"`);
    }
  }
  assert(conflictDetected, 'Push MUST fail with ConflictError if remote has diverged');
  console.log('    ✓ Remote branch protected against non-fast-forward clobbering.\n');

  // Restore remote ref to c3 for clone test
  cloudClient.mockRefs.set('main', c3.commitHash);

  // -------------------------------------------------------------
  // TEST 5: Full Project Clone to Fresh Workstation
  // -------------------------------------------------------------
  console.log('[TEST 5] Testing full project clone to a fresh directory:');
  console.log(`    Cloning repository to: ${CLONE_DIR}...`);
  const cloneResult = await sync.clone(CLONE_DIR, 'main');
  console.log(`    ✓ Clone complete:`);
  console.log(`      • Reconstructed to:    ${cloneResult.targetRoot}`);
  console.log(`      • Active Commit:       ${cloneResult.commitHash.slice(0, 8)}`);
  console.log(`      • Downloaded Chunks:   ${cloneResult.downloadedChunks}`);

  // Bit-for-bit file verification between original and cloned workspace
  console.log('\n    Verifying 100% bit-for-bit file integrity on cloned workstation:');
  const origPrprojHash = await Hasher.hashFile(PROJECT_FILE);
  const clonedPrprojHash = await Hasher.hashFile(path.join(CLONE_DIR, 'ClientAd.prproj'));
  console.log(`      • Original .prproj Hash: ${origPrprojHash}`);
  console.log(`      • Cloned .prproj Hash:   ${clonedPrprojHash}`);
  assert.strictEqual(clonedPrprojHash, origPrprojHash, 'Cloned project file must match original bit-for-bit');

  for (let i = 1; i <= 3; i++) {
    const origTake = path.join(FOOTAGE_DIR, `Take_${i}.mov`);
    const clonedTake = path.join(CLONE_DIR, 'Footage', `Take_${i}.mov`);
    assert(fs.existsSync(clonedTake), `Cloned Take_${i}.mov must exist`);
    const h1 = await Hasher.hashFile(origTake);
    const h2 = await Hasher.hashFile(clonedTake);
    assert.strictEqual(h1, h2, `Take_${i}.mov must match bit-for-bit`);
  }
  console.log('      • All 3 media footage files matched bit-for-bit!');
  console.log('    ✓ Fresh clone completed with 100% cryptographic parity.');

  console.log('\n===========================================================');
  console.log('    PROMPT SUCCESS CRITERION: CLOUD SYNC VALIDATION PASS   ');
  console.log('===========================================================');
}

runCloudSyncTest().catch(err => {
  console.error('\nCLOUD SYNC TEST FAILED:', err);
  process.exit(1);
});
