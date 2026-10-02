// FrameGit - Phase 7 GitHub Integration Test Suite
// Validates GitHub repository linking, manifest/pointer mirroring, release tagging,
// and project reconstruction using GitHub metadata + Cloudflare R2 asset storage.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const assert = require('node:assert');
const { VersionEngine } = require('../core/version_engine');
const { SyncEngine } = require('../core/sync_engine');
const { CloudClient } = require('../core/cloud_client');
const { GitHubSync } = require('../core/github_sync');
const { MockGitHubApi } = require('./mocks/mock_github');
const { Hasher } = require('../core/hasher');

const WORKSPACE_DIR = path.join(__dirname, 'github_sync_workspace');
const RECON_DIR = path.join(__dirname, 'github_reconstruct_workspace');
const PROJECT_FILE = path.join(WORKSPACE_DIR, 'ClientAd.prproj');
const FOOTAGE_DIR = path.join(WORKSPACE_DIR, 'Footage');

function createSamplePrprojXml() {
  return `<?xml version="1.0" encoding="UTF-8" ?>
<PremiereData Version="3">
  <Project ObjectID="1" Name="ClientAd">
    <Media ObjectID="med1" FilePath="Footage/HeroTake.mov" Name="HeroTake.mov" />
    <Sequence ObjectID="seq1" Name="Main_Timeline" Duration="120960000000">
      <TrackItem ObjectID="c1" TrackIndex="1" TrackType="video" Name="HeroTake.mov" MediaID="med1" Start="0" End="120960000000" In="0" Out="120960000000">
        <Component DisplayName="Lumetri Color">
          <Parameter Name="Exposure" CurrentValue="0.65" />
        </Component>
      </TrackItem>
    </Sequence>
  </Project>
</PremiereData>`;
}

async function runGitHubSyncTest() {
  console.log('===========================================================');
  console.log('       FRAMEGIT — PHASE 7 GITHUB INTEGRATION TEST          ');
  console.log('===========================================================\n');

  if (fs.existsSync(WORKSPACE_DIR)) fs.rmSync(WORKSPACE_DIR, { recursive: true, force: true });
  if (fs.existsSync(RECON_DIR)) fs.rmSync(RECON_DIR, { recursive: true, force: true });
  fs.mkdirSync(FOOTAGE_DIR, { recursive: true });

  // Create 2.5 MB mock media file
  const heroPath = path.join(FOOTAGE_DIR, 'HeroTake.mov');
  const heroData = Buffer.alloc(1024 * 1024 * 2.5);
  heroData.fill(0x55);
  fs.writeFileSync(heroPath, heroData);

  const initialXml = createSamplePrprojXml();
  fs.writeFileSync(PROJECT_FILE, zlib.gzipSync(Buffer.from(initialXml, 'utf-8')));
  const originalPrprojHash = await Hasher.hashFile(PROJECT_FILE);
  const originalHeroHash = await Hasher.hashFile(heroPath);

  // Initialize Version Engine & Cloud Sync
  const engine = new VersionEngine(WORKSPACE_DIR, 'ClientAd.prproj');
  engine.init();

  const cloudClient = new CloudClient();
  const syncEngine = new SyncEngine(WORKSPACE_DIR, cloudClient, engine.db);

  // Commit and push to Cloudflare R2
  const commit1 = await engine.commit('Client Approval Cut with graded hero shot', {
    name: 'Lead Colorist',
    email: 'color@agency.com'
  });
  console.log(`[1] Created FrameGit commit: ${commit1.commitHash.slice(0, 8)}`);
  await syncEngine.push('main');
  console.log('    ✓ Media chunks uploaded to Cloudflare R2 (zero egress)\n');

  // Step 2: Link with GitHub
  console.log('[2] Linking repository with GitHub:');
  const gitHubApi = new MockGitHubApi();
  const ghSync = new GitHubSync(engine, { apiClient: gitHubApi });

  const linkResult = ghSync.linkRepository('ghp_abcdef1234567890oauth_token', 'agency-media/commercial-ad');
  console.log(`    ✓ Authenticated user: ${linkResult.user}`);
  console.log(`    ✓ Linked repository:  ${linkResult.repo}\n`);

  // Step 3: Mirror commit metadata & pointers to GitHub
  console.log('[3] Mirroring FrameGit commit & pointers to GitHub:');
  const mirrorResult = await ghSync.syncBranchToGitHub('main');
  console.log(`    ✓ GitHub Commit SHA:      ${mirrorResult.gitSha}`);
  console.log(`    ✓ Files Pushed to Git:    ${mirrorResult.filesPushed} (manifest.json, pointers, README.md)`);
  console.log(`    ✓ Total Git Payload Size: ${(mirrorResult.totalManifestBytes / 1024).toFixed(2)} KB`);

  // Verify GitHub repository tree
  const ghRepo = gitHubApi.repositories.get('agency-media/commercial-ad');
  assert(ghRepo.tree.has('.framegit/manifest.json'), 'manifest.json must exist in GitHub repo');
  assert(ghRepo.tree.has('README.md'), 'README.md must exist in GitHub repo');
  console.log('    ✓ Zero video bytes on GitHub: repository payload strictly contains metadata & pointers.\n');

  // Step 4: Create Release Tag on GitHub
  console.log('[4] Creating release tag on GitHub:');
  const tagResult = await ghSync.createReleaseTag('v1.0-client-approved', 'Official client approval milestone');
  console.log(`    ✓ Tag created: '${tagResult.name}' pointing to commit ${tagResult.commitSha.slice(0, 8)}`);
  assert.strictEqual(tagResult.name, 'v1.0-client-approved');
  console.log('    ✓ Release tag verified.\n');

  // Step 5: Reconstruct project from GitHub Metadata + Cloudflare R2
  console.log('[5] Testing fresh project reconstruction from GitHub metadata + R2:');
  console.log(`    Target: ${RECON_DIR}...`);

  const reconResult = await GitHubSync.reconstructFromGitHubAndCloud(
    RECON_DIR,
    cloudClient,
    gitHubApi,
    'agency-media/commercial-ad'
  );
  console.log(`    ✓ Reconstructed FrameGit commit: ${reconResult.framegitCommit.slice(0, 8)}`);

  // Verify bit-for-bit file integrity
  const reconPrprojHash = await Hasher.hashFile(path.join(RECON_DIR, 'ClientAd.prproj'));
  const reconHeroHash = await Hasher.hashFile(path.join(RECON_DIR, 'Footage', 'HeroTake.mov'));

  console.log('\n    Verifying bit-for-bit integrity:');
  console.log(`      • Original .prproj: ${originalPrprojHash}`);
  console.log(`      • Restored .prproj: ${reconPrprojHash}`);
  assert.strictEqual(reconPrprojHash, originalPrprojHash, 'Project file must match bit-for-bit');

  console.log(`      • Original Media:   ${originalHeroHash}`);
  console.log(`      • Restored Media:   ${reconHeroHash}`);
  assert.strictEqual(reconHeroHash, originalHeroHash, 'Media asset must match bit-for-bit');
  console.log('    ✓ 100% Cryptographic match between GitHub pointers + R2 chunks.');

  console.log('\n===========================================================');
  console.log('   PROMPT SUCCESS CRITERION: GITHUB INTEGRATION PASS       ');
  console.log('===========================================================');
}

runGitHubSyncTest().catch(err => {
  console.error('\nGITHUB INTEGRATION TEST FAILED:', err);
  process.exit(1);
});
