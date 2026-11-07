# OsmiumIDE (Osmium) — Progress Tracker (`docs/PROGRESS.md`)

> Read this file at the start of every session and update it at the end. A fresh session must be able to resume from this file alone.

---

## Current Status: Phase 0 (M1 — Scaffold) Complete — reviewed by orchestrator, awaiting owner sign-off before Phase 1

### Session log
- **2026-11-07, session 1**: The worker team scaffolded Phase 0, then stopped when it hit its model quota before the review gates. The orchestrator then reviewed the work and fixed:
  - Code/Chat toggle: the active state was inverted (Code was always highlighted). Now driven by state with `aria-pressed`; defaults to Code to match `Home.png`. Regression test added.
  - Home subtitle claimed "Three CLIs connected" while none are installed or detected. Replaced with neutral copy until Phase 1 detection exists.
  - Prettier was failing on 11 files; reformatted, and `format:check` added to `scripts/ci.sh` (plus a `pnpm format` script). Token tests made case- and quote-insensitive.
  - `test:e2e` hard-coded `xvfb-run` (Linux-only, breaks Windows/macOS). Replaced with `scripts/run-e2e.mjs`, which wraps in xvfb only on headless Linux.
  - Docs said `pnpm ci`, which is a pnpm built-in rather than our script. Corrected to `pnpm run ci`.
  - Reference screenshots copied to `docs/design/`; `upload/` and root PNGs are git-ignored.
- **2026-11-07, session 2 (Owner integration)**:
  - Connected remote GitHub repository `https://github.com/duschino-source/Osmium`.
  - Merged remote `origin/main` integrating `LICENSE` (GNU General Public License v3.0, selected by owner) and initializing `README.md`.
  - Renamed working project identity to **OsmiumIDE** (or Osmium): updated Electron window title, `index.html` title, `package.json` package names and `productName: OsmiumIDE`, `README.md`, `docs/PLAN.md`, and `docs/PROGRESS.md`.
  - Authored comprehensive `README.md` and complete AI writeoff/handoff guide in `docs/HANDOFF.md` and `HANDOFF.md` at repository root.
  - Pushed all commits to GitHub repository `origin/main`.
- `e2e/runner.mjs` + `e2e/suite/` hold the E2E test track (tiers 1–4) the team wrote ahead of time for later phases. Not run in CI yet; they are enabled phase by phase as features land. `PROJECT.md`, `TEST_INFRA.md` and `TEST_READY.md` at the repo root are the team's planning notes.

### What Is Done
- **Repository & Documentation**:
  - Initialized git repository on branch `main` in `/home/antigravity` with `.gitignore`.
  - Created `docs/PLAN.md` from the authoritative build plan.
  - Created and maintained `docs/PROGRESS.md` with session state, CLI probe findings, decisions, open questions, and the Section 10 report.
- **Monorepo & Toolchain**:
  - Configured `pnpm-workspace.yaml` with `apps/*` and `packages/*` (`apps/desktop`, `packages/core`, `packages/ide-core`, `packages/adapters`, `packages/ui`, `packages/mock-cli`).
  - Configured strict TypeScript (`tsconfig.base.json` with `"strict": true`), ESLint 9 flat config (`eslint.config.js`), Prettier (`.prettierrc`), Vitest (`vitest.config.ts`), Playwright (`playwright.config.ts`), and `scripts/ci.sh`.
- **Core Contracts & Schemas (`packages/core`, `packages/ide-core`, `packages/adapters`)**:
  - Implemented `CliId`, `Capabilities`, `CliDetectionResult`, `CliAdapter`, `StartOptions`, `AgentSession`, and `AgentEvent` in `packages/core/src/types.ts`.
  - Implemented `ProjectConfigSchema` (with `.passthrough()` at every object level + YAML parse/stringify helpers preserving unknown keys), `RoutingRuleSchema`, `PlannedTaskSchema`, `TeamworkPlanSchema`, and `ExtensionManifestSchema` in `packages/core/src/schemas.ts`.
  - Implemented typed IPC contracts (`OsmiumBridge`, `CommandDefinition`, `IpcChannelMap`) in `packages/ide-core/src/ipc-types.ts`.
  - Implemented adapter contract re-exports and CLI color palette utilities (`DEFAULT_CLI_PALETTE`, `getCliColor`, `createVersionWarning`) in `packages/adapters/src/index.ts`.
