#!/usr/bin/env python3
"""
FrameGit — DaVinci Resolve Integration Script & Bridge

Integrates FrameGit version control directly into Blackmagic DaVinci Resolve
via the official DaVinci Resolve Python Scripting API and Desktop Agent.

Supports full Source Control operations:
  - Checkpoint commit with automatic .drp export
  - Working tree status and SMPTE visual diff
  - Branch creation and switching
  - Push, Pull, Fetch, and Sync
  - Bit-for-bit restore of previous checkpoints

Install location:
  Windows: %APPDATA%\\Blackmagic Design\\DaVinci Resolve\\Support\\Developer\\Scripting\\Modules\\
           and Scripts\\Utility\\FrameGit.py
  macOS:   ~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules/
  Linux:   /opt/resolve/Developer/Scripting/Modules/
"""

import sys
import os
import json
import urllib.request
import urllib.error
import subprocess
import shutil
from pathlib import Path

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 41793


def get_resolve_instance():
    """Acquire the live DaVinci Resolve API instance."""
    try:
        import DaVinciResolveScript as dvr_script
        return dvr_script.scriptapp("Resolve")
    except ImportError:
        if "bmd" in globals():
            return globals()["bmd"].scriptapp("Resolve")
        elif "resolve" in globals():
            return globals()["resolve"]
        return None


