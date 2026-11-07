#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { type AgentEvent, type TeamworkPlan, assertWorkspaceWriteAllowed } from '@conductor/core';

export const MOCK_CLI_VERSION = '0.1.0';

export type MockScenarioName =
  'chat' | 'edit' | 'approval' | 'quota' | 'plan' | 'review' | 'teamwork' | 'raw';

export interface MockCliOptions {
  version?: boolean;
  help?: boolean;
  scenario: MockScenarioName;
  delayMs: number;
  cwd: string;
  json: boolean;
  writeFile: boolean;
  targetFile: string;
  approvalKind: 'command' | 'edit' | 'network';
  prompt?: string;
  resume?: string;
  systemContext?: string;
}

export function createMockTeamworkPlan(goal = 'Add copy review brief'): TeamworkPlan {
  return {
    goal,
    tasks: [
      {
        id: 'task-1',
        title: 'Scaffold copy action',
        description: 'Define CompareRow brief types and route wiring',
        scope: ['src/routes/**'],
        dependencies: [],
        taskType: 'planning',
        assignedCli: 'codex',
      },
      {
        id: 'task-2',
        title: 'Markdown brief builder',
        description: 'Implement toBrief formatting and clipboard helper',
        scope: ['src/lib/**'],
        dependencies: ['task-1'],
        taskType: 'implementation',
        assignedCli: 'codex',
      },
      {
        id: 'task-3',
        title: 'Browser check on fixtures',
        description: 'Verify copy button UI states across fixture views',
        scope: ['fixtures/**', 'src/components/**'],
        dependencies: ['task-1'],
        taskType: 'browser-check',
        assignedCli: 'antigravity',
      },
      {
        id: 'task-4',
        title: 'Unit tests: compare-model',
        description: 'Cover brief formatting edge cases and empty rows',
        scope: ['tests/**'],
        dependencies: ['task-2'],
        taskType: 'tests',
        assignedCli: 'deepseek',
      },
    ],
  };
}

export function createMockPlanChecklist(): Array<{ id: string; title: string; checked: boolean }> {
  return [
    {
      id: 'step-1',
      title: 'Build the markdown brief helper in src/lib/brief.ts',
      checked: true,
    },
    {
      id: 'step-2',
      title: 'Wire the Copy review brief button in CompareView.tsx',
      checked: true,
    },
    {
      id: 'step-3',
      title: 'Add unit tests for compare-model.ts',
      checked: true,
    },
  ];
}

export function createMockReviewComments(): Array<{
  filePath: string;
  line: number;
  comment: string;
}> {
  return [
    {
      filePath: 'src/routes/compare.ts',
      line: 6,
      comment: 'Guard navigator.clipboard availability when running in non-secure contexts.',
    },
    {
      filePath: 'src/components/CompareView.tsx',
      line: 18,
      comment: 'Ensure the Copy review brief button has an accessible aria-label.',
    },
  ];
}

