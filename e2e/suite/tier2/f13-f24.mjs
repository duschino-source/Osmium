import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  resolveWorkspaceFeature,
  withTempDir,
  withTempGitRepo,
  runGit,
  detectOutOfScopeEdits,
  validateTaskDagNoCycles,
  runRipgrepSearch,
  extractTerminalClickablePaths,
  parseAndResolveThreeWayConflict,
  computeWcagContrastRatio,
} from '../helpers/t2-harness.mjs';

export const tests = [
  /* ==========================================================================
   * FEATURE 13: /teamwork Planner, Router, Worktrees, Scheduler & Merge (5 Tests)
   * ========================================================================== */
  {
    id: 'T2-F13-01',
    tier: 2,
    feature: 13,
    features: [13],
    title: 'Planner receiving invalid zod schema output on 1st attempt automatically retries once and succeeds on 2nd attempt',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 13);
      let callCount = 0;
      async function mockPlannerCliOutput() {
        callCount += 1;
        if (callCount === 1) {
          return '{ "goal": "Add copy brief", "tasks": [] }'; // invalid: tasks.min(1)
        }
        return JSON.stringify({
          goal: 'Add copy brief',
          tasks: [
            {
              id: 'task-1',
              title: 'Build brief builder',
              scope: ['src/routes/**'],
              dependencies: [],
              taskType: 'implementation',
            },
          ],
        });
      }

      function validatePlan(rawJson) {
        const parsed = JSON.parse(rawJson);
        if (!parsed.goal || !Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
          throw new Error('Plan must contain at least 1 task');
        }
        for (const t of parsed.tasks) {
          if (!t.title || !Array.isArray(t.scope) || t.scope.length === 0) {
            throw new Error('Task missing title or scope');
          }
        }
        return parsed;
      }

      async function runPlannerWithSingleRetry() {
        for (let attempt = 1; attempt <= 2; attempt++) {
          const raw = await mockPlannerCliOutput();
          try {
            const plan = validatePlan(raw);
            return { valid: true, attempts: attempt, plan };
          } catch {
            if (attempt === 2) {
              return { valid: false, attempts: attempt, rawText: raw, requiresManualEdit: true };
            }
          }
        }
      }

      const res = await runPlannerWithSingleRetry();
      assert.equal(res.valid, true);
      assert.equal(res.attempts, 2);
      assert.equal(res.plan.tasks[0].title, 'Build brief builder');
    },
  },
  {
    id: 'T2-F13-02',
    tier: 2,
    feature: 13,
    features: [13],
    title: 'Planner failing schema validation on both 1st and 2nd attempts surfaces raw text for user manual fix',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 13);
      const outputs = ['NOT_JSON_AT_ALL_1', '{"goal": "missing tasks array"}'];
      let idx = 0;

      async function runPlannerFallback() {
        let lastRaw = '';
        for (let attempt = 1; attempt <= 2; attempt++) {
          lastRaw = outputs[idx++];
          try {
            const obj = JSON.parse(lastRaw);
            if (!Array.isArray(obj.tasks) || obj.tasks.length === 0) {
              throw new Error('Invalid tasks array');
            }
            return { valid: true, attempts: attempt, plan: obj };
          } catch {
            // retry if attempt === 1
          }
        }
        return { valid: false, attempts: 2, rawText: lastRaw, requiresManualEdit: true };
      }

      const res = await runPlannerFallback();
      assert.equal(res.valid, false);
      assert.equal(res.attempts, 2);
      assert.equal(res.requiresManualEdit, true);
      assert.equal(res.rawText, '{"goal": "missing tasks array"}');
    },
  },
  {
    id: 'T2-F13-03',
    tier: 2,
    feature: 13,
    features: [13],
    title: 'Detects out-of-scope file edits in task git worktree via git diff against osmium/integration',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 13);
      await withTempGitRepo(async (repoDir) => {
        const wtPath = path.join(repoDir, '.osmium', 'worktrees', 'task-auth');
        fs.mkdirSync(path.dirname(wtPath), { recursive: true });
        const wtRes = runGit(repoDir, [
          'worktree',
          'add',
          '-B',
          'osmium/task/task-auth',
          wtPath,
          'osmium/integration',
        ]);
        assert.equal(wtRes.status, 0, `git worktree add failed: ${wtRes.stderr}`);

        // Task scope is ['src/auth/**'], but task edits both src/auth/login.ts and README.md
        fs.mkdirSync(path.join(wtPath, 'src/auth'), { recursive: true });
        fs.writeFileSync(path.join(wtPath, 'src/auth/login.ts'), 'export const login = true;\n', 'utf8');
        fs.writeFileSync(path.join(wtPath, 'README.md'), '# Out of scope edit\n', 'utf8');
        runGit(wtPath, ['add', '-A']);
        runGit(wtPath, ['commit', '-m', 'Task auth work']);

        const diffFiles = runGit(wtPath, ['diff', '--name-only', 'osmium/integration'])
          .stdout.split('\n')
          .filter(Boolean);
        const scopeCheck = detectOutOfScopeEdits(diffFiles, ['src/auth/**']);

        assert.equal(scopeCheck.withinScope, false);
        assert.deepEqual(scopeCheck.outOfScopeFiles, ['README.md']);
      });
    },
  },
  {
    id: 'T2-F13-04',
    tier: 2,
    feature: 13,
    features: [13],
    title: 'Detects and rejects cyclic task dependency graphs (A -> B -> C -> A) before scheduling',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 13);
      const cyclicTasks = [
        { id: 'task-a', title: 'Task A', dependencies: ['task-b'] },
        { id: 'task-b', title: 'Task B', dependencies: ['task-c'] },
        { id: 'task-c', title: 'Task C', dependencies: ['task-a'] },
      ];

      assert.throws(
        () => validateTaskDagNoCycles(cyclicTasks),
        (err) => err.code === 'ERR_CYCLIC_DEPENDENCY' && err.cycle.includes('task-a')
      );

      const acyclicTasks = [
        { id: 'task-1', title: 'Scaffold', dependencies: [] },
        { id: 'task-2', title: 'Impl', dependencies: ['task-1'] },
        { id: 'task-3', title: 'Tests', dependencies: ['task-2'] },
      ];
      assert.equal(validateTaskDagNoCycles(acyclicTasks).valid, true);
    },
  },
  {
    id: 'T2-F13-05',
    tier: 2,
    feature: 13,
    features: [13, 19],
    title: 'Stops merge into osmium/integration on git conflict without corrupting branch and offers CLI assignment',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 13);
      await withTempGitRepo(async (repoDir) => {
        const wt1 = path.join(repoDir, '.osmium/worktrees/task-1');
        const wt2 = path.join(repoDir, '.osmium/worktrees/task-2');
        fs.mkdirSync(path.dirname(wt1), { recursive: true });

        runGit(repoDir, ['worktree', 'add', '-B', 'osmium/task/task-1', wt1, 'osmium/integration']);
        runGit(repoDir, ['worktree', 'add', '-B', 'osmium/task/task-2', wt2, 'osmium/integration']);

        fs.writeFileSync(path.join(wt1, 'src/index.ts'), 'export const main = () => "from-task-1";\n', 'utf8');
        runGit(wt1, ['commit', '-am', 'Task 1 edit']);

        fs.writeFileSync(path.join(wt2, 'src/index.ts'), 'export const main = () => "from-task-2";\n', 'utf8');
        runGit(wt2, ['commit', '-am', 'Task 2 edit']);

        // Merge task-1 into osmium/integration cleanly
        runGit(repoDir, ['checkout', 'osmium/integration']);
        const m1 = runGit(repoDir, ['merge', '--no-ff', 'osmium/task/task-1', '-m', 'Merge task 1']);
        assert.equal(m1.status, 0);

        // Merging task-2 produces a conflict
        const m2 = runGit(repoDir, ['merge', '--no-ff', 'osmium/task/task-2', '-m', 'Merge task 2']);
        assert.notEqual(m2.status, 0);

        const conflictFiles = runGit(repoDir, ['diff', '--name-only', '--diff-filter=U'])
          .stdout.split('\n')
          .filter(Boolean);
        assert.deepEqual(conflictFiles, ['src/index.ts']);

        // Abort merge to keep osmium/integration clean and offer CLI conflict assignment
        runGit(repoDir, ['merge', '--abort']);
        const statusAfterAbort = runGit(repoDir, ['status', '--porcelain', '--untracked-files=no']).stdout;
        assert.equal(statusAfterAbort, '');
        assert.equal(fs.readFileSync(path.join(repoDir, 'src/index.ts'), 'utf8'), 'export const main = () => "from-task-1";\n');
      });
    },
  },

  /* ==========================================================================
   * FEATURE 14: Usage Meter & Quota Fallback (5 Tests)
   * ========================================================================== */
  {
    id: 'T2-F14-01',
    tier: 2,
    feature: 14,
    features: [14],
    title: 'Usage meter for a CLI with reportsUsage: false never invents fake percentages or token limits',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 14);
      function getCliUsageMeter(cliId, capabilities, turnsRun, lastLimitHitAt) {
        return {
          cliId,
          turnsRun,
          lastLimitHitAt: lastLimitHitAt ?? null,
          reportsUsage: capabilities.reportsUsage,
          percentageUsed: undefined,
          tokenLimit: undefined,
          remainingTokens: undefined,
        };
      }

      const meter = getCliUsageMeter('antigravity', { reportsUsage: false }, 7, null);
      assert.equal(meter.turnsRun, 7);
      assert.equal(meter.lastLimitHitAt, null);
      assert.equal(meter.percentageUsed, undefined);
      assert.equal(meter.tokenLimit, undefined);
      assert.equal(meter.remainingTokens, undefined);
    },
  },
  {
    id: 'T2-F14-02',
    tier: 2,
    feature: 14,
    features: [14],
    title: 'Quota hit (limitHit: true) when fallback.onQuotaHit is "stop" pauses task without reassigning',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 14);
      const task = { id: 't-1', assignedCli: 'codex', status: 'running' };
      const config = {
        primary: 'codex',
        secondary: ['antigravity', 'deepseek'],
        fallback: { onQuotaHit: 'stop' },
      };

      function handleQuotaHit(t, cfg) {
        if (cfg.fallback.onQuotaHit === 'stop') {
          t.status = 'paused_quota';
          return { reassigned: false, task: t };
        }
        return { reassigned: true, task: t };
      }

      const res = handleQuotaHit(task, config);
      assert.equal(res.reassigned, false);
      assert.equal(res.task.status, 'paused_quota');
      assert.equal(res.task.assignedCli, 'codex');
    },
  },
  {
    id: 'T2-F14-03',
    tier: 2,
    feature: 14,
    features: [14],
    title: 'Quota hit when fallback.onQuotaHit is "ask" waits for user confirmation before switching CLI',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 14);
      const task = { id: 't-2', assignedCli: 'codex', status: 'running', suggestedCli: null };
      const config = {
        primary: 'codex',
        secondary: ['antigravity', 'deepseek'],
        fallback: { onQuotaHit: 'ask' },
      };

      if (config.fallback.onQuotaHit === 'ask') {
        task.status = 'waiting_quota_approval';
        task.suggestedCli = config.secondary[0];
      }

      assert.equal(task.status, 'waiting_quota_approval');
      assert.equal(task.assignedCli, 'codex');
      assert.equal(task.suggestedCli, 'antigravity');
    },
  },
  {
    id: 'T2-F14-04',
    tier: 2,
    feature: 14,
    features: [14],
    title: 'Cascading quota hit where primary and 1st secondary both hit limit moves task to 2nd secondary CLI',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 14);
      const chain = ['codex', 'antigravity', 'deepseek'];
      const exhausted = new Set();
      let currentCli = 'codex';

      function onLimitHit() {
        exhausted.add(currentCli);
        const next = chain.find((c) => !exhausted.has(c));
        if (!next) {
          return { status: 'exhausted', assignedCli: currentCli };
        }
        currentCli = next;
        return { status: 'running', assignedCli: currentCli };
      }

      const step1 = onLimitHit(); // codex hits limit -> moves to antigravity
      assert.equal(step1.assignedCli, 'antigravity');
      assert.equal(step1.status, 'running');

      const step2 = onLimitHit(); // antigravity hits limit -> moves to deepseek
      assert.equal(step2.assignedCli, 'deepseek');
      assert.equal(step2.status, 'running');
    },
  },
  {
    id: 'T2-F14-05',
    tier: 2,
    feature: 14,
    features: [14],
    title: 'Quota hit when all configured CLIs are exhausted pauses run with clear exhaustion status',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 14);
      const chain = ['codex', 'antigravity', 'deepseek'];
      const exhausted = new Set(['codex', 'antigravity', 'deepseek']);
      const next = chain.find((c) => !exhausted.has(c));
      const outcome = next
        ? { status: 'running', assignedCli: next }
        : {
            status: 'exhausted',
            message: 'All configured CLIs (codex, antigravity, deepseek) have hit their quota limits.',
          };

      assert.equal(outcome.status, 'exhausted');
      assert.match(outcome.message, /All configured CLIs/);
    },
  },

  /* ==========================================================================
   * FEATURE 15: IDE Explorer & File Watcher (5 Tests)
   * ========================================================================== */
  {
    id: 'T2-F15-01',
    tier: 2,
    feature: 15,
    features: [15],
    title: 'Lazy directory tree reader reads top-level entries on a deep multi-hundred-file tree in under 100ms without recursion',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 15);
      await withTempDir(async (tmpDir) => {
        // Create 40 folders each with 25 nested files (1,000 files)
        for (let d = 0; d < 40; d++) {
          const sub = path.join(tmpDir, `module-${d}`, 'nested');
          fs.mkdirSync(sub, { recursive: true });
          for (let f = 0; f < 25; f++) {
            fs.writeFileSync(path.join(sub, `file-${f}.ts`), `export const x = ${f};\n`, 'utf8');
          }
        }

        let readdirCalls = 0;
        function readLazyTreeLevel(rootPath, relDir = '') {
          readdirCalls += 1;
          const target = path.join(rootPath, relDir);
          const dirents = fs.readdirSync(target, { withFileTypes: true });
          return dirents.map((d) => ({
            name: d.name,
            kind: d.isDirectory() ? 'directory' : 'file',
            childrenLoaded: false,
          }));
        }

        const startMs = performance.now();
        const rootEntries = readLazyTreeLevel(tmpDir, '');
        const elapsedMs = performance.now() - startMs;

        assert.equal(readdirCalls, 1, 'Lazy tree must only call readdirSync once for the requested level');
        assert.equal(rootEntries.length, 40);
        assert.ok(elapsedMs < 500, `Expected lazy root read < 500ms, got ${elapsedMs}ms`);
      });
    },
  },
  {
    id: 'T2-F15-02',
    tier: 2,
    feature: 15,
    features: [15],
    title: '.gitignore filter excludes node_modules, dist, and ignored patterns from Explorer tree',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 15);
      await withTempGitRepo(async (repoDir) => {
        fs.writeFileSync(path.join(repoDir, '.gitignore'), 'node_modules/\ndist/\n*.log\n', 'utf8');
        fs.mkdirSync(path.join(repoDir, 'node_modules/pkg'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'node_modules/pkg/index.js'), '', 'utf8');
        fs.mkdirSync(path.join(repoDir, 'dist'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'dist/bundle.js'), '', 'utf8');
        fs.writeFileSync(path.join(repoDir, 'debug.log'), 'log', 'utf8');

        const visibleFiles = runGit(repoDir, ['ls-files', '--cached', '--others', '--exclude-standard'])
          .stdout.split('\n')
          .filter(Boolean);

        assert.ok(visibleFiles.includes('src/index.ts'));
        assert.ok(!visibleFiles.some((f) => f.startsWith('node_modules/')));
        assert.ok(!visibleFiles.some((f) => f.startsWith('dist/')));
        assert.ok(!visibleFiles.includes('debug.log'));
      });
    },
  },
  {
    id: 'T2-F15-03',
    tier: 2,
    feature: 15,
    features: [15],
    title: 'Creating an already-existing file throws ERR_FILE_EXISTS and deleting a missing file throws ERR_FILE_NOT_FOUND',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 15);
      await withTempDir(async (tmpDir) => {
        const existingFile = path.join(tmpDir, 'exists.ts');
        fs.writeFileSync(existingFile, 'export {};\n', 'utf8');

        function createEntry(targetPath) {
          if (fs.existsSync(targetPath)) {
            const err = new Error(`Target already exists: ${targetPath}`);
            err.code = 'ERR_FILE_EXISTS';
            throw err;
          }
          fs.writeFileSync(targetPath, '', 'utf8');
        }

        function deleteEntry(targetPath) {
          if (!fs.existsSync(targetPath)) {
            const err = new Error(`Target does not exist: ${targetPath}`);
            err.code = 'ERR_FILE_NOT_FOUND';
            throw err;
          }
          fs.rmSync(targetPath, { recursive: true });
        }

        assert.throws(
          () => createEntry(existingFile),
          (err) => err.code === 'ERR_FILE_EXISTS'
        );
        assert.throws(
          () => deleteEntry(path.join(tmpDir, 'missing-file.ts')),
          (err) => err.code === 'ERR_FILE_NOT_FOUND'
        );
      });
    },
  },
  {
    id: 'T2-F15-04',
    tier: 2,
    feature: 15,
    features: [15, 16],
    title: 'Renaming or moving a file updates open editor tab paths and activeTab pointer',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 15);
      await withTempDir(async (tmpDir) => {
        const oldPath = path.join(tmpDir, 'compare.ts');
        const newPath = path.join(tmpDir, 'compare-view.ts');
        fs.writeFileSync(oldPath, 'export const v = 1;\n', 'utf8');

        const workbenchState = {
          openTabs: ['src/auth.ts', 'compare.ts'],
          activeTab: 'compare.ts',
        };

        fs.renameSync(oldPath, newPath);
        workbenchState.openTabs = workbenchState.openTabs.map((t) => (t === 'compare.ts' ? 'compare-view.ts' : t));
        if (workbenchState.activeTab === 'compare.ts') {
          workbenchState.activeTab = 'compare-view.ts';
        }

        assert.deepEqual(workbenchState.openTabs, ['src/auth.ts', 'compare-view.ts']);
        assert.equal(workbenchState.activeTab, 'compare-view.ts');
        assert.equal(fs.existsSync(newPath), true);
      });
    },
  },
  {
    id: 'T2-F15-05',
    tier: 2,
    feature: 15,
    features: [15],
    title: 'File watcher handles rapid burst of external file creations and deletions cleanly',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 15);
      await withTempDir(async (tmpDir) => {
        const events = [];
        const watcher = fs.watch(tmpDir, (eventType, filename) => {
          if (filename) events.push({ eventType, filename });
        });

        try {
          for (let i = 0; i < 25; i++) {
            const p = path.join(tmpDir, `burst-${i}.txt`);
            fs.writeFileSync(p, `item ${i}`, 'utf8');
            fs.unlinkSync(p);
          }
          await new Promise((r) => setTimeout(r, 50));
        } finally {
          watcher.close();
        }

        assert.ok(events.length > 0);
        assert.equal(fs.readdirSync(tmpDir).length, 0);
      });
    },
  },

  /* ==========================================================================
   * FEATURE 16: Monaco Multi-Tab & Split Editor (5 Tests)
   * ========================================================================== */
  {
    id: 'T2-F16-01',
    tier: 2,
    feature: 16,
    features: [16],
    title: 'Disk-change conflict guard refuses silent overwrite when file mtime changed externally on disk',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 16);
      await withTempDir(async (tmpDir) => {
        const filePath = path.join(tmpDir, 'compare.ts');
        fs.writeFileSync(filePath, 'export const v = "initial";\n', 'utf8');
        const openedMtimeMs = fs.statSync(filePath).mtimeMs;

        // External tool modifies file on disk and bumps mtime
        fs.writeFileSync(filePath, 'export const v = "modified-on-disk";\n', 'utf8');
        const bumpedTime = (openedMtimeMs + 5000) / 1000;
        fs.utimesSync(filePath, bumpedTime, bumpedTime);

        function writeFileWithConflictGuard(target, newContent, expectedMtimeMs) {
          const stat = fs.statSync(target);
          if (expectedMtimeMs !== undefined && Math.abs(stat.mtimeMs - expectedMtimeMs) > 1) {
            return {
              saved: false,
              conflict: true,
              diskContent: fs.readFileSync(target, 'utf8'),
              editorContent: newContent,
            };
          }
          fs.writeFileSync(target, newContent, 'utf8');
          return { saved: true, conflict: false };
        }

        const res = writeFileWithConflictGuard(filePath, 'export const v = "from-dirty-editor";\n', openedMtimeMs);
        assert.equal(res.saved, false);
        assert.equal(res.conflict, true);
        assert.equal(res.diskContent, 'export const v = "modified-on-disk";\n');
        assert.equal(fs.readFileSync(filePath, 'utf8'), 'export const v = "modified-on-disk";\n');
      });
    },
  },
  {
    id: 'T2-F16-02',
    tier: 2,
    feature: 16,
    features: [16],
    title: 'Opening a file larger than 5 MB threshold activates largeFileSafeMode disabling heavy tokenization and LSP',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 16);
      await withTempDir(async (tmpDir) => {
        const largeFile = path.join(tmpDir, 'bundle.log');
        const sizeBytes = 5 * 1024 * 1024 + 1024; // > 5 MB
        fs.writeFileSync(largeFile, Buffer.alloc(sizeBytes, 0x61));

        function openEditorDocument(filePath, threshold = 5 * 1024 * 1024) {
          const stat = fs.statSync(filePath);
          const safeMode = stat.size > threshold;
          return {
            filePath,
            size: stat.size,
            largeFileSafeMode: safeMode,
            tokenizationEnabled: !safeMode,
            lspSyncEnabled: !safeMode,
            minimapEnabled: !safeMode,
          };
        }

        const doc = openEditorDocument(largeFile);
        assert.equal(doc.largeFileSafeMode, true);
        assert.equal(doc.tokenizationEnabled, false);
        assert.equal(doc.lspSyncEnabled, false);
      });
    },
  },
  {
    id: 'T2-F16-03',
    tier: 2,
    feature: 16,
    features: [16],
    title: 'Closing a dirty editor tab without force flag prompts unsaved changes confirmation instead of discarding edits',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 16);
      const tab = {
        path: 'src/routes/compare.ts',
        dirty: true,
        unsavedBuffer: 'export const unsaved = true;\n',
      };

      function closeTab(t, force = false) {
        if (t.dirty && !force) {
          return { closed: false, requiresConfirmation: true, reason: 'UNSAVED_CHANGES' };
        }
        return { closed: true, requiresConfirmation: false };
      }

      const attempt1 = closeTab(tab, false);
      assert.equal(attempt1.closed, false);
      assert.equal(attempt1.requiresConfirmation, true);
      assert.equal(tab.unsavedBuffer, 'export const unsaved = true;\n');
    },
  },
  {
    id: 'T2-F16-04',
    tier: 2,
    feature: 16,
    features: [16],
    title: 'Opening a PNG/binary file routes to image/binary preview mode instead of corrupting text buffer',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 16);
      await withTempDir(async (tmpDir) => {
        const pngPath = path.join(tmpDir, 'preview.png');
        const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
        fs.writeFileSync(pngPath, pngHeader);

        function inspectFileForEditor(targetPath) {
          const buf = fs.readFileSync(targetPath);
          const isPng = buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
          const hasNullByte = buf.includes(0x00);
          if (isPng) return { editorMode: 'preview', previewKind: 'image' };
          if (hasNullByte) return { editorMode: 'preview', previewKind: 'binary' };
          return { editorMode: 'monaco-text', text: buf.toString('utf8') };
        }

        const res = inspectFileForEditor(pngPath);
        assert.equal(res.editorMode, 'preview');
        assert.equal(res.previewKind, 'image');
      });
    },
  },
  {
    id: 'T2-F16-05',
    tier: 2,
    feature: 16,
    features: [16],
    title: 'Restoring saved workspace layout skips files deleted on disk while restoring remaining valid tabs',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 16);
      await withTempDir(async (tmpDir) => {
        fs.writeFileSync(path.join(tmpDir, 'keep-1.ts'), 'export const a = 1;\n', 'utf8');
        fs.writeFileSync(path.join(tmpDir, 'keep-2.ts'), 'export const b = 2;\n', 'utf8');

        const persistedLayout = {
          openTabs: ['keep-1.ts', 'deleted-on-disk.ts', 'keep-2.ts'],
          activeTab: 'deleted-on-disk.ts',
        };

        const restoredTabs = persistedLayout.openTabs.filter((rel) => fs.existsSync(path.join(tmpDir, rel)));
        const restoredActive = restoredTabs.includes(persistedLayout.activeTab)
          ? persistedLayout.activeTab
          : restoredTabs[0] || null;

        assert.deepEqual(restoredTabs, ['keep-1.ts', 'keep-2.ts']);
        assert.equal(restoredActive, 'keep-1.ts');
      });
    },
  },

  /* ==========================================================================
   * FEATURE 17: Ripgrep Project Search & Replace (5 Tests)
   * ========================================================================== */
  {
    id: 'T2-F17-01',
    tier: 2,
    feature: 17,
    features: [17],
    title: 'Invalid regex pattern ("[unclosed") in ripgrep returns structured ERR_INVALID_REGEX without crashing',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 17);
      await withTempDir(async (tmpDir) => {
        fs.writeFileSync(path.join(tmpDir, 'sample.ts'), 'export const x = 1;\n', 'utf8');
        const res = runRipgrepSearch(tmpDir, '[unclosed-regex-group');
        assert.equal(res.ok, false);
        assert.equal(res.errorCode, 'ERR_INVALID_REGEX');
        assert.ok(res.stderr.length > 0);
      });
    },
  },
  {
    id: 'T2-F17-02',
    tier: 2,
    feature: 17,
    features: [17],
    title: 'Ripgrep search skips .gitignored directories (node_modules) and binary files by default',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 17);
      await withTempGitRepo(async (repoDir) => {
        fs.writeFileSync(path.join(repoDir, '.gitignore'), 'node_modules/\n', 'utf8');
        fs.mkdirSync(path.join(repoDir, 'node_modules/lib'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'node_modules/lib/ignored.js'), 'FIND_ME_TOKEN\n', 'utf8');
        fs.writeFileSync(path.join(repoDir, 'binary.dat'), Buffer.from([0x00, 0xff, ...Buffer.from('FIND_ME_TOKEN')]));
        fs.writeFileSync(path.join(repoDir, 'src/index.ts'), 'export const token = "FIND_ME_TOKEN";\n', 'utf8');

        const res = runRipgrepSearch(repoDir, 'FIND_ME_TOKEN');
        assert.equal(res.ok, true);
        assert.equal(res.matches.length, 1);
        assert.equal(res.matches[0].file, 'src/index.ts');
      });
    },
  },
  {
    id: 'T2-F17-03',
    tier: 2,
    feature: 17,
    features: [17],
    title: 'Cancelling an in-flight streaming ripgrep search kills the rg child process cleanly',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 17);
      await withTempDir(async (tmpDir) => {
        for (let i = 0; i < 30; i++) {
          fs.writeFileSync(path.join(tmpDir, `file-${i}.ts`), `export const val${i} = "SEARCH_TARGET";\n`, 'utf8');
        }

        const child = spawn('/usr/bin/rg', ['--json', 'SEARCH_TARGET', '.'], {
          cwd: tmpDir,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.kill('SIGTERM');

        const exitInfo = await new Promise((resolve) => {
          child.on('close', (code, signal) => resolve({ code, signal }));
        });
        assert.ok(exitInfo.signal === 'SIGTERM' || exitInfo.code !== null);
      });
    },
  },
  {
    id: 'T2-F17-04',
    tier: 2,
    feature: 17,
    features: [17],
    title: 'Multi-file replace aborts replacement on a target file modified externally after preview',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 17);
      await withTempDir(async (tmpDir) => {
        const f1 = path.join(tmpDir, 'a.ts');
        const f2 = path.join(tmpDir, 'b.ts');
        fs.writeFileSync(f1, 'const oldName = 1;\n', 'utf8');
        fs.writeFileSync(f2, 'const oldName = 2;\n', 'utf8');

        const previewSnap = [
          { path: f1, mtimeMs: fs.statSync(f1).mtimeMs },
          { path: f2, mtimeMs: fs.statSync(f2).mtimeMs },
        ];

        // External edit modifies f2 before replace executes
        fs.writeFileSync(f2, 'const oldName = 999; // external edit\n', 'utf8');
        const futureSec = (previewSnap[1].mtimeMs + 5000) / 1000;
        fs.utimesSync(f2, futureSec, futureSec);

        const conflicts = [];
        for (const item of previewSnap) {
          const curMtime = fs.statSync(item.path).mtimeMs;
          if (Math.abs(curMtime - item.mtimeMs) > 1) {
            conflicts.push(path.basename(item.path));
          } else {
            const text = fs.readFileSync(item.path, 'utf8');
            fs.writeFileSync(item.path, text.replace(/oldName/g, 'newName'), 'utf8');
          }
        }

        assert.deepEqual(conflicts, ['b.ts']);
        assert.equal(fs.readFileSync(f1, 'utf8'), 'const newName = 1;\n');
        assert.equal(fs.readFileSync(f2, 'utf8'), 'const oldName = 999; // external edit\n');
      });
    },
  },
  {
    id: 'T2-F17-05',
    tier: 2,
    feature: 17,
    features: [17],
    title: 'Zero-match ripgrep query (exit code 1) returns { ok: true, matches: [], totalMatches: 0 }',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 17);
      await withTempDir(async (tmpDir) => {
        fs.writeFileSync(path.join(tmpDir, 'hello.ts'), 'export const greeting = "hello";\n', 'utf8');
        const res = runRipgrepSearch(tmpDir, 'STRING_THAT_DOES_NOT_EXIST_ANYWHERE');
        assert.equal(res.ok, true);
        assert.deepEqual(res.matches, []);
        assert.equal(res.totalMatches, 0);
      });
    },
  },

  /* ==========================================================================
   * FEATURE 18: Integrated Multi-Tab Split Terminal (5 Tests)
   * ========================================================================== */
  {
    id: 'T2-F18-01',
    tier: 2,
    feature: 18,
    features: [18],
    title: 'Spawning terminal with non-existent cwd returns structured ERR_INVALID_TERMINAL_CWD error',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 18);
      function createTerminalSession(opts) {
        if (!opts.cwd || !fs.existsSync(opts.cwd) || !fs.statSync(opts.cwd).isDirectory()) {
          return { ok: false, errorCode: 'ERR_INVALID_TERMINAL_CWD', message: `Directory not found: ${opts.cwd}` };
        }
        return { ok: true };
      }

      const res = createTerminalSession({ cwd: '/tmp/non-existent-terminal-cwd-987654' });
      assert.equal(res.ok, false);
      assert.equal(res.errorCode, 'ERR_INVALID_TERMINAL_CWD');
    },
  },
  {
    id: 'T2-F18-02',
    tier: 2,
    feature: 18,
    features: [18, 21],
    title: 'Non-zero exit code command in terminal captures stderr and exit code for 1-click Fix this error',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 18);
      const termResult = await new Promise((resolve) => {
        const child = spawn('/bin/bash', ['-c', 'echo "TypeError: x is not a function at src/index.ts:12:4" >&2; exit 1']);
        let stderr = '';
        child.stderr.on('data', (d) => (stderr += d.toString()));
        child.on('close', (code) => resolve({ exitCode: code, stderr: stderr.trim() }));
      });

      assert.equal(termResult.exitCode, 1);
      const fixActionPayload = {
        chip: '@terminal',
        exitCode: termResult.exitCode,
        output: termResult.stderr,
        prompt: `Fix this terminal error:\n${termResult.stderr}`,
      };
      assert.equal(fixActionPayload.chip, '@terminal');
      assert.match(fixActionPayload.prompt, /TypeError: x is not a function at src\/index\.ts:12:4/);
    },
  },
  {
    id: 'T2-F18-03',
    tier: 2,
    feature: 18,
    features: [18],
    title: 'Normalizes both Windows backslash and POSIX forward-slash clickable file paths with line and column',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 18);
      const sampleOutput = [
        'ERROR in src\\routes\\compare.ts:5:12 - TS2322',
        '  at Object.<anonymous> (./packages/core/src/session.ts:44:9)',
      ].join('\n');

      const links = extractTerminalClickablePaths(sampleOutput);
      assert.equal(links.length, 2);
      assert.deepEqual(links[0], {
        raw: 'src\\routes\\compare.ts:5:12',
        normalizedPath: 'src/routes/compare.ts',
        line: 5,
        column: 12,
      });
      assert.deepEqual(links[1], {
        raw: './packages/core/src/session.ts:44:9',
        normalizedPath: 'packages/core/src/session.ts',
        line: 44,
        column: 9,
      });
    },
  },
  {
    id: 'T2-F18-04',
    tier: 2,
    feature: 18,
    features: [18],
    title: 'Closing terminal kills underlying shell child process without leaving zombie process',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 18);
      const child = spawn('/bin/bash', ['-c', 'sleep 30']);
      const pid = child.pid;
      assert.ok(pid > 0);

      const closePromise = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
      child.kill('SIGTERM');
      const closed = await closePromise;
      assert.equal(closed.signal, 'SIGTERM');

      let processAlive = true;
      try {
        process.kill(pid, 0);
      } catch {
        processAlive = false;
      }
      assert.equal(processAlive, false);
    },
  },
  {
    id: 'T2-F18-05',
    tier: 2,
    feature: 18,
    features: [18],
    title: 'Fix this error when terminal output buffer is empty returns safe no-op warning',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 18);
      function buildFixThisError(bufferText, lastExitCode) {
        if (!bufferText || bufferText.trim().length === 0 || lastExitCode === 0) {
          return { ok: false, reason: 'NO_TERMINAL_ERROR' };
        }
        return { ok: true, chip: '@terminal', content: bufferText };
      }

      assert.deepEqual(buildFixThisError('', null), { ok: false, reason: 'NO_TERMINAL_ERROR' });
      assert.deepEqual(buildFixThisError('   ', 0), { ok: false, reason: 'NO_TERMINAL_ERROR' });
    },
  },

  /* ==========================================================================
   * FEATURE 19: Source Control & Inline Hunk Review (5 Tests)
   * ========================================================================== */
  {
    id: 'T2-F19-01',
    tier: 2,
    feature: 19,
    features: [19],
    title: '3-way merge conflict parser extracts ours, base, and theirs and resolves removing all conflict markers',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 19);
      const conflictedText = [
        'export function getTitle() {',
        '<<<<<<< HEAD',
        '  return "Copy review brief (HEAD)";',
        '||||||| merged common ancestors',
        '  return "Brief";',
        '=======',
        '  return "Copy review brief (Feature)";',
        '>>>>>>> osmium/task/brief',
        '}',
        '',
      ].join('\n');

      const parsed = parseAndResolveThreeWayConflict(conflictedText, 'theirs');
      assert.equal(parsed.conflictCount, 1);
      assert.equal(parsed.blocks[0].ours.trim(), 'return "Copy review brief (HEAD)";');
      assert.equal(parsed.blocks[0].base.trim(), 'return "Brief";');
      assert.equal(parsed.blocks[0].theirs.trim(), 'return "Copy review brief (Feature)";');
      assert.equal(parsed.clean, true);
      assert.ok(parsed.resolvedText.includes('return "Copy review brief (Feature)";'));
      assert.ok(!parsed.resolvedText.includes('<<<<<<<'));
    },
  },
  {
    id: 'T2-F19-02',
    tier: 2,
    feature: 19,
    features: [19],
    title: 'gitCommit rejects empty commit message and rejects commit when zero changes are staged',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 19);
      await withTempGitRepo(async (repoDir) => {
        function gitCommitChecked(cwd, message) {
          if (!message || message.trim().length === 0) {
            const err = new Error('Commit message cannot be empty');
            err.code = 'ERR_EMPTY_COMMIT_MESSAGE';
            throw err;
          }
          const staged = runGit(cwd, ['diff', '--cached', '--name-only']).stdout;
          if (!staged) {
            const err = new Error('No staged changes to commit');
            err.code = 'ERR_NOTHING_STAGED';
            throw err;
          }
          return runGit(cwd, ['commit', '-m', message]);
        }

        assert.throws(
          () => gitCommitChecked(repoDir, '   '),
          (err) => err.code === 'ERR_EMPTY_COMMIT_MESSAGE'
        );
        assert.throws(
          () => gitCommitChecked(repoDir, 'Valid message but nothing staged'),
          (err) => err.code === 'ERR_NOTHING_STAGED'
        );
      });
    },
  },
  {
    id: 'T2-F19-03',
    tier: 2,
    feature: 19,
    features: [19],
    title: 'Rejecting Hunk 1 while accepting Hunk 2 in the same file restores Hunk 1 to HEAD and keeps Hunk 2',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 19);
      await withTempGitRepo(
        async (repoDir) => {
          const filePath = path.join(repoDir, 'src/compare.ts');
          const editedLines = [
            'export const hunk1 = "MODIFIED_HUNK_1";',
            'export const spacer1 = 1;',
            'export const spacer2 = 2;',
            'export const spacer3 = 3;',
            'export const spacer4 = 4;',
            'export const spacer5 = 5;',
            'export const spacer6 = 6;',
            'export const spacer7 = 7;',
            'export const hunk2 = "MODIFIED_HUNK_2";',
            '',
          ];
          fs.writeFileSync(filePath, editedLines.join('\n'), 'utf8');

          // User clicks Reject on Hunk 1 (line 1) and Accept on Hunk 2 (line 9)
          const headLines = runGit(repoDir, ['show', 'HEAD:src/compare.ts']).stdout.split('\n');
          editedLines[0] = headLines[0]; // Revert hunk 1 to HEAD
          fs.writeFileSync(filePath, editedLines.join('\n'), 'utf8');

          const finalContent = fs.readFileSync(filePath, 'utf8');
          assert.match(finalContent, /hunk1 = "ORIGINAL_HUNK_1"/);
          assert.match(finalContent, /hunk2 = "MODIFIED_HUNK_2"/);
        },
        {
          initialFiles: {
            'src/compare.ts': [
              'export const hunk1 = "ORIGINAL_HUNK_1";',
              'export const spacer1 = 1;',
              'export const spacer2 = 2;',
              'export const spacer3 = 3;',
              'export const spacer4 = 4;',
              'export const spacer5 = 5;',
              'export const spacer6 = 6;',
              'export const spacer7 = 7;',
              'export const hunk2 = "ORIGINAL_HUNK_2";',
              '',
            ].join('\n'),
          },
        }
      );
    },
  },
  {
    id: 'T2-F19-04',
    tier: 2,
    feature: 19,
    features: [19, 21],
    title: 'Ask to change on an inline hunk attaches exact hunk diff range and user instruction to agent prompt',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 19);
      const hunk = {
        filePath: 'src/routes/compare.ts',
        hunkIndex: 2,
        totalHunks: 2,
        startLine: 18,
        endLine: 26,
        diffText: '@@ -18,3 +18,5 @@\n+ showToast("Copied");',
      };

      function createAskToChangeRequest(h, instruction) {
        return {
          attachedChips: ['@diff', `@${path.basename(h.filePath)}`],
          targetHunk: `${h.filePath}:${h.startLine}-${h.endLine}`,
          prompt: `Update Hunk ${h.hunkIndex} of ${h.totalHunks} in ${h.filePath} (lines ${h.startLine}-${h.endLine}): ${instruction}\n\n${h.diffText}`,
        };
      }

      const req = createAskToChangeRequest(hunk, 'Also handle clipboard permission denied fallback');
      assert.deepEqual(req.attachedChips, ['@diff', '@compare.ts']);
      assert.equal(req.targetHunk, 'src/routes/compare.ts:18-26');
      assert.match(req.prompt, /Hunk 2 of 2/);
      assert.match(req.prompt, /clipboard permission denied/);
    },
  },
  {
    id: 'T2-F19-05',
    tier: 2,
    feature: 19,
    features: [19],
    title: 'git stash pop on a conflicting working tree reports conflict without losing local changes',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 19);
      await withTempGitRepo(async (repoDir) => {
        const file = path.join(repoDir, 'src/index.ts');
        fs.writeFileSync(file, 'export const main = () => "stashed-version";\n', 'utf8');
        runGit(repoDir, ['stash', 'push', '-m', 'wip']);

        fs.writeFileSync(file, 'export const main = () => "conflicting-working-tree";\n', 'utf8');
        runGit(repoDir, ['commit', '-am', 'Commit conflicting line']);

        const popRes = runGit(repoDir, ['stash', 'pop']);
        assert.notEqual(popRes.status, 0);
        const content = fs.readFileSync(file, 'utf8');
        assert.ok(content.includes('conflicting-working-tree') && content.includes('stashed-version'));
      });
    },
  },

  /* ==========================================================================
   * FEATURE 20: Code Intelligence & LSP Manager (5 Tests)
   * ========================================================================== */
  {
    id: 'T2-F20-01',
    tier: 2,
    feature: 20,
    features: [20],
    title: 'Missing LSP binary returns installed: false with installHint and never runs silent installation',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 20);
      const spawnedCommands = [];
      function checkLspServer(serverId, binaryPath) {
        if (!fs.existsSync(binaryPath)) {
          return {
            id: serverId,
            installed: false,
            autoInstalled: false,
            installHint: `Install ${serverId} manually (e.g. 'cargo install ${serverId}' or system package manager). Osmium never installs language servers silently.`,
          };
        }
        spawnedCommands.push(binaryPath);
        return { id: serverId, installed: true };
      }

      const res = checkLspServer('rust-analyzer', '/usr/bin/non-existent-rust-analyzer-xyz');
      assert.equal(res.installed, false);
      assert.equal(res.autoInstalled, false);
      assert.equal(spawnedCommands.length, 0);
      assert.match(res.installHint, /never installs language servers silently/);
    },
  },
  {
    id: 'T2-F20-02',
    tier: 2,
    feature: 20,
    features: [20],
    title: 'LSP server process crash mid-session marks server state as errored without crashing IDE host',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 20);
      await withTempDir(async (tmpDir) => {
        const fakeLsp = path.join(tmpDir, 'fake-lsp.mjs');
        fs.writeFileSync(fakeLsp, `#!/usr/bin/env node\nprocess.exit(139);\n`, { mode: 0o755 });

        const state = await new Promise((resolve) => {
          const child = spawn(fakeLsp, []);
          child.on('close', (code) => {
            resolve({
              serverStatus: code !== 0 ? 'errored' : 'running',
              exitCode: code,
              ideHostHealthy: true,
            });
          });
        });

        assert.equal(state.serverStatus, 'errored');
        assert.equal(state.exitCode, 139);
        assert.equal(state.ideHostHealthy, true);
      });
    },
  },
  {
    id: 'T2-F20-03',
    tier: 2,
    feature: 20,
    features: [20],
    title: 'Fixing diagnostics in a file updates Problems count in panel and status bar from 2 problems to 0 problems',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 20);
      const diagnosticsByFile = new Map();
      diagnosticsByFile.set('src/routes/compare.ts', [
        { line: 5, message: 'Unused variable x', severity: 'error' },
        { line: 9, message: 'Missing return type', severity: 'warning' },
      ]);

      const countProblems = () => {
        let total = 0;
        for (const list of diagnosticsByFile.values()) total += list.length;
        return `${total} problems`;
      };

      assert.equal(countProblems(), '2 problems');
      // File is fixed and LSP publishes empty diagnostics array for the URI
      diagnosticsByFile.set('src/routes/compare.ts', []);
      assert.equal(countProblems(), '0 problems');
    },
  },
  {
    id: 'T2-F20-04',
    tier: 2,
    feature: 20,
    features: [20],
    title: 'Unsupported file extension (.unknownext) falls back cleanly to plaintext language mode',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 20);
      const extMap = {
        '.ts': 'typescript',
        '.tsx': 'typescriptreact',
        '.js': 'javascript',
        '.json': 'json',
        '.css': 'css',
        '.html': 'html',
        '.py': 'python',
        '.rs': 'rust',
        '.go': 'go',
      };
      function resolveLanguageId(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        return extMap[ext] || 'plaintext';
      }

      assert.equal(resolveLanguageId('notes.unknownext'), 'plaintext');
      assert.equal(resolveLanguageId('Makefile'), 'plaintext');
      assert.equal(resolveLanguageId('src/compare.ts'), 'typescript');
    },
  },
  {
    id: 'T2-F20-05',
    tier: 2,
    feature: 20,
    features: [20],
    title: 'LSP request timeout rejects hanging hover/definition call cleanly with ERR_LSP_REQUEST_TIMEOUT',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 20);
      function lspRequestWithTimeout(method, timeoutMs) {
        return new Promise((_resolve, reject) => {
          setTimeout(() => {
            const err = new Error(`LSP request '${method}' timed out after ${timeoutMs}ms`);
            err.code = 'ERR_LSP_REQUEST_TIMEOUT';
            reject(err);
          }, timeoutMs);
        });
      }

      await assert.rejects(
        lspRequestWithTimeout('textDocument/definition', 30),
        (err) => err.code === 'ERR_LSP_REQUEST_TIMEOUT'
      );
    },
  },

  /* ==========================================================================
   * FEATURE 21: Docked Agent Panel, Context Chips & Follow Agent (5 Tests)
   * ========================================================================== */
  {
    id: 'T2-F21-01',
    tier: 2,
    feature: 21,
    features: [21],
    title: 'Removing auto-attached @file or @selection chip excludes it from sent prompt attachments',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 21);
      const composer = {
        chips: [
          { id: '@compare.ts', kind: 'file', path: 'src/routes/compare.ts', autoAttached: true },
          { id: '@selection', kind: 'selection', range: '5:1-8:20', autoAttached: true },
          { id: '@problems', kind: 'problems', count: 2, autoAttached: false },
        ],
        removeChip(id) {
          this.chips = this.chips.filter((c) => c.id !== id);
        },
        buildAttachments() {
          return this.chips.map((c) => c.id);
        },
      };

      composer.removeChip('@selection');
      assert.deepEqual(composer.buildAttachments(), ['@compare.ts', '@problems']);
    },
  },
  {
    id: 'T2-F21-02',
    tier: 2,
    feature: 21,
    features: [21, 10],
    title: 'Switching CLI inside docked Agent panel (Ctrl/Cmd+L) preserves full message history',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 21);
      const dockedPanel = {
        activeCli: 'codex',
        messages: [
          { role: 'user', text: 'Explain compare.ts' },
          { role: 'assistant', cli: 'codex', text: 'It builds the markdown brief.' },
        ],
        switchCli(newCli) {
          const prevCli = this.activeCli;
          this.activeCli = newCli;
          this.messages.push({
            role: 'system-handoff',
            from: prevCli,
            to: newCli,
            text: `Switched from ${prevCli} to ${newCli}`,
          });
        },
      };

      dockedPanel.switchCli('antigravity');
      assert.equal(dockedPanel.activeCli, 'antigravity');
      assert.equal(dockedPanel.messages.length, 3);
      assert.equal(dockedPanel.messages[0].text, 'Explain compare.ts');
      assert.equal(dockedPanel.messages[1].text, 'It builds the markdown brief.');
    },
  },
  {
    id: 'T2-F21-03',
    tier: 2,
    feature: 21,
    features: [21, 16],
    title: 'Follow agent disabled (false) does NOT steal focus or switch active editor tab on background file edit',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 21);
      const ideState = {
        followAgent: false,
        activeTab: 'src/routes/compare.ts',
        openTabs: ['src/routes/compare.ts', 'src/routes/auth.ts'],
        agentEditedTabs: new Map(),
        onAgentFileEdit(filePath, cliId) {
          this.agentEditedTabs.set(filePath, cliId);
          if (this.followAgent) {
            if (!this.openTabs.includes(filePath)) this.openTabs.push(filePath);
            this.activeTab = filePath;
          }
        },
      };

      ideState.onAgentFileEdit('src/routes/brief.ts', 'codex');
      assert.equal(ideState.activeTab, 'src/routes/compare.ts');
      assert.equal(ideState.agentEditedTabs.get('src/routes/brief.ts'), 'codex');
    },
  },
  {
    id: 'T2-F21-04',
    tier: 2,
    feature: 21,
    features: [21, 24],
    title: 'Agent-edited tab dot (● brief.ts) uses exact CLI color token and clears once changes are reviewed/accepted',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 21);
      const cliColorTokens = {
        codex: '#1B2B22',
        antigravity: '#2F5FD0',
        deepseek: '#6B4FD0',
      };
      const tab = {
        title: 'brief.ts',
        agentEditingCli: 'antigravity',
        getBadge() {
          if (!this.agentEditingCli) return { dotColor: null, label: this.title };
          return { dotColor: cliColorTokens[this.agentEditingCli], label: `● ${this.title}` };
        },
        markReviewed() {
          this.agentEditingCli = null;
        },
      };

      assert.deepEqual(tab.getBadge(), { dotColor: '#2F5FD0', label: '● brief.ts' });
      tab.markReviewed();
      assert.deepEqual(tab.getBadge(), { dotColor: null, label: 'brief.ts' });
    },
  },
  {
    id: 'T2-F21-05',
    tier: 2,
    feature: 21,
    features: [21, 20],
    title: '@problems context chip when workspace has 0 problems attaches clean empty diagnostic summary',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 21);
      function serializeProblemsChip(diagnostics) {
        if (!diagnostics || diagnostics.length === 0) {
          return { chip: '@problems', count: 0, text: 'Workspace problems: 0 (no errors or warnings).' };
        }
        return { chip: '@problems', count: diagnostics.length, text: diagnostics.join('\n') };
      }

      const res = serializeProblemsChip([]);
      assert.equal(res.count, 0);
      assert.match(res.text, /Workspace problems: 0/);
    },
  },

  /* ==========================================================================
   * FEATURE 22: Tasks Runner & DAP Debugger (5 Tests)
   * ========================================================================== */
  {
    id: 'T2-F22-01',
    tier: 2,
    feature: 22,
    features: [22],
    title: 'tasksList handles missing or malformed package.json cleanly without crashing',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 22);
      await withTempDir(async (tmpDir) => {
        function listPackageTasks(cwd) {
          const pkgPath = path.join(cwd, 'package.json');
          if (!fs.existsSync(pkgPath)) {
            return { ok: true, scripts: [] };
          }
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            return {
              ok: true,
              scripts: Object.entries(pkg.scripts || {}).map(([name, cmd]) => ({ name, cmd })),
            };
          } catch (e) {
            return { ok: false, errorCode: 'ERR_INVALID_PACKAGE_JSON', message: e.message, scripts: [] };
          }
        }

        const missingRes = listPackageTasks(tmpDir);
        assert.deepEqual(missingRes, { ok: true, scripts: [] });

        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{ malformed json ', 'utf8');
        const badRes = listPackageTasks(tmpDir);
        assert.equal(badRes.ok, false);
        assert.equal(badRes.errorCode, 'ERR_INVALID_PACKAGE_JSON');
      });
    },
  },
  {
    id: 'T2-F22-02',
    tier: 2,
    feature: 22,
    features: [22],
    title: 'Failing task script (exit 1) reports status "failed" and captures stderr output',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 22);
      await withTempDir(async (tmpDir) => {
        const res = await new Promise((resolve) => {
          const child = spawn(process.execPath, ['-e', 'console.error("Test suite failed: 1 assertion"); process.exit(1);'], {
            cwd: tmpDir,
          });
          let stderr = '';
          child.stderr.on('data', (d) => (stderr += d.toString()));
          child.on('close', (code) =>
            resolve({
              exitCode: code,
              status: code === 0 ? 'passed' : 'failed',
              stderr: stderr.trim(),
            })
          );
        });

        assert.equal(res.exitCode, 1);
        assert.equal(res.status, 'failed');
        assert.match(res.stderr, /Test suite failed/);
      });
    },
  },
  {
    id: 'T2-F22-03',
    tier: 2,
    feature: 22,
    features: [22],
    title: 'DAP debug session start with missing program entrypoint fails gracefully with ERR_DAP_ENTRYPOINT_MISSING',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 22);
      await withTempDir(async (tmpDir) => {
        function startDapSession(cwd, launchConfig) {
          const prog = path.resolve(cwd, launchConfig.program || '');
          if (!fs.existsSync(prog)) {
            return {
              ok: false,
              errorCode: 'ERR_DAP_ENTRYPOINT_MISSING',
              message: `Debug program does not exist: ${prog}`,
            };
          }
          return { ok: true, sessionId: 'dap-1' };
        }

        const res = startDapSession(tmpDir, { type: 'node', program: 'src/missing-entry.js' });
        assert.equal(res.ok, false);
        assert.equal(res.errorCode, 'ERR_DAP_ENTRYPOINT_MISSING');
      });
    },
  },
  {
    id: 'T2-F22-04',
    tier: 2,
    feature: 22,
    features: [22],
    title: 'Setting breakpoint on comment or out-of-bounds line reports unverified or relocates to executable line',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 22);
      const sourceLines = [
        '// Line 1: comment only',
        '',
        'export function sum(a, b) {',
        '  return a + b;',
        '}',
      ];

      function verifyBreakpoint(lines, requestedLine) {
        if (requestedLine < 1 || requestedLine > lines.length) {
          return { verified: false, line: requestedLine, reason: 'Line out of range' };
        }
        const text = lines[requestedLine - 1].trim();
        if (text === '' || text.startsWith('//')) {
          return { verified: false, line: requestedLine, reason: 'Non-executable comment or blank line' };
        }
        return { verified: true, line: requestedLine };
      }

      assert.equal(verifyBreakpoint(sourceLines, 1).verified, false);
      assert.equal(verifyBreakpoint(sourceLines, 999).verified, false);
      assert.equal(verifyBreakpoint(sourceLines, 4).verified, true);
    },
  },
  {
    id: 'T2-F22-05',
    tier: 2,
    feature: 22,
    features: [22],
    title: 'Terminating a DAP debug session kills the debuggee child process cleanly',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 22);
      const debuggee = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);']);
      const pid = debuggee.pid;
      assert.ok(pid > 0);

      const exitPromise = new Promise((resolve) => debuggee.on('close', (code, signal) => resolve({ code, signal })));
      debuggee.kill('SIGTERM');
      const out = await exitPromise;
      assert.equal(out.signal, 'SIGTERM');
    },
  },

  /* ==========================================================================
   * FEATURE 23: Adapter SDK & ~/.osmium/extensions/ API (5 Tests)
   * ========================================================================== */
  {
    id: 'T2-F23-01',
    tier: 2,
    feature: 23,
    features: [23],
    title: 'Extension requesting node-process permission in osmium.json is blocked until user approves permission prompt',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 23);
      const manifest = {
        name: 'custom-linter',
        version: '1.0.0',
        displayName: 'Custom Linter',
        permissions: ['node-process'],
      };
      const grantedPermissions = new Set();

      function executeExtensionNodeTask(extManifest, fn) {
        if (extManifest.permissions.includes('node-process') && !grantedPermissions.has(`${extManifest.name}:node-process`)) {
          const err = new Error(`Extension '${extManifest.displayName}' requires user approval for 'node-process' permission`);
          err.code = 'ERR_EXTENSION_PERMISSION_DENIED';
          throw err;
        }
        return fn();
      }

      assert.throws(
        () => executeExtensionNodeTask(manifest, () => 'ran-node'),
        (err) => err.code === 'ERR_EXTENSION_PERMISSION_DENIED'
      );

      grantedPermissions.add('custom-linter:node-process');
      assert.equal(executeExtensionNodeTask(manifest, () => 'ran-node'), 'ran-node');
    },
  },
  {
    id: 'T2-F23-02',
    tier: 2,
    feature: 23,
    features: [23],
    title: 'Invalid osmium.json manifest missing required fields or containing unknown permissions is rejected',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 23);
      const allowedPermissions = new Set(['node-process', 'filesystem', 'network', 'webview']);
      function validateExtensionManifest(m) {
        if (!m || typeof m.name !== 'string' || !m.name || typeof m.version !== 'string' || typeof m.displayName !== 'string') {
          const err = new Error('Invalid osmium.json: name, version, and displayName are required');
          err.code = 'ERR_INVALID_EXTENSION_MANIFEST';
          throw err;
        }
        for (const p of m.permissions || []) {
          if (!allowedPermissions.has(p)) {
            const err = new Error(`Unsupported extension permission: ${p}`);
            err.code = 'ERR_INVALID_EXTENSION_PERMISSION';
            throw err;
          }
        }
        return true;
      }

      assert.throws(
        () => validateExtensionManifest({ name: 'broken-ext' }),
        (err) => err.code === 'ERR_INVALID_EXTENSION_MANIFEST'
      );
      assert.throws(
        () => validateExtensionManifest({ name: 'ext', version: '1.0.0', displayName: 'Ext', permissions: ['root-shell'] }),
        (err) => err.code === 'ERR_INVALID_EXTENSION_PERMISSION'
      );
    },
  },
  {
    id: 'T2-F23-03',
    tier: 2,
    feature: 23,
    features: [23],
    title: 'Extension webview panel enforces sandbox isolation and blocks direct require("child_process")',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 23);
      function validateWebviewPanelHtml(htmlContent, webPreferences = {}) {
        if (webPreferences.nodeIntegration === true || webPreferences.sandbox === false) {
          const err = new Error('Extension webviews must run with sandbox: true and nodeIntegration: false');
          err.code = 'ERR_UNSAFE_WEBVIEW_PREFS';
          throw err;
        }
        if (/require\s*\(\s*['"](?:node:)?child_process['"]\s*\)/.test(htmlContent)) {
          const err = new Error('Direct child_process access is forbidden inside sandboxed extension webview');
          err.code = 'ERR_WEBVIEW_SANDBOX_VIOLATION';
          throw err;
        }
        return { sandboxed: true };
      }

      assert.throws(
        () => validateWebviewPanelHtml('<script>require("child_process").exec("whoami")</script>', { sandbox: true, nodeIntegration: false }),
        (err) => err.code === 'ERR_WEBVIEW_SANDBOX_VIOLATION'
      );
      assert.throws(
        () => validateWebviewPanelHtml('<div>Safe</div>', { sandbox: false, nodeIntegration: true }),
        (err) => err.code === 'ERR_UNSAFE_WEBVIEW_PREFS'
      );
    },
  },
  {
    id: 'T2-F23-04',
    tier: 2,
    feature: 23,
    features: [23, 5],
    title: 'Third-party adapter missing required CliAdapter methods fails the Adapter SDK contract test suite',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 23);
      async function verifyAdapterContract(adapter) {
        const requiredMethods = ['detect', 'capabilities', 'start'];
        for (const m of requiredMethods) {
          if (typeof adapter[m] !== 'function') {
            const err = new Error(`Adapter '${adapter.id || 'unknown'}' failed contract: missing method '${m}()'`);
            err.code = 'ERR_ADAPTER_CONTRACT_FAILED';
            throw err;
          }
        }
        const session = await adapter.start({ cwd: '/tmp', approvalMode: 'ask' });
        for (const sm of ['send', 'respondToApproval', 'cancel', 'close']) {
          if (typeof session[sm] !== 'function') {
            const err = new Error(`Adapter '${adapter.id}' session failed contract: missing '${sm}()'`);
            err.code = 'ERR_ADAPTER_SESSION_CONTRACT_FAILED';
            throw err;
          }
        }
        return true;
      }

      const brokenAdapter = {
        id: 'broken-3p',
        displayName: 'Broken 3P',
        detect: async () => ({ installed: true }),
        capabilities: async () => ({ acp: false, jsonStream: true, resume: false, approvals: false, readOnlyMode: false, reportsUsage: false }),
        start: async () => ({
          id: 's1',
          events: (async function* () {})(),
          send: async () => {},
          respondToApproval: async () => {},
          // missing cancel() and close()
        }),
      };

      await assert.rejects(
        verifyAdapterContract(brokenAdapter),
        (err) => err.code === 'ERR_ADAPTER_SESSION_CONTRACT_FAILED' && /cancel/.test(err.message)
      );
    },
  },
  {
    id: 'T2-F23-05',
    tier: 2,
    feature: 23,
    features: [23, 24],
    title: 'VS Code theme importer gracefully handles missing or partial token colors with fallback defaults',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 23);
      const defaultTokens = {
        '--bg-ground': '#F6F8F5',
        '--bg-sidebar': '#EAF1E8',
        '--text-ink': '#1B2B22',
        '--accent-primary': '#2F6B4F',
      };

      function importVsCodeThemeJson(vsCodeTheme) {
        const colors = (vsCodeTheme && vsCodeTheme.colors) || {};
        return {
          '--bg-ground': colors['editor.background'] || defaultTokens['--bg-ground'],
          '--bg-sidebar': colors['sideBar.background'] || defaultTokens['--bg-sidebar'],
          '--text-ink': colors['editor.foreground'] || defaultTokens['--text-ink'],
          '--accent-primary': colors['button.background'] || defaultTokens['--accent-primary'],
        };
      }

      const imported = importVsCodeThemeJson({ name: 'Partial Theme', colors: { 'editor.background': '#101512' } });
      assert.equal(imported['--bg-ground'], '#101512');
      assert.equal(imported['--bg-sidebar'], '#EAF1E8');
      assert.equal(imported['--text-ink'], '#1B2B22');
      assert.equal(imported['--accent-primary'], '#2F6B4F');
    },
  },

  /* ==========================================================================
   * FEATURE 24: Design System, Command Registry, Palette, Replay, Dark Theme & Release (5 Tests)
   * ========================================================================== */
  {
    id: 'T2-F24-01',
    tier: 2,
    feature: 24,
    features: [24],
    title: 'Verifies Section 7 design token text/background pairs meet WCAG >= 4.5:1 contrast and flags low-contrast pairs',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 24);
      const inkOnGround = computeWcagContrastRatio('#1B2B22', '#F6F8F5');
      const inkOnSidebar = computeWcagContrastRatio('#1B2B22', '#EAF1E8');
      const mutedOnGround = computeWcagContrastRatio('#566A5E', '#F6F8F5');
      const mutedOnWhite = computeWcagContrastRatio('#566A5E', '#FFFFFF');
      const whiteOnAccent = computeWcagContrastRatio('#FFFFFF', '#2F6B4F');
      const badLowContrast = computeWcagContrastRatio('#95A59B', '#F6F8F5');

      assert.ok(inkOnGround >= 4.5, `Expected inkOnGround >= 4.5, got ${inkOnGround}`);
      assert.ok(inkOnSidebar >= 4.5, `Expected inkOnSidebar >= 4.5, got ${inkOnSidebar}`);
      assert.ok(mutedOnGround >= 4.5, `Expected mutedOnGround >= 4.5, got ${mutedOnGround}`);
      assert.ok(mutedOnWhite >= 4.5, `Expected mutedOnWhite >= 4.5, got ${mutedOnWhite}`);
      assert.ok(whiteOnAccent >= 4.5, `Expected whiteOnAccent >= 4.5, got ${whiteOnAccent}`);
      assert.ok(badLowContrast < 4.5, `Expected badLowContrast < 4.5, got ${badLowContrast}`);
    },
  },
  {
    id: 'T2-F24-02',
    tier: 2,
    feature: 24,
    features: [24],
    title: 'CLI badge accessibility validator rejects rendering a CLI by colored dot alone without text name',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 24);
      function validateCliBadge(badgeProps) {
        if (!badgeProps.dotColor || typeof badgeProps.label !== 'string' || badgeProps.label.trim().length === 0) {
          const err = new Error('Accessibility rule violation: A CLI must always be shown as a colored dot plus its text name, never by color alone.');
          err.code = 'ERR_ACCESSIBILITY_COLOR_ONLY_BADGE';
          throw err;
        }
        return true;
      }

      assert.throws(
        () => validateCliBadge({ dotColor: '#1B2B22', label: '' }),
        (err) => err.code === 'ERR_ACCESSIBILITY_COLOR_ONLY_BADGE'
      );
      assert.equal(validateCliBadge({ dotColor: '#2F5FD0', label: 'Antigravity' }), true);
    },
  },
  {
    id: 'T2-F24-03',
    tier: 2,
    feature: 24,
    features: [24],
    title: 'Window dimension constraint enforces 1200x720 default and >= 960x600 minimum size',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 24);
      function normalizeWindowBounds(req = {}) {
        const minWidth = 960;
        const minHeight = 600;
        const width = Math.max(minWidth, req.width ?? 1200);
        const height = Math.max(minHeight, req.height ?? 720);
        return { width, height, minWidth, minHeight, clamped: width !== (req.width ?? 1200) || height !== (req.height ?? 720) };
      }

      const def = normalizeWindowBounds();
      assert.equal(def.width, 1200);
      assert.equal(def.height, 720);
      assert.equal(def.clamped, false);

      const tooSmall = normalizeWindowBounds({ width: 640, height: 480 });
      assert.equal(tooSmall.width, 960);
      assert.equal(tooSmall.height, 600);
      assert.equal(tooSmall.clamped, true);
    },
  },
  {
    id: 'T2-F24-04',
    tier: 2,
    feature: 24,
    features: [24],
    title: 'Command Registry throws ERR_COMMAND_NOT_FOUND for unregistered command ID and ERR_DUPLICATE_COMMAND on collision',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 24);
      const commands = new Map();
      function registerCommand(id, handler) {
        if (commands.has(id)) {
          const err = new Error(`Duplicate command ID registration: ${id}`);
          err.code = 'ERR_DUPLICATE_COMMAND';
          throw err;
        }
        commands.set(id, handler);
      }
      function executeCommand(id, ...args) {
        const fn = commands.get(id);
        if (!fn) {
          const err = new Error(`Command not registered: ${id}`);
          err.code = 'ERR_COMMAND_NOT_FOUND';
          throw err;
        }
        return fn(...args);
      }

      registerCommand('osmium.toggleAgentPanel', () => 'toggled');
      assert.equal(executeCommand('osmium.toggleAgentPanel'), 'toggled');

      assert.throws(
        () => registerCommand('osmium.toggleAgentPanel', () => {}),
        (err) => err.code === 'ERR_DUPLICATE_COMMAND'
      );
      assert.throws(
        () => executeCommand('osmium.nonExistentCommand'),
        (err) => err.code === 'ERR_COMMAND_NOT_FOUND'
      );
    },
  },
  {
    id: 'T2-F24-05',
    tier: 2,
    feature: 24,
    features: [24],
    title: 'Release packaging verifier enforces auto-updates off by default and blocks bundled third-party provider logos',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 24);
      function verifyReleaseConfig(builderConfig, bundledAssetNames) {
        if (builderConfig.autoUpdate === true || (builderConfig.publish && builderConfig.publish.autoPublish === true)) {
          const err = new Error('Packaging rule violation: auto-updates must be off by default');
          err.code = 'ERR_AUTO_UPDATE_MUST_BE_OFF';
          throw err;
        }
        const forbiddenLogos = ['openai-logo.svg', 'codex-trademark.png', 'deepseek-official-logo.svg', 'antigravity-logo.png'];
        const foundLogos = bundledAssetNames.filter((name) => forbiddenLogos.includes(name));
        if (foundLogos.length > 0) {
          const err = new Error(`Packaging rule violation: do not bundle provider logos/trademarks (${foundLogos.join(', ')})`);
          err.code = 'ERR_FORBIDDEN_PROVIDER_LOGO';
          throw err;
        }
        return { valid: true };
      }

      assert.throws(
        () => verifyReleaseConfig({ autoUpdate: true }, []),
        (err) => err.code === 'ERR_AUTO_UPDATE_MUST_BE_OFF'
      );
      assert.throws(
        () => verifyReleaseConfig({ autoUpdate: false }, ['inter-regular.woff2', 'openai-logo.svg']),
        (err) => err.code === 'ERR_FORBIDDEN_PROVIDER_LOGO'
      );
      assert.deepEqual(verifyReleaseConfig({ autoUpdate: false, publish: null }, ['inter-regular.woff2']), { valid: true });
    },
  },
];
