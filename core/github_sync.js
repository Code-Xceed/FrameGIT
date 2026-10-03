// FrameGit Core - GitHub Metadata Integration & Pointer Synchronizer
// Mirrors commit graphs, branch refs, and lightweight manifests to GitHub while keeping massive video in S3/R2.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Hasher } = require('./hasher');
const { VersionEngine } = require('./version_engine');
const { CASStorage, OBJECT_TYPES } = require('./storage');
const { CloudClient } = require('./cloud_client');
const { safeJsonParse, wrapFsOperation, NetworkError, CloudAuthError } = require('./errors');

/**
 * Production GitHub REST API Client
 * Interacts directly with GitHub Git Data API (Blobs, Trees, Commits, Refs).
 */
class GitHubApiClient {
  /**
   * @param {Object} [options]
   * @param {string} [options.baseUrl='https://api.github.com']
   * @param {string} [options.token]
   * @param {string} [options.userAgent='FrameGit-Client/1.0']
   */
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || 'https://api.github.com').replace(/\/+$/, '');
    this.token = options.token || null;
    this.userAgent = options.userAgent || 'FrameGit-Client/1.0';
  }

  setToken(token) {
    this.token = token;
  }

  async _request(method, apiPath, body = null) {
    if (!this.token) {
      throw new CloudAuthError('GitHub', 'GitHub access token is required. Call linkRepository() or login first.');
    }

    const url = `${this.baseUrl}${apiPath.startsWith('/') ? apiPath : '/' + apiPath}`;
    const headers = {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': this.userAgent
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (response.status === 401 || response.status === 403) {
      const errText = await response.text().catch(() => '');
      throw new CloudAuthError('GitHub', `Authentication failed (${response.status}): ${errText}`);
    }

    if (!response.ok && response.status !== 404) {
      const errText = await response.text().catch(() => '');
      throw new NetworkError(method, `GitHub API error (${response.status}) on ${apiPath}: ${errText}`);
    }

    if (response.status === 204) return null;
    if (response.status === 404) return null;

    return response.json();
  }

  async authenticate(token) {
    this.token = token;
    const user = await this._request('GET', '/user');
    if (!user || !user.login) {
      throw new CloudAuthError('GitHub', 'Failed to authenticate GitHub user. Check token permissions.');
    }
    return { user: user.login, authenticated: true };
  }

  async getRepo(repoFullName) {
    return this._request('GET', `/repos/${repoFullName}`);
  }

  async createRepo({ name, description = '', isPrivate = true }) {
    return this._request('POST', '/user/repos', {
      name,
      description,
      private: isPrivate,
      auto_init: false
    });
  }

  /**
   * Read a file's UTF-8 content from a repository via the GitHub Contents API.
   * @param {string} repoFullName 'owner/repo'
   * @param {string} filePath Repository-relative path
   * @param {string} [ref] Optional branch/tag/commit ref
   * @returns {Promise<{content: string, sha: string, size: number}|null>}
   */
  async getFileContent(repoFullName, filePath, ref = null) {
    const cleanPath = String(filePath).split('/').map(encodeURIComponent).join('/');
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const res = await this._request('GET', `/repos/${repoFullName}/contents/${cleanPath}${query}`);
    if (!res || Array.isArray(res) || !res.content) return null;
    return {
      content: Buffer.from(res.content, res.encoding === 'base64' ? 'base64' : 'utf-8').toString('utf-8'),
      sha: res.sha,
      size: res.size
    };
  }

  async createBlob(repoFullName, content) {
    const res = await this._request('POST', `/repos/${repoFullName}/git/blobs`, {
      content,
      encoding: 'utf-8'
    });
    return res.sha;
  }

  async createTree(repoFullName, treeItems, baseTreeSha = null) {
    const payload = { tree: treeItems };
    if (baseTreeSha) payload.base_tree = baseTreeSha;
    const res = await this._request('POST', `/repos/${repoFullName}/git/trees`, payload);
    return res.sha;
  }

  async createCommit(repoFullName, message, treeSha, parents = [], author = null) {
    const payload = {
      message,
      tree: treeSha,
      parents
    };
    if (author) {
      payload.author = {
        name: author.name || 'FrameGit Editor',
        email: author.email || 'editor@framegit.local',
        date: new Date().toISOString()
      };
    }
    const res = await this._request('POST', `/repos/${repoFullName}/git/commits`, payload);
    return res.sha;
  }

  async getCommit(repoFullName, commitSha) {
    const res = await this._request('GET', `/repos/${repoFullName}/git/commits/${commitSha}`);
    return res;
  }

  async getRef(repoFullName, branchName) {
    const res = await this._request('GET', `/repos/${repoFullName}/git/ref/heads/${branchName}`);
    if (!res || !res.object) return null;
    return res.object.sha;
  }

  async updateRef(repoFullName, branchName, commitSha, force = false) {
    const existing = await this.getRef(repoFullName, branchName);
    if (!existing) {
      await this._request('POST', `/repos/${repoFullName}/git/refs`, {
        ref: `refs/heads/${branchName}`,
        sha: commitSha
      });
      return { ref: `refs/heads/${branchName}`, sha: commitSha };
    }

    await this._request('PATCH', `/repos/${repoFullName}/git/refs/heads/${branchName}`, {
      sha: commitSha,
      force
    });
    return { ref: `refs/heads/${branchName}`, sha: commitSha };
  }

  async createTag(repoFullName, { tagName, commitHash, message }) {
    const commitSha = commitHash.slice(0, 40);
    const tagRes = await this._request('POST', `/repos/${repoFullName}/git/tags`, {
      tag: tagName,
      message: message || `Release ${tagName}`,
      object: commitSha,
      type: 'commit'
    });

    const shaToPoint = (tagRes && tagRes.sha) ? tagRes.sha : commitSha;
    await this._request('POST', `/repos/${repoFullName}/git/refs`, {
      ref: `refs/tags/${tagName}`,
      sha: shaToPoint
    });

    return { name: tagName, sha: shaToPoint, framegitHash: commitHash };
  }

  async pushCommit(repoFullName, { branchName, commitHash, author, message, files, committedAt }) {
    const treeItems = [];
    for (const file of files) {
      const blobSha = await this.createBlob(repoFullName, file.content);
      treeItems.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blobSha
      });
    }

    const currentBranchSha = await this.getRef(repoFullName, branchName);
    let baseTreeSha = null;
    if (currentBranchSha) {
      try {
        const commitObj = await this.getCommit(repoFullName, currentBranchSha);
        if (commitObj && commitObj.tree && commitObj.tree.sha) {
          baseTreeSha = commitObj.tree.sha;
        }
      } catch (_) {}
    }

    const newTreeSha = await this.createTree(repoFullName, treeItems, baseTreeSha);
    const parents = currentBranchSha ? [currentBranchSha] : [];
    const newCommitSha = await this.createCommit(repoFullName, message, newTreeSha, parents, author);

    await this.updateRef(repoFullName, branchName, newCommitSha);

    return {
      sha: newCommitSha,
      framegitHash: commitHash,
      filesCount: files.length
    };
  }
}

