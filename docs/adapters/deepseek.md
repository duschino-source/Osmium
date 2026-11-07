# DeepSeek CLI Adapter — Probe Report and Contract

Status: **no real `deepseek` binary is installed on this machine.** Everything
below distinguishes what was measured from what the adapter merely supports.
Nothing in this document is derived from an imagined CLI interface.

Last probed: **2026-11-07**, Windows, repository `E:\SeriousProject\Osmium`,
toolchain `cargo 1.99.1`, `node v24.21.0`.

## 1. What the CLI is

Unknown. No official DeepSeek CLI interface has been observed on this host or
on the Linux host recorded in `docs/PROGRESS.md` (session 1 probe: `which
deepseek` → not found). Consequently this adapter does **not** claim that
`deepseek` exists, that it has a `chat` subcommand, that it accepts `--json`,
or that any version was tested.

The previous implementation asserted `deepseek chat --json`, set
`DEEPSEEK_TESTED_VERSION = "1.0.0"`, and returned all capabilities `true`.
That was a hypothesis, and it is now removed:

- `DEEPSEEK_TESTED_VERSION` is `Option<&str> = None` (`crates/adapters/src/builtins/deepseek.rs`).
- Capabilities come from the binary's real `--help` at runtime.
- `acp` and `approvals` are always `false` because this adapter does not
  implement an ACP transport or a CLI approval protocol.

## 2. Probe commands and real output

Run on Windows in `E:\SeriousProject\Osmium`:

```powershell
Get-Command deepseek -ErrorAction SilentlyContinue        # no output
Get-Command deepseek.exe -ErrorAction SilentlyContinue    # no output
Get-Command deepseek.cmd -ErrorAction SilentlyContinue    # no output
Get-Command deepseek.bat -ErrorAction SilentlyContinue    # no output
where.exe deepseek                                        # no output
```

Common install locations checked (all absent):

```text
%LOCALAPPDATA%\Programs\deepseek
%LOCALAPPDATA%\deepseek
%APPDATA%\npm\deepseek.cmd
%APPDATA%\npm\deepseek
%USERPROFILE%\.local\bin\deepseek.exe
%USERPROFILE%\.deepseek\bin
%ProgramFiles%\DeepSeek
%ProgramFiles(x86)%\DeepSeek
```

Package-manager shim directories checked: `%USERPROFILE%\scoop\shims`,
`C:\ProgramData\chocolatey\bin`, `%USERPROFILE%\.cargo\bin`,
`%LOCALAPPDATA%\Microsoft\WinGet\Links`. No `deepseek*` entry.
`npm root -g` = `C:\Users\stane\AppData\Roaming\npm\node_modules`; no
`deepseek` package installed there.

`PATH` at probe time:

```text
C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot\bin;C:\Python314\Scripts\;C:\Python314\;C:\WINDOWS\system32;C:\WINDOWS;C:\WINDOWS\System32\Wbem;C:\WINDOWS\System32\WindowsPowerShell\v1.0\;C:\WINDOWS\System32\OpenSSH\;C:\Program Files\dotnet\;C:\Program Files\nodejs\;C:\ProgramData\chocolatey\bin;C:\Program Files\Git\cmd;C:\Program Files\Sunshine;C:\Program Files\Sunshine\tools;C:\Program Files\WSL\;C:\Users\stane\.cargo\bin;C:\Users\stane\AppData\Local\pnpm\bin;C:\Users\stane\AppData\Local\Programs\muse;C:\Users\stane\AppData\Local\agy\bin;C:\Users\stane\AppData\Local\Microsoft\WindowsApps;C:\Users\stane\tools\mingit\cmd;C:\Users\stane\AppData\Roaming\npm;C:\Users\stane\Documents\Codex\2026-10-11\ca\outputs\AndroidTools;C:\Users\stane\Documents\Codex\2026-10-11\ca\outputs\AndroidTools\platform-tools;C:\Users\stane\.dotnet\tools;C:\Users\stane\AppData\Local\Unity\bin
```

Because no binary exists:

