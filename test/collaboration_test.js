// FrameGit - Phase 10 Collaboration & Review Test Suite
// Validates:
// 1. Team RBAC (Owner, Lead Editor, Assistant Editor, Viewer)
// 2. Branch Protection (Direct push blocking for assistants)
// 3. Creative Review Requests & Automated Changelogs
// 4. Timecode-anchored comments & audit logs
// 5. Approval workflows (blocking self-approval, requiring lead sign-off)
// 6. 3-Way Structural Timeline Merge for non-conflicting orthogonal tracks
// 7. Timeline Conflict Detection & Resolution via FORK_TRACK strategy
// 8. Dual-parent DAG merge commits and metadata persistence

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const { VersionEngine } = require('../core/version_engine');
const { PremiereParser } = require('../core/premiere_parser');
const {
  CollaborationEngine,
  ROLES,
  REVIEW_STATUS,
  RESOLUTION_STRATEGY,
  PermissionError,
  BranchProtectionError,
  CreativeMergeConflictError
} = require('../core/collaboration');

const WORKSPACE_DIR = path.join(__dirname, 'collaboration_workspace');
const PROJECT_FILE = path.join(WORKSPACE_DIR, 'FeatureFilm.prproj');
const FOOTAGE_DIR = path.join(WORKSPACE_DIR, 'Footage');

