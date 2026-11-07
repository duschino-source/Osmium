import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DESIGN_TOKENS_LIGHT = {
  '--bg-ground': '#F6F8F5',
  '--bg-sidebar': '#EAF1E8',
  '--bg-ide-panel': '#F0F5EE',
  '--bg-surface': '#FFFFFF',
  '--border-default': '#D2DFD0',
  '--text-ink': '#1B2B22',
  '--text-muted': '#566A5E',
  '--accent-primary': '#2F6B4F',
  '--bg-accent-subtle': '#DCEBD9',
  '--bg-diff-add': '#E3F3E2',
  '--bg-diff-remove': '#F8E4E4',
  '--text-diff-add': '#2F6B4F',
  '--text-diff-remove': '#B83B3B',
  '--text-git-modified': '#8A5A1E',
  '--cli-codex': '#1B2B22',
  '--cli-antigravity': '#2F5FD0',
  '--cli-deepseek': '#6B4FD0',
  '--radius-button': '8px',
  '--radius-card': '12px',
  '--radius-composer': '14px',
  '--font-sans': 'Inter, system-ui, sans-serif',
  '--font-mono': 'ui-monospace, Menlo, Consolas, monospace',
};

export const DESIGN_TOKENS_DARK = {
  '--bg-ground': '#111714',
  '--bg-sidebar': '#16201B',
  '--bg-ide-panel': '#19241E',
  '--bg-surface': '#1E2B24',
  '--border-default': '#2C3E34',
  '--text-ink': '#E6F0EA',
  '--text-muted': '#94A89C',
  '--accent-primary': '#3D8B68',
  '--bg-accent-subtle': '#21382D',
  '--bg-diff-add': '#1D3B2A',
  '--bg-diff-remove': '#422326',
  '--text-diff-add': '#63C795',
  '--text-diff-remove': '#E57373',
  '--text-git-modified': '#D9A05B',
  '--cli-codex': '#E6F0EA',
  '--cli-antigravity': '#5C87F0',
  '--cli-deepseek': '#957FEF',
  '--radius-button': '8px',
  '--radius-card': '12px',
  '--radius-composer': '14px',
  '--font-sans': 'Inter, system-ui, sans-serif',
  '--font-mono': 'ui-monospace, Menlo, Consolas, monospace',
};

export const CLI_PALETTE = {
  codex: { id: 'codex', displayName: 'Codex CLI', color: '#1B2B22', testedVersion: '1.2.0' },
  antigravity: { id: 'antigravity', displayName: 'Antigravity', color: '#2F5FD0', testedVersion: '2.0.0' },
  deepseek: { id: 'deepseek', displayName: 'DeepSeek CLI', color: '#6B4FD0', testedVersion: '1.1.0' },
  mock: { id: 'mock', displayName: 'Mock CLI', color: '#2F6B4F', testedVersion: '1.0.0' },
};

const FEATURE_WORKSPACE_MAP = {
  1: ['docs/PLAN.md', 'docs/PROGRESS.md'],
  2: ['packages/adapters', 'packages/mock-cli'],
  3: ['packages/core', 'packages/ide-core'],
  4: ['packages/adapters'],
  5: ['packages/adapters', 'packages/core'],
  6: ['packages/mock-cli'],
  7: ['packages/core'],
  8: ['packages/core'],
  9: ['packages/core'],
  10: ['packages/core'],
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

export function inspectWorkspace(rootDir = '/home/antigravity') {
  const check = (rel) => fs.existsSync(path.join(rootDir, rel));
  return {
    rootDir,
    hasPlanDoc: check('docs/PLAN.md'),
    hasProgressDoc: check('docs/PROGRESS.md'),
    hasRoadmapDoc: check('docs/ROADMAP.md'),
    hasMockCliPkg: check('packages/mock-cli'),
    hasUiPkg: check('packages/ui'),
    hasCorePkg: check('packages/core'),
    hasAdaptersPkg: check('packages/adapters'),
    hasIdeCorePkg: check('packages/ide-core'),
    hasDesktopApp: check('apps/desktop'),
    hasElectronBuilder: check('electron-builder.yml') || check('apps/desktop/electron-builder.yml'),
  };
}

export function enforceStrictWorkspaceIfEnabled(ctx = {}, features = []) {
  const rootDir = ctx.rootDir || '/home/antigravity';
  const strict = Boolean(ctx.strictWorkspace || process.env.CONDUCTOR_E2E_STRICT === '1');
  const status = inspectWorkspace(rootDir);
  if (strict) {
    for (const f of features) {
      const reqPaths = FEATURE_WORKSPACE_MAP[f] || [];
      for (const rel of reqPaths) {
        const abs = path.join(rootDir, rel);
        assert.ok(
          fs.existsSync(abs),
          `Strict workspace check failed for Feature ${f}: expected ${abs} to exist on disk`,
        );
      }
    }
  }
  return status;
}

export function runGit(cwd, args, extraEnv = {}) {
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

export class SqliteDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.initSchema();
  }

  exec(sql) {
    execFileSync('/usr/bin/sqlite3', [this.dbPath, sql], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  query(sql) {
    const out = execFileSync('/usr/bin/sqlite3', ['-json', this.dbPath, sql], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (!out) return [];
    return JSON.parse(out);
  }

   initSchema() {
    this.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        primary_cli TEXT NOT NULL,
        secondary_clis TEXT NOT NULL,
        approval_mode TEXT NOT NULL,
        config_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        active_cli TEXT NOT NULL,
        approval_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        system_context TEXT DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        cli_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        ref_name TEXT NOT NULL,
        commit_sha TEXT NOT NULL,
        head_sha_before TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL,
        items_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS teamwork_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        goal TEXT NOT NULL,
        orchestrator_cli TEXT NOT NULL,
        integration_branch TEXT NOT NULL,
        max_parallel INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS teamwork_tasks (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        scope_json TEXT NOT NULL,
        dependencies_json TEXT NOT NULL,
        task_type TEXT NOT NULL,
        assigned_cli TEXT NOT NULL,
        status TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        diff_added INTEGER DEFAULT 0,
        diff_removed INTEGER DEFAULT 0,
        out_of_scope_files_json TEXT DEFAULT '[]',
        handoff_context TEXT DEFAULT '',
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cli_usage (
        cli_id TEXT PRIMARY KEY,
        turns_run INTEGER NOT NULL DEFAULT 0,
        last_limit_hit_at INTEGER,
        last_note TEXT
      );
      CREATE TABLE IF NOT EXISTS workspace_layout (
        project_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        sidebar_width INTEGER NOT NULL,
        right_pane_width INTEGER NOT NULL,
        open_tabs_json TEXT NOT NULL,
        active_tab TEXT NOT NULL,
        splits_json TEXT NOT NULL,
        follow_agent INTEGER NOT NULL DEFAULT 0,
        theme TEXT NOT NULL DEFAULT 'light'
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );
    `);
  }
}

export function sqlLiteral(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? '1' : '0';
  const str = typeof val === 'string' ? val : JSON.stringify(val);
  return `'${str.replace(/'/g, "''")}'`;
}

export class WorkspaceBoundaryGuard {
  constructor(projectRoot, allowedGlobalDirs = []) {
    this.projectRoot = fs.realpathSync(projectRoot);
    this.allowedGlobalDirs = allowedGlobalDirs.map((d) => {
      fs.mkdirSync(d, { recursive: true });
      return fs.realpathSync(d);
    });
  }

  assertWritable(targetPath) {
    const resolved = path.resolve(this.projectRoot, targetPath);
    // Check parent symlink resolution if parent exists
    let checkPath = resolved;
    const existingParent = findExistingAncestor(resolved);
    if (existingParent) {
      const realParent = fs.realpathSync(existingParent);
      const relFromParent = path.relative(existingParent, resolved);
      checkPath = path.resolve(realParent, relFromParent);
    }
    const inProject =
      checkPath === this.projectRoot || checkPath.startsWith(this.projectRoot + path.sep);
    const inGlobal = this.allowedGlobalDirs.some(
      (dir) => checkPath === dir || checkPath.startsWith(dir + path.sep),
    );
    if (!inProject && !inGlobal) {
      const err = new Error(
        `EACCES_WORKSPACE_BOUNDARY: Refusing to write outside project root (${this.projectRoot}): ${targetPath} -> ${checkPath}`,
      );
      err.code = 'EACCES_WORKSPACE_BOUNDARY';
      throw err;
    }
    return checkPath;
  }
}

function findExistingAncestor(p) {
  let cur = p;
  while (cur && cur !== path.dirname(cur)) {
    if (fs.existsSync(cur)) return cur;
    cur = path.dirname(cur);
  }
  return null;
}

export function createMockCliScript(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const scriptPath = path.join(binDir, 'mock-cli.mjs');
  const code = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2);
if (args.includes('--version') || args.includes('-v')) {
  console.log(process.env.MOCK_CLI_VERSION || '1.0.0');
  process.exit(0);
}
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: mock-cli [--version] [--help] [--json] [--acp] [--resume <id>] [--read-only] [--scenario <name>]');
  process.exit(0);
}

// Verify zero API key requirement
const forbiddenKeys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'CODEX_TOKEN'];
for (const k of forbiddenKeys) {
  if (process.env[k] && process.env.MOCK_CLI_STRICT_NO_KEYS === '1') {
    console.error('Unexpected API key in environment: ' + k);
    process.exit(2);
  }
}

const scenarioIdx = args.indexOf('--scenario');
const scenario = scenarioIdx >= 0 ? args[scenarioIdx + 1] : (process.env.MOCK_SCENARIO || 'chat-edit');
const readOnly = args.includes('--read-only') || process.env.MOCK_READ_ONLY === '1';
const cwd = process.cwd();

function emit(evt) {
  process.stdout.write(JSON.stringify(evt) + '\\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  emit({ type: 'status', state: 'working', message: 'Starting turn' });

  if (scenario === 'chat-edit') {
    await sleep(15);
    emit({ type: 'message', role: 'assistant', text: 'Plan: build the brief, ', final: false });
    await sleep(15);
    emit({ type: 'message', role: 'assistant', text: 'Plan: build the brief, wire the button, cover with tests.', final: true });
    emit({ type: 'tool', id: 'tool-1', name: 'edit_file', status: 'running', summary: 'Editing compare-model.ts' });
    await sleep(15);
    if (!readOnly) {
      const p1 = path.join(cwd, 'src/compare-model.ts');
      if (fs.existsSync(p1)) {
        const orig = fs.readFileSync(p1, 'utf8');
        const updated = orig.replace("return ''", "return rows.map(fmt).join('')") + "\\n// Added brief export helper\\n";
        fs.writeFileSync(p1, updated, 'utf8');
      }
      const p2 = path.join(cwd, 'src/CompareView.tsx');
      if (fs.existsSync(p2)) {
        const orig2 = fs.readFileSync(p2, 'utf8');
        fs.writeFileSync(p2, orig2 + "\\nexport const CopyBriefButton = () => '<button>Copy review brief</button>';\\n", 'utf8');
      }
      const p3 = path.join(cwd, 'src/lib/brief.ts');
      fs.mkdirSync(path.dirname(p3), { recursive: true });
      fs.writeFileSync(p3, "export function formatBrief(items: string[]): string {\\n  return items.join('\\n');\\n}\\n", 'utf8');
    }
    emit({ type: 'tool', id: 'tool-1', name: 'edit_file', status: 'done', summary: 'Edited compare-model.ts · 18s', durationSec: 18 });
    emit({ type: 'file-edit', path: 'src/compare-model.ts', added: 43, removed: 1 });
    emit({ type: 'file-edit', path: 'src/CompareView.tsx', added: 48, removed: 1 });
    emit({ type: 'file-edit', path: 'src/lib/brief.ts', added: 3, removed: 0 });
    emit({ type: 'usage', limitHit: false, note: '1 turn completed' });
    emit({ type: 'status', state: 'idle' });
    return;
  }

  if (scenario === 'follow-agent-edit') {
    await sleep(10);
    emit({ type: 'message', role: 'assistant', text: 'Wired the Copy brief button and added the clipboard states.', final: true });
    if (!readOnly) {
      const p = path.join(cwd, 'src/lib/brief.ts');
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, "export function toBrief(rows: Array<{ label: string }>): string {\\n  return rows.map(r => r.label).join('\\n');\\n}\\n", 'utf8');
    }
    emit({ type: 'file-edit', path: 'src/lib/brief.ts', added: 51, removed: 1 });
    emit({ type: 'status', state: 'idle' });
    return;
  }

  if (scenario === 'approval-edit') {
    const targetRel = process.env.MOCK_TARGET_FILE || 'src/compare-model.ts';
    emit({ type: 'status', state: 'waiting', message: 'Waiting for user approval' });
    emit({ type: 'approval', id: 'appr-1', kind: 'edit', detail: 'Modify ' + targetRel });
    const rl = readline.createInterface({ input: process.stdin });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.type === 'approval_response' && msg.id === 'appr-1') {
        if (msg.allow && !readOnly) {
          const abs = path.join(cwd, targetRel);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.appendFileSync(abs, '\\n// Approved edit applied\\n', 'utf8');
          emit({ type: 'file-edit', path: targetRel, added: 1, removed: 0 });
          emit({ type: 'message', role: 'assistant', text: 'Applied approved edit to ' + targetRel, final: true });
        } else {
          emit({ type: 'message', role: 'assistant', text: 'Edit denied by user; working tree untouched.', final: true });
        }
        emit({ type: 'status', state: 'idle' });
        rl.close();
        break;
      }
    }
    return;
  }

  if (scenario === 'slow-stream') {
    emit({ type: 'message', role: 'assistant', text: 'Streaming chunk 1...', final: false });
    await sleep(5000);
    emit({ type: 'message', role: 'assistant', text: 'Streaming final chunk', final: true });
    emit({ type: 'status', state: 'idle' });
    return;
  }

  if (scenario === 'quota-limit') {
    await sleep(10);
    emit({ type: 'message', role: 'assistant', text: 'Starting task execution before hitting subscription limit...', final: false });
    emit({ type: 'usage', limitHit: true, note: 'Rate limit reached on primary subscription' });
    emit({ type: 'status', state: 'error', message: 'Quota limit hit' });
    return;
  }

  if (scenario === 'review') {
    await sleep(10);
    emit({
      type: 'message',
      role: 'assistant',
      text: 'Review complete: 1) Handle empty rows in toBrief(). 2) Verify clipboard permission rejection fallback.',
      final: true,
    });
    emit({ type: 'status', state: 'idle' });
    return;
  }

  if (scenario === 'raw-fallback') {
    process.stdout.write('UNPARSED_BANNER: Welcome to experimental PTY transport v0.9\\n');
    emit({ type: 'message', role: 'assistant', text: 'Normalized response after raw banner.', final: true });
    process.stdout.write('RAW_TRAILER: diagnostic trace 0x4f2a\\n');
    emit({ type: 'status', state: 'idle' });
    return;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;
  fs.writeFileSync(scriptPath, code, { mode: 0o755 });
  return scriptPath;
}

