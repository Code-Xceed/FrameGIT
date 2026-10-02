/**
 * FrameGit Desktop — Minimalist Application, Onboarding & Workspace Controller
 * Ultra-clean, subtle, dark, local-first.
 */

'use strict';

// 1. Unified API Adapter (Native Electron IPC with HTTP Fallback)
const api = window.framegit || {
  getSetupStatus: async () => (await fetch('/api/setup/status')).json(),
  startGitHubOAuth: async (opts) => (await fetch('/api/setup/start-oauth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts || {})
  })).json(),
  waitForGitHubOAuth: async () => ({ success: false, error: 'Not available in browser mode' }),
  cancelGitHubOAuth: async () => ({ success: true }),
  verifyGitHubToken: async (token) => (await fetch('/api/setup/verify-github', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  })).json(),
  saveGitHubConfig: async (cfg) => (await fetch('/api/setup/save-github', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg)
  })).json(),
  skipGitHubConfig: async () => (await fetch('/api/setup/skip-github', { method: 'POST' })).json(),
  copyToClipboard: async (text) => {
    if (navigator.clipboard) await navigator.clipboard.writeText(text);
    return { success: true };
  },
  detectEditors: async () => (await fetch('/api/desktop/nle-detect')).json(),
  installPlugin: async (family) => (await fetch('/api/desktop/deploy-plugins', { method: 'POST' })).json(),
  configureStartup: async (enable) => (await fetch('/api/desktop/configure-startup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enable })
  })).json(),
  completeSetup: async (opts) => (await fetch('/api/setup/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts || {})
  })).json(),
  resetSetup: async () => (await fetch('/api/setup/reset', { method: 'POST' })).json(),
  openExternal: (url) => { window.open(url, '_blank'); return Promise.resolve({ success: true }); },

  // Project & Version Control Fallbacks
  listProjects: async () => (await fetch('/api/desktop/projects')).json(),
  pickProjectFolder: async () => ({ canceled: true }),
  trackProject: async (path, meta) => (await fetch('/api/desktop/projects/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, meta })
  })).json(),
  getProjectDetails: async (projectPath) => {
    const res = await fetch(`/api/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'project.details', params: { projectPath } })
    });
    const data = await res.json();
    return data.result;
  },
  commitProject: async (projectPath, message) => {
    const res = await fetch(`/api/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'project.commit', params: { projectPath, message } })
    });
    const data = await res.json();
    return data.result;
  },
  revertProject: async (projectPath, commitHash, force) => {
    const res = await fetch(`/api/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'project.restore', params: { projectPath, commitHash, force } })
    });
    const data = await res.json();
    return data.result;
  },
  createBranch: async (projectPath, name) => {
    const res = await fetch(`/api/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'branch.create', params: { projectPath, name } })
    });
    const data = await res.json();
    return data.result;
  },
  switchBranch: async (projectPath, name, force) => {
    const res = await fetch(`/api/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'branch.switch', params: { projectPath, name, force } })
    });
    const data = await res.json();
    return data.result;
  },
  pushProject: async (projectPath) => {
    const res = await fetch(`/api/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync.push', params: { projectPath } })
    });
    const data = await res.json();
    return data.result;
  },
  pullProject: async (projectPath) => {
    const res = await fetch(`/api/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync.pull', params: { projectPath } })
    });
    const data = await res.json();
    return data.result;
  },
  getRunningEditors: async () => (await fetch('/api/desktop/heartbeat')).json()
};

// 2. Application State
const state = {
  isSetupCompleted: false,
  step: 1, // 1: Auth, 2: Editors, 3: Launch
  authMode: 'welcome', // 'welcome' | 'oauth_active' | 'token_input' | 'connected'
  userCode: '',
  verificationUri: '',
  isWaitingOAuth: false,
  user: null,
  editors: [],
  autoStartService: true,

  // Workspace & Project State
  projects: [],
  activeProject: null,
  activeProjectDetails: null,
  runningEditors: [],
  isCommitting: false
};

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function updateHeader(statusText, isOnline = false) {
  const container = $('header-status');
  if (!container) return;
  container.innerHTML = `
    <span class="status-dot ${isOnline ? 'online' : ''}"></span>
    <span>${escapeHtml(statusText)}</span>
  `;
}

// 3. Main Render Router
function render() {
  const app = $('app');
  if (!app) return;

  if (state.isSetupCompleted) {
    renderWorkspace(app);
    return;
  }

  updateHeader(`Setup ${state.step}/3`);

  app.innerHTML = `
    <div class="card">
      ${renderCurrentStepHtml()}
    </div>
  `;

  attachEventListeners();
}

function renderCurrentStepHtml() {
  // Step 1: Authentication
  if (state.step === 1) {
    if (state.authMode === 'welcome') {
      return `
        <div class="brand-mark">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M3 12h6m6 0h6M12 3v6m0 6v6"></path>
          </svg>
        </div>
        <h1 class="card-title">FrameGit</h1>
        <p class="card-subtitle">Version control for video editors.</p>

        <div class="action-stack">
          <button class="btn btn-github" id="btn-start-oauth">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            <span>Connect with GitHub</span>
          </button>
        </div>

        <div class="subtle-links">
          <span class="subtle-link" id="link-use-token">Use Access Token</span>
          <span class="divider-dot">•</span>
          <span class="subtle-link" id="link-offline">Work Offline</span>
        </div>

        <div class="footer-badge">
          <span>🔒 100% local-first on this device</span>
        </div>
      `;
    }

    if (state.authMode === 'oauth_active') {
      return `
        <div class="brand-mark">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M3 12h6m6 0h6M12 3v6m0 6v6"></path>
          </svg>
        </div>
        <h1 class="card-title">Authorize FrameGit</h1>
        <p class="card-subtitle">Confirm this code in your browser tab:</p>

        <div class="code-box">
          <span class="code-value" id="device-code-label">${escapeHtml(state.userCode || '---- ----')}</span>
          <button class="code-copy-btn" id="btn-copy-code">Copy</button>
        </div>

        <div class="auth-pulse-status">
          <span class="pulse-dot"></span>
          <span>Waiting for authorization in browser...</span>
        </div>

        <button class="btn btn-subtle" id="btn-cancel-oauth">Cancel</button>
      `;
    }

    if (state.authMode === 'token_input') {
      return `
        <div class="brand-mark">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
          </svg>
        </div>
        <h1 class="card-title">GitHub Token</h1>
        <p class="card-subtitle">Paste a Personal Access Token (PAT):</p>

        <div class="action-stack">
          <input type="password" class="input-field" id="pat-input" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" />
          <button class="btn btn-primary" id="btn-verify-pat">Connect</button>
          <button class="btn btn-subtle" id="btn-back-welcome">Back</button>
        </div>
      `;
    }

    if (state.authMode === 'connected') {
      const u = state.user || {};
      return `
        <div class="brand-mark" style="background: linear-gradient(135deg, #064e3b, #047857); border-color: rgba(63, 185, 80, 0.4); box-shadow: 0 8px 24px rgba(63, 185, 80, 0.25);">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6ee7b7" stroke-width="2.2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <h1 class="card-title">Connected</h1>
        <p class="card-subtitle">Encrypted locally in your hardware vault.</p>

        <div class="user-card">
          <img class="user-card-avatar" src="${escapeHtml(u.avatar_url || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png')}" alt="Avatar" />
          <div class="user-card-details">
            <div class="user-card-name">${escapeHtml(u.name || u.login || 'Editor')}</div>
            <div class="user-card-login">@${escapeHtml(u.login || 'user')}</div>
          </div>
          <span class="user-card-badge">✓ Verified</span>
        </div>

        <button class="btn btn-primary" id="btn-step1-next">Continue →</button>
      `;
    }
  }

  // Step 2: Creative Editors Auto-Detection
  if (state.step === 2) {
    return `
      <div class="brand-mark">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
          <line x1="7" y1="2" x2="7" y2="22"></line>
          <line x1="17" y1="2" x2="17" y2="22"></line>
          <line x1="2" y1="12" x2="22" y2="12"></line>
        </svg>
      </div>
      <h1 class="card-title">Creative Editors</h1>
      <p class="card-subtitle">Auto-detected software on your PC:</p>

      <div class="editor-grid">
        ${renderEditorTilesHtml()}
      </div>

      <div class="action-stack">
        <button class="btn btn-primary" id="btn-step2-next">Continue →</button>
      </div>
    `;
  }

  // Step 3: Launch Workspace
  if (state.step === 3) {
    const username = (state.user && state.user.login) ? `@${state.user.login}` : 'Offline Mode';
    return `
      <div class="brand-mark">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      </div>
      <h1 class="card-title">Ready</h1>
      <p class="card-subtitle">Your local-first environment is configured.</p>

      <div class="editor-grid">
        <div class="editor-tile">
          <div class="editor-tile-info">
            <div class="editor-tile-text">
              <h4>GitHub Account</h4>
              <p>${escapeHtml(username)}</p>
            </div>
          </div>
          <span class="editor-status-pill">Active ✓</span>
        </div>
        <div class="editor-tile">
          <div class="editor-tile-info">
            <div class="editor-tile-text">
              <h4>Local Vault Storage</h4>
              <p>%APPDATA%\\FrameGit</p>
            </div>
          </div>
          <span class="editor-status-pill">Encrypted ✓</span>
        </div>
        <div class="editor-tile">
          <div class="editor-tile-info">
            <div class="editor-tile-text">
              <h4>Background Watcher</h4>
              <p>Monitors active timelines</p>
            </div>
          </div>
          <span class="editor-status-pill">Enabled ✓</span>
        </div>
      </div>

      <div class="action-stack">
        <button class="btn btn-primary" id="btn-launch-app">Open Workspace</button>
      </div>
    `;
  }

  return '';
}

function renderEditorTilesHtml() {
  const pr = state.editors.find(e => e.family === 'premiere');
  const dr = state.editors.find(e => e.family === 'resolve');

  return `
    <div class="editor-tile">
      <div class="editor-tile-info">
        <div class="editor-badge pr">Pr</div>
        <div class="editor-tile-text">
          <h4>Adobe Premiere Pro</h4>
          <p>${pr ? escapeHtml(pr.name) : 'Not detected on standard path'}</p>
        </div>
      </div>
      <span class="editor-status-pill ${pr ? '' : 'muted'}">
        ${pr ? 'Installed ✓' : 'Optional'}
      </span>
    </div>

    <div class="editor-tile">
      <div class="editor-tile-info">
        <div class="editor-badge dr">Da</div>
        <div class="editor-tile-text">
          <h4>DaVinci Resolve</h4>
          <p>${dr ? escapeHtml(dr.name) : 'Not detected on standard path'}</p>
        </div>
      </div>
      <span class="editor-status-pill ${dr ? '' : 'muted'}">
        ${dr ? 'Installed ✓' : 'Optional'}
      </span>
    </div>
  `;
}

// 4. Workspace View (Post-Setup)
function renderWorkspace(app) {
  updateHeader('Service Active', true);
  const u = state.user || {};
  const name = u.name || u.login || 'Editor';

  if (!state.projects || state.projects.length === 0) {
    // Empty workspace state
    app.innerHTML = `
      <div class="dashboard-view">
        <div class="dashboard-panel">
          <div class="panel-header">
            <div class="panel-user">
              <img class="panel-avatar" src="${escapeHtml(u.avatar_url || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png')}" alt="Avatar" />
              <div>
                <div class="panel-title">${escapeHtml(name)}</div>
                <div class="panel-subtitle">${u.login ? '@' + escapeHtml(u.login) : 'Local Workspace'}</div>
              </div>
            </div>
            <span class="panel-status-pill">● Online</span>
          </div>

          <div class="empty-workspace">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="color: var(--accent-purple);">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
            <h3 style="font-size: 14px; font-weight: 600; color: var(--text-primary); margin-top: 4px;">No Tracked Projects</h3>
            <p>Open any project in Premiere Pro or DaVinci Resolve with FrameGit enabled, or add a project directory below.</p>
            <button class="btn btn-primary btn-sm" id="btn-add-project" style="margin-top: 10px; width: auto; padding: 0 16px;">+ Track Project Folder</button>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 11px; color: var(--text-muted);">Background daemon active (Port 41793)</span>
            <button class="btn btn-subtle" id="btn-reset-setup" style="width: auto;">Settings</button>
          </div>
        </div>
      </div>
    `;

    attachWorkspaceEventListeners();
    return;
  }

  // Active Project View
  const p = state.activeProject || state.projects[0];
  const d = state.activeProjectDetails || { status: {}, branches: ['main'], history: [] };
  const changesCount = (d.status && d.status.changes) ? d.status.changes.length : 0;
  const currentBranch = (d.status && d.status.currBranch) || p.currentBranch || 'main';

  app.innerHTML = `
    <div class="workspace-layout">
      <!-- Left Sidebar: Projects Rail -->
      <aside class="workspace-sidebar">
        <div class="sidebar-top">
          <span class="sidebar-title">Tracked Projects</span>
          <button class="sidebar-btn-add" id="btn-add-project">+ Add</button>
        </div>

        <div class="sidebar-project-list">
          ${state.projects.map(proj => {
            const isSel = (p && proj.path === p.path);
            const isPr = (proj.projectFile || '').endsWith('.prproj') || proj.adapter === 'premiere';
            return `
              <div class="sidebar-project-item ${isSel ? 'active' : ''}" data-path="${escapeHtml(proj.path)}">
                <div class="editor-badge ${isPr ? 'pr' : 'dr'}" style="width: 26px; height: 26px; font-size: 10px;">
                  ${isPr ? 'Pr' : 'Da'}
                </div>
                <div>
                  <div class="project-item-name">${escapeHtml(proj.name || proj.projectFile)}</div>
                  <div class="project-item-meta">${escapeHtml(proj.currentBranch || 'main')}</div>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <div class="sidebar-footer">
          <div style="display: flex; align-items: center; gap: 8px;">
            <img class="panel-avatar" style="width: 24px; height: 24px;" src="${escapeHtml(u.avatar_url || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png')}" />
            <span style="font-size: 12px; font-weight: 500;">${escapeHtml(u.login || 'Local')}</span>
          </div>
          <button class="btn-subtle" id="btn-reset-setup" style="font-size: 11px; cursor: pointer;">Settings</button>
        </div>
      </aside>

      <!-- Main Stage: Active Project -->
      <main class="workspace-content">
        <div class="workspace-header">
          <div class="workspace-header-details">
            <h2>${escapeHtml(p.name || p.projectFile)}</h2>
            <p>${escapeHtml(p.path)}</p>
          </div>
          <div class="workspace-header-actions">
            <span class="branch-select-badge">⎇ ${escapeHtml(currentBranch)}</span>
            <button class="btn btn-secondary btn-sm" id="btn-sync-push" style="width: auto;">⇪ Push</button>
            <button class="btn btn-secondary btn-sm" id="btn-sync-pull" style="width: auto;">⇩ Pull</button>
          </div>
        </div>

        <!-- Checkpoint Bar -->
        <div class="checkpoint-card">
          <div class="checkpoint-title-row">
            <h4 style="font-size: 13px; font-weight: 600;">Timeline Checkpoint</h4>
            <span style="font-size: 12px; color: ${changesCount > 0 ? 'var(--accent-purple)' : 'var(--text-success)'};">
              ${changesCount > 0 ? `● ${changesCount} changes pending` : '✓ Timeline in sync'}
            </span>
          </div>
          <div class="checkpoint-input-row">
            <input type="text" class="input-field" id="checkpoint-msg-input" placeholder="Describe timeline changes..." style="margin-bottom: 0;" />
            <button class="btn btn-primary" id="btn-commit-checkpoint" style="width: auto; padding: 0 18px;" ${state.isCommitting ? 'disabled' : ''}>
              ${state.isCommitting ? '<div class="spinner"></div>' : 'Commit'}
            </button>
          </div>
        </div>

        <!-- Timeline History -->
        <div class="history-card">
          <h4 style="font-size: 13px; font-weight: 600;">Timeline Commit History</h4>
          <div class="history-list">
            ${(d.history && d.history.length > 0) ? d.history.map(c => `
              <div class="history-item-row">
                <div style="display: flex; align-items: center; gap: 12px;">
                  <span class="hash-pill">${escapeHtml((c.hash || '').slice(0, 8))}</span>
                  <div>
                    <div style="font-size: 13px; font-weight: 500;">${escapeHtml(c.message || 'Checkpoint')}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(c.author || 'Editor')} • ${formatTimeAgo(c.timestamp)}</div>
                  </div>
                </div>
                <button class="btn btn-secondary btn-sm btn-revert-commit" data-hash="${escapeHtml(c.hash)}" style="width: auto; height: 28px; font-size: 11px;">
                  Revert
                </button>
              </div>
            `).join('') : `
              <div style="text-align: center; color: var(--text-muted); padding: 24px; font-size: 12px;">
                No commits on this branch yet. Create your first timeline checkpoint above.
              </div>
            `}
          </div>
        </div>
      </main>
    </div>
  `;

  attachWorkspaceEventListeners();
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return 'recently';
  const sec = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

// 5. Event Listeners
function attachEventListeners() {
  const startOAuthBtn = $('btn-start-oauth');
  if (startOAuthBtn) {
    startOAuthBtn.addEventListener('click', async () => {
      startOAuthBtn.disabled = true;
      startOAuthBtn.innerHTML = `<div class="spinner"></div><span>Opening Browser...</span>`;

      try {
        const res = await api.startGitHubOAuth();
        if (res.started) {
          state.userCode = res.userCode;
          state.verificationUri = res.verificationUri;
          state.authMode = 'oauth_active';
          render();

          if (res.userCode) {
            await api.copyToClipboard(res.userCode);
          }

          state.isWaitingOAuth = true;
          const authRes = await api.waitForGitHubOAuth();
          if (authRes && authRes.success && authRes.user) {
            state.user = authRes.user;
            state.authMode = 'connected';
            render();
          } else if (authRes && authRes.cancelled) {
            // Cancelled
          } else {
            state.authMode = 'token_input';
            render();
          }
        } else {
          state.authMode = 'token_input';
          render();
        }
      } catch (err) {
        state.authMode = 'token_input';
        render();
      }
    });
  }

  const copyBtn = $('btn-copy-code');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      if (state.userCode) {
        await api.copyToClipboard(state.userCode);
        copyBtn.textContent = 'Copied! ✓';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          if ($('btn-copy-code')) {
            $('btn-copy-code').textContent = 'Copy';
            $('btn-copy-code').classList.remove('copied');
          }
        }, 2000);
      }
    });
  }

  const cancelOAuthBtn = $('btn-cancel-oauth');
  if (cancelOAuthBtn) {
    cancelOAuthBtn.addEventListener('click', async () => {
      await api.cancelGitHubOAuth();
      state.authMode = 'welcome';
      render();
    });
  }

  const useTokenLink = $('link-use-token');
  if (useTokenLink) {
    useTokenLink.addEventListener('click', () => {
      state.authMode = 'token_input';
      render();
    });
  }

  const offlineLink = $('link-offline');
  if (offlineLink) {
    offlineLink.addEventListener('click', async () => {
      await api.skipGitHubConfig();
      state.user = null;
      state.step = 2;
      render();
      scanEditors();
    });
  }

  const backWelcomeBtn = $('btn-back-welcome');
  if (backWelcomeBtn) {
    backWelcomeBtn.addEventListener('click', () => {
      state.authMode = 'welcome';
      render();
    });
  }

  const verifyPatBtn = $('btn-verify-pat');
  if (verifyPatBtn) {
    verifyPatBtn.addEventListener('click', async () => {
      const patInput = $('pat-input');
      const token = patInput ? patInput.value.trim() : '';
      if (!token) return;

      verifyPatBtn.disabled = true;
      verifyPatBtn.innerHTML = `<div class="spinner"></div>`;

      try {
        const res = await api.verifyGitHubToken(token);
        if (res.valid && res.user) {
          state.user = res.user;
          await api.saveGitHubConfig({
            token,
            username: res.user.login,
            name: res.user.name,
            email: res.user.email,
            avatarUrl: res.user.avatar_url
          });
          state.authMode = 'connected';
          render();
        } else {
          alert('Invalid token: ' + (res.error || 'Authentication failed'));
          verifyPatBtn.disabled = false;
          verifyPatBtn.textContent = 'Connect';
        }
      } catch (err) {
        alert('Network error: ' + err.message);
        verifyPatBtn.disabled = false;
        verifyPatBtn.textContent = 'Connect';
      }
    });
  }

  const step1NextBtn = $('btn-step1-next');
  if (step1NextBtn) {
    step1NextBtn.addEventListener('click', () => {
      state.step = 2;
      render();
      scanEditors();
    });
  }

  const step2NextBtn = $('btn-step2-next');
  if (step2NextBtn) {
    step2NextBtn.addEventListener('click', () => {
      state.step = 3;
      render();
    });
  }

  const launchBtn = $('btn-launch-app');
  if (launchBtn) {
    launchBtn.addEventListener('click', async () => {
      launchBtn.disabled = true;
      launchBtn.innerHTML = `<div class="spinner"></div>`;
      try {
        await api.configureStartup(true);
        await api.completeSetup({
          autoStartService: true,
          plugins: {
            premiere: state.editors.some(e => e.family === 'premiere'),
            resolve: state.editors.some(e => e.family === 'resolve')
          }
        });
        state.isSetupCompleted = true;
        await refreshProjects();
        render();
      } catch (err) {
        alert('Error completing setup: ' + err.message);
        launchBtn.disabled = false;
        launchBtn.textContent = 'Open Workspace';
      }
    });
  }
}

