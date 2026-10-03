/**
 * FrameGit Desktop — Minimalist Application & Onboarding Controller
 * 1-Click Official Browser OAuth with local loopback callback receiver.
 */

'use strict';

// 1. Unified API Adapter (Native Electron IPC with HTTP Fallback)
const api = window.framegit || {
  getSetupStatus: async () => (await fetch('/api/setup/status')).json(),
  startBrowserOAuth: async () => ({ started: false, error: 'Not available in browser mode' }),
  waitForBrowserOAuth: async () => ({ success: false, error: 'Not available in browser mode' }),
  cancelBrowserOAuth: async () => ({ success: true }),
  getOAuthConfig: async () => ({ clientId: 'Ov23liEdxYDHJ3uGPzQv', hasSecret: false }),
  setOAuthConfig: async () => ({ success: true }),
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

  // Account Session Lifecycle
  signOut: async () => (await fetch('/api/auth/sign-out', { method: 'POST' })).json(),
  refreshProfile: async () => (await fetch('/api/auth/refresh-profile')).json(),
  syncGitConfig: async () => (await fetch('/api/auth/sync-git', { method: 'POST' })).json(),

  // Project Management & Tracking
  pickProject: async () => {
    const p = prompt('Enter absolute path to Premiere Pro or DaVinci Resolve project folder:');
    if (!p) return { canceled: true };
    return { canceled: false, path: p.trim() };
  },
  getTrackedProjects: async () => (await fetch('/api/desktop/projects/tracked')).json(),
  removeTrackedProject: async (path) => (await fetch('/api/desktop/project/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  })).json(),
  inspectProject: async (path) => (await fetch('/api/desktop/project/inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  })).json(),
  commitCheckpoint: async (params) => (await fetch('/api/desktop/project/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })).json(),
  restoreCheckpoint: async (params) => (await fetch('/api/desktop/project/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })).json(),
  switchBranch: async (params) => (await fetch('/api/desktop/branch/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })).json(),
  createBranch: async (params) => (await fetch('/api/desktop/branch/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })).json(),
  getProjectDiff: async (path) => (await fetch('/api/desktop/project/diff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  })).json(),
  getRemoteInfo: async (projectPath) => (await fetch('/api/desktop/project/remote-info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath })
  })).json(),
  publishGitHub: async (params) => (await fetch('/api/desktop/project/publish-github', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })).json(),
  pushRemote: async (projectPath) => (await fetch('/api/desktop/project/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath })
  })).json(),
  pullRemote: async (projectPath) => (await fetch('/api/desktop/project/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath })
  })).json(),
  fetchRemote: async (projectPath) => (await fetch('/api/desktop/project/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath })
  })).json(),
  syncRemote: async (projectPath) => (await fetch('/api/desktop/project/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath })
  })).json(),
  discardChanges: async (projectPath) => (await fetch('/api/desktop/project/discard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath })
  })).json(),
  ensurePluginsInstalled: async () => (await fetch('/api/desktop/plugins/ensure-installed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  })).json(),

  // System Shell Utilities
  showItemInFolder: async (path) => (await fetch('/api/desktop/shell/reveal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  })).json(),
  openPath: async (path) => (await fetch('/api/desktop/shell/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  })).json()
};

function normalizeUser(u) {
  if (!u) return null;
  const login = u.login || u.username || '';
  const name = u.name || login || 'Editor';
  const avatarUrl = u.avatar_url || u.avatarUrl || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png';
  return {
    login,
    username: login,
    name,
    email: u.email || null,
    avatar_url: avatarUrl,
    avatarUrl: avatarUrl,
    public_repos: u.public_repos || 0
  };
}

// 2. Application State
const state = {
  isSetupCompleted: false,
  step: 1, // 1: Auth, 2: Editors, 3: Launch
  authMode: 'welcome', // 'welcome' | 'browser_active' | 'device_active' | 'token_input' | 'config_input' | 'connected'
  browserOAuthState: null,
  browserAuthUrl: null,
  userCode: '',
  verificationUri: '',
  user: null,
  editors: [],
  autoStartService: true,
  oauthConfig: { clientId: '', hasSecret: false },
  trackedProjects: [],
  activeProject: null,
  activeFilter: 'all', // 'all' | 'premiere' | 'resolve'
  searchQuery: '',
  isOffline: false
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

function showToast(message) {
  let toast = $('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.style.position = 'fixed';
    toast.style.bottom = '24px';
    toast.style.right = '24px';
    toast.style.backgroundColor = '#111318';
    toast.style.border = '1px solid rgba(255, 255, 255, 0.15)';
    toast.style.borderRadius = '10px';
    toast.style.padding = '10px 18px';
    toast.style.color = '#f4f4f6';
    toast.style.fontSize = '12px';
    toast.style.boxShadow = '0 16px 40px rgba(0, 0, 0, 0.6)';
    toast.style.zIndex = '9999';
    toast.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    toast.style.pointerEvents = 'none';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(6px)';
  }, 2600);
}

function updateAccountHeader() {
  const container = $('account-menu-container');
  if (!container) return;

  if (state.user && (state.user.login || state.user.username)) {
    const u = normalizeUser(state.user);
    container.style.display = 'block';
    const avatarEl = $('account-avatar-small');
    const nameEl = $('account-name-small');
    if (avatarEl) {
      avatarEl.src = u.avatar_url;
      avatarEl.onerror = () => {
        avatarEl.src = 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png';
      };
    }
    if (nameEl) nameEl.textContent = u.name || `@${u.login}`;

    // Popover fields
    const popAvatar = $('popover-avatar');
    const popName = $('popover-name');
    const popHandle = $('popover-handle');
    const popEmail = $('popover-email');
    if (popAvatar) {
      popAvatar.src = u.avatar_url;
      popAvatar.onerror = () => {
        popAvatar.src = 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png';
      };
    }
    if (popName) popName.textContent = u.name;
    if (popHandle) popHandle.textContent = `@${u.login}`;
    if (popEmail) popEmail.textContent = u.email || 'OAuth Token Encrypted';
  } else {
    container.style.display = 'none';
  }
}

function updateHeader(statusText, isOnline = false) {
  const container = $('header-status');
  if (!container) return;
  container.innerHTML = `
    <span class="status-dot ${isOnline ? 'online' : ''}"></span>
    <span>${escapeHtml(statusText)}</span>
  `;
}

function updateTopbarNavigation() {
  const contextSection = $('topbar-context-section');
  const bridgesGroup = $('header-bridges-group');
  if (!contextSection) return;

  if (!state.isSetupCompleted) {
    contextSection.style.display = 'none';
    if (bridgesGroup) bridgesGroup.style.display = 'none';
    return;
  }

  contextSection.style.display = 'flex';
  if (bridgesGroup) {
    bridgesGroup.style.display = 'flex';
    const hasPr = state.editors.some(e => e.family === 'premiere');
    const hasDr = state.editors.some(e => e.family === 'resolve');
    const dotPr = $('dot-bridge-pr');
    const dotDr = $('dot-bridge-dr');
    if (dotPr) dotPr.className = `bridge-dot ${hasPr ? 'active' : ''}`;
    if (dotDr) dotDr.className = `bridge-dot ${hasDr ? 'active' : ''}`;
  }

  // Update Project Switcher Label
  const projectLabel = $('topbar-project-label');
  if (projectLabel) {
    projectLabel.textContent = state.activeProject ? state.activeProject.name : 'All Projects';
  }

  // Update Branch Switcher
  const branchAnchor = $('topbar-branch-anchor');
  const branchLabel = $('topbar-branch-label');
  if (branchAnchor && branchLabel) {
    if (state.activeProject) {
      branchAnchor.style.display = 'block';
      branchLabel.textContent = state.activeProject.currentBranch || 'main';
    } else {
      branchAnchor.style.display = 'none';
    }
  }

  // Populate Project Switcher Dropdown List
  const projListEl = $('topbar-project-dropdown-list');
  if (projListEl) {
    let itemsHtml = `
      <button class="dropdown-item ${!state.activeProject ? 'active' : ''}" data-nav-target="home">
        <span>🏠 All Projects</span>
        <span class="sidebar-badge">${state.trackedProjects.length}</span>
      </button>
    `;
    state.trackedProjects.forEach(p => {
      const isSelected = state.activeProject && state.activeProject.path === p.path;
      itemsHtml += `
        <button class="dropdown-item ${isSelected ? 'active' : ''}" data-open-project="${escapeHtml(p.path)}">
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px;">${escapeHtml(p.name)}</span>
          <span class="editor-badge-icon ${p.type === 'premiere' ? 'pr' : (p.type === 'resolve' ? 'dr' : '')}">${p.type === 'premiere' ? 'Pr' : (p.type === 'resolve' ? 'Dr' : 'FG')}</span>
        </button>
      `;
    });
    projListEl.innerHTML = itemsHtml;
  }

  // Populate Branch Switcher Dropdown List
  const branchListEl = $('topbar-branch-dropdown-list');
  if (branchListEl && state.activeProject) {
    const branches = state.activeProject.branches || ['main'];
    const curBranch = state.activeProject.currentBranch || 'main';
    branchListEl.innerHTML = branches.map(b => `
      <button class="dropdown-item ${b === curBranch ? 'active' : ''}" data-switch-branch="${escapeHtml(b)}">
        <span>🌿 ${escapeHtml(b)}</span>
        ${b === curBranch ? '<span>✓</span>' : ''}
      </button>
    `).join('');
  }
}

// 3. Main Render Router
function render() {
  const app = $('app');
  if (!app) return;

  const msgDraft = $('checkpoint-msg-input')?.value;
  const isMsgFocused = document.activeElement && document.activeElement.id === 'checkpoint-msg-input';

  if (state.isSetupCompleted) {
    app.className = 'app-container desktop-mode';
    renderDashboard(app);
    attachEventListeners();
    if (msgDraft !== undefined && $('checkpoint-msg-input') && !$('checkpoint-msg-input').value) {
      $('checkpoint-msg-input').value = msgDraft;
      if (isMsgFocused) $('checkpoint-msg-input').focus();
    }
    return;
  }

  app.className = 'app-container';
  updateHeader(`Setup ${state.step}/3`);
  updateTopbarNavigation();

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
          <button class="btn btn-github" id="btn-start-browser-oauth">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            <span>Sign in with GitHub</span>
          </button>
        </div>

        <div class="subtle-links">
          <span class="subtle-link" id="link-show-device">Device Code</span>
          <span class="divider-dot">•</span>
          <span class="subtle-link" id="link-show-config">OAuth Config</span>
          <span class="divider-dot">•</span>
          <span class="subtle-link" id="link-offline">Work Offline</span>
        </div>

        <div class="footer-badge">
          <span>🔒 100% local-first on this device</span>
        </div>
      `;
    }

    if (state.authMode === 'browser_active') {
      return `
        <div class="brand-mark">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M3 12h6m6 0h6M12 3v6m0 6v6"></path>
          </svg>
        </div>
        <h1 class="card-title">Authorizing on GitHub</h1>
        <p class="card-subtitle">A tab was opened in your browser.<br>Click <strong>Authorize FrameGit</strong> to grant repository access.</p>

        <div class="auth-pulse-status" style="margin: 12px 0 24px 0;">
          <span class="pulse-dot"></span>
          <span>Waiting for GitHub authorization...</span>
        </div>

        <div class="action-stack">
          ${state.browserAuthUrl ? `
            <button class="btn btn-secondary" id="btn-reopen-browser">Reopen Browser Tab</button>
          ` : ''}
          <button class="btn btn-subtle" id="btn-cancel-browser-oauth">Cancel</button>
        </div>
      `;
    }

    if (state.authMode === 'device_active') {
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

        <button class="btn btn-subtle" id="btn-cancel-device-oauth">Cancel</button>
      `;
    }

    if (state.authMode === 'config_input') {
      return `
        <div class="brand-mark">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </div>
        <h1 class="card-title">OAuth Configuration</h1>
        <p class="card-subtitle">Configure your GitHub OAuth App credentials:</p>

        <div class="action-stack" style="text-align: left;">
          <label style="font-size: 11px; color: var(--text-secondary); margin-bottom: -6px;">Client ID</label>
          <input type="text" class="input-field" id="cfg-client-id" placeholder="Iv23..." value="${escapeHtml(state.oauthConfig.clientId || '')}" />
          
          <label style="font-size: 11px; color: var(--text-secondary); margin-bottom: -6px;">Client Secret (optional)</label>
          <input type="password" class="input-field" id="cfg-client-secret" placeholder="Enter secret or leave blank" />

          <button class="btn btn-primary" id="btn-save-oauth-config">Save Credentials</button>
          <button class="btn btn-subtle" id="btn-back-from-config">Back</button>
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

// 4. Studio Workspace Dashboard
function renderDashboard(app) {
  updateHeader(state.isOffline ? 'Offline (Local-First)' : 'Service Active', !state.isOffline);
  updateAccountHeader();
  updateTopbarNavigation();

  const u = state.user || {};
  const userName = u.name || (u.login ? `@${u.login}` : 'Editor');
  const premiereCount = state.trackedProjects.filter(p => p.type === 'premiere').length;
  const resolveCount = state.trackedProjects.filter(p => p.type === 'resolve').length;

  // Filter projects by searchQuery and activeFilter
  let filteredProjects = state.trackedProjects.slice();
  if (state.activeFilter === 'premiere') {
    filteredProjects = filteredProjects.filter(p => p.type === 'premiere');
  } else if (state.activeFilter === 'resolve') {
    filteredProjects = filteredProjects.filter(p => p.type === 'resolve');
  }
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    filteredProjects = filteredProjects.filter(p => 
      p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
    );
  }

  const sidebarHtml = `
    <aside class="desktop-sidebar">
      <div class="sidebar-top">
        <div class="sidebar-section">
          <div class="sidebar-section-title">Workspace</div>
          <div class="sidebar-nav-item ${!state.activeProject && state.activeFilter === 'all' ? 'active' : ''}" id="nav-filter-all">
            <div class="sidebar-nav-label">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="7" height="7"></rect>
                <rect x="14" y="3" width="7" height="7"></rect>
                <rect x="14" y="14" width="7" height="7"></rect>
                <rect x="3" y="14" width="7" height="7"></rect>
              </svg>
              <span>All Projects</span>
            </div>
            <span class="sidebar-badge">${state.trackedProjects.length}</span>
          </div>

          <div class="sidebar-nav-item ${!state.activeProject && state.activeFilter === 'premiere' ? 'active' : ''}" id="nav-filter-pr">
            <div class="sidebar-nav-label">
              <span class="editor-badge-icon pr">Pr</span>
              <span>Premiere Pro</span>
            </div>
            <span class="sidebar-badge">${premiereCount}</span>
          </div>

          <div class="sidebar-nav-item ${!state.activeProject && state.activeFilter === 'resolve' ? 'active' : ''}" id="nav-filter-dr">
            <div class="sidebar-nav-label">
              <span class="editor-badge-icon dr">Dr</span>
              <span>DaVinci Resolve</span>
            </div>
            <span class="sidebar-badge">${resolveCount}</span>
          </div>
        </div>

        <button class="sidebar-btn-add" id="btn-sidebar-add-project">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12h14"></path>
          </svg>
          <span>Track Project</span>
        </button>

        ${state.trackedProjects.length ? `
          <div class="sidebar-section">
            <div class="sidebar-section-title">Quick Switch</div>
            ${state.trackedProjects.slice(0, 8).map(p => `
              <div class="sidebar-nav-item ${state.activeProject && state.activeProject.path === p.path ? 'active' : ''} btn-open-tracked" data-project-path="${escapeHtml(p.path)}">
                <div class="sidebar-nav-label" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 190px;">
                  <span class="editor-badge-icon ${p.type === 'premiere' ? 'pr' : (p.type === 'resolve' ? 'dr' : '')}">${p.type === 'premiere' ? 'Pr' : (p.type === 'resolve' ? 'Dr' : 'FG')}</span>
                  <span style="overflow: hidden; text-overflow: ellipsis;">${escapeHtml(p.name)}</span>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>

      <div class="sidebar-bottom">
        <div class="sidebar-status-card">
          <div class="sidebar-status-header">
            <span>Creative Bridges</span>
            <span style="color: var(--text-success); font-size: 10px;">● Live</span>
          </div>
          <div class="sidebar-status-item">
            <span>Premiere Pro UXP</span>
            <span class="dot ${state.editors.some(e => e.family === 'premiere') ? 'active' : ''}"></span>
          </div>
          <div class="sidebar-status-item">
            <span>DaVinci Resolve Bridge</span>
            <span class="dot ${state.editors.some(e => e.family === 'resolve') ? 'active' : ''}"></span>
          </div>
        </div>

        <div style="font-size: 10px; color: var(--text-muted); display: flex; align-items: center; justify-content: space-between; padding: 0 4px;">
          <span>🔒 Vault Encrypted</span>
          <span>%APPDATA%</span>
        </div>
      </div>
    </aside>
  `;

  if (!state.activeProject) {
    // HOME / LAUNCHPAD VIEW
    app.innerHTML = `
      <div class="desktop-shell">
        ${sidebarHtml}
        <main class="desktop-main">
          <div class="launchpad-content">
            <div class="launchpad-header">
              <div class="launchpad-profile-row">
                <img class="launchpad-avatar" src="${escapeHtml(u.avatar_url || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png')}" alt="avatar" />
                <div class="launchpad-greeting">
                  <h2>Welcome back, ${escapeHtml(userName)}</h2>
                  <p>${state.trackedProjects.length} project(s) tracked • Local-first timeline version control ready</p>
                </div>
              </div>
              <div class="launchpad-actions">
                <button class="btn btn-primary" id="btn-open-project" style="height: 38px; padding: 0 16px; width: auto;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                  </svg>
                  <span>Open Video Project</span>
                </button>
              </div>
            </div>

            <div class="launchpad-toolbar">
              <div class="search-box-container">
                <svg class="search-box-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <input type="text" class="search-input" id="search-projects-input" placeholder="Search tracked projects by name or path..." value="${escapeHtml(state.searchQuery)}" />
              </div>

              <div class="filter-chips-row">
                <div class="filter-chip ${state.activeFilter === 'all' ? 'active' : ''}" data-filter="all">All (${state.trackedProjects.length})</div>
                <div class="filter-chip ${state.activeFilter === 'premiere' ? 'active' : ''}" data-filter="premiere">Premiere (${premiereCount})</div>
                <div class="filter-chip ${state.activeFilter === 'resolve' ? 'active' : ''}" data-filter="resolve">DaVinci (${resolveCount})</div>
              </div>
            </div>

            <div class="projects-container">
              ${filteredProjects.length ? filteredProjects.map(p => `
                <div class="project-card">
                  <div class="project-card-header">
                    <div class="project-title-area">
                      <span class="project-format-badge ${p.type === 'premiere' ? 'pr' : (p.type === 'resolve' ? 'dr' : 'generic')}">
                        ${p.type === 'premiere' ? 'Pr' : (p.type === 'resolve' ? 'Dr' : 'FG')}
                      </span>
                      <div>
                        <div class="project-name-heading">${escapeHtml(p.name)}</div>
                      </div>
                      <span class="project-branch-tag">🌿 main</span>
                    </div>
                    <span class="project-status-pill clean">● Ready</span>
                  </div>

                  <div class="project-card-body">
                    <div class="project-path-code" title="${escapeHtml(p.path)}">${escapeHtml(p.path)}</div>
                  </div>

                  <div class="project-card-actions">
                    <div class="project-meta-info">
                      ${p.type === 'premiere' ? 'Adobe Premiere Pro Project' : (p.type === 'resolve' ? 'DaVinci Resolve Export (.drp)' : 'Video Project')}
                    </div>
                    <div class="project-buttons-group">
                      <button class="btn-card-action btn-card-primary btn-open-tracked" data-project-path="${escapeHtml(p.path)}">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                        <span>Open Workspace</span>
                      </button>
                      <button class="btn-card-action btn-card-secondary btn-reveal-path" data-path="${escapeHtml(p.projectFilePath || p.path)}" title="Reveal in Windows Explorer">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                        </svg>
                        <span>Explorer</span>
                      </button>
                      <button class="btn-card-action btn-card-secondary btn-launch-editor" data-path="${escapeHtml(p.projectFilePath || p.path)}" title="Open in creative application">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polygon points="5 3 19 12 5 21 5 3"></polygon>
                        </svg>
                        <span>${p.type === 'premiere' ? 'Open in Premiere' : (p.type === 'resolve' ? 'Open in Resolve' : 'Launch File')}</span>
                      </button>
                      <button class="btn-card-action btn-card-danger btn-remove-tracked" data-project-path="${escapeHtml(p.path)}" title="Remove project from FrameGit tracking">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              `).join('') : `
                <div class="empty-launchpad">
                  <div class="empty-launchpad-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    </svg>
                  </div>
                  <h3>${state.searchQuery ? 'No matching projects found' : 'No tracked video projects yet'}</h3>
                  <p>${state.searchQuery ? `No projects match "${escapeHtml(state.searchQuery)}". Clear the search or track a new project.` : 'Click "Open Video Project" to track your first Premiere Pro (.prproj) or DaVinci Resolve (.drp) project.'}</p>
                  <button class="btn btn-primary" id="btn-empty-add-project" style="max-width: 200px; margin-top: 8px;">
                    ${state.searchQuery ? 'Clear Search Filter' : '+ Track Video Project'}
                  </button>
                </div>
              `}
            </div>
          </div>
        </main>
      </div>
    `;
  } else {
    // PROJECT STUDIO VIEW
    const proj = state.activeProject;
    const isDirty = proj.status && proj.status.hasChanges;
    const changes = (proj.status && proj.status.changes) || [];
    const changesCount = changes.length;

    const defaultRepoName = (proj.name || 'project').replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_\-\.]/g, '-');

    app.innerHTML = `
      <div class="studio-layout">
        <!-- Left Staging & Checkpoint Panel -->
        <aside class="studio-staging-panel">
          <button class="staging-nav-back" id="btn-back-to-home">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            <span>All Projects</span>
          </button>

          <div class="staging-project-header">
            <span class="project-format-badge ${proj.type === 'premiere' ? 'pr' : (proj.type === 'resolve' ? 'dr' : 'generic')}">
              ${proj.type === 'premiere' ? 'Pr' : (proj.type === 'resolve' ? 'Dr' : 'FG')}
            </span>
            <div class="staging-project-meta">
              <h3>${escapeHtml(proj.name)}</h3>
              <p>${escapeHtml(proj.path)}</p>
            </div>
          </div>

          <!-- Creative Bridge Status -->
          <div class="creative-bridge-badge-row">
            <div class="creative-bridge-pill ${proj.type === 'premiere' ? 'active' : ''}">
              <span class="editor-badge-icon pr" style="width: 16px; height: 16px; font-size: 9px;">Pr</span>
              <span>Premiere UXP Active</span>
            </div>
            <div class="creative-bridge-pill ${proj.type === 'resolve' ? 'active' : ''}">
              <span class="editor-badge-icon dr" style="width: 16px; height: 16px; font-size: 9px;">Dr</span>
              <span>Resolve Script Active</span>
            </div>
            <button class="btn-sync-bridges" id="btn-sync-creative-bridges" title="Ensure Premiere & Resolve integrations are deployed and linked">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
            </button>
          </div>

          <!-- Staging / Working Tree Area -->
          <div class="staging-section">
            <div class="staging-section-title">
              <span>Working Tree</span>
              <span class="project-status-pill ${isDirty ? 'dirty' : 'clean'}">
                ● ${isDirty ? `${changesCount} changes` : 'Clean'}
              </span>
            </div>

            <div class="uncommitted-box">
              <div class="uncommitted-status-row">
                <span>${isDirty ? `${changesCount} uncommitted modifications` : 'Timeline is up to date'}</span>
                <div style="display: flex; gap: 6px;">
                  <button class="btn btn-secondary" id="btn-show-diff" style="height: 26px; padding: 0 8px; font-size: 11px;">
                    Visual Diff
                  </button>
                  <button class="btn btn-secondary ${isDirty ? 'btn-danger-hover' : ''}" id="btn-discard-changes" ${!isDirty ? 'disabled' : ''} style="height: 26px; padding: 0 8px; font-size: 11px;" title="Discard all uncommitted changes on disk">
                    Discard
                  </button>
                </div>
              </div>

              ${isDirty ? `
                <div class="changes-breakdown-list">
                  ${changes.slice(0, 10).map(ch => `
                    <div class="change-item-row">
                      <span class="change-tag ${ch.type && ch.type.includes('add') ? 'add' : (ch.type && ch.type.includes('del') ? 'del' : 'mod')}">
                        ${escapeHtml(ch.type || 'MOD')}
                      </span>
                      <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${escapeHtml(ch.description || ch.item || 'Timeline change')}
                      </span>
                    </div>
                  `).join('')}
                </div>
              ` : `
                <div style="font-size: 11px; color: var(--text-muted); padding: 4px 0;">
                  No changes since last checkpoint. Save your project in Premiere/DaVinci to track edits.
                </div>
              `}
            </div>
          </div>

          <!-- Checkpoint Creator Box -->
          <div class="staging-section">
            <div class="staging-section-title">
              <span>Create Checkpoint</span>
              <span style="font-size: 10px; color: var(--text-muted);">Ctrl + Enter</span>
            </div>

            <div class="checkpoint-box">
              <textarea id="checkpoint-msg-input" placeholder="Describe checkpoint (e.g. Scene 2 rough cut, audio ducking, Lumetri grade)..."></textarea>
              <div class="checkpoint-commit-footer">
                <span class="commit-author-hint">Author: ${escapeHtml(userName)}</span>
                <button class="btn btn-primary" id="btn-create-checkpoint" style="width: auto; height: 32px; padding: 0 14px; font-size: 12px;">
                  Save Checkpoint
                </button>
              </div>
            </div>
          </div>
        </aside>

        <!-- Right Main Timeline History Feed -->
        <main class="studio-history-panel">
          <!-- Remote Sync Section -->
          ${proj.remote && proj.remote.isLinked ? `
            <div class="remote-sync-bar">
              <div class="remote-repo-badge" id="btn-open-remote-link" title="Open repository on GitHub" style="cursor: pointer;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                </svg>
                <span>${escapeHtml(proj.remote.repoFullName || 'origin')}</span>
                <span class="external-icon">↗</span>
              </div>

              <div class="remote-action-buttons">
                <button class="btn btn-secondary remote-action-btn" id="btn-remote-fetch" title="Fetch updates from origin">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                  </svg>
                  <span>Fetch origin</span>
                </button>

                <button class="btn btn-secondary remote-action-btn" id="btn-remote-pull" title="Pull remote commits into local branch">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <polyline points="19 12 12 19 5 12"></polyline>
                  </svg>
                  <span>Pull</span>
                  ${proj.remote.behind > 0 ? `<span class="remote-count-badge behind">${proj.remote.behind}</span>` : ''}
                </button>

                <button class="btn btn-secondary remote-action-btn" id="btn-remote-push" title="Push local commits to GitHub">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="19" x2="12" y2="5"></line>
                    <polyline points="5 12 12 5 19 12"></polyline>
                  </svg>
                  <span>Push</span>
                  ${proj.remote.ahead > 0 ? `<span class="remote-count-badge ahead">${proj.remote.ahead}</span>` : ''}
                </button>

                <button class="btn btn-primary remote-action-btn" id="btn-remote-sync" title="Fetch origin and push commits">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
                  </svg>
                  <span>Sync</span>
                </button>
              </div>
            </div>
          ` : `
            <div class="remote-sync-card">
              <div class="remote-sync-info">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                </svg>
                <div>
                  <h4>Publish repository to GitHub</h4>
                  <p>Sync timeline manifests and checkpoints to a private or public GitHub repository.</p>
                </div>
              </div>
              <button class="btn btn-primary" id="btn-open-publish-modal" style="height: 32px; padding: 0 14px; font-size: 12px; width: auto;">
                <span>Publish to GitHub</span>
              </button>
            </div>
          `}

          <div class="history-topbar">
            <div class="history-title-area">
              <h2>Timeline History (${proj.history ? proj.history.length : 0})</h2>
              <p>Branch: <strong style="color: var(--text-primary);">🌿 ${escapeHtml(proj.currentBranch || 'main')}</strong></p>
            </div>

            <div class="history-action-buttons">
              <button class="btn btn-secondary btn-reveal-path" data-path="${escapeHtml(proj.projectFilePath || proj.path)}" style="height: 32px; padding: 0 12px; font-size: 12px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
                <span>Reveal in Explorer</span>
              </button>
              <button class="btn btn-secondary btn-launch-editor" data-path="${escapeHtml(proj.projectFilePath || proj.path)}" style="height: 32px; padding: 0 12px; font-size: 12px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                <span>${proj.type === 'premiere' ? 'Open in Premiere' : (proj.type === 'resolve' ? 'Open in Resolve' : 'Open in Editor')}</span>
              </button>
              <button class="btn btn-secondary" id="btn-refresh-project" style="height: 32px; padding: 0 10px; font-size: 12px;" title="Refresh working tree">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                </svg>
              </button>
            </div>
          </div>

          <div class="timeline-feed">
            ${proj.history && proj.history.length ? proj.history.map(c => {
              const cHash = c.commitHash || c.hash || '';
              const cTime = c.committedAt || c.timestamp || Date.now();
              return `
              <div class="checkpoint-timeline-card">
                <div class="checkpoint-card-left">
                  <span class="checkpoint-sha-badge">${escapeHtml(cHash.slice(0, 8))}</span>
                  <div class="checkpoint-info">
                    <h4>${escapeHtml(c.message || 'Timeline checkpoint')}</h4>
                    <p>${escapeHtml(c.author && c.author.name ? c.author.name : userName)} • ${escapeHtml(new Date(cTime).toLocaleString())}</p>
                  </div>
                </div>

                <div class="checkpoint-actions">
                  <button class="btn btn-secondary btn-restore-checkpoint" data-hash="${escapeHtml(cHash)}" style="height: 30px; padding: 0 12px; font-size: 11px;">
                    Restore
                  </button>
                </div>
              </div>
            `;}).join('') : `
              <div class="empty-launchpad" style="padding: 40px 20px;">
                <p>No checkpoints committed on branch "${escapeHtml(proj.currentBranch || 'main')}" yet.<br>Create your first checkpoint using the staging panel on the left.</p>
              </div>
            `}
          </div>
        </main>
      </div>

      <!-- Publish to GitHub Modal -->
      <div class="modal-overlay" id="modal-publish-repo" style="display: none;">
        <div class="modal-dialog">
          <div class="modal-header">
            <div style="display: flex; align-items: center; gap: 10px;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
              </svg>
              <h3>Publish Repository to GitHub</h3>
            </div>
            <button class="modal-close-btn" id="btn-close-publish-modal">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group" style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px;">
              <label style="font-size: 12px; font-weight: 600; color: var(--text-primary);">Repository Name</label>
              <input type="text" id="input-publish-name" class="modal-input" placeholder="e.g. BMW-edit" value="${escapeHtml(defaultRepoName)}" />
            </div>
            <div class="form-group" style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px;">
              <label style="font-size: 12px; font-weight: 600; color: var(--text-primary);">Description (Optional)</label>
              <input type="text" id="input-publish-desc" class="modal-input" placeholder="Video project versioned with FrameGit" />
            </div>
            <div class="form-group" style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
              <input type="checkbox" id="input-publish-private" checked style="accent-color: var(--accent-purple);" />
              <label for="input-publish-private" style="font-size: 12px; color: var(--text-secondary); cursor: pointer;">
                Keep this repository private (Recommended)
              </label>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="btn-cancel-publish-modal">Cancel</button>
            <button class="btn btn-primary" id="btn-confirm-publish">Publish Repository</button>
          </div>
        </div>
      </div>

      <!-- Visual Diff Modal -->
      <div class="modal-overlay" id="modal-visual-diff" style="display: none;">
        <div class="modal-dialog" style="max-width: 820px; width: 95%;">
          <div class="modal-header">
            <div style="display: flex; align-items: center; gap: 10px;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="4 7 4 4 20 4 20 7"></polyline>
                <line x1="9" y1="20" x2="15" y2="20"></line>
                <line x1="12" y1="4" x2="12" y2="20"></line>
              </svg>
              <h3>Timeline Visual Diff</h3>
            </div>
            <button class="modal-close-btn" id="btn-close-diff-modal">✕</button>
          </div>
          <div class="modal-body" style="padding: 0;">
            <pre class="diff-terminal-content" id="diff-terminal-output">Computing timeline diff...</pre>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="btn-open-html-diff" title="Open full visual diff in browser">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"></path>
              </svg>
              <span>Open Interactive Canvas</span>
            </button>
            <button class="btn btn-primary" id="btn-dismiss-diff-modal">Done</button>
          </div>
        </div>
      </div>
    `;
  }
}

// 5. Event Listeners
function attachEventListeners() {
  // Step 1: Start 1-Click Official Browser OAuth
  const startBrowserOAuthBtn = $('btn-start-browser-oauth');
  if (startBrowserOAuthBtn) {
    startBrowserOAuthBtn.addEventListener('click', async () => {
      startBrowserOAuthBtn.disabled = true;
      startBrowserOAuthBtn.innerHTML = `<div class="spinner"></div><span>Opening Browser...</span>`;

      try {
        const res = await api.startBrowserOAuth();
        if (res.started) {
          state.browserOAuthState = res.state;
          state.browserAuthUrl = res.authUrl;
          state.authMode = 'browser_active';
          render();

          // Await token from loopback callback receiver
          const authRes = await api.waitForBrowserOAuth(res.state);
          if (authRes && authRes.success && authRes.user) {
            state.user = authRes.user;
            state.authMode = 'connected';
            render();
          } else if (authRes && authRes.cancelled) {
            // Cancelled
          } else {
            // If OAuth failed or cancelled, return to welcome
            state.authMode = 'welcome';
            render();
          }
        } else {
          // If browser OAuth failed (e.g. in headless test mode), fallback to device flow
          startDeviceFlow();
        }
      } catch (err) {
        console.error('Browser OAuth error:', err);
        startDeviceFlow();
      }
    });
  }

  // Reopen browser button
  const reopenBtn = $('btn-reopen-browser');
  if (reopenBtn && state.browserAuthUrl) {
    reopenBtn.addEventListener('click', () => {
      api.openExternal(state.browserAuthUrl);
    });
  }

  // Cancel Browser OAuth
  const cancelBrowserBtn = $('btn-cancel-browser-oauth');
  if (cancelBrowserBtn) {
    cancelBrowserBtn.addEventListener('click', async () => {
      if (state.browserOAuthState) {
        await api.cancelBrowserOAuth(state.browserOAuthState);
      }
      state.browserOAuthState = null;
      state.authMode = 'welcome';
      render();
    });
  }

  // Helper for Device Code Flow
  async function startDeviceFlow() {
    try {
      const res = await api.startGitHubOAuth();
      if (res.started) {
        state.userCode = res.userCode;
        state.verificationUri = res.verificationUri;
        state.authMode = 'device_active';
        render();

        if (res.userCode) {
          await api.copyToClipboard(res.userCode);
        }

        const authRes = await api.waitForGitHubOAuth();
        if (authRes && authRes.success && authRes.user) {
          state.user = authRes.user;
          state.authMode = 'connected';
          render();
        }
      } else {
        state.authMode = 'welcome';
        render();
      }
    } catch (_) {
      state.authMode = 'welcome';
      render();
    }
  }

  // Show Device Code Flow directly
  const showDeviceLink = $('link-show-device');
  if (showDeviceLink) {
    showDeviceLink.addEventListener('click', () => {
      startDeviceFlow();
    });
  }

  // Show OAuth Config
  const showConfigLink = $('link-show-config');
  if (showConfigLink) {
    showConfigLink.addEventListener('click', async () => {
      const cfg = await api.getOAuthConfig();
      state.oauthConfig = cfg || { clientId: '', hasSecret: false };
      state.authMode = 'config_input';
      render();
    });
  }

  // Save OAuth Config
  const saveConfigBtn = $('btn-save-oauth-config');
  if (saveConfigBtn) {
    saveConfigBtn.addEventListener('click', async () => {
      const idInput = $('cfg-client-id');
      const secretInput = $('cfg-client-secret');
      const clientId = idInput ? idInput.value.trim() : '';
      const clientSecret = secretInput ? secretInput.value.trim() : '';

      if (clientId) {
        await api.setOAuthConfig({
          clientId,
          clientSecret: clientSecret || null
        });
      }
      state.authMode = 'welcome';
      render();
    });
  }

  // Back from Config
  const backConfigBtn = $('btn-back-from-config');
  if (backConfigBtn) {
    backConfigBtn.addEventListener('click', () => {
      state.authMode = 'welcome';
      render();
    });
  }

  // Copy code in device flow
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

  // Cancel device OAuth
  const cancelDeviceBtn = $('btn-cancel-device-oauth');
  if (cancelDeviceBtn) {
    cancelDeviceBtn.addEventListener('click', async () => {
      await api.cancelGitHubOAuth();
      state.authMode = 'welcome';
      render();
    });
  }

  // Work Offline
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

  // Step 1 -> Step 2
  const step1NextBtn = $('btn-step1-next');
  if (step1NextBtn) {
    step1NextBtn.addEventListener('click', () => {
      state.step = 2;
      render();
      scanEditors();
    });
  }

  // Step 2 -> Step 3
  const step2NextBtn = $('btn-step2-next');
  if (step2NextBtn) {
    step2NextBtn.addEventListener('click', () => {
      state.step = 3;
      render();
    });
  }

  // Step 3 -> Launch Workspace
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
        render();
      } catch (err) {
        alert('Error completing setup: ' + err.message);
        launchBtn.disabled = false;
        launchBtn.textContent = 'Open Workspace';
      }
    });
  }

  // Account Popover Toggle
  const accountTrigger = $('account-trigger-btn');
  const accountPopover = $('account-popover');
  if (accountTrigger && accountPopover) {
    accountTrigger.onclick = (e) => {
      e.stopPropagation();
      const isVisible = accountPopover.style.display !== 'none';
      accountPopover.style.display = isVisible ? 'none' : 'flex';
      const pdd = $('topbar-project-dropdown');
      if (pdd) pdd.style.display = 'none';
      const bdd = $('topbar-branch-dropdown');
      if (bdd) bdd.style.display = 'none';
    };
  }

  // Topbar Project Switcher Dropdown
  const topbarProjBtn = $('topbar-project-btn');
  const topbarProjDd = $('topbar-project-dropdown');
  if (topbarProjBtn && topbarProjDd) {
    topbarProjBtn.onclick = (e) => {
      e.stopPropagation();
      const isVis = topbarProjDd.style.display !== 'none';
      topbarProjDd.style.display = isVis ? 'none' : 'flex';
      const bdd = $('topbar-branch-dropdown');
      if (bdd) bdd.style.display = 'none';
      const ap = $('account-popover');
      if (ap) ap.style.display = 'none';
    };
  }

  // Topbar Branch Switcher Dropdown
  const topbarBranchBtn = $('topbar-branch-btn');
  const topbarBranchDd = $('topbar-branch-dropdown');
  if (topbarBranchBtn && topbarBranchDd) {
    topbarBranchBtn.onclick = (e) => {
      e.stopPropagation();
      const isVis = topbarBranchDd.style.display !== 'none';
      topbarBranchDd.style.display = isVis ? 'none' : 'flex';
      const pdd = $('topbar-project-dropdown');
      if (pdd) pdd.style.display = 'none';
      const ap = $('account-popover');
      if (ap) ap.style.display = 'none';
    };
  }

  // Header Brand Click -> Return to Home
  const headerBrandBtn = $('header-brand-btn');
  if (headerBrandBtn) {
    headerBrandBtn.onclick = () => {
      state.activeProject = null;
      render();
    };
  }

  // Nav target home from dropdown
  document.querySelectorAll('[data-nav-target="home"]').forEach(el => {
    el.onclick = () => {
      state.activeProject = null;
      const pdd = $('topbar-project-dropdown');
      if (pdd) pdd.style.display = 'none';
      render();
    };
  });

  // Switch branch from dropdown
  document.querySelectorAll('[data-switch-branch]').forEach(el => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const targetBranch = el.getAttribute('data-switch-branch');
      const bdd = $('topbar-branch-dropdown');
      if (bdd) bdd.style.display = 'none';
      if (!state.activeProject || !targetBranch || targetBranch === state.activeProject.currentBranch) return;
      try {
        const res = await api.switchBranch({
          projectPath: state.activeProject.path,
          branchName: targetBranch,
          force: false
        });
        if (res && res.success) {
          showToast(`Switched to branch: ${targetBranch}`);
          await openProjectByPath(state.activeProject.path);
        } else {
          showToast(`Cannot switch branch: ${res.error || 'Uncommitted changes detected'}`);
        }
      } catch (err) {
        showToast(`Error: ${err.message}`);
      }
    };
  });

  // Create new branch from dropdown
  const newBranchBtn = $('topbar-dropdown-new-branch');
  if (newBranchBtn && state.activeProject) {
    newBranchBtn.onclick = async (e) => {
      e.stopPropagation();
      const bdd = $('topbar-branch-dropdown');
      if (bdd) bdd.style.display = 'none';
      const branchName = prompt('Enter new branch name (e.g. director-cut, color-grade):');
      if (branchName && branchName.trim()) {
        try {
          const res = await api.createBranch({
            projectPath: state.activeProject.path,
            branchName: branchName.trim()
          });
          if (res && res.success) {
            showToast(`Branch created: ${branchName.trim()}`);
            await api.switchBranch({
              projectPath: state.activeProject.path,
              branchName: branchName.trim()
            });
            await openProjectByPath(state.activeProject.path);
          } else {
            showToast(`Error creating branch: ${res.error || 'Unknown error'}`);
          }
        } catch (err) {
          showToast(`Error: ${err.message}`);
        }
      }
    };
  }

  // Open project from topbar dropdown
  document.querySelectorAll('[data-open-project]').forEach(el => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const path = el.getAttribute('data-open-project');
      const pdd = $('topbar-project-dropdown');
      if (pdd) pdd.style.display = 'none';
      if (path) await openProjectByPath(path);
    };
  });

  // Sync Git Config
  const syncGitBtn = $('menu-sync-git');
  if (syncGitBtn) {
    syncGitBtn.onclick = async () => {
      try {
        const res = await api.syncGitConfig();
        if (res.success) {
          showToast(`Git Author Configured: ${res.name} <${res.email}>`);
        } else {
          showToast(`Sync Failed: ${res.error || 'Unknown error'}`);
        }
      } catch (err) {
        showToast(`Sync Error: ${err.message}`);
      }
    };
  }

  // View GitHub Profile
  const viewGhBtn = $('menu-view-github');
  if (viewGhBtn) {
    viewGhBtn.onclick = () => {
      if (state.user && state.user.login) {
        api.openExternal(`https://github.com/${state.user.login}`);
      }
    };
  }

  // Refresh Session
  const refreshBtn = $('menu-refresh-session');
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      refreshBtn.disabled = true;
      try {
        const res = await api.refreshProfile();
        if (res && res.authenticated) {
          if (res.user) state.user = res.user;
          state.isOffline = Boolean(res.offline);
          updateAccountHeader();
          updateHeader(state.isOffline ? 'Offline (Cached Profile)' : 'Service Active', !state.isOffline);
          showToast(state.isOffline ? 'Offline: Operating from Local Vault' : 'Session Active: Verified with GitHub');
        } else {
          showToast('Session Expired: Please Sign In Again');
        }
      } catch (err) {
        showToast('Session check: ' + err.message);
      } finally {
        refreshBtn.disabled = false;
      }
    };
  }

  // Sign Out
  const signOutBtn = $('menu-sign-out');
  if (signOutBtn) {
    signOutBtn.onclick = async () => {
      if (confirm('Disconnect GitHub account and sign out?')) {
        await api.signOut();
        state.user = null;
        state.isSetupCompleted = false;
        state.step = 1;
        state.authMode = 'welcome';
        state.activeProject = null;
        const pop = $('account-popover');
        if (pop) pop.style.display = 'none';
        updateAccountHeader();
        render();
        showToast('Signed out successfully.');
      }
    };
  }

  // Global Handlers for Opening Projects
  const handleOpenPicker = async () => {
    try {
      const res = await api.pickProject();
      if (res && !res.canceled && res.path) {
        await openProjectByPath(res.path);
      }
    } catch (err) {
      showToast('Error selecting project: ' + err.message);
    }
  };

  const openProjBtn = $('btn-open-project');
  const sidebarAddBtn = $('btn-sidebar-add-project');
  const topbarAddBtn = $('topbar-dropdown-add-project');
  const emptyAddBtn = $('btn-empty-add-project');
  if (openProjBtn) openProjBtn.onclick = handleOpenPicker;
  if (sidebarAddBtn) sidebarAddBtn.onclick = handleOpenPicker;
  if (topbarAddBtn) {
    topbarAddBtn.onclick = () => {
      const pdd = $('topbar-project-dropdown');
      if (pdd) pdd.style.display = 'none';
      handleOpenPicker();
    };
  }
  if (emptyAddBtn) {
    emptyAddBtn.onclick = () => {
      if (state.searchQuery) {
        state.searchQuery = '';
        render();
      } else {
        handleOpenPicker();
      }
    };
  }

  // Filter Search Input in Launchpad
  const searchInput = $('search-projects-input');
  if (searchInput) {
    searchInput.oninput = (e) => {
      state.searchQuery = e.target.value;
      const app = $('app');
      if (app) renderDashboard(app);
      // Re-focus search input and restore cursor position
      const reSearch = $('search-projects-input');
      if (reSearch) {
        reSearch.focus();
        reSearch.setSelectionRange(reSearch.value.length, reSearch.value.length);
      }
    };
  }

  // Filter Chips in Launchpad
  document.querySelectorAll('.filter-chip').forEach(el => {
    el.onclick = () => {
      const f = el.getAttribute('data-filter');
      if (f) {
        state.activeFilter = f;
        render();
      }
    };
  });

  // Sidebar Workspace Filter Items
  const navAll = $('nav-filter-all');
  if (navAll) navAll.onclick = () => { state.activeFilter = 'all'; state.activeProject = null; render(); };
  const navPr = $('nav-filter-pr');
  if (navPr) navPr.onclick = () => { state.activeFilter = 'premiere'; state.activeProject = null; render(); };
  const navDr = $('nav-filter-dr');
  if (navDr) navDr.onclick = () => { state.activeFilter = 'resolve'; state.activeProject = null; render(); };

  // Open Tracked Projects
  document.querySelectorAll('.btn-open-tracked').forEach(el => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const path = el.getAttribute('data-project-path');
      if (path) await openProjectByPath(path);
    };
  });

  // Reveal in Explorer
  document.querySelectorAll('.btn-reveal-path').forEach(el => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const path = el.getAttribute('data-path');
      if (path) {
        try {
          const res = await api.showItemInFolder(path);
          if (res && res.error) showToast(`Could not reveal: ${res.error}`);
        } catch (err) {
          showToast(`Error: ${err.message}`);
        }
      }
    };
  });

  // Launch Project in Creative Editor
  document.querySelectorAll('.btn-launch-editor').forEach(el => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const path = el.getAttribute('data-path');
      if (path) {
        try {
          const res = await api.openPath(path);
          if (res && res.error) showToast(`Launch failed: ${res.error}`);
          else showToast(`Opening in editor...`);
        } catch (err) {
          showToast(`Error: ${err.message}`);
        }
      }
    };
  });

  // Remove Tracked Project
  document.querySelectorAll('.btn-remove-tracked').forEach(el => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const projectPath = el.getAttribute('data-project-path');
      if (projectPath && confirm(`Remove "${projectPath.split(/[/\\]/).pop()}" from FrameGit tracked projects? (Your video files will not be deleted)`)) {
        try {
          await api.removeTrackedProject(projectPath);
          if (state.activeProject && state.activeProject.path === projectPath) {
            state.activeProject = null;
          }
          state.trackedProjects = await api.getTrackedProjects();
          render();
          showToast('Project removed from tracking');
        } catch (err) {
          showToast(`Error: ${err.message}`);
        }
      }
    };
  });

  // Back to Home from Studio
  const backHomeBtn = $('btn-back-to-home');
  if (backHomeBtn) {
    backHomeBtn.onclick = () => {
      state.activeProject = null;
      render();
    };
  }

  // Refresh Project Working Tree
  const refreshProjBtn = $('btn-refresh-project');
  if (refreshProjBtn && state.activeProject) {
    refreshProjBtn.onclick = async () => {
      await openProjectByPath(state.activeProject.path);
      showToast('Project status refreshed');
    };
  }

  // Create Checkpoint
  const createCpBtn = $('btn-create-checkpoint');
  const cpInput = $('checkpoint-msg-input');
  const handleCreateCheckpoint = async () => {
    if (!state.activeProject) return;
    const msg = cpInput ? cpInput.value.trim() : '';
    if (!msg) {
      showToast('Please enter a checkpoint description');
      if (cpInput) cpInput.focus();
      return;
    }
    createCpBtn.disabled = true;
    createCpBtn.textContent = 'Saving...';
    try {
      const res = await api.commitCheckpoint({
        projectPath: state.activeProject.path,
        message: msg
      });
      if (res && res.success) {
        showToast(`Checkpoint created: ${res.commit.commitHash.slice(0, 8)}`);
        await openProjectByPath(state.activeProject.path);
      } else {
        showToast(`Failed: ${res.error || 'Could not save checkpoint'}`);
      }
    } catch (err) {
      showToast(`Error: ${err.message}`);
    } finally {
      if (createCpBtn) {
        createCpBtn.disabled = false;
        createCpBtn.textContent = 'Save Checkpoint';
      }
    }
  };
  if (createCpBtn) createCpBtn.onclick = handleCreateCheckpoint;
  if (cpInput) {
    cpInput.onkeydown = (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleCreateCheckpoint();
      }
    };
  }

  // Discard Uncommitted Changes
  const discardBtn = $('btn-discard-changes');
  if (discardBtn && state.activeProject) {
    discardBtn.onclick = async () => {
      if (!state.activeProject.status || !state.activeProject.status.hasChanges) return;
      if (confirm('Discard all uncommitted timeline modifications? This will revert the project to the latest checkpoint on disk.')) {
        discardBtn.disabled = true;
        discardBtn.textContent = 'Discarding...';
        try {
          const res = await api.discardChanges(state.activeProject.path);
          if (res && res.success) {
            showToast('Uncommitted changes discarded. Project restored.');
            await openProjectByPath(state.activeProject.path);
          } else {
            showToast(`Discard failed: ${res.error || 'Unknown error'}`);
          }
        } catch (err) {
          showToast(`Error: ${err.message}`);
        } finally {
          if ($('btn-discard-changes')) {
            $('btn-discard-changes').disabled = false;
            $('btn-discard-changes').textContent = 'Discard';
          }
        }
      }
    };
  }

  // View Visual Diff Modal
  const diffBtn = $('btn-show-diff');
  const diffModal = $('modal-visual-diff');
  const diffOutput = $('diff-terminal-output');
  if (diffBtn && diffModal && state.activeProject) {
    diffBtn.onclick = async () => {
      diffModal.style.display = 'flex';
      if (diffOutput) diffOutput.textContent = 'Analyzing timeline and computing SMPTE frame diff...';
      try {
        const res = await api.getProjectDiff(state.activeProject.path);
        if (res && res.success && res.ascii) {
          if (diffOutput) diffOutput.textContent = res.ascii;
        } else {
          if (diffOutput) diffOutput.textContent = 'Working tree clean — No uncommitted timeline modifications detected.';
        }
      } catch (err) {
        if (diffOutput) diffOutput.textContent = 'Error computing visual diff: ' + err.message;
      }
    };
  }

  const closeDiffBtn = $('btn-close-diff-modal');
  const dismissDiffBtn = $('btn-dismiss-diff-modal');
  if (closeDiffBtn && diffModal) closeDiffBtn.onclick = () => { diffModal.style.display = 'none'; };
  if (dismissDiffBtn && diffModal) dismissDiffBtn.onclick = () => { diffModal.style.display = 'none'; };

  const openHtmlDiffBtn = $('btn-open-html-diff');
  if (openHtmlDiffBtn && state.activeProject) {
    openHtmlDiffBtn.onclick = () => {
      const url = `http://127.0.0.1:41793/api/desktop/diff/html?projectPath=${encodeURIComponent(state.activeProject.path)}`;
      api.openExternal(url);
    };
  }

  // Sync Creative Bridges
  const syncBridgesBtn = $('btn-sync-creative-bridges');
  if (syncBridgesBtn) {
    syncBridgesBtn.onclick = async () => {
      syncBridgesBtn.style.opacity = '0.5';
      try {
        await api.ensurePluginsInstalled();
        showToast('Creative bridges verified: Premiere Pro UXP & DaVinci Resolve scripts synchronized.');
        await scanEditors();
      } catch (err) {
        showToast('Bridge error: ' + err.message);
      } finally {
        syncBridgesBtn.style.opacity = '1';
      }
    };
  }

  // Publish to GitHub Modal Handlers
  const openPublishBtn = $('btn-open-publish-modal');
  const publishModal = $('modal-publish-repo');
  if (openPublishBtn && publishModal) {
    openPublishBtn.onclick = () => {
      publishModal.style.display = 'flex';
      const nameInput = $('input-publish-name');
      if (nameInput) nameInput.focus();
    };
  }

  const closePublishBtn = $('btn-close-publish-modal');
  const cancelPublishBtn = $('btn-cancel-publish-modal');
  if (closePublishBtn && publishModal) closePublishBtn.onclick = () => { publishModal.style.display = 'none'; };
  if (cancelPublishBtn && publishModal) cancelPublishBtn.onclick = () => { publishModal.style.display = 'none'; };

  const confirmPublishBtn = $('btn-confirm-publish');
  if (confirmPublishBtn && state.activeProject) {
    confirmPublishBtn.onclick = async () => {
      const nameInput = $('input-publish-name');
      const descInput = $('input-publish-desc');
      const privInput = $('input-publish-private');

      const repoName = nameInput ? nameInput.value.trim() : '';
      if (!repoName) {
        showToast('Please enter a repository name');
        if (nameInput) nameInput.focus();
        return;
      }

      confirmPublishBtn.disabled = true;
      confirmPublishBtn.textContent = 'Publishing to GitHub...';

      try {
        const res = await api.publishGitHub({
          projectPath: state.activeProject.path,
          repoName,
          description: descInput ? descInput.value.trim() : '',
          isPrivate: privInput ? privInput.checked : true
        });

        if (res && res.success) {
          if (publishModal) publishModal.style.display = 'none';
          showToast(`Published to GitHub: ${res.repoFullName}`);
          await openProjectByPath(state.activeProject.path);
        } else {
          showToast(`Publish failed: ${res.error || 'Unknown error'}`);
        }
      } catch (err) {
        showToast(`Publish error: ${err.message}`);
      } finally {
        if (confirmPublishBtn) {
          confirmPublishBtn.disabled = false;
          confirmPublishBtn.textContent = 'Publish Repository';
        }
      }
    };
  }

  // Remote Actions: Fetch, Pull, Push, Sync, Link
  const fetchBtn = $('btn-remote-fetch');
  if (fetchBtn && state.activeProject) {
    fetchBtn.onclick = async () => {
      fetchBtn.disabled = true;
      fetchBtn.innerHTML = `<div class="spinner" style="width: 10px; height: 10px;"></div><span>Fetching...</span>`;
      try {
        const res = await api.fetchRemote(state.activeProject.path);
        if (res && res.success) {
          showToast('Fetched updates from origin.');
          await openProjectByPath(state.activeProject.path);
        } else {
          showToast(`Fetch error: ${res.error || 'Failed'}`);
        }
      } catch (err) {
        showToast(`Fetch error: ${err.message}`);
      } finally {
        if ($('btn-remote-fetch')) {
          $('btn-remote-fetch').disabled = false;
          $('btn-remote-fetch').innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
            <span>Fetch origin</span>
          `;
        }
      }
    };
  }

  const pullBtn = $('btn-remote-pull');
  if (pullBtn && state.activeProject) {
    pullBtn.onclick = async () => {
      pullBtn.disabled = true;
      pullBtn.innerHTML = `<div class="spinner" style="width: 10px; height: 10px;"></div><span>Pulling...</span>`;
      try {
        const res = await api.pullRemote(state.activeProject.path);
        if (res && res.success) {
          showToast('Pull completed: Timeline updated from remote.');
          await openProjectByPath(state.activeProject.path);
        } else {
          showToast(`Pull error: ${res.error || 'Failed'}`);
        }
      } catch (err) {
        showToast(`Pull error: ${err.message}`);
      } finally {
        if ($('btn-remote-pull')) {
          $('btn-remote-pull').disabled = false;
        }
      }
    };
  }

  const pushBtn = $('btn-remote-push');
  if (pushBtn && state.activeProject) {
    pushBtn.onclick = async () => {
      pushBtn.disabled = true;
      pushBtn.innerHTML = `<div class="spinner" style="width: 10px; height: 10px;"></div><span>Pushing...</span>`;
      try {
        const res = await api.pushRemote(state.activeProject.path);
        if (res && res.success) {
          showToast('Push completed: Commits uploaded to GitHub.');
          await openProjectByPath(state.activeProject.path);
        } else {
          showToast(`Push error: ${res.error || 'Failed'}`);
        }
      } catch (err) {
        showToast(`Push error: ${err.message}`);
      } finally {
        if ($('btn-remote-push')) {
          $('btn-remote-push').disabled = false;
        }
      }
    };
  }

  const syncBtn = $('btn-remote-sync');
  if (syncBtn && state.activeProject) {
    syncBtn.onclick = async () => {
      syncBtn.disabled = true;
      syncBtn.innerHTML = `<div class="spinner" style="width: 10px; height: 10px;"></div><span>Syncing...</span>`;
      try {
        const res = await api.syncRemote(state.activeProject.path);
        if (res && res.success) {
          showToast('Sync complete: Reconciled with remote.');
          await openProjectByPath(state.activeProject.path);
        } else {
          showToast(`Sync error: ${res.error || 'Failed'}`);
        }
      } catch (err) {
        showToast(`Sync error: ${err.message}`);
      } finally {
        if ($('btn-remote-sync')) {
          $('btn-remote-sync').disabled = false;
        }
      }
    };
  }

  const openRemoteLinkBtn = $('btn-open-remote-link');
  if (openRemoteLinkBtn && state.activeProject && state.activeProject.remote) {
    openRemoteLinkBtn.onclick = () => {
      const repo = state.activeProject.remote.repoFullName;
      if (repo) {
        api.openExternal(`https://github.com/${repo}`);
      }
    };
  }

  // Restore Checkpoint
  document.querySelectorAll('.btn-restore-checkpoint').forEach(el => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const hash = el.getAttribute('data-hash');
      if (!state.activeProject) return;
      if (confirm(`Restore project to checkpoint ${hash.slice(0, 8)}? Any uncommitted changes on disk will be rolled back.`)) {
        try {
          const res = await api.restoreCheckpoint({
            projectPath: state.activeProject.path,
            commitHash: hash,
            force: true
          });
          if (res && res.success) {
            showToast(`Restored to checkpoint ${hash.slice(0, 8)}`);
            await openProjectByPath(state.activeProject.path);
          } else {
            showToast(`Restore failed: ${res.error || 'Unknown error'}`);
          }
        } catch (err) {
          showToast(`Restore error: ${err.message}`);
        }
      }
    };
  });
}

