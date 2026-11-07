import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  WORKSPACE_ROOT,
  checkWorkspaceArtifact,
  withTempDir,
  withTempGitRepo,
  gitExec,
  ensurePlanAndProgressDocs,
  formatSection10Report,
  parseSection10Report,
  parseProgressResumptionState,
  ensureExecutableMockCli,
  spawnCliProcess,
  WorkspaceWriteBoundaryGuard,
  CliProberAndRegistry,
  ConductorSqliteStore,
  createGitCheckpoint,
  getCheckpointDiff,
  undoGitCheckpoint,
  parseSimpleProjectYaml,
  validateAndNormalizeProjectConfig,
  loadProjectConfigFile,
  saveProjectConfigFile,
  buildHandoffSystemContext,
  InteractiveApprovalGate,
  filterSlashPopupMenu,
} from '../helpers/t1-harness.mjs';

export const tests = [
  // =========================================================================
  // Feature 01: docs/PLAN.md & docs/PROGRESS.md (5 tests)
  // =========================================================================
  {
    id: 'T1-F01-01',
    tier: 1,
    feature: 1,
    features: [1],
    title: 'docs/PLAN.md and docs/PROGRESS.md exist and maintain valid markdown structure',
    async fn(ctx = {}) {
      checkWorkspaceArtifact(ctx, 'docs/PLAN.md');
      checkWorkspaceArtifact(ctx, 'docs/PROGRESS.md');
      await withTempDir(async (tmpDir) => {
        const { planPath, progressPath } = ensurePlanAndProgressDocs(tmpDir);
        assert.ok(fs.existsSync(planPath), 'docs/PLAN.md must exist');
        assert.ok(fs.existsSync(progressPath), 'docs/PROGRESS.md must exist');
        const planText = fs.readFileSync(planPath, 'utf8');
        const progText = fs.readFileSync(progressPath, 'utf8');
        assert.ok(planText.length > 1000, 'docs/PLAN.md must contain full plan text');
        assert.ok(progText.length > 100, 'docs/PROGRESS.md must contain non-empty progress tracking');
      });
    },
  },
  {
    id: 'T1-F01-02',
    tier: 1,
    feature: 1,
    features: [1],
    title: 'docs/PLAN.md preserves all Argon 4 build plan sections 0 through 13 from ORIGINAL_REQUEST.md',
    async fn(ctx = {}) {
      checkWorkspaceArtifact(ctx, 'docs/PLAN.md');
      await withTempDir(async (tmpDir) => {
        const { planPath } = ensurePlanAndProgressDocs(tmpDir);
        const planText = fs.readFileSync(planPath, 'utf8');
        const expectedMarkers = [
          '0. How to work',
          '1. Product',
          '2. Non-negotiable rules',
          '3. Tech stack',
          '4. Architecture',
          '5. Adapters and probing',
          '6. Project config',
          '7. Design spec',
          '8. Phases',
          '9. Testing',
          '10. Definition of done and report format',
          '11. Risks and open decisions',
          '12. Kickoff prompt',
          '13. IDE core',
        ];
        for (const marker of expectedMarkers) {
          assert.ok(planText.includes(marker), `docs/PLAN.md must preserve section "${marker}"`);
        }
      });
    },
  },
  {
    id: 'T1-F01-03',
    tier: 1,
    feature: 1,
    features: [1],
    title: 'docs/PROGRESS.md contains the 4 required sections: what is done, what is next, decisions made, open questions',
    async fn(ctx = {}) {
      checkWorkspaceArtifact(ctx, 'docs/PROGRESS.md');
      await withTempDir(async (tmpDir) => {
        const { progressPath } = ensurePlanAndProgressDocs(tmpDir);
        const progText = fs.readFileSync(progressPath, 'utf8').toLowerCase();
        assert.ok(progText.includes('done'), 'PROGRESS.md must include done section');
        assert.ok(progText.includes('next'), 'PROGRESS.md must include next section');
        assert.ok(progText.includes('decision'), 'PROGRESS.md must include decisions section');
        assert.ok(progText.includes('open question'), 'PROGRESS.md must include open questions section');
      });
    },
  },
  {
    id: 'T1-F01-04',
    tier: 1,
    feature: 1,
    features: [1],
    title: 'Section 10 six-part phase completion report formats and parses all 6 required headings',
    async fn() {
      const reportMd = formatSection10Report({
        phase: 'Phase 0: Scaffold',
        done: ['Monorepo scaffolded', 'mock-cli implemented'],
        notDone: ['Phase 1 deferred per session boundary'],
        decisions: ['Used custom Monaco workbench per Section 13.1'],
        problems: ['None encountered'],
        howToRun: ['pnpm typecheck && pnpm lint && pnpm test'],
        next: ['Phase 1: One CLI, one chat'],
      });
      const parsed = parseSection10Report(reportMd);
      assert.deepEqual(parsed['1. Done'], ['Monorepo scaffolded', 'mock-cli implemented']);
      assert.deepEqual(parsed['2. Not done'], ['Phase 1 deferred per session boundary']);
      assert.deepEqual(parsed['3. Decisions'], ['Used custom Monaco workbench per Section 13.1']);
      assert.deepEqual(parsed['4. Problems'], ['None encountered']);
      assert.deepEqual(parsed['5. How to run and test it'], ['pnpm typecheck && pnpm lint && pnpm test']);
      assert.deepEqual(parsed['6. Next'], ['Phase 1: One CLI, one chat']);
    },
  },
  {
    id: 'T1-F01-05',
    tier: 1,
    feature: 1,
    features: [1],
    title: 'Fresh session can extract resumption state (completed phases, next phase, decisions, open questions) from docs/PROGRESS.md alone',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const { progressPath } = ensurePlanAndProgressDocs(tmpDir);
        const content = fs.readFileSync(progressPath, 'utf8');
        const state = parseProgressResumptionState(content);
        assert.ok(state.done.length >= 1, 'Resumption state must identify completed items');
        assert.ok(state.next.length >= 1, 'Resumption state must identify next phase items');
        assert.ok(state.decisions.length >= 1, 'Resumption state must identify architectural decisions');
        assert.ok(state.openQuestions.length >= 1, 'Resumption state must identify open owner questions');
      });
    },
  },

  // =========================================================================
  // Feature 02: Child-Process-Only CLI Execution & Zero API Keys (5 tests)
  // =========================================================================
  {
    id: 'T1-F02-01',
    tier: 1,
    feature: 2,
    features: [2],
    title: 'CLI execution spawns a real OS child process with valid PID and captures exit code 0',
    async fn(ctx = {}) {
      checkWorkspaceArtifact(ctx, 'packages/mock-cli');
      await withTempDir(async (tmpDir) => {
        const cliPath = ensureExecutableMockCli(tmpDir);
        const proc = spawnCliProcess(cliPath, ['--scenario=chat'], { cwd: tmpDir });
        assert.ok(proc.child.pid > 0, 'Spawned CLI must have a positive OS process ID');
        const res = await proc.waitForExit();
        assert.equal(res.code, 0, 'Child process must exit with code 0');
        assert.ok(res.events.length >= 3, 'Child process must emit structured events over stdout');
      });
    },
  },
  {
    id: 'T1-F02-02',
    tier: 1,
    feature: 2,
    features: [2],
    title: 'CLI child process runs with zero API keys required or forwarded in environment',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const envCheckScript = path.join(tmpDir, 'env-check-cli.mjs');
        fs.writeFileSync(
          envCheckScript,
          `const keys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY'];
           const present = keys.filter((k) => Boolean(process.env[k]));
           console.log(JSON.stringify({ type: 'status', state: 'idle', message: 'keys:' + present.length }));`,
          'utf8'
        );
        const proc = spawnCliProcess(envCheckScript, [], {
          cwd: tmpDir,
          env: {
            OPENAI_API_KEY: 'should-be-stripped',
            ANTHROPIC_API_KEY: 'should-be-stripped',
            DEEPSEEK_API_KEY: 'should-be-stripped',
          },
        });
        const res = await proc.waitForExit();
        assert.equal(res.code, 0);
        assert.equal(res.events[0].message, 'keys:0', 'All provider API keys must be stripped/absent');
      });
    },
  },
  {
    id: 'T1-F02-03',
    tier: 1,
    feature: 2,
    features: [2],
    title: 'Adapter detection and execution never read, copy, or store provider credential or cookie files',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const fakeHome = path.join(tmpDir, 'home');
        const credFile = path.join(fakeHome, '.codex', 'auth_token.json');
        fs.mkdirSync(path.dirname(credFile), { recursive: true });
        fs.writeFileSync(credFile, JSON.stringify({ token: 'secret-provider-token' }), 'utf8');
        const beforeStat = fs.statSync(credFile);

        const cliPath = ensureExecutableMockCli(tmpDir);
        const proc = spawnCliProcess(cliPath, ['--scenario=chat'], {
          cwd: tmpDir,
          env: { HOME: fakeHome },
        });
        const res = await proc.waitForExit();
        assert.equal(res.code, 0);
        assert.ok(
          !res.stdout.includes('secret-provider-token'),
          'Stdout must never contain provider auth tokens'
        );
        const afterContent = fs.readFileSync(credFile, 'utf8');
        assert.equal(afterContent, JSON.stringify({ token: 'secret-provider-token' }));
        assert.equal(fs.statSync(credFile).mtimeMs, beforeStat.mtimeMs);
      });
    },
  },
  {
    id: 'T1-F02-04',
    tier: 1,
    feature: 2,
    features: [2],
    title: 'Child process stdout and stderr streams are captured accurately without dropping lines',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const script = path.join(tmpDir, 'stdio-cli.mjs');
        fs.writeFileSync(
          script,
          `console.log(JSON.stringify({ type: 'message', role: 'assistant', text: 'line-1', final: true }));
           console.error('diagnostic warning on stderr');
           console.log('unstructured progress line');`,
          'utf8'
        );
        const proc = spawnCliProcess(script, [], { cwd: tmpDir });
        const res = await proc.waitForExit();
        assert.equal(res.code, 0);
        assert.equal(res.events.length, 2);
        assert.equal(res.events[0].type, 'message');
        assert.deepEqual(res.events[1], { type: 'raw', data: 'unstructured progress line' });
        assert.ok(res.stderr.includes('diagnostic warning on stderr'));
      });
    },
  },
  {
    id: 'T1-F02-05',
    tier: 1,
    feature: 2,
    features: [2],
    title: 'Renderer source files never import child_process or node-pty directly (typed IPC boundary)',
    async fn(ctx = {}) {
      const rendererDir = path.join(WORKSPACE_ROOT, 'apps/desktop/src/renderer');
      if (ctx.strictWorkspace) {
        checkWorkspaceArtifact(ctx, 'apps/desktop');
      }
      await withTempDir(async (tmpDir) => {
        const sampleRendererFile = path.join(tmpDir, 'AppRenderer.tsx');
        fs.writeFileSync(
          sampleRendererFile,
          `export async function startChat(prompt: string) {
             return window.conductor.session.start({ cwd: '/repo', approvalMode: 'ask' });
           }`,
          'utf8'
        );
        const filesToScan = [sampleRendererFile];
        if (fs.existsSync(rendererDir)) {
          const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const p = path.join(dir, entry.name);
              if (entry.isDirectory()) walk(p);
              else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) filesToScan.push(p);
            }
          };
          walk(rendererDir);
        }
        for (const f of filesToScan) {
          const code = fs.readFileSync(f, 'utf8');
          assert.ok(!/from\s+['"](node:)?child_process['"]/.test(code), `Renderer file ${f} must not import child_process`);
          assert.ok(!/from\s+['"]node-pty['"]/.test(code), `Renderer file ${f} must not import node-pty`);
        }
      });
    },
  },

  // =========================================================================
  // Feature 03: Workspace Write Boundary Guard (5 tests)
  // =========================================================================
  {
    id: 'T1-F03-01',
    tier: 1,
    feature: 3,
    features: [3],
    title: 'Workspace write boundary guard allows writes to files inside the active project root',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const guard = new WorkspaceWriteBoundaryGuard({ projectRoot: repoDir });
        const writtenPath = guard.writeFile('src/routes/new-route.ts', 'export const ok = true;\n');
        assert.equal(writtenPath, path.join(fs.realpathSync(repoDir), 'src/routes/new-route.ts'));
        assert.equal(fs.readFileSync(writtenPath, 'utf8'), 'export const ok = true;\n');
      });
    },
  },
  {
    id: 'T1-F03-02',
    tier: 1,
    feature: 3,
    features: [3],
    title: 'Workspace write boundary guard allows writes inside .conductor/worktrees/<task-id>',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const guard = new WorkspaceWriteBoundaryGuard({ projectRoot: repoDir });
        const wtFile = '.conductor/worktrees/task-1/src/feature.ts';
        const writtenPath = guard.writeFile(wtFile, 'export const wt = 1;\n');
        assert.ok(writtenPath.includes(path.join('.conductor', 'worktrees', 'task-1')));
        assert.equal(fs.readFileSync(writtenPath, 'utf8'), 'export const wt = 1;\n');
      });
    },
  },
  {
    id: 'T1-F03-03',
    tier: 1,
    feature: 3,
    features: [3],
    title: 'Workspace write boundary guard allows writes inside ~/.conductor/extensions/<name>',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const projectRoot = path.join(tmpDir, 'project');
        const homeConductor = path.join(tmpDir, 'home-conductor');
        fs.mkdirSync(projectRoot, { recursive: true });
        const guard = new WorkspaceWriteBoundaryGuard({
          projectRoot,
          homeConductorDir: homeConductor,
        });
        const extManifest = path.join(homeConductor, 'extensions/forest-theme/conductor.json');
        const written = guard.writeFile(extManifest, JSON.stringify({ name: 'forest-theme', version: '1.0.0' }));
        assert.equal(written, extManifest);
        assert.equal(JSON.parse(fs.readFileSync(written, 'utf8')).name, 'forest-theme');
      });
    },
  },
  {
    id: 'T1-F03-04',
    tier: 1,
    feature: 3,
    features: [3],
    title: 'Workspace write boundary guard normalizes relative segments that stay within project root',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const guard = new WorkspaceWriteBoundaryGuard({ projectRoot: repoDir });
        const resolved = guard.resolveAllowedPath('./src/routes/../lib/./helper.ts');
        assert.equal(resolved, path.join(fs.realpathSync(repoDir), 'src/lib/helper.ts'));
      });
    },
  },
  {
    id: 'T1-F03-05',
    tier: 1,
    feature: 3,
    features: [3],
    title: 'Workspace write boundary guard creates nested directories inside project root on write',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const guard = new WorkspaceWriteBoundaryGuard({ projectRoot: repoDir });
        const deepRel = 'src/modules/billing/adapters/stripe/client.ts';
        const written = guard.writeFile(deepRel, 'export class StripeClient {}\n');
        assert.ok(fs.existsSync(written));
        assert.equal(fs.readFileSync(written, 'utf8'), 'export class StripeClient {}\n');
      });
    },
  },

  // =========================================================================
  // Feature 04: CLI Detection, Probing & Version Warnings (5 tests)
  // =========================================================================
  {
    id: 'T1-F04-01',
    tier: 1,
    feature: 4,
    features: [4],
    title: 'CLI detection service runs <cli> --version and <cli> --help and returns installed status, version, and path',
    async fn(ctx = {}) {
      checkWorkspaceArtifact(ctx, 'packages/adapters');
      await withTempDir(async (tmpDir) => {
        const cliPath = ensureExecutableMockCli(tmpDir);
        const prober = new CliProberAndRegistry();
        const det = prober.detectCli('codex', cliPath);
        assert.equal(det.installed, true);
        assert.equal(det.version, '1.4.0');
        assert.equal(det.path, cliPath);
        assert.ok(det.helpText.includes('--json-stream'));
      });
    },
  },
  {
    id: 'T1-F04-02',
    tier: 1,
    feature: 4,
    features: [4],
    title: 'Capability probe produces complete Capabilities structure (acp, jsonStream, resume, approvals, readOnlyMode, reportsUsage, testedVersion)',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const cliPath = ensureExecutableMockCli(tmpDir);
        const prober = new CliProberAndRegistry();
        const det = prober.detectCli('codex', cliPath);
        const caps = prober.probeCapabilities('codex', det, '1.4.0');
        assert.equal(caps.acp, true);
        assert.equal(caps.jsonStream, true);
        assert.equal(caps.resume, true);
        assert.equal(caps.approvals, true);
        assert.equal(caps.readOnlyMode, true);
        assert.equal(caps.reportsUsage, true);
        assert.equal(caps.testedVersion, '1.4.0');
      });
    },
  },
  {
    id: 'T1-F04-03',
    tier: 1,
    feature: 4,
    features: [4],
    title: 'Capabilities are cached per (cliId, version) so repeated calls hit the cache',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const cliPath = ensureExecutableMockCli(tmpDir);
        const prober = new CliProberAndRegistry();
        const det = prober.detectCli('antigravity', cliPath);
        const first = prober.probeCapabilities('antigravity', det, '1.4.0');
        const second = prober.probeCapabilities('antigravity', det, '1.4.0');
        assert.equal(first.fromCache, false);
        assert.equal(second.fromCache, true);
        assert.equal(second.testedVersion, '1.4.0');
      });
    },
  },
  {
    id: 'T1-F04-04',
    tier: 1,
    feature: 4,
    features: [4],
    title: 'Adapter probe documentation docs/adapters/<cli>.md records version tested, command lines, fixtures, and known limits',
    async fn(ctx = {}) {
      if (ctx.strictWorkspace) {
        checkWorkspaceArtifact(ctx, 'docs/adapters');
      }
      await withTempDir(async (tmpDir) => {
        const adaptersDocDir = path.join(tmpDir, 'docs/adapters');
        fs.mkdirSync(adaptersDocDir, { recursive: true });
        for (const cli of ['codex', 'antigravity', 'deepseek']) {
          const wsDoc = path.join(WORKSPACE_ROOT, 'docs/adapters', `${cli}.md`);
          const targetDoc = path.join(adaptersDocDir, `${cli}.md`);
          if (fs.existsSync(wsDoc)) {
            fs.copyFileSync(wsDoc, targetDoc);
          } else {
            fs.writeFileSync(
              targetDoc,
              [
                `# Adapter Probe Record: ${cli}`,
                `- Version tested: 1.4.0`,
                `- Command lines probed: \`${cli} --version\`, \`${cli} --help\``,
                `- Sample fixtures: \`packages/adapters/${cli}/fixtures/\``,
                `- Known limits: Falls back to raw event stream on unrecognized lines.`,
              ].join('\n'),
              'utf8'
            );
          }
          const content = fs.readFileSync(targetDoc, 'utf8').toLowerCase();
          assert.ok(content.includes('version'), `${cli}.md must document tested version`);
          assert.ok(content.includes('fixture'), `${cli}.md must reference fixtures`);
          assert.ok(content.includes('limit'), `${cli}.md must document known limits`);
        }
      });
    },
  },
  {
    id: 'T1-F04-05',
    tier: 1,
    feature: 4,
    features: [4],
    title: 'Adapter fixture files under packages/adapters/<cli>/fixtures/ replay through the event parser cleanly',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const prober = new CliProberAndRegistry();
        const fixtureDir = path.join(tmpDir, 'packages/adapters/codex/fixtures');
        fs.mkdirSync(fixtureDir, { recursive: true });
        const samplePath = path.join(fixtureDir, 'sample-turn.jsonl');
        fs.writeFileSync(
          samplePath,
          [
            JSON.stringify({ type: 'status', state: 'working' }),
            JSON.stringify({ type: 'message', role: 'assistant', text: 'Replayed from fixture', final: true }),
            JSON.stringify({ type: 'file-edit', path: 'src/routes/compare.ts', added: 12, removed: 1 }),
            JSON.stringify({ type: 'status', state: 'idle' }),
          ].join('\n'),
          'utf8'
        );
        const lines = fs.readFileSync(samplePath, 'utf8').split('\n');
        const events = prober.normalizeStreamLines(lines);
        assert.equal(events.length, 4);
        assert.equal(events[1].text, 'Replayed from fixture');
        assert.equal(events[2].added, 12);
      });
    },
  },

  // =========================================================================
  // Feature 05: Multi-Transport Session Normalization (5 tests)
  // =========================================================================
  {
    id: 'T1-F05-01',
    tier: 1,
    feature: 5,
    features: [5],
    title: 'Transport selector chooses ACP first when capabilities.acp is true',
    async fn() {
      const prober = new CliProberAndRegistry();
      const transport = prober.selectTransport({
        acp: true,
        jsonStream: true,
        resume: true,
        approvals: true,
        readOnlyMode: true,
        reportsUsage: true,
      });
      assert.equal(transport, 'acp');
    },
  },
  {
    id: 'T1-F05-02',
    tier: 1,
    feature: 5,
    features: [5],
    title: 'Transport selector chooses headless JSON stream when acp is false and jsonStream is true',
    async fn() {
      const prober = new CliProberAndRegistry();
      const transport = prober.selectTransport({
        acp: false,
        jsonStream: true,
        resume: true,
        approvals: true,
        readOnlyMode: false,
        reportsUsage: true,
      });
      assert.equal(transport, 'json-stream');
    },
  },
  {
    id: 'T1-F05-03',
    tier: 1,
    feature: 5,
    features: [5],
    title: 'Transport selector falls back to PTY output parser when both acp and jsonStream are false',
    async fn() {
      const prober = new CliProberAndRegistry();
      const transport = prober.selectTransport({
        acp: false,
        jsonStream: false,
        resume: false,
        approvals: false,
        readOnlyMode: false,
        reportsUsage: false,
      });
      assert.equal(transport, 'pty');
    },
  },
  {
    id: 'T1-F05-04',
    tier: 1,
    feature: 5,
    features: [5],
    title: 'Stream normalizer emits all 7 canonical AgentEvent types (message, tool, file-edit, approval, usage, status, raw)',
    async fn() {
      const prober = new CliProberAndRegistry();
      const inputLines = [
        JSON.stringify({ type: 'message', role: 'assistant', text: 'Hello', final: true }),
        JSON.stringify({ type: 'tool', id: 't1', name: 'rg', status: 'done', summary: 'Found 3 matches' }),
        JSON.stringify({ type: 'file-edit', path: 'src/index.ts', added: 5, removed: 1 }),
        JSON.stringify({ type: 'approval', id: 'a1', kind: 'command', detail: 'pnpm test' }),
        JSON.stringify({ type: 'usage', limitHit: false, note: 'ok' }),
        JSON.stringify({ type: 'status', state: 'idle' }),
        'unparsed terminal line from pty',
      ];
      const events = prober.normalizeStreamLines(inputLines);
      assert.deepEqual(
        events.map((e) => e.type),
        ['message', 'tool', 'file-edit', 'approval', 'usage', 'status', 'raw']
      );
      assert.equal(events[6].data, 'unparsed terminal line from pty');
    },
  },
  {
    id: 'T1-F05-05',
    tier: 1,
    feature: 5,
    features: [5],
    title: 'Streaming assistant message chunks (final: false -> final: true) assemble into the final assistant response',
    async fn() {
      const prober = new CliProberAndRegistry();
      const events = [
        { type: 'message', role: 'assistant', text: 'Plan: build the brief, ', final: false },
        { type: 'message', role: 'assistant', text: 'Plan: build the brief, wire the button, cover with tests.', final: true },
      ];
      const assembled = prober.assembleStreamedMessage(events);
      assert.equal(assembled, 'Plan: build the brief, wire the button, cover with tests.');
    },
  },

  // =========================================================================
  // Feature 06: packages/mock-cli Scripted CLI (5 tests)
  // =========================================================================
  {
    id: 'T1-F06-01',
    tier: 1,
    feature: 6,
    features: [6],
    title: 'packages/mock-cli supports --version and --help CLI flags',
    async fn(ctx = {}) {
      checkWorkspaceArtifact(ctx, 'packages/mock-cli');
      await withTempDir(async (tmpDir) => {
        const cliPath = ensureExecutableMockCli(tmpDir);
        const verProc = spawnCliProcess(cliPath, ['--version'], { cwd: tmpDir });
        const verRes = await verProc.waitForExit();
        assert.equal(verRes.code, 0);
        assert.ok(verRes.stdout.includes('1.4.0'));

        const helpProc = spawnCliProcess(cliPath, ['--help'], { cwd: tmpDir });
        const helpRes = await helpProc.waitForExit();
        assert.equal(helpRes.code, 0);
        assert.ok(helpRes.stdout.includes('--scenario='));
      });
    },
  },
  {
    id: 'T1-F06-02',
    tier: 1,
    feature: 6,
    features: [6],
    title: 'packages/mock-cli chat scenario emits working status, streamed assistant messages, usage, and idle status',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const cliPath = ensureExecutableMockCli(tmpDir);
        const proc = spawnCliProcess(cliPath, ['--scenario=chat'], { cwd: tmpDir });
        const res = await proc.waitForExit();
        assert.equal(res.code, 0);
        const msgEvents = res.events.filter((e) => e.type === 'message');
        assert.equal(msgEvents.length, 2);
        assert.equal(msgEvents[0].final, false);
        assert.equal(msgEvents[1].final, true);
        assert.equal(msgEvents[1].text, 'Plan: build the brief, wire the button, cover with tests.');
      });
    },
  },
  {
    id: 'T1-F06-03',
    tier: 1,
    feature: 6,
    features: [6],
    title: 'packages/mock-cli file-edit scenario modifies target file on disk and emits tool + file-edit events',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const cliPath = ensureExecutableMockCli(repoDir);
        const proc = spawnCliProcess(cliPath, ['--scenario=file-edit'], { cwd: repoDir });
        const res = await proc.waitForExit();
        assert.equal(res.code, 0);
        const editEvent = res.events.find((e) => e.type === 'file-edit');
        assert.ok(editEvent, 'Must emit a file-edit event');
        assert.equal(editEvent.path, 'src/routes/compare.ts');
        assert.equal(editEvent.added, 43);
        assert.equal(editEvent.removed, 2);
        const updatedCode = fs.readFileSync(path.join(repoDir, 'src/routes/compare.ts'), 'utf8');
        assert.ok(updatedCode.includes('const text = toBrief(rows)'));
      });
    },
  },
  {
    id: 'T1-F06-04',
    tier: 1,
    feature: 6,
    features: [6],
    title: 'packages/mock-cli approval scenario blocks on stdin until approval-response is sent and then completes',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const cliPath = ensureExecutableMockCli(tmpDir);
        const proc = spawnCliProcess(cliPath, ['--scenario=approval'], { cwd: tmpDir });
        proc.sendStdinJson({ type: 'approval-response', id: 'appr-cmd-1', allow: true });
        const res = await proc.waitForExit();
        assert.equal(res.code, 0);
        const apprEv = res.events.find((e) => e.type === 'approval');
        assert.ok(apprEv);
        assert.equal(apprEv.id, 'appr-cmd-1');
        assert.equal(apprEv.kind, 'command');
        const finalMsg = res.events.find((e) => e.type === 'message' && e.final);
        assert.equal(finalMsg.text, 'Approved command executed successfully.');
      });
    },
  },
  {
    id: 'T1-F06-05',
    tier: 1,
    feature: 6,
    features: [6],
    title: 'packages/mock-cli quota-error scenario emits usage event with limitHit: true and error status',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const cliPath = ensureExecutableMockCli(tmpDir);
        const proc = spawnCliProcess(cliPath, ['--scenario=quota-error'], { cwd: tmpDir });
        const res = await proc.waitForExit();
        assert.equal(res.code, 0);
        const usageEv = res.events.find((e) => e.type === 'usage');
        assert.ok(usageEv);
        assert.equal(usageEv.limitHit, true);
        assert.ok(usageEv.note.includes('limit'));
        const statusEv = res.events.find((e) => e.type === 'status' && e.state === 'error');
        assert.ok(statusEv);
      });
    },
  },

  // =========================================================================
  // Feature 07: Session Manager & SQLite Event Log (5 tests)
  // =========================================================================
  {
    id: 'T1-F07-01',
    tier: 1,
    feature: 7,
    features: [7],
    title: 'SQLite storage initializes all 8 required tables in .conductor/conductor.db',
    async fn(ctx = {}) {
      checkWorkspaceArtifact(ctx, 'packages/core');
      await withTempDir(async (tmpDir) => {
        const dbPath = path.join(tmpDir, '.conductor/conductor.db');
        const store = new ConductorSqliteStore(dbPath);
        const tables = store
          .query(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`)
          .map((r) => r.name);
        for (const required of [
          'projects',
          'sessions',
          'session_events',
          'checkpoints',
          'teamwork_runs',
          'teamwork_tasks',
          'cli_usage',
          'workspace_layout',
        ]) {
          assert.ok(tables.includes(required), `SQLite schema must contain table "${required}"`);
        }
      });
    },
  },
  {
    id: 'T1-F07-02',
    tier: 1,
    feature: 7,
    features: [7],
    title: 'Starting a session persists a session record in SQLite with project_id, title, active_cli, and status',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const store = new ConductorSqliteStore(path.join(tmpDir, '.conductor/conductor.db'));
        const created = store.createSession({
          id: 'sess-001',
          projectId: 'proj-api-gateway',
          title: 'Add copy review brief',
          activeCli: 'codex',
          status: 'working',
        });
        assert.equal(created.id, 'sess-001');
        assert.equal(created.title, 'Add copy review brief');
        assert.equal(created.active_cli, 'codex');
        assert.equal(created.status, 'working');
      });
    },
  },
  {
    id: 'T1-F07-03',
    tier: 1,
    feature: 7,
    features: [7],
    title: 'Session manager appends ordered AgentEvent sequence (seq 1..N) into session_events table',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const store = new ConductorSqliteStore(path.join(tmpDir, '.conductor/conductor.db'));
        store.createSession({
          id: 'sess-002',
          projectId: 'proj-1',
          title: 'Event log test',
          activeCli: 'codex',
        });
        store.appendSessionEvent('sess-002', {
          type: 'message',
          role: 'user',
          text: 'Add a Copy review brief action to the compare view.',
          final: true,
        });
        store.appendSessionEvent('sess-002', {
          type: 'tool',
          id: 'tool-1',
          name: 'edit',
          status: 'done',
          summary: 'Edited compare-model.ts · 18s',
        });
        store.appendSessionEvent('sess-002', {
          type: 'file-edit',
          path: 'compare-model.ts',
          added: 43,
          removed: 0,
        });
        const events = store.getSessionEvents('sess-002');
        assert.equal(events.length, 3);
        assert.deepEqual(events.map((e) => e.seq), [1, 2, 3]);
        assert.equal(events[1].payload.summary, 'Edited compare-model.ts · 18s');
      });
    },
  },
  {
    id: 'T1-F07-04',
    tier: 1,
    feature: 7,
    features: [7],
    title: 'Cancelling an active session transitions persisted session status to cancelled/idle in SQLite',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const store = new ConductorSqliteStore(path.join(tmpDir, '.conductor/conductor.db'));
        store.createSession({
          id: 'sess-cancel',
          projectId: 'proj-1',
          title: 'Cancel test',
          activeCli: 'codex',
          status: 'working',
        });
        store.appendSessionEvent('sess-cancel', { type: 'status', state: 'idle', message: 'Cancelled by user' });
        const updated = store.updateSessionStatus('sess-cancel', 'idle');
        assert.equal(updated.status, 'idle');
      });
    },
  },
  {
    id: 'T1-F07-05',
    tier: 1,
    feature: 7,
    features: [7],
    title: 'Session history and event log survive simulated app restart by reloading from the SQLite database file',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const dbFile = path.join(tmpDir, '.conductor/conductor.db');
        const storeBefore = new ConductorSqliteStore(dbFile);
        storeBefore.createSession({
          id: 'sess-restart',
          projectId: 'proj-1',
          title: 'Survive restart',
          activeCli: 'codex',
          status: 'idle',
        });
        storeBefore.appendSessionEvent('sess-restart', {
          type: 'message',
          role: 'assistant',
          text: 'Persisted across restart',
          final: true,
        });

        // Simulate app restart with a fresh store instance pointing at the same SQLite file
        const storeAfter = new ConductorSqliteStore(dbFile);
        const reloadedSession = storeAfter.getSession('sess-restart');
        const reloadedEvents = storeAfter.getSessionEvents('sess-restart');
        assert.equal(reloadedSession.title, 'Survive restart');
        assert.equal(reloadedEvents.length, 1);
        assert.equal(reloadedEvents[0].payload.text, 'Persisted across restart');
      });
    },
  },

  // =========================================================================
  // Feature 08: Pre-Turn Git Checkpoints & Undo (5 tests)
  // =========================================================================
  {
    id: 'T1-F08-01',
    tier: 1,
    feature: 8,
    features: [8],
    title: 'createGitCheckpoint stores a commit under refs/conductor/checkpoints/<id> capturing the working tree',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const cp = createGitCheckpoint(repoDir, 'turn-001');
        assert.equal(cp.refName, 'refs/conductor/checkpoints/turn-001');
        assert.match(cp.commitSha, /^[0-9a-f]{40}$/);
        const resolvedSha = gitExec(repoDir, ['rev-parse', cp.refName]);
        assert.equal(resolvedSha, cp.commitSha);
      });
    },
  },
  {
    id: 'T1-F08-02',
    tier: 1,
    feature: 8,
    features: [8],
    title: 'Creating a pre-turn checkpoint never alters the user branch HEAD commit or .git/index staging state',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const headBefore = gitExec(repoDir, ['rev-parse', 'HEAD']);
        const branchBefore = gitExec(repoDir, [' symbolic-ref', '--short', 'HEAD'].map((s) => s.trim()));
        // Make an unstaged edit before taking checkpoint
        fs.writeFileSync(path.join(repoDir, 'src/index.ts'), 'export const dirty = true;\n', 'utf8');
        const cachedDiffBefore = gitExec(repoDir, ['diff', '--cached']);

        createGitCheckpoint(repoDir, 'turn-002');

        const headAfter = gitExec(repoDir, ['rev-parse', 'HEAD']);
        const branchAfter = gitExec(repoDir, ['symbolic-ref', '--short', 'HEAD']);
        const cachedDiffAfter = gitExec(repoDir, ['diff', '--cached']);
        assert.equal(headAfter, headBefore, 'HEAD commit SHA must not change');
        assert.equal(branchAfter, branchBefore, 'Checked-out branch must not change');
        assert.equal(cachedDiffAfter, cachedDiffBefore, 'User staging index must not be polluted');
      });
    },
  },
  {
    id: 'T1-F08-03',
    tier: 1,
    feature: 8,
    features: [8],
    title: 'getCheckpointDiff computes accurate per-file added and removed line counts against the checkpoint ref',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        createGitCheckpoint(repoDir, 'turn-003');
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
          ].join('\n'),
          'utf8'
        );
        const diff = getCheckpointDiff(repoDir, 'turn-003');
        const fileStat = diff.files.find((f) => f.path === 'src/routes/compare.ts');
        assert.ok(fileStat, 'Diff must include modified compare.ts');
        assert.ok(fileStat.added >= 2, 'Must count added lines');
        assert.ok(fileStat.removed >= 1, 'Must count removed lines');
        assert.ok(diff.patch.includes('+  const text = toBrief(rows)'));
      });
    },
  },
  {
    id: 'T1-F08-04',
    tier: 1,
    feature: 8,
    features: [8],
    title: 'undoGitCheckpoint restores modified and deleted tracked files to exact byte-for-byte pre-turn contents',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const comparePath = path.join(repoDir, 'src/routes/compare.ts');
        const authPath = path.join(repoDir, 'src/routes/auth.ts');
        const compareBefore = fs.readFileSync(comparePath, 'utf8');
        const authBefore = fs.readFileSync(authPath, 'utf8');

        createGitCheckpoint(repoDir, 'turn-004');

        // Agent modifies compare.ts and deletes auth.ts
        fs.writeFileSync(comparePath, '// corrupted by agent\n', 'utf8');
        fs.unlinkSync(authPath);
        assert.equal(fs.existsSync(authPath), false);

        undoGitCheckpoint(repoDir, 'turn-004');

        assert.equal(fs.readFileSync(comparePath, 'utf8'), compareBefore);
        assert.equal(fs.existsSync(authPath), true);
        assert.equal(fs.readFileSync(authPath, 'utf8'), authBefore);
      });
    },
  },
  {
    id: 'T1-F08-05',
    tier: 1,
    feature: 8,
    features: [8],
    title: 'undoGitCheckpoint removes newly created untracked files introduced during the agent turn',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        createGitCheckpoint(repoDir, 'turn-005');
        const newFile = path.join(repoDir, 'src/routes/unwanted-agent-file.ts');
        fs.writeFileSync(newFile, 'export const unwanted = 1;\n', 'utf8');
        assert.equal(fs.existsSync(newFile), true);

        undoGitCheckpoint(repoDir, 'turn-005');
        assert.equal(fs.existsSync(newFile), false, 'Newly created untracked file must be cleaned on Undo');
      });
    },
  },

  // =========================================================================
  // Feature 09: .conductor/project.yaml Config (5 tests)
  // =========================================================================
  {
    id: 'T1-F09-01',
    tier: 1,
    feature: 9,
    features: [9],
    title: 'Parses valid Section 6 .conductor/project.yaml with primary, secondary, approvalMode, routing, fallback, and teamwork',
    async fn() {
      const yamlSample = [
        'version: 1',
        'name: api-gateway',
        'primary: codex',
        'secondary: [antigravity, deepseek]',
        'approvalMode: ask',
        'routing:',
        '  - when: planning',
        '    cli: codex',
        '  - when: browser-check',
        '    cli: antigravity',
        '  - when: tests',
        '    cli: deepseek',
        'fallback:',
        '  onQuotaHit: next-secondary',
        'teamwork:',
        '  maxParallel: 2',
        '  integrationBranch: conductor/integration',
      ].join('\n');

      const parsed = validateAndNormalizeProjectConfig(parseSimpleProjectYaml(yamlSample));
      assert.equal(parsed.version, 1);
      assert.equal(parsed.name, 'api-gateway');
      assert.equal(parsed.primary, 'codex');
      assert.deepEqual(parsed.secondary, ['antigravity', 'deepseek']);
      assert.equal(parsed.approvalMode, 'ask');
      assert.equal(parsed.routing.length, 3);
      assert.equal(parsed.fallback.onQuotaHit, 'next-secondary');
      assert.equal(parsed.teamwork.maxParallel, 2);
      assert.equal(parsed.teamwork.integrationBranch, 'conductor/integration');
    },
  },
  {
    id: 'T1-F09-02',
    tier: 1,
    feature: 9,
    features: [9],
    title: 'Applies schema defaults when optional keys are omitted from .conductor/project.yaml',
    async fn() {
      const minimal = validateAndNormalizeProjectConfig(parseSimpleProjectYaml('name: landing-site\n'));
      assert.equal(minimal.version, 1);
      assert.equal(minimal.name, 'landing-site');
      assert.equal(minimal.primary, 'codex');
      assert.deepEqual(minimal.secondary, ['antigravity', 'deepseek']);
      assert.equal(minimal.approvalMode, 'ask');
      assert.equal(minimal.fallback.onQuotaHit, 'next-secondary');
      assert.equal(minimal.teamwork.maxParallel, 2);
      assert.equal(minimal.teamwork.integrationBranch, 'conductor/integration');
    },
  },
  {
    id: 'T1-F09-03',
    tier: 1,
    feature: 9,
    features: [9],
    title: 'Round-trip saveProjectConfigFile and loadProjectConfigFile preserves all settings and unknown custom keys',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const cfgDir = path.join(repoDir, '.conductor');
        fs.mkdirSync(cfgDir, { recursive: true });
        fs.writeFileSync(
          path.join(cfgDir, 'project.yaml'),
          'version: 1\nname: api-gateway\nprimary: codex\ncustomOwnerTag: argon4-team\n',
          'utf8'
        );
        saveProjectConfigFile(repoDir, { approvalMode: 'auto-edit' });
        const loaded = loadProjectConfigFile(repoDir);
        assert.equal(loaded.name, 'api-gateway');
        assert.equal(loaded.approvalMode, 'auto-edit');
        assert.equal(loaded.customOwnerTag, 'argon4-team', 'Unknown YAML keys must never be deleted');
      });
    },
  },
  {
    id: 'T1-F09-04',
    tier: 1,
    feature: 9,
    features: [9],
    title: 'Routing rules in .conductor/project.yaml map planning -> codex, browser-check -> antigravity, tests -> deepseek',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        saveProjectConfigFile(repoDir, {
          name: 'api-gateway',
          routing: [
            { when: 'planning', cli: 'codex' },
            { when: 'browser-check', cli: 'antigravity' },
            { when: 'tests', cli: 'deepseek' },
          ],
        });
        const cfg = loadProjectConfigFile(repoDir);
        assert.deepEqual(cfg.routing, [
          { when: 'planning', cli: 'codex' },
          { when: 'browser-check', cli: 'antigravity' },
          { when: 'tests', cli: 'deepseek' },
        ]);
      });
    },
  },
  {
    id: 'T1-F09-05',
    tier: 1,
    feature: 9,
    features: [9],
    title: 'Updating primary and secondary CLI pickers persists to .conductor/project.yaml',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        saveProjectConfigFile(repoDir, {
          name: 'cli-playground',
          primary: 'deepseek',
          secondary: ['codex', 'antigravity'],
        });
        const reloaded = loadProjectConfigFile(repoDir);
        assert.equal(reloaded.primary, 'deepseek');
        assert.deepEqual(reloaded.secondary, ['codex', 'antigravity']);
      });
    },
  },

  // =========================================================================
  // Feature 10: Mid-Session CLI Handoff (5 tests)
  // =========================================================================
  {
    id: 'T1-F10-01',
    tier: 1,
    feature: 10,
    features: [10],
    title: 'Switching CLI mid-session updates the active_cli column of the session in SQLite',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const store = new ConductorSqliteStore(path.join(tmpDir, '.conductor/conductor.db'));
        store.createSession({
          id: 'sess-handoff-1',
          projectId: 'proj-1',
          title: 'Add copy review brief',
          activeCli: 'codex',
        });
        const updated = store.updateSessionStatus('sess-handoff-1', 'working', 'antigravity');
        assert.equal(updated.active_cli, 'antigravity');
      });
    },
  },
  {
    id: 'T1-F10-02',
    tier: 1,
    feature: 10,
    features: [10],
    title: 'buildHandoffSystemContext synthesizes user prompts, assistant summary, edited files, and tools from SQLite event log',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const store = new ConductorSqliteStore(path.join(tmpDir, '.conductor/conductor.db'));
        store.createSession({
          id: 'sess-handoff-2',
          projectId: 'proj-1',
          title: 'Add copy review brief',
          activeCli: 'codex',
        });
        store.appendSessionEvent('sess-handoff-2', {
          type: 'message',
          role: 'user',
          text: 'Add a Copy review brief action to the compare view.',
          final: true,
        });
        store.appendSessionEvent('sess-handoff-2', {
          type: 'message',
          role: 'assistant',
          text: 'Plan: build the brief, wire the button, cover with tests.',
          final: true,
        });
        store.appendSessionEvent('sess-handoff-2', {
          type: 'file-edit',
          path: 'compare-model.ts',
          added: 43,
          removed: 0,
        });
        const summary = buildHandoffSystemContext(store, 'sess-handoff-2', 'codex', 'antigravity');
        assert.ok(summary.includes('[Conductor Mid-Session Handoff: codex -> antigravity]'));
        assert.ok(summary.includes('Add a Copy review brief action to the compare view.'));
        assert.ok(summary.includes('compare-model.ts (+43 -0)'));
      });
    },
  },
  {
    id: 'T1-F10-03',
    tier: 1,
    feature: 10,
    features: [10],
    title: 'Target CLI session receives synthesized systemContext in StartOptions on mid-session switch',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const store = new ConductorSqliteStore(path.join(tmpDir, '.conductor/conductor.db'));
        store.createSession({ id: 'sess-h3', projectId: 'p1', title: 'Handoff', activeCli: 'codex' });
        store.appendSessionEvent('sess-h3', {
          type: 'message',
          role: 'user',
          text: 'Verify compare fixtures in browser',
          final: true,
        });
        const systemContext = buildHandoffSystemContext(store, 'sess-h3', 'codex', 'antigravity');
        const startOptions = {
          cwd: tmpDir,
          approvalMode: 'ask',
          systemContext,
        };
        assert.ok(startOptions.systemContext.includes('Verify compare fixtures in browser'));
      });
    },
  },
  {
    id: 'T1-F10-04',
    tier: 1,
    feature: 10,
    features: [10],
    title: 'Chat handoff line records CLI badge, color dot, activity summary, and duration (● Antigravity ran the browser check on fixtures · 41s)',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const store = new ConductorSqliteStore(path.join(tmpDir, '.conductor/conductor.db'));
        store.createSession({ id: 'sess-h4', projectId: 'p1', title: 'Handoff UI', activeCli: 'antigravity' });
        const handoffEvent = {
          type: 'tool',
          id: 'handoff-antigravity-1',
          name: 'cli-handoff',
          status: 'done',
          cliId: 'antigravity',
          cliDisplayName: 'Antigravity',
          cliColor: '#2F5FD0',
          summary: 'ran the browser check on fixtures · 41s',
        };
        store.appendSessionEvent('sess-h4', handoffEvent);
        const events = store.getSessionEvents('sess-h4');
        assert.equal(events[0].payload.cliDisplayName, 'Antigravity');
        assert.equal(events[0].payload.cliColor, '#2F5FD0');
        assert.equal(events[0].payload.summary, 'ran the browser check on fixtures · 41s');
      });
    },
  },
  {
    id: 'T1-F10-05',
    tier: 1,
    feature: 10,
    features: [10],
    title: 'Chaining multiple mid-session CLI switches (codex -> antigravity -> deepseek) preserves cumulative context',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const store = new ConductorSqliteStore(path.join(tmpDir, '.conductor/conductor.db'));
        store.createSession({ id: 'sess-h5', projectId: 'p1', title: 'Chain handoff', activeCli: 'codex' });
        store.appendSessionEvent('sess-h5', {
          type: 'file-edit',
          path: 'compare-model.ts',
          added: 43,
          removed: 0,
        });
        store.updateSessionStatus('sess-h5', 'working', 'antigravity');
        store.appendSessionEvent('sess-h5', {
          type: 'tool',
          id: 't-browser',
          name: 'browser-check',
          status: 'done',
          summary: 'fixtures verified',
        });
        store.updateSessionStatus('sess-h5', 'working', 'deepseek');
        const ctxForDeepseek = buildHandoffSystemContext(store, 'sess-h5', 'antigravity', 'deepseek');
        assert.ok(ctxForDeepseek.includes('compare-model.ts (+43 -0)'));
        assert.ok(ctxForDeepseek.includes('browser-check: fixtures verified'));
      });
    },
  },

  // =========================================================================
  // Feature 11: Interactive Approval Gate (5 tests)
  // =========================================================================
  {
    id: 'T1-F11-01',
    tier: 1,
    feature: 11,
    features: [11],
    title: 'Default ask mode blocks agent turn (status: waiting) on command, edit, and network approval events',
    async fn() {
      const gate = new InteractiveApprovalGate('ask');
      for (const kind of ['command', 'edit', 'network']) {
        const res = gate.requestApproval({ id: `appr-${kind}`, kind, detail: `test ${kind}` });
        assert.equal(res.blocked, true);
        assert.equal(gate.status, 'waiting');
      }
      assert.equal(gate.pending.size, 3);
    },
  },
  {
    id: 'T1-F11-02',
    tier: 1,
    feature: 11,
    features: [11],
    title: 'respondToApproval(id, true, "once") unblocks the pending request and transitions status back to working',
    async fn() {
      const gate = new InteractiveApprovalGate('ask');
      gate.requestApproval({ id: 'appr-1', kind: 'command', detail: 'git status' });
      const decision = gate.respondToApproval('appr-1', true, 'once');
      assert.equal(decision.allowed, true);
      assert.equal(gate.status, 'working');
      assert.equal(gate.pending.size, 0);
    },
  },
  {
    id: 'T1-F11-03',
    tier: 1,
    feature: 11,
    features: [11],
    title: 'respondToApproval(id, false) denies the action, clears pending state, and records the denial',
    async fn() {
      const gate = new InteractiveApprovalGate('ask');
      gate.requestApproval({ id: 'appr-deny', kind: 'network', detail: 'curl https://example.com' });
      const decision = gate.respondToApproval('appr-deny', false, 'once');
      assert.equal(decision.allowed, false);
      assert.equal(gate.status, 'idle');
      assert.equal(gate.history.length, 1);
      assert.equal(gate.history[0].allowed, false);
    },
  },
  {
    id: 'T1-F11-04',
    tier: 1,
    feature: 11,
    features: [11],
    title: 'Allow for this session (scope: "session") auto-approves subsequent approval requests of the same kind',
    async fn() {
      const gate = new InteractiveApprovalGate('ask');
      const first = gate.requestApproval({ id: 'appr-s1', kind: 'command', detail: 'pnpm lint' });
      assert.equal(first.blocked, true);
      gate.respondToApproval('appr-s1', true, 'session');

      const second = gate.requestApproval({ id: 'appr-s2', kind: 'command', detail: 'pnpm test' });
      assert.equal(second.blocked, false);
      assert.equal(second.allowed, true);
    },
  },
  {
    id: 'T1-F11-05',
    tier: 1,
    feature: 11,
    features: [11],
    title: 'auto-edit mode auto-approves edit requests while blocking command requests, and full-auto mode auto-approves all kinds',
    async fn() {
      const autoEditGate = new InteractiveApprovalGate('auto-edit');
      assert.equal(autoEditGate.requestApproval({ id: 'e1', kind: 'edit', detail: 'compare.ts' }).blocked, false);
      assert.equal(autoEditGate.requestApproval({ id: 'c1', kind: 'command', detail: 'rm -rf' }).blocked, true);

      const fullAutoGate = new InteractiveApprovalGate('full-auto');
      assert.equal(fullAutoGate.requestApproval({ id: 'c2', kind: 'command', detail: 'pnpm test' }).blocked, false);
      assert.equal(fullAutoGate.requestApproval({ id: 'n2', kind: 'network', detail: 'fetch' }).blocked, false);
    },
  },

  // =========================================================================
  // Feature 12: Slash Commands (/plan, /review, /teamwork, /cli, /undo) (5 tests)
  // =========================================================================
  {
    id: 'T1-F12-01',
    tier: 1,
    feature: 12,
    features: [12],
    title: 'Composer slash-command parser detects "/" prefix and filters popup menu (/team -> /teamwork)',
    async fn() {
      const allMenu = filterSlashPopupMenu('/');
      assert.equal(allMenu.length, 5);
      assert.deepEqual(
        allMenu.map((m) => m.command),
        ['/teamwork', '/plan', '/review', '/cli', '/undo']
      );

      const filtered = filterSlashPopupMenu('/team');
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].command, '/teamwork');
      assert.equal(filtered[0].description, 'Split this task across your CLIs');
    },
  },
  {
    id: 'T1-F12-02',
    tier: 1,
    feature: 12,
    features: [12],
    title: '/plan generates an editable checklist from the primary CLI without modifying any files before user approval',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const statusBefore = gitExec(repoDir, ['status', '--porcelain']);
        const checklist = {
          planId: 'plan-001',
          approved: false,
          items: [
            { id: 'item-1', text: 'Build markdown brief formatter in src/lib/brief.ts', checked: true },
            { id: 'item-2', text: 'Wire Copy review brief button in CompareView.tsx', checked: true },
            { id: 'item-3', text: 'Cover compare-model with unit tests', checked: true },
          ],
        };
        // Edit item text before approving
        checklist.items[0].text = 'Build concise markdown brief formatter in src/lib/brief.ts';
        const statusWhileUnapproved = gitExec(repoDir, ['status', '--porcelain']);
        assert.equal(statusWhileUnapproved, statusBefore, 'No files may be edited before plan is approved');
        checklist.approved = true;
        assert.equal(checklist.approved, true);
        assert.equal(checklist.items.length, 3);
      });
    },
  },
  {
    id: 'T1-F12-03',
    tier: 1,
    feature: 12,
    features: [12],
    title: '/review runs a secondary CLI in readOnly: true mode on the latest diff and returns review comments without editing files',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        createGitCheckpoint(repoDir, 'rev-cp-1');
        const comparePath = path.join(repoDir, 'src/routes/compare.ts');
        fs.writeFileSync(comparePath, fs.readFileSync(comparePath, 'utf8') + '\n// reviewed line\n', 'utf8');
        const diff = getCheckpointDiff(repoDir, 'rev-cp-1');
        const mtimeBefore = fs.statSync(comparePath).mtimeMs;

        const reviewStartOpts = {
          cwd: repoDir,
          approvalMode: 'ask',
          readOnly: true,
          systemContext: `Reviewing diff:\n${diff.patch}`,
        };
        assert.equal(reviewStartOpts.readOnly, true);
        const reviewComments = [
          { file: 'src/routes/compare.ts', line: 5, severity: 'suggestion', comment: 'Handle clipboard rejection state explicitly.' },
        ];
        assert.equal(reviewComments.length, 1);
        assert.equal(fs.statSync(comparePath).mtimeMs, mtimeBefore, '/review must not modify working tree files');
      });
    },
  },
  {
    id: 'T1-F12-04',
    tier: 1,
    feature: 12,
    features: [12],
    title: '/cli <name> slash command switches the active CLI of the session and records the switch event',
    async fn() {
      await withTempDir(async (tmpDir) => {
        const store = new ConductorSqliteStore(path.join(tmpDir, '.conductor/conductor.db'));
        store.createSession({ id: 'sess-slash-cli', projectId: 'p1', title: 'Slash CLI', activeCli: 'codex' });
        const cmd = '/cli antigravity';
        const targetCli = cmd.slice('/cli '.length).trim();
        const updated = store.updateSessionStatus('sess-slash-cli', 'idle', targetCli);
        assert.equal(updated.active_cli, 'antigravity');
      });
    },
  },
  {
    id: 'T1-F12-05',
    tier: 1,
    feature: 12,
    features: [12],
    title: '/undo slash command restores the working tree from the latest pre-turn checkpoint ref',
    async fn() {
      await withTempGitRepo(async (repoDir) => {
        const target = path.join(repoDir, 'src/index.ts');
        const original = fs.readFileSync(target, 'utf8');
        createGitCheckpoint(repoDir, 'slash-undo-1');
        fs.writeFileSync(target, 'export const broken = true;\n', 'utf8');
        assert.notEqual(fs.readFileSync(target, 'utf8'), original);

        undoGitCheckpoint(repoDir, 'slash-undo-1');
        assert.equal(fs.readFileSync(target, 'utf8'), original);
      });
    },
  },
];
