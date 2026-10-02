// FrameGit - Phase 5 Version Engine Multi-Branch Lifecycle Test
// Tests DAG commits, branch creation, switching, uncommitted change protection,
// and bit-for-bit workspace restoration across multiple branches.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const assert = require('node:assert');
const { VersionEngine, DirtyWorkingTreeError } = require('../core/version_engine');
const { Hasher } = require('../core/hasher');
const { PremiereParser } = require('../core/premiere_parser');

const WORKSPACE_DIR = path.join(__dirname, 'version_engine_workspace');
const PROJECT_FILE = path.join(WORKSPACE_DIR, 'Commercial.prproj');
const FOOTAGE_DIR = path.join(WORKSPACE_DIR, 'Footage');

function createPrprojXml({ durationTicks, exposureVal, tempVal, markerText }) {
  const markerXml = markerText
    ? `<Marker ObjectID="m1" Name="${markerText}" Time="317520000000" Comment="Format note" Type="Cyan" />`
    : '';

  return `<?xml version="1.0" encoding="UTF-8" ?>
<PremiereData Version="3">
  <Project ObjectID="1" Name="Commercial">
    <Media ObjectID="med1" FilePath="Footage/HeroShot.mov" Name="HeroShot.mov" />
    <Sequence ObjectID="seq1" Name="Master_Edit" Duration="${durationTicks}">
      ${markerXml}
      <TrackItem ObjectID="c1" TrackIndex="1" TrackType="video" Name="HeroShot.mov" MediaID="med1" Start="0" End="${durationTicks}" In="0" Out="${durationTicks}">
        <Component DisplayName="Lumetri Color">
          <Parameter Name="Exposure" CurrentValue="${exposureVal}" />
          <Parameter Name="Temperature" CurrentValue="${tempVal}" />
        </Component>
      </TrackItem>
    </Sequence>
  </Project>
</PremiereData>`;
}

