# Qwen Continuation Prompt — OsmiumIDE (IDE-1 Completion)

You are taking over **OsmiumIDE** at `E:\SeriousProject\Osmium` on Windows.
This is not a greenfield task. The project is a working Electron + React 19 +
TypeScript (strict) + Vite monorepo with a Rust workspace under `crates/`.
The previous session ended at commit **`30edce9`** on `main`, pushed to
`https://github.com/duschino-source/Osmium`.

Your job is to take the **IDE workbench from “demo-complete” to genuinely
usable**, following `docs/PLAN.md` **IDE-1**, without breaking the adapter
bridge, settings, branding, or design system that already work. Do not redo
the UI revamp. Do not invent CLI behavior. Do not fake terminal, LSP, or
debugger output.

Read this entire prompt before touching code, then audit, plan, implement,
verify, and report.

---

## 0. Hard mission

**Primary mission — finish PLAN.md IDE-1:**

> “Workbench: layout manager, explorer with file operations and watcher,
> editor tabs and splits, quick open, command palette, settings, status bar,
> session restore. Done when a real project can be opened, edited, saved and
> restored after a restart without data loss.” — `docs/PLAN.md`

The store, command palette, settings, tabs, search, source control, and a
custom text editor already exist. The missing/weak pieces are:

1. **Real terminal** — the current Terminal panel is a command/log surface,
   not an xterm + node-pty terminal.
2. **Explorer file lifecycle** — create works; rename/delete/move do not have
   UI, and there is no live filesystem watcher.
3. **Quick Open and Go to Line** — absent.
4. **Open Folder / workspace selection** — the app currently starts from
   `process.cwd()`; there is no folder picker or recent-project flow.
5. **Session restore** — tabs/layout/session do not survive restart.
6. **Editor reliability** — the editor is a custom textarea, not Monaco;
   find/replace, quick open, splits, and editor-level polish are missing.
7. **LSP/Problems** — typed IPC shapes exist, but no manager/panel.
8. **Keybindings/settings polish** — settings persist, but keybindings are
   not editable and format-on-save is conservative.
9. **Packaging** — the adapter host is not packaged as an Electron resource.

**Secondary mission (only after every primary gate is green):** wire the
existing Rust session/checkpoint/storage layer (`crates/core`) into the app
so sessions/events persist to SQLite and pre-turn git checkpoints work.
That is M2 work, not IDE-1; do not let it destabilize the IDE.

**Explicitly out of scope unless the primary mission is complete and green:**
Codex/Antigravity adapter verification, teamwork orchestration, extension
marketplace, Cloud/telemetry, and any provider HTTP API.

---

## 1. Read first, in this order

1. `AGENTS.md` — mandatory gate.
2. `DESIGN.md` — canonical visual rules; §1 bans, §2 tokens, §5 gates.
3. `PRODUCT.md` — product intent and constraints.
4. `docs/PLAN.md` — architecture, transport preference, IDE-1..IDE-5
   definitions, Windows requirements, definition of done.
5. `docs/PROGRESS.md` — current state and session history. It is the
   resumable source of truth.
6. `docs/ADAPTER_BRIDGE.md` — Rust sidecar ↔ Electron protocol. Do not break it.
7. `docs/adapters/deepseek.md` — the truth standard for CLI probing.
8. `packages/core/src/types.ts` — shared domain contract.
9. `packages/ide-core/src/ipc-types.ts` — `OsmiumBridge`, settings, IDE IPC.
10. `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`,
    `apps/desktop/src/main/adapter-host.ts`, `apps/desktop/src/main/settings-store.ts`.
11. `apps/desktop/src/renderer/App.tsx`, `SessionView.tsx`, `CliHubView.tsx`,
    `BrandMark.tsx`.
12. `packages/ui/src/ide/IdeWorkbench.tsx`, `EditorWorkspace.tsx`,
    `FileExplorer.tsx`, `TerminalPanel.tsx`, `StatusBar.tsx`,
    `SettingsPanel.tsx`; `packages/ui/src/tokens.css`, `workbench.css`.
13. `crates/core/src/{types,session,storage,checkpoint,teamwork}.rs`,
    `crates/adapters/src/**`, `crates/adapter-host/src/**`,
    `crates/mock-cli/src/**`.

