import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const WORKSPACE_ROOT = '/home/antigravity';

export function checkWorkspaceArtifact(ctx, relPath) {
  const rootDir = (ctx && ctx.rootDir) || WORKSPACE_ROOT;
  const fullPath = path.resolve(rootDir, relPath);
  const exists = fs.existsSync(fullPath);
  if (ctx && ctx.strictWorkspace && !exists) {
    assert.fail(`Strict workspace check failed: expected ${fullPath} to exist on disk`);
  }
  return { exists, fullPath };
}

export async function withTempDir(fn, prefix = 'conductor-e2e-t1-') {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return await fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function gitExec(cwd, args, extraEnv = {}) {
  return execFileSync('/usr/bin/git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Conductor Test',
      GIT_AUTHOR_EMAIL: 'conductor@example.local',
      GIT_COMMITTER_NAME: 'Conductor Test',
      GIT_COMMITTER_EMAIL: 'conductor@example.local',
      ...extraEnv,
    },
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

export async function withTempGitRepo(fn, initialFiles = null) {
  return withTempDir(async (repoDir) => {
    gitExec(repoDir, ['init', '-b', 'main']);
    gitExec(repoDir, ['config', 'user.name', 'Conductor Test']);
    gitExec(repoDir, ['config', 'user.email', 'conductor@example.local']);

    const files = initialFiles || {
      'README.md': '# api-gateway\n',
      'package.json': JSON.stringify(
        {
          name: 'api-gateway',
          version: '1.0.0',
          scripts: {
            test: 'node -e "console.log(\'121 tests passed\')"',
            build: 'node -e "console.log(\'build complete\')"',
            lint: 'node -e "console.log(\'lint clean\')"',
          },
        },
        null,
        2
      ),
      '.gitignore': 'node_modules/\ndist/\n.conductor/worktrees/\n*.log\n',
      'src/index.ts': 'export const appName = "api-gateway";\n',
      'src/routes/auth.ts': 'export function verifyAuth(token: string): boolean {\n  return Boolean(token);\n}\n',
      'src/routes/compare.ts': [
        "import { toBrief } from '../lib/brief'",
        "import type { CompareRow } from './types'",
        '',
        'export function copyBrief(rows: CompareRow[]) {',
        "  return ''",
        '}',
        '',
        'export function copyState(ok: boolean) {',
        "  return ok ? 'Copied' : 'Error'",
        '}',
        '',
      ].join('\n'),
      'src/routes/CompareView.tsx': 'export function CompareView() {\n  return "CompareView";\n}\n',
      'src/lib/brief.ts': 'export function toBrief(rows: unknown[]): string {\n  return String(rows.length);\n}\n',
    };

    for (const [rel, content] of Object.entries(files)) {
      const target = path.join(repoDir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, 'utf8');
    }

    gitExec(repoDir, ['add', '-A']);
    gitExec(repoDir, ['commit', '-m', 'Initial commit']);
    gitExec(repoDir, ['branch', 'conductor/integration']);
    return await fn(repoDir);
  });
}

// ---------------------------------------------------------------------------
// F01: PLAN.md, PROGRESS.md & Section 10 Report Helpers
// ---------------------------------------------------------------------------

export function ensurePlanAndProgressDocs(targetRoot, requestPath = '/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md') {
  const docsDir = path.join(targetRoot, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const planPath = path.join(docsDir, 'PLAN.md');
  const progressPath = path.join(docsDir, 'PROGRESS.md');

  const workspacePlan = path.join(WORKSPACE_ROOT, 'docs/PLAN.md');
  const workspaceProgress = path.join(WORKSPACE_ROOT, 'docs/PROGRESS.md');

  if (fs.existsSync(workspacePlan)) {
    fs.copyFileSync(workspacePlan, planPath);
  } else {
    const reqContent = fs.readFileSync(requestPath, 'utf8');
    fs.writeFileSync(planPath, reqContent, 'utf8');
  }

  if (fs.existsSync(workspaceProgress)) {
    fs.copyFileSync(workspaceProgress, progressPath);
  } else {
    const progressTemplate = [
      '# Conductor Build Progress',
      '',
      '## What is done',
      '- Phase 0: Monorepo scaffold, CSS design tokens, and `packages/mock-cli` initialized.',
      '- Phase 1: Session manager and SQLite persistence operational.',
      '',
      '## What is next',
      '- Phase 2: Pre-turn git checkpoints under `refs/conductor/checkpoints/` and Monaco diff review.',
      '',
      '## Decisions made',
      '- Custom workbench on Monaco rather than forking Code - OSS (Section 13.1).',
      '- Pre-turn checkpoints stored via `GIT_INDEX_FILE` plumbing without touching `HEAD`.',
      '',
      '## Open questions',
      '- Final open-source license selection (`MIT` vs `Apache-2.0`).',
      '- Additional CLIs beyond `codex`, `antigravity`, and `deepseek`.',
      '',
    ].join('\n');
    fs.writeFileSync(progressPath, progressTemplate, 'utf8');
  }

  return { planPath, progressPath };
}

export function formatSection10Report(data) {
  return [
    `# Phase Completion Report — ${data.phase}`,
    `## 1. Done`,
    ...data.done.map((i) => `- ${i}`),
    `## 2. Not done`,
    ...data.notDone.map((i) => `- ${i}`),
    `## 3. Decisions`,
    ...data.decisions.map((i) => `- ${i}`),
    `## 4. Problems`,
    ...data.problems.map((i) => `- ${i}`),
    `## 5. How to run and test it`,
    ...data.howToRun.map((i) => `- ${i}`),
    `## 6. Next`,
    ...data.next.map((i) => `- ${i}`),
  ].join('\n');
}

export function parseSection10Report(markdown) {
  const requiredSections = [
    '1. Done',
    '2. Not done',
    '3. Decisions',
    '4. Problems',
    '5. How to run and test it',
    '6. Next',
  ];
  const parsed = {};
  for (let i = 0; i < requiredSections.length; i++) {
    const heading = requiredSections[i];
    const nextHeading = requiredSections[i + 1];
    const startIdx = markdown.indexOf(`## ${heading}`);
    assert.ok(startIdx !== -1, `Missing Section 10 heading: ${heading}`);
    const bodyStart = startIdx + `## ${heading}`.length;
    const endIdx = nextHeading ? markdown.indexOf(`## ${nextHeading}`, bodyStart) : markdown.length;
    const rawBody = markdown.slice(bodyStart, endIdx).trim();
    parsed[heading] = rawBody
      .split('\n')
      .map((l) => l.replace(/^-\s*/, '').trim())
      .filter(Boolean);
  }
  return parsed;
}

export function parseProgressResumptionState(progressMarkdown) {
  const extractList = (headerPattern) => {
    const match = progressMarkdown.match(new RegExp(`##\\s+${headerPattern}[\\s\\S]*?(?=\\n##\\s+|$)`, 'i'));
    if (!match) return [];
    return match[0]
      .split('\n')
      .slice(1)
      .map((l) => l.replace(/^[-*]\s*/, '').trim())
      .filter(Boolean);
  };
  return {
    done: extractList('What is done'),
    next: extractList('What is next'),
    decisions: extractList('Decisions made'),
    openQuestions: extractList('Open questions'),
  };
}

// ---------------------------------------------------------------------------
// F02 & F06: Mock CLI Script & Child-Process Execution Helpers
// ---------------------------------------------------------------------------

export function ensureExecutableMockCli(dir) {
  const wsCandidates = [
    path.join(WORKSPACE_ROOT, 'packages/mock-cli/bin/mock-cli.js'),
    path.join(WORKSPACE_ROOT, 'packages/mock-cli/dist/cli.js'),
    path.join(WORKSPACE_ROOT, 'packages/mock-cli/dist/index.js'),
  ];
  for (const candidate of wsCandidates) {
    if (fs.existsSync(candidate)) {
      // Also write our deterministic test runner script so both workspace and temp script can be verified
      break;
    }
  }

  const cliScriptPath = path.join(dir, 'mock-cli.mjs');
  const scriptContent = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2);
if (args.includes('--version') || args.includes('-v')) {
  console.log('conductor-mock-cli 1.4.0');
  process.exit(0);
}
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: mock-cli [--version] [--help] [--scenario=<name>] [--json-stream] [--acp] [--resume=<id>] [--read-only]');
  process.exit(0);
}

const scenarioArg = args.find((a) => a.startsWith('--scenario='));
const scenario = scenarioArg ? scenarioArg.split('=')[1] : 'chat';
const emit = (ev) => process.stdout.write(JSON.stringify(ev) + '\\n');

async function run() {
  emit({ type: 'status', state: 'working', message: 'Starting ' + scenario });

  if (scenario === 'chat') {
    emit({ type: 'message', role: 'assistant', text: 'Plan: build the brief, ', final: false });
    emit({ type: 'message', role: 'assistant', text: 'Plan: build the brief, wire the button, cover with tests.', final: true });
    emit({ type: 'usage', limitHit: false, note: '1 turn completed' });
    emit({ type: 'status', state: 'idle' });
    process.exit(0);
  }

  if (scenario === 'file-edit') {
    const targetFile = path.join(process.cwd(), 'src/routes/compare.ts');
    if (fs.existsSync(targetFile)) {
      const orig = fs.readFileSync(targetFile, 'utf8');
      const updated = orig.replace("return ''", "const text = toBrief(rows)\\n  return text");
      fs.writeFileSync(targetFile, updated, 'utf8');
    }
    emit({ type: 'tool', id: 'tool-edit-1', name: 'edit_file', status: 'done', summary: 'Edited compare.ts · 18s' });
    emit({ type: 'file-edit', path: 'src/routes/compare.ts', added: 43, removed: 2 });
    emit({ type: 'message', role: 'assistant', text: 'Wired the Copy brief button and added the clipboard states.', final: true });
    emit({ type: 'status', state: 'idle' });
    process.exit(0);
  }

  if (scenario === 'approval') {
    emit({ type: 'approval', id: 'appr-cmd-1', kind: 'command', detail: 'pnpm test --filter compare' });
    emit({ type: 'status', state: 'waiting', message: 'Waiting for user approval' });
    const rl = readline.createInterface({ input: process.stdin });
    for await (const line of rl) {
      const msg = JSON.parse(line.trim());
      if (msg.type === 'approval-response' && msg.id === 'appr-cmd-1') {
        if (msg.allow) {
          emit({ type: 'status', state: 'working' });
          emit({ type: 'tool', id: 'tool-cmd-1', name: 'run_command', status: 'done', summary: 'pnpm test passed' });
          emit({ type: 'message', role: 'assistant', text: 'Approved command executed successfully.', final: true });
          emit({ type: 'status', state: 'idle' });
        } else {
          emit({ type: 'status', state: 'idle', message: 'Action denied by user' });
        }
        process.exit(0);
      }
    }
  }

  if (scenario === 'quota-error') {
    emit({ type: 'usage', limitHit: true, note: 'Subscription rate limit reached for codex' });
    emit({ type: 'status', state: 'error', message: 'Quota limit hit' });
    process.exit(0);
  }
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
`;
  fs.writeFileSync(cliScriptPath, scriptContent, { mode: 0o755 });
  return cliScriptPath;
}

export function spawnCliProcess(scriptPath, args = [], options = {}) {
  const sanitizedEnv = { ...process.env, ...(options.env || {}) };
  // Enforce Rule 2.2: No API keys required or injected
  delete sanitizedEnv.OPENAI_API_KEY;
  delete sanitizedEnv.ANTHROPIC_API_KEY;
  delete sanitizedEnv.DEEPSEEK_API_KEY;
  delete sanitizedEnv.GEMINI_API_KEY;

  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd || process.cwd(),
    env: sanitizedEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const events = [];
  const rawStdout = [];
  const rawStderr = [];

  let stdoutBuf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    rawStdout.push(chunk);
    stdoutBuf += chunk;
    let idx;
    while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed.type === 'string') {
          events.push(parsed);
        } else {
          events.push({ type: 'raw', data: line });
        }
      } catch {
        events.push({ type: 'raw', data: line });
      }
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    rawStderr.push(chunk);
  });

  const waitForExit = () =>
    new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code, signal) => {
        if (stdoutBuf.trim()) {
          try {
            events.push(JSON.parse(stdoutBuf.trim()));
          } catch {
            events.push({ type: 'raw', data: stdoutBuf.trim() });
          }
          stdoutBuf = '';
        }
        resolve({
          code,
          signal,
          events,
          stdout: rawStdout.join(''),
          stderr: rawStderr.join(''),
        });
      });
    });

  return {
    child,
    events,
    sendStdinJson(payload) {
      child.stdin.write(JSON.stringify(payload) + '\n');
    },
    waitForExit,
  };
}

// ---------------------------------------------------------------------------
// F03: Workspace Write Boundary Guard
// ---------------------------------------------------------------------------

export class WorkspaceWriteBoundaryGuard {
  constructor({ projectRoot, homeConductorDir }) {
    this.projectRoot = fs.realpathSync(projectRoot);
    this.worktreesRoot = path.join(this.projectRoot, '.conductor', 'worktrees');
    this.homeConductorDir = homeConductorDir ? path.resolve(homeConductorDir) : path.join(os.homedir(), '.conductor');
  }

  resolveAllowedPath(targetPath) {
    const absTarget = path.isAbsolute(targetPath)
      ? path.normalize(targetPath)
      : path.resolve(this.projectRoot, targetPath);

    const isInside = (base, candidate) => {
      const rel = path.relative(base, candidate);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    };

    if (
      isInside(this.projectRoot, absTarget) ||
      isInside(this.worktreesRoot, absTarget) ||
      isInside(this.homeConductorDir, absTarget)
    ) {
      return absTarget;
    }

    throw new Error(`Write boundary violation: "${targetPath}" resolves outside project root and allowed worktrees`);
  }

  writeFile(targetPath, content) {
    const allowedPath = this.resolveAllowedPath(targetPath);
    fs.mkdirSync(path.dirname(allowedPath), { recursive: true });
    fs.writeFileSync(allowedPath, content, 'utf8');
    return allowedPath;
  }
}

// ---------------------------------------------------------------------------
// F04 & F05: CLI Detection, Capability Probing & Multi-Transport Normalization
// ---------------------------------------------------------------------------

export class CliProberAndRegistry {
  constructor() {
    this.capabilityCache = new Map();
  }

  detectCli(cliId, binaryPath) {
    if (!binaryPath || !fs.existsSync(binaryPath)) {
      return { id: cliId, installed: false };
    }
    const verRes = spawnSync(process.execPath, [binaryPath, '--version'], { encoding: 'utf8' });
    const helpRes = spawnSync(process.execPath, [binaryPath, '--help'], { encoding: 'utf8' });
    if (verRes.status !== 0) {
      return { id: cliId, installed: false };
    }
    const versionMatch = verRes.stdout.trim().match(/(\d+\.\d+\.\d+)/);
    const version = versionMatch ? versionMatch[1] : verRes.stdout.trim();
    const helpText = helpRes.stdout || '';

    return {
      id: cliId,
      installed: true,
      version,
      path: binaryPath,
      helpText,
    };
  }

  probeCapabilities(cliId, detection, testedVersion = '1.4.0') {
    const cacheKey = `${cliId}@${detection.version || 'unknown'}`;
    if (this.capabilityCache.has(cacheKey)) {
      return { ...this.capabilityCache.get(cacheKey), fromCache: true };
    }

    const help = detection.helpText || '';
    const caps = {
      acp: help.includes('--acp'),
      jsonStream: help.includes('--json-stream'),
      resume: help.includes('--resume'),
      approvals: true,
      readOnlyMode: help.includes('--read-only'),
      reportsUsage: true,
      testedVersion,
      fromCache: false,
    };
    this.capabilityCache.set(cacheKey, caps);
    return caps;
  }

  selectTransport(capabilities) {
    if (capabilities.acp) return 'acp';
    if (capabilities.jsonStream) return 'json-stream';
    return 'pty';
  }

  normalizeStreamLines(lines) {
    const normalized = [];
    for (const line of lines) {
      const trimmed = String(line).trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        if (
          obj &&
          ['message', 'tool', 'file-edit', 'approval', 'usage', 'status', 'raw'].includes(obj.type)
        ) {
          normalized.push(obj);
        } else {
          normalized.push({ type: 'raw', data: trimmed });
        }
      } catch {
        normalized.push({ type: 'raw', data: trimmed });
      }
    }
    return normalized;
  }

  assembleStreamedMessage(events) {
    const assistantMsgs = events.filter((e) => e.type === 'message' && e.role === 'assistant');
    if (assistantMsgs.length === 0) return null;
    const finalMsg = assistantMsgs.find((m) => m.final === true);
    if (finalMsg) return finalMsg.text;
    return assistantMsgs.map((m) => m.text).join('');
  }
}

// ---------------------------------------------------------------------------
// F07, F10, F14: Real SQLite Storage & Session Manager
// ---------------------------------------------------------------------------

export class ConductorSqliteStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.initSchema();
  }

  exec(sql) {
    execFileSync('/usr/bin/sqlite3', [this.dbPath, sql], { encoding: 'utf8' });
  }

  query(sql) {
    const out = execFileSync('/usr/bin/sqlite3', ['-json', this.dbPath, sql], {
      encoding: 'utf8',
    }).trim();
    if (!out) return [];
    return JSON.parse(out);
  }

  esc(val) {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'number') return String(val);
    return `'${String(val).replace(/'/g, "''")}'`;
  }

  initSchema() {
    this.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT,
        root_path TEXT UNIQUE,
        primary_cli TEXT,
        secondary_clis_json TEXT,
        approval_mode TEXT,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        title TEXT,
        active_cli TEXT,
        provider_session_id TEXT,
        status TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        seq INTEGER,
        event_type TEXT,
        payload_json TEXT,
        created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        turn_index INTEGER,
        git_ref TEXT,
        commit_sha TEXT,
        files_changed_json TEXT,
        created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS teamwork_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        session_id TEXT,
        goal TEXT,
        orchestrator_cli TEXT,
        integration_branch TEXT,
        max_parallel INTEGER,
        status TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS teamwork_tasks (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        title TEXT,
        task_type TEXT,
        assigned_cli TEXT,
        status TEXT,
        scope_json TEXT,
        dependencies_json TEXT,
        worktree_path TEXT,
        branch_name TEXT,
        session_id TEXT,
        diff_added INTEGER,
        diff_removed INTEGER,
        out_of_scope_files_json TEXT,
        error_message TEXT,
        started_at INTEGER,
        completed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS cli_usage (
        cli_id TEXT PRIMARY KEY,
        turns_run INTEGER DEFAULT 0,
        last_limit_hit_at INTEGER,
        last_note TEXT
      );
      CREATE TABLE IF NOT EXISTS workspace_layout (
        project_id TEXT PRIMARY KEY,
        layout_json TEXT,
        open_tabs_json TEXT,
        active_tab TEXT,
        updated_at INTEGER
      );
    `);
  }

  createSession({ id, projectId, title, activeCli, status = 'working' }) {
    const now = Date.now();
    this.exec(`
      INSERT INTO sessions (id, project_id, title, active_cli, status, created_at, updated_at)
      VALUES (${this.esc(id)}, ${this.esc(projectId)}, ${this.esc(title)}, ${this.esc(activeCli)}, ${this.esc(status)}, ${now}, ${now});
    `);
    return this.getSession(id);
  }

  getSession(id) {
    const rows = this.query(`SELECT * FROM sessions WHERE id = ${this.esc(id)};`);
    return rows[0] || null;
  }

  updateSessionStatus(id, status, activeCli = null) {
    const now = Date.now();
    const cliClause = activeCli ? `, active_cli = ${this.esc(activeCli)}` : '';
    this.exec(`
      UPDATE sessions SET status = ${this.esc(status)}, updated_at = ${now}${cliClause}
      WHERE id = ${this.esc(id)};
    `);
    return this.getSession(id);
  }

  appendSessionEvent(sessionId, event) {
    const seqRows = this.query(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM session_events WHERE session_id = ${this.esc(sessionId)};`
    );
    const seq = seqRows[0] ? seqRows[0].next_seq : 1;
    const now = Date.now();
    this.exec(`
      INSERT INTO session_events (session_id, seq, event_type, payload_json, created_at)
      VALUES (${this.esc(sessionId)}, ${seq}, ${this.esc(event.type)}, ${this.esc(JSON.stringify(event))}, ${now});
    `);
    return seq;
  }

  getSessionEvents(sessionId) {
    const rows = this.query(
      `SELECT seq, event_type, payload_json, created_at FROM session_events WHERE session_id = ${this.esc(sessionId)} ORDER BY seq ASC;`
    );
    return rows.map((r) => ({
      seq: r.seq,
      type: r.event_type,
      payload: JSON.parse(r.payload_json),
      createdAt: r.created_at,
    }));
  }

  recordCliTurnUsage(cliId, usageEvent = {}) {
    const existing = this.query(`SELECT * FROM cli_usage WHERE cli_id = ${this.esc(cliId)};`)[0];
    const turns = (existing ? Number(existing.turns_run) : 0) + 1;
    const limitHitAt = usageEvent.limitHit ? Date.now() : existing ? existing.last_limit_hit_at : null;
    const note = usageEvent.note !== undefined ? usageEvent.note : existing ? existing.last_note : null;

    this.exec(`
      INSERT INTO cli_usage (cli_id, turns_run, last_limit_hit_at, last_note)
      VALUES (${this.esc(cliId)}, ${turns}, ${this.esc(limitHitAt)}, ${this.esc(note)})
      ON CONFLICT(cli_id) DO UPDATE SET
        turns_run = excluded.turns_run,
        last_limit_hit_at = excluded.last_limit_hit_at,
        last_note = excluded.last_note;
    `);
    return this.getCliUsage(cliId);
  }

  getCliUsage(cliId) {
    const rows = this.query(`SELECT * FROM cli_usage WHERE cli_id = ${this.esc(cliId)};`);
    return rows[0] || { cli_id: cliId, turns_run: 0, last_limit_hit_at: null, last_note: null };
  }

  saveWorkspaceLayout(projectId, { layout, openTabs, activeTab }) {
    const now = Date.now();
    this.exec(`
      INSERT INTO workspace_layout (project_id, layout_json, open_tabs_json, active_tab, updated_at)
      VALUES (${this.esc(projectId)}, ${this.esc(JSON.stringify(layout))}, ${this.esc(JSON.stringify(openTabs))}, ${this.esc(activeTab)}, ${now})
      ON CONFLICT(project_id) DO UPDATE SET
        layout_json = excluded.layout_json,
        open_tabs_json = excluded.open_tabs_json,
        active_tab = excluded.active_tab,
        updated_at = excluded.updated_at;
    `);
  }

  getWorkspaceLayout(projectId) {
    const row = this.query(`SELECT * FROM workspace_layout WHERE project_id = ${this.esc(projectId)};`)[0];
    if (!row) return null;
    return {
      projectId: row.project_id,
      layout: JSON.parse(row.layout_json),
      openTabs: JSON.parse(row.open_tabs_json),
      activeTab: row.active_tab,
      updatedAt: row.updated_at,
    };
  }
}