- **`packages/mock-cli`**:
  - Implemented standalone Node script (`packages/mock-cli/src/index.ts` and `src/cli.ts`, compiled to `dist/index.js` and `dist/cli.js`) supporting `--version`, `--help`, `--scenario`, `--delay`, `--cwd`, `--write-file`, `--json`, and `--prompt`.
  - Supports deterministic scenarios: `chat` (streamed assistant chunks + tool call + final message), `edit` (`file-edit` event + optional disk edit), `approval` (`command`/`edit`/`network` approval blocking on stdin `allow`/`deny`), `quota` (`usage` event with `limitHit: true`), `/plan`, `/review`, and `/teamwork` (4-task JSON plan across `codex`, `antigravity`, and `deepseek`).
- **`packages/ui` (Design System & Bundled Inter Font)**:
  - Bundled local `Inter` WOFF2 font files (`Inter-Regular.woff2`, `Inter-Medium.woff2`, `Inter-SemiBold.woff2`, `Inter-Bold.woff2`) in `packages/ui/src/fonts/` with `@font-face` declarations in `packages/ui/src/tokens.css` (zero remote CDN calls).
  - Defined all Section 7 & Section 13 CSS variable tokens (`--bg-ground: #F6F8F5`, `--bg-sidebar: #EAF1E8`, `--bg-ide-panel: #F0F5EE`, `--bg-surface: #FFFFFF`, `--border-default: #D2DFD0`, `--text-ink: #1B2B22`, `--text-muted: #566A5E`, `--accent-primary: #2F6B4F`, `--bg-diff-add: #E3F3E2`, `--bg-diff-remove: #F8E4E4`, `--bg-accent-subtle: #DCEBD9`, `--cli-codex: #1B2B22`, `--cli-antigravity: #2F5FD0`, `--cli-deepseek: #6B4FD0`, radii `8px`/`12px`/`14px`, layout variables, and `[data-theme="dark"]` token overrides).
  - Built accessible React components (`CliBadge` always rendering colored dot + name, `Button`, `Card`, `Composer`, `EditedFilesCard`, `SlashCommandMenu`, `ApprovalPrompt`, `ContextChip`).
- **`apps/desktop` Phase 0 App Shell & E2E Smoke Test**:
  - Built Electron main process (`1200x720` default window, `960x600` min), preload (`window.osmium` bridge), and React/Vite renderer (`apps/desktop/src/renderer/App.tsx`) matching `Home.png`.
  - Added Playwright Electron smoke test (`e2e/phase0-smoke.spec.ts`) verifying window launch, design tokens, `216px` sidebar, bundled `Inter` font, CLI badges, composer, slash command menu trigger, and quick-start buttons under `xvfb-run -a`.

---

### Machine CLI Probe Results (Section 5)
Probed `PATH` (`/opt/antigravity/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`) on this Linux host (`Debian GNU/Linux 12 (bookworm)` x86_64):
- `codex`: **NOT INSTALLED** (`which codex` -> not found)
- `antigravity`: **NOT INSTALLED** (`which antigravity` -> not found; `/opt/antigravity/bin` contains only plugin helper scripts `gcalendar`, `gdocs`, `gdrive`, `gh`, `gsheets`, `gslides`)
- `deepseek`: **NOT INSTALLED** (`which deepseek` -> not found)
- `git`: Installed (`/usr/bin/git`, version `2.39.5`)
- `rg` (ripgrep): Installed (`/usr/bin/rg`, version `13.0.0`)
- `sqlite3`: Installed (`/usr/bin/sqlite3`, version `3.40.1`)
- `node`: Installed (`/usr/local/bin/node`, version `v24.22.2`)
- `pnpm`: Installed (`/usr/local/bin/pnpm`, version `12.18.0` via Corepack)

