// FrameGit Core - Cloud Synchronization Engine
// Orchestrates resumable uploads, deduplication discovery, conflict detection, and remote cloning.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Hasher } = require('./hasher');
const { CASStorage, OBJECT_TYPES } = require('./storage');
const { CloudClient, ConflictError, NetworkError } = require('./cloud_client');
const { safeJsonParse, wrapFsOperation } = require('./errors');

class SyncEngine {
  /**
   * @param {string} rootPath Absolute path to workspace
   * @param {CloudClient} cloudClient 
   * @param {import('node:sqlite').DatabaseSync} [db]
   */
  constructor(rootPath, cloudClient, db = null) {
    this.rootPath = path.resolve(rootPath);
    this.cloudClient = cloudClient;
    this.storage = new CASStorage(this.rootPath);
    this.dbPath = path.join(this.rootPath, '.framegit', 'state.db');
    this.db = db;
  }

  /**
   * Initialize sync queue schema in SQLite if not present.
   */
  initQueue() {
    if (!this.db && fs.existsSync(this.dbPath)) {
      this.db = new DatabaseSync(this.dbPath);
    }

    if (this.db) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sync_queue (
          queue_id INTEGER PRIMARY KEY AUTOINCREMENT,
          direction TEXT NOT NULL,
          object_type TEXT NOT NULL,
          object_hash TEXT NOT NULL UNIQUE,
          byte_size INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          retry_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          updated_at INTEGER NOT NULL
        );
      `);
    }
  }

  /**
   * Push a local branch to cloud storage.
   * @param {string} branchName 
   * @returns {Promise<{uploadedChunks: number, reusedRemoteChunks: number, commitHash: string}>}
   */
  async push(branchName) {
    this.initQueue();

    // 1. Get local commit for branch
    const branchRow = this.db.prepare('SELECT commit_hash FROM branches WHERE name = ?').get(branchName);
    if (!branchRow) {
      throw new Error(`Local branch '${branchName}' not found.`);
    }
    const localCommitHash = branchRow.commit_hash;

    // 2. Fetch remote ref and detect conflicts
    const remoteCommitHash = await this.cloudClient.getRef(branchName);

    // If remote commit exists and is identical, already up to date
    if (remoteCommitHash === localCommitHash) {
      return { uploadedChunks: 0, reusedRemoteChunks: 0, commitHash: localCommitHash, message: 'Already up to date' };
    }

    // Conflict Check: If remote commit exists, it must be an ancestor of localCommitHash
    if (remoteCommitHash && !this.isAncestor(remoteCommitHash, localCommitHash)) {
      throw new ConflictError(
        `Push rejected: Remote branch '${branchName}' has diverged. Pull remote changes before pushing.`,
        remoteCommitHash,
        localCommitHash
      );
    }

    // 3. Collect unpushed commits and their required chunks
    const commitsToPush = this.collectCommitsSince(localCommitHash, remoteCommitHash);
    const requiredChunks = new Map(); // chunkHash -> byte_size
    const requiredTrees = new Set();

    for (const cHash of commitsToPush) {
      const commitObj = this.storage.readObject(cHash);
      const commitData = safeJsonParse(commitObj.payload.toString('utf-8'), `commit[${cHash}]`);
      requiredTrees.add(commitData.tree);

      const treeObj = this.storage.readObject(commitData.tree);
      const treeData = safeJsonParse(treeObj.payload.toString('utf-8'), `tree[${commitData.tree}]`);

      // Project file chunks
      for (const ch of treeData.projectFile.chunks || []) {
        requiredChunks.set(ch.hash, ch.size);
      }

      // Media asset chunks
      for (const asset of treeData.assets || []) {
        for (const ch of asset.chunks || []) {
          requiredChunks.set(ch.hash, ch.size);
        }
      }
    }

    // 4. Batch Remote HeadObject Discovery (Deduplication)
    let reusedRemoteChunks = 0;
    const missingChunks = [];

    for (const [chunkHash, size] of requiredChunks.entries()) {
      const head = await this.cloudClient.headObject(`chunks/${chunkHash}`);
      if (head.exists) {
        reusedRemoteChunks++;
      } else {
        missingChunks.push({ chunkHash, size });
        // Queue in SQLite
        this.db.prepare(`
          INSERT INTO sync_queue (direction, object_type, object_hash, byte_size, status, updated_at)
          VALUES ('upload', 'chunk', ?, ?, 'pending', ?)
          ON CONFLICT(object_hash) DO UPDATE SET status = 'pending', updated_at = excluded.updated_at
        `).run(chunkHash, size, Date.now());
      }
    }

    // 5. Upload missing chunks with resumable tracking
    let uploadedChunks = 0;
    for (const item of missingChunks) {
      try {
        const obj = this.storage.readObject(item.chunkHash);
        await this.cloudClient.putObject(`chunks/${item.chunkHash}`, obj.payload);

        this.db.prepare("UPDATE sync_queue SET status = 'completed', updated_at = ? WHERE object_hash = ?")
          .run(Date.now(), item.chunkHash);
        uploadedChunks++;
      } catch (err) {
        this.db.prepare("UPDATE sync_queue SET status = 'failed', retry_count = retry_count + 1, last_error = ?, updated_at = ? WHERE object_hash = ?")
          .run(err.message, Date.now(), item.chunkHash);
        throw err;
      }
    }

    // 6. Upload Trees and Commits
    for (const treeHash of requiredTrees) {
      const treeObj = this.storage.readObject(treeHash);
      await this.cloudClient.putObject(`trees/${treeHash}`, treeObj.payload);
    }

    for (const cHash of commitsToPush) {
      const commitObj = this.storage.readObject(cHash);
      await this.cloudClient.putObject(`commits/${cHash}`, commitObj.payload);
    }

    // 7. Atomic Remote Ref Update
    await this.cloudClient.updateRef(branchName, localCommitHash, remoteCommitHash);

    return {
      uploadedChunks,
      reusedRemoteChunks,
      commitHash: localCommitHash
    };
  }

  /**
   * Pull changes from remote cloud storage into local repository.
   * @param {string} branchName 
   * @returns {Promise<{pulledCommits: number, downloadedChunks: number, newCommitHash: string}>}
   */
  async pull(branchName) {
    this.initQueue();

    const remoteCommitHash = await this.cloudClient.getRef(branchName);
    if (!remoteCommitHash) {
      throw new Error(`Remote branch '${branchName}' does not exist.`);
    }

    const branchRow = this.db.prepare('SELECT commit_hash FROM branches WHERE name = ?').get(branchName);
    const localCommitHash = branchRow ? branchRow.commit_hash : null;

    if (localCommitHash === remoteCommitHash) {
      return { pulledCommits: 0, downloadedChunks: 0, newCommitHash: remoteCommitHash, message: 'Already up to date' };
    }

    // Fetch commit objects along the chain until we reach a known commit or root
    const commitsToProcess = [];
    const queue = [remoteCommitHash];
    const visited = new Set();
    let downloadedChunks = 0;

    while (queue.length > 0) {
      const commitHash = queue.shift();
      if (!commitHash || visited.has(commitHash)) continue;
      visited.add(commitHash);

      // Check if we already have this commit locally in SQLite
      const existing = this.db.prepare('SELECT commit_hash FROM commits WHERE commit_hash = ?').get(commitHash);
      if (existing) {
        continue;
      }

      // Download commit object
      let commitPayload;
      if (this.storage.hasObject(commitHash)) {
        const obj = this.storage.readObject(commitHash);
        commitPayload = obj.payload;
      } else {
        commitPayload = await this.cloudClient.getObject(`commits/${commitHash}`);
        this.storage.writeObject(OBJECT_TYPES.COMMIT, commitPayload, true);
      }

      const commitData = safeJsonParse(commitPayload.toString('utf-8'), `remote_commit[${commitHash}]`);
      commitsToProcess.push({ commitHash, commitData });

      if (commitData.parent) queue.push(commitData.parent);
      if (commitData.secondParent) queue.push(commitData.secondParent);
    }

    // Process downloaded commits in topological order (parents first)
    commitsToProcess.reverse();

    for (const { commitHash, commitData } of commitsToProcess) {
      // Fetch remote tree object if missing
      let treePayload;
      if (this.storage.hasObject(commitData.tree)) {
        const obj = this.storage.readObject(commitData.tree);
        treePayload = obj.payload;
      } else {
        treePayload = await this.cloudClient.getObject(`trees/${commitData.tree}`);
        this.storage.writeObject(OBJECT_TYPES.TREE, treePayload, true);
      }

      const treeData = safeJsonParse(treePayload.toString('utf-8'), `remote_tree[${commitData.tree}]`);

      // Download missing chunks into local CAS
      const requiredChunks = [];
      for (const ch of treeData.projectFile?.chunks || []) {
        requiredChunks.push(ch.hash);
      }
      for (const asset of treeData.assets || []) {
        for (const ch of asset.chunks || []) {
          requiredChunks.push(ch.hash);
        }
      }

      for (const chHash of requiredChunks) {
        if (!this.storage.hasObject(chHash)) {
          const chunkPayload = await this.cloudClient.getObject(`chunks/${chHash}`);
          this.storage.writeObject(OBJECT_TYPES.CHUNK, chunkPayload);
          downloadedChunks++;
        }
      }

      // Update SQLite commits table
      const now = Date.now();
      const author = commitData.author || {};
      this.db.prepare(`
        INSERT INTO commits (commit_hash, tree_hash, parent_hash, second_parent_hash, author_name, author_email, message, committed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(commit_hash) DO NOTHING
      `).run(
        commitHash,
        commitData.tree,
        commitData.parent || null,
        commitData.secondParent || null,
        author.name || 'Remote Editor',
        author.email || '',
        commitData.message || '',
        commitData.committedAt || now
      );
    }

    // Update branch ref
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO branches (name, commit_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET commit_hash = excluded.commit_hash, updated_at = excluded.updated_at
    `).run(branchName, remoteCommitHash, now, now);

    return {
      pulledCommits: Math.max(commitsToProcess.length, 1),
      downloadedChunks,
      newCommitHash: remoteCommitHash
    };
  }