export function parseMockCliArgs(argv: string[]): MockCliOptions {
  const opts: MockCliOptions = {
    scenario: 'chat',
    delayMs: 10,
    cwd: process.cwd(),
    json: true,
    writeFile: false,
    targetFile: 'src/routes/compare.ts',
    approvalKind: 'command',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--version' || arg === '-v') {
      opts.version = true;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--scenario' || arg === '-s') {
      const val = argv[++i] ?? 'chat';
      opts.scenario = normalizeScenario(val);
    } else if (arg.startsWith('--scenario=')) {
      opts.scenario = normalizeScenario(arg.slice('--scenario='.length));
    } else if (arg === '--delay' || arg === '-d') {
      opts.delayMs = Math.max(0, Number.parseInt(argv[++i] ?? '10', 10) || 0);
    } else if (arg.startsWith('--delay=')) {
      opts.delayMs = Math.max(0, Number.parseInt(arg.slice('--delay='.length), 10) || 0);
    } else if (arg === '--cwd') {
      opts.cwd = argv[++i] ?? process.cwd();
    } else if (arg.startsWith('--cwd=')) {
      opts.cwd = arg.slice('--cwd='.length);
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--text') {
      opts.json = false;
    } else if (arg === '--write-file') {
      opts.writeFile = true;
    } else if (arg === '--target-file') {
      opts.targetFile = argv[++i] ?? opts.targetFile;
    } else if (arg === '--approval-kind') {
      const kind = argv[++i];
      if (kind === 'command' || kind === 'edit' || kind === 'network') {
        opts.approvalKind = kind;
      }
    } else if (arg === '--prompt' || arg === '-p') {
      opts.prompt = argv[++i] ?? '';
      if (!argv.includes('--scenario') && !argv.some((a) => a.startsWith('--scenario='))) {
        opts.scenario = inferScenarioFromPrompt(opts.prompt);
      }
    } else if (arg.startsWith('--prompt=')) {
      opts.prompt = arg.slice('--prompt='.length);
      if (!argv.includes('--scenario') && !argv.some((a) => a.startsWith('--scenario='))) {
        opts.scenario = inferScenarioFromPrompt(opts.prompt);
      }
    } else if (arg === '--resume') {
      opts.resume = argv[++i];
    } else if (arg === '--system-context') {
      opts.systemContext = argv[++i];
    }
  }

  return opts;
}

function normalizeScenario(raw: string): MockScenarioName {
  const cleaned = raw.replace(/^\//, '').toLowerCase();
  if (
    cleaned === 'chat' ||
    cleaned === 'edit' ||
    cleaned === 'approval' ||
    cleaned === 'quota' ||
    cleaned === 'plan' ||
    cleaned === 'review' ||
    cleaned === 'teamwork' ||
    cleaned === 'raw'
  ) {
    return cleaned;
  }
  if (cleaned === 'file-edit') return 'edit';
  if (cleaned === 'limit' || cleaned === 'usage') return 'quota';
  return 'chat';
}

function inferScenarioFromPrompt(prompt: string): MockScenarioName {
  const trimmed = prompt.trim();
  if (trimmed.startsWith('/plan')) return 'plan';
  if (trimmed.startsWith('/review')) return 'review';
  if (trimmed.startsWith('/teamwork')) return 'teamwork';
  if (/\bquota\b|\blimit\b/i.test(trimmed)) return 'quota';
  if (/\bapproval\b|\bapprove\b/i.test(trimmed)) return 'approval';
  if (/\bedit\b|\bwrite\b/i.test(trimmed)) return 'edit';
  return 'chat';
}

export function getMockCliHelpText(): string {
  return [
    `mock-cli v${MOCK_CLI_VERSION} — Conductor deterministic fake CLI for testing`,
    '',
    'Usage: mock-cli [options]',
    '',
    'Options:',
    '  -v, --version                 Print version and exit',
    '  -h, --help                    Print help and exit',
    '  -s, --scenario <name>         Scenario: chat | edit | approval | quota | plan | review | teamwork | raw',
    '  -d, --delay <ms>              Delay in milliseconds between emitted events (default: 10)',
    '  --cwd <dir>                   Working directory for file operations',
    '  --write-file                  Write simulated file edit to disk inside --cwd',
    '  --target-file <relPath>       Target file path relative to --cwd (default: src/routes/compare.ts)',
    '  --approval-kind <kind>        Approval kind: command | edit | network (default: command)',
    '  -p, --prompt <text>           User prompt text',
    '  --resume <sessionId>          Resume an existing session ID',
    '  --system-context <text>       System handoff or context string',
    '  --json                        Emit newline-delimited JSON AgentEvents (default)',
    '  --text                        Emit human-readable plain text output',
  ].join('\n');
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseApprovalInput(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { allow?: boolean; approved?: boolean };
      return Boolean(parsed.allow ?? parsed.approved);
    } catch {
      return false;
    }
  }
  const lower = trimmed.toLowerCase();
  return (
    lower === 'allow' ||
    lower === 'allow-session' ||
    lower === 'yes' ||
    lower === 'y' ||
    lower === 'true' ||
    lower === '1'
  );
}

