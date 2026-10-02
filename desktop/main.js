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

class DesktopServer {
  constructor(port = 41793) {
    this.port = port;
    this.server = null;
    this.nleDetector = new NleDetector();
    this.projectCatalog = new ProjectCatalog();
    this.processMonitor = new ProcessMonitor({ intervalMs: 5000 });

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

      function registerIpcHandlers() {
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

        // Project Catalog & Workspace Actions
        ipcMain.handle('projects:list', async () => {
          const catalog = new ProjectCatalog();
          return catalog.list();
        });

        ipcMain.handle('projects:pickFolder', async () => {
          const { dialog } = require('electron');
          const res = await dialog.showOpenDialog({
            title: 'Select Video Editing Project Folder',
            properties: ['openDirectory']
          });
          if (res.canceled || !res.filePaths || res.filePaths.length === 0) {
            return { canceled: true };
          }
          return { canceled: false, path: res.filePaths[0] };
        });

        ipcMain.handle('projects:track', async (event, projectPath, meta) => {
          const cleanPath = path.resolve(projectPath);
          const catalog = new ProjectCatalog();
          const framegitDir = path.join(cleanPath, '.FrameGIT');
          const altDir = path.join(cleanPath, '.framegit');
          if (!fs.existsSync(framegitDir) && !fs.existsSync(altDir)) {
            let files = [];
            try { files = fs.readdirSync(cleanPath); } catch (_) {}
            const prj = files.find(f => f.endsWith('.prproj') || f.endsWith('.drp')) || 'project.prproj';
            const engine = new VersionEngine(cleanPath, prj);
            engine.init();
          }
          const entry = catalog.register(cleanPath, meta || {});
          return { success: true, project: entry };
        });

        ipcMain.handle('projects:getDetails', async (event, projectPath) => {
          const cleanPath = path.resolve(projectPath);
          let files = [];
          try { files = fs.readdirSync(cleanPath); } catch (_) {}
          const prj = files.find(f => f.endsWith('.prproj') || f.endsWith('.drp')) || 'project.prproj';
          const engine = new VersionEngine(cleanPath, prj);
          engine.open();
          const status = engine.status();
          const branches = engine.listBranches();
          const history = engine.log(20);
          return { status, branches, history };
        });

        ipcMain.handle('projects:commit', async (event, projectPath, message) => {
          const cleanPath = path.resolve(projectPath);
          let files = [];
          try { files = fs.readdirSync(cleanPath); } catch (_) {}
          const prj = files.find(f => f.endsWith('.prproj') || f.endsWith('.drp')) || 'project.prproj';
          const engine = new VersionEngine(cleanPath, prj);
          engine.open();
          const res = await engine.commit(message || 'Timeline checkpoint');
          const catalog = new ProjectCatalog();
          catalog.register(cleanPath, {
            headCommit: res.commitHash,
            lastMessage: message,
            currentBranch: res.branch
          });
          return res;
        });

        ipcMain.handle('projects:revert', async (event, projectPath, commitHash, force) => {
          const cleanPath = path.resolve(projectPath);
          let files = [];
          try { files = fs.readdirSync(cleanPath); } catch (_) {}
          const prj = files.find(f => f.endsWith('.prproj') || f.endsWith('.drp')) || 'project.prproj';
          const engine = new VersionEngine(cleanPath, prj);
          engine.open();
          engine.rollback(commitHash, force !== false);
          return { success: true, commitHash };
        });

        ipcMain.handle('projects:createBranch', async (event, projectPath, name) => {
          const cleanPath = path.resolve(projectPath);
          let files = [];
          try { files = fs.readdirSync(cleanPath); } catch (_) {}
          const prj = files.find(f => f.endsWith('.prproj') || f.endsWith('.drp')) || 'project.prproj';
          const engine = new VersionEngine(cleanPath, prj);
          engine.open();
          engine.createBranch(name);
          return { success: true, name };
        });

        ipcMain.handle('projects:switchBranch', async (event, projectPath, name, force) => {
          const cleanPath = path.resolve(projectPath);
          let files = [];
          try { files = fs.readdirSync(cleanPath); } catch (_) {}
          const prj = files.find(f => f.endsWith('.prproj') || f.endsWith('.drp')) || 'project.prproj';
          const engine = new VersionEngine(cleanPath, prj);
          engine.open();
          const res = engine.switchBranch(name, force || false);
          const catalog = new ProjectCatalog();
          catalog.register(cleanPath, { currentBranch: name });
          return res;
        });

        ipcMain.handle('projects:push', async (event, projectPath) => {
          const cleanPath = path.resolve(projectPath);
          let files = [];
          try { files = fs.readdirSync(cleanPath); } catch (_) {}
          const prj = files.find(f => f.endsWith('.prproj') || f.endsWith('.drp')) || 'project.prproj';
          const engine = new VersionEngine(cleanPath, prj);
          engine.open();
          const currentBranch = engine.getCurrentBranch() || 'main';
          if (engine.config && engine.config.cloud) {
            const cloudClient = new CloudClient(engine.config.cloud);
            const syncEngine = new SyncEngine(cleanPath, cloudClient, engine.db);
            return await syncEngine.push(currentBranch);
          }
          return { pushed: true, branch: currentBranch, localOnly: true };
        });

        ipcMain.handle('projects:pull', async (event, projectPath) => {
          const cleanPath = path.resolve(projectPath);
          let files = [];
          try { files = fs.readdirSync(cleanPath); } catch (_) {}
          const prj = files.find(f => f.endsWith('.prproj') || f.endsWith('.drp')) || 'project.prproj';
          const engine = new VersionEngine(cleanPath, prj);
          engine.open();
          const currentBranch = engine.getCurrentBranch() || 'main';
          if (engine.config && engine.config.cloud) {
            const cloudClient = new CloudClient(engine.config.cloud);
            const syncEngine = new SyncEngine(cleanPath, cloudClient, engine.db);
            return await syncEngine.pull(currentBranch);
          }
          return { pulled: true, branch: currentBranch, localOnly: true };
        });

        ipcMain.handle('system:getRunningEditors', async () => {
          const monitor = new ProcessMonitor();
          return monitor.poll();
        });

        ipcMain.handle('shell:openExternal', async (event, url) => {
          if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
            await shell.openExternal(url);
            return { success: true };
          }
          return { success: false, error: 'Invalid URL' };
        });
      }

      registerIpcHandlers();

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
