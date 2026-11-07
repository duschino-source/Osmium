import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  AdapterHostClient,
  AdapterHostError,
  adapterHostBinaryName,
  mockCliBinaryName,
  resolveAdapterHostBinary,
  resolveMockCliPath,
  splitNdjsonLines,
  type AdapterHostClientOptions,
  type SessionEventPayload,
} from '../main/adapter-host.js';

/**
 * A tiny Node "host" that speaks the NDJSON protocol from
 * docs/ADAPTER_BRIDGE.md. Running it with `node -e` keeps the test independent
 * of the real Rust binary (and of the host crate being built).
 */
const FAKE_HOST_SCRIPT = `
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
function send(obj) { process.stdout.write(JSON.stringify(obj) + '\\n'); }
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'ping') { send({ id: msg.id, result: { ok: true, version: 'fake-1.0.0' } }); return; }
  if (msg.method === 'notify') {
    send({ id: msg.id, result: {} });
    // Canonical shape: the AgentEvent rides under "data".
    send({ event: 'sessionEvent', sessionId: 's-1', data: { type: 'status', state: 'working' } });
    // Legacy shape: payload under a duplicate "event" key (JSON keeps the last).
    send({ event: 'sessionEvent', sessionId: 's-1', event: { type: 'message', role: 'assistant', text: 'legacy', final: true } });
    send({ event: 'sessionEnded', sessionId: 's-1' });
    return;
  }
  if (msg.method === 'split') {
    const out = JSON.stringify({ id: msg.id, result: { value: 42 } }) + '\\n';
    process.stdout.write(out.slice(0, 12));
    setTimeout(() => process.stdout.write(out.slice(12)), 10);
    return;
  }
  if (msg.method === 'fail') {
    send({ id: msg.id, error: { code: 'ERR_HOST_BAD_REQUEST', message: 'bad request from fake' } });
    return;
  }
  if (msg.method === 'slow') { return; }
  if (msg.method === 'crash') { process.exit(3); }
  if (msg.method === 'shutdown') { send({ id: msg.id, result: {} }); process.exit(0); }
  send({ id: msg.id, result: { method: msg.method } });
});
`;

const clients: AdapterHostClient[] = [];

function createClient(overrides: AdapterHostClientOptions = {}): AdapterHostClient {
  const client = new AdapterHostClient({
    hostPath: process.execPath,
    hostArgs: ['-e', FAKE_HOST_SCRIPT],
    mockCliPath: null,
    repoRoot: null,
    timeouts: { default: 2000 },
    ...overrides,
  });
  clients.push(client);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)));
});

describe('adapter host NDJSON framing', () => {
  it('buffers partial lines, handles CRLF, and skips blank lines', () => {
    const first = splitNdjsonLines('', '{"a":1}\n{"b"');
    expect(first.lines).toEqual(['{"a":1}']);
    expect(first.rest).toBe('{"b"');

    const second = splitNdjsonLines(first.rest, ':2}\r\n\n{"c":3}\n');
    expect(second.lines).toEqual(['{"b":2}', '{"c":3}']);
    expect(second.rest).toBe('');
  });
});

