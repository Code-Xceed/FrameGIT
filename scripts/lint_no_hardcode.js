#!/usr/bin/env node

/**
 * FrameGit — No-Hardcode Static Linter
 *
 * Guards the production source tree against the patterns explicitly banned by
 * PRODUCTION_ROADMAP.md and PRODUCTION_PLAN.md (Workstream A):
 *
 *   1. Hardcoded external URLs (must come from config)
 *   2. Invented / unowned domains (e.g. framegit.io)
 *   3. Hardcoded loopback hosts and network ports
 *   4. Hardcoded / placeholder e-mail addresses
 *   5. Math.random() used to mint identifiers (must use crypto.randomUUID())
 *   6. Mock / fake / simulated code reachable from production (core/, bin/)
 *   7. Hardcoded placeholder project / sequence names
 *
 * Design notes:
 *   - Comments are ignored (a comment mentioning "mock" is not a violation).
 *   - String literals ARE scanned (that is where URLs and names live).
 *   - A per-rule allowlist permits legitimate third-party service defaults.
 *   - Inline suppression: add `no-hardcode-ignore` on a line (optionally
 *     `no-hardcode-ignore: rule-id, other-rule`) to skip it deliberately.
 *   - A baseline file records pre-existing debt so the linter can be enforced
 *     in CI today and fail on any NEW violation. Regenerate intentionally with
 *     `--update-baseline`.
 *
 * Usage:
 *   node scripts/lint_no_hardcode.js [--json] [--update-baseline] [--list-rules]
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TARGET_DIRS = ['core', 'bin', 'plugin'];
const SCAN_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.py', '.json', '.html']);
const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', '.framegit', '__pycache__']);
const BASELINE_PATH = path.join(__dirname, '.no_hardcode_baseline.json');

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

const GH = /^https?:\/\/(?:api\.)?github\.com(?:\/|$)/;

const RULES = [
  {
    id: 'invented-domain',
    severity: 'error',
    description: 'Invented/unowned domain literal',
    pattern: /framegit\.io/gi
  },
  {
    id: 'hardcoded-url',
    severity: 'error',
    description: 'Hardcoded external URL (must come from config)',
    pattern: /https?:\/\/[^\s'"`)<>\]]+/g,
    allow: [
      GH,
      /^https?:\/\/json-schema\.org(?:\/|$)/,
      /^https?:\/\/www\.w3\.org(?:\/|$)/,
      /^https?:\/\/schemas\.adobe\.com(?:\/|$)/
    ]
  },
  {
    id: 'loopback-literal',
    severity: 'warning',
    description: 'Hardcoded loopback host (use config daemon.host)',
    pattern: /\b(?:127\.0\.0\.1|localhost)\b/g
  },
  {
    id: 'literal-port',
    severity: 'warning',
    description: 'Hardcoded network port (use config daemon.port)',
    pattern: /\b41793\b/g
  },
  {
    id: 'placeholder-email',
    severity: 'error',
    description: 'Hardcoded/placeholder e-mail address',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    allow: [/@example\.(?:com|org)$/i, /@localhost$/i]
  },
  {
    id: 'math-random-id',
    severity: 'error',
    description: 'Math.random() used for an identifier (use crypto.randomUUID())',
    pattern: /Math\.random\(\)/g,
    lineMustAlsoMatch: /\b(?:id|identifier|uuid|guid|hash)\b|toString\(36\)|substring\(2\)/i
  },
  {
    id: 'mock-in-production',
    severity: 'error',
    description: 'Mock/fake/simulated code in production source',
    pattern: /\b(?:isMock|Mock[A-Za-z]*|simulate[A-Za-z]*|mock[A-Za-z]*|fake[A-Za-z]*|dummy[A-Za-z]*)\b/g,
    onlyInDirs: ['core', 'bin'],
    // core/config.js legitimately defines the `isMock` configuration fields.
    pathAllow: ['core/config.js']
  },
  {
    id: 'placeholder-name',
    severity: 'error',
    description: 'Hardcoded placeholder project/sequence name',
    pattern: /'(?:Untitled Sequence|FrameGit Project|Resolve Timeline|Resolve Clip)'/g
  }
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function relativeToRoot(absPath) {
  return toPosix(path.relative(ROOT, absPath));
}

/**
 * Build a per-character mask for one line where `false` marks characters that
 * are inside a comment. String-literal contents remain `true` so the linter
 * still inspects them. Handles multi-line block comments via `state`.
 *
 * @param {string} line
 * @param {{ inBlock: boolean }} state
 * @returns {boolean[]}
 */
