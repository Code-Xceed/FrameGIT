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
  openExternal: (url) => { window.open(url, '_blank'); return Promise.resolve({ success: true }); }
};

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
  oauthConfig: { clientId: '', hasSecret: false }
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
    renderDashboard(app);
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

// 4. Post-Setup Minimal Dashboard
function renderDashboard(app) {
  updateHeader('Service Active', true);

  const u = state.user || {};
  const name = u.name || u.login || 'Editor';

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
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="color: var(--text-muted);">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <p>No active project open in Premiere Pro or DaVinci Resolve.</p>
          <p style="font-size: 11px;">Open any project to automatically track timeline checkpoints.</p>
        </div>

        <button class="btn btn-subtle" id="btn-reset-setup">Re-run Setup</button>
      </div>
    </div>
  `;

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
    state.isSetupCompleted = Boolean(status.isSetupCompleted);

    if (status.auth && status.auth.hasToken && status.auth.user) {
      state.user = status.auth.user;
    }

    try {
      const eds = await api.detectEditors();
      state.editors = Array.isArray(eds) ? eds : [];
    } catch (_) {}

    try {
      const cfg = await api.getOAuthConfig();
      if (cfg) state.oauthConfig = cfg;
    } catch (_) {}

    render();
  } catch (err) {
    console.error('Failed to initialize:', err);
    state.isSetupCompleted = false;
    state.step = 1;
    render();
  }
}

document.addEventListener('DOMContentLoaded', init);
