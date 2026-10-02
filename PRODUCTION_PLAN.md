# FrameGit — Production Completion Plan

> **STATUS:** Active execution plan (supersedes the "100% complete" claim in `PENDING_TASKS.md`)
> **GOAL:** Ship a hardcoded-free, mock-free, end-to-end verified FrameGit that a video
> professional can install and use against **real** cloud storage and **real** GitHub,
> inside **real** Premiere Pro / DaVinci Resolve, with **zero dev-machine assumptions**.

---

## 0. Definition of Done (the contract)

FrameGit is "production complete" only when **every** line below is demonstrably true on a
clean machine, with real services, and no test-only code paths reachable in the shipped binary:

- [ ] `framegit init <real>.prproj` works in a folder with a real Premiere project.
- [ ] `framegit status` reports real timeline changes after an actual edit in Premiere.
- [ ] `framegit commit -m "…"` creates a real CAS commit with deduplicated chunks.
- [ ] `framegit push` uploads chunks to a **real** S3/R2 bucket (SigV4 verified by the bucket)
      and metadata to a **real** GitHub repo.
- [ ] `framegit clone <url> <dir>` on a **second machine** reconstructs the project byte-for-byte
      and it opens in Premiere.
- [ ] `framegit branch` / `checkout` / `merge` reconcile collaborative edits without corruption.
- [ ] `framegit diff [--html]` shows real clip/track/effect changes.
- [ ] `framegit restore <hash>` yields a project that opens in Premiere.
- [ ] The Premiere UXP panel commits/pushes/pulls/restores from inside Premiere.
- [ ] Everything above also works for a real DaVinci Resolve `.drp` project.
- [ ] `framegit fsck` detects real corruption and `--repair` fixes it.
- [ ] `framegit doctor` reports honest health with no placeholder values.
- [ ] `dist/framegit.exe` runs on a machine with **no Node.js**.
- [ ] No `Mock*` class is reachable from `core/`; no `isMock` journey is the default.
- [ ] The "no-hardcode" linter (Workstream A) passes with 0 violations.
- [ ] The full regression suite passes; integration tests pass against real/gated services.

**Non-negotiable engineering rules** (from `PRODUCTION_ROADMAP.md`, enforced by CI):
1. No mock/fake/simulated implementation shipped in `core/` or `bin/`.
2. No hardcoded paths, ports, hosts, emails, names, URLs, buckets, or IDs — everything comes
   from config / env / CLI.
3. No string-concatenated XML — `xmlbuilder2` only.
4. No `Math.random()` / short `crypto.randomBytes` for identifiers — `crypto.randomUUID()` only.
5. Every `JSON.parse()` wrapped; every `fs.*` op wrapped via `core/errors.js`.
6. No code change without a corresponding test change.

---

## 1. Gap Register (what stands between now and Done)

Derived from the source audit. Each gap is a ticket; IDs are referenced by the workstreams.

