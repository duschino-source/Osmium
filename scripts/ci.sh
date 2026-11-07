#!/usr/bin/env bash
set -euo pipefail

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

echo "==> [1/5] Building workspace packages and desktop app..."
pnpm build

echo "==> [2/5] Running strict TypeScript typecheck..."
pnpm typecheck

echo "==> [3/5] Running ESLint and Prettier check..."
pnpm lint
pnpm format:check

echo "==> [4/5] Running Vitest unit & integration tests..."
pnpm test

echo "==> [5/5] Running Playwright Electron smoke tests..."
pnpm test:e2e

echo "==> CI pipeline completed successfully!"