Do not edit anything before you can state what each of these does.

---

## 2. Current snapshot — verified at commit `30edce9`

### Architecture

```text
Renderer (React 19, apps/desktop/src/renderer)
  │  window.osmium.* typed bridge
  ▼
Preload (contextBridge, contextIsolation: true)
  │  ipcRenderer.invoke
  ▼
Electron main (apps/desktop/src/main)
  │  AdapterHostClient: NDJSON over stdin/stdout
  ▼
osmium-adapter-host (Rust, crates/adapter-host)
  │  crates/adapters
  ▼
Codex / Antigravity / DeepSeek / osmium-mock-cli child processes
```

A separate TypeScript layer (`packages/ide-core`) provides file, search,
git, terminal, and IPC services. The renderer talks to it only through typed
IPC. The renderer must never spawn processes.

### What already works

- **Phase 0 / M1** scaffold + full Xcode-grade UI revamp; both light and dark.
- **Rust adapters**: Mock and DeepSeek are implemented and tested; DeepSeek
  has honest probe-derived capabilities, stdin prompt transport, an Osmium
  approval gate, cancellation, process-tree kill, and env scrubbing.
- **Rust sidecar**: `crates/adapter-host` exposes detection, start/send/
  approval/cancel/close and streams `AgentEvent`s over NDJSON. Protocol doc:
  `docs/ADAPTER_BRIDGE.md`. Notifications use `data` for the AgentEvent:
  `{"event":"sessionEvent","sessionId":"…","data":{…}}`.
- **Electron main**: `AdapterHostClient` resolves/spawns the host, buffers
  NDJSON, matches ids, times out, respawns, kills the tree on quit. Real
  `cli:*` and `session:*` IPC. In-memory session/event log.
- **Chat**: real CLI detection chips, CLI Hub, streamed session transcript,
  approvals, cancel/new-chat, raw-output fallback, composer in the session.
- **Settings**: Light/Dark/System, Blue/Teal/Forest/Graphite accent palettes,
  reading size, sidebar visibility, default approval, auto-save,
  format-on-save, telemetry opt-in. Persisted to `userData/settings.json`
  via `SettingsStore` (whitelisted).
- **IDE shell**: explorer (create only), tabs, search, git panel, terminal
  command surface, docked agent launcher, status bar, command palette,
  settings activity, collapsible navigation sidebar (`Ctrl+B`).
- **Branding**: owner-supplied mark; Chat title is **Osmium**, IDE title is
  **OsmiumIDE**; app icon/favicon/packaging assets exist.
- **Build**: `pnpm build` builds `osmium-adapter-host` + `osmium-mock-cli`
  first, then TS packages and Electron. `pnpm dev` does the same then launches.

### Verified baseline (do not regress)