| ID | Severity | Location | Gap |
|----|----------|----------|-----|
| G1 | 🔴 Blocker | `framegit.config.json` | Ships `cloud.isMock:true`, `github.isMock:true`, empty creds, placeholder user (`"FrameGit Editor"`/`"editor@framegit.local"`). Out-of-box = fake mode. |
| G2 | 🔴 Blocker | `core/github_sync.js:13` | `core/` imports `MockGitHubApi` from `../test/mocks/` and re-exports it. Core→test dependency. |
| G3 | 🔴 Blocker | `core/github_sync.js:376` | `reconstructFromGitHubAndCloud()` real branch returns `{content:'{}'}` stub. Real GitHub→cloud clone unimplemented. |
| G4 | 🔴 Blocker | `core/github_auth.js:14` | `DEFAULT_CLIENT_ID='Iv23liFrameGitDefaultApp'` is a placeholder; device flow cannot succeed. |
| G5 | 🔴 Blocker | `bin/framegit.js` | `clone` advertised in `--help` but no `case 'clone'`; engine `SyncEngine.clone()` exists but is unwired. |
| G6 | 🟠 High | `core/cloud_client.js` | `simulateNetworkFailure` test backdoor + mock `Map()` storage in the shipped class. |
| G7 | 🟠 High | `core/premiere_adapter.js`, `core/resolve_adapter.js` | `openProject()` returns fake `{opened:true}`. |
| G8 | 🟠 High | `core/resolve_adapter.js:~148` | `Math.random()` for clip IDs. |
| G9 | 🟠 High | `core/premiere_parser.js:77,182` | Hardcoded `'Untitled Sequence'`, `'FrameGit Project'` defaults. |
| G10 | 🟠 High | repo root `Project.prproj` | Literal `dummy prproj data` committed to production root. |
| G11 | 🟠 High | `core/github_sync.js` manifest | Invented schema URLs `https://framegit.io/schemas/...` — not real resources. |
| G12 | 🟠 High | `plugin/premiere/*`, `plugin/resolve/*` | Port `41793` and domains hardcoded; panel reads plain `agent.auth`. |
| G13 | 🟠 High | testing | "Real" network tests use local mock servers; no test hits real S3/GitHub/Premiere. |
| G14 | 🟡 Medium | `core/config.js` | `getAuthor()` silently falls back to `'Unknown'`/`'unknown@framegit.local'` instead of failing closed. |
| G15 | 🟡 Medium | `core/change_engine.js`, `core/visual_diff.js` | Premiere tick constant `254016000000` baked into logic instead of adapter metadata. |
| G16 | 🟡 Medium | build | SEA build depends on global `npx esbuild/postject`; not pinned, not reproducible. |
| G17 | 🟡 Medium | distributed | No auto-update, no code signing, no CI release pipeline. |
| G18 | ⚪ Low | docs | `docs/` only has quickstart + cloud-setup; missing installation, CLI, config, plugin, architecture. |

---

## 2. Workstreams & Tasks

Ordering respects dependencies (A first; B/C/D parallel; E depends on B+C+D; F last).

### Workstream A — Zero-Hardcode Enforcement & Config Hardening (foundation)

**A1. Remove mock defaults from shipped config (G1).**
- Set `cloud.isMock:false`, `github.isMock:false` in `framegit.config.json`.
- Remove credential fields from the shipped file entirely (secrets must live in the vault or env).
- Replace placeholder user with empty strings; make author required at commit time (see A5).

**A2. Add a "no-hardcode" static linter.**
- New `scripts/lint_no_hardcode.js`: scans `core/`, `bin/`, `plugin/` and fails on:
  - literal `http(s)://` URLs not in a config/adapter constant allowlist,
  - literal `127.0.0.1`, `localhost`, ports (`\b4\d{4}\b`),
  - literal emails (`@` sequences), `editor@`, `studio.com`, `framegit.local`,
  - `Math.random()` used for IDs,
  - `isMock`/`Mock`/`simulate`/`fake`/`dummy` tokens in `core/`,
  - `framegit.io` URLs.
- Wire into `npm test` and CI. This is the guardrail that keeps the codebase honest.

**A3. Config completeness audit.**
- For every literal discovered by A2, add a config key + default in `core/config.js` and
  `framegit.schema.json`, loaded in the documented precedence order
  (CLI > env > project > global > defaults).
- Add `daemon.publicBaseUrl`, `github.oauthClientId`, `project.framegitignoreFilename`,
  `editor.*` metadata, `logging.*`, `update.feedUrl`.

**A4. Fail-closed config validation.**
- `loadConfig({ validate:true })` must throw `ConfigurationError` naming the missing key
  when a real operation needs it (e.g. `push` without endpoint/bucket).
- Validate loaded config against `framegit.schema.json` (add a tiny dependency or hand-rolled
  validator) in CI.

**A5. Author identity required (G14).**
- `getAuthor()` throws `AuthorNotConfiguredError` (already defined in `core/errors.js`) when
  unset; the CLI catches it and prints the exact `framegit config set user.name …` fix.
- Never fall back to `'Unknown'`.

**A6. Remove dummy artifacts (G10).**
- Delete root `Project.prproj`; move any needed sample to `test/fixtures/`.
- Add a repo-hygiene test asserting no `dummy`/`fake` fixture content outside `test/`.

**Acceptance:** linter exit 0; config schema validation passes; `framegit push` with empty config
fails with a clear actionable message instead of silently using mock mode.

