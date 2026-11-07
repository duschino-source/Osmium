import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AgentEvent } from '@osmium/core';

/**
 * Electron main-side client for the Rust `osmium-adapter-host` sidecar.
 *
 * Transport is newline-delimited JSON over stdin/stdout (see
 * `docs/ADAPTER_BRIDGE.md`). This module intentionally does not import
 * `electron` so it can be unit-tested with a fake child process; the only
 * Electron-specific input (the packaged resources directory) is read
 * defensively from `process.resourcesPath`.
 */

export const ADAPTER_HOST_BINARY = 'osmium-adapter-host';
export const MOCK_CLI_BINARY = 'osmium-mock-cli';

const SHUTDOWN_GRACE_MS = 1_200;
const KILL_GRACE_MS = 800;
const FINAL_KILL_GRACE_MS = 400;

export type AdapterHostResolutionSource =
  'explicit' | 'env' | 'dev-debug' | 'dev-release' | 'resources' | 'none';

export interface AdapterHostBinaryCandidate {
  path: string;
  source: Exclude<AdapterHostResolutionSource, 'none'>;
}

export interface AdapterHostResolution {
  /** Resolved binary path, or `null` when no candidate exists. */
  path: string | null;
  source: AdapterHostResolutionSource;
  /** Every candidate that was probed, in resolution order (diagnostics only). */
  candidates: AdapterHostBinaryCandidate[];
  repoRoot: string | null;
}

export interface ResolveAdapterHostOptions {
  /** Explicit override (test/embedding); wins over the environment. */
  explicitPath?: string | null;
  env?: NodeJS.ProcessEnv;
  /** `process.resourcesPath` in Electron; defaults to reading it if present. */
  resourcesPath?: string | null;
  repoRoot?: string | null;
  platform?: NodeJS.Platform;
  exists?: (candidate: string) => boolean;
}

export interface ResolveMockCliOptions {
  repoRoot?: string | null;
  platform?: NodeJS.Platform;
  exists?: (candidate: string) => boolean;
}

/** Windows builds carry an `.exe` suffix; other platforms do not. */
export function adapterHostBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? `${ADAPTER_HOST_BINARY}.exe` : ADAPTER_HOST_BINARY;
}

export function mockCliBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? `${MOCK_CLI_BINARY}.exe` : MOCK_CLI_BINARY;
}

