// FrameGit Adobe Premiere Pro UXP Panel Controller
// Connects Premiere Pro DOM context to FrameGit Local Agent daemon via authenticated JSON-RPC.

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
      return res.ok;
    } catch (_) {
      return false;
    }
  }
}

// In real UXP panel environment, window and document are available.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  let initialToken = '';
  try {
    if (typeof localStorage !== 'undefined') {
      initialToken = localStorage.getItem('framegit_agent_token') || '';
    }
  } catch (_) {}

  // If running in UXP host with Node/filesystem access, attempt reading agent.auth
  if (!initialToken && typeof require === 'function') {
    try {
      const uxpFs = require('fs');
      if (uxpFs && typeof uxpFs.readFileSync === 'function') {
        for (const authPath of ['.framegit/agent.auth', '../.framegit/agent.auth']) {
          if (uxpFs.existsSync && uxpFs.existsSync(authPath)) {
            const raw = uxpFs.readFileSync(authPath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && parsed.token) {
              initialToken = parsed.token;
              break;
            }
          }
        }
      }
    } catch (_) {}
  }

  const client = new FrameGitClient(41793, initialToken);

  const statusPill = document.getElementById('statusPill');
  const branchSelect = document.getElementById('branchSelect');
  const changesBadge = document.getElementById('changesBadge');
  const changesList = document.getElementById('changesList');
  const commitInput = document.getElementById('commitInput');
  const commitBtn = document.getElementById('commitBtn');
  const historyList = document.getElementById('historyList');
  const pushBtn = document.getElementById('pushBtn');
  const pullBtn = document.getElementById('pullBtn');

  async function refreshUI() {
    try {
      const status = await client.call('project.status');
      statusPill.textContent = 'Connected';
      statusPill.className = 'status-pill';

      // Update changes list
      changesBadge.textContent = status.changes ? status.changes.length : 0;
      if (status.hasChanges && status.changes.length > 0) {
        changesList.innerHTML = status.changes.map(c => `
          <div class="change-item">
            <span class="change-tag tag-${c.type.split('_')[0]}">${c.type.split('_')[0]}</span>
            <span>${c.description}</span>
          </div>
        `).join('');
        commitBtn.disabled = !commitInput.value.trim();
      } else {
        changesList.innerHTML = `<div style="color: var(--text-muted); font-size: 11px; text-align: center; padding: 12px;">No uncommitted changes</div>`;
        commitBtn.disabled = true;
      }

      // Update branches
      const branches = await client.call('branch.list');
      branchSelect.innerHTML = branches.map(b => `
        <option value="${b.name}" ${b.isCurrent ? 'selected' : ''}>${b.name}</option>
      `).join('');

      // Update history
      const history = await client.call('project.history', { limit: 15 });
      historyList.innerHTML = history.map(h => `
        <div class="history-item">
          <div class="history-header">
            <span class="history-sha">${h.commit_hash.slice(0, 8)}</span>
            <span class="history-time">${new Date(h.committed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div class="history-msg">${h.message}</div>
          <button class="btn-restore" data-hash="${h.commit_hash}">Restore</button>
        </div>
      `).join('');

      // Attach restore listeners
      document.querySelectorAll('.btn-restore').forEach(btn => {
        btn.onclick = async () => {
          const hash = btn.getAttribute('data-hash');
          if (confirm(`Restore project to commit ${hash.slice(0, 8)}?`)) {
            await client.call('project.restore', { commitHash: hash, force: true });
            alert(`Project restored to commit ${hash.slice(0, 8)}.`);
            await refreshUI();
          }
        };
      });
    } catch (err) {
      statusPill.textContent = 'Disconnected';
      statusPill.className = 'status-pill offline';
    }
  }

  commitInput?.addEventListener('input', () => {
    commitBtn.disabled = !commitInput.value.trim();
  });

  commitBtn?.addEventListener('click', async () => {
    const msg = commitInput.value.trim();
    if (!msg) return;

    commitBtn.disabled = true;
    commitBtn.textContent = 'Committing...';
    try {
      // In Adobe Premiere, flush project edits to disk first
      if (typeof app !== 'undefined' && app.project) {
        app.project.save();
      }
      await client.call('project.commit', { message: msg });
      commitInput.value = '';
      await refreshUI();
    } catch (err) {
      alert(`Commit failed: ${err.message}`);
    } finally {
      commitBtn.textContent = 'Commit';
    }
  });

  branchSelect?.addEventListener('change', async (e) => {
    const targetBranch = e.target.value;
    try {
      await client.call('branch.switch', { name: targetBranch });
      await refreshUI();
    } catch (err) {
      alert(`Cannot switch branch: ${err.message}`);
      await refreshUI();
    }
  });

  pushBtn?.addEventListener('click', async () => {
    pushBtn.disabled = true;
    pushBtn.textContent = 'Pushing...';
    try {
      const res = await client.call('sync.push');
      alert(`Pushed successfully! (${res.uploadedChunks} chunks uploaded)`);
    } catch (err) {
      alert(`Push failed: ${err.message}`);
    } finally {
      pushBtn.disabled = false;
      pushBtn.textContent = 'Push';
    }
  });

  pullBtn?.addEventListener('click', async () => {
    pullBtn.disabled = true;
    pullBtn.textContent = 'Pulling...';
    try {
      const res = await client.call('sync.pull');
      alert(`Pulled successfully! (Commit: ${res.newCommitHash.slice(0, 8)})`);
      await refreshUI();
    } catch (err) {
      alert(`Pull failed: ${err.message}`);
    } finally {
      pullBtn.disabled = false;
      pullBtn.textContent = 'Pull';
    }
  });

  // Auto-refresh interval (every 3 seconds)
  setInterval(refreshUI, 3000);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FrameGitClient };
}
