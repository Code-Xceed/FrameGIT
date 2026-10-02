# FrameGit — End-to-End User Flow & Master Product Specification

> **Status:** Production Architecture Blueprint  
> **Target Audience:** Video Editors, Post-Production Engineers, Technical Directors, Developers  
> **Supported NLEs:** Adobe Premiere Pro (CC 2022–2025), DaVinci Resolve (18–19, Free & Studio)  
> **Supported Platforms:** Windows 10/11 (64-bit), macOS (Apple Silicon & Intel)

---

## 1. Executive Summary & Product Vision

FrameGit brings the software engineering power of **Git and GitHub** into the creative post-production suite—specifically tailored for **Adobe Premiere Pro** and **DaVinci Resolve**.

Unlike text-based code repositories, video projects contain massive, multi-gigabyte binary assets (ProRes, BRAW, RED, H.264/H.265), nested timelines, complex color grades (Lumetri, Resolve Color Nodes), audio mixer states, and external dependencies.

FrameGit operates on a **hybrid local-first architecture**:
1. **In-Editor Native Panels:** Editors never have to leave their timeline to commit, switch branches, or review changes.
2. **Desktop Companion App:** A central hub that manages GitHub permissions, scans installed editors, auto-configures scripts, displays all tracked projects across all storage drives, and renders full-screen visual timeline diffs.
3. **Background Process Daemon:** Silently monitors editor process lifecycles and file saves, automatically snapshotting and indexing media with zero UI lag and strictly bounded RAM usage (<150 MB).
4. **Cloud & GitHub Bridge:** Mirrors commit DAGs, branches, and manifests to GitHub while streaming media chunks to high-performance object storage (Cloudflare R2, AWS S3, Wasabi).

---

## 2. Complete End-to-End User Journey

```mermaid
flowchart TD
    subgraph S1["Phase 1: Installation & System Registration"]
        I1["Download FrameGit-Setup-1.0.0.exe"] --> I2["Single-Click Windows Setup"]
        I2 --> I3["Installs Core Engine to Program Files"]
        I2 --> I4["Registers System PATH (Global CLI)"]
        I2 --> I5["Creates Desktop Shortcut & Start Menu Entry"]
        I2 --> I6["Checkbox: Launch FrameGit Desktop App"]
    end

    subgraph S2["Phase 2: First-Launch Desktop App Onboarding Wizard"]
        I6 --> W1["FrameGit Desktop App Launches"]
        W1 --> W2["Step 1: GitHub OAuth Authorization (repo, workflow, user)"]
        W2 --> W3["Step 2: Auto-Scan Installed NLEs (Registry & Program Files)"]
        W3 --> W4["Step 3: Auto-Install CCX Panel & Resolve Python Scripts"]
        W4 --> W5["Step 4: Enable Background Watcher Service (Auto-Start with NLEs)"]
    end

    subgraph S3["Phase 3: In-Editor Project Activation (.framegit/)"]
        W5 --> E1["Editor Opens Premiere Pro or DaVinci Resolve"]
        E1 --> E2["Background Service Detects NLE Process Silently"]
        E2 --> E3["Editor Opens FrameGit Panel (Window -> Extensions)"]
        E3 --> E4["Panel Prompts: 'Enable FrameGit Version Control for this project?'"]
        E4 --> E5["Creates .framegit/ in Project Directory"]
        E5 --> E6["Registers Project in Global Desktop Catalog (~/.framegit/projects.json)"]
    end

    subgraph S4["Phase 4: Bi-Directional Version Control & GitHub Sync"]
        E6 --> D1["Editor Cuts Timeline & Hits Save (Ctrl+S)"]
        D1 --> D2["Watcher Detects Save -> Live Change List in Panel"]
        D2 --> D3["Commit (FastCDC Streaming, Bounded <150MB RAM)"]
        D3 --> D4["Branching (main, director-cut, social-15s)"]
        D4 --> D5["Visual Timeline Diff (Terminal ASCII + Interactive HTML/SVG)"]
        D5 --> D6["Push to GitHub (Commit Graph) & S3/R2 (Delta Media Chunks)"]
        D6 --> D7["Disaster Recovery: One-Click Bit-for-Bit Rollback"]
    end
```

---

## 3. Phase-by-Phase Technical Walkthrough