---

### Workstream B — Real Cloud Storage (S3 / R2 / MinIO / B2)

**B1. Purge test backdoors (G6).**
- Delete `simulateNetworkFailure` from `core/cloud_client.js`.
- Extract the in-memory fake into `test/mocks/mock_cloud_client.js`; production `CloudClient`
  must have no `isMock` branch at all. Tests inject the fake via dependency injection.
- If `isMock` must remain for unit tests, gate it behind an explicit constructor option used
  **only** by tests, and ensure the linter ignores `test/`.

**B2. Real multipart + retry hardening.**
- Verify `uploadMultipart` against MinIO (Docker) and Cloudflare R2: correct `UploadId` parse,
  part ETag quoting, abort-on-failure, and >5 GB part streaming (avoid loading whole buffer).
- Replace buffer-in-memory multipart with **streaming** parts for multi-GB chunks; assert bounded RSS.
- Confirm retry/jitter for 429/5xx/timeouts; add per-request timeout config.

**B3. Presigned URLs + resumable uploads.**
- Implement `generatePresignedUrl(key, expiresIn)` (roadmap Phase 15) for direct download from panel.
- Persist uploaded-part state in `sync_queue` (schema exists) so interrupted uploads resume.

**B4. Integration test: real bucket (gated).**
- `test/integration/cloud_real.test.js`: if `FRAMEGIT_IT_S3=1` + creds present, run put/head/get/
  delete/list/multipart against the real bucket; otherwise skip with a clear notice.
- CI job spins MinIO via Docker and sets the env vars so it actually runs in CI.

**Acceptance:** push/pull round-trips real bytes to a real bucket; `headObject` dedup works;
multipart upload of a >5 MB chunk succeeds; no mock path exists in `core/cloud_client.js`.

---

### Workstream C — Real GitHub Integration

**C1. Break the core→test dependency (G2).**
- Move `MockGitHubApi` entirely to `test/mocks/mock_github.js`.
- Delete `require('../test/mocks/mock_github')` and the `MockGitHubApi` export from `core/github_sync.js`.
- `GitHubSync` accepts an injected `apiClient`; production always constructs `GitHubApiClient`.

**C2. Implement real reconstruction (G3).**
- `reconstructFromGitHubAndCloud`: fetch `.framegit/manifest.json` via GitHub **Contents API**
  (`GET /repos/{owner}/{repo}/contents/{path}` or the Git Data blob API), parse it, then pull
  commit/tree objects + chunks from the cloud client and rebuild the workspace.
- Add `GitHubApiClient.getContents(repo, path, ref)` and `getBlob(repo, sha)`.
- Remove the `{content:'{}'}` fallback — throw a typed error if the manifest is missing.

**C3. Real, configurable OAuth (G4).**
- Move the client ID to config: `github.oauthClientId` (+ optional `github.oauthClientSecret`
  in the vault for refresh). Document how to register a GitHub OAuth App.
- Add a Personal Access Token path (`framegit config set-secret github.token`) as the
  guaranteed fallback so login always has a working route.
- Add `framegit login` / `framegit logout` CLI commands; store tokens in `core/vault.js`.

**C4. Real schema URLs (G11).**
- Either publish real JSON schemas under a domain we control, or switch the manifest `schema`
  field to a versioned identifier stored in-repo (e.g. `"framegit-manifest/1"`).
- Remove every `framegit.io` literal.

**C5. Integration test: real GitHub (gated).**
- `test/integration/github_real.test.js`: with `FRAMEGIT_IT_GITHUB=1` + token, create a scratch
  repo (or use a test repo), push a manifest, fetch it back, reconstruct, and assert equality;
  clean up after. CI gate with a bot token in secrets.

**Acceptance:** `framegit push` mirrors metadata to a real repo; clone from GitHub+cloud
reconstructs the project; `grep -R "framegit.io" core/` is empty; no `Mock` import in `core/`.

---

### Workstream D — CLI, Editors & Plugin Polish

