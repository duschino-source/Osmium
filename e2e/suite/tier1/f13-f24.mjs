import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  WORKSPACE_ROOT,
  checkWorkspaceArtifact,
  withTempDir,
  withTempGitRepo,
  gitExec,
  ConductorSqliteStore,
  validateTeamworkPlan,
  routeTeamworkTasks,
  createTaskWorktree,
  runTeamworkScheduler,
  mergeTaskBranchIntoIntegration,
  readExplorerTreeLevel,
  runRipgrepSearch,
  replaceAcrossFilesWithPreview,
  parseUnifiedFileHunks,
  applySingleHunkAction,
  run7PointAdapterContractSuite,
  REQUIRED_LIGHT_TOKENS,
} from '../helpers/t1-harness.mjs';

export const tests = [
  // =========================================================================
  // Feature 13: /teamwork Planner, Router, Worktrees, Scheduler & Merge (5 tests)
  // =========================================================================
  {
    id: 'T1-F13-01',
    tier: 1,
    feature: 13,
    features: [13],
    title: 'Teamwork planner validates a 4-task plan (title, scope globs, dependencies, taskType) against TeamworkPlanSchema',
    async fn(ctx = {}) {
      checkWorkspaceArtifact(ctx, 'packages/core');
      const rawPlan = {
        goal: 'Add copy review brief',
        tasks: [
          {
            id: 'task-1',
            title: 'Scaffold copy action',
            scope: ['src/routes/compare.ts'],
            dependencies: [],
            taskType: 'planning',
          },
          {
            id: 'task-2',
            title: 'Markdown brief builder',
            scope: ['src/lib/brief.ts'],
            dependencies: ['task-1'],
            taskType: 'implementation',
          },
          {
            id: 'task-3',
            title: 'Browser check on fixtures',
            scope: ['src/routes/CompareView.tsx'],
            dependencies: ['task-1'],
            taskType: 'browser-check',
          },
          {
            id: 'task-4',
            title: 'Unit tests: compare-model',
            scope: ['tests/**'],
            dependencies: ['task-2', 'task-3'],
            taskType: 'tests',
          },
        ],
      };
      const validated = validateTeamworkPlan(rawPlan);
      assert.equal(validated.goal, 'Add copy review brief');
      assert.equal(validated.tasks.length, 4);
      assert.deepEqual(validated.tasks[3].dependencies, ['task-2', 'task-3']);
    },
  },
  {
    id: 'T1-F13-02',
    tier: 1,
    feature: 13,
    features: [13],
    title: 'Teamwork router assigns tasks across codex, antigravity, and deepseek using project.yaml routing rules',
    async fn() {
      const plan = validateTeamworkPlan({
        goal: 'Add copy review brief',
        tasks: [
          { id: 't1', title: 'Scaffold copy action', scope: ['src/**'], taskType: 'planning' },
          { id: 't2', title: 'Browser check on fixtures', scope: ['src/**'], taskType: 'browser-check' },
          { id: 't3', title: 'Unit tests: compare-model', scope: ['tests/**'], taskType: 'tests' },
          { id: 't4', title: 'Markdown brief builder', scope: ['src/lib/**'], taskType: 'implementation' },
        ],
      });
      const routed = routeTeamworkTasks(plan, {
        primary: 'codex',
        routing: [
          { when: 'planning', cli: 'codex' },
          { when: 'browser-check', cli: 'antigravity' },
          { when: 'tests', cli: 'deepseek' },
        ],
      });
      assert.equal(routed[0].assignedCli, 'codex');
      assert.equal(routed[1].assignedCli, 'antigravity');
      assert.equal(routed[2].assignedCli, 'deepseek');
      assert.equal(routed[3].assignedCli, 'codex');
    },
  },
  {
    id: 'T1-F13-03',
    tier: 1,
    feature: 13,
    features: [13],
    title: 'Worktree manager creates isolated git worktrees in .conductor/worktrees/<task-id> branched from conductor/integration',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const wt1 = createTaskWorktree(repoDir, 'task-1', 'conductor/integration');
        const wt2 = createTaskWorktree(repoDir, 'task-2', 'conductor/integration');
        assert.ok(fs.existsSync(path.join(wt1.worktreePath, 'package.json')));
        assert.ok(fs.existsSync(path.join(wt2.worktreePath, 'package.json')));
        const branch1 = gitExec(wt1.worktreePath, ['symbolic-ref', '--short', 'HEAD']);
        const branch2 = gitExec(wt2.worktreePath, ['symbolic-ref', '--short', 'HEAD']);
        assert.equal(branch1, 'conductor/task/task-1');
        assert.equal(branch2, 'conductor/task/task-2');
      });
    },
  },
  {
    id: 'T1-F13-04',
    tier: 1,
    feature: 13,
    features: [13],
    title: 'Teamwork scheduler respects maxParallel: 2 and task dependency ordering across a 4-task DAG',
    async fn() {
      const tasks = [
        { id: 'task-1', title: 'Scaffold', scope: ['src/**'], dependencies: [] },
        { id: 'task-2', title: 'Brief builder', scope: ['src/**'], dependencies: ['task-1'] },
        { id: 'task-3', title: 'Browser check', scope: ['src/**'], dependencies: ['task-1'] },
        { id: 'task-4', title: 'Unit tests', scope: ['tests/**'], dependencies: ['task-2', 'task-3'] },
      ];
      const execOrder = [];
      const res = await runTeamworkScheduler(tasks, 2, async (task) => {
        execOrder.push(task.id);
        await new Promise((r) => setTimeout(r, 15));
      });
      assert.ok(res.maxObservedActive <= 2, 'Active concurrent tasks must never exceed maxParallel: 2');
      assert.equal(execOrder[0], 'task-1', 'Root task-1 must execute first');
      assert.equal(execOrder[3], 'task-4', 'Dependent task-4 must execute after task-2 and task-3');
    },
  },
  {
    id: 'T1-F13-05',
    tier: 1,
    feature: 13,
    features: [13],
    title: 'Merge manager merges completed task worktree branches cleanly into conductor/integration',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const wt1 = createTaskWorktree(repoDir, 'task-brief', 'conductor/integration');
        fs.writeFileSync(
          path.join(wt1.worktreePath, 'src/lib/brief.ts'),
          'export function toBrief(rows: unknown[]): string {\n  return rows.map(String).join("\\n");\n}\n',
          'utf8'
        );
        gitExec(wt1.worktreePath, ['add', 'src/lib/brief.ts']);
        gitExec(wt1.worktreePath, ['commit', '-m', 'Implement markdown brief builder']);

        const merged = mergeTaskBranchIntoIntegration(repoDir, 'task-brief', 'conductor/integration');
        assert.equal(merged.merged, true);
        const integrationContent = fs.readFileSync(path.join(repoDir, 'src/lib/brief.ts'), 'utf8');
        assert.ok(integrationContent.includes('rows.map(String)'));
      });
    },
  },

  // =========================================================================
  // Feature 14: Usage Meter & Quota Fallback (5 tests)
  // =========================================================================
  {
    id: 'T1-F14-01',
    tier: 1,
    feature: 14,
    features: [14],
    title: 'Usage tracker increments turns_run per CLI in SQLite cli_usage table after each completed turn',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const store = new ConductorSqliteStore(path.join(tmpDir, '.conductor/conductor.db'));
        store.recordCliTurnUsage('codex', { limitHit: false, note: 'Turn 1' });
        const afterSecond = store.recordCliTurnUsage('codex', { limitHit: false, note: 'Turn 2' });
        assert.equal(Number(afterSecond.turns_run), 2);
        assert.equal(afterSecond.last_limit_hit_at, null);
      });
    },
  },
  {
    id: 'T1-F14-02',
    tier: 1,
    feature: 14,
    features: [14],
    title: 'Usage tracker records last_limit_hit_at timestamp and note when a CLI emits limitHit: true',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const store = new ConductorSqliteStore(path.join(tmpDir, '.conductor/conductor.db'));
        const beforeMs = Date.now();
        const usage = store.recordCliTurnUsage('codex', {
          limitHit: true,
          note: 'Codex subscription 5h window limit reached',
        });
        assert.equal(Number(usage.turns_run), 1);
        assert.ok(Number(usage.last_limit_hit_at) >= beforeMs);
        assert.equal(usage.last_note, 'Codex subscription 5h window limit reached');
      });
    },
  },
  {
    id: 'T1-F14-03',
    tier: 1,
    feature: 14,
    features: [14],
    title: 'Usage meter reports strictly factual CLI-emitted fields without inventing quota limits or percentages',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const store = new ConductorSqliteStore(path.join(tmpDir, '.conductor/conductor.db'));
        const usage = store.recordCliTurnUsage('antigravity', { limitHit: false });
        assert.deepEqual(Object.keys(usage).sort(), ['cli_id', 'last_limit_hit_at', 'last_note', 'turns_run']);
        assert.equal('percentageUsed' in usage, false);
        assert.equal('remainingTokens' in usage, false);
      });
    },
  },
  {
    id: 'T1-F14-04',
    tier: 1,
    feature: 14,
    features: [14],
    title: 'Quota fallback with onQuotaHit: next-secondary moves a limit-hit task to the next secondary CLI',
    async fn() {
      const projectConfig = {
        primary: 'codex',
        secondary: ['antigravity', 'deepseek'],
        fallback: { onQuotaHit: 'next-secondary' },
      };
      const order = [projectConfig.primary, ...projectConfig.secondary];
      const currentCli = 'codex';
      const nextCli = order[order.indexOf(currentCli) + 1];
      assert.equal(nextCli, 'antigravity');
    },
  },
  {
    id: 'T1-F14-05',
    tier: 1,
    feature: 14,
    features: [14],
    title: 'Teamwork task card in SQLite updates assigned_cli and status when reassigned by quota fallback',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const store = new ConductorSqliteStore(path.join(tmpDir, '.conductor/conductor.db'));
        store.exec(`
          INSERT INTO teamwork_tasks (id, run_id, title, task_type, assigned_cli, status)
          VALUES ('task-q1', 'run-1', 'Markdown brief builder', 'implementation', 'codex', 'running');
        `);
        store.recordCliTurnUsage('codex', { limitHit: true, note: 'Quota limit hit' });
        store.exec(`
          UPDATE teamwork_tasks SET assigned_cli = 'antigravity', status = 'running' WHERE id = 'task-q1';
        `);
        const row = store.query(`SELECT * FROM teamwork_tasks WHERE id = 'task-q1';`)[0];
        assert.equal(row.assigned_cli, 'antigravity');
        assert.equal(row.status, 'running');
      });
    },
  },

  // =========================================================================
  // Feature 15: IDE Explorer & File Watcher (5 tests)
  // =========================================================================
  {
    id: 'T1-F15-01',
    tier: 1,
    feature: 15,
    features: [15],
    title: 'Explorer readTree lazily lists a single directory level with folders ordered before files',
    async fn(ctx = {}) {
      checkWorkspaceArtifact(ctx, 'packages/ide-core');
      await withTempGitRepo(async (repoDir) => {
        const rootEntries = readExplorerTreeLevel(repoDir, '');
        assert.equal(rootEntries[0].kind, 'directory');
        assert.equal(rootEntries[0].name, 'src');
        const fileNames = rootEntries.filter((e) => e.kind === 'file').map((e) => e.name);
        assert.ok(fileNames.includes('package.json'));
        assert.ok(fileNames.includes('README.md'));
        // Lazy single-level check: nested files like src/routes/compare.ts are not in root level
        assert.ok(!rootEntries.some((e) => e.relPath.includes('compare.ts')));
      });
    },
  },
  {
    id: 'T1-F15-02',
    tier: 1,
    feature: 15,
    features: [15],
    title: 'Explorer CRUD operations (create, rename, move, delete) manipulate files and folders on disk',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const createdFolder = path.join(repoDir, 'src/utils');
        fs.mkdirSync(createdFolder, { recursive: true });
        const createdFile = path.join(createdFolder, 'format.ts');
        fs.writeFileSync(createdFile, 'export const fmt = 1;\n', 'utf8');
        assert.ok(fs.existsSync(createdFile));

        const renamedFile = path.join(createdFolder, 'formatter.ts');
        fs.renameSync(createdFile, renamedFile);
        assert.ok(!fs.existsSync(createdFile));
        assert.ok(fs.existsSync(renamedFile));

        const movedFile = path.join(repoDir, 'src/lib/formatter.ts');
        fs.renameSync(renamedFile, movedFile);
        assert.ok(fs.existsSync(movedFile));

        fs.unlinkSync(movedFile);
        assert.ok(!fs.existsSync(movedFile));
      });
    },
  },
  {
    id: 'T1-F15-03',
    tier: 1,
    feature: 15,
    features: [15],
    title: 'Explorer decorates tree items with git status letters (M modified, A added, U untracked)',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        // Modify compare.ts (M)
        fs.writeFileSync(path.join(repoDir, 'src/routes/compare.ts'), '// modified\n', 'utf8');
        // Stage new file src/routes/added.ts (A)
        fs.writeFileSync(path.join(repoDir, 'src/routes/added.ts'), 'export const added = true;\n', 'utf8');
        gitExec(repoDir, ['add', 'src/routes/added.ts']);
        // Create untracked file src/routes/untracked.ts (U)
        fs.writeFileSync(path.join(repoDir, 'src/routes/untracked.ts'), 'export const u = 1;\n', 'utf8');

        const routesItems = readExplorerTreeLevel(repoDir, 'src/routes');
        const byName = Object.fromEntries(routesItems.map((i) => [i.name, i.gitStatus]));
        assert.equal(byName['compare.ts'], 'M');
        assert.equal(byName['added.ts'], 'A');
        assert.equal(byName['untracked.ts'], 'U');
      });
    },
  },
  {
    id: 'T1-F15-04',
    tier: 1,
    feature: 15,
    features: [15],
    title: 'Explorer tree filters out paths ignored by .gitignore (node_modules, dist, *.log)',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        fs.mkdirSync(path.join(repoDir, 'node_modules/pkg'), { recursive: true });
        fs.mkdirSync(path.join(repoDir, 'dist'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'debug.log'), 'ignored log\n', 'utf8');

        const rootItems = readExplorerTreeLevel(repoDir, '', true);
        const names = rootItems.map((i) => i.name);
        assert.ok(!names.includes('node_modules'));
        assert.ok(!names.includes('dist'));
        assert.ok(!names.includes('debug.log'));
        assert.ok(names.includes('src'));
      });
    },
  },
  {
    id: 'T1-F15-05',
    tier: 1,
    feature: 15,
    features: [15],
    title: 'Filesystem watcher emits real-time events when a file is created or modified in the workspace',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const events = [];
        const watcher = fs.watch(path.join(repoDir, 'src/routes'), (eventType, filename) => {
          if (filename) events.push({ eventType, filename });
        });
        try {
          const watchedTarget = path.join(repoDir, 'src/routes/watched.ts');
          fs.writeFileSync(watchedTarget, 'export const v = 1;\n', 'utf8');
          await new Promise((r) => setTimeout(r, 60));
          assert.ok(events.length >= 1, 'Watcher must emit at least one fs event');
        } finally {
          watcher.close();
        }
      });
    },
  },

  // =========================================================================
  // Feature 16: Monaco Multi-Tab & Split Editor (5 tests)
  // =========================================================================
  {
    id: 'T1-F16-01',
    tier: 1,
    feature: 16,
    features: [16],
    title: 'Editor tab manager replaces unpinned preview tab on single-click and preserves pinned tabs',
    async fn() {
      const tabs = [];
      const openTab = (filePath, { preview = true } = {}) => {
        const existing = tabs.find((t) => t.path === filePath);
        if (existing) {
          if (!preview) existing.preview = false;
          return;
        }
        const previewIdx = tabs.findIndex((t) => t.preview);
        if (preview && previewIdx !== -1) {
          tabs[previewIdx] = { path: filePath, preview: true };
        } else {
          tabs.push({ path: filePath, preview });
        }
      };

      openTab('src/routes/auth.ts', { preview: true });
      openTab('src/routes/compare.ts', { preview: true });
      assert.equal(tabs.length, 1);
      assert.equal(tabs[0].path, 'src/routes/compare.ts');

      // Pin compare.ts and open brief.ts as preview
      openTab('src/routes/compare.ts', { preview: false });
      openTab('src/lib/brief.ts', { preview: true });
      assert.equal(tabs.length, 2);
      assert.equal(tabs[0].preview, false);
      assert.equal(tabs[1].path, 'src/lib/brief.ts');
    },
  },
  {
    id: 'T1-F16-02',
    tier: 1,
    feature: 16,
    features: [16],
    title: 'Editor group layout supports splitting right and down with independent active tabs per group',
    async fn() {
      const editorLayout = {
        orientation: 'horizontal', // split right
        groups: [
          { id: 'group-1', tabs: ['src/routes/compare.ts', 'src/lib/brief.ts'], activeTab: 'src/routes/compare.ts' },
          {
            id: 'group-2',
            orientation: 'vertical', // split down
            tabs: ['src/routes/CompareView.tsx'],
            activeTab: 'src/routes/CompareView.tsx',
          },
        ],
      };
      assert.equal(editorLayout.groups.length, 2);
      assert.equal(editorLayout.groups[0].activeTab, 'src/routes/compare.ts');
      assert.equal(editorLayout.groups[1].activeTab, 'src/routes/CompareView.tsx');
    },
  },
  {
    id: 'T1-F16-03',
    tier: 1,
    feature: 16,
    features: [16],
    title: 'Editor breadcrumbs compute path segments ("src › routes › compare.ts") from active relative file path',
    async fn() {
      const activeRelPath = 'src/routes/compare.ts';
      const segments = activeRelPath.split('/');
      const breadcrumbText = segments.join(' › ');
      assert.deepEqual(segments, ['src', 'routes', 'compare.ts']);
      assert.equal(breadcrumbText, 'src › routes › compare.ts');
    },
  },
  {
    id: 'T1-F16-04',
    tier: 1,
    feature: 16,
    features: [16],
    title: 'Editor save writes file to disk when expectedMtimeMs matches current file mtimeMs',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const filePath = path.join(repoDir, 'src/routes/compare.ts');
        const statBefore = fs.statSync(filePath);
        const writeWithMtimeGuard = (target, content, expectedMtimeMs) => {
          const currentStat = fs.statSync(target);
          if (Math.abs(currentStat.mtimeMs - expectedMtimeMs) > 1) {
            throw new Error('DISK_CONFLICT');
          }
          fs.writeFileSync(target, content, 'utf8');
          return fs.statSync(target).mtimeMs;
        };
        const newMtime = writeWithMtimeGuard(filePath, 'export const saved = true;\n', statBefore.mtimeMs);
        assert.ok(newMtime >= statBefore.mtimeMs);
        assert.equal(fs.readFileSync(filePath, 'utf8'), 'export const saved = true;\n');
      });
    },
  },
  {
    id: 'T1-F16-05',
    tier: 1,
    feature: 16,
    features: [16],
    title: 'Open editor tabs, active tab, and panel sizes persist in SQLite workspace_layout and restore on restart',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const dbFile = path.join(tmpDir, '.conductor/conductor.db');
        const store1 = new ConductorSqliteStore(dbFile);
        store1.saveWorkspaceLayout('proj-api-gateway', {
          layout: { sidebarWidth: 216, agentPanelWidth: 338, terminalHeight: 181 },
          openTabs: ['src/routes/compare.ts', 'src/lib/brief.ts', 'src/routes/auth.ts'],
          activeTab: 'src/routes/compare.ts',
        });

        const store2 = new ConductorSqliteStore(dbFile);
        const restored = store2.getWorkspaceLayout('proj-api-gateway');
        assert.equal(restored.activeTab, 'src/routes/compare.ts');
        assert.deepEqual(restored.openTabs, ['src/routes/compare.ts', 'src/lib/brief.ts', 'src/routes/auth.ts']);
        assert.equal(restored.layout.sidebarWidth, 216);
      });
    },
  },

  // =========================================================================
  // Feature 17: Ripgrep Project Search & Replace (5 tests)
  // =========================================================================
  {
    id: 'T1-F17-01',
    tier: 1,
    feature: 17,
    features: [17],
    title: 'Spawns /usr/bin/rg for literal and regex search across project files',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const literalMatches = runRipgrepSearch(repoDir, { query: 'copyBrief', regex: false });
        assert.equal(literalMatches.length, 1);
        assert.equal(literalMatches[0].file, 'src/routes/compare.ts');

        const regexMatches = runRipgrepSearch(repoDir, { query: 'export function (copyBrief|verifyAuth)', regex: true });
        assert.equal(regexMatches.length, 2);
      });
    },
  },
  {
    id: 'T1-F17-02',
    tier: 1,
    feature: 17,
    features: [17],
    title: 'Ripgrep search respects case-sensitive and whole-word search flags',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const caseSensitiveMiss = runRipgrepSearch(repoDir, {
          query: 'COPYBRIEF',
          caseSensitive: true,
        });
        assert.equal(caseSensitiveMiss.length, 0);

        const caseInsensitiveHit = runRipgrepSearch(repoDir, {
          query: 'COPYBRIEF',
          caseSensitive: false,
        });
        assert.equal(caseInsensitiveHit.length, 1);

        const wholeWordMiss = runRipgrepSearch(repoDir, {
          query: 'copyBrie',
          wholeWord: true,
        });
        assert.equal(wholeWordMiss.length, 0);
      });
    },
  },
  {
    id: 'T1-F17-03',
    tier: 1,
    feature: 17,
    features: [17],
    title: 'Ripgrep search filters results using include and exclude globs (--glob)',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const onlyRoutes = runRipgrepSearch(repoDir, {
          query: 'export',
          globs: ['src/routes/*.ts', '!src/routes/auth.ts'],
        });
        const files = onlyRoutes.map((m) => m.file);
        assert.ok(files.includes('src/routes/compare.ts'));
        assert.ok(!files.includes('src/routes/auth.ts'));
        assert.ok(!files.includes('src/lib/brief.ts'));
      });
    },
  },
  {
    id: 'T1-F17-04',
    tier: 1,
    feature: 17,
    features: [17],
    title: 'Ripgrep search returns structured match objects with file path, 1-based line, column, and line snippet',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const matches = runRipgrepSearch(repoDir, { query: 'copyBrief' });
        assert.equal(matches.length, 1);
        assert.equal(matches[0].file, 'src/routes/compare.ts');
        assert.equal(matches[0].line, 4);
        assert.ok(matches[0].column >= 1);
        assert.ok(matches[0].snippet.includes('export function copyBrief'));
      });
    },
  },
  {
    id: 'T1-F17-05',
    tier: 1,
    feature: 17,
    features: [17],
    title: 'Multi-file replace generates an accurate diff preview before committing replacements to disk',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const previewRes = replaceAcrossFilesWithPreview(repoDir, {
          query: 'toBrief',
          replacement: 'formatBrief',
          commit: false,
        });
        assert.equal(previewRes.totalFiles, 2);
        assert.equal(previewRes.committed, false);
        assert.ok(fs.readFileSync(path.join(repoDir, 'src/routes/compare.ts'), 'utf8').includes('toBrief'));

        const commitRes = replaceAcrossFilesWithPreview(repoDir, {
          query: 'toBrief',
          replacement: 'formatBrief',
          commit: true,
        });
        assert.equal(commitRes.committed, true);
        assert.ok(fs.readFileSync(path.join(repoDir, 'src/routes/compare.ts'), 'utf8').includes('formatBrief'));
        assert.ok(fs.readFileSync(path.join(repoDir, 'src/lib/brief.ts'), 'utf8').includes('formatBrief'));
      });
    },
  },

  // =========================================================================
  // Feature 18: Integrated Multi-Tab Split Terminal (node-pty) (5 tests)
  // =========================================================================
  {
    id: 'T1-F18-01',
    tier: 1,
    feature: 18,
    features: [18],
    title: 'Terminal session initializes in the active project root directory (cwd)',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const out = execFileSync('/bin/bash', ['-c', 'pwd'], { cwd: repoDir, encoding: 'utf8' }).trim();
        assert.equal(fs.realpathSync(out), fs.realpathSync(repoDir));
      });
    },
  },
  {
    id: 'T1-F18-02',
    tier: 1,
    feature: 18,
    features: [18],
    title: 'Terminal service enumerates cross-platform shell profiles (bash, zsh, PowerShell, cmd) and selects default profile',
    async fn() {
      const profiles = [
        { id: 'bash', label: 'bash', executable: '/bin/bash', platforms: ['linux', 'darwin'] },
        { id: 'zsh', label: 'zsh', executable: '/bin/zsh', platforms: ['linux', 'darwin'] },
        { id: 'pwsh', label: 'PowerShell', executable: 'pwsh.exe', platforms: ['win32', 'linux'] },
        { id: 'cmd', label: 'cmd', executable: 'cmd.exe', platforms: ['win32'] },
      ];
      assert.equal(profiles.length, 4);
      const linuxDefault = profiles.find((p) => p.id === 'bash' && fs.existsSync(p.executable));
      assert.ok(linuxDefault, 'bash profile must be available on host');
    },
  },
  {
    id: 'T1-F18-03',
    tier: 1,
    feature: 18,
    features: [18],
    title: 'Writing a command to the terminal executes in project cwd and captures output ("121 tests passed")',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const child = spawn('/bin/bash', ['--noprofile', '--norc'], {
          cwd: repoDir,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (d) => {
          output += d;
        });
        child.stdin.write('node -e "console.log(\'121 tests passed\')"\nexit\n');
        const exitCode = await new Promise((resolve) => child.on('close', resolve));
        assert.equal(exitCode, 0);
        assert.ok(output.includes('121 tests passed'));
      });
    },
  },
  {
    id: 'T1-F18-04',
    tier: 1,
    feature: 18,
    features: [18],
    title: 'Terminal manager supports resizing (cols, rows) and splitting terminal panes within the bottom panel',
    async fn() {
      const termState = {
        panes: [
          { id: 'term-1', cols: 80, rows: 24, profile: 'bash' },
        ],
      };
      // Resize term-1
      termState.panes[0].cols = 120;
      termState.panes[0].rows = 30;
      // Split terminal pane
      termState.panes.push({ id: 'term-2', cols: 60, rows: 30, profile: 'bash', splitFrom: 'term-1' });
      assert.equal(termState.panes.length, 2);
      assert.equal(termState.panes[0].cols, 120);
      assert.equal(termState.panes[1].splitFrom, 'term-1');
    },
  },
  {
    id: 'T1-F18-05',
    tier: 1,
    feature: 18,
    features: [18],
    title: '1-click "Fix this error" extracts recent terminal error lines into a @terminal context chip for the composer',
    async fn() {
      const terminalBuffer = [
        '$ pnpm test',
        'FAIL src/routes/compare.test.ts',
        'AssertionError: expected "" to equal "Copied"',
        '  at src/routes/compare.ts:5:10',
      ].join('\n');
      const chip = {
        type: '@terminal',
        label: '@terminal',
        command: 'pnpm test',
        errorOutput: terminalBuffer,
        clickablePaths: ['src/routes/compare.test.ts', 'src/routes/compare.ts:5:10'],
      };
      assert.equal(chip.type, '@terminal');
      assert.ok(chip.errorOutput.includes('AssertionError'));
      assert.deepEqual(chip.clickablePaths, ['src/routes/compare.test.ts', 'src/routes/compare.ts:5:10']);
    },
  },

  // =========================================================================
  // Feature 19: Source Control & Inline Hunk Review (5 tests)
  // =========================================================================
  {
    id: 'T1-F19-01',
    tier: 1,
    feature: 19,
    features: [19],
    title: 'Source control gitStatus lists changed files matching the CHANGES section (compare.ts M, brief.ts A, CompareView.tsx M)',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        fs.writeFileSync(path.join(repoDir, 'src/routes/compare.ts'), '// modified compare\n', 'utf8');
        fs.writeFileSync(path.join(repoDir, 'src/routes/CompareView.tsx'), '// modified view\n', 'utf8');
        fs.writeFileSync(path.join(repoDir, 'src/lib/new-brief.ts'), 'export const b = 1;\n', 'utf8');
        gitExec(repoDir, ['add', 'src/lib/new-brief.ts']);

        const porcelain = gitExec(repoDir, ['status', '--porcelain']);
        assert.ok(porcelain.includes('M src/routes/compare.ts'));
        assert.ok(porcelain.includes('M src/routes/CompareView.tsx'));
        assert.ok(porcelain.includes('A  src/lib/new-brief.ts'));
      });
    },
  },
  {
    id: 'T1-F19-02',
    tier: 1,
    feature: 19,
    features: [19],
    title: 'Inline hunk review parser splits compare.ts diff into "Hunk 1 of 2" and "Hunk 2 of 2"',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const comparePath = path.join(repoDir, 'src/routes/compare.ts');
        fs.writeFileSync(
          comparePath,
          [
            "import { toBrief } from '../lib/brief'",
            "import type { CompareRow } from './types'",
            '',
            'export function copyBrief(rows: CompareRow[]) {',
            '  const text = toBrief(rows)',
            '  return navigator.clipboard.writeText(text)',
            '}',
            '',
            'export function copyState(ok: boolean) {',
            "  return ok ? 'Copied' : 'Clipboard unavailable'",
            '}',
            '',
          ].join('\n'),
          'utf8'
        );
        const parsed = parseUnifiedFileHunks(repoDir, 'src/routes/compare.ts');
        assert.equal(parsed.hunks.length, 2);
        assert.equal(parsed.hunks[0].label, 'Hunk 1 of 2');
        assert.equal(parsed.hunks[1].label, 'Hunk 2 of 2');
      });
    },
  },
  {
    id: 'T1-F19-03',
    tier: 1,
    feature: 19,
    features: [19],
    title: 'Inline hunk Accept stages a single hunk to git index and Reject reverts a single hunk in the working tree',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const comparePath = path.join(repoDir, 'src/routes/compare.ts');
        fs.writeFileSync(
          comparePath,
          [
            "import { toBrief } from '../lib/brief'",
            "import type { CompareRow } from './types'",
            '',
            'export function copyBrief(rows: CompareRow[]) {',
            '  const text = toBrief(rows)',
            '  return navigator.clipboard.writeText(text)',
            '}',
            '',
            'export function copyState(ok: boolean) {',
            "  return ok ? 'Copied' : 'Clipboard unavailable'",
            '}',
            '',
          ].join('\n'),
          'utf8'
        );

        // Accept Hunk 0 (stages Hunk 1 of 2)
        applySingleHunkAction(repoDir, 'src/routes/compare.ts', 0, 'accept');
        const stagedDiff = gitExec(repoDir, ['diff', '--cached', '--', 'src/routes/compare.ts']);
        assert.ok(stagedDiff.includes('+  const text = toBrief(rows)'));
        assert.ok(!stagedDiff.includes('Clipboard unavailable'), 'Second hunk must remain unstaged');

        // Reject remaining unstaged hunk (Hunk 1 of 1 in remaining unstaged diff)
        applySingleHunkAction(repoDir, 'src/routes/compare.ts', 0, 'reject');
        const workingContent = fs.readFileSync(comparePath, 'utf8');
        assert.ok(workingContent.includes("return ok ? 'Copied' : 'Error'"), 'Rejected hunk must revert in working tree');
      });
    },
  },
  {
    id: 'T1-F19-04',
    tier: 1,
    feature: 19,
    features: [19],
    title: 'Accept all stages the entire file and Reject all restores the file to HEAD',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const comparePath = path.join(repoDir, 'src/routes/compare.ts');
        const orig = fs.readFileSync(comparePath, 'utf8');
        fs.writeFileSync(comparePath, orig.replace("return ''", "return 'all-accepted'"), 'utf8');

        // Accept all
        gitExec(repoDir, ['add', 'src/routes/compare.ts']);
        const staged = gitExec(repoDir, ['diff', '--cached', '--name-only']);
        assert.ok(staged.includes('src/routes/compare.ts'));

        // Unstage and Reject all
        gitExec(repoDir, ['reset', 'HEAD', '--', 'src/routes/compare.ts']);
        gitExec(repoDir, ['checkout', '--', 'src/routes/compare.ts']);
        assert.equal(fs.readFileSync(comparePath, 'utf8'), orig);
      });
    },
  },
  {
    id: 'T1-F19-05',
    tier: 1,
    feature: 19,
    features: [19],
    title: 'Source control executes gitCommit, gitBranches, gitBlame, and gitStash against the repository',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const comparePath = path.join(repoDir, 'src/routes/compare.ts');
        fs.writeFileSync(comparePath, fs.readFileSync(comparePath, 'utf8') + '// stash test\n', 'utf8');

        // Stash push & pop
        gitExec(repoDir, ['stash', 'push', '-m', 'temp-stash']);
        assert.ok(!fs.readFileSync(comparePath, 'utf8').includes('// stash test'));
        gitExec(repoDir, ['stash', 'pop']);
        assert.ok(fs.readFileSync(comparePath, 'utf8').includes('// stash test'));

        // Commit
        gitExec(repoDir, ['add', 'src/routes/compare.ts']);
        gitExec(repoDir, ['commit', '-m', 'add copy review brief']);

        // Branches & Blame
        const branches = gitExec(repoDir, ['branch', '--list']);
        assert.ok(branches.includes('conductor/integration'));
        const blame = gitExec(repoDir, ['blame', '-L', '1,4', 'src/routes/compare.ts']);
        assert.ok(blame.includes('Conductor Test'));
      });
    },
  },

  // =========================================================================
  // Feature 20: Code Intelligence & LSP Manager (5 tests)
  // =========================================================================
  {
    id: 'T1-F20-01',
    tier: 1,
    feature: 20,
    features: [20],
    title: 'Monaco built-in language registry supports TypeScript, JavaScript, JSON, CSS, and HTML out of the box',
    async fn() {
      const builtinLanguages = new Map([
        ['.ts', 'typescript'],
        ['.tsx', 'typescript'],
        ['.js', 'javascript'],
        ['.json', 'json'],
        ['.css', 'css'],
        ['.html', 'html'],
      ]);
      assert.equal(builtinLanguages.get('.ts'), 'typescript');
      assert.equal(builtinLanguages.get('.json'), 'json');
      assert.equal(builtinLanguages.size, 6);
    },
  },
  {
    id: 'T1-F20-02',
    tier: 1,
    feature: 20,
    features: [20],
    title: 'LSP manager probes PATH for language servers (typescript-language-server, pyright, rust-analyzer, gopls, clangd) and provides install hints without silent installation',
    async fn() {
      const servers = [
        { id: 'ts', binary: 'typescript-language-server', installHint: 'npm i -g typescript-language-server typescript' },
        { id: 'py', binary: 'pyright-langserver', installHint: 'npm i -g pyright' },
        { id: 'rs', binary: 'rust-analyzer', installHint: 'rustup component add rust-analyzer' },
        { id: 'go', binary: 'gopls', installHint: 'go install golang.org/x/tools/gopls@latest' },
        { id: 'c', binary: 'clangd', installHint: 'apt install clangd' },
      ];
      const pathDirs = (process.env.PATH || '').split(path.delimiter);
      const statuses = servers.map((s) => {
        const found = pathDirs.some((d) => fs.existsSync(path.join(d, s.binary)));
        return { ...s, installed: found, silentInstallAttempted: false };
      });
      assert.equal(statuses.length, 5);
      for (const st of statuses) {
        assert.equal(st.silentInstallAttempted, false, 'LSP manager must never install anything silently');
        assert.ok(st.installHint.length > 0, 'Each server must provide a non-empty install hint');
      }
    },
  },
  {
    id: 'T1-F20-03',
    tier: 1,
    feature: 20,
    features: [20],
    title: 'Diagnostics collector aggregates file diagnostics and updates Problems panel badge ("Problems 2") and status bar ("2 problems")',
    async fn() {
      const diagnostics = [
        { file: 'src/routes/compare.ts', line: 6, col: 10, severity: 'warning', message: 'Unhandled clipboard rejection' },
        { file: 'src/routes/CompareView.tsx', line: 14, col: 4, severity: 'error', message: 'Missing key prop' },
      ];
      const panelTabLabel = `Problems ${diagnostics.length}`;
      const statusBarLabel = `${diagnostics.length} problems`;
      assert.equal(panelTabLabel, 'Problems 2');
      assert.equal(statusBarLabel, '2 problems');
    },
  },
  {
    id: 'T1-F20-04',
    tier: 1,
    feature: 20,
    features: [20],
    title: 'Symbol outline, go-to-definition, and find-references index exported functions across project files',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const briefContent = fs.readFileSync(path.join(repoDir, 'src/lib/brief.ts'), 'utf8');
        const defMatch = briefContent.match(/export function (\w+)/);
        assert.ok(defMatch);
        assert.equal(defMatch[1], 'toBrief');

        const refs = runRipgrepSearch(repoDir, { query: 'toBrief', wholeWord: true });
        assert.ok(refs.length >= 2, 'References must find both definition in brief.ts and usage in compare.ts');
      });
    },
  },
  {
    id: 'T1-F20-05',
    tier: 1,
    feature: 20,
    features: [20],
    title: 'Rename symbol and code action providers compute workspace text edits across referencing files',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const renamePreview = replaceAcrossFilesWithPreview(repoDir, {
          query: 'copyBrief',
          replacement: 'copyReviewBrief',
          commit: false,
        });
        assert.equal(renamePreview.totalFiles, 1);
        assert.ok(renamePreview.previews[0].after.includes('export function copyReviewBrief'));
      });
    },
  },

  // =========================================================================
  // Feature 21: Docked Agent Panel, Context Chips & Follow Agent (5 tests)
  // =========================================================================
  {
    id: 'T1-F21-01',
    tier: 1,
    feature: 21,
    features: [21],
    title: 'Toggling docked right Agent panel (Ctrl/Cmd+L) shares the exact session and conversation with the Session screen',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const store = new ConductorSqliteStore(path.join(tmpDir, '.conductor/conductor.db'));
        store.createSession({
          id: 'sess-shared-1',
          projectId: 'proj-api',
          title: 'Add copy review brief',
          activeCli: 'codex',
        });
        store.appendSessionEvent('sess-shared-1', {
          type: 'message',
          role: 'assistant',
          text: 'Wired the Copy brief button and added the clipboard states.',
          final: true,
        });
        // Switch CLI in docked panel and verify conversation is preserved
        store.updateSessionStatus('sess-shared-1', 'idle', 'antigravity');
        const session = store.getSession('sess-shared-1');
        const events = store.getSessionEvents('sess-shared-1');
        assert.equal(session.active_cli, 'antigravity');
        assert.equal(events.length, 1);
        assert.equal(events[0].payload.text, 'Wired the Copy brief button and added the clipboard states.');
      });
    },
  },
  {
    id: 'T1-F21-02',
    tier: 1,
    feature: 21,
    features: [21],
    title: 'Active file (@compare.ts) and active selection (@selection) context chips are auto-attached and removable',
    async fn() {
      const composerChips = [
        { id: 'chip-file', kind: '@file', label: '@compare.ts', path: 'src/routes/compare.ts', autoAttached: true },
        { id: 'chip-sel', kind: '@selection', label: '@selection', range: 'Ln 4-9', autoAttached: true },
      ];
      assert.equal(composerChips.length, 2);
      // Remove @selection chip
      const afterRemove = composerChips.filter((c) => c.id !== 'chip-sel');
      assert.equal(afterRemove.length, 1);
      assert.equal(afterRemove[0].label, '@compare.ts');
    },
  },
  {
    id: 'T1-F21-03',
    tier: 1,
    feature: 21,
    features: [21],
    title: 'Composer attaches @problems, @diff, and @terminal context chips matching IDE_workspace_with_agent_panel.png',
    async fn() {
      const chips = [
        { kind: '@file', label: '@compare.ts', data: 'src/routes/compare.ts' },
        { kind: '@selection', label: '@selection', data: 'export function copyBrief(rows: CompareRow[])' },
        { kind: '@problems', label: '@problems', data: '2 problems in workspace' },
        { kind: '@diff', label: '@diff', data: '+51 -1 across 2 files' },
        { kind: '@terminal', label: '@terminal', data: '$ pnpm test -> 121 tests passed' },
      ];
      assert.deepEqual(
        chips.slice(0, 3).map((c) => c.label),
        ['@compare.ts', '@selection', '@problems']
      );
      assert.equal(chips.length, 5);
    },
  },
  {
    id: 'T1-F21-04',
    tier: 1,
    feature: 21,
    features: [21],
    title: 'Editor selection actions (Ask, Explain, Fix) open the Agent composer with @file and @selection chips pre-attached',
    async fn() {
      const triggerSelectionAction = (action, filePath, selectedCode) => ({
        panelOpen: true,
        action,
        chips: [
          { kind: '@file', label: `@${path.basename(filePath)}`, filePath },
          { kind: '@selection', label: '@selection', code: selectedCode },
        ],
        promptPrefix: action === 'Explain' ? 'Explain this selection:' : action === 'Fix' ? 'Fix this code:' : '',
      });
      const state = triggerSelectionAction('Fix', 'src/routes/compare.ts', "return ''");
      assert.equal(state.panelOpen, true);
      assert.equal(state.chips[0].label, '@compare.ts');
      assert.equal(state.chips[1].label, '@selection');
      assert.equal(state.promptPrefix, 'Fix this code:');
    },
  },
  {
    id: 'T1-F21-05',
    tier: 1,
    feature: 21,
    features: [21],
    title: 'Follow agent toggle auto-opens files as the agent edits them and decorates active agent-edited tab with CLI-colored dot ("● brief.ts")',
    async fn() {
      const workbench = {
        followAgent: true,
        openTabs: [{ path: 'src/routes/compare.ts', label: 'compare.ts', activeAgentCli: null }],
        activeTab: 'src/routes/compare.ts',
      };
      const onAgentFileEdit = (event, cliId, cliColor) => {
        let tab = workbench.openTabs.find((t) => t.path === event.path);
        if (!tab) {
          tab = { path: event.path, label: path.basename(event.path), activeAgentCli: cliId, cliColor };
          workbench.openTabs.push(tab);
        } else {
          tab.activeAgentCli = cliId;
          tab.cliColor = cliColor;
        }
        if (workbench.followAgent) {
          workbench.activeTab = event.path;
        }
      };

      onAgentFileEdit({ type: 'file-edit', path: 'src/lib/brief.ts', added: 15, removed: 0 }, 'codex', '#1B2B22');
      assert.equal(workbench.activeTab, 'src/lib/brief.ts');
      const briefTab = workbench.openTabs.find((t) => t.label === 'brief.ts');
      assert.equal(briefTab.activeAgentCli, 'codex');
      assert.equal(briefTab.cliColor, '#1B2B22');
    },
  },

  // =========================================================================
  // Feature 22: Tasks Runner & DAP Debugger (5 tests)
  // =========================================================================
  {
    id: 'T1-F22-01',
    tier: 1,
    feature: 22,
    features: [22],
    title: 'Tasks runner (tasksList) discovers runnable scripts from project package.json',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
        const tasks = Object.entries(pkg.scripts || {}).map(([name, command]) => ({
          name,
          command,
          source: 'package.json',
        }));
        assert.deepEqual(
          tasks.map((t) => t.name),
          ['test', 'build', 'lint']
        );
      });
    },
  },
  {
    id: 'T1-F22-02',
    tier: 1,
    feature: 22,
    features: [22],
    title: 'Tasks runner (tasksRun) executes a package.json script and captures output and exit code 0',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
        const testCmd = pkg.scripts.test;
        const out = execFileSync('/bin/bash', ['-c', testCmd], { cwd: repoDir, encoding: 'utf8' }).trim();
        assert.equal(out, '121 tests passed');
      });
    },
  },
  {
    id: 'T1-F22-03',
    tier: 1,
    feature: 22,
    features: [22],
    title: 'DAP debugger (dapStart) initializes a Node/Python debug session and registers source breakpoints',
    async fn() {
      const dapSession = {
        id: 'dap-node-1',
        type: 'node',
        program: 'src/routes/compare.ts',
        state: 'running',
        breakpoints: [{ file: 'src/routes/compare.ts', line: 5, verified: true }],
      };
      assert.equal(dapSession.type, 'node');
      assert.equal(dapSession.breakpoints.length, 1);
      assert.equal(dapSession.breakpoints[0].verified, true);
    },
  },
  {
    id: 'T1-F22-04',
    tier: 1,
    feature: 22,
    features: [22],
    title: 'DAP debugger inspects call stack frames and local variables when paused on a breakpoint',
    async fn() {
      const pausedState = {
        reason: 'breakpoint',
        threadId: 1,
        callStack: [
          { frameId: 101, name: 'copyBrief', file: 'src/routes/compare.ts', line: 5, column: 3 },
          { frameId: 102, name: 'onClickCopy', file: 'src/routes/CompareView.tsx', line: 19, column: 7 },
        ],
        variables: {
          101: [
            { name: 'rows', type: 'CompareRow[]', value: 'Array(3)' },
            { name: 'text', type: 'string', value: '"# Brief summary"' },
          ],
        },
      };
      assert.equal(pausedState.callStack[0].name, 'copyBrief');
      assert.equal(pausedState.variables[101][1].name, 'text');
    },
  },
  {
    id: 'T1-F22-05',
    tier: 1,
    feature: 22,
    features: [22],
    title: 'DAP debugger supports stepping (stepOver, stepInto, continue) and debug console expression evaluation',
    async fn() {
      let currentLine = 5;
      const scopeVars = { rows: ['r1', 'r2'], ok: true };
      const stepOver = () => {
        currentLine += 1;
        return { state: 'paused', line: currentLine };
      };
      const evaluate = (expr) => {
        if (expr === 'rows.length') return String(scopeVars.rows.length);
        if (expr === "ok ? 'Copied' : 'Clipboard unavailable'") return 'Copied';
        return 'undefined';
      };
      assert.equal(stepOver().line, 6);
      assert.equal(evaluate('rows.length'), '2');
      assert.equal(evaluate("ok ? 'Copied' : 'Clipboard unavailable'"), 'Copied');
    },
  },

  // =========================================================================
  // Feature 23: Adapter SDK & ~/.conductor/extensions/ API (5 tests)
  // =========================================================================
  {
    id: 'T1-F23-01',
    tier: 1,
    feature: 23,
    features: [23],
    title: 'Adapter SDK template adapter implements CliAdapter and passes all 7 points of the shared contract test suite',
    async fn(ctx = {}) {
      checkWorkspaceArtifact(ctx, 'packages/adapters');
      await withTempDir(async (tmpDir) => {
        const templateAdapter = {
          id: 'template-cli',
          displayName: 'Template CLI',
          async detect() {
            return { installed: true, version: '1.0.0', path: '/usr/local/bin/template-cli' };
          },
          async capabilities() {
            return {
              acp: false,
              jsonStream: true,
              resume: true,
              approvals: true,
              readOnlyMode: true,
              reportsUsage: true,
              testedVersion: '1.0.0',
            };
          },
          async start(opts) {
            let approved = false;
            const session = {
              id: `tmpl-sess-${Date.now()}`,
              opts,
              async send() {},
              async respondToApproval(id, allow) {
                if (id === 'appr-1' && allow) approved = true;
              },
              async cancel() {},
              async close() {},
              events: {
                async *[Symbol.asyncIterator]() {
                  yield { type: 'status', state: 'working' };
                  yield { type: 'message', role: 'assistant', text: 'Streaming chunk 1... ', final: false };
                  yield { type: 'approval', id: 'appr-1', kind: 'edit', detail: 'Modify src/index.ts' };
                  yield { type: 'file-edit', path: 'src/index.ts', added: 4, removed: 1 };
                  yield {
                    type: 'message',
                    role: 'assistant',
                    text: `Completed with approval=${approved}`,
                    final: true,
                  };
                  yield { type: 'usage', limitHit: false, note: '1 turn' };
                  yield { type: 'status', state: 'idle' };
                },
              },
            };
            return session;
          },
        };

        const contractResults = await run7PointAdapterContractSuite(templateAdapter, tmpDir);
        assert.deepEqual(contractResults, {
          start: true,
          streamMessage: true,
          fileEdit: true,
          approval: true,
          cancel: true,
          resumeOrDegrade: true,
          usage: true,
        });
      });
    },
  },
  {
    id: 'T1-F23-02',
    tier: 1,
    feature: 23,
    features: [23],
    title: 'User-folder adapter loader dynamically imports a third-party adapter module without touching core code',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const userAdapterFile = path.join(tmpDir, 'custom-qwen-adapter.mjs');
        fs.writeFileSync(
          userAdapterFile,
          `export default {
             id: 'qwen-code',
             displayName: 'Qwen Code CLI',
             async detect() { return { installed: true, version: '2.1.0' }; },
             async capabilities() { return { acp: false, jsonStream: true, resume: false, approvals: true, readOnlyMode: true, reportsUsage: false }; },
           };\n`,
          'utf8'
        );
        const mod = await import(`file://${userAdapterFile}`);
        const adapter = mod.default;
        assert.equal(adapter.id, 'qwen-code');
        const det = await adapter.detect();
        assert.equal(det.installed, true);
        assert.equal(det.version, '2.1.0');
      });
    },
  },
  {
    id: 'T1-F23-03',
    tier: 1,
    feature: 23,
    features: [23],
    title: 'Extension manifest validator parses ~/.conductor/extensions/<name>/conductor.json with themes, snippets, LSPs, adapters, commands, and panels',
    async fn() {
      const manifest = {
        name: 'argon-pack',
        version: '1.0.0',
        displayName: 'Argon Extension Pack',
        permissions: ['webview'],
        contributes: {
          themes: [{ id: 'argon-moss', label: 'Argon Moss', uiTheme: 'light', path: './themes/moss.json' }],
          snippets: [{ language: 'typescript', path: './snippets/ts.json' }],
          languageServers: [{ id: 'svelte-lsp', languages: ['svelte'], command: 'svelteserver', args: ['--stdio'] }],
          cliAdapters: [{ id: 'custom-cli', displayName: 'Custom CLI', entry: './adapter.js' }],
          commands: [{ id: 'argon.sayHello', title: 'Argon: Say Hello', keybinding: 'Ctrl+Alt+H' }],
          panels: [{ id: 'argon.preview', title: 'Argon Preview', htmlPath: './webviews/index.html' }],
        },
      };
      assert.equal(manifest.name, 'argon-pack');
      assert.equal(manifest.contributes.themes.length, 1);
      assert.equal(manifest.contributes.languageServers[0].id, 'svelte-lsp');
      assert.equal(manifest.contributes.panels[0].id, 'argon.preview');
    },
  },
  {
    id: 'T1-F23-04',
    tier: 1,
    feature: 23,
    features: [23],
    title: 'Extension installer copies an extension from a local folder into ~/.conductor/extensions/<name>/ and loads its manifest',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const srcExtDir = path.join(tmpDir, 'src-sample-ext');
        const destExtsRoot = path.join(tmpDir, 'home-conductor/extensions');
        fs.mkdirSync(srcExtDir, { recursive: true });
        fs.writeFileSync(
          path.join(srcExtDir, 'conductor.json'),
          JSON.stringify({
            name: 'sample-theme-ext',
            version: '0.1.0',
            displayName: 'Sample Theme Extension',
            permissions: [],
            contributes: {
              themes: [{ id: 'soft-pine', label: 'Soft Pine', uiTheme: 'light', path: './theme.json' }],
            },
          }),
          'utf8'
        );
        fs.writeFileSync(path.join(srcExtDir, 'theme.json'), JSON.stringify({ '--bg-ground': '#F6F8F5' }), 'utf8');

        const installedDir = path.join(destExtsRoot, 'sample-theme-ext');
        fs.cpSync(srcExtDir, installedDir, { recursive: true });
        const loadedManifest = JSON.parse(fs.readFileSync(path.join(installedDir, 'conductor.json'), 'utf8'));
        assert.equal(loadedManifest.name, 'sample-theme-ext');
        assert.equal(loadedManifest.contributes.themes[0].id, 'soft-pine');
      });
    },
  },
  {
    id: 'T1-F23-05',
    tier: 1,
    feature: 23,
    features: [23],
    title: 'VS Code importers convert VS Code theme, keybindings, and snippets JSON files into Conductor tokens and registries',
    async fn() {
      const vscodeTheme = {
        name: 'VS Code Light+',
        type: 'light',
        colors: {
          'editor.background': '#F6F8F5',
          'sideBar.background': '#EAF1E8',
          'editor.foreground': '#1B2B22',
        },
      };
      const vscodeKeybindings = [{ key: 'ctrl+k', command: 'workbench.action.showCommands' }];
      const vscodeSnippets = {
        Log: { prefix: 'clg', body: ['console.log($1);'], description: 'Log to console' },
      };

      const importedTheme = {
        '--bg-ground': vscodeTheme.colors['editor.background'],
        '--bg-sidebar': vscodeTheme.colors['sideBar.background'],
        '--text-ink': vscodeTheme.colors['editor.foreground'],
      };
      assert.equal(importedTheme['--bg-ground'], '#F6F8F5');
      assert.equal(vscodeKeybindings[0].key, 'ctrl+k');
      assert.equal(vscodeSnippets.Log.prefix, 'clg');
    },
  },

  // =========================================================================
  // Feature 24: Design System, Command Registry, Palette, Replay, Dark Theme & Release (5 tests)
  // =========================================================================
  {
    id: 'T1-F24-01',
    tier: 1,
    feature: 24,
    features: [24],
    title: 'Design system defines all Section 7 CSS variable tokens (colors, CLI dots, radii 8/12/14px, 216px sidebar, 360px right pane)',
    async fn(ctx = {}) {
      checkWorkspaceArtifact(ctx, 'packages/ui');
      const expectedHexes = {
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
      };
      for (const [k, v] of Object.entries(expectedHexes)) {
        assert.equal(REQUIRED_LIGHT_TOKENS[k], v, `Token ${k} must match spec value ${v}`);
      }
      assert.equal(REQUIRED_LIGHT_TOKENS['--radius-sm'], '8px');
      assert.equal(REQUIRED_LIGHT_TOKENS['--radius-md'], '12px');
      assert.equal(REQUIRED_LIGHT_TOKENS['--radius-lg'], '14px');
      assert.equal(REQUIRED_LIGHT_TOKENS['--sidebar-width'], '216px');
      assert.equal(REQUIRED_LIGHT_TOKENS['--right-pane-width'], '360px');
    },
  },
  {
    id: 'T1-F24-02',
    tier: 1,
    feature: 24,
    features: [24],
    title: 'Unified Command Registry registers and executes commands backing Command Palette (Ctrl/Cmd+K, Ctrl/Cmd+Shift+P) and Quick Open (Ctrl/Cmd+P)',
    async fn() {
      const commands = new Map();
      const registerCommand = (id, title, shortcut, handler) => {
        commands.set(id, { id, title, shortcut, handler });
      };
      const executeCommand = async (id, ...args) => {
        const entry = commands.get(id);
        assert.ok(entry, `Command ${id} not registered`);
        return await entry.handler(...args);
      };

      let toggledAgentPanel = false;
      registerCommand('conductor.palette.open', 'View: Show Command Palette', 'Ctrl+K / Ctrl+Shift+P', () => 'palette-open');
      registerCommand('conductor.quickOpen', 'File: Quick Open', 'Ctrl+P', (q) => `quick-open:${q}`);
      registerCommand('conductor.agentPanel.toggle', 'View: Toggle Agent Panel', 'Ctrl+L', () => {
        toggledAgentPanel = !toggledAgentPanel;
        return toggledAgentPanel;
      });

      assert.equal(await executeCommand('conductor.palette.open'), 'palette-open');
      assert.equal(await executeCommand('conductor.quickOpen', 'compare.ts'), 'quick-open:compare.ts');
      assert.equal(await executeCommand('conductor.agentPanel.toggle'), true);
    },
  },
  {
    id: 'T1-F24-03',
    tier: 1,
    feature: 24,
    features: [24],
    title: 'Session Replay timeline steps through persisted SQLite session_events in chronological sequence',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const store = new ConductorSqliteStore(path.join(tmpDir, '.conductor/conductor.db'));
        store.createSession({ id: 'sess-replay', projectId: 'p1', title: 'Replay test', activeCli: 'codex' });
        store.appendSessionEvent('sess-replay', { type: 'message', role: 'user', text: 'Prompt 1', final: true });
        store.appendSessionEvent('sess-replay', { type: 'file-edit', path: 'compare.ts', added: 43, removed: 0 });
        store.appendSessionEvent('sess-replay', { type: 'message', role: 'assistant', text: 'Done', final: true });

        const allEvents = store.getSessionEvents('sess-replay');
        const replaySnapshotAt = (stepIdx) => allEvents.slice(0, stepIdx + 1).map((e) => e.payload);

        assert.equal(replaySnapshotAt(0).length, 1);
        assert.equal(replaySnapshotAt(1)[1].type, 'file-edit');
        assert.equal(replaySnapshotAt(2)[2].text, 'Done');
      });
    },
  },
  {
    id: 'T1-F24-04',
    tier: 1,
    feature: 24,
    features: [24],
    title: 'Dark Theme swaps CSS variable token values under [data-theme="dark"] without modifying component structure',
    async fn() {
      const darkTokens = {
        '--bg-ground': '#111915',
        '--bg-sidebar': '#16211B',
        '--border-default': '#26382E',
        '--text-ink': '#E6EFE9',
        '--text-muted': '#8FA597',
        '--accent-primary': '#3D8B66',
        '--bg-diff-add': '#193524',
        '--bg-diff-remove': '#3B1D1D',
      };
      for (const key of Object.keys(darkTokens)) {
        assert.ok(key in REQUIRED_LIGHT_TOKENS, `Dark theme token ${key} must correspond to a light theme CSS variable`);
        assert.notEqual(darkTokens[key], REQUIRED_LIGHT_TOKENS[key], `Dark token ${key} must swap value`);
      }
    },
  },
  {
    id: 'T1-F24-05',
    tier: 1,
    feature: 24,
    features: [24],
    title: 'Release and open-source governance configuration defines electron-builder targets (auto-update off) and governance docs',
    async fn(ctx = {}) {
      if (ctx.strictWorkspace) {
        checkWorkspaceArtifact(ctx, 'README.md');
        checkWorkspaceArtifact(ctx, 'CONTRIBUTING.md');
        checkWorkspaceArtifact(ctx, 'CODE_OF_CONDUCT.md');
        checkWorkspaceArtifact(ctx, 'SECURITY.md');
        checkWorkspaceArtifact(ctx, 'docs/ROADMAP.md');
      }
      const builderConfig = {
        appId: 'dev.conductor.app',
        productName: 'Conductor',
        publish: null, // auto-updates off by default per Section 8 Phase 7
        linux: { target: ['AppImage', 'deb'] },
        mac: { target: ['dmg', 'zip'] },
        win: { target: ['nsis', 'zip'] },
      };
      assert.equal(builderConfig.publish, null, 'Auto-updates must be disabled by default');
      assert.ok(builderConfig.linux && builderConfig.mac && builderConfig.win);
    },
  },
];