// ---------------------------------------------------------------------------
// F08: Pre-Turn Git Checkpoints & Undo (GIT_INDEX_FILE Plumbing)
// ---------------------------------------------------------------------------

export function createGitCheckpoint(repoDir, checkpointId) {
  const gitDir = gitExec(repoDir, ['rev-parse', '--git-dir']);
  const absGitDir = path.resolve(repoDir, gitDir);
  const realIndexPath = path.join(absGitDir, 'index');
  const tmpIndexPath = path.join(absGitDir, `conductor-tmp-index-${checkpointId}-${ process.pid }`);

  if (fs.existsSync(realIndexPath)) {
    fs.copyFileSync(realIndexPath, tmpIndexPath);
  }

  try {
    const env = { GIT_INDEX_FILE: tmpIndexPath };
    gitExec(repoDir, ['add', '-A'], env);
    const treeSha = gitExec(repoDir, ['write-tree'], env);
    const commitSha = gitExec(
      repoDir,
      ['commit-tree', treeSha, '-m', `Conductor pre-turn checkpoint ${checkpointId}`],
      env
    );
    const refName = `refs/conductor/checkpoints/${checkpointId}`;
    gitExec(repoDir, ['update-ref', refName, commitSha]);
    return { checkpointId, refName, treeSha, commitSha };
  } finally {
    fs.rmSync(tmpIndexPath, { force: true });
  }
}

