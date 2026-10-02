# FrameGit Quickstart Guide

This guide walks you through setting up FrameGit for a professional video editing project in under 5 minutes.

---

## 1. Installation

### Option A: Standalone Windows Binary (Recommended for Editors)
Download `framegit.exe` from the latest release and place it in your PATH (e.g. `C:\Program Files\FrameGit\` or run the Windows installer).

Verify installation:
```powershell
framegit --version
```

### Option B: Node.js / npm
```bash
npm install -g framegit
```

---

## 2. Setting Up Your Identity

FrameGit tags every commit with your editor name and email so team members know who made each creative change:

```bash
framegit config set user.name "Alex Rivera"
framegit config set user.email "alex@studio.com"
```

---

## 3. Initializing a Video Project

Navigate to your video editing project directory. Ensure your Adobe Premiere Pro (`.prproj`) or DaVinci Resolve (`.drp`) file is located in this directory:

```bash
cd D:\Projects\Nike_Commercial_2026
framegit init Nike_Commercial.prproj
```

FrameGit creates a lightweight `.framegit/` directory containing:
- An embedded SQLite DAG database (`state.db`)
- A local Content-Addressable Storage (CAS) store for deduplicated chunks
- Rolling crash recovery snapshots

---

## 4. Your First Commit

Commit your initial timeline assembly:

```bash
framegit commit -m "Initial rough cut Assembly Take 1"
```

FrameGit will:
1. Parse the sequence XML / DRP structure.
2. Index footage references in `Footage/`, `Audio/`, and `Graphics/`.
3. FastCDC-chunk the project file and tracked media.
4. Record an atomic commit node in the DAG.

Check status at any time:
```bash
framegit status
```

---

## 5. Branching for Alternative Cuts

Never duplicate project files manually again! Want to try a radical color pass or alternate music cue? Create a branch:

```bash
framegit branch experimental-music
framegit checkout experimental-music
```

Now open Premiere Pro or DaVinci Resolve, replace the music track, adjust clip timings, and save the project.

View what changed:
```bash
framegit status
```
Output:
```
On branch experimental-music
Project:  Nike_Commercial.prproj
HEAD:     84a1e932

Changes detected (2):
  • [clip_trimmed] Upbeat_Electronic.wav trimmed (-4.00s)
  • [clip_added] Ambient_Cinematic.wav added to AUDIO 2
```

Commit the experiment:
```bash
framegit commit -m "Replaced background music with ambient electronic cue"
```

---

## 6. Visual Timeline Diff

To see exactly what changed visually across your timeline tracks:

```bash
framegit diff
```

Output:
```
TIMELINE VISUAL DIFF: "Main_Commercial_30s" [00:00:30:00]
======================================================================

[ VIDEO 1          ]
  |██████████████████████████████████████████████████|

[ AUDIO 1 (Dialogue) ]
  |██████████████████████████████████████████████████|

[ AUDIO 2 (Music)    ]
  |~~~~~~~~~~~~~~~~~~~~~~~~~+++++++++++++++++++++++++|
    • [TRIMMED] Upbeat_Electronic.wav @ 00:00:00:00 (Trimmed out-point)
    • [ADDED] Ambient_Cinematic.wav @ 00:00:15:00 (New music cue inserted)

----------------------------------------------------------------------
Legend: [█ Unchanged] [+ Added] [X Deleted] [> Moved] [* Effect/Grade] [~ Trimmed]
```

To export an interactive HTML/SVG timeline report for your director or client:
```bash
framegit diff --html
```
Open `timeline_diff.html` in your browser to inspect hover tooltips, frame-accurate timecodes, and grade parameters.

---

## 7. Switching Branches or Rolling Back

Switch back to the main client cut:
```bash
framegit checkout main
```
FrameGit immediately restores `Nike_Commercial.prproj` bit-for-bit to the main branch state. When you reload or re-open Premiere, your original timeline is exactly as you left it.

If a project file ever gets corrupted by an editor crash, recover it instantly:
```bash
framegit doctor
framegit fsck --repair
```
