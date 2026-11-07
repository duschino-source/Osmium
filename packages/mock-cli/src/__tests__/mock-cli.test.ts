import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TeamworkPlanSchema } from '@osmium/core';
import {
  MOCK_CLI_VERSION,
  parseMockCliArgs,
  runMockCliScenario,
  getMockCliHelpText,
} from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('@osmium/mock-cli scenarios & subprocess execution', () => {
  it('parses CLI flags and supports --version and --help', () => {
    expect(parseMockCliArgs(['--version']).version).toBe(true);
    expect(parseMockCliArgs(['--help']).help).toBe(true);
    expect(getMockCliHelpText()).toContain(`mock-cli v${MOCK_CLI_VERSION}`);

    const parsed = parseMockCliArgs([
      '--scenario',
      'edit',
      '--delay',
      '5',
      '--cwd',
      '/tmp/demo',
      '--write-file',
    ]);
    expect(parsed.scenario).toBe('edit');
    expect(parsed.delayMs).toBe(5);
    expect(parsed.cwd).toBe('/tmp/demo');
    expect(parsed.writeFile).toBe(true);
  });

  it('streams assistant answer chunks, tool status transitions, and final message in chat scenario', async () => {
    const opts = parseMockCliArgs(['--scenario', 'chat', '--delay', '0']);
    const events = await runMockCliScenario(opts);

    const messageEvents = events.filter((e) => e.type === 'message');
    expect(messageEvents.length).toBeGreaterThanOrEqual(2);
    expect(messageEvents[0]).toMatchObject({
      type: 'message',
      role: 'assistant',
      final: false,
    });
    expect(messageEvents[messageEvents.length - 1]).toMatchObject({
      type: 'message',
      role: 'assistant',
      final: true,
    });

    const toolEvents = events.filter((e) => e.type === 'tool');
    expect(toolEvents.map((t) => (t.type === 'tool' ? t.status : ''))).toEqual(['running', 'done']);
  });

  it('emits file-edit event and writes file inside cwd when --write-file is enabled', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'osmium-mock-cli-'));
    try {
      const opts = parseMockCliArgs([
        '--scenario',
        'edit',
        '--delay',
        '0',
        '--cwd',
        tmpDir,
        '--write-file',
      ]);
      const events = await runMockCliScenario(opts);
      const editEvent = events.find((e) => e.type === 'file-edit');
      expect(editEvent).toEqual({
        type: 'file-edit',
        path: 'src/routes/compare.ts',
        added: 43,
        removed: 2,
      });

      const writtenFile = path.join(tmpDir, 'src/routes/compare.ts');
      expect(fs.existsSync(writtenFile)).toBe(true);
      expect(fs.readFileSync(writtenFile, 'utf8')).toContain('export function copyBrief');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('blocks on approval request until stdin responds allow or deny', async () => {
    const stdinAllow = new PassThrough();
    const opts = parseMockCliArgs([
      '--scenario',
      'approval',
      '--approval-kind',
      'command',
      '--delay',
      '0',
    ]);

    const promise = runMockCliScenario(opts, { stdin: stdinAllow });
    setTimeout(() => {
      stdinAllow.write('{"id":"approval-1","allow":true}\n');
      stdinAllow.end();
    }, 5);

    const events = await promise;
    expect(events.some((e) => e.type === 'approval' && e.kind === 'command')).toBe(true);
    expect(events.some((e) => e.type === 'status' && e.state === 'waiting')).toBe(true);
    const finalMsg = events.find((e) => e.type === 'message' && e.final);
    expect(finalMsg && finalMsg.type === 'message' ? finalMsg.text : '').toContain(
      'Approved command completed',
    );

    // Also test denial
    const stdinDeny = new PassThrough();
    const denyPromise = runMockCliScenario(opts, { stdin: stdinDeny });
    setTimeout(() => {
      stdinDeny.write('deny\n');
      stdinDeny.end();
    }, 5);
    const denyEvents = await denyPromise;
    expect(denyEvents.some((e) => e.type === 'tool' && e.status === 'error')).toBe(true);
  });

  it('emits simulated quota limit hit event', async () => {
    const opts = parseMockCliArgs(['--scenario', 'quota', '--delay', '0']);
    const events = await runMockCliScenario(opts);
    const usageEvent = events.find((e) => e.type === 'usage');
    expect(usageEvent).toMatchObject({
      type: 'usage',
      limitHit: true,
    });
    expect(events[events.length - 1]).toMatchObject({
      type: 'status',
      state: 'error',
    });
  });

  it('emits valid /plan, /review, and /teamwork outputs', async () => {
    const planEvents = await runMockCliScenario(
      parseMockCliArgs(['--prompt', '/plan Add copy brief', '--delay', '0']),
    );
    const planMsg = planEvents.find((e) => e.type === 'message' && e.final);
    expect(planMsg && planMsg.type === 'message' ? planMsg.text : '').toContain('Proposed Plan:');

    const reviewEvents = await runMockCliScenario(
      parseMockCliArgs(['--prompt', '/review', '--delay', '0']),
    );
    const reviewMsg = reviewEvents.find((e) => e.type === 'message' && e.final);
    expect(reviewMsg && reviewMsg.type === 'message' ? reviewMsg.text : '').toContain(
      'Read-only diff review complete:',
    );

    const teamworkEvents = await runMockCliScenario(
      parseMockCliArgs(['--prompt', '/teamwork Add copy review brief', '--delay', '0']),
    );
    const teamworkMsg = teamworkEvents.find((e) => e.type === 'message' && e.final);
    const parsedPlan = TeamworkPlanSchema.parse(
      JSON.parse(teamworkMsg && teamworkMsg.type === 'message' ? teamworkMsg.text : '{}'),
    );
    expect(parsedPlan.tasks).toHaveLength(4);
    expect(new Set(parsedPlan.tasks.map((t) => t.assignedCli))).toEqual(
      new Set(['codex', 'antigravity', 'deepseek']),
    );
  });

  it('runs as a real child process when built', async () => {
    const distCli = path.resolve(__dirname, '../../dist/index.js');
    if (!fs.existsSync(distCli)) {
      return;
    }
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [distCli, '--scenario', 'chat', '--delay', '0'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (chunk) => {
        out += String(chunk);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve(out);
        else reject(new Error(`Exited with ${code}`));
      });
    });

    const lines = output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines.some((e) => e.type === 'message' && e.final === true)).toBe(true);
  });
});
