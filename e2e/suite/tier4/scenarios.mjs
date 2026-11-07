import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DESIGN_TOKENS_DARK,
  DESIGN_TOKENS_LIGHT,
  runGit,
  withTempOsmiumEnv,
} from '../helpers/t34-harness.mjs';

export const tests = [
  {
    id: 'T4-SC-01',
    tier: 4,
    feature: 4,
    features: [1, 2, 4, 9, 24],
    title: 'First Run, Project Open, & CLI Hub Detection + Capability Probe + Home Screen Status Chips',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [1, 2, 4, 9, 24], async ({ app, repoDir, mockCliPath }) => {
        const docs = app.initGovernanceAndPlanDocs(repoDir);
        assert.ok(fs.existsSync(docs.planFile), 'docs/PLAN.md must be initialized on first run');
        assert.ok(fs.existsSync(docs.progressFile), 'docs/PROGRESS.md must be initialized on first run');

        const opened = app.openProject('api-gateway', {
          primary: 'codex',
          secondary: ['antigravity', 'deepseek'],
          approvalMode: 'ask',
        });
        assert.equal(opened.projectId, 'proj-api-gateway');
        assert.ok(fs.existsSync(opened.configPath), '.osmium/project.yaml must exist');
        assert.ok(fs.existsSync(app.dbPath), '.osmium/osmium.db SQLite database must exist');

        const mockProbe = app.probeCli('mock', { binaryPath: mockCliPath });
        assert.equal(mockProbe.installed, true);
        assert.equal(mockProbe.version, '1.0.0');
        assert.equal(mockProbe.capabilities.readOnlyMode, true);
        assert.ok(app.capabilityCache.has('mock@1.0.0'), 'Capabilities must be cached per CLI version');

        const newerProbe = app.probeCli('codex', {
          binaryPath: mockCliPath,
          simulatedVersion: '9.0.0',
        });
        assert.equal(newerProbe.installed, true);
        assert.ok(
          newerProbe.versionWarning && newerProbe.versionWarning.includes('Untested newer version 9.0.0'),
          'Untested newer CLI version must emit warning, not error',
        );

        const missingProbe = app.probeCli('deepseek', { forceMissing: true });
        assert.equal(missingProbe.installed, false);

        const homeModel = app.getHomeScreenModel();
        assert.equal(homeModel.headline, 'What are we building?');
        assert.equal(homeModel.sidebarWidthPx, 216);
        assert.deepEqual(
          homeModel.chips.map((c) => c.label),
          [
            '● Codex CLI · Primary',
            '● Antigravity · Second',
            '● DeepSeek CLI',
            '+ Connect CLI',
          ],
        );
        assert.equal(homeModel.chips[3].dashed, true);
      });
    },
  },
  {
    id: 'T4-SC-02',
    tier: 4,
    feature: 7,
    features: [2, 5, 6, 7, 11],
    title: 'Full Chat Session with mock-cli (Streaming, Tool Lines, Approval Prompt, Cancel, SQLite Restart Persistence)',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [2, 5, 6, 7, 11], async ({ app, restartApp }) => {
        const session = app.startSession({
          title: 'Add copy review brief',
          cliId: 'codex',
          approvalMode: 'ask',
        });

        // Turn 1: Streamed message chunks + tool execution line + file edits
        const turn1 = await app.runTurn(
          session.id,
          'Add a Copy review brief action to the compare view.',
          { scenario: 'chat-edit' },
        );
        const msgEvents = turn1.events.filter((e) => e.type === 'message');
        assert.ok(msgEvents.some((m) => m.final === false && m.text.includes('Plan: build the brief')));
        assert.ok(
           msgEvents.some(
            (m) => m.final === true && m.text === 'Plan: build the brief, wire the button, cover with tests.',
          ),
        );
        assert.ok(
          turn1.events.some((e) => e.type === 'tool' && e.summary === 'Edited compare-model.ts · 18s'),
        );

        // Turn 2: Interactive approval prompt in ask mode
        const turn2 = await app.runTurn(session.id, 'Apply gated edit with approval', {
          scenario: 'approval-edit',
          onApproval: (evt) => {
            assert.equal(evt.kind, 'edit');
            return 'allow-session';
          },
        });
        assert.ok(turn2.events.some((e) => e.type === 'approval'));

        // Turn 3: Mid-turn cancellation
        const turn3 = await app.runTurn(session.id, 'Long streaming turn to cancel', {
          scenario: 'slow-stream',
          cancelAfterFirstChunk: true,
        });
        assert.equal(turn3.signal, 'SIGTERM');

        // Restart session manager from SQLite DB and verify full event log survives intact
        const restarted = restartApp();
        const restoredEvents = restarted.getSessionEvents(session.id);
        assert.ok(restoredEvents.length >= 12);
        assert.ok(
          restoredEvents.some(
            (e) =>
              e.type === 'message' &&
              e.payload.role === 'user' &&
              e.payload.text === 'Add a Copy review brief action to the compare view.',
          ),
        );
        assert.ok(
          restoredEvents.some(
            (e) => e.type === 'status' && e.payload.message === 'Session cancelled by user',
          ),
        );
      });
    },
  },
  {
    id: 'T4-SC-03',
    tier: 4,
    feature: 8,
    features: [3, 6, 8, 12, 19],
    title: 'Agent File Edit, Right-Pane Diff Inspection, and Checkpoint Undo Restoring Working Tree Byte-for-Byte',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [3, 6, 8, 12, 19], async ({ app, repoDir }) => {
        const compareModelPath = path.join(repoDir, 'src/compare-model.ts');
        const compareViewPath = path.join(repoDir, 'src/CompareView.tsx');
        const briefPath = path.join(repoDir, 'src/lib/brief.ts');

        const beforeModel = fs.readFileSync(compareModelPath, 'utf8');
        const beforeView = fs.readFileSync(compareViewPath, 'utf8');
        const headBefore = runGit(repoDir, ['rev-parse', 'HEAD']);

        const session = app.startSession({ title: 'Add copy review brief', cliId: 'codex' });
        const turn = await app.runTurn(
          session.id,
          'Add a Copy review brief action to the compare view.',
          { scenario: 'chat-edit' },
        );

        // User branch HEAD is untouched by checkpoint creation
        assert.equal(runGit(repoDir, ['rev-parse', 'HEAD']), headBefore);
        assert.ok(turn.checkpoint.refName.startsWith('refs/osmium/checkpoints/'));

        // Inspect diff & Edited 3 files card
        const diff = app.getCheckpointDiff(turn.checkpoint.checkpointId);
        assert.equal(diff.editedCard.header, 'Edited 3 files');
        assert.equal(diff.rightPaneWidthPx, 360);
        assert.ok(diff.rawDiff.includes('+  return rows.map(fmt).join(\'\')'));
        assert.equal(fs.existsSync(briefPath), true);

        // Trigger Undo and verify byte-for-byte restoration of tracked + removal of untracked files
        app.undoCheckpoint(turn.checkpoint.checkpointId);
        assert.equal(fs.readFileSync(compareModelPath, 'utf8'), beforeModel);
        assert.equal(fs.readFileSync(compareViewPath, 'utf8'), beforeView);
        assert.equal(fs.existsSync(briefPath), false);
        assert.equal(runGit(repoDir, ['status', '--porcelain']), '');
      });
    },
  },
  {
    id: 'T4-SC-04',
    tier: 4,
    feature: 10,
    features: [4, 5, 7, 9, 10],
    title: 'Multi-CLI Project (codex Primary, antigravity & deepseek Secondary) with Mid-Session Switch & Handoff Line',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [4, 5, 7, 9, 10], async ({ app }) => {
        const cfg = app.saveProjectConfig({
          primary: 'codex',
          secondary: ['antigravity', 'deepseek'],
          approvalMode: 'ask',
          preserveCustomField: { owner: 'platform-team', tier: 'enterprise' },
        });
        assert.deepEqual(cfg.preserveCustomField, { owner: 'platform-team', tier: 'enterprise' });

        const session = app.startSession({ cliId: 'codex', title: 'Add copy review brief' });
        await app.runTurn(session.id, 'Add a Copy review brief action to the compare view.', {
          cliId: 'codex',
          scenario: 'chat-edit',
        });

        // Switch mid-session to antigravity (which has resume: false)
        const switchToAntigravity = app.switchCli(
          session.id,
          'antigravity',
          'ran the browser check on fixtures · 41s',
        );
        assert.equal(
          switchToAntigravity.handoffLine.fullLine,
          '● Antigravity ran the browser check on fixtures · 41s',
        );
        assert.ok(switchToAntigravity.systemContext.includes('Add a Copy review brief action'));

        const turn2 = await app.runTurn(session.id, 'Verify fixtures in browser check', {
          cliId: 'antigravity',
          scenario: 'review',
          readOnly: true,
        });
        assert.ok(turn2.systemContextUsed.includes('[Osmium Handoff Summary]'));

        // Switch to third CLI (deepseek) and verify cumulative context
        const switchToDeepseek = await app.runSlashCommand(session.id, '/cli deepseek');
        assert.equal(switchToDeepseek.targetCliId, 'deepseek');
        assert.ok(switchToDeepseek.systemContext.includes('Review complete'));
      });
    },
  },
  {
    id: 'T4-SC-05',
    tier: 4,
    feature: 12,
    features: [5, 8, 11, 12],
    title: '/plan & /review End-to-End Workflow (Editable Checklist Gate + Secondary CLI Read-Only Review)',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [5, 8, 11, 12], async ({ app, repoDir }) => {
        const session = app.startSession({ cliId: 'codex', title: 'Plan and Review workflow' });

        // 1. User types /plan -> generates checklist without editing any files
        const plan = await app.runSlashCommand(session.id, '/plan Add copy review brief');
        assert.equal(plan.status, 'pending_approval');
        assert.equal(runGit(repoDir, ['status', '--porcelain']), '', 'No files may be modified before plan approval');

        // 2. User edits checklist item and approves -> creates checkpoint and applies changes
        const updatedItems = [
          ...plan.items,
          { id: 'step-4', text: 'Verify clipboard error state', checked: true },
        ];
        const execRes = await app.approvePlanAndExecute(session.id, plan.planId, updatedItems);
        assert.equal(execRes.status, 'executed');
        assert.ok(execRes.turn.checkpoint.checkpointId);

        // 3. User runs /review -> secondary CLI (antigravity) reviews latest diff in readOnly mode
        const treeSnapshotBeforeReview = runGit(repoDir, ['status', '--porcelain']);
        const review = await app.runSlashCommand(session.id, '/review');
        assert.equal(review.reviewerCli, 'antigravity');
        assert.equal(review.readOnly, true);
        assert.ok(review.comments.length >= 1);
        assert.equal(runGit(repoDir, ['status', '--porcelain']), treeSnapshotBeforeReview);
      });
    },
  },
  {
    id: 'T4-SC-06',
    tier: 4,
    feature: 13,
    features: [3, 9, 12, 13, 19],
    title: '/teamwork Happy Path Splitting a Goal into 4 Tasks Across 3 CLIs in Isolated .osmium/worktrees/ and Merging Cleanly',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [3, 9, 12, 13, 19], async ({ app, repoDir }) => {
        const session = app.startSession({ cliId: 'codex' });
        const plan = await app.runSlashCommand(session.id, '/teamwork Add copy review brief');
        assert.equal(plan.valid, true);
        assert.equal(plan.tasks.length, 4);

        const cliSet = new Set(plan.tasks.map((t) => t.assignedCli));
        assert.deepEqual([...cliSet].sort(), ['antigravity', 'codex', 'deepseek']);

        const { runId, integrationBranch } = app.startTeamworkRun(plan);
        const { batchHistory, board } = app.runTeamworkToReview(runId);

        // Verify maxParallel: 2 was respected at every scheduling step
        assert.ok(batchHistory.every((b) => b.runningCount <= 2));
        assert.equal(board.columns.REVIEW.length, 4);
        assert.ok(board.tasks.every((t) => t.outOfScopeFiles.length === 0));

        // Merge all 4 tasks cleanly into osmium/integration in dependency order
        for (const task of plan.tasks) {
          const mergeRes = app.mergeTeamworkTask(runId, task.id);
          assert.equal(mergeRes.merged, true, `Expected ${task.id} to merge cleanly`);
          assert.equal(mergeRes.conflict, false);
        }

        const finalBoard = app.getTeamworkBoardState(runId);
        assert.equal(finalBoard.columns.DONE.length, 4);

        // Checkout osmium/integration and verify all 4 task artifacts exist
        runGit(repoDir, ['checkout', integrationBranch]);
        assert.ok(fs.readFileSync(path.join(repoDir, 'src/routes/compare.ts'), 'utf8').includes('Clipboard unavailable'));
        assert.ok(fs.readFileSync(path.join(repoDir, 'src/lib/brief.ts'), 'utf8').includes('buildMarkdownBrief'));
        assert.ok(fs.readFileSync(path.join(repoDir, 'src/CompareView.tsx'), 'utf8').includes('Copy review brief'));
        assert.ok(fs.existsSync(path.join(repoDir, 'tests/compare-model.test.ts')));
      });
    },
  },
  {
    id: 'T4-SC-07',
    tier: 4,
    feature: 13,
    features: [1, 7, 13],
    title: 'App Kill and Restart Mid-/teamwork Run with Automatic Scheduler Resumption from SQLite & Worktrees',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [1, 7, 13], async ({ app, repoDir, restartApp }) => {
        const plan = app.planTeamwork('Add copy review brief');
        const { runId, integrationBranch } = app.startTeamworkRun(plan);

        // Step 1: Schedule and complete task-1-scaffold, then merge it so it is DONE
        app.stepTeamworkScheduler(runId);
        app.stepTeamworkScheduler(runId);
        app.mergeTeamworkTask(runId, 'task-1-scaffold');

        // Now task-1 is DONE, task-2 & task-3 are RUNNING, task-4 is QUEUED
        const beforeKill = app.getTeamworkBoardState(runId);
        assert.equal(beforeKill.columns.DONE.length, 1);
        assert.equal(beforeKill.columns.RUNNING.length, 2);
        assert.equal(beforeKill.columns.QUEUED.length, 1);

        // Simulate abrupt app crash/kill and instantiate fresh app from disk SQLite + git worktrees
        const recoveredApp = restartApp();
        const afterRecovery = recoveredApp.runTeamworkToReview(runId);
        assert.equal(afterRecovery.board.columns.DONE.length, 1, 'Completed Task 1 must remain DONE and not re-run');
        assert.equal(afterRecovery.board.columns.REVIEW.length, 3, 'Tasks 2, 3, and 4 must finish and move to REVIEW');

        for (const taskId of ['task-2-brief', 'task-3-browser', 'task-4-tests']) {
          const m = recoveredApp.mergeTeamworkTask(runId, taskId);
          assert.equal(m.merged, true);
        }

        const completedBoard = recoveredApp.getTeamworkBoardState(runId);
        assert.equal(completedBoard.columns.DONE.length, 4);
        runGit(repoDir, ['checkout', integrationBranch]);
        assert.ok(fs.existsSync(path.join(repoDir, 'tests/compare-model.test.ts')));
      });
    },
  },
  {
    id: 'T4-SC-08',
    tier: 4,
    feature: 14,
    features: [6, 7, 10, 13, 14],
    title: 'Simulated Quota Limit Hit (limitHit: true) Moving a Running Task to the Next Secondary CLI and Updating Board Badge',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [6, 7, 10, 13, 14], async ({ app }) => {
        app.saveProjectConfig({
          primary: 'codex',
          secondary: ['antigravity', 'deepseek'],
          fallback: { onQuotaHit: 'next-secondary' },
        });

        // Also verify standalone mock-cli quota-limit event emission
        const session = app.startSession({ cliId: 'codex', title: 'Quota limit check' });
        const turn = await app.runTurn(session.id, 'Run until limit hit', {
          scenario: 'quota-limit',
        });
        assert.ok(turn.events.some((e) => e.type === 'usage' && e.limitHit === true));

        // Now run a teamwork task on codex where limitHit triggers automatic fallback to antigravity
        const plan = app.planTeamwork('Add copy review brief');
        const { runId } = app.startTeamworkRun(plan);
        app.stepTeamworkScheduler(runId); // schedules task-1-scaffold on codex

        const afterFallback = app.stepTeamworkScheduler(runId, {
          simulateQuotaHitOnTask: 'task-1-scaffold',
          simulateQuotaHitOnCli: 'codex',
        });

        const task1 = afterFallback.board.tasks.find((t) => t.id === 'task-1-scaffold');
        assert.equal(task1.assignedCli, 'antigravity');
        assert.equal(task1.cliBadge, '● Antigravity');
        assert.equal(task1.status, 'REVIEW');

        const codexUsage = app.getCliUsage('codex');
        assert.ok(codexUsage.lastLimitHitAt !== null);
        const antigravityUsage = app.getCliUsage('antigravity');
        assert.ok(antigravityUsage.turnsRun >= 1);
      });
    },
  },
  {
    id: 'T4-SC-09',
    tier: 4,
    feature: 16,
    features: [3, 15, 16, 17, 18, 21],
    title: 'IDE Workbench Workflow: Lazy Explorer, Multi-Tab Monaco Edit, Disk-Conflict Guard, Ripgrep Replace, Terminal Fix This Error & Layout Restore',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [3, 15, 16, 17, 18, 21], async ({ app, repoDir, restartApp }) => {
        // Create brief.ts and modify compare.ts + auth.ts to match IDE screenshot state
        fs.writeFileSync(
          path.join(repoDir, 'src/lib/brief.ts'),
          "export function toBrief() { return 'brief'; }\n",
          'utf8',
        );
        fs.appendFileSync(path.join(repoDir, 'src/routes/compare.ts'), '\n// route edit\n', 'utf8');
        fs.appendFileSync(path.join(repoDir, 'src/routes/auth.ts'), '\n// auth edit\n', 'utf8');

        const rootTree = app.readExplorerTree('');
        assert.ok(rootTree.some((e) => e.name === 'src' && e.lazyChildren === true));
        assert.ok(!rootTree.some((e) => e.name === '.osmium'), '.gitignore entries must be hidden in Explorer');

        const routesTree = app.readExplorerTree('src/routes');
        assert.equal(routesTree.find((e) => e.name === 'compare.ts').gitStatus, 'M');
        assert.equal(routesTree.find((e) => e.name === 'auth.ts').gitStatus, 'M');
        assert.equal(app.readExplorerTree('src/lib').find((e) => e.name === 'brief.ts').gitStatus, 'A');

        // Open 3 tabs with split editor and check breadcrumbs
        const compareTab = app.openEditorFile('src/routes/compare.ts', { splitDirection: 'right' });
        app.openEditorFile('src/lib/brief.ts');
        app.openEditorFile('src/routes/auth.ts');
        assert.equal(compareTab.breadcrumbs, 'src › routes › compare.ts');

        // External disk change triggers DISK_CONFLICT guard on stale mtime
        const compareAbs = path.join(repoDir, 'src/routes/compare.ts');
        const futureTime = new Date(compareTab.mtimeMs + 10000);
        fs.writeFileSync(compareAbs, compareTab.content + '\n// concurrent disk change\n', 'utf8');
        fs.utimesSync(compareAbs, futureTime, futureTime);
        assert.throws(
          () => app.saveEditorFile('src/routes/compare.ts', '// overwrite attempt\n', compareTab.mtimeMs),
          (err) => err.code === 'DISK_CONFLICT',
        );

        // Ripgrep search & multi-file replace
        const rgHits = app.ripgrepSearch({ query: 'verifyRedirect', includeGlob: 'src/**' });
        assert.equal(rgHits.length, 1);
        app.replaceAcrossFiles({
          query: 'verifyRedirect',
          replacement: 'validateAuthRedirect',
          includeGlob: 'src/**',
          previewOnly: false,
        });
        assert.equal(app.ripgrepSearch({ query: 'validateAuthRedirect', includeGlob: 'src/**' }).length, 1);

        // Integrated terminal failing command -> 1-click Fix this error attaches @terminal chip
        const failedTerm = app.runTaskInTerminal('test:fail');
        const fixComposer = app.clickFixTerminalError(failedTerm);
        assert.equal(fixComposer.chips[0].id, '@terminal');

        // Verify open tabs and splits survive app restart
        const restarted = restartApp();
        const layout = restarted.getWorkbenchLayout();
        assert.deepEqual(layout.openTabs, [
          'src/routes/compare.ts',
          'src/lib/brief.ts',
          'src/routes/auth.ts',
        ]);
        assert.equal(layout.splits.length, 1);
      });
    },
  },
  {
    id: 'T4-SC-10',
    tier: 4,
    feature: 19,
    features: [8, 13, 19, 21],
    title: 'Source Control Inline Hunk Review (Accept, Reject, Ask to change, Accept all, Reject all), Commit, and 3-Way Merge Conflict Resolution',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [8, 13, 19, 21], async ({ app, repoDir }) => {
        runGit(repoDir, ['checkout', 'osmium/integration']);

        const compareRel = 'src/routes/compare.ts';
        fs.writeFileSync(
          path.join(repoDir, compareRel),
          [
            "import { toBrief } from '../compare-model'",
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
          'utf8',
        );
        fs.writeFileSync(
          path.join(repoDir, 'src/lib/brief.ts'),
          "export const briefVersion = '1.0';\n",
          'utf8',
        );
        fs.appendFileSync(
          path.join(repoDir, 'src/CompareView.tsx'),
          '\n// CompareView updated\n',
          'utf8',
        );

        const hunks = app.parseFileHunks(compareRel);
        assert.equal(hunks.length, 2);
        assert.equal(hunks[0].label, 'Hunk 1 of 2');
        assert.equal(hunks[1].label, 'Hunk 2 of 2');

        // Ask to change on Hunk 1 attaches @diff chip to docked Agent composer
        const composer = { chips: [] };
        app.applyHunkAction(compareRel, 0, 'Ask to change', composer);
        assert.equal(composer.chips.length, 1);

        // Stage all 3 files (Accept all) and commit with "add copy review brief"
        app.applyAllHunks(compareRel, 'Accept all');
        app.applyAllHunks('src/lib/brief.ts', 'Accept all');
        app.applyAllHunks('src/CompareView.tsx', 'Accept all');
        const commit = app.gitCommit('add copy review brief');
        assert.ok(commit.sha);
        assert.equal(runGit(repoDir, ['status', '--porcelain']), '');

        // Create a conflicting branch and trigger a 3-way merge conflict on compare.ts
        runGit(repoDir, ['checkout', '-b', 'feature/conflict-branch']);
        fs.writeFileSync(
          path.join(repoDir, compareRel),
          "export const conflictTarget = 'theirs-branch-version';\n",
          'utf8',
        );
        runGit(repoDir, ['commit', '-am', 'Theirs change']);

        runGit(repoDir, ['checkout', 'osmium/integration']);
        fs.writeFileSync(
          path.join(repoDir, compareRel),
          "export const conflictTarget = 'ours-integration-version';\n",
          'utf8',
        );
        runGit(repoDir, ['commit', '-am', 'Ours change']);

        assert.throws(() => runGit(repoDir, ['merge', 'feature/conflict-branch']));
        assert.equal(app.hasUnmergedFiles(), true);

        const conflict = app.getThreeWayConflict(compareRel);
        assert.ok(conflict.ours.includes('ours-integration-version'));
        assert.ok(conflict.theirs.includes('theirs-branch-version'));

        app.resolveThreeWayConflict(compareRel, 'both');
        const mergeCommit = app.gitCommit('Merge feature/conflict-branch after 3-way resolution');
        assert.ok(mergeCommit.sha);
        assert.equal(app.hasUnmergedFiles(), false);
      });
    },
  },
  {
    id: 'T4-SC-11',
    tier: 4,
    feature: 20,
    features: [6, 16, 20, 21, 22],
    title: 'IDE Code Intelligence (TS/Python Diagnostics, Problems Panel, Context Chips @compare.ts, @selection, @problems, Follow agent)',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [6, 16, 20, 21, 22], async ({ app, repoDir }) => {
        fs.writeFileSync(
          path.join(repoDir, 'src/script.py'),
          'def compute_delta(a: int, b: int) -> int:\n    return a - b\n',
          'utf8',
        );

        const diag = app.inspectLspAndDiagnostics(['src/routes/compare.ts', 'src/script.py']);
        assert.equal(diag.problemsCount, 2);
        assert.equal(diag.problemsBadge, '2 problems');
        assert.equal(diag.statusBarColor, '#2F6B4F');
        for (const srv of diag.lspStatus) {
          assert.equal(srv.silentInstallAttempted, false, 'LSP manager must never silently install binaries');
          if (!srv.installed) {
            assert.ok(srv.installHint.includes('Install'));
          }
        }

        const composerCtx = app.buildDockedAgentComposerContext({
          activeFile: 'src/routes/compare.ts',
          selection: 'export function copyBrief(rows: CompareRow[])',
          action: 'Fix',
        });
        assert.deepEqual(composerCtx.chips, ['@compare.ts', '@selection', '@problems']);

        // Enable Follow agent -> run agent turn editing src/lib/brief.ts -> verify tab auto-opens with CLI dot
        app.setFollowAgent(true);
        const session = app.startSession({ cliId: 'codex' });
        await app.runTurn(session.id, 'Fix brief and update clipboard handling', {
          scenario: 'follow-agent-edit',
        });

        const layout = app.getWorkbenchLayout();
        assert.equal(layout.activeTab, 'src/lib/brief.ts');
        const briefTab = app.openEditorFile('src/lib/brief.ts');
        assert.equal(briefTab.agentDot.tabLabel, '● brief.ts');
        assert.equal(briefTab.agentDot.color, '#1B2B22');
      });
    },
  },
  {
    id: 'T4-SC-12',
    tier: 4,
    feature: 23,
    features: [1, 2, 3, 4, 23, 24],
    title: 'Third-Party Adapter SDK Template Loading & ~/.osmium/extensions/ Theme/LSP Loading + Dark Theme Token Swap & Governance Docs',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [1, 2, 3, 4, 23, 24], async ({ app, repoDir, homeDir, mockCliPath }) => {
        // 1. Load custom third-party adapter from user folder and run all 7 contract tests
        const thirdPartyDir = path.join(homeDir, 'user-adapters', 'custom-agent-cli');
        fs.mkdirSync(thirdPartyDir, { recursive: true });
        fs.copyFileSync(mockCliPath, path.join(thirdPartyDir, 'cli.mjs'));
        fs.writeFileSync(
          path.join(thirdPartyDir, 'adapter.json'),
          JSON.stringify(
            {
              id: 'custom-agent-cli',
              displayName: 'Custom Agent CLI',
              color: '#0E7490',
              testedVersion: '1.0.0',
              entry: 'cli.mjs',
            },
            null,
            2,
          ),
          'utf8',
        );

        const adapterRes = await app.loadThirdPartyAdapterFromFolder(thirdPartyDir);
        assert.equal(adapterRes.allPassed, true);

        // 2. Load sample-theme and sample-lsp extensions from ~/.osmium/extensions/
        const themeExtDir = path.join(app.extensionsDir, 'sample-theme');
        fs.mkdirSync(themeExtDir, { recursive: true });
        fs.writeFileSync(
          path.join(themeExtDir, 'osmium.json'),
          JSON.stringify({
            name: 'sample-theme',
            version: '1.0.0',
            permissions: [],
            contributes: {
              themes: [{ id: 'soft-pine', label: 'Soft Pine' }],
            },
          }),
          'utf8',
        );
        const loadedThemeExt = app.loadExtensionFromFolder(themeExtDir);
        assert.equal(loadedThemeExt.loaded, true);

        const lspExtDir = path.join(app.extensionsDir, 'sample-lsp');
        fs.mkdirSync(lspExtDir, { recursive: true });
        fs.writeFileSync(
          path.join(lspExtDir, 'osmium.json'),
          JSON.stringify({
            name: 'sample-lsp',
            version: '1.0.0',
            permissions: ['node-process'],
            contributes: {
              languageServers: [{ id: 'sample-graphql-lsp', languages: ['graphql'] }],
              commands: [{ id: 'sampleLsp.restart', title: 'Restart Sample GraphQL LSP' }],
            },
          }),
          'utf8',
        );
        const blockedLspExt = app.loadExtensionFromFolder(lspExtDir, { approvePermissions: false });
        assert.equal(blockedLspExt.loaded, false);
        assert.equal(blockedLspExt.blockedByPermissionPrompt, true);

        const approvedLspExt = app.loadExtensionFromFolder(lspExtDir, { approvePermissions: true });
        assert.equal(approvedLspExt.loaded, true);
        assert.ok(app.registeredCommands.has('sampleLsp.restart'));

        // 3. Import VS Code theme and snippets
        const vscodeThemePath = path.join(homeDir, 'vscode-theme.json');
        fs.writeFileSync(
          vscodeThemePath,
          JSON.stringify({ name: 'Imported VS Code Theme', colors: { 'editor.background': '#F6F8F5' } }),
          'utf8',
        );
        const importedTheme = app.importVsCodeAsset('themes', vscodeThemePath);
        assert.ok(importedTheme.importedCount >= 2);

        // 4. Switch from light theme to dark theme via CSS variable token swap
        assert.equal(DESIGN_TOKENS_LIGHT['--bg-ground'], '#F6F8F5');
        assert.equal(DESIGN_TOKENS_LIGHT['--bg-sidebar'], '#EAF1E8');
        assert.equal(DESIGN_TOKENS_LIGHT['--accent-primary'], '#2F6B4F');

        const dark = app.switchTheme('dark');
        assert.equal(dark.domAttribute, '[data-theme="dark"]');
        assert.equal(dark.tokens['--bg-ground'], DESIGN_TOKENS_DARK['--bg-ground']);
        assert.equal(dark.tokens['--accent-primary'], DESIGN_TOKENS_DARK['--accent-primary']);

        // 5. Verify electron-builder config (autoUpdate: false) and open-source governance docs
        const gov = app.verifyReleaseAndGovernanceBundle(repoDir);
        assert.equal(gov.builderConfig.autoUpdate, false);
        assert.ok(gov.filesVerified.every((f) => f.exists));
      });
    },
  },
];
