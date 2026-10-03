// FrameGit Core - Production Version Engine
// Manages DAG commits, branches, checkout, rollback, and uncommitted change protection.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Hasher } = require('./hasher');
const { Chunker } = require('./chunker');
const { StreamingChunker } = require('./streaming_chunker');
const { CASStorage, OBJECT_TYPES } = require('./storage');
const { PremiereParser } = require('./premiere_parser');
const { ChangeEngine } = require('./change_engine');
const { safeJsonParse, wrapFsOperation } = require('./errors');
const { loadConfig, getAuthor } = require('./config');

class DirtyWorkingTreeError extends Error {
  constructor(message, dirtyFiles = []) {
    super(message);
    this.name = 'DirtyWorkingTreeError';
    this.dirtyFiles = dirtyFiles;
  }
}

class VersionEngine {
  /**
   * @param {string} rootPath Absolute path to project workspace
   * @param {string} projectFilePath Relative or absolute path to primary .prproj
   * @param {Object} [adapter=null]
   * @param {Object} [options={}]
   */
  constructor(rootPath, projectFilePath, adapter = null, options = {}) {
    this.rootPath = path.resolve(rootPath);
    this.config = loadConfig({ projectDir: this.rootPath, overrides: options.config });
    this.projectFilePath = path.isAbsolute(projectFilePath) 
      ? projectFilePath 
      : path.join(this.rootPath, projectFilePath);
    this.framegitDir = path.join(this.rootPath, '.framegit');
    this.dbPath = path.join(this.framegitDir, this.config.project?.databaseFilename || 'state.db');
    this.storage = new CASStorage(this.rootPath);
    this.db = null;

    if (adapter) {
      this.adapter = adapter;
    } else if (this.projectFilePath.endsWith('.drp')) {
      const { ResolveAdapter } = require('./resolve_adapter');
      this.adapter = new ResolveAdapter();
    } else {
      const { PremiereAdapter } = require('./premiere_adapter');
      this.adapter = new PremiereAdapter();
    }
  }

