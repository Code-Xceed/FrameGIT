#!/usr/bin/env node

/**
 * FrameGit Command Line Interface (CLI)
 * 
 * Version control platform for creative video editors.
 * Usage: framegit <command> [options]
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { VersionEngine, DirtyWorkingTreeError } = require('../core/version_engine');
const { ProductionHardening } = require('../core/hardening');
const { VisualDiff } = require('../core/visual_diff');
const { WatcherDaemon } = require('../core/watcher');
const { loadConfig, setConfigValue, getAuthor } = require('../core/config');
const { SyncEngine } = require('../core/sync_engine');
const { CloudClient } = require('../core/cloud_client');

const VERSION = '1.0.0';

function printHelp() {
  console.log(`
FrameGit — Version Control for Creative Video Professionals (v${VERSION})

USAGE:
  framegit <command> [arguments] [options]

COMMANDS:
  init [project-file]            Initialize FrameGit repository in current workspace
  status                         Show project changes and working tree status
  commit -m "message"            Commit current project state and tracked media
  log [-n count] [--json]        Show commit history DAG
  branch [name] [-d delete-name] List, create, or delete branches
  checkout <branch|commit> [-f]  Switch branches or restore previous commit
  diff                           Display terminal visual timeline diff
  restore <commit-hash>          Roll back project files bit-for-bit to a commit
  fsck [--repair]                Run cryptographic data integrity audit
  doctor                         Run system diagnostics & health report
  config <get|set> <key> [val]   View or update FrameGit configuration
  daemon <start|stop|status>     Manage background auto-snapshot watcher daemon
  desktop                        Launch FrameGit Desktop GUI App in browser/window
  push [branch]                  Push local branch and chunks to remote storage
  pull [branch]                  Pull remote changes into local workspace
  clone <endpoint> <target-dir>  Clone remote project into a clean directory

OPTIONS:
  -v, --version                  Display version information
  -h, --help                     Display this help guide

EXAMPLES:
  $ framegit init Commercial.prproj
  $ framegit status
  $ framegit commit -m "Rough cut Take 1 with Lumetri grade"
  $ framegit branch color-grade
  $ framegit checkout color-grade
  $ framegit diff
  $ framegit fsck
  $ framegit daemon start
`);
}

function resolveWorkspaceRepo(cwd = process.cwd()) {
  let curr = path.resolve(cwd);
  while (curr !== path.dirname(curr)) {
    const framegitDir = path.join(curr, '.framegit');
    const isRepo = fs.existsSync(framegitDir) && (
      fs.existsSync(path.join(framegitDir, 'state.db')) ||
      fs.existsSync(path.join(framegitDir, 'objects'))
    );
    if (isRepo) {
      // Find project file in workspace
      const files = fs.readdirSync(curr);
      const prj = files.find(f => f.endsWith('.prproj') || f.endsWith('.drp'));
      return {
        rootPath: curr,
        projectFile: prj || 'project.prproj'
      };
    }
    curr = path.dirname(curr);
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help') || args[0] === 'help') {
    printHelp();
    process.exit(0);
  }

  if (args.includes('-v') || args.includes('--version') || args[0] === 'version') {
    console.log(`framegit version ${VERSION} (${process.platform}-${process.arch}, node ${process.version})`);
    process.exit(0);
  }

  const command = args[0];
  const cmdArgs = args.slice(1);

  try {
    switch (command) {
      case 'init': {
        const cwd = process.cwd();
        let targetProj = cmdArgs[0];

        if (!targetProj) {
          const files = fs.readdirSync(cwd);
          targetProj = files.find(f => f.endsWith('.prproj') || f.endsWith('.drp'));
        }

        if (!targetProj) {
          console.error('Error: No Premiere (.prproj) or Resolve (.drp) project file found.');
          console.error('Provide the project file explicitly: framegit init <filename>');
          process.exit(1);
        }

        const engine = new VersionEngine(cwd, targetProj);
        engine.init();
        console.log(`Initialized FrameGit repository in ${cwd}`);
        console.log(`Tracking project: ${path.basename(targetProj)}`);
        break;
      }

      case 'status': {
        const repo = resolveWorkspaceRepo();
        if (!repo) {
          console.error('fatal: not a framegit repository (or any of the parent directories): .framegit');
          process.exit(1);
        }

        const engine = new VersionEngine(repo.rootPath, repo.projectFile);
        engine.open();

        const st = engine.status();
        const branch = engine.getCurrentBranch() || '(detached HEAD)';
        const head = engine.getHeadCommitHash();

        console.log(`On branch ${branch}`);
        console.log(`Project:  ${repo.projectFile}`);
        console.log(`HEAD:     ${head ? head.slice(0, 8) : '(initial)'}\n`);

        if (!st.hasChanges) {
          console.log('Working project clean. No changes detected since last commit.');
        } else {
          console.log(`Changes detected (${st.changes.length}):`);
          for (const c of st.changes) {
            console.log(`  • [${c.type}] ${c.description || c.name || ''}`);
          }
          console.log('\nUse "framegit commit -m <msg>" to save snapshot.');
        }
        break;
      }

      case 'commit': {
        const repo = resolveWorkspaceRepo();
        if (!repo) {
          console.error('fatal: not a framegit repository (or any of the parent directories): .framegit');
          process.exit(1);
        }

        let message = '';
        let author = null;

        for (let i = 0; i < cmdArgs.length; i++) {
          if (cmdArgs[i] === '-m' || cmdArgs[i] === '--message') {
            message = cmdArgs[i + 1] || '';
            i++;
          } else if (cmdArgs[i] === '--author') {
            const rawAuthor = cmdArgs[i + 1] || '';
            const match = rawAuthor.match(/(.+)<(.+)>/);
            if (match) {
              author = { name: match[1].trim(), email: match[2].trim() };
            } else {
              author = { name: rawAuthor.trim(), email: 'editor@framegit.local' };
            }
            i++;
          }
        }

        if (!message || message.trim().length === 0) {
          console.error('Error: Commit message is required (-m "message")');
          process.exit(1);
        }

        const engine = new VersionEngine(repo.rootPath, repo.projectFile);
        engine.open();

        const res = await engine.commit(message, author);
        console.log(`[${res.branch} ${res.commitHash.slice(0, 8)}] ${message}`);
        break;
      }

      case 'log': {
        const repo = resolveWorkspaceRepo();
        if (!repo) {
          console.error('fatal: not a framegit repository (or any of the parent directories): .framegit');
          process.exit(1);
        }

        let limit = 10;
        let isJson = false;

        for (let i = 0; i < cmdArgs.length; i++) {
          if (cmdArgs[i] === '-n') {
            limit = parseInt(cmdArgs[i + 1] || '10', 10);
            i++;
          } else if (cmdArgs[i] === '--json') {
            isJson = true;
          }
        }

        const engine = new VersionEngine(repo.rootPath, repo.projectFile);
        engine.open();

        const history = engine.getHistory(engine.getCurrentBranch() || 'main', limit);

        if (isJson) {
          console.log(JSON.stringify(history, null, 2));
        } else {
          console.log(`Commit History: ${engine.getCurrentBranch() || '(detached HEAD)'}\n`);
          for (const c of history) {
            const dateStr = new Date(c.committedAt).toLocaleString();
            console.log(`● ${c.commitHash.slice(0, 8)} - ${c.message}`);
            console.log(`  Author: ${c.author.name} <${c.author.email}> | Date: ${dateStr}\n`);
          }
        }
        break;
      }

      case 'branch': {
        const repo = resolveWorkspaceRepo();
        if (!repo) {
          console.error('fatal: not a framegit repository (or any of the parent directories): .framegit');
          process.exit(1);
        }

        const engine = new VersionEngine(repo.rootPath, repo.projectFile);
        engine.open();

        // Check for delete flag
        const deleteIdx = cmdArgs.indexOf('-d');
        if (deleteIdx !== -1) {
          const toDelete = cmdArgs[deleteIdx + 1];
          if (!toDelete) {
            console.error('Error: Branch name required for -d');
            process.exit(1);
          }
          engine.deleteBranch(toDelete);
          console.log(`Deleted branch ${toDelete}`);
          break;
        }

        // Create new branch
        if (cmdArgs.length > 0 && !cmdArgs[0].startsWith('-')) {
          const newBranch = cmdArgs[0];
          engine.createBranch(newBranch);
          console.log(`Created branch ${newBranch}`);
          break;
        }

        // List branches
        const branches = engine.listBranches();
        for (const b of branches) {
          const prefix = b.isActive ? '* ' : '  ';
          console.log(`${prefix}${b.name.padEnd(20)} ${b.commitHash ? b.commitHash.slice(0, 8) : '(empty)'} ${b.lastCommitMessage || ''}`);
        }
        break;
      }

      case 'checkout': {
        const repo = resolveWorkspaceRepo();
        if (!repo) {
          console.error('fatal: not a framegit repository (or any of the parent directories): .framegit');
          process.exit(1);
        }

        const target = cmdArgs[0];
        const force = cmdArgs.includes('-f') || cmdArgs.includes('--force');

        if (!target) {
          console.error('Error: Branch name or commit hash required (framegit checkout <target>)');
          process.exit(1);
        }

        const engine = new VersionEngine(repo.rootPath, repo.projectFile);
        engine.open();

        const branches = engine.listBranches();
        const branchExists = branches.some(b => b.name === target);

        if (branchExists) {
          engine.switchBranch(target, force);
          console.log(`Switched to branch '${target}'`);
        } else {
          engine.checkoutCommit(target, force);
          console.log(`Note: switching to '${target.slice(0, 8)}'. You are in 'detached HEAD' state.`);
        }
        break;
      }

      case 'diff': {
        const repo = resolveWorkspaceRepo();
        if (!repo) {
          console.error('fatal: not a framegit repository (or any of the parent directories): .framegit');
          process.exit(1);
        }

        const engine = new VersionEngine(repo.rootPath, repo.projectFile);
        engine.open();

        const st = engine.status();
        const head = engine.getHeadCommitHash();
        const baseState = head ? engine.getCommitProjectState(head) : null;
        const currState = st.currState;

        const ascii = VisualDiff.formatAsciiDiff(baseState, currState);
        console.log(ascii);

        if (cmdArgs.includes('--html')) {
          const outPath = path.join(repo.rootPath, 'timeline_diff.html');
          const html = VisualDiff.renderHtmlDiff(baseState, currState);
          fs.writeFileSync(outPath, html, 'utf-8');
          console.log(`\nExported interactive visual diff: ${outPath}`);
        }
        break;
      }

      case 'restore': {
        const repo = resolveWorkspaceRepo();
        if (!repo) {
          console.error('fatal: not a framegit repository (or any of the parent directories): .framegit');
          process.exit(1);
        }

        const commitHash = cmdArgs[0];
        if (!commitHash) {
          console.error('Error: Commit hash required (framegit restore <commit-hash>)');
          process.exit(1);
        }

        const engine = new VersionEngine(repo.rootPath, repo.projectFile);
        engine.open();
        engine.checkoutCommit(commitHash, true);
        console.log(`Restored workspace bit-for-bit to commit ${commitHash.slice(0, 8)}`);
        break;
      }

      case 'fsck': {
        const repo = resolveWorkspaceRepo();
        if (!repo) {
          console.error('fatal: not a framegit repository (or any of the parent directories): .framegit');
          process.exit(1);
        }

        const engine = new VersionEngine(repo.rootPath, repo.projectFile);
        engine.open();

        const hardening = new ProductionHardening(engine);
        hardening.init();

        console.log('Auditing cryptographic integrity of all CAS objects...');
        const res = hardening.fsck();

        if (res.valid) {
          console.log(`✓ Repository integrity is 100% HEALTHY. Checked ${res.totalChecked ?? res.checkedCount ?? 0} objects.`);
        } else {
          console.error(`✖ Corruption detected in ${res.corrupted.length} objects:`);
          for (const c of res.corrupted) {
            console.error(`  • ${c.hash.slice(0, 8)}: ${c.reason}`);
          }
          process.exit(1);
        }
        break;
      }

      case 'doctor': {
        const repo = resolveWorkspaceRepo();
        if (!repo) {
          console.error('fatal: not a framegit repository (or any of the parent directories): .framegit');
          process.exit(1);
        }

        const engine = new VersionEngine(repo.rootPath, repo.projectFile);
        engine.open();

        const hardening = new ProductionHardening(engine);
        hardening.init();

        const report = hardening.generateDiagnosticReport();
        console.log('===========================================================');
        console.log('             FRAMEGIT SYSTEM HEALTH REPORT                 ');
        console.log('===========================================================');
        console.log(`Health Verdict:      ${report.health || 'HEALTHY'}`);
        console.log(`Repository:          Valid (${report.workspaceRoot})`);
        console.log(`Project File:        ${report.projectFile} (${report.projectSizeBytes} bytes)`);
        console.log(`Total Branches:      ${report.metrics?.totalBranches ?? 0}`);
        console.log(`Total Commits:       ${report.metrics?.totalCommits ?? 0}`);
        console.log(`Tracked Chunks:      ${report.metrics?.totalTrackedChunks ?? 0} (${((report.metrics?.totalCatalogBytes || 0) / 1024).toFixed(1)} KB)`);
        console.log(`Node / Platform:     ${report.system?.nodeVersion} (${report.system?.platform})`);
        console.log(`Process Memory:      ${((report.system?.rssMemoryBytes || 0) / (1024 * 1024)).toFixed(1)} MB`);
        console.log('===========================================================');
        break;
      }

      case 'config': {
        const sub = cmdArgs[0];
        if (sub === 'get') {
          const key = cmdArgs[1];
          const cfg = loadConfig();
          if (!key) {
            console.log(JSON.stringify(cfg, null, 2));
          } else {
            const parts = key.split('.');
            let val = cfg;
            for (const p of parts) val = val ? val[p] : undefined;
            console.log(val !== undefined ? val : '');
          }
        } else if (sub === 'set') {
          const key = cmdArgs[1];
          const val = cmdArgs[2];
          if (!key || val === undefined) {
            console.error('Usage: framegit config set <key> <value>');
            process.exit(1);
          }
          setConfigValue(key, val);
          console.log(`Config updated: ${key} = ${val}`);
        } else if (sub === 'set-secret') {
          const key = cmdArgs[1];
          const val = cmdArgs[2];
          if (!key || val === undefined) {
            console.error('Usage: framegit config set-secret <key> <value>');
            process.exit(1);
          }
          const { getDefaultVault } = require('../core/vault');
          getDefaultVault().setSecret(key, val);
          console.log(`Secret safely encrypted in vault: ${key}`);
        } else if (sub === 'get-secret') {
          const key = cmdArgs[1];
          if (!key) {
            console.error('Usage: framegit config get-secret <key>');
            process.exit(1);
          }
          const { getDefaultVault } = require('../core/vault');
          const val = getDefaultVault().getSecret(key);
          console.log(val !== null ? '••••••••' : '(not set)');
        } else if (sub === 'list-secrets') {
          const { getDefaultVault } = require('../core/vault');
          const keys = getDefaultVault().listKeys();
          console.log('Vault encrypted secrets:');
          for (const k of keys) console.log(`  • ${k}`);
        } else {
          console.error('Usage: framegit config <get|set|set-secret|get-secret|list-secrets> [key] [val]');
          process.exit(1);
        }
        break;
      }

      case 'daemon': {
        const sub = cmdArgs[0];
        const repo = resolveWorkspaceRepo();
        if (!repo) {
          console.error('fatal: not a framegit repository (or any of the parent directories): .framegit');
          process.exit(1);
        }

        const daemon = new WatcherDaemon(repo.rootPath, repo.projectFile);

        if (sub === 'start') {
          const res = daemon.start();
          console.log(`Watcher daemon started (PID: ${res.pid})`);
          console.log(`Monitoring saves on: ${res.projectFile}`);
        } else if (sub === 'stop') {
          daemon.stop();
          console.log('Watcher daemon stopped.');
        } else if (sub === 'status') {
          const st = daemon.getStatus();
          if (st.running) {
            console.log(`Watcher daemon is RUNNING (PID: ${st.pid})`);
          } else {
            console.log('Watcher daemon is STOPPED.');
          }
        } else {
          console.error('Usage: framegit daemon <start|stop|status>');
          process.exit(1);
        }
        break;
      }

      case 'push': {
        const repo = resolveWorkspaceRepo();
        if (!repo) {
          console.error('fatal: not a framegit repository');
          process.exit(1);
        }
        const engine = new VersionEngine(repo.rootPath, repo.projectFile);
        engine.open();
        const branch = cmdArgs[0] || engine.getCurrentBranch() || 'main';

        const cloudClient = new CloudClient(engine.config.cloud);
        const syncEngine = new SyncEngine(repo.rootPath, cloudClient, engine.db);
        const res = await syncEngine.push(branch);
        console.log(`Pushed branch '${branch}' to remote:`);
        console.log(`  • Uploaded Chunks:      ${res.uploadedChunks}`);
        console.log(`  • Reused Remote Chunks: ${res.reusedRemoteChunks}`);
        console.log(`  • Commit HEAD:          ${res.commitHash ? res.commitHash.slice(0, 8) : ''}`);
        break;
      }

      case 'pull': {
        const repo = resolveWorkspaceRepo();
        if (!repo) {
          console.error('fatal: not a framegit repository');
          process.exit(1);
        }
        const engine = new VersionEngine(repo.rootPath, repo.projectFile);
        engine.open();
        const branch = cmdArgs[0] || engine.getCurrentBranch() || 'main';

        const cloudClient = new CloudClient(engine.config.cloud);
        const syncEngine = new SyncEngine(repo.rootPath, cloudClient, engine.db);
        const res = await syncEngine.pull(branch);
        console.log(`Pulled branch '${branch}': ${res.pulledCommits} commit(s), ${res.downloadedChunks} chunk(s)`);
        break;
      }

      case 'clone': {
        const targetDir = cmdArgs[0];
        const branch = cmdArgs[1] || 'main';
        if (!targetDir) {
          console.error('Usage: framegit clone <target-directory> [branch]');
          process.exit(1);
        }
        const targetRoot = path.resolve(targetDir);
        const config = loadConfig({ projectDir: targetRoot });
        const cloudClient = new CloudClient(config.cloud);
        const syncEngine = new SyncEngine(targetRoot, cloudClient);
        console.log(`Cloning branch '${branch}' into '${targetDir}'...`);
        const res = await syncEngine.clone(targetDir, branch);
        console.log(`Cloned project '${res.projectFile}' successfully at commit ${res.framegitCommit.slice(0, 8)}.`);
        break;
      }

      case 'desktop': {
        const cfg = loadConfig();
        const port = parseInt(cmdArgs[0], 10) || cfg.daemon.port;
        const host = cfg.daemon.host;
        const { DesktopServer } = require('../desktop/main');
        const server = new DesktopServer(port);
        await server.start();
        const proto = 'http';
        const originUrl = `${proto}://${host}:${port}/`;
        console.log(`FrameGit Desktop running at ${originUrl}`);
        const { exec } = require('node:child_process');
        if (process.platform === 'win32') {
          exec(`start "" "${originUrl}"`);
        } else if (process.platform === 'darwin') {
          exec(`open "${originUrl}"`);
        } else {
          exec(`xdg-open "${originUrl}"`);
        }
        break;
      }

      default:
        console.error(`Unknown command: '${command}'. See 'framegit --help'.`);
        process.exit(1);
    }
  } catch (err) {
    if (err instanceof DirtyWorkingTreeError) {
      console.error(`\nError: ${err.message}`);
      if (err.dirtyFiles && err.dirtyFiles.length > 0) {
        console.error('Uncommitted changes:');
        for (const f of err.dirtyFiles) {
          console.error(`  • [${f.type}] ${f.description || f.name || ''}`);
        }
      }
      console.error('Commit or discard your changes first.');
      process.exit(1);
    }

    console.error(`\nFatal error: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
