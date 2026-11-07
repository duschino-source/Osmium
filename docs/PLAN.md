# Conductor: Build Plan for Argon 4

Working name: Conductor. A desktop IDE and chat app that drives the coding CLIs people already pay for (Codex CLI, Antigravity, DeepSeek CLI and others) from one place, with projects, a primary and secondary CLI per project, and a /teamwork mode that splits work across CLIs.

## 0. How to work (read first)
• Build in the phases of section 8, in order. One phase per session. Stop at the end of each phase and report using the format in section 10.
• Keep docs/PROGRESS.md in the repo: what is done, what is next, decisions made, open questions. Read it at the start of every session and update it at the end. A fresh session must be able to resume from it alone.
• In the first session, copy this plan into docs/PLAN.md.
• Never guess how a third-party CLI behaves. Probe it on this machine (section 5) and record what you find.
• Small, reviewable commits. Every phase ends with typecheck, lint and tests passing.
• If something here is impossible, or you know a better option, say so and propose the change before doing it.
• Be economical: do not rewrite files that already work and do not add features that belong to a later phase.

## 1. Product
One app where a developer connects the coding CLIs they already subscribe to, so no API keys are needed. The app is both an everyday IDE (open a folder, edit, chat, review diffs, undo) and an orchestrator.
• Projects: each project has a primary CLI (example: Codex) and secondary CLIs (example: Antigravity, DeepSeek).
• Chat: one conversation UI for every CLI, with the same look for messages, tool calls, edited files and approvals.
• /teamwork: the primary CLI splits a goal into tasks; each task is assigned to a CLI (by routing rules, by hand, or by the primary) and runs in its own git worktree; the user reviews and merges.
• Quota fallback: when one subscription hits its limit, work can move to the next CLI.

## 2. Non-negotiable rules
1. Official CLIs only, run as child processes. Never read, copy, store or forward a provider's login tokens, cookies or credentials. Each CLI manages its own login. The app only finds out whether a CLI works by running it.
2. No API key is required anywhere in the app.
3. Local first: no account, no server, no telemetry unless the user opts in. Project data lives in the repo's .conductor/ folder and a local SQLite database.
4. Default approval mode is ask. Full-auto only when the user chose it for that project.
5. The app never writes outside the project root or its own worktrees.
6. Windows, macOS and Linux are all supported. Test Windows early: ConPTY, path separators, CRLF, long paths.
7. All colors, radii and spacing come from CSS variables from day one so a dark theme is a token swap.

## 3. Tech stack (decided)
• Electron, React, TypeScript (strict), Vite. One language end to end, and child processes plus node-pty are first class.
• pnpm monorepo: apps/desktop, packages/core (orchestrator, types, storage), packages/adapters (one folder per CLI), packages/ui (components and tokens), packages/mock-cli (a fake CLI for tests).
• Monaco for the editor, xterm.js with node-pty for terminals, the system git CLI (spawned) for git and worktrees, better-sqlite3 for storage, zod for validation, zustand for UI state, vitest and Playwright for tests.
• Typed IPC between the main process and the renderer. The renderer never spawns processes.

## 4. Architecture
Layers, bottom to top:
1. Adapters: one per CLI, all implementing the same interface and emitting the same normalized events.
2. Session manager: starts, resumes, cancels and records sessions; persists the event log to SQLite.
3. Checkpoints: before every agent turn, snapshot the working tree as a commit under refs/conductor/checkpoints/, never on the user's branch. Undo restores from it.
4. Orchestrator: planner, router, scheduler and worktree manager for /teamwork.
5. UI: sidebar, chat, editor and diff pane, teamwork board, CLI Hub.