| Command | Baseline |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm format:check` | clean |
| `pnpm test` | 14 files / 77 tests passed |
| `pnpm build` | exit 0 |
| `pnpm test:e2e` | 1 passed |
| `node scripts/check-ui-rules.mjs` | clean |
| `cargo test -p osmium-adapters -p osmium-adapter-host` | 121 passed |
| `cargo test -p osmium-core` | 31 passed |
| `node scripts/shoot-ui.mjs` | Code/Home/Session/Approval/CLI Hub/Settings × 3 sizes × light/dark |

### Environment facts

- Windows host. `codex.cmd` 0.160.0 is installed and detected; the Codex
  adapter is **detection-only/unverified** and its `start` still uses
  mock-era flags. Do not claim it works.
- `deepseek` is **not installed**; no real binary has ever been available.
  DeepSeek remains honestly “not installed”; fixtures/fake CLI only.
- `agy.exe` may exist under `%LOCALAPPDATA%\agy\bin`, but the Antigravity
  adapter is not verified and is detection-only.
- The **Mock CLI** is the verified end-to-end demo path.
- `node-pty`, `@xterm/xterm`, `monaco-editor`, `better-sqlite3`, `chokidar`
  are already in root dependencies. `prettier` is a dev dependency.

---

## 3. Rules you must not break

### Security / CLI truth

1. **Zero API keys.** The app never reads, stores, logs, or forwards provider
   credentials. Never call a provider HTTP API as a substitute for a CLI.
   Child processes only. `crates/adapters/src/env.rs` scrubs forbidden env
   vars; keep that path intact and test it if you touch spawning.
2. **Never invent CLI behavior.** Probe the real binary (`--version`,
   `--help`, subcommands) and record it. A capability you have not seen
   working is `false`. DeepSeek’s truth rules in `docs/adapters/deepseek.md`
   are the model.
3. **No fake data in production UI.** If a feature cannot be real
   (terminal, LSP, debugger), show an honest unavailable/install-hint state,
   not simulated output. Mock CLI is allowed for tests/demos.
4. **No zombies.** Cancel/close must kill child process trees (Windows
   `taskkill /T /F`), reap with timeouts, and never leave orphan Node/CLI
   processes.
5. **Windows first-class:** `.exe/.cmd/.bat` resolution, CRLF, paths with
   spaces, ConPTY quirks, process-tree kill. `find_in_path` already prefers
   runnable `.exe/.cmd/.bat` and only accepts extensionless PE files.

### UI / design

1. Read `DESIGN.md` before any UI change. It outranks habit and screenshots.
2. No emoji/glyph icons; use `packages/ui/src/ide/Icon.tsx`.
3. No hardcoded colors in `.tsx` or `workbench.css`; colors only in
   `tokens.css` (and `--brand-mark-*` logo exception).
4. One tint per palette; no gradients/glow/glass everywhere; no second
   simultaneous accent.
5. Preserve every `data-testid`, ARIA role, and keyboard behavior. If a
   change genuinely changes a contract, update the test and say so.
6. Use existing `.xc-*`, `.os-*`, `.ed-*`, `.wb-*`, `.app-*` classes and
   `tokens.css` variables. New UI surface = tokens/classes, both themes,
   light/dark screenshot review.
7. Before calling UI done: `node scripts/check-ui-rules.mjs` and
   `node scripts/shoot-ui.mjs`; inspect the images. Do not allowlist
   violations.

### Contracts / code

1. Preserve public names: `DeepSeekAdapter`, `with_binary_path`,
  `builtin_adapters()`, `getCliCssVariable`, `SessionView`, `CliHubView`,
  `IdeWorkbench`, `SettingsPanel`, etc.
2. The Rust and TS `AgentEvent` contracts already differ in representation
   (push `mpsc` receiver vs `AsyncIterable`; `SessionSummary.status` is
   narrower than `AgentEvent.status.state`). Do not “fix” this by breaking
   either side; keep the bridge mapping explicit.
3. Renderer must not runtime-import `@osmium/ide-core`: its index re-exports
   Node-only services and Vite will externalize `node:*` (this already
   caused a production build failure once). Import **values** from
   `@osmium/core`, or **types only** from `@osmium/ide-core`.
4. `vite.config.ts` sets `publicDir` to `apps/desktop/public` because the
   Vite root is `src/renderer`. Keep favicon/window icon copying working.
5. Build order matters: Rust host/mock first, then TS. `pnpm build` does it.
6. Do not commit `target/`, `dist/`, `.agents/`, `test-results/`,
   `node_modules/`, `electron_debug.log`, `.perch/`, or stray debug scripts.
7. Do not commit test artifacts such as the old
   `crates/adapters/src/routes/compare.ts` (created by a mock file-edit test).
   Run tests with cwd-aware fixtures or clean them.

---

## 4. Known traps and lessons (read these twice)

- **`ELECTRON_RUN_AS_NODE=1`** may be inherited in agent shells. Electron
  then runs main as Node and `require('electron')` returns the npm shim.
  `scripts/shoot-ui.mjs` and `scripts/run-e2e.mjs` delete it; keep that.
  If `pnpm dev` fails this way in your shell, unset it first.
- **Settings persistence is real.** The screenshots/e2e can open in a
  persisted dark/forest profile. E2E forces light/blue tokens around the
  design assertion and restores them; do not remove that determinism.
- **Screenshot gate drives the real Settings UI** for theme selection
  because setting only `data-theme` races the async settings load. Keep that
  pattern if you touch themes.
- **`@osmium/ide-core` is Node-only at runtime** (file/search/git/terminal
  services, `node-pty`). See rule 3 above.
- **`settings.json` lives in Electron `userData`.** Tests use a temp store;
  don’t write to the real profile in unit tests.
- **`formatOnSave` is conservative:** JSON pretty-print + trailing whitespace
  + final newline (`apps/desktop/src/renderer/format.ts`), not a language
  formatter. If you add Prettier/TS formatting, decide packaging
  (devDependency vs bundled) and name the change.
- **The docked Agent panel is a launcher** into the Chat session, not a
  second transcript. If you give it a real transcript, do it as a deliberate
  refactor with tests.
- **The current editor is a custom textarea**, not Monaco. A Monaco
  migration is allowed only if you keep all editor tests and the current
  keyboard behavior; otherwise keep the custom editor and report the gap.
- **`pnpm dev` is build+launch, not HMR.** It runs `tsc`, `vite build`, then
  Electron. Restart it after renderer/main changes.
- **Do not re-add** `deepseek chat --json`, `DEEPSEEK_TESTED_VERSION = "1.0.0"`,
  or all-true capabilities. They were false and removed.
- **Windows `.cmd` arguments:** untrusted prompt text must never go on a
  `.cmd` command line; DeepSeek uses stdin for that reason. If you add
  adapters, follow the same rule.
- **`find_in_path`** now resolves npm’s `codex.cmd` instead of the
  extensionless POSIX shim. If detection changes, verify against
  `%APPDATA%\npm\codex.cmd` and keep the probe tests.

---

## 5. The work plan — implement in this order

Do **one phase at a time**. After each phase: run its tests, then the full
gates. Stop and report if a phase cannot be completed honestly.

### Phase 0 — Audit (report first)

1. Run the baseline commands in §2 and record real numbers.
2. Open the app (`pnpm dev`) and inspect: open a real folder, edit/save,
   terminal, explorer, settings, theme palettes, sidebar collapse.
3. Write a short audit: what works, what is fake, what throws, what is
   missing versus IDE-1. Include file/line evidence.
4. Do not write features before this audit.

### Phase 1 — Real terminal (highest value)

Goal: a working terminal tab backed by `node-pty`, rendered with
`@xterm/xterm`, with no fake output and no zombies.

Tasks:
- Add an `XtermTerminal` component (or a real terminal mode in
  `TerminalPanel`) using `@xterm/xterm` and the existing
  `TerminalService` in `packages/ide-core`.
- Wire IPC end to end:
  - `ide:terminalCreate` (cwd, shell profile, cols/rows)
  - `ide:terminalWrite`
  - `ide:terminalResize`
  - `ide:terminalClose`
  - main → renderer `ide:terminalData` stream (already in preload/main)
- Handle ANSI, resize on pane/layout changes, focus, copy/paste, clear,
  terminal tabs, shell profile selection, and `cwd` from the open folder.
- Windows: ConPTY via `node-pty`; `.cmd`/PowerShell profiles; kill/reap.
- If `node-pty` cannot load (native ABI), show a clear unavailable state and
  keep the command/log surface; do **not** fake a shell.
- Tests:
  - Unit for any pure command/CSI handling you add.
  - E2E: open terminal, run `echo osmium-terminal`, assert output appears;
    resize; close; ensure no leftover process (best effort).
  - Keep `terminal-cmd-input` / `terminal-output` testids if the fallback
    surface remains.

Acceptance: terminal is real; closing it kills the PTY; UI shows no fake
lines; both themes; screenshot reviewed.

### Phase 2 — Explorer file lifecycle + watcher

Tasks:
- Add **Rename** and **Delete** row actions (inline rename input; delete
  confirmation), preserving `data-testid` patterns and keyboard access.
- Wire `ide:renameEntry` / `ide:deleteEntry`; refresh the tree and close
  tabs whose files disappear/rename.
- Add **move** only if it is safe and tested.
- Add a workspace watcher (`chokidar` already a dep) in the main process:
  - `ide:watchWorkspace(root)` / `ide:unwatchWorkspace`
  - push `ide:treeChanged` (or similar) to renderer
  - debounce; ignore `node_modules`, `.git`, `dist`, `target`, `.cache`
  - close watchers on window/app quit
- Keep the inline create form and selected-directory targeting.
- Tests: rename/delete handlers (IPC or pure service), watcher event
  filtering/debounce, UI actions.

Acceptance: create/rename/delete all work in a real temp workspace, the tree
refreshes, open tabs reconcile, watcher does not leak, Windows paths/spaces
work.

### Phase 3 — Workspace open + Quick Open + Go to Line

Tasks:
- **Open Folder**:
  - main `dialog.showOpenDialog` handler; persist last root in settings or
    project config; `readTree`/git/search/terminal use that root.
  - renderer menu/composer entry; recent folders; handle no folder.
- **Quick Open** (`Ctrl+P`): flatten the current tree (or use a fast file
  list), fuzzy filter, keyboard navigation, open in a tab. Do not block on
  a 10k-file tree; lazy/stream is acceptable.
- **Go to Line** (`Ctrl+G`): jump the active editor.
- Keep the command palette (`Ctrl+K`) and its existing commands.
- Tests: quick-open filter/navigation, open-folder state, go-to-line.

Acceptance: a real folder can be opened, searched, files opened from Quick
Open, and the app does not assume `process.cwd()`.

### Phase 4 — Session restore + layout

Tasks:
- Persist open tab paths, active tab, sidebar width/visibility, terminal
  visibility/height, and window mode (Code/Chat) per project.
- Restore on restart without losing dirty buffers (dirty buffers need an
  explicit recovery policy; do not silently discard).
- Use `userData` settings or SQLite; choose one and document it.
- Add a “Restore previous session” behavior with a safe default.
- Tests: pure restore-state serialization + App integration where possible.

Acceptance: close/reopen the app with a real project, tabs/layout restore,
no data loss; a dirty buffer is surfaced, not dropped.

### Phase 5 — Editor reliability / Monaco decision

Tasks:
- Fix any editor issues you find in the audit (selection, undo, find,
  multi-cursor, large files, CRLF).
- Add **Find/Replace** if it is missing, at minimum in the current editor.
- **Monaco:** the PLAN wants it. Migrate only if you can:
  - keep Ctrl+S, dirty tabs, tab close, cursor status, reveal/line jumps
  - keep all existing editor tests green
  - avoid bundling Node-only code into the renderer
  - keep the design tokens (`syntax.ts`/`.syn-*` mapping)
  If not, keep the custom editor and report the gap honestly.
- Add keyboard shortcuts: `Ctrl+P`, `Ctrl+G`, `Ctrl+S`, `Ctrl+B`, `Ctrl+,`,
  `Ctrl+K` as applicable; make them discoverable in Settings or Help.

### Phase 6 — LSP / Problems (honest, read-only first)

Tasks:
- Add an `LspServerStatus` detection surface: `typescript-language-server`,
  `pyright`, `rust-analyzer`, etc. **Never install silently.**
- If a server is present, start it per workspace and stream diagnostics;
  otherwise show install hints.
- Problems panel: file/line/message/severity; click jumps to line.
- TypeScript/JavaScript built-ins are acceptable if Monaco is used.
- Do not fake diagnostics or completions. If LSP cannot be completed today,
  ship detection + honest hints and report.

### Phase 7 — Secondary (only if everything above is green)

- Wire Rust `crates/core` session/event persistence to SQLite.
- Pre-turn git checkpoints (`GIT_INDEX_FILE` + `write-tree` +
  `commit-tree` + `refs/osmium/checkpoints/<id>`) before each `send`.
- Undo/restore flow; persist session summaries/events.
- `switchCli`, slash commands, teamwork remain later.
- Codex/Antigravity adapter verification: probe real binaries, fix transport
  (stdin prompt vs legacy mock flags), capabilities honest, tests. Do not
  claim them until measured.

---

## 6. Implementation standards

- **Audit → plan → small commits.** One phase per commit if possible.
- **Tests must fail without the change.** No tests that only assert the code
  says what it says. Fixture tests replay recorded/fake output through the
  real parser.
- **Do not widen scope silently.** If a contract blocks you, stop and report
  the exact type/contract, the options, and the tradeoff.
- **No new UI dependencies** without a `DESIGN.md` amendment. New icons go
  in `Icon.tsx` at 24px/1.6 stroke.
- **Keep the bridge protocol stable.** If you need a new host method, update
  `docs/ADAPTER_BRIDGE.md`, host, client, and tests together.
- **Timeouts on every wait.** No unbounded `recv`, `wait`, or PTY lifecycle.
- **No credentials in logs.** Child stderr is diagnostics; never echo env.
- **Update `docs/PROGRESS.md` at the end** with: what changed, files,
  commands/results, decisions, known gaps, next step. A fresh session must
  resume from it alone.
- **Update `docs/PLAN.md`** only if you materially change the plan; explain
  why.

---

## 7. Verification gates (run all; report real output)

```powershell
# Rust
cargo test -p osmium-adapters -p osmium-adapter-host
cargo test -p osmium-core
cargo build -p osmium-mock-cli