class GitHubSync {
  /**
   * @param {VersionEngine} versionEngine 
   * @param {Object} [options]
   * @param {Object} [options.apiClient] Injected API client (defaults to the real GitHubApiClient)
   */
  constructor(versionEngine, options = {}) {
    this.engine = versionEngine;
    this.rootPath = versionEngine.rootPath;
    this.storage = new CASStorage(this.rootPath);
    this.api = options.apiClient || new GitHubApiClient(options);
    this.linkedRepo = null;
    this.oauthToken = null;
  }

  /**
   * Link FrameGit repository with a GitHub repository.
   * @param {string} token GitHub OAuth / Personal Access Token
   * @param {string} repoFullName 'owner/repo'
   */
  linkRepository(token, repoFullName) {
    this.oauthToken = token;
    this.linkedRepo = repoFullName;

    // Persist link in SQLite
    this.engine.db.exec(`
      CREATE TABLE IF NOT EXISTS github_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.engine.db.prepare("INSERT INTO github_config (key, value) VALUES ('repo_fullname', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(repoFullName);

    const authResult = this.api.authenticate(token);
    if (authResult && typeof authResult.then === 'function') {
      return authResult.then(res => ({
        user: res.user,
        repo: repoFullName,
        linked: true
      }));
    }

    return {
      user: authResult ? authResult.user : 'authenticated-user',
      repo: repoFullName,
      linked: true
    };
  }

  /**
   * Retrieve the linked GitHub repository name from memory or SQLite.
   * @returns {string|null}
   */
  getLinkedRepo() {
    if (this.linkedRepo) return this.linkedRepo;
    try {
      this.engine.db.exec(`
        CREATE TABLE IF NOT EXISTS github_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
      const row = this.engine.db.prepare("SELECT value FROM github_config WHERE key = 'repo_fullname'").get();
      if (row && row.value) {
        this.linkedRepo = row.value;
        return this.linkedRepo;
      }
    } catch (_) {}
    return null;
  }