The core contract:
```typescript
export type CliId = 'codex' | 'antigravity' | 'deepseek' | (string & {});

export interface CliAdapter {
  id: CliId;
  displayName: string;
  detect(): Promise<{ installed: boolean; version?: string; path?: string }>;
  capabilities(): Promise<Capabilities>; // from the probe, cached per version
  start(opts: StartOptions): Promise<AgentSession>;
}

export interface StartOptions {
  cwd: string; // project root or a task worktree
  approvalMode: 'ask' | 'auto-edit' | 'full-auto';
  resume?: string; // provider session id, if the CLI supports it
  systemContext?: string; // project rules or a handoff summary
}

export interface AgentSession {
  id: string;
  events: AsyncIterable<AgentEvent>;
  send(prompt: string, attachments?: string[]): Promise<void>;
  respondToApproval(id: string, allow: boolean): Promise<void>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}

export type AgentEvent =
  | { type: 'message'; role: 'assistant' | 'user'; text: string; final: boolean }
  | { type: 'tool'; id: string; name: string; status: 'running' | 'done' | 'error'; summary?: string }
  | { type: 'file-edit'; path: string; added: number; removed: number }
  | { type: 'approval'; id: string; kind: 'command' | 'edit' | 'network'; detail: string }
  | { type: 'usage'; limitHit?: boolean; note?: string }
  | { type: 'status'; state: 'idle' | 'working' | 'waiting' | 'error'; message?: string }
  | { type: 'raw'; data: string };
```

Transport per adapter, in order of preference: (1) Agent Client Protocol (ACP) if the CLI supports it, (2) the CLI's headless or JSON streaming mode, (3) a pseudo-terminal session with output parsing. Always forward unparsed output as raw events so nothing is lost when parsing fails.

## 5. Adapters and probing
This plan was written without access to the real CLIs, so exact flags and output formats are unknown. Before writing any adapter:
1. Run `<cli> --version` and `<cli> --help` (and the help of any subcommand that looks relevant, such as exec, run, chat, acp, json or headless).
2. Check for an ACP mode, a JSON or stream output mode, a resume or session option, and approval or sandbox flags.
3. Record findings in `docs/adapters/<cli>.md`: version tested, command lines, sample real output saved as fixtures under `packages/adapters/<cli>/fixtures/`, known limits.
4. Build a `capabilities()` result from those findings: `acp`, `jsonStream`, `resume`, `approvals`, `readOnlyMode`, `reportsUsage`.
5. If a needed capability is missing, degrade gracefully (for example no resume means the app re-sends a summary) and note it in the CLI Hub screen.
Every adapter must pass the same contract test suite (section 9). Adapters are versioned against the CLI versions they were tested with, and an untested newer version shows a warning, not an error.

## 6. Project config
Stored at `.conductor/project.yaml` in each project and editable from the UI:
```yaml
version: 1
name: api-gateway
primary: codex
secondary: [antigravity, deepseek]
approvalMode: ask
routing:
  - when: planning
    cli: codex
  - when: browser-check
    cli: antigravity
  - when: tests
    cli: deepseek
fallback:
  onQuotaHit: next-secondary
teamwork:
  maxParallel: 2
  integrationBranch: conductor/integration
```
Validate with zod. Unknown keys are kept, never deleted.

## 7. Design spec
Style: calm, light, soft green, rounded. Modeled on the reference screenshots (Qoder-like structure) with an original identity. Dark theme comes in Phase 6 but all tokens are variables now.
Tokens:
• Ground #F6F8F5, sidebar #EAF1E8, border #D2DFD0, ink #1B2B22, muted text #566A5E, accent #2F6B4F, diff add #E3F3E2, diff remove #F8E4E4.
• CLI colors: Codex #1B2B22, Antigravity #2F5FD0, DeepSeek #6B4FD0. A new CLI gets the next color from a fixed palette. A CLI is always shown as a colored dot plus its name, never by color alone.
• Type: Inter (bundled locally, not fetched), monospace ui-monospace, Menlo, Consolas. Body 13px, headings 15 to 30px.
• Radii: 8 for buttons and rows, 12 for cards, 14 for the composer. Window is 1200 by 720 minimum 960 by 600.
Layout: left sidebar 216px, main area, optional right pane 360px (diff or editor).
• Sidebar: a Code and Chat toggle at the top; New Task, Projects, Teamwork, Search; a PROJECTS list where each project has a dot in its primary CLI color; RECENT sessions; at the bottom CLI Hub, Automations, Extensions.
• Home: headline, one row of CLI status chips (name, Primary or Second label, plus a dashed Connect CLI chip), a large composer, three quick-start buttons.
• Session: header with title and CLI badge; messages; tool lines in muted text; an Edited N files card (counts, Undo, Review); handoff lines showing which CLI did what; a slash-command menu above the composer; right pane with file tabs and a diff.
• Composer: plus button, approval mode selector, CLI selector (shows the current CLI), mode (Auto), Send. Typing / opens the command menu.
• Teamwork board: columns Queued, Running, Review, Done; cards show title, CLI badge and status; header shows the orchestrator and a Reassign button; a bottom strip shows the auto-assign rules with an Edit rules button.
• CLI Hub: one row per CLI with installed, version, working or not, capabilities found, a Test button, and the tested-version warning.
Accessibility: real buttons, visible focus rings, contrast at least 4.5:1 for text, full keyboard use, and the command palette on Ctrl or Cmd plus K.