- `deepseek --version` was **not** run (there is nothing to run).
- `deepseek --help` and every subcommand help were **not** run.
- No ACP mode, JSON mode, resume flag, approval flag, read-only flag or usage
  signal was observed.
- **The live smoke test is unverified.** The fake-executable smoke in
  `crates/adapters/tests/deepseek_adapter_test.rs` is the only execution
  evidence.

## 3. Capabilities

`Capabilities` is computed by `DeepSeekAdapter::capabilities()` from a real
`--help` probe (`probe_help_text` + `CliProber::probe_capabilities`). The
adapter only advertises a capability when the help text contains a
flag-shaped token and the adapter implements the corresponding behavior.

| Capability | Value with no binary | Value when `--help` shows the flag | Evidence |
|---|---|---|---|
| `acp` | `false` | always `false` | No ACP mode observed; ACP transport is not implemented. |
| `jsonStream` | `false` | `true` for `--json` / `--json-stream` | `crates/adapters/tests/fixtures/deepseek/help-rich.txt`; fake emits NDJSON. |
| `resume` | `false` | `true` for `--resume` | Same fixture; flag is forwarded only when advertised. |
| `approvals` | `false` | always `false` | No CLI approval protocol implemented. Osmium-side gate only (below). |
| `readOnlyMode` | `false` | `true` for `--read-only` / `--readonly` | Flag forwarded only when requested + advertised. |
| `reportsUsage` | `false` | `true` for `--usage` / `--quota` / `quota` | Usage events pass through the normalizer when the CLI emits them. |
| `testedVersion` | `None` | `None` | No real version was ever observed. |

A capability that was not seen working is `false`. This includes `--help`
mentions that are prose rather than flags: `probe_capabilities` ignores the
`Usage:` heading and the word "ask" (both previously produced false
positives, covered by tests).

## 4. Transport and invocation

Preference from `docs/PLAN.md`:

1. **ACP** — not implemented and not observed. `acp: false`.
2. **Headless/JSON streaming** — used only when `--help` advertises
   `--json-stream` or `--json`. Each stdout line is fed to the real
   `NormalizedEventStreamParser` (`crates/adapters/src/normalizer.rs`). A line
   that is a valid `AgentEvent` becomes a typed event; everything else is a
   `{ type: "raw", data }` event. Nothing is dropped.
3. **Plain stdout** — no flags are passed. Every non-empty line becomes `raw`.
   Plain text is deliberately **not** guessed into `message` events.

The invocation is:

```text
<binary> [--json|--json-stream] [--resume <id>] [--read-only]
stdin:    [Osmium session context] ... <prompt> [attached file paths]
```

- Only flags literally present in `--help` are ever appended
  (`DeepSeekAdapter::build_turn_args`).
- The prompt is delivered on **stdin**, never argv. This is a deliberate
  Windows-safety decision: `cmd.exe` interprets `&`, `|`, `>`, `%`, etc. in a
  `.cmd` command line (measured: Rust direct `.cmd` spawn passed `a&b` through
  unescaped and cmd split the command). Prompt text must not be exposed to
  that parser. System context and attachment paths travel in the same stdin
  payload as plain text.
- `resume` ids are restricted to `[A-Za-z0-9._:/\-]` before they may reach
  argv, because they do reach a `.cmd` command line.
- `cwd` is set with `Command::current_dir`; no `--cwd` flag is invented.
- This invocation is a **placeholder protocol**, not a verified DeepSeek
  interface. When a real binary becomes available, re-run the probe and
  correct `build_turn_args`; the rest of the pipeline is probe-driven.

### Approvals

The real CLI exposes no approval mechanism that we have seen, so
`approvals: false`. In `approvalMode: "ask"` the adapter implements an
**Osmium-side gate**: `send` emits an `approval` event whose detail says
`Osmium approval gate (this CLI exposes no approval protocol)`, sets
`status: waiting`, and does not spawn the CLI. `respond_to_approval(true)`
spawns the turn; `false` emits a tool error plus `status: idle` and the CLI is
never started. `auto-edit` and `full-auto` spawn immediately. This is an
Osmium decision, not a claim that the CLI asked.

## 5. Lifecycle

