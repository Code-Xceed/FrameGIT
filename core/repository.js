// FrameGit Core - Repository & Version Engine
// Manages DAG commits, branches, FastCDC chunking, CAS persistence, and bit-for-bit restore.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Hasher } = require('./hasher');
const { Chunker } = require('./chunker');
const { CASStorage, OBJECT_TYPES } = require('./storage');
const { PremiereParser } = require('./premiere_parser');
const { ChangeEngine } = require('./change_engine');
const { safeJsonParse, wrapFsOperation } = require('./errors');
const { loadConfig, getAuthor } = require('./config');

class Repository {
  /**
   * @param {string} rootPath Absolute path to project workspace
   * @param {string} projectFilePath Relative or absolute path to primary .prproj
   * @param {Object} [options={}]
   */
  constructor(rootPath, projectFilePath, options = {}) {
    this.rootPath = path.resolve(rootPath);
    this.config = loadConfig({ projectDir: this.rootPath, overrides: options.config });
    this.projectFilePath = path.isAbsolute(projectFilePath) 
      ? projectFilePath 
      : path.join(this.rootPath, projectFilePath);
    this.framegitDir = path.join(this.rootPath, '.framegit');
    this.dbPath = path.join(this.framegitDir, this.config.project?.databaseFilename || 'state.db');
    this.storage = new CASStorage(this.rootPath);
    this.db = null;
  }

