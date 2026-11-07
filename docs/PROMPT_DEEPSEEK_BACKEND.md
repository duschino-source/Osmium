# Continuation Prompt — DeepSeek Backend

Paste everything below the line into the next session.

---

You are continuing work on **OsmiumIDE** at `E:\SeriousProject\Osmium`
(Electron + React 19 + TypeScript monorepo, plus a Rust workspace in
`crates/`). The UI revamp is done and verified (see `DESIGN.md`,
`docs/PROGRESS.md`, `docs/design/revamp/`). Do not redo any UI work.

## Your mission

Make the **DeepSeek backend** real: the DeepSeek CLI adapter that detects
the CLI, reports honest capabilities, starts a session, streams normalized
`AgentEvent`s, handles approvals/cancel/close, and degrades to raw output
when the CLI gives nothing structured. One CLI, done properly — not Codex,
not Antigravity, not the session manager, not teamwork.

## Step 0 — Audit before you write anything (report first, then proceed)

Read these and state what you found before implementing:

- `PROJECT.md` (§ adapters, M2), `docs/PLAN.md` (transport preference and
  probe protocol), `docs/PROGRESS.md` (current state).
- `packages/core/src/types.ts` — the contract: `CliAdapter`
  (`detect` / `capabilities` / `start`), `StartOptions`, `AgentSession`,
  `AgentEvent` (`message`, `tool`, `file-edit`, `approval`, `usage`,
  `status`, `raw`).
- The two adapter homes that both exist today:
  - Rust (has code): `crates/adapters/` — `builtins/deepseek.rs`,
    `builtins/codex.rs` (reference), `probe.rs`, `session.rs`
    (`SubprocessSession`), `normalizer.rs`, `env.rs`. Note the Rust
    `AgentSession` trait in `crates/core/src/types.rs` differs from the
    TS one — check it.
  - TypeScript (utilities only): `packages/adapters/src/index.ts` —
    colors, display names, semver. There are no TS adapter
    implementations yet.
- How (if at all) the desktop app consumes a backend today:
  `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`.

Then decide and write down: **which stack is the DeepSeek backend in this
session** (recommendation: Rust `crates/adapters`, because
`DeepSeekAdapter` already exists there), and **how it will be consumed**.
If no wiring to Electron exists yet, wiring a new bridge is out of scope —
say so explicitly; the deliverable is the adapter + its tests + its doc.

## Step 1 — Probe the real CLI. Never invent its interface.

The current Rust adapter assumes `deepseek chat --json` and asserts
capabilities (`json_stream: true`, `resume: false`, …) and
`DEEPSEEK_TESTED_VERSION = "1.0.0"`. All of that is unverified. Treat it
as a hypothesis to falsify, not as truth.

1. Look for the binary: `deepseek` on PATH (also try `deepseek.exe` /
   common install locations on Windows). Record exactly what you ran.
2. If found: run `deepseek --version`, `deepseek --help`, and the help of
   every plausible subcommand (`chat`, `exec`, `run`, `acp`, `--json`,
   headless modes). Look for: an ACP mode, a JSON/streaming mode, a
   resume/session flag, approval or sandbox flags, a read-only flag,
   usage/quota reporting.
3. Record findings in `docs/adapters/deepseek.md`: version tested, exact
   command lines, what each flag actually does. Save short real outputs
   as fixtures under the adapter's fixture location (follow the codex /
   existing fixture conventions if any exist; otherwise create
   `crates/adapters/tests/fixtures/deepseek/`). Redact anything
   credential-shaped from fixtures.
4. If the binary is **not installed** on this machine (likely — see
   `docs/PROGRESS.md` probe history): say so plainly, do not fabricate
   output, and build against (a) the probe protocol above and (b) a
   fake DeepSeek executable in tests (a small script/binary that prints
   canned lines, following the `mock` adapter pattern in
   `crates/adapters/src/builtins/mock.rs` and `packages/mock-cli`).
   Mark every capability you could not verify as `false`/unknown in
   code, with the doc saying "unverified — no binary available".

## Step 2 — Implement, in this order

1. **Detection**: PATH lookup + `--version` probe with timeout, semver
   extraction, non-blocking "newer than tested version" warning. Reuse
   `probe.rs` (`find_in_path`, `probe_cli_executable`,
   `create_version_warning`); do not fork a second prober.
2. **Capabilities**: derive from the probe (`--help` text via
   `CliProber::probe_capabilities` or measured behavior). A capability
   you have not seen working is `false`. Update
   `DEEPSEEK_TESTED_VERSION` only to a version you actually observed.
