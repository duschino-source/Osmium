#!/usr/bin/env bash
set -euo pipefail

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

echo "==> [1/5] Building workspace packages and desktop app..."
pnpm build

echo "==> [2/5] Running strict TypeScript typecheck..."
pnpm typecheck

echo "==> [3/6] Running ESLint, Prettier, and UI base-rules checks..."
pnpm lint
pnpm format:check
node scripts/check-ui-rules.mjs

echo "==> [4/6] Running Vitest unit & integration tests..."
pnpm test

echo "==> [5/6] Running Playwright Electron smoke tests..."
echo "==> [6/6] UI rules gate passed (screenshot gate: node scripts/shoot-ui.mjs, manual per DESIGN.md)"
pnpm test:e2e

echo "==> CI pipeline completed successfully!"