async function openProjectByPath(projectPath) {
  try {
    const details = await api.inspectProject(projectPath);
    if (details && details.success) {
      let remote = null;
      try {
        remote = await api.getRemoteInfo(projectPath);
      } catch (_) {}

      state.activeProject = {
        path: projectPath,
        projectFilePath: details.projectFilePath || projectPath,
        name: details.name || projectPath.split(/[/\\]/).pop(),
        type: details.type || 'generic',
        currentBranch: details.currentBranch || 'main',
        status: details.status || {},
        branches: details.branches || [],
        history: details.history || [],
        remote: (remote && remote.success) ? remote : null
      };
      state.trackedProjects = await api.getTrackedProjects();
      render();
      showToast(`Opened project: ${state.activeProject.name}`);
    } else {
      showToast(`Could not inspect project: ${details.error || 'Unknown error'}`);
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

async function scanEditors() {
  try {
    const list = await api.detectEditors();
    state.editors = Array.isArray(list) ? list : [];
    // Auto-install plugins silently for detected editors
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

// 6. Bootstrap
async function init() {
  try {
    const status = await api.getSetupStatus();
    
    if (status.auth && status.auth.hasToken && status.auth.user) {
      state.user = normalizeUser(status.auth.user);
      state.isSetupCompleted = true;
    } else {
      state.isSetupCompleted = Boolean(status.isSetupCompleted);
      if (status.auth && status.auth.user) {
        state.user = normalizeUser(status.auth.user);
      }
    }

    try {
      const eds = await api.detectEditors();
      state.editors = Array.isArray(eds) ? eds : [];
    } catch (_) {}

    try {
      const cfg = await api.getOAuthConfig();
      if (cfg) state.oauthConfig = cfg;
    } catch (_) {}

    try {
      const tracked = await api.getTrackedProjects();
      if (Array.isArray(tracked)) state.trackedProjects = tracked;
    } catch (_) {}

    render();

    // Register global outside click for popovers & dropdowns once
    document.addEventListener('click', (e) => {
      const pop = $('account-popover');
      const trigger = $('account-trigger-btn');
      if (pop && pop.style.display !== 'none') {
        if (!pop.contains(e.target) && (!trigger || !trigger.contains(e.target))) {
          pop.style.display = 'none';
        }
      }

      const pdd = $('topbar-project-dropdown');
      const pbtn = $('topbar-project-btn');
      if (pdd && pdd.style.display !== 'none') {
        if (!pdd.contains(e.target) && (!pbtn || !pbtn.contains(e.target))) {
          pdd.style.display = 'none';
        }
      }

      const bdd = $('topbar-branch-dropdown');
      const bbtn = $('topbar-branch-btn');
      if (bdd && bdd.style.display !== 'none') {
        if (!bdd.contains(e.target) && (!bbtn || !bbtn.contains(e.target))) {
          bdd.style.display = 'none';
        }
      }
    });

    // Silent background session verification & sync
    if (state.user && state.user.login) {
      api.refreshProfile().then(ref => {
        if (ref && ref.authenticated) {
          if (ref.user) state.user = normalizeUser(ref.user);
          state.isOffline = Boolean(ref.offline);
          updateAccountHeader();
          updateHeader(state.isOffline ? 'Offline (Local-First)' : 'Service Active', !state.isOffline);
    // Live Working Tree Poller: Auto-detects timeline modifications in real-time
    setInterval(async () => {
      if (state.activeProject && state.activeProject.path && !state.isCommitting) {
        try {
          const details = await api.inspectProject(state.activeProject.path);
          if (details && details.success) {
            const currentCount = state.activeProject.status && state.activeProject.status.changes ? state.activeProject.status.changes.length : 0;
            const newCount = details.status && details.status.changes ? details.status.changes.length : 0;
            const currentHistLen = state.activeProject.history ? state.activeProject.history.length : 0;
            const newHistLen = details.history ? details.history.length : 0;
            const branchChanged = (details.currentBranch || 'main') !== (state.activeProject.currentBranch || 'main');

            if (currentCount !== newCount || currentHistLen !== newHistLen || branchChanged) {
              state.activeProject.status = details.status || {};
              state.activeProject.branches = details.branches || [];
              state.activeProject.history = details.history || [];
              state.activeProject.currentBranch = details.currentBranch || 'main';
              render();
            }
          }
        } catch (_) {}
      }
    }, 2500);
  } catch (err) {
    console.error('Failed to initialize:', err);
    state.isSetupCompleted = false;
    state.step = 1;
    render();
  }
}

document.addEventListener('DOMContentLoaded', init);