describe('adapter host binary resolution', () => {
  const repoRoot = path.resolve('fixture-repo');
  const resourcesRoot = path.join(repoRoot, 'resources');
  const platform = process.platform;

  it('prefers OSMIUM_ADAPTER_HOST over dev and packaged paths', () => {
    const envHost = path.join(repoRoot, 'vendor', adapterHostBinaryName(platform));
    const resolution = resolveAdapterHostBinary({
      env: { OSMIUM_ADAPTER_HOST: envHost } as NodeJS.ProcessEnv,
      repoRoot,
      resourcesPath: resourcesRoot,
      platform,
      exists: () => true,
    });
    expect(resolution.source).toBe('env');
    expect(resolution.path).toBe(path.resolve(envHost));
    expect(resolution.candidates.map((candidate) => candidate.source)).toEqual([
      'env',
      'dev-debug',
      'dev-release',
      'resources',
    ]);
  });

  it('falls back to target/debug, then target/release, then packaged resources', () => {
    const devDebug = path.join(repoRoot, 'target', 'debug', adapterHostBinaryName(platform));
    const devRelease = path.join(repoRoot, 'target', 'release', adapterHostBinaryName(platform));
    const packaged = path.join(resourcesRoot, adapterHostBinaryName(platform));

    expect(
      resolveAdapterHostBinary({
        env: {} as NodeJS.ProcessEnv,
        repoRoot,
        resourcesPath: resourcesRoot,
        platform,
        exists: (candidate) => candidate === devDebug,
      }).source,
    ).toBe('dev-debug');

    expect(
      resolveAdapterHostBinary({
        env: {} as NodeJS.ProcessEnv,
        repoRoot,
        resourcesPath: resourcesRoot,
        platform,
        exists: (candidate) => candidate === devRelease,
      }).source,
    ).toBe('dev-release');

    const packagedResolution = resolveAdapterHostBinary({
      env: {} as NodeJS.ProcessEnv,
      repoRoot,
      resourcesPath: resourcesRoot,
      platform,
      exists: (candidate) => candidate === packaged,
    });
    expect(packagedResolution.source).toBe('resources');
    expect(packagedResolution.path).toBe(packaged);

    expect(
      resolveAdapterHostBinary({
        env: {} as NodeJS.ProcessEnv,
        repoRoot,
        resourcesPath: resourcesRoot,
        platform,
        exists: () => false,
      }),
    ).toMatchObject({ path: null, source: 'none' });
  });

  it('resolves the dev mock CLI from target/debug', () => {
    const mockPath = path.join(repoRoot, 'target', 'debug', mockCliBinaryName(platform));
    expect(resolveMockCliPath({ repoRoot, platform, exists: (c) => c === mockPath })).toBe(
      mockPath,
    );
    expect(resolveMockCliPath({ repoRoot, platform, exists: () => false })).toBeNull();
  });
});

describe('AdapterHostClient request/response', () => {
  it('matches responses by id and reassembles a split line', async () => {
    const client = createClient();
    expect(client.resolvedHostPath).toBe(process.execPath);
    expect(client.diagnostics.mockCliPath).toBeNull();

    await expect(client.ping()).resolves.toEqual({ ok: true, version: 'fake-1.0.0' });
    await expect(client.request('split')).resolves.toEqual({ value: 42 });
    expect(client.isRunning).toBe(true);
  });

  it('rejects host error responses with the host error code', async () => {
    const client = createClient();
    const error = await client.request('fail').catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AdapterHostError);
    expect((error as AdapterHostError).code).toBe('ERR_HOST_BAD_REQUEST');
    expect((error as AdapterHostError).message).toBe('bad request from fake');
  });

  it('times out unanswered requests', async () => {
    const client = createClient({ timeouts: { default: 120 } });
    await expect(client.request('slow')).rejects.toMatchObject({ code: 'ERR_HOST_TIMEOUT' });
  });

  it('rejects pending requests on host exit and respawns on the next request', async () => {
    const client = createClient();
    await expect(client.request('crash')).rejects.toMatchObject({ code: 'ERR_HOST_EXITED' });
    expect(client.isRunning).toBe(false);
    await expect(client.ping()).resolves.toMatchObject({ ok: true });
    expect(client.isRunning).toBe(true);
  });

  it('emits typed sessionEvent and sessionEnded notifications', async () => {
    const client = createClient();
    const events: SessionEventPayload[] = [];
    const ended: string[] = [];
    const notifications = new Promise<void>((resolve) => {
      client.on('sessionEvent', (payload) => {
        events.push(payload);
      });
      client.once('sessionEnded', ({ sessionId }) => {
        ended.push(sessionId);
        resolve();
      });
    });

    await client.request('notify');
    await notifications;

    expect(events).toEqual([
      { sessionId: 's-1', event: { type: 'status', state: 'working' } },
      {
        sessionId: 's-1',
        event: { type: 'message', role: 'assistant', text: 'legacy', final: true },
      },
    ]);
    expect(ended).toEqual(['s-1']);
  });

  it('close() sends shutdown, stops the child, and still allows a later respawn', async () => {
    const client = createClient();
    await client.ping();
    expect(client.isRunning).toBe(true);

    await client.close();
    expect(client.isRunning).toBe(false);

    await expect(client.ping()).resolves.toMatchObject({ ok: true });
    await client.close();
  });
});
