// FrameGit Desktop Application — Frontend Controller
// Connects UI tabs, interactive visual diff, NLE detection wizard, and project catalog.

'use strict';

(function () {
  const API_BASE = window.location.origin.includes('http') ? window.location.origin : 'http://127.0.0.1:41793';
  let activeProject = null;
  let allProjects = [];

  class FrameGitDesktopApp {
    constructor() {
      this.initTabs();
      this.initEventListeners();
      this.refreshAll();
      setInterval(() => this.pollHeartbeat(), 3000);
    }

    // Tab Navigation
    initTabs() {
      const tabs = document.querySelectorAll('.nav-tab');
      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));

          tab.classList.add('active');
          const targetView = document.getElementById(tab.getAttribute('data-view'));
          if (targetView) targetView.classList.add('active');

          if (tab.getAttribute('data-view') === 'viewWizard') {
            this.scanNLEs();
          } else if (tab.getAttribute('data-view') === 'viewDiff') {
            this.refreshVisualDiff();
          }
        });
      });
    }

    initEventListeners() {
      // Create Commit button
      const commitInput = document.getElementById('commitMsgInput');
      const commitBtn = document.getElementById('btnCreateCommit');
      commitInput?.addEventListener('input', () => {
        commitBtn.disabled = !commitInput.value.trim() || !activeProject;
      });

      commitBtn?.addEventListener('click', async () => {
        const msg = commitInput.value.trim();
        if (!msg || !activeProject) return;

        commitBtn.disabled = true;
        commitBtn.textContent = 'Committing...';
        try {
          await this.callRpc('project.commit', { projectPath: activeProject.path, message: msg });
          commitInput.value = '';
          await this.refreshProjectDetails(activeProject.path);
        } catch (err) {
          alert(`Commit failed: ${err.message}`);
        } finally {
          commitBtn.textContent = 'Commit to Current Branch';
          commitBtn.disabled = !commitInput.value.trim();
        }
      });

      // Branch Switcher
      const branchSelect = document.getElementById('branchSelect');
      branchSelect?.addEventListener('change', async (e) => {
        const newBranch = e.target.value;
        if (!activeProject) return;
        try {
          await this.callRpc('branch.switch', { projectPath: activeProject.path, name: newBranch });
          await this.refreshProjectDetails(activeProject.path);
        } catch (err) {
          alert(`Failed to switch branch: ${err.message}`);
          await this.refreshProjectDetails(activeProject.path);
        }
      });

      // New Branch Button
      document.getElementById('btnNewBranch')?.addEventListener('click', async () => {
        if (!activeProject) return;
        const branchName = prompt('Enter new branch name:');
        if (branchName) {
          try {
            await this.callRpc('branch.create', { projectPath: activeProject.path, name: branchName.trim() });
            await this.callRpc('branch.switch', { projectPath: activeProject.path, name: branchName.trim() });
            await this.refreshProjectDetails(activeProject.path);
          } catch (err) {
            alert(`Failed to create branch: ${err.message}`);
          }
        }
      });

      // Push Remote
      document.getElementById('btnPushRemote')?.addEventListener('click', async () => {
        if (!activeProject) return;
        const btn = document.getElementById('btnPushRemote');
        btn.disabled = true;
        btn.textContent = 'Pushing...';
        try {
          const res = await this.callRpc('sync.push', { projectPath: activeProject.path });
          alert(`Successfully pushed branch to remote! (${res.uploadedChunks || 0} chunks uploaded)`);
          await this.refreshProjectDetails(activeProject.path);
        } catch (err) {
          alert(`Push failed: ${err.message}`);
        } finally {
          btn.disabled = false;
          btn.textContent = '↑ Push';
        }
      });

      // Pull Remote
      document.getElementById('btnPullRemote')?.addEventListener('click', async () => {
        if (!activeProject) return;
        const btn = document.getElementById('btnPullRemote');
        btn.disabled = true;
        btn.textContent = 'Pulling...';
        try {
          const res = await this.callRpc('sync.pull', { projectPath: activeProject.path });
          alert(`Successfully pulled changes! (${res.pulledCommits || 0} commits, ${res.downloadedChunks || 0} chunks)`);
          await this.refreshProjectDetails(activeProject.path);
        } catch (err) {
          alert(`Pull failed: ${err.message}`);
        } finally {
          btn.disabled = false;
          btn.textContent = '↓ Pull';
        }
      });

      // Add Project
      document.getElementById('btnOpenLocalProject')?.addEventListener('click', async () => {
        const projPath = prompt('Enter absolute path to project workspace folder:');
        if (projPath) {
          try {
            await this.apiCall('/api/desktop/projects/register', 'POST', { path: projPath.trim() });
            await this.refreshProjectsList();
          } catch (err) {
            alert(`Failed to register project: ${err.message}`);
          }
        }
      });

      // Refresh Changes Button
      document.getElementById('btnRefreshChanges')?.addEventListener('click', () => {
        if (activeProject) this.refreshProjectDetails(activeProject.path);
      });

      // Export Diff Button
      document.getElementById('btnExportDiffHtml')?.addEventListener('click', () => {
        if (activeProject) {
          window.open(`${API_BASE}/api/desktop/diff/html?projectPath=${encodeURIComponent(activeProject.path)}`, '_blank');
        }
      });
    }

    // Wizard Step Navigation
    nextWizardStep(stepNum) {
      document.querySelectorAll('.step-indicator').forEach((ind, idx) => {
        ind.classList.remove('active', 'completed');
        if (idx + 1 === stepNum) ind.classList.add('active');
        if (idx + 1 < stepNum) ind.classList.add('completed');
      });

      document.querySelectorAll('.wizard-step-content').forEach(c => c.classList.remove('active'));
      const activeContent = document.getElementById(`wizardStep${stepNum}`);
      if (activeContent) activeContent.classList.add('active');

      if (stepNum === 2) {
        this.scanNLEs();
      }
    }

    async scanNLEs() {
      const container = document.getElementById('nleScanResultsContainer');
      container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">Scanning machine for Adobe Premiere Pro and DaVinci Resolve...</div>';

      try {
        const detected = await this.apiCall('/api/desktop/nle-detect');
        if (!detected || detected.length === 0) {
          container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">No creative NLEs detected in standard Program Files paths.</div>';
          return;
        }

        container.innerHTML = detected.map(nle => `
          <div class="nle-item">
            <div class="nle-details">
              <span class="nle-title">${nle.name}</span>
              <span class="nle-path">${nle.installPath}</span>
            </div>
            <span class="badge-pill ${nle.pluginInstalled ? 'installed' : 'pending'}">
              ${nle.pluginInstalled ? 'Extension Installed ✓' : 'Ready to Install'}
            </span>
          </div>
        `).join('');
      } catch (err) {
        container.innerHTML = `<div style="padding: 20px; color: var(--accent-red);">Failed to scan editors: ${err.message}</div>`;
      }
    }

    async autoDeployPlugins() {
      const btn = document.getElementById('btnAutoDeployPlugins');
      btn.disabled = true;
      btn.textContent = 'Installing Extensions...';
      try {
        await this.apiCall('/api/desktop/deploy-plugins', 'POST');
        this.nextWizardStep(3);
      } catch (err) {
        alert(`Failed to deploy extensions: ${err.message}`);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Install Extensions & Continue →';
      }
    }

    async finishWizard() {
      const autoStart = document.getElementById('chkAutoStartService')?.checked ?? true;
      try {
        await this.apiCall('/api/desktop/configure-startup', 'POST', { enable: autoStart });
      } catch (_) {}

      // Switch to dashboard
      const dashTab = document.querySelector('[data-view="viewDashboard"]');
      if (dashTab) dashTab.click();
    }

    // Refresh project catalog & details
    async refreshAll() {
      await this.refreshProjectsList();
      await this.pollHeartbeat();
    }

    async refreshProjectsList() {
      const listEl = document.getElementById('projectList');
      try {
        allProjects = await this.apiCall('/api/desktop/projects');
        if (!allProjects || allProjects.length === 0) {
          listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-dim); font-size: 11px;">No projects tracked yet.<br>Click <b>+ Add</b> above or open a project in Premiere/Resolve.</div>';
          return;
        }

        listEl.innerHTML = allProjects.map(p => `
          <div class="project-card ${activeProject && activeProject.path === p.path ? 'active' : ''}" data-path="${p.path}">
            <div class="project-card-header">
              <span class="project-name" title="${p.name}">${p.name}</span>
              <span class="adapter-badge ${p.adapter}">${p.adapter}</span>
            </div>
            <div class="project-meta">
              <span class="branch-tag">⎇ ${p.currentBranch || 'main'}</span>
              <span>${p.existsOnDisk ? '● On Disk' : '○ Offline'}</span>
            </div>
          </div>
        `).join('');

        // Attach click listener
        listEl.querySelectorAll('.project-card').forEach(card => {
          card.onclick = () => {
            const pPath = card.getAttribute('data-path');
            const found = allProjects.find(p => p.path === pPath);
            if (found) this.selectProject(found);
          };
        });

        // Auto-select first project if none selected
        if (!activeProject && allProjects.length > 0) {
          this.selectProject(allProjects[0]);
        }
      } catch (err) {
        listEl.innerHTML = `<div style="padding: 12px; color: var(--accent-red); font-size: 11px;">Daemon offline</div>`;
      }
    }

    selectProject(project) {
      activeProject = project;
      document.querySelectorAll('.project-card').forEach(c => {
        c.classList.toggle('active', c.getAttribute('data-path') === project.path);
      });

      document.getElementById('dashProjectName').textContent = project.name;
      const badge = document.getElementById('dashAdapterBadge');
      badge.textContent = project.adapter;
      badge.className = `adapter-badge ${project.adapter}`;
      badge.style.display = 'inline-block';

      this.refreshProjectDetails(project.path);
    }

    async refreshProjectDetails(projectPath) {
      try {
        const details = await this.callRpc('project.details', { projectPath });

        // Update branch select
        const branchSelect = document.getElementById('branchSelect');
        if (details.branches) {
          branchSelect.innerHTML = details.branches.map(b => `
            <option value="${b.name}" ${b.isCurrent ? 'selected' : ''}>${b.name}</option>
          `).join('');
        }

        // Update changes count and list
        const changesCount = details.status?.changes?.length || 0;
        document.getElementById('changesCountBadge').textContent = changesCount;
        const changesContainer = document.getElementById('changesListContainer');

        if (changesCount > 0) {
          changesContainer.innerHTML = details.status.changes.map(c => `
            <div style="padding: 6px 0; border-bottom: 1px solid var(--border-subtle); display: flex; gap: 8px;">
              <span style="color: var(--badge-modified); font-weight: 700;">[${c.type}]</span>
              <span>${c.description || ''}</span>
            </div>
          `).join('');
        } else {
          changesContainer.innerHTML = '<div style="color: var(--text-dim); text-align: center; padding: 24px;">Clean working tree. No unsaved changes.</div>';
        }

        // Update history
        const historyContainer = document.getElementById('historyListContainer');
        const history = details.history || [];
        document.getElementById('historyCount').textContent = `${history.length} commits`;

        if (history.length > 0) {
          historyContainer.innerHTML = history.map(h => `
            <div style="padding: 8px 10px; background: var(--bg-input); border-radius: 4px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-weight: 600; font-size: 12px;">${h.message}</div>
                <div style="font-size: 10px; color: var(--text-dim); font-family: var(--font-mono);">
                  ${h.commit_hash.slice(0, 8)} • ${new Date(h.committed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="window.framegitApp.restoreCommit('${h.commit_hash}')">Restore</button>
            </div>
          `).join('');
        } else {
          historyContainer.innerHTML = '<div style="color: var(--text-dim); text-align: center; padding: 24px;">No commit history yet.</div>';
        }

        // Also update diff if diff view is active
        this.refreshVisualDiff();
      } catch (err) {
        console.error('Failed to refresh project details:', err);
      }
    }

    async restoreCommit(commitHash) {
      if (!activeProject) return;
      if (confirm(`Restore project to commit ${commitHash.slice(0, 8)}? All project files will be reverted bit-for-bit.`)) {
        try {
          await this.callRpc('project.restore', { projectPath: activeProject.path, commitHash, force: true });
          alert(`Restored successfully to commit ${commitHash.slice(0, 8)}.`);
          await this.refreshProjectDetails(activeProject.path);
        } catch (err) {
          alert(`Restore failed: ${err.message}`);
        }
      }
    }

    async refreshVisualDiff() {
      if (!activeProject) return;
      const diffContainer = document.getElementById('asciiDiffView');
      try {
        const diffText = await this.apiCall(`/api/desktop/diff/ascii?projectPath=${encodeURIComponent(activeProject.path)}`);
        diffContainer.textContent = diffText || 'No differences detected.';
      } catch (_) {
        diffContainer.textContent = 'Visual diff not available for current state.';
      }
    }

    async pollHeartbeat() {
      const pill = document.getElementById('daemonStatusPill');
      const text = document.getElementById('daemonStatusText');
      const nleBadge = document.getElementById('nleStatusBadge');
      const nleText = document.getElementById('nleStatusText');

      try {
        const hb = await this.apiCall('/api/desktop/heartbeat');
        pill.className = 'status-pill online';
        text.textContent = 'Daemon Ready';

        if (hb.activeEditors && hb.activeEditors.length > 0) {
          nleBadge.style.display = 'flex';
          nleText.textContent = hb.activeEditors.map(e => e.name).join(', ');
        } else {
          nleBadge.style.display = 'none';
        }
      } catch (_) {
        pill.className = 'status-pill offline';
        text.textContent = 'Daemon Offline';
        nleBadge.style.display = 'none';
      }
    }

    // Generic JSON-RPC & HTTP callers
    async callRpc(action, params = {}) {
      const res = await fetch(`${API_BASE}/api/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: Date.now(), action, params })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      return data.result;
    }

    async apiCall(endpoint, method = 'GET', body = null) {
      const options = { method, headers: {} };
      if (body) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }
      const res = await fetch(`${API_BASE}${endpoint}`, options);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get('content-type') || '';
      return contentType.includes('json') ? await res.json() : await res.text();
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    window.framegitApp = new FrameGitDesktopApp();
  });
})();