## 8. Phases
Phase 0: Scaffold
• Monorepo, strict TypeScript, eslint, prettier, vitest, a Playwright smoke test, CI script.
• Electron window with the app shell: sidebar and empty main area, tokens as CSS variables, bundled Inter.
• packages/mock-cli: a Node script that prints scripted events with delays, including a streamed answer, a file edit, an approval request and a simulated quota error.
• Done when: dev command opens the window, tests pass, shell matches the design.
Phase 1: One CLI, one chat
• Detection service and the CLI Hub screen.
• Mock adapter first, then the Codex adapter after probing.
• Chat UI: streaming messages, tool lines, composer, cancel, error states.
• Sessions and events persisted in SQLite.
• Done when: a full chat works with the mock, works with Codex if installed, cancel works, and history survives a restart.
Phase 2: Editor and review
• Open folder, file tree, Monaco tabs, save, an integrated terminal.
• Checkpoints before each turn, the Edited files card, diff view in the right pane, Undo.
• Approval prompts in the chat (allow, deny, allow for this session).
• Done when: an agent edit shows as a diff, Undo restores the tree exactly, and approvals block until answered.
Phase 3: Projects and multiple CLIs
• Projects list, project.yaml, primary and secondary pickers, per-project approval mode.
• Antigravity and DeepSeek adapters, each after its probe, each with its adapter doc and fixtures.
• Switch CLI mid-session: build a handoff summary from the event log and pass it as systemContext to the new CLI. Show a handoff line in the chat.
• Done when: the same project can be driven by three CLIs, and switching keeps context.
Phase 4: Slash commands
• Composer parser and menu for /plan, /review, /teamwork, /cli <name>, /undo.
• /plan: the primary CLI writes a plan, shown as an editable checklist; nothing is edited until the user approves it.
• /review: a different CLI reviews the latest diff in read-only mode and returns comments.
• Done when: each command works end to end with the mock and at least one real CLI.
Phase 5: Teamwork
• Planner: the primary outputs tasks as structured data (title, scope globs, dependencies, task type). Validate with zod; on invalid output retry once, then show the raw text and let the user fix it.
• Router: routing rules, manual assignment, or let the primary decide.
• Worktrees: one git worktree per task under .conductor/worktrees/, all branched from the integration branch. Warn when a task edits files outside its scope.
• Scheduler: respects dependencies and maxParallel; survives an app restart and resumes.
• Board UI as designed; card detail with the task's chat; reassign; retry with another CLI.
• Merge: review each task diff, merge into the integration branch, stop on conflicts and offer to assign the conflict to a CLI.
• Done when: with the mock, a goal splits into four tasks across three CLIs and merges cleanly, including after killing and restarting the app mid-run.
Phase 6: Quota, replay, polish
• Usage meter per CLI based only on what the CLI reports (turns run, last time a limit was hit). Never invent limits or numbers.
• Quota fallback: on a limit-hit event, offer or automatically move the task to the next secondary, according to the project setting.
• Session replay timeline; command palette; settings; dark theme; keyboard shortcuts.
• Done when: a simulated limit-hit moves a task to another CLI and the board shows it.
Phase 7: SDK and release
• Adapter SDK: documented interface, a template adapter, contract tests that third parties can run, and loading adapters from a user folder.
• Packaging with electron-builder for Windows, macOS and Linux; updates off by default.
• README, docs, and a license (ask the owner which one before choosing).
• Done when: installers build and a template adapter can be added without touching core code.