**D1. Wire `framegit clone` (G5).**
- Add `case 'clone'`: parse `<remote> <target-dir>`, resolve remote config (endpoint/bucket/repo),
  construct `CloudClient` + `SyncEngine`, call `SyncEngine.clone(target, branch)`, then run
  `GitHubSync.reconstructFromGitHubAndCloud` when a GitHub metadata repo is configured.
- Add `--branch`, `--depth` (full/smart/lazy per `Idea.txt` §8) options.

**D2. Real `openProject` semantics (G7).**
- The **daemon** cannot launch Premiere; redefine adapter `openProject` honestly: it emits the
  correct OS launch/UXP action and returns a clear "not available headless" result — never a
  fake `{opened:true}`. Move actual open logic into the UXP plugin (`app.openDocument`).

**D3. Remove `Math.random()` IDs (G8) and hardcoded parser defaults (G9).**
- Use `crypto.randomUUID()` everywhere IDs are minted.
- Pull `'Untitled Sequence'` / `'FrameGit Project'` from configurable defaults or derive from the
  source project; never invent a name.

**D4. Dynamic daemon port / discovery (G12).**
- Daemon writes `{port, host, token}` to `.framegit/agent.auth` (already does) with restrictive
  perms; plugin reads it via UXP filesystem API instead of hardcoding `41793`.
- UXP manifest domains: use `http://127.0.0.1:*`/`ws://127.0.0.1:*` if Adobe permits, else
  document the port requirement and make the daemon prefer the configured port.
- Update `plugin/resolve/framegit_resolve.py` to read the same discovery file.

**D5. Real editor validation.**
- Load the panel in Adobe UXP Developer Tool against a running daemon; fix CSP/sandbox issues.
- Verify `app.project.save()` API shape in Premiere 2024/2025.
- Install `plugin/resolve/framegit_resolve.py` and verify `Workspace > Scripts` export+commit.
- Document results in `docs/premiere-setup.md` / `docs/resolve-setup.md`.

**Acceptance:** `framegit clone` runs end-to-end from CLI; panel commits inside Premiere;
Resolve script exports+commits; zero hardcoded ports in `plugin/`.

---

### Workstream E — End-to-End Integration Test Matrix

Create `test/integration/` with gated tests (skip cleanly when secrets absent; **required** in CI):

| Test | Fixture | Gate | Asserts |
|------|---------|------|---------|
| `cloud_real` | MinIO (CI) / R2 | `FRAMEGIT_IT_S3=1` | put/head/get/list/delete/multipart, dedup, resume |
| `github_real` | scratch repo | `FRAMEGIT_IT_GITHUB=1` | blob/tree/commit/ref, manifest round-trip, reconstruct |
| `e2e_local` | real `.prproj`/`.drp` fixtures | always | init→commit→branch→checkout→diff→restore→fsck |
| `e2e_remote` | two temp dirs | S3+GitHub gates | machine-A push → machine-B clone → hash equality |
| `e2e_memory` | 10 GB synthetic stream | always | chunking bounded RSS < 250 MB |

- Add `test/fixtures/` sanitized real project files (already partially present).
- Every test asserts **no mock** was used (e.g. assert config `isMock === false`).

**Acceptance:** `npm run test:integration` passes against real services; `npm test` (unit) remains
hermetic and fast.

---

### Workstream F — Packaging, CI, Docs & Release

**F1. Reproducible SEA build (G16).**
- Pin `esbuild` + `postject` as devDependencies; invoke local binaries, not global `npx`.
- Verify `dist/framegit.exe --version`/`status` on a machine without Node.
- Handle `node:sqlite` inside the SEA bundle (verify it loads from the embedded bundle).

**F2. CI pipeline.**
- GitHub Actions: matrix (Windows/macOS/Linux) → lint (A2) → unit tests → integration tests
  (MinIO service) → build SEA + `.ccx` → upload artifacts.
- Add branch protection requiring green CI.

**F3. Versioning, signing, auto-update (G17).**
- Semantic versioning; single source of truth for `VERSION` (currently duplicated in `bin/` and README).
- Windows code signing for the `.exe`; NSIS installer review (`installer/windows/installer.nsi`).
- Auto-update check against GitHub Releases (roadmap Phase 21.4).