# TypeScript / UI
pnpm typecheck
pnpm lint
pnpm format:check
node scripts/check-ui-rules.mjs

# Tests / build
pnpm test
pnpm build
pnpm test:e2e

# Screenshot gate (review .agents/ui-shots/)
node scripts/shoot-ui.mjs
```

If you touch `packages/core` or `packages/ide-core` contracts, rebuild them
before typechecking the desktop:

```powershell
pnpm --filter @osmium/core build
pnpm --filter @osmium/ide-core build
pnpm --filter @osmium/ui build
pnpm --filter @osmium/desktop build
```

For a live smoke:

```powershell
pnpm dev
```

Then in the app:
1. Code mode → open the explorer → create/rename/delete a file.
2. Open a file → edit → `Ctrl+S` → confirm on disk.
3. Terminal → run `echo osmium` → see real output.
4. Settings → switch Light/Dark/System and a palette; restart; settings
   persist.
5. Sidebar toggle / `Ctrl+B`; reopen.
6. Chat → send a prompt with Mock CLI → stream; approval/cancel.
7. Chat title “Osmium”; IDE title “OsmiumIDE”.

If a real CLI is absent, say “unverified — no binary available”; never
fabricate a live smoke.

---

## 8. Reporting format (use exactly this, at the end)

1. **Baseline audit** — what worked, what was fake/broken, IDE-1 gaps, with
   file/line evidence.
2. **What changed** — file by file, including tests and docs.
3. **Behavior vs IDE-1** — checklist: open folder, edit/save, terminal,
   explorer lifecycle, quick open, settings, session restore, LSP/Problems.
4. **Verified vs assumed** — commands and real outputs; capabilities/features
   you could not verify.
5. **Tests added and why they fail without the change** (mutation or
   reasoning).
6. **Not done / risks / follow-ups** — be blunt; no adjectives in place of
   evidence.
7. **Git state** — commit hash, pushed branch, clean working tree.
8. **`docs/PROGRESS.md` updated** — paste the new entry or summarize it.

---

## 9. Definition of done for this session

- A real folder can be opened; the tree, search, git, terminal, and editor
  use that root.
- Explorer create/rename/delete work; the watcher keeps the tree fresh; no
  leaked watchers.
- The terminal is a real PTY-backed xterm (or an honest unavailable state
  with a documented native-load failure), with no fake output.
- Quick Open and Go to Line work.
- Tabs/layout/theme/sidebar restore after restart; dirty buffers are not
  silently lost.
- Settings persist; Light/Dark/System + four palettes are green in both
  themes; sidebar toggle works.
- No API keys anywhere; no credential logging; no invented CLI behavior.
- All gates in §7 pass, or failures are reported with exact evidence.
- `docs/PROGRESS.md` is updated and the commit is pushed.

If any of these cannot be done safely, **stop at that boundary**, keep the
app green, and report the exact blocker and the smallest next step. A smaller
honest delivery is better than a broken “complete” one.

---

## 10. First actions (do these now)

```powershell
cd E:\SeriousProject\Osmium
git status --short
git log -1 --oneline
pnpm typecheck
pnpm test
cargo test -p osmium-adapters -p osmium-adapter-host
```

Then open `docs/PROGRESS.md`, `docs/PLAN.md` (IDE-1..IDE-5), `DESIGN.md`, and
`AGENTS.md`. Write the Step 0 audit before changing code.

Good luck. Keep it truthful, keep it green, and leave the next session a
repo it can resume from alone.