## 9. Testing
• The mock CLI makes the UI and orchestrator testable without any subscription. Build features against it first.
• Contract test suite that every adapter must pass: start, stream a message, report a file edit, handle an approval, cancel mid-run, resume or degrade, report usage if supported.
• Fixture tests: replay recorded real CLI output through each adapter's parser.
• Playwright flows: first run, chat, edit and undo, switch CLI, /teamwork happy path, restart mid-teamwork.
• Windows run of the test suite before Phase 2 and again before Phase 7.

## 10. Definition of done and report format
A phase is done only when typecheck, lint and tests pass, the acceptance line for the phase is met, docs/PROGRESS.md is updated, and the app runs from a clean clone using the documented commands.
End every phase with a report:
1. Done: what works now.
2. Not done: anything skipped or partial, and why.
3. Decisions: anything you chose that this plan did not decide.
4. Problems: bugs, risks, unknowns found.
5. How to run and test it.
6. Next: what the next phase will do.

## 11. Risks and open decisions
• CLI interfaces change. Mitigation: capability probe, version-tagged adapters, raw fallback, fixtures.
• Provider terms for subscription use can change. Mitigation: official CLIs only, no token handling, and a note in the README to check each provider's current terms.
• The Antigravity and DeepSeek CLIs may offer little structured output. Mitigation: pseudo-terminal transport with a conservative parser; degrade features, do not fake them.
• Parallel agents can conflict. Mitigation: worktrees, scopes, merge review, conflict flow.
• Windows pseudo-terminal quirks. Mitigation: test early, keep a path-handling utility.
• Open for the owner: final product name, license, whether to open-source from the start, and which CLIs beyond the first three to support.

## 12. Kickoff prompt (paste this first)
You are building the desktop app described in this plan. Work only on Phase 0 in this session. First create docs/PLAN.md from this document and docs/PROGRESS.md. Then scaffold the monorepo, the app shell from the design spec, the mock CLI and the tests. Do not start Phase 1. Do not guess how any real CLI behaves. When Phase 0 is done, stop and send the report in section 10.

## 13. IDE core (a major part of the product)
Conductor is an IDE first and an orchestrator second: a developer should be able to leave VS Code for it. This section extends sections 3, 7 and 8. Where they conflict, this section wins. Screens for it are on the design canvas: IDE workspace, and Source control with inline hunk review.

### 13.1 Decision: how to build the IDE
• Build our own workbench on Monaco. Do not fork Code - OSS. Reasons: full design freedom (section 7), a codebase small enough to build and maintain in limited sessions, the orchestration layer is the real differentiator, and contributors can start in days instead of weeks.
• Accepted cost: no VS Code extension host in v1. Mitigations: import VS Code themes, keybindings and snippets; TextMate grammars for highlighting; language servers over LSP; our own small extension API (13.5).
• Revisit after IDE-4. If users demand the VS Code marketplace, a Code - OSS based edition can reuse packages/core and the adapters.

### 13.2 Feature scope (an everyday IDE must have all of these)
• Explorer: lazy tree, create, rename, delete, move and drag and drop, file icons, git status letters and colors, .gitignore aware, file watcher.
• Editor: tabs, preview tabs, pinned tabs, split right and down, breadcrumbs, multi-cursor, find and replace, format on save, auto-save, image and markdown preview, large-file safe mode, restore tabs on restart. Never overwrite a file that changed on disk without showing a conflict.
• Search: project search with ripgrep (spawned), regex, case, whole word, include and exclude globs, streaming results, replace across files with a preview.
• Terminal: multiple tabs and splits, shell profiles (PowerShell, cmd, bash, zsh), clickable file paths, starts in the project folder.
• Source control (system git): changes list, stage and unstage files and hunks, commit, branches, history, blame, stash, three-way merge conflict editor.
• Code intelligence: Monaco built-ins for TypeScript, JavaScript, JSON, CSS and HTML; a language server manager for the rest (typescript-language-server, pyright, rust-analyzer, gopls, clangd, and others) that detects what is installed, shows install hints, and never installs anything silently. Diagnostics, hover, completion, go to definition, references, rename, code actions, outline, Problems panel.
• Navigation and settings: command palette (Ctrl or Cmd plus Shift plus P), quick open (Ctrl or Cmd plus P), go to symbol, keybindings editor, settings UI backed by a settings file, light and dark themes.
• Status bar: branch, sync state, problems count, language, encoding, line endings, cursor position, current CLI.
• Tasks and debugging (IDE-4): run scripts from package.json and similar files; debugger through the Debug Adapter Protocol, Node and Python first, with breakpoints, call stack, variables and a debug console.
• Out of scope for v1: remote SSH, dev containers, collaborative editing. WSL support on Windows is a stretch goal.

