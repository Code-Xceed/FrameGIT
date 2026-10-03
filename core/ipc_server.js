// FrameGit Core - Local Agent IPC Server
// Exposes typed JSON-RPC endpoints for the Adobe Premiere Pro UXP Panel with Bearer token authentication.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { VersionEngine, DirtyWorkingTreeError } = require('./version_engine');
const { SyncEngine } = require('./sync_engine');
const { CloudClient } = require('./cloud_client');
const { safeJsonParse, wrapFsOperation } = require('./errors');
const { loadConfig, getAuthor } = require('./config');

class IPCServer {
  /**
   * @param {VersionEngine} versionEngine 
   * @param {SyncEngine} [syncEngine]
   * @param {number} [port=null]
   */
  constructor(versionEngine, syncEngine = null, port = null) {
    this.engine = versionEngine;
    this.sync = syncEngine;
    this.config = this.engine?.config || loadConfig({ projectDir: this.engine?.rootPath });
    this.port = port !== null ? port : (this.config.daemon?.port || 41793);
    this.host = this.config.daemon?.host || '127.0.0.1';
    this.sessionSecret = crypto.randomBytes(32);
    this.authToken = this._generateToken();
    this.rotationTimer = null;
    this.server = null;
    this.authFilePath = path.join(this.engine.rootPath, '.framegit', 'agent.auth');
  }

