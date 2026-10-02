// FrameGit Core - Global Multi-Project Catalog Manager
// Maintains the central machine registry of all tracked .framegit repositories
// across all storage volumes for the Desktop Dashboard.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

class ProjectCatalog {
  /**
   * @param {Object} [options]
   * @param {string} [options.catalogPath] Custom path to projects.json override for testing
   */
  constructor(options = {}) {
    const defaultDir = path.join(os.homedir(), '.framegit');
    this.catalogDir = options.catalogDir || defaultDir;
    this.catalogPath = options.catalogPath || path.join(this.catalogDir, 'projects.json');
    this._initStorage();
  }

  _initStorage() {
    if (!fs.existsSync(this.catalogDir)) {
      try {
        fs.mkdirSync(this.catalogDir, { recursive: true });
      } catch (_) {}
    }

    if (!fs.existsSync(this.catalogPath)) {
      const initialData = {
        version: '1.0.0',
        updatedAt: Date.now(),
        projects: []
      };
      try {
        fs.writeFileSync(this.catalogPath, JSON.stringify(initialData, null, 2), 'utf8');
      } catch (_) {}
    }
  }

  _readCatalog() {
    try {
      if (!fs.existsSync(this.catalogPath)) {
        return { version: '1.0.0', updatedAt: Date.now(), projects: [] };
      }
      const raw = fs.readFileSync(this.catalogPath, 'utf8');
      return JSON.parse(raw);
    } catch (_) {
      return { version: '1.0.0', updatedAt: Date.now(), projects: [] };
    }
  }

  _writeCatalog(data) {
    data.updatedAt = Date.now();
    const tempPath = this.catalogPath + `.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    if (fs.existsSync(this.catalogPath)) {
      try { fs.unlinkSync(this.catalogPath); } catch (_) {}
    }
    fs.renameSync(tempPath, this.catalogPath);
  }

  /**
   * Register or update a project repository in the global catalog.
   * @param {string} rootPath Absolute path to workspace repository
   * @param {Object} [meta={}] Optional explicit metadata
   * @returns {Object} Registered project entry
   */
  register(rootPath, meta = {}) {
    const resolvedPath = path.resolve(rootPath);
    const framegitDir = path.join(resolvedPath, '.framegit');

    if (!fs.existsSync(framegitDir)) {
      throw new Error(`Directory is not a FrameGit repository (.framegit not found): ${resolvedPath}`);
    }

    const catalog = this._readCatalog();
    const existingIndex = catalog.projects.findIndex(p => path.resolve(p.path).toLowerCase() === resolvedPath.toLowerCase());

    // Auto-discover project file if not provided
    let projectFile = meta.projectFile;
    if (!projectFile) {
      try {
        const files = fs.readdirSync(resolvedPath);
        projectFile = files.find(f => f.endsWith('.prproj') || f.endsWith('.drp')) || 'project.prproj';
      } catch (_) {
        projectFile = 'project.prproj';
      }
    }

    const projectName = meta.name || path.basename(resolvedPath);
    const adapterType = projectFile.endsWith('.drp') ? 'resolve' : 'premiere';

    // Introspect repository state if possible
    let currentBranch = meta.currentBranch || 'main';
    let headCommit = meta.headCommit || null;
    let lastMessage = meta.lastMessage || '';
    let committedAt = meta.committedAt || 0;

    const dbPath = path.join(framegitDir, 'state.db');
    if (fs.existsSync(dbPath)) {
      try {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(dbPath, { readOnly: true });
        const branchRow = db.prepare("SELECT value FROM repo_meta WHERE key = 'current_branch'").get();
        if (branchRow && branchRow.value) {
          currentBranch = branchRow.value;
        }

        const headRow = db.prepare("SELECT value FROM repo_meta WHERE key = 'head'").get();
        if (headRow && headRow.value) {
          const val = headRow.value;
          headCommit = val.startsWith('ref: ')
            ? (db.prepare('SELECT commit_hash FROM branches WHERE name = ?').get(val.replace('ref: refs/heads/', ''))?.commit_hash || null)
            : val;
        }

        if (headCommit) {
          const commitRow = db.prepare('SELECT message, committed_at FROM commits WHERE commit_hash = ?').get(headCommit);
          if (commitRow) {
            lastMessage = commitRow.message;
            committedAt = commitRow.committed_at;
          }
        }
        db.close();
      } catch (_) {
        // Fallback to defaults if SQLite cannot be opened in readOnly
      }
    }

    const now = Date.now();
    const entry = {
      id: meta.id || (existingIndex >= 0 ? catalog.projects[existingIndex].id : crypto.randomUUID()),
      name: projectName,
      path: resolvedPath,
      projectFile,
      adapter: adapterType,
      currentBranch,
      headCommit,
      lastCommitMessage: lastMessage,
      lastCommitAt: committedAt,
      isFavorite: meta.isFavorite ?? (existingIndex >= 0 ? catalog.projects[existingIndex].isFavorite : false),
      createdAt: existingIndex >= 0 ? catalog.projects[existingIndex].createdAt : now,
      updatedAt: now
    };

    if (existingIndex >= 0) {
      catalog.projects[existingIndex] = entry;
    } else {
      catalog.projects.push(entry);
    }

    this._writeCatalog(catalog);
    return entry;
  }

  /**
   * Remove a project from the catalog. Does not delete project files on disk.
   * @param {string} rootPath 
   * @returns {boolean}
   */
  unregister(rootPath) {
    const resolvedPath = path.resolve(rootPath).toLowerCase();
    const catalog = this._readCatalog();
    const initialLen = catalog.projects.length;

    catalog.projects = catalog.projects.filter(p => path.resolve(p.path).toLowerCase() !== resolvedPath);
    if (catalog.projects.length !== initialLen) {
      this._writeCatalog(catalog);
      return true;
    }
    return false;
  }

  /**
   * Retrieve all registered projects with live status annotations.
   * @returns {Array<Object>}
   */
  list() {
    const catalog = this._readCatalog();
    return catalog.projects.map(proj => {
      const exists = fs.existsSync(proj.path) && fs.existsSync(path.join(proj.path, '.framegit'));
      return {
        ...proj,
        existsOnDisk: exists
      };
    });
  }

  /**
   * Get single project by path.
   * @param {string} rootPath 
   * @returns {Object|null}
   */
  get(rootPath) {
    const resolvedPath = path.resolve(rootPath).toLowerCase();
    const catalog = this._readCatalog();
    const found = catalog.projects.find(p => path.resolve(p.path).toLowerCase() === resolvedPath);
    if (!found) return null;

    return {
      ...found,
      existsOnDisk: fs.existsSync(found.path) && fs.existsSync(path.join(found.path, '.framegit'))
    };
  }

  /**
   * Toggle favorite/pinned status for a project.
   * @param {string} rootPath 
   * @returns {boolean} New favorite state
   */
  toggleFavorite(rootPath) {
    const resolvedPath = path.resolve(rootPath).toLowerCase();
    const catalog = this._readCatalog();
    const proj = catalog.projects.find(p => path.resolve(p.path).toLowerCase() === resolvedPath);
    if (!proj) {
      throw new Error(`Project not found in catalog: ${rootPath}`);
    }

    proj.isFavorite = !proj.isFavorite;
    this._writeCatalog(catalog);
    return proj.isFavorite;
  }
}

module.exports = { ProjectCatalog };
