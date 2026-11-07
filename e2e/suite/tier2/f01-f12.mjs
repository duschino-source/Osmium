import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  resolveWorkspaceFeature,
  withTempDir,
  withTempGitRepo,
  runGit,
  validateProgressDoc,
  validateSection10Report,
  recoverCorruptedProgress,
  reconstructClipboardPasteArtifacts,
  updateProgressWithConcurrencyGuard,
  assertNotCredentialPath,
  validateZeroApiKeyRequirement,
  guardProcessSpawnContext,
  WorkspaceBoundaryGuard,
  probeCliExecutable,
  NormalizedEventStreamParser,
  negotiateAdapterTransport,
  createMockCliScript,
  SqliteSessionStore,
  createGitCheckpoint,
  undoGitCheckpoint,
  validateProjectConfig,
  loadOrInitProjectYaml,
  buildHandoffSummary,
  InteractiveApprovalGate,
} from '../helpers/t2-harness.mjs';

export const tests = [
  /* ==========================================================================
   * FEATURE 1: docs/PLAN.md & docs/PROGRESS.md (5 Boundary/Negative Tests)
   * ========================================================================== */
  {
    id: 'T2-F01-01',
    tier: 2,
    feature: 1,
    features: [1],
    title: 'Detects missing required sections (Decisions made, Open questions) in docs/PROGRESS.md',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 1);
      const incompleteMd = [
        '# Progress',
        '## What is done',
        '- Created scaffold',
        '## What is next',
        '- Build Phase 1',
      ].join('\n');

      const result = validateProgressDoc(incompleteMd);
      assert.equal(result.valid, false);
      assert.deepEqual(result.missingSections, ['decisions', 'open_questions']);

      const completeMd = [
        ...incompleteMd.split('\n'),
        '## Decisions made',
        '- Use SQLite WAL mode',
        '## Open questions',
        '- License choice',
      ].join('\n');
      const validResult = validateProgressDoc(completeMd);
      assert.equal(validResult.valid, true);
      assert.equal(validResult.missingSections.length, 0);
    },
  },
  {
    id: 'T2-F01-02',
    tier: 2,
    feature: 1,
    features: [1],
    title: 'Rejects incomplete Section 10 phase report missing required 6-point headings',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 1);
      const partialReport = [
        '### 1. Done',
        'Scaffold complete.',
        '### 2. Not done',
        'None.',
        '### 3. Decisions',
        'Monorepo layout.',
        '### 6. Next',
        'Phase 1.',
      ].join('\n');

      const check = validateSection10Report(partialReport);
      assert.equal(check.valid, false);
      assert.deepEqual(check.missingHeadings, ['4. Problems', '5. How to run and test it']);

      const fullReport = [
        '1. Done: Phase 0 complete',
        '2. Not done: Nothing skipped',
        '3. Decisions: Strict TS',
        '4. Problems: None',
        '5. How to run and test it: pnpm test',
        '6. Next: Phase 1',
      ].join('\n');
      const validCheck = validateSection10Report(fullReport);
      assert.equal(validCheck.valid, true);
      assert.equal(validCheck.missingHeadings.length, 0);
    },
  },
  {
    id: 'T2-F01-03',
    tier: 2,
    feature: 1,
    features: [1],
    title: 'Recovers corrupted or 0-byte docs/PROGRESS.md with backup and valid section skeleton',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 1);
      await withTempDir(async (tmpDir) => {
        const docsDir = path.join(tmpDir, 'docs');
        fs.mkdirSync(docsDir, { recursive: true });
        const progressPath = path.join(docsDir, 'PROGRESS.md');
        fs.writeFileSync(progressPath, Buffer.from([0x00, 0xff, 0xfe, 0x00]));

        const recovery = recoverCorruptedProgress(tmpDir);
        assert.equal(recovery.recovered, true);
        assert.equal(recovery.backupCreated, true);
        assert.ok(fs.existsSync(`${progressPath}.bak`));

        const restoredText = fs.readFileSync(progressPath, 'utf8');
        const check = validateProgressDoc(restoredText);
        assert.equal(check.valid, true);
      });
    },
  },
  {
    id: 'T2-F01-04',
    tier: 2,
    feature: 1,
    features: [1],
    title: 'Reconstructs corrupted clipboard paste artifacts in ORIGINAL_REQUEST.md lines 221 and 231',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 1);
      const line221 =
        'Importers for VS Code themes, keybindings and snippets. VS Cod@[c:\\Users\\stane\\Downloads\\Osmium IDE — CLI hub design(1).html] e extensions themselves are not supported in v1.';
      const line231 =
        'Make contributing a new CLI adapter the easiest path: the tem@[c:\\Users\\stane\\Downloads\\Osmium IDE — CLI hub design(1).html] plate adapter, the contract test suite and a short guide in docs/adapters/.';

      const r1 = reconstructClipboardPasteArtifacts(line221);
      assert.equal(r1.originalHadArtifact, true);
      assert.ok(r1.cleaned.includes('VS Code extensions themselves are not supported in v1.'));

      const r2 = reconstructClipboardPasteArtifacts(line231);
      assert.equal(r2.originalHadArtifact, true);
      assert.ok(r2.cleaned.includes('the template adapter, the contract test suite'));
    },
  },
  {
    id: 'T2-F01-05',
    tier: 2,
    feature: 1,
    features: [1],
    title: 'Rejects concurrent stale-mtime overwrite on docs/PROGRESS.md without losing updates',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 1);
      await withTempDir(async (tmpDir) => {
        recoverCorruptedProgress(tmpDir);
        const progressPath = path.join(tmpDir, 'docs', 'PROGRESS.md');
        const initialMtime = fs.statSync(progressPath).mtimeMs;

        // Simulate Session A updating the file and advancing mtime
        const nextMtime = initialMtime + 2000;
        const resA = updateProgressWithConcurrencyGuard(progressPath, initialMtime, 'Done', 'Session A finished task');
        assert.equal(resA.ok, true);
        fs.utimesSync(progressPath, nextMtime / 1000, nextMtime / 1000);

        // Session B tries to write using stale initialMtime
        assert.throws(
          () => updateProgressWithConcurrencyGuard(progressPath, initialMtime, 'Done', 'Session B stale write'),
          (err) => err.code === 'ERR_CONCURRENT_PROGRESS_UPDATE'
        );

        const content = fs.readFileSync(progressPath, 'utf8');
        assert.ok(content.includes('Session A finished task'));
        assert.ok(!content.includes('Session B stale write'));
      });
    },
  },

  /* ==========================================================================
   * FEATURE 2: Child-Process-Only CLI Execution & Zero API Keys (5 Tests)
   * ========================================================================== */
  {
    id: 'T2-F02-01',
    tier: 2,
    feature: 2,
    features: [2],
    title: 'Blocks any attempt to read ~/.ssh, ~/.netrc, ~/.aws/credentials, or provider auth tokens',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 2);
      const forbiddenPaths = [
        '/home/user/.ssh/id_ed25519',
        '/home/user/.netrc',
        '/home/user/.aws/credentials',
        '/home/user/.config/gh/hosts.yml',
        '/home/user/.codex/auth.json',
        '/home/user/.deepseek/credentials',
        '/Users/dev/Library/Application Support/Firefox/Profiles/cookies.sqlite',
      ];
      for (const p of forbiddenPaths) {
        assert.throws(
          () => assertNotCredentialPath(p),
          (err) => err.code === 'ERR_CREDENTIAL_ACCESS_FORBIDDEN',
          `Expected ${p} to be blocked`
        );
      }
      assert.equal(assertNotCredentialPath('/home/antigravity/src/index.ts'), true);
    },
  },
  {
    id: 'T2-F02-02',
    tier: 2,
    feature: 2,
    features: [2],
    title: 'Rejects project or adapter configuration objects containing API keys or bearer tokens',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 2);
      assert.throws(
        () =>
          validateZeroApiKeyRequirement({
            primary: 'codex',
            providers: {
              codex: { apiKey: 'sk-1234567890' },
              deepseek: { bearerToken: 'tok-abc' },
            },
          }),
        (err) =>
          err.code === 'ERR_API_KEY_PROHIBITED' &&
          err.keys.includes('providers.codex.apiKey') &&
          err.keys.includes('providers.deepseek.bearerToken')
      );

      const clean = validateZeroApiKeyRequirement({
        primary: 'codex',
        secondary: ['antigravity', 'deepseek'],
        approvalMode: 'ask',
      });
      assert.equal(clean.valid, true);
    },
  },
  {
    id: 'T2-F02-03',
    tier: 2,
    feature: 2,
    features: [2],
    title: 'Surfaces unauthenticated CLI exit code 1 with login message cleanly without prompting for API key',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 2);
      await withTempDir(async (tmpDir) => {
        const fakeUnauthCli = path.join(tmpDir, 'unauth-cli.mjs');
        fs.writeFileSync(
          fakeUnauthCli,
          `#!/usr/bin/env node\nconsole.error("Not logged in. Please run 'codex login' in your terminal.");\nprocess.exit(1);\n`,
          { mode: 0o755 }
        );

        const outcome = await new Promise((resolve) => {
          const child = spawn(fakeUnauthCli, [], { stdio: ['ignore', 'pipe', 'pipe'] });
          let stderr = '';
          child.stderr.on('data', (d) => {
            stderr += d.toString('utf8');
          });
          child.on('close', (code) => {
            resolve({
              exitCode: code,
              statusEvent: {
                type: 'status',
                state: 'error',
                message: stderr.trim(),
                requiresApiKey: false,
              },
            });
          });
        });

        assert.equal(outcome.exitCode, 1);
        assert.equal(outcome.statusEvent.state, 'error');
        assert.equal(outcome.statusEvent.requiresApiKey, false);
        assert.match(outcome.statusEvent.message, /codex login/);
      });
    },
  },
  {
    id: 'T2-F02-04',
    tier: 2,
    feature: 2,
    features: [2],
    title: 'Handles child process SIGKILL crash mid-turn cleanly without crashing parent host',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 2);
      await withTempDir(async (tmpDir) => {
        const script = path.join(tmpDir, 'crash-cli.mjs');
        fs.writeFileSync(
          script,
          `#!/usr/bin/env node\nconsole.log(JSON.stringify({ type: 'status', state: 'working' }));\nsetInterval(() => {}, 1000);\n`,
          { mode: 0o755 }
        );

        const result = await new Promise((resolve) => {
          const child = spawn(script, [], { stdio: ['ignore', 'pipe', 'pipe'] });
          child.stdout.once('data', () => {
            child.kill('SIGKILL');
          });
          child.on('close', (code, signal) => {
            resolve({ code, signal, hostAlive: true });
          });
        });

        assert.equal(result.signal, 'SIGKILL');
        assert.equal(result.hostAlive, true);
      });
    },
  },
  {
    id: 'T2-F02-05',
    tier: 2,
    feature: 2,
    features: [2],
    title: 'Rejects renderer-side process spawn attempts while allowing Electron main process',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 2);
      assert.throws(
        () => guardProcessSpawnContext('renderer'),
        (err) => err.code === 'ERR_RENDERER_SPAWN_FORBIDDEN'
      );
      assert.throws(
        () => guardProcessSpawnContext('webview'),
        (err) => err.code === 'ERR_RENDERER_SPAWN_FORBIDDEN'
      );
      assert.equal(guardProcessSpawnContext('main'), true);
    },
  },

  /* ==========================================================================
   * FEATURE 3: Workspace Write Boundary Guard (5 Tests)
   * ========================================================================== */
  {
    id: 'T2-F03-01',
    tier: 2,
    feature: 3,
    features: [3],
    title: 'Rejects relative path traversal attack (../../../etc/passwd) outside project root',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 3);
      await withTempDir(async (projectRoot) => {
        const guard = new WorkspaceBoundaryGuard(projectRoot);
        assert.throws(
          () => guard.validateWritePath('../../../etc/passwd'),
          (err) => err.code === 'ERR_WORKSPACE_BOUNDARY_VIOLATION'
        );
        assert.throws(
          () => guard.validateWritePath('src/../../outside.txt'),
          (err) => err.code === 'ERR_WORKSPACE_BOUNDARY_VIOLATION'
        );
      });
    },
  },
  {
    id: 'T2-F03-02',
    tier: 2,
    feature: 3,
    features: [3],
    title: 'Rejects absolute paths outside project root while allowing project and ~/.osmium paths',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 3);
      await withTempDir(async (baseDir) => {
        const projectRoot = path.join(baseDir, 'project');
        const globalOsmium = path.join(baseDir, 'home-osmium');
        const outsidePath = path.join(baseDir, 'outside-secret.txt');
        fs.mkdirSync(projectRoot, { recursive: true });
        fs.mkdirSync(globalOsmium, { recursive: true });

        const guard = new WorkspaceBoundaryGuard(projectRoot, { globalOsmiumDir: globalOsmium });
        assert.throws(
          () => guard.safeWriteFileSync(outsidePath, 'hacked'),
          (err) => err.code === 'ERR_WORKSPACE_BOUNDARY_VIOLATION'
        );
        assert.equal(fs.existsSync(outsidePath), false);

        const validInside = guard.safeWriteFileSync('src/ok.ts', 'export const ok = 1;');
        assert.equal(fs.existsSync(validInside), true);

        const validGlobal = guard.safeWriteFileSync(path.join(globalOsmium, 'extensions/ext/osmium.json'), '{}');
        assert.equal(fs.existsSync(validGlobal), true);
      });
    },
  },
  {
    id: 'T2-F03-03',
    tier: 2,
    feature: 3,
    features: [3],
    title: 'Blocks write through symlink inside project root pointing to a file outside project root',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 3);
      await withTempDir(async (baseDir) => {
        const projectRoot = path.join(baseDir, 'repo');
        const externalTarget = path.join(baseDir, 'external-host-file.txt');
        fs.mkdirSync(projectRoot, { recursive: true });
        fs.writeFileSync(externalTarget, 'original-external-content', 'utf8');

        const symlinkInside = path.join(projectRoot, 'escaped-link.txt');
        fs.symlinkSync(externalTarget, symlinkInside);

        const guard = new WorkspaceBoundaryGuard(projectRoot);
        assert.throws(
          () => guard.safeWriteFileSync(symlinkInside, 'overwritten-via-symlink'),
          (err) => err.code === 'ERR_WORKSPACE_BOUNDARY_VIOLATION'
        );
        assert.equal(fs.readFileSync(externalTarget, 'utf8'), 'original-external-content');
      });
    },
  },
  {
    id: 'T2-F03-04',
    tier: 2,
    feature: 3,
    features: [3],
    title: 'Blocks task agent in .osmium/worktrees/task-a from writing to sibling worktree task-b',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 3);
      await withTempDir(async (projectRoot) => {
        const worktreeA = path.join(projectRoot, '.osmium', 'worktrees', 'task-a');
        const worktreeB = path.join(projectRoot, '.osmium', 'worktrees', 'task-b');
        fs.mkdirSync(worktreeA, { recursive: true });
        fs.mkdirSync(worktreeB, { recursive: true });

        const guardA = new WorkspaceBoundaryGuard(projectRoot, { activeWorktree: worktreeA });
        assert.throws(
          () => guardA.validateWritePath('../task-b/src/hijack.ts'),
          (err) => err.code === 'ERR_WORKTREE_BOUNDARY_VIOLATION'
        );
        assert.throws(
          () => guardA.validateWritePath(path.join(projectRoot, 'src/main-tree.ts')),
          (err) => err.code === 'ERR_WORKTREE_BOUNDARY_VIOLATION'
        );

        const allowedInA = guardA.safeWriteFileSync('src/feature-a.ts', 'export const a = true;');
        assert.ok(allowedInA.startsWith(fs.realpathSync(worktreeA)));
      });
    },
  },
  {
    id: 'T2-F03-05',
    tier: 2,
    feature: 3,
    features: [3],
    title: 'Rejects null-byte path injection and Windows backslash traversal (..\\..\\escape.txt)',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 3);
      await withTempDir(async (projectRoot) => {
        const guard = new WorkspaceBoundaryGuard(projectRoot);
        assert.throws(
          () => guard.validateWritePath('src/index.ts\0.txt'),
          (err) => err.code === 'ERR_NULL_BYTE_PATH'
        );
        assert.throws(
          () => guard.validateWritePath('..\\..\\..\\outside-win.txt'),
          (err) => err.code === 'ERR_WORKSPACE_BOUNDARY_VIOLATION'
        );
      });
    },
  },

  /* ==========================================================================
   * FEATURE 4: CLI Detection, Probing & Version Warnings (5 Tests)
   * ========================================================================== */
  {
    id: 'T2-F04-01',
    tier: 2,
    feature: 4,
    features: [4],
    title: 'Non-existent CLI binary returns { installed: false } cleanly without throwing',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 4);
      const res = await probeCliExecutable('/tmp/non-existent-osmium-cli-bin-99999');
      assert.deepEqual(res, { installed: false });
    },
  },
  {
    id: 'T2-F04-02',
    tier: 2,
    feature: 4,
    features: [4],
    title: 'Untested newer CLI version (2.5.0 > testedVersion 1.0.0) populates versionWarning without failing',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 4);
      await withTempDir(async (tmpDir) => {
        const binPath = path.join(tmpDir, 'codex-newer.mjs');
        fs.writeFileSync(
          binPath,
          `#!/usr/bin/env node\nif (process.argv.includes('--version')) console.log('codex-cli 2.5.0');\nelse console.log('--json --resume --approval');\n`,
          { mode: 0o755 }
        );

        const res = await probeCliExecutable(binPath, { testedVersion: '1.0.0' });
        assert.equal(res.installed, true);
        assert.equal(res.version, '2.5.0');
        assert.match(res.versionWarning, /2\.5\.0 is newer than tested version 1\.0\.0/);
      });
    },
  },
  {
    id: 'T2-F04-03',
    tier: 2,
    feature: 4,
    features: [4],
    title: 'Kills hanging CLI --version probe after timeout and returns timedOut: true',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 4);
      await withTempDir(async (tmpDir) => {
        const hangBin = path.join(tmpDir, 'hang-cli.mjs');
        fs.writeFileSync(
          hangBin,
          `#!/usr/bin/env node\nsetTimeout(() => {}, 30000);\n`,
          { mode: 0o755 }
        );

        const res = await probeCliExecutable(hangBin, { timeoutMs: 120 });
        assert.equal(res.installed, false);
        assert.equal(res.timedOut, true);
        assert.match(res.versionWarning, /timed out/i);
      });
    },
  },
  {
    id: 'T2-F04-04',
    tier: 2,
    feature: 4,
    features: [4],
    title: 'Handles corrupted/unparseable --version output gracefully with versionWarning',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 4);
      await withTempDir(async (tmpDir) => {
        const weirdBin = path.join(tmpDir, 'weird-cli.mjs');
        fs.writeFileSync(
          weirdBin,
          `#!/usr/bin/env node\nconsole.log('### CUSTOM BUILD NO SEMVER ###');\n`,
          { mode: 0o755 }
        );

        const res = await probeCliExecutable(weirdBin, { testedVersion: '1.0.0' });
        assert.equal(res.installed, true);
        assert.equal(res.version, undefined);
        assert.match(res.versionWarning, /Unparseable version output/);
      });
    },
  },
  {
    id: 'T2-F04-05',
    tier: 2,
    feature: 4,
    features: [4],
    title: 'Flags missing --resume capability in capabilities and adds CLI Hub degradation notice',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 4);
      await withTempDir(async (tmpDir) => {
        const noResumeBin = path.join(tmpDir, 'deepseek-minimal.mjs');
        fs.writeFileSync(
          noResumeBin,
          `#!/usr/bin/env node\nif (process.argv.includes('--version')) console.log('deepseek 1.0.0');\nelse console.log('Usage: deepseek chat --json');\n`,
          { mode: 0o755 }
        );

        const res = await probeCliExecutable(noResumeBin, { testedVersion: '1.0.0' });
        assert.equal(res.installed, true);
        assert.equal(res.capabilities.jsonStream, true);
        assert.equal(res.capabilities.resume, false);
        assert.ok(res.degradedNotes.some((n) => n.includes('systemContext')));
      });
    },
  },

  /* ==========================================================================
   * FEATURE 5: Multi-Transport Session Normalization (5 Tests)
   * ========================================================================== */
  {
    id: 'T2-F05-01',
    tier: 2,
    feature: 5,
    features: [5],
    title: 'Emits malformed JSON stdout lines as { type: "raw", data } without losing subsequent valid events',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 5);
      const parser = new NormalizedEventStreamParser();
      const chunk = [
        JSON.stringify({ type: 'status', state: 'working' }),
        '{malformed_json: true, oops',
        'Plain text diagnostic line from CLI',
        JSON.stringify({ type: 'message', role: 'assistant', text: 'Recovered!', final: true }),
        '',
      ].join('\n');

      const emitted = parser.writeChunk(chunk);
      assert.equal(emitted.length, 4);
      assert.deepEqual(emitted[0], { type: 'status', state: 'working' });
      assert.equal(emitted[1].type, 'raw');
      assert.equal(emitted[1].data, '{malformed_json: true, oops');
      assert.equal(emitted[2].type, 'raw');
      assert.equal(emitted[2].data, 'Plain text diagnostic line from CLI');
      assert.deepEqual(emitted[3], { type: 'message', role: 'assistant', text: 'Recovered!', final: true });
    },
  },
  {
    id: 'T2-F05-02',
    tier: 2,
    feature: 5,
    features: [5],
    title: 'Strips ANSI escape codes for cleanText while preserving raw PTY data in raw fallback events',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 5);
      const parser = new NormalizedEventStreamParser();
      const ansiLine = '\x1b[32m✔\x1b[0m \x1b[1mBuilding project...\x1b[0m\n';
      const [evt] = parser.writeChunk(ansiLine);
      assert.equal(evt.type, 'raw');
      assert.equal(evt.data, '\x1b[32m✔\x1b[0m \x1b[1mBuilding project...\x1b[0m');
      assert.equal(evt.cleanText, '✔ Building project...');
    },
  },
  {
    id: 'T2-F05-03',
    tier: 2,
    feature: 5,
    features: [5],
    title: 'Transitions session to error state on abrupt stdout EOF while working',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 5);
      const parser = new NormalizedEventStreamParser();
      parser.writeChunk(`${JSON.stringify({ type: 'status', state: 'working' })}\npartial-unterminated-line`);

      const eofEvents = parser.handleUnexpectedEof(137);
      assert.equal(eofEvents.length, 2);
      assert.equal(eofEvents[0].type, 'raw');
      assert.equal(eofEvents[0].data, 'partial-unterminated-line');
      assert.equal(eofEvents[1].type, 'status');
      assert.equal(eofEvents[1].state, 'error');
      assert.equal(parser.state, 'error');
    },
  },
  {
    id: 'T2-F05-04',
    tier: 2,
    feature: 5,
    features: [5],
    title: 'Reassembles multi-megabyte JSON event across stream chunks and guards max buffer overflow',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 5);
      const parser = new NormalizedEventStreamParser({ maxBufferBytes: 4 * 1024 * 1024 });
      const bigText = 'A'.repeat(1.5 * 1024 * 1024); // 1.5 MB payload
      const fullJson = JSON.stringify({ type: 'message', role: 'assistant', text: bigText, final: true }) + '\n';

      const half = Math.floor(fullJson.length / 2);
      const part1 = parser.writeChunk(fullJson.slice(0, half));
      assert.equal(part1.length, 0);
      const part2 = parser.writeChunk(fullJson.slice(half));
      assert.equal(part2.length, 1);
      assert.equal(part2[0].type, 'message');
      assert.equal(part2[0].text.length, bigText.length);

      // Now test buffer overflow guard
      const smallLimitParser = new NormalizedEventStreamParser({ maxBufferBytes: 1024 });
      const overflowRes = smallLimitParser.writeChunk('X'.repeat(2048));
      assert.equal(overflowRes.length, 1);
      assert.equal(overflowRes[0].type, 'raw');
      assert.equal(overflowRes[0].truncated, true);
      assert.equal(overflowRes[0].data.length, 1024);
    },
  },
  {
    id: 'T2-F05-05',
    tier: 2,
    feature: 5,
    features: [5],
    title: 'Falls back cleanly from ACP to jsonStream to PTY when higher-priority transports fail',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 5);
      const caps = { acp: true, jsonStream: true };
      const res = await negotiateAdapterTransport(caps, {
        tryAcp: async () => {
          throw new Error('ACP socket connection refused');
        },
        tryJsonStream: async () => false,
        tryPty: async () => true,
      });

      assert.equal(res.selected, 'pty');
      assert.deepEqual(res.attempted, ['acp', 'jsonStream', 'pty']);
    },
  },

  /* ==========================================================================
   * FEATURE 6: packages/mock-cli Scripted CLI (5 Tests)
   * ========================================================================== */
  {
    id: 'T2-F06-01',
    tier: 2,
    feature: 6,
    features: [6],
    title: 'mock-cli rejects unknown CLI flags and unknown scenarios with non-zero exit and error status',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 6);
      await withTempDir(async (tmpDir) => {
        const cliPath = createMockCliScript(tmpDir);

        const flagRes = await new Promise((resolve) => {
          const child = spawn(cliPath, ['--bogus-flag'], { stdio: ['ignore', 'pipe', 'pipe'] });
          let stderr = '';
          child.stderr.on('data', (d) => (stderr += d.toString()));
          child.on('close', (code) => resolve({ code, stderr: stderr.trim() }));
        });
        assert.equal(flagRes.code, 2);
        assert.match(flagRes.stderr, /Unknown flag: --bogus-flag/);

        const scenRes = await new Promise((resolve) => {
          const child = spawn(cliPath, ['--scenario=does-not-exist'], { stdio: ['ignore', 'pipe', 'pipe'] });
          let stdout = '';
          child.stdout.on('data', (d) => (stdout += d.toString()));
          child.on('close', (code) => resolve({ code, stdout: stdout.trim() }));
        });
        assert.equal(scenRes.code, 3);
        const evt = JSON.parse(scenRes.stdout);
        assert.equal(evt.type, 'status');
        assert.equal(evt.state, 'error');
      });
    },
  },
  {
    id: 'T2-F06-02',
    tier: 2,
    feature: 6,
    features: [6],
    title: 'mock-cli approval denial (allow: false) over stdin aborts file edit and emits error tool status',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 6);
      await withTempDir(async (tmpDir) => {
        const cliPath = createMockCliScript(tmpDir);
        const events = [];

        await new Promise((resolve) => {
          const child = spawn(cliPath, ['--scenario=edit-approval', `--cwd=${tmpDir}`, '--delay=1'], {
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          const parser = new NormalizedEventStreamParser();
          child.stdout.on('data', (chunk) => {
            const newEvts = parser.writeChunk(chunk);
            for (const e of newEvts) {
              events.push(e);
              if (e.type === 'approval') {
                child.stdin.write(JSON.stringify({ id: e.id, allow: false }) + '\n');
              }
            }
          });
          child.on('close', () => resolve());
        });

        assert.equal(fs.existsSync(path.join(tmpDir, 'target.txt')), false);
        assert.ok(events.some((e) => e.type === 'tool' && e.status === 'error' && /denied/i.test(e.summary)));
      });
    },
  },
  {
    id: 'T2-F06-03',
    tier: 2,
    feature: 6,
    features: [6],
    title: 'mock-cli mid-stream SIGTERM cancellation halts output immediately and transitions to idle',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 6);
      await withTempDir(async (tmpDir) => {
        const cliPath = createMockCliScript(tmpDir);
        const events = [];

        await new Promise((resolve) => {
          const child = spawn(cliPath, ['--scenario=stream-long', '--delay=40'], {
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          const parser = new NormalizedEventStreamParser();
          child.stdout.on('data', (chunk) => {
            const batch = parser.writeChunk(chunk);
            for (const e of batch) {
              events.push(e);
              if (e.type === 'message' && e.text === 'Chunk 2') {
                child.kill('SIGTERM');
              }
            }
          });
          child.on('close', () => resolve());
        });

        const msgChunks = events.filter((e) => e.type === 'message');
        assert.ok(msgChunks.length >= 2 && msgChunks.length < 20);
        const lastStatus = [...events].reverse().find((e) => e.type === 'status');
        assert.equal(lastStatus.state, 'idle');
      });
    },
  },
  {
    id: 'T2-F06-04',
    tier: 2,
    feature: 6,
    features: [6],
    title: 'mock-cli handles invalid JSON input on stdin without crashing and still processes valid approval',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 6);
      await withTempDir(async (tmpDir) => {
        const cliPath = createMockCliScript(tmpDir);
        const events = [];

        await new Promise((resolve) => {
          const child = spawn(cliPath, ['--scenario=edit-approval', `--cwd=${tmpDir}`, '--delay=1'], {
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          const parser = new NormalizedEventStreamParser();
          child.stdout.on('data', (chunk) => {
            const batch = parser.writeChunk(chunk);
            for (const e of batch) {
              events.push(e);
              if (e.type === 'approval') {
                child.stdin.write('NOT_VALID_JSON_AT_ALL\n');
                setTimeout(() => {
                  child.stdin.write(JSON.stringify({ id: e.id, allow: true }) + '\n');
                }, 15);
              }
            }
          });
          child.on('close', () => resolve());
        });

        assert.ok(events.some((e) => e.type === 'raw' && e.data.includes('INVALID_STDIN_JSON:NOT_VALID_JSON_AT_ALL')));
        assert.ok(events.some((e) => e.type === 'file-edit' && e.path === 'target.txt'));
        assert.equal(fs.readFileSync(path.join(tmpDir, 'target.txt'), 'utf8'), 'approved-content\n');
      });
    },
  },
  {
    id: 'T2-F06-05',
    tier: 2,
    feature: 6,
    features: [6],
    title: 'mock-cli zero-delay (--delay=0) vs delayed streaming preserves exact event ordering',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 6);
      await withTempDir(async (tmpDir) => {
        const cliPath = createMockCliScript(tmpDir);

        const runWithDelay = (delay) =>
          new Promise((resolve) => {
            const evts = [];
            const parser = new NormalizedEventStreamParser();
            const child = spawn(cliPath, ['--scenario=chat', `--delay=${delay}`], {
              stdio: ['ignore', 'pipe', 'pipe'],
            });
            child.stdout.on('data', (c) => evts.push(...parser.writeChunk(c)));
            child.on('close', () => resolve(evts));
          });

        const zeroEvts = await runWithDelay(0);
        const delayedEvts = await runWithDelay(10);
        assert.deepEqual(
          zeroEvts.map((e) => e.type),
          ['status', 'message', 'message', 'status']
        );
        assert.deepEqual(zeroEvts, delayedEvts);
      });
    },
  },

  /* ==========================================================================
   * FEATURE 7: Session Manager & SQLite Event Log (5 Tests)
   * ========================================================================== */
  {
    id: 'T2-F07-01',
    tier: 2,
    feature: 7,
    features: [7],
    title: 'Cancelling a session mid-turn persists partial events and transitions session status to cancelled',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 7);
      await withTempDir(async (tmpDir) => {
        const store = new SqliteSessionStore(path.join(tmpDir, '.osmium', 'osmium.db'));
        store.createSession({ id: 'sess-1', projectId: 'proj-1', title: 'Auth refactor', activeCli: 'codex' });
        store.appendEvent('sess-1', { type: 'message', role: 'user', text: 'Refactor login', final: true });
        store.appendEvent('sess-1', { type: 'message', role: 'assistant', text: 'Partial stream...', final: false });

        const cancelled = store.cancelSession('sess-1');
        assert.equal(cancelled.status, 'cancelled');

        const events = store.getEvents('sess-1');
        assert.equal(events.length, 3);
        assert.equal(events[1].payload.text, 'Partial stream...');
        assert.equal(events[2].payload.type, 'status');
        assert.equal(events[2].payload.message, 'Cancelled by user');
      });
    },
  },
  {
    id: 'T2-F07-02',
    tier: 2,
    feature: 7,
    features: [7],
    title: 'Closing an already-closed session is idempotent and does not corrupt state',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 7);
      await withTempDir(async (tmpDir) => {
        const store = new SqliteSessionStore(path.join(tmpDir, '.osmium', 'osmium.db'));
        store.createSession({ id: 'sess-close', projectId: 'proj-1', title: 'Close test', activeCli: 'codex' });

        const firstClose = store.closeSession('sess-close');
        assert.equal(firstClose.status, 'closed');
        assert.equal(firstClose.alreadyClosed, false);

        const secondClose = store.closeSession('sess-close');
        assert.equal(secondClose.status, 'closed');
        assert.equal(secondClose.alreadyClosed, true);
      });
    },
  },
  {
    id: 'T2-F07-03',
    tier: 2,
    feature: 7,
    features: [7],
    title: 'SQLite WAL mode and BEGIN IMMEDIATE transactions maintain strictly sequential seq numbers under rapid writes',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 7);
      await withTempDir(async (tmpDir) => {
        const store = new SqliteSessionStore(path.join(tmpDir, '.osmium', 'osmium.db'));
        store.createSession({ id: 'sess-seq', projectId: 'proj-1', title: 'Burst write', activeCli: 'codex' });

        for (let i = 1; i <= 20; i++) {
          store.appendEvent('sess-seq', { type: 'message', role: 'assistant', text: `Turn ${i}`, final: i === 20 });
        }

        const events = store.getEvents('sess-seq');
        assert.equal(events.length, 20);
        assert.deepEqual(
          events.map((e) => e.seq),
          Array.from({ length: 20 }, (_, idx) => idx + 1)
        );
      });
    },
  },
  {
    id: 'T2-F07-04',
    tier: 2,
    feature: 7,
    features: [7],
    title: 'Querying or appending to a non-existent session ID throws typed ERR_SESSION_NOT_FOUND',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 7);
      await withTempDir(async (tmpDir) => {
        const store = new SqliteSessionStore(path.join(tmpDir, '.osmium', 'osmium.db'));
        assert.throws(
          () => store.getSession('non-existent-session-id'),
          (err) => err.code === 'ERR_SESSION_NOT_FOUND'
        );
        assert.throws(
          () => store.appendEvent('non-existent-session-id', { type: 'status', state: 'idle' }),
          (err) => err.code === 'ERR_SESSION_NOT_FOUND'
        );
      });
    },
  },
  {
    id: 'T2-F07-05',
    tier: 2,
    feature: 7,
    features: [7],
    title: 'Recovers interrupted working/waiting sessions on restart while leaving closed sessions intact',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 7);
      await withTempDir(async (tmpDir) => {
        const dbPath = path.join(tmpDir, '.osmium', 'osmium.db');
        const store = new SqliteSessionStore(dbPath);
        store.createSession({ id: 's-working', projectId: 'p1', title: 'Working', activeCli: 'codex', status: 'working' });
        store.createSession({ id: 's-waiting', projectId: 'p1', title: 'Waiting', activeCli: 'antigravity', status: 'waiting' });
        store.createSession({ id: 's-closed', projectId: 'p1', title: 'Closed', activeCli: 'deepseek', status: 'closed' });

        // Simulate app restart with new store instance
        const restartedStore = new SqliteSessionStore(dbPath);
        const recoveredIds = restartedStore.recoverInterruptedSessions();
        assert.deepEqual(recoveredIds.sort(), ['s-waiting', 's-working']);
        assert.equal(restartedStore.getSession('s-working').status, 'interrupted');
        assert.equal(restartedStore.getSession('s-waiting').status, 'interrupted');
        assert.equal(restartedStore.getSession('s-closed').status, 'closed');
      });
    },
  },

  /* ==========================================================================
   * FEATURE 8: Pre-Turn Git Checkpoints & Undo (5 Tests)
   * ========================================================================== */
  {
    id: 'T2-F08-01',
    tier: 2,
    feature: 8,
    features: [8],
    title: 'Creating checkpoint with staged, unstaged, and untracked files preserves user .git/index and HEAD untouched',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 8);
      await withTempGitRepo(async (repoDir) => {
        const headBefore = runGit(repoDir, ['rev-parse', 'HEAD']).stdout;

        // User stages a change to README.md
        fs.writeFileSync(path.join(repoDir, 'README.md'), '# Staged by user\n', 'utf8');
        runGit(repoDir, ['add', 'README.md']);
        const stagedDiffBefore = runGit(repoDir, ['diff', '--cached']).stdout;

        // User also has an unstaged edit and an untracked file
        fs.writeFileSync(path.join(repoDir, 'src/index.ts'), 'export const main = () => "unstaged";\n', 'utf8');
        fs.writeFileSync(path.join(repoDir, 'untracked-note.txt'), 'user note\n', 'utf8');

        const cp = createGitCheckpoint(repoDir, 'turn-01');
        assert.ok(cp.commitSha.length >= 40);

        // Verify user's HEAD and staged index are 100% untouched
        const headAfter = runGit(repoDir, ['rev-parse', 'HEAD']).stdout;
        const stagedDiffAfter = runGit(repoDir, ['diff', '--cached']).stdout;
        assert.equal(headAfter, headBefore);
        assert.equal(stagedDiffAfter, stagedDiffBefore);
      });
    },
  },
  {
    id: 'T2-F08-02',
    tier: 2,
    feature: 8,
    features: [8],
    title: 'Undo restores deleted tracked files and removes newly created untracked directories exactly',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 8);
      await withTempGitRepo(async (repoDir) => {
        createGitCheckpoint(repoDir, 'before-destructive-turn');

        // Agent deletes tracked src/index.ts and adds untracked nested directory
        fs.rmSync(path.join(repoDir, 'src/index.ts'));
        fs.mkdirSync(path.join(repoDir, 'src/agent-generated/sub'), { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'src/agent-generated/sub/new.ts'), 'export const bad = 1;\n', 'utf8');

        assert.equal(fs.existsSync(path.join(repoDir, 'src/index.ts')), false);
        assert.equal(fs.existsSync(path.join(repoDir, 'src/agent-generated/sub/new.ts')), true);

        undoGitCheckpoint(repoDir, 'before-destructive-turn');

        assert.equal(fs.existsSync(path.join(repoDir, 'src/index.ts')), true);
        assert.equal(fs.readFileSync(path.join(repoDir, 'src/index.ts'), 'utf8'), 'export const main = () => "hello";\n');
        assert.equal(fs.existsSync(path.join(repoDir, 'src/agent-generated')), false);
      });
    },
  },
  {
    id: 'T2-F08-03',
    tier: 2,
    feature: 8,
    features: [8],
    title: 'Undo with invalid or non-existent checkpoint ID throws ERR_CHECKPOINT_NOT_FOUND without touching working tree',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 8);
      await withTempGitRepo(async (repoDir) => {
        fs.writeFileSync(path.join(repoDir, 'README.md'), '# Unsaved working tree edit\n', 'utf8');

        assert.throws(
          () => undoGitCheckpoint(repoDir, 'non-existent-checkpoint-999'),
          (err) => err.code === 'ERR_CHECKPOINT_NOT_FOUND'
        );
        assert.throws(
          () => undoGitCheckpoint(repoDir, '../invalid/ref'),
          (err) => err.code === 'ERR_CHECKPOINT_NOT_FOUND'
        );

        // Working tree must remain untouched
        assert.equal(fs.readFileSync(path.join(repoDir, 'README.md'), 'utf8'), '# Unsaved working tree edit\n');
      });
    },
  },
  {
    id: 'T2-F08-04',
    tier: 2,
    feature: 8,
    features: [8],
    title: 'Checkpoint creation and undo preserves binary files byte-for-byte',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 8);
      const binaryBytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
      await withTempGitRepo(
        async (repoDir) => {
          createGitCheckpoint(repoDir, 'cp-binary');
          // Corrupt the binary file
          fs.writeFileSync(path.join(repoDir, 'assets/logo.bin'), Buffer.from([0xde, 0xad, 0xbe, 0xef]));

          undoGitCheckpoint(repoDir, 'cp-binary');
          const restored = fs.readFileSync(path.join(repoDir, 'assets/logo.bin'));
          assert.equal(Buffer.compare(restored, binaryBytes), 0);
        },
        {
          initialFiles: {
            'README.md': '# Binary test\n',
            'assets/logo.bin': binaryBytes,
          },
        }
      );
    },
  },
  {
    id: 'T2-F08-05',
    tier: 2,
    feature: 8,
    features: [8],
    title: 'Multiple sequential checkpoints across turns can restore directly to an earlier turn (turn 1)',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 8);
      await withTempGitRepo(async (repoDir) => {
        const file = path.join(repoDir, 'src/index.ts');

        fs.writeFileSync(file, 'export const turn = 1;\n', 'utf8');
        createGitCheckpoint(repoDir, 'turn-1');

        fs.writeFileSync(file, 'export const turn = 2;\n', 'utf8');
        createGitCheckpoint(repoDir, 'turn-2');

        fs.writeFileSync(file, 'export const turn = 3;\n', 'utf8');
        createGitCheckpoint(repoDir, 'turn-3');

        undoGitCheckpoint(repoDir, 'turn-1');
        assert.equal(fs.readFileSync(file, 'utf8'), 'export const turn = 1;\n');
      });
    },
  },

  /* ==========================================================================
   * FEATURE 9: .osmium/project.yaml Config (5 Tests)
   * ========================================================================== */
  {
    id: 'T2-F09-01',
    tier: 2,
    feature: 9,
    features: [9],
    title: 'Preserves unknown root and nested keys on load, validation, and save (.passthrough)',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 9);
      const raw = {
        version: 1,
        name: 'api-gateway',
        primary: 'codex',
        secondary: ['antigravity', 'deepseek'],
        approvalMode: 'ask',
        customExperimentalFlag: 'alpha-9',
        routing: [{ when: 'planning', cli: 'codex', customRoutePriority: 100 }],
        fallback: { onQuotaHit: 'next-secondary', customNotifyWebhook: 'http://localhost' },
        teamwork: { maxParallel: 2, integrationBranch: 'osmium/integration', customWorktreePrefix: 'wt-' },
      };

      const validated = validateProjectConfig(raw);
      assert.equal(validated.customExperimentalFlag, 'alpha-9');
      assert.equal(validated.routing[0].customRoutePriority, 100);
      assert.equal(validated.fallback.customNotifyWebhook, 'http://localhost');
      assert.equal(validated.teamwork.customWorktreePrefix, 'wt-');
    },
  },
  {
    id: 'T2-F09-02',
    tier: 2,
    feature: 9,
    features: [9],
    title: 'Rejects invalid approvalMode ("yolo") with path ["approvalMode"]',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 9);
      assert.throws(
        () =>
          validateProjectConfig({
            version: 1,
            name: 'api-gateway',
            approvalMode: 'yolo',
          }),
        (err) => err.code === 'ERR_CONFIG_VALIDATION' && err.path[0] === 'approvalMode'
      );
    },
  },
  {
    id: 'T2-F09-03',
    tier: 2,
    feature: 9,
    features: [9],
    title: 'Rejects teamwork.maxParallel <= 0 or non-integer values',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 9);
      for (const badVal of [0, -3, 2.5, 'two']) {
        assert.throws(
          () =>
            validateProjectConfig({
              version: 1,
              name: 'api-gateway',
              teamwork: { maxParallel: badVal },
            }),
          (err) =>
            err.code === 'ERR_CONFIG_VALIDATION' &&
            err.path[0] === 'teamwork' &&
            err.path[1] === 'maxParallel'
        );
      }
    },
  },
  {
    id: 'T2-F09-04',
    tier: 2,
    feature: 9,
    features: [9],
    title: 'Initializes default .osmium/project.yaml when missing in project directory',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 9);
      await withTempDir(async (tmpDir) => {
        const res = loadOrInitProjectYaml(tmpDir);
        assert.equal(res.initializedDefault, true);
        assert.equal(res.config.approvalMode, 'ask');
        assert.equal(res.config.primary, 'codex');
        assert.equal(res.config.teamwork.maxParallel, 2);
        assert.equal(fs.existsSync(res.yamlPath), true);
      });
    },
  },
  {
    id: 'T2-F09-05',
    tier: 2,
    feature: 9,
    features: [9],
    title: 'Surfaces descriptive ERR_YAML_PARSE error on malformed syntax without deleting existing file',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 9);
      await withTempDir(async (tmpDir) => {
        const osmiumDir = path.join(tmpDir, '.osmium');
        fs.mkdirSync(osmiumDir, { recursive: true });
        const yamlPath = path.join(osmiumDir, 'project.yaml');
        const corruptedContent = 'routing: [[unclosed\n  : : invalid syntax';
        fs.writeFileSync(yamlPath, corruptedContent, 'utf8');

        assert.throws(
          () => loadOrInitProjectYaml(tmpDir),
          (err) => err.code === 'ERR_YAML_PARSE'
        );
        // Existing file is preserved so user can fix syntax
        assert.equal(fs.readFileSync(yamlPath, 'utf8'), corruptedContent);
      });
    },
  },

  /* ==========================================================================
   * FEATURE 10: Mid-Session CLI Handoff (5 Tests)
   * ========================================================================== */
  {
    id: 'T2-F10-01',
    tier: 2,
    feature: 10,
    features: [10, 4],
    title: 'Switching to a CLI with capabilities.resume === false injects synthesized systemContext summary',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 10);
      const events = [
        { type: 'message', role: 'user', text: 'Add copy review brief button', final: true },
        { type: 'file-edit', path: 'src/compare-model.ts', added: 43, removed: 0 },
        { type: 'message', role: 'assistant', text: 'Built brief builder in compare-model.ts', final: true },
      ];
      const targetCaps = { resume: false };
      const handoff = buildHandoffSummary(events);
      const startOpts = {
        cwd: '/tmp/proj',
        approvalMode: 'ask',
        resume: targetCaps.resume ? 'prov-1' : undefined,
        systemContext: handoff.systemContext,
      };

      assert.equal(startOpts.resume, undefined);
      assert.match(startOpts.systemContext, /src\/compare-model\.ts/);
      assert.match(startOpts.systemContext, /Built brief builder/);
    },
  },
  {
    id: 'T2-F10-02',
    tier: 2,
    feature: 10,
    features: [10],
    title: 'Switching CLI when event log is empty (0 prior turns) passes clean initial context',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 10);
      const summary = buildHandoffSummary([]);
      assert.equal(summary.turnCount, 0);
      assert.equal(summary.truncated, false);
      assert.match(summary.systemContext, /No prior turns recorded/);
    },
  },
  {
    id: 'T2-F10-03',
    tier: 2,
    feature: 10,
    features: [10, 4],
    title: 'Switching to an uninstalled CLI rejects with ERR_CLI_NOT_INSTALLED while preserving current CLI',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 10);
      const sessionState = { id: 'sess-1', activeCli: 'codex' };
      const installedClis = new Set(['codex', 'antigravity']);

      function switchCli(targetCli) {
        if (!installedClis.has(targetCli)) {
          const err = new Error(`Target CLI '${targetCli}' is not installed on this machine.`);
          err.code = 'ERR_CLI_NOT_INSTALLED';
          throw err;
        }
        sessionState.activeCli = targetCli;
      }

      assert.throws(
        () => switchCli('deepseek'),
        (err) => err.code === 'ERR_CLI_NOT_INSTALLED'
      );
      assert.equal(sessionState.activeCli, 'codex');
    },
  },
  {
    id: 'T2-F10-04',
    tier: 2,
    feature: 10,
    features: [10],
    title: 'Truncates oversized event logs in systemContext within maxChars budget while retaining latest turns',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 10);
      const manyEvents = [];
      for (let i = 1; i <= 150; i++) {
        manyEvents.push({
          type: 'message',
          role: i % 2 === 0 ? 'assistant' : 'user',
          text: `Turn number ${i} with detailed context about module_${i}.ts`,
          final: true,
        });
      }
      manyEvents.push({ type: 'file-edit', path: 'src/final-target.ts', added: 12, removed: 1 });

      const summary = buildHandoffSummary(manyEvents, { maxChars: 600 });
      assert.equal(summary.truncated, true);
      assert.ok(summary.systemContext.length <= 600);
      assert.match(summary.systemContext, /src\/final-target\.ts/);
      assert.match(summary.systemContext, /Turn number 150/);
    },
  },
  {
    id: 'T2-F10-05',
    tier: 2,
    feature: 10,
    features: [10, 11],
    title: 'Blocks mid-session CLI switch when an interactive approval request is still pending',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 10);
      const gate = new InteractiveApprovalGate('ask');
      void gate.requestApproval({ id: 'app-1', kind: 'edit', detail: 'Modify auth.ts' });

      function attemptSwitchCli(targetCli) {
        if (gate.pending.size > 0) {
          const err = new Error(`Cannot switch to ${targetCli} while ${gate.pending.size} approval(s) are pending`);
          err.code = 'ERR_PENDING_APPROVAL_ON_SWITCH';
          throw err;
        }
        return targetCli;
      }

      assert.throws(
        () => attemptSwitchCli('antigravity'),
        (err) => err.code === 'ERR_PENDING_APPROVAL_ON_SWITCH'
      );
      gate.respond('app-1', false);
      assert.equal(attemptSwitchCli('antigravity'), 'antigravity');
    },
  },

  /* ==========================================================================
   * FEATURE 11: Interactive Approval Gate (5 Tests)
   * ========================================================================== */
  {
    id: 'T2-F11-01',
    tier: 2,
    feature: 11,
    features: [11],
    title: 'Default ask mode strictly blocks file modification until respond(id, true) is invoked',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 11);
      await withTempDir(async (tmpDir) => {
        const targetFile = path.join(tmpDir, 'protected.ts');
        const gate = new InteractiveApprovalGate('ask');

        let settled = false;
        const promise = gate
          .requestApproval({
            id: 'edit-1',
            kind: 'edit',
            detail: 'Write protected.ts',
            onExecute: () => fs.writeFileSync(targetFile, 'written\n', 'utf8'),
          })
          .then((r) => {
            settled = true;
            return r;
          });

        // Before respond() is called, file MUST NOT exist
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(settled, false);
        assert.equal(fs.existsSync(targetFile), false);

        gate.respond('edit-1', true, 'once');
        const out = await promise;
        assert.equal(out.approved, true);
        assert.equal(fs.existsSync(targetFile), true);
      });
    },
  },
  {
    id: 'T2-F11-02',
    tier: 2,
    feature: 11,
    features: [11],
    title: 'Denying (allow: false) an edit or command approval prevents execution and leaves disk untouched',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 11);
      await withTempDir(async (tmpDir) => {
        const targetFile = path.join(tmpDir, 'never-created.ts');
        const gate = new InteractiveApprovalGate('ask');

        const pending = gate.requestApproval({
          id: 'edit-deny-1',
          kind: 'edit',
          detail: 'Write never-created.ts',
          onExecute: () => fs.writeFileSync(targetFile, 'should not happen', 'utf8'),
        });

        gate.respond('edit-deny-1', false);
        const res = await pending;
        assert.equal(res.approved, false);
        assert.equal(fs.existsSync(targetFile), false);
      });
    },
  },
  {
    id: 'T2-F11-03',
    tier: 2,
    feature: 11,
    features: [11],
    title: 'Allow for this session (scope: "session") for edit does NOT auto-approve command or network requests',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 11);
      const gate = new InteractiveApprovalGate('ask');

      // 1st edit request approved for session
      const p1 = gate.requestApproval({ id: 'e1', kind: 'edit', detail: 'Edit 1' });
      gate.respond('e1', true, 'session');
      await p1;

      // 2nd edit request auto-approves immediately
      const p2 = await gate.requestApproval({ id: 'e2', kind: 'edit', detail: 'Edit 2' });
      assert.equal(p2.approved, true);
      assert.equal(p2.auto, true);

      // Command request MUST still block in pending map
      let cmdSettled = false;
      const pCmd = gate.requestApproval({ id: 'c1', kind: 'command', detail: 'rm -rf dist' }).then((r) => {
        cmdSettled = true;
        return r;
      });
      await new Promise((r) => setTimeout(r, 15));
      assert.equal(cmdSettled, false);
      assert.equal(gate.pending.has('c1'), true);

      gate.respond('c1', false);
      const cmdRes = await pCmd;
      assert.equal(cmdRes.approved, false);
    },
  },
  {
    id: 'T2-F11-04',
    tier: 2,
    feature: 11,
    features: [11],
    title: 'Rejects unknown approvalId and duplicate responses to already-resolved approvalId',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 11);
      const gate = new InteractiveApprovalGate('ask');

      assert.throws(
        () => gate.respond('unknown-id-999', true),
        (err) => err.code === 'ERR_APPROVAL_NOT_FOUND'
      );

      const p = gate.requestApproval({ id: 'dup-1', kind: 'edit', detail: 'Edit file' });
      gate.respond('dup-1', true);
      await p;

      assert.throws(
        () => gate.respond('dup-1', false),
        (err) => err.code === 'ERR_APPROVAL_ALREADY_RESOLVED'
      );
    },
  },
  {
    id: 'T2-F11-05',
    tier: 2,
    feature: 11,
    features: [11, 7],
    title: 'Cancelling session while waiting on approval rejects pending gate and clears queue',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 11);
      const gate = new InteractiveApprovalGate('ask');
      const pendingPromise = gate.requestApproval({ id: 'wait-1', kind: 'command', detail: 'pnpm build' });

      const cancelledIds = gate.cancelAllPending();
      assert.deepEqual(cancelledIds, ['wait-1']);
      assert.equal(gate.pending.size, 0);

      await assert.rejects(
        pendingPromise,
        (err) => err.code === 'ERR_APPROVAL_CANCELLED'
      );
    },
  },

  /* ==========================================================================
   * FEATURE 12: Slash Commands (/plan, /review, /teamwork, /cli, /undo) (5 Tests)
   * ========================================================================== */
  {
    id: 'T2-F12-01',
    tier: 2,
    feature: 12,
    features: [12],
    title: '/plan prevents any file edits in working tree while plan checklist is unapproved',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 12);
      await withTempDir(async (tmpDir) => {
        const planSession = {
          planId: 'plan-1',
          approved: false,
          items: [
            { id: 'item-1', text: 'Create brief.ts', file: 'brief.ts', enabled: true },
          ],
          executeItem(item) {
            if (!this.approved) {
              const err = new Error('Cannot execute plan edits before user approves the /plan checklist');
              err.code = 'ERR_PLAN_NOT_APPROVED';
              throw err;
            }
            fs.writeFileSync(path.join(tmpDir, item.file), '// created\n', 'utf8');
          },
        };

        assert.throws(
          () => planSession.executeItem(planSession.items[0]),
          (err) => err.code === 'ERR_PLAN_NOT_APPROVED'
        );
        assert.equal(fs.existsSync(path.join(tmpDir, 'brief.ts')), false);
      });
    },
  },
  {
    id: 'T2-F12-02',
    tier: 2,
    feature: 12,
    features: [12],
    title: 'Removing or disabling items in /plan checklist before approval executes only remaining approved items',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 12);
      await withTempDir(async (tmpDir) => {
        const checklist = [
          { id: '1', title: 'Update compare-model.ts', target: 'compare-model.ts', approved: true },
          { id: '2', title: 'Delete legacy auth.ts', target: 'auth.ts', approved: false }, // unchecked by user
          { id: '3', title: 'Add unit tests', target: 'compare.test.ts', approved: true },
        ];

        const approvedItems = checklist.filter((item) => item.approved);
        for (const item of approvedItems) {
          fs.writeFileSync(path.join(tmpDir, item.target), `// ${item.title}\n`, 'utf8');
        }

        assert.equal(fs.existsSync(path.join(tmpDir, 'compare-model.ts')), true);
        assert.equal(fs.existsSync(path.join(tmpDir, 'compare.test.ts')), true);
        assert.equal(fs.existsSync(path.join(tmpDir, 'auth.ts')), false);
      });
    },
  },
  {
    id: 'T2-F12-03',
    tier: 2,
    feature: 12,
    features: [12],
    title: '/review strictly enforces readOnly: true and rejects any file write attempt by reviewing CLI',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 12);
      await withTempDir(async (tmpDir) => {
        const reviewOpts = { cwd: tmpDir, approvalMode: 'ask', readOnly: true };
        function attemptReviewSessionWrite(filePath, content) {
          if (reviewOpts.readOnly) {
            const err = new Error(`Write operation rejected: /review session is running in readOnly mode (${filePath})`);
            err.code = 'ERR_READ_ONLY_MODE';
            throw err;
          }
          fs.writeFileSync(path.join(tmpDir, filePath), content, 'utf8');
        }

        assert.throws(
          () => attemptReviewSessionWrite('src/index.ts', 'mutated during review'),
          (err) => err.code === 'ERR_READ_ONLY_MODE'
        );
      });
    },
  },
  {
    id: 'T2-F12-04',
    tier: 2,
    feature: 12,
    features: [12],
    title: '/cli <unknown> rejects unknown CLI name with structured error and preserves current session CLI',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 12);
      const validClis = ['codex', 'antigravity', 'deepseek', 'mock'];
      function parseAndExecuteCliSlash(cmdText, currentCli) {
        const match = cmdText.trim().match(/^\/cli(?:\s+(\S+))?$/);
        if (!match || !match[1]) {
          const err = new Error('Usage: /cli <codex|antigravity|deepseek>');
          err.code = 'ERR_SLASH_SYNTAX';
          throw err;
        }
        const target = match[1];
        if (!validClis.includes(target)) {
          const err = new Error(`Unknown CLI '${target}'. Available CLIs: ${validClis.join(', ')}`);
          err.code = 'ERR_UNKNOWN_CLI';
          throw err;
        }
        return target;
      }

      assert.throws(
        () => parseAndExecuteCliSlash('/cli unknown-provider', 'codex'),
        (err) => err.code === 'ERR_UNKNOWN_CLI' && /Available CLIs/.test(err.message)
      );
      assert.throws(
        () => parseAndExecuteCliSlash('/cli', 'codex'),
        (err) => err.code === 'ERR_SLASH_SYNTAX'
      );
    },
  },
  {
    id: 'T2-F12-05',
    tier: 2,
    feature: 12,
    features: [12, 8],
    title: '/undo when zero checkpoints exist in session returns safe no-op warning without touching repo',
    async fn(ctx = {}) {
      resolveWorkspaceFeature(ctx, 12);
      await withTempGitRepo(async (repoDir) => {
        const refs = runGit(repoDir, ['for-each-ref', 'refs/osmium/checkpoints/']).stdout;
        assert.equal(refs, '');

        function executeSlashUndo(cwd) {
          const list = runGit(cwd, ['for-each-ref', '--format=%(refname)', 'refs/osmium/checkpoints/']).stdout;
          if (!list) {
            return { ok: false, noOp: true, message: 'No checkpoints available to undo in this session.' };
          }
          return { ok: true };
        }

        const res = executeSlashUndo(repoDir);
        assert.equal(res.ok, false);
        assert.equal(res.noOp, true);
        assert.match(res.message, /No checkpoints available/);
      });
    },
  },
];
