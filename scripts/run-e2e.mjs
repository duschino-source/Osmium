#!/usr/bin/env node
// Cross-platform Playwright launcher: wraps in `xvfb-run -a` only on Linux
// when no display is available, so the same command works on Windows and macOS.
import { spawnSync } from 'node:child_process';

const args = ['playwright', 'test', ...process.argv.slice(2)];
// Some agent shells inherit ELECTRON_RUN_AS_NODE=1; Electron would then run the
// main entry as plain Node instead of an app.
delete process.env.ELECTRON_RUN_AS_NODE;
const needsXvfb =
  process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;

const [cmd, cmdArgs] = needsXvfb ? ['xvfb-run', ['-a', 'npx', ...args]] : ['npx', args];
const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: process.platform === 'win32' });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
