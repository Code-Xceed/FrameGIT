#!/usr/bin/env python3
"""
FrameGit — DaVinci Resolve Integration Script

Integrates FrameGit version control directly into Blackmagic DaVinci Resolve
via the official DaVinci Resolve Python Scripting API.

Install location:
  Windows: %APPDATA%\\Blackmagic Design\\DaVinci Resolve\\Support\\Developer\\Scripting\\Modules\\
           or Workspace -> Scripts -> FrameGit
  macOS:   ~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules/
  Linux:   /opt/resolve/Developer/Scripting/Modules/
"""

import sys
import os
import json
import urllib.request
import urllib.error
import subprocess
from pathlib import Path


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


def read_ipc_auth(workspace_dir):
    """Read local agent authentication token and port from .framegit/agent.auth."""
    auth_file = Path(workspace_dir) / ".framegit" / "agent.auth"
    if not auth_file.exists():
        return None
    try:
        with open(auth_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def send_ipc_rpc(auth_info, action, params=None):
    """Dispatch JSON-RPC request to local FrameGit IPC daemon."""
    if not auth_info:
        return {"error": "Local FrameGit agent is not running. Start with 'framegit daemon start'"}

    url = f"http://{auth_info.get('host', '127.0.0.1')}:{auth_info.get('port', 41793)}/api/rpc"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {auth_info.get('token', '')}"
    }
    payload = json.dumps({
        "action": action,
        "params": params or {},
        "id": 1
    }).encode("utf-8")

    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("result")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            err_json = json.loads(body)
            return {"error": err_json.get("error", {}).get("message", f"HTTP {e.code}")}
        except Exception:
            return {"error": f"HTTP {e.code}: {body}"}
    except Exception as e:
        return {"error": str(e)}


import shutil


def run_cli_cmd(args, cwd):
    """Execute FrameGit CLI command portably across Windows, macOS, and Linux."""
    cmd_name = args[0]
    is_win = sys.platform == "win32"
    if is_win and not cmd_name.lower().endswith((".cmd", ".bat", ".exe")):
        which_cmd = shutil.which(cmd_name + ".cmd") or shutil.which(cmd_name)
        if which_cmd:
            args[0] = which_cmd
    return subprocess.run(args, cwd=str(cwd), capture_output=True, text=True, shell=is_win)


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
            # If launched inside DaVinci Resolve host, cwd is often C:\Program Files or /Applications
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
        # ExportProject returns boolean in Resolve API
        return bool(pm.ExportProject(proj_name, str(target_drp_path)))

    def commit(self, message, author=None):
        """Export current Resolve project and execute FrameGit commit."""
        active_name = self.get_active_project() or "Project"
        drp_path = self.workspace_path / f"{active_name}.drp"

        # 1. Export active project if running inside Resolve
        if self.resolve:
            print(f"Exporting active project '{active_name}' to {drp_path}...")
            ok = self.export_project_snapshot(drp_path)
            if not ok:
                return {"error": f"Failed to export project '{active_name}' from DaVinci Resolve"}

        # 2. Commit via CLI or IPC
        auth = read_ipc_auth(self.workspace_path)
        if auth:
            params = {"message": message}
            if author:
                params["author"] = author
            return send_ipc_rpc(auth, "project.commit", params)
        else:
            # Fallback to CLI command
            cmd = ["framegit", "commit", "-m", message]
            res = run_cli_cmd(cmd, self.workspace_path)
            if res.returncode == 0:
                return {"message": res.stdout.strip()}
            else:
                return {"error": res.stderr.strip() or res.stdout.strip()}

    def status(self):
        """Get project status and detected changes."""
        auth = read_ipc_auth(self.workspace_path)
        if auth:
            return send_ipc_rpc(auth, "project.status")
        else:
            cmd = ["framegit", "status"]
            res = run_cli_cmd(cmd, self.workspace_path)
            return {"output": res.stdout.strip()}


def main():
    if len(sys.argv) < 2:
        print("FrameGit DaVinci Resolve Integration")
        print("Usage: framegit_resolve.py <status|commit> [args]")
        sys.exit(0)

    cmd = sys.argv[1]
    bridge = FrameGitResolve()

    if cmd == "status":
        st = bridge.status()
        print(json.dumps(st, indent=2))
    elif cmd == "commit":
        msg = sys.argv[2] if len(sys.argv) > 2 else "Resolve checkpoint"
        res = bridge.commit(msg)
        print(json.dumps(res, indent=2))
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)


if __name__ == "__main__":
    main()