### Phase 1: Installation & System Registration

```text
Installer File: FrameGit-Setup-1.0.0.exe
Target Location: C:\Program Files\FrameGit\
Permissions: Standard User / Administrator (UAC elevated for Program Files)
```

1. **Downloader Execution:** The editor downloads `FrameGit-Setup-1.0.0.exe` and runs it.
2. **Component Deployment:**
   - Installs `framegit.exe` (standalone single-executable binary containing the Node runtime and Core Engine).
   - Installs the Desktop Companion Application (`FrameGit Desktop.exe`).
   - Copies the Premiere Pro UXP plugin package (`FrameGit-Premiere.ccx`).
   - Copies the DaVinci Resolve Python bridge script (`framegit_resolve.py`).
3. **System Environment Integration:**
   - Appends `C:\Program Files\FrameGit\` to the Windows System `PATH` registry (`HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment`).
   - Broadcasts `WM_SETTINGCHANGE` to all running explorer shells so any open command prompt or terminal recognizes `framegit` immediately.
4. **Shortcuts Created:**
   - Desktop: `FrameGit Desktop.lnk`
   - Start Menu: `FrameGit\FrameGit Desktop.lnk`, `FrameGit\FrameGit CLI.lnk`, `FrameGit\Uninstall.lnk`
5. **Completion Screen:** Offers a clean toggle: `[✓] Launch FrameGit Desktop to configure your environment`.

---

### Phase 2: First-Launch Desktop App Onboarding Wizard

When FrameGit Desktop launches for the first time, it detects the absence of `~/.framegit/config.json` and automatically launches the **4-Step Onboarding Wizard**.

```
┌────────────────────────────────────────────────────────────────────────┐
│  FRAMEGIT DESKTOP — INITIAL ONBOARDING WIZARD                          │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   (1) GitHub Auth  ──►  (2) Scan NLEs  ──►  (3) Plugins  ──►  (4) Service
│                                                                        │
│   CONNECT YOUR GITHUB ACCOUNT                                          │
│   FrameGit synchronizes your timeline changes, commit graphs, and      │
│   project metadata directly with your GitHub account.                  │
│                                                                        │
│   Required Permissions:                                                │
│   • repo (Full control of private repositories, commits, & branches)   │
│   • workflow (CI/CD automated render hooks)                            │
│   • user:email (Accurate commit authorship attribution)                │
│                                                                        │
│   [ Connect with GitHub (Browser Flow) ]                               │
│                                                                        │
│   Or enter Personal Access Token (PAT):                                │
│   [ ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx ]  [ Verify & Save ]     │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

#### Step 2.1: GitHub Authorization
* **Automated Device/OAuth Flow:** Clicking **Connect with GitHub** launches the system default browser to GitHub's authorization portal.
* **Token Handshake:** The browser receives the authorization code, passes it back to FrameGit's local loopback server (`http://127.0.0.1:41793/oauth/callback`), and retrieves the OAuth access token.
* **Credential Encryption:** The token is encrypted using AES-256-GCM with a PBKDF2 key derived from the host's unique `.machine_id` salt and stored in `~/.framegit/vault.enc`. It is never stored in plain text.
* **Verification:** The app issues a `GET /user` request to GitHub, confirming the authenticated username, avatar, and repository permissions.