function attachWorkspaceEventListeners() {
  // Add project button
  const addProjectBtn = $('btn-add-project');
  if (addProjectBtn) {
    addProjectBtn.addEventListener('click', async () => {
      const res = await api.pickProjectFolder();
      if (!res.canceled && res.path) {
        try {
          await api.trackProject(res.path);
          await refreshProjects();
          render();
        } catch (err) {
          alert('Failed to track project: ' + err.message);
        }
      }
    });
  }

  // Sidebar project items
  document.querySelectorAll('.sidebar-project-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      const pathAttr = e.currentTarget.getAttribute('data-path');
      const found = state.projects.find(p => p.path === pathAttr);
      if (found) {
        state.activeProject = found;
        try {
          state.activeProjectDetails = await api.getProjectDetails(found.path);
        } catch (_) {}
        render();
      }
    });
  });

  // Commit checkpoint
  const commitBtn = $('btn-commit-checkpoint');
  if (commitBtn) {
    commitBtn.addEventListener('click', async () => {
      const msgInput = $('checkpoint-msg-input');
      const message = msgInput ? msgInput.value.trim() : '';
      if (!message || !state.activeProject) return;

      state.isCommitting = true;
      render();

      try {
        await api.commitProject(state.activeProject.path, message);
        state.activeProjectDetails = await api.getProjectDetails(state.activeProject.path);
      } catch (err) {
        alert('Commit failed: ' + err.message);
      } finally {
        state.isCommitting = false;
        render();
      }
    });
  }

  // Revert buttons
  document.querySelectorAll('.btn-revert-commit').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const hash = e.currentTarget.getAttribute('data-hash');
      if (!hash || !state.activeProject) return;
      if (!confirm(`Revert project to checkpoint ${hash.slice(0, 8)}? All timeline edits made after this checkpoint will be restored bit-for-bit.`)) return;

      try {
        await api.revertProject(state.activeProject.path, hash, true);
        state.activeProjectDetails = await api.getProjectDetails(state.activeProject.path);
        render();
      } catch (err) {
        alert('Revert failed: ' + err.message);
      }
    });
  });

  // Push
  const pushBtn = $('btn-sync-push');
  if (pushBtn) {
    pushBtn.addEventListener('click', async () => {
      if (!state.activeProject) return;
      pushBtn.disabled = true;
      try {
        await api.pushProject(state.activeProject.path);
        alert('Pushed timeline commits successfully.');
      } catch (err) {
        alert('Push failed: ' + err.message);
      } finally {
        pushBtn.disabled = false;
      }
    });
  }

  // Pull
  const pullBtn = $('btn-sync-pull');
  if (pullBtn) {
    pullBtn.addEventListener('click', async () => {
      if (!state.activeProject) return;
      pullBtn.disabled = true;
      try {
        await api.pullProject(state.activeProject.path);
        state.activeProjectDetails = await api.getProjectDetails(state.activeProject.path);
        render();
      } catch (err) {
        alert('Pull failed: ' + err.message);
      } finally {
        pullBtn.disabled = false;
      }
    });
  }

  // Re-run setup
  const resetBtn = $('btn-reset-setup');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      await api.resetSetup();
      state.isSetupCompleted = false;
      state.step = 1;
      state.authMode = 'welcome';
      render();
    });
  }
}

