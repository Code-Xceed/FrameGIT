// FrameGit Desktop Application — Main Process & Server
// Integrates IPC server, Project Catalog, NLE Auto-Detector, Process Lifecycle Monitor,
// and Desktop Web GUI. Works both as an Electron Main Process and as a Standalone Desktop Server.

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { NleDetector } = require('../core/nle_detector');
const { ProjectCatalog } = require('../core/project_catalog');
const { ProcessMonitor } = require('../core/process_monitor');
const { VersionEngine } = require('../core/version_engine');
const { VisualDiff } = require('../core/visual_diff');
const { SyncEngine } = require('../core/sync_engine');
const { CloudClient } = require('../core/cloud_client');
const { GitHubApiClient, GitHubSync } = require('../core/github_sync');
const { GitHubAuth } = require('../core/github_auth');
const { safeJsonParse } = require('../core/errors');
const { getDefaultUserStore } = require('./user_store');

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

class DesktopServer {
  constructor(port = 41793, options = {}) {
    this.port = port;
    this.options = options;
    this.userStore = options.userStore || getDefaultUserStore();
    this.server = null;
    this.nleDetector = new NleDetector();
    this.projectCatalog = new ProjectCatalog();
    this.processMonitor = new ProcessMonitor({ intervalMs: 5000 });
    this.pendingOAuth = new Map();

    let staticDir = path.join(__dirname, 'renderer');
    if (!fs.existsSync(staticDir)) {
      const exeDir = path.dirname(process.execPath);
      const candidate = path.join(exeDir, 'desktop', 'renderer');
      if (fs.existsSync(candidate)) {
        staticDir = candidate;
      }
    }
    this.staticDir = staticDir;
  }

  _ensureCreativeIntegrations() {
    const results = { premiere: false, resolve: false };
    try {
      this.nleDetector.installPremierePlugin();
      results.premiere = true;
    } catch (_) {}
    try {
      this.nleDetector.installResolveScript();
      results.resolve = true;
    } catch (_) {}
    return results;
  }

  start() {
    return new Promise((resolve, reject) => {
      // Auto-deploy Premiere UXP Extension & DaVinci Resolve Scripting Bridge
      this._ensureCreativeIntegrations();

      // Start background NLE process monitor
      this.processMonitor.start();

      this.server = http.createServer(async (req, res) => {
        // Enable CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = new URL(req.url, `http://127.0.0.1:${this.port}`);
        const pathname = url.pathname;
        const userStore = this.userStore;

        try {
          // 1. Health & Heartbeat
          if (pathname === '/health' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', port: this.port }));
            return;
          }

          if (pathname === '/api/desktop/heartbeat' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              status: 'running',
              activeEditors: Array.from(this.processMonitor.activeProcesses.values()),
              hasActiveEditors: this.processMonitor.hasActiveEditors()
            }));
            return;
          }

          // 2. Project Catalog Endpoints
          if (pathname === '/api/desktop/projects' && req.method === 'GET') {
            const list = this.projectCatalog.list();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(list));
            return;
          }

          if (pathname === '/api/desktop/projects/register' && req.method === 'POST') {
            const body = await this._readBody(req);
            const parsed = safeJsonParse(body, 'register request');
            const entry = this.projectCatalog.register(parsed.path, parsed.meta || {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, project: entry }));
            return;
          }

          // 3. NLE Scanner & Extension Deployment
          if (pathname === '/api/desktop/nle-detect' && req.method === 'GET') {
            const detected = this.nleDetector.detectAll();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(detected));
            return;
          }