**F4. Documentation (G18).**
- `docs/installation.md`, `docs/cli-reference.md`, `docs/configuration.md`,
  `docs/premiere-setup.md`, `docs/resolve-setup.md`, `docs/architecture.md`.
- Update `README.md` and `PENDING_TASKS.md` to reflect true status.

**Acceptance:** tagged release produces signed installers + updater metadata; docs cover every
config key and command.

---

### Workstream G — Observability, Security & Performance (cross-cutting)

- **G-1 Structured logging:** route `config.logging` through one logger; no stray `console.log` in `core/`.
- **G-2 Error taxonomy:** ensure every thrown error is a typed `FrameGitError` subclass.
- **G-3 Security review:** vault key derivation strength, token expiry/rotation, path-traversal on
  clone/restore, XML entity handling, `.framegitignore` traversal, TLS cert handling.
- **G-4 Performance:** stream (don't buffer) large chunks on upload/download; measure RSS/throughput
  in `test/stress_benchmark.js`; target bounded memory and resumability.
- **G-5 Crash recovery:** verify rolling snapshots + `fsck --repair` under simulated disk-full
  (`ENOSPC`) and mid-write kill.

---

## 3. Execution Order

```
A (config/linter)
  ├─→ B (cloud)  ─┐
  ├─→ C (github) ─┼─→ E (e2e integration) ─→ F (packaging/release)
  └─→ D (CLI/editors) ┘
G (security/perf/logging) runs continuously alongside B–E
```

- **Phase 1 (blockers):** A1–A6, B1, C1–C4, D1–D3.
- **Phase 2 (real validation):** B2–B4, C5, D4–D5, E all.
- **Phase 3 (productization):** F1–F4, G cleanup.
- **Phase 4:** independent end-to-end acceptance run on a clean VM with a real editor + bucket + repo.

---

## 4. Resource Prerequisites

- A real **S3-compatible bucket** (Cloudflare R2 free tier recommended) + credentials.
- A **GitHub OAuth App** registration (client ID/secret) and/or a PAT with `repo` scope.
- A machine (or VM) with **Adobe Premiere Pro 2024/2025** and **DaVinci Resolve** for D5.
- A **real `.prproj`** and **`.drp`** project (sanitized) for fixtures.
- CI secrets: `FRAMEGIT_IT_S3`, `FRAMEGIT_IT_GITHUB`, cloud keys, GitHub bot token.

---

## 5. Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Editor APIs (UXP / Resolve `ExportProject`) differ from assumptions | D5 blocks | Validate early with a spike; keep daemon authoritative |
| Advertising OAuth client cannot ship publicly | Onboarding friction | Provide PAT fallback + clear self-hosting guide |
| SEA bundling breaks `node:sqlite`/native bits | No standalone exe | Test SEA early in CI on all OSes |
| Multi-GB streaming memory blowups | OOM in production | Streaming parts + RSS assertion test |
| Real bucket/GitHub cost in CI | Budget | MinIO local + ephemeral scratch repos; cleanup |

---

## 6. Progress Snapshot

| Workstream | Status |
|------------|--------|
| A — Zero-hardcode foundation | 🟡 A1 fixed (`framegit.config.json` no longer defaults to mock; user placeholders cleared). A2 linter built + CI wired. Baseline down to **29 entries / 54 matches** from 32/60. A3–A6 pending |
| B — Real cloud | 🟡 Code real, backdoor + mode to fix, unvalidated |
| C — Real GitHub | 🟡 **G2 cleared** — `MockGitHubApi` removed from `core/` (now injected; test imports from `test/mocks/`). **G3 cleared** — `reconstructFromGitHubAndCloud` uses `api.getFileContent()` (real Contents API on `GitHubApiClient`; no `{}` stub). G4 (placeholder OAuth) + G11 (framegit.io schemas) pending |
| D — CLI/editors | 🟡 14/15 commands; clone missing; editors unvalidated |
| E — Integration tests | ⬜ Only local-mock tests exist |
| F — Packaging/CI/docs | 🟡 Artifacts build; no CI/signing/updater; thin docs |
| G — Cross-cutting | ⬜ Not started |

> Update this table as tasks land. A workstream is done only when its Acceptance line is met.
