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
const { safeJsonParse } = require('../core/errors');

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
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: ok }));
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

  // If running inside Electron, launch BrowserWindow
  if (process.versions.electron) {
    try {
      const electron = require('electron');
      const { app, BrowserWindow, Tray, Menu } = electron;

      app.whenReady().then(() => {
        const win = new BrowserWindow({
          width: 1200,
          height: 800,
          minWidth: 900,
          minHeight: 600,
          title: 'FrameGit Desktop',
          backgroundColor: '#181818',
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
          }
        });

        win.loadURL('http://127.0.0.1:41793/');

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