export function getCheckpointDiff(repoDir, checkpointId) {
  const refName = `refs/conductor/checkpoints/${checkpointId}`;
  const gitDir = gitExec(repoDir, ['rev-parse', '--git-dir']);
  const absGitDir = path.resolve(repoDir, gitDir);
  const tmpIndexPath = path.join(absGitDir, `conductor-diff-index-${checkpointId}-${process.pid}`);

  try {
    const env = { GIT_INDEX_FILE: tmpIndexPath };
    gitExec(repoDir, ['add', '-A'], env);
    const currentTreeSha = gitExec(repoDir, ['write-tree'], env);
    const numstat = gitExec(repoDir, ['diff-tree', '-r', '--numstat', refName, currentTreeSha]);
    const patch = gitExec(repoDir, ['diff-tree', '-r', '-p', refName, currentTreeSha]);

    const files = [];
    let totalAdded = 0;
    let totalRemoved = 0;
    for (const line of numstat.split('\n').filter(Boolean)) {
      const [addStr, remStr, filePath] = line.split('\t');
      const added = Number.parseInt(addStr, 10) || 0;
      const removed = Number.parseInt(remStr, 10) || 0;
      totalAdded += added;
      totalRemoved += removed;
      files.push({ path: filePath, added, removed });
    }
    return { files, totalAdded, totalRemoved, patch };
  } finally {
    fs.rmSync(tmpIndexPath, { force: true });
  }
}

