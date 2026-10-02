/**
 * FrameGit Desktop — First-Run Setup & Application Controller
 * Local-first architecture: all settings and credentials stay on the user's PC.
 */

'use strict';

// 1. API Adapter (Native Electron IPC with HTTP Fallback)
const api = window.framegit || {
  getSetupStatus: async () => {
    const res = await fetch('/api/setup/status');
    return res.json();
  },
  verifyGitHubToken: async (token) => {
    const res = await fetch('/api/setup/verify-github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    return res.json();
  },
  saveGitHubConfig: async (config) => {
    const res = await fetch('/api/setup/save-github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    return res.json();
  },
  skipGitHubConfig: async () => {
    const res = await fetch('/api/setup/skip-github', { method: 'POST' });
    return res.json();
  },
  detectEditors: async () => {
    const res = await fetch('/api/desktop/nle-detect');
    return res.json();
  },
  installPlugin: async (family) => {
    const res = await fetch('/api/desktop/deploy-plugins', { method: 'POST' });
    const data = await res.json();
    return { success: true, details: data };
  },
  configureStartup: async (enable) => {
    const res = await fetch('/api/desktop/configure-startup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable })
    });
    return res.json();
  },
  completeSetup: async (options) => {
    const res = await fetch('/api/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });
    return res.json();
  },
  resetSetup: async () => {
    const res = await fetch('/api/setup/reset', { method: 'POST' });
    return res.json();
  },
  openExternal: (url) => {
    window.open(url, '_blank');
    return Promise.resolve({ success: true });
  },
  platform: 'win32'
};

// 2. Application State
const state = {
  isSetupCompleted: false,
  step: 1, // 1: Welcome, 2: GitHub, 3: Editors, 4: Background Service, 5: Ready
  settings: {},
  gitHub: {
    token: '',
    verifying: false,
    verified: false,
    user: null,
    skipped: false,
    error: null
  },
  editors: {
    loading: false,
    scanned: false,
    list: [],
    installing: null,
    installedCount: 0
  },
  service: {
    autoStart: true
  }
};

// 3. UI Helpers
function $(id) {
  return document.getElementById(id);
}

function updateHeaderStatus(label, isOnline = false) {
  const container = $('header-status');
  if (!container) return;
  container.innerHTML = `
    <span class="status-dot ${isOnline ? 'online' : ''}"></span>
    <span class="status-label">${escapeHtml(label)}</span>
  `;
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

// 4. Wizard Renderer
function renderWizard() {
  const app = $('app');
  if (!app) return;

  if (state.isSetupCompleted) {
    renderDashboard(app);
    return;
  }

  updateHeaderStatus(`Setup Step ${state.step} of 5`, false);

  app.innerHTML = `
    <div class="wizard-box">
      <!-- Stepper Indicator -->
      <div class="wizard-stepper">
        <div class="step-indicator ${state.step === 1 ? 'active' : state.step > 1 ? 'completed' : ''}">
          <div class="step-bar"></div>
          <span class="step-title">1. Welcome</span>
        </div>
        <div class="step-indicator ${state.step === 2 ? 'active' : state.step > 2 ? 'completed' : ''}">
          <div class="step-bar"></div>
          <span class="step-title">2. GitHub</span>
        </div>
        <div class="step-indicator ${state.step === 3 ? 'active' : state.step > 3 ? 'completed' : ''}">
          <div class="step-bar"></div>
          <span class="step-title">3. Editors</span>
        </div>
        <div class="step-indicator ${state.step === 4 ? 'active' : state.step > 4 ? 'completed' : ''}">
          <div class="step-bar"></div>
          <span class="step-title">4. Background</span>
        </div>
        <div class="step-indicator ${state.step === 5 ? 'active' : ''}">
          <div class="step-bar"></div>
          <span class="step-title">5. Finish</span>
        </div>
      </div>

      <!-- Step Content -->
      <div class="wizard-content">
        ${getStepContentHtml()}
      </div>

      <!-- Footer Navigation -->
      <div class="wizard-footer">
        ${getStepFooterHtml()}
      </div>
    </div>
  `;

  attachStepEventListeners();
}

function getStepContentHtml() {
  switch (state.step) {
    case 1:
      return `
        <div class="wizard-title-group">
          <h2>Welcome to FrameGit</h2>
          <p>Local-First Git Version Control designed specifically for Video Editors & Motion Artists.</p>
        </div>

        <div class="info-card">
          <div class="info-icon">🔒</div>
          <div class="info-text">
            <h4>100% Local-First Architecture</h4>
            <p>Your video timelines, project sequences, and hardware-encrypted credentials are saved directly on your local machine. No footage or personal tokens are ever sent to unauthorized third-party servers.</p>
          </div>
        </div>

        <div class="info-card">
          <div class="info-icon">🎬</div>
          <div class="info-text">
            <h4>Premiere Pro & DaVinci Resolve</h4>
            <p>Seamlessly commit, branch, visual-diff, and restore creative sequences directly inside your editing workflow, with lightweight snapshots and fast background synchronization.</p>
          </div>
        </div>

        <div class="info-card">
          <div class="info-icon">🚀</div>
          <div class="info-text">
            <h4>Ready to Configure</h4>
            <p>This quick onboarding wizard will connect your GitHub account, detect your installed editing tools, and set up your background project tracker.</p>
          </div>
        </div>
      `;

    case 2:
      return `
        <div class="wizard-title-group">
          <h2>Configure GitHub</h2>
          <p>FrameGit uses GitHub to sync project commit graphs, branch refs, and lightweight sequence manifests with your team.</p>
        </div>

        ${state.gitHub.verified && state.gitHub.user ? `
          <div class="user-auth-card">
            <div class="user-auth-info">
              <img class="user-avatar" src="${escapeHtml(state.gitHub.user.avatar_url || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png')}" alt="User Avatar" />
              <div class="user-name-group">
                <h4>${escapeHtml(state.gitHub.user.name || state.gitHub.user.login)}</h4>
                <p>@${escapeHtml(state.gitHub.user.login)} • ${state.gitHub.user.public_repos || 0} repositories</p>
              </div>
            </div>
            <div class="auth-badge">
              ✓ Connected & Verified
            </div>
          </div>
        ` : `
          <div class="form-group">
            <div class="form-label">
              <span>Personal Access Token (classic or fine-grained)</span>
              <a href="#" id="link-create-token">Generate Token on GitHub ↗</a>
            </div>
            <div class="input-row">
              <input type="password" id="gh-token-input" class="text-input" placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value="${escapeHtml(state.gitHub.token)}" />
              <button class="btn btn-secondary" id="btn-verify-token" ${state.gitHub.verifying ? 'disabled' : ''}>
                ${state.gitHub.verifying ? '<div class="spinner"></div>' : 'Verify & Connect'}
              </button>
            </div>
            <p class="input-help">Requires <strong>repo</strong> and <strong>read:user</strong> scopes so FrameGit can create branches and push sequence commits.</p>
            ${state.gitHub.error ? `<p style="color: var(--text-danger); font-size: 13px; margin-top: 4px;">⚠ ${escapeHtml(state.gitHub.error)}</p>` : ''}
          </div>

          <div class="info-card">
            <div class="info-icon">🛡️</div>
            <div class="info-text">
              <h4>Hardware-Bound Encryption</h4>
              <p>Your token will be encrypted locally on this PC using AES-256-GCM via your OS credential vault. FrameGit never stores plaintext tokens.</p>
            </div>
          </div>
        `}
      `;

    case 3:
      return `
        <div class="wizard-title-group">
          <h2>Creative Editors Auto-Detection</h2>
          <p>FrameGit automatically scans your computer for installed NLE suites and deploys our timeline tracking plugins.</p>
        </div>

        <div class="editor-list" id="editor-list-container">
          ${renderEditorCardsHtml()}
        </div>
      `;

    case 4:
      return `
        <div class="wizard-title-group">
          <h2>Background Tracking Service</h2>
          <p>Configure background monitoring so FrameGit detects when your creative editors open and tracks project activity automatically.</p>
        </div>

        <div class="service-toggle-card">
          <div class="service-toggle-info">
            <h4>Automatic Background Tracker</h4>
            <p>Automatically detect when Adobe Premiere Pro or DaVinci Resolve is running and keep project timelines synchronized in the background without user intervention.</p>
          </div>
          <label class="switch">
            <input type="checkbox" id="chk-autostart" ${state.service.autoStart ? 'checked' : ''} />
            <span class="slider"></span>
          </label>
        </div>

        <div class="info-card">
          <div class="info-icon">📁</div>
          <div class="info-text">
            <h4>The .FrameGIT Project Directory</h4>
            <p>When you open an editing project, FrameGit will create a lightweight <code>.FrameGIT</code> folder inside the project directory to record sequence hashes, edit diffs, and local branch references.</p>
          </div>
        </div>

        <div class="info-card">
          <div class="info-icon">⚡</div>
          <div class="info-text">
            <h4>Low Resource Overhead</h4>
            <p>The background daemon runs on an ultra-lightweight heartbeat cycle, consuming zero GPU resources and minimal CPU memory while you edit.</p>
          </div>
        </div>
      `;

    case 5:
      return `
        <div class="wizard-title-group">
          <h2>Ready to Launch FrameGit</h2>
          <p>Review your local-first configuration. You can change these preferences at any time.</p>
        </div>

        <div class="summary-grid">
          <div class="summary-item">
            <div class="summary-label">Storage Architecture</div>
            <div class="summary-value">🔒 Local-First (100% on PC)</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">GitHub Integration</div>
            <div class="summary-value">
              ${state.gitHub.verified && state.gitHub.user ? `✓ @${escapeHtml(state.gitHub.user.login)}` : 'Offline / Local-Only Mode'}
            </div>
          </div>
          <div class="summary-item">
            <div class="summary-label">Detected Editors</div>
            <div class="summary-value">
              ${state.editors.list.length > 0 ? `✓ ${state.editors.list.length} Software Found` : 'Manual Setup Available'}
            </div>
          </div>
          <div class="summary-item">
            <div class="summary-label">Background Daemon</div>
            <div class="summary-value">${state.service.autoStart ? '✓ Enabled on Startup' : 'Manual Launch Only'}</div>
          </div>
        </div>

        <div class="info-card">
          <div class="info-icon">🎉</div>
          <div class="info-text">
            <h4>Setup Complete!</h4>
            <p>Click "Open FrameGit Desktop" below to enter the desktop app, view your tracked projects, and start versioning your video sequences.</p>
          </div>
        </div>
      `;

    default:
      return '';
  }
}

function renderEditorCardsHtml() {
  if (state.editors.loading) {
    return `
      <div class="loading-spinner-container">
        <div class="spinner"></div>
        <p>Scanning host operating system for Premiere Pro and DaVinci Resolve...</p>
      </div>
    `;
  }

  const list = state.editors.list || [];
  if (list.length === 0) {
    return `
      <div class="empty-state">
        <p>No supported editing software was detected in standard program directories.</p>
        <button class="btn btn-secondary btn-sm" id="btn-rescan-editors">Scan Again</button>
      </div>
    `;
  }

  return list.map(ed => {
    const isPremiere = ed.family === 'premiere';
    const isInstalled = ed.pluginInstalled;
    const isInstalling = state.editors.installing === ed.family;

    return `
      <div class="editor-card ${isInstalled ? 'installed' : ''}">
        <div class="editor-info">
          <div class="editor-icon ${isPremiere ? 'premiere' : 'resolve'}">
            ${isPremiere ? 'Pr' : 'Da'}
          </div>
          <div class="editor-text">
            <h4>
              ${escapeHtml(ed.name)}
              <span class="badge ${isInstalled ? 'badge-success' : 'badge-muted'}">
                ${isInstalled ? '✓ Extension Ready' : 'Detected'}
              </span>
            </h4>
            <p>${escapeHtml(ed.installPath || 'Standard Install Path')}</p>
          </div>
        </div>
        <div>
          ${isInstalled ? `
            <span style="color: var(--text-success); font-size: 13px; font-weight: 500;">Ready ✓</span>
          ` : `
            <button class="btn btn-secondary btn-sm btn-install-plugin" data-family="${escapeHtml(ed.family)}" ${isInstalling ? 'disabled' : ''}>
              ${isInstalling ? '<div class="spinner"></div>' : `Install ${isPremiere ? 'Panel' : 'Script'}`}
            </button>
          `}
        </div>
      </div>
    `;
  }).join('');
}

function getStepFooterHtml() {
  switch (state.step) {
    case 1:
      return `
        <div></div>
        <button class="btn btn-primary" id="btn-next-step">
          Configure FrameGit →
        </button>
      `;

    case 2:
      return `
        <button class="btn btn-subtle" id="btn-skip-github">
          Skip for now (Local-Only Mode)
        </button>
        <div style="display: flex; gap: 10px;">
          <button class="btn btn-secondary" id="btn-prev-step">Back</button>
          <button class="btn btn-primary" id="btn-next-step" ${(!state.gitHub.verified && !state.gitHub.skipped) ? 'disabled' : ''}>
            Continue →
          </button>
        </div>
      `;

    case 3:
      return `
        <button class="btn btn-secondary" id="btn-prev-step">Back</button>
        <div style="display: flex; gap: 10px;">
          <button class="btn btn-secondary" id="btn-rescan-editors">Rescan</button>
          <button class="btn btn-primary" id="btn-next-step">Continue →</button>
        </div>
      `;

    case 4:
      return `
        <button class="btn btn-secondary" id="btn-prev-step">Back</button>
        <button class="btn btn-primary" id="btn-next-step">Continue →</button>
      `;

    case 5:
      return `
        <button class="btn btn-secondary" id="btn-prev-step">Back</button>
        <button class="btn btn-accent" id="btn-finish-setup">
          🚀 Open FrameGit Desktop
        </button>
      `;

    default:
      return '';
  }
}

// 5. Event Listeners
function attachStepEventListeners() {
  const nextBtn = $('btn-next-step');
  const prevBtn = $('btn-prev-step');
  const finishBtn = $('btn-finish-setup');
  const skipGhBtn = $('btn-skip-github');
  const verifyTokenBtn = $('btn-verify-token');
  const createTokenLink = $('link-create-token');
  const rescanBtn = $('btn-rescan-editors');
  const chkAutostart = $('chk-autostart');

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      state.step++;
      if (state.step === 3 && !state.editors.scanned) {
        scanEditors();
      }
      renderWizard();
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      state.step = Math.max(1, state.step - 1);
      renderWizard();
    });
  }

  if (skipGhBtn) {
    skipGhBtn.addEventListener('click', async () => {
      state.gitHub.skipped = true;
      state.gitHub.verified = false;
      state.gitHub.user = null;
      try {
        await api.skipGitHubConfig();
      } catch (_) {}
      state.step = 3;
      if (!state.editors.scanned) {
        scanEditors();
      }
      renderWizard();
    });
  }

  if (createTokenLink) {
    createTokenLink.addEventListener('click', (e) => {
      e.preventDefault();
      api.openExternal('https://github.com/settings/tokens/new?scopes=repo,read:user&description=FrameGit+Desktop');
    });
  }

  if (verifyTokenBtn) {
    verifyTokenBtn.addEventListener('click', async () => {
      const input = $('gh-token-input');
      const token = input ? input.value.trim() : '';
      if (!token) return;

      state.gitHub.token = token;
      state.gitHub.verifying = true;
      state.gitHub.error = null;
      renderWizard();

      try {
        const res = await api.verifyGitHubToken(token);
        if (res.valid && res.user) {
          state.gitHub.verified = true;
          state.gitHub.skipped = false;
          state.gitHub.user = res.user;
          state.gitHub.error = null;

          // Save encrypted token locally
          await api.saveGitHubConfig({
            token,
            username: res.user.login,
            name: res.user.name,
            email: res.user.email,
            avatarUrl: res.user.avatar_url
          });
        } else {
          state.gitHub.verified = false;
          state.gitHub.error = res.error || 'Failed to authenticate with GitHub. Check your token.';
        }
      } catch (err) {
        state.gitHub.verified = false;
        state.gitHub.error = err.message || 'Network error verifying token.';
      } finally {
        state.gitHub.verifying = false;
        renderWizard();
      }
    });
  }

  if (rescanBtn) {
    rescanBtn.addEventListener('click', () => {
      scanEditors();
    });
  }

  if (chkAutostart) {
    chkAutostart.addEventListener('change', (e) => {
      state.service.autoStart = e.target.checked;
    });
  }

  // Plugin installer buttons
  document.querySelectorAll('.btn-install-plugin').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const family = e.currentTarget.getAttribute('data-family');
      if (!family) return;

      state.editors.installing = family;
      renderWizard();

      try {
        await api.installPlugin(family);
        // Refresh editor status
        await scanEditors();
      } catch (err) {
        alert(`Failed to install ${family} integration: ` + err.message);
      } finally {
        state.editors.installing = null;
        renderWizard();
      }
    });
  });

  if (finishBtn) {
    finishBtn.addEventListener('click', async () => {
      try {
        await api.configureStartup(state.service.autoStart);
        await api.completeSetup({
          autoStartService: state.service.autoStart,
          plugins: {
            premiere: state.editors.list.some(e => e.family === 'premiere' && e.pluginInstalled),
            resolve: state.editors.list.some(e => e.family === 'resolve' && e.pluginInstalled)
          }
        });
        state.isSetupCompleted = true;
        renderWizard();
      } catch (err) {
        alert('Error completing setup: ' + err.message);
      }
    });
  }
}

