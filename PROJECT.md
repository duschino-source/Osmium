# Project: Osmium (Argon 4 Desktop IDE & Multi-CLI Orchestrator)

## Architecture

Osmium is a local-first desktop IDE and multi-CLI orchestrator built with **Electron, React, TypeScript (strict), and Vite** in a `pnpm` monorepo. It connects to official coding CLIs that developers already subscribe to (`codex`, `antigravity`, `deepseek`, plus a deterministic `mock-cli` for testing and an extensible Adapter SDK) as child processes without ever touching provider tokens, cookies, or API keys.

### Layered Architecture (Bottom to Top)
1. **Adapters (`packages/adapters`)**: One folder per CLI (`mock`, `codex`, `antigravity`, `deepseek`, `sdk`), implementing `CliAdapter` and emitting normalized `AgentEvent` streams over ACP, JSON/headless stream, or `node-pty` with `{ type: 'raw', data }` fallback.
2. **Core Orchestrator & Storage (`packages/core`)**:
   - **SQLite Storage (`better-sqlite3`)**: Persists projects, sessions, event logs, git checkpoints, teamwork runs/tasks, CLI usage, and workspace layouts.
   - **Session Manager**: Starts, resumes, cancels, and records sessions; builds mid-session handoff summaries (`systemContext`) when switching CLIs; enforces interactive approvals (`ask`, `auto-edit`, `full-auto`).
   - **Pre-Turn Checkpoints**: Snapshots the working tree before every agent turn using git plumbing (`GIT_INDEX_FILE` temp index + `git write-tree` + `git commit-tree` + `git update-ref refs/osmium/checkpoints/<id>`), never touching the user's branch. Undo restores the exact tree.
   - **Teamwork Orchestrator**: Planner (`zod`-validated task graph with retry + raw fallback), Router (rules / manual / primary), Worktree Manager (`.osmium/worktrees/<task-id>` branched from `osmium/integration` with out-of-scope edit detection), Scheduler (`maxParallel` + dependency DAG + SQLite restart recovery), and Merge Manager (diff review, merge into `osmium/integration`, conflict detection & CLI assignment).
   - **Quota & Usage Tracker**: Tracks turns run and limit-hit timestamps strictly from CLI events; supports automatic or prompted fallback to `next-secondary` CLI.
3. **IDE Core Services (`packages/ide-core`)**:
   - Main-process IDE workbench services behind typed IPC and a unified **Command Registry**: Workspace & File Service (lazy tree for 10,000+ files, `.gitignore` & git status awareness, `chokidar` watcher, disk-conflict guard, large-file safe mode), Ripgrep Search & Replace Service (`rg`), System Git & Inline Hunk Service (file/hunk stage/unstage/accept/reject, commit, branches, history, blame, stash, 3-way merge conflict resolver), Terminal Service (`node-pty` + shell profiles + `Fix this error`), LSP Manager (detects installed servers, never installs silently), Tasks & DAP Debugger (Node & Python), Layout/Settings/Keybindings Manager, and Extension Loader (`~/.osmium/extensions/<name>/osmium.json` + VS Code theme/keybinding/snippet importers).
4. **UI & Desktop App (`packages/ui`, `apps/desktop`)**:
   - Token-driven design system (CSS variables for all colors, radii, spacing; light theme default + dark theme token swap; bundled local `Inter` font).
   - Unified `Chat` (Orchestrator) and `Code` (IDE Workbench) modes matching all 5 reference screenshots (`Home.png`, `Session_with_teamwork_menu.png`, `Teamwork_board.png`, `IDE_workspace_with_agent_panel.png`, `Source_control_and_inline_hunk_review.png`) plus `CLI Hub`.

---

## Feature Inventory

