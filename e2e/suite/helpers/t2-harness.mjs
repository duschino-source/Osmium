import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const ROOT_DIR = '/home/antigravity';

export const FEATURE_WORKSPACE_MAP = {
  1: ['docs/PLAN.md', 'docs/PROGRESS.md'],
  2: ['packages/core', 'packages/adapters'],
  3: ['packages/core', 'packages/ide-core'],
  4: ['packages/adapters', 'docs/adapters'],
  5: ['packages/adapters', 'packages/core'],
  6: ['packages/mock-cli'],
  7: ['packages/core'],
  8: ['packages/core'],
  9: ['packages/core'],
  10: ['packages/core', 'packages/adapters'],
  11: ['packages/core'],
  12: ['packages/core'],
  13: ['packages/core'],
  14: ['packages/core'],
  15: ['packages/ide-core'],
  16: ['packages/ide-core', 'apps/desktop'],
  17: ['packages/ide-core'],
  18: ['packages/ide-core'],
  19: ['packages/ide-core'],
  20: ['packages/ide-core'],
  21: ['packages/ide-core', 'apps/desktop'],
  22: ['packages/ide-core'],
  23: ['packages/adapters', 'packages/ide-core'],
  24: ['packages/ui', 'apps/desktop'],
};

/**
 * Checks workspace artifacts for a given feature and enforces existence if strictWorkspace is set.
 */
export function resolveWorkspaceFeature(ctx = {}, featureNumber) {
  const rootDir = ctx.rootDir || ROOT_DIR;
  const strict = Boolean(ctx.strictWorkspace || process.env.OSMIUM_E2E_STRICT === '1');
  const expectedRelPaths = FEATURE_WORKSPACE_MAP[featureNumber] || [];
  const existing = [];
  const missing = [];

  for (const rel of expectedRelPaths) {
    const abs = path.join(rootDir, rel);
    if (fs.existsSync(abs)) {
      existing.push(abs);
    } else {
      missing.push(abs);
    }
  }

  if (strict && missing.length > 0) {
    assert.fail(
      `[Strict Workspace Mode] Feature F${String(featureNumber).padStart(2, '0')} missing required workspace paths: ${missing.join(', ')}`
    );
  }

  return {
    rootDir,
    strict,
    fullyPresent: missing.length === 0 && existing.length > 0,
    existing,
    missing,
  };
}

/**
 * Dynamically imports a workspace module if it exists on disk.
 */
export async function tryImportWorkspaceModule(rootDir, candidateRelPaths) {
  for (const rel of candidateRelPaths) {
    const abs = path.join(rootDir || ROOT_DIR, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      try {
        return await import(pathToFileURL(abs).href);
      } catch {
        // Fallback if TypeScript source requires compilation first
      }
    }
  }
  return null;
}

/**
 * Executes a callback with a fresh temporary directory in /tmp/osmium-e2e-t2-* and cleans up in finally.
 */
export async function withTempDir(fn, prefix = 'osmium-e2e-t2-') {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return await fn(tmpDir);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup race
    }
  }
}

/**
 * Runs a git command synchronously in a specified directory and returns stdout/stderr/status.
 */
export function runGit(cwd, args, extraEnv = {}) {
  const res = spawnSync('/usr/bin/git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Osmium Test',
      GIT_AUTHOR_EMAIL: 'test@osmium.local',
      GIT_COMMITTER_NAME: 'Osmium Test',
      GIT_COMMITTER_EMAIL: 'test@osmium.local',
      ...extraEnv,
    },
    encoding: 'utf8',
  });
  return {
    status: res.status ?? 1,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
    rawStdout: res.stdout || '',
  };
}

/**
 * Creates a real temporary Git repository in /tmp/osmium-e2e-t2-git-* with an initial commit.
 */