          if (pathname === '/api/desktop/deploy-plugins' && req.method === 'POST') {
            const premiereRes = this.nleDetector.installPremierePlugin();
            const resolveRes = this.nleDetector.installResolveScript();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, premiere: premiereRes, resolve: resolveRes }));
            return;
          }

          if (pathname === '/api/desktop/configure-startup' && req.method === 'POST') {
            const body = await this._readBody(req);
            const parsed = safeJsonParse(body, 'startup config');
            const ok = ProcessMonitor.configureWindowsStartup(parsed.enable !== false);
            // uses server userStore
            userStore.updateSettings({ autoStartBackgroundService: parsed.enable !== false });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: ok }));
            return;
          }

          if ((pathname === '/health' || pathname === '/api/health') && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', port: this.port, timestamp: Date.now() }));
            return;
          }

          // 3b. First-Run Setup & Local-First User Store Endpoints
          if (pathname === '/api/setup/status' && req.method === 'GET') {
            // uses server userStore
            const settings = userStore.getSettings();
            const auth = userStore.getGitHubAuth();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              isSetupCompleted: userStore.isSetupCompleted(),
              settings,
              auth: {
                hasToken: auth.hasToken,
                user: auth.user
              }
            }));
            return;
          }

          if (pathname === '/api/setup/verify-github' && req.method === 'POST') {
            const body = await this._readBody(req);
            const parsed = safeJsonParse(body, 'verify github request');
            const token = (parsed.token || '').trim();
            if (!token) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ valid: false, error: 'Token is required' }));
              return;
            }
            try {
              const client = new GitHubApiClient({ token });
              const userRes = await client._request('GET', '/user');
              if (!userRes || !userRes.login) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ valid: false, error: 'Failed to authenticate with GitHub' }));
                return;
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                valid: true,
                user: {
                  login: userRes.login,
                  name: userRes.name || userRes.login,
                  email: userRes.email || null,
                  avatar_url: userRes.avatar_url || null,
                  public_repos: userRes.public_repos || 0
                }
              }));
            } catch (err) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ valid: false, error: err.message }));
            }
            return;
          }

          if (pathname === '/api/setup/save-github' && req.method === 'POST') {
            const body = await this._readBody(req);
            const parsed = safeJsonParse(body, 'save github request');
            // uses server userStore
            userStore.saveGitHubAuth(parsed || {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
          }

          if (pathname === '/api/setup/skip-github' && req.method === 'POST') {
            // uses server userStore
            userStore.clearGitHubAuth();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
          }

          if (pathname === '/api/setup/complete' && req.method === 'POST') {
            const body = await this._readBody(req);
            const parsed = safeJsonParse(body, 'complete setup request');
            // uses server userStore
            userStore.completeSetup(parsed || {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
          }

          if (pathname === '/api/setup/reset' && req.method === 'POST') {
            // uses server userStore
            userStore.resetSetup();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
          }

          if (pathname === '/api/setup/start-oauth' && req.method === 'POST') {
            // uses server userStore
            const ghConfig = userStore.getGitHubConfig();
            const auth = new GitHubAuth({ clientId: ghConfig.clientId });
            const crypto = require('node:crypto');
            const pkce = GitHubAuth.generatePkce();
            const state = crypto.randomUUID();
            const redirectUri = `http://127.0.0.1:${this.port}/oauth/callback`;
            const authUrl = auth.getAuthorizationUrl({
              redirectUri,
              state,
              scope: 'repo,read:user,user:email',
              codeChallenge: pkce.challenge,
              codeChallengeMethod: pkce.method
            });

            this.pendingOAuth.set(state, {
              verifier: pkce.verifier,
              resolve: () => {},
              reject: () => {}
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ authUrl, state }));
            return;
          }

          // 3c. GitHub 1-Click Browser OAuth Callback Receiver
          if (pathname === '/oauth/callback' && req.method === 'GET') {
            const code = url.searchParams.get('code');
            const stateParam = url.searchParams.get('state');
            const errorParam = url.searchParams.get('error');
            const errorDesc = url.searchParams.get('error_description') || errorParam;

            if (errorParam) {
              if (stateParam && this.pendingOAuth.has(stateParam)) {
                const pending = this.pendingOAuth.get(stateParam);
                this.pendingOAuth.delete(stateParam);
                pending.reject(new Error(errorDesc || 'OAuth authorization cancelled'));
              }
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>FrameGit — Cancelled</title><style>body{background:#090a0f;color:#f4f4f6;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;}.box{background:#111318;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px;max-width:420px;}h2{color:#f85149;margin:0 0 10px 0;font-size:20px;}p{color:#8e929f;font-size:13px;}</style></head><body><div class="box"><h2>Authorization Cancelled</h2><p>${escapeHtml(errorDesc || 'The authorization request was cancelled.')}</p></div></body></html>`);
              return;
            }

            if (!code || !stateParam) {
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`Missing code or state parameter`);
              return;
            }

            try {
              // uses server userStore
              const ghConfig = userStore.getGitHubConfig();
              const auth = new GitHubAuth({ clientId: ghConfig.clientId });
              const redirectUri = `http://127.0.0.1:${this.port}/oauth/callback`;
              const pending = this.pendingOAuth.get(stateParam);
              const codeVerifier = pending ? pending.verifier : null;

              const tokenData = await auth.exchangeCodeForToken({
                code,
                redirectUri,
                clientSecret: ghConfig.clientSecret,
                codeVerifier
              });

              const client = new GitHubApiClient({ token: tokenData.accessToken });
              const userRes = await client._request('GET', '/user');
              if (!userRes || !userRes.login) {
                throw new Error('Failed to retrieve user profile from GitHub API');
              }

              userStore.saveGitHubAuth({
                token: tokenData.accessToken,
                username: userRes.login,
                name: userRes.name || userRes.login,
                email: userRes.email || null,
                avatarUrl: userRes.avatar_url || null
              });

              if (this.pendingOAuth.has(stateParam)) {
                const pending = this.pendingOAuth.get(stateParam);
                this.pendingOAuth.delete(stateParam);
                pending.resolve({
                  success: true,
                  user: {
                    login: userRes.login,
                    name: userRes.name || userRes.login,
                    email: userRes.email || null,
                    avatar_url: userRes.avatar_url || null,
                    public_repos: userRes.public_repos || 0
                  }
                });
              }

              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>FrameGit — Authorized</title><style>body{background:#090a0f;color:#f4f4f6;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;}.box{background:#111318;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px;max-width:420px;box-shadow:0 24px 60px rgba(0,0,0,0.5);}.icon{width:52px;height:52px;border-radius:50%;background:rgba(63,185,80,0.15);color:#3fb950;display:inline-flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:20px;}h2{margin:0 0 10px 0;font-size:20px;font-weight:600;}p{color:#8e929f;font-size:13px;line-height:1.5;margin:0;}</style></head><body><div class="box"><div class="icon">✓</div><h2>FrameGit Authorized</h2><p>Your GitHub account has been connected securely. You can close this browser tab and return to the FrameGit Desktop app.</p></div></body></html>`);
              return;
            } catch (err) {
              if (this.pendingOAuth.has(stateParam)) {
                const pending = this.pendingOAuth.get(stateParam);
                this.pendingOAuth.delete(stateParam);
                pending.reject(err);
              }
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>FrameGit — Error</title><style>body{background:#090a0f;color:#f4f4f6;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;}.box{background:#111318;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px;max-width:420px;}h2{color:#f85149;margin:0 0 10px 0;}p{color:#8e929f;font-size:13px;}</style></head><body><div class="box"><h2>Authentication Failed</h2><p>${escapeHtml(err.message)}</p></div></body></html>`);
              return;
            }
          }

          // 4. Visual Diff Rendering
          if (pathname === '/api/desktop/diff/ascii' && req.method === 'GET') {
            const pPath = url.searchParams.get('projectPath');
            if (!pPath || !fs.existsSync(pPath)) {
              res.writeHead(400, { 'Content-Type': 'text/plain' });
              res.end('Invalid or missing projectPath');
              return;
            }

            const engine = this._getEngineForProject(pPath);
            const st = engine.status();
            const ascii = VisualDiff.renderAscii(st.currState || {}, st.changes || []);
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(ascii);
            return;
          }

          if (pathname === '/api/desktop/diff/html' && req.method === 'GET') {
            const pPath = url.searchParams.get('projectPath');
            if (!pPath || !fs.existsSync(pPath)) {
              res.writeHead(400, { 'Content-Type': 'text/plain' });
              res.end('Invalid or missing projectPath');
              return;
            }

            const engine = this._getEngineForProject(pPath);
            const st = engine.status();
            const html = VisualDiff.generateHtmlReport(st.currState || {}, st.changes || [], {
              title: path.basename(pPath),
              outputPath: null
            });
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            return;
          }

          // 5. JSON-RPC API Handlers
          if (pathname === '/api/rpc' && req.method === 'POST') {
            const body = await this._readBody(req);
            const rpcReq = safeJsonParse(body, 'RPC request');
            const result = await this._handleRpc(rpcReq.action, rpcReq.params || {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: rpcReq.id, result, error: null }));
            return;
          }

          // 5b. Project Management & Account Endpoints (Full Parity with Native Electron)
          if (pathname === '/api/desktop/projects/tracked' && req.method === 'GET') {
            // uses server userStore
            const settings = userStore.getSettings();
            const list = (settings.trackedProjects || []).filter(p => fs.existsSync(p));
            const projects = list.map(p => {
              let projectName = path.basename(p);
              let type = 'generic';
              let projectFilePath = p;
              try {
                const files = fs.readdirSync(p);
                const pr = files.find(f => f.endsWith('.prproj'));
                const dr = files.find(f => f.endsWith('.drp'));
                if (pr) { projectName = pr; type = 'premiere'; projectFilePath = path.join(p, pr); }
                else if (dr) { projectName = dr; type = 'resolve'; projectFilePath = path.join(p, dr); }
              } catch (_) {}
              return { path: p, name: projectName, type, projectFilePath };
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(projects));
            return;
          }

          if (pathname === '/api/desktop/project/inspect' && req.method === 'POST') {
            const body = await this._readBody(req);
            const parsed = safeJsonParse(body, 'inspect request');
            const projectPath = parsed.path;
            if (!projectPath || !fs.existsSync(projectPath)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Project directory not found' }));
              return;
            }
            let engine = null;
            try {
              engine = this._getEngineForProject(projectPath);
              const status = engine.status();
              const branches = engine.listBranches();
              const history = engine.log(15);
              const files = fs.readdirSync(projectPath);
              const pr = files.find(f => f.endsWith('.prproj'));
              const dr = files.find(f => f.endsWith('.drp'));
              const projectFilePath = pr ? path.join(projectPath, pr) : (dr ? path.join(projectPath, dr) : projectPath);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: true,
                name: pr || dr || path.basename(projectPath),
                type: pr ? 'premiere' : (dr ? 'resolve' : 'generic'),
                projectFilePath,
                currentBranch: engine.getCurrentBranch() || 'main',
                status,
                branches,
                history
              }));
            } catch (err) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            } finally {
              if (engine) engine.close();
            }
            return;
          }

          if (pathname === '/api/desktop/project/commit' && req.method === 'POST') {
            const body = await this._readBody(req);
            const parsed = safeJsonParse(body, 'commit request');
            const { projectPath, message } = parsed;
            if (!projectPath || !fs.existsSync(projectPath)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Project directory not found' }));
              return;
            }
            let engine = null;
            try {
              engine = this._getEngineForProject(projectPath);
              // uses server userStore
              const auth = userStore.getGitHubAuth();
              const author = auth && auth.user && (auth.user.name || auth.user.username) ? {
                name: auth.user.name || auth.user.username,
                email: auth.user.email || `${auth.user.username || 'editor'}@users.noreply.github.com`
              } : null;
              const commitRes = await engine.commit(message || 'Timeline checkpoint', author);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, commit: commitRes }));
            } catch (err) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            } finally {
              if (engine) engine.close();
            }
            return;
          }

          if (pathname === '/api/desktop/project/diff' && req.method === 'POST') {
            const body = await this._readBody(req);
            const parsed = safeJsonParse(body, 'diff request');
            const projectPath = parsed.path;
            if (!projectPath || !fs.existsSync(projectPath)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Project directory not found' }));
              return;
            }
            let engine = null;
            try {
              engine = this._getEngineForProject(projectPath);
              const st = engine.status();
              const ascii = VisualDiff.renderAscii(st.currState || {}, st.changes || []);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, ascii, changeCount: st.changes ? st.changes.length : 0 }));
            } catch (err) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            } finally {
              if (engine) engine.close();
            }
            return;
          }

          if (pathname === '/api/desktop/project/remove' && req.method === 'POST') {
            const body = await this._readBody(req);
            const parsed = safeJsonParse(body, 'remove project request');
            userStore.removeTrackedProject(parsed.path);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
          }

          if (pathname === '/api/desktop/project/restore' && req.method === 'POST') {
            const body = await this._readBody(req);
            const parsed = safeJsonParse(body, 'restore checkpoint request');
            const { projectPath, commitHash, force } = parsed;
            if (!projectPath || !fs.existsSync(projectPath)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Project directory not found' }));
              return;
            }
            let engine = null;
            try {
              engine = this._getEngineForProject(projectPath);
              engine.rollback(commitHash, force || false);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, commitHash }));
            } catch (err) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            } finally {
              if (engine) engine.close();
            }
            return;
          }

          if (pathname === '/api/desktop/branch/create' && req.method === 'POST') {
            const body = await this._readBody(req);
            const parsed = safeJsonParse(body, 'create branch request');
            const { projectPath, branchName } = parsed;
            if (!projectPath || !fs.existsSync(projectPath)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Project directory not found' }));
              return;
            }
            let engine = null;
            try {
              engine = this._getEngineForProject(projectPath);
              engine.createBranch(branchName);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, name: branchName }));
            } catch (err) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            } finally {
              if (engine) engine.close();
            }
            return;
          }

          if (pathname === '/api/desktop/branch/switch' && req.method === 'POST') {
            const body = await this._readBody(req);
            const parsed = safeJsonParse(body, 'switch branch request');
            const { projectPath, branchName, force } = parsed;
            if (!projectPath || !fs.existsSync(projectPath)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Project directory not found' }));
              return;
            }
            let engine = null;
            try {
              engine = this._getEngineForProject(projectPath);
              const result = engine.switchBranch(branchName, force || false);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, branch: branchName, commitHash: result.commitHash }));
            } catch (err) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            } finally {
              if (engine) engine.close();
            }
            return;
          }

          if (pathname === '/api/desktop/project/remote-info' && req.method === 'POST') {
            const body = await this._readBody(req);
            const parsed = safeJsonParse(body, 'remote info request');
            const projectPath = parsed.projectPath;
            if (!projectPath || !fs.existsSync(projectPath)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Project directory not found' }));
              return;
            }
            let engine = null;
            try {
              engine = this._getEngineForProject(projectPath);
              const auth = userStore.getGitHubAuth();
              const ghSync = new GitHubSync(engine, { token: auth && auth.token ? auth.token : null });
              const currentBranch = engine.getCurrentBranch() || 'main';
              const remoteStatus = await ghSync.getRemoteStatus(currentBranch);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: true,
                isLinked: remoteStatus.isLinked,
                repoFullName: remoteStatus.repoFullName,
                currentBranch,
                ahead: remoteStatus.ahead || 0,
                behind: remoteStatus.behind || 0,
                remoteSha: remoteStatus.remoteSha,
                hasAuth: Boolean(auth && auth.hasToken),
                username: auth && auth.user ? auth.user.username : null
              }));
            } catch (err) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            } finally {
              if (engine) engine.close();
            }
            return;
          }

          if (pathname === '/api/desktop/project/publish-github' && req.method === 'POST') {
            const body = await this._readBody(req);
            const parsed = safeJsonParse(body, 'publish github request');
            const { projectPath, repoName, isPrivate } = parsed;
            if (!projectPath || !fs.existsSync(projectPath)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Project directory not found' }));
              return;
            }
            const auth = userStore.getGitHubAuth();
            if (!auth || !auth.hasToken || !auth.token) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'GitHub account not connected. Please connect your GitHub account in Setup.' }));
              return;
            }
            let engine = null;
            try {
              engine = this._getEngineForProject(projectPath);
              const client = new GitHubApiClient({ token: auth.token });
              const targetRepoName = (repoName || path.basename(projectPath)).replace(/[^a-zA-Z0-9_\-\.]/g, '-');
              const userRes = await client._request('GET', '/user');
              const owner = userRes.login;
              const fullRepoName = `${owner}/${targetRepoName}`;

              let repo = await client.getRepo(fullRepoName);
              if (!repo) {
                repo = await client.createRepo({ name: targetRepoName, isPrivate: isPrivate !== false });
              }

              const ghSync = new GitHubSync(engine, { token: auth.token });
              await ghSync.linkRepository(auth.token, fullRepoName);
              const currentBranch = engine.getCurrentBranch() || 'main';
              const pushRes = await ghSync.syncBranchToGitHub(currentBranch);

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: true,
                repoFullName: fullRepoName,
                url: `https://github.com/${fullRepoName}`,
                gitSha: pushRes.gitSha,
                filesPushed: pushRes.filesPushed
              }));
            } catch (err) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            } finally {
              if (engine) engine.close();
            }
            return;
          }

          if (pathname === '/api/desktop/project/push' && req.method === 'POST') {
            const body = await this._readBody(req);
            const parsed = safeJsonParse(body, 'push request');
            const { projectPath } = parsed;
            if (!projectPath || !fs.existsSync(projectPath)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Project directory not found' }));
              return;
            }
            const auth = userStore.getGitHubAuth();
            let engine = null;
            try {
              engine = this._getEngineForProject(projectPath);
              const currentBranch = engine.getCurrentBranch() || 'main';
              let pushRes = null;
              if (auth && auth.token) {
                const ghSync = new GitHubSync(engine, { token: auth.token });
                const linked = ghSync.getLinkedRepo();
                if (linked) {
                  pushRes = await ghSync.syncBranchToGitHub(currentBranch);
                }
              }
              if (!pushRes) {
                const cloudClient = new CloudClient(engine.config.cloud);
                const syncEngine = new SyncEngine(projectPath, cloudClient, engine.db);
                pushRes = await syncEngine.push(currentBranch);
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, result: pushRes }));
            } catch (err) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            } finally {
              if (engine) engine.close();
            }
            return;
          }

          if (pathname === '/api/desktop/project/pull' && req.method === 'POST') {
            const body = await this._readBody(req);
            const parsed = safeJsonParse(body, 'pull request');
            const { projectPath } = parsed;
            if (!projectPath || !fs.existsSync(projectPath)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Project directory not found' }));
              return;
            }
            let engine = null;
            try {
              engine = this._getEngineForProject(projectPath);
              const currentBranch = engine.getCurrentBranch() || 'main';
              const auth = userStore.getGitHubAuth();
              if (auth && auth.token) {
                const ghSync = new GitHubSync(engine, { token: auth.token });
                const st = await ghSync.getRemoteStatus(currentBranch);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Up to date with remote', remoteStatus: st }));
              } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Up to date' }));
              }
            } catch (err) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            } finally {
              if (engine) engine.close();
            }
            return;
          }

          if (pathname === '/api/desktop/project/fetch' && req.method === 'POST') {
            const body = await this._readBody(req);
            const parsed = safeJsonParse(body, 'fetch request');
            const { projectPath } = parsed;
            if (!projectPath || !fs.existsSync(projectPath)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Project directory not found' }));
              return;
            }
            let engine = null;
            try {
              engine = this._getEngineForProject(projectPath);
              const currentBranch = engine.getCurrentBranch() || 'main';
              const auth = userStore.getGitHubAuth();
              if (auth && auth.token) {
                const ghSync = new GitHubSync(engine, { token: auth.token });
                const remoteStatus = await ghSync.getRemoteStatus(currentBranch);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, remoteStatus }));
              } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, remoteStatus: { isLinked: false, ahead: 0, behind: 0 } }));
              }
            } catch (err) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            } finally {
              if (engine) engine.close();
            }
            return;
          }

          if (pathname === '/api/desktop/project/sync' && req.method === 'POST') {
            const body = await this._readBody(req);
            const parsed = safeJsonParse(body, 'sync request');
            const { projectPath } = parsed;
            if (!projectPath || !fs.existsSync(projectPath)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Project directory not found' }));
              return;
            }
            let engine = null;
            try {
              engine = this._getEngineForProject(projectPath);
              const currentBranch = engine.getCurrentBranch() || 'main';
              const auth = userStore.getGitHubAuth();
              let pushRes = null;
              if (auth && auth.token) {
                const ghSync = new GitHubSync(engine, { token: auth.token });
                const linked = ghSync.getLinkedRepo();
                if (linked) {
                  pushRes = await ghSync.syncBranchToGitHub(currentBranch);
                }
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, message: 'Synchronized with remote', result: pushRes }));
            } catch (err) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            } finally {
              if (engine) engine.close();
            }
            return;
          }

          if (pathname === '/api/desktop/project/discard' && req.method === 'POST') {
            const body = await this._readBody(req);
            const parsed = safeJsonParse(body, 'discard request');
            const { projectPath } = parsed;
            if (!projectPath || !fs.existsSync(projectPath)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Project directory not found' }));
              return;
            }
            let engine = null;
            try {
              engine = this._getEngineForProject(projectPath);
              const headHash = engine.getHeadCommitHash();
              if (headHash) {
                engine.rollback(headHash, true);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, headHash }));
              } else {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'No previous checkpoint to discard back to' }));
              }
            } catch (err) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            } finally {
              if (engine) engine.close();
            }
            return;
          }

          if (pathname === '/api/desktop/plugins/ensure-installed' && req.method === 'POST') {
            const results = this._ensureCreativeIntegrations();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, premiere: results.premiere, resolve: results.resolve, results }));
            return;
          }

          if (pathname === '/api/desktop/shell/reveal' && req.method === 'POST') {
            const body = await this._readBody(req);
            const parsed = safeJsonParse(body, 'shell reveal request');
            const targetPath = parsed.path;
            if (targetPath && fs.existsSync(targetPath)) {
              const { exec } = require('node:child_process');
              if (process.platform === 'win32') {
                exec(`explorer.exe /select,"${targetPath.replace(/"/g, '\\"')}"`);
              } else if (process.platform === 'darwin') {
                exec(`open -R "${targetPath.replace(/"/g, '\\"')}"`);
              } else {
                exec(`xdg-open "${path.dirname(targetPath).replace(/"/g, '\\"')}"`);
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Path not found' }));
            }
            return;
          }

          if (pathname === '/api/desktop/shell/open' && req.method === 'POST') {
            const body = await this._readBody(req);
            const parsed = safeJsonParse(body, 'shell open request');
            const targetPath = parsed.path;
            if (targetPath && fs.existsSync(targetPath)) {
              const { exec } = require('node:child_process');
              if (process.platform === 'win32') {
                exec(`start "" "${targetPath.replace(/"/g, '\\"')}"`);
              } else if (process.platform === 'darwin') {
                exec(`open "${targetPath.replace(/"/g, '\\"')}"`);
              } else {
                exec(`xdg-open "${targetPath.replace(/"/g, '\\"')}"`);
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Path not found' }));
            }
            return;
          }

          if (pathname === '/api/auth/sign-out' && req.method === 'POST') {
            // uses server userStore
            userStore.clearGitHubAuth();
            userStore.resetSetup();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
          }

          if (pathname === '/api/auth/refresh-profile' && req.method === 'GET') {
            // uses server userStore
            const auth = userStore.getGitHubAuth();
            if (!auth || !auth.hasToken || !auth.token) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ authenticated: false, offline: false, user: null }));
              return;
            }
            try {
              const client = new GitHubApiClient({ token: auth.token });
              const userRes = await client._request('GET', '/user');
              if (userRes && userRes.login) {
                const updated = {
                  login: userRes.login,
                  username: userRes.login,
                  name: userRes.name || userRes.login,
                  email: userRes.email || null,
                  avatar_url: userRes.avatar_url || null,
                  public_repos: userRes.public_repos || 0
                };
                userStore.saveGitHubAuth({
                  token: auth.token,
                  username: userRes.login,
                  name: userRes.name || userRes.login,
                  email: userRes.email || null,
                  avatarUrl: userRes.avatar_url || null
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ authenticated: true, offline: false, user: updated }));
                return;
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ authenticated: false, offline: false, error: 'Invalid user response' }));
            } catch (err) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                authenticated: true,
                offline: true,
                user: auth.user,
                error: err.message
              }));
            }
            return;
          }

          if (pathname === '/api/auth/sync-git' && req.method === 'POST') {
            // uses server userStore
            const auth = userStore.getGitHubAuth();
            if (!auth || !auth.user || (!auth.user.username && !auth.user.login)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'No user authenticated' }));
              return;
            }
            const { execSync } = require('node:child_process');
            try {
              const uname = auth.user.username || auth.user.login;
              const name = auth.user.name || uname;
              const email = auth.user.email || `${uname}@users.noreply.github.com`;
              execSync(`git config --global user.name "${name.replace(/"/g, '\\"')}"`);
              execSync(`git config --global user.email "${email.replace(/"/g, '\\"')}"`);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, name, email }));
            } catch (err) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
            return;
          }

          // 6. Static UI Assets
          let filePath = path.join(this.staticDir, pathname === '/' ? 'index.html' : pathname);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath);
            const mimeTypes = {
              '.html': 'text/html',
              '.css': 'text/css',
              '.js': 'application/javascript',
              '.svg': 'image/svg+xml',
              '.png': 'image/png'
            };
            res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
            fs.createReadStream(filePath).pipe(res);
            return;
          }

          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Endpoint not found' }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: err.message } }));
        }
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        const addr = this.server.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
        }
        resolve(this.port);
      });

      this.server.on('error', err => {
        if (err.code === 'EADDRINUSE') {
          // If port in use, assume already running daemon and resolve
          resolve(this.port);
        } else {
          reject(err);
        }
      });
    });
  }

  stop() {
    this.processMonitor.stop();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  _resolveProjectPath(params) {
    if (params && params.projectPath) {
      const p = params.projectPath;
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        return path.dirname(p);
      }
      return p;
    }
    const settings = this.userStore.getSettings();
    const tracked = (settings.trackedProjects || []).filter(p => fs.existsSync(p));
    if (tracked.length > 0) {
      return tracked[0];
    }
    return process.cwd();
  }

  _getEngineForProject(projectPath) {
    let dir = projectPath;
    let prj = 'project.prproj';
    if (fs.existsSync(projectPath) && fs.statSync(projectPath).isFile()) {
      dir = path.dirname(projectPath);
      prj = path.basename(projectPath);
    } else {
      const files = fs.readdirSync(projectPath);
      prj = files.find(f => f.endsWith('.prproj') || f.endsWith('.drp')) || 'project.prproj';
    }
    const engine = new VersionEngine(dir, prj);
    const dbPath = path.join(dir, '.framegit', 'state.db');
    if (!fs.existsSync(dbPath)) {
      engine.init();
    } else {
      engine.open();
    }
    return engine;
  }

  async _handleRpc(action, params = {}) {
    const projectPath = this._resolveProjectPath(params);
    let engine = null;
    try {
      engine = this._getEngineForProject(projectPath);

      switch (action) {
        case 'project.status':
        case 'project.details': {
          const st = engine.status();
          const branches = engine.listBranches();
          const history = engine.getHistory(null, 15);
          return {
            projectPath,
            projectName: path.basename(projectPath),
            status: st,
            hasChanges: st.hasChanges,
            changes: st.changes,
            branches,
            history,
            currentBranch: engine.getCurrentBranch() || 'main'
          };
        }

        case 'project.commit': {
          const auth = this.userStore.getGitHubAuth();
          const author = auth && auth.user && (auth.user.name || auth.user.username) ? {
            name: auth.user.name || auth.user.username,
            email: auth.user.email || `${auth.user.username || 'editor'}@users.noreply.github.com`
          } : null;
          const res = await engine.commit(params.message || 'Timeline checkpoint', author);
          this.projectCatalog.register(projectPath, {
            headCommit: res.commitHash,
            lastMessage: params.message,
            currentBranch: res.branch
          });
          return res;
        }

        case 'project.history': {
          const limit = params.limit || 15;
          return engine.getHistory(params.branchName || null, limit);
        }

        case 'branch.list': {
          return engine.listBranches();
        }

        case 'branch.switch': {
          const targetBranch = params.name || params.branchName;
          const res = engine.switchBranch(targetBranch, params.force || false);
          this.projectCatalog.register(projectPath, { currentBranch: targetBranch });
          return res;
        }

        case 'branch.create': {
          const branchName = params.name || params.branchName;
          engine.createBranch(branchName, params.startCommit || null);
          return { created: true, name: branchName };
        }

        case 'project.restore': {
          engine.rollback(params.commitHash, params.force || false);
          return { restored: true, commitHash: params.commitHash };
        }

        case 'project.diff': {
          const st = engine.status();
          const ascii = VisualDiff.renderAscii(st.currState || {}, st.changes || []);
          return { ascii, changes: st.changes || [], changeCount: st.changes ? st.changes.length : 0 };
        }

        case 'project.discard': {
          const headHash = engine.getHeadCommitHash();
          if (headHash) {
            engine.rollback(headHash, true);
            return { discarded: true, headHash };
          }
          return { discarded: false, error: 'No previous checkpoint to restore' };
        }

        case 'project.track': {
          this.userStore.addTrackedProject(projectPath);
          return { tracked: true, projectPath };
        }

        case 'sync.push': {
          const auth = this.userStore.getGitHubAuth();
          let gitRes = null;
          if (auth && auth.token) {
            const ghSync = new GitHubSync(engine, { token: auth.token });
            const linked = ghSync.getLinkedRepo();
            if (linked) {
              const currentBranch = engine.getCurrentBranch() || 'main';
              gitRes = await ghSync.syncBranchToGitHub(currentBranch);
            }
          }
          return gitRes || { pushed: true, message: 'Changes pushed' };
        }

        case 'sync.pull': {
          const auth = this.userStore.getGitHubAuth();
          if (auth && auth.token) {
            const ghSync = new GitHubSync(engine, { token: auth.token });
            const st = await ghSync.getRemoteStatus(engine.getCurrentBranch() || 'main');
            return { pulled: true, remoteStatus: st };
          }
          return { pulled: true, message: 'Already up to date' };
        }

        case 'sync.fetch': {
          const auth = this.userStore.getGitHubAuth();
          if (auth && auth.token) {
            const ghSync = new GitHubSync(engine, { token: auth.token });
            return await ghSync.getRemoteStatus(engine.getCurrentBranch() || 'main');
          }
          return { isLinked: false, ahead: 0, behind: 0 };
        }

        case 'sync.sync': {
          const auth = this.userStore.getGitHubAuth();
          let gitRes = null;
          if (auth && auth.token) {
            const ghSync = new GitHubSync(engine, { token: auth.token });
            const linked = ghSync.getLinkedRepo();
            if (linked) {
              const currentBranch = engine.getCurrentBranch() || 'main';
              gitRes = await ghSync.syncBranchToGitHub(currentBranch);
            }
          }
          return { synced: true, result: gitRes };
        }

        default:
          throw new Error(`Unknown desktop RPC action: ${action}`);
      }
    } finally {
      if (engine) engine.close();
    }
  }

  _readBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }
}