def read_ipc_auth(workspace_dir=None):
    """Read local agent authentication token and port from .framegit/agent.auth if present."""
    if workspace_dir:
        auth_file = Path(workspace_dir) / ".framegit" / "agent.auth"
        if auth_file.exists():
            try:
                with open(auth_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
    return {"host": DEFAULT_HOST, "port": DEFAULT_PORT, "token": ""}


def send_rpc(action, params=None, workspace_dir=None):
    """Dispatch JSON-RPC request to local FrameGit Desktop server."""
    auth_info = read_ipc_auth(workspace_dir)
    host = auth_info.get("host", DEFAULT_HOST)
    port = auth_info.get("port", DEFAULT_PORT)
    token = auth_info.get("token", "")

    url = f"http://{host}:{port}/api/rpc"  # no-hardcode-ignore: hardcoded-url
    headers = {
        "Content-Type": "application/json"
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    payload = json.dumps({
        "action": action,
        "params": params or {},
        "id": 1
    }).encode("utf-8")

    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("error"):
                return {"error": data["error"].get("message", str(data["error"]))}
            return data.get("result")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            err_json = json.loads(body)
            return {"error": err_json.get("error", {}).get("message", f"HTTP {e.code}")}
        except Exception:
            return {"error": f"HTTP {e.code}: {body}"}
    except Exception as e:
        return {"error": f"Connection to FrameGit Desktop agent failed: {e}"}


class FrameGitResolve:
    def __init__(self, workspace_path=None):
        self.resolve = get_resolve_instance()
        
        # Determine intelligent workspace root
        if workspace_path:
            self.workspace_path = Path(workspace_path).resolve()
        elif "FRAMEGIT_WORKSPACE" in os.environ:
            self.workspace_path = Path(os.environ["FRAMEGIT_WORKSPACE"]).resolve()
        else:
            cwd = Path(os.getcwd()).resolve()
            is_system_app_dir = any(part.lower() in ("program files", "program files (x86)", "applications", "opt") for part in cwd.parts)
            if is_system_app_dir or not (cwd / ".framegit").exists():
                active = self.get_active_project() or "DefaultProject"
                fallback = Path.home() / "FrameGitProjects" / active
                self.workspace_path = fallback.resolve()
            else:
                self.workspace_path = cwd

        self.workspace_path.mkdir(parents=True, exist_ok=True)

    def get_active_project(self):
        """Retrieve current project name from DaVinci Resolve."""
        if not self.resolve:
            return None
        pm = self.resolve.GetProjectManager()
        if not pm:
            return None
        proj = pm.GetCurrentProject()
        return proj.GetName() if proj else None

    def export_project_snapshot(self, target_drp_path):
        """Export current project state to a .drp archive file."""
        if not self.resolve:
            return False
        pm = self.resolve.GetProjectManager()
        if not pm:
            return False
        proj = pm.GetCurrentProject()
        if not proj:
            return False

        proj_name = proj.GetName()
        os.makedirs(os.path.dirname(target_drp_path), exist_ok=True)
        return bool(pm.ExportProject(proj_name, str(target_drp_path)))

    def ensure_tracked(self):
        """Register workspace with FrameGit desktop agent."""
        return send_rpc("project.track", {"projectPath": str(self.workspace_path)}, str(self.workspace_path))

    def status(self):
        """Get project status, dirty changes, branches, and active branch."""
        active_name = self.get_active_project()
        if active_name and self.resolve:
            drp_path = self.workspace_path / f"{active_name}.drp"
            self.export_project_snapshot(drp_path)

        res = send_rpc("project.status", {"projectPath": str(self.workspace_path)}, str(self.workspace_path))
        return res

    def commit(self, message, author=None):
        """Export current Resolve project and execute FrameGit commit."""
        active_name = self.get_active_project() or "Project"
        drp_path = self.workspace_path / f"{active_name}.drp"

        if self.resolve:
            print(f"[FrameGit] Exporting active Resolve project '{active_name}' to {drp_path}...")
            ok = self.export_project_snapshot(drp_path)
            if not ok:
                return {"error": f"Failed to export project '{active_name}' from DaVinci Resolve"}

        params = {
            "projectPath": str(self.workspace_path),
            "message": message
        }
        if author:
            params["author"] = author

        return send_rpc("project.commit", params, str(self.workspace_path))

    def history(self, limit=15):
        """Retrieve recent commit history DAG."""
        return send_rpc("project.history", {"projectPath": str(self.workspace_path), "limit": limit}, str(self.workspace_path))

    def branch_list(self):
        """List branches in repository."""
        return send_rpc("branch.list", {"projectPath": str(self.workspace_path)}, str(self.workspace_path))

    def branch_create(self, name):
        """Create a new branch."""
        return send_rpc("branch.create", {"projectPath": str(self.workspace_path), "name": name}, str(self.workspace_path))

    def branch_switch(self, name, force=False):
        """Switch active branch."""
        return send_rpc("branch.switch", {"projectPath": str(self.workspace_path), "name": name, "force": force}, str(self.workspace_path))

    def restore(self, commit_hash):
        """Rollback Resolve project to a specific checkpoint."""
        return send_rpc("project.restore", {"projectPath": str(self.workspace_path), "commitHash": commit_hash, "force": True}, str(self.workspace_path))

    def diff(self):
        """Get SMPTE visual diff breakdown."""
        return send_rpc("project.diff", {"projectPath": str(self.workspace_path)}, str(self.workspace_path))

    def discard(self):
        """Discard uncommitted modifications."""
        return send_rpc("project.discard", {"projectPath": str(self.workspace_path)}, str(self.workspace_path))

    def push(self):
        """Push commits to remote."""
        return send_rpc("sync.push", {"projectPath": str(self.workspace_path)}, str(self.workspace_path))

    def pull(self):
        """Pull remote changes."""
        return send_rpc("sync.pull", {"projectPath": str(self.workspace_path)}, str(self.workspace_path))

    def sync(self):
        """Atomic Pull + Push."""
        return send_rpc("sync.sync", {"projectPath": str(self.workspace_path)}, str(self.workspace_path))

    def fetch(self):
        """Fetch remote ref status."""
        return send_rpc("sync.fetch", {"projectPath": str(self.workspace_path)}, str(self.workspace_path))


def run_interactive_menu():
    """Terminal or Dialog menu for DaVinci Resolve editors."""
    bridge = FrameGitResolve()
    active_name = bridge.get_active_project() or "DaVinci Resolve Project"

    print("=" * 60)
    print(f"       FRAMEGIT — SOURCE CONTROL FOR DAVINCI RESOLVE")
    print(f"       Project: {active_name}")
    print(f"       Workspace: {bridge.workspace_path}")
    print("=" * 60)

    st = bridge.status()
    if isinstance(st, dict) and "error" in st:
        print(f"Notice: {st['error']}")
    else:
        branch = st.get("currentBranch", "main") if isinstance(st, dict) else "main"
        changes = st.get("changes", []) if isinstance(st, dict) else []
        print(f"🌿 Active Branch: {branch}")
        print(f"● Working Tree: {len(changes)} uncommitted change(s)")
        for ch in changes[:5]:
            print(f"   • [{ch.get('type', 'MOD')}] {ch.get('description', '')}")

    print("\nAvailable Commands:")
    print("  1. Commit Checkpoint")
    print("  2. View Working Tree Diff")
    print("  3. Discard Changes")
    print("  4. Switch / Create Branch")
    print("  5. Sync Changes (Pull & Push)")
    print("  6. View Timeline History")
    print("  0. Exit")


def main():
    if len(sys.argv) < 2:
        run_interactive_menu()
        sys.exit(0)

    cmd = sys.argv[1].lower()
    bridge = FrameGitResolve()

    if cmd == "status":
        print(json.dumps(bridge.status(), indent=2))
    elif cmd == "commit":
        msg = sys.argv[2] if len(sys.argv) > 2 else "Resolve timeline checkpoint"
        print(json.dumps(bridge.commit(msg), indent=2))
    elif cmd == "diff":
        res = bridge.diff()
        if isinstance(res, dict) and "ascii" in res:
            print(res["ascii"])
        else:
            print(json.dumps(res, indent=2))
    elif cmd == "push":
        print(json.dumps(bridge.push(), indent=2))
    elif cmd == "pull":
        print(json.dumps(bridge.pull(), indent=2))
    elif cmd == "sync":
        print(json.dumps(bridge.sync(), indent=2))
    elif cmd == "branches":
        print(json.dumps(bridge.branch_list(), indent=2))
    elif cmd == "branch":
        if len(sys.argv) > 2:
            print(json.dumps(bridge.branch_create(sys.argv[2]), indent=2))
        else:
            print(json.dumps(bridge.branch_list(), indent=2))
    elif cmd == "checkout" or cmd == "switch":
        if len(sys.argv) > 2:
            print(json.dumps(bridge.branch_switch(sys.argv[2]), indent=2))
        else:
            print("Usage: framegit_resolve.py switch <branchName>")
    elif cmd == "restore":
        if len(sys.argv) > 2:
            print(json.dumps(bridge.restore(sys.argv[2]), indent=2))
        else:
            print("Usage: framegit_resolve.py restore <commitHash>")
    elif cmd == "discard":
        print(json.dumps(bridge.discard(), indent=2))
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)


if __name__ == "__main__":
    main()