async function scanEditors() {
  state.editors.loading = true;
  renderWizard();

  try {
    const list = await api.detectEditors();
    state.editors.list = Array.isArray(list) ? list : [];
    state.editors.scanned = true;
  } catch (err) {
    console.error('Failed to detect editors:', err);
    state.editors.list = [];
  } finally {
    state.editors.loading = false;
    renderWizard();
  }
}

// 6. Main Dashboard View (Post-Setup)
function renderDashboard(app) {
  updateHeaderStatus('FrameGit Service Online', true);

  const user = state.gitHub.user || (state.settings && state.settings.user) || {};
  const username = user.username || user.login || 'Editor';

  app.innerHTML = `
    <div class="dashboard-box">
      <div class="dashboard-header">
        <div class="dashboard-welcome">
          <h2>Welcome back, ${escapeHtml(username)}</h2>
          <p>FrameGit background service is active and watching for creative project timelines.</p>
        </div>
        <div class="dashboard-actions">
          <button class="btn btn-secondary btn-sm" id="btn-reopen-setup">⚙ Setup Settings</button>
        </div>
      </div>

      <div class="dashboard-grid">
        <div class="dashboard-card">
          <div class="card-title">
            <span>Tracked Editing Projects</span>
            <span class="badge badge-muted">0 Active</span>
          </div>
          <div class="empty-state">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--text-muted);">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
            <p>Open any project in Adobe Premiere Pro or DaVinci Resolve with FrameGit enabled.</p>
            <p class="input-help">The background daemon will automatically detect your timeline and generate a local <code>.FrameGIT</code> tracking repository.</p>
          </div>
        </div>

        <div class="dashboard-card">
          <div class="card-title">
            <span>Editor Integrations</span>
            <span class="badge badge-success">Active</span>
          </div>
          <div class="editor-list">
            ${(state.editors.list && state.editors.list.length > 0) ? state.editors.list.map(ed => `
              <div class="editor-card ${ed.pluginInstalled ? 'installed' : ''}" style="padding: 10px 14px;">
                <div class="editor-info" style="gap: 10px;">
                  <div class="editor-icon ${ed.family === 'premiere' ? 'premiere' : 'resolve'}" style="width: 28px; height: 28px; font-size: 11px;">
                    ${ed.family === 'premiere' ? 'Pr' : 'Da'}
                  </div>
                  <div class="editor-text">
                    <h4 style="font-size: 13px;">${escapeHtml(ed.name)}</h4>
                  </div>
                </div>
                <span class="badge ${ed.pluginInstalled ? 'badge-success' : 'badge-muted'}">
                  ${ed.pluginInstalled ? 'Connected' : 'Detected'}
                </span>
              </div>
            `).join('') : `
              <p class="input-help">No editors detected.</p>
            `}
          </div>
        </div>
      </div>
    </div>
  `;

  const rerunBtn = $('btn-reopen-setup');
  if (rerunBtn) {
    rerunBtn.addEventListener('click', async () => {
      try {
        await api.resetSetup();
        state.isSetupCompleted = false;
        state.step = 1;
        renderWizard();
      } catch (err) {
        alert('Failed to reset setup: ' + err.message);
      }
    });
  }
}

// 7. Initial Bootstrap
async function init() {
  try {
    const status = await api.getSetupStatus();
    state.isSetupCompleted = Boolean(status.isSetupCompleted);
    state.settings = status.settings || {};

    if (status.auth && status.auth.hasToken) {
      state.gitHub.verified = true;
      state.gitHub.user = status.auth.user;
    }

    if (state.settings.autoStartBackgroundService !== undefined) {
      state.service.autoStart = state.settings.autoStartBackgroundService;
    }

    // Pre-scan editors
    try {
      const eds = await api.detectEditors();
      state.editors.list = Array.isArray(eds) ? eds : [];
      state.editors.scanned = true;
    } catch (_) {}

    renderWizard();
  } catch (err) {
    console.error('Error during initial status check:', err);
    // Default to wizard step 1
    state.isSetupCompleted = false;
    state.step = 1;
    renderWizard();
  }
}

// Start
document.addEventListener('DOMContentLoaded', init);