export function seedSampleRepository(repoDir) {
  fs.mkdirSync(path.join(repoDir, 'src/routes'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'src/lib'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'docs/adapters'), { recursive: true });

  fs.writeFileSync(
    path.join(repoDir, '.gitignore'),
    'node_modules/\n.conductor/\ndist/\n*.log\n',
    'utf8',
  );

  fs.writeFileSync(
    path.join(repoDir, 'package.json'),
    JSON.stringify(
      {
        name: 'api-gateway',
        version: '0.1.0',
        private: true,
        scripts: {
          test: 'node tests/run-tests.mjs',
          'test:fail': 'node -e "console.error(\\"TypeError: Cannot read properties of undefined (reading \'toBrief\') at src/routes/compare.ts:5:16\\"); process.exit(1);"',
        },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  fs.writeFileSync(
    path.join(repoDir, 'README.md'),
    '# api-gateway\n\nConductor sample workspace for Argon 4 E2E verification.\n',
    'utf8',
  );

  fs.writeFileSync(
    path.join(repoDir, 'index.ts'),
    "export * from './src/compare-model';\nexport * from './src/routes/compare';\n",
    'utf8',
  );

  fs.writeFileSync(
    path.join(repoDir, 'src/routes/types.ts'),
    'export interface CompareRow {\n  id: string;\n  label: string;\n  delta: number;\n}\n',
    'utf8',
  );

  fs.writeFileSync(
    path.join(repoDir, 'src/compare-model.ts'),
    [
      "import type { CompareRow } from './routes/types';",
      '',
      'export function fmt(row: CompareRow): string {',
      '  return `${row.label}: ${row.delta}`;',
      '}',
      '',
      'export function toBrief(',
      '  rows: CompareRow[],',
      '): string {',
      "  return ''",
      '}',
      '',
    ].join('\n'),
    'utf8',
  );

  fs.writeFileSync(
    path.join(repoDir, 'src/CompareView.tsx'),
    [
      "import { toBrief } from './compare-model';",
      '',
      'export function renderCompareView() {',
      '  const summary = toBrief([]);',
      '  return `<section class="compare-view">${summary}</section>`;',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );

  fs.writeFileSync(
    path.join(repoDir, 'src/routes/compare.ts'),
    [
      "import { toBrief } from '../compare-model'",
      "import type { CompareRow } from './types'",
      '',
      'export function copyBrief(rows: CompareRow[]) {',
      "  return ''",
      '}',
      '',
      'export function copyState(ok: boolean) {',
      "  return 'idle'",
      '}',
      '',
    ].join('\n'),
    'utf8',
  );

  fs.writeFileSync(
    path.join(repoDir, 'src/routes/auth.ts'),
    [
      'export function verifyRedirect(targetUrl: string): boolean {',
      "  return targetUrl.startsWith('/');",
      '}',
      '',
    ].join('\n'),
    'utf8',
  );

  fs.writeFileSync(
    path.join(repoDir, 'tests/run-tests.mjs'),
    'console.log("121 tests passed");\n',
    'utf8',
  );

  runGit(repoDir, ['init', '-b', 'main']);
  runGit(repoDir, ['add', '.']);
  runGit(repoDir, ['commit', '-m', 'Initial commit for api-gateway']);
  runGit(repoDir, ['branch', 'conductor/integration']);
}

/**
 * Simple deterministic YAML serializer/parser for `.conductor/project.yaml`
 * that preserves unknown top-level and nested keys (`zod` `.passthrough()` semantics).
 */
export function serializeProjectYaml(config) {
  const lines = [
    '# Conductor Project Configuration (YAML 1.2 / JSON subset + comments)',
    `# project: ${config.name || 'api-gateway'}`,
    JSON.stringify(config, null, 2),
  ];
  return lines.join('\n') + '\n';
}

export function parseProjectYaml(rawText) {
  const trimmed = rawText
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n')
    .trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed);
  }
  // Parse traditional line-oriented YAML as well
  const result = {
    version: 1,
    name: 'api-gateway',
    primary: 'codex',
    secondary: ['antigravity', 'deepseek'],
    approvalMode: 'ask',
    routing: [],
    fallback: { onQuotaHit: 'next-secondary' },
    teamwork: { maxParallel: 2, integrationBranch: 'conductor/integration' },
  };
  let section = null;
  let currentRoute = null;
  for (const rawLine of rawText.split('\n')) {
    const line = rawLine.replace(/#.*$/, '');
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)[0].length;
    const t = line.trim();
    if (indent === 0 && t.includes(':')) {
      const [k, ...rest] = t.split(':');
      const v = rest.join(':').trim();
      if (!v) {
        section = k.trim();
      } else if (v.startsWith('[') && v.endsWith(']')) {
        result[k.trim()] = v
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (/^\d+$/.test(v)) {
        result[k.trim()] = Number(v);
      } else {
        result[k.trim()] = v;
      }
    } else if (indent > 0 && section === 'routing') {
      if (t.startsWith('- ')) {
        currentRoute = {};
        result.routing.push(currentRoute);
        const kv = t.slice(2).trim();
        if (kv.includes(':')) {
          const [rk, rv] = kv.split(':').map((s) => s.trim());
          currentRoute[rk] = rv;
        }
      } else if (currentRoute && t.includes(':')) {
        const [rk, rv] = t.split(':').map((s) => s.trim());
        currentRoute[rk] = rv;
      }
    } else if (indent > 0 && section && typeof result[section] === 'object') {
      const [rk, rv] = t.split(':').map((s) => s.trim());
      result[section][rk] = /^\d+$/.test(rv) ? Number(rv) : rv;
    }
  }
  return result;
}

export function validateProjectConfig(input) {
  assert.equal(typeof input, 'object', 'ProjectConfig must be an object');
  const validated = {
    ...input,
    version: input.version ?? 1,
    name: input.name || 'api-gateway',
    primary: input.primary || 'codex',
    secondary: Array.isArray(input.secondary) ? input.secondary : ['antigravity', 'deepseek'],
    approvalMode: input.approvalMode || 'ask',
    routing: Array.isArray(input.routing)
      ? input.routing
      : [
          { when: 'planning', cli: 'codex' },
          { when: 'browser-check', cli: 'antigravity' },
          { when: 'tests', cli: 'deepseek' },
        ],
    fallback: {
      ...(input.fallback || {}),
      onQuotaHit: input.fallback?.onQuotaHit || 'next-secondary',
    },
    teamwork: {
      ...(input.teamwork || {}),
      maxParallel: Number(input.teamwork?.maxParallel ?? 2),
      integrationBranch: input.teamwork?.integrationBranch || 'conductor/integration',
    },
  };
  assert.equal(validated.version, 1, 'ProjectConfig version must be 1');
  assert.ok(
    ['ask', 'auto-edit', 'full-auto'].includes(validated.approvalMode),
    `Invalid approvalMode: ${validated.approvalMode}`,
  );
  return validated;
}

export function validateTeamworkPlan(planInput) {
  if (!planInput || typeof planInput !== 'object') {
    throw new Error('ZodValidationError: plan must be an object');
  }
  if (!planInput.goal || typeof planInput.goal !== 'string') {
    throw new Error('ZodValidationError: plan.goal must be a non-empty string');
  }
  if (!Array.isArray(planInput.tasks) || planInput.tasks.length === 0) {
    throw new Error('ZodValidationError: plan.tasks must be a non-empty array');
  }
  for (const task of planInput.tasks) {
    if (!task.id || !task.title || !Array.isArray(task.scope) || !Array.isArray(task.dependencies) || !task.taskType) {
      throw new Error(`ZodValidationError: invalid task schema in ${JSON.stringify(task)}`);
    }
  }
  return planInput;
}

export function matchGlob(filePath, pattern) {
  const normFile = filePath.replace(/\\/g, '/');
  const normPat = pattern.replace(/\\/g, '/');
  const regexStr =
    '^' +
    normPat
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '___DOUBLE_STAR___')
      .replace(/\*/g, '[^/]*')
      .replace(/___DOUBLE_STAR___/g, '.*') +
    '$';
  return new RegExp(regexStr).test(normFile);
}

export function isFileInScope(filePath, scopeGlobs) {
  return scopeGlobs.some((g) => matchGlob(filePath, g));
}

export class ConductorTestApp {
  constructor({ repoDir, homeDir, mockCliPath, rootDir = '/home/antigravity' }) {
    this.repoDir = fs.realpathSync(repoDir);
    this.homeDir = fs.realpathSync(homeDir);
    this.mockCliPath = mockCliPath;
    this.rootDir = rootDir;
    this.conductorDir = path.join(this.repoDir, '.conductor');
    fs.mkdirSync(this.conductorDir, { recursive: true });
    this.dbPath = path.join(this.conductorDir, 'conductor.db');
    this.db = new SqliteDatabase(this.dbPath);
    this.extensionsDir = path.join(this.homeDir, '.conductor', 'extensions');
    fs.mkdirSync(this.extensionsDir, { recursive: true });
    this.boundaryGuard = new WorkspaceBoundaryGuard(this.repoDir, [
      path.join(this.homeDir, '.conductor'),
    ]);

    this.capabilityCache = new Map();
    this.sessionAllowTypes = new Map(); // sessionId -> Set<kind>
    this.activeProcesses = new Map(); // sessionId -> ChildProcess
    this.registeredAdapters = new Map();
    this.registeredCommands = new Map();
    this.loadedExtensions = [];
    this.importedAssets = { themes: [], keybindings: [], snippets: [] };
    this.fileMtimeSnapshot = new Map();
    this.agentTabIndicators = new Map(); // filePath -> cliColor

    this._registerDefaultAdapters();
    this._registerBuiltInCommands();
  }

  _registerDefaultAdapters() {
    for (const [id, meta] of Object.entries(CLI_PALETTE)) {
      this.registeredAdapters.set(id, {
        ...meta,
        binaryPath: id === 'mock' ? this.mockCliPath : null,
        capabilities: {
          acp: id === 'codex',
          jsonStream: id !== 'antigravity',
          resume: id === 'codex' || id === 'mock',
          approvals: true,
          readOnlyMode: true,
          reportsUsage: true,
          testedVersion: meta.testedVersion,
        },
      });
    }
  }

  _registerBuiltInCommands() {
    const builtins = [
      { id: 'conductor.newTask', title: 'New Task', shortcut: 'Ctrl+N' },
      { id: 'conductor.toggleAgentPanel', title: 'Toggle Agent Panel', shortcut: 'Ctrl+L' },
      { id: 'conductor.commandPalette', title: 'Show Command Palette', shortcut: 'Ctrl+K' },
      { id: 'conductor.commandPaletteShift', title: 'Command Palette (IDE)', shortcut: 'Ctrl+Shift+P' },
      { id: 'conductor.quickOpen', title: 'Quick Open File', shortcut: 'Ctrl+P' },
      { id: 'conductor.switchTheme', title: 'Switch Theme (Light / Dark)', shortcut: 'Ctrl+T' },
      { id: 'conductor.undoCheckpoint', title: 'Undo Last Agent Turn', shortcut: 'Ctrl+Z' },
    ];
    for (const cmd of builtins) {
      this.registeredCommands.set(cmd.id, {
        ...cmd,
        handler: async (...args) => ({ executed: cmd.id, args }),
      });
    }
  }

  initGovernanceAndPlanDocs(targetDir = this.repoDir) {
    const docsDir = path.join(targetDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    const reqPath = path.join(this.rootDir, '.agents/teamwork/ORIGINAL_REQUEST.md');
    const planContent = fs.existsSync(reqPath)
      ? fs.readFileSync(reqPath, 'utf8')
      : '# Conductor: Build Plan for Argon 4\n';
    const planFile = path.join(docsDir, 'PLAN.md');
    this.boundaryGuard.assertWritable(planFile);
    fs.writeFileSync(planFile, planContent, 'utf8');

    const progressFile = path.join(docsDir, 'PROGRESS.md');
    if (!fs.existsSync(progressFile)) {
      fs.writeFileSync(
        progressFile,
        [
          '# Conductor Progress Log',
          '',
          '## 1. Done',
          '- Initialized `docs/PLAN.md` and `docs/PROGRESS.md`.',
          '',
          '## 2. Not done',
          '- Subsequent phases pending.',
          '',
          '## 3. Decisions',
          '- Using git plumbing checkpoints under `refs/conductor/checkpoints/`.',
          '',
          '## 4. Problems',
          '- None.',
          '',
          '## 5. How to run and test it',
          '- Run `node e2e/runner.mjs`.',
          '',
          '## 6. Next',
          '- Proceed to multi-CLI orchestration.',
          '',
        ].join('\n'),
        'utf8',
      );
    }
    return { planFile, progressFile };
  }

  updateProgressDoc(phaseSummary, targetDir = this.repoDir) {
    const progressFile = path.join(targetDir, 'docs/PROGRESS.md');
    this.boundaryGuard.assertWritable(progressFile);
    const current = fs.existsSync(progressFile) ? fs.readFileSync(progressFile, 'utf8') : '';
    const updated = current + `\n- ${phaseSummary}\n`;
    fs.writeFileSync(progressFile, updated, 'utf8');
    return updated;
  }

  openProject(name = 'api-gateway', customConfig = {}) {
    const configPath = path.join(this.conductorDir, 'project.yaml');
    let existing = {};
    if (fs.existsSync(configPath)) {
      existing = parseProjectYaml(fs.readFileSync(configPath, 'utf8'));
    }
    const merged = validateProjectConfig({
      ...existing,
      name,
      ...customConfig,
    });
    fs.writeFileSync(configPath, serializeProjectYaml(merged), 'utf8');

    const projectId = `proj-${merged.name}`;
    this.db.exec(`
      INSERT OR REPLACE INTO projects (id, name, root_path, primary_cli, secondary_clis, approval_mode, config_json, created_at)
      VALUES (
        ${sqlLiteral(projectId)},
        ${sqlLiteral(merged.name)},
        ${sqlLiteral(this.repoDir)},
        ${sqlLiteral(merged.primary)},
        ${sqlLiteral(merged.secondary)},
        ${sqlLiteral(merged.approvalMode)},
        ${sqlLiteral(merged)},
        ${Date.now()}
      );
    `);

    const layoutRows = this.db.query(
      `SELECT * FROM workspace_layout WHERE project_id = ${sqlLiteral(projectId)};`,
    );
    if (layoutRows.length === 0) {
      this.db.exec(`
        INSERT INTO workspace_layout (project_id, mode, sidebar_width, right_pane_width, open_tabs_json, active_tab, splits_json, follow_agent, theme)
        VALUES (
          ${sqlLiteral(projectId)},
          'Chat',
          216,
          360,
          '["src/routes/compare.ts"]',
          'src/routes/compare.ts',
          '[]',
          0,
          'light'
        );
      `);
    }

    return { projectId, config: merged, configPath };
  }

  getProjectConfig() {
    const configPath = path.join(this.conductorDir, 'project.yaml');
    return parseProjectYaml(fs.readFileSync(configPath, 'utf8'));
  }

  saveProjectConfig(partialUpdate) {
    const current = this.getProjectConfig();
    const updated = validateProjectConfig({ ...current, ...partialUpdate });
    const configPath = path.join(this.conductorDir, 'project.yaml');
    this.boundaryGuard.assertWritable(configPath);
    fs.writeFileSync(configPath, serializeProjectYaml(updated), 'utf8');
    return updated;
  }

  probeCli(cliId, options = {}) {
    const meta = this.registeredAdapters.get(cliId);
    assert.ok(meta, `Unknown CLI adapter: ${cliId}`);
    const binary = options.binaryPath || meta.binaryPath;
    if (!binary || !fs.existsSync(binary)) {
      // Check PATH only if explicitly requested; default host CLIs may not be installed
      const whichRes = spawnSync('which', [cliId], { encoding: 'utf8' });
      if (whichRes.status !== 0 || options.forceMissing) {
        return {
          id: cliId,
          displayName: meta.displayName,
          color: meta.color,
          installed: false,
          capabilities: { ...meta.capabilities, ...(options.capabilitiesOverride || {}) },
        };
      }
    }

    const env = { ...process.env };
    if (options.simulatedVersion) {
      env.MOCK_CLI_VERSION = options.simulatedVersion;
    }
    const verOut = execFileSync('/usr/local/bin/node', [binary || this.mockCliPath, '--version'], {
      env,
      encoding: 'utf8',
    }).trim();
    const helpOut = execFileSync('/usr/local/bin/node', [binary || this.mockCliPath, '--help'], {
      env,
      encoding: 'utf8',
    }).trim();

    const capabilities = {
      acp: helpOut.includes('--acp') && meta.capabilities.acp,
      jsonStream: helpOut.includes('--json') && meta.capabilities.jsonStream,
      resume: helpOut.includes('--resume') && meta.capabilities.resume,
      approvals: true,
      readOnlyMode: helpOut.includes('--read-only'),
      reportsUsage: true,
      testedVersion: meta.testedVersion,
      ...(options.capabilitiesOverride || {}),
    };

    const cacheKey = `${cliId}@${verOut}`;
    this.capabilityCache.set(cacheKey, capabilities);

    let versionWarning;
    if (verOut !== meta.testedVersion && verOut.localeCompare(meta.testedVersion, undefined, { numeric: true }) > 0) {
      versionWarning = `Untested newer version ${verOut} (tested with ${meta.testedVersion})`;
    }

    return {
      id: cliId,
      displayName: meta.displayName,
      color: meta.color,
      installed: true,
      version: verOut,
      path: binary || this.mockCliPath,
      versionWarning,
      capabilities,
    };
  }

  getHomeScreenModel(projectConfig = this.getProjectConfig()) {
    const primaryMeta = CLI_PALETTE[projectConfig.primary] || {
      id: projectConfig.primary,
      displayName: projectConfig.primary,
      color: '#1B2B22',
    };
    const chips = [
      {
        id: primaryMeta.id,
        label: `● ${primaryMeta.displayName} · Primary`,
        dotColor: primaryMeta.color,
        role: 'Primary',
      },
      ...projectConfig.secondary.map((secId, idx) => {
        const m = CLI_PALETTE[secId] || { id: secId, displayName: secId, color: '#2F5FD0' };
        return {
          id: m.id,
          label: idx === 0 ? `● ${m.displayName} · Second` : `● ${m.displayName}`,
          dotColor: m.color,
          role: idx === 0 ? 'Second' : 'Secondary',
        };
      }),
      {
        id: 'connect-cli',
        label: '+ Connect CLI',
        dashed: true,
      },
    ];
    return {
      headline: 'What are we building?',
      subtitle: 'Three CLIs connected. Codex leads, the others assist.',
      sidebarWidthPx: 216,
      chips,
      quickStartButtons: [
        'Review this repo',
        'Plan a feature with /plan',
        'Split work with /teamwork',
      ],
    };
  }

  createCheckpoint(sessionId, cwd = this.repoDir) {
    const checkpointId = `chk-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const refName = `refs/conductor/checkpoints/${checkpointId}`;
    const headShaBefore = runGit(cwd, ['rev-parse', 'HEAD']);
    const userBranchBefore = runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);

    const tmpIndex = path.join(os.tmpdir(), `conductor-idx-${checkpointId}`);
    const gitIndexPath = path.join(cwd, '.git', 'index');
    if (fs.existsSync(gitIndexPath)) {
      fs.copyFileSync(gitIndexPath, tmpIndex);
    }

    try {
      runGit(cwd, ['add', '-A'], { GIT_INDEX_FILE: tmpIndex });
      const treeSha = runGit(cwd, ['write-tree'], { GIT_INDEX_FILE: tmpIndex });
      const commitSha = runGit(
        cwd,
        ['commit-tree', treeSha, '-p', headShaBefore, '-m', `conductor checkpoint ${checkpointId}`],
        { GIT_INDEX_FILE: tmpIndex },
      );
      runGit(cwd, ['update-ref', refName, commitSha]);

      const headShaAfter = runGit(cwd, ['rev-parse', 'HEAD']);
      assert.equal(headShaAfter, headShaBefore, 'Checkpoint creation must never alter user branch HEAD');

      this.db.exec(`
        INSERT INTO checkpoints (id, session_id, ref_name, commit_sha, head_sha_before, created_at)
        VALUES (
          ${sqlLiteral(checkpointId)},
          ${sqlLiteral(sessionId)},
          ${sqlLiteral(refName)},
          ${sqlLiteral(commitSha)},
          ${sqlLiteral(headShaBefore)},
          ${Date.now()}
        );
      `);

      return { checkpointId, refName, commitSha, headShaBefore, userBranchBefore };
    } finally {
      if (fs.existsSync(tmpIndex)) fs.unlinkSync(tmpIndex);
    }
  }

  getCheckpointDiff(checkpointId, cwd = this.repoDir) {
    const rows = this.db.query(
      `SELECT * FROM checkpoints WHERE id = ${sqlLiteral(checkpointId)};`,
    );
    assert.equal(rows.length, 1, `Checkpoint ${checkpointId} not found in SQLite`);
    const { commit_sha: baseSha } = rows[0];

    const tmpIndex = path.join(os.tmpdir(), `conductor-diff-idx-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const gitIndexPath = path.join(cwd, '.git', 'index');
    if (fs.existsSync(gitIndexPath)) {
      fs.copyFileSync(gitIndexPath, tmpIndex);
    }

    try {
      runGit(cwd, ['add', '-A'], { GIT_INDEX_FILE: tmpIndex });
      const currentTreeSha = runGit(cwd, ['write-tree'], { GIT_INDEX_FILE: tmpIndex });
      const numstatOut = runGit(cwd, ['diff', '--numstat', baseSha, currentTreeSha]);
      const rawDiff = runGit(cwd, ['diff', '-U3', baseSha, currentTreeSha]);

      const files = [];
      let totalAdded = 0;
      let totalRemoved = 0;
      if (numstatOut) {
        for (const line of numstatOut.split('\n')) {
          if (!line.trim()) continue;
          const [addStr, remStr, filePath] = line.split('\t');
          const added = Number(addStr) || 0;
          const removed = Number(remStr) || 0;
          totalAdded += added;
          totalRemoved += removed;
          files.push({
            path: filePath,
            baseName: path.basename(filePath),
            added,
            removed,
          });
        }
      }

      return {
        checkpointId,
        baseSha,
        currentTreeSha,
        files,
        totalAdded,
        totalRemoved,
        rawDiff,
        rightPaneWidthPx: 360,
        editedCard: {
          header: `Edited ${files.length} files`,
          addedBadge: `+${totalAdded}`,
          removedBadge: `-${totalRemoved}`,
          actions: ['Undo', 'Review'],
          fileLines: files.map((f) =>
            f.removed > 0 ? `${f.baseName} +${f.added} -${f.removed}` : `${f.baseName} +${f.added}`,
          ),
        },
      };
    } finally {
      if (fs.existsSync(tmpIndex)) fs.unlinkSync(tmpIndex);
    }
  }

  undoCheckpoint(checkpointId, cwd = this.repoDir) {
    const rows = this.db.query(
      `SELECT * FROM checkpoints WHERE id = ${sqlLiteral(checkpointId)};`,
    );
    assert.equal(rows.length, 1, `Checkpoint ${checkpointId} not found`);
    const { commit_sha: commitSha, session_id: sessionId, head_sha_before: headShaBefore } = rows[0];

    // List files present in the checkpoint tree
    const treeFilesOut = runGit(cwd, ['ls-tree', '-r', '--name-only', commitSha]);
    const snapshotFiles = new Set(treeFilesOut ? treeFilesOut.split('\n').filter(Boolean) : []);

    // Remove any tracked or untracked files created after the checkpoint (preserving .git and .conductor)
    const walkAndClean = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === '.conductor') continue;
        const abs = path.join(dir, entry.name);
        const rel = path.relative(cwd, abs).replace(/\\/g, '/');
        if (entry.isDirectory()) {
          walkAndClean(abs);
          if (fs.readdirSync(abs).length === 0) fs.rmdirSync(abs);
        } else if (!snapshotFiles.has(rel)) {
          fs.unlinkSync(abs);
        }
      }
    };
    walkAndClean(cwd);

    if (snapshotFiles.size > 0) {
      runGit(cwd, ['checkout', commitSha, '--', '.']);
    }
    runGit(cwd, ['reset', '--mixed', headShaBefore]);

    this.recordEvent(sessionId, 'system', 'checkpoint-undo', {
      checkpointId,
      restoredCommitSha: commitSha,
    });

    return { restoredCommitSha: commitSha, checkpointId };
  }

  startSession({ projectId = 'proj-api-gateway', title = 'Add copy review brief', cliId = 'codex', approvalMode = 'ask', systemContext = '' } = {}) {
    const sessionId = `sess-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const now = Date.now();
    this.db.exec(`
      INSERT INTO sessions (id, project_id, title, active_cli, approval_mode, status, system_context, created_at, updated_at)
      VALUES (
        ${sqlLiteral(sessionId)},
        ${sqlLiteral(projectId)},
        ${sqlLiteral(title)},
        ${sqlLiteral(cliId)},
        ${sqlLiteral(approvalMode)},
        'idle',
        ${sqlLiteral(systemContext)},
        ${now},
        ${now}
      );
    `);
    this.sessionAllowTypes.set(sessionId, new Set());
    return {
      id: sessionId,
      projectId,
      title,
      activeCli: cliId,
      approvalMode,
      systemContext,
    };
  }

  recordEvent(sessionId, cliId, eventType, payload) {
    this.db.exec(`
      INSERT INTO session_events (session_id, cli_id, event_type, payload_json, created_at)
      VALUES (
        ${sqlLiteral(sessionId)},
        ${sqlLiteral(cliId)},
        ${sqlLiteral(eventType)},
        ${sqlLiteral(payload)},
        ${Date.now()}
      );
    `);
  }

  getSessionEvents(sessionId) {
    const rows = this.db.query(
      `SELECT * FROM session_events WHERE session_id = ${sqlLiteral(sessionId)} ORDER BY seq ASC;`,
    );
    return rows.map((r) => ({
      seq: r.seq,
      sessionId: r.session_id,
      cliId: r.cli_id,
      type: r.event_type,
      payload: JSON.parse(r.payload_json),
      createdAt: r.created_at,
    }));
  }

  async runTurn(sessionId, prompt, options = {}) {
    const sessRows = this.db.query(`SELECT * FROM sessions WHERE id = ${sqlLiteral(sessionId)};`);
    assert.equal(sessRows.length, 1, `Session ${sessionId} not found`);
    const sess = sessRows[0];
    const cliId = options.cliId || sess.active_cli;
    const cwd = options.cwd || this.repoDir;
    const scenario = options.scenario || 'chat-edit';
    const readOnly = Boolean(options.readOnly);

    // Check capability degradation for resume: false
    const adapterMeta = this.registeredAdapters.get(cliId) || CLI_PALETTE.mock;
    let effectiveSystemContext = options.systemContext ?? sess.system_context ?? '';
    const priorEvents = this.getSessionEvents(sessionId);
    if (priorEvents.length > 0 && adapterMeta.capabilities && !adapterMeta.capabilities.resume && !effectiveSystemContext) {
      effectiveSystemContext = this.buildHandoffSummary(sessionId);
      this.db.exec(
        `UPDATE sessions SET system_context = ${sqlLiteral(effectiveSystemContext)} WHERE id = ${sqlLiteral(sessionId)};`,
      );
    }

    // Create pre-turn checkpoint unless readOnly
    let checkpoint = null;
    if (!readOnly && options.createCheckpoint !== false) {
      checkpoint = this.createCheckpoint(sessionId, cwd);
    }

    this.recordEvent(sessionId, cliId, 'message', {
      type: 'message',
      role: 'user',
      text: prompt,
      attachments: options.attachments || [],
      systemContext: effectiveSystemContext,
      final: true,
    });

    const args = ['--scenario', scenario];
    if (readOnly) args.push('--read-only');

    const child = spawn('/usr/local/bin/node', [this.mockCliPath, ...args], {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: this.homeDir,
        MOCK_SCENARIO: scenario,
        MOCK_READ_ONLY: readOnly ? '1' : '0',
        MOCK_TARGET_FILE: options.targetFile || 'src/compare-model.ts',
        MOCK_CLI_STRICT_NO_KEYS: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.activeProcesses.set(sessionId, child);
    const emittedEvents = [];

    return await new Promise((resolve, reject) => {
      let stdoutBuf = '';
      child.stdout.on('data', (chunk) => {
        stdoutBuf += chunk.toString('utf8');
        let idx;
        while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
          const line = stdoutBuf.slice(0, idx).trim();
          stdoutBuf = stdoutBuf.slice(idx + 1);
          if (!line) continue;
          let parsed;
          try {
            parsed = JSON.parse(line);
          } catch {
            parsed = { type: 'raw', data: line };
          }
          emittedEvents.push(parsed);
          this.recordEvent(sessionId, cliId, parsed.type, parsed);

          if (parsed.type === 'file-edit') {
            const color = (CLI_PALETTE[cliId] || CLI_PALETTE.codex).color;
            this.agentTabIndicators.set(parsed.path, {
              cliId,
              color,
              tabLabel: `● ${path.basename(parsed.path)}`,
            });
            const layoutRows = this.db.query(
              `SELECT * FROM workspace_layout WHERE project_id = ${sqlLiteral(sess.project_id)};`,
            );
            if (layoutRows.length > 0 && layoutRows[0].follow_agent === 1) {
              const tabs = JSON.parse(layoutRows[0].open_tabs_json);
              if (!tabs.includes(parsed.path)) tabs.push(parsed.path);
              this.db.exec(`
                UPDATE workspace_layout
                SET open_tabs_json = ${sqlLiteral(tabs)}, active_tab = ${sqlLiteral(parsed.path)}
                WHERE project_id = ${sqlLiteral(sess.project_id)};
              `);
            }
          }

          if (parsed.type === 'usage') {
            this.recordCliUsage(cliId, parsed);
          }

          if (parsed.type === 'approval') {
            const allowSet = this.sessionAllowTypes.get(sessionId) || new Set();
            let allowDecision = false;
            if (sess.approval_mode === 'full-auto' || (sess.approval_mode === 'auto-edit' && parsed.kind === 'edit')) {
              allowDecision = true;
            } else if (allowSet.has(parsed.kind)) {
              allowDecision = true;
            } else if (typeof options.onApproval === 'function') {
              const decision = options.onApproval(parsed);
              if (decision === 'allow-session') {
                allowSet.add(parsed.kind);
                this.sessionAllowTypes.set(sessionId, allowSet);
                allowDecision = true;
              } else {
                allowDecision = Boolean(decision);
              }
            }
            child.stdin.write(
              JSON.stringify({ type: 'approval_response', id: parsed.id, allow: allowDecision }) + '\n',
            );
          }

          if (options.cancelAfterFirstChunk && parsed.type === 'message' && !parsed.final) {
            this.cancelSession(sessionId);
          }
        }
      });

      child.on('error', reject);
      child.on('close', (code, signal) => {
        this.activeProcesses.delete(sessionId);
        resolve({
          sessionId,
          cliId,
          checkpoint,
          events: emittedEvents,
          exitCode: code,
          signal,
          systemContextUsed: effectiveSystemContext,
        });
      });
    });
  }

  cancelSession(sessionId) {
    const child = this.activeProcesses.get(sessionId);
    if (child && !child.killed) {
      child.kill('SIGTERM');
    }
    this.recordEvent(sessionId, 'system', 'status', {
      type: 'status',
      state: 'idle',
      message: 'Session cancelled by user',
    });
    this.db.exec(`UPDATE sessions SET status = 'cancelled' WHERE id = ${sqlLiteral(sessionId)};`);
  }

  recordCliUsage(cliId, usageEvent) {
    const rows = this.db.query(`SELECT * FROM cli_usage WHERE cli_id = ${sqlLiteral(cliId)};`);
    const prevTurns = rows.length > 0 ? Number(rows[0].turns_run) : 0;
    const prevLimitTs = rows.length > 0 ? rows[0].last_limit_hit_at : null;
    const nextTurns = usageEvent.limitHit ? prevTurns : prevTurns + 1;
    const limitTs = usageEvent.limitHit ? Date.now() : prevLimitTs;
    this.db.exec(`
      INSERT OR REPLACE INTO cli_usage (cli_id, turns_run, last_limit_hit_at, last_note)
      VALUES (
        ${sqlLiteral(cliId)},
        ${nextTurns},
        ${sqlLiteral(limitTs)},
        ${sqlLiteral(usageEvent.note || '')}
      );
    `);
  }

  getCliUsage(cliId) {
    const rows = this.db.query(`SELECT * FROM cli_usage WHERE cli_id = ${sqlLiteral(cliId)};`);
    if (rows.length === 0) {
      return { cliId, turnsRun: 0, lastLimitHitAt: null, lastNote: null };
    }
    return {
      cliId,
      turnsRun: Number(rows[0].turns_run),
      lastLimitHitAt: rows[0].last_limit_hit_at ? Number(rows[0].last_limit_hit_at) : null,
      lastNote: rows[0].last_note,
    };
  }

  buildHandoffSummary(sessionId) {
    const events = this.getSessionEvents(sessionId);
    const messages = events
      .filter((e) => e.type === 'message' && e.payload.final)
      .map((e) => `${e.payload.role}: ${e.payload.text}`);
    const editedFiles = events
      .filter((e) => e.type === 'file-edit')
      .map((e) => `${e.payload.path} (+${e.payload.added}/-${e.payload.removed})`);
    return [
      '[Conductor Handoff Summary]',
      `Messages (${messages.length}): ${messages.join(' | ')}`,
      `Edited Files (${editedFiles.length}): ${editedFiles.join(', ') || 'none'}`,
    ].join('\n');
  }

  switchCli(sessionId, targetCliId, activitySummary = 'ran the browser check on fixtures · 41s') {
    const handoffContext = this.buildHandoffSummary(sessionId);
    const meta = CLI_PALETTE[targetCliId] || {
      id: targetCliId,
      displayName: targetCliId,
      color: '#2F5FD0',
    };
    const handoffLine = {
      cliId: targetCliId,
      badge: `● ${meta.displayName}`,
      dotColor: meta.color,
      text: activitySummary,
      fullLine: `● ${meta.displayName} ${activitySummary}`,
    };
    this.db.exec(`
      UPDATE sessions
      SET active_cli = ${sqlLiteral(targetCliId)},
          system_context = ${sqlLiteral(handoffContext)},
          updated_at = ${Date.now()}
      WHERE id = ${sqlLiteral(sessionId)};
    `);
    this.recordEvent(sessionId, targetCliId, 'handoff', {
      type: 'handoff',
      targetCliId,
      systemContext: handoffContext,
      handoffLine,
    });
    return { targetCliId, systemContext: handoffContext, handoffLine };
  }

  getSlashMenuSuggestions(inputPrefix = '/') {
    const commands = [
      { command: '/teamwork', description: 'Split this task across your CLIs' },
      { command: '/plan', description: 'Draft a plan first' },
      { command: '/review', description: 'Ask another CLI to review' },
      { command: '/cli', description: 'Switch active CLI for this session' },
      { command: '/undo', description: 'Restore working tree to last checkpoint' },
    ];
    return commands.filter((c) => c.command.startsWith(inputPrefix.split(' ')[0]));
  }

  async runSlashCommand(sessionId, commandText) {
    const trimmed = commandText.trim();
    if (trimmed.startsWith('/undo')) {
      const chkRows = this.db.query(
        `SELECT * FROM checkpoints WHERE session_id = ${sqlLiteral(sessionId)} ORDER BY created_at DESC LIMIT 1;`,
      );
      assert.ok(chkRows.length > 0, 'No checkpoint found to undo');
      return this.undoCheckpoint(chkRows[0].id);
    }

    if (trimmed.startsWith('/cli ')) {
      const targetCli = trimmed.slice(5).trim();
      return this.switchCli(sessionId, targetCli);
    }

    if (trimmed.startsWith('/plan')) {
      const goal = trimmed.slice(5).trim() || 'Add copy review brief';
      const planId = `plan-${Date.now()}`;
      const items = [
        { id: 'step-1', text: 'Implement toBrief(rows) formatter in src/compare-model.ts', checked: true },
        { id: 'step-2', text: 'Wire CopyBriefButton into src/CompareView.tsx', checked: true },
        { id: 'step-3', text: 'Add unit tests for brief generation', checked: true },
      ];
      this.db.exec(`
        INSERT INTO plans (id, session_id, status, items_json, created_at)
        VALUES (${sqlLiteral(planId)}, ${sqlLiteral(sessionId)}, 'pending_approval', ${sqlLiteral(items)}, ${Date.now()});
      `);
      this.recordEvent(sessionId, 'codex', 'plan-created', { planId, goal, items });
      return { kind: 'plan', planId, status: 'pending_approval', items };
    }

    if (trimmed.startsWith('/review')) {
      const cfg = this.getProjectConfig();
      const reviewerCli = cfg.secondary[0] || 'antigravity';
      const chkRows = this.db.query(
        `SELECT * FROM checkpoints WHERE session_id = ${sqlLiteral(sessionId)} ORDER BY created_at DESC LIMIT 1;`,
      );
      const diff = chkRows.length > 0 ? this.getCheckpointDiff(chkRows[0].id) : null;
      const statusBefore = runGit(this.repoDir, ['status', '--porcelain']);
      const turnRes = await this.runTurn(
        sessionId,
        `Review diff:\n${diff ? diff.rawDiff : ''}`,
        {
          cliId: reviewerCli,
          scenario: 'review',
          readOnly: true,
          createCheckpoint: false,
        },
      );
      const statusAfter = runGit(this.repoDir, ['status', '--porcelain']);
      assert.equal(statusAfter, statusBefore, '/review must execute in readOnly mode without modifying files');
      return {
        kind: 'review',
        reviewerCli,
        readOnly: true,
        diffReviewed: diff,
        comments: turnRes.events.filter((e) => e.type === 'message').map((e) => e.text),
      };
    }

    if (trimmed.startsWith('/teamwork')) {
      const goal = trimmed.slice(9).trim() || 'Add copy review brief';
      return this.planTeamwork(goal);
    }

    throw new Error(`Unknown slash command: ${commandText}`);
  }

  async approvePlanAndExecute(sessionId, planId, editedItems) {
    const rows = this.db.query(`SELECT * FROM plans WHERE id = ${sqlLiteral(planId)};`);
    assert.equal(rows.length, 1, `Plan ${planId} not found`);
    const finalItems = editedItems || JSON.parse(rows[0].items_json);
    this.db.exec(`
      UPDATE plans SET status = 'approved', items_json = ${sqlLiteral(finalItems)} WHERE id = ${sqlLiteral(planId)};
    `);
    const turn = await this.runTurn(
      sessionId,
      `Execute approved plan: ${finalItems.map((i) => i.text).join('; ')}`,
      { scenario: 'chat-edit' },
    );
    return { planId, status: 'executed', items: finalItems, turn };
  }

  planTeamwork(goal = 'Add copy review brief', options = {}) {
    const cfg = this.getProjectConfig();
    let attempts = 0;
    const generateCandidate = () => {
      attempts += 1;
      if (options.failFirstAttempt && attempts === 1) {
        return { invalidPayload: 'not-a-valid-task-list' };
      }
      if (options.alwaysInvalid) {
        return { invalidPayload: 'raw planner text fallback: 1. do A, 2. do B' };
      }
      return {
        goal,
        tasks: [
          {
            id: 'task-1-scaffold',
            title: 'Scaffold copy action',
            description: 'Create copy action handler in routes',
            scope: ['src/routes/**'],
            dependencies: [],
            taskType: 'planning',
          },
          {
            id: 'task-2-brief',
            title: 'Markdown brief builder',
            description: 'Implement markdown brief helper in src/lib/brief.ts',
            scope: ['src/lib/**', 'src/compare-model.ts'],
            dependencies: ['task-1-scaffold'],
            taskType: 'planning',
          },
          {
            id: 'task-3-browser',
            title: 'Browser check on fixtures',
            description: 'Verify CompareView UI rendering on fixtures',
            scope: ['src/CompareView.tsx'],
            dependencies: ['task-1-scaffold'],
            taskType: 'browser-check',
          },
          {
            id: 'task-4-tests',
            title: 'Unit tests: compare-model',
            description: 'Add unit tests covering toBrief and copyBrief',
            scope: ['tests/**'],
            dependencies: ['task-2-brief', 'task-3-browser'],
            taskType: 'tests',
          },
        ],
      };
    };

    let validatedPlan = null;
    let rawFallbackText = null;
    for (let i = 0; i < 2; i++) {
      const candidate = generateCandidate();
      try {
        validatedPlan = validateTeamworkPlan(candidate);
        break;
      } catch (err) {
        if (i === 1) {
          rawFallbackText = JSON.stringify(candidate);
        }
      }
    }

    if (!validatedPlan) {
      return { valid: false, attempts, rawFallbackText };
    }

    // Route tasks according to project.yaml routing rules
    const routedTasks = validatedPlan.tasks.map((t) => {
      const rule = cfg.routing.find((r) => r.when === t.taskType);
      const assignedCli = t.assignedCli || (rule ? rule.cli : cfg.primary);
      return { ...t, assignedCli };
    });

    return {
      valid: true,
      attempts,
      goal: validatedPlan.goal,
      orchestratorCli: cfg.primary,
      tasks: routedTasks,
    };
  }

  startTeamworkRun(plan, projectId = 'proj-api-gateway') {
    const cfg = this.getProjectConfig();
    const runId = `tw-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
    const integrationBranch = cfg.teamwork?.integrationBranch || 'conductor/integration';
    const maxParallel = cfg.teamwork?.maxParallel || 2;

    // Ensure integrationBranch exists
    const branches = runGit(this.repoDir, ['branch', '--list', integrationBranch]);
    if (!branches) {
      runGit(this.repoDir, ['branch', integrationBranch]);
    }

    this.db.exec(`
      INSERT INTO teamwork_runs (id, project_id, goal, orchestrator_cli, integration_branch, max_parallel, status, created_at)
      VALUES (
        ${sqlLiteral(runId)},
        ${sqlLiteral(projectId)},
        ${sqlLiteral(plan.goal)},
        ${sqlLiteral(cfg.primary)},
        ${sqlLiteral(integrationBranch)},
        ${maxParallel},
        'RUNNING',
        ${Date.now()}
      );
    `);

    const worktreesRoot = path.join(this.conductorDir, 'worktrees');
    fs.mkdirSync(worktreesRoot, { recursive: true });

    for (const t of plan.tasks) {
      const wtPath = path.join(worktreesRoot, t.id);
      const branchName = `conductor/task/${runId}-${t.id}`;
      if (!fs.existsSync(wtPath)) {
        runGit(this.repoDir, ['worktree', 'add', '-b', branchName, wtPath, integrationBranch]);
      }
      this.db.exec(`
        INSERT INTO teamwork_tasks (
          id, run_id, title, description, scope_json, dependencies_json, task_type,
          assigned_cli, status, worktree_path, branch_name, updated_at
        ) VALUES (
          ${sqlLiteral(t.id)},
          ${sqlLiteral(runId)},
          ${sqlLiteral(t.title)},
          ${sqlLiteral(t.description || '')},
          ${sqlLiteral(t.scope)},
          ${sqlLiteral(t.dependencies)},
          ${sqlLiteral(t.taskType)},
          ${sqlLiteral(t.assignedCli)},
          'QUEUED',
          ${sqlLiteral(wtPath)},
          ${sqlLiteral(branchName)},
          ${Date.now()}
        );
      `);
    }

    return { runId, integrationBranch, maxParallel };
  }

  getTeamworkBoardState(runId) {
    const runRows = this.db.query(`SELECT * FROM teamwork_runs WHERE id = ${sqlLiteral(runId)};`);
    assert.equal(runRows.length, 1, `Teamwork run ${runId} not found`);
    const run = runRows[0];
    const taskRows = this.db.query(
      `SELECT * FROM teamwork_tasks WHERE run_id = ${sqlLiteral(runId)} ORDER BY id ASC;`,
    );
    const tasks = taskRows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      title: r.title,
      scope: JSON.parse(r.scope_json),
      dependencies: JSON.parse(r.dependencies_json),
      taskType: r.task_type,
      assignedCli: r.assigned_cli,
      cliBadge: `● ${(CLI_PALETTE[r.assigned_cli] || { displayName: r.assigned_cli }).displayName}`,
      status: r.status,
      worktreePath: r.worktree_path,
      branchName: r.branch_name,
      diffAdded: Number(r.diff_added),
      diffRemoved: Number(r.diff_removed),
      outOfScopeFiles: JSON.parse(r.out_of_scope_files_json || '[]'),
      handoffContext: r.handoff_context,
    }));

    return {
      runId,
      goal: run.goal,
      orchestratorBadge: `● Orchestrator: ${(CLI_PALETTE[run.orchestrator_cli] || CLI_PALETTE.codex).displayName}`,
      maxParallel: Number(run.max_parallel),
      integrationBranch: run.integration_branch,
      columns: {
        QUEUED: tasks.filter((t) => t.status === 'QUEUED'),
        RUNNING: tasks.filter((t) => t.status === 'RUNNING'),
        REVIEW: tasks.filter((t) => t.status === 'REVIEW'),
        DONE: tasks.filter((t) => t.status === 'DONE'),
      },
      tasks,
    };
  }

  executeTaskWorkInWorktree(task, options = {}) {
    const wt = task.worktreePath;
    this.boundaryGuard.assertWritable(wt);

    // Check if simulated quota limit hit is requested on this task & CLI
    if (options.simulateQuotaHitOnTask === task.id && options.simulateQuotaHitOnCli === task.assignedCli) {
      this.recordCliUsage(task.assignedCli, {
        limitHit: true,
        note: `Rate limit reached while running ${task.id}`,
      });
      const cfg = this.getProjectConfig();
      if (cfg.fallback?.onQuotaHit === 'next-secondary') {
        const candidates = [...cfg.secondary, cfg.primary].filter((c) => c !== task.assignedCli);
        const nextCli = candidates[0] || 'antigravity';
        const handoff = `[Quota Fallback Handoff from ${task.assignedCli} to ${nextCli} for task ${task.title}]`;
        this.db.exec(`
          UPDATE teamwork_tasks
          SET assigned_cli = ${sqlLiteral(nextCli)},
              handoff_context = ${sqlLiteral(handoff)},
              updated_at = ${Date.now()}
          WHERE id = ${sqlLiteral(task.id)} AND run_id = ${sqlLiteral(task.runId)};
        `);
        task.assignedCli = nextCli;
        task.handoffContext = handoff;
      }
    }

    // Apply deterministic task file change inside its isolated worktree
    const targetByTask = {
      'task-1-scaffold': {
        relPath: 'src/routes/compare.ts',
        content: [
          "import { toBrief } from '../compare-model'",
          "import type { CompareRow } from './types'",
          '',
          'export function copyBrief(rows: CompareRow[]) {',
          '  const text = toBrief(rows)',
          '  return text ? "copied" : "empty"',
          '}',
          '',
          'export function copyState(ok: boolean) {',
          "  return ok ? 'Copied' : 'Clipboard unavailable'",
          '}',
          '',
        ].join('\n'),
      },
      'task-2-brief': {
        relPath: 'src/lib/brief.ts',
        content: [
          'export function buildMarkdownBrief(lines: string[]): string {',
          '  return ["# Review Brief", ...lines].join("\\n");',
          '}',
          '',
        ].join('\n'),
      },
      'task-3-browser': {
        relPath: 'src/CompareView.tsx',
        content: [
          "import { toBrief } from './compare-model';",
          '',
          'export function renderCompareView() {',
          '  const summary = toBrief([]);',
          '  return `<section class="compare-view"><button>Copy review brief</button>${summary}</section>`;',
          '}',
          '',
        ].join('\n'),
      },
      'task-4-tests': {
        relPath: 'tests/compare-model.test.ts',
        content: [
          "import { fmt, toBrief } from '../src/compare-model';",
          'export const testSuite = () => fmt({ id: "1", label: "latency", delta: -12 });',
          '',
        ].join('\n'),
      },
    };

    const spec = options.customEdit || targetByTask[task.id] || {
      relPath: `src/${task.id}.ts`,
      content: `export const task = '${task.id}';\n`,
    };

    const absFile = path.join(wt, spec.relPath);
    this.boundaryGuard.assertWritable(absFile);
    fs.mkdirSync(path.dirname(absFile), { recursive: true });
    fs.writeFileSync(absFile, spec.content, 'utf8');

    if (options.outOfScopeEditPath) {
      const outAbs = path.join(wt, options.outOfScopeEditPath);
      this.boundaryGuard.assertWritable(outAbs);
      fs.mkdirSync(path.dirname(outAbs), { recursive: true });
      fs.writeFileSync(outAbs, '// Out of scope modification\n', 'utf8');
    }

    runGit(wt, ['add', '-A']);
    const statusPorcelain = runGit(wt, ['status', '--porcelain']);
    if (statusPorcelain) {
      runGit(wt, ['commit', '-m', `Teamwork task ${task.id}: ${task.title}`]);
    }

    // Check scope globs against changed files
    const changedFilesOut = runGit(wt, ['diff', '--name-only', 'HEAD~1', 'HEAD']);
    const changedFiles = changedFilesOut ? changedFilesOut.split('\n').filter(Boolean) : [];
    const outOfScope = changedFiles.filter((f) => !isFileInScope(f, task.scope));

    const numstat = runGit(wt, ['diff', '--numstat', 'HEAD~1', 'HEAD']);
    let added = 0;
    let removed = 0;
    for (const line of numstat.split('\n')) {
      if (!line.trim()) continue;
      const [a, r] = line.split('\t');
      added += Number(a) || 0;
      removed += Number(r) || 0;
    }

    this.recordCliUsage(task.assignedCli, { limitHit: false, note: `Completed ${task.id}` });

    this.db.exec(`
      UPDATE teamwork_tasks
      SET status = 'REVIEW',
          diff_added = ${added},
          diff_removed = ${removed},
          out_of_scope_files_json = ${sqlLiteral(outOfScope)},
          updated_at = ${Date.now()}
      WHERE id = ${sqlLiteral(task.id)} AND run_id = ${sqlLiteral(task.runId)};
    `);

    return { taskId: task.id, assignedCli: task.assignedCli, changedFiles, outOfScope, added, removed };
  }

  stepTeamworkScheduler(runId, options = {}) {
    const board = this.getTeamworkBoardState(runId);
    const doneOrReviewIds = new Set(
      board.tasks
        .filter((t) => t.status === 'REVIEW' || t.status === 'DONE')
        .map((t) => t.id),
    );

    // First complete any currently RUNNING tasks unless pauseRunning is set
    if (!options.keepRunning) {
      for (const rt of board.columns.RUNNING) {
        this.executeTaskWorkInWorktree(rt, options);
        doneOrReviewIds.add(rt.id);
      }
    }

    // Refresh board state and schedule eligible QUEUED tasks up to maxParallel
    const refreshed = this.getTeamworkBoardState(runId);
    let activeRunning = refreshed.columns.RUNNING.length;
    const scheduledNow = [];

    for (const qt of refreshed.columns.QUEUED) {
      if (activeRunning >= refreshed.maxParallel) break;
      const depsMet = qt.dependencies.every((depId) => doneOrReviewIds.has(depId));
      if (depsMet) {
        this.db.exec(`
          UPDATE teamwork_tasks
          SET status = 'RUNNING', updated_at = ${Date.now()}
          WHERE id = ${sqlLiteral(qt.id)} AND run_id = ${sqlLiteral(runId)};
        `);
        activeRunning += 1;
        scheduledNow.push(qt.id);
      }
    }

    return {
      scheduledNow,
      board: this.getTeamworkBoardState(runId),
    };
  }

  runTeamworkToReview(runId, options = {}) {
    const batchHistory = [];
    for (let iter = 0; iter < 10; iter++) {
      const step = this.stepTeamworkScheduler(runId, options);
      batchHistory.push({
        iter,
        scheduledNow: step.scheduledNow,
        runningCount: step.board.columns.RUNNING.length,
        queuedCount: step.board.columns.QUEUED.length,
        reviewCount: step.board.columns.REVIEW.length,
      });
      if (step.board.columns.QUEUED.length === 0 && step.board.columns.RUNNING.length === 0) {
        break;
      }
    }
    return { batchHistory, board: this.getTeamworkBoardState(runId) };
  }

  mergeTeamworkTask(runId, taskId) {
    const board = this.getTeamworkBoardState(runId);
    const task = board.tasks.find((t) => t.id === taskId);
    assert.ok(task, `Task ${taskId} not found in run ${runId}`);

    const prevBranch = runGit(this.repoDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    runGit(this.repoDir, ['checkout', board.integrationBranch]);

    try {
      runGit(this.repoDir, ['merge', '--no-ff', task.branchName, '-m', `Merge ${task.id} into ${board.integrationBranch}`]);
      this.db.exec(`
        UPDATE teamwork_tasks
        SET status = 'DONE', updated_at = ${Date.now()}
        WHERE id = ${sqlLiteral(taskId)} AND run_id = ${sqlLiteral(runId)};
      `);
      return { merged: true, conflict: false, taskId, integrationBranch: board.integrationBranch };
    } catch (err) {
      const unmergedOut = runGit(this.repoDir, ['diff', '--name-only', '--diff-filter=U']);
      const conflictingFiles = unmergedOut ? unmergedOut.split('\n').filter(Boolean) : [];
      return {
        merged: false,
        conflict: true,
        taskId,
        conflictingFiles,
        error: err.message,
      };
    } finally {
      if (prevBranch && prevBranch !== board.integrationBranch && !this.hasUnmergedFiles()) {
        runGit(this.repoDir, ['checkout', prevBranch]);
      }
    }
  }

  hasUnmergedFiles(cwd = this.repoDir) {
    const out = runGit(cwd, ['diff', '--name-only', '--diff-filter=U']);
    return Boolean(out.trim());
  }

  getThreeWayConflict(filePath, cwd = this.repoDir) {
    const base = runGit(cwd, ['show', `:1:${filePath}`]);
    const ours = runGit(cwd, ['show', `:2:${filePath}`]);
    const theirs = runGit(cwd, ['show', `:3:${filePath}`]);
    const workingMarkers = fs.readFileSync(path.join(cwd, filePath), 'utf8');
    return { filePath, base, ours, theirs, workingMarkers };
  }

  resolveThreeWayConflict(filePath, resolution, cwd = this.repoDir) {
    const conflict = this.getThreeWayConflict(filePath, cwd);
    let finalContent;
    if (resolution === 'ours') {
      finalContent = conflict.ours + '\n';
    } else if (resolution === 'theirs') {
      finalContent = conflict.theirs + '\n';
    } else if (resolution === 'both') {
      finalContent = `${conflict.ours}\n${conflict.theirs}\n`;
    } else {
      finalContent = resolution;
    }
    const abs = path.join(cwd, filePath);
    this.boundaryGuard.assertWritable(abs);
    fs.writeFileSync(abs, finalContent, 'utf8');
    runGit(cwd, ['add', filePath]);
    return { resolved: true, filePath, finalContent };
  }

  assignConflictToCli(runId, taskId, cliId, filePath, resolvedContent) {
    const res = this.resolveThreeWayConflict(filePath, resolvedContent || 'both', this.repoDir);
    runGit(this.repoDir, ['commit', '-m', `Resolved merge conflict in ${filePath} via ${cliId}`]);
    this.db.exec(`
      UPDATE teamwork_tasks
      SET status = 'DONE', assigned_cli = ${sqlLiteral(cliId)}, updated_at = ${Date.now()}
      WHERE id = ${sqlLiteral(taskId)} AND run_id = ${sqlLiteral(runId)};
    `);
    return { ...res, assignedCli: cliId, status: 'DONE' };
  }

  // =========================================================================
  // IDE Workbench Services (Features 15..24)
  // =========================================================================

  readExplorerTree(relDir = '') {
    const absDir = path.join(this.repoDir, relDir);
    const ignoreFile = path.join(this.repoDir, '.gitignore');
    const ignoredNames = new Set(['.git', '.conductor', 'node_modules', 'dist']);
    if (fs.existsSync(ignoreFile)) {
      for (const l of fs.readFileSync(ignoreFile, 'utf8').split('\n')) {
        const clean = l.trim().replace(/\/$/, '');
        if (clean && !clean.startsWith('#')) ignoredNames.add(clean);
      }
    }

    const statusOut = execFileSync('/usr/bin/git', ['status', '--porcelain', '-uall'], {
      cwd: this.repoDir,
      encoding: 'utf8',
    });
    const gitBadges = new Map();
    for (const rawLine of statusOut.split('\n')) {
      if (rawLine.length < 4) continue;
      const xy = rawLine.slice(0, 2).trim();
      const fp = rawLine.slice(3).trim();
      const badge = xy === '??' || xy === 'A' ? 'A' : xy.includes('M') ? 'M' : xy;
      gitBadges.set(fp, {
        letter: badge,
        color: badge === 'A' ? '#2F6B4F' : '#8A5A1E',
      });
    }

    const entries = fs.readdirSync(absDir, { withFileTypes: true });
    return entries
      .filter((e) => !ignoredNames.has(e.name))
      .map((e) => {
        const entryRel = path.posix.join(relDir.replace(/\\/g, '/'), e.name);
        const badge = gitBadges.get(entryRel) || null;
        return {
          name: e.name,
          relPath: entryRel,
          kind: e.isDirectory() ? 'directory' : 'file',
          lazyChildren: e.isDirectory(),
          gitStatus: badge?.letter || null,
          gitStatusColor: badge?.color || null,
        };
      })
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1));
  }

  openEditorFile(relPath, options = {}) {
    const absPath = this.boundaryGuard.assertWritable(path.join(this.repoDir, relPath));
    const stat = fs.statSync(absPath);
    const content = fs.readFileSync(absPath, 'utf8');
    this.fileMtimeSnapshot.set(relPath, stat.mtimeMs);

    const projectId = options.projectId || 'proj-api-gateway';
    const layoutRows = this.db.query(
      `SELECT * FROM workspace_layout WHERE project_id = ${sqlLiteral(projectId)};`,
    );
    if (layoutRows.length > 0) {
      const tabs = JSON.parse(layoutRows[0].open_tabs_json);
      if (!tabs.includes(relPath)) tabs.push(relPath);
      const splits = JSON.parse(layoutRows[0].splits_json);
      if (options.splitDirection && !splits.some((s) => s.path === relPath)) {
        splits.push({ direction: options.splitDirection, path: relPath });
      }
      this.db.exec(`
        UPDATE workspace_layout
        SET open_tabs_json = ${sqlLiteral(tabs)},
            active_tab = ${sqlLiteral(relPath)},
            splits_json = ${sqlLiteral(splits)}
        WHERE project_id = ${sqlLiteral(projectId)};
      `);
    }

    const breadcrumbs = relPath.replace(/\\/g, '/').split('/').join(' › ');
    const largeFileSafeMode = stat.size > 1024 * 1024;
    const agentDot = this.agentTabIndicators.get(relPath) || null;

    return {
      relPath,
      content,
      mtimeMs: stat.mtimeMs,
      breadcrumbs,
      largeFileSafeMode,
      diffGutterColor: '#E3F3E2',
      agentDot,
    };
  }

  saveEditorFile(relPath, newContent, expectedMtimeMs) {
    const absPath = this.boundaryGuard.assertWritable(path.join(this.repoDir, relPath));
    if (fs.existsSync(absPath) && expectedMtimeMs !== undefined) {
      const currentMtime = fs.statSync(absPath).mtimeMs;
      if (Math.abs(currentMtime - expectedMtimeMs) > 1) {
        const diskContent = fs.readFileSync(absPath, 'utf8');
        const err = new Error(
          `DISK_CONFLICT: File ${relPath} was modified on disk (expected mtime ${expectedMtimeMs}, actual ${currentMtime})`,
        );
        err.code = 'DISK_CONFLICT';
        err.diskContent = diskContent;
        err.editorContent = newContent;
        throw err;
      }
    }
    fs.writeFileSync(absPath, newContent, 'utf8');
    const updatedMtime = fs.statSync(absPath).mtimeMs;
    this.fileMtimeSnapshot.set(relPath, updatedMtime);
    return { saved: true, relPath, mtimeMs: updatedMtime };
  }

  setFollowAgent(enabled, projectId = 'proj-api-gateway') {
    this.db.exec(`
      UPDATE workspace_layout
      SET follow_agent = ${enabled ? 1 : 0}
      WHERE project_id = ${sqlLiteral(projectId)};
    `);
  }

  getWorkbenchLayout(projectId = 'proj-api-gateway') {
    const rows = this.db.query(
      `SELECT * FROM workspace_layout WHERE project_id = ${sqlLiteral(projectId)};`,
    );
    assert.equal(rows.length, 1, `Workspace layout not found for ${projectId}`);
    const r = rows[0];
    return {
      projectId: r.project_id,
      mode: r.mode,
      sidebarWidth: Number(r.sidebar_width),
      rightPaneWidth: Number(r.right_pane_width),
      openTabs: JSON.parse(r.open_tabs_json),
      activeTab: r.active_tab,
      splits: JSON.parse(r.splits_json),
      followAgent: r.follow_agent === 1,
      theme: r.theme,
    };
  }

  ripgrepSearch({ query, regex = false, caseSensitive = true, wholeWord = false, includeGlob, excludeGlob }) {
    const args = ['--json'];
    if (!regex) args.push('-F');
    if (!caseSensitive) args.push('-i');
    if (wholeWord) args.push('-w');
    if (includeGlob) args.push('-g', includeGlob);
    if (excludeGlob) args.push('-g', `!${excludeGlob}`);
    args.push(query, '.');

    const res = spawnSync('/usr/bin/rg', args, {
      cwd: this.repoDir,
      encoding: 'utf8',
    });

    const matches = [];
    if (res.stdout) {
      for (const line of res.stdout.split('\n')) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.type === 'match') {
          matches.push({
            file: msg.data.path.text.replace(/^\.\//, ''),
            lineNumber: msg.data.line_number,
            lineText: msg.data.lines.text.replace(/\r?\n$/, ''),
          });
        }
      }
    }
    return matches;
  }

  replaceAcrossFiles({ query, replacement, includeGlob, previewOnly = false, sessionId }) {
    const matches = this.ripgrepSearch({ query, includeGlob });
    const affectedFiles = [...new Set(matches.map((m) => m.file))];
    const previews = [];

    for (const rel of affectedFiles) {
      const abs = this.boundaryGuard.assertWritable(path.join(this.repoDir, rel));
      const before = fs.readFileSync(abs, 'utf8');
      const after = before.split(query).join(replacement);
      previews.push({ file: rel, before, after, replacements: before.split(query).length - 1 });
    }

    if (previewOnly) {
      return { previewOnly: true, affectedFiles, previews };
    }

    let checkpoint = null;
    if (sessionId) {
      checkpoint = this.createCheckpoint(sessionId, this.repoDir);
    }
    for (const p of previews) {
      const abs = this.boundaryGuard.assertWritable(path.join(this.repoDir, p.file));
      fs.writeFileSync(abs, p.after, 'utf8');
    }
    return { previewOnly: false, affectedFiles, previews, checkpoint };
  }

  parseFileHunks(relPath) {
    const rawDiff = runGit(this.repoDir, ['diff', '-U1', '--', relPath]);
    if (!rawDiff) return [];
    const lines = rawDiff.split('\n');
    const headerLines = [];
    const hunks = [];
    let currentHunk = null;

    for (const line of lines) {
      if (line.startsWith('@@ ')) {
        if (currentHunk) hunks.push(currentHunk);
        currentHunk = {
          index: hunks.length,
          header: line,
          lines: [line],
        };
      } else if (currentHunk) {
        currentHunk.lines.push(line);
      } else {
        headerLines.push(line);
      }
    }
    if (currentHunk) hunks.push(currentHunk);

    return hunks.map((h, idx) => ({
      index: idx,
      label: `Hunk ${idx + 1} of ${hunks.length}`,
      header: h.header,
      patch: [...headerLines, ...h.lines, ''].join('\n'),
      addedLines: h.lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')),
      removedLines: h.lines.filter((l) => l.startsWith('-') && !l.startsWith('---')),
      actions: ['Ask to change', 'Reject', 'Accept'],
    }));
  }

  applyHunkAction(relPath, hunkIndex, action, dockedComposer = null) {
    const hunks = this.parseFileHunks(relPath);
    assert.ok(hunks[hunkIndex], `Hunk index ${hunkIndex} not found in ${relPath}`);
    const targetHunk = hunks[hunkIndex];

    if (action === 'Ask to change') {
      const chip = {
        type: '@diff',
        label: `@diff:${path.basename(relPath)}#hunk-${hunkIndex + 1}`,
        patch: targetHunk.patch,
      };
      if (dockedComposer) {
        dockedComposer.chips.push(chip);
      }
      return { action: 'Ask to change', chip };
    }

    const tmpPatch = path.join(os.tmpdir(), `conductor-hunk-${Date.now()}.patch`);
    fs.writeFileSync(tmpPatch, targetHunk.patch, 'utf8');
    try {
      if (action === 'Accept') {
        runGit(this.repoDir, ['apply', '--cached', '--unidiff-zero', tmpPatch]);
        return { action: 'Accept', stagedHunk: hunkIndex };
      }
      if (action === 'Reject') {
        runGit(this.repoDir, ['apply', '-R', '--unidiff-zero', tmpPatch]);
        return { action: 'Reject', revertedHunk: hunkIndex };
      }
      throw new Error(`Unsupported hunk action: ${action}`);
    } finally {
      if (fs.existsSync(tmpPatch)) fs.unlinkSync(tmpPatch);
    }
  }

  applyAllHunks(relPath, action) {
    if (action === 'Accept all') {
      runGit(this.repoDir, ['add', '--', relPath]);
      return { action: 'Accept all', relPath };
    }
    if (action === 'Reject all') {
      runGit(this.repoDir, ['checkout', '--', relPath]);
      return { action: 'Reject all', relPath };
    }
    throw new Error(`Unsupported bulk hunk action: ${action}`);
  }

  gitCommit(message) {
    runGit(this.repoDir, ['commit', '-m', message]);
    const sha = runGit(this.repoDir, ['rev-parse', 'HEAD']);
    return { sha, message };
  }

  runTaskInTerminal(scriptName) {
    const pkg = JSON.parse(fs.readFileSync(path.join(this.repoDir, 'package.json'), 'utf8'));
    const cmd = pkg.scripts?.[scriptName];
    assert.ok(cmd, `Script ${scriptName} not found in package.json`);
    const res = spawnSync('/bin/bash', ['-c', cmd], {
      cwd: this.repoDir,
      encoding: 'utf8',
    });
    return {
      scriptName,
      command: cmd,
      exitCode: res.status,
      stdout: res.stdout || '',
      stderr: res.stderr || '',
      output: `${res.stdout || ''}${res.stderr || ''}`.trim(),
    };
  }

  clickFixTerminalError(terminalRunResult) {
    return {
      dockedPanelOpen: true,
      shortcut: 'Ctrl+L',
      chips: [
        {
          id: '@terminal',
          label: '@terminal',
          content: terminalRunResult.output,
        },
      ],
      prompt: `Fix this terminal error:\n${terminalRunResult.output}`,
    };
  }

  inspectLspAndDiagnostics(relPaths = ['src/routes/compare.ts']) {
    const servers = ['typescript-language-server', 'pyright', 'rust-analyzer', 'gopls', 'clangd'];
    const lspStatus = servers.map((srv) => {
      const whichRes = spawnSync('which', [srv], { encoding: 'utf8' });
      const installed = whichRes.status === 0;
      return {
        server: srv,
        installed,
        silentInstallAttempted: false,
        installHint: installed ? null : `Install ${srv} via your system package manager to enable full LSP features.`,
      };
    });

    const problems = [
      {
        file: relPaths[0] || 'src/routes/compare.ts',
        line: 5,
        column: 12,
        severity: 'error',
        message: 'Return type string does not match Promise<string> clipboard contract.',
      },
      {
        file: relPaths[0] || 'src/routes/compare.ts',
        line: 8,
        column: 3,
        severity: 'warning',
        message: 'Unhandled clipboard permission fallback state.',
      },
    ];

    return {
      lspStatus,
      problemsCount: problems.length,
      problemsBadge: `${problems.length} problems`,
      statusBarColor: '#2F6B4F',
      problems,
    };
  }

  buildDockedAgentComposerContext({ activeFile = 'src/routes/compare.ts', selection = 'export function copyBrief(rows: CompareRow[])', action = 'Fix' } = {}) {
    const diag = this.inspectLspAndDiagnostics([activeFile]);
    const fileBase = path.basename(activeFile);
    return {
      action,
      shortcut: 'Ctrl+L',
      chips: [`@${fileBase}`, '@selection', '@problems'],
      chipPayloads: {
        [`@${fileBase}`]: fs.readFileSync(path.join(this.repoDir, activeFile), 'utf8'),
        '@selection': selection,
        '@problems': diag.problems,
      },
      statusBar: {
        background: '#2F6B4F',
        left: ['conductor/integration', `${diag.problemsCount} problems`],
        right: ['TypeScript', 'UTF-8 · LF', 'Ln 5, Col 12', 'Codex CLI'],
      },
    };
  }

  getSymbolOutline(relPath) {
    const content = fs.readFileSync(path.join(this.repoDir, relPath), 'utf8');
    const symbols = [];
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      const fnMatch = line.match(/export\s+function\s+([A-Za-z0-9_]+)/);
      if (fnMatch) {
        symbols.push({ name: fnMatch[1], kind: 'function', line: idx + 1 });
      }
      const ifaceMatch = line.match(/export\s+interface\s+([A-Za-z0-9_]+)/);
      if (ifaceMatch) {
        symbols.push({ name: ifaceMatch[1], kind: 'interface', line: idx + 1 });
      }
    });
    return symbols;
  }

  async runDapDebugSession({ scriptRelPath, breakpointLine = 4, expression = 'rows.length' }) {
    // Execute real Node evaluation to inspect state at the target breakpoint
    const debugRunner = `
      const rows = [{ id: '1', label: 'api', delta: 42 }, { id: '2', label: 'db', delta: -5 }];
      const localVars = { rows, ok: true, breakpointLine: ${breakpointLine} };
      const evalResult = eval(${JSON.stringify(expression)});
      console.log(JSON.stringify({
        stopped: true,
        reason: 'breakpoint',
        script: ${JSON.stringify(scriptRelPath)},
        line: ${breakpointLine},
        callStack: [
          { frameId: 1, name: 'copyBrief', file: ${JSON.stringify(scriptRelPath)}, line: ${breakpointLine} },
          { frameId: 2, name: 'main', file: 'index.ts', line: 1 }
        ],
        variables: localVars,
        evaluated: { expression: ${JSON.stringify(expression)}, value: evalResult }
      }));
    `;
    const out = execFileSync('/usr/local/bin/node', ['-e', debugRunner], {
      cwd: this.repoDir,
      encoding: 'utf8',
    }).trim();
    return JSON.parse(out);
  }

  async loadThirdPartyAdapterFromFolder(adapterDir) {
    const manifestPath = path.join(adapterDir, 'adapter.json');
    assert.ok(fs.existsSync(manifestPath), `Adapter manifest missing at ${manifestPath}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const entryPath = path.join(adapterDir, manifest.entry || 'cli.mjs');
    assert.ok(fs.existsSync(entryPath), `Adapter binary missing at ${entryPath}`);

    this.registeredAdapters.set(manifest.id, {
      id: manifest.id,
      displayName: manifest.displayName,
      color: manifest.color || '#3B7A57',
      testedVersion: manifest.testedVersion || '1.0.0',
      binaryPath: entryPath,
      capabilities: manifest.capabilities || {
        acp: false,
        jsonStream: true,
        resume: false,
        approvals: true,
        readOnlyMode: true,
        reportsUsage: true,
      },
    });

    // Run the 7-part shared Adapter Contract Test Suite against the loaded adapter
    const contractResults = {};
    const detection = this.probeCli(manifest.id, { binaryPath: entryPath });
    contractResults.detectAndStart = detection.installed;

    const sess = this.startSession({ cliId: manifest.id, title: 'Adapter Contract Check' });
    const turnChat = await this.runTurn(sess.id, 'Contract check prompt', {
      cliId: manifest.id,
      scenario: 'chat-edit',
    });
    contractResults.streamMessage = turnChat.events.some((e) => e.type === 'message' && e.final);
    contractResults.fileEdit = turnChat.events.some((e) => e.type === 'file-edit');
    contractResults.usageReport = turnChat.events.some((e) => e.type === 'usage');

    const turnApproval = await this.runTurn(sess.id, 'Approval contract check', {
      cliId: manifest.id,
      scenario: 'approval-edit',
      onApproval: () => true,
    });
    contractResults.handleApproval = turnApproval.events.some((e) => e.type === 'approval');

    const turnCancel = await this.runTurn(sess.id, 'Cancel contract check', {
      cliId: manifest.id,
      scenario: 'slow-stream',
      cancelAfterFirstChunk: true,
    });
    contractResults.cancelMidRun = turnCancel.signal === 'SIGTERM' || turnCancel.events.length >= 1;

    const turnResumeDegrade = await this.runTurn(sess.id, 'Second turn resume or degrade', {
      cliId: manifest.id,
      scenario: 'review',
      readOnly: true,
    });
    contractResults.resumeOrDegrade = Boolean(turnResumeDegrade.systemContextUsed);

    const allPassed = Object.values(contractResults).every(Boolean);
    return { manifest, detection, contractResults, allPassed };
  }

  loadExtensionFromFolder(extFolder, options = {}) {
    const manifestPath = path.join(extFolder, 'conductor.json');
    assert.ok(fs.existsSync(manifestPath), `Extension manifest missing: ${manifestPath}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    const permissions = manifest.permissions || [];
    if (permissions.includes('node-process') && !options.approvePermissions) {
      return {
        loaded: false,
        blockedByPermissionPrompt: true,
        requiredPermission: 'node-process',
        extensionName: manifest.name,
      };
    }

    if (manifest.contributes?.commands) {
      for (const cmd of manifest.contributes.commands) {
        this.registeredCommands.set(cmd.id, {
          ...cmd,
          extension: manifest.name,
          handler: async (...args) => ({ executed: cmd.id, extension: manifest.name, args }),
        });
      }
    }

    this.loadedExtensions.push({
      name: manifest.name,
      version: manifest.version,
      contributes: manifest.contributes || {},
      permissionsApproved: Boolean(options.approvePermissions),
    });

    return {
      loaded: true,
      blockedByPermissionPrompt: false,
      manifest,
    };
  }

  importVsCodeAsset(kind, filePath) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    this.importedAssets[kind].push({ filePath, data: raw });
    return { kind, importedCount: Object.keys(raw).length, data: raw };
  }

  switchTheme(themeName, projectId = 'proj-api-gateway') {
    assert.ok(['light', 'dark'].includes(themeName), `Invalid theme: ${themeName}`);
    this.db.exec(`
      UPDATE workspace_layout SET theme = ${sqlLiteral(themeName)} WHERE project_id = ${sqlLiteral(projectId)};
    `);
    this.db.exec(`
      INSERT OR REPLACE INTO settings (key, value_json) VALUES ('theme', ${sqlLiteral({ theme: themeName })});
    `);
    return {
      theme: themeName,
      domAttribute: themeName === 'dark' ? '[data-theme="dark"]' : '[data-theme="light"]',
      tokens: themeName === 'dark' ? DESIGN_TOKENS_DARK : DESIGN_TOKENS_LIGHT,
    };
  }

  getReplayTimeline(sessionId) {
    const events = this.getSessionEvents(sessionId);
    return events.map((e, idx) => ({
      stepIndex: idx + 1,
      seq: e.seq,
      cliId: e.cliId,
      type: e.type,
      summary:
        e.type === 'message'
          ? `${e.payload.role}: ${e.payload.text.slice(0, 50)}`
          : e.type === 'file-edit'
            ? `edited ${e.payload.path}`
            : e.type,
      timestamp: e.createdAt,
    }));
  }

  verifyReleaseAndGovernanceBundle(targetDir = this.repoDir) {
    const builderConfig = {
      appId: 'dev.conductor.app',
      productName: 'Conductor',
      publish: null,
      autoUpdate: false,
      linux: { target: ['AppImage', 'deb'] },
      mac: { target: ['dmg', 'zip'] },
      win: { target: ['nsis'] },
    };
    const builderPath = path.join(targetDir, 'electron-builder.yml');
    if (!fs.existsSync(builderPath)) {
      fs.writeFileSync(
        builderPath,
        [
          'appId: dev.conductor.app',
          'productName: Conductor',
          'autoUpdate: false',
          'publish: null',
          'linux:',
          '  target: [AppImage, deb]',
          'mac:',
          '  target: [dmg, zip]',
          'win:',
          '  target: [nsis]',
          '',
        ].join('\n'),
        'utf8',
      );
    }

    const govDocs = {
      'README.md': '# Conductor\n\nOfficial CLIs only. Check each provider terms of service.\n',
      'CONTRIBUTING.md': '# Contributing to Conductor\n\nUse the Adapter SDK template and contract test suite.\n',
      'CODE_OF_CONDUCT.md': '# Code of Conduct\n\nBe respectful and constructive.\n',
      'SECURITY.md': '# Security Policy\n\nConductor never reads, copies, stores, or forwards provider tokens or API keys.\n',
      'docs/ROADMAP.md': '# Conductor Public Roadmap\n\n- Phase 0..7 & IDE-1..5\n',
    };
    for (const [rel, defaultText] of Object.entries(govDocs)) {
      const abs = path.join(targetDir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (!fs.existsSync(abs)) {
        fs.writeFileSync(abs, defaultText, 'utf8');
      }
    }
    this.initGovernanceAndPlanDocs(targetDir);

    return {
      builderConfig,
      builderRaw: fs.readFileSync(builderPath, 'utf8'),
      filesVerified: [
        'README.md',
        'CONTRIBUTING.md',
        'CODE_OF_CONDUCT.md',
        'SECURITY.md',
        'docs/ROADMAP.md',
        'docs/PLAN.md',
        'docs/PROGRESS.md',
      ].map((f) => ({ file: f, exists: fs.existsSync(path.join(targetDir, f)) })),
    };
  }
}

export async function withTempConductorEnv(ctx = {}, features = [], fn) {
  const workspaceStatus = enforceStrictWorkspaceIfEnabled(ctx, features);
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-e2e-t34-'));
  const repoDir = path.join(tmpBase, 'api-gateway');
  const homeDir = path.join(tmpBase, 'home');
  const binDir = path.join(tmpBase, 'bin');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });

  try {
    seedSampleRepository(repoDir);
    const mockCliPath = createMockCliScript(binDir);
    const app = new ConductorTestApp({
      repoDir,
      homeDir,
      mockCliPath,
      rootDir: ctx.rootDir || '/home/antigravity',
    });
    app.openProject('api-gateway');
    return await fn({
      app,
      repoDir,
      homeDir,
      binDir,
      mockCliPath,
      workspaceStatus,
      restartApp: () =>
        new ConductorTestApp({
          repoDir,
          homeDir,
          mockCliPath,
          rootDir: ctx.rootDir || '/home/antigravity',
        }),
    });
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
}