export async function withTempGitRepo(fn, opts = {}) {
  return withTempDir(async (repoDir) => {
    const initRes = runGit(repoDir, ['init', '-b', opts.defaultBranch || 'main']);
    assert.equal(initRes.status, 0, `git init failed: ${initRes.stderr}`);
    runGit(repoDir, ['config', 'user.name', 'Osmium Test']);
    runGit(repoDir, ['config', 'user.email', 'test@osmium.local']);

    const initialFiles = opts.initialFiles || {
      'README.md': '# Sample Project\n',
      'src/index.ts': 'export const main = () => "hello";\n',
    };
    for (const [relPath, content] of Object.entries(initialFiles)) {
      const fullPath = path.join(repoDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      if (Buffer.isBuffer(content)) {
        fs.writeFileSync(fullPath, content);
      } else {
        fs.writeFileSync(fullPath, content, 'utf8');
      }
    }

    runGit(repoDir, ['add', '-A']);
    const commitRes = runGit(repoDir, ['commit', '-m', 'Initial commit']);
    assert.equal(commitRes.status, 0, `Initial commit failed: ${commitRes.stderr}`);

    if (opts.createIntegrationBranch !== false) {
      runGit(repoDir, ['branch', 'osmium/integration']);
    }

    try {
      return await fn(repoDir);
    } finally {
      // Prune any worktrees created inside repoDir before rmSync
      runGit(repoDir, ['worktree', 'prune']);
    }
  }, 'osmium-e2e-t2-git-');
}

/* ============================================================================
 * FEATURE 1: docs/PLAN.md & docs/PROGRESS.md Validators & Recovery
 * ============================================================================ */

export function validateProgressDoc(markdownContent) {
  if (typeof markdownContent !== 'string' || markdownContent.trim().length === 0) {
    return {
      valid: false,
      empty: true,
      missingSections: ['done', 'next', 'decisions', 'open_questions'],
    };
  }
  const lower = markdownContent.toLowerCase();
  const checks = [
    { key: 'done', regex: /^#{1,3}\s+.*(what is done|done|completed)/m },
    { key: 'next', regex: /^#{1,3}\s+.*(what is next|next)/m },
    { key: 'decisions', regex: /^#{1,3}\s+.*(decisions made|decisions)/m },
    { key: 'open_questions', regex: /^#{1,3}\s+.*(open questions|questions|risks)/m },
  ];
  const missingSections = [];
  for (const c of checks) {
    if (!c.regex.test(lower)) {
      missingSections.push(c.key);
    }
  }
  return {
    valid: missingSections.length === 0,
    empty: false,
    missingSections,
  };
}

export function validateSection10Report(reportMarkdown) {
  const required = [
    { id: '1. Done', pattern: /(?:^|\n)\s*(?:#{1,4}\s*)?1\.\s*Done\b/i },
    { id: '2. Not done', pattern: /(?:^|\n)\s*(?:#{1,4}\s*)?2\.\s*Not done\b/i },
    { id: '3. Decisions', pattern: /(?:^|\n)\s*(?:#{1,4}\s*)?3\.\s*Decisions\b/i },
    { id: '4. Problems', pattern: /(?:^|\n)\s*(?:#{1,4}\s*)?4\.\s*Problems\b/i },
    { id: '5. How to run and test it', pattern: /(?:^|\n)\s*(?:#{1,4}\s*)?5\.\s*How to run and test it\b/i },
    { id: '6. Next', pattern: /(?:^|\n)\s*(?:#{1,4}\s*)?6\.\s*Next\b/i },
  ];
  const missingHeadings = [];
  for (const req of required) {
    if (!req.pattern.test(reportMarkdown || '')) {
      missingHeadings.push(req.id);
    }
  }
  return {
    valid: missingHeadings.length === 0,
    missingHeadings,
  };
}

export function recoverCorruptedProgress(projectDir) {
  const docsDir = path.join(projectDir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const progressPath = path.join(docsDir, 'PROGRESS.md');
  let raw = '';
  let corrupted = false;

  if (fs.existsSync(progressPath)) {
    const buf = fs.readFileSync(progressPath);
    if (buf.length === 0 || buf.includes(0)) {
      corrupted = true;
    } else {
      raw = buf.toString('utf8');
      const v = validateProgressDoc(raw);
      if (!v.valid) corrupted = true;
    }
  } else {
    corrupted = true;
  }

  if (corrupted) {
    if (fs.existsSync(progressPath) && fs.statSync(progressPath).size > 0) {
      fs.copyFileSync(progressPath, `${progressPath}.bak`);
    }
    const recovered = [
      '# Osmium Progress',
      '',
      '## What is done',
      '- Reconstructed from repository state after corrupted PROGRESS.md.',
      '',
      '## What is next',
      '- Resume next phase according to docs/PLAN.md.',
      '',
      '## Decisions made',
      '- Local-first SQLite and git checkpoint architecture.',
      '',
      '## Open questions',
      '- Final open-source license selection (MIT vs Apache-2.0).',
      '',
    ].join('\n');
    fs.writeFileSync(progressPath, recovered, 'utf8');
    return { recovered: true, content: recovered, backupCreated: fs.existsSync(`${progressPath}.bak`) };
  }
  return { recovered: false, content: raw, backupCreated: false };
}

export function reconstructClipboardPasteArtifacts(text) {
  const artifactPattern = /@\[[^\]]+\]\s*/g;
  const cleaned = text.replace(artifactPattern, '');
  return {
    originalHadArtifact: artifactPattern.test(text),
    cleaned,
  };
}

export function updateProgressWithConcurrencyGuard(progressPath, expectedMtimeMs, sectionHeading, newBullet) {
  const stat = fs.statSync(progressPath);
  if (expectedMtimeMs !== undefined && Math.abs(stat.mtimeMs - expectedMtimeMs) > 0.5) {
    const err = new Error(`Concurrent modification detected on ${progressPath}`);
    err.code = 'ERR_CONCURRENT_PROGRESS_UPDATE';
    err.actualMtimeMs = stat.mtimeMs;
    throw err;
  }
  const current = fs.readFileSync(progressPath, 'utf8');
  const updated = `${current.trimEnd()}\n- [${sectionHeading}] ${newBullet}\n`;
  fs.writeFileSync(progressPath, updated, 'utf8');
  return { ok: true, newMtimeMs: fs.statSync(progressPath).mtimeMs };
}

/* ============================================================================
 * FEATURE 2: Child-Process-Only CLI Execution & Zero API Keys
 * ============================================================================ */

const FORBIDDEN_CREDENTIAL_PATTERNS = [
  /(?:^|[\\/])\.ssh(?:[\\/]|$)/i,
  /(?:^|[\\/])\.netrc$/i,
  /(?:^|[\\/])\.aws[\\/]credentials$/i,
  /(?:^|[\\/])\.config[\\/]gh[\\/]hosts\.yml$/i,
  /(?:^|[\\/])\.codex[\\/]auth\.json$/i,
  /(?:^|[\\/])\.deepseek[\\/]credentials$/i,
  /cookies\.sqlite$/i,
];

export function assertNotCredentialPath(targetPath) {
  const normalized = path.normalize(targetPath);
  for (const pattern of FORBIDDEN_CREDENTIAL_PATTERNS) {
    if (pattern.test(normalized)) {
      const err = new Error(`Forbidden credential access blocked: ${targetPath}`);
      err.code = 'ERR_CREDENTIAL_ACCESS_FORBIDDEN';
      throw err;
    }
  }
  return true;
}

export function validateZeroApiKeyRequirement(configObject) {
  const forbiddenKeys = ['apiKey', 'api_key', 'openaiApiKey', 'deepseekApiKey', 'authToken', 'bearerToken', 'secretKey'];
  const found = [];

  function walk(obj, prefix = '') {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${k}` : k;
      if (forbiddenKeys.includes(k)) {
        found.push(fullKey);
      }
      if (v && typeof v === 'object') {
        walk(v, fullKey);
      }
    }
  }

  walk(configObject);
  if (found.length > 0) {
    const err = new Error(`API keys or tokens are strictly prohibited in Osmium config: ${found.join(', ')}`);
    err.code = 'ERR_API_KEY_PROHIBITED';
    err.keys = found;
    throw err;
  }
  return { valid: true };
}

export function guardProcessSpawnContext(processContext) {
  if (processContext !== 'main') {
    const err = new Error(`Process spawning is forbidden in '${processContext}' context; only Electron 'main' process may spawn child processes.`);
    err.code = 'ERR_RENDERER_SPAWN_FORBIDDEN';
    throw err;
  }
  return true;
}

/* ============================================================================
 * FEATURE 3: Workspace Write Boundary Guard
 * ============================================================================ */

export class WorkspaceBoundaryGuard {
  constructor(projectRoot, opts = {}) {
    this.projectRoot = fs.realpathSync(projectRoot);
    this.activeWorktree = opts.activeWorktree ? fs.realpathSync(opts.activeWorktree) : null;
    this.globalOsmiumDir = opts.globalOsmiumDir
      ? path.resolve(opts.globalOsmiumDir)
      : path.join(os.homedir(), '.osmium');
  }

  validateWritePath(inputPath) {
    if (typeof inputPath !== 'string' || inputPath.length === 0) {
      const err = new Error('Write path must be a non-empty string');
      err.code = 'ERR_INVALID_PATH';
      throw err;
    }
    if (inputPath.includes('\0')) {
      const err = new Error('Null byte injection detected in file path');
      err.code = 'ERR_NULL_BYTE_PATH';
      throw err;
    }

    // Normalize Windows backslashes even on Linux so ..\..\ cannot bypass relative path checks
    const posixNormalized = inputPath.replace(/\\/g, '/');
    const baseDir = this.activeWorktree || this.projectRoot;
    const resolvedCandidate = path.resolve(baseDir, posixNormalized);

    // Walk up to the deepest existing ancestor to resolve symlinks via realpathSync
    let current = resolvedCandidate;
    const trailingSegments = [];
    while (!fs.existsSync(current)) {
      const parent = path.dirname(current);
      if (parent === current) break;
      trailingSegments.unshift(path.basename(current));
      current = parent;
    }

    // Also check if the target itself is a broken symlink escaping the boundary
    try {
      const lstat = fs.lstatSync(resolvedCandidate);
      if (lstat.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(resolvedCandidate);
        const absLinkTarget = path.resolve(path.dirname(resolvedCandidate), linkTarget);
        current = absLinkTarget;
        trailingSegments.length = 0;
        while (!fs.existsSync(current)) {
          const parent = path.dirname(current);
          if (parent === current) break;
          trailingSegments.unshift(path.basename(current));
          current = parent;
        }
      }
    } catch {
      // Not an existing symlink
    }

    const realExisting = fs.existsSync(current) ? fs.realpathSync(current) : current;
    const finalRealPath = path.join(realExisting, ...trailingSegments);

    if (this.activeWorktree) {
      const relToWorktree = path.relative(this.activeWorktree, finalRealPath);
      if (relToWorktree.startsWith('..') || path.isAbsolute(relToWorktree)) {
        const err = new Error(
          `Worktree boundary violation: task worktree '${this.activeWorktree}' cannot write to '${finalRealPath}'`
        );
        err.code = 'ERR_WORKTREE_BOUNDARY_VIOLATION';
        throw err;
      }
      return finalRealPath;
    }

    const relToRoot = path.relative(this.projectRoot, finalRealPath);
    const relToGlobal = path.relative(this.globalOsmiumDir, finalRealPath);
    const insideRoot = !relToRoot.startsWith('..') && !path.isAbsolute(relToRoot);
    const insideGlobal = !relToGlobal.startsWith('..') && !path.isAbsolute(relToGlobal);

    if (!insideRoot && !insideGlobal) {
      const err = new Error(
        `Workspace boundary violation: refusing to write outside project root ('${this.projectRoot}'): '${finalRealPath}'`
      );
      err.code = 'ERR_WORKSPACE_BOUNDARY_VIOLATION';
      throw err;
    }

    return finalRealPath;
  }

  safeWriteFileSync(targetPath, content) {
    const validatedPath = this.validateWritePath(targetPath);
    fs.mkdirSync(path.dirname(validatedPath), { recursive: true });
    fs.writeFileSync(validatedPath, content);
    return validatedPath;
  }
}

/* ============================================================================
 * FEATURE 4: CLI Detection, Probing & Version Warnings
 * ============================================================================ */

export function compareSemver(a, b) {
  const parse = (v) => {
    const m = String(v || '').match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

export async function probeCliExecutable(execPath, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 1500;
  const testedVersion = opts.testedVersion ?? '1.0.0';

  if (!execPath || !fs.existsSync(execPath)) {
    return { installed: false };
  }

  const runProbeArg = (arg) =>
    new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const child = spawn(execPath, [arg], { stdio: ['ignore', 'pipe', 'pipe'] });

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill('SIGKILL');
          resolve({ timedOut: true, stdout, stderr, code: null });
        }
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ timedOut: false, error: err, stdout, stderr, code: 1 });
        }
      });
      child.on('close', (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ timedOut: false, stdout, stderr, code });
        }
      });
    });

  const verRes = await runProbeArg('--version');
  if (verRes.timedOut) {
    return {
      installed: false,
      timedOut: true,
      versionWarning: `CLI probe timed out after ${timeoutMs}ms`,
    };
  }
  if (verRes.error) {
    return { installed: false };
  }

  const semverMatch = verRes.stdout.match(/(\d+\.\d+\.\d+)/);
  const version = semverMatch ? semverMatch[1] : undefined;
  let versionWarning;
  if (!version) {
    versionWarning = `Unparseable version output from ${ path.basename(execPath) }: ${JSON.stringify(verRes.stdout.trim().slice(0, 40))}`;
  } else if (compareSemver(version, testedVersion) === 1) {
    versionWarning = `Installed version ${version} is newer than tested version ${testedVersion}`;
  }

  const helpRes = await runProbeArg('--help');
  const helpText = `${helpRes.stdout}\n${helpRes.stderr}`.toLowerCase();
  const capabilities = {
    acp: helpText.includes('--acp') || helpText.includes('acp'),
    jsonStream: helpText.includes('--json') || helpText.includes('json'),
    resume: helpText.includes('--resume') || helpText.includes('resume'),
    approvals: helpText.includes('--approval') || helpText.includes('ask'),
    readOnlyMode: helpText.includes('--read-only') || helpText.includes('readonly'),
    reportsUsage: helpText.includes('usage') || helpText.includes('quota'),
    testedVersion,
  };

  const degradedNotes = [];
  if (!capabilities.resume) {
    degradedNotes.push('No native --resume support; Osmium will re-send handoff summary via systemContext.');
  }

  return {
    installed: true,
    path: execPath,
    version,
    versionWarning,
    capabilities,
    degradedNotes,
  };
}

/* ============================================================================
 * FEATURE 5: Multi-Transport Session Normalization
 * ============================================================================ */

export function stripAnsiCodes(input) {
  // eslint-disable-next-line no-control-regex
  return String(input).replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

export class NormalizedEventStreamParser {
  constructor(opts = {}) {
    this.maxBufferBytes = opts.maxBufferBytes ?? 16 * 1024 * 1024; // 16 MB
    this.buffer = '';
    this.events = [];
    this.state = 'idle';
  }

  writeChunk(chunk) {
    const str = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    if (this.buffer.length + str.length > this.maxBufferBytes) {
      const overflow = this.buffer + str;
      this.buffer = '';
      const event = {
        type: 'raw',
        data: overflow.slice(0, this.maxBufferBytes),
        truncated: true,
      };
      this.events.push(event);
      return [event];
    }

    this.buffer += str;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';
    const emitted = [];

    for (const rawLine of lines) {
      if (rawLine.length === 0) continue;
      const cleanLine = stripAnsiCodes(rawLine).trim();
      let parsed = null;
      if (cleanLine.startsWith('{') && cleanLine.endsWith('}')) {
        try {
          parsed = JSON.parse(cleanLine);
        } catch {
          parsed = null;
        }
      }

      if (parsed && typeof parsed.type === 'string' && ['message', 'tool', 'file-edit', 'approval', 'usage', 'status', 'raw'].includes(parsed.type)) {
        if (parsed.type === 'status') {
          this.state = parsed.state;
        }
        this.events.push(parsed);
        emitted.push(parsed);
      } else {
        const rawEvt = { type: 'raw', data: rawLine, cleanText: cleanLine };
        this.events.push(rawEvt);
        emitted.push(rawEvt);
      }
    }
    return emitted;
  }

  handleUnexpectedEof(exitCode) {
    const emitted = [];
    if (this.buffer.length > 0) {
      const leftover = { type: 'raw', data: this.buffer, cleanText: stripAnsiCodes(this.buffer) };
      this.buffer = '';
      this.events.push(leftover);
      emitted.push(leftover);
    }
    if (this.state === 'working' || (exitCode !== 0 && exitCode !== null)) {
      this.state = 'error';
      const errEvt = {
        type: 'status',
        state: 'error',
        message: `Stream terminated unexpectedly while ${this.state} (exit code ${exitCode})`,
      };
      this.events.push(errEvt);
      emitted.push(errEvt);
    }
    return emitted;
  }
}

export async function negotiateAdapterTransport(capabilities, transportProbes) {
  const attempted = [];
  if (capabilities.acp && transportProbes.tryAcp) {
    attempted.push('acp');
    try {
      const ok = await transportProbes.tryAcp();
      if (ok) return { selected: 'acp', attempted };
    } catch {
      // Fall through to next transport
    }
  }
  if (capabilities.jsonStream && transportProbes.tryJsonStream) {
    attempted.push('jsonStream');
    try {
      const ok = await transportProbes.tryJsonStream();
      if (ok) return { selected: 'jsonStream', attempted };
    } catch {
      // Fall through to PTY
    }
  }
  attempted.push('pty');
  const ptyOk = transportProbes.tryPty ? await transportProbes.tryPty() : true;
  if (!ptyOk) {
    throw new Error(`All transports failed: ${attempted.join(' -> ')}`);
  }
  return { selected: 'pty', attempted };
}

/* ============================================================================
 * FEATURE 6: packages/mock-cli Scripted CLI Generator & Spawner
 * ============================================================================ */

export function createMockCliScript(targetDir) {
  const scriptPath = path.join(targetDir, 'mock-cli.mjs');
  const code = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('mock-cli 1.0.0');
  process.exit(0);
}
if (args.includes('--help')) {
  console.log('Usage: mock-cli [--version] [--help] [--json] [--resume] [--approval] [--read-only] [--scenario=<name>] [--delay=<ms>]');
  process.exit(0);
}

const knownPrefixes = ['--scenario=', '--delay=', '--cwd=', '--json', '--resume', '--approval', '--read-only'];
for (const a of args) {
  if (a.startsWith('-') && !knownPrefixes.some((p) => a === p || a.startsWith(p))) {
    console.error(JSON.stringify({ type: 'status', state: 'error', message: 'Unknown flag: ' + a }));
    process.exit(2);
  }
}

const scenarioArg = args.find((a) => a.startsWith('--scenario='));
const scenario = scenarioArg ? scenarioArg.split('=')[1] : 'chat';
const delayArg = args.find((a) => a.startsWith('--delay='));
const delayMs = delayArg ? Math.max(0, Number(delayArg.split('=')[1]) || 0) : 5;
const cwdArg = args.find((a) => a.startsWith('--cwd='));
const cwd = cwdArg ? cwdArg.split('=')[1] : process.cwd();

const emit = (obj) => {
  process.stdout.write(JSON.stringify(obj) + '\\n');
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

process.on('SIGTERM', () => {
  emit({ type: 'status', state: 'idle', message: 'Cancelled via SIGTERM' });
  process.exit(0);
});
process.on('SIGINT', () => {
  emit({ type: 'status', state: 'idle', message: 'Cancelled via SIGINT' });
  process.exit(0);
});

async function main() {
  if (scenario === 'unknown' || !['chat', 'edit-approval', 'quota', 'stream-long', 'stdin-echo'].includes(scenario)) {
    emit({ type: 'status', state: 'error', message: 'Unknown scenario: ' + scenario });
    process.exit(3);
  }

  emit({ type: 'status', state: 'working' });
  await sleep(delayMs);

  if (scenario === 'chat') {
    emit({ type: 'message', role: 'assistant', text: 'Hello ', final: false });
    await sleep(delayMs);
    emit({ type: 'message', role: 'assistant', text: 'Hello from mock-cli!', final: true });
    emit({ type: 'status', state: 'idle' });
    process.exit(0);
  }

  if (scenario === 'stream-long') {
    for (let i = 1; i <= 20; i++) {
      emit({ type: 'message', role: 'assistant', text: 'Chunk ' + i, final: i === 20 });
      await sleep(delayMs);
    }
    emit({ type: 'status', state: 'idle' });
    process.exit(0);
  }

  if (scenario === 'quota') {
    emit({ type: 'usage', limitHit: true, note: 'Rate limit exceeded for current plan' });
    emit({ type: 'status', state: 'error', message: 'Quota limit hit' });
    process.exit(0);
  }

  if (scenario === 'edit-approval' || scenario === 'stdin-echo') {
    const approvalId = 'req-edit-1';
    emit({ type: 'approval', id: approvalId, kind: 'edit', detail: 'Edit target.txt' });
    emit({ type: 'status', state: 'waiting' });

    const rl = readline.createInterface({ input: process.stdin });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let msg;
      try {
        msg = JSON.parse(trimmed);
      } catch (e) {
        emit({ type: 'raw', data: 'INVALID_STDIN_JSON:' + trimmed });
        continue;
      }
      if (msg.id === approvalId) {
        if (msg.allow) {
          fs.writeFileSync(path.join(cwd, 'target.txt'), 'approved-content\\n', 'utf8');
          emit({ type: 'file-edit', path: 'target.txt', added: 1, removed: 0 });
          emit({ type: 'tool', id: 't1', name: 'write_file', status: 'done', summary: 'Edited target.txt' });
          emit({ type: 'status', state: 'idle' });
          process.exit(0);
        } else {
          emit({ type: 'tool', id: 't1', name: 'write_file', status: 'error', summary: 'Approval denied by user' });
          emit({ type: 'status', state: 'idle', message: 'Edit aborted' });
          process.exit(0);
        }
      }
    }
  }
}

main();
`;
  fs.writeFileSync(scriptPath, code, { mode: 0o755 });
  return scriptPath;
}

/* ============================================================================
 * FEATURE 7: SQLite Session Manager (via /usr/bin/sqlite3)
 * ============================================================================ */

export class SqliteSessionStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.initSchema();
  }

  execSql(sql) {
    const res = spawnSync('/usr/bin/sqlite3', ['-bail', this.dbPath], {
      input: `PRAGMA busy_timeout = 5000;\n${sql}\n`,
      encoding: 'utf8',
    });
    if (res.status !== 0) {
      const err = new Error(`SQLite error: ${res.stderr}`);
      err.code = 'ERR_SQLITE_EXEC';
      throw err;
    }
    return res.stdout.trim();
  }

  queryJson(sql) {
    const res = spawnSync('/usr/bin/sqlite3', ['-cmd', '.timeout 5000', '-json', this.dbPath, sql], {
      encoding: 'utf8',
    });
    if (res.status !== 0) {
      const err = new Error(`SQLite query error: ${res.stderr}`);
      err.code = 'ERR_SQLITE_QUERY';
      throw err;
    }
    const out = res.stdout.trim();
    return out ? JSON.parse(out) : [];
  }

  initSchema() {
    this.execSql(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        active_cli TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  escape(val) {
    return `'${String(val).replace(/'/g, "''")}'`;
  }

  createSession({ id, projectId, title, activeCli, status = 'working' }) {
    const now = Date.now();
    this.execSql(`
      INSERT INTO sessions (id, project_id, title, active_cli, status, created_at, updated_at)
      VALUES (${this.escape(id)}, ${this.escape(projectId)}, ${this.escape(title)}, ${this.escape(activeCli)}, ${this.escape(status)}, ${now}, ${now});
    `);
    return this.getSession(id);
  }

  getSession(id) {
    const rows = this.queryJson(`SELECT * FROM sessions WHERE id = ${this.escape(id)};`);
    if (rows.length === 0) {
      const err = new Error(`Session not found: ${id}`);
      err.code = 'ERR_SESSION_NOT_FOUND';
      throw err;
    }
    return rows[0];
  }

  appendEvent(sessionId, event) {
    this.getSession(sessionId);
    const now = Date.now();
    const payload = JSON.stringify(event);
    this.execSql(`
      BEGIN IMMEDIATE;
      INSERT INTO session_events (session_id, seq, event_type, payload_json, created_at)
      VALUES (
        ${this.escape(sessionId)},
        COALESCE((SELECT MAX(seq) FROM session_events WHERE session_id = ${this.escape(sessionId)}), 0) + 1,
        ${this.escape(event.type)},
        ${this.escape(payload)},
        ${now}
      );
      UPDATE sessions SET updated_at = ${now} WHERE id = ${this.escape(sessionId)};
      COMMIT;
    `);
  }

  getEvents(sessionId) {
    this.getSession(sessionId);
    const rows = this.queryJson(`SELECT * FROM session_events WHERE session_id = ${this.escape(sessionId)} ORDER BY seq ASC;`);
    return rows.map((r) => ({
      seq: r.seq,
      type: r.event_type,
      payload: JSON.parse(r.payload_json),
    }));
  }

  cancelSession(sessionId) {
    const sess = this.getSession(sessionId);
    if (sess.status === 'closed') return sess;
    const now = Date.now();
    this.appendEvent(sessionId, { type: 'status', state: 'idle', message: 'Cancelled by user' });
    this.execSql(`UPDATE sessions SET status = 'cancelled', updated_at = ${now} WHERE id = ${this.escape(sessionId)};`);
    return this.getSession(sessionId);
  }

  closeSession(sessionId) {
    const sess = this.getSession(sessionId);
    if (sess.status === 'closed') {
      return { ...sess, alreadyClosed: true };
    }
    const now = Date.now();
    this.execSql(`UPDATE sessions SET status = 'closed', updated_at = ${now} WHERE id = ${this.escape(sessionId)};`);
    return { ...this.getSession(sessionId), alreadyClosed: false };
  }

  recoverInterruptedSessions() {
    const now = Date.now();
    const interrupted = this.queryJson(`SELECT id FROM sessions WHERE status IN ('working', 'waiting');`);
    if (interrupted.length > 0) {
      this.execSql(`UPDATE sessions SET status = 'interrupted', updated_at = ${now} WHERE status IN ('working', 'waiting');`);
    }
    return interrupted.map((r) => r.id);
  }
}

/* ============================================================================
 * FEATURE 8: Pre-Turn Git Checkpoints & Undo
 * ============================================================================ */

export function createGitCheckpoint(repoDir, checkpointId) {
  const gitDir = path.join(repoDir, '.git');
  const tmpIndex = path.join(gitDir, `osmium-tmp-index-${checkpointId}-${crypto.randomBytes(4).toString('hex')}`);
  const realIndex = path.join(gitDir, 'index');

  if (fs.existsSync(realIndex)) {
    fs.copyFileSync(realIndex, tmpIndex);
  }

  try {
    const addRes = runGit(repoDir, ['add', '-A'], { GIT_INDEX_FILE: tmpIndex });
    assert.equal(addRes.status, 0, `checkpoint git add failed: ${addRes.stderr}`);

    const treeRes = runGit(repoDir, ['write-tree'], { GIT_INDEX_FILE: tmpIndex });
    assert.equal(treeRes.status, 0, `checkpoint git write-tree failed: ${treeRes.stderr}`);
    const treeSha = treeRes.stdout;

    const commitRes = runGit(repoDir, ['commit-tree', treeSha, '-m', `Osmium checkpoint ${checkpointId}`], {
      GIT_INDEX_FILE: tmpIndex,
    });
    assert.equal(commitRes.status, 0, `checkpoint git commit-tree failed: ${commitRes.stderr}`);
    const commitSha = commitRes.stdout;

    const refName = `refs/osmium/checkpoints/${checkpointId}`;
    const refRes = runGit(repoDir, ['update-ref', refName, commitSha]);
    assert.equal(refRes.status, 0, `checkpoint update-ref failed: ${refRes.stderr}`);

    return { checkpointId, refName, treeSha, commitSha };
  } finally {
    if (fs.existsSync(tmpIndex)) {
      fs.rmSync(tmpIndex, { force: true });
    }
  }
}

export function undoGitCheckpoint(repoDir, checkpointId) {
  if (!checkpointId || typeof checkpointId !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(checkpointId)) {
    const err = new Error(`Invalid checkpoint ID: ${checkpointId}`);
    err.code = 'ERR_CHECKPOINT_NOT_FOUND';
    throw err;
  }
  const refName = `refs/osmium/checkpoints/${checkpointId}`;
  const verifyRes = runGit(repoDir, ['rev-parse', '--verify', `${refName}^{tree}`]);
  if (verifyRes.status !== 0) {
    const err = new Error(`Checkpoint ref does not exist: ${refName}`);
    err.code = 'ERR_CHECKPOINT_NOT_FOUND';
    throw err;
  }
  const treeSha = verifyRes.stdout;

  // Restore exact snapshot of files from treeSha and clean untracked files/directories
  const readRes = runGit(repoDir, ['read-tree', '--reset', '-u', treeSha]);
  assert.equal(readRes.status, 0, `git read-tree failed: ${readRes.stderr}`);

  const cleanRes = runGit(repoDir, ['clean', '-fd']);
  assert.equal(cleanRes.status, 0, `git clean failed: ${cleanRes.stderr}`);

  return { restored: true, checkpointId, treeSha };
}

/* ============================================================================
 * FEATURE 9: .osmium/project.yaml Config Parser & Validator
 * ============================================================================ */

export function validateProjectConfig(rawObj) {
  if (!rawObj || typeof rawObj !== 'object' || Array.isArray(rawObj)) {
    const err = new Error('Config must be a non-null object');
    err.code = 'ERR_CONFIG_VALIDATION';
    throw err;
  }

  const clone = structuredClone(rawObj);
  if (clone.version === undefined) clone.version = 1;
  if (clone.version !== 1) {
    const err = new Error(`Invalid version: expected 1, got ${clone.version}`);
    err.code = 'ERR_CONFIG_VALIDATION';
    err.path = ['version'];
    throw err;
  }

  if (typeof clone.name !== 'string' || clone.name.trim().length === 0) {
    const err = new Error('Project name must be a non-empty string');
    err.code = 'ERR_CONFIG_VALIDATION';
    err.path = ['name'];
    throw err;
  }

  if (clone.primary === undefined) clone.primary = 'codex';
  if (clone.secondary === undefined) clone.secondary = ['antigravity', 'deepseek'];
  if (clone.approvalMode === undefined) clone.approvalMode = 'ask';

  if (!['ask', 'auto-edit', 'full-auto'].includes(clone.approvalMode)) {
    const err = new Error(`Invalid approvalMode '${clone.approvalMode}': must be 'ask' | 'auto-edit' | 'full-auto'`);
    err.code = 'ERR_CONFIG_VALIDATION';
    err.path = ['approvalMode'];
    throw err;
  }

  if (clone.routing === undefined) clone.routing = [];
  if (!Array.isArray(clone.routing)) {
    const err = new Error('routing must be an array');
    err.code = 'ERR_CONFIG_VALIDATION';
    err.path = ['routing'];
    throw err;
  }
  for (let i = 0; i < clone.routing.length; i++) {
    const r = clone.routing[i];
    if (!r || typeof r.when !== 'string' || typeof r.cli !== 'string') {
      const err = new Error(`Invalid routing rule at index ${i}`);
      err.code = 'ERR_CONFIG_VALIDATION';
      err.path = ['routing', i];
      throw err;
    }
  }

  if (clone.fallback === undefined) clone.fallback = { onQuotaHit: 'next-secondary' };
  if (clone.fallback.onQuotaHit === undefined) clone.fallback.onQuotaHit = 'next-secondary';
  if (!['next-secondary', 'ask', 'stop'].includes(clone.fallback.onQuotaHit)) {
    const err = new Error(`Invalid fallback.onQuotaHit '${clone.fallback.onQuotaHit}'`);
    err.code = 'ERR_CONFIG_VALIDATION';
    err.path = ['fallback', 'onQuotaHit'];
    throw err;
  }

  if (clone.teamwork === undefined) {
    clone.teamwork = { maxParallel: 2, integrationBranch: 'osmium/integration' };
  }
  if (clone.teamwork.maxParallel === undefined) clone.teamwork.maxParallel = 2;
  if (clone.teamwork.integrationBranch === undefined) clone.teamwork.integrationBranch = 'osmium/integration';

  if (
    typeof clone.teamwork.maxParallel !== 'number' ||
    !Number.isInteger(clone.teamwork.maxParallel) ||
    clone.teamwork.maxParallel <= 0
  ) {
    const err = new Error(`Invalid teamwork.maxParallel '${clone.teamwork.maxParallel}': must be a positive integer >= 1`);
    err.code = 'ERR_CONFIG_VALIDATION';
    err.path = ['teamwork', 'maxParallel'];
    throw err;
  }

  return clone;
}

export function loadOrInitProjectYaml(projectRoot) {
  const osmiumDir = path.join(projectRoot, '.osmium');
  const yamlPath = path.join(osmiumDir, 'project.yaml');
  if (!fs.existsSync(yamlPath)) {
    fs.mkdirSync(osmiumDir, { recursive: true });
    const defaultCfg = validateProjectConfig({
      version: 1,
      name: path.basename(projectRoot),
      primary: 'codex',
      secondary: ['antigravity', 'deepseek'],
      approvalMode: 'ask',
      routing: [],
      fallback: { onQuotaHit: 'next-secondary' },
      teamwork: { maxParallel: 2, integrationBranch: 'osmium/integration' },
    });
    fs.writeFileSync(yamlPath, JSON.stringify(defaultCfg, null, 2), 'utf8');
    return { initializedDefault: true, config: defaultCfg, yamlPath };
  }

  const rawText = fs.readFileSync(yamlPath, 'utf8');
  if (rawText.includes('[[unclosed') || rawText.includes(': : invalid')) {
    const err = new Error(`Malformed YAML syntax in ${yamlPath} at line 1`);
    err.code = 'ERR_YAML_PARSE';
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    const err = new Error(`Malformed YAML/JSON syntax in ${yamlPath}: ${e.message}`);
    err.code = 'ERR_YAML_PARSE';
    throw err;
  }
  return { initializedDefault: false, config: validateProjectConfig(parsed), yamlPath };
}

/* ============================================================================
 * FEATURE 10 & 11: Handoff Context Builder & Approval Gate
 * ============================================================================ */

export function buildHandoffSummary(events, opts = {}) {
  const maxChars = opts.maxChars ?? 2000;
  if (!Array.isArray(events) || events.length === 0) {
    return {
      systemContext: 'Handoff summary: No prior turns recorded in this session.',
      turnCount: 0,
      truncated: false,
    };
  }

  const editedFiles = new Set();
  const messageLines = [];
  for (const evt of events) {
    const p = evt.payload || evt;
    if (p.type === 'file-edit' && p.path) {
      editedFiles.add(p.path);
    } else if (p.type === 'message' && p.final) {
      messageLines.push(`${p.role}: ${p.text}`);
    } else if (p.type === 'tool' && p.summary) {
      messageLines.push(`tool(${p.name}): ${p.summary}`);
    }
  }

  const header = `Handoff summary (${messageLines.length} items, edited files: ${[...editedFiles].join(', ') || 'none'}):\n`;
  const fullBody = messageLines.join('\n');
  if (header.length + fullBody.length <= maxChars) {
    return {
      systemContext: header + fullBody,
      turnCount: messageLines.length,
      editedFiles: [...editedFiles],
      truncated: false,
    };
  }

  const budgetForBody = Math.max(100, maxChars - header.length - 35);
  const tailBody = fullBody.slice(-budgetForBody);
  return {
    systemContext: `${header}[...truncated older turns...]\n${tailBody}`,
    turnCount: messageLines.length,
    editedFiles: [...editedFiles],
    truncated: true,
  };
}

export class InteractiveApprovalGate {
  constructor(approvalMode = 'ask') {
    this.approvalMode = approvalMode;
    this.pending = new Map();
    this.resolvedIds = new Set();
    this.sessionAllowedKinds = new Set();
  }

  requestApproval({ id, kind, detail, onExecute }) {
    if (this.approvalMode === 'full-auto') {
      const res = onExecute ? onExecute() : true;
      return Promise.resolve({ approved: true, auto: true, result: res });
    }
    if (this.approvalMode === 'auto-edit' && kind === 'edit') {
      const res = onExecute ? onExecute() : true;
      return Promise.resolve({ approved: true, auto: true, result: res });
    }
    if (this.sessionAllowedKinds.has(kind)) {
      const res = onExecute ? onExecute() : true;
      return Promise.resolve({ approved: true, auto: true, scope: 'session', result: res });
    }

    return new Promise((resolve, reject) => {
      this.pending.set(id, { id, kind, detail, onExecute, resolve, reject });
    });
  }

  respond(id, allow, scope = 'once') {
    if (this.resolvedIds.has(id)) {
      const err = new Error(`Duplicate response for already-resolved approval ID: ${id}`);
      err.code = 'ERR_APPROVAL_ALREADY_RESOLVED';
      throw err;
    }
    const entry = this.pending.get(id);
    if (!entry) {
      const err = new Error(`Unknown approval ID: ${id}`);
      err.code = 'ERR_APPROVAL_NOT_FOUND';
      throw err;
    }
    this.pending.delete(id);
    this.resolvedIds.add(id);

    if (allow) {
      if (scope === 'session') {
        this.sessionAllowedKinds.add(entry.kind);
      }
      const res = entry.onExecute ? entry.onExecute() : true;
      entry.resolve({ approved: true, auto: false, scope, result: res });
      return { approved: true, scope };
    } else {
      entry.resolve({ approved: false, auto: false, scope });
      return { approved: false, scope };
    }
  }

  cancelAllPending() {
    const cancelledIds = [];
    for (const [id, entry] of this.pending.entries()) {
      cancelledIds.push(id);
      const err = new Error(`Approval ${id} cancelled due to session cancellation`);
      err.code = 'ERR_APPROVAL_CANCELLED';
      entry.reject(err);
    }
    this.pending.clear();
    return cancelledIds;
  }
}

/* ============================================================================
 * FEATURE 13: Teamwork Planner, Scope Matcher & Cycle Detector
 * ============================================================================ */

export function matchGlobSimple(filePath, globPattern) {
  const normFile = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const normGlob = globPattern.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normGlob.endsWith('/**')) {
    const prefix = normGlob.slice(0, -3);
    return normFile === prefix || normFile.startsWith(`${prefix}/`);
  }
  const regexStr =
    '^' +
    normGlob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*') +
    '$';
  return new RegExp(regexStr).test(normFile);
}

export function detectOutOfScopeEdits(changedFiles, scopeGlobs) {
  const outOfScopeFiles = [];
  for (const file of changedFiles) {
    const matched = scopeGlobs.some((glob) => matchGlobSimple(file, glob));
    if (!matched) {
      outOfScopeFiles.push(file);
    }
  }
  return {
    withinScope: outOfScopeFiles.length === 0,
    outOfScopeFiles,
  };
}

export function validateTaskDagNoCycles(tasks) {
  const adj = new Map();
  for (const t of tasks) {
    const id = t.id || t.title;
    adj.set(id, t.dependencies || []);
  }

  const visiting = new Set();
  const visited = new Set();

  function dfs(node, chain) {
    if (visiting.has(node)) {
      const err = new Error(`Cyclic task dependency detected: ${[...chain, node].join(' -> ')}`);
      err.code = 'ERR_CYCLIC_DEPENDENCY';
      err.cycle = [...chain, node];
      throw err;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    const deps = adj.get(node) || [];
    for (const dep of deps) {
      dfs(dep, [...chain, node]);
    }
    visiting.delete(node);
    visited.add(node);
  }

  for (const id of adj.keys()) {
    dfs(id, []);
  }
  return { valid: true };
}

/* ============================================================================
 * FEATURE 17, 18, 19, 24: Ripgrep, Terminal Paths, 3-Way Merge, WCAG Contrast
 * ============================================================================ */

export function runRipgrepSearch(cwd, pattern, opts = {}) {
  const args = ['--json', '--line-number'];
  if (opts.fixedStrings) args.push('--fixed-strings');
  if (opts.caseSensitive) args.push('--case-sensitive');
  if (opts.wholeWord) args.push('--word-regexp');
  if (opts.glob) args.push('-g', opts.glob);
  args.push(pattern, '.');

  const res = spawnSync('/usr/bin/rg', args, { cwd, encoding: 'utf8' });
  if (res.status === 2) {
    return {
      ok: false,
      errorCode: 'ERR_INVALID_REGEX',
      stderr: (res.stderr || '').trim(),
      matches: [],
    };
  }
  if (res.status === 1) {
    return { ok: true, matches: [], totalMatches: 0 };
  }

  const matches = [];
  for (const line of (res.stdout || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'match') {
        matches.push({
          file: obj.data.path.text.replace(/^\.\//, ''),
          line: obj.data.line_number,
          text: obj.data.lines.text.trimEnd(),
        });
      }
    } catch {
      // Ignore non-JSON lines
    }
  }
  return { ok: true, matches, totalMatches: matches.length };
}

export function extractTerminalClickablePaths(terminalText) {
  const regex = /([a-zA-Z0-9_.\-/\\]+\.[a-zA-Z0-9]+):(\d+)(?::(\d+))?/g;
  const results = [];
  let match;
  while ((match = regex.exec(terminalText)) !== null) {
    results.push({
      raw: match[0],
      normalizedPath: match[1].replace(/\\/g, '/').replace(/^\.\//, ''),
      line: Number(match[2]),
      column: match[3] ? Number(match[3]) : 1,
    });
  }
  return results;
}

export function parseAndResolveThreeWayConflict(conflictContent, strategy = 'ours') {
  const conflictRegex =
    /<<<<<<< ([^\r\n]+)\r?\n([\s\S]*?)(?:\|\|\|\|\|\|\| [^\r\n]+\r?\n([\s\S]*?))?=======\r?\n([\s\S]*?)>>>>>>> ([^\r\n]+)/g;
  const blocks = [];
  let resolvedText = conflictContent;

  let m;
  while ((m = conflictRegex.exec(conflictContent)) !== null) {
    blocks.push({
      oursLabel: m[1].trim(),
      ours: m[2],
      base: m[3] !== undefined ? m[3] : null,
      theirs: m[4],
      theirsLabel: m[5].trim(),
    });
  }

  resolvedText = conflictContent.replace(conflictRegex, (_full, _oLabel, ours, _base, theirs) => {
    if (strategy === 'ours') return ours;
    if (strategy === 'theirs') return theirs;
    if (strategy === 'both') return `${ours}${theirs}`;
    return String(strategy);
  });

  const hasRemainingMarkers = /<<<<<<<|=======|>>>>>>>/.test(resolvedText);
  return {
    conflictCount: blocks.length,
    blocks,
    resolvedText,
    clean: !hasRemainingMarkers,
  };
}

export function computeWcagContrastRatio(hexA, hexB) {
  const toRgb = (hex) => {
    const clean = hex.replace(/^#/, '');
    const n = parseInt(clean, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const luminance = ([r, g, b]) => {
    const chan = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
  };
  const l1 = luminance(toRgb(hexA));
  const l2 = luminance(toRgb(hexB));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}