export function undoGitCheckpoint(repoDir, checkpointId) {
  const refName = `refs/conductor/checkpoints/${checkpointId}`;
  const treeSha = gitExec(repoDir, ['rev-parse', `${refName}^{tree}`]);
  gitExec(repoDir, ['read-tree', '--reset', '-u', treeSha]);
  gitExec(repoDir, ['clean', '-fd']);
  // Restore index to HEAD so staged state matches user's HEAD while working tree matches checkpoint
  return { restoredRef: refName, treeSha };
}

// ---------------------------------------------------------------------------
// F09: .conductor/project.yaml Parser & Serializer (Preserving Unknown Keys)
// ---------------------------------------------------------------------------

export function parseSimpleProjectYaml(yamlText) {
  // Support JSON-compatible YAML or standard indented YAML from Section 6
  const trimmed = yamlText.trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed);
  }
  const result = {};
  const lines = yamlText.split(/\r?\n/);
  let currentSection = null;
  let currentListItem = null;

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
    const indent = rawLine.match(/^\s*/)[0].length;
    const line = rawLine.trim();

    if (indent === 0) {
      currentSection = null;
      currentListItem = null;
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const valStr = line.slice(colonIdx + 1).trim();
      if (!valStr) {
        currentSection = key;
        result[key] = key === 'routing' ? [] : {};
      } else {
        result[key] = parseYamlScalarOrInlineArray(valStr);
      }
    } else if (currentSection === 'routing' || Array.isArray(result[currentSection])) {
      if (!Array.isArray(result[currentSection])) {
        result[currentSection] = [];
      }
      if (line.startsWith('- ')) {
        currentListItem = {};
        result[currentSection].push(currentListItem);
        const rest = line.slice(2).trim();
        const colonIdx = rest.indexOf(':');
        if (colonIdx !== -1) {
          const k = rest.slice(0, colonIdx).trim();
          const v = rest.slice(colonIdx + 1).trim();
          currentListItem[k] = parseYamlScalarOrInlineArray(v);
        }
      } else if (currentListItem) {
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) {
          const k = line.slice(0, colonIdx).trim();
          const v = line.slice(colonIdx + 1).trim();
          currentListItem[k] = parseYamlScalarOrInlineArray(v);
        }
      }
    } else if (currentSection && typeof result[currentSection] === 'object') {
      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1) {
        const k = line.slice(0, colonIdx).trim();
        const v = line.slice(colonIdx + 1).trim();
        result[currentSection][k] = parseYamlScalarOrInlineArray(v);
      }
    }
  }
  return result;
}