- `send`: one turn at a time. `working`/`waiting` rejects with
  `ERR_ADAPTER_ALREADY_RUNNING`.
- `cancel`: idempotent; kills the child process tree, emits `status:
  cancelled`, reaps with a timeout.
- `close`: terminal and irreversible; subsequent `send`/`cancel` return
  `ERR_ADAPTER_SESSION_CLOSED`; repeat `close` is a no-op.
- `resume`: forwarded only when `--resume` was advertised; otherwise `start`
  returns `ERR_ADAPTER_UNSUPPORTED_CAPABILITY`.
- `readOnly`: forwarded only when `--read-only` was advertised; otherwise
  `start` returns `ERR_ADAPTER_UNSUPPORTED_CAPABILITY`.

### Windows process trees

`npm install -g` produces `.cmd` shims; the direct child is `cmd.exe`, and the
real CLI is its child. `terminate_child_tree` runs `taskkill /T /F /PID` before
`start_kill`/`wait`, so cancelling a `.cmd` turn does not orphan Node. The
`cancel_kills_the_process_tree_and_is_idempotent` test asserts the recorded
Node PID is gone after cancel.

`.cmd`/`.bat` resolution is covered by `find_in_path`. Tests run through a
wrapper whose directory name contains a space, so paths with spaces and CRLF
fixtures are exercised.

## 6. Zero-API-key invariant

`SubprocessSession` removes `FORBIDDEN_ENV_VARS` (case-insensitively, by
iterating the parent environment) before every spawn, including:

```text
OPENAI_API_KEY ANTHROPIC_API_KEY
DEEPSEEK_API_KEY DEEPSEEK_AUTH_TOKEN DEEPSEEK_SESSION_TOKEN
DEEPSEEK_ACCESS_TOKEN DEEPSEEK_REFRESH_TOKEN
GEMINI_API_KEY CODEX_TOKEN
```

`DEEPSEEK_BASE_URL` is not a credential and is preserved. The adapter never
reads, stores, logs or forwards a credential and never calls the DeepSeek HTTP
API. `credentials_are_absent_from_the_child_environment` sets
`DEEPSEEK_API_KEY` and `DEEPSEEK_SESSION_TOKEN` in the test process, spawns the
fake, and asserts the child reports both `absent`.

## 7. Fixtures

All fixtures are **synthetic**, not recordings of a real CLI. They contain no
credentials.

```text
crates/adapters/tests/fixtures/deepseek/
├── README.md             explains that these are synthetic, not recordings
├── fake-deepseek.mjs     executable used by integration tests
├── help-rich.txt         advertises --json, --resume, --read-only, --usage
├── help-minimal.txt      no flags (conservative case)
├── version.txt           "deepseek 2.0.0" (newer than any tested version)
├── stream-json.ndjson    NDJSON AgentEvent stream
└── plain-output.txt      unstructured stdout
```

The fake rejects any argument the adapter did not derive from `--help`, so an
invented command line fails loudly. `recorded_stream_replays_through_the_real_normalizer`
replays the NDJSON fixture through `EventNormalizer`, including a CRLF variant;
it does not reimplement the parser.

Manual run (for inspection only):

```powershell
node crates/adapters/tests/fixtures/deepseek/fake-deepseek.mjs --fake-profile rich --help
node crates/adapters/tests/fixtures/deepseek/fake-deepseek.mjs --fake-profile rich --version
```

## 8. Re-probing when a binary exists

```powershell
Get-Command deepseek
deepseek --version
deepseek --help
deepseek chat --help        # only if `chat` appears in --help
deepseek exec --help        # only if `exec` appears in --help
deepseek acp --help         # only if `acp` appears in --help
```

Record the version, the exact command lines, and the help screen. If the
interface differs from the placeholder above, update `build_turn_args` and the
fixtures, then rerun `cargo test -p osmium-adapters`. Do not set
`DEEPSEEK_TESTED_VERSION` until a version has actually been observed.

## 9. Verification

```powershell
cargo test -p osmium-adapters
```

Current result: see the session report in `docs/PROGRESS.md`. No live smoke is
possible on this host; it remains explicitly unverified.
