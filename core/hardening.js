// FrameGit Core - Production Hardening, Disaster Recovery & Integrity Engine
// Implements:
// 1. Cryptographic fsck & auto-repair from cloud storage
// 2. Crash recovery & automated rolling snapshot manager
// 3. Resilient offline sync queue
// 4. Telemetry and diagnostic health reporter

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Hasher } = require('./hasher');
const { OBJECT_TYPES } = require('./storage');
const { wrapFsOperation, safeJsonParse } = require('./errors');

class ProductionHardening {
  /**
   * @param {import('./version_engine').VersionEngine} versionEngine
   * @param {import('./cloud_client').CloudStorageClient} [cloudClient=null]
   */
  constructor(versionEngine, cloudClient = null) {
    this.versionEngine = versionEngine;
    this.rootPath = versionEngine.rootPath;
    this.storage = versionEngine.storage;
    this.db = versionEngine.db;
    this.cloudClient = cloudClient;
    this.snapshotsDir = path.join(versionEngine.framegitDir, 'snapshots');
    this.logsDir = path.join(versionEngine.framegitDir, 'logs');
  }

  /**
   * Initialize hardening tables and recovery directories.
   */
  init() {
    if (!fs.existsSync(this.snapshotsDir)) {
      wrapFsOperation(() => fs.mkdirSync(this.snapshotsDir, { recursive: true }), this.snapshotsDir, 'mkdir');
    }
    if (!fs.existsSync(this.logsDir)) {
      wrapFsOperation(() => fs.mkdirSync(this.logsDir, { recursive: true }), this.logsDir, 'mkdir');
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS offline_sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_type TEXT NOT NULL, /* 'chunk' | 'commit' | 'branch' */
        item_key TEXT NOT NULL,
        payload TEXT,
        attempts INTEGER DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS recovery_snapshots (
        snapshot_id TEXT PRIMARY KEY,
        project_hash TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  // =========================================================================
  // 1. INTEGRITY VERIFICATION (FSCK) & AUTO-REPAIR
  // =========================================================================

  /**
   * Audit all objects in the repository for cryptographic integrity.
   * Detects bit rot, missing chunks, and truncated files.
   * @returns {{valid: boolean, totalChecked: number, corrupted: Array, missing: Array}}
   */
  fsck() {
    const corrupted = [];
    const missing = [];
    let totalChecked = 0;

    // Check all chunks tracked in catalog
    const catalogRows = this.db.prepare('SELECT chunk_hash, size_bytes FROM chunk_catalog').all();
    for (const row of catalogRows) {
      totalChecked++;
      const hash = row.chunk_hash;
      try {
        const obj = this.storage.readObject(hash);
        if (!obj) {
          missing.push({ hash, type: 'chunk', size: row.size_bytes });
        } else {
          const actualHash = Hasher.hash(obj.payload);
          if (actualHash !== hash) {
            corrupted.push({ hash, type: 'chunk', expectedHash: hash, actualHash });
          }
        }
      } catch (err) {
        corrupted.push({ hash, type: 'chunk', error: err.message });
      }
    }

    // Check all commit objects
    const commitRows = this.db.prepare('SELECT commit_hash, tree_hash FROM commits').all();
    for (const row of commitRows) {
      totalChecked++;
      try {
        const commitObj = this.storage.readObject(row.commit_hash);
        if (!commitObj) {
          missing.push({ hash: row.commit_hash, type: 'commit' });
        } else {
          const actualHash = Hasher.hash(commitObj.payload);
          if (actualHash !== row.commit_hash) {
            corrupted.push({ hash: row.commit_hash, type: 'commit', expectedHash: row.commit_hash, actualHash });
          }
        }
      } catch (err) {
        corrupted.push({ hash: row.commit_hash, type: 'commit', error: err.message });
      }

      // Check tree object
      totalChecked++;
      try {
        const treeObj = this.storage.readObject(row.tree_hash);
        if (!treeObj) {
          missing.push({ hash: row.tree_hash, type: 'tree' });
        } else {
          const actualHash = Hasher.hash(treeObj.payload);
          if (actualHash !== row.tree_hash) {
            corrupted.push({ hash: row.tree_hash, type: 'tree', expectedHash: row.tree_hash, actualHash });
          }
        }
      } catch (err) {
        corrupted.push({ hash: row.tree_hash, type: 'tree', error: err.message });
      }
    }

    return {
      valid: corrupted.length === 0 && missing.length === 0,
      totalChecked,
      corrupted,
      missing
    };
  }

  /**
   * Repair corrupted or missing chunks by re-fetching from cloud storage.
   * @param {Array<{hash: string, type: string}>} damagedItems
   * @returns {Promise<{repairedCount: number, failedCount: number, repaired: Array}>}
   */
  async repairFromCloud(damagedItems = []) {
    if (!this.cloudClient) {
      throw new Error('Cloud storage client is required for automated repair.');
    }

    const repaired = [];
    let repairedCount = 0;
    let failedCount = 0;

    for (const item of damagedItems) {
      try {
        if (item.type === 'chunk') {
          const chunkData = await this.cloudClient.downloadChunk(item.hash);
          if (chunkData && Hasher.hash(chunkData) === item.hash) {
            const objPath = this.storage.getObjectPath(item.hash);
            if (fs.existsSync(objPath)) {
              try { fs.unlinkSync(objPath); } catch (_) {}
            }
            this.storage.writeObject(OBJECT_TYPES.CHUNK, chunkData);
            repaired.push(item.hash);
            repairedCount++;
          } else {
            failedCount++;
          }
        } else if (item.type === 'commit' || item.type === 'tree') {
          const remoteKey = `${item.type}s/${item.hash}`;
          const objData = await this.cloudClient.getObject(remoteKey);
          if (objData && Hasher.hash(objData) === item.hash) {
            const objPath = this.storage.getObjectPath(item.hash);
            if (fs.existsSync(objPath)) {
              try { fs.unlinkSync(objPath); } catch (_) {}
            }
            const objType = item.type === 'commit' ? OBJECT_TYPES.COMMIT : OBJECT_TYPES.TREE;
            this.storage.writeObject(objType, objData, true);
            repaired.push(item.hash);
            repairedCount++;
          } else {
            failedCount++;
          }
        }
      } catch {
        failedCount++;
      }
    }

    return { repairedCount, failedCount, repaired };
  }

  // =========================================================================
  // 2. CRASH RECOVERY & ROLLING SNAPSHOTS
  // =========================================================================

  /**
   * Capture an uncompressed/validated safety snapshot before risky operations.
   */
  captureSnapshot() {
    if (!fs.existsSync(this.versionEngine.projectFilePath)) return null;

    const buffer = fs.readFileSync(this.versionEngine.projectFilePath);
    if (buffer.length === 0) return null; // Do not snapshot 0-byte corrupt files

    const hash = Hasher.hash(buffer);
    const snapshotId = `snap_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const snapshotPath = path.join(this.snapshotsDir, `${snapshotId}.bak`);

    wrapFsOperation(() => fs.writeFileSync(snapshotPath, buffer), snapshotPath, 'write');

    this.db.prepare(`
      INSERT INTO recovery_snapshots (snapshot_id, project_hash, file_path, file_size, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(snapshotId, hash, snapshotPath, buffer.length, Date.now());

    // Keep only last 10 snapshots to bound disk usage
    const allSnaps = this.db.prepare('SELECT snapshot_id, file_path FROM recovery_snapshots ORDER BY created_at DESC').all();
    if (allSnaps.length > 10) {
      for (let i = 10; i < allSnaps.length; i++) {
        try { fs.unlinkSync(allSnaps[i].file_path); } catch (_) {}
        this.db.prepare('DELETE FROM recovery_snapshots WHERE snapshot_id = ?').run(allSnaps[i].snapshot_id);
      }
    }

    return { snapshotId, hash, snapshotPath };
  }

  /**
   * Disaster recovery: Restore damaged or truncated project file.
   * Priority 1: Latest valid local snapshot
   * Priority 2: Latest committed HEAD tree in CAS
   * @returns {{restored: boolean, source: string, projectHash: string}}
   */
  recoverProjectFile() {
    const projPath = this.versionEngine.projectFilePath;
    let needsRecovery = false;

    if (!fs.existsSync(projPath)) {
      needsRecovery = true;
    } else {
      const stats = fs.statSync(projPath);
      if (stats.size === 0) {
        needsRecovery = true;
      } else {
        // Try parsing to verify XML/DRP integrity
        try {
          this.versionEngine.adapter.getProjectState(projPath);
        } catch {
          needsRecovery = true;
        }
      }
    }

    if (!needsRecovery) {
      return { restored: false, source: 'none', reason: 'Project file is intact' };
    }

    // Try Priority 1: Latest valid snapshot
    const snaps = this.db.prepare('SELECT file_path, project_hash FROM recovery_snapshots ORDER BY created_at DESC').all();
    for (const snap of snaps) {
      if (fs.existsSync(snap.file_path) && fs.statSync(snap.file_path).size > 0) {
        const snapBuf = fs.readFileSync(snap.file_path);
        const tempTest = snap.file_path + '.test';
        try {
          // Verify snapshot parseability
          wrapFsOperation(() => fs.writeFileSync(tempTest, snapBuf), tempTest, 'write');
          this.versionEngine.adapter.getProjectState(tempTest);

          // Restored!
          wrapFsOperation(() => fs.writeFileSync(projPath, snapBuf), projPath, 'write');
          return { restored: true, source: 'snapshot', projectHash: snap.project_hash };
        } catch (_) {
          // Test failed, try next snapshot
        } finally {
          try { fs.unlinkSync(tempTest); } catch (_) {}
        }
      }
    }

    // Try Priority 2: Reconstruct from current HEAD commit in CAS
    const headHash = this.versionEngine.getHeadCommitHash();
    if (headHash) {
      const commitObj = this.storage.readObject(headHash);
      if (commitObj) {
        const commitData = JSON.parse(commitObj.payload.toString('utf-8'));
        const treeObj = this.storage.readObject(commitData.tree);
        if (treeObj) {
          const treeData = JSON.parse(treeObj.payload.toString('utf-8'));
          this.versionEngine.reconstructFileFromChunks(treeData.projectFile, projPath);
          return { restored: true, source: 'cas_commit', projectHash: treeData.projectFile.fullHash };
        }
      }
    }

    throw new Error('Fatal: Unable to recover project file. No valid snapshot or commit tree found.');
  }

  // =========================================================================
  // 3. RESILIENT OFFLINE SYNC QUEUE
  // =========================================================================

  /**
   * Enqueue a pending synchronization operation when working offline.
   * @param {'chunk'|'commit'|'branch'} itemType 
   * @param {string} itemKey 
   * @param {Object} [payload=null]
   */
  enqueueSync(itemType, itemKey, payload = null) {
    this.db.prepare(`
      INSERT INTO offline_sync_queue (item_type, item_key, payload, created_at)
      VALUES (?, ?, ?, ?)
    `).run(itemType, itemKey, payload ? JSON.stringify(payload) : null, Date.now());
  }

  /**
   * Drain offline sync queue and push to remote cloud storage.
   * @param {import('./sync_engine').SyncEngine} syncEngine 
   * @returns {Promise<{processed: number, failed: number}>}
   */
  async processSyncQueue(syncEngine) {
    const queue = this.db.prepare('SELECT * FROM offline_sync_queue ORDER BY id ASC').all();
    let processed = 0;
    let failed = 0;

    for (const item of queue) {
      try {
        if (item.item_type === 'branch') {
          await syncEngine.push(item.item_key);
        } else if (item.item_type === 'chunk') {
          if (syncEngine?.cloudClient && this.storage) {
            const chunkObj = this.storage.readObject(item.item_key);
            await syncEngine.cloudClient.putObject(`chunks/${item.item_key}`, chunkObj.payload);
          }
        } else if (item.item_type === 'commit') {
          if (syncEngine?.cloudClient && this.storage) {
            const commitObj = this.storage.readObject(item.item_key);
            await syncEngine.cloudClient.putObject(`commits/${item.item_key}`, commitObj.payload);
          }
        }
        this.db.prepare('DELETE FROM offline_sync_queue WHERE id = ?').run(item.id);
        processed++;
      } catch (err) {
        failed++;
        this.db.prepare('UPDATE offline_sync_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?')
          .run(err.message, item.id);
      }
    }

    return { processed, failed };
  }

  // =========================================================================
  // 4. DIAGNOSTIC HEALTH REPORT
  // =========================================================================

  /**
   * Generate comprehensive health and telemetry diagnostic report.
   * @returns {Object}
   */
  generateDiagnosticReport() {
    const fsckResult = this.fsck();
    const branchCount = this.db.prepare('SELECT COUNT(*) as c FROM branches').get().c;
    const commitCount = this.db.prepare('SELECT COUNT(*) as c FROM commits').get().c;
    const chunkCount = this.db.prepare('SELECT COUNT(*) as c, SUM(size_bytes) as total_size FROM chunk_catalog').get();
    const pendingQueueCount = this.db.prepare('SELECT COUNT(*) as c FROM offline_sync_queue').get().c;

    let projectSize = 0;
    if (fs.existsSync(this.versionEngine.projectFilePath)) {
      projectSize = fs.statSync(this.versionEngine.projectFilePath).size;
    }

    return {
      timestamp: new Date().toISOString(),
      workspaceRoot: this.rootPath,
      projectFile: path.basename(this.versionEngine.projectFilePath),
      projectSizeBytes: projectSize,
      health: fsckResult.valid ? 'HEALTHY' : 'DEGRADED',
      fsck: fsckResult,
      metrics: {
        totalBranches: branchCount,
        totalCommits: commitCount,
        totalTrackedChunks: chunkCount.c || 0,
        totalCatalogBytes: chunkCount.total_size || 0,
        pendingOfflineSyncItems: pendingQueueCount
      },
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        rssMemoryBytes: process.memoryUsage().rss
      }
    };
  }
}

module.exports = { ProductionHardening };
