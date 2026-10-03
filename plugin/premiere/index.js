// FrameGit Adobe Premiere Pro UXP Panel Controller
// Provides VS Code Source Control (SCM) experience directly inside Adobe Premiere Pro.

class FrameGitClient {
  constructor(port = 41793, token = '') {
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.token = token;
    this.reqId = 1;
  }

  setToken(token) {
    this.token = token;
  }

  async call(action, params = {}) {
    const res = await fetch(`${this.baseUrl}/api/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`
      },
      body: JSON.stringify({
        id: `rpc-${this.reqId++}`,
        action,
        params
      })
    });

    const data = await res.json();
    if (data.error) {
      throw new Error(data.error.message || JSON.stringify(data.error));
    }
    return data.result;
  }

  async checkHealth() {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      if (res.ok) return true;
    } catch (_) {}
    try {
      const res2 = await fetch(`${this.baseUrl}/api/setup/status`);
      return res2.ok;
    } catch (_) {
      return false;
    }
  }
}

// In real UXP panel environment, window and document are available
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  let initialToken = '';
  try {
    if (typeof localStorage !== 'undefined') {
      initialToken = localStorage.getItem('framegit_agent_token') || '';
    }
  } catch (_) {}

  const client = new FrameGitClient(41793, initialToken);

  // DOM Elements
  const projNameLabel = document.getElementById('projNameLabel');
  const branchSelector = document.getElementById('branchSelector');
  const btnNewBranch = document.getElementById('btnNewBranch');
  const untrackedNotice = document.getElementById('untrackedNotice');
  const untrackedText = document.getElementById('untrackedText');
  const btnTrackActiveProject = document.getElementById('btnTrackActiveProject');
  const commitMessageInput = document.getElementById('commitMessageInput');
  const btnCommit = document.getElementById('btnCommit');
  const btnSync = document.getElementById('btnSync');
  const btnPull = document.getElementById('btnPull');
  const btnPush = document.getElementById('btnPush');
  const btnRefresh = document.getElementById('btnRefresh');
  const btnDiff = document.getElementById('btnDiff');
  const btnDiscard = document.getElementById('btnDiscard');
  const changesCountBadge = document.getElementById('changesCountBadge');
  const changesListContainer = document.getElementById('changesListContainer');
  const historyCountBadge = document.getElementById('historyCountBadge');
  const historyListContainer = document.getElementById('historyListContainer');
  const statusDot = document.getElementById('statusDot');
  const statusLabel = document.getElementById('statusLabel');
  const remoteSyncLabel = document.getElementById('remoteSyncLabel');

  let activeProjectPath = null;

  const csInterface = (typeof CSInterface !== 'undefined') ? new CSInterface() : null;

  async function getPremiereActiveProjectPath() {
    try {
      if (typeof app !== 'undefined' && app.project && app.project.path && app.project.path.trim()) {
        return app.project.path.trim();
      }
    } catch (_) {}

    if (csInterface && typeof window !== 'undefined' && window.__adobe_cep__) {
      return new Promise((resolve) => {
        csInterface.evalScript('(function() { try { return (app.project && app.project.path) ? app.project.path : ""; } catch(e) { return ""; } })()', (res) => {
          if (res && res !== 'ERR_NO_CEP' && res !== 'EvalScript error.' && res.trim()) {
            resolve(res.trim());
          } else {
            resolve(null);
          }
        });
      });
    }
    return null;
  }

  async function getPremiereActiveProjectName() {
    try {
      if (typeof app !== 'undefined' && app.project && app.project.name && app.project.name.trim()) {
        return app.project.name.trim();
      }
    } catch (_) {}

    if (csInterface && typeof window !== 'undefined' && window.__adobe_cep__) {
      return new Promise((resolve) => {
        csInterface.evalScript('(function() { try { return (app.project && app.project.name) ? app.project.name : ""; } catch(e) { return ""; } })()', (res) => {
          if (res && res !== 'ERR_NO_CEP' && res !== 'EvalScript error.' && res.trim()) {
            resolve(res.trim());
          } else {
            resolve(null);
          }
        });
      });
    }
    return null;
  }

  async function flushPremiereProjectSave() {
    try {
      if (typeof app !== 'undefined' && app.project && typeof app.project.save === 'function') {
        app.project.save();
        return;
      }
    } catch (_) {}

    if (csInterface && typeof window !== 'undefined' && window.__adobe_cep__) {
      return new Promise((resolve) => {
        csInterface.evalScript('(function() { try { if (app.project && typeof app.project.save === "function") { app.project.save(); return "1"; } } catch(e){} return "0"; })()', () => resolve());
      });
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function refreshUI() {
    const premierePath = await getPremiereActiveProjectPath();
    const premiereName = await getPremiereActiveProjectName();

    try {
      const isOnline = await client.checkHealth();
      if (!isOnline) {
        statusDot.className = 'status-dot offline';
        statusLabel.textContent = 'FrameGit Desktop Offline';
        return;
      }

      statusDot.className = 'status-dot';
      statusLabel.textContent = 'FrameGit Connected';

      const status = await client.call('project.status', {
        projectPath: premierePath || activeProjectPath
      });

      if (status && status.projectPath) {
        activeProjectPath = status.projectPath;
      }

      const displayName = premiereName || (status.projectName || (activeProjectPath ? activeProjectPath.split(/[/\\]/).pop() : 'Active Project'));
      projNameLabel.textContent = displayName;

      // Check if project is tracked
      untrackedNotice.style.display = 'none';

      // Update Branches
      const branches = status.branches || [];
      branchSelector.innerHTML = branches.map(b => `
        <option value="${escapeHtml(b.name)}" ${b.isCurrent ? 'selected' : ''}>🌿 ${escapeHtml(b.name)}</option>
      `).join('');

      // Update Changes
      const changes = (status.status && status.status.changes) || status.changes || [];
      const changesCount = changes.length;
      changesCountBadge.textContent = changesCount;

      if (changesCount > 0) {
        changesListContainer.innerHTML = changes.map(ch => {
          const type = (ch.type || 'MOD').toUpperCase();
          let badgeClass = 'mod';
          if (type.includes('ADD')) badgeClass = 'add';
          else if (type.includes('DEL')) badgeClass = 'del';
          else if (type.includes('FX') || type.includes('COLOR')) badgeClass = 'fx';

          const text = ch.description || ch.item || 'Timeline modification';
          return `
            <div class="scm-change-row" data-change="${escapeHtml(text)}">
              <div class="scm-change-info">
                <span class="scm-badge ${badgeClass}">${escapeHtml(type.slice(0, 3))}</span>
                <span title="${escapeHtml(text)}">${escapeHtml(text)}</span>
              </div>
            </div>
          `;
        }).join('');
        btnCommit.disabled = !commitMessageInput.value.trim();
      } else {
        changesListContainer.innerHTML = `<div style="color: var(--vscode-text-muted); padding: 12px; text-align: center;">No changes detected</div>`;
        btnCommit.disabled = true;
      }

      // Update History
      const history = status.history || [];
      historyCountBadge.textContent = history.length;
      if (history.length > 0) {
        historyListContainer.innerHTML = history.map(c => {
          const sha = (c.commitHash || c.hash || '').slice(0, 8);
          const author = (c.author && c.author.name) || 'Editor';
          const time = new Date(c.committedAt || c.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          return `
            <div class="scm-commit-row">
              <div class="scm-commit-header">
                <span class="scm-commit-sha">${sha}</span>
                <span class="scm-commit-time">${time}</span>
              </div>
              <div class="scm-commit-msg">${escapeHtml(c.message || 'Timeline checkpoint')}</div>
              <div class="scm-commit-footer">
                <span class="scm-commit-author">${escapeHtml(author)}</span>
                <button class="btn-restore-small btn-restore-item" data-hash="${escapeHtml(c.commitHash || c.hash)}">Restore</button>
              </div>
            </div>
          `;
        }).join('');

        document.querySelectorAll('.btn-restore-item').forEach(btn => {
          btn.onclick = async () => {
            const h = btn.getAttribute('data-hash');
            if (confirm(`Restore Premiere project to checkpoint ${h.slice(0, 8)}? Any uncommitted changes on disk will be rolled back.`)) {
              try {
                await client.call('project.restore', {
                  projectPath: activeProjectPath,
                  commitHash: h,
                  force: true
                });
                alert(`Project restored to checkpoint ${h.slice(0, 8)}.`);
                await refreshUI();
              } catch (err) {
                alert(`Restore failed: ${err.message}`);
              }
            }
          };
        });
      } else {
        historyListContainer.innerHTML = `<div style="color: var(--vscode-text-muted); padding: 12px; text-align: center;">No checkpoints committed yet</div>`;
      }

      // Remote fetch status
      try {
        const remote = await client.call('sync.fetch', { projectPath: activeProjectPath });
        if (remote && remote.isLinked) {
          remoteSyncLabel.textContent = `Remote: ${remote.repoFullName || 'GitHub'} (↑${remote.ahead || 0} ↓${remote.behind || 0})`;
        } else {
          remoteSyncLabel.textContent = 'Local-first';
        }
      } catch (_) {
        remoteSyncLabel.textContent = 'Local-first';
      }

    } catch (err) {
      statusDot.className = 'status-dot offline';
      statusLabel.textContent = 'FrameGit Server Offline';
    }
  }

  // Handle Commit Checkpoint
  async function handleCommit() {
    const msg = commitMessageInput.value.trim();
    if (!msg) return;

    btnCommit.disabled = true;
    btnCommit.textContent = 'Committing...';
    try {
      // Flush edits in Premiere Pro to disk first
      await flushPremiereProjectSave();

      await client.call('project.commit', {
        projectPath: activeProjectPath,
        message: msg
      });

      commitMessageInput.value = '';
      await refreshUI();
    } catch (err) {
      alert(`Commit failed: ${err.message}`);
    } finally {
      btnCommit.disabled = false;
      btnCommit.textContent = '✓ Commit Checkpoint';
    }
  }

  // Event Listeners
  commitMessageInput?.addEventListener('input', () => {
    btnCommit.disabled = !commitMessageInput.value.trim();
  });

  commitMessageInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleCommit();
    }
  });

  btnCommit?.addEventListener('click', handleCommit);

  branchSelector?.addEventListener('change', async (e) => {
    const targetBranch = e.target.value;
    try {
      await client.call('branch.switch', {
        projectPath: activeProjectPath,
        name: targetBranch
      });
      await refreshUI();
    } catch (err) {
      alert(`Cannot switch branch: ${err.message}`);
      await refreshUI();
    }
  });

  btnNewBranch?.addEventListener('click', async () => {
    const branchName = prompt('Enter new branch name (e.g. director-cut, color-grade):');
    if (branchName && branchName.trim()) {
      try {
        await client.call('branch.create', {
          projectPath: activeProjectPath,
          name: branchName.trim()
        });
        await client.call('branch.switch', {
          projectPath: activeProjectPath,
          name: branchName.trim()
        });
        await refreshUI();
      } catch (err) {
        alert(`Error creating branch: ${err.message}`);
      }
    }
  });

  btnRefresh?.addEventListener('click', async () => {
    btnRefresh.textContent = '…';
    try {
      await flushPremiereProjectSave();
      await refreshUI();
    } finally {
      btnRefresh.textContent = '↻';
    }
  });

  btnDiff?.addEventListener('click', async () => {
    try {
      const diff = await client.call('project.diff', { projectPath: activeProjectPath });
      if (diff && diff.ascii) {
        alert(`=== TIMELINE VISUAL DIFF ===\n\n${diff.ascii}`);
      } else {
        alert('Working tree clean — No modifications detected.');
      }
    } catch (err) {
      alert(`Error computing diff: ${err.message}`);
    }
  });

  btnDiscard?.addEventListener('click', async () => {
    if (confirm('Discard all uncommitted timeline modifications and roll back to the last checkpoint?')) {
      try {
        await client.call('project.discard', { projectPath: activeProjectPath });
        alert('Modifications discarded. Timeline restored to clean state.');
        await refreshUI();
      } catch (err) {
        alert(`Discard failed: ${err.message}`);
      }
    }
  });

  btnSync?.addEventListener('click', async () => {
    btnSync.disabled = true;
    btnSync.textContent = 'Syncing...';
    try {
      const res = await client.call('sync.sync', { projectPath: activeProjectPath });
      alert('Synchronized with remote repository successfully.');
      await refreshUI();
    } catch (err) {
      alert(`Sync failed: ${err.message}`);
    } finally {
      btnSync.disabled = false;
      btnSync.textContent = '☁ Sync';
    }
  });

  btnPull?.addEventListener('click', async () => {
    btnPull.disabled = true;
    btnPull.textContent = 'Pulling...';
    try {
      await client.call('sync.pull', { projectPath: activeProjectPath });
      alert('Pulled remote updates successfully.');
      await refreshUI();
    } catch (err) {
      alert(`Pull failed: ${err.message}`);
    } finally {
      btnPull.disabled = false;
      btnPull.textContent = '↓ Pull';
    }
  });

  btnPush?.addEventListener('click', async () => {
    btnPush.disabled = true;
    btnPush.textContent = 'Pushing...';
    try {
      const res = await client.call('sync.push', { projectPath: activeProjectPath });
      alert(`Pushed checkpoint manifests to remote! (Commit: ${(res.gitSha || '').slice(0, 8)})`);
      await refreshUI();
    } catch (err) {
      alert(`Push failed: ${err.message}`);
    } finally {
      btnPush.disabled = false;
      btnPush.textContent = '↑ Push';
    }
  });

  btnTrackActiveProject?.addEventListener('click', async () => {
    const p = getPremiereActiveProjectPath();
    if (p) {
      try {
        await client.call('project.track', { projectPath: p });
        activeProjectPath = p;
        await refreshUI();
      } catch (err) {
        alert(`Error tracking project: ${err.message}`);
      }
    }
  });

  // Initial load & Polling interval
  refreshUI();
  setInterval(refreshUI, 4000);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FrameGitClient };
}