function buildCodeMask(line, state) {
  const mask = new Array(line.length).fill(true);
  let i = 0;

  while (i < line.length) {
    if (state.inBlock) {
      const end = line.indexOf('*/', i);
      if (end === -1) {
        for (; i < line.length; i++) mask[i] = false;
        break;
      }
      for (; i < end + 2; i++) mask[i] = false;
      state.inBlock = false;
      continue;
    }

    const ch = line[i];

    // String literal — consume it but keep marking contents as code.
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < line.length) {
        if (line[i] === '\\') { i += 2; continue; }
        if (line[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }

    // Line comment.
    if (ch === '/' && line[i + 1] === '/') {
      for (; i < line.length; i++) mask[i] = false;
      break;
    }

    // Block comment (may open and close on the same line).
    if (ch === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2);
      if (end === -1) {
        for (; i < line.length; i++) mask[i] = false;
        state.inBlock = true;
        break;
      }
      for (; i < end + 2; i++) mask[i] = false;
      i = end + 2;
      continue;
    }

    i++;
  }

  return mask;
}

/**
 * Parse an inline suppression directive on a raw line.
 * @returns {null | Set<string> | true} `null` = no directive; `true` = suppress all;
 *   otherwise a Set of rule ids to suppress.
 */
function parseSuppression(rawLine) {
  const idx = rawLine.indexOf('no-hardcode-ignore');
  if (idx === -1) return null;

  const after = rawLine.slice(idx + 'no-hardcode-ignore'.length);
  const colon = after.indexOf(':');
  if (colon === -1) return true;

  const ids = after
    .slice(colon + 1)
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean);

  return ids.length > 0 ? new Set(ids) : true;
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (EXCLUDED_DIRS.has(ent.name)) continue;
      walk(path.join(dir, ent.name), out);
    } else if (ent.isFile()) {
      if (SCAN_EXTENSIONS.has(path.extname(ent.name))) {
        out.push(path.join(dir, ent.name));
      }
    }
  }
}

function ruleAppliesToPath(rule, relPath) {
  if (rule.pathAllow && rule.pathAllow.includes(relPath)) return false;
  if (rule.onlyInDirs) {
    const top = relPath.split('/')[0];
    if (!rule.onlyInDirs.includes(top)) return false;
  }
  return true;
}