async function scanEditors() {
  try {
    const list = await api.detectEditors();
    state.editors = Array.isArray(list) ? list : [];
    for (const ed of state.editors) {
      if (!ed.pluginInstalled) {
        try { await api.installPlugin(ed.family); ed.pluginInstalled = true; } catch (_) {}
      }
    }
    render();
  } catch (err) {
    console.error('Editor detection failed:', err);
  }
}

async function refreshProjects() {
  try {
    const list = await api.listProjects();
    state.projects = Array.isArray(list) ? list : [];
    if (state.projects.length > 0 && !state.activeProject) {
      state.activeProject = state.projects[0];
      try {
        state.activeProjectDetails = await api.getProjectDetails(state.activeProject.path);
      } catch (_) {}
    }
  } catch (_) {
    state.projects = [];
  }
}

// 6. Bootstrap
async function init() {
  try {
    const status = await api.getSetupStatus();
    state.isSetupCompleted = Boolean(status.isSetupCompleted);

    if (status.auth && status.auth.hasToken && status.auth.user) {
      state.user = status.auth.user;
    }

    try {
      const eds = await api.detectEditors();
      state.editors = Array.isArray(eds) ? eds : [];
    } catch (_) {}

    if (state.isSetupCompleted) {
      await refreshProjects();
    }

    render();
  } catch (err) {
    console.error('Failed to initialize:', err);
    state.isSetupCompleted = false;
    state.step = 1;
    render();
  }
}

document.addEventListener('DOMContentLoaded', init);