Because none of `codex`, `antigravity`, or `deepseek` are installed on this machine, `packages/mock-cli` serves as the live executable CLI for end-to-end verification, while real CLI adapters in Phase 1 / Phase 3 will record `installed: false` on this host and test parser logic via fixtures and contract tests.

---

### What Is Next
- **Milestone 2 (Phases 1–6 Backend — `packages/adapters` & `packages/core`)**:
  - Implement CLI Detection & Capability Probing service, `docs/adapters/{codex,antigravity,deepseek,README}.md`, and fixtures.
  - Implement shared Adapter Contract Test Suite and `mock`, `codex`, `antigravity`, `deepseek` adapters + Adapter SDK & template adapter.
  - Implement SQLite storage (`better-sqlite3`), Session Manager, Pre-turn Git Checkpoints (`refs/osmium/checkpoints/<id>`) & Undo, `.osmium/project.yaml` manager, Slash Command Engine (`/plan`, `/review`, `/teamwork`, `/cli`, `/undo`), Teamwork Orchestrator (Planner, Router, `.osmium/worktrees/`, Scheduler with restart recovery, Merge & conflict flow), and Quota & Usage Tracker.
- **Milestone 3 (IDE-1 to IDE-5 Backend — `packages/ide-core`)**:
  - Implement Workspace & File Service, Ripgrep Search & Replace, System Git & Inline Hunk Service, Terminal Service (`node-pty`), LSP Manager, Tasks & DAP Debugger, Command Registry, Layout/Settings/Keybindings Manager, and Extension Loader (`~/.osmium/extensions/<name>/osmium.json` + VS Code importers).
- **Milestone 4 (`apps/desktop` Full Screens, IPC Wiring & Packaging)**:
  - Wire all main/preload IPC handlers and build all 5 reference screens (`Home`, `Session`, `Teamwork Board`, `IDE Workspace`, `Source Control & Inline Hunk Review`) plus `CLI Hub`, Command Palette, Replay Timeline, Dark Theme, `electron-builder.yml`, and open-source governance docs.

---

### Decisions Made
1. **Include `packages/ide-core` in Phase 0 Monorepo Layout**: Per Section 13 ("This section extends sections 3, 7 and 8. Where they conflict, this section wins") and Section 13.4, `packages/ide-core` is scaffolded alongside `packages/core`, `packages/adapters`, `packages/ui`, `packages/mock-cli`, and `apps/desktop` from day one.
2. **Bundled Local `Inter` Font via `@fontsource/inter` WOFF2 Assets**: Copied `Inter` `.woff2` font files (weights 400, 500, 600, 700) into `packages/ui/src/fonts/` and declared local `@font-face` rules in `packages/ui/src/tokens.css` so no external font CDN is ever contacted.
3. **Zod v3 (`^3.24.2`) with Deep `.passthrough()`**: Used Zod v3 `.passthrough()` on `ProjectConfigSchema`, `RoutingRuleSchema`, `fallback`, and `teamwork` objects paired with the `yaml` package so unknown keys at both root and nested levels in `.osmium/project.yaml` are preserved on load and save.
4. **Headless Linux Electron Execution**: Configured Playwright Electron launch and `test:e2e` script to run under `xvfb-run -a` with `--no-sandbox` and `--disable-gpu` so Electron launches deterministically in a headless container environment.

---

### Open Questions (For Project Owner, per Section 11 & Section 13.7)
1. **Final Product Name**: Confirm whether to keep the working name **Osmium** or adopt another release name.
2. **Open-Source License**: Choose between `Apache-2.0` and `MIT` before the first public release commit (Section 13.7).
3. **Open-Source Timing**: Confirm whether to open-source from the start or after v1 stabilization.
4. **Additional CLIs**: Confirm which coding CLIs beyond Codex CLI, Antigravity, and DeepSeek CLI should be prioritized next in the Adapter SDK catalog.

---

## Section 10 Report — Phase 0 (Scaffold)