### 13.3 How the IDE and the agents connect (the all-in-one part)
• The Agent panel docks on the right of the editor and is the same chat as the Session screen. Toggle with Ctrl or Cmd plus L. Switching the CLI in the panel does not lose the conversation.
• Context chips in the composer: @file, @selection, @problems, @diff, @terminal. The active file and selection are added automatically and can be removed.
• Select code, then Ask, Explain or Fix opens the composer with the right chips already attached.
• Agent edits always go through checkpoints and review. Changed lines show a green gutter in the editor, and each hunk has Accept, Reject and Ask to change (see the Source control screen). Accept all and Reject all are available.
• A Follow agent toggle opens files as the agent edits them. Tabs show a dot in the CLI's color for files an agent is changing right now.
• Terminal output can be sent to the agent with one click (Fix this error).
• All of this is built on the command registry (13.4), so the palette, menus, keybindings and extensions can trigger the same actions.

### 13.4 Architecture additions
Create packages/ide-core with these services, all in the main process behind typed IPC: workspace, file service (watcher via @parcel/watcher or chokidar), search service (ripgrep), git service, LSP manager, terminal service, settings and keybindings, a single command registry, and a layout manager (panels, splits, sizes; persisted per project).
The renderer talks to services only through the command registry and typed IPC. Performance targets: cold start to interactive in under 3 seconds, a 10,000 file folder opens with a lazy tree, typing latency no worse than plain Monaco, search over 100,000 files streams its first results quickly.

### 13.5 Extension API (small on purpose)
• Extensions live in ~/.conductor/extensions/<name>/ with a conductor.json manifest that declares what they contribute and the permissions they need.
• v1 contribution types: themes, snippets, language servers, CLI adapters, commands, and sandboxed panels (webviews).
• No arbitrary Node access without a visible permission prompt. Install from a folder or a git URL. There is no marketplace in v1.
• Importers for VS Code themes, keybindings and snippets. VS Code extensions themselves are not supported in v1.

### 13.6 IDE phases (interleave with the main phases)
• IDE-1 Workbench, after Phase 2: layout manager, explorer with file operations and watcher, editor tabs and splits, quick open, command palette, settings, status bar, session restore. Done when a real project can be opened, edited, saved and restored after a restart without data loss.
• IDE-2 Search and Git, after IDE-1: ripgrep search and replace, source control panel with hunk staging, commit, branches, blame and the merge conflict editor. Done when a full commit and a conflict resolution can be done without leaving the app.
• IDE-3 Code intelligence, after Phase 4: LSP manager, Monaco built-ins, Problems panel, outline, rename, code actions, plus the agent context chips and Ask, Explain and Fix actions. Done when TypeScript and Python projects get diagnostics and go to definition, and a chip-based agent request works.
• IDE-4 Debug and tasks, after Phase 6: DAP debugger for Node and Python, tasks runner, terminal splits and profiles. Done when a breakpoint can be hit and inspected in a Node project.
• IDE-5 Extensions and themes, with Phase 7: extension API, theme, keybinding and snippet importers, install from folder or git URL, an extension template. Done when a sample theme and a sample language server load from the extensions folder.

### 13.7 Open source setup
• The owner picks the license (Apache-2.0 or MIT are the usual choices for this kind of project) before the first public commit.
• Add CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, issue templates, good-first-issue labels, and a public roadmap in docs/ROADMAP.md.
• Make contributing a new CLI adapter the easiest path: the template adapter, the contract test suite and a short guide in docs/adapters/.
• Do not bundle provider logos or trademarks. Show CLI names as text with the app's own colored dots.
• Every release is built in CI from tagged commits, with checksums published.