#### Step 2.2: Deep System NLE Detection
The Desktop App scans the host operating system to identify all installed video editing software:
* **Adobe Premiere Pro Scan:**
  - Queries Windows Registry: `HKLM\SOFTWARE\Adobe\Premiere Pro` and `HKCU\Software\Adobe\Premiere Pro`.
  - Scans disk: `C:\Program Files\Adobe\Adobe Premiere Pro <YYYY>\`.
  - Detects versions: 2022, 2023, 2024, 2025.
* **DaVinci Resolve Scan:**
  - Queries Windows Registry: `HKLM\SOFTWARE\Blackmagic Design\DaVinci Resolve`.
  - Scans disk: `C:\Program Files\Blackmagic Design\DaVinci Resolve\`.
  - Detects editions: DaVinci Resolve Free and DaVinci Resolve Studio (v18, v19).
* **Display Results:** The UI presents detected applications with green checkmarks:
  ```text
  [✓] Adobe Premiere Pro 2025 (Found: C:\Program Files\Adobe\Adobe Premiere Pro 2025)
  [✓] DaVinci Resolve Studio 19 (Found: C:\Program Files\Blackmagic Design\DaVinci Resolve)
  ```

#### Step 2.3: Automated Plugin Deployment & Configuration
With one click on **Auto-Install Extensions**, FrameGit copies the appropriate adapters into each editor's official plugin directories:
* **For Adobe Premiere Pro:**
  - Deploys the CCX manifest and bundle into:
    `%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\25\FrameGit\` and common UXP directories.
  - Registers the extension in Adobe's local UXP catalog.
* **For DaVinci Resolve:**
  - Copies `framegit_resolve.py` into:
    `%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting\Modules\framegit_resolve.py`
  - Creates a menu shortcut in Resolve's Utility Scripts directory:
    `%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting\Scripts\Utility\FrameGit.py`
* **Visual Guide:** Shows screenshots and instructions:
  - *Premiere Pro:* Accessible via top menu: **`Window -> Extensions -> FrameGit`**
  - *DaVinci Resolve:* Accessible via top menu: **`Workspace -> Scripts -> FrameGit`**

#### Step 2.4: Background Service & Auto-Monitoring Permission
* The wizard asks the editor for permission to enable smart background monitoring:
  > *"Allow FrameGit to automatically monitor project saves when Premiere Pro or DaVinci Resolve is active?"*
* **Smart Process Watcher Mechanics:**
  - FrameGit registers a lightweight startup entry in `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
  - The service consumes **0% CPU** and **<20 MB RAM** while idle.
  - It polls the system process list every 5 seconds for `Adobe Premiere Pro.exe` or `Resolve.exe`.
  - When an editor opens, it awakens the FrameGit IPC server and file watcher. When the editor closes, it returns to sleep.

---

### Phase 3: In-Editor Project Activation & The `.framegit/` Repository

```
┌────────────────────────────────────────────────────────┐
│  PREMIERE PRO / DAVINCI RESOLVE — EXTENSION PANEL      │
├────────────────────────────────────────────────────────┤
│  FRAMEGIT                                ● Connected   │
│                                                        │
│  Project: Commercial_Master_v1.prproj                  │
│                                                        │
│  ⚠️ This project is not yet tracked by FrameGit.       │
│                                                        │
│  Tracking this project will allow:                     │
│  • Instant rollback to any edit point                  │
│  • Safe branching (social cut, color pass)             │
│  • Cloud backup of footage and sequence changes        │
│                                                        │
│  [ Enable FrameGit Version Control ]                   │
│                                                        │
└────────────────────────────────────────────────────────┘
```