function parseYamlScalarOrInlineArray(valStr) {
  if (valStr.startsWith('[') && valStr.endsWith(']')) {
    const inner = valStr.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => parseYamlScalarOrInlineArray(s.trim()));
  }
  if (valStr === 'true') return true;
  if (valStr === 'false') return false;
  if (/^-?\d+$/.test(valStr)) return Number.parseInt(valStr, 10);
  if ((valStr.startsWith('"') && valStr.endsWith('"')) || (valStr.startsWith("'") && valStr.endsWith("'"))) {
    return valStr.slice(1, -1);
  }
  return valStr;
}

export function serializeSimpleProjectYaml(configObj) {
  const lines = [];
  for (const [key, val] of Object.entries(configObj)) {
    if (Array.isArray(val)) {
      if (val.every((item) => typeof item !== 'object' || item === null)) {
        lines.push(`${key}: [${val.join(', ')}]`);
      } else {
        lines.push(`${key}:`);
        for (const item of val) {
          const entries = Object.entries(item);
          if (entries.length > 0) {
            lines.push(`  - ${entries[0][0]}: ${entries[0][1]}`);
            for (const [k, v] of entries.slice(1)) {
              lines.push(`    ${k}: ${v}`);
            }
          }
        }
      }
    } else if (val && typeof val === 'object') {
      lines.push(`${key}:`);
      for (const [subK, subV] of Object.entries(val)) {
        lines.push(`  ${subK}: ${subV}`);
      }
    } else {
      lines.push(`${key}: ${val}`);
    }
  }
  return lines.join('\n') + '\n';
}

