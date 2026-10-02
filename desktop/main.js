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
const { GitHubApiClient } = require('../core/github_sync');
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
  constructor(port = 41793) {
    this.port = port;
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

  start() {
    return new Promise((resolve, reject) => {
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
            const userStore = getDefaultUserStore();
            userStore.updateSettings({ autoStartBackgroundService: parsed.enable !== false });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: ok }));
            return;
          }

          // 3b. First-Run Setup & Local-First User Store Endpoints
          if (pathname === '/api/setup/status' && req.method === 'GET') {
            const userStore = getDefaultUserStore();
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
            const userStore = getDefaultUserStore();
            userStore.saveGitHubAuth(parsed || {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
          }

          if (pathname === '/api/setup/skip-github' && req.method === 'POST') {
            const userStore = getDefaultUserStore();
            userStore.clearGitHubAuth();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
          }

          if (pathname === '/api/setup/complete' && req.method === 'POST') {
            const body = await this._readBody(req);
            const parsed = safeJsonParse(body, 'complete setup request');
            const userStore = getDefaultUserStore();
            userStore.completeSetup(parsed || {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
          }

          if (pathname === '/api/setup/reset' && req.method === 'POST') {
            const userStore = getDefaultUserStore();
            userStore.resetSetup();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
          }

          if (pathname === '/api/setup/start-oauth' && req.method === 'POST') {
            const userStore = getDefaultUserStore();
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
              const userStore = getDefaultUserStore();
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

  _getEngineForProject(projectPath) {
    const files = fs.readdirSync(projectPath);
    const prj = files.find(f => f.endsWith('.prproj') || f.endsWith('.drp')) || 'project.prproj';
    const engine = new VersionEngine(projectPath, prj);
    engine.open();
    return engine;
  }

  async _handleRpc(action, params) {
    const projectPath = params.projectPath || process.cwd();
    const engine = this._getEngineForProject(projectPath);

    switch (action) {
      case 'project.details': {
        const st = engine.status();
        const branches = engine.listBranches();
        const history = engine.log(15);
        return { status: st, branches, history };
      }

      case 'project.commit': {
        const res = await engine.commit(params.message || 'Desktop checkpoint');
        this.projectCatalog.register(projectPath, {
          headCommit: res.commitHash,
          lastMessage: params.message,
          currentBranch: res.branch
        });
        return res;
      }

      case 'branch.switch': {
        const res = engine.switchBranch(params.name, params.force || false);
        this.projectCatalog.register(projectPath, { currentBranch: params.name });
        return res;
      }

      case 'branch.create': {
        engine.createBranch(params.name);
        return { created: true, name: params.name };
      }

      case 'project.restore': {
        engine.rollback(params.commitHash, params.force || false);
        return { restored: true, commitHash: params.commitHash };
      }

      case 'sync.push': {
        const cloudClient = new CloudClient(engine.config.cloud);
        const syncEngine = new SyncEngine(projectPath, cloudClient, engine.db);
        const currentBranch = engine.getCurrentBranch() || 'main';
        return await syncEngine.push(currentBranch);
      }

      case 'sync.pull': {
        const cloudClient = new CloudClient(engine.config.cloud);
        const syncEngine = new SyncEngine(projectPath, cloudClient, engine.db);
        const currentBranch = engine.getCurrentBranch() || 'main';
        return await syncEngine.pull(currentBranch);
      }

      default:
        throw new Error(`Unknown desktop RPC action: ${action}`);
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
        const userStore = getDefaultUserStore();
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
            const tray = new Tray(iconPath);
            const contextMenu = Menu.buildFromTemplate([
              { label: 'Open FrameGit Desktop', click: () => win.show() },
              { type: 'separator' },
              { label: 'Quit', click: () => app.quit() }
            ]);
            tray.setToolTip('FrameGit Desktop');
            tray.setContextMenu(contextMenu);
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

if (require.main === module) {
  main();
}

module.exports = { DesktopServer };
