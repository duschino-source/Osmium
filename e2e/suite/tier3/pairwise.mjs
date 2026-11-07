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
    id: 'T3-PW-01',
    tier: 3,
    feature: 6,
    features: [6, 7, 8],
    title: 'mock-cli streaming file-edit turn + SQLite event persistence + pre-turn git checkpoint & Edited N files diff',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [6, 7, 8], async ({ app, repoDir }) => {
        const headBefore = runGit(repoDir, ['rev-parse', 'HEAD']);
        const session = app.startSession({ title: 'Add copy review brief', cliId: 'codex' });
        const turn = await app.runTurn(
          session.id,
          'Add a Copy review brief action to the compare view.',
          { scenario: 'chat-edit' },
        );

        assert.ok(turn.checkpoint, 'Expected pre-turn checkpoint to be created');
        assert.match(turn.checkpoint.refName, /^refs\/osmium\/checkpoints\/chk-/);
        const refSha = runGit(repoDir, ['rev-parse', turn.checkpoint.refName]);
        assert.equal(refSha, turn.checkpoint.commitSha);
        assert.equal(runGit(repoDir, ['rev-parse', 'HEAD']), headBefore, 'User branch HEAD must remain untouched');

        const persistedEvents = app.getSessionEvents(session.id);
        assert.ok(persistedEvents.some((e) => e.type === 'message' && e.payload.text.includes('Plan: build the brief')));
        assert.ok(persistedEvents.some((e) => e.type === 'tool' && e.payload.summary === 'Edited compare-model.ts · 18s'));
        assert.equal(persistedEvents.filter((e) => e.type === 'file-edit').length, 3);

        const diff = app.getCheckpointDiff(turn.checkpoint.checkpointId);
        assert.equal(diff.files.length, 3);
        assert.equal(diff.editedCard.header, 'Edited 3 files');
        assert.deepEqual(diff.editedCard.actions, ['Undo', 'Review']);
        assert.equal(diff.rightPaneWidthPx, 360);
      });
    },
  },
  {
    id: 'T3-PW-02',
    tier: 3,
    feature: 7,
    features: [7, 8, 12],
    title: 'Multi-turn chat session + /undo slash command restoring git checkpoint byte-for-byte and recording undo in SQLite',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [7, 8, 12], async ({ app, repoDir }) => {
        const comparePath = path.join(repoDir, 'src/compare-model.ts');
        const viewPath = path.join(repoDir, 'src/CompareView.tsx');
        const briefPath = path.join(repoDir, 'src/lib/brief.ts');
        const origCompare = fs.readFileSync(comparePath, 'utf8');
        const origView = fs.readFileSync(viewPath, 'utf8');
        assert.equal(fs.existsSync(briefPath), false);

        const session = app.startSession({ title: 'Undo verification session', cliId: 'codex' });
        await app.runTurn(session.id, 'Modify compare-model and create brief.ts', {
          scenario: 'chat-edit',
        });

        assert.notEqual(fs.readFileSync(comparePath, 'utf8'), origCompare);
        assert.equal(fs.existsSync(briefPath), true);

        const suggestions = app.getSlashMenuSuggestions('/un');
        assert.equal(suggestions.length, 1);
        assert.equal(suggestions[0].command, '/undo');

        const undoRes = await app.runSlashCommand(session.id, '/undo');
        assert.ok(undoRes.restoredCommitSha);

        assert.equal(fs.readFileSync(comparePath, 'utf8'), origCompare, 'compare-model.ts must be restored byte-for-byte');
        assert.equal(fs.readFileSync(viewPath, 'utf8'), origView, 'CompareView.tsx must be restored byte-for-byte');
        assert.equal(fs.existsSync(briefPath), false, 'Untracked file created during turn must be removed on undo');
        assert.equal(runGit(repoDir, ['status', '--porcelain']), '', 'Working tree must be clean after undo');

        const events = app.getSessionEvents(session.id);
        assert.ok(events.some((e) => e.type === 'checkpoint-undo'));
      });
    },
  },
  {
    id: 'T3-PW-03',
    tier: 3,
    feature: 11,
    features: [6, 8, 11],
    title: 'Approval gate (ask mode) blocking mock-cli file edit on Deny vs Allow vs Allow for this session',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [6, 8, 11], async ({ app, repoDir }) => {
        const targetPath = path.join(repoDir, 'src/compare-model.ts');
        const origContent = fs.readFileSync(targetPath, 'utf8');
        const session = app.startSession({ approvalMode: 'ask', cliId: 'codex' });

        // 1. Deny approval -> working tree stays identical to pre-turn checkpoint
        const denyTurn = await app.runTurn(session.id, 'Attempt edit with Deny', {
          scenario: 'approval-edit',
          onApproval: () => false,
        });
        assert.ok(denyTurn.events.some((e) => e.type === 'approval' && e.kind === 'edit'));
        assert.equal(fs.readFileSync(targetPath, 'utf8'), origContent, 'Denied edit must not touch file on disk');

        // 2. Allow for this session -> applies edit and remembers approval for subsequent edit turns
        await app.runTurn(session.id, 'Attempt edit with Allow for this session', {
          scenario: 'approval-edit',
          onApproval: () => 'allow-session',
        });
        const afterFirstAllow = fs.readFileSync(targetPath, 'utf8');
        assert.ok(afterFirstAllow.includes('// Approved edit applied'));

        // 3. Subsequent turn auto-approves without invoking prompt callback
        let callbackCalled = false;
        await app.runTurn(session.id, 'Second edit turn auto-approved by session scope', {
          scenario: 'approval-edit',
          onApproval: () => {
            callbackCalled = true;
            return false;
          },
        });
        assert.equal(callbackCalled, false, 'Session-scoped approval should auto-approve without prompting again');
        const afterSecondAllow = fs.readFileSync(targetPath, 'utf8');
        assert.equal(afterSecondAllow.split('// Approved edit applied').length - 1, 2);
      });
    },
  },
  {
    id: 'T3-PW-04',
    tier: 3,
    feature: 10,
    features: [7, 9, 10],
    title: 'project.yaml multi-CLI config + mid-session CLI switch building systemContext handoff summary from SQLite + handoff pill line',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [7, 9, 10], async ({ app }) => {
        const savedCfg = app.saveProjectConfig({
          primary: 'codex',
          secondary: ['antigravity', 'deepseek'],
          customTeamTag: 'argon-4-preserve-me',
        });
        assert.equal(savedCfg.customTeamTag, 'argon-4-preserve-me', 'Unknown YAML keys must be preserved');

        const session = app.startSession({ cliId: 'codex', title: 'Add copy review brief' });
        await app.runTurn(session.id, 'Add a Copy review brief action to the compare view.', {
          scenario: 'chat-edit',
        });

        const handoff = app.switchCli(
          session.id,
          'antigravity',
          'ran the browser check on fixtures · 41s',
        );
        assert.equal(handoff.targetCliId, 'antigravity');
        assert.equal(handoff.handoffLine.badge, '● Antigravity');
        assert.equal(handoff.handoffLine.dotColor, '#2F5FD0');
        assert.equal(
          handoff.handoffLine.fullLine,
          '● Antigravity ran the browser check on fixtures · 41s',
        );
        assert.ok(handoff.systemContext.includes('[Osmium Handoff Summary]'));
        assert.ok(handoff.systemContext.includes('src/compare-model.ts'));

        const persistedEvents = app.getSessionEvents(session.id);
        assert.ok(persistedEvents.some((e) => e.type === 'handoff' && e.cliId === 'antigravity'));
      });
    },
  },
  {
    id: 'T3-PW-05',
    tier: 3,
    feature: 4,
    features: [4, 5, 10],
    title: 'Capability probe detecting CLI with resume: false + multi-transport raw fallback + graceful degradation to systemContext',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [4, 5, 10], async ({ app, mockCliPath }) => {
        const probe = app.probeCli('antigravity', {
          binaryPath: mockCliPath,
          simulatedVersion: '2.1.0',
          capabilitiesOverride: { resume: false, jsonStream: false },
        });
        assert.equal(probe.installed, true);
        assert.equal(probe.capabilities.resume, false);
        assert.ok(
          probe.versionWarning && probe.versionWarning.includes('Untested newer version 2.1.0'),
          'Newer CLI version must produce a non-blocking versionWarning',
        );

        const session = app.startSession({ cliId: 'antigravity' });
        const turn1 = await app.runTurn(session.id, 'First turn over PTY/raw stream', {
          cliId: 'antigravity',
          scenario: 'raw-fallback',
        });
        const rawEvents = turn1.events.filter((e) => e.type === 'raw');
        assert.equal(rawEvents.length, 2, 'Unparsed output lines must be emitted as raw events');
        assert.ok(rawEvents[0].data.includes('UNPARSED_BANNER'));

        // Turn 2 on a CLI with resume: false must automatically synthesize systemContext
        const turn2 = await app.runTurn(session.id, 'Second turn without native resume flag', {
          cliId: 'antigravity',
          scenario: 'review',
          readOnly: true,
        });
        assert.ok(
          turn2.systemContextUsed.includes('[Osmium Handoff Summary]'),
          'Expected automatic systemContext synthesis when capabilities.resume is false',
        );
      });
    },
  },
  {
    id: 'T3-PW-06',
    tier: 3,
    feature: 8,
    features: [8, 11, 12],
    title: '/plan slash command generating editable checklist + blocking file writes until approval + pre-turn checkpoint on execution',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [8, 11, 12], async ({ app, repoDir }) => {
        const session = app.startSession({ cliId: 'codex' });
        const statusBeforePlan = runGit(repoDir, ['status', '--porcelain']);

        const planRes = await app.runSlashCommand(session.id, '/plan Add copy review brief');
        assert.equal(planRes.kind, 'plan');
        assert.equal(planRes.status, 'pending_approval');
        assert.equal(planRes.items.length, 3);
        assert.equal(
          runGit(repoDir, ['status', '--porcelain']),
          statusBeforePlan,
          '/plan must not edit any files before user approves the checklist',
        );

        // User edits checklist item 2 and approves
        const editedItems = planRes.items.map((item, idx) =>
          idx === 1 ? { ...item, text: 'Wire CopyBriefButton with keyboard focus ring' } : item,
        );
        const execRes = await app.approvePlanAndExecute(session.id, planRes.planId, editedItems);
        assert.equal(execRes.status, 'executed');
        assert.ok(execRes.turn.checkpoint?.checkpointId, 'Executing approved plan must create a checkpoint');
        assert.notEqual(runGit(repoDir, ['status', '--porcelain']), '', 'Files should be edited after plan approval');
      });
    },
  },
  {
    id: 'T3-PW-07',
    tier: 3,
    feature: 5,
    features: [5, 8, 12],
    title: '/review slash command reading latest checkpoint diff and invoking secondary CLI in readOnly mode returning comments',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [5, 8, 12], async ({ app, repoDir }) => {
        const session = app.startSession({ cliId: 'codex' });
        await app.runTurn(session.id, 'Implement copy brief', { scenario: 'chat-edit' });

        const statusBeforeReview = runGit(repoDir, ['status', '--porcelain']);
        const reviewRes = await app.runSlashCommand(session.id, '/review');

        assert.equal(reviewRes.kind, 'review');
        assert.equal(reviewRes.reviewerCli, 'antigravity');
        assert.equal(reviewRes.readOnly, true);
        assert.ok(reviewRes.diffReviewed.rawDiff.includes('toBrief'));
        assert.ok(reviewRes.comments.some((c) => c.includes('Review complete')));
        assert.equal(
          runGit(repoDir, ['status', '--porcelain']),
          statusBeforeReview,
          '/review must never modify working tree files',
        );
      });
    },
  },
  {
    id: 'T3-PW-08',
    tier: 3,
    feature: 12,
    features: [9, 12, 13],
    title: '/teamwork slash command + project.yaml routing rules + zod planner validation with 1x retry and raw fallback',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [9, 12, 13], async ({ app }) => {
        // 1. Planner fails first validation attempt, succeeds on automatic retry
        const retryPlan = app.planTeamwork('Add copy review brief', { failFirstAttempt: true });
        assert.equal(retryPlan.valid, true);
        assert.equal(retryPlan.attempts, 2, 'Planner must retry once on invalid zod output');
        assert.equal(retryPlan.tasks.length, 4);

        const byId = Object.fromEntries(retryPlan.tasks.map((t) => [t.id, t]));
        assert.equal(byId['task-1-scaffold'].assignedCli, 'codex');
        assert.equal(byId['task-2-brief'].assignedCli, 'codex');
        assert.equal(byId['task-3-browser'].assignedCli, 'antigravity');
        assert.equal(byId['task-4-tests'].assignedCli, 'deepseek');

        // 2. If second attempt is also invalid, returns raw text for manual user fix
        const fallbackPlan = app.planTeamwork('Broken goal', { alwaysInvalid: true });
        assert.equal(fallbackPlan.valid, false);
        assert.equal(fallbackPlan.attempts, 2);
        assert.ok(fallbackPlan.rawFallbackText.includes('raw planner text fallback'));
      });
    },
  },
  {
    id: 'T3-PW-09',
    tier: 3,
    feature: 13,
    features: [3, 13, 19],
    title: '/teamwork isolated git worktrees (.osmium/worktrees/<task-id>) + workspace boundary guard + out-of-scope edit warning',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [3, 13, 19], async ({ app }) => {
        const plan = app.planTeamwork('Add copy review brief');
        const { runId } = app.startTeamworkRun(plan);
        const board = app.getTeamworkBoardState(runId);

        for (const task of board.tasks) {
          assert.ok(fs.existsSync(task.worktreePath), `Worktree must exist at ${task.worktreePath}`);
          assert.ok(task.worktreePath.includes('.osmium/worktrees/'));
        }

        // Execute task-1 with an out-of-scope edit to README.md (task-1 scope is ['src/routes/**'])
        const task1 = board.tasks.find((t) => t.id === 'task-1-scaffold');
        const execResult = app.executeTaskWorkInWorktree(task1, {
          outOfScopeEditPath: 'README.md',
        });
        assert.ok(
          execResult.outOfScope.includes('README.md'),
          'Out-of-scope file edit must be detected against task scope globs',
        );

        // Verify workspace write boundary guard blocks writes outside repo/worktrees
        assert.throws(
          () => app.boundaryGuard.assertWritable('/tmp/outside-osmium-boundary.txt'),
          /EACCES_WORKSPACE_BOUNDARY/,
        );
      });
    },
  },
  {
    id: 'T3-PW-10',
    tier: 3,
    feature: 14,
    features: [7, 13, 14],
    title: '/teamwork scheduler parallel execution (maxParallel: 2) + quota limitHit: true + automatic fallback to next-secondary CLI',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [7, 13, 14], async ({ app }) => {
        const plan = app.planTeamwork('Add copy review brief');
        const { runId } = app.startTeamworkRun(plan);

        // Step 1: task-1-scaffold has no dependencies -> moves to RUNNING
        const step1 = app.stepTeamworkScheduler(runId);
        assert.deepEqual(step1.scheduledNow, ['task-1-scaffold']);

        // Step 2: task-1 completes with simulated quota limit hit on codex -> reassigns to antigravity & schedules task-2 and task-3 (maxParallel: 2)
        const step2 = app.stepTeamworkScheduler(runId, {
          simulateQuotaHitOnTask: 'task-1-scaffold',
          simulateQuotaHitOnCli: 'codex',
        });
        assert.equal(step2.board.columns.RUNNING.length, 2, 'Scheduler must run task-2 and task-3 in parallel (maxParallel: 2)');

        const task1After = step2.board.tasks.find((t) => t.id === 'task-1-scaffold');
        assert.equal(task1After.assignedCli, 'antigravity', 'Quota fallback must move task from codex to next-secondary (antigravity)');
        assert.equal(task1After.cliBadge, '● Antigravity');
        assert.ok(task1After.handoffContext.includes('Quota Fallback Handoff'));

        const codexUsage = app.getCliUsage('codex');
        assert.ok(codexUsage.lastLimitHitAt > 0, 'Usage tracker must record factual lastLimitHitAt timestamp');
      });
    },
  },
  {
    id: 'T3-PW-11',
    tier: 3,
    feature: 1,
    features: [1, 7, 13],
    title: '/teamwork scheduler SQLite persistence + simulated app kill & restart mid-run + resuming tasks and updating docs/PROGRESS.md',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [1, 7, 13], async ({ app, repoDir, restartApp }) => {
        app.initGovernanceAndPlanDocs(repoDir);
        const plan = app.planTeamwork('Add copy review brief');
        const { runId } = app.startTeamworkRun(plan);

        // Schedule task-1, then complete task-1 and leave task-2 & task-3 RUNNING
        app.stepTeamworkScheduler(runId);
        const midState = app.stepTeamworkScheduler(runId);
        assert.equal(midState.board.columns.REVIEW.length, 1);
        assert.equal(midState.board.columns.RUNNING.length, 2);
        assert.equal(midState.board.columns.QUEUED.length, 1);

        // Simulate app kill & restart with a brand new OsmiumTestApp instance reading from SQLite
        const restartedApp = restartApp();
        const recovered = restartedApp.runTeamworkToReview(runId);
        assert.equal(recovered.board.columns.REVIEW.length, 4, 'All 4 tasks must complete and reach REVIEW after restart');

        restartedApp.updateProgressDoc('Phase 5: Recovered teamwork run across restart and completed 4 tasks.', repoDir);
        const progressText = fs.readFileSync(path.join(repoDir, 'docs/PROGRESS.md'), 'utf8');
        assert.ok(progressText.includes('Recovered teamwork run across restart'));
      });
    },
  },
  {
    id: 'T3-PW-12',
    tier: 3,
    feature: 21,
    features: [13, 19, 21],
    title: '/teamwork task completion (REVIEW) + merging into osmium/integration + git merge conflict detection and CLI conflict resolution',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [13, 19, 21], async ({ app, repoDir }) => {
        const plan = app.planTeamwork('Add copy review brief');
        const { runId } = app.startTeamworkRun(plan);
        const board = app.getTeamworkBoardState(runId);
        const task1 = board.tasks.find((t) => t.id === 'task-1-scaffold');

        app.executeTaskWorkInWorktree(task1, {
          customEdit: {
            relPath: 'src/routes/compare.ts',
            content: 'export const compareRoute = "from-task-1-worktree";\n',
          },
        });

        // Create a conflicting commit directly on osmium/integration
        runGit(repoDir, ['checkout', 'osmium/integration']);
        fs.writeFileSync(
          path.join(repoDir, 'src/routes/compare.ts'),
          'export const compareRoute = "from-integration-branch";\n',
          'utf8',
        );
        runGit(repoDir, ['add', 'src/routes/compare.ts']);
        runGit(repoDir, ['commit', '-m', 'Conflicting change on integration']);

        const mergeAttempt = app.mergeTeamworkTask(runId, task1.id);
        assert.equal(mergeAttempt.merged, false);
        assert.equal(mergeAttempt.conflict, true);
        assert.ok(mergeAttempt.conflictingFiles.includes('src/routes/compare.ts'));

        const threeWay = app.getThreeWayConflict('src/routes/compare.ts');
        assert.ok(threeWay.ours.includes('from-integration-branch'));
        assert.ok(threeWay.theirs.includes('from-task-1-worktree'));

        const resolved = app.assignConflictToCli(
          runId,
          task1.id,
          'codex',
          'src/routes/compare.ts',
          'export const compareRoute = "resolved-by-codex";\n',
        );
        assert.equal(resolved.status, 'DONE');
        assert.equal(app.hasUnmergedFiles(), false);
      });
    },
  },
  {
    id: 'T3-PW-13',
    tier: 3,
    feature: 15,
    features: [15, 16, 19],
    title: 'IDE Explorer lazy tree & git status badges (M, A) + opening modified files in Monaco tabs + breadcrumbs & #E3F3E2 diff gutter',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [15, 16, 19], async ({ app, repoDir }) => {
        fs.appendFileSync(path.join(repoDir, 'src/routes/compare.ts'), '\n// modified line\n', 'utf8');
        fs.appendFileSync(path.join(repoDir, 'src/routes/auth.ts'), '\n// modified auth\n', 'utf8');
        fs.writeFileSync(path.join(repoDir, 'src/lib/brief.ts'), 'export const brief = true;\n', 'utf8');

        const routesTree = app.readExplorerTree('src/routes');
        const compareEntry = routesTree.find((e) => e.name === 'compare.ts');
        const authEntry = routesTree.find((e) => e.name === 'auth.ts');
        assert.equal(compareEntry.gitStatus, 'M');
        assert.equal(compareEntry.gitStatusColor, '#8A5A1E');
        assert.equal(authEntry.gitStatus, 'M');

        const libTree = app.readExplorerTree('src/lib');
        const briefEntry = libTree.find((e) => e.name === 'brief.ts');
        assert.equal(briefEntry.gitStatus, 'A');
        assert.equal(briefEntry.gitStatusColor, '#2F6B4F');

        const tab = app.openEditorFile('src/routes/compare.ts', { splitDirection: 'right' });
        assert.equal(tab.breadcrumbs, 'src › routes › compare.ts');
        assert.equal(tab.diffGutterColor, '#E3F3E2');
      });
    },
  },
  {
    id: 'T3-PW-14',
    tier: 3,
    feature: 3,
    features: [3, 15, 16],
    title: 'Monaco editor dirty tab + external disk modification + mtime conflict guard blocking silent overwrite + boundary check',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [3, 15, 16], async ({ app, repoDir }) => {
        const opened = app.openEditorFile('src/routes/compare.ts');
        const absFile = path.join(repoDir, 'src/routes/compare.ts');

        // Simulate external modification on disk advancing mtime
        const bumpedTime = new Date(opened.mtimeMs + 5000);
        fs.writeFileSync(absFile, opened.content + '\n// external disk edit\n', 'utf8');
        fs.utimesSync(absFile, bumpedTime, bumpedTime);

        assert.throws(
          () => app.saveEditorFile('src/routes/compare.ts', '// dirty editor buffer\n', opened.mtimeMs),
          (err) => err.code === 'DISK_CONFLICT' && err.diskContent.includes('external disk edit'),
          'Editor must block silent overwrite when disk mtime changed externally',
        );

        // Saving with updated mtime succeeds
        const latestStat = fs.statSync(absFile);
        const saved = app.saveEditorFile('src/routes/compare.ts', '// resolved content\n', latestStat.mtimeMs);
        assert.equal(saved.saved, true);

        // Saving outside project boundary fails
        assert.throws(
          () => app.saveEditorFile('../../outside.ts', 'bad'),
          /EACCES_WORKSPACE_BOUNDARY/,
        );
      });
    },
  },
  {
    id: 'T3-PW-15',
    tier: 3,
    feature: 17,
    features: [8, 16, 17],
    title: 'Ripgrep (rg) streaming project search with regex/globs + multi-file replace preview + executing replacement and undo via checkpoint',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [8, 16, 17], async ({ app }) => {
        const session = app.startSession({ cliId: 'codex' });
        const matches = app.ripgrepSearch({
          query: 'toBrief',
          includeGlob: 'src/**',
        });
        assert.ok(matches.length >= 3, 'Expected ripgrep to find toBrief across src/** files');

        const preview = app.replaceAcrossFiles({
          query: 'toBrief',
          replacement: 'buildReviewBrief',
          includeGlob: 'src/**',
          previewOnly: true,
        });
        assert.equal(preview.previewOnly, true);
        assert.equal(preview.affectedFiles.length, 3);
        assert.equal(
          app.ripgrepSearch({ query: 'buildReviewBrief', includeGlob: 'src/**' }).length,
          0,
          'Preview mode must not modify files on disk',
        );

        const applied = app.replaceAcrossFiles({
          query: 'toBrief',
          replacement: 'buildReviewBrief',
          includeGlob: 'src/**',
          previewOnly: false,
          sessionId: session.id,
        });
        assert.ok(applied.checkpoint?.checkpointId);
        assert.ok(app.ripgrepSearch({ query: 'buildReviewBrief', includeGlob: 'src/**' }).length >= 3);

        // Undo checkpoint restores original identifier across all 3 files
        app.undoCheckpoint(applied.checkpoint.checkpointId);
        assert.equal(app.ripgrepSearch({ query: 'buildReviewBrief', includeGlob: 'src/**' }).length, 0);
      });
    },
  },
  {
    id: 'T3-PW-16',
    tier: 3,
    feature: 18,
    features: [18, 21, 22],
    title: 'Tasks runner executing package.json script in terminal + failing command output captured via 1-click Fix this error + @terminal chip',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [18, 21, 22], async ({ app }) => {
        const passRun = app.runTaskInTerminal('test');
        assert.equal(passRun.exitCode, 0);
        assert.ok(passRun.output.includes('121 tests passed'));

        const failRun = app.runTaskInTerminal('test:fail');
        assert.notEqual(failRun.exitCode, 0);
        assert.ok(failRun.output.includes("TypeError: Cannot read properties of undefined (reading 'toBrief')"));

        const fixAction = app.clickFixTerminalError(failRun);
        assert.equal(fixAction.dockedPanelOpen, true);
        assert.equal(fixAction.chips[0].id, '@terminal');
        assert.ok(fixAction.chips[0].content.includes('src/routes/compare.ts:5:16'));
      });
    },
  },
  {
    id: 'T3-PW-17',
    tier: 3,
    feature: 19,
    features: [8, 19, 21],
    title: 'Source Control inline hunk review (Hunk 1 of 2, Hunk 2 of 2) + Accept hunk 1, Reject hunk 2, Ask to change + gitCommit',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [8, 19, 21], async ({ app, repoDir }) => {
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

        const hunks = app.parseFileHunks(compareRel);
        assert.equal(hunks.length, 2, 'Expected 2 distinct hunks in src/routes/compare.ts');
        assert.equal(hunks[0].label, 'Hunk 1 of 2');
        assert.equal(hunks[1].label, 'Hunk 2 of 2');

        const composer = { chips: [] };
        const askRes = app.applyHunkAction(compareRel, 0, 'Ask to change', composer);
        assert.equal(askRes.action, 'Ask to change');
        assert.equal(composer.chips.length, 1);
        assert.equal(composer.chips[0].label, '@diff:compare.ts#hunk-1');

        // Reject Hunk 2 (reverts copyState back to 'idle' in working tree)
        app.applyHunkAction(compareRel, 1, 'Reject');
        const contentAfterReject = fs.readFileSync(path.join(repoDir, compareRel), 'utf8');
        assert.ok(contentAfterReject.includes('navigator.clipboard.writeText(text)'), 'Hunk 1 must remain intact');
        assert.ok(contentAfterReject.includes("return 'idle'"), 'Hunk 2 must be reverted in working tree');

        // Accept remaining Hunk 1 into staging index and commit
        app.applyHunkAction(compareRel, 0, 'Accept');
        const commitRes = app.gitCommit('add copy review brief hunk 1');
        assert.ok(commitRes.sha.length >= 7);
      });
    },
  },
  {
    id: 'T3-PW-18',
    tier: 3,
    feature: 20,
    features: [16, 20, 21],
    title: 'Code Intelligence LSP manager & TS diagnostics (2 problems) + Problems panel + docked Agent composer with @compare.ts, @selection, @problems',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [16, 20, 21], async ({ app }) => {
        const diag = app.inspectLspAndDiagnostics(['src/routes/compare.ts']);
        assert.equal(diag.problemsCount, 2);
        assert.equal(diag.problemsBadge, '2 problems');
        assert.equal(diag.statusBarColor, '#2F6B4F');
        assert.ok(
          diag.lspStatus.every((s) => s.silentInstallAttempted === false),
          'LSP manager must never install language servers silently',
        );

        const composerCtx = app.buildDockedAgentComposerContext({
          activeFile: 'src/routes/compare.ts',
          selection: 'return navigator.clipboard.writeText(text)',
          action: 'Fix',
        });
        assert.deepEqual(composerCtx.chips, ['@compare.ts', '@selection', '@problems']);
        assert.equal(composerCtx.chipPayloads['@problems'].length, 2);
        assert.equal(composerCtx.statusBar.background, '#2F6B4F');
      });
    },
  },
  {
    id: 'T3-PW-19',
    tier: 3,
    feature: 16,
    features: [6, 16, 21],
    title: 'Follow agent toggle active in docked Agent panel + agent streaming file-edit on brief.ts + editor auto-opening tab with CLI dot (● brief.ts)',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [6, 16, 21], async ({ app }) => {
        app.setFollowAgent(true);
        const session = app.startSession({ cliId: 'codex' });

        await app.runTurn(session.id, 'Build brief helper and follow agent', {
          scenario: 'follow-agent-edit',
        });

        const layout = app.getWorkbenchLayout();
        assert.equal(layout.followAgent, true);
        assert.equal(layout.activeTab, 'src/lib/brief.ts', 'Follow agent must automatically focus the agent-edited file tab');
        assert.ok(layout.openTabs.includes('src/lib/brief.ts'));

        const tabModel = app.openEditorFile('src/lib/brief.ts');
        assert.ok(tabModel.agentDot, 'Edited file tab must display CLI-colored dot');
        assert.equal(tabModel.agentDot.tabLabel, '● brief.ts');
        assert.equal(tabModel.agentDot.color, '#1B2B22');
      });
    },
  },
  {
    id: 'T3-PW-20',
    tier: 3,
    feature: 22,
    features: [18, 20, 22],
    title: 'Code Intelligence symbol outline + DAP debugger starting Node debug session, hitting breakpoint, inspecting variables & evaluating expression',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [18, 20, 22], async ({ app }) => {
        const outline = app.getSymbolOutline('src/routes/compare.ts');
        assert.deepEqual(
          outline.map((s) => s.name),
          ['copyBrief', 'copyState'],
        );

        const dap = await app.runDapDebugSession({
          scriptRelPath: 'src/routes/compare.ts',
          breakpointLine: 4,
          expression: 'rows.map(r => r.label).join(",")',
        });
        assert.equal(dap.stopped, true);
        assert.equal(dap.reason, 'breakpoint');
        assert.equal(dap.callStack[0].name, 'copyBrief');
        assert.equal(dap.variables.rows.length, 2);
        assert.equal(dap.evaluated.value, 'api,db');
      });
    },
  },
  {
    id: 'T3-PW-21',
    tier: 3,
    feature: 2,
    features: [2, 4, 23],
    title: 'Adapter SDK template adapter loaded from user folder + passing shared contract test suite + child-process execution with zero API keys',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [2, 4, 23], async ({ app, homeDir, mockCliPath }) => {
        const customAdapterDir = path.join(homeDir, 'custom-adapters', 'qwen-cli');
        fs.mkdirSync(customAdapterDir, { recursive: true });
        fs.copyFileSync(mockCliPath, path.join(customAdapterDir, 'cli.mjs'));
        fs.writeFileSync(
          path.join(customAdapterDir, 'adapter.json'),
          JSON.stringify(
            {
              id: 'qwen-cli',
              displayName: 'Qwen Code CLI',
              color: '#0D9488',
              testedVersion: '1.0.0',
              entry: 'cli.mjs',
              capabilities: {
                acp: false,
                jsonStream: true,
                resume: false,
                approvals: true,
                readOnlyMode: true,
                reportsUsage: true,
              },
            },
            null,
            2,
          ),
          'utf8',
        );

        const sdkRes = await app.loadThirdPartyAdapterFromFolder(customAdapterDir);
        assert.equal(sdkRes.allPassed, true, 'Third-party adapter must pass all 7 shared contract tests');
        assert.equal(sdkRes.contractResults.detectAndStart, true);
        assert.equal(sdkRes.contractResults.streamMessage, true);
        assert.equal(sdkRes.contractResults.fileEdit, true);
        assert.equal(sdkRes.contractResults.handleApproval, true);
        assert.equal(sdkRes.contractResults.cancelMidRun, true);
        assert.equal(sdkRes.contractResults.resumeOrDegrade, true);
        assert.equal(sdkRes.contractResults.usageReport, true);
      });
    },
  },
  {
    id: 'T3-PW-22',
    tier: 3,
    feature: 23,
    features: [3, 23, 24],
    title: 'Extension loader reading ~/.osmium/extensions/<name>/osmium.json + enforcing permission gate for node-process + registering commands',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [3, 23, 24], async ({ app }) => {
        const extDir = path.join(app.extensionsDir, 'sample-lsp-theme');
        fs.mkdirSync(extDir, { recursive: true });
        fs.writeFileSync(
          path.join(extDir, 'osmium.json'),
          JSON.stringify(
            {
              name: 'sample-lsp-theme',
              version: '1.0.0',
              permissions: ['node-process'],
              contributes: {
                themes: [{ id: 'forest-calm', label: 'Forest Calm' }],
                languageServers: [{ id: 'custom-toml-lsp', languages: ['toml'] }],
                commands: [{ id: 'ext.formatToml', title: 'Format TOML Document' }],
              },
            },
            null,
            2,
          ),
          'utf8',
        );

        // Without user permission approval, node-process extension must be blocked
        const blocked = app.loadExtensionFromFolder(extDir, { approvePermissions: false });
        assert.equal(blocked.loaded, false);
        assert.equal(blocked.blockedByPermissionPrompt, true);
        assert.equal(blocked.requiredPermission, 'node-process');

        // With explicit user permission approval, extension loads and registers commands
        const approved = app.loadExtensionFromFolder(extDir, { approvePermissions: true });
        assert.equal(approved.loaded, true);
        assert.ok(app.registeredCommands.has('ext.formatToml'));
      });
    },
  },
  {
    id: 'T3-PW-23',
    tier: 3,
    feature: 24,
    features: [7, 16, 24],
    title: 'Command Registry & Command Palette (Ctrl/Cmd+K, Ctrl/Cmd+Shift+P) + Quick Open (Ctrl/Cmd+P) + Session Replay timeline from SQLite',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [7, 16, 24], async ({ app }) => {
        assert.ok(app.registeredCommands.has('osmium.commandPalette'));
        assert.ok(app.registeredCommands.has('osmium.commandPaletteShift'));
        assert.ok(app.registeredCommands.has('osmium.quickOpen'));

        const quickOpened = app.openEditorFile('src/CompareView.tsx');
        assert.equal(quickOpened.breadcrumbs, 'src › CompareView.tsx');

        const session = app.startSession({ cliId: 'codex', title: 'Replayable session' });
        await app.runTurn(session.id, 'Generate replay events', { scenario: 'chat-edit' });

        const timeline = app.getReplayTimeline(session.id);
        assert.ok(timeline.length >= 6, 'Replay timeline should include user message, status, assistant messages, tool, and file-edit steps');
        assert.equal(timeline[0].stepIndex, 1);
        assert.ok(timeline.some((s) => s.summary.includes('edited src/compare-model.ts')));
      });
    },
  },
  {
    id: 'T3-PW-24',
    tier: 3,
    feature: 9,
    features: [1, 9, 24],
    title: 'Design system light-to-dark theme CSS variable token swap ([data-theme="dark"]) + electron-builder config + open-source governance docs',
    async fn(ctx = {}) {
      await withTempOsmiumEnv(ctx, [1, 9, 24], async ({ app, repoDir }) => {
        assert.equal(DESIGN_TOKENS_LIGHT['--bg-ground'], '#F6F8F5');
        assert.equal(DESIGN_TOKENS_LIGHT['--bg-sidebar'], '#EAF1E8');
        assert.equal(DESIGN_TOKENS_LIGHT['--accent-primary'], '#2F6B4F');

        const darkState = app.switchTheme('dark');
        assert.equal(darkState.domAttribute, '[data-theme="dark"]');
        assert.equal(darkState.tokens['--bg-ground'], DESIGN_TOKENS_DARK['--bg-ground']);
        assert.equal(app.getWorkbenchLayout().theme, 'dark');

        const gov = app.verifyReleaseAndGovernanceBundle(repoDir);
        assert.equal(gov.builderConfig.autoUpdate, false, 'electron-builder autoUpdate must be off by default');
        assert.ok(gov.builderRaw.includes('autoUpdate: false'));
        assert.ok(
          gov.filesVerified.every((f) => f.exists),
          'All required open-source governance and plan/progress docs must exist',
        );
      });
    },
  },
];