  /**
   * Check remote GitHub branch ref and compute ahead/behind status.
   * @param {string} [branchName='main']
   * @returns {Promise<{isLinked: boolean, repoFullName: string|null, ahead: number, behind: number, remoteSha: string|null}>}
   */
  async getRemoteStatus(branchName = 'main') {
    const linked = this.getLinkedRepo();
    if (!linked) {
      return { isLinked: false, repoFullName: null, ahead: 0, behind: 0, remoteSha: null };
    }

    try {
      const branchRow = this.engine.db.prepare('SELECT commit_hash FROM branches WHERE name = ?').get(branchName);
      const localCommit = branchRow ? branchRow.commit_hash : null;
      const remoteRef = await this.api.getRef(linked, branchName);

      if (!remoteRef) {
        return {
          isLinked: true,
          repoFullName: linked,
          ahead: localCommit ? 1 : 0,
          behind: 0,
          remoteSha: null
        };
      }

      // Check if remote ref matches local or if local has commits
      const isUpToDate = localCommit && remoteRef.startsWith(localCommit.slice(0, 7));
      return {
        isLinked: true,
        repoFullName: linked,
        ahead: isUpToDate ? 0 : 1,
        behind: 0,
        remoteSha: remoteRef
      };
    } catch (err) {
      return {
        isLinked: true,
        repoFullName: linked,
        ahead: 0,
        behind: 0,
        remoteSha: null,
        error: err.message
      };
    }
  }

  /**
   * Mirror a FrameGit commit and its asset manifests to GitHub.
   * Only lightweight pointers and JSON manifests are committed to GitHub (never binary media!).
   * @param {string} branchName 
   * @returns {Promise<{gitSha: string, filesPushed: number, totalManifestBytes: number}>}
   */
  async syncBranchToGitHub(branchName) {
    if (!this.linkedRepo) {
      this.linkedRepo = this.getLinkedRepo();
    }
    if (!this.linkedRepo) {
      throw new Error('Repository is not linked to GitHub. Call linkRepository() first.');
    }

    const branchRow = this.engine.db.prepare('SELECT commit_hash FROM branches WHERE name = ?').get(branchName);
    if (!branchRow) {
      throw new Error(`Branch '${branchName}' not found.`);
    }

    const commitObj = this.storage.readObject(branchRow.commit_hash);
    const commitData = safeJsonParse(commitObj.payload.toString('utf-8'), `commit[${branchRow.commit_hash}]`);
    const treeObj = this.storage.readObject(commitData.tree);
    const treeData = safeJsonParse(treeObj.payload.toString('utf-8'), `tree[${commitData.tree}]`);

    // 1. Generate Lightweight Project Manifest (< 100 KB)
    const manifestJson = JSON.stringify({
      schema: 'https://framegit.io/schemas/v1/github-manifest.json',
      framegitCommit: branchRow.commit_hash,
      projectFile: treeData.projectFile.relativePath,
      projectFileSize: treeData.projectFile.size,
      projectFileBlake3: treeData.projectFile.fullHash,
      projectStateSummary: {
        editor: treeData.projectState?.metadata?.editor,
        sequencesCount: treeData.projectState?.sequences?.length || 0,
        assetsCount: treeData.assets?.length || 0
      },
      committedAt: commitData.committedAt
    }, null, 2);

    const filesToPush = [
      {
        path: '.framegit/manifest.json',
        content: manifestJson,
        size: Buffer.byteLength(manifestJson)
      }
    ];

    let totalManifestBytes = Buffer.byteLength(manifestJson);

    // 2. Generate Asset Pointers (LFS-style pointers pointing to CAS chunks in Cloudflare R2 / S3)
    for (const asset of treeData.assets || []) {
      const pointerData = JSON.stringify({
        version: 'https://framegit.io/spec/v1/pointer',
        assetPath: asset.relativePath,
        fileSize: asset.size,
        fileBlake3: asset.fullHash,
        chunksCount: asset.chunks.length,
        chunks: asset.chunks.map(c => ({ offset: c.offset, size: c.size, hash: c.hash }))
      }, null, 2);

      const pointerFileName = `.framegit/pointers/${asset.fullHash.slice(0, 16)}.json`;
      filesToPush.push({
        path: pointerFileName,
        content: pointerData,
        size: Buffer.byteLength(pointerData)
      });
      totalManifestBytes += Buffer.byteLength(pointerData);
    }

    // 3. Generate human-readable README for GitHub web UI
    const readmeContent = `# ${path.basename(this.rootPath)} (FrameGit Managed Project)

> **Editor:** ${treeData.projectState?.metadata?.editor || 'Adobe Premiere Pro'}  
> **Active Commit:** \`${branchRow.commit_hash.slice(0, 8)}\`  
> **Committed By:** ${commitData.author.name} (<${commitData.author.email}>)  
> **Timestamp:** ${new Date(commitData.committedAt).toISOString()}

## Commit Message
${commitData.message}

## Project Overview
- **Sequences:** ${treeData.projectState?.sequences?.length || 0}
- **Tracked Assets:** ${treeData.assets?.length || 0} files
- **Project File:** \`${treeData.projectFile.relativePath}\` (${(treeData.projectFile.size / 1024).toFixed(1)} KB)

---
*Synced securely via FrameGit. Media chunks stored in zero-egress cloud storage.*
`;
    filesToPush.push({
      path: 'README.md',
      content: readmeContent,
      size: Buffer.byteLength(readmeContent)
    });
    totalManifestBytes += Buffer.byteLength(readmeContent);

    // 4. Push commit mirror to GitHub
    const gitCommit = await this.api.pushCommit(this.linkedRepo, {
      branchName,
      commitHash: branchRow.commit_hash,
      author: commitData.author,
      message: commitData.message,
      files: filesToPush,
      committedAt: commitData.committedAt
    });

    return {
      gitSha: gitCommit.sha,
      filesPushed: filesToPush.length,
      totalManifestBytes
    };
  }