function normalizeMatch(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function violationKey(v) {
  return `${v.file}|${v.ruleId}|${normalizeMatch(v.match)}`;
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

function scanFile(absPath) {
  const relPath = relativeToRoot(absPath);
  let content;
  try {
    content = fs.readFileSync(absPath, 'utf-8');
  } catch {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const state = { inBlock: false };
  const violations = [];

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const rawLine = lines[lineNo];
    const mask = buildCodeMask(rawLine, state);
    const suppression = parseSuppression(rawLine);

    for (const rule of RULES) {
      if (!ruleAppliesToPath(rule, relPath)) continue;
      if (suppression === true) continue;
      if (suppression instanceof Set && suppression.has(rule.id)) continue;
      if (rule.lineMustAlsoMatch && !rule.lineMustAlsoMatch.test(rawLine)) continue;

      rule.pattern.lastIndex = 0;
      let m;
      while ((m = rule.pattern.exec(rawLine)) !== null) {
        const start = m.index;
        // Ignore matches that begin inside a comment.
        if (mask[start] === false) continue;
        // Zero-length guard.
        if (m[0].length === 0) { rule.pattern.lastIndex++; continue; }

        const matched = m[0];
        if (rule.allow && rule.allow.some(re => re.test(matched))) continue;

        violations.push({
          ruleId: rule.id,
          severity: rule.severity,
          description: rule.description,
          file: relPath,
          line: lineNo + 1,
          column: start + 1,
          match: matched,
          snippet: rawLine.trim().slice(0, 160)
        });
      }
    }
  }

  return violations;
}

function scan() {
  const files = [];
  for (const dir of TARGET_DIRS) {
    walk(path.join(ROOT, dir), files);
  }
  files.sort();

  const violations = [];
  for (const file of files) {
    violations.push(...scanFile(file));
  }
  return { filesScanned: files.length, violations };
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

function loadBaseline(baselinePath) {
  try {
    const raw = fs.readFileSync(baselinePath, 'utf-8');
    const data = JSON.parse(raw);
    return new Set(Array.isArray(data.entries) ? data.entries : []);
  } catch {
    return new Set();
  }
}

function writeBaseline(baselinePath, violations) {
  const entries = Array.from(new Set(violations.map(violationKey))).sort();
  const payload = {
    version: 1,
    note: 'Known pre-existing no-hardcode debt. Remove entries as they are fixed. Regenerate with: node scripts/lint_no_hardcode.js --update-baseline',
    count: entries.length,
    entries
  };
  fs.writeFileSync(baselinePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  return entries;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printRules() {
  console.log('FrameGit no-hardcode rules:\n');
  for (const r of RULES) {
    console.log(`  [${r.severity}] ${r.id}`);
    console.log(`      ${r.description}`);
  }
}

function groupByRule(violations) {
  const groups = new Map();
  for (const v of violations) {
    if (!groups.has(v.ruleId)) groups.set(v.ruleId, []);
    groups.get(v.ruleId).push(v);
  }
  return groups;
}

function printViolations(title, violations) {
  if (violations.length === 0) return;
  console.log(`\n${title}`);
  const groups = groupByRule(violations);
  for (const [ruleId, list] of groups) {
    console.log(`\n  [${ruleId}] ${list.length}`);
    for (const v of list) {
      console.log(`    ${v.file}:${v.line}:${v.column}`);
      console.log(`      > ${v.snippet}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list-rules')) {
    printRules();
    return 0;
  }

  const asJson = args.includes('--json');
  const updateBaseline = args.includes('--update-baseline');
  const baselineArgIdx = args.indexOf('--baseline');
  const baselinePath = baselineArgIdx !== -1 ? path.resolve(args[baselineArgIdx + 1]) : BASELINE_PATH;

  const { filesScanned, violations } = scan();

  if (updateBaseline) {
    const entries = writeBaseline(baselinePath, violations);
    if (asJson) {
      console.log(JSON.stringify({ filesScanned, baselined: entries.length }, null, 2));
    } else {
      console.log(`Baseline updated: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} written to ${relativeToRoot(baselinePath)}`);
    }
    return 0;
  }

  const baseline = loadBaseline(baselinePath);
  const baselined = violations.filter(v => baseline.has(violationKey(v)));
  const fresh = violations.filter(v => !baseline.has(violationKey(v)));

  if (asJson) {
    console.log(JSON.stringify({
      filesScanned,
      total: violations.length,
      new: fresh.length,
      baselined: baselined.length,
      violations: fresh.map(v => ({
        rule: v.ruleId,
        severity: v.severity,
        file: v.file,
        line: v.line,
        column: v.column,
        match: v.match
      }))
    }, null, 2));
  } else {
    console.log('===========================================================');
    console.log('        FRAMEGIT NO-HARDCODE LINTER                        ');
    console.log('===========================================================');
    console.log(`Scanned ${filesScanned} file(s) in: ${TARGET_DIRS.join(', ')}`);

    if (fresh.length > 0) {
      printViolations('NEW VIOLATIONS (fix these or regenerate the baseline intentionally):', fresh);
    }

    if (baselined.length > 0) {
      console.log(`\n${baselined.length} known issue(s) suppressed by the baseline`);
      console.log(`(${relativeToRoot(baselinePath)}). Fix them and shrink the baseline over time.`);
    }

    console.log('\n-----------------------------------------------------------');
    if (fresh.length > 0) {
      console.log(`FAIL: ${fresh.length} new violation(s), ${baselined.length} baselined.`);
    } else if (baselined.length > 0) {
      console.log(`PASS: no new violations (${baselined.length} baselined).`);
    } else {
      console.log('PASS: no hardcoded patterns detected.');
    }
    console.log('===========================================================');
  }

  return fresh.length > 0 ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(`Linter internal error: ${err.message}`);
    process.exitCode = 2;
  }
}

module.exports = { RULES, scan, violationKey, buildCodeMask };