1. **Opening a Project:** The editor opens `D:\Projects\ShoeCommercial\ShoeCommercial.prproj`.
2. **Opening the Panel:** The editor clicks `Window -> Extensions -> FrameGit`.
3. **The First-Time Handshake:**
   - The panel communicates with the local daemon via `http://127.0.0.1:41793/api/rpc`.
   - The panel detects that no `.framegit/` directory exists yet in `D:\Projects\ShoeCommercial\`.
   - It prompts the user: **"Enable FrameGit Version Control for this project?"**
4. **Repository Initialization:**
   - When clicked, FrameGit executes `init` in the project root.
   - Creates the hidden `.framegit/` directory:
     - `state.db`: SQLite database holding commit DAG, branch tables, and FastCDC chunk catalogs.
     - `objects/`: Content-Addressable Storage directory storing deduplicated chunk blobs.
     - `config.json`: Project configuration (remote GitHub repo URL, S3/R2 bucket name).
     - `agent.auth`: Ephemeral HMAC authentication token rotated every 24 hours.
5. **Central Catalog Registration:**
   - FrameGit automatically registers the project in the global machine catalog:
     `%USERPROFILE%\.framegit\projects.json`
   - **Instant Desktop Sync:** The project appears immediately on the **FrameGit Desktop Dashboard** with its project name, path, current branch (`main`), and status.

---

### Phase 4: Bi-Directional Daily Workflow

#### Step 4.1: Real-Time Change Detection on Save (`Ctrl + S`)
* The editor makes cuts on Video Track 1, moves an interview clip by +3.2 seconds, trims an out-point, and adjusts Lumetri Color exposure from `0.0` to `+1.25`.
* The editor presses standard **`Ctrl + S`** in Premiere Pro.
* The background file watcher intercepts the write event, unpacks the compressed `.prproj` XML, and compares the canonical AST against the HEAD commit.
* Within **250 milliseconds**, the FrameGit panel updates:
  ```text
  CHANGES (4)
  • [clip_moved]  Interview_A.mov (+3.20s on Video 1)
  • [clip_trim]   B-Roll_Run.mov (Trimmed Out: -1.50s)
  • [effect_mod]  Lumetri Color (Exposure: 0.0 -> 1.25)
  • [media_add]   Music_Track_Final.wav (48 kHz Stereo)
  ```

#### Step 4.2: FastCDC Streaming Commit
* The editor types: `"Warm color grade pass and adjusted interview pacing"`.
* Clicks **`[ Commit ]`**.
* **Engine Execution:**
  - The **Streaming FastCDC Chunker** slices new media files using a sliding gear-matrix hash.
  - Project file XML is compressed and stored as a tree object in CAS.
  - Memory usage stays strictly below **150 MB RSS** even if 15 GB of media was added.
  - An atomic SQLite transaction updates the `commits` table and moves branch pointer `main` to the new commit hash: `a78f23c`.

#### Step 4.3: Safe Branching for Alternative Versions
* The client requests an alternative 15-second TikTok version:
  - Editor selects branch dropdown in the panel -> Clicks **`+ New Branch`** -> Enters `social-15s`.
  - Re-edits the sequence to 9:16 vertical and commits: `"15s vertical cut"`.
  - Can switch back to `main` at any time with one click.
* **Dirty Working Tree Protection:** If the editor makes cuts and tries to switch branches without saving, FrameGit blocks the switch and warns:
  > *"Cannot switch branches: You have uncommitted changes on your timeline. Commit or discard your changes first to protect your edit."*

#### Step 4.4: Visual Timeline Diffing
* The editor or director wants to see what changed between `main` and `social-15s`.
* Clicks **`[ View Visual Diff ]`** in either the panel or Desktop App:
  - Renders an interactive HTML/SVG visual canvas with SMPTE ruler timecodes (`00:00:15:00`).
  - Track rows clearly distinguish unchanged media (gray), added clips (green), deleted clips (red), moved clips (orange), and grade adjustments (blue).

#### Step 4.5: Synchronizing with GitHub & S3/R2 Cloud
* Editor clicks **`[ ↑ Push ]`**:
  1. **GitHub Git Data API:** Uploads lightweight commit manifests, author details, and branch refs to the linked private GitHub repository.
  2. **Cloud Storage (S3 / R2):** Uploads missing media chunks with multi-part streaming, deduplicating against chunks already in the cloud.
  3. Colleague on another workstation runs `framegit clone` or clicks **Pull** in their Desktop App and immediately gets the exact working timeline.

#### Step 4.6: Disaster Recovery (Instant Rollback)
* If an editor accidentally deletes a complex sequence, or Premiere corrupts the `.prproj` file:
  - Opens FrameGit panel -> Goes to **History**.
  - Selects the desired commit -> Clicks **`[ Restore ]`**.
  - FrameGit restores the `.prproj` and all referenced media **bit-for-bit** from CAS storage.

---

## 4. Current Codebase vs. Target Flow (Gap Analysis)

| Flow Component | Requirement | Current Codebase State | Status |
| :--- | :--- | :--- | :---: |
| **Installer** | `FrameGit-Setup-1.0.0.exe` installer wizard with PATH and Desktop shortcut | `installer/windows/installer.nsi` exists; `dist/framegit.exe` exists (94MB SEA) | ⏳ Needs Automated Build Script |
| **Desktop App** | Standalone Windows GUI window with project dashboard | Web panel exists (`plugin/premiere/index.html`); CLI exists (`bin/framegit.js`) | ⏳ Needs Desktop App Shell (`desktop/`) |
| **Auth Wizard** | First-run GitHub OAuth device flow & token verification GUI | Underlying OAuth methods exist in `core/github_auth.js` & `core/vault.js` | ⏳ Needs Wizard GUI Screen |
| **NLE Scanner** | Auto-detect Premiere Pro (2022-2025) and DaVinci Resolve (18-19) | Manual paths in `installer.nsi`; adapter logic in `core/` | ⏳ Needs Auto-Detector (`core/nle_detector.js`) |
| **Auto-Installer** | Automatically copy CCX & Python script to user extension directories | Files exist in `dist/FrameGit-Premiere.ccx` and `plugin/resolve/` | ⏳ Needs Auto-Copy Routine |
| **Process Watcher**| Auto-wake daemon when Premiere or Resolve starts; idle otherwise | Workspace watcher exists (`core/watcher.js`); IPC server exists (`core/ipc_server.js`) | ⏳ Needs Process Monitor (`core/process_monitor.js`) |
| **Global Catalog** | Central registry of all tracked `.framegit/` projects across the machine | Each `.framegit/` is independent | ⏳ Needs Registry (`core/project_catalog.js`) |
| **In-Editor Panel**| Premiere Pro UXP Panel with live change list, commit, branch, restore | Complete and DOM-safe in `plugin/premiere/index.js` and `index.html` | ✅ **100% BUILT** |
| **Resolve Bridge** | DaVinci Resolve Python script with project export and commit | Complete and Windows-hardened in `plugin/resolve/framegit_resolve.py` | ✅ **100% BUILT** |
| **FastCDC Engine** | Streaming chunker with constant <150MB RAM on 500GB projects | Complete and benchmarked in `core/streaming_chunker.js` (143 MB/s) | ✅ **100% BUILT** |
| **Version Engine** | Git DAG commits, branches, checkout, rollback, data safety | Complete in `core/version_engine.js` with 37 passing unit tests | ✅ **100% BUILT** |
| **Cloud & GitHub** | AWS SigV4 S3/R2 client + GitHub Git Data API synchronization | Complete in `core/cloud_client.js`, `core/sync_engine.js`, `github_sync.js` | ✅ **100% BUILT** |
| **Visual Diff**   | Interactive SVG/HTML canvas + Terminal ASCII visual timeline diff | Complete in `core/visual_diff.js` and verified | ✅ **100% BUILT** |

---

## 5. Implementation Roadmap to Complete the End-to-End Product

To bring this complete consumer product flow to life, we will execute the following concrete development phases:

```mermaid
flowchart LR
    P1["1. System NLE Detector<br/>(core/nle_detector.js)"] --> P2["2. Global Project Catalog<br/>(core/project_catalog.js)"]
    P2 --> P3["3. Process Lifecycle Watcher<br/>(core/process_monitor.js)"]
    P3 --> P4["4. FrameGit Desktop GUI App<br/>(desktop/index.html & app.js)"]
    P4 --> P5["5. Automated Setup Compiler<br/>(scripts/build_installer.js)"]