  /**
   * Clone a project from remote cloud storage into target directory.
   * @param {string} targetDir 
   * @param {string} [branchName='main']
   */
  async clone(targetDir, branchName = 'main') {
    const targetRoot = path.resolve(targetDir);
    const framegitDir = path.join(targetRoot, '.framegit');
    if (!fs.existsSync(framegitDir)) {
      wrapFsOperation(() => fs.mkdirSync(framegitDir, { recursive: true }), framegitDir, 'mkdir');
    }

    const { VersionEngine } = require('./version_engine');
    // Initialize temporary repository instance to establish schema
    const tempRepo = new VersionEngine(targetRoot, 'project.prproj');
    tempRepo.init();

    const newSyncEngine = new SyncEngine(targetRoot, this.cloudClient, tempRepo.db);
    const pullResult = await newSyncEngine.pull(branchName);

    // Dynamically discover actual project file name from pulled root tree
    const commitObj = newSyncEngine.storage.readObject(pullResult.newCommitHash);
    const commitData = safeJsonParse(commitObj.payload.toString('utf-8'), `clone_commit[${pullResult.newCommitHash}]`);
    const treeObj = newSyncEngine.storage.readObject(commitData.tree);
    const treeData = safeJsonParse(treeObj.payload.toString('utf-8'), `clone_tree[${commitData.tree}]`);
    const actualProjectFile = treeData.projectFile ? treeData.projectFile.relativePath : 'project.prproj';

    // Re-bind VersionEngine to the actual project file and open
    const newRepo = new VersionEngine(targetRoot, actualProjectFile);
    newRepo.open();

    // Reconstruct workspace files bit-for-bit
    newRepo.checkoutCommit(pullResult.newCommitHash, true);

    return {
      targetRoot,
      commitHash: pullResult.newCommitHash,
      downloadedChunks: pullResult.downloadedChunks,
      projectFile: actualProjectFile
    };
  }

  /**
   * Check if ancestorHash is in the parent chain of childHash.
   */
  isAncestor(ancestorHash, childHash) {
    let current = childHash;
    while (current) {
      if (current === ancestorHash) return true;
      const row = this.db.prepare('SELECT parent_hash FROM commits WHERE commit_hash = ?').get(current);
      current = row ? row.parent_hash : null;
    }
    return false;
  }

  /**
   * Collect commit hashes on local branch not present on remote.
   */
  collectCommitsSince(headHash, baseHash) {
    const list = [];
    let current = headHash;
    while (current && current !== baseHash) {
      list.push(current);
      const row = this.db.prepare('SELECT parent_hash FROM commits WHERE commit_hash = ?').get(current);
      current = row ? row.parent_hash : null;
    }
    return list;
  }
}

module.exports = { SyncEngine };
