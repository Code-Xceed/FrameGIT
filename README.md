# FrameGit — Version Control for Creative Video Professionals

[![Release](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/framegit/framegit)
[![Architecture](https://img.shields.io/badge/architecture-FastCDC%20CAS%20%2B%20DAG-emerald.svg)]()
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-purple.svg)]()
[![License](https://img.shields.io/badge/license-ISC-green.svg)]()

> **The creative workflow platform that gives video editors the power of Git, GitHub, and VS Code inside Adobe Premiere Pro and Blackmagic DaVinci Resolve.**

---

## 💡 The Core Problem

Video projects are fundamentally different from software code:
- Projects range from **100 GB to multi-terabytes**.
- Assets are binary video streams, RAW media, conformed audio, and complex timeline XML/DRP databases.
- Traditional Git and Git LFS break down at multi-gigabyte scale, choking memory and cloning entire multi-hundred GB histories.
- Creative editors have had **no real version control**—relying on fragile manual filenames like `Client_Ad_v2_final_FINAL_approved_v3_reallyfinal.prproj`.

---

## ⚡ What FrameGit Does

FrameGit solves creative version control from the ground up:

1. **Content-Defined Chunking (FastCDC)**: Slices multi-GB video files and project XMLs into deduplicated cryptographic chunks. If you change a 3-second title in a 50 GB project, FrameGit uploads **only the changed 2 MB chunk**, not 50 GB.
2. **True Git DAG History**: Full commit trees, branches, detached HEAD checkouts, and merge bases running on high-speed embedded SQLite (`node:sqlite`).
3. **Creative Project Aware**: Understands sequences, tracks, clips, Lumetri Color parameters, timecode ticks, markers, and media references for Premiere Pro (`.prproj`) and DaVinci Resolve (`.drp`).
4. **Visual Timeline Diff**: Renders interactive HTML/SVG timeline comparisons and high-density terminal ASCII visual diffs directly in your editor panel.
5. **3-Way Timeline Merge (`FORK_TRACK`)**: Reconciles collaborative edits between editors without corrupting edit points or overlapping clips.
6. **Zero Cloud Lock-in**: Connects directly to any S3-compatible cloud storage (Cloudflare R2 with $0 egress fees, AWS S3, MinIO, Backblaze B2) and GitHub Git Data REST API.
7. **Standalone Binary**: Pre-compiled standalone `framegit.exe` with zero Node.js or external tool prerequisites.

---

## 🚀 30-Second Quickstart

### 1. Initialize a Project
In your project folder (containing your `.prproj` or `.drp`):
```bash
framegit init Commercial.prproj
```

### 2. Configure Your Editor Identity
```bash
framegit config set user.name "Alex Rivera"
framegit config set user.email "alex@posthouse.tv"
```

### 3. Commit Your First Cut
```bash
framegit commit -m "Rough cut Assembly 1 with temp audio bed"
```

### 4. Branch for Color Grading
```bash
framegit branch color-grade
framegit checkout color-grade
```
Open Premiere or Resolve, tweak your grades, and commit:
```bash
framegit commit -m "Applied Lumetri warm grade to A-Roll"
```

### 5. Inspect Timeline Diffs
```bash
framegit diff
```
*Outputs an ASCII timeline lane map showing added, deleted, moved, and grade-modified clips with exact SMPTE timecodes.*

```bash
framegit diff --html
```
*Generates an interactive SVG timeline diff canvas you can open in any browser or editor panel.*

### 6. Switch Back or Restore Anytime
```bash
framegit checkout main
```
*Workspace restores bit-for-bit to the exact project file and media state.*

---

## 🖥️ Command-Line Interface (CLI)

| Command | Description |
| :--- | :--- |
| `framegit init [project-file]` | Initialize a FrameGit repository in current workspace |
| `framegit status` | Show detected clip/sequence changes since last commit |
| `framegit commit -m "<msg>"` | Record project snapshot and deduplicated media chunks |
| `framegit log [-n count]` | View commit history DAG with author, hash, and date |
| `framegit branch [<name>]` | List, create, or delete (`-d`) branches |
| `framegit checkout <target>` | Switch branches or checkout specific commit (detached HEAD) |
| `framegit diff [--html]` | View visual timeline diff in terminal or export interactive SVG |
| `framegit restore <commit>` | Bit-for-bit rollback of project file to commit hash |
| `framegit fsck [--repair]` | Run cryptographic SHA-256 / BLAKE2s integrity audit |
| `framegit doctor` | System diagnostics, memory metrics, and repository health |
| `framegit config <get\|set>` | View or update configuration values |
| `framegit config set-secret` | Store encrypted API keys in AES-256-GCM hardware vault |
| `framegit daemon <start\|stop>` | Background auto-snapshot watcher daemon |
| `framegit push [branch]` | Push local commits and chunks to S3/R2 remote |
| `framegit pull [branch]` | Pull remote commits and missing chunks into workspace |

---

## 🎬 Editor Integration

### Adobe Premiere Pro (UXP Panel)
- Packaged as a standard Adobe Creative Cloud plugin: `dist/FrameGit-Premiere.ccx`.
- Double-click to install directly into Premiere Pro 2024 / 2025.
- Connects to local daemon over session-bound HMAC-authenticated IPC.
- One-click commit, branch switching, and visual timeline diff inspection right inside Premiere.

### DaVinci Resolve (Python Script)
- Native script in `plugin/resolve/framegit_resolve.py`.
- Integrates with DaVinci Resolve Scripting API (`bmd.scriptapp('Resolve')`).
- Automatically exports `.drp` archives and records atomic FrameGit checkpoints from Resolve's **Workspace > Scripts** menu.

---

## 🔐 Security & Encrypted Credential Vault

FrameGit never writes passwords, S3 secret keys, or GitHub personal access tokens in plain text.

All credentials are encrypted using **AES-256-GCM** with a 256-bit PBKDF2 key derived from host hardware and OS identifiers, stored in `~/.framegit/credentials.enc`.

```bash
# Securely store S3 / Cloudflare R2 credentials
framegit config set-secret cloud.accessKeyId "YOUR_R2_ACCESS_KEY"
framegit config set-secret cloud.secretAccessKey "YOUR_R2_SECRET_KEY"

# Securely store GitHub token
framegit config set-secret github.token "ghp_YourGitHubToken"
```

---

## 📦 Building from Source

Requirements: Node.js 24.x LTS

```bash
# Install dependencies
npm install

# Run entire test suite (16 test suites, 100% pass)
node --test test/*_test.js

# Build Premiere Pro UXP CCX package
node scripts/build_uxp_ccx.js

# Build standalone framegit.exe
node scripts/build_sea.js
```

---

## 📄 Documentation

- [Quickstart Guide](docs/quickstart.md)
- [Cloud Storage Setup (Cloudflare R2 / AWS S3)](docs/cloud-setup.md)
- [Architecture Blueprint](PRODUCTION_ROADMAP.md)