  /**
   * Initialize a new FrameGit repository in the workspace.
   */
  init() {
    if (!fs.existsSync(this.framegitDir)) {
      wrapFsOperation(() => fs.mkdirSync(this.framegitDir, { recursive: true }), this.framegitDir, 'mkdir');
    }
    this.storage.init();

    // Initialize embedded SQLite database
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
        author_name TEXT NOT NULL,
        author_email TEXT NOT NULL,
        message TEXT NOT NULL,
        committed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS branches (
        name TEXT PRIMARY KEY,
        commit_hash TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chunk_catalog (
        chunk_hash TEXT PRIMARY KEY,
        size_bytes INTEGER NOT NULL,
        ref_count INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
    `);

    // Set initial branch from config
    const defaultBranch = this.config.project?.defaultBranch || 'main';
    const existingHead = this.db.prepare("SELECT value FROM repo_meta WHERE key = 'current_branch'").get();
    if (!existingHead) {
      this.db.prepare("INSERT INTO repo_meta (key, value) VALUES ('current_branch', ?)").run(defaultBranch);
    }
  }

  /**
   * Open an existing repository.
   */
  open() {
    if (!fs.existsSync(this.dbPath)) {
      throw new Error(`Not a FrameGit repository: ${this.framegitDir}`);
    }
    this.storage.init();
    this.db = new DatabaseSync(this.dbPath);
  }

  /**
   * Get current HEAD commit hash.
   * @returns {string|null}
   */
  getHeadCommitHash() {
    const defaultBranch = this.config.project?.defaultBranch || 'main';
    const branchRow = this.db.prepare("SELECT value FROM repo_meta WHERE key = 'current_branch'").get();
    const branchName = branchRow ? branchRow.value : defaultBranch;
    const row = this.db.prepare('SELECT commit_hash FROM branches WHERE name = ?').get(branchName);
    return row ? row.commit_hash : null;
  }

  /**
   * Detect uncommitted changes by comparing working project state with HEAD commit.
   * @returns {{hasChanges: boolean, changes: Array, currState: Object}}
   */
  detectChanges() {
    if (!fs.existsSync(this.projectFilePath)) {
      throw new Error(`Project file does not exist: ${this.projectFilePath}`);
    }

    const currState = PremiereParser.parseProjectFile(this.projectFilePath);
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
   * Create a versioned snapshot (commit) of the project and tracked assets.
   * @param {string} message Commit message
   * @param {{name: string, email: string}} [author=null]
   * @returns {Promise<{commitHash: string, totalChunks: number, totalBytes: number}>}
   */
  async createCommit(message, author = null) {
    if (!fs.existsSync(this.projectFilePath)) {
      throw new Error(`Project file not found: ${this.projectFilePath}`);
    }

    if (!author) {
      author = getAuthor(this.config);
    }

    const projectState = PremiereParser.parseProjectFile(this.projectFilePath);
    const parentHash = this.getHeadCommitHash();

    // 1. Chunk and store the .prproj file itself
    const prprojBuffer = fs.readFileSync(this.projectFilePath);
    const prprojChunks = Chunker.chunkBufferFastCDC(prprojBuffer, { minSize: 131072, targetSize: 524288, maxSize: 2097152 });

    let totalChunks = 0;
    let totalBytes = 0;

    const prprojManifest = {
      relativePath: path.relative(this.rootPath, this.projectFilePath).replace(/\\/g, '/'),
      size: prprojBuffer.length,
      fullHash: Hasher.hash(prprojBuffer),
      chunks: []
    };

    for (const chunk of prprojChunks) {
      this.storage.writeObject(OBJECT_TYPES.CHUNK, chunk.data);
      this.recordChunk(chunk.hash, chunk.size);
      prprojManifest.chunks.push({
        offset: chunk.offset,
        size: chunk.size,
        hash: chunk.hash
      });
      totalChunks++;
      totalBytes += chunk.size;
    }

    // 2. Scan and chunk all tracked assets in the workspace
    const assetManifests = [];
    const mediaFiles = this.scanWorkspaceAssets();

    for (const relPath of mediaFiles) {
      const fullPath = path.join(this.rootPath, relPath);
      const fileBuffer = fs.readFileSync(fullPath);
      const chunks = Chunker.chunkBufferFastCDC(fileBuffer, { minSize: 262144, targetSize: 1048576, maxSize: 4194304 });

      const assetEntry = {
        relativePath: relPath.replace(/\\/g, '/'),
        size: fileBuffer.length,
        fullHash: Hasher.hash(fileBuffer),
        chunks: []
      };

      for (const chunk of chunks) {
        this.storage.writeObject(OBJECT_TYPES.CHUNK, chunk.data);
        this.recordChunk(chunk.hash, chunk.size);
        assetEntry.chunks.push({
          offset: chunk.offset,
          size: chunk.size,
          hash: chunk.hash
        });
        totalChunks++;
        totalBytes += chunk.size;
      }

      assetManifests.push(assetEntry);
    }

    // 3. Create Root Tree Object (Zstandard/Deflate compressed)
    const treeData = {
      projectFile: prprojManifest,
      projectState,
      assets: assetManifests
    };
    const treePayload = Buffer.from(JSON.stringify(treeData), 'utf-8');
    const treeHash = this.storage.writeObject(OBJECT_TYPES.TREE, treePayload, true);

    // 4. Create Commit Object
    const commitData = {
      tree: treeHash,
      parent: parentHash,
      author,
      message,
      committedAt: Date.now()
    };
    const commitPayload = Buffer.from(JSON.stringify(commitData), 'utf-8');
    const commitHash = this.storage.writeObject(OBJECT_TYPES.COMMIT, commitPayload, true);

    // 5. Update SQLite DAG
    this.db.prepare(`
      INSERT INTO commits (commit_hash, tree_hash, parent_hash, author_name, author_email, message, committed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(commitHash, treeHash, parentHash, author.name, author.email, message, commitData.committedAt);

    // Update current branch
    const branchRow = this.db.prepare("SELECT value FROM repo_meta WHERE key = 'current_branch'").get();
    const branchName = branchRow ? branchRow.value : 'main';

    this.db.prepare(`
      INSERT INTO branches (name, commit_hash) VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET commit_hash = excluded.commit_hash
    `).run(branchName, commitHash);

    return {
      commitHash,
      totalChunks,
      totalBytes
    };
  }

  /**
   * Restore the project and all tracked assets to a specific commit.
   * Guarantees bit-for-bit integrity verification.
   * @param {string} commitHash 
   * @returns {{restoredFiles: number, verifiedFiles: number, success: boolean}}
   */
  restoreCommit(commitHash) {
    const commitObj = this.storage.readObject(commitHash);
    const commitData = safeJsonParse(commitObj.payload.toString('utf-8'), `commit[${commitHash}]`);

    const treeObj = this.storage.readObject(commitData.tree);
    const treeData = safeJsonParse(treeObj.payload.toString('utf-8'), `tree[${commitData.tree}]`);

    let restoredFiles = 0;
    let verifiedFiles = 0;

    // 1. Reconstruct .prproj project file from chunks
    const prprojManifest = treeData.projectFile;
    const prprojTarget = path.join(this.rootPath, prprojManifest.relativePath);
    this.reconstructFileFromChunks(prprojManifest, prprojTarget);
    restoredFiles++;

    // Verify bit-for-bit integrity of restored project file
    const prprojBuf = fs.readFileSync(prprojTarget);
    const prprojCheck = Hasher.hash(prprojBuf);
    if (prprojCheck !== prprojManifest.fullHash) {
      throw new Error(`Project file integrity failure on restore: expected ${prprojManifest.fullHash}, got ${prprojCheck}`);
    }
    verifiedFiles++;

    // 2. Reconstruct all tracked media files from chunks
    for (const asset of treeData.assets || []) {
      const assetTarget = path.join(this.rootPath, asset.relativePath);
      this.reconstructFileFromChunks(asset, assetTarget);
      restoredFiles++;

      const assetBuf = fs.readFileSync(assetTarget);
      const assetCheck = Hasher.hash(assetBuf);
      if (assetCheck !== asset.fullHash) {
        throw new Error(`Asset file integrity failure on restore: ${asset.relativePath}`);
      }
      verifiedFiles++;
    }

    // Update branch HEAD
    const defaultBranch = this.config.project?.defaultBranch || 'main';
    const branchRow = this.db.prepare("SELECT value FROM repo_meta WHERE key = 'current_branch'").get();
    const branchName = branchRow ? branchRow.value : defaultBranch;
    this.db.prepare('UPDATE branches SET commit_hash = ? WHERE name = ?').run(commitHash, branchName);

    return {
      restoredFiles,
      verifiedFiles,
      success: true
    };
  }

  /**
   * Reassemble a file from its CAS chunks.
   */
  reconstructFileFromChunks(manifest, destPath) {
    const parentDir = path.dirname(destPath);
    if (!fs.existsSync(parentDir)) {
      wrapFsOperation(() => fs.mkdirSync(parentDir, { recursive: true }), parentDir, 'mkdir');
    }

    const chunkBuffers = [];
    for (const chunkEntry of manifest.chunks) {
      const chunkObj = this.storage.readObject(chunkEntry.hash);
      chunkBuffers.push(chunkObj.payload);
    }

    const fullBuffer = Buffer.concat(chunkBuffers);

    // Atomic write with secure temp name
    const tempPath = destPath + `.${Date.now()}.${crypto.randomUUID()}.restore.tmp`;
    wrapFsOperation(() => fs.writeFileSync(tempPath, fullBuffer), tempPath, 'write');
    wrapFsOperation(() => fs.renameSync(tempPath, destPath), destPath, 'rename');
  }

  /**
   * Scan project directory for media assets across configured directories.
   * @returns {string[]} Relative file paths
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

  /**
   * Retrieve commit history list.
   * @returns {Array<Object>}
   */
  getHistory() {
    return this.db.prepare(`
      SELECT commit_hash, parent_hash, author_name, message, committed_at
      FROM commits
      ORDER BY committed_at DESC
    `).all();
  }
}

module.exports = { Repository };