async function runVersionEngineTest() {
  console.log('===========================================================');
  console.log('       FRAMEGIT — PHASE 5 VERSION ENGINE TEST SUITE        ');
  console.log('===========================================================\n');

  if (fs.existsSync(WORKSPACE_DIR)) {
    fs.rmSync(WORKSPACE_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(FOOTAGE_DIR, { recursive: true });

  // Create sample media
  const heroPath = path.join(FOOTAGE_DIR, 'HeroShot.mov');
  const heroData = Buffer.alloc(1024 * 1024 * 3); // 3MB mock video
  heroData.fill(0x33);
  fs.writeFileSync(heroPath, heroData);

  // Initial XML (30s duration = 7,620,480,000,000 ticks, Exposure 0.0, Temp 5600)
  const initialXml = createPrprojXml({
    durationTicks: '7620480000000',
    exposureVal: '0.0',
    tempVal: '5600',
    markerText: ''
  });
  fs.writeFileSync(PROJECT_FILE, zlib.gzipSync(Buffer.from(initialXml, 'utf-8')));
  const initialHash = Hasher.hash(fs.readFileSync(PROJECT_FILE));

  console.log('[1] Initializing Version Engine repository on branch: main');
  const engine = new VersionEngine(WORKSPACE_DIR, 'Commercial.prproj');
  engine.init();
  assert.strictEqual(engine.getCurrentBranch(), 'main');
  console.log('    ✓ Default branch is main\n');

  // Step 2: Commit 1 on main
  console.log('[2] Creating Commit 1 on main: "Initial 30s commercial assembly"...');
  const c1 = await engine.commit('Initial 30s commercial assembly', { name: 'Lead Editor', email: 'lead@studio.com' });
  console.log(`    ✓ Commit 1: ${c1.commitHash.slice(0, 8)} on ${c1.branch}`);
  console.log(`    ✓ Project Hash: ${initialHash.slice(0, 12)}...\n`);

  // Step 3: Create and switch to branch: color-grade
  console.log('[3] Creating and switching to branch: "color-grade"...');
  engine.createBranch('color-grade');
  const switch1 = engine.switchBranch('color-grade');
  assert.strictEqual(switch1.branch, 'color-grade');
  assert.strictEqual(engine.getCurrentBranch(), 'color-grade');
  console.log('    ✓ Switched to branch color-grade');

  // Mutate project for color grading: Exposure = 0.85, Temp = 6200
  console.log('    Modifying Lumetri Color: Exposure 0.0 -> 0.85, Temp 5600 -> 6200...');
  const colorXml = createPrprojXml({
    durationTicks: '7620480000000',
    exposureVal: '0.85',
    tempVal: '6200',
    markerText: ''
  });
  fs.writeFileSync(PROJECT_FILE, zlib.gzipSync(Buffer.from(colorXml, 'utf-8')));
  const colorHash = Hasher.hash(fs.readFileSync(PROJECT_FILE));

  const c2 = await engine.commit('Warm commercial color grade pass', { name: 'Colorist', email: 'color@studio.com' });
  console.log(`    ✓ Commit 2: ${c2.commitHash.slice(0, 8)} on ${c2.branch}`);
  console.log(`    ✓ Color Hash: ${colorHash.slice(0, 12)}...\n`);

  // Step 4: Create branch social-cut branching off main (c1)
  console.log('[4] Creating branch "social-cut" originating from main (Commit 1)...');
  engine.createBranch('social-cut', c1.commitHash);

  // Switch to social-cut
  engine.switchBranch('social-cut');
  assert.strictEqual(engine.getCurrentBranch(), 'social-cut');
  console.log('    ✓ Switched to branch social-cut');

  // Mutate project for social cut: 15s duration (3,810,240,000,000 ticks) + Marker
  console.log('    Trimming duration from 30s to 15s and adding "IG Reel Cut" marker...');
  const socialXml = createPrprojXml({
    durationTicks: '3810240000000',
    exposureVal: '0.0',
    tempVal: '5600',
    markerText: 'IG Reel Cut'
  });
  fs.writeFileSync(PROJECT_FILE, zlib.gzipSync(Buffer.from(socialXml, 'utf-8')));
  const socialHash = Hasher.hash(fs.readFileSync(PROJECT_FILE));

  const c3 = await engine.commit('15s vertical social cut', { name: 'Assistant Editor', email: 'assist@studio.com' });
  console.log(`    ✓ Commit 3: ${c3.commitHash.slice(0, 8)} on ${c3.branch}`);
  console.log(`    ✓ Social Hash: ${socialHash.slice(0, 12)}...\n`);

  // Step 5: Test listBranches()
  console.log('[5] Querying branch catalog:');
  const branches = engine.listBranches();
  for (const b of branches) {
    console.log(`    ${b.isCurrent ? '●' : ' '} ${b.name.padEnd(14)} [${b.commitHash.slice(0, 8)}] "${b.message}"`);
  }
  assert.strictEqual(branches.length, 3);
  assert(branches.some(b => b.name === 'main'));
  assert(branches.some(b => b.name === 'color-grade'));
  assert(branches.some(b => b.name === 'social-cut'));
  console.log('    ✓ All 3 branches registered correctly.\n');

  // Step 6: Test Branch Switching & Workspace Restoration
  console.log('[6] Testing branch switching and bit-for-bit workspace restoration:');

  // Switch to main
  console.log('    Switching to main...');
  engine.switchBranch('main');
  const currentMainHash = Hasher.hash(fs.readFileSync(PROJECT_FILE));
  assert.strictEqual(currentMainHash, initialHash, 'main project file must match initial commit bit-for-bit');
  const parsedMain = PremiereParser.parseProjectFile(PROJECT_FILE);
  assert.strictEqual(parsedMain.sequences[0].durationTicks, '7620480000000');
  console.log('    ✓ main restored: duration is 30s, Lumetri exposure is 0.0 (Bit-for-bit match)');

  // Switch to color-grade
  console.log('    Switching to color-grade...');
  engine.switchBranch('color-grade');
  const currentColorHash = Hasher.hash(fs.readFileSync(PROJECT_FILE));
  assert.strictEqual(currentColorHash, colorHash, 'color-grade project file must match color commit bit-for-bit');
  const parsedColor = PremiereParser.parseProjectFile(PROJECT_FILE);
  const colorLumetri = parsedColor.sequences[0].tracks[0].clips[0].effects[0];
  assert.strictEqual(String(colorLumetri.parameters.Exposure), '0.85');
  assert.strictEqual(String(colorLumetri.parameters.Temperature), '6200');
  console.log('    ✓ color-grade restored: exposure is 0.85, temp is 6200 (Bit-for-bit match)');

  // Switch to social-cut
  console.log('    Switching to social-cut...');
  engine.switchBranch('social-cut');
  const currentSocialHash = Hasher.hash(fs.readFileSync(PROJECT_FILE));
  assert.strictEqual(currentSocialHash, socialHash, 'social-cut project file must match social commit bit-for-bit');
  const parsedSocial = PremiereParser.parseProjectFile(PROJECT_FILE);
  assert.strictEqual(parsedSocial.sequences[0].durationTicks, '3810240000000');
  assert.strictEqual(parsedSocial.sequences[0].markers[0].name, 'IG Reel Cut');
  console.log('    ✓ social-cut restored: duration is 15s, marker "IG Reel Cut" present (Bit-for-bit match)\n');

  // Step 7: Test Dirty Working Tree Protection
  console.log('[7] Testing dirty working tree protection (data loss prevention):');
  // Make uncommitted edit on social-cut
  const dirtyXml = createPrprojXml({
    durationTicks: '9999999999999',
    exposureVal: '1.5',
    tempVal: '7000',
    markerText: 'Uncommitted'
  });
  fs.writeFileSync(PROJECT_FILE, zlib.gzipSync(Buffer.from(dirtyXml, 'utf-8')));

  let threwExpected = false;
  try {
    engine.switchBranch('main');
  } catch (err) {
    if (err instanceof DirtyWorkingTreeError) {
      threwExpected = true;
      console.log(`    ✓ Protected: ${err.message}`);
      console.log(`      Detected uncommitted changes: ${err.dirtyFiles.length}`);
    }
  }
  assert(threwExpected, 'Must throw DirtyWorkingTreeError to prevent overwriting unsaved edits');
  assert.strictEqual(engine.getCurrentBranch(), 'social-cut', 'Branch must remain unchanged');
  console.log('    ✓ Data loss prevention verified.\n');

  // Discard dirty edit by forcing checkout of social-cut HEAD
  engine.checkoutCommit(c3.commitHash, true);

  // Step 8: Test Commit History DAG Traversal (getLog)
  console.log('[8] Testing DAG commit history traversal:');
  engine.switchBranch('social-cut');
  const socialLog = engine.getLog();
  console.log('    Log for branch social-cut:');
  for (const item of socialLog) {
    console.log(`      ● ${item.commit_hash.slice(0, 8)}: "${item.message}" by ${item.author_name}`);
  }
  assert.strictEqual(socialLog.length, 2);
  assert.strictEqual(socialLog[0].commit_hash, c3.commitHash);
  assert.strictEqual(socialLog[1].commit_hash, c1.commitHash);
  console.log('    ✓ DAG parent relationship verified (Commit 3 -> Commit 1).\n');

  // Step 9: Test Branch Deletion
  console.log('[9] Testing branch deletion:');
  let deleteActiveThrew = false;
  try {
    engine.deleteBranch('social-cut');
  } catch (err) {
    deleteActiveThrew = true;
    console.log(`    ✓ Cannot delete active branch: "${err.message}"`);
  }
  assert(deleteActiveThrew, 'Must block deleting active branch');

  engine.switchBranch('main');
  engine.deleteBranch('social-cut');
  const remainingBranches = engine.listBranches();
  assert.strictEqual(remainingBranches.length, 2);
  assert(!remainingBranches.some(b => b.name === 'social-cut'));
  console.log('    ✓ Branch social-cut deleted cleanly after switching away.');

  console.log('\n===========================================================');
  console.log('  PROMPT SUCCESS CRITERION: VERSION ENGINE VALIDATION PASS  ');
  console.log('===========================================================');
}

runVersionEngineTest().catch(err => {
  console.error('\nVERSION ENGINE TEST FAILED:', err);
  process.exit(1);
});