### 1. Done
- Created `docs/PLAN.md` and `docs/PROGRESS.md`.
- Initialized the `pnpm` monorepo (`pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json` with `"strict": true`, `eslint.config.js`, `.prettierrc`, `vitest.config.ts`, `playwright.config.ts`, and `scripts/ci.sh`).
- Built `packages/core` (Section 4 TypeScript interfaces and Section 6 / Phase 5 / Section 13.5 `zod` schemas with `.passthrough()` preservation of unknown YAML keys).
- Built `packages/ide-core` (typed IPC channel contracts and Command Registry types).
- Built `packages/adapters` (adapter contract re-exports, fixed CLI color palette, and version-warning helper).
- Built `packages/mock-cli` (standalone executable Node CLI emitting deterministic scripted events with configurable delays for streamed chat messages, tool calls, file edits, interactive approvals over stdin, simulated quota limit errors, `/plan`, `/review`, and `/teamwork`).
- Built `packages/ui` (CSS variable design tokens matching Section 7 & Section 13, dark theme token overrides, locally bundled `Inter` `.woff2` fonts, and accessible React primitives: `CliBadge`, `Button`, `Card`, `Composer`, `EditedFilesCard`, `SlashCommandMenu`, `ApprovalPrompt`, `ContextChip`).
- Built `apps/desktop` Phase 0 App Shell (Electron main/preload + React/Vite renderer matching `Home.png`: `216px` `#EAF1E8` sidebar with `Code | Chat` toggle, navigation items, `PROJECTS` with CLI color dots, `RECENT` sessions, footer links, centered Home view with CLI status chips, large composer with `/` slash command menu popup, and quick-start buttons).
- Added unit tests across all packages and Playwright Electron smoke test (`e2e/phase0-smoke.spec.ts`).

### 2. Not done
- Phases 1–7 and IDE-1–5 runtime implementations (CLI detection & CLI Hub, SQLite persistence, git checkpoints, Monaco workbench, ripgrep search, source control hunk review, `/teamwork` worktree scheduler, quota fallback, and packaging) are intentionally deferred to Milestones 2–4 per Section 0 and Section 12 ("Work only on Phase 0 in this session... Do not start Phase 1").

### 3. Decisions
- Scaffolded `packages/ide-core` in Phase 0 alongside the Section 3 packages so typed IPC contracts exist from the start.
- Bundled local `Inter` `.woff2` font files directly inside `packages/ui/src/fonts/` to guarantee offline-first rendering without network requests.
- Configured `onlyBuiltDependencies` in `pnpm-workspace.yaml` so native modules (`electron`, `better-sqlite3`, `node-pty`, `esbuild`, `@parcel/watcher`) build cleanly under `pnpm` v12.

### 4. Problems
- Host environment has no active `$DISPLAY` by default; resolved by running Playwright Electron tests via `xvfb-run -a` and passing `--no-sandbox` / `--disable-gpu` to Electron in headless test mode.
- Host machine probe (Section 5) confirmed that `codex`, `antigravity`, and `deepseek` CLIs are not installed on this machine; mitigated via `packages/mock-cli` and recorded in `docs/PROGRESS.md`.

### 5. How to run and test it
```bash
# Install workspace dependencies
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install

# Build all packages and the desktop app
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm build

# Run strict TypeScript typechecking across all packages
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm typecheck

# Run ESLint across the monorepo
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm lint

# Run Vitest unit & integration tests
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm test

# Run Playwright Electron smoke test under Xvfb
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm test:e2e   # wraps in xvfb-run automatically on headless Linux

# Run the full CI pipeline (build + typecheck + lint + test + test:e2e)
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm run ci
```

### 6. Next
- Proceed to Phase 1 / Milestone 2 (`packages/adapters` and `packages/core`): CLI detection service, CLI Hub, `mock` and `codex` adapters with probe documentation & fixtures, SQLite event persistence (`better-sqlite3`), checkpoints (`refs/osmium/checkpoints/`), and multi-CLI orchestration.