  /**
   * Mint a session-bound HMAC-SHA256 authenticated token.
   * Format: <timestamp_ms>.<nonce>.<signature>
   * @param {number} [timestamp]
   * @returns {string}
   */
  _generateToken(timestamp = Date.now()) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const payload = `${timestamp}:${nonce}`;
    const sig = crypto.createHmac('sha256', this.sessionSecret).update(payload).digest('hex');
    return `${timestamp}.${nonce}.${sig}`;
  }

  /**
   * Verify authenticity and freshness of Bearer token.
   * @param {string} token 
   * @param {number} [maxAgeMs=86400000] 24 hours
   * @returns {boolean}
   */
  verifyToken(token, maxAgeMs = 24 * 60 * 60 * 1000) {
    if (!token || typeof token !== 'string') return false;
    if (token === this.authToken) return true;

    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const [tsStr, nonce, sig] = parts;
    const ts = parseInt(tsStr, 10);
    if (isNaN(ts)) return false;

    const now = Date.now();
    // Verify freshness (within maxAgeMs, clock skew up to 60s)
    if (now - ts > maxAgeMs || ts > now + 60000) {
      return false;
    }

    try {
      const payload = `${ts}:${nonce}`;
      const expectedSig = crypto.createHmac('sha256', this.sessionSecret).update(payload).digest('hex');
      const sigBuf = Buffer.from(sig, 'hex');
      const expBuf = Buffer.from(expectedSig, 'hex');
      if (sigBuf.length !== expBuf.length) return false;
      return crypto.timingSafeEqual(sigBuf, expBuf);
    } catch (_) {
      return false;
    }
  }

  /**
   * Rotate active auth token and update agent.auth atomically.
   */
  rotateToken() {
    this.authToken = this._generateToken();
    const authDir = path.dirname(this.authFilePath);
    if (!fs.existsSync(authDir)) {
      wrapFsOperation(() => fs.mkdirSync(authDir, { recursive: true, mode: 0o700 }), authDir, 'mkdir');
    }
    wrapFsOperation(() => fs.writeFileSync(this.authFilePath, JSON.stringify({
      port: this.port,
      host: this.host,
      token: this.authToken,
      createdAt: Date.now(),
      expiresInMs: 24 * 60 * 60 * 1000
    }, null, 2), { mode: 0o600 }), this.authFilePath, 'write');
  }

  /**
   * Start local IPC server and write auth token.
   * @returns {Promise<number>} Bound port
   */
  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // Enable CORS for Adobe UXP
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        // Authenticate Bearer token via HMAC verification
        const authHeader = req.headers['authorization'] || '';
        const token = authHeader.replace(/^Bearer\s+/i, '');
        if (!this.verifyToken(token) && req.url !== '/health') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized: invalid, expired, or missing IPC token' }));
          return;
        }

        if (req.url === '/health' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', port: this.port }));
          return;
        }

        if (req.url === '/api/rpc' && req.method === 'POST') {
          let body = '';
          const MAX_PAYLOAD = 10 * 1024 * 1024; // 10 MB limit
          let exceeded = false;

          req.on('data', chunk => {
            if (exceeded) return;
            body += chunk;
            if (body.length > MAX_PAYLOAD) {
              exceeded = true;
              res.writeHead(413, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Payload Too Large: maximum request body is 10MB' }));
              req.destroy();
            }
          });

          req.on('end', async () => {
            if (exceeded) return;
            try {
              const rpcRequest = safeJsonParse(body, 'JSON-RPC request');
              const result = await this.handleRpc(rpcRequest.action, rpcRequest.params);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ id: rpcRequest.id, result, error: null }));
            } catch (err) {
              const statusCode = err instanceof DirtyWorkingTreeError ? 409 : 500;
              res.writeHead(statusCode, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                id: null,
                result: null,
                error: { message: err.message, name: err.name, details: err.dirtyFiles || null }
              }));
            }
          });
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint not found' }));
      });

      this.server.on('error', reject);
      this.server.listen(this.port, this.host, () => {
        const addr = this.server.address();
        if (addr && typeof addr === 'object' && addr.port) {
          this.port = addr.port;
        }
        // Write HMAC token to .framegit/agent.auth
        this.rotateToken();

        // Setup 24h automatic token rotation
        this.rotationTimer = setInterval(() => {
          try {
            this.rotateToken();
          } catch (_) {}
        }, 24 * 60 * 60 * 1000);
        this.rotationTimer.unref();

        resolve(this.port);
      });
    });
  }

  /**
   * Stop the IPC server and remove auth file.
   */
  stop() {
    return new Promise(resolve => {
      if (this.rotationTimer) {
        clearInterval(this.rotationTimer);
        this.rotationTimer = null;
      }
      if (fs.existsSync(this.authFilePath)) {
        try { fs.unlinkSync(this.authFilePath); } catch (_) {}
      }
      if (this.server) {
        this.server.close(resolve);
      } else {
        resolve();
      }
    });
  }

  /**
   * Dispatch RPC actions to engine methods.
   * @param {string} action 
   * @param {Object} [params] 
   */
  async handleRpc(action, params = {}) {
    switch (action) {
      case 'project.status': {
        const st = this.engine.status();
        const currentBranch = this.engine.getCurrentBranch();
        const headHash = this.engine.getHeadCommitHash();
        return {
          currentBranch,
          headCommit: headHash ? headHash.slice(0, 8) : null,
          headCommitFull: headHash,
          hasChanges: st.hasChanges,
          changes: st.changes,
          projectName: path.basename(this.engine.projectFilePath)
        };
      }

      case 'project.commit': {
        if (!params.message || params.message.trim().length === 0) {
          throw new Error('Commit message is required');
        }
        const author = params.author || getAuthor(this.config);
        const result = await this.engine.commit(params.message, author);
        return {
          commitHash: result.commitHash,
          shortHash: result.commitHash.slice(0, 8),
          branch: result.branch,
          message: params.message
        };
      }

      case 'branch.list': {
        return this.engine.listBranches();
      }

      case 'branch.create': {
        this.engine.createBranch(params.name, params.startCommit || null);
        return { created: true, name: params.name };
      }

      case 'branch.switch': {
        return this.engine.switchBranch(params.name, params.force ?? false);
      }

      case 'branch.delete': {
        this.engine.deleteBranch(params.name);
        return { deleted: true, name: params.name };
      }

      case 'project.history': {
        const limit = params.limit || 20;
        return this.engine.getLog(limit);
      }

      case 'project.restore': {
        this.engine.checkoutCommit(params.commitHash, params.force ?? false);
        return { restored: true, commitHash: params.commitHash };
      }

      case 'sync.push': {
        if (!this.sync) throw new Error('Cloud sync engine not configured');
        const branch = params.branch || this.engine.getCurrentBranch() || 'main';
        return this.sync.push(branch);
      }

      case 'sync.pull': {
        if (!this.sync) throw new Error('Cloud sync engine not configured');
        const branch = params.branch || this.engine.getCurrentBranch() || 'main';
        return this.sync.pull(branch);
      }

      case 'project.diff_visual': {
        const { VisualDiff } = require('./visual_diff');
        const headHash = params.commitHash || this.engine.getHeadCommitHash();
        let prevState = null;
        if (headHash) {
          prevState = this.engine.getCommitProjectState(headHash);
        }
        const currState = this.engine.adapter.getProjectState(this.engine.projectFilePath);
        const diffModel = VisualDiff.computeVisualDiff(prevState, currState);
        const html = VisualDiff.renderHtmlDiff(prevState, currState, {
          title: `FrameGit Visual Diff — ${path.basename(this.engine.projectFilePath)}`,
          width: params.width || 800
        });
        const ascii = VisualDiff.formatAsciiDiff(prevState, currState);
        return { diffModel, html, ascii };
      }

      default:
        throw new Error(`Unknown RPC action: '${action}'`);
    }
  }
}

module.exports = { IPCServer };
