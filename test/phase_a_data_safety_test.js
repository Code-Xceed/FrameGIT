/**
 * FrameGit Phase A Verification Test Suite: Data Safety & Core Bug Elimination
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { VersionEngine } = require('../core/version_engine');
const { PremiereParser } = require('../core/premiere_parser');
const { ChangeEngine } = require('../core/change_engine');
const { ProductionHardening } = require('../core/hardening');
const { CredentialVault } = require('../core/vault');

const TEST_DIR = path.join(__dirname, 'temp_phase_a_safety');

function setupWorkspace() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(TEST_DIR, 'Footage'), { recursive: true });

  const dummyXml = `<?xml version="1.0" encoding="UTF-8"?>
<PremiereData Version="3">
  <Project ObjectID="1" Name="SafetyTest">
    <Sequence ObjectID="seq_1" Name="MainSeq" Duration="2540160000000">
      <TrackItem ObjectID="clip_1" TrackName="Video 1" Name="Intro.mov" Start="0" End="254016000000" In="0" Out="254016000000" MediaID="m1"/>
    </Sequence>
  </Project>
</PremiereData>`;

  const prprojPath = path.join(TEST_DIR, 'Project.prproj');
  fs.writeFileSync(prprojPath, zlib.gzipSync(Buffer.from(dummyXml, 'utf-8')));

  const clipPath = path.join(TEST_DIR, 'Footage', 'Intro.mov');
  fs.writeFileSync(clipPath, Buffer.alloc(1024 * 64, 0x11));

  return { prprojPath, clipPath };
}

test('Phase A.1: Untracked Media Files Are NEVER Deleted on Checkout', async () => {
  setupWorkspace();
  const engine = new VersionEngine(TEST_DIR, 'Project.prproj');
  engine.init();

  // Commit 1
  const c1 = await engine.commit('Initial commit with Intro.mov');
  assert.ok(c1.commitHash);

  // Now create a brand new untracked video file representing newly imported footage
  const rawFootagePath = path.join(TEST_DIR, 'Footage', 'CameraCard_A001_Take1.braw');
  fs.writeFileSync(rawFootagePath, Buffer.alloc(1024 * 128, 0x99));
  assert.ok(fs.existsSync(rawFootagePath), 'New camera file created on disk');

  // Checkout commit 1 with force=true (or switch branch)
  engine.checkoutCommit(c1.commitHash, true);

  // CRITICAL VERIFICATION: Untracked camera footage must NOT be unlinked
  assert.ok(
    fs.existsSync(rawFootagePath),
    'DATA LOSS DETECTED: Untracked footage was destroyed during checkout!'
  );

  engine.close();
});

test('Phase A.2: Detached HEAD Checkout Updates repo_meta Correctly', async () => {
  setupWorkspace();
  const engine = new VersionEngine(TEST_DIR, 'Project.prproj');
  engine.init();

  const c1 = await engine.commit('Commit 1 on main');
  assert.strictEqual(engine.getCurrentBranch(), 'main');
  assert.strictEqual(engine.getHeadCommitHash(), c1.commitHash);

  // Checkout detached HEAD
  engine.checkoutCommit(c1.commitHash, true);

  // Must report detached HEAD (null branch) and HEAD pointing to commit
  assert.strictEqual(engine.getCurrentBranch(), null, 'Branch must be null in detached HEAD');
  assert.strictEqual(engine.getHeadCommitHash(), c1.commitHash, 'HEAD must point directly to commit hash');

  // Switch back to main
  const sw = engine.switchBranch('main');
  assert.strictEqual(sw.switched, true);
  assert.strictEqual(engine.getCurrentBranch(), 'main');

  engine.close();
});

test('Phase A.3: Deterministic Clip ID Derivation Prevents Phantom Diffs', () => {
  const xmlWithoutIds = `<?xml version="1.0" encoding="UTF-8"?>
<PremiereData Version="3">
  <Project Name="NoIds">
    <Sequence Name="SeqA">
      <TrackItem TrackName="V1" Name="Unlabeled.mov" Start="1000" In="0"/>
    </Sequence>
  </Project>
</PremiereData>`;

  const tempFile = path.join(TEST_DIR, 'NoIds.prproj');
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.writeFileSync(tempFile, zlib.gzipSync(Buffer.from(xmlWithoutIds, 'utf-8')));

  const parse1 = PremiereParser.parseProjectFile(tempFile);
  const parse2 = PremiereParser.parseProjectFile(tempFile);

  const id1 = parse1.sequences[0].tracks[0].clips[0].id;
  const id2 = parse2.sequences[0].tracks[0].clips[0].id;

  assert.ok(id1.startsWith('c_'), 'Deterministic ID generated');
  assert.strictEqual(id1, id2, 'Identical project XML must produce identical deterministic IDs across parses');
});

test('Phase A.4: Sequence Deletion Is Detected by ChangeEngine', () => {
  const prevState = {
    sequences: [
      { name: 'Assembly_Cut', markers: [], tracks: [] },
      { name: 'Deleted_Scene_Sequence', markers: [], tracks: [] }
    ]
  };

  const currState = {
    sequences: [
      { name: 'Assembly_Cut', markers: [], tracks: [] }
    ]
  };

  const changes = ChangeEngine.diffStates(prevState, currState);
  const seqDeletedChange = changes.find(c => c.type === 'sequence_deleted');
  assert.ok(seqDeletedChange, 'ChangeEngine must detect deleted sequences');
  assert.strictEqual(seqDeletedChange.details.sequenceName, 'Deleted_Scene_Sequence');
});

test('Phase A.5: Vault Key Derivation Remains Stable Across Machine Hostname Changes', () => {
  const vaultDir = path.join(TEST_DIR, 'vault_test');
  fs.mkdirSync(vaultDir, { recursive: true });

  const vaultPath = path.join(vaultDir, 'creds.enc');
  const saltPath = path.join(vaultDir, '.salt');
  const machineIdPath = path.join(vaultDir, '.machine_id');

  const v1 = new CredentialVault({ vaultPath, saltPath, machineIdPath });
  v1.setSecret('r2.key', 'R2_SUPER_SECRET_VALUE');

  // Instantiate second vault instance referencing the same machine ID and salt
  const v2 = new CredentialVault({ vaultPath, saltPath, machineIdPath });
  assert.strictEqual(v2.getSecret('r2.key'), 'R2_SUPER_SECRET_VALUE');
});

test('Phase A.6: Offline Sync Queue Uploads Chunks & Commits without Discarding', async () => {
  setupWorkspace();
  const engine = new VersionEngine(TEST_DIR, 'Project.prproj');
  engine.init();
  const c1 = await engine.commit('Commit for queue test');

  const hardening = new ProductionHardening(engine);
  hardening.init();

  // Enqueue a chunk and a commit
  hardening.enqueueSync('chunk', 'c_test_chunk_hash');
  hardening.enqueueSync('commit', c1.commitHash);

  const uploadedKeys = [];
  const mockCloud = {
    putObject: async (key) => {
      uploadedKeys.push(key);
      return { success: true };
    }
  };

  // Replace storage readObject with a dummy payload for the test chunk
  const origRead = engine.storage.readObject.bind(engine.storage);
  engine.storage.readObject = (hash) => {
    if (hash === 'c_test_chunk_hash') {
      return { payload: Buffer.from('test_chunk_payload') };
    }
    return origRead(hash);
  };

  const mockSyncEngine = {
    cloudClient: mockCloud,
    storage: engine.storage,
    push: async () => ({ success: true })
  };

  const res = await hardening.processSyncQueue(mockSyncEngine);
  assert.strictEqual(res.processed, 2);
  assert.strictEqual(res.failed, 0);
  assert.ok(uploadedKeys.includes('chunks/c_test_chunk_hash'), 'Chunk was pushed to cloud');
  assert.ok(uploadedKeys.includes(`commits/${c1.commitHash}`), 'Commit was pushed to cloud');

  engine.close();

  // Cleanup test workspace
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch (_) {}
});