async function waitForApprovalLine(input: NodeJS.ReadableStream): Promise<boolean> {
  const rl = readline.createInterface({
    input,
    crlfDelay: Infinity,
  });
  return new Promise<boolean>((resolve) => {
    let resolved = false;
    rl.on('line', (line) => {
      if (!resolved) {
        resolved = true;
        rl.close();
        resolve(parseApprovalInput(line));
      }
    });
    rl.on('close', () => {
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    });
  });
}

export interface RunMockCliHandlers {
  onEvent?: (event: AgentEvent) => void;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
}

export async function runMockCliScenario(
  opts: MockCliOptions,
  handlers: RunMockCliHandlers = {},
): Promise<AgentEvent[]> {
  const emitted: AgentEvent[] = [];
  const stdout = handlers.stdout;

  const emit = async (event: AgentEvent) => {
    emitted.push(event);
    handlers.onEvent?.(event);
    if (stdout) {
      if (opts.json) {
        stdout.write(`${JSON.stringify(event)}\n`);
      } else {
        stdout.write(`[${event.type}] ${JSON.stringify(event)}\n`);
      }
    }
    await sleep(opts.delayMs);
  };

  await emit({ type: 'status', state: 'working', message: `Starting ${opts.scenario}` });

  switch (opts.scenario) {
    case 'chat': {
      const contextPrefix = opts.systemContext
        ? `[Handoff context received] `
        : opts.resume
          ? `[Resumed ${opts.resume}] `
          : '';
      await emit({
        type: 'message',
        role: 'assistant',
        text: `${contextPrefix}Plan: build the brief, `,
        final: false,
      });
      await emit({
        type: 'tool',
        id: 'tool-read-1',
        name: 'read_file',
        status: 'running',
        summary: 'Reading compare-model.ts',
      });
      await emit({
        type: 'tool',
        id: 'tool-read-1',
        name: 'read_file',
        status: 'done',
        summary: 'Read compare-model.ts · 18s',
        durationSec: 18,
      });
      await emit({
        type: 'message',
        role: 'assistant',
        text: `${contextPrefix}Plan: build the brief, wire the button, cover with tests.`,
        final: true,
      });
      await emit({ type: 'status', state: 'idle' });
      break;
    }

    case 'edit': {
      await emit({
        type: 'tool',
        id: 'tool-edit-1',
        name: 'apply_patch',
        status: 'running',
        summary: `Editing ${opts.targetFile}`,
      });

      if (opts.writeFile) {
        const safePath = assertWorkspaceWriteAllowed(opts.cwd, opts.targetFile);
        fs.mkdirSync(path.dirname(safePath), { recursive: true });
        const content = [
          "import { toBrief } from '../lib/brief';",
          '',
          'export function copyBrief(rows: Array<{ key: string; value: string }>) {',
          '  const text = toBrief(rows);',
          '  return text;',
          '}',
          '',
        ].join('\n');
        fs.writeFileSync(safePath, content, 'utf8');
      }

      await emit({
        type: 'file-edit',
        path: opts.targetFile,
        added: 43,
        removed: 2,
      });
      await emit({
        type: 'tool',
        id: 'tool-edit-1',
        name: 'apply_patch',
        status: 'done',
        summary: `Edited ${path.basename(opts.targetFile)} · 18s`,
        durationSec: 18,
      });
      await emit({
        type: 'message',
        role: 'assistant',
        text: `Updated ${opts.targetFile} with the copy review brief implementation.`,
        final: true,
      });
      await emit({ type: 'status', state: 'idle' });
      break;
    }

    case 'approval': {
      const approvalId = 'approval-1';
      const detail =
        opts.approvalKind === 'command'
          ? 'pnpm --filter api-gateway test'
          : opts.approvalKind === 'edit'
            ? `Write changes to ${opts.targetFile}`
            : 'Fetch schema from https://example.com/schema.json';

      await emit({
        type: 'approval',
        id: approvalId,
        kind: opts.approvalKind,
        detail,
      });
      await emit({
        type: 'status',
        state: 'waiting',
        message: `Waiting for approval (${opts.approvalKind})`,
      });

      const allowed = await waitForApprovalLine(handlers.stdin ?? process.stdin);
      if (allowed) {
        await emit({
          type: 'status',
          state: 'working',
          message: 'Approval granted, continuing execution',
        });
        await emit({
          type: 'tool',
          id: 'tool-approved-1',
          name: opts.approvalKind,
          status: 'done',
          summary: `Executed approved ${opts.approvalKind}: ${detail}`,
        });
        await emit({
          type: 'message',
          role: 'assistant',
          text: `Approved ${opts.approvalKind} completed successfully.`,
          final: true,
        });
        await emit({ type: 'status', state: 'idle' });
      } else {
        await emit({
          type: 'tool',
          id: 'tool-approved-1',
          name: opts.approvalKind,
          status: 'error',
          summary: `Approval denied for ${opts.approvalKind}`,
        });
        await emit({
          type: 'message',
          role: 'assistant',
          text: `Action cancelled because approval was denied.`,
          final: true,
        });
        await emit({ type: 'status', state: 'idle', message: 'Approval denied' });
      }
      break;
    }

    case 'quota': {
      await emit({
        type: 'message',
        role: 'assistant',
        text: 'Starting task execution...',
        final: false,
      });
      await emit({
        type: 'usage',
        limitHit: true,
        note: 'Rate or subscription quota limit reached on current CLI.',
      });
      await emit({
        type: 'status',
        state: 'error',
        message: 'Subscription quota limit reached',
      });
      break;
    }

    case 'plan': {
      const checklist = createMockPlanChecklist();
      const markdownChecklist = checklist.map((item) => `- [x] ${item.title}`).join('\n');
      await emit({
        type: 'message',
        role: 'assistant',
        text: `Proposed Plan:\n${markdownChecklist}`,
        final: true,
      });
      await emit({ type: 'status', state: 'idle' });
      break;
    }

    case 'review': {
      const comments = createMockReviewComments();
      const formatted = comments.map((c) => `${c.filePath}:${c.line} — ${c.comment}`).join('\n');
      await emit({
        type: 'message',
        role: 'assistant',
        text: `Read-only diff review complete:\n${formatted}`,
        final: true,
      });
      await emit({ type: 'status', state: 'idle' });
      break;
    }

    case 'teamwork': {
      const goal = opts.prompt?.replace(/^\/teamwork\s*/i, '').trim() || 'Add copy review brief';
      const plan = createMockTeamworkPlan(goal);
      await emit({
        type: 'message',
        role: 'assistant',
        text: JSON.stringify(plan),
        final: true,
      });
      await emit({ type: 'status', state: 'idle' });
      break;
    }

    case 'raw': {
      await emit({
        type: 'raw',
        data: 'unstructured terminal line: building index [100%]',
      });
      await emit({ type: 'status', state: 'idle' });
      break;
    }
  }

  return emitted;
}

export async function runCliFromProcess(argv = process.argv.slice(2)): Promise<number> {
  const opts = parseMockCliArgs(argv);

  if (opts.version) {
    process.stdout.write(`mock-cli ${MOCK_CLI_VERSION}\n`);
    return 0;
  }

  if (opts.help) {
    process.stdout.write(`${getMockCliHelpText()}\n`);
    return 0;
  }

  await runMockCliScenario(opts, {
    stdin: process.stdin,
    stdout: process.stdout,
  });

  return 0;
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  runCliFromProcess().then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`mock-cli error: ${msg}\n`);
      process.exitCode = 1;
    },
  );
}