Every feature from the Survey phase is assigned to a milestone below. No feature is left unassigned.

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | `docs/PLAN.md` & `docs/PROGRESS.md` | Copy build plan to `docs/PLAN.md`; maintain `docs/PROGRESS.md` (done, next, decisions, open questions) and phase reports across sessions. | M1, M4, M5 | survey (`ORIGINAL_REQUEST.md` §0, §10, §12) |
| 2 | Child-Process-Only CLI Execution & Zero API Keys | Spawn official CLIs as child processes; never read/store/forward credentials or require API keys. | M1, M2 | survey (`ORIGINAL_REQUEST.md` §2.1–2.2) |
| 3 | Workspace Write Boundary Guard | Enforce that Osmium never writes outside the project root or `.osmium/worktrees/` (plus `~/.osmium/` config/extensions). | M2, M3 | survey (`ORIGINAL_REQUEST.md` §2.5) |
| 4 | CLI Detection, Probing & Version Warnings | Probe CLIs (`--version`, `--help`), document in `docs/adapters/<cli>.md` with fixtures, cache `Capabilities`, warn on untested newer versions. | M2 | survey (`ORIGINAL_REQUEST.md` §4, §5) |
| 5 | Multi-Transport Session Normalization | ACP -> JSON stream -> PTY transport priority emitting normalized `AgentEvent` stream with `{ type: 'raw', data }` fallback. | M2 | survey (`ORIGINAL_REQUEST.md` §4) |
| 6 | `packages/mock-cli` Scripted CLI | Standalone Node script printing scripted events with delays: streamed answer, file edit, approval request, quota error, plan/teamwork/review outputs. | M1 | survey (`ORIGINAL_REQUEST.md` §3, §8 Phase 0, §9) |
| 7 | Session Manager & SQLite Event Log | Start, resume, cancel, close sessions; persist sessions and `AgentEvent` log in SQLite (`better-sqlite3`); survive restarts. | M2 | survey (`ORIGINAL_REQUEST.md` §4.2, §8 Phase 1) |
| 8 | Pre-Turn Git Checkpoints & Undo | Snapshot working tree before every turn under `refs/osmium/checkpoints/<id>` without touching user branch; exact Undo restoration. | M2 | survey (`ORIGINAL_REQUEST.md` §4.3, §8 Phase 2) |
| 9 | `.osmium/project.yaml` Config | Per-project YAML config validated with `zod` `.passthrough()` preserving unknown keys; primary/secondary CLIs, approvalMode, routing, fallback, teamwork. | M1, M2 | survey (`ORIGINAL_REQUEST.md` §6, §8 Phase 3) |
| 10 | Mid-Session CLI Handoff | Switch CLI mid-session; build handoff summary from SQLite event log passed as `systemContext`; render handoff pill line in chat (`● Antigravity ran...`). | M2, M4 | survey (`ORIGINAL_REQUEST.md` §5.5, §8 Phase 3, `Session_with_teamwork_menu.png`) |
| 11 | Interactive Approval Gate | Default `ask` mode blocks execution on `command`/`edit`/`network` approvals until user selects `Allow`, `Deny`, or `Allow for this session`. | M2, M4 | survey (`ORIGINAL_REQUEST.md` §2.4, §8 Phase 2) |
| 12 | Slash Commands (`/plan`, `/review`, `/teamwork`, `/cli`, `/undo`) | Composer `/` parser and popup menu; `/plan` editable checklist before edits; `/review` secondary CLI read-only diff review; `/cli` switch; `/undo` checkpoint restore. | M2, M4 | survey (`ORIGINAL_REQUEST.md` §8 Phase 4, `Session_with_teamwork_menu.png`) |
| 13 | `/teamwork` Planner, Router, Worktrees, Scheduler & Merge | Split goal into `zod`-validated tasks (retry once + raw fallback), route to CLIs, run in `.osmium/worktrees/<task-id>` from `osmium/integration`, warn on out-of-scope edits, respect `maxParallel` & dependencies across restarts, review & merge or assign conflicts. | M2, M4 | survey (`ORIGINAL_REQUEST.md` §1, §8 Phase 5, `Teamwork_board.png`) |
| 14 | Usage Meter & Quota Fallback | Track CLI usage strictly from CLI events (turns run, last limit hit; never invent numbers); move task to `next-secondary` on `limitHit: true`. | M2, M4 | survey (`ORIGINAL_REQUEST.md` §1, §8 Phase 6) |
| 15 | IDE Explorer & File Watcher | Lazy virtualized file tree (10,000+ files), CRUD + drag-and-drop, file icons, git status letters (`M`, `A`), `.gitignore` awareness, real-time watcher. | M3, M4 | survey (`ORIGINAL_REQUEST.md` §13.2, §13.4, `IDE_workspace_with_agent_panel.png`) |
| 16 | Monaco Multi-Tab & Split Editor | Tabs, preview/pinned tabs, split right/down, breadcrumbs, multi-cursor, find/replace, format/auto-save, markdown/image preview, large-file safe mode, tab restore, disk-change conflict guard. | M3, M4 | survey (`ORIGINAL_REQUEST.md` §13.2, `IDE_workspace_with_agent_panel.png`) |
| 17 | Ripgrep Project Search & Replace | Spawned `ripgrep` (`rg`) streaming search with regex, case, whole word, include/exclude globs, and multi-file replace with preview. | M3, M4 | survey (`ORIGINAL_REQUEST.md` §13.2, §13.4) |
| 18 | Integrated Multi-Tab Split Terminal (`node-pty`) | `xterm.js` + `node-pty` terminals with tabs, splits, shell profiles (`bash`, `zsh`, `PowerShell`, `cmd`), clickable paths, and 1-click `Fix this error`. | M3, M4 | survey (`ORIGINAL_REQUEST.md` §2.6, §13.2, §13.3, `IDE_workspace_with_agent_panel.png`) |
| 19 | Source Control & Inline Hunk Review | System `git` changes list, file & inline hunk staging/unstaging, inline hunk review (`Accept`, `Reject`, `Ask to change`, `Accept all`, `Reject all`), commit, branches, history, blame, stash, 3-way merge conflict editor. | M3, M4 | survey (`ORIGINAL_REQUEST.md` §13.2, §13.3, `Source_control_and_inline_hunk_review.png`) |
| 20 | Code Intelligence & LSP Manager | Monaco built-ins (TS/JS/JSON/CSS/HTML) + LSP manager (`typescript-language-server`, `pyright`, `rust-analyzer`, `gopls`, `clangd`) with install hints (never silent install), diagnostics, hover, completion, definition, references, rename, code actions, outline, Problems panel. | M3, M4 | survey (`ORIGINAL_REQUEST.md` §13.2, §13.6 IDE-3) |
| 21 | Docked Agent Panel, Context Chips & Follow Agent | Right-docked Agent panel (`Ctrl/Cmd+L`), `@file`, `@selection`, `@problems`, `@diff`, `@terminal` context chips (auto-attached active file/selection), `Ask`/`Explain`/`Fix` actions, `Follow agent` toggle, CLI-colored dot on agent-edited tabs (`● brief.ts`). | M3, M4 | survey (`ORIGINAL_REQUEST.md` §13.3, `IDE_workspace_with_agent_panel.png`) |
| 22 | Tasks Runner & DAP Debugger | Run scripts from `package.json`; Debug Adapter Protocol (DAP) debugger for Node and Python with breakpoints, call stack, variables, and debug console. | M3, M4 | survey (`ORIGINAL_REQUEST.md` §13.2, §13.6 IDE-4) |
| 23 | Adapter SDK & `~/.osmium/extensions/` API | Documented Adapter SDK + template adapter + contract tests + user-folder loader; `~/.osmium/extensions/<name>/osmium.json` with permission prompt, themes, snippets, LSPs, adapters, commands, sandboxed webviews, and VS Code importers. | M2, M3, M4 | survey (`ORIGINAL_REQUEST.md` §8 Phase 7, §13.5, §13.6 IDE-5) |
| 24 | Design System, Command Registry, Palette, Replay, Dark Theme & Release | CSS variable tokens, bundled `Inter`, Command Registry, Command Palette (`Ctrl/Cmd+K` & `Ctrl/Cmd+Shift+P`), Quick Open (`Ctrl/Cmd+P`), Session Replay timeline, Dark Theme token swap, `electron-builder` packaging, and open-source governance docs. | M1, M3, M4 | survey (`ORIGINAL_REQUEST.md` §7, §8 Phase 6–7, §13.4, §13.7, all 5 PNGs) |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | **M1: Monorepo Scaffold, Design System (`packages/ui`), `packages/mock-cli`, Core Contracts & Docs** | Git init, `docs/PLAN.md` & `docs/PROGRESS.md`, pnpm workspace (`apps/desktop`, `packages/core`, `packages/ide-core`, `packages/adapters`, `packages/ui`, `packages/mock-cli`), strict TS/ESLint/Prettier/Vitest/Playwright/CI script, `packages/mock-cli` with all scripted scenarios, `packages/ui` CSS variable tokens + bundled `Inter` + shared UI components, core types & `zod` schemas in `packages/core` and `packages/ide-core`. | none | IN_PROGRESS (`023efbb1807721e09d989ef22727b3de`) |
| 2 | **M2: CLI Adapters (`packages/adapters`) & Core Orchestrator Engine (`packages/core`)** | CLI Detection & Capability Probing, `docs/adapters/<cli>.md` + fixtures, shared Adapter Contract Test Suite, `mock`/`codex`/`antigravity`/`deepseek` adapters + Adapter SDK & template adapter; `packages/core` SQLite storage, Session Manager, Pre-turn Git Checkpoints (`refs/osmium/checkpoints/`) & Undo, `.osmium/project.yaml` manager, Slash Command Engine (`/plan`, `/review`, `/teamwork`, `/cli`, `/undo`), Teamwork Orchestrator (Planner, Router, Worktrees `.osmium/worktrees/`, Scheduler with restart recovery, Merge & conflict flow), Quota & Usage Tracker. | M1 | PLANNED |
| 3 | **M3: IDE Core Services (`packages/ide-core`)** | Workspace & File Service (lazy tree, CRUD, git status, `.gitignore`, watcher, disk-conflict guard, large-file safe mode), Ripgrep Search & multi-file Replace, System Git & Inline Hunk Service (stage/unstage/accept/reject files & hunks, commit, branches, history, blame, stash, 3-way conflict resolver), Terminal Service (`node-pty` + shell profiles + `Fix this error`), LSP Manager, Tasks & DAP Debugger (Node/Python), Command Registry, Layout/Settings/Keybindings Manager, Extension Loader (`osmium.json` + VS Code importers). | M1 | PLANNED |
| 4 | **M4: Desktop App (`apps/desktop`), All 5 Reference Screens, IPC Integration & Release Packaging** | Electron Main & Preload typed IPC wiring (`packages/core`, `packages/adapters`, `packages/ide-core`); full React/Monaco/xterm Renderer implementing all screens from the 5 reference PNGs (`Home`, `Session` with slash menu & right diff pane, `Teamwork Board`, `CLI Hub`, `IDE Workspace` with activity bar, explorer, Monaco tabs/splits, terminal/problems, docked Agent panel with context chips & `Follow agent`, `#2F6B4F` status bar, `Source Control` with inline hunk review & 3-way merge editor, Command Palette, Quick Open, Replay timeline, Settings, Dark Theme); `electron-builder` config, sample extension/adapter, open-source docs (`README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `docs/ROADMAP.md`, `docs/PROGRESS.md`). | M2, M3 | PLANNED |
| 5 | **M5: Final Milestone — E2E Verification (Tiers 1–4) & Adversarial Coverage Hardening (Tier 5)** | Phase 1: Pass 100% of E2E Test Suite (`TEST_READY.md` Tiers 1–4) across unit, contract, fixture, and Playwright Electron E2E tests under `xvfb-run -a`. Phase 2: White-box Tier 5 adversarial coverage hardening (Challenger -> Worker -> Reviewer loop) and final `docs/PROGRESS.md` + Section 10 report verification. | M4, E2E Track | PLANNED |
| E2E | **E2E Testing Track (`e2e_test_orch`)** | Requirement-driven opaque-box E2E test infrastructure (`TEST_INFRA.md`) and 4-tier test suite (`e2e/`) covering all 24 inventoried features (>=120 test cases across Tiers 1–4); publishes `TEST_READY.md`. | M1 | IN_PROGRESS (`552df6fa6cdf7d10ea044754918a9331`) |

---

## Interface Contracts

### 1. Core Adapter & Session Contract (`packages/core/src/types.ts`)
```typescript
export type CliId = 'codex' | 'antigravity' | 'deepseek' | 'mock' | (string & {});

export interface Capabilities {
  acp: boolean;
  jsonStream: boolean;
  resume: boolean;
  approvals: boolean;
  readOnlyMode: boolean;
  reportsUsage: boolean;
  testedVersion?: string;
}

export interface CliDetectionResult {
  installed: boolean;
  version?: string;
  path?: string;
  versionWarning?: string;
}

export interface CliAdapter {
  id: CliId;
  displayName: string;
  detect(): Promise<{ installed: boolean; version?: string; path?: string; versionWarning?: string }>;
  capabilities(): Promise<Capabilities>;
  start(opts: StartOptions): Promise<AgentSession>;
}

export interface StartOptions {
  cwd: string;
  approvalMode: 'ask' | 'auto-edit' | 'full-auto';
  resume?: string;
  systemContext?: string;
  readOnly?: boolean;
}

export interface AgentSession {
  id: string;
  events: AsyncIterable<AgentEvent>;
  send(prompt: string, attachments?: string[]): Promise<void>;
  respondToApproval(id: string, allow: boolean, scope?: 'once' | 'session'): Promise<void>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}

export type AgentEvent =
  | { type: 'message'; role: 'assistant' | 'user'; text: string; final: boolean }
  | { type: 'tool'; id: string; name: string; status: 'running' | 'done' | 'error'; summary?: string; durationSec?: number }
  | { type: 'file-edit'; path: string; added: number; removed: number }
  | { type: 'approval'; id: string; kind: 'command' | 'edit' | 'network'; detail: string }
  | { type: 'usage'; limitHit?: boolean; note?: string }
  | { type: 'status'; state: 'idle' | 'working' | 'waiting' | 'error'; message?: string }
  | { type: 'raw'; data: string };
```

### 2. Project Config & Planner Schemas (`packages/core/src/schemas.ts`)
- `ProjectConfigSchema`: Validates `.osmium/project.yaml` (`version: 1`, `name`, `primary`, `secondary`, `approvalMode`, `routing`, `fallback.onQuotaHit`, `teamwork.maxParallel`, `teamwork.integrationBranch`) using `.passthrough()` at every object level so unknown keys are preserved when reading and writing.
- `TeamworkPlanSchema`: Validates planner output (`goal`, `tasks: [{ id, title, description, scope, dependencies, taskType, assignedCli }]`).

### 3. Typed IPC Contract (`packages/ide-core/src/ipc-types.ts`)
- Exposed on `window.osmium` via Electron `contextBridge.exposeInMainWorld('osmium', ...)`.
- Namespaces:
  - `window.osmium.cli`: `detectAll()`, `detect(id)`, `test(id)`, `getCapabilities(id)`, `getUsage()`
  - `window.osmium.session`: `start(opts)`, `send(sessionId, prompt, attachments)`, `cancel(sessionId)`, `respondToApproval(sessionId, approvalId, allow, scope)`, `switchCli(sessionId, targetCliId)`, `runSlashCommand(sessionId, commandText)`, `approvePlan(sessionId, planId, items)`, `list(projectId)`, `getEvents(sessionId)`, `onEvent(cb)`
  - `window.osmium.checkpoint`: `create(sessionId, cwd)`, `undo(checkpointId)`, `getDiff(checkpointId)`, `list(sessionId)`
  - `window.osmium.project`: `open(rootPath)`, `list()`, `getConfig(rootPath)`, `saveConfig(rootPath, config)`
  - `window.osmium.teamwork`: `plan(projectId, goal)`, `startRun(projectId, plan)`, `getRun(runId)`, `listRuns(projectId)`, `reassignTask(taskId, cliId)`, `retryTask(taskId, cliId)`, `mergeTask(taskId)`, `resolveConflictWithCli(taskId, cliId)`, `onStateChange(cb)`
  - `window.osmium.ide`: `readTree(rootPath, relPath)`, `readFile(filePath)`, `writeFile(filePath, content, expectedMtimeMs)`, `createEntry(targetPath, kind)`, `renameEntry(oldPath, newPath)`, `deleteEntry(targetPath)`, `moveEntry(srcPath, destPath)`, `search(opts)`, `replaceAcrossFiles(opts)`, `gitStatus(cwd)`, `gitDiff(cwd, filePath)`, `gitStageFile(cwd, filePath)`, `gitUnstageFile(cwd, filePath)`, `gitHunkAction(cwd, filePath, hunkIndex, action)`, `gitCommit(cwd, message)`, `gitBranches(cwd)`, `gitCheckout(cwd, branch)`, `gitBlame(cwd, filePath)`, `gitStash(cwd, action)`, `gitConflictThreeWay(cwd, filePath, resolution)`, `terminalCreate(opts)`, `terminalWrite(id, data)`, `terminalResize(id, cols, rows)`, `terminalClose(id)`, `lspStatus(cwd)`, `lspRequest(cwd, method, params)`, `tasksList(cwd)`, `tasksRun(cwd, scriptName)`, `dapStart(cwd, config)`, `dapCommand(sessionId, cmd, args)`, `extensionsList()`, `extensionsInstall(src)`, `importVsCode(kind, filePath)`, `executeCommand(id, ...args)`, `listCommands()`, `getLayout(projectId)`, `saveLayout(projectId, layout)`, `getSettings()`, `saveSettings(settings)`

---

## Code Layout

Exclusive file write-ownership boundaries per milestone/track:

```text
/home/antigravity/
├── package.json                  # M1 (created), M2/M3/M4 (only if adding scripts, sequential after M1)
├── pnpm-workspace.yaml           # M1
├── tsconfig.base.json            # M1
├── eslint.config.js              # M1
├── .prettierrc                   # M1
├── vitest.config.ts              # M1
├── playwright.config.ts          # M1 / E2E Track
├── electron-builder.yml          # M4
├── scripts/
│   └── ci.sh                     # M1
├── docs/
│   ├── PLAN.md                   # M1
│   ├── PROGRESS.md               # M1 (initialized), updated at end of each milestone
│   ├── ROADMAP.md                # M4
│   └── adapters/                 # M2 (codex.md, antigravity.md, deepseek.md, README.md)
├── packages/
│   ├── mock-cli/                 # M1 (exclusive ownership)
│   ├── ui/                       # M1 (exclusive ownership; M4 may extend components)
│   ├── core/                     # M1 (types.ts, schemas.ts), M2 (full implementation & unit tests)
│   ├── adapters/                 # M1 (index.ts stub), M2 (full implementation, fixtures & contract tests)
│   └── ide-core/                 # M1 (ipc-types.ts), M3 (full implementation & unit tests)
├── apps/
│   └── desktop/                  # M1 (initial shell), M4 (full application, IPC wiring, all screens)
├── examples/
│   └── extensions/               # M4 (sample theme & sample language server extension)
├── e2e/                          # E2E Testing Track (Tiers 1-4 test suite) & M5 (Tier 5 hardening)
├── TEST_INFRA.md                 # E2E Testing Track
└── TEST_READY.md                 # E2E Testing Track
```