  /**
   * Create a GitHub release tag linked to a FrameGit commit.
   * @param {string} tagName 
   * @param {string} [message] 
   */
  async createReleaseTag(tagName, message = '') {
    if (!this.linkedRepo) throw new Error('Repository is not linked to GitHub');
    const headHash = this.engine.getHeadCommitHash();
    if (!headHash) throw new Error('No commits to tag');

    return this.api.createTag(this.linkedRepo, {
      tagName,
      commitHash: headHash,
      message
    });
  }

  /**
   * Reconstruct a project from GitHub manifest pointers + Cloudflare R2 chunk storage.
   * Proves that GitHub can store all metadata while S3/R2 stores media chunks.
   * @param {string} targetDir 
   * @param {CloudClient} cloudClient 
   * @param {Object} api 
   * @param {string} repoFullName 
   */
  static async reconstructFromGitHubAndCloud(targetDir, cloudClient, api, repoFullName) {
    const manifestFile = await api.getFileContent(repoFullName, '.framegit/manifest.json');
    if (!manifestFile || !manifestFile.content) {
      throw new Error(`No .framegit/manifest.json found in GitHub repository: ${repoFullName}`);
    }

    const manifest = safeJsonParse(manifestFile.content, 'github_manifest.json');

    // Fetch commit object and tree object from R2
    const commitPayload = await cloudClient.getObject(`commits/${manifest.framegitCommit}`);
    const commitData = safeJsonParse(commitPayload.toString('utf-8'), `commit[${manifest.framegitCommit}]`);

    const treePayload = await cloudClient.getObject(`trees/${commitData.tree}`);
    const treeData = safeJsonParse(treePayload.toString('utf-8'), `tree[${commitData.tree}]`);

    // Initialize fresh target repo
    const targetRoot = path.resolve(targetDir);
    const targetStorage = new CASStorage(targetRoot);
    targetStorage.init();

    // Reconstruct .prproj from R2 chunks
    const prprojTarget = path.join(targetRoot, treeData.projectFile.relativePath);
    await downloadAndAssemble(treeData.projectFile, prprojTarget, cloudClient, targetStorage);

    // Reconstruct media assets from R2 chunks
    for (const asset of treeData.assets || []) {
      const assetTarget = path.join(targetRoot, asset.relativePath);
      await downloadAndAssemble(asset, assetTarget, cloudClient, targetStorage);
    }

    return {
      targetRoot,
      framegitCommit: manifest.framegitCommit,
      projectFile: prprojTarget
    };
  }
}

async function downloadAndAssemble(manifest, destPath, cloudClient, storage) {
  const parent = path.dirname(destPath);
  if (!fs.existsSync(parent)) {
    wrapFsOperation(() => fs.mkdirSync(parent, { recursive: true }), parent, 'mkdir');
  }

  const tempPath = destPath + `.${Date.now()}.${crypto.randomUUID()}.restore.tmp`;
  const writeStream = fs.createWriteStream(tempPath);

  try {
    for (const c of manifest.chunks) {
      const chunkBytes = await cloudClient.getObject(`chunks/${c.hash}`);
      storage.writeObject(OBJECT_TYPES.CHUNK, chunkBytes);
      if (!writeStream.write(chunkBytes)) {
        await new Promise(resolve => writeStream.once('drain', resolve));
      }
    }

    await new Promise((resolve, reject) => {
      writeStream.end();
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    if (fs.existsSync(destPath)) {
      try { fs.unlinkSync(destPath); } catch {}
    }
    wrapFsOperation(() => fs.renameSync(tempPath, destPath), destPath, 'rename');
  } catch (err) {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch {}
    }
    throw err;
  }
}

module.exports = {
  GitHubSync,
  GitHubApiClient
};