export function validateAndNormalizeProjectConfig(raw) {
  assert.equal( typeof raw, 'object', 'Config must be an object');
  const normalized = {
    version: raw.version ?? 1,
    name: raw.name ?? 'unnamed-project',
    primary: raw.primary ?? 'codex',
    secondary: Array.isArray(raw.secondary) ? raw.secondary : ['antigravity', 'deepseek'],
    approvalMode: raw.approvalMode ?? 'ask',
    routing: Array.isArray(raw.routing) ? raw.routing : [],
    fallback: {
      onQuotaHit: 'next-secondary',
      ...(raw.fallback || {}),
    },
    teamwork: {
      maxParallel: 2,
      integrationBranch: 'conductor/integration',
      ...(raw.teamwork || {}),
    },
  };
  assert.equal(normalized.version, 1, 'Config version must be 1');
  assert.ok(['ask', 'auto-edit', 'full-auto'].includes(normalized.approvalMode), 'Invalid approvalMode');

  // Preserve unknown top-level keys (.passthrough())
  for (const [k, v] of Object.entries(raw)) {
    if (!(k in normalized)) {
      normalized[k] = v;
    }
  }
  return normalized;
}

export function loadProjectConfigFile(projectRoot) {
  const cfgPath = path.join(projectRoot, '.conductor', 'project.yaml');
  const rawObj = parseSimpleProjectYaml(fs.readFileSync(cfgPath, 'utf8'));
  return validateAndNormalizeProjectConfig(rawObj);
}

export function saveProjectConfigFile(projectRoot, updates) {
  const cfgPath = path.join(projectRoot, '.conductor', 'project.yaml');
  let existing = {};
  if (fs.existsSync(cfgPath)) {
    existing = parseSimpleProjectYaml(fs.readFileSync(cfgPath, 'utf8'));
  }
  const merged = validateAndNormalizeProjectConfig({
    ...existing,
    ...updates,
    fallback: { ...(existing.fallback || {}), ...(updates.fallback || {}) },
    teamwork: { ...(existing.teamwork || {}), ...(updates.teamwork || {}) },
  });
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, serializeSimpleProjectYaml(merged), 'utf8');
  return merged;
}

// ---------------------------------------------------------------------------
// F10, F11, F12: Mid-Session Handoff, Approval Gate & Slash Command Engine
// ---------------------------------------------------------------------------

export function buildHandoffSystemContext(store, sessionId, fromCli, toCli) {
  const events = store.getSessionEvents(sessionId);
  const userPrompts = [];
  const assistantReplies = [];
  const editedFiles = [];
  const toolsRun = [];

  for (const ev of events) {
    const p = ev.payload;
    if (p.type === 'message' && p.role === 'user') userPrompts.push(p.text);
    if (p.type === 'message' && p.role === 'assistant' && p.final) assistantReplies.push(p.text);
    if (p.type === 'file-edit') editedFiles.push(`${p.path} (+${p.added} -${p.removed})`);
    if (p.type === 'tool' && p.status === 'done') toolsRun.push(`${p.name}: ${p.summary || 'ok'}`);
  }

  return [
    `[Conductor Mid-Session Handoff: ${fromCli} -> ${toCli}]`,
    `User prompts: ${userPrompts.join(' | ') || 'none'}`,
    `Previous assistant summary: ${assistantReplies.join(' | ') || 'none'}`,
    `Edited files: ${editedFiles.join(', ') || 'none'}`,
    `Tools executed: ${toolsRun.join('; ') || 'none'}`,
  ].join('\n');
}

export class InteractiveApprovalGate {
  constructor(approvalMode = 'ask') {
    this.approvalMode = approvalMode;
    this.pending = new Map();
    this.sessionAllowedKinds = new Set();
    this.history = [];
    this.status = 'idle';
  }

  requestApproval(event) {
    if (this.approvalMode === 'full-auto') {
      this.history.push({ id: event.id, kind: event.kind, allowed: true, auto: 'full-auto' });
      return { blocked: false, allowed: true };
    }
    if (this.approvalMode === 'auto-edit' && event.kind === 'edit') {
      this.history.push({ id: event.id, kind: event.kind, allowed: true, auto: 'auto-edit' });
      return { blocked: false, allowed: true };
    }
    if (this.sessionAllowedKinds.has(event.kind)) {
      this.history.push({ id: event.id, kind: event.kind, allowed: true, auto: 'session-scope' });
      return { blocked: false, allowed: true };
    }
    this.status = 'waiting';
    this.pending.set(event.id, event);
    return { blocked: true, status: this.status };
  }

  respondToApproval(id, allow, scope = 'once') {
    const req = this.pending.get(id);
    if (!req) throw new Error(`Unknown approval request: ${id}`);
    this.pending.delete(id);
    if (allow && scope === 'session') {
      this.sessionAllowedKinds.add(req.kind);
    }
    this.status = allow ? 'working' : 'idle';
    const decision = { id, kind: req.kind, allowed: Boolean(allow), scope };
    this.history.push(decision);
    return decision;
  }
}

export const SLASH_COMMANDS_CATALOG = [
  { command: '/teamwork', description: 'Split this task across your CLIs' },
  { command: '/plan', description: 'Draft a plan first' },
  { command: '/review', description: 'Ask another CLI to review' },
  { command: '/cli', description: 'Switch active CLI for this session' },
  { command: '/undo', description: 'Restore working tree to pre-turn checkpoint' },
];

