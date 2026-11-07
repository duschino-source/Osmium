#!/usr/bin/env node
/* global process, setTimeout */
// Synthetic DeepSeek CLI used by crates/adapters tests.
//
// This is NOT a recording of the real DeepSeek CLI. No real binary was
// available on the development host, so this fixture exists to exercise the
// adapter's process, transport, capability and lifecycle code paths. It
// deliberately rejects every argument the adapter did not derive from
// `--help`, which is how the tests prove that no invented flags are passed.

import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const finish = async (code) => {
  await sleep(10);
  process.exit(code);
};

// A cancelled `.cmd` turn closes the Rust-side pipe before the Node child is
// necessarily killed. Keep ticking instead of dying on EPIPE so the
// process-tree test can tell "killed" from "orphaned".
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

const rawArgs = process.argv.slice(2);
let profile = 'minimal';
const profileIndex = rawArgs.indexOf('--fake-profile');
if (profileIndex !== -1) {
  profile = rawArgs[profileIndex + 1] ?? 'minimal';
  rawArgs.splice(profileIndex, 2);
}

const fixtureDir = import.meta.dirname;
const readFixture = (name) =>
  fs.readFileSync(path.join(fixtureDir, name), 'utf8').replace(/\r\n/g, '\n');

if (rawArgs.includes('--version')) {
  process.stdout.write(readFixture('version.txt').trimEnd() + '\n');
  await finish(0);
}

if (rawArgs.includes('--help')) {
  process.stdout.write(readFixture(`help-${profile}.txt`).trimEnd() + '\n');
  await finish(0);
}

let json = false;
let resume = null;
let readOnly = false;
for (let i = 0; i < rawArgs.length; i += 1) {
  const arg = rawArgs[i];
  if (arg === '--json') {
    json = true;
  } else if (arg === '--resume') {
    resume = rawArgs[i + 1] ?? null;
    i += 1;
  } else if (arg === '--read-only') {
    readOnly = true;
  } else {
    process.stderr.write(`fake-deepseek: unsupported argument ${arg}\n`);
    await finish(2);
  }
}

// The adapter closes stdin after writing the composed prompt (system context
// and attachment paths included). Reading to EOF proves the transport.
const prompt = fs.readFileSync(0, 'utf8');
fs.writeFileSync(path.join(process.cwd(), '.fake-spawned'), prompt);
fs.writeFileSync(path.join(process.cwd(), '.fake-pid'), String(process.pid));

const writeJson = (event) => process.stdout.write(JSON.stringify(event) + '\n');
const writeLine = (text) => {
  if (json) writeJson({ type: 'raw', data: text });
  else process.stdout.write(text + '\n');
};
const emitIdle = async () => {
  if (json) writeJson({ type: 'status', state: 'idle' });
  await sleep(10);
};

const envReport = ['DEEPSEEK_API_KEY', 'DEEPSEEK_SESSION_TOKEN']
  .map((key) => `${key}=${process.env[key] ? 'present' : 'absent'}`)
  .join(';');

if (resume) writeLine(`RESUME=${resume}`);
if (readOnly) writeLine('READ_ONLY=1');
if (json) writeJson({ type: 'status', state: 'working' });

if (prompt.includes('REPORT_ENV')) {
  writeLine(`ENV ${envReport}`);
  await emitIdle();
  await finish(0);
}

if (prompt.includes('ECHO_MARKER')) {
  const text = `STDIN_BEGIN${prompt}STDIN_END`;
  if (json) writeJson({ type: 'message', role: 'assistant', text, final: true });
  else process.stdout.write(text + '\n');
  await emitIdle();
  await finish(0);
}

if (prompt.includes('SLOW')) {
  writeLine('slow turn started');
  for (let i = 0; i < 300; i += 1) {
    await sleep(100);
    writeLine(`tick ${i}`);
  }
  await finish(0);
}

if (prompt.includes('FAIL')) {
  if (json) writeJson({ type: 'message', role: 'assistant', text: 'about to fail', final: true });
  else process.stdout.write('about to fail\n');
  await finish(3);
}

const fixture = json ? 'stream-json.ndjson' : 'plain-output.txt';
const lines = readFixture(fixture)
  .split('\n')
  .filter((line) => line.trim() !== '');
for (const line of lines) {
  process.stdout.write(line + '\n');
  await sleep(10);
}

await finish(0);
