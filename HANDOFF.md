# OsmiumIDE (Osmium) — Master AI Handoff & Architecture Guide

> **Target Audience**: The next AI coding assistant / orchestrator continuing the OsmiumIDE project.  
> **Repository**: [https://github.com/duschino-source/Osmium](https://github.com/duschino-source/Osmium)  
> **Current Date / Local Time**: November 2026  
> **Status**: **Phase 0 Complete & Verified**. Ready to begin **Phase 1 (One CLI, One Chat)**.

---

## 1. Executive Summary & Project Identity

**OsmiumIDE** (working title: *Osmium* or *OsmiumIDE*, formerly *Conductor*) is a calm, light-green desktop IDE and multi-CLI orchestrator built on **Electron**, **React 19**, **strict TypeScript**, and **Vite**.

It allows developers to connect the coding CLIs they already pay for (OpenAI Codex CLI, Google Antigravity, DeepSeek CLI, and others) into one desktop workbench:
- **No API keys anywhere**: Official CLIs run as local child processes; each CLI manages its own login, tokens, and billing.
- **Everyday IDE**: Monaco editor workbench, lazy file explorer, integrated terminals (`node-pty` + xterm.js), ripgrep search, and git source control with inline hunk review.
- **Pre-Turn Git Checkpoints**: Working tree snapshots under `refs/osmium/checkpoints/<id>` before every agent turn, providing instant, exact Undo without polluting user git branches.
- **`/teamwork` Multi-CLI Orchestrator**: The primary CLI splits a high-level goal into structured tasks; tasks run in isolated git worktrees (`.osmium/worktrees/`) assigned across CLIs, followed by diff review and clean integration.
- **Quota Fallback**: When a CLI subscription hits its limit, work moves smoothly to the next secondary CLI.
- **100% Local-First**: Project configuration lives in `.osmium/project.yaml`, data in a local SQLite database (`.osmium/osmium.db`). No telemetry or cloud account required.

---

## 2. Non-Negotiable Rules

1. **Official CLIs only, run as child processes**: Never read, copy, store, or forward login tokens, cookies, or credentials.
2. **No API key required anywhere in the app**.
3. **Local first**: Project data lives in `.osmium/` within the repository and a local SQLite database.
4. **Default approval mode is `ask`**: Full-auto only if explicitly configured for that project.
5. **Strict write boundary**: The app never writes outside the project root or its own worktrees (`.osmium/worktrees/`).
6. **Cross-platform**: Linux, macOS, and Windows supported. All file path utilities and E2E scripts must handle Windows paths and headless Linux environments.
7. **CSS variable design tokens**: All colors, radii, and spacing are defined as CSS variables in `packages/ui/src/tokens.css` (soft-green palette: ground `#F6F8F5`, sidebar `#EAF1E8`, border `#D2DFD0`, ink `#1B2B22`, accent `#2F6B4F`, with full `[data-theme="dark"]` token swap).

---

## 3. Current Repository State & What Is Already Done

### Phase 0: Complete, Tested, and Verified
The repository has been scaffolded and reviewed. All gates pass:
- **`pnpm run build`**: Builds all workspace packages and desktop app.
- **`pnpm run typecheck`**: Strict TypeScript (`tsc -p tsconfig.json --noEmit`) passes with zero errors across all packages.
- **`pnpm run lint`**: ESLint 9 flat config passes with zero warnings or errors.
- **`pnpm run format:check`**: Prettier formatting checked and enforced.
- **`pnpm test`**: 26 Vitest unit and integration tests passing.
- **`pnpm test:e2e`**: Playwright Electron smoke test launches the real application under `xvfb-run` on headless Linux, validating UI geometry (216px sidebar), CSS variables, bundled fonts, and DOM elements against the design spec (`Home.png`).
- **`pnpm run ci`**: Complete pipeline script (`scripts/ci.sh`) executes all 5 stages cleanly.
- **Clean clone verification**: Tested in an isolated directory (`/tmp/conductor-clean`) from a fresh clone with `--frozen-lockfile`.

### Review Fixes Applied in Phase 0
- **Code/Chat toggle**: Fixed active state logic so clicking either mode updates `aria-pressed` and styles correctly, defaulting to `Code` as depicted in `Home.png`.
- **Honest UI Copy**: Replaced hardcoded "Three CLIs connected" subtitle with neutral copy, as detection belongs to Phase 1 and no real CLIs are installed locally.
- **Prettier & CI**: Reformatted all source files, made CSS token tests case- and quote-insensitive, and added `format:check` to `scripts/ci.sh`.
- **Cross-Platform E2E**: Created `scripts/run-e2e.mjs` which wraps in `xvfb-run -a` only when running headless on Linux without `$DISPLAY`, allowing smooth execution on macOS and Windows.
- **Design Assets**: Reference PNGs preserved in `docs/design/`.

---

## 4. Host Machine & CLI Reality Check

Before implementing any adapter, **do not assume or guess CLI behavior**:
- Host OS: Debian GNU/Linux 12 (bookworm) x86_64, user `antigravity`.
- **Installed Tools**:
  - `node`: `v24.22.2`
  - `pnpm`: `12.18.0`
  - `git`: `2.39.5`
  - `rg` (ripgrep): `13.0.0`
  - `sqlite3`: `3.40.1`
  - `gcc` / `g++`: `12.2.0`
  - `xvfb-run` (virtual framebuffer for headless Electron execution)
- **Real CLIs Probe Results**:
  - `codex`: **NOT INSTALLED**
  - `antigravity`: **NOT INSTALLED**
  - `deepseek`: **NOT INSTALLED**
- **Testing Strategy**:
  - `packages/mock-cli` is the fully-functional, deterministic mock CLI used for all local development, integration, and E2E tests. It supports streaming chat, tool calls, file edits, stdin approval prompts, simulated quota errors, `/plan`, `/review`, and `/teamwork` scenarios.
  - Real CLI adapters (`codex`, `antigravity`, `deepseek`) must gracefully handle `installed: false` on machines where they are absent, and must verify their parser logic against recorded real CLI fixtures located in `packages/adapters/<cli>/fixtures/`.

---

## 5. Monorepo Structure & Key Files

```
Osmium/
├── apps/
│   └── desktop/
│       ├── package.json               # @osmium/desktop (productName: OsmiumIDE)
│       ├── tsconfig.json              # Renderer TS config
│       ├── tsconfig.main.json         # Main & preload TS config
│       ├── vite.config.ts             # Vite build for React renderer
│       └── src/
│           ├── main/index.ts          # Electron main process (1200x720 window, IPC)
│           ├── preload/index.ts       # contextBridge exposing window.osmium
│           ├── renderer/
│           │   ├── App.tsx            # Main application shell matching Home.png
│           │   ├── main.tsx           # React root mounting App with tokens.css
│           │   └── index.html         # HTML entry with <title>OsmiumIDE</title>
│           └── __tests__/             # App shell unit tests
├── packages/
│   ├── core/
│   │   ├── src/types.ts               # CliId, CliAdapter, AgentSession, AgentEvent, etc.
│   │   ├── src/schemas.ts             # Zod schemas (ProjectConfigSchema with .passthrough())
│   │   └── src/index.ts               # Public exports
│   ├── ide-core/
│   │   ├── src/ipc-types.ts           # Typed IPC contracts (IpcChannelMap, OsmiumBridge)
│   │   └── src/index.ts               # Public exports
│   ├── adapters/
│   │   ├── src/index.ts               # CliAdapter re-exports, CLI colors, version warnings
│   │   └── src/__tests__/             # Color palette & adapter utility tests
│   ├── ui/
│   │   ├── src/tokens.css             # CSS variables & local @font-face Inter WOFF2
│   │   ├── src/fonts/                 # Bundled Inter-Regular, Medium, SemiBold, Bold
│   │   ├── src/components.tsx         # CliBadge, Button, Card, Composer, SlashCommandMenu, etc.
│   │   └── src/__tests__/             # Design token & component tests
│   └── mock-cli/
│       ├── src/index.ts               # Subprocess mock CLI logic & scenario definitions
│       ├── src/cli.ts                 # CLI entry point
│       └── src/__tests__/             # Deterministic scenario tests
├── docs/
│   ├── PLAN.md                        # Master build plan
│   ├── PROGRESS.md                    # Living progress log (update every session!)
│   ├── HANDOFF.md                     # This document
│   └── design/                        # Reference design screenshots (Home, Session, etc.)
├── e2e/
│   ├── phase0-smoke.spec.ts           # Playwright smoke test verifying shell launch
│   ├── runner.mjs                     # 4-tier E2E runner
│   └── suite/                         # Tier 1-4 pre-scaffolded test suites
├── scripts/
│   ├── ci.sh                          # 5-step CI verification script
│   └── run-e2e.mjs                    # Cross-platform Playwright runner
├── package.json                       # Monorepo root
├── pnpm-workspace.yaml                # Monorepo workspace configuration
├── tsconfig.base.json                 # Shared strict TypeScript base config
├── eslint.config.js                   # ESLint 9 flat configuration
├── .prettierrc                        # Prettier configuration
└── vitest.config.ts                   # Vitest root configuration
```

---

## 6. How to Run & Verify Everything

```bash
# 1. Install dependencies
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install

# 2. Build all packages and the desktop app
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm run build

# 3. Strict TypeScript typechecking across all packages
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm run typecheck

# 4. ESLint check
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm run lint

# 5. Prettier formatting check
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm run format:check

# 6. Unit & integration tests
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm test

# 7. Playwright Electron smoke test (works on Linux/macOS/Windows)
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm test:e2e

# 8. Full end-to-end CI pipeline
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm run ci
```

---

## 7. Roadmap & Detailed Instructions for Phase 1 (Next Step)

**Your immediate goal is Phase 1: One CLI, One Chat.**  
Do not jump ahead to Phase 2 or Phase 5 until Phase 1 is complete and passes all checks.

### Requirements for Phase 1:
1. **CLI Detection & Capabilities Service (`packages/adapters`)**:
   - Probe system `PATH` for installed CLIs (`codex`, `antigravity`, `deepseek`, and the built-in `mock`).
   - Implement `detect(): Promise<CliDetectionResult>` and `capabilities(): Promise<Capabilities>` for each adapter.
   - Cache capabilities per CLI version.
   - If an untested newer version of a CLI is found, surface a non-blocking warning rather than an error.
2. **CLI Hub Screen (`apps/desktop`)**:
   - Accessible via the sidebar "CLI Hub" button or `connect-cli-chip`.
   - Displays a row for each CLI with: name, colored dot badge, installed status, version, capabilities list, a "Test" button, and tested-version warnings.
3. **Mock Adapter & Codex Adapter**:
   - `packages/adapters/src/mock.ts`: Wraps `packages/mock-cli` implementing `CliAdapter` and `AgentSession`.
   - `packages/adapters/src/codex.ts`: Implements the real Codex CLI adapter. On machines where Codex is absent, `detect()` returns `{ installed: false }`. Provide documented findings and fixtures in `docs/adapters/codex.md` and `packages/adapters/codex/fixtures/`.
4. **SQLite Session & Event Persistence (`packages/core`)**:
   - Use `better-sqlite3` to store sessions and their event log in `.osmium/osmium.db`.
   - Tables: `sessions` (id, project_id, title, cli_id, created_at, updated_at) and `session_events` (id, session_id, seq, timestamp, type, payload_json).
5. **Chat UI (`apps/desktop`)**:
   - Render streaming assistant messages, tool call lines (in muted text `#566A5E`), file-edit cards, and error states.
   - Cancel button to abort an ongoing turn.
   - Restoring a session from SQLite reproduces the exact conversation history.
6. **Acceptance Criteria for Phase 1**:
   - A full chat session works with the `mock` CLI (streaming text, tool call, final message).
   - Cancel interrupts a long-running turn cleanly.
   - History survives an app restart (loaded from SQLite).
   - `pnpm run ci` passes with zero type, lint, format, test, or smoke test failures.
   - Section 10 Report written in `docs/PROGRESS.md`.

---

## 8. Definition of Done & Reporting Format (Section 10)

At the conclusion of Phase 1 (and every subsequent phase), verify all gates and output a formal report matching the Section 10 structure:
1. **Done**: What works now.
2. **Not done**: Anything skipped or partial, and why.
3. **Decisions**: Architectural or design choices made during the phase.
4. **Problems**: Bugs, risks, or unknowns encountered.
5. **How to run and test it**: Concrete commands.
6. **Next**: What the next phase will do.

Update `docs/PROGRESS.md` with this report before concluding the session.

Good luck! You have a pristine, fully-tested foundation to build upon.