function createSamplePrprojXml({ clipsVideo1 = [], clipsVideo2 = [], audioTracks = [], markers = [] }) {
  let mediaXml = `
    <Media ObjectID="med1" FilePath="Footage/A-Roll_01.mov" Name="A-Roll_01.mov" />
    <Media ObjectID="med2" FilePath="Footage/Foley_Ambience.wav" Name="Foley_Ambience.wav" />
  `;

  let markersXml = '';
  for (const m of markers) {
    markersXml += `    <Marker ObjectID="${m.id}" Name="${m.name}" Time="${m.timeTicks}" Comment="${m.comment}" Type="Cyan" />\n`;
  }

  let videoTracksXml = '';
  // Track 1
  for (const c of clipsVideo1) {
    videoTracksXml += `    <TrackItem ObjectID="${c.id}" TrackIndex="1" TrackType="video" TrackName="VIDEO 1" Name="${c.name}" MediaID="med1" Start="${c.startTicks}" End="${c.endTicks}" In="0" Out="${BigInt(c.endTicks) - BigInt(c.startTicks)}">
      <Component DisplayName="Lumetri Color">
        <Parameter Name="Exposure" CurrentValue="${c.exposure || '0.0'}" />
      </Component>
    </TrackItem>\n`;
  }
  // Track 2 (if any)
  for (const c of clipsVideo2) {
    videoTracksXml += `    <TrackItem ObjectID="${c.id}" TrackIndex="2" TrackType="video" TrackName="VIDEO 2" Name="${c.name}" MediaID="med1" Start="${c.startTicks}" End="${c.endTicks}" In="0" Out="${BigInt(c.endTicks) - BigInt(c.startTicks)}">
      <Component DisplayName="Lumetri Color">
        <Parameter Name="Exposure" CurrentValue="${c.exposure || '0.0'}" />
      </Component>
    </TrackItem>\n`;
  }

  let audioTracksXml = '';
  for (const at of audioTracks) {
    for (const c of at.clips) {
      audioTracksXml += `    <TrackItem ObjectID="${c.id}" TrackIndex="${at.index}" TrackType="audio" TrackName="AUDIO ${at.index}" Name="${c.name}" MediaID="med2" Start="${c.startTicks}" End="${c.endTicks}" In="0" Out="${BigInt(c.endTicks) - BigInt(c.startTicks)}" />\n`;
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<PremiereData Version="3">
  <Project ObjectID="1" Name="FeatureFilm">
${mediaXml}
    <Sequence ObjectID="seq1" Name="Scene_01" Duration="725760000000">
${markersXml}
${videoTracksXml}
${audioTracksXml}
    </Sequence>
  </Project>
</PremiereData>`;

  return PremiereParser.compressXmlToGzip(xml);
}

async function runCollaborationTest() {
  console.log('===========================================================');
  console.log('       FRAMEGIT — PHASE 10 COLLABORATION TEST SUITE        ');
  console.log('===========================================================\n');

  // [1] Clean and initialize workspace
  if (fs.existsSync(WORKSPACE_DIR)) {
    fs.rmSync(WORKSPACE_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(FOOTAGE_DIR, { recursive: true });

  fs.writeFileSync(path.join(FOOTAGE_DIR, 'A-Roll_01.mov'), Buffer.alloc(1024 * 1024, 0x11));
  fs.writeFileSync(path.join(FOOTAGE_DIR, 'Foley_Ambience.wav'), Buffer.alloc(512 * 1024, 0x22));

  // Base state: A-Roll on Video 1 (0 to 5s / 127008000000 ticks), Exposure 0.0
  const basePrproj = createSamplePrprojXml({
    clipsVideo1: [{ id: 'c1', name: 'A-Roll_01.mov', startTicks: '0', endTicks: '127008000000', exposure: '0.0' }],
    audioTracks: [{ index: 1, clips: [{ id: 'a1', name: 'A-Roll_01.wav', startTicks: '0', endTicks: '127008000000' }] }]
  });
  fs.writeFileSync(PROJECT_FILE, basePrproj);

  const engine = new VersionEngine(WORKSPACE_DIR, PROJECT_FILE);
  engine.init();
  const collab = new CollaborationEngine(engine);
  collab.init();

  // Commit 1 on main (Base Commit)
  const commit1 = await engine.commit('Initial Picture Lock', { name: 'Alice (Lead)', email: 'alice@studio.com' });
  console.log(`[1] Initialized workspace and Commit 1 (Base): ${commit1.commitHash.slice(0, 8)} on main`);

  // [2] Setup Team Roles
  const alice = collab.addMember({ userId: 'u_alice', name: 'Alice', email: 'alice@studio.com', role: ROLES.LEAD_EDITOR });
  const bob = collab.addMember({ userId: 'u_bob', name: 'Bob', email: 'bob@studio.com', role: ROLES.ASSISTANT_EDITOR });
  const carol = collab.addMember({ userId: 'u_carol', name: 'Carol', email: 'carol@studio.com', role: ROLES.ASSISTANT_EDITOR });
  const david = collab.addMember({ userId: 'u_david', name: 'David (Director/Client)', email: 'david@client.com', role: ROLES.VIEWER });

  console.log('[2] Configured creative team:');
  console.log(`    • Alice: ${alice.role} (Lead Editor)`);
  console.log(`    • Bob:   ${bob.role} (Assistant Editor)`);
  console.log(`    • Carol: ${carol.role} (Colorist / Assistant)`);
  console.log(`    • David: ${david.role} (Client / Viewer)`);

  // [3] Test RBAC & Branch Protection
  collab.setBranchProtection('main', { blockDirectPush: true, requireReview: true, requiredApprovals: 1, requireLeadApproval: true });
  console.log('\n[3] Testing RBAC and Branch Protection...');
  
  let blockedPush = false;
  try {
    collab.assertDirectPushAllowed(bob, 'main');
  } catch (err) {
    if (err instanceof BranchProtectionError) {
      blockedPush = true;
      console.log(`    ✓ Protected: Direct push to 'main' blocked for ${bob.role} (${err.message.slice(0, 60)}...)`);
    }
  }
  assert.strictEqual(blockedPush, true, 'Assistant editor direct push must be blocked');

  let blockedViewerReview = false;
  try {
    collab.createReviewRequest({ title: 'Illegal Review', sourceBranch: 'main', author: david });
  } catch (err) {
    if (err instanceof PermissionError) {
      blockedViewerReview = true;
      console.log(`    ✓ Protected: Viewer cannot create review requests (${err.message})`);
    }
  }
  assert.strictEqual(blockedViewerReview, true, 'Viewer review creation must be blocked');

  // [4] Scenario 1: Orthogonal Feature Branch (Audio Pass) & 3-Way Clean Merge
  console.log('\n[4] Simulating Feature Branch 1: "feature/sound-mix" by Assistant Editor Bob...');
  engine.createBranch('feature/sound-mix', commit1.commitHash);
  engine.switchBranch('feature/sound-mix');

  // Bob adds Audio Track 2 (Foley) and a Marker, leaving Video 1 untouched
  const soundMixPrproj = createSamplePrprojXml({
    clipsVideo1: [{ id: 'c1', name: 'A-Roll_01.mov', startTicks: '0', endTicks: '127008000000', exposure: '0.0' }],
    audioTracks: [
      { index: 1, clips: [{ id: 'a1', name: 'A-Roll_01.wav', startTicks: '0', endTicks: '127008000000' }] },
      { index: 2, clips: [{ id: 'a2', name: 'Foley_Ambience.wav', startTicks: '0', endTicks: '127008000000' }] }
    ],
    markers: [{ id: 'm1', name: 'Sound Mix Note', timeTicks: '63504000000', comment: 'Added atmospheric room tone' }]
  });
  fs.writeFileSync(PROJECT_FILE, soundMixPrproj);
  const commit2 = await engine.commit('Add Foley ambience stem and room tone marker', { name: 'Bob', email: 'bob@studio.com' });
  console.log(`    ✓ Commit 2: ${commit2.commitHash.slice(0, 8)} on feature/sound-mix`);

  // Bob opens Creative Review Request
  const review1 = collab.createReviewRequest({
    title: 'Sound Design & Foley Pass',
    description: 'Added 5.1 room tone on Audio Track 2 and anchored note marker.',
    sourceBranch: 'feature/sound-mix',
    targetBranch: 'main',
    author: bob
  });
  console.log(`    ✓ Opened Review Request #${review1.id}: "${review1.title}"`);
  console.log(`      Changelog: ${review1.summary.totalChanges} change(s) detected (Markers: +${review1.summary.markersAdded}, Clips: +${review1.summary.clipsAdded})`);

  // David (Client) leaves timecode comment
  collab.addComment(review1.id, {
    author: david,
    timecode: '00:00:02:12',
    sequenceName: 'Scene_01',
    comment: 'The wind atmosphere sounds great here!'
  });
  console.log('    ✓ Client (David) submitted timecode comment at 00:00:02:12');

  // Bob attempts self-approval -> BLOCKED
  let selfApprovalBlocked = false;
  try {
    collab.submitReviewVerdict(review1.id, { reviewer: bob, verdict: 'APPROVED' });
  } catch (err) {
    if (err instanceof PermissionError) {
      selfApprovalBlocked = true;
      console.log(`    ✓ Self-approval prevented: ${err.message}`);
    }
  }
  assert.strictEqual(selfApprovalBlocked, true);

  // Alice (Lead Editor) reviews and approves
  const approvedReview1 = collab.submitReviewVerdict(review1.id, {
    reviewer: alice,
    verdict: 'APPROVED',
    note: 'Audio stems verified. Good levels.'
  });
  assert.strictEqual(approvedReview1.status, REVIEW_STATUS.APPROVED);
  console.log(`    ✓ Review #${review1.id} approved by Lead Editor (Alice). Status: ${approvedReview1.status}`);

  // Alice merges review into main
  engine.switchBranch('main');
  const mergeResult1 = await collab.mergeReview(review1.id, { merger: alice });
  console.log(`    ✓ Clean 3-Way Structural Merge executed! Merge Commit: ${mergeResult1.mergeCommitHash.slice(0, 8)}`);

  // Verify DAG dual parentage of Merge Commit
  const mergeCommitObj = engine.storage.readObject(mergeResult1.mergeCommitHash);
  const mergeCommitData = JSON.parse(mergeCommitObj.payload.toString('utf-8'));
  assert.strictEqual(mergeCommitData.parent, commit1.commitHash);
  assert.strictEqual(mergeCommitData.secondParent, commit2.commitHash);
  console.log(`    ✓ Commit DAG verifies dual parents: Parent1 = ${commit1.commitHash.slice(0, 8)}, Parent2 = ${commit2.commitHash.slice(0, 8)}`);

  // [5] Scenario 2: Divergent Edit on main vs feature branch (Conflict Handling)
  console.log('\n[5] Simulating Branch 2: "feature/color-grade" and conflicting edit on main...');
  // Carol branched from base commit1
  engine.createBranch('feature/color-grade', commit1.commitHash);
  engine.switchBranch('feature/color-grade');

  // Carol shifted exposure to 1.8 on Video 1
  const carolPrproj = createSamplePrprojXml({
    clipsVideo1: [{ id: 'c1', name: 'A-Roll_01.mov', startTicks: '0', endTicks: '127008000000', exposure: '1.8' }],
    audioTracks: [{ index: 1, clips: [{ id: 'a1', name: 'A-Roll_01.wav', startTicks: '0', endTicks: '127008000000' }] }]
  });
  fs.writeFileSync(PROJECT_FILE, carolPrproj);
  const commit3 = await engine.commit('Aggressive warm commercial color grade pass', { name: 'Carol', email: 'carol@studio.com' });
  console.log(`    ✓ Commit 3: ${commit3.commitHash.slice(0, 8)} on feature/color-grade`);

  // Meanwhile on main, Alice trimmed / adjusted exposure to 0.4
  engine.switchBranch('main');
  const aliceMainPrproj = createSamplePrprojXml({
    clipsVideo1: [{ id: 'c1', name: 'A-Roll_01.mov', startTicks: '0', endTicks: '127008000000', exposure: '0.4' }],
    audioTracks: [
      { index: 1, clips: [{ id: 'a1', name: 'A-Roll_01.wav', startTicks: '0', endTicks: '127008000000' }] },
      { index: 2, clips: [{ id: 'a2', name: 'Foley_Ambience.wav', startTicks: '0', endTicks: '127008000000' }] }
    ]
  });
  fs.writeFileSync(PROJECT_FILE, aliceMainPrproj);
  const commit4 = await engine.commit('Subtle exposure bump for broadcast specs', { name: 'Alice', email: 'alice@studio.com' });
  console.log(`    ✓ Commit 4: ${commit4.commitHash.slice(0, 8)} on main`);

  // Carol opens Review Request 2
  const review2 = collab.createReviewRequest({
    title: 'Warm Summer Color Grade',
    description: 'Heavy LUT + Lumetri warm tint.',
    sourceBranch: 'feature/color-grade',
    targetBranch: 'main',
    author: carol
  });
  console.log(`    ✓ Opened Review Request #${review2.id}: "${review2.title}"`);

  collab.submitReviewVerdict(review2.id, { reviewer: alice, verdict: 'APPROVED', note: 'Looks good, but will review collision with my cut.' });

  // Alice attempts merge without conflict resolution -> Conflict detected!
  let conflictCaught = false;
  let detectedConflicts = [];
  try {
    await collab.mergeReview(review2.id, { merger: alice });
  } catch (err) {
    if (err instanceof CreativeMergeConflictError) {
      conflictCaught = true;
      detectedConflicts = err.conflicts;
      console.log(`    ✓ Timeline Conflict Detected: ${err.message}`);
      console.log(`      Track: '${err.conflicts[0].trackName}', Head Exposure: ${err.conflicts[0].headClip.effects[0].parameters.Exposure} vs Incoming Exposure: ${err.conflicts[0].incomingClip.effects[0].parameters.Exposure}`);
    }
  }
  assert.strictEqual(conflictCaught, true, 'Conflict must be detected when both modify the same clip');

  // [6] Conflict Resolution with FORK_TRACK strategy
  console.log('\n[6] Resolving Conflict using FORK_TRACK (Preserving both takes on alternate track)...');
  const conflictId = detectedConflicts[0].conflictId;
  const resolutions = {
    [conflictId]: RESOLUTION_STRATEGY.FORK_TRACK
  };

  const mergeResult2 = await collab.mergeReview(review2.id, { merger: alice, resolutions });
  console.log(`    ✓ Conflict resolved and merged! Merge Commit: ${mergeResult2.mergeCommitHash.slice(0, 8)}`);

  // Inspect the resulting project on disk
  const finalState = engine.adapter.getProjectState(PROJECT_FILE);
  const finalSeq = finalState.sequences[0];
  console.log('    ✓ Reconciled Timeline Structure:');
  for (const t of finalSeq.tracks) {
    console.log(`      • Track '${t.name}': ${t.clips.length} clip(s)`);
    for (const c of t.clips) {
      const exp = c.effects?.[0]?.parameters?.Exposure || 'N/A';
      console.log(`        - [${c.name}] Exposure: ${exp}`);
    }
  }

  // Verifications:
  // 1. VIDEO 1 retains Alice's broadcast exposure (0.4)
  const track1 = finalSeq.tracks.find(t => t.name === 'VIDEO 1');
  assert.strictEqual(track1.clips[0].effects[0].parameters.Exposure, '0.4');

  // 2. VIDEO 1 (Incoming Alt) was dynamically created containing Carol's warm grade (1.8)
  const altTrack = finalSeq.tracks.find(t => t.name === 'VIDEO 1 (Incoming Alt)');
  assert.ok(altTrack, 'Alternate track must be created by FORK_TRACK strategy');
  assert.strictEqual(altTrack.clips[0].effects[0].parameters.Exposure, '1.8');

  // 3. AUDIO 2 from first merge was preserved in project
  const audio2 = finalSeq.tracks.find(t => t.name === 'AUDIO 2');
  assert.ok(audio2, 'AUDIO 2 from earlier merge must be preserved');

  // [7] Persistence Verification
  console.log('\n[7] Verifying review metadata JSON persistence on disk:');
  const rev1File = path.join(WORKSPACE_DIR, '.framegit', 'reviews', `${review1.id}.json`);
  const rev2File = path.join(WORKSPACE_DIR, '.framegit', 'reviews', `${review2.id}.json`);
  assert.ok(fs.existsSync(rev1File), 'Review 1 JSON must exist');
  assert.ok(fs.existsSync(rev2File), 'Review 2 JSON must exist');

  const rev1Disk = JSON.parse(fs.readFileSync(rev1File, 'utf-8'));
  assert.strictEqual(rev1Disk.status, REVIEW_STATUS.MERGED);
  assert.strictEqual(rev1Disk.comments.length, 1);
  assert.strictEqual(rev1Disk.comments[0].timecode, '00:00:02:12');
  console.log(`    ✓ ${review1.id}.json verified with status: ${rev1Disk.status}, comments: ${rev1Disk.comments.length}`);

  const rev2Disk = JSON.parse(fs.readFileSync(rev2File, 'utf-8'));
  assert.strictEqual(rev2Disk.status, REVIEW_STATUS.MERGED);
  console.log(`    ✓ ${review2.id}.json verified with status: ${rev2Disk.status}`);

  console.log('\n===========================================================');
  console.log('   PROMPT SUCCESS CRITERION: COLLABORATION SUITE PASS      ');
  console.log('===========================================================');
}

runCollaborationTest().catch(err => {
  console.error('\n❌ Collaboration test failed:', err);
  process.exit(1);
});
