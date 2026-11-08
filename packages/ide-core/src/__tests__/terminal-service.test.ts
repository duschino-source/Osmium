import { describe, it, expect, afterEach } from 'vitest';
import os from 'node:os';
import { TerminalService } from '../terminal-service.js';

/**
 * These exercise the real PTY path when node-pty loads on this host, and the
 * spawn fallback when it does not. Either way the contract is the same: output
 * arrives, writes reach the shell, and close() reaps the process.
 */
describe('TerminalService (real PTY)', () => {
  const service = new TerminalService();
  const created: string[] = [];

  afterEach(() => {
    service.closeAll();
    created.length = 0;
  });

  it('starts a shell, runs a command, and streams its output', async () => {
    const chunks: string[] = [];
    const info = await service.createSession(
      { cwd: os.tmpdir(), cols: 80, rows: 24 },
      (_id, data) => chunks.push(data),
    );
    created.push(info.id);

    expect(info.id).toMatch(/^term-\d+$/);
    expect(info.pid).toBeGreaterThan(0);
    expect(info.cwd).toBe(os.tmpdir());

    // Wait for the shell prompt, then issue a command.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    service.write(info.id, 'echo osmium-pty-marker\r');

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (chunks.join('').includes('osmium-pty-marker')) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(chunks.join('')).toContain('osmium-pty-marker');
  }, 20000);

  it('reports the shell it actually started', async () => {
    const info = await service.createSession({ cwd: os.tmpdir() }, () => {});
    created.push(info.id);
    expect(info.shell.length).toBeGreaterThan(0);
    expect(info.shell.toLowerCase()).toMatch(/powershell|cmd|bash|sh|zsh/);
  }, 20000);

  it('lists and closes sessions without leaking them', async () => {
    const a = await service.createSession({ cwd: os.tmpdir() }, () => {});
    const b = await service.createSession({ cwd: os.tmpdir() }, () => {});
    expect(service.list().map((s) => s.id)).toEqual(expect.arrayContaining([a.id, b.id]));

    service.close(a.id);
    expect(service.list().map((s) => s.id)).not.toContain(a.id);
    expect(service.list().map((s) => s.id)).toContain(b.id);

    service.closeAll();
    expect(service.list()).toEqual([]);
  }, 20000);

  it('ignores writes and closes for an unknown session', () => {
    expect(() => service.write('term-nope', 'x')).not.toThrow();
    expect(() => service.close('term-nope')).not.toThrow();
    expect(() => service.resize('term-nope', 80, 24)).not.toThrow();
  });
});