```

### Module 1: System NLE Auto-Detector (`core/nle_detector.js`)
* Scans Windows Registry and `Program Files` for Premiere Pro and DaVinci Resolve installations.
* Implements `installPremiereExtension()` and `installResolveScript()` to automatically copy assets into user profile directories.

### Module 2: Global Project Catalog (`core/project_catalog.js`)
* Manages `%USERPROFILE%\.framegit\projects.json`.
* Provides `registerProject()`, `unregisterProject()`, `listProjects()`, and `refreshAllProjects()`.
* Automatically called whenever `framegit init` or extension activation occurs.

### Module 3: Process Lifecycle Watcher (`core/process_monitor.js`)
* Monitors running processes for `Adobe Premiere Pro.exe` and `Resolve.exe`.
* Spawns the background daemon on demand and idles when editing applications close.
* Handles Windows Startup registration (`HKCU\...\Run`).

### Module 4: Standalone FrameGit Desktop GUI App (`desktop/`)
* Lightweight, responsive dark-mode desktop window.
* Contains the **First-Run Onboarding Wizard** (GitHub OAuth, Editor Scan, Permissions).
* Contains the **Global Projects Dashboard** (All tracked editing projects, active branches, one-click Diff, Push, Pull, and Restore).

### Module 5: Automated Installer Compiler (`scripts/build_installer.js`)
* Bundles `framegit.exe`, Desktop GUI files, CCX package, and Python script into a standalone `FrameGit-Setup-1.0.0.exe` installer.
* Registers system PATH and Desktop shortcuts cleanly.

---

*This document serves as the canonical reference for FrameGit's consumer desktop product flow.*
