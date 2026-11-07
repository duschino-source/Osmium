#!/usr/bin/env node
import { runCliFromProcess } from './index.js';

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