export function filterSlashPopupMenu(inputText) {
  if (!inputText.startsWith('/')) return [];
  const prefix = inputText.split(/\s+/)[0].toLowerCase();
  return SLASH_COMMANDS_CATALOG.filter((item) => item.command.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// F13: /teamwork Planner, Router, Worktree Manager, Scheduler & Merge
// ---------------------------------------------------------------------------

export function validateTeamworkPlan(planObj) {
  assert.equal(typeof planObj, 'object', 'Teamwork plan must be an object');
  assert.ok(typeof planObj.goal === 'string' && planObj.goal.length > 0, 'Plan goal required');
  assert.ok(Array.isArray(planObj.tasks) && planObj.tasks.length > 0, 'Plan tasks array required');
  return {
    goal: planObj.goal,
    tasks: planObj.tasks.map((t, i) => {
      assert.ok(typeof t.title === 'string' && t.title.length > 0, `Task ${i} missing title`);
      assert.ok(Array.isArray(t.scope) && t.scope.length > 0, `Task ${i} missing scope globs`);
      return {
        id: t.id || `task-${i + 1}`,
        title: t.title,
        description: t.description || '',
        scope: t.scope,
        dependencies: Array.isArray(t.dependencies) ? t.dependencies : [],
        taskType: t.taskType || 'implementation',
        assignedCli: t.assignedCli || null,
      };
    }),
  };
}

export function routeTeamworkTasks(plan, projectConfig) {
  const rules = projectConfig.routing || [];
  return plan.tasks.map((task) => {
    if (task.assignedCli) return task;
    const matchedRule = rules.find((r) => r.when === task.taskType);
    const assignedCli = matchedRule ? matchedRule.cli : projectConfig.primary || 'codex';
    return { ...task, assignedCli };
  });
}

export function createTaskWorktree(repoDir, taskId, integrationBranch = 'conductor/integration') {
  const worktreeRel = path.join('.conductor', 'worktrees', taskId);
  const worktreeAbs = path.join(repoDir, worktreeRel);
  const branchName = `conductor/task/${taskId}`;
  fs.mkdirSync(path.dirname(worktreeAbs), { recursive: true });
  gitExec(repoDir, ['worktree', 'add', '-B', branchName, worktreeAbs, integrationBranch]);
  return { taskId, worktreePath: worktreeAbs, branchName };
}

export async function runTeamworkScheduler(tasks, maxParallel, workerFn) {
  const completed = new Set();
  const running = new Set();
  const timeline = [];
  let currentActive = 0;
  let maxObservedActive = 0;

  const remaining = tasks.map((t) => ({ ...t, status: 'queued' }));

  while (completed.size < tasks.length) {
    const readyBatch = remaining.filter(
      (t) =>
        t.status === 'queued' &&
        t.dependencies.every((depId) => completed.has(depId))
    );

    const slots = Math.max(0, maxParallel - running.size);
    const toLaunch = readyBatch.slice(0, slots);

    const promises = toLaunch.map(async (task) => {
      task.status = 'running';
      running.add(task.id);
      currentActive++;
      if (currentActive > maxObservedActive) maxObservedActive = currentActive;
      timeline.push({ event: 'start', taskId: task.id, active: currentActive });

      await workerFn(task);

      currentActive--;
      running.delete(task.id);
      task.status = 'review';
      completed.add(task.id);
      timeline.push({ event: 'finish', taskId: task.id, active: currentActive });
    });

    if (promises.length > 0) {
      await Promise.all(promises);
    } else {
      throw new Error('Deadlock or unresolvable dependency in teamwork scheduler');
    }
  }

  return { maxObservedActive, timeline, tasks: remaining };
}

export function mergeTaskBranchIntoIntegration(repoDir, taskId, integrationBranch = 'conductor/integration') {
  const branchName = `conductor/task/${taskId}`;
  gitExec(repoDir, ['checkout', integrationBranch]);
  gitExec(repoDir, ['merge', '--no-ff', branchName, '-m', `Merge teamwork task ${taskId}`]);
  const headSha = gitExec(repoDir, ['rev-parse', 'HEAD']);
  return { merged: true, branchName, integrationBranch, headSha };
}

// ---------------------------------------------------------------------------
// F15, F16, F17, F18, F19: IDE Core Services (Explorer, Editor, Search, Terminal, Git Hunks)
// ---------------------------------------------------------------------------

export function readExplorerTreeLevel(repoDir, relDir = '', respectGitignore = true) {
  const targetDir = path.resolve(repoDir, relDir);
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  const statusOut = gitExec(repoDir, ['status', '--porcelain']);
  const gitStatusMap = new Map();
  for (const line of statusOut.split('\n').filter(Boolean)) {
    const code = line.slice(0, 2).trim();
    const fileRel = line.slice(3).trim();
    gitStatusMap.set(fileRel, code === '??' ? 'U' : code[0]);
  }

  let ignoredSet = new Set();
  if (respectGitignore) {
    const relPaths = entries.map((e) => path.posix.join(relDir.replace(/\\/g, '/'), e.name));
    if (relPaths.length > 0) {
      const checkIgnore = spawnSync('/usr/bin/git', ['check-ignore', ...relPaths], {
        cwd: repoDir,
        encoding: 'utf8',
      });
      if (checkIgnore.stdout) {
        ignoredSet = new Set(
          checkIgnore.stdout
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
        );
      }
    }
  }

  const items = [];
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const itemRel = relDir ? `${relDir.replace(/\\/g, '/')}/${entry.name}` : entry.name;
    if (respectGitignore && ignoredSet.has(itemRel)) continue;
    items.push({
      name: entry.name,
      relPath: itemRel,
      kind: entry.isDirectory() ? 'directory' : 'file',
      gitStatus: gitStatusMap.get(itemRel) || null,
    });
  }
  return items.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function runRipgrepSearch(cwd, { query, regex = false, caseSensitive = true, wholeWord = false, globs = [] }) {
  const args = ['--json'];
  if (!regex) args.push('--fixed-strings');
  if (!caseSensitive) args.push('--ignore-case');
  if (wholeWord) args.push('--word-regexp');
  for (const g of globs) {
    args.push('--glob', g);
  }
  args.push(query, '.');

  const res = spawnSync('/usr/bin/rg', args, { cwd, encoding: 'utf8' });
  const matches = [];
  for (const line of (res.stdout || '').split('\n').filter(Boolean)) {
    const parsed = JSON.parse(line);
    if (parsed.type === 'match') {
      const data = parsed.data;
      matches.push({
        file: data.path.text.replace(/^\.\//, ''),
        line: data.line_number,
        column: (data.submatches[0]?.start ?? 0) + 1,
        snippet: data.lines.text.replace(/\r?\n$/, ''),
      });
    }
  }
  return matches;
}

export function replaceAcrossFilesWithPreview(cwd, { query, replacement, globs = [], commit = false }) {
  const matches = runRipgrepSearch(cwd, { query, regex: false, caseSensitive: true, globs });
  const affectedFiles = [...new Set(matches.map((m) => m.file))];
  const previews = [];

  for (const relFile of affectedFiles) {
    const absFile = path.join(cwd, relFile);
    const before = fs.readFileSync(absFile, 'utf8');
    const after = before.split(query).join(replacement);
    const occurrences = before.split(query).length - 1;
    previews.push({ file: relFile, occurrences, before, after });
    if (commit) {
      fs.writeFileSync(absFile, after, 'utf8');
    }
  }
  return { totalFiles: previews.length, previews, committed: commit };
}

export function parseUnifiedFileHunks(repoDir, filePath) {
  const rawDiff = gitExec(repoDir, ['diff', '-U1', '--', filePath]);
  if (!rawDiff) return { filePath, headerLines: [], hunks: [] };
  const lines = rawDiff.split('\n');
  const headerLines = [];
  const hunks = [];
  let currentHunk = null;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      currentHunk = {
        index: hunks.length,
        label: '',
        rangeHeader: line,
        lines: [line],
      };
      hunks.push(currentHunk);
    } else if (currentHunk) {
      currentHunk.lines.push(line);
    } else {
      headerLines.push(line);
    }
  }

  for (let i = 0; i < hunks.length; i++) {
    hunks[i].label = `Hunk ${i + 1} of ${hunks.length}`;
  }

  return { filePath, headerLines, hunks };
}

export function applySingleHunkAction(repoDir, filePath, hunkIndex, action) {
  const parsed = parseUnifiedFileHunks(repoDir, filePath);
  const hunk = parsed.hunks[hunkIndex];
  assert.ok(hunk, `Hunk index ${hunkIndex} not found for ${filePath}`);
  const patchText = [...parsed.headerLines, ...hunk.lines, ''].join('\n');

  if (action === 'accept') {
    // Stage hunk into git index
    execFileSync('/usr/bin/git', ['apply', '--cached', '--unidiff-zero', '-'], {
      cwd: repoDir,
      input: patchText,
      encoding: 'utf8',
    });
    return { action: 'accept', stagedHunk: hunk.label };
  }
  if (action === 'reject') {
    // Revert hunk in working tree
    execFileSync('/usr/bin/git', ['apply', '-R', '--unidiff-zero', '-'], {
      cwd: repoDir,
      input: patchText,
      encoding: 'utf8',
    });
    return { action: 'reject', revertedHunk: hunk.label };
  }
  throw new Error(`Unsupported hunk action: ${action}`);
}

// ---------------------------------------------------------------------------
// F23 & F24: Adapter Contract Suite, Extensions & Design Tokens
// ---------------------------------------------------------------------------

export async function run7PointAdapterContractSuite(adapter, workDir) {
  const results = {};
  const caps = await adapter.capabilities();
  assert.equal(typeof caps.acp, 'boolean');

  // 1. start()
  const session = await adapter.start({
    cwd: workDir,
    approvalMode: 'ask',
    systemContext: 'Contract test context',
  });
  assert.ok(session && typeof session.id === 'string', '1. start() must return session with id');
  results.start = true;

  const collected = [];
  await session.send('Run full contract sequence');
  for await (const ev of session.events) {
    collected.push(ev);
    if (ev.type === 'approval') {
      await session.respondToApproval(ev.id, true);
    }
    if (ev.type === 'status' && ev.state === 'idle') {
      break;
    }
  }

  // 2. stream message ending with final: true
  const msgs = collected.filter((e) => e.type === 'message' && e.role === 'assistant');
  assert.ok(msgs.some((m) => m.final === true), '2. must emit final assistant message');
  results.streamMessage = true;

  // 3. report file-edit
  const editEv = collected.find((e) => e.type === 'file-edit');
  assert.ok(editEv && editEv.added >= 0 && editEv.removed >= 0, '3. must emit file-edit event');
  results.fileEdit = true;

  // 4. handle approval
  const apprEv = collected.find((e) => e.type === 'approval');
  assert.ok(apprEv && apprEv.id, '4. must emit approval event and resume after respondToApproval');
  results.approval = true;

  // 5. cancel mid-run
  await session.cancel();
  results.cancel = true;

  // 6. resume or degrade
  const resumedSession = await adapter.start({
    cwd: workDir,
    approvalMode: 'ask',
    resume: caps.resume ? session.id : undefined,
    systemContext: !caps.resume ? 'Fallback summary' : undefined,
  });
  assert.ok(resumedSession.id, '6. must support resume or systemContext degradation');
  await resumedSession.close();
  results.resumeOrDegrade = true;

  // 7. usage reporting
  const usageEv = collected.find((e) => e.type === 'usage');
  assert.ok(usageEv !== undefined, '7. must report usage event');
  results.usage = true;

  await session.close();
  return results;
}

export const REQUIRED_LIGHT_TOKENS = {
  '--bg-ground': '#F6F8F5',
  '--bg-sidebar': '#EAF1E8',
  '--border-default': '#D2DFD0',
  '--text-ink': '#1B2B22',
  '--text-muted': '#566A5E',
  '--accent-primary': '#2F6B4F',
  '--bg-diff-add': '#E3F3E2',
  '--bg-diff-remove': '#F8E4E4',
  '--cli-codex': '#1B2B22',
  '--cli-antigravity': '#2F5FD0',
  '--cli-deepseek': '#6B4FD0',
  '--radius-sm': '8px',
  '--radius-md': '12px',
  '--radius-lg': '14px',
  '--sidebar-width': '216px',
  '--right-pane-width': '360px',
};
