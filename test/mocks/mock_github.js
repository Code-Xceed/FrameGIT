/**
 * Mock GitHub API Client for Deterministic Unit & Integration Testing
 * 
 * Simulates GitHub Git Data API (Blobs, Trees, Commits, Refs, Tags, Releases)
 * entirely in-memory without making real outbound network requests.
 */

'use strict';

class MockGitHubApi {
  constructor() {
    this.repositories = new Map(); // 'owner/repo' -> { commits: [], branches: Map, tags: Map, tree: Map }
    this.token = null;
  }

  authenticate(token) {
    if (!token || token.length < 10) throw new Error('Invalid GitHub OAuth token');
    this.token = token;
    return { user: 'creative-editor', authenticated: true };
  }

  createOrGetRepo(repoFullName) {
    if (!this.repositories.has(repoFullName)) {
      this.repositories.set(repoFullName, {
        fullName: repoFullName,
        commits: [],
        branches: new Map([['main', null]]),
        tags: new Map(),
        tree: new Map() // filePath -> { content, size }
      });
    }
    return this.repositories.get(repoFullName);
  }

  async pushCommit(repoFullName, { branchName, commitHash, author, message, files, committedAt }) {
    const repo = this.createOrGetRepo(repoFullName);
    const gitCommit = {
      sha: commitHash.slice(0, 40), // 40-char SHA format for GitHub
      framegitHash: commitHash,
      author,
      message,
      committedAt,
      filesCount: files.length
    };

    repo.commits.push(gitCommit);
    repo.branches.set(branchName, gitCommit.sha);

    for (const f of files) {
      repo.tree.set(f.path, { content: f.content, size: f.size || f.content.length });
    }

    return gitCommit;
  }

  async getFileContent(repoFullName, filePath) {
    const repo = this.repositories.get(repoFullName);
    if (!repo) return null;
    const entry = repo.tree.get(filePath);
    if (!entry) return null;
    return { content: entry.content, size: entry.size };
  }

  async createTag(repoFullName, { tagName, commitHash, message }) {
    const repo = this.createOrGetRepo(repoFullName);
    repo.tags.set(tagName, {
      name: tagName,
      commitSha: commitHash.slice(0, 40),
      framegitHash: commitHash,
      message,
      createdAt: Date.now()
    });
    return repo.tags.get(tagName);
  }
}

module.exports = { MockGitHubApi };