3. **Session start**: spawn the real command line you verified (Step 1).
   Transport preference per `docs/PLAN.md`: (1) ACP if the CLI supports
   it, (2) its headless/JSON streaming mode, (3) pseudo-terminal/plain
   stdout with the conservative `EventNormalizer` and `{ type: 'raw' }`
   fallback. Reuse `SubprocessSession` — extend it only if DeepSeek
   genuinely needs something it cannot express, and say why.
4. **Event normalization**: map real DeepSeek output onto `AgentEvent`:
   streamed assistant text → `message` (final flag on completion), tool
   activity → `tool`, file changes → `file-edit`, permission prompts →
   `approval`, quota/usage signals → `usage`, lifecycle → `status`,
   anything unparseable → `raw` (never drop output, never guess
   structure that is not there).
5. **Approvals**: honor `approvalMode` (`ask` blocks and waits for
   `respond_to_approval`, `auto-edit`, `full-auto`). If the real CLI has
   no approval mechanism, encode that honestly: `approvals: false` and
   Osmium-side gating only — do not pretend the CLI asked.
6. **Lifecycle**: `send` (one turn at a time; reject or queue per the
   existing session semantics), `cancel` (kills the child, idempotent),
   `close` (terminal, irreversible), resume only if the CLI really
   supports it. No zombie processes; timeouts on every wait.
7. **Zero-API-key invariant**: child process only. The child's
   environment must be scrubbed of `DEEPSEEK_API_KEY` and friends —
   verify `crates/adapters/src/env.rs` (`FORBIDDEN_ENV_VARS`,
   `is_forbidden_env_var`) actually covers the spawn path in
   `session.rs`, and add a test that proves the variable is absent.
   Never read, store, log, or forward any credential. Never call the
   DeepSeek HTTP API as a substitute for the CLI.

## Rules

- Work only inside the adapter surface you chose in Step 0, its tests,
  its fixtures, and `docs/adapters/deepseek.md`. Do not change the UI,
  `packages/core` contracts, or other adapters unless the contract
  itself blocks you — if it does, stop and report instead of silently
  widening scope.
- If you also need the TS side (`packages/adapters`) to expose the
  adapter, keep it a thin parity layer over the same contract; do not
  build a second, divergent implementation.
- Preserve existing public names and behaviors (`DeepSeekAdapter`,
  `with_binary_path`, `builtin_adapters()`, `getCliCssVariable`, …)
  unless they encode a falsehood from Step 1 — then fix the falsehood
  and name the change in your report.
- Windows is a first-class target: `.exe`/`.cmd` resolution, CRLF line
  endings, paths with spaces, ConPTY quirks if you reach the PTY path.
- Every test you add must fail without your change (prove it by
  reverting mentally or actually) — no tests that only assert the code
  says what it says. Fixture tests must replay recorded/fake output
  through the real parser, not a copy of it.

## Verification (run all of these; report real output)

```bash
cargo test -p osmium-adapters
cargo test -p osmium-core        # only if you had to touch core
pnpm --filter @osmium/adapters build && pnpm --filter @osmium/adapters typecheck  # if TS touched
pnpm test                        # repo suite must stay green
node scripts/check-ui-rules.mjs  # proves you touched no UI rules
```

Plus one live smoke, if a real `deepseek` binary exists: detect →
capabilities → start → one harmless prompt in a temp directory → events
stream → cancel. If no binary exists, the fake-executable equivalent
runs in tests and the report says the live smoke is unverified.

## Definition of done

- `docs/adapters/deepseek.md` tells the truth: what the CLI is, what was
  probed, what is verified vs assumed.
- Detection, capabilities, start, streaming, approvals, cancel, close
  all work against fixtures/fake binary (and the real binary if present).
- Unknown output survives as `raw`; nothing is silently swallowed;
  no credentials anywhere; no zombies on cancel/close.
- All verification commands above pass, or failures are reported with
  evidence, not adjectives.

## Report format (end of session)

1. **Stack decision** (Step 0) and how the backend is consumed.
2. **Probe results**: binary found or not; versions/flags actually seen.
3. **What was implemented**, file by file (`crates/adapters/...`,
   fixtures, doc).
4. **Verified vs assumed**: capabilities table with evidence per row.
5. **Test/e2e output**: the commands and their real results.
6. **Not done / risks**: anything deferred (Electron wiring, PTY
   transport, resume) and what blocks it.
7. Update `docs/PROGRESS.md` with a session entry so the next session
   can resume from it alone.

Start with Step 0 now.
