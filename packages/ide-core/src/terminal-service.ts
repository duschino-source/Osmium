import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { TerminalCreateOptions, TerminalSessionInfo } from './ipc-types.js';

interface ActiveTerminal {
  info: TerminalSessionInfo;
  process?: ChildProcess;
  ptyProcess?: any;
  emitter: EventEmitter;
}

export class TerminalService {
  private sessions = new Map<string, ActiveTerminal>();
  private idCounter = 1;

  async createSession(
    opts: TerminalCreateOptions,
    onData: (sessionId: string, data: string) => void,
  ): Promise<TerminalSessionInfo> {
    const id = `term-${this.idCounter++}`;
    const cwd = opts.cwd || process.cwd();
    const isWindows = process.platform === 'win32';
    const shell =
      opts.shellProfile === 'cmd'
        ? isWindows
          ? 'cmd.exe'
          : 'sh'
        : isWindows
          ? 'powershell.exe'
          : process.env.SHELL || 'bash';

    const emitter = new EventEmitter();

    // Attempt node-pty first if available, fallback to child_process.spawn
    let ptyProcess: any;
    let proc: ChildProcess | undefined;
    let pid = 0;

    try {
      const pty = await import('node-pty');
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: opts.cols || 80,
        rows: opts.rows || 24,
        cwd,
        env: { ...process.env, ...opts.env } as Record<string, string>,
      });
      pid = ptyProcess.pid;
      ptyProcess.onData((data: string) => {
        onData(id, data);
      });
    } catch {
      // Fallback to standard spawn
      proc = spawn(shell, [], {
        cwd,
        env: { ...process.env, ...opts.env },
        shell: false,
      });
      pid = proc.pid || 0;

      proc.stdout?.on('data', (chunk) => {
        onData(id, chunk.toString());
      });
      proc.stderr?.on('data', (chunk) => {
        onData(id, chunk.toString());
      });
    }

    const info: TerminalSessionInfo = {
      id,
      cwd,
      shell,
      pid,
    };

    this.sessions.set(id, {
      info,
      process: proc,
      ptyProcess,
      emitter,
    });

    return info;
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (!session) return;

    if (session.ptyProcess) {
      session.ptyProcess.write(data);
    } else if (session.process?.stdin?.writable) {
      session.process.stdin.write(data);
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (!session) return;
    if (session.ptyProcess?.resize) {
      session.ptyProcess.resize(cols, rows);
    }
  }

  close(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;

    if (session.ptyProcess) {
      session.ptyProcess.kill();
    } else if (session.process) {
      session.process.kill();
    }

    this.sessions.delete(id);
  }

  list(): TerminalSessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => s.info);
  }
}