/** Walk up from `startDir` until a directory containing `Cargo.toml` is found. */
export function findRepoRoot(
  startDir: string,
  exists: (candidate: string) => boolean = existsSync,
  maxDepth = 8,
): string | null {
  let current = path.resolve(startDir);
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (exists(path.join(current, 'Cargo.toml'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function resourcesDir(): string | null {
  const value = (process as NodeJS.Process & { resourcesPath?: unknown }).resourcesPath;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function moduleDir(): string | null {
  // `typeof` on an undeclared identifier is safe in ESM, where `__dirname`
  // does not exist (e.g. when this module is loaded by Vitest).
  return typeof __dirname === 'string' ? __dirname : null;
}

function defaultRepoRoot(): string | null {
  const dir = moduleDir();
  if (!dir) return null;
  // Source layout: apps/desktop/src/main; build layout: apps/desktop/dist/main.
  // Both are four levels below the repository root.
  return findRepoRoot(dir) ?? path.resolve(dir, '..', '..', '..', '..');
}

/**
 * Resolve the adapter-host binary in contract order:
 * explicit override, `OSMIUM_ADAPTER_HOST`, dev `target/debug`,
 * dev `target/release`, packaged resources directory.
 */
export function resolveAdapterHostBinary(
  options: ResolveAdapterHostOptions = {},
): AdapterHostResolution {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  const candidates: AdapterHostBinaryCandidate[] = [];
  const add = (candidate: string, source: Exclude<AdapterHostResolutionSource, 'none'>): void => {
    candidates.push({ path: candidate, source });
  };

  const explicit = options.explicitPath?.trim();
  if (explicit) {
    add(path.resolve(explicit), 'explicit');
  } else {
    const fromEnv = env.OSMIUM_ADAPTER_HOST?.trim();
    if (fromEnv) add(path.resolve(fromEnv), 'env');
  }

  const repoRoot = options.repoRoot !== undefined ? options.repoRoot : defaultRepoRoot();
  if (repoRoot) {
    add(path.join(repoRoot, 'target', 'debug', adapterHostBinaryName(platform)), 'dev-debug');
    add(path.join(repoRoot, 'target', 'release', adapterHostBinaryName(platform)), 'dev-release');
  }

  const resources = options.resourcesPath ?? resourcesDir();
  if (resources) {
    add(path.join(resources, adapterHostBinaryName(platform)), 'resources');
  }

  const match = candidates.find((candidate) => exists(candidate.path));
  return {
    path: match?.path ?? null,
    source: match?.source ?? 'none',
    candidates,
    repoRoot,
  };
}

/** The dev mock CLI lives next to the dev host build. */
export function resolveMockCliPath(options: ResolveMockCliOptions = {}): string | null {
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  const repoRoot = options.repoRoot !== undefined ? options.repoRoot : defaultRepoRoot();
  if (!repoRoot) return null;
  const candidate = path.join(repoRoot, 'target', 'debug', mockCliBinaryName(platform));
  return exists(candidate) ? candidate : null;
}

export interface NdjsonSplitResult {
  lines: string[];
  rest: string;
}

/**
 * Split a buffered stdout chunk into complete NDJSON lines.
 * Handles `\n` and `\r\n`, ignores blank lines, and returns the unterminated
 * tail so the caller can prepend it to the next chunk.
 */
export function splitNdjsonLines(buffer: string, chunk: string): NdjsonSplitResult {
  const combined = buffer + chunk;
  const lines: string[] = [];
  let start = 0;
  for (;;) {
    const newline = combined.indexOf('\n', start);
    if (newline === -1) break;
    const line = combined.slice(start, newline).replace(/\r$/, '').trim();
    if (line.length > 0) lines.push(line);
    start = newline + 1;
  }
  return { lines, rest: combined.slice(start) };
}

export class AdapterHostError extends Error {
  readonly code: string;
  override readonly cause?: unknown;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'AdapterHostError';
    this.code = code;
    if (options && 'cause' in options) this.cause = options.cause;
  }
}

export interface SessionEventPayload {
  sessionId: string;
  event: AgentEvent;
}

export interface SessionEndedPayload {
  sessionId: string;
}

export interface AdapterHostExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  expected: boolean;
}

export interface AdapterHostProtocolErrorInfo {
  line: string;
  error: Error;
}

export interface AdapterHostClientEvents {
  sessionEvent: (payload: SessionEventPayload) => void;
  sessionEnded: (payload: SessionEndedPayload) => void;
  hostExit: (info: AdapterHostExitInfo) => void;
  stderr: (line: string) => void;
  protocolError: (info: AdapterHostProtocolErrorInfo) => void;
}

export interface AdapterHostTimeouts {
  detectAll: number;
  start: number;
  send: number;
  default: number;
}

const DEFAULT_TIMEOUTS: AdapterHostTimeouts = {
  detectAll: 60_000,
  start: 30_000,
  send: 30_000,
  default: 15_000,
};

function timeoutForMethod(method: string, timeouts: AdapterHostTimeouts): number {
  switch (method) {
    case 'detectAll':
      return timeouts.detectAll;
    case 'start':
      return timeouts.start;
    case 'send':
      return timeouts.send;
    default:
      return timeouts.default;
  }
}

export interface AdapterHostClientOptions {
  /** Explicit binary path; when omitted the contract resolution order applies. */
  hostPath?: string;
  /** Extra argv entries before `--mock-cli` (used by tests to run a fake host). */
  hostArgs?: string[];
  /** `null` disables `--mock-cli`; omitted auto-detects `target/debug/osmium-mock-cli`. */
  mockCliPath?: string | null;
  env?: NodeJS.ProcessEnv;
  repoRoot?: string | null;
  resourcesPath?: string | null;
  platform?: NodeJS.Platform;
  exists?: (candidate: string) => boolean;
  timeouts?: Partial<AdapterHostTimeouts>;
  log?: (message: string) => void;
}

export interface AdapterHostDiagnostics {
  hostPath: string | null;
  source: AdapterHostResolutionSource;
  mockCliPath: string | null;
  repoRoot: string | null;
  candidates: AdapterHostBinaryCandidate[];
  running: boolean;
  pid: number | null;
  pendingRequests: number;
}

interface PendingRequest {
  id: string;
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: NodeJS.Timeout;
}

interface HostRequestMessage {
  id: string;
  method: string;
  params: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class AdapterHostClient {
  private readonly options: AdapterHostClientOptions;
  private readonly timeouts: AdapterHostTimeouts;
  private readonly resolution: AdapterHostResolution;
  private readonly mockCliPath: string | null;
  private readonly emitter = new EventEmitter();

  private child: ChildProcess | null = null;
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private closing = false;
  private nextRequestId = 0;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(options: AdapterHostClientOptions = {}) {
    this.options = options;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
    const exists = options.exists ?? existsSync;
    this.resolution = resolveAdapterHostBinary({
      explicitPath: options.hostPath,
      env: options.env,
      resourcesPath: options.resourcesPath,
      repoRoot: options.repoRoot,
      platform: options.platform,
      exists,
    });
    this.mockCliPath =
      options.mockCliPath === undefined
        ? resolveMockCliPath({
            repoRoot: this.resolution.repoRoot,
            platform: options.platform,
            exists,
          })
        : options.mockCliPath;
  }

  /** Resolved `osmium-adapter-host` path (null when not built/installed). */
  get resolvedHostPath(): string | null {
    return this.resolution.path;
  }

  /** Resolved dev `osmium-mock-cli` path passed via `--mock-cli`, if any. */
  get resolvedMockCliPath(): string | null {
    return this.mockCliPath;
  }

  get isRunning(): boolean {
    return this.child !== null && this.isAlive(this.child);
  }

  get diagnostics(): AdapterHostDiagnostics {
    return {
      hostPath: this.resolution.path,
      source: this.resolution.source,
      mockCliPath: this.mockCliPath,
      repoRoot: this.resolution.repoRoot,
      candidates: this.resolution.candidates,
      running: this.isRunning,
      pid: this.child?.pid ?? null,
      pendingRequests: this.pending.size,
    };
  }

  on<K extends keyof AdapterHostClientEvents>(
    event: K,
    listener: AdapterHostClientEvents[K],
  ): this {
    this.emitter.on(event, listener);
    return this;
  }

  once<K extends keyof AdapterHostClientEvents>(
    event: K,
    listener: AdapterHostClientEvents[K],
  ): this {
    this.emitter.once(event, listener);
    return this;
  }

  off<K extends keyof AdapterHostClientEvents>(
    event: K,
    listener: AdapterHostClientEvents[K],
  ): this {
    this.emitter.off(event, listener);
    return this;
  }

  /** Send one request and resolve with its `result` (or reject with its `error`). */
  request<T>(
    method: string,
    params: unknown = {},
    options: { timeoutMs?: number } = {},
  ): Promise<T> {
    this.ensureHost();
    const id = String(++this.nextRequestId);
    const timeoutMs = options.timeoutMs ?? timeoutForMethod(method, this.timeouts);

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.reject(
          new AdapterHostError(
            'ERR_HOST_TIMEOUT',
            `Adapter host request "${method}" timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);

      this.pending.set(id, {
        id,
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      try {
        this.sendRequest({ id, method, params });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  ping(): Promise<{ ok: boolean; version: string }> {
    return this.request('ping');
  }

  /**
   * Send `shutdown`, wait briefly for a clean exit, then terminate the process
   * tree. Safe to call when no host was ever spawned.
   */
  async close(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.closing = false;
    this.rejectPending(new AdapterHostError('ERR_HOST_CLOSED', 'Adapter host client closed'));
    if (!child || !this.isAlive(child)) return;

    this.closing = true;
    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    });

    try {
      this.writeToChild(child, {
        id: `shutdown-${++this.nextRequestId}`,
        method: 'shutdown',
        params: {},
      });
    } catch (error) {
      this.log(`shutdown request failed: ${describeError(error)}`);
    }

    await waitForExit(exited, SHUTDOWN_GRACE_MS);
    if (this.isAlive(child)) this.killProcessTree(child);
    await waitForExit(exited, KILL_GRACE_MS);
    if (this.isAlive(child)) {
      try {
        child.kill('SIGKILL');
      } catch {
        // Best effort; the process may already be gone.
      }
      await waitForExit(exited, FINAL_KILL_GRACE_MS);
    }
    this.closing = false;
  }

  private ensureHost(): ChildProcess {
    if (this.child && this.isAlive(this.child)) return this.child;
    return this.spawnHost();
  }

  private spawnHost(): ChildProcess {
    const hostPath = this.resolution.path;
    if (!hostPath) {
      const lookedIn =
        this.resolution.candidates.map((candidate) => candidate.path).join(', ') || '(none)';
      throw new AdapterHostError(
        'ERR_HOST_BINARY_NOT_FOUND',
        `Could not find ${adapterHostBinaryName()}. Set OSMIUM_ADAPTER_HOST or run "cargo build -p ${ADAPTER_HOST_BINARY}". Looked in: ${lookedIn}`,
      );
    }

    const args = [...(this.options.hostArgs ?? [])];
    if (this.mockCliPath) args.push('--mock-cli', this.mockCliPath);

    let child: ChildProcess;
    try {
      child = spawn(hostPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      throw new AdapterHostError(
        'ERR_HOST_SPAWN_FAILED',
        `Failed to spawn ${hostPath}: ${describeError(error)}`,
        { cause: error },
      );
    }

    this.child = child;
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.closing = false;

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.consumeStdout(chunk));
    child.stderr?.on('data', (chunk: string) => this.consumeStderr(chunk));
    // Never let an EPIPE/stdout error crash the main process; the exit handler
    // rejects whatever is still pending.
    child.stdout?.on('error', () => undefined);
    child.stderr?.on('error', () => undefined);
    child.stdin?.on('error', () => undefined);
    child.on('error', (error) => this.handleProcessError(child, error));
    child.on('exit', (code, signal) => this.handleProcessExit(child, code, signal));

    this.log(`spawned ${hostPath} (pid ${child.pid ?? '?'})`);
    return child;
  }

  private sendRequest(message: HostRequestMessage): void {
    const child = this.child;
    if (!child) {
      throw new AdapterHostError('ERR_HOST_NOT_RUNNING', 'Adapter host is not running');
    }
    this.writeToChild(child, message);
  }

  private writeToChild(child: ChildProcess, message: HostRequestMessage): void {
    const stdin = child.stdin;
    if (!stdin || !stdin.writable) {
      throw new AdapterHostError('ERR_HOST_NOT_RUNNING', 'Adapter host stdin is not writable');
    }
    stdin.write(`${JSON.stringify(message)}\n`);
  }

  private consumeStdout(chunk: string): void {
    const { lines, rest } = splitNdjsonLines(this.stdoutBuffer, chunk);
    this.stdoutBuffer = rest;
    for (const line of lines) this.handleLine(line);
  }

  private consumeStderr(chunk: string): void {
    const { lines, rest } = splitNdjsonLines(this.stderrBuffer, chunk);
    this.stderrBuffer = rest;
    for (const line of lines) this.emitter.emit('stderr', line);
  }

  private handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.emitter.emit('protocolError', {
        line,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return;
    }
    if (!isRecord(message)) {
      this.emitter.emit('protocolError', {
        line,
        error: new Error('Adapter host emitted a non-object JSON message'),
      });
      return;
    }
    if (typeof message.id === 'string' || typeof message.id === 'number') {
      this.handleResponse(message);
      return;
    }
    this.handleNotification(message);
  }

  private handleResponse(message: Record<string, unknown>): void {
    const id = String(message.id);
    const pending = this.pending.get(id);
    // Late responses after a timeout, or responses to an already-rejected
    // request, are ignored.
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);

    if (message.error !== undefined) {
      const error = message.error;
      const code =
        isRecord(error) && typeof error.code === 'string' ? error.code : 'ERR_HOST_UNKNOWN';
      const text =
        isRecord(error) && typeof error.message === 'string'
          ? error.message
          : `Adapter host request "${pending.method}" failed`;
      pending.reject(new AdapterHostError(code, text));
      return;
    }
    pending.resolve(message.result);
  }

  /**
   * Handle asynchronous notifications. Canonical wire format:
   * `{ event: 'sessionEvent', sessionId, data: AgentEvent }` and
   * `{ event: 'sessionEnded', sessionId }`. For robustness this also accepts
   * legacy/alternate shapes seen while the contract was settling:
   * `{ event: 'sessionEvent', sessionId, event: {...} }` (duplicate key; last
   * wins after JSON.parse), `{ type: 'sessionEvent', sessionId, event: {...} }`,
   * and a bare `{ sessionId, event: AgentEvent }`.
   */
  private handleNotification(message: Record<string, unknown>): void {
    const sessionId = typeof message.sessionId === 'string' ? message.sessionId : null;
    const eventName = typeof message.event === 'string' ? message.event : undefined;
    const typeName = typeof message.type === 'string' ? message.type : undefined;
    const payload = isRecord(message.event)
      ? message.event
      : isRecord(message.data)
        ? message.data
        : null;

    if (eventName === 'sessionEnded' || typeName === 'sessionEnded') {
      if (sessionId) this.emitter.emit('sessionEnded', { sessionId });
      return;
    }

    const isSessionEvent = eventName === 'sessionEvent' || typeName === 'sessionEvent';
    if (sessionId && payload && (isSessionEvent || typeof payload.type === 'string')) {
      this.emitter.emit('sessionEvent', {
        sessionId,
        event: payload as unknown as AgentEvent,
      });
      return;
    }

    this.emitter.emit('protocolError', {
      line: JSON.stringify(message),
      error: new Error(
        `Unrecognised adapter host notification (event=${String(eventName ?? typeName)})`,
      ),
    });
  }

  private handleProcessError(child: ChildProcess, error: Error): void {
    this.log(`process error: ${error.message}`);
    if (this.child !== child) return;
    this.child = null;
    this.closing = false;
    this.rejectPending(
      new AdapterHostError(
        'ERR_HOST_SPAWN_FAILED',
        `Adapter host process error: ${error.message}`,
        { cause: error },
      ),
    );
  }

  private handleProcessExit(
    child: ChildProcess,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    const wasActive = this.child === child;
    const expected = this.closing;
    if (wasActive) {
      this.child = null;
      this.stdoutBuffer = '';
      this.stderrBuffer = '';
    }
    this.closing = false;
    if (wasActive) {
      this.rejectPending(
        new AdapterHostError(
          'ERR_HOST_EXITED',
          `Adapter host exited (code ${code ?? 'null'}, signal ${signal ?? 'null'}) before responding`,
        ),
      );
    }
    this.log(`exited code=${code ?? 'null'} signal=${signal ?? 'null'} expected=${expected}`);
    this.emitter.emit('hostExit', { code, signal, expected });
  }

  private rejectPending(error: AdapterHostError): void {
    for (const pending of [...this.pending.values()]) {
      clearTimeout(pending.timer);
      this.pending.delete(pending.id);
      pending.reject(error);
    }
  }

  private isAlive(child: ChildProcess): boolean {
    return child.exitCode === null && child.signalCode === null;
  }

  private killProcessTree(child: ChildProcess): void {
    if (process.platform === 'win32' && typeof child.pid === 'number') {
      try {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        killer.on('error', () => {
          try {
            child.kill();
          } catch {
            // Already gone.
          }
        });
        return;
      } catch {
        // Fall through to a plain kill.
      }
    }
    try {
      child.kill();
    } catch {
      // Already gone.
    }
  }

  private log(message: string): void {
    this.options.log?.(message);
  }
}

function waitForExit(exited: Promise<void>, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    void exited.then(finish);
  });
}