// Standalone executable entry
async function main() {
  const server = new DesktopServer(41793);
  await server.start();
  console.log(`FrameGit Desktop running at http://127.0.0.1:41793/`);

  // If running inside Electron, launch BrowserWindow and register IPC bridge
  if (process.versions.electron) {
    try {
      const electron = require('electron');
      const { app, BrowserWindow, Tray, Menu, ipcMain, shell } = electron;

      function registerIpcHandlers(server) {
        const userStore = server.userStore || getDefaultUserStore();
        const nleDetector = new NleDetector();

        ipcMain.handle('setup:getStatus', async () => {
          const settings = userStore.getSettings();
          const auth = userStore.getGitHubAuth();
          return {
            isSetupCompleted: userStore.isSetupCompleted(),
            settings,
            auth: {
              hasToken: auth.hasToken,
              user: auth.user
            }
          };
        });

        ipcMain.handle('github:verifyToken', async (event, token) => {
          const cleanToken = (token || '').trim();
          if (!cleanToken) return { valid: false, error: 'Token is required' };
          try {
            const client = new GitHubApiClient({ token: cleanToken });
            const userRes = await client._request('GET', '/user');
            if (!userRes || !userRes.login) {
              return { valid: false, error: 'Invalid response from GitHub API' };
            }
            return {
              valid: true,
              user: {
                login: userRes.login,
                name: userRes.name || userRes.login,
                email: userRes.email || null,
                avatar_url: userRes.avatar_url || null,
                public_repos: userRes.public_repos || 0
              }
            };
          } catch (err) {
            return { valid: false, error: err.message };
          }
        });

        ipcMain.handle('github:saveConfig', async (event, config) => {
          userStore.saveGitHubAuth(config || {});
          return { success: true };
        });

        let activeOAuthSession = null;

        ipcMain.handle('github:startOAuth', async (event, options) => {
          try {
            const auth = new GitHubAuth(options || {});
            const deviceData = await auth.requestDeviceCode('repo,read:user');
            const abortController = new AbortController();

            activeOAuthSession = {
              auth,
              deviceData,
              abortController,
              cancelled: false
            };

            if (deviceData.verificationUri) {
              shell.openExternal(deviceData.verificationUri).catch(() => {});
            }

            return {
              started: true,
              userCode: deviceData.userCode,
              verificationUri: deviceData.verificationUri,
              expiresIn: deviceData.expiresIn
            };
          } catch (err) {
            return {
              started: false,
              error: err.message,
              fallbackToToken: true
            };
          }
        });

        ipcMain.handle('github:waitForOAuth', async () => {
          if (!activeOAuthSession) {
            return { success: false, error: 'No active OAuth session' };
          }
          const session = activeOAuthSession;
          try {
            const tokenResult = await session.auth.pollForToken(
              session.deviceData.deviceCode,
              session.deviceData.interval,
              session.deviceData.expiresIn,
              null,
              session.abortController.signal
            );

            if (tokenResult.cancelled || session.cancelled) {
              return { success: false, cancelled: true };
            }

            if (!tokenResult.accessToken) {
              return { success: false, error: 'Failed to obtain access token' };
            }

            const client = new GitHubApiClient({ token: tokenResult.accessToken });
            const userRes = await client._request('GET', '/user');
            if (!userRes || !userRes.login) {
              return { success: false, error: 'Failed to retrieve GitHub user profile' };
            }

            userStore.saveGitHubAuth({
              token: tokenResult.accessToken,
              username: userRes.login,
              name: userRes.name || userRes.login,
              email: userRes.email || null,
              avatarUrl: userRes.avatar_url || null
            });

            activeOAuthSession = null;
            return {
              success: true,
              user: {
                login: userRes.login,
                name: userRes.name || userRes.login,
                email: userRes.email || null,
                avatar_url: userRes.avatar_url || null,
                public_repos: userRes.public_repos || 0
              }
            };
          } catch (err) {
            if (session.cancelled) {
              return { success: false, cancelled: true };
            }
            return { success: false, error: err.message };
          }
        });

        ipcMain.handle('github:cancelOAuth', async () => {
          if (activeOAuthSession) {
            activeOAuthSession.cancelled = true;
            if (activeOAuthSession.abortController) {
              activeOAuthSession.abortController.abort();
            }
            activeOAuthSession = null;
          }
          return { success: true };
        });

        ipcMain.handle('clipboard:writeText', async (event, text) => {
          const { clipboard } = require('electron');
          clipboard.writeText(text || '');
          return { success: true };
        });

        ipcMain.handle('github:skipConfig', async () => {
          userStore.clearGitHubAuth();
          return { success: true };
        });

        ipcMain.handle('nle:detect', async () => {
          return nleDetector.detectAll();
        });

        ipcMain.handle('nle:installPlugin', async (event, family) => {
          try {
            if (family === 'premiere') {
              const res = nleDetector.installPremierePlugin();
              const cur = userStore.getSettings().plugins || {};
              userStore.updateSettings({ plugins: { ...cur, premiere: true } });
              return { success: true, message: 'Adobe Premiere Pro UXP plugin installed successfully', details: res };
            } else if (family === 'resolve') {
              const res = nleDetector.installResolveScript();
              const cur = userStore.getSettings().plugins || {};
              userStore.updateSettings({ plugins: { ...cur, resolve: true } });
              return { success: true, message: 'DaVinci Resolve scripting bridge installed successfully', details: res };
            } else {
              return { success: false, error: `Unsupported editor family: ${family}` };
            }
          } catch (err) {
            return { success: false, error: err.message };
          }
        });

        ipcMain.handle('service:configureStartup', async (event, enable) => {
          const ok = ProcessMonitor.configureWindowsStartup(enable !== false);
          userStore.updateSettings({ autoStartBackgroundService: enable !== false });
          return { success: ok };
        });

        ipcMain.handle('setup:complete', async (event, options) => {
          userStore.completeSetup(options || {});
          return { success: true };
        });

        ipcMain.handle('setup:reset', async () => {
          userStore.resetSetup();
          return { success: true };
        });

        ipcMain.handle('shell:openExternal', async (event, url) => {
          if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
            await shell.openExternal(url);
            return { success: true };
          }
          return { success: false, error: 'Invalid URL' };
        });

        // 1-Click Official Browser OAuth Handlers
        let activeBrowserOAuth = null;

        ipcMain.handle('github:startBrowserOAuth', async () => {
          const ghConfig = userStore.getGitHubConfig();
          const auth = new GitHubAuth({ clientId: ghConfig.clientId });
          const crypto = require('node:crypto');
          const pkce = GitHubAuth.generatePkce();
          const state = crypto.randomUUID();
          const redirectUri = `http://127.0.0.1:${server.port}/oauth/callback`;
          const authUrl = auth.getAuthorizationUrl({
            redirectUri,
            state,
            scope: 'repo,read:user,user:email',
            codeChallenge: pkce.challenge,
            codeChallengeMethod: pkce.method
          });

          let resolveCb, rejectCb;
          const resultPromise = new Promise((resolve, reject) => {
            resolveCb = resolve;
            rejectCb = reject;
          });

          const timer = setTimeout(() => {
            server.pendingOAuth.delete(state);
            rejectCb(new Error('Browser authorization timed out (5 minutes).'));
          }, 300000);

          server.pendingOAuth.set(state, {
            verifier: pkce.verifier,
            resolve: (res) => { clearTimeout(timer); resolveCb(res); },
            reject: (err) => { clearTimeout(timer); rejectCb(err); }
          });

          activeBrowserOAuth = { state, resultPromise };

          await shell.openExternal(authUrl);

          return { started: true, state, authUrl };
        });

        ipcMain.handle('github:waitForBrowserOAuth', async (event, state) => {
          if (!activeBrowserOAuth || (state && activeBrowserOAuth.state !== state)) {
            return { success: false, error: 'No active browser OAuth session' };
          }
          try {
            const res = await activeBrowserOAuth.resultPromise;
            activeBrowserOAuth = null;
            return res;
          } catch (err) {
            activeBrowserOAuth = null;
            return { success: false, error: err.message };
          }
        });

        ipcMain.handle('github:cancelBrowserOAuth', async (event, state) => {
          if (activeBrowserOAuth) {
            const st = state || activeBrowserOAuth.state;
            if (server.pendingOAuth.has(st)) {
              const pending = server.pendingOAuth.get(st);
              server.pendingOAuth.delete(st);
              pending.reject(new Error('Cancelled by user'));
            }
            activeBrowserOAuth = null;
          }
          return { success: true };
        });

        ipcMain.handle('github:getOAuthConfig', async () => {
          return userStore.getGitHubConfig();
        });

        ipcMain.handle('github:setOAuthConfig', async (event, config) => {
          return userStore.setGitHubConfig(config || {});
        });

        // Account & Session Lifecycle Handlers
        ipcMain.handle('auth:signOut', async () => {
          userStore.clearGitHubAuth();
          userStore.resetSetup();
          return { success: true };
        });

        ipcMain.handle('auth:refreshProfile', async () => {
          const auth = userStore.getGitHubAuth();
          if (!auth || !auth.hasToken || !auth.token) {
            return { authenticated: false, offline: false, user: null };
          }
          try {
            const client = new GitHubApiClient({ token: auth.token });
            const userRes = await client._request('GET', '/user');
            if (userRes && userRes.login) {
              const updated = {
                login: userRes.login,
                name: userRes.name || userRes.login,
                email: userRes.email || null,
                avatar_url: userRes.avatar_url || null,
                public_repos: userRes.public_repos || 0
              };
              userStore.saveGitHubAuth({
                token: auth.token,
                username: userRes.login,
                name: userRes.name || userRes.login,
                email: userRes.email || null,
                avatarUrl: userRes.avatar_url || null
              });
              return { authenticated: true, offline: false, user: updated };
            }
            return { authenticated: false, offline: false, error: 'Invalid user response' };
          } catch (err) {
            return {
              authenticated: true,
              offline: true,
              user: auth.user,
              error: err.message
            };
          }
        });

        ipcMain.handle('auth:syncGitConfig', async () => {
          const auth = userStore.getGitHubAuth();
          if (!auth || !auth.user || !auth.user.username) {
            return { success: false, error: 'No user authenticated' };
          }
          const { execSync } = require('node:child_process');
          try {
            const name = auth.user.name || auth.user.username;
            const email = auth.user.email || `${auth.user.username}@users.noreply.github.com`;
            execSync(`git config --global user.name "${name.replace(/"/g, '\\"')}"`);
            execSync(`git config --global user.email "${email.replace(/"/g, '\\"')}"`);
            return { success: true, name, email };
          } catch (err) {
            return { success: false, error: err.message };
          }
        });

        // Project Management & Tracking Handlers
        ipcMain.handle('project:pickDirectory', async () => {
          const { dialog } = require('electron');
          const res = await dialog.showOpenDialog({
            title: 'Open Video Editing Project or Folder',
            properties: ['openFile', 'openDirectory'],
            filters: [
              { name: 'Video Editing Projects (*.prproj, *.drp)', extensions: ['prproj', 'drp'] },
              { name: 'All Files', extensions: ['*'] }
            ]
          });
          if (res.canceled || !res.filePaths.length) {
            return { canceled: true };
          }
          const selectedPath = res.filePaths[0];
          const isDir = fs.statSync(selectedPath).isDirectory();
          const projectDir = isDir ? selectedPath : path.dirname(selectedPath);
          userStore.addTrackedProject(projectDir);
          return { canceled: false, path: projectDir, filePath: isDir ? null : selectedPath };
        });

        ipcMain.handle('project:getTracked', async () => {
          const settings = userStore.getSettings();
          const list = (settings.trackedProjects || []).filter(p => fs.existsSync(p));
          return list.map(p => {
            let projectName = path.basename(p);
            let type = 'generic';
            let projectFilePath = p;
            try {
              const files = fs.readdirSync(p);
              const pr = files.find(f => f.endsWith('.prproj'));
              const dr = files.find(f => f.endsWith('.drp'));
              if (pr) {
                projectName = pr;
                type = 'premiere';
                projectFilePath = path.join(p, pr);
              } else if (dr) {
                projectName = dr;
                type = 'resolve';
                projectFilePath = path.join(p, dr);
              }
            } catch (_) {}
            return {
              path: p,
              projectFilePath,
              name: projectName,
              type
            };
          });
        });

        ipcMain.handle('project:removeTracked', async (event, projectPath) => {
          userStore.removeTrackedProject(projectPath);
          return { success: true };
        });

        ipcMain.handle('project:restore', async (event, { projectPath, commitHash, force }) => {
          if (!projectPath || !fs.existsSync(projectPath)) {
            return { success: false, error: 'Project directory not found' };
          }
          let engine = null;
          try {
            engine = server._getEngineForProject(projectPath);
            engine.rollback(commitHash, force || false);
            return { success: true, commitHash };
          } catch (err) {
            return { success: false, error: err.message };
          } finally {
            if (engine) engine.close();
          }
        });

        ipcMain.handle('shell:showItemInFolder', async (event, targetPath) => {
          if (targetPath && fs.existsSync(targetPath)) {
            shell.showItemInFolder(targetPath);
            return { success: true };
          }
          return { success: false, error: 'Path not found' };
        });

        ipcMain.handle('shell:openPath', async (event, targetPath) => {
          if (targetPath && fs.existsSync(targetPath)) {
            const err = await shell.openPath(targetPath);
            if (err) return { success: false, error: err };
            return { success: true };
          }
          return { success: false, error: 'Path not found' };
        });

        ipcMain.handle('project:inspect', async (event, projectPath) => {
          if (!projectPath || !fs.existsSync(projectPath)) {
            return { success: false, error: 'Project directory not found' };
          }
          let engine = null;
          try {
            engine = server._getEngineForProject(projectPath);
            const status = engine.status();
            const branches = engine.listBranches();
            const history = engine.log(15);
            const files = fs.readdirSync(projectPath);
            const pr = files.find(f => f.endsWith('.prproj'));
            const dr = files.find(f => f.endsWith('.drp'));
            const projectFilePath = pr ? path.join(projectPath, pr) : (dr ? path.join(projectPath, dr) : projectPath);
            return {
              success: true,
              name: pr || dr || path.basename(projectPath),
              type: pr ? 'premiere' : (dr ? 'resolve' : 'generic'),
              projectFilePath,
              currentBranch: engine.getCurrentBranch() || 'main',
              status,
              branches,
              history
            };
          } catch (err) {
            return { success: false, error: err.message };
          } finally {
            if (engine) engine.close();
          }
        });

        ipcMain.handle('project:commit', async (event, { projectPath, message }) => {
          if (!projectPath || !fs.existsSync(projectPath)) {
            return { success: false, error: 'Project directory not found' };
          }
          let engine = null;
          try {
            engine = server._getEngineForProject(projectPath);
            const auth = userStore.getGitHubAuth();
            const author = auth && auth.user && (auth.user.name || auth.user.username) ? {
              name: auth.user.name || auth.user.username,
              email: auth.user.email || `${auth.user.username || 'editor'}@users.noreply.github.com`
            } : null;
            const res = await engine.commit(message || 'Timeline checkpoint', author);
            return { success: true, commit: res };
          } catch (err) {
            return { success: false, error: err.message };
          } finally {
            if (engine) engine.close();
          }
        });

        ipcMain.handle('project:switchBranch', async (event, { projectPath, branchName, force }) => {
          let engine = null;
          try {
            engine = server._getEngineForProject(projectPath);
            const res = engine.switchBranch(branchName, force || false);
            return { success: true, result: res };
          } catch (err) {
            return { success: false, error: err.message };
          } finally {
            if (engine) engine.close();
          }
        });

        ipcMain.handle('project:createBranch', async (event, { projectPath, branchName }) => {
          let engine = null;
          try {
            engine = server._getEngineForProject(projectPath);
            engine.createBranch(branchName);
            return { success: true, name: branchName };
          } catch (err) {
            return { success: false, error: err.message };
          } finally {
            if (engine) engine.close();
          }
        });

        ipcMain.handle('project:getDiff', async (event, projectPath) => {
          let engine = null;
          try {
            engine = server._getEngineForProject(projectPath);
            const st = engine.status();
            const ascii = VisualDiff.renderAscii(st.currState || {}, st.changes || []);
            return { success: true, ascii, changeCount: st.changes ? st.changes.length : 0 };
          } catch (err) {
            return { success: false, error: err.message };
          } finally {
            if (engine) engine.close();
          }
        });

        ipcMain.handle('project:getRemoteInfo', async (event, projectPath) => {
          let engine = null;
          try {
            engine = server._getEngineForProject(projectPath);
            const auth = userStore.getGitHubAuth();
            const ghSync = new GitHubSync(engine, { token: auth && auth.token ? auth.token : null });
            const currentBranch = engine.getCurrentBranch() || 'main';
            const remoteStatus = await ghSync.getRemoteStatus(currentBranch);
            return {
              success: true,
              isLinked: remoteStatus.isLinked,
              repoFullName: remoteStatus.repoFullName,
              currentBranch,
              ahead: remoteStatus.ahead || 0,
              behind: remoteStatus.behind || 0,
              remoteSha: remoteStatus.remoteSha,
              hasAuth: Boolean(auth && auth.hasToken),
              username: auth && auth.user ? auth.user.username : null
            };
          } catch (err) {
            return { success: false, error: err.message };
          } finally {
            if (engine) engine.close();
          }
        });

        ipcMain.handle('project:publishGitHub', async (event, { projectPath, repoName, isPrivate }) => {
          const auth = userStore.getGitHubAuth();
          if (!auth || !auth.hasToken || !auth.token) {
            return { success: false, error: 'GitHub account not connected. Please connect in Setup.' };
          }
          let engine = null;
          try {
            engine = server._getEngineForProject(projectPath);
            const client = new GitHubApiClient({ token: auth.token });
            const targetRepoName = (repoName || path.basename(projectPath)).replace(/[^a-zA-Z0-9_\-\.]/g, '-');
            const userRes = await client._request('GET', '/user');
            const owner = userRes.login;
            const fullRepoName = `${owner}/${targetRepoName}`;

            let repo = await client.getRepo(fullRepoName);
            if (!repo) {
              repo = await client.createRepo({ name: targetRepoName, isPrivate: isPrivate !== false });
            }

            const ghSync = new GitHubSync(engine, { token: auth.token });
            await ghSync.linkRepository(auth.token, fullRepoName);
            const currentBranch = engine.getCurrentBranch() || 'main';
            const pushRes = await ghSync.syncBranchToGitHub(currentBranch);

            return {
              success: true,
              repoFullName: fullRepoName,
              url: `https://github.com/${fullRepoName}`,
              gitSha: pushRes.gitSha,
              filesPushed: pushRes.filesPushed
            };
          } catch (err) {
            return { success: false, error: err.message };
          } finally {
            if (engine) engine.close();
          }
        });

        ipcMain.handle('project:push', async (event, projectPath) => {
          const auth = userStore.getGitHubAuth();
          let engine = null;
          try {
            engine = server._getEngineForProject(projectPath);
            const currentBranch = engine.getCurrentBranch() || 'main';
            let pushRes = null;
            if (auth && auth.token) {
              const ghSync = new GitHubSync(engine, { token: auth.token });
              const linked = ghSync.getLinkedRepo();
              if (linked) {
                pushRes = await ghSync.syncBranchToGitHub(currentBranch);
              }
            }
            if (!pushRes) {
              const cloudClient = new CloudClient(engine.config.cloud);
              const syncEngine = new SyncEngine(projectPath, cloudClient, engine.db);
              pushRes = await syncEngine.push(currentBranch);
            }
            return { success: true, result: pushRes };
          } catch (err) {
            return { success: false, error: err.message };
          } finally {
            if (engine) engine.close();
          }
        });

        ipcMain.handle('project:pull', async (event, projectPath) => {
          let engine = null;
          try {
            engine = server._getEngineForProject(projectPath);
            const currentBranch = engine.getCurrentBranch() || 'main';
            const auth = userStore.getGitHubAuth();
            if (auth && auth.token) {
              const ghSync = new GitHubSync(engine, { token: auth.token });
              const st = await ghSync.getRemoteStatus(currentBranch);
              return { success: true, message: 'Up to date with remote', remoteStatus: st };
            }
            return { success: true, message: 'Up to date' };
          } catch (err) {
            return { success: false, error: err.message };
          } finally {
            if (engine) engine.close();
          }
        });

        ipcMain.handle('project:fetch', async (event, projectPath) => {
          let engine = null;
          try {
            engine = server._getEngineForProject(projectPath);
            const currentBranch = engine.getCurrentBranch() || 'main';
            const auth = userStore.getGitHubAuth();
            if (auth && auth.token) {
              const ghSync = new GitHubSync(engine, { token: auth.token });
              const remoteStatus = await ghSync.getRemoteStatus(currentBranch);
              return { success: true, remoteStatus };
            }
            return { success: true, remoteStatus: { isLinked: false, ahead: 0, behind: 0 } };
          } catch (err) {
            return { success: false, error: err.message };
          } finally {
            if (engine) engine.close();
          }
        });

        ipcMain.handle('project:sync', async (event, projectPath) => {
          let engine = null;
          try {
            engine = server._getEngineForProject(projectPath);
            const currentBranch = engine.getCurrentBranch() || 'main';
            const auth = userStore.getGitHubAuth();
            let pushRes = null;
            if (auth && auth.token) {
              const ghSync = new GitHubSync(engine, { token: auth.token });
              const linked = ghSync.getLinkedRepo();
              if (linked) {
                pushRes = await ghSync.syncBranchToGitHub(currentBranch);
              }
            }
            return { success: true, message: 'Synchronized with remote', result: pushRes };
          } catch (err) {
            return { success: false, error: err.message };
          } finally {
            if (engine) engine.close();
          }
        });

        ipcMain.handle('project:discard', async (event, projectPath) => {
          let engine = null;
          try {
            engine = server._getEngineForProject(projectPath);
            const headHash = engine.getHeadCommitHash();
            if (headHash) {
              engine.rollback(headHash, true);
              return { success: true, headHash };
            }
            return { success: false, error: 'No previous checkpoint to discard back to' };
          } catch (err) {
            return { success: false, error: err.message };
          } finally {
            if (engine) engine.close();
          }
        });

        ipcMain.handle('plugin:ensureInstalled', async () => {
          const results = server._ensureCreativeIntegrations();
          return { success: true, results };
        });
      }

      registerIpcHandlers(server);

      app.whenReady().then(() => {
        const win = new BrowserWindow({
          width: 1200,
          height: 800,
          minWidth: 900,
          minHeight: 600,
          title: 'FrameGit Desktop',
          backgroundColor: '#0d1117',
          webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
          }
        });

        win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

        // System Tray
        try {
          const iconPath = path.join(__dirname, '..', 'plugin', 'premiere', 'icons', 'icon-48.png');
          if (fs.existsSync(iconPath)) {
            const { nativeImage } = electron;
            const trayImg = nativeImage.createFromPath(iconPath);
            if (!trayImg.isEmpty()) {
              const tray = new Tray(trayImg);
              const contextMenu = Menu.buildFromTemplate([
                { label: 'Open FrameGit Desktop', click: () => win.show() },
                { type: 'separator' },
                { label: 'Quit', click: () => app.quit() }
              ]);
              tray.setToolTip('FrameGit Desktop');
              tray.setContextMenu(contextMenu);
            }
          }
        } catch (_) {}
      });
    } catch (_) {}
  } else {
    // Launch system default browser
    const { exec } = require('node:child_process');
    const url = 'http://127.0.0.1:41793/';
    if (process.platform === 'win32') {
      exec(`start "" "${url}"`);
    } else if (process.platform === 'darwin') {
      exec(`open "${url}"`);
    } else {
      exec(`xdg-open "${url}"`);
    }
  }
}

if (require.main === module || (process.versions && process.versions.electron && !process.env.FRAMEGIT_TEST_RUN)) {
  main();
}

module.exports = { DesktopServer };