  /**
   * Initialize a new repository with default 'main' branch.
   */
  init() {
    if (!fs.existsSync(this.framegitDir)) {
      fs.mkdirSync(this.framegitDir, { recursive: true });
    }
    this.storage.init();

    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS repo_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS commits (
        commit_hash TEXT PRIMARY KEY,
        tree_hash TEXT NOT NULL,
        parent_hash TEXT,
        second_parent_hash TEXT,
        author_name TEXT NOT NULL,
        author_email TEXT NOT NULL,
        message TEXT NOT NULL,
        committed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS branches (
        name TEXT PRIMARY KEY,
        commit_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chunk_catalog (
        chunk_hash TEXT PRIMARY KEY,
        size_bytes INTEGER NOT NULL,
        ref_count INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
    `);

    // Ensure default HEAD is 'main'
    const headRow = this.db.prepare("SELECT value FROM repo_meta WHERE key = 'head'").get();
    if (!headRow) {
      this.db.prepare("INSERT INTO repo_meta (key, value) VALUES ('head', 'ref: refs/heads/main')").run();
      this.db.prepare("INSERT INTO repo_meta (key, value) VALUES ('current_branch', 'main')").run();
    }
  }

  /**
   * Open existing repository.
   */
  open() {
    this.close();
    if (!fs.existsSync(this.dbPath)) {
      throw new Error(`Not a FrameGit repository: ${this.framegitDir}`);
    }
    this.storage.init();
    this.db = new DatabaseSync(this.dbPath);
  }

  /**
   * Close SQLite database connection and release file locks.
   */
  close() {
    if (this.db) {
      try {
        this.db.close();
      } catch (_) {}
      this.db = null;
    }
  }

  /**
   * Get current active branch name or null if in detached HEAD.
   * @returns {string|null}
   */
  getCurrentBranch() {
    const row = this.db.prepare("SELECT value FROM repo_meta WHERE key = 'current_branch'").get();
    return row ? row.value : null;
  }

  /**
   * Get current HEAD commit hash.
   * @returns {string|null}
   */
  getHeadCommitHash() {
    const headMeta = this.db.prepare("SELECT value FROM repo_meta WHERE key = 'head'").get();
    if (!headMeta) return null;

    const val = headMeta.value;
    if (val.startsWith('ref: refs/heads/')) {
      const branchName = val.replace('ref: refs/heads/', '');
      const branch = this.db.prepare('SELECT commit_hash FROM branches WHERE name = ?').get(branchName);
      return branch ? branch.commit_hash : null;
    }
    return val; // Detached HEAD hash
  }

  /**
   * Detect uncommitted changes against current HEAD.
   * @returns {{hasChanges: boolean, changes: Array, currState: Object}}
   */
  status() {
    if (!fs.existsSync(this.projectFilePath)) {
      throw new Error(`Project file does not exist: ${this.projectFilePath}`);
    }

    const currState = this.adapter.getProjectState(this.projectFilePath);
    const headHash = this.getHeadCommitHash();

    let prevState = null;
    if (headHash) {
      const commitObj = this.storage.readObject(headHash);
      const commitData = safeJsonParse(commitObj.payload.toString('utf-8'), `commit[${headHash}]`);
      const treeObj = this.storage.readObject(commitData.tree);
      const treeData = safeJsonParse(treeObj.payload.toString('utf-8'), `tree[${commitData.tree}]`);
      prevState = treeData.projectState;
    }

    const changes = ChangeEngine.diffStates(prevState, currState);
    return {
      hasChanges: changes.length > 0,
      changes,
      currState
    };
  }

  /**
   * Create a new commit in the current branch.
   * @param {string} message Commit message
   * @param {{name: string, email: string}} [author=null]
   * @param {string|null} [secondParent=null] Second parent commit hash for merge commits
   * @returns {Promise<{commitHash: string, treeHash: string, branch: string}>}
   */
  async commit(message, author = null, secondParent = null) {
    if (!fs.existsSync(this.projectFilePath)) {
      throw new Error(`Project file not found: ${this.projectFilePath}`);
    }

    if (!author) {
      author = getAuthor(this.config);
    }

    const parentHash = this.getHeadCommitHash();
    const projectState = this.adapter.getProjectState(this.projectFilePath);

    // 1. Chunk and store project file
    const prprojManifest = {
      relativePath: path.relative(this.rootPath, this.projectFilePath).replace(/\\/g, '/'),
      size: 0,
      fullHash: '',
      chunks: []
    };

    const prprojRes = await StreamingChunker.chunkFile(
      this.projectFilePath,
      async (chunk) => {
        this.storage.writeObject(OBJECT_TYPES.CHUNK, chunk.data);
        this.recordChunk(chunk.hash, chunk.size);
        prprojManifest.chunks.push({ offset: chunk.offset, size: chunk.size, hash: chunk.hash });
      },
      { minSize: 131072, targetSize: 524288, maxSize: 2097152 }
    );
    prprojManifest.size = prprojRes.totalBytes;
    prprojManifest.fullHash = prprojRes.fullHash;

    // 2. Scan and chunk tracked media assets
    const assetManifests = [];
    const mediaFiles = this.scanWorkspaceAssets();

    for (const relPath of mediaFiles) {
      const fullPath = path.join(this.rootPath, relPath);
      const assetEntry = {
        relativePath: relPath.replace(/\\/g, '/'),
        size: 0,
        fullHash: '',
        chunks: []
      };

      const assetRes = await StreamingChunker.chunkFile(
        fullPath,
        async (chunk) => {
          this.storage.writeObject(OBJECT_TYPES.CHUNK, chunk.data);
          this.recordChunk(chunk.hash, chunk.size);
          assetEntry.chunks.push({ offset: chunk.offset, size: chunk.size, hash: chunk.hash });
        },
        { minSize: 262144, targetSize: 1048576, maxSize: 4194304 }
      );
      assetEntry.size = assetRes.totalBytes;
      assetEntry.fullHash = assetRes.fullHash;

      assetManifests.push(assetEntry);
    }

    // 3. Store Tree object
    const treeData = {
      projectFile: prprojManifest,
      projectState,
      assets: assetManifests
    };
    const treePayload = Buffer.from(JSON.stringify(treeData), 'utf-8');
    const treeHash = this.storage.writeObject(OBJECT_TYPES.TREE, treePayload, true);

    // 4. Store Commit object
    const now = Date.now();
    const commitData = {
      tree: treeHash,
      parent: parentHash,
      secondParent: secondParent || null,
      author,
      message,
      committedAt: now
    };
    const commitPayload = Buffer.from(JSON.stringify(commitData), 'utf-8');
    const commitHash = this.storage.writeObject(OBJECT_TYPES.COMMIT, commitPayload, true);

    // 5. Update SQLite commits table and branch ref atomically
    const currentBranch = this.getCurrentBranch();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT INTO commits (commit_hash, tree_hash, parent_hash, second_parent_hash, author_name, author_email, message, committed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(commitHash, treeHash, parentHash, secondParent || null, author.name, author.email, message, now);

      if (currentBranch) {
        this.db.prepare(`
          INSERT INTO branches (name, commit_hash, created_at, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(name) DO UPDATE SET commit_hash = excluded.commit_hash, updated_at = excluded.updated_at
        `).run(currentBranch, commitHash, now, now);
      } else {
        this.db.prepare("UPDATE repo_meta SET value = ? WHERE key = 'head'").run(commitHash);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch (_) {}
      throw err;
    }

    return { commitHash, treeHash, branch: currentBranch || '(detached HEAD)' };
  }

  /**
   * Retrieve normalized project state from a commit hash.
   * @param {string} commitHash 
   * @returns {Object|null}
   */
  getCommitProjectState(commitHash) {
    if (!commitHash) return null;
    const commitObj = this.storage.readObject(commitHash);
    if (!commitObj) return null;
    const commitData = safeJsonParse(commitObj.payload.toString('utf-8'), `commit[${commitHash}]`);
    const treeObj = this.storage.readObject(commitData.tree);
    if (!treeObj) return null;
    const treeData = safeJsonParse(treeObj.payload.toString('utf-8'), `tree[${commitData.tree}]`);
    return treeData.projectState || null;
  }

  /**
   * Retrieve all ancestors of a commit in the DAG.
   * @param {string} commitHash 
   * @returns {Set<string>}
   */
  getAncestors(commitHash) {
    const ancestors = new Set();
    const queue = [commitHash];
    while (queue.length > 0) {
      const hash = queue.shift();
      if (!hash || ancestors.has(hash)) continue;
      ancestors.add(hash);
      const row = this.db.prepare('SELECT parent_hash, second_parent_hash FROM commits WHERE commit_hash = ?').get(hash);
      if (row) {
        if (row.parent_hash) queue.push(row.parent_hash);
        if (row.second_parent_hash) queue.push(row.second_parent_hash);
      }
    }
    return ancestors;
  }

  /**
   * Find Lowest Common Ancestor (LCA / merge base) between two commits.
   * @param {string} commitHashA 
   * @param {string} commitHashB 
   * @returns {string|null}
   */
  getMergeBase(commitHashA, commitHashB) {
    if (commitHashA === commitHashB) return commitHashA;
    const ancestorsA = this.getAncestors(commitHashA);
    const queue = [commitHashB];
    const visitedB = new Set();
    while (queue.length > 0) {
      const hash = queue.shift();
      if (!hash || visitedB.has(hash)) continue;
      if (ancestorsA.has(hash)) return hash;
      visitedB.add(hash);
      const row = this.db.prepare('SELECT parent_hash, second_parent_hash FROM commits WHERE commit_hash = ?').get(hash);
      if (row) {
        if (row.parent_hash) queue.push(row.parent_hash);
        if (row.second_parent_hash) queue.push(row.second_parent_hash);
      }
    }
    return null;
  }

  /**
   * Create a new branch pointing to specified commit or current HEAD.
   * @param {string} branchName 
   * @param {string} [startCommit=null]
   */
  createBranch(branchName, startCommit = null) {
    if (!branchName || !/^[a-zA-Z0-9_\-\.\/]+$/.test(branchName)) {
      throw new Error(`Invalid branch name: '${branchName}'. Must contain only alphanumeric characters, dashes, slashes, and dots.`);
    }

    const existing = this.db.prepare('SELECT name FROM branches WHERE name = ?').get(branchName);
    if (existing) {
      throw new Error(`Branch '${branchName}' already exists.`);
    }

    const targetCommit = startCommit || this.getHeadCommitHash();
    if (!targetCommit) {
      throw new Error('Cannot create branch from empty repository with no commits.');
    }

    const now = Date.now();
    this.db.prepare(`
      INSERT INTO branches (name, commit_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(branchName, targetCommit, now, now);
  }

  /**
   * List all branches with active branch indicator and commit messages.
   * @returns {Array<{name: string, commitHash: string, isCurrent: boolean, message: string, committedAt: number}>}
   */
  listBranches() {
    const currentBranch = this.getCurrentBranch();
    const rows = this.db.prepare(`
      SELECT b.name, b.commit_hash, c.message, c.committed_at
      FROM branches b
      LEFT JOIN commits c ON b.commit_hash = c.commit_hash
      ORDER BY b.name ASC
    `).all();

    if (rows.length === 0 && currentBranch) {
      return [{
        name: currentBranch,
        commitHash: null,
        isCurrent: true,
        isActive: true,
        message: '(initial branch, no commits yet)',
        lastCommitMessage: '(initial branch, no commits yet)',
        committedAt: 0
      }];
    }

    return rows.map(r => ({
      name: r.name,
      commitHash: r.commit_hash,
      isCurrent: r.name === currentBranch,
      isActive: r.name === currentBranch,
      message: r.message || '',
      lastCommitMessage: r.message || '',
      committedAt: r.committed_at || 0
    }));
  }

  /**
   * Switch to a different branch with uncommitted change protection.
   * @param {string} branchName 
   * @param {boolean} [force=false]
   */
  switchBranch(branchName, force = false) {
    const currentBranch = this.getCurrentBranch();
    if (currentBranch === branchName) {
      return { switched: false, branch: branchName, message: 'Already on branch' };
    }

    const branch = this.db.prepare('SELECT commit_hash FROM branches WHERE name = ?').get(branchName);
    if (!branch) {
      // If it's the initial unborn branch with no commits yet
      if (branchName === currentBranch && !this.getHeadCommitHash()) {
        return { switched: false, branch: branchName, message: 'Already on initial branch' };
      }
      throw new Error(`Branch '${branchName}' does not exist.`);
    }

    // Check for uncommitted changes
    if (!force) {
      const st = this.status();
      if (st.hasChanges) {
        throw new DirtyWorkingTreeError(
          `Cannot switch to branch '${branchName}' because you have uncommitted changes. Commit or discard your changes first.`,
          st.changes
        );
      }
    }

    // Restore workspace to branch commit
    this.checkoutCommit(branch.commit_hash, true, true);

    // Update HEAD to branch ref
    this.db.prepare("INSERT INTO repo_meta (key, value) VALUES ('head', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(`ref: refs/heads/${branchName}`);
    this.db.prepare("INSERT INTO repo_meta (key, value) VALUES ('current_branch', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(branchName);

    return { switched: true, branch: branchName, commitHash: branch.commit_hash };
  }

  /**
   * Rollback/checkout a specific commit hash.
   * @param {string} commitHash 
   * @param {boolean} [force=false]
   */
  rollback(commitHash, force = false) {
    return this.checkoutCommit(commitHash, force);
  }

  /**
   * Checkout a specific commit hash (detached HEAD).
   * @param {string} commitHash 
   * @param {boolean} [force=false]
   * @param {boolean} [isBranchSwitch=false]
   */
  checkoutCommit(commitHash, force = false, isBranchSwitch = false) {
    if (!force) {
      const st = this.status();
      if (st.hasChanges) {
        throw new DirtyWorkingTreeError(
          `Cannot checkout commit '${commitHash.slice(0, 8)}' because you have uncommitted changes.`,
          st.changes
        );
      }
    }

    const commitObj = this.storage.readObject(commitHash);
    const commitData = safeJsonParse(commitObj.payload.toString('utf-8'), `commit[${commitHash}]`);
    const treeObj = this.storage.readObject(commitData.tree);
    const treeData = safeJsonParse(treeObj.payload.toString('utf-8'), `tree[${commitData.tree}]`);

    // 1. Reconstruct project file
    const prprojManifest = treeData.projectFile;
    const prprojTarget = path.join(this.rootPath, prprojManifest.relativePath);
    this.reconstructFileFromChunks(prprojManifest, prprojTarget);

    // 2. Reconstruct media assets
    const activeAssetPaths = new Set();
    for (const asset of treeData.assets || []) {
      const assetTarget = path.join(this.rootPath, asset.relativePath);
      this.reconstructFileFromChunks(asset, assetTarget);
      activeAssetPaths.add(asset.relativePath);
    }

    // 3. Remove ONLY files that were explicitly tracked in previous commit but do NOT exist in target commit.
    // Untracked/new workspace media files must NEVER be deleted.
    const prevCommitHash = this.getHeadCommitHash();
    if (prevCommitHash && prevCommitHash !== commitHash) {
      try {
        const prevCommitObj = this.storage.readObject(prevCommitHash);
        const prevCommitData = safeJsonParse(prevCommitObj.payload.toString('utf-8'), `prevCommit[${prevCommitHash}]`);
        const prevTreeObj = this.storage.readObject(prevCommitData.tree);
        const prevTreeData = safeJsonParse(prevTreeObj.payload.toString('utf-8'), `prevTree[${prevCommitData.tree}]`);
        for (const prevAsset of prevTreeData.assets || []) {
          if (!activeAssetPaths.has(prevAsset.relativePath)) {
            const full = path.join(this.rootPath, prevAsset.relativePath);
            if (fs.existsSync(full)) {
              wrapFsOperation(() => fs.unlinkSync(full), full, 'unlink');
            }
          }
        }
      } catch (_) {
        // If previous commit tree cannot be read, do not remove any files to prevent data loss
      }
    }

    // Update HEAD to detached hash if not switching branch
    if (!isBranchSwitch) {
      this.db.prepare("INSERT INTO repo_meta (key, value) VALUES ('head', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(commitHash);
      this.db.prepare("DELETE FROM repo_meta WHERE key = 'current_branch'").run();
    }
  }

  /**
   * Delete a branch.
   * @param {string} branchName 
   */
  deleteBranch(branchName) {
    const currentBranch = this.getCurrentBranch();
    if (currentBranch === branchName) {
      throw new Error(`Cannot delete currently checked-out branch '${branchName}'. Switch to another branch first.`);
    }

    const info = this.db.prepare('DELETE FROM branches WHERE name = ?').run(branchName);
    if (info.changes === 0) {
      throw new Error(`Branch '${branchName}' not found.`);
    }
  }

  /**
   * Traverse commit history starting from HEAD.
   * @param {number} [limit=50]
   * @returns {Array<Object>}
   */
  getLog(limit = 50) {
    const log = [];
    let currentHash = this.getHeadCommitHash();

    while (currentHash && log.length < limit) {
      const row = this.db.prepare(`
        SELECT commit_hash, tree_hash, parent_hash, second_parent_hash, author_name, author_email, message, committed_at
        FROM commits
        WHERE commit_hash = ?
      `).get(currentHash);

      if (!row) break;
      log.push(row);
      currentHash = row.parent_hash;
    }

    return log;
  }

  log(limit = 50) {
    return this.getHistory(null, limit);
  }

  /**
   * Traverse commit history for a specific branch or current HEAD, returning rich objects.
   * @param {string|null} [branchName=null]
   * @param {number} [limit=50]
   * @returns {Array<{commitHash: string, treeHash: string, parentHash: string|null, author: {name: string, email: string}, message: string, committedAt: number}>}
   */
  getHistory(branchName = null, limit = 50) {
    let startHash = null;
    if (branchName) {
      const branchRow = this.db.prepare('SELECT commit_hash FROM branches WHERE name = ?').get(branchName);
      if (branchRow) startHash = branchRow.commit_hash;
    }
    if (!startHash) {
      startHash = this.getHeadCommitHash();
    }

    const history = [];
    let currentHash = startHash;

    while (currentHash && history.length < limit) {
      const row = this.db.prepare(`
        SELECT commit_hash, tree_hash, parent_hash, second_parent_hash, author_name, author_email, message, committed_at
        FROM commits
        WHERE commit_hash = ?
      `).get(currentHash);

      if (!row) break;
      history.push({
        commitHash: row.commit_hash,
        hash: row.commit_hash,
        treeHash: row.tree_hash,
        parentHash: row.parent_hash,
        secondParentHash: row.second_parent_hash,
        author: {
          name: row.author_name,
          email: row.author_email
        },
        message: row.message,
        committedAt: row.committed_at,
        timestamp: row.committed_at
      });
      currentHash = row.parent_hash;
    }

    return history;
  }

  /**
   * Reassemble file from chunks.
   */
  reconstructFileFromChunks(manifest, destPath) {
    const parentDir = path.dirname(destPath);
    if (!fs.existsSync(parentDir)) {
      wrapFsOperation(() => fs.mkdirSync(parentDir, { recursive: true }), parentDir, 'mkdir');
    }

    const tempPath = destPath + `.${Date.now()}.${crypto.randomUUID()}.restore.tmp`;
    let fd = null;
    try {
      fd = fs.openSync(tempPath, 'w');
      for (const chunkEntry of manifest.chunks) {
        const chunkObj = this.storage.readObject(chunkEntry.hash);
        fs.writeSync(fd, chunkObj.payload);
      }
      fs.closeSync(fd);
      fd = null;

      // On Windows NTFS, pre-unlink destination if it exists before renameSync
      if (fs.existsSync(destPath)) {
        try { fs.unlinkSync(destPath); } catch {}
      }
      wrapFsOperation(() => fs.renameSync(tempPath, destPath), destPath, 'rename');
    } catch (err) {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch {}
      }
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch {}
      }
      throw err;
    }
  }

  /**
   * Scan project directory for media assets across configured directories.
   */
  scanWorkspaceAssets() {
    const assets = [];
    const dirsToScan = this.config?.project?.assetDirectories || ['Footage', 'Media', 'Assets', 'Audio', 'Graphics'];
    for (const dirName of dirsToScan) {
      const mediaDir = path.join(this.rootPath, dirName);
      if (fs.existsSync(mediaDir)) {
        try {
          const files = fs.readdirSync(mediaDir, { recursive: true });
          for (const f of files) {
            const full = path.join(mediaDir, f);
            if (fs.statSync(full).isFile()) {
              const rel = path.relative(this.rootPath, full).replace(/\\/g, '/');
              if (!rel.startsWith('.framegit/') && !assets.includes(rel)) {
                assets.push(rel);
              }
            }
          }
        } catch {
          // If directory is unreadable, skip safely
        }
      }
    }
    return assets;
  }

  /**
   * Record chunk reference in catalog.
   */
  recordChunk(chunkHash, sizeBytes) {
    this.db.prepare(`
      INSERT INTO chunk_catalog (chunk_hash, size_bytes, ref_count, created_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(chunk_hash) DO UPDATE SET ref_count = ref_count + 1
    `).run(chunkHash, sizeBytes, Date.now());
  }
}

module.exports = { VersionEngine, DirtyWorkingTreeError };
