# Osmium (Argon 4) — E2E Test Infrastructure & Contract Specification (`TEST_INFRA.md`)

## 1. Overview & Philosophy

This document defines the requirement-driven, opaque-box **4-Tier End-to-End (E2E) Test Suite** for **Osmium (Argon 4 Desktop IDE & Multi-CLI Orchestrator)**.

The suite covers all **24 features (`F01`–`F24`)** defined in `/home/antigravity/PROJECT.md § Feature Inventory` and `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md`:
- **Tier 1 — Feature Coverage (`120` test cases)**: `5` happy-path test cases per feature across all `24` features (`T1-F01-01` .. `T1-F24-05`).
- **Tier 2 — Boundary & Corner Cases (`120` test cases)**: `5` edge, boundary, and negative test cases per feature across all `24` features (`T2-F01-01` .. `T2-F24-05`).
- **Tier 3 — Cross-Feature Combinations (`24` test cases)**: `24` pairwise integration test cases verifying interactions across multiple features (`T3-PW-01` .. `T3-PW-24`).
- **Tier 4 — Real-World Application Scenarios (`12` scenarios)**: `12` comprehensive end-to-end workflows from Section 9 of `ORIGINAL_REQUEST.md` (`T4-SC-01` .. `T4-SC-12`).
- **Total**: **`276` concrete E2E test cases**.

---

## 2. Directory Layout & Exclusive File Ownership

```text
/home/antigravity/
├── TEST_INFRA.md                           # This infrastructure & contract specification
├── TEST_READY.md                           # Published test readiness & feature-to-test matrix
└── e2e/
    ├── runner.mjs                          # Main CLI test runner entrypoint
    └── suite/
        ├── helpers/
        │   ├── t1-harness.mjs              # Workspace bridge & real git/sqlite/rg/process helpers for Tier 1
        │   ├── t2-harness.mjs              # Workspace bridge & boundary/fault-injection helpers for Tier 2
        │   └── t34-harness.mjs             # Multi-feature & end-to-end workflow orchestration helpers for Tiers 3 & 4
        ├── tier1/
        │   ├── f01-f12.mjs                 # Tier 1 tests for Features 1..12 (60 tests)
        │   └── f13-f24.mjs                 # Tier 1 tests for Features 13..24 (60 tests)
        ├── tier2/
        │   ├── f01-f12.mjs                 # Tier 2 tests for Features 1..12 (60 tests)
        │   └── f13-f24.mjs                 # Tier 2 tests for Features 13..24 (60 tests)
        ├── tier3/
        │   └── pairwise.mjs                # Tier 3 cross-feature pairwise tests (24 tests)
        └── tier4/
            └── scenarios.mjs               # Tier 4 real-world application scenarios (12 scenarios)
```

---

## 3. Runner Invocation & CLI Flags (`/home/antigravity/e2e/runner.mjs`)

```bash
# Run all 276 tests across Tiers 1, 2, 3, and 4
node e2e/runner.mjs

# Run a specific tier (1, 2, 3, or 4)
node e2e/runner.mjs --tier=1
node e2e/runner.mjs --tier=2
node e2e/runner.mjs --tier=3
node e2e/runner.mjs --tier=4

# Filter by feature number (1..24) or test ID prefix (e.g. T1-F08, T3-PW-01, T4-SC-06)
node e2e/runner.mjs --feature=8
node e2e/runner.mjs --filter=T4-SC-06

# List all registered tests and verify counts per tier and feature without executing
node e2e/runner.mjs --list

# Output structured JSON summary report
node e2e/runner.mjs --json

# Enforce strict workspace module resolution (used in Milestone 5 when all M1-M4 packages are built)
node e2e/runner.mjs --strict-workspace
```

### Exit Codes
- `0`: All selected tests executed and passed (`failed === 0` and `total > 0`).
- `1`: One or more tests failed, or no tests matched the filter.

---

## 4. Standard Test Module Export Contract

Every test file under `e2e/suite/tier{1,2,3,4}/*.mjs` MUST export a named array `export const tests = [...]` where each element conforms to:

```javascript
export const tests = [
  {
    id: 'T1-F01-01',              // Unique ID string
    tier: 1,                      // Integer: 1 | 2 | 3 | 4
    feature: 1,                   // Primary feature number (1..24)
    features: [1],                // Array of feature numbers (1..24) exercised by this test
    title: 'docs/PLAN.md exists and preserves the Argon 4 build plan sections',
    async fn(ctx = {}) {
      // Must perform real operations and throw an Error (or node:assert failure) on mismatch.
    }
  }
];
```

### Naming Conventions for Test IDs
- **Tier 1**: `T1-F<NN>-<MM>` where `<NN>` is zero-padded feature `01`..`24` and `<MM>` is `01`..`05` (e.g., `T1-F01-01` .. `T1-F24-05`, total 120).
- **Tier 2**: `T2-F<NN>-<MM>` where `<NN>` is zero-padded feature `01`..`24` and `<MM>` is `01`..`05` (e.g., `T2-F01-01` .. `T2-F24-05`, total 120).
- **Tier 3**: `T3-PW-<NN>` where `<NN>` is `01`..`24` (total 24).
- **Tier 4**: `T4-SC-<NN>` where `<NN>` is `01`..`12` (total 12).

---

## 5. Progressive Workspace Binding & Real System Verification

The E2E suite is designed to run progressively from Milestone 1 through Milestone 5:

1. **Dynamic Workspace Package Resolution**:
   Each harness (`t1-harness.mjs`, `t2-harness.mjs`, `t34-harness.mjs`) resolves modules from `/home/antigravity`:
   - `packages/mock-cli` (`bin/mock-cli.js`, `dist/index.js`, `src/index.ts`, or `src/cli.ts`)
   - `packages/ui` (`src/tokens.css`, `src/index.ts`, `dist/index.js`)
   - `packages/core` (`src/types.ts`, `src/schemas.ts`, `src/index.ts`, `dist/index.js`)
   - `packages/adapters` (`src/index.ts`, `dist/index.js`, `mock`, `codex`, `antigravity`, `deepseek`, `sdk`)
   - `packages/ide-core` (`src/ipc-types.ts`, `src/index.ts`, `dist/index.js`)
   - `apps/desktop` (`src/main`, `src/preload`, `src/renderer`, `electron-builder.yml`)
   - `docs/PLAN.md`, `docs/PROGRESS.md`, `docs/ROADMAP.md`, `docs/adapters/*.md`

2. **Real System Execution (Zero Dummy Assertions)**:
   Every test executes real OS-level operations in isolated temporary directories (`/tmp/osmium-e2e-*`, cleaned up after each test):
   - **Real Git Plumbing**: Spawns `/usr/bin/git` to create repositories, branches (`osmium/integration`), checkpoints under `refs/osmium/checkpoints/<id>` via `GIT_INDEX_FILE` + `git write-tree` + `git commit-tree` + `git update-ref`, worktrees under `.osmium/worktrees/<task-id>`, diffs, hunk staging/applying, blame, stash, and 3-way conflict detection/resolution.
   - **Real SQLite Storage**: Uses `better-sqlite3` (if installed in workspace `node_modules`) or `/usr/bin/sqlite3` CLI against real SQLite database files (`.osmium/osmium.db`) with the schema for `projects`, `sessions`, `session_events`, `checkpoints`, `teamwork_runs`, `teamwork_tasks`, `cli_usage`, and `workspace_layout`.
   - **Real Ripgrep Search**: Spawns `/usr/bin/rg` for streaming regex, case-sensitive, whole-word, and glob-filtered searches across real directory trees.
   - **Real Child Processes**: Spawns `/usr/local/bin/node` child processes for `mock-cli` and CLI adapters over stdout/stdin pipes.

3. **Workspace Binding vs. Progressive Contract Execution**:
   - Whenever a workspace package/file exists in `/home/antigravity/packages/*` or `/home/antigravity/apps/desktop/*`, the harness loads and tests the workspace implementation directly.
   - When `--strict-workspace` is passed (or when `OSMIUM_E2E_STRICT=1` is set in Milestone 5), every test requires its corresponding workspace package in `/home/antigravity/packages/*` and `/home/antigravity/apps/desktop/*` to exist on disk and fails immediately if any workspace module is missing.
